import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
const serviceKey = secretKeys ? JSON.parse(secretKeys).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const allowedOrigins = (Deno.env.get("APP_ALLOWED_ORIGINS") || "*").split(",").map((x) => x.trim());

class HttpError extends Error {
  constructor(message: string, public status = 400, public code = "REQUEST_FAILED") { super(message); }
}
const ok = <T>(result: { data: T | null; error: { message: string } | null }): T => {
  if (result.error) throw new HttpError(result.error.message, 400);
  return result.data as T;
};
const one = async (query: PromiseLike<{ data: any; error: any }>) => ok(await query);
const json = (body: unknown, status = 200, origin = "") => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Vary": "Origin" },
});
const tokenHash = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};
const safeNumber = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const distanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const r = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

async function getProfile(userId: string) {
  return await one(admin.from("profiles").select("*").eq("id", userId).maybeSingle());
}
async function context(request: Request) {
  const bearer = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!bearer) throw new HttpError("Authentication required.", 401, "AUTH_REQUIRED");
  const { data, error } = await admin.auth.getUser(bearer);
  if (error || !data.user) throw new HttpError("Authentication required.", 401, "AUTH_REQUIRED");
  const profile = await getProfile(data.user.id);
  if (!profile) throw new HttpError("Account profile was not found.", 403, "PROFILE_MISSING");
  if (profile.status !== "active") throw new HttpError(profile.status === "pending" ? "Your account is pending administrator approval." : "Your account is disabled.", 403, "ACCOUNT_NOT_ACTIVE");
  return { authUser: data.user, profile };
}
function requireRole(profile: any, role: string) {
  if (profile.role !== role) throw new HttpError("You do not have permission to do that.", 403, "FORBIDDEN");
}
async function catalog() {
  const [academic_years, semesters, classes, subjects] = await Promise.all([
    one(admin.from("academic_years").select("id,year_level,name").order("year_level")),
    one(admin.from("semesters").select("id,academic_year_id,semester_number,name").order("id")),
    one(admin.from("classes").select("id,academic_year_id,name").order("name")),
    one(admin.from("subjects").select("id,code,name,semester_id,teacher_registration_enabled").eq("teacher_registration_enabled", true).order("name")),
  ]);
  const semById = new Map(semesters.map((s: any) => [s.id, s]));
  const yearById = new Map(academic_years.map((y: any) => [y.id, y]));
  return {
    academic_years, semesters, classes,
    subjects: subjects.map((s: any) => {
      const sem: any = semById.get(s.semester_id); const year: any = sem ? yearById.get(sem.academic_year_id) : null;
      return { ...s, semester_number: sem?.semester_number, semester_name: sem?.name, academic_year_id: year?.id, academic_year_name: year?.name, year_level: year?.year_level };
    }),
  };
}
async function assignmentsFor(userId: string) {
  const terms = await one(admin.from("teacher_terms").select("id,semester_id,class_id,class:classes(id,name),semester:semesters(id,name,semester_number,academic_year_id,year:academic_years(id,name,year_level)),links:teacher_subjects(id,subject_id,subject:subjects(id,code,name,semester_id))").eq("teacher_id", userId));
  return terms.flatMap((term: any) => {
    const cls = term.class, sem = term.semester, year = sem?.year;
    return (term.links || []).map((link: any) => {
      const sub = link.subject;
      return {assignment_id:link.id,id:sub?.id,code:sub?.code,name:sub?.name,semester_id:term.semester_id,semester_name:sem?.name,semester_number:sem?.semester_number,academic_year_id:year?.id,academic_year_name:year?.name,year_level:year?.year_level,class_id:cls?.id,class_name:cls?.name};
    });
  });
}
async function ownedAssignment(userId: string, assignmentId: number) {
  const link=await one(admin.from('teacher_subjects').select('id,subject_id,teacher_term_id').eq('id',assignmentId).maybeSingle());
  if(!link)throw new HttpError('Select one of your assigned subjects.',403,'ASSIGNMENT_FORBIDDEN');
  const term=await one(admin.from('teacher_terms').select('teacher_id,semester_id,class_id').eq('id',link.teacher_term_id).single());
  if(term.teacher_id!==userId)throw new HttpError('Select one of your assigned subjects.',403,'ASSIGNMENT_FORBIDDEN');
  return {link,term};
}
async function asUser(profile: any) {
  const result: any = { id: profile.id, username: profile.username, full_name: profile.full_name, role: profile.role };
  if (profile.role === "student") {
    const student = await one(admin.from("students").select("id,student_no,class_id,semester_id,device_uuid,class:classes(id,name,academic_year_id),semester:semesters(id,name,semester_number,academic_year_id,year:academic_years(id,name,year_level))").eq("user_id", profile.id).single());
    const cls = student.class, sem = student.semester, year = sem.year;
    Object.assign(result,{student_no:student.student_no,class_name:cls.name,class_id:cls.id,semester_id:sem.id,semester:{id:sem.id,name:sem.name,number:sem.semester_number},academic_year:{id:year.id,name:year.name,year_level:year.year_level}});
  } else if (profile.role === "teacher") {
    result.subjects=await assignmentsFor(profile.id);
    result.class_name=[...new Set(result.subjects.map((s:any)=>s.class_name))].join(",");
  }
  return result;
}
async function sessionView(session: any, includeToken = false) {
  if (!session) return null;
  const link = await one(admin.from("teacher_subjects").select("id,subject_id,teacher_term_id,subject:subjects(id,code,name,semester_id),term:teacher_terms(semester_id,class_id)").eq("id",session.teacher_subject_id).single());
  const term = link.term, subject = link.subject;
  const [cls,sem]=await Promise.all([
    one(admin.from("classes").select("id,name,academic_year_id").eq("id",term.class_id).single()),
    one(admin.from("semesters").select("id,name,semester_number,academic_year_id,year:academic_years(id,name,year_level)").eq("id",term.semester_id).single()),
  ]);
  const year = sem.year;
  const view:any={id:session.id,session_id:session.id,title:session.title,year_level:year.year_level,class_id:cls.id,class_name:cls.name,teacher_subject_id:link.id,starts_at:session.starts_at,ended_at:session.ended_at,ends_at:session.ended_at,status:session.active?"ACTIVE":"ENDED",active:session.active,attendance_radius_meters:session.attendance_radius_meters,center_accuracy:session.center_accuracy,subject,academic_year:{id:year.id,year_level:year.year_level,name:year.name},semester:{id:sem.id,number:sem.semester_number,name:sem.name}};
  if(includeToken&&session.active&&session.qr_display_token){view.token=session.qr_display_token;view.qr_payload=`ATTENDQR:${session.qr_display_token}`;}
  return view;
}
async function register(input: any) {
  const username=String(input.username||"").trim().toLowerCase(), full_name=String(input.full_name||"").trim(), password=String(input.password||""), role=String(input.role||"");
  if(!(/^[a-z0-9_.-]{3,50}$/).test(username)||!full_name||full_name.length>120||password.length<8||!['student','teacher'].includes(role)) throw new HttpError("Enter a valid name, username, and password with at least 8 characters.",422,"INVALID_REGISTRATION");
  const email=`${username}@accounts.easyattend.invalid`;
  let studentContext:any=null;
  if(role==='student'){
    const identifier=String(input.identifier||"").trim().toUpperCase(); const match=identifier.match(/^([1-6])IT[0-9]+$/);
    if(!match)throw new HttpError("Enter a valid student roll number, such as 4IT15.",422,"INVALID_STUDENT_NUMBER");
    const yearLevel=Number(match[1]), yearId=Number(input.academic_year_id), semesterId=Number(input.semester_id);
    const year=await one(admin.from('academic_years').select('*').eq('id',yearId).maybeSingle());
    const semester=await one(admin.from('semesters').select('*').eq('id',semesterId).maybeSingle());
    if(!year||year.year_level!==yearLevel||!semester||semester.academic_year_id!==yearId)throw new HttpError("Choose the academic year and semester matching your roll number.",422,"INVALID_ENROLLMENT");
    const cls=await one(admin.from('classes').select('*').eq('academic_year_id',yearId).eq('name',`${yearLevel}IT`).maybeSingle());
    if(!cls)throw new HttpError("No class is configured for your academic year.",422,"CLASS_NOT_CONFIGURED");
    studentContext={student_no:identifier,class_id:cls.id,semester_id:semesterId};
  }
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
  if(created.error||!created.data.user)throw new HttpError(created.error?.message||"Could not create the account.",422,"REGISTRATION_FAILED");
  const userId=created.data.user.id;
  try{
    ok(await admin.from('profiles').insert({id:userId,email,username,full_name,role,status:'pending'}));
    if(role==='student')ok(await admin.from('students').insert({user_id:userId,...studentContext}));
    else ok(await admin.from('teachers').insert({user_id:userId}));
  }catch(err){await admin.auth.admin.deleteUser(userId);throw err;}
  return {message:"Registration submitted. An administrator must approve your account before you can sign in."};
}

async function api(request: Request) {
  const urlObject=new URL(request.url), action=urlObject.searchParams.get('action')||'health';
  const input=request.method==='GET'?Object.fromEntries(urlObject.searchParams.entries()):await request.json().catch(()=>({}));
  if(action==='health')return {message:'EasyAttend Supabase API is running'};
  if(action==='registration/subjects')return await catalog();
  if(action==='register')return await register(input);
  const {profile}=await context(request);
  if(action==='login'){
    if(profile.role==='student'){
      const device=String(input.device_uuid||'');if(!device)throw new HttpError("Device identification is required.",422,"DEVICE_REQUIRED");
      const row=await one(admin.from('students').select('id,device_uuid').eq('user_id',profile.id).single());
      if(row.device_uuid&&row.device_uuid!==device)throw new HttpError("This account is registered on another device.",403,"DEVICE_MISMATCH");
      if(!row.device_uuid){const updated=await one(admin.from('students').update({device_uuid:device}).eq('id',row.id).is('device_uuid',null).select('id'));if(!updated.length){const check=await one(admin.from('students').select('device_uuid').eq('id',row.id).single());if(check.device_uuid!==device)throw new HttpError("This account is registered on another device.",403,"DEVICE_MISMATCH");}}
    }
    return {user:await asUser(profile)};
  }
  if(action==='me')return {user:await asUser(profile)};
  if(action==='logout')return {message:'Logged out'};
  if(action==='admin/users'){
    requireRole(profile,'admin');return {users:await one(admin.from('profiles').select('id,username,full_name,role,status,created_at').order('created_at',{ascending:false}))};
  }
  if(action==='admin/verify'||action==='admin/status'){
    requireRole(profile,'admin');const status=action==='admin/verify'?'active':String(input.status||'');
    if(!['active','disabled'].includes(status))throw new HttpError("Status must be active or disabled.",422);
    const updated=await one(admin.from('profiles').update({status}).eq('id',input.user_id).neq('role','admin').select('id'));
    if(!updated.length)throw new HttpError("Account not found or cannot be updated.",404);
    return {message:action==='admin/verify'?'Account approved.':`Account ${status}.`};
  }
  if(action==='admin/device/reset'){
    requireRole(profile,'admin');const student=await one(admin.from('students').update({device_uuid:null}).eq('user_id',input.user_id).select('id'));
    if(!student.length)throw new HttpError("Student account not found.",404);return {message:'Student device registration reset.'};
  }
  if(action==='admin/subject'){
    requireRole(profile,'admin');const name=String(input.name||'').trim(),code=String(input.code||'').trim().toUpperCase(),semesterId=Number(input.semester_id);
    const sem=await one(admin.from('semesters').select('id').eq('id',semesterId).maybeSingle());if(!sem||!name)throw new HttpError('Subject name and valid semester are required.',422);
    if(code){const {error}=await admin.from('subjects').upsert({code,name,semester_id:semesterId,teacher_registration_enabled:true},{onConflict:'semester_id,code'});if(error)throw new HttpError(error.message,422);}else ok(await admin.from('subjects').insert({code:null,name,semester_id:semesterId,teacher_registration_enabled:true}));
    return {message:'Subject saved.'};
  }
  if(action==='subjects'){
    const [rows,semesters,years]=await Promise.all([one(admin.from('subjects').select('*').order('name')),one(admin.from('semesters').select('*')),one(admin.from('academic_years').select('*'))]);
    return {subjects:rows.map((s:any)=>{const sem=semesters.find((x:any)=>x.id===s.semester_id),year=sem&&years.find((x:any)=>x.id===sem.academic_year_id);return {...s,semester_name:sem?.name,semester_number:sem?.semester_number,academic_year_id:year?.id,academic_year_name:year?.name};})};
  }
  if(action==='student/profile'){
    requireRole(profile,'student');const student=await one(admin.from('students').select('id,student_no,class_id,semester_id').eq('user_id',profile.id).single());return {profile:{...await asUser(profile),...student}};
  }
  if(action==='student/attendance'){
    requireRole(profile,'student');const student=await one(admin.from('students').select('id').eq('user_id',profile.id).single());
    const rows=await one(admin.from('attendance').select('status,recorded_at,attendance_sessions!inner(id,title,teacher_subject_id,teacher_id)').eq('student_id',student.id).order('recorded_at',{ascending:false}));
    const [links,subjects,semesters]=await Promise.all([one(admin.from('teacher_subjects').select('id,subject_id,teacher_term_id')),one(admin.from('subjects').select('id,code,name,semester_id')),one(admin.from('semesters').select('id,name,semester_number'))]);
    return {attendance:rows.map((a:any)=>{const session=a.attendance_sessions,link=links.find((x:any)=>x.id===session.teacher_subject_id),subject=link&&subjects.find((x:any)=>x.id===link.subject_id),sem=subject&&semesters.find((x:any)=>x.id===subject.semester_id);return {status:a.status,recorded_at:a.recorded_at,title:session.title,code:subject?.code,name:subject?.name,semester_name:sem?.name,teacher_name:''};})};
  }
  if(action==='student/scan'){
    requireRole(profile,'student');const token=String(input.token||'').trim().replace(/^ATTENDQR:/i,'');const latitude=Number(input.latitude),longitude=Number(input.longitude),accuracy=Number(input.accuracy);
    if(!token)throw new HttpError('A QR token is required.',422,'INVALID_QR');
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||!Number.isFinite(accuracy)||latitude < -90||latitude>90||longitude < -180||longitude>180||accuracy<=0)throw new HttpError('Precise location permission is required.',422,'LOCATION_PERMISSION_REQUIRED');
    const maxAccuracy=Number(Deno.env.get('ATTENDANCE_MAX_ACCURACY_METERS')||100);
    if(accuracy>maxAccuracy)throw new HttpError('Your location is not accurate enough. Enable precise GPS and try again.',422,'POOR_LOCATION_ACCURACY');
    const hash=await tokenHash(token);const session=await one(admin.from('attendance_sessions').select('*').eq('qr_token_hash',hash).maybeSingle());if(!session||!session.active)throw new HttpError('This QR session is invalid or has ended.',410,'SESSION_ENDED');
    const assignment=await one(admin.from('teacher_subjects').select('id,subject_id,teacher_term_id').eq('id',session.teacher_subject_id).single());const term=await one(admin.from('teacher_terms').select('semester_id,class_id').eq('id',assignment.teacher_term_id).single());
    const student=await one(admin.from('students').select('id,class_id,semester_id').eq('user_id',profile.id).single());if(student.class_id!==term.class_id||student.semester_id!==term.semester_id)throw new HttpError('This attendance session is for a different class or semester.',403,'WRONG_CLASS');
    if(!Number.isFinite(session.center_latitude)||!Number.isFinite(session.center_longitude))throw new HttpError('This QR session has no saved location. End it and start a new session.',409,'SESSION_LOCATION_REQUIRED');
    const radius=Number(session.attendance_radius_meters)||100;
    const distance=distanceMeters(latitude,longitude,session.center_latitude,session.center_longitude);if(distance>radius)throw new HttpError(`You are outside the allowed ${radius} meter attendance area.`,403,'OUTSIDE_ALLOWED_AREA');
    const inserted=await admin.from('attendance').insert({session_id:session.id,student_id:student.id,status:'present',latitude,longitude,accuracy,distance_from_classroom:distance}).select('id');
    if(inserted.error?.code==='23505')throw new HttpError('Attendance has already been recorded.',409,'DUPLICATE_ATTENDANCE');if(inserted.error?.code==='P0001')throw new HttpError('This QR attendance session has ended.',410,'SESSION_ENDED');if(inserted.error)throw new HttpError(inserted.error.message,400);
    return {code:'SUCCESS',message:'Attendance recorded successfully.',distance_from_classroom:distance,allowed_radius:radius};
  }
  if(action==='teacher/assignments'){
    requireRole(profile,'teacher');const yearId=Number(input.academic_year_id),semesterId=Number(input.semester_id),classId=Number(input.class_id),ids=[...new Set((Array.isArray(input.subject_ids)?input.subject_ids:[input.subject_ids]).map(Number).filter(Boolean))];
    const [year,sem,cls]=await Promise.all([one(admin.from('academic_years').select('id').eq('id',yearId).maybeSingle()),one(admin.from('semesters').select('id,academic_year_id').eq('id',semesterId).maybeSingle()),one(admin.from('classes').select('id,academic_year_id').eq('id',classId).maybeSingle())]);
    if(!year||!sem||!cls||sem.academic_year_id!==yearId||cls.academic_year_id!==yearId)throw new HttpError('Select a valid academic year, semester, and class.',422);
    const allowed=await one(admin.from('subjects').select('id').eq('semester_id',semesterId).eq('teacher_registration_enabled',true).in('id',ids.length?ids:[-1]));if(allowed.length!==ids.length)throw new HttpError('Subjects must belong to the selected semester.',422);
    if(!ids.length)throw new HttpError('Select at least one subject.',422);
    const term=await one(admin.from('teacher_terms').upsert({teacher_id:profile.id,semester_id:semesterId,class_id:classId},{onConflict:'teacher_id,semester_id,class_id'}).select('id').single());
    const existing=await one(admin.from('teacher_subjects').select('id,subject_id').eq('teacher_term_id',term.id));const remove=existing.filter((x:any)=>!ids.includes(x.subject_id));
    if(remove.length){const sessions=await one(admin.from('attendance_sessions').select('teacher_subject_id').in('teacher_subject_id',remove.map((x:any)=>x.id)));if(sessions.length)throw new HttpError('Assignments with attendance history cannot be removed.',409);await one(admin.from('teacher_subjects').delete().in('id',remove.map((x:any)=>x.id)));}
    const had=new Set(existing.map((x:any)=>x.subject_id));const adds=ids.filter(id=>!had.has(id));if(adds.length)ok(await admin.from('teacher_subjects').insert(adds.map(subject_id=>({teacher_term_id:term.id,subject_id}))));
    return {message:'Academic assignment saved.',user:await asUser(profile)};
  }
  if(action==='attendance/create'){
    requireRole(profile,'teacher');const assignmentId=Number(input.teacher_subject_id),title=String(input.title||'').trim();if(!title||title.length>150)throw new HttpError('Enter a session title.',422);
    const centerLatitude=Number(input.latitude),centerLongitude=Number(input.longitude),centerAccuracy=Number(input.accuracy);
    if(!Number.isFinite(centerLatitude)||centerLatitude < -90||centerLatitude>90||!Number.isFinite(centerLongitude)||centerLongitude < -180||centerLongitude>180||!Number.isFinite(centerAccuracy)||centerAccuracy<=0)throw new HttpError('Precise location permission is required to start a QR session.',422,'LOCATION_PERMISSION_REQUIRED');
    const maxAccuracy=Number(Deno.env.get('ATTENDANCE_MAX_ACCURACY_METERS')||100);if(centerAccuracy>maxAccuracy)throw new HttpError('Your location is not accurate enough to start a session. Enable precise GPS and try again.',422,'POOR_LOCATION_ACCURACY');
    const radius=Number(Deno.env.get('ATTENDANCE_RADIUS_METERS')||100);if(!Number.isInteger(radius)||radius<1||radius>5000)throw new HttpError('The attendance radius is not configured correctly.',503,'INVALID_ATTENDANCE_RADIUS');
    await ownedAssignment(profile.id,assignmentId);
    const token=Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b=>b.toString(16).padStart(2,'0')).join('');const hash=await tokenHash(token);
    const created=await admin.from('attendance_sessions').insert({teacher_id:profile.id,teacher_subject_id:assignmentId,title,qr_token_hash:hash,qr_display_token:token,center_latitude:centerLatitude,center_longitude:centerLongitude,center_accuracy:centerAccuracy,attendance_radius_meters:radius,active:true}).select('*').single();
    if(created.error?.code==='23505')throw new HttpError('You already have an active QR session. End it before starting another.',409,'ACTIVE_SESSION_EXISTS');if(created.error)throw new HttpError(created.error.message,400);
    const session=await sessionView(created.data,true);return {session,message:'Attendance session created.'};
  }
  if(action==='attendance/active'){
    requireRole(profile,'teacher');const session=await one(admin.from('attendance_sessions').select('*').eq('teacher_id',profile.id).eq('active',true).order('starts_at',{ascending:false}).limit(1).maybeSingle());return {session:await sessionView(session,true)};
  }
  if(action==='attendance/end'){
    requireRole(profile,'teacher');let query=admin.from('attendance_sessions').update({active:false,ended_at:new Date().toISOString(),qr_display_token:null}).eq('teacher_id',profile.id).eq('active',true);if(input.session_id)query=query.eq('id',Number(input.session_id));const ended=await one(query.select('*').maybeSingle());if(!ended)throw new HttpError('There is no active QR session to end.',404,'NO_ACTIVE_SESSION');return {session:await sessionView(ended),message:'QR attendance session ended.'};
  }
  if(action==='attendance/sessions'){
    requireRole(profile,'teacher');const assignmentId=Number(input.teacher_subject_id);await ownedAssignment(profile.id,assignmentId);
    const rows=await one(admin.from('attendance_sessions').select('id,title,starts_at,ended_at,active').eq('teacher_id',profile.id).eq('teacher_subject_id',assignmentId).order('starts_at',{ascending:false}));return {sessions:rows.map((s:any)=>({...s,session_id:s.id,status:s.active?'ACTIVE':'ENDED'}))};
  }
  if(action==='attendance/session'||action==='attendance/live'){
    requireRole(profile,'teacher');let session:any;
    if(action==='attendance/session'){session=await one(admin.from('attendance_sessions').select('*').eq('id',Number(input.session_id)).eq('teacher_id',profile.id).maybeSingle());}
    else {session=await one(admin.from('attendance_sessions').select('*').eq('teacher_id',profile.id).eq('active',true).order('starts_at',{ascending:false}).limit(1).maybeSingle());if(!session)session=await one(admin.from('attendance_sessions').select('*').eq('teacher_id',profile.id).order('starts_at',{ascending:false}).limit(1).maybeSingle());}
    if(!session)return {session:null,total_students:0,present_students:0,absent_students:0,attendance:[]};
    const link=await one(admin.from('teacher_subjects').select('teacher_term_id').eq('id',session.teacher_subject_id).single());const term=await one(admin.from('teacher_terms').select('semester_id,class_id').eq('id',link.teacher_term_id).single());const classRow=await one(admin.from('classes').select('name').eq('id',term.class_id).single());const students=await one(admin.from('students').select('id,user_id,student_no,class_id,semester_id').eq('class_id',term.class_id).eq('semester_id',term.semester_id));
    const all=await one(admin.from('attendance').select('student_id,status,recorded_at').eq('session_id',session.id).order('recorded_at',{ascending:false}));const profiles=students.length?await one(admin.from('profiles').select('id,full_name,status').in('id',students.map((x:any)=>x.user_id))):[];const profileMap=new Map(profiles.map((p:any)=>[p.id,p]));
    const activeStudents=students.filter((s:any)=>profileMap.get(s.user_id)?.status==='active');const visible=action==='attendance/live'&&session.active?all.slice(0,3):all;const rows=visible.map((a:any)=>{const st=students.find((x:any)=>x.id===a.student_id),p=st&&profileMap.get(st.user_id);return {full_name:p?.full_name||'',student_no:st?.student_no,class_name:classRow.name,status:a.status,recorded_at:a.recorded_at};});
    const present=all.filter((x:any)=>x.status==='present'||x.status==='late').length;const view=await sessionView(session,session.active);
    return action==='attendance/live'?{session:view,total_students:activeStudents.length,present_students:present,absent_students:Math.max(0,activeStudents.length-present),attendance:rows}:{session:view,present_students:present,attendance:rows};
  }
  if(action==='reports/monthly'){
    const month=String(input.month||new Date().toISOString().slice(0,7));if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new HttpError('Month must use YYYY-MM format.',422);
    const from=`${month}-01T00:00:00.000Z`,to=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString();let report:any[]=[],yearLevel=0,response:any={month,required_percentage:75};
    if(profile.role==='student'){
      const st=await one(admin.from('students').select('id,class_id,semester_id,semester:semesters(academic_year_id,year:academic_years(year_level))').eq('user_id',profile.id).single());yearLevel=st.semester.year.year_level;
      const [subjects,terms]=await Promise.all([one(admin.from('subjects').select('id,code,name').eq('semester_id',st.semester_id).eq('teacher_registration_enabled',true)),one(admin.from('teacher_terms').select('id').eq('class_id',st.class_id).eq('semester_id',st.semester_id))]);const links=terms.length?await one(admin.from('teacher_subjects').select('id,subject_id').in('teacher_term_id',terms.map((x:any)=>x.id))):[];
      const sessions=links.length?await one(admin.from('attendance_sessions').select('id,teacher_subject_id,starts_at').in('teacher_subject_id',links.map((x:any)=>x.id)).gte('starts_at',from).lt('starts_at',to)):[];const attendance=sessions.length?await one(admin.from('attendance').select('session_id,status').eq('student_id',st.id).in('session_id',sessions.map((x:any)=>x.id))):[];
      report=subjects.map((sub:any)=>{const assignmentIds=new Set(links.filter((x:any)=>x.subject_id===sub.id).map((x:any)=>x.id));const own=sessions.filter((x:any)=>assignmentIds.has(x.teacher_subject_id));const attended=attendance.filter((a:any)=>own.some((x:any)=>x.id===a.session_id)&&(a.status==='present'||a.status==='late')).length;const percentage=own.length?Math.round(attended/own.length*10000)/100:0;return {...sub,attended,total_sessions:own.length,percentage,meets_requirement:percentage>=75,highlight_red:percentage<75,status:percentage>=75?'Good standing':'Below requirement'};});
      response.semester_id=st.semester_id;
    }else if(profile.role==='teacher'){
      const assignmentId=Number(input.teacher_subject_id||0);let assignment:any,term:any;try{({link:assignment,term}=await ownedAssignment(profile.id,assignmentId));}catch{throw new HttpError('That subject is not assigned to your account.',403,'ASSIGNMENT_FORBIDDEN');}
      const [sub,cls,sem,year]=await Promise.all([one(admin.from('subjects').select('id,code,name').eq('id',assignment.subject_id).single()),one(admin.from('classes').select('id,name').eq('id',term.class_id).single()),one(admin.from('semesters').select('id,name,semester_number,academic_year_id').eq('id',term.semester_id).single()),one(admin.from('academic_years').select('id,name,year_level').eq('id',(await one(admin.from('semesters').select('academic_year_id').eq('id',term.semester_id).single())).academic_year_id).single())]);
      const students=await one(admin.from('students').select('id,user_id,student_no').eq('class_id',term.class_id).eq('semester_id',term.semester_id));const activeProfiles=students.length?await one(admin.from('profiles').select('id,full_name').eq('status','active').in('id',students.map((x:any)=>x.user_id))):[];
      const sessions=await one(admin.from('attendance_sessions').select('id,starts_at').eq('teacher_subject_id',assignment.id).gte('starts_at',from).lt('starts_at',to));const attendance=sessions.length?await one(admin.from('attendance').select('session_id,student_id,status').in('session_id',sessions.map((x:any)=>x.id))):[];
      report=activeProfiles.map((p:any)=>{const st=students.find((x:any)=>x.user_id===p.id);const attended=attendance.filter((a:any)=>a.student_id===st.id&&(a.status==='present'||a.status==='late')).length;const percentage=sessions.length?Math.round(attended/sessions.length*10000)/100:0;return {full_name:p.full_name,student_no:st.student_no,attended,total_sessions:sessions.length,percentage,meets_requirement:percentage>=75,highlight_red:percentage<75,status:percentage>=75?'Good standing':'Below requirement'};});
      yearLevel=year.year_level;response.subject={...sub,assignment_id:assignment.id};response.academic_year=year;response.semester=sem;response.class=cls;response.subjects=await assignmentsFor(profile.id);
    }else throw new HttpError('Only students and teachers have monthly reports.',403);
    response.year_level=yearLevel;response.report=report;return response;
  }
  throw new HttpError('Endpoint not found.',404,'NOT_FOUND');
}

Deno.serve(async (request: Request) => {
  const requestOrigin=request.headers.get('Origin')||'';
  const allowed=allowedOrigins.includes('*')||allowedOrigins.includes(requestOrigin);
  const origin=allowed?requestOrigin:'';
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin||'*','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Vary':'Origin'}});
  if(!allowed)return json({message:'Origin not allowed.'},403,'');
  try{return json(await api(request),200,origin);}catch(error){const err=error instanceof HttpError?error:new HttpError(error instanceof Error?error.message:'Unexpected server error.',500,'SERVER_ERROR');return json({code:err.code,message:err.message},err.status,origin);}
});
