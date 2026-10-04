import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
const serviceKey = secretKeys ? JSON.parse(secretKeys).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const allowedOrigins = (Deno.env.get("APP_ALLOWED_ORIGINS") || "*").split(",").map((x) => x.trim());

class HttpError extends Error {
  constructor(message: string, public status = 400, public code = "REQUEST_FAILED", public extra: Record<string, any> = {}) { super(message); }
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

// ---------- In-memory caches to eliminate roundtrip lag ----------
const _authCache = new Map<string, { authUser: any; profile: any; expiresAt: number }>();
let _catalogCache: { data: any; expiresAt: number } | null = null;

// ---------- Auth ----------
async function context(request: Request) {
  const bearer = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!bearer) throw new HttpError("Authentication required.", 401, "AUTH_REQUIRED");

  const cached = _authCache.get(bearer);
  const now = Date.now();
  if (cached && now < cached.expiresAt) {
    return { authUser: cached.authUser, profile: cached.profile };
  }

  const { data, error } = await admin.auth.getUser(bearer);
  if (error || !data.user) throw new HttpError("Authentication required.", 401, "AUTH_REQUIRED");
  const profile = await one(admin.from("profiles").select("*").eq("id", data.user.id).maybeSingle());
  if (!profile) throw new HttpError("Account profile was not found.", 403, "PROFILE_MISSING");
  if (profile.status !== "active") throw new HttpError(profile.status === "pending" ? "Your account is pending administrator approval." : "Your account is disabled.", 403, "ACCOUNT_NOT_ACTIVE");

  // Cache for 60 seconds in Edge memory
  _authCache.set(bearer, { authUser: data.user, profile, expiresAt: now + 60000 });
  return { authUser: data.user, profile };
}
function requireRole(profile: any, role: string) {
  if (profile.role !== role) throw new HttpError("You do not have permission to do that.", 403, "FORBIDDEN");
}

// ---------- Catalog (cached in memory for 5 minutes) ----------
async function catalog() {
  const now = Date.now();
  if (_catalogCache && now < _catalogCache.expiresAt) {
    return _catalogCache.data;
  }
  const [academic_years, semesters, classes, subjects] = await Promise.all([
    one(admin.from("academic_years").select("id,year_level,name").order("year_level")),
    one(admin.from("semesters").select("id,academic_year_id,semester_number,name").order("id")),
    one(admin.from("classes").select("id,academic_year_id,name").order("name")),
    one(admin.from("subjects").select("id,code,name,semester_id,teacher_registration_enabled").eq("teacher_registration_enabled", true).order("name")),
  ]);
  const semById = new Map(semesters.map((s: any) => [s.id, s]));
  const yearById = new Map(academic_years.map((y: any) => [y.id, y]));
  const data = {
    academic_years, semesters, classes,
    subjects: subjects.map((s: any) => {
      const sem: any = semById.get(s.semester_id); const year: any = sem ? yearById.get(sem.academic_year_id) : null;
      return { ...s, semester_number: sem?.semester_number, semester_name: sem?.name, academic_year_id: year?.id, academic_year_name: year?.name, year_level: year?.year_level };
    }),
  };
  _catalogCache = { data, expiresAt: now + 300000 };
  return data;
}

// ---------- Teacher assignments (cached per-call via param) ----------
async function assignmentsFor(userId: string) {
  const terms = await one(admin.from("teacher_terms").select("id,semester_id,class_id,class:classes(id,name,academic_year_id),semester:semesters(id,name,semester_number,academic_year_id,year:academic_years(id,name,year_level)),links:teacher_subjects(id,subject_id,subject:subjects(id,code,name,semester_id))").eq("teacher_id", userId));
  return terms.flatMap((term: any) => {
    const cls = term.class, sem = term.semester, year = sem?.year;
    return (term.links || []).map((link: any) => {
      const sub = link.subject;
      return { assignment_id: link.id, id: sub?.id, code: sub?.code, name: sub?.name, semester_id: term.semester_id, semester_name: sem?.name, semester_number: sem?.semester_number, academic_year_id: year?.id, academic_year_name: year?.name, year_level: year?.year_level, class_id: cls?.id, class_name: cls?.name };
    });
  });
}
async function ownedAssignment(userId: string, assignmentId: number) {
  const link = await one(admin.from("teacher_subjects").select("id,subject_id,teacher_term_id").eq("id", assignmentId).maybeSingle());
  if (!link) throw new HttpError("Select one of your assigned subjects.", 403, "ASSIGNMENT_FORBIDDEN");
  const term = await one(admin.from("teacher_terms").select("teacher_id,semester_id,class_id").eq("id", link.teacher_term_id).single());
  if (term.teacher_id !== userId) throw new HttpError("Select one of your assigned subjects.", 403, "ASSIGNMENT_FORBIDDEN");
  return { link, term };
}

// ---------- User projection ----------
async function asUser(profile: any) {
  const result: any = { id: profile.id, username: profile.username, full_name: profile.full_name, role: profile.role };
  if (profile.role === "student") {
    const student = await one(admin.from("students").select("id,student_no,class_id,semester_id,device_uuid,class:classes(id,name,academic_year_id),semester:semesters(id,name,semester_number,academic_year_id,year:academic_years(id,name,year_level))").eq("user_id", profile.id).single());
    const cls = student.class, sem = student.semester, year = sem.year;
    Object.assign(result, { student_no: student.student_no, class_name: cls.name, class_id: cls.id, semester_id: sem.id, semester: { id: sem.id, name: sem.name, number: sem.semester_number }, academic_year: { id: year.id, name: year.name, year_level: year.year_level } });
  } else if (profile.role === "teacher") {
    result.subjects = await assignmentsFor(profile.id);
    result.class_name = [...new Set(result.subjects.map((s: any) => s.class_name))].join(",");
  }
  return result;
}

// ---------- Session view (FIXED: single joined query instead of N+1) ----------
async function sessionView(session: any, includeToken = false) {
  if (!session) return null;
  // Single joined query replaces 3 sequential round-trips
  const link = await one(admin.from("teacher_subjects")
    .select("id,subject_id,teacher_term_id,subject:subjects(id,code,name,semester_id),term:teacher_terms(semester_id,class_id,class:classes(id,name,academic_year_id),semester:semesters(id,name,semester_number,academic_year_id,year:academic_years(id,name,year_level)))")
    .eq("id", session.teacher_subject_id).single());
  const term = link.term, subject = link.subject;
  const cls = term.class, sem = term.semester, year = sem.year;
  const view: any = {
    id: session.id, session_id: session.id, title: session.title,
    year_level: year.year_level, class_id: cls.id, class_name: cls.name,
    teacher_subject_id: link.id, starts_at: session.starts_at, ended_at: session.ended_at,
    ends_at: session.ended_at, status: session.active ? "ACTIVE" : "ENDED", active: session.active,
    attendance_radius_meters: session.attendance_radius_meters, center_accuracy: session.center_accuracy,
    subject, academic_year: { id: year.id, year_level: year.year_level, name: year.name },
    semester: { id: sem.id, number: sem.semester_number, name: sem.name }
  };
  if (includeToken && session.active && session.qr_display_token) {
    view.token = session.qr_display_token;
    view.qr_payload = `ATTENDQR:${session.qr_display_token}`;
  }
  return view;
}

// ---------- Absent marking: mark all students who didn't scan as absent ----------
async function markAbsents(sessionId: number | bigint, teacherSubjectId: number) {
  try {
    const link = await one(admin.from("teacher_subjects").select("teacher_term_id").eq("id", teacherSubjectId).single());
    const term = await one(admin.from("teacher_terms").select("class_id,semester_id").eq("id", link.teacher_term_id).single());
    const students = await one(admin.from("students").select("id").eq("class_id", term.class_id).eq("semester_id", term.semester_id));
    if (!students.length) return;
    const present = await one(admin.from("attendance").select("student_id").eq("session_id", sessionId));
    const presentIds = new Set(present.map((a: any) => a.student_id));
    const absentStudents = students.filter((s: any) => !presentIds.has(s.id));
    if (!absentStudents.length) return;
    await admin.from("attendance").insert(absentStudents.map((s: any) => ({
      session_id: sessionId, student_id: s.id, status: "absent",
    })));
  } catch (_) { /* Non-fatal: don't fail the end-session call if absent marking has an issue */ }
}

// ---------- Register ----------
async function register(input: any) {
  const username = String(input.username || "").trim().toLowerCase(), full_name = String(input.full_name || "").trim(), password = String(input.password || ""), role = String(input.role || "");
  if (!(/^[a-z0-9_.-]{3,50}$/).test(username) || !full_name || full_name.length > 120 || password.length < 8 || !["student", "teacher"].includes(role)) throw new HttpError("Enter a valid name, username, and password with at least 8 characters.", 422, "INVALID_REGISTRATION");
  const email = `${username}@accounts.easyattend.invalid`;
  let studentContext: any = null;
  if (role === "student") {
    const identifier = String(input.identifier || "").trim().toUpperCase(); const match = identifier.match(/^([1-6])IT[0-9]+$/);
    if (!match) throw new HttpError("Enter a valid student roll number, such as 4IT15.", 422, "INVALID_STUDENT_NUMBER");
    const yearLevel = Number(match[1]), yearId = Number(input.academic_year_id), semesterId = Number(input.semester_id);
    const year = await one(admin.from("academic_years").select("*").eq("id", yearId).maybeSingle());
    const semester = await one(admin.from("semesters").select("*").eq("id", semesterId).maybeSingle());
    if (!year || year.year_level !== yearLevel || !semester || semester.academic_year_id !== yearId) throw new HttpError("Choose the academic year and semester matching your roll number.", 422, "INVALID_ENROLLMENT");
    const cls = await one(admin.from("classes").select("*").eq("academic_year_id", yearId).eq("name", `${yearLevel}IT`).maybeSingle());
    if (!cls) throw new HttpError("No class is configured for your academic year.", 422, "CLASS_NOT_CONFIGURED");
    studentContext = { student_no: identifier, class_id: cls.id, semester_id: semesterId };
  }
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new HttpError(created.error?.message || "Could not create the account.", 422, "REGISTRATION_FAILED");
  const userId = created.data.user.id;
  try {
    ok(await admin.from("profiles").insert({ id: userId, email, username, full_name, role, status: "pending" }));
    if (role === "student") ok(await admin.from("students").insert({ user_id: userId, ...studentContext }));
    else ok(await admin.from("teachers").insert({ user_id: userId }));
  } catch (err) { await admin.auth.admin.deleteUser(userId); throw err; }
  return { message: "Registration submitted. An administrator must approve your account before you can sign in." };
}

// ---------- Main router ----------
async function api(request: Request) {
  const urlObject = new URL(request.url), action = urlObject.searchParams.get("action") || "health";
  const input = request.method === "GET" ? Object.fromEntries(urlObject.searchParams.entries()) : await request.json().catch(() => ({}));

  // Public endpoints (no auth)
  if (action === "health") return { message: "EasyAttend API is running.", ts: Date.now() };
  if (action === "registration/subjects") return await catalog();
  if (action === "register") return await register(input);

  // All other endpoints require auth
  const { profile } = await context(request);

  // ---------- Auth endpoints ----------
  if (action === "login") {
    if (profile.role === "student") {
      const device = String(input.device_uuid || ""); if (!device) throw new HttpError("Device identification is required.", 422, "DEVICE_REQUIRED");
      const row = await one(admin.from("students").select("id,device_uuid").eq("user_id", profile.id).single());
      if (row.device_uuid && row.device_uuid !== device) throw new HttpError("This account is registered on another device.", 403, "DEVICE_MISMATCH");
      if (!row.device_uuid) {
        const updated = await one(admin.from("students").update({ device_uuid: device }).eq("id", row.id).is("device_uuid", null).select("id"));
        if (!updated.length) { const check = await one(admin.from("students").select("device_uuid").eq("id", row.id).single()); if (check.device_uuid !== device) throw new HttpError("This account is registered on another device.", 403, "DEVICE_MISMATCH"); }
      }
    }
    return { user: await asUser(profile) };
  }
  if (action === "me") return { user: await asUser(profile) };
  if (action === "logout") return { message: "Logged out" };

  // ---------- Admin endpoints ----------
  if (action === "admin/create-user") {
    requireRole(profile, "admin");
    const role = String(input.role || "teacher").trim().toLowerCase();
    if (!["teacher", "student", "admin"].includes(role)) throw new HttpError("Role must be teacher, student, or admin.", 422);
    const fullName = String(input.full_name || "").trim();
    const username = String(input.username || "").trim().toLowerCase();
    const password = String(input.password || "");
    if (!(/^[a-z0-9_.-]{3,50}$/).test(username)) throw new HttpError("Username must be 3-50 alphanumeric characters.", 422);
    if (!fullName || fullName.length > 120) throw new HttpError("Full name is required (max 120 characters).", 422);
    if (password.length < 8) throw new HttpError("Password must be at least 8 characters.", 422);

    const email = `${username}@accounts.easyattend.invalid`;
    const existing = await one(admin.from("profiles").select("id").eq("username", username).maybeSingle());
    if (existing) throw new HttpError(`Username "${username}" is already taken.`, 409);

    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { temp_password: password } });
    if (created.error || !created.data?.user) throw new HttpError(created.error?.message || "Could not create account in auth.", 422);
    const newUserId = created.data.user.id;

    try {
      try {
        ok(await admin.from("profiles").insert({ id: newUserId, email, username, full_name: fullName, role, status: "active", temp_password: password }));
      } catch (_) {
        ok(await admin.from("profiles").insert({ id: newUserId, email, username, full_name: fullName, role, status: "active" }));
      }
      if (role === "teacher") {
        ok(await admin.from("teachers").insert({ user_id: newUserId }));
      } else if (role === "student") {
        const studentNo = String(input.student_no || "").trim().toUpperCase() || `${username.toUpperCase()}`;
        const classId = Number(input.class_id) || 1;
        const semesterId = Number(input.semester_id) || 11;
        ok(await admin.from("students").insert({ user_id: newUserId, student_no: studentNo, class_id: classId, semester_id: semesterId }));
      }
    } catch (err) {
      await admin.auth.admin.deleteUser(newUserId);
      throw err;
    }
    return { message: `${role.toUpperCase()} account "${username}" created and activated successfully!` };
  }

  if (action === "admin/users") {
    requireRole(profile, "admin");
    return { users: await one(admin.from("profiles").select("id,username,full_name,role,status,created_at").order("created_at", { ascending: false })) };
  }
  if (action === "admin/user/profile") {
    requireRole(profile, "admin");
    const targetUserId = String(input.user_id || query.get("user_id") || "");
    if (!targetUserId) throw new HttpError("User ID is required.", 422);

    const targetProfile = await one(admin.from("profiles").select("*").eq("id", targetUserId).maybeSingle());
    if (!targetProfile) throw new HttpError("User profile not found.", 404);

    let tempPassword = targetProfile.temp_password || null;
    try {
      const authUser = await admin.auth.admin.getUserById(targetUserId);
      if (authUser?.data?.user?.user_metadata?.temp_password) {
        tempPassword = authUser.data.user.user_metadata.temp_password;
      }
    } catch (_) {}

    let studentInfo = null;
    let teacherSubjects = [];
    let attendanceStats = null;

    if (targetProfile.role === "student") {
      const st = await one(admin.from("students").select("id,student_no,device_uuid,class_id,semester_id").eq("user_id", targetUserId).maybeSingle());
      if (st) {
        const [cls, sem, attRecords] = await Promise.all([
          st.class_id ? one(admin.from("classes").select("name,academic_year_id").eq("id", st.class_id).maybeSingle()) : null,
          st.semester_id ? one(admin.from("semesters").select("name,academic_year_id").eq("id", st.semester_id).maybeSingle()) : null,
          one(admin.from("attendance").select("status").eq("student_id", st.id))
        ]);
        let yearName = "";
        if (cls?.academic_year_id) {
          const yr = await one(admin.from("academic_years").select("name").eq("id", cls.academic_year_id).maybeSingle());
          if (yr) yearName = yr.name;
        }
        studentInfo = {
          student_no: st.student_no,
          device_uuid: st.device_uuid,
          class_name: cls?.name || "Unassigned",
          semester_name: sem?.name || "Unassigned",
          academic_year_name: yearName
        };
        const total = attRecords.length;
        const present = attRecords.filter((a: any) => a.status === "present").length;
        const late = attRecords.filter((a: any) => a.status === "late").length;
        const absent = attRecords.filter((a: any) => a.status === "absent").length;
        attendanceStats = { total, present, late, absent, percentage: total ? Math.round(((present + late) / total) * 100) : 0 };
      }
    } else if (targetProfile.role === "teacher") {
      teacherSubjects = await assignmentsFor(targetUserId);
    }

    return {
      profile: { ...targetProfile, temp_password: tempPassword },
      student: studentInfo,
      teacher_subjects: teacherSubjects,
      attendance_stats: attendanceStats
    };
  }
  if (action === "admin/user/reset-password") {
    requireRole(profile, "admin");
    const targetUserId = String(input.user_id || "");
    const newPassword = String(input.new_password || "").trim();
    if (!targetUserId) throw new HttpError("User ID is required.", 422);
    if (!newPassword || newPassword.length < 6) throw new HttpError("Password must be at least 6 characters long.", 422);

    const targetProfile = await one(admin.from("profiles").select("id,username,full_name").eq("id", targetUserId).maybeSingle());
    if (!targetProfile) throw new HttpError("User profile not found.", 404);

    const { error } = await admin.auth.admin.updateUserById(targetUserId, {
      password: newPassword,
      user_metadata: { temp_password: newPassword }
    });
    if (error) throw new HttpError(`Auth update failed: ${error.message}`, 400);

    try {
      await admin.from("profiles").update({ temp_password: newPassword }).eq("id", targetUserId);
    } catch (_) {}

    _authCache.clear();
    return {
      message: `Password for "${targetProfile.full_name}" (@${targetProfile.username}) has been updated to "${newPassword}".`,
      new_password: newPassword
    };
  }
  if (action === "admin/verify" || action === "admin/status") {
    requireRole(profile, "admin");
    const status = action === "admin/verify" ? "active" : String(input.status || "");
    if (!["active", "disabled"].includes(status)) throw new HttpError("Status must be active or disabled.", 422);
    const updated = await one(admin.from("profiles").update({ status }).eq("id", input.user_id).neq("role", "admin").select("id"));
    if (!updated.length) throw new HttpError("Account not found or cannot be updated.", 404);
    _authCache.clear();
    return { message: action === "admin/verify" ? "Account approved." : `Account ${status}.` };
  }
  if (action === "admin/device/reset") {
    requireRole(profile, "admin");
    const student = await one(admin.from("students").update({ device_uuid: null }).eq("user_id", input.user_id).select("id"));
    if (!student.length) throw new HttpError("Student account not found.", 404);
    return { message: "Student device registration reset." };
  }
  if (action === "admin/subject") {
    requireRole(profile, "admin");
    _catalogCache = null; // Invalidate cache so new subject is seen immediately
    const name = String(input.name || "").trim(), code = String(input.code || "").trim().toUpperCase(), semesterId = Number(input.semester_id);
    const sem = await one(admin.from("semesters").select("id").eq("id", semesterId).maybeSingle()); if (!sem || !name) throw new HttpError("Subject name and valid semester are required.", 422);
    if (code) { const { error } = await admin.from("subjects").upsert({ code, name, semester_id: semesterId, teacher_registration_enabled: true }, { onConflict: "semester_id,code" }); if (error) throw new HttpError(error.message, 422); } else ok(await admin.from("subjects").insert({ code: null, name, semester_id: semesterId, teacher_registration_enabled: true }));
    return { message: "Subject saved." };
  }
  if (action === "admin/subject/update") {
    requireRole(profile, "admin");
    _catalogCache = null;
    const id = Number(input.id), name = String(input.name || "").trim(), code = String(input.code || "").trim().toUpperCase() || null, semesterId = Number(input.semester_id);
    if (!id || !name || !semesterId) throw new HttpError("Subject ID, name, and semester are required.", 422);
    const sem = await one(admin.from("semesters").select("id").eq("id", semesterId).maybeSingle());
    if (!sem) throw new HttpError("Valid semester is required.", 422);
    const updated = await one(admin.from("subjects").update({ name, code, semester_id: semesterId }).eq("id", id).select("id"));
    if (!updated.length) throw new HttpError("Subject not found.", 404);
    return { message: "Subject updated successfully." };
  }
  if (action === "admin/subject/delete") {
    requireRole(profile, "admin");
    _catalogCache = null;
    const id = Number(input.id);
    if (!id) throw new HttpError("Subject ID is required.", 422);
    const linked = await one(admin.from("teacher_subjects").select("id").eq("subject_id", id));
    if (linked.length) throw new HttpError("This subject is assigned to teachers and cannot be deleted. Remove teacher assignments first.", 409);
    const deleted = await one(admin.from("subjects").delete().eq("id", id).select("id"));
    if (!deleted.length) throw new HttpError("Subject not found.", 404);
    return { message: "Subject deleted successfully." };
  }
  // NEW: Admin attendance overview across all classes
  if (action === "admin/attendance/overview") {
    requireRole(profile, "admin");
    const month = String(input.month || new Date().toISOString().slice(0, 7));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError("Month must use YYYY-MM format.", 422);
    const from = `${month}-01T00:00:00.000Z`;
    const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString();
    const [sessions, attendanceCounts, profiles] = await Promise.all([
      one(admin.from("attendance_sessions").select("id,title,teacher_subject_id,starts_at,ended_at,active,teacher_id").gte("starts_at", from).lt("starts_at", to).order("starts_at", { ascending: false })),
      one(admin.from("attendance").select("session_id,status").gte("recorded_at", from).lt("recorded_at", to)),
      one(admin.from("profiles").select("id,full_name,role").eq("role", "teacher")),
    ]);
    const teacherMap = new Map(profiles.map((p: any) => [p.id, p.full_name]));
    const countMap = new Map<number, { present: number; absent: number; late: number }>();
    for (const a of attendanceCounts) {
      const entry = countMap.get(a.session_id) || { present: 0, absent: 0, late: 0 };
      entry[a.status as "present" | "absent" | "late"] = (entry[a.status as "present" | "absent" | "late"] || 0) + 1;
      countMap.set(a.session_id, entry);
    }
    const sessionDetails = sessions.map((s: any) => {
      const counts = countMap.get(s.id) || { present: 0, absent: 0, late: 0 };
      return { ...s, teacher_name: teacherMap.get(s.teacher_id) || "Unknown", ...counts };
    });
    const totalSessions = sessions.length;
    const totalPresent = [...countMap.values()].reduce((n, c) => n + c.present + c.late, 0);
    const totalAbsent = [...countMap.values()].reduce((n, c) => n + c.absent, 0);
    return { month, total_sessions: totalSessions, total_present: totalPresent, total_absent: totalAbsent, sessions: sessionDetails };
  }

  // ---------- Subjects ----------
  if (action === "subjects") {
    const [rows, semesters, years] = await Promise.all([
      one(admin.from("subjects").select("*").order("name")),
      one(admin.from("semesters").select("*")),
      one(admin.from("academic_years").select("*")),
    ]);
    return { subjects: rows.map((s: any) => { const sem = semesters.find((x: any) => x.id === s.semester_id), year = sem && years.find((x: any) => x.id === sem.academic_year_id); return { ...s, semester_name: sem?.name, semester_number: sem?.semester_number, academic_year_id: year?.id, academic_year_name: year?.name }; }) };
  }

  // ---------- Student endpoints ----------
  if (action === "student/profile") {
    requireRole(profile, "student");
    const student = await one(admin.from("students").select("id,student_no,class_id,semester_id").eq("user_id", profile.id).single());
    return { profile: { ...await asUser(profile), ...student } };
  }
  if (action === "student/attendance") {
    requireRole(profile, "student");
    // FIXED: filter to student's data only — no more full table scans
    const student = await one(admin.from("students").select("id,semester_id,class_id").eq("user_id", profile.id).single());
    const rows = await one(admin.from("attendance")
      .select("status,recorded_at,attendance_sessions!inner(id,title,teacher_subject_id)")
      .eq("student_id", student.id)
      .order("recorded_at", { ascending: false }));
    if (!rows.length) return { attendance: [] };
    const assignmentIds = [...new Set(rows.map((a: any) => a.attendance_sessions.teacher_subject_id))];
    const [links, semesters] = await Promise.all([
      one(admin.from("teacher_subjects").select("id,subject_id,subject:subjects(id,code,name,semester_id,semester:semesters(id,name,semester_number))").in("id", assignmentIds)),
      one(admin.from("semesters").select("id,name,semester_number")),
    ]);
    const linkMap = new Map(links.map((l: any) => [l.id, l]));
    return {
      attendance: rows.map((a: any) => {
        const session = a.attendance_sessions;
        const link = linkMap.get(session.teacher_subject_id);
        const subject = link?.subject;
        const sem = subject?.semester;
        return { status: a.status, recorded_at: a.recorded_at, title: session.title, code: subject?.code, name: subject?.name, semester_name: sem?.name };
      })
    };
  }
  if (action === "student/scan") {
    requireRole(profile, "student");
    const rawToken = String(input.token || "").trim().replace(/^ATTENDQR:/i, "");
    if (!rawToken) throw new HttpError("A QR token is required.", 422, "INVALID_QR");
    const parts = rawToken.split(":");
    const baseToken = parts[0];
    const scannedSlot = parts[1] ? Number(parts[1]) : null;
    if (scannedSlot !== null && !isNaN(scannedSlot)) {
      const currentSlot = Math.floor(Date.now() / 15000);
      if (Math.abs(currentSlot - scannedSlot) > 1) {
        throw new HttpError("⚠️ QR code expired! The QR code updates every 15 seconds to prevent photo sharing. Please scan the live QR code currently displayed on the teacher's screen.", 410, "QR_EXPIRED");
      }
    }
    const latitude = Number(input.latitude), longitude = Number(input.longitude), accuracy = Number(input.accuracy);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || accuracy <= 0) throw new HttpError("Precise location permission is required.", 422, "LOCATION_PERMISSION_REQUIRED");
    const maxAccuracy = Number(Deno.env.get("ATTENDANCE_MAX_ACCURACY_METERS") || 100);
    if (accuracy > maxAccuracy) throw new HttpError("Your location is not accurate enough. Enable precise GPS and try again.", 422, "POOR_LOCATION_ACCURACY");
    const hash = await tokenHash(baseToken);
    const session = await one(admin.from("attendance_sessions").select("*").eq("qr_token_hash", hash).maybeSingle());
    if (!session || !session.active) throw new HttpError("This QR session is invalid or has ended.", 410, "SESSION_ENDED");
    // FIXED: Parallel fetch of assignment+term and student with academic_year details
    const [assignmentRow, studentRow] = await Promise.all([
      one(admin.from("teacher_subjects").select("id,subject_id,teacher_term_id,term:teacher_terms(semester_id,class_id,class:classes(id,academic_year_id))").eq("id", session.teacher_subject_id).single()),
      one(admin.from("students").select("id,class_id,semester_id,class:classes(id,academic_year_id)").eq("user_id", profile.id).single()),
    ]);
    const term = assignmentRow.term;
    const termClass = term?.class;
    const studentClass = studentRow?.class;

    // Match by class_id OR by academic_year_id (prevents semester ID mismatch for same-year students)
    const isSameClass = studentRow.class_id === term.class_id;
    const isSameYear = Boolean(studentClass?.academic_year_id && termClass?.academic_year_id && studentClass.academic_year_id === termClass.academic_year_id);
    if (!isSameClass && !isSameYear) throw new HttpError("This attendance session is for a different class or academic year.", 403, "WRONG_CLASS");

    if (!Number.isFinite(session.center_latitude) || !Number.isFinite(session.center_longitude)) throw new HttpError("This QR session has no saved location. End it and start a new session.", 409, "SESSION_LOCATION_REQUIRED");
    
    const radius = Number(session.attendance_radius_meters) || 100;
    const rawDistance = distanceMeters(latitude, longitude, session.center_latitude, session.center_longitude);
    
    // Accuracy Buffer: Subtract GPS/Wi-Fi location uncertainty (up to 40m) to prevent false "Out of Area" errors inside classroom
    const accuracyBuffer = Math.min(accuracy, 40);
    const effectiveDistance = Math.max(0, rawDistance - accuracyBuffer);

    if (effectiveDistance > radius) {
      const distMeters = Math.round(rawDistance);
      throw new HttpError(`📍 Outside Allowed Radius: You are ${distMeters} meters away from the classroom (allowed limit is ${radius} meters). Move closer to the teacher's device and try again.`, 403, "OUTSIDE_ALLOWED_AREA", { distance_from_classroom: distMeters, distance: distMeters, allowed_radius: radius });
    }
    // Determine late status
    const lateThresholdMinutes = Number(Deno.env.get("LATE_THRESHOLD_MINUTES") || 0);
    let attendStatus = "present";
    if (lateThresholdMinutes > 0) {
      const sessionStart = new Date(session.starts_at).getTime();
      const minutesSinceStart = (Date.now() - sessionStart) / 60000;
      if (minutesSinceStart > lateThresholdMinutes) attendStatus = "late";
    }
    const inserted = await admin.from("attendance").insert({ session_id: session.id, student_id: studentRow.id, status: attendStatus, latitude, longitude, accuracy, distance_from_classroom: distance }).select("id");
    if (inserted.error?.code === "23505") throw new HttpError("Attendance has already been recorded.", 409, "DUPLICATE_ATTENDANCE");
    if (inserted.error?.code === "P0001") throw new HttpError("This QR attendance session has ended.", 410, "SESSION_ENDED");
    if (inserted.error) throw new HttpError(inserted.error.message, 400);
    const statusMsg = attendStatus === "late" ? "Attendance recorded as late." : "Attendance recorded successfully.";
    return { code: "SUCCESS", message: statusMsg, status: attendStatus, distance_from_classroom: distance, allowed_radius: radius };
  }

  // Helper: Save assignments for a target teacher (supports force overwrite)
  async function saveTeacherAssignments(targetTeacherId: string, yearId: number, semesterId: number, classId: number, subjectIds: number[], force = false) {
    const ids = [...new Set((Array.isArray(subjectIds) ? subjectIds : [subjectIds]).map(Number).filter(Boolean))];
    const [year, sem, cls] = await Promise.all([
      one(admin.from("academic_years").select("id").eq("id", yearId).maybeSingle()),
      one(admin.from("semesters").select("id,academic_year_id").eq("id", semesterId).maybeSingle()),
      one(admin.from("classes").select("id,academic_year_id").eq("id", classId).maybeSingle()),
    ]);
    if (!year || !sem || !cls || sem.academic_year_id !== yearId || cls.academic_year_id !== yearId) throw new HttpError("Select a valid academic year, semester, and class.", 422);
    const allowed = await one(admin.from("subjects").select("id").eq("semester_id", semesterId).eq("teacher_registration_enabled", true).in("id", ids.length ? ids : [-1]));
    if (allowed.length !== ids.length) throw new HttpError("Subjects must belong to the selected semester.", 422);
    if (!ids.length) throw new HttpError("Select at least one subject.", 422);
    const term = await one(admin.from("teacher_terms").upsert({ teacher_id: targetTeacherId, semester_id: semesterId, class_id: classId }, { onConflict: "teacher_id,semester_id,class_id" }).select("id").single());
    const existing = await one(admin.from("teacher_subjects").select("id,subject_id").eq("teacher_term_id", term.id));
    const remove = existing.filter((x: any) => !ids.includes(x.subject_id));
    if (remove.length) {
      const removeIds = remove.map((x: any) => x.id);
      const sessions = await one(admin.from("attendance_sessions").select("id").in("teacher_subject_id", removeIds));
      if (sessions.length && !force) throw new HttpError("SESSIONS_EXIST: Some assignments have recorded attendance. Enable Force Overwrite to delete them.", 409, "SESSIONS_EXIST");
      if (sessions.length && force) {
        const sessionIds = sessions.map((s: any) => s.id);
        await admin.from("attendance").delete().in("session_id", sessionIds);
        await admin.from("attendance_sessions").delete().in("id", sessionIds);
      }
      await one(admin.from("teacher_subjects").delete().in("id", removeIds));
    }
    const had = new Set(existing.map((x: any) => x.subject_id));
    const adds = ids.filter(id => !had.has(id));
    if (adds.length) ok(await admin.from("teacher_subjects").insert(adds.map(subject_id => ({ teacher_term_id: term.id, subject_id }))));
    return { message: "Academic assignment saved successfully." };
  }

  // ---------- Teacher endpoints ----------
  if (action === "teacher/assignments") {
    requireRole(profile, "teacher");
    const force = Boolean(input.force || input.overwrite);
    await saveTeacherAssignments(profile.id, Number(input.academic_year_id), Number(input.semester_id), Number(input.class_id), input.subject_ids, force);
    return { message: "Academic assignment saved.", user: await asUser(profile) };
  }
  if (action === "admin/teacher/assignments") {
    requireRole(profile, "admin");
    const teacherId = String(input.teacher_id || "");
    if (!teacherId) throw new HttpError("Teacher ID is required.", 422);
    const teacherProf = await one(admin.from("profiles").select("id,role").eq("id", teacherId).maybeSingle());
    if (!teacherProf || teacherProf.role !== "teacher") throw new HttpError("Target user is not a teacher.", 422);
    const force = Boolean(input.force || input.overwrite);
    await saveTeacherAssignments(teacherId, Number(input.academic_year_id), Number(input.semester_id), Number(input.class_id), input.subject_ids, force);
    return { message: "Teacher assignment updated successfully.", subjects: await assignmentsFor(teacherId) };
  }
  if (action === "admin/teacher/assignments/list") {
    requireRole(profile, "admin");
    const teacherId = String(input.teacher_id || "");
    if (!teacherId) throw new HttpError("Teacher ID is required.", 422);
    const teacherProf = await one(admin.from("profiles").select("id,full_name,username").eq("id", teacherId).single());
    return { teacher: teacherProf, subjects: await assignmentsFor(teacherId) };
  }
  if (action === "teacher/assignments/delete" || action === "admin/teacher/assignments/delete") {
    const assignmentId = Number(input.assignment_id);
    const force = Boolean(input.force || input.overwrite);
    if (!assignmentId) throw new HttpError("Assignment ID is required.", 422);
    const link = await one(admin.from("teacher_subjects").select("id,teacher_term_id").eq("id", assignmentId).maybeSingle());
    if (!link) throw new HttpError("Assignment not found.", 404);
    if (profile.role !== "admin") {
      const term = await one(admin.from("teacher_terms").select("teacher_id").eq("id", link.teacher_term_id).single());
      if (term.teacher_id !== profile.id) throw new HttpError("Forbidden.", 403);
    }
    const sessions = await one(admin.from("attendance_sessions").select("id").eq("teacher_subject_id", assignmentId));
    if (sessions.length && !force) throw new HttpError("SESSIONS_EXIST: Cannot remove this assignment because attendance sessions have been recorded for it.", 409, "SESSIONS_EXIST");
    if (sessions.length && force) {
      const sessionIds = sessions.map((s: any) => s.id);
      await admin.from("attendance").delete().in("session_id", sessionIds);
      await admin.from("attendance_sessions").delete().in("id", sessionIds);
    }
    await one(admin.from("teacher_subjects").delete().eq("id", assignmentId));
    return { message: "Assignment deleted successfully." };
  }
  if (action === "attendance/create") {
    requireRole(profile, "teacher");
    const assignmentId = Number(input.teacher_subject_id), title = String(input.title || "").trim();
    if (!title || title.length > 150) throw new HttpError("Enter a session title.", 422);
    const centerLatitude = Number(input.latitude), centerLongitude = Number(input.longitude), centerAccuracy = Number(input.accuracy);
    if (!Number.isFinite(centerLatitude) || centerLatitude < -90 || centerLatitude > 90 || !Number.isFinite(centerLongitude) || centerLongitude < -180 || centerLongitude > 180 || !Number.isFinite(centerAccuracy) || centerAccuracy <= 0) throw new HttpError("Precise location permission is required to start a QR session.", 422, "LOCATION_PERMISSION_REQUIRED");
    const maxAccuracy = Number(Deno.env.get("ATTENDANCE_MAX_ACCURACY_METERS") || 100);
    if (centerAccuracy > maxAccuracy) throw new HttpError("Your location is not accurate enough to start a session. Enable precise GPS and try again.", 422, "POOR_LOCATION_ACCURACY");
    const radius = Number(Deno.env.get("ATTENDANCE_RADIUS_METERS") || 100);
    if (!Number.isInteger(radius) || radius < 1 || radius > 5000) throw new HttpError("The attendance radius is not configured correctly.", 503, "INVALID_ATTENDANCE_RADIUS");
    await ownedAssignment(profile.id, assignmentId);
    const token = Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2, "0")).join("");
    const hash = await tokenHash(token);
    const created = await admin.from("attendance_sessions").insert({ teacher_id: profile.id, teacher_subject_id: assignmentId, title, qr_token_hash: hash, qr_display_token: token, center_latitude: centerLatitude, center_longitude: centerLongitude, center_accuracy: centerAccuracy, attendance_radius_meters: radius, active: true }).select("*").single();
    if (created.error?.code === "23505") throw new HttpError("You already have an active QR session. End it before starting another.", 409, "ACTIVE_SESSION_EXISTS");
    if (created.error) throw new HttpError(created.error.message, 400);
    const session = await sessionView(created.data, true);
    return { session, message: "Attendance session created." };
  }
  if (action === "attendance/active") {
    requireRole(profile, "teacher");
    const session = await one(admin.from("attendance_sessions").select("*").eq("teacher_id", profile.id).eq("active", true).order("starts_at", { ascending: false }).limit(1).maybeSingle());
    return { session: await sessionView(session, true) };
  }
  if (action === "attendance/end") {
    requireRole(profile, "teacher");
    let query = admin.from("attendance_sessions").update({ active: false, ended_at: new Date().toISOString(), qr_display_token: null }).eq("teacher_id", profile.id).eq("active", true);
    if (input.session_id) query = query.eq("id", Number(input.session_id));
    const ended = await one(query.select("*").maybeSingle());
    if (!ended) throw new HttpError("There is no active QR session to end.", 404, "NO_ACTIVE_SESSION");
    // ADDED: Auto-mark absent students when session ends
    await markAbsents(ended.id, ended.teacher_subject_id);
    return { session: await sessionView(ended), message: "QR attendance session ended." };
  }
  if (action === "attendance/sessions") {
    requireRole(profile, "teacher");
    const assignmentId = Number(input.teacher_subject_id);
    await ownedAssignment(profile.id, assignmentId);
    const rows = await one(admin.from("attendance_sessions").select("id,title,starts_at,ended_at,active").eq("teacher_id", profile.id).eq("teacher_subject_id", assignmentId).order("starts_at", { ascending: false }));
    const sessionIds = rows.map((s: any) => s.id);
    const attRecords = sessionIds.length ? await one(admin.from("attendance").select("session_id,status").in("session_id", sessionIds)) : [];
    const countsMap = new Map();
    attRecords.forEach((r: any) => {
      if (!countsMap.has(r.session_id)) countsMap.set(r.session_id, { present: 0, late: 0, absent: 0 });
      const c = countsMap.get(r.session_id);
      if (r.status === "present") c.present++;
      else if (r.status === "late") c.late++;
      else if (r.status === "absent") c.absent++;
    });
    return {
      sessions: rows.map((s: any) => ({
        ...s,
        session_id: s.id,
        status: s.active ? "ACTIVE" : "ENDED",
        present: countsMap.get(s.id)?.present || 0,
        late: countsMap.get(s.id)?.late || 0,
        absent: countsMap.get(s.id)?.absent || 0
      }))
    };
  }
  if (action === "attendance/session" || action === "attendance/live") {
    requireRole(profile, "teacher");
    let session: any;
    if (action === "attendance/session") {
      session = await one(admin.from("attendance_sessions").select("*").eq("id", Number(input.session_id)).eq("teacher_id", profile.id).maybeSingle());
    } else {
      session = await one(admin.from("attendance_sessions").select("*").eq("teacher_id", profile.id).eq("active", true).order("starts_at", { ascending: false }).limit(1).maybeSingle());
      if (!session) session = await one(admin.from("attendance_sessions").select("*").eq("teacher_id", profile.id).order("starts_at", { ascending: false }).limit(1).maybeSingle());
    }
    if (!session) return { session: null, total_students: 0, present_students: 0, absent_students: 0, late_students: 0, attendance: [] };
    // FIXED: parallel fetches instead of 6 sequential round-trips
    const [linkRow, allAttendance] = await Promise.all([
      one(admin.from("teacher_subjects").select("teacher_term_id,term:teacher_terms(semester_id,class_id,class:classes(name))").eq("id", session.teacher_subject_id).single()),
      one(admin.from("attendance").select("student_id,status,recorded_at").eq("session_id", session.id).order("recorded_at", { ascending: false })),
    ]);
    const term = linkRow.term;
    const [students, sessionViewData] = await Promise.all([
      one(admin.from("students").select("id,user_id,student_no").eq("class_id", term.class_id).eq("semester_id", term.semester_id)),
      sessionView(session, session.active),
    ]);
    const userIds = students.map((s: any) => s.user_id);
    const profiles = userIds.length ? await one(admin.from("profiles").select("id,full_name,status").in("id", userIds)) : [];
    const profileMap = new Map(profiles.map((p: any) => [p.id, p]));
    const activeStudents = students.filter((s: any) => profileMap.get(s.user_id)?.status === "active");
    const visible = action === "attendance/live" && session.active ? allAttendance.slice(0, 5) : allAttendance;
    const className = term.class?.name || "";
    const rows = visible.map((a: any) => {
      const st = students.find((x: any) => x.id === a.student_id), p = st && profileMap.get(st.user_id);
      return { full_name: p?.full_name || "", student_no: st?.student_no, class_name: className, status: a.status, recorded_at: a.recorded_at };
    });
    const present = allAttendance.filter((x: any) => x.status === "present").length;
    const late = allAttendance.filter((x: any) => x.status === "late").length;
    const absent = allAttendance.filter((x: any) => x.status === "absent").length;
    return action === "attendance/live"
      ? { session: sessionViewData, total_students: activeStudents.length, present_students: present, late_students: late, absent_students: absent, attendance: rows }
      : { session: sessionViewData, present_students: present, late_students: late, absent_students: absent, attendance: rows };
  }

  // ---------- Monthly report (FIXED: optimized teacher path) ----------
  if (action === "reports/monthly") {
    const month = String(input.month || new Date().toISOString().slice(0, 7));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError("Month must use YYYY-MM format.", 422);
    const from = `${month}-01T00:00:00.000Z`;
    const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString();
    let report: any[] = [], yearLevel = 0, response: any = { month, required_percentage: 75 };
    if (profile.role === "student") {
      const st = await one(admin.from("students").select("id,class_id,semester_id,semester:semesters(academic_year_id,year:academic_years(year_level))").eq("user_id", profile.id).single());
      yearLevel = st.semester.year.year_level;
      const [subjects, terms] = await Promise.all([
        one(admin.from("subjects").select("id,code,name").eq("semester_id", st.semester_id).eq("teacher_registration_enabled", true)),
        one(admin.from("teacher_terms").select("id").eq("class_id", st.class_id).eq("semester_id", st.semester_id)),
      ]);
      const links = terms.length ? await one(admin.from("teacher_subjects").select("id,subject_id").in("teacher_term_id", terms.map((x: any) => x.id))) : [];
      const sessions = links.length ? await one(admin.from("attendance_sessions").select("id,teacher_subject_id,starts_at").in("teacher_subject_id", links.map((x: any) => x.id)).gte("starts_at", from).lt("starts_at", to)) : [];
      const attendance = sessions.length ? await one(admin.from("attendance").select("session_id,status").eq("student_id", st.id).in("session_id", sessions.map((x: any) => x.id))) : [];
      report = subjects.map((sub: any) => {
        const assignmentIds = new Set(links.filter((x: any) => x.subject_id === sub.id).map((x: any) => x.id));
        const own = sessions.filter((x: any) => assignmentIds.has(x.teacher_subject_id));
        const attended = attendance.filter((a: any) => own.some((x: any) => x.id === a.session_id) && (a.status === "present" || a.status === "late")).length;
        const percentage = own.length ? Math.round(attended / own.length * 10000) / 100 : 0;
        return { ...sub, attended, total_sessions: own.length, percentage, meets_requirement: percentage >= 75, highlight_red: percentage < 75, status: percentage >= 75 ? "Good standing" : "Below requirement" };
      });
      response.semester_id = st.semester_id;
    } else if (profile.role === "teacher") {
      const assignmentId = Number(input.teacher_subject_id || 0);
      let assignment: any, term: any;
      try { ({ link: assignment, term } = await ownedAssignment(profile.id, assignmentId)); } catch { throw new HttpError("That subject is not assigned to your account.", 403, "ASSIGNMENT_FORBIDDEN"); }
      // FIXED: parallel fetches of sub, cls, sem all at once (sem now includes year via join)
      const [sub, cls, sem] = await Promise.all([
        one(admin.from("subjects").select("id,code,name").eq("id", assignment.subject_id).single()),
        one(admin.from("classes").select("id,name").eq("id", term.class_id).single()),
        one(admin.from("semesters").select("id,name,semester_number,academic_year_id,year:academic_years(id,name,year_level)").eq("id", term.semester_id).single()),
      ]);
      const year = sem.year;
      const [students, sessions] = await Promise.all([
        one(admin.from("students").select("id,user_id,student_no").eq("class_id", term.class_id).eq("semester_id", term.semester_id)),
        one(admin.from("attendance_sessions").select("id,starts_at").eq("teacher_subject_id", assignment.id).gte("starts_at", from).lt("starts_at", to)),
      ]);
      const [activeProfiles, attendance] = await Promise.all([
        students.length ? one(admin.from("profiles").select("id,full_name").eq("status", "active").in("id", students.map((x: any) => x.user_id))) : Promise.resolve([]),
        sessions.length ? one(admin.from("attendance").select("session_id,student_id,status").in("session_id", sessions.map((x: any) => x.id))) : Promise.resolve([]),
      ]);
      report = activeProfiles.map((p: any) => {
        const st = students.find((x: any) => x.user_id === p.id);
        const attended = attendance.filter((a: any) => a.student_id === st.id && (a.status === "present" || a.status === "late")).length;
        const percentage = sessions.length ? Math.round(attended / sessions.length * 10000) / 100 : 0;
        return { full_name: p.full_name, student_no: st.student_no, attended, total_sessions: sessions.length, percentage, meets_requirement: percentage >= 75, highlight_red: percentage < 75, status: percentage >= 75 ? "Good standing" : "Below requirement" };
      });
      yearLevel = year.year_level;
      response.subject = { ...sub, assignment_id: assignment.id };
      response.academic_year = year; response.semester = sem; response.class = cls;
      response.subjects = await assignmentsFor(profile.id);
    } else throw new HttpError("Only students and teachers have monthly reports.", 403);
    response.year_level = yearLevel; response.report = report; return response;
  }

  throw new HttpError("Endpoint not found.", 404, "NOT_FOUND");
}

Deno.serve(async (request: Request) => {
  const requestOrigin = request.headers.get("Origin") || "";
  const allowed = allowedOrigins.includes("*") || !requestOrigin || allowedOrigins.includes(requestOrigin);
  const origin = allowed ? (requestOrigin || "*") : "";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Vary": "Origin" } });
  if (!allowed) return json({ message: "Origin not allowed." }, 403, "");
  try { return json(await api(request), 200, origin); } catch (error) { const err = error instanceof HttpError ? error : new HttpError(error instanceof Error ? error.message : "Unexpected server error.", 500, "SERVER_ERROR"); return json({ code: err.code, message: err.message, ...err.extra }, err.status, origin); }
});
