const app = document.querySelector('#app');
const QRCode = window.QRCode;
const SUPABASE_URL = (window.EASYATTEND_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_PUBLISHABLE_KEY = window.EASYATTEND_SUPABASE_PUBLISHABLE_KEY || '';
const supabase = window.supabase?.createClient && SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null;
const API_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/api` : '';
const USER_KEY = 'easyattend_user';
let user = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
let page = location.hash.slice(1) || 'dashboard';
let catalog = null;
let activeSession = null;
let scannerStream = null;

// FIX: Cache auth session to avoid repeated getSession() calls per page render
let _cachedSession = null;
let _sessionCacheTs = 0;
async function getCachedSession() {
  if (_cachedSession && (Date.now() - _sessionCacheTs) < 25000) return _cachedSession;
  const { data: { session } } = await supabase.auth.getSession();
  _cachedSession = session;
  _sessionCacheTs = Date.now();
  return session;
}
supabase?.auth?.onAuthStateChange((_event, session) => {
  _cachedSession = session;
  _sessionCacheTs = Date.now();
});

const esc = (value = '') => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const dateTime = value => value ? new Date(String(value).replace(' ', 'T')).toLocaleString() : '—';
const monthNow = () => new Date().toISOString().slice(0, 7);
const authAddress = username => `${String(username||'').trim().toLowerCase()}@accounts.easyattend.invalid`;

const call = async (action, {method='GET', body, query=''} = {}) => {
  if (!API_URL || !SUPABASE_PUBLISHABLE_KEY || !supabase) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in the site configuration.');
  // FIX: use cached session instead of a fresh getSession() call each time
  const session = await getCachedSession();
  const headers = {'Accept':'application/json','apikey':SUPABASE_PUBLISHABLE_KEY};
  if (body) headers['Content-Type'] = 'application/json';
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  let response;
  try { response = await fetch(`${API_URL}?action=${encodeURIComponent(action)}${query}`, {method, headers, body: body ? JSON.stringify(body) : undefined, credentials:'omit'}); }
  catch { throw new Error('Could not reach the API. Check its URL, hosting status, and CORS settings.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.message || 'The request failed.');
    err.code = data.code;
    err.distance_from_classroom = data.distance_from_classroom;
    err.distance = data.distance || data.distance_from_classroom;
    throw err;
  }
  return data;
};

// Warm up the Edge Function on load to reduce cold-start lag
function warmUpApi() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return;
  fetch(`${API_URL}?action=health`, { method: 'GET', headers: { 'apikey': SUPABASE_PUBLISHABLE_KEY }, credentials: 'omit' }).catch(() => {});
}
// Keep Edge Function warm every 2 minutes — prevents cold-start lag entirely
setInterval(warmUpApi, 2 * 60 * 1000);

// ---------- Stale-while-revalidate cache ----------
// Shows cached data INSTANTLY, then silently refreshes in background.
// Result: pages feel instant even on high-latency VPN connections.
const _cache = new Map(); // key -> { data, ts }
const CACHE_TTL = 60000;  // 60 seconds — stale data still shown, fresh loaded silently

async function callCached(action, opts = {}, ttl = CACHE_TTL) {
  const key = action + (opts.query || '');
  const cached = _cache.get(key);
  const now = Date.now();

  if (cached && (now - cached.ts) < ttl) {
    // Still fresh — return immediately, no network
    return cached.data;
  }

  if (cached) {
    // Stale — return old data NOW (instant), fetch fresh in background
    call(action, opts).then(fresh => {
      _cache.set(key, { data: fresh, ts: Date.now() });
      // Silently re-render current page if still on same page
      if (page === _currentRenderPage) _silentRefresh(action, fresh);
    }).catch(() => {});
    return cached.data;
  }

  // No cache — must wait for network (first visit)
  const data = await call(action, opts);
  _cache.set(key, { data, ts: Date.now() });
  return data;
}
function invalidateCache(action, query = '') {
  _cache.delete(action + query);
}
let _currentRenderPage = '';
const _silentUpdaters = new Map(); // action -> updater fn, registered per page
function onSilentRefresh(action, query, fn) {
  _silentUpdaters.set(action + query, fn);
}
function _silentRefresh(action, fresh) {
  const key = action;
  // Find any updater registered for this action prefix
  for (const [k, fn] of _silentUpdaters) {
    if (k.startsWith(key)) { try { fn(fresh); } catch(_) {} }
  }
}

// ---------- Skeleton loaders ----------
// Shown immediately while network loads — makes the app feel instant
function skeletonRows(cols, count = 4) {
  return Array.from({length: count}, () =>
    `<tr>${Array.from({length: cols}, () => '<td><span class="skel"></span></td>').join('')}</tr>`
  ).join('');
}
function skeletonCard(lines = 3) {
  return `<div class="skel-block">${Array.from({length: lines}, () => '<span class="skel skel-line"></span>').join('')}</div>`;
}
function skeletonStats(count = 2) {
  return `<div class="stats${count===3?' three':''}">${Array.from({length: count}, () => '<div class="stat"><span class="skel skel-line"></span><strong class="skel" style="height:36px;display:block;border-radius:6px"></strong></div>').join('')}</div>`;
}

// ---------- Nav hover prefetch ----------
// Starts fetching data before the user even clicks — very effective on slow connections
const _prefetchMap = {}; // page -> fetch fn
function registerPrefetch(pageName, fn) { _prefetchMap[pageName] = fn; }
function attachNavPrefetch() {
  document.querySelectorAll('.nav-link').forEach(link => {
    const key = link.getAttribute('href')?.slice(1);
    if (!key || !_prefetchMap[key]) return;
    let timer;
    link.addEventListener('mouseenter', () => { timer = setTimeout(() => _prefetchMap[key](), 80); });
    link.addEventListener('mouseleave', () => clearTimeout(timer));
    link.addEventListener('touchstart', () => _prefetchMap[key](), {passive:true});
  });
}

const notice = (message, kind='') => { const el=document.querySelector('#notice'); if(el){el.className=`notice ${kind}`;el.textContent=message;} };
const actionButton = (label, action, attrs='') => `<button class="button ${attrs}" data-action="${action}">${label}</button>`;
const nav = (items) => items.map(([key,label,icon])=>`<a href="#${key}" class="nav-link ${page===key?'selected':''}" id="nav-${key}"><span>${icon}</span>${label}</a>`).join('');

function shell(content) {
  if (!user) { app.innerHTML=content; return; }
  const items = user.role==='admin'
    ? [['dashboard','Dashboard','◫'],['users','Users','♙'],['subjects','Subjects','▤'],['overview','Attendance Overview','☷']]
    : user.role==='teacher'
    ? [['dashboard','Dashboard','◫'],['create','Create QR session','▦'],['attendance','Attendance','☷'],['reports','Reports','▤'],['assignments','Academic assignments','⌘']]
    : [['dashboard','Dashboard','◫'],['scan','Scan QR','▦'],['monthly','Monthly attendance','▤'],['history','Attendance history','◷']];
  app.innerHTML=`<aside class="sidebar"><div class="brand">Easy<span>Attend</span><b>◉</b></div><div class="identity"><strong>${esc(user.full_name)}</strong><small>${esc(user.role)}</small></div><nav>${nav(items)}</nav><button class="logout" data-action="logout">Log out</button></aside><main class="main"><div class="mobile-brand">Easy<span>Attend</span></div><div id="notice" class="notice" role="status"></div>${content}</main>`;
  // Attach hover-prefetch after DOM is updated
  setTimeout(attachNavPrefetch, 0);
}
function heading(kicker,title,subtitle=''){return `<header class="page-heading"><div><p class="eyebrow">${esc(kicker)}</p><h1>${esc(title)}</h1>${subtitle?`<p class="muted">${esc(subtitle)}</p>`:''}</div></header>`;}
function card(title,body,extra=''){return `<section class="card ${extra}"><h2>${title}</h2>${body}</section>`;}
function rowsTable(headers,rows,empty='Nothing here yet.') {return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${headers.length}" class="empty">${empty}</td></tr>`}</tbody></table></div>`;}
function statusPill(status) {
  const map = { present: 'good', late: 'late', absent: 'absent', pending: 'warn', active: '', disabled: 'warn' };
  return `<span class="pill ${map[status]||''}">${esc(status)}</span>`;
}

// ---------- CSV export helper ----------
function exportCsv(filename, headers, rows) {
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// ---------- Auth views ----------
function loginView(message='') {
  app.innerHTML=`<main class="auth-page"><section class="auth-card"><div class="brand dark">Easy<span>Attend</span><b>◉</b></div><p class="eyebrow">QR ATTENDANCE PORTAL</p><h1>Welcome back</h1><p class="muted">Sign in to continue to your attendance workspace.</p><div id="notice" class="notice error">${esc(message)}</div><form id="login-form" class="form-stack"><label>Username<input name="username" autocomplete="username" required placeholder="admin / teacher / student"></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="button primary" id="btn-signin">Sign in</button></form><div style="margin-top:20px;border-top:1px solid #e2d9c7;padding-top:16px;text-align:center;"><p class="muted" style="margin-bottom:10px;font-size:13px;font-weight:600">NEW TO EASYATTEND? CREATE AN ACCOUNT:</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><button type="button" class="button" data-action="register-teacher" style="padding:10px 4px;font-weight:700">👨‍🏫 Register Teacher</button><button type="button" class="button" data-action="register-student" style="padding:10px 4px;font-weight:700">🎓 Register Student</button></div></div><p class="tiny" style="margin-top:14px">Public registrations require administrator approval before sign in.</p></section></main>`;
}
async function registerView(defaultRole='student') {
  try { catalog=await call('registration/subjects'); }
  catch(e){ loginView(e.message); return; }
  app.innerHTML=`<main class="auth-page"><section class="auth-card wide"><div class="brand dark">Easy<span>Attend</span><b>◉</b></div><p class="eyebrow">GET STARTED</p><h1>Create an account</h1><div id="notice" class="notice"></div><form id="register-form" class="form-stack"><label>Full name<input name="full_name" required maxlength="120" placeholder="Your full name"></label><label>Username<input name="username" required minlength="3" maxlength="50" placeholder="e.g. teacher1 or student1"></label><label>Password<input name="password" type="password" required minlength="8" placeholder="At least 8 characters"></label><label>Account type<select name="role"><option value="student" ${defaultRole==='student'?'selected':''}>Student</option><option value="teacher" ${defaultRole==='teacher'?'selected':''}>Teacher</option></select></label><div id="student-fields" ${defaultRole==='teacher'?'hidden':''}><label>Student roll number<input name="identifier" placeholder="4IT15"></label><div class="form-grid"><label>Academic year<select name="academic_year_id">${(catalog.academic_years||[]).map(y=>`<option value="${y.id}">${esc(y.name)}</option>`).join('')}</select></label><label>Semester<select name="semester_id"></select></label></div></div><div id="teacher-fields" ${defaultRole==='student'?'hidden':''}><p class="muted" style="padding:12px;background:#f3ecda;border-radius:8px"><b>Teacher account:</b> After approval, log in and assign your subjects under Academic assignments to start creating QR sessions.</p></div><button class="button primary">Submit registration</button></form><button class="text-button" data-action="show-login">Back to sign in</button></section></main>`;
  updateRegistration();
}
function updateRegistration() {
  const form=document.querySelector('#register-form'); if(!form||!catalog)return;
  const role=form.elements.role.value; document.querySelector('#student-fields').hidden=role!=='student'; document.querySelector('#teacher-fields').hidden=role!=='teacher';
  if(role!=='student')return;
  const year=Number(form.elements.academic_year_id.value); const semester=form.elements.semester_id;
  semester.innerHTML=(catalog.semesters||[]).filter(s=>Number(s.academic_year_id)===year).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
}

// ---------- Dashboards ----------
async function dashboard() {
  if(user.role==='admin') return adminDashboard();
  if(user.role==='student') return studentDashboard();
  return teacherDashboard();
}
async function adminDashboard(){
  _currentRenderPage = 'dashboard';
  _silentUpdaters.clear();
  // Show skeleton immediately
  shell(`${heading('ADMIN','Welcome back')}<div class="grid two">${card('Quick start','<p>Approve new student and teacher accounts, reset registered devices, and maintain subjects. Check the <b>Attendance Overview</b> for cross-class activity.</p>')}${skeletonStats(2)}</div>`);
  const data = await callCached('admin/users');
  const users = data.users||[];
  // Update stats in-place without re-rendering shell
  const statsEl = app.querySelector('.stats');
  if (statsEl) statsEl.outerHTML = `<div class="stats"><div class="stat"><span>Pending accounts</span><strong>${users.filter(x=>x.status==='pending').length}</strong></div><div class="stat"><span>Active accounts</span><strong>${users.filter(x=>x.status==='active').length}</strong></div></div>`;
  // Register prefetches
  registerPrefetch('users', () => callCached('admin/users'));
  registerPrefetch('subjects', () => Promise.all([callCached('subjects'), callCached('registration/subjects')]));
  registerPrefetch('overview', () => callCached('admin/attendance/overview', {query:`&month=${monthNow()}`}));
  attachNavPrefetch();
}
async function studentDashboard(){
  _currentRenderPage = 'dashboard';
  _silentUpdaters.clear();
  // Show skeleton immediately so the page isn't blank
  shell(`${heading('STUDENT',`Welcome, ${user.full_name}`,'Your attendance at a glance.')}${skeletonStats(3)}${card('Recent attendance',rowsTable(['SUBJECT','SESSION','STATUS','TIME'],skeletonRows(4)))}`);
  const [history, monthly] = await Promise.all([
    callCached('student/attendance'),
    callCached('reports/monthly', {query:`&month=${monthNow()}`})
  ]);
  const recent=(history.attendance||[]).slice(0,4);
  const statsHtml = `<div class="stats three"><div class="stat"><span>Classes attended this month</span><strong>${(monthly.report||[]).reduce((n,r)=>n+Number(r.attended||0),0)}</strong></div><div class="stat"><span>Subjects this term</span><strong>${(monthly.report||[]).length}</strong></div><div class="stat"><span>Attendance radius</span><strong>100 m</strong></div></div>`;
  const tableHtml = rowsTable(['SUBJECT','SESSION','STATUS','TIME'],recent.map(a=>`<tr><td>${esc(a.code||'')} — ${esc(a.name||'')}</td><td>${esc(a.title||'Class attendance')}</td><td>${statusPill(a.status)}</td><td>${dateTime(a.recorded_at)}</td></tr>`));
  // Patch in real data without re-rendering the full shell
  const skelStats = app.querySelector('.stats.three');
  if (skelStats) skelStats.outerHTML = statsHtml;
  const skelCard = app.querySelector('.card .table-wrap');
  if (skelCard) skelCard.outerHTML = tableHtml;
  // Register prefetches for student nav
  registerPrefetch('monthly', () => callCached('reports/monthly', {query:`&month=${monthNow()}`}));
  registerPrefetch('history', () => callCached('student/attendance'));
  attachNavPrefetch();
}
async function teacherDashboard(){
  const [live]=await Promise.all([call('attendance/live')]);
  activeSession=live.session;
  const subjects=user.subjects||[];
  const recent=live.attendance||[];
  const liveStats = live.session ? `<div class="stats three" style="margin-bottom:18px">
    <div class="stat"><span>Present</span><strong style="color:#3d6d3d">${live.present_students||0}</strong></div>
    <div class="stat"><span>Late</span><strong style="color:#7a5a1e">${live.late_students||0}</strong></div>
    <div class="stat"><span>Absent</span><strong style="color:#913b30">${live.absent_students||0}</strong></div>
  </div>` : '';
  shell(`${heading('TEACHER DASHBOARD',`Good day, ${user.full_name}`,new Date().toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'}))}<div class="grid two">${card('My classes',subjects.length?subjects.map(s=>`<div class="assignment"><b>${esc(s.class_name)} · ${esc(s.semester_name)}</b><span>${esc(s.code||'')} — ${esc(s.name)}</span></div>`).join(''):'<p>No subjects assigned yet.</p>')}${card('Active session',activeSession?`<p><b>${esc(activeSession.subject?.name||activeSession.title)}</b></p><p>${esc(activeSession.class_name)} · Started ${dateTime(activeSession.starts_at)}</p>${actionButton('View active QR','create','primary')}`:'<p>No QR attendance session is open.</p>'+actionButton('Create QR session','create','primary'))}</div>${liveStats}${card('Recent check-ins',rowsTable(['STUDENT','CLASS','STATUS','TIME'],recent.map(a=>`<tr><td>${esc(a.full_name)}</td><td>${esc(a.class_name)}</td><td>${statusPill(a.status)}</td><td>${dateTime(a.recorded_at)}</td></tr>`),'No check-ins yet.'))}`);
}

// ---------- Admin pages ----------
let usersPollTimer = null;
function stopUsersPoll() {
  if (usersPollTimer) { clearInterval(usersPollTimer); usersPollTimer = null; }
}

async function openUserProfileModal(userId) {
  let spot = document.querySelector('#admin-teacher-assignment-container');
  if (!spot) {
    spot = document.createElement('div');
    spot.id = 'admin-teacher-assignment-container';
    document.body.appendChild(spot);
  }
  notice('Loading user profile…');
  try {
    const data = await call('admin/user/profile', { query: `&user_id=${userId}` });
    const p = data.profile || {};
    const st = data.student;
    const stats = data.attendance_stats;
    const subs = data.teacher_subjects || [];

    spot.innerHTML = `<div class="modal-overlay" id="modal-user-profile">
      <div class="modal-card wide">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid var(--line);padding-bottom:12px">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="background:var(--navy);color:#fff;width:42px;height:42px;border-radius:50%;display:grid;place-items:center;font-size:18px;font-weight:800">
              ${esc((p.full_name||'U').charAt(0).toUpperCase())}
            </div>
            <div>
              <h3 style="margin:0;font-size:20px">${esc(p.full_name)}</h3>
              <small class="muted">@${esc(p.username)} · ${statusPill(p.status)}</small>
            </div>
          </div>
          <button class="button small" data-action="close-modal">✕ Close</button>
        </div>

        <div class="grid two" style="margin-bottom:16px">
          <div class="card" style="margin:0;padding:16px;background:#fffaf2">
            <h4 style="margin:0 0 10px;font-size:14px;color:var(--navy)">Account Specs</h4>
            <p style="margin:4px 0;font-size:13px"><b>Role:</b> <span class="pill">${esc(p.role)}</span></p>
            <p style="margin:4px 0;font-size:13px"><b>Username:</b> @${esc(p.username)}</p>
            <p style="margin:4px 0;font-size:13px"><b>Account ID:</b> <small style="font-family:monospace">${esc(p.id.slice(0,18))}…</small></p>
            <p style="margin:4px 0;font-size:13px"><b>Registered:</b> ${dateTime(p.created_at)}</p>
          </div>

          ${p.role === 'student' && st ? `
            <div class="card" style="margin:0;padding:16px;background:#fffaf2">
              <h4 style="margin:0 0 10px;font-size:14px;color:var(--navy)">Student Details</h4>
              <p style="margin:4px 0;font-size:13px"><b>Roll No:</b> ${esc(st.student_no)}</p>
              <p style="margin:4px 0;font-size:13px"><b>Class:</b> ${esc(st.class_name)}</p>
              <p style="margin:4px 0;font-size:13px"><b>Semester:</b> ${esc(st.semester_name)}</p>
              <p style="margin:4px 0;font-size:13px"><b>Device Lock:</b> ${st.device_uuid ? `<span class="pill good">Bound</span> <button class="button small" data-action="reset-device" data-id="${p.id}">Reset Device</button>` : '<span class="pill warn">Not Bound</span>'}</p>
            </div>
          ` : ''}

          ${p.role === 'teacher' ? `
            <div class="card" style="margin:0;padding:16px;background:#fffaf2">
              <h4 style="margin:0 0 10px;font-size:14px;color:var(--navy)">Assigned Classes (${subs.length})</h4>
              ${subs.length === 0 ? '<p class="muted" style="margin:0;font-size:13px">No subjects assigned.</p>' : `
                <ul style="margin:0;padding-left:18px;font-size:13px">
                  ${subs.map(s => `<li><b>${esc(s.class_name)}</b>: ${esc(s.code || '')} ${esc(s.name)}</li>`).join('')}
                </ul>
              `}
            </div>
          ` : ''}
        </div>

        ${stats ? `
          <div style="background:#f6ecd7;border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:16px">
            <h4 style="margin:0 0 8px;font-size:14px;color:var(--navy)">Attendance Record Summary</h4>
            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
              <span class="pill good">Present: ${stats.present}</span>
              <span class="pill late">Late: ${stats.late}</span>
              <span class="pill absent">Absent: ${stats.absent}</span>
              <span style="font-weight:700;margin-left:auto">Total: ${stats.total} sessions (${stats.percentage}%)</span>
            </div>
          </div>
        ` : ''}

        <div style="background:#fff3cd;border:1px solid #ffeeba;border-radius:12px;padding:16px">
          <h4 style="margin:0 0 8px;color:#856404;display:flex;align-items:center;gap:6px">
            🔐 Admin Password Access & Instant Reset
          </h4>
          <p style="margin:0 0 12px;font-size:13px;color:#856404">
            If this user forgets their password, you can view the temporary password below or set a new password instantly.
          </p>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
            <span style="font-weight:700;font-size:13px;color:#856404">Stored Password Hint:</span>
            <span id="user-password-display" style="font-family:monospace;background:#fff;padding:6px 12px;border-radius:8px;border:1px solid #e0d5c1;font-weight:700;font-size:15px;color:#1c3045">
              ${p.temp_password ? esc(p.temp_password) : '•••••••• (Set by user)'}
            </span>
            ${p.temp_password ? `<button type="button" class="button small" onclick="navigator.clipboard.writeText('${esc(p.temp_password)}');notice('Password copied to clipboard!','success')">📋 Copy Password</button>` : ''}
          </div>

          <form id="admin-reset-password-form" style="display:flex;gap:8px;align-items:center">
            <input type="hidden" name="user_id" value="${p.id}">
            <input name="new_password" placeholder="Enter new password" required minlength="6" style="flex:1;background:#fff" value="12345678">
            <button class="button primary small" style="white-space:nowrap">Set New Password</button>
          </form>
        </div>
      </div>
    </div>`;
  } catch(err) {
    notice(err.message, 'error');
  }
}

async function usersPage(){
  stopUsersPoll();
  shell(`${heading('ADMINISTRATOR','User management','Approve accounts, manage access, view profiles, and reset passwords.')}${card('➕ Create New Account (Instantly Active)',`<form id="admin-create-user-form" class="form-grid"><label>Full name<input name="full_name" required placeholder="e.g. Daw Thida / U Aung" maxlength="120"></label><label>Username<input name="username" required placeholder="e.g. teacher_thida" minlength="3" maxlength="50"></label><label>Password<input name="password" type="password" required minlength="8" placeholder="At least 8 chars"></label><label>Role<select name="role" id="admin-user-role"><option value="teacher" selected>Teacher</option><option value="student">Student</option><option value="admin">Administrator</option></select></label><div id="admin-student-fields" style="display:none;grid-column:1/-1" class="form-grid"><label>Student roll number (e.g. 4IT15)<input name="student_no" placeholder="4IT15"></label></div><button class="button primary" style="grid-column:1/-1">Create and Activate Account</button></form>`)}${card('<div style="display:flex;justify-content:space-between;align-items:center"><span>Accounts</span><span class="live-feed-badge"><span class="pulse-dot"></span> LIVE SYNC</span></div>',rowsTable(['NAME','ROLE','STATUS','ACTIONS'],skeletonRows(4)))}<div id="admin-teacher-assignment-container"></div>`);
  
  const updateUsersTable = async () => {
    if (document.hidden) return;
    try {
      const {users=[]}=await call('admin/users');
      const rows=users.map(u=>`<tr>
        <td><b>${esc(u.full_name)}</b><small>@${esc(u.username)}</small></td>
        <td><span class="pill">${esc(u.role)}</span></td>
        <td>${statusPill(u.status)}</td>
        <td class="actions">
          <button class="button small" data-action="view-user-profile" data-id="${u.id}">👤 Profile</button>
          ${u.role==='teacher'?`<button class="button small primary" data-action="admin-teacher-assignments" data-id="${u.id}" data-name="${esc(u.full_name)}">Reassign</button>`:''}
          ${u.status==='pending'?`<button class="button small primary" data-action="approve" data-id="${u.id}">Approve</button>`:''}
          ${u.role==='student'?`<button class="button small" data-action="reset-device" data-id="${u.id}">Reset Device</button>`:''}
          ${u.role!=='admin'?`<button class="button small" data-action="status" data-id="${u.id}" data-status="${u.status==='disabled'?'active':'disabled'}">${u.status==='disabled'?'Enable':'Disable'}</button>`:''}
        </td>
      </tr>`).join('');
      const tableWrap = app.querySelector('.table-wrap');
      if (tableWrap) tableWrap.outerHTML = rowsTable(['NAME','ROLE','STATUS','ACTIONS'],rows,'No accounts have registered yet.');
    } catch (_) {}
  };
  
  await updateUsersTable();
  usersPollTimer = setInterval(updateUsersTable, 6000);
}
async function subjectsPage(){
  shell(`${heading('ADMINISTRATOR','Subjects','Maintain the available subject catalog.')}${card('Add a subject',`<form id="subject-form" class="form-grid"><label>Code (optional)<input name="code" maxlength="30" placeholder="e.g. CS-401"></label><label>Name<input name="name" required maxlength="120" placeholder="e.g. Software Engineering"></label><label>Academic year<select id="subject-year"><option>Loading...</option></select></label><label>Semester<select name="semester_id" id="subject-sem"><option>Loading...</option></select></label><button class="button primary">Save subject</button></form>`)}${card('Current subjects',rowsTable(['CODE','NAME','YEAR','SEMESTER','ACTIONS'],skeletonRows(4)))}<div id="edit-subject-container"></div>`);
  const [list,reg]=await Promise.all([callCached('subjects'),callCached('registration/subjects')]);
  catalog=reg;
  const rows=(list.subjects||[]).map(s=>`<tr>
    <td><b>${esc(s.code||'—')}</b></td>
    <td>${esc(s.name)}</td>
    <td>${esc(s.academic_year_name||'')}</td>
    <td>${esc(s.semester_name||'')}</td>
    <td class="actions">
      <button class="button small" data-action="edit-subject" data-id="${s.id}" data-code="${esc(s.code||'')}" data-name="${esc(s.name)}" data-year="${s.academic_year_id}" data-sem="${s.semester_id}">Edit</button>
      <button class="button small danger" data-action="delete-subject" data-id="${s.id}">Delete</button>
    </td>
  </tr>`).join('');
  const tableWrap = app.querySelector('.table-wrap');
  if (tableWrap) tableWrap.outerHTML = rowsTable(['CODE','NAME','YEAR','SEMESTER','ACTIONS'],rows,'No subjects configured.');
  const yearSel = document.querySelector('#subject-year');
  if (yearSel) yearSel.innerHTML = (catalog.academic_years||[]).map(y=>`<option value="${y.id}">${esc(y.name)}</option>`).join('');
  updateSubjectSemesters();
}
function updateSubjectSemesters(){const y=document.querySelector('#subject-year'),s=document.querySelector('#subject-sem');if(y&&s)s.innerHTML=(catalog.semesters||[]).filter(x=>Number(x.academic_year_id)===Number(y.value)).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');}

// NEW: Admin attendance overview page
async function overviewPage(){
  const month = monthNow();
  shell(`${heading('ADMINISTRATOR','Attendance Overview','Cross-class attendance activity by month.')}
  <div class="stats three" style="margin-bottom:22px">
    <div class="stat"><span>Sessions this month</span><strong><span class="skel"></span></strong></div>
    <div class="stat"><span>Total present/late</span><strong style="color:#3d6d3d"><span class="skel"></span></strong></div>
    <div class="stat"><span>Total absent</span><strong style="color:#913b30"><span class="skel"></span></strong></div>
  </div>
  ${card('Sessions',`<div class="button-row">
    <label style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:13px">Month<input type="month" id="overview-month" value="${month}"></label>
    <button class="button primary" data-action="load-overview">View</button>
    <button class="button" data-action="export-overview-csv" style="margin-left:auto">Export CSV</button>
  </div>
  <div id="overview-table">${rowsTable(['SESSION','TEACHER','STATUS','PRESENT','LATE','ABSENT'],skeletonRows(4))}</div>`)}`);

  const data = await callCached('admin/attendance/overview', { query: `&month=${month}` });
  const sessions = data.sessions || [];
  const rows = sessions.map(s => `<tr>
    <td><b>${esc(s.title)}</b><small>${dateTime(s.starts_at)}</small></td>
    <td><small>${esc(s.teacher_name)}</small></td>
    <td><span class="pill ${s.active?'good':''}">${s.active?'ACTIVE':'ENDED'}</span></td>
    <td style="color:#3d6d3d;font-weight:700">${s.present||0}</td>
    <td style="color:#7a5a1e;font-weight:700">${s.late||0}</td>
    <td style="color:#913b30;font-weight:700">${s.absent||0}</td>
  </tr>`).join('');

  const stats = app.querySelector('.stats.three');
  if (stats) stats.outerHTML = `<div class="stats three" style="margin-bottom:22px">
    <div class="stat"><span>Sessions this month</span><strong>${data.total_sessions||0}</strong></div>
    <div class="stat"><span>Total present/late</span><strong style="color:#3d6d3d">${data.total_present||0}</strong></div>
    <div class="stat"><span>Total absent</span><strong style="color:#913b30">${data.total_absent||0}</strong></div>
  </div>`;
  const tableEl = document.querySelector('#overview-table');
  if (tableEl) tableEl.innerHTML = rowsTable(['SESSION','TEACHER','STATUS','PRESENT','LATE','ABSENT'],rows,'No sessions recorded for this month.');
}

// ---------- Student pages ----------
async function scanPage(){shell(`${heading('STUDENT','Scan QR','Attendance is accepted only during an active session and within the school radius.')}${card('Scan your teacher\'s QR code',`<div id="scan-alert-box"></div><p class="muted">Allow camera and precise location access. Your position must be within 100 meters of the configured attendance point.</p><div class="button-row"><button class="button primary" data-action="start-camera" id="btn-open-camera">📷 Open camera</button><label class="button file-button">🖼️ Choose QR image<input id="qr-file" type="file" accept="image/*" capture="environment" hidden></label></div><video id="camera" class="camera" playsinline hidden></video><label>QR token<input id="scan-token" placeholder="You can paste the token here"></label><button class="button primary full" data-action="submit-scan" id="btn-record-attendance" style="padding:14px;font-size:16px;margin-top:14px">✅ Record Attendance</button><p class="tiny" style="margin-top:12px">Location and accuracy are checked by the server. QR codes change every 15s for security.</p>`,'narrow')}`);
}
async function monthlyPage(){
  const month=monthNow();
  let query=`&month=${month}`;
  if(user.role==='teacher'){const a=user.subjects?.[0];if(a)query+=`&teacher_subject_id=${a.assignment_id}`;}
  const selectors=user.role==='teacher'?`<label>Subject<select id="report-assignment">${(user.subjects||[]).map(a=>`<option value="${a.assignment_id}">${esc(a.class_name)} · ${esc(a.code||'')} ${esc(a.name)}</option>`).join('')}</select></label>`:'';
  
  shell(`${heading(user.role==='teacher'?'TEACHER':'STUDENT','Monthly attendance',user.role==='teacher'?'Attendance totals for your assigned class and subject.':'Check your monthly attendance percentage.')}${card('Report filters',`<form id="month-form" class="form-grid">${selectors}<label>Month<input type="month" name="month" value="${month}"></label><button class="button primary">View report</button><button type="button" class="button" data-action="export-monthly-csv" style="align-self:end">Export CSV</button></form>`)}${card(`Attendance · ${esc(month)}`,`<div id="report-table-container">${rowsTable(user.role==='teacher'?['STUDENT','ATTENDED','TOTAL CLASSES','ATTENDANCE','STATUS']:['SUBJECT','ATTENDED','TOTAL CLASSES','ATTENDANCE','STATUS'],skeletonRows(4))}</div>`)}<p class="tiny">The attendance requirement is 75%.</p>`);
  
  const data=await callCached('reports/monthly',{query});
  const rows=buildReportRows(data);
  const container=document.querySelector('#report-table-container');
  if(container)container.innerHTML=rowsTable(user.role==='teacher'?['STUDENT','ATTENDED','TOTAL CLASSES','ATTENDANCE','STATUS']:['SUBJECT','ATTENDED','TOTAL CLASSES','ATTENDANCE','STATUS'],rows,'No sessions recorded for this month.');
}
function buildReportRows(data) {
  return (data.report||[]).map(r=>`<tr${r.highlight_red?' style="background:#fff5f5"':''}><td>${user.role==='teacher'?`${esc(r.full_name)}<small>${esc(r.student_no||'')}</small>`:`${esc(r.code||'')} — ${esc(r.name||'')}`}</td><td>${r.attended}</td><td>${r.total_sessions}</td><td><b>${Number(r.percentage).toFixed(2)}%</b></td><td>${statusPill(r.meets_requirement?'present':'absent').replace('present','good').replace('absent','warn')} <span class="pill ${r.meets_requirement?'good':'warn'}">${esc(r.status)}</span></td></tr>`);
}
async function historyPage(){
  shell(`${heading('STUDENT','My attendance','Your recorded attendance sessions.')}${card('Attendance history',rowsTable(['SUBJECT','SEMESTER','SESSION','STATUS','TIME'],skeletonRows(4)))}`);
  const {attendance=[]}=await callCached('student/attendance');
  const rows=attendance.map(a=>`<tr><td>${esc(a.code||'')} — ${esc(a.name)}</td><td>${esc(a.semester_name)}</td><td>${esc(a.title||'Class attendance')}</td><td>${statusPill(a.status)}</td><td>${dateTime(a.recorded_at)}</td></tr>`).join('');
  const tableWrap = app.querySelector('.table-wrap');
  if(tableWrap)tableWrap.outerHTML=rowsTable(['SUBJECT','SEMESTER','SESSION','STATUS','TIME'],rows,'No attendance records yet.');
}

// ---------- Teacher pages ----------
let activeSessionPollTimer = null;
let qrTimerInterval = null;
function stopActiveSessionPoll() {
  if (activeSessionPollTimer) { clearInterval(activeSessionPollTimer); activeSessionPollTimer = null; }
}
function stopQrTimer() {
  if (qrTimerInterval) { clearInterval(qrTimerInterval); qrTimerInterval = null; }
}

async function updateLiveAttendanceCount() {
  if (!activeSession) return;
  try {
    const live = await call('attendance/live');
    const el = document.querySelector('#live-count strong');
    if (el) el.textContent = `${(live.present_students||0) + (live.late_students||0)} / ${live.total_students||0}`;
    
    const feedContainer = document.querySelector('#live-feed-content');
    if (feedContainer && live.attendance) {
      if (live.attendance.length === 0) {
        feedContainer.innerHTML = '<p class="muted">No check-ins yet for this active session. Scanned student names will appear here live!</p>';
      } else {
        const rows = live.attendance.map(a => `<tr>
          <td><b>${esc(a.full_name)}</b></td>
          <td><small>${esc(a.student_no||'—')}</small></td>
          <td>${statusPill(a.status)}</td>
          <td>${dateTime(a.recorded_at)}</td>
        </tr>`).join('');
        feedContainer.innerHTML = rowsTable(['STUDENT NAME', 'ROLL NO', 'STATUS', 'CHECK-IN TIME'], rows);
      }
    }
  } catch (_) {}
}

async function createPage(){
  stopActiveSessionPoll();
  stopQrTimer();
  const assignments=user.subjects||[];
  const result=await call('attendance/active');
  activeSession=result.session;
  shell(`${heading('TEACHER','Create QR session','The 100 m attendance area is centered on your device when you start the session.')}${card(activeSession?'Active QR session':'Start attendance',activeSession?`<div class="qr-layout">
    <div>
      <span class="pill good">SESSION ACTIVE</span>
      <h3>${esc(activeSession.subject?.code||'')} — ${esc(activeSession.subject?.name||activeSession.title)}</h3>
      <p>${esc(activeSession.class_name)} · ${dateTime(activeSession.starts_at)}</p>
      <p class="muted">Attendance radius: ${Number(activeSession.attendance_radius_meters)||100} m from teacher location.</p>
      <canvas id="qr-canvas"></canvas>
      <p class="token">${esc(activeSession.token)}</p>
      <div class="qr-timer-box">
        <div style="font-size:12px;font-weight:700;color:var(--navy);display:flex;justify-content:space-between;">
          <span>🛡️ Dynamic Anti-Cheating QR</span>
          <span>Refreshes in <b id="qr-seconds">15</b>s</span>
        </div>
        <div class="qr-progress-track">
          <div id="qr-timer-bar" class="qr-progress-bar"></div>
        </div>
      </div>
      <button class="button danger" data-action="end-session" id="btn-end-session" style="margin-top:10px">End session</button>
    </div>
    <div style="display:grid;gap:15px">
      <div id="live-count" class="stat"><span>Students present</span><strong>—</strong></div>
      <div class="card" style="margin:0;padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h4 style="margin:0">Live Check-In Feed</h4>
          <span class="live-feed-badge"><span class="pulse-dot"></span> LIVE</span>
        </div>
        <div id="live-feed-content"><p class="muted">Loading student check-ins...</p></div>
      </div>
    </div>
  </div>`:`<form id="create-session" class="form-stack"><label>Class and subject<select name="teacher_subject_id" required>${assignments.map(a=>`<option value="${a.assignment_id}">${esc(a.class_name)} · ${esc(a.code||'')} — ${esc(a.name)}</option>`).join('')}</select></label><label>Session title<input name="title" value="Class attendance" maxlength="150" required></label><p class="muted">Allow location access. Your current location will become the center of the 100 m attendance area for this session.</p><button class="button primary" id="btn-generate-qr">Generate QR</button></form>`,'narrow')}${card('Attendance sessions',`<div class="button-row"><select id="sessions-assignment">${assignments.map(a=>`<option value="${a.assignment_id}">${esc(a.class_name)} · ${esc(a.code||'')} ${esc(a.name)}</option>`).join('')}</select><button class="button" data-action="load-sessions">Refresh</button></div><div id="session-list" class="stack"></div>`)}`);
  
  if(activeSession){
    let currentSlot = Math.floor(Date.now() / 15000);
    const getPayload = () => `ATTENDQR:${activeSession.token}:${currentSlot}`;
    drawQR(getPayload());
    updateLiveAttendanceCount();
    activeSessionPollTimer = setInterval(updateLiveAttendanceCount, 3000);

    qrTimerInterval = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000);
      const rem = 15 - (nowSec % 15);
      const bar = document.querySelector('#qr-timer-bar');
      const secEl = document.querySelector('#qr-seconds');
      if (secEl) secEl.textContent = rem;
      if (bar) bar.style.width = `${(rem / 15) * 100}%`;

      const newSlot = Math.floor(Date.now() / 15000);
      if (newSlot !== currentSlot) {
        currentSlot = newSlot;
        drawQR(getPayload());
      }
    }, 1000);
  }
  await loadSessions();
}
async function drawQR(value){
  if(!value)return;
  const c=document.querySelector('#qr-canvas');
  if(!c)return;
  if(window.qrcode){
    try{
      const qr=window.qrcode(0,'M');
      qr.addData(value);
      qr.make();
      const count=qr.getModuleCount();
      const size=220;
      const margin=10;
      const cellSize=(size-margin*2)/count;
      c.width=size;
      c.height=size;
      const ctx=c.getContext('2d');
      ctx.fillStyle='#fffaf0';
      ctx.fillRect(0,0,size,size);
      ctx.fillStyle='#12263a';
      for(let r=0;r<count;r++){
        for(let col=0;col<count;col++){
          if(qr.isDark(r,col)){
            ctx.fillRect(Math.floor(margin+col*cellSize),Math.floor(margin+r*cellSize),Math.ceil(cellSize),Math.ceil(cellSize));
          }
        }
      }
      return;
    }catch(e){console.error('QR render error:',e);}
  }
  if(window.QRCode?.toCanvas){
    try{await window.QRCode.toCanvas(c,value,{width:220,margin:2,color:{dark:'#12263a',light:'#fffaf0'}});}catch(e){notice(e.message,'error');}
  }
}
async function loadSessions(){
  const selector=document.querySelector('#sessions-assignment');if(!selector)return;
  const data=await call('attendance/sessions',{query:`&teacher_subject_id=${selector.value}`});
  const list=document.querySelector('#session-list');
  list.innerHTML=(data.sessions||[]).map(s=>`<div class="session-row">
    <div>
      <b>${esc(s.title)}</b>
      <small>${dateTime(s.starts_at)} · <span class="pill ${s.active?'good':''}">${s.status}</span></small>
      <div style="display:flex;gap:6px;margin-top:6px">
        <span class="pill good" style="font-size:11px;padding:3px 8px">${s.present||0} Present</span>
        <span class="pill late" style="font-size:11px;padding:3px 8px">${s.late||0} Late</span>
        <span class="pill absent" style="font-size:11px;padding:3px 8px">${s.absent||0} Absent</span>
      </div>
    </div>
    <button class="button small primary" data-action="session-detail" data-id="${s.id}">👤 View Student Names</button>
  </div>`).join('')||'<p class="muted">No sessions yet.</p>';
}
async function attendancePage(){
  const assignments=user.subjects||[];
  shell(`${heading('TEACHER','Attendance','Browse attendance sessions by class and subject.')}${card('Select assignment',`<div class="button-row"><select id="attendance-assignment">${assignments.map(a=>`<option value="${a.assignment_id}">${esc(a.class_name)} · ${esc(a.code||'')} ${esc(a.name)}</option>`).join('')}</select><button class="button primary" data-action="load-attendance">Load sessions</button></div><div id="attendance-sessions" class="stack"></div><div id="session-detail"></div>`)}`);
  await loadAttendanceSessions();
}
async function loadAttendanceSessions(){
  const sel=document.querySelector('#attendance-assignment');if(!sel)return;
  const d=await call('attendance/sessions',{query:`&teacher_subject_id=${sel.value}`});
  document.querySelector('#attendance-sessions').innerHTML=(d.sessions||[]).map(s=>`<div class="session-row">
    <div>
      <b>${esc(s.title)}</b>
      <small>${dateTime(s.starts_at)} · <span class="pill ${s.active?'good':''}">${s.active?'Active':'Ended'}</span></small>
      <div style="display:flex;gap:6px;margin-top:6px">
        <span class="pill good" style="font-size:11px;padding:3px 8px">${s.present||0} Present</span>
        <span class="pill late" style="font-size:11px;padding:3px 8px">${s.late||0} Late</span>
        <span class="pill absent" style="font-size:11px;padding:3px 8px">${s.absent||0} Absent</span>
      </div>
    </div>
    <button class="button small primary" data-action="session-detail" data-id="${s.id}">👤 View Student Names</button>
  </div>`).join('')||'<p class="muted">No sessions for this assignment.</p>';
}
async function assignmentPage(){
  const assignments=user.subjects||[];
  if (!catalog) {
    shell(`${heading('TEACHER','Academic assignments','Choose a class, semester, and the subjects you teach.')}${skeletonCard(2)}`);
    catalog = await callCached('registration/subjects');
  }
  shell(`${heading('TEACHER','Academic assignments','Choose a class, semester, and the subjects you teach.')}${card('Choose an assignment',`<form id="assignment-form" class="form-stack"><div class="form-grid"><label>Academic year<select name="academic_year_id" id="assignment-year">${(catalog.academic_years||[]).map(y=>`<option value="${y.id}">${esc(y.name)}</option>`).join('')}</select></label><label>Class<select name="class_id" id="assignment-class"></select></label><label>Semester<select name="semester_id" id="assignment-semester"></select></label></div><fieldset><legend>Subjects</legend><div id="assignment-subjects" class="check-list"></div></fieldset><button class="button primary">Save assignment</button></form>`)}${card('Current assignments',assignments.map(a=>`<div class="assignment" style="flex-direction:row;align-items:center;justify-content:space-between"><div><b>${esc(a.academic_year_name)} · ${esc(a.semester_name)} · ${esc(a.class_name)}</b><span style="display:block">${esc(a.code||'')} — ${esc(a.name)}</span></div><button class="button small danger" data-action="teacher-delete-assignment" data-id="${a.assignment_id}">Remove</button></div>`).join('')||'<p>No assignments have been saved yet.</p>')}`);
  updateAssignmentOptions();
}
function updateAssignmentOptions(){
  const f=document.querySelector('#assignment-form');if(!f||!catalog)return;
  const year=Number(f.elements.academic_year_id.value);
  const cl=f.elements.class_id;const selectedClass=Number(cl.value);
  cl.innerHTML=(catalog.classes||[]).filter(c=>Number(c.academic_year_id)===year).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if(selectedClass&&[...cl.options].some(o=>Number(o.value)===selectedClass))cl.value=String(selectedClass);
  const sem=f.elements.semester_id;const selectedSem=Number(sem.value);
  sem.innerHTML=(catalog.semesters||[]).filter(s=>Number(s.academic_year_id)===year).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
  if(selectedSem&&[...sem.options].some(o=>Number(o.value)===selectedSem))sem.value=String(selectedSem);
  const matching=(catalog.subjects||[]).filter(s=>Number(s.semester_id)===Number(sem.value));
  const assigned=new Set((user.subjects||[]).filter(s=>Number(s.semester_id)===Number(sem.value)&&Number(s.class_id)===Number(cl.value)).map(s=>Number(s.id)));
  document.querySelector('#assignment-subjects').innerHTML=matching.map(s=>`<label class="check"><input type="checkbox" name="subject_ids[]" value="${s.id}" ${assigned.has(Number(s.id))?'checked':''}><span>${esc(s.code||'Subject')} — ${esc(s.name)}</span></label>`).join('')||'<span class="muted">No subjects configured for this semester yet.</span>';
}

// ---------- Main render ----------
async function render(){
  stopActiveSessionPoll();
  stopUsersPoll();
  if(!user){loginView();return;}
  try{
    if(page==='dashboard')await dashboard();
    else if(page==='users'&&user.role==='admin')await usersPage();
    else if(page==='subjects'&&user.role==='admin')await subjectsPage();
    else if(page==='overview'&&user.role==='admin')await overviewPage();
    else if(page==='scan'&&user.role==='student')await scanPage();
    else if(page==='monthly'&&(user.role==='student'||user.role==='teacher'))await monthlyPage();
    else if(page==='history'&&user.role==='student')await historyPage();
    else if(page==='create'&&user.role==='teacher')await createPage();
    else if(page==='attendance'&&user.role==='teacher')await attendancePage();
    else if(page==='reports'&&user.role==='teacher')await monthlyPage();
    else if(page==='assignments'&&user.role==='teacher')await assignmentPage();
    else{page='dashboard';location.hash='dashboard';await dashboard();}
  }catch(e){shell(`${heading('EASYATTEND','Could not load this page')}${card('Request error',`<p>${esc(e.message)}</p><button class="button" data-action="retry">Try again</button>`)}`);}}

function deviceId(){let id=localStorage.getItem('easyattend_device');if(!id){id=crypto.randomUUID();localStorage.setItem('easyattend_device',id);}return id;}
async function getQrToken(raw){const text=String(raw||'').trim().replace(/^ATTENDQR:/i,'');return text;}
async function stopCamera(){if(scannerStream){scannerStream.getTracks().forEach(t=>t.stop());scannerStream=null;}const video=document.querySelector('#camera');if(video){video.hidden=true;video.srcObject=null;}}
async function decodeQrFromBitmap(bitmap) {
  if ('BarcodeDetector' in window) {
    try {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const codes = await detector.detect(bitmap);
      if (codes[0]?.rawValue) return codes[0].rawValue;
    } catch (_) {}
  }
  if (window.jsQR) {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(imgData.data, imgData.width, imgData.height);
    if (code?.data) return code.data;
  }
  return null;
}
async function startCamera(){
  const video=document.querySelector('#camera');
  if(!('BarcodeDetector'in window) && !window.jsQR){
    notice('This browser does not support live QR scanning. Use Choose QR image or paste the token.','error');
    return;
  }
  try{
    scannerStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    video.srcObject=scannerStream;
    video.hidden=false;
    await video.play();
    const useNative = 'BarcodeDetector' in window;
    const detector = useNative ? new BarcodeDetector({formats:['qr_code']}) : null;
    const canvas = !useNative ? document.createElement('canvas') : null;
    const ctx = canvas ? canvas.getContext('2d', { willReadFrequently: true }) : null;
    const scan=async()=>{
      if(!scannerStream)return;
      try{
        let rawVal = null;
        if(useNative){
          const codes=await detector.detect(video);
          if(codes[0]) rawVal = codes[0].rawValue;
        } else if(ctx && video.videoWidth){
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = window.jsQR(imgData.data, imgData.width, imgData.height);
          if(code) rawVal = code.data;
        }
        if(rawVal){
          document.querySelector('#scan-token').value=await getQrToken(rawVal);
          await stopCamera();
          notice('QR code captured. Tap Record attendance.','success');
          return;
        }
      }catch(_){}
      requestAnimationFrame(scan);
    };
    scan();
  }catch{
    notice('Camera permission was denied or no camera is available.','error');
  }
}
async function submitScan(){
  const alertBox=document.querySelector('#scan-alert-box');
  if(alertBox)alertBox.innerHTML='';
  const input=document.querySelector('#scan-token');
  const qr=await getQrToken(input?.value);
  if(!qr){notice('Scan a QR code or enter its token first.','error');return;}
  notice('Getting a precise location…');
  if(!navigator.geolocation){
    const errMsg = 'This browser does not provide location services.';
    if(alertBox)alertBox.innerHTML=`<div class="geofence-alert"><h4>⚠️ Location Error</h4><p>${esc(errMsg)}</p></div>`;
    showLocationHelpModal(errMsg);
    notice(errMsg,'error');
    return;
  }
  navigator.geolocation.getCurrentPosition(async pos=>{
    try{
      const result=await call('student/scan',{method:'POST',body:{token:qr,latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracy:pos.coords.accuracy}});
      const kind=result.status==='late'?'warn':'success';
      notice(result.message||'Attendance recorded.',kind);
      if(alertBox)alertBox.innerHTML=`<div class="notice success" style="display:block">✅ ${esc(result.message||'Attendance recorded successfully!')} (${Math.round(result.distance_from_classroom||0)}m from classroom point)</div>`;
      input.value='';
    }catch(e){
      const distance = e.distance_from_classroom || e.distance;
      showOutOfRadiusModal(e.message || 'Verification failed. You are outside the 100m attendance radius.', distance);
      if(alertBox){
        alertBox.innerHTML=`<div class="geofence-alert">
          <h4>📍 Attendance Verification Failed</h4>
          <p>${esc(e.message)}</p>
          <div class="geofence-tips">
            💡 <b>Troubleshooting Tips:</b> Move closer to the teacher's desk, ensure Wi-Fi/GPS is active for precise position, and scan the dynamic live QR code on the teacher's screen.
          </div>
        </div>`;
      }
      notice(e.message,'error');
    }
  },e=>{
    const errMsg=e.code===1?'Location permission is required. Enable precise location and try again.':'Could not get a precise location. Move outside or enable GPS/Wi-Fi location and retry.';
    showLocationHelpModal(errMsg);
    if(alertBox){
      alertBox.innerHTML=`<div class="geofence-alert">
        <h4>📍 Location Access Error</h4>
        <p>${esc(errMsg)}</p>
      </div>`;
    }
    notice(errMsg,'error');
  },{enableHighAccuracy:true,timeout:12000,maximumAge:10000});
}

function showOutOfRadiusModal(message, distance) {
  const existing = document.querySelector('#modal-out-of-radius');
  if (existing) existing.remove();
  const numDist = Number(distance);
  const distText = Number.isFinite(numDist) && numDist > 0 ? `Your Distance: ${Math.round(numDist)}m from classroom` : `Position: Outside 100m attendance area`;
  const container = document.createElement('div');
  container.innerHTML = `<div class="modal-overlay" id="modal-out-of-radius">
    <div class="modal-card" style="text-align:center;border:2px solid #e07267;background:#fffaf0;width:min(100%,480px)">
      <div style="font-size:52px;margin-bottom:6px">🚨</div>
      <h3 style="margin:0 0 10px;color:#913b30;font-size:22px;letter-spacing:-0.02em">Out of Attendance Area</h3>
      <div style="background:#fdf0ed;border:1px solid #e49f98;padding:16px;border-radius:12px;margin-bottom:18px">
        <p style="margin:0 0 8px;font-weight:700;font-size:15px;color:#8a2720">${esc(message)}</p>
        <span class="pill absent" style="font-size:14px;padding:6px 14px">${esc(distText)}</span>
      </div>

      <div style="background:#fff;border:1px solid var(--line);padding:14px;border-radius:10px;text-align:left;font-size:13px;line-height:1.6;margin-bottom:18px;color:var(--navy)">
        <b>💡 What should you do?</b>
        <ul style="margin:6px 0 0;padding-left:18px">
          <li>Walk closer to the teacher's desk (within 100 meters).</li>
          <li>Ensure Wi-Fi & Location services are turned on.</li>
          <li>Rescan the live QR code shown on the teacher's screen.</li>
        </ul>
      </div>

      <button class="button primary full" onclick="document.querySelector('#modal-out-of-radius')?.remove()">Got it (Try Again)</button>
    </div>
  </div>`;
  document.body.appendChild(container.firstElementChild);
}

function showLocationHelpModal(message) {
  const existing = document.querySelector('#modal-location-help');
  if (existing) existing.remove();
  const container = document.createElement('div');
  container.innerHTML = `<div class="modal-overlay" id="modal-location-help">
    <div class="modal-card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;color:var(--danger)">
        <span style="font-size:28px">📍</span>
        <h3 style="margin:0">Location Services Required</h3>
      </div>
      <p style="margin-bottom:16px;color:var(--muted)">${esc(message || 'Browser location access was blocked or unavailable.')}</p>
      
      <div style="background:var(--bg-muted);padding:14px;border-radius:10px;font-size:13px;line-height:1.6;margin-bottom:18px">
        <b>How to enable location on Mac / Mobile:</b>
        <ol style="margin:8px 0 0;padding-left:20px">
          <li>In your browser address bar (top left), click <b>lock icon 🔒</b> or <b>tune icon 🛠️</b>.</li>
          <li>Set <b>Location</b> permission to <b>Allow</b>.</li>
          <li>On Mac: Open <b>System Settings ⚙️ → Privacy & Security → Location Services</b>. Turn ON Location Services AND check your browser (Chrome/Safari).</li>
          <li>Refresh this page and try scanning again!</li>
        </ol>
      </div>

      <div style="display:flex;gap:10px">
        <button class="button primary" style="flex:1" onclick="document.querySelector('#modal-location-help')?.remove();location.reload();">Refresh Page</button>
        <button type="button" class="button" data-action="close-modal">Close</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(container.firstElementChild);
}
function getFreshLocation(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){
      const err = new Error('This browser does not provide location services.');
      showLocationHelpModal(err.message);
      reject(err);
      return;
    }
    const tryLowAccuracy = () => {
      navigator.geolocation.getCurrentPosition(
        pos=>resolve({latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracy:pos.coords.accuracy}),
        err2=>{
          if(err2.code===1){
            showLocationHelpModal('Location access is blocked in your browser or Mac System Settings.');
            reject(new Error('Location permission is required. Enable location in browser and Mac System Settings.'));
          } else {
            showLocationHelpModal('Could not retrieve Mac location. Ensure Wi-Fi and Location Services are active in Mac System Settings.');
            reject(new Error('Could not get location. Enable GPS/Wi-Fi location and retry.'));
          }
        },
        {enableHighAccuracy:false,timeout:12000,maximumAge:30000}
      );
    };

    navigator.geolocation.getCurrentPosition(
      pos=>resolve({latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracy:pos.coords.accuracy}),
      err=>{
        if(err.code===1){
          showLocationHelpModal('Location access is blocked in your browser or Mac System Settings.');
          reject(new Error('Location permission is required. Enable location in browser and Mac System Settings.'));
        } else {
          tryLowAccuracy();
        }
      },
      {enableHighAccuracy:true,timeout:6000,maximumAge:10000}
    );
  });
}
async function sessionDetail(id){
  const d=await call('attendance/session',{query:`&session_id=${id}`});
  const rows=(d.attendance||[]).map(a=>`<tr><td>${esc(a.full_name)}</td><td>${esc(a.student_no)}</td><td>${esc(a.class_name)}</td><td>${statusPill(a.status)}</td><td>${dateTime(a.recorded_at)}</td></tr>`).join('');
  const spot=document.querySelector('#session-detail')||document.querySelector('#session-list');
  if(!spot)return;
  const existingBox=spot.querySelector('.detail-box');
  if(existingBox)existingBox.remove();
  spot.insertAdjacentHTML('beforeend',`<div class="detail-box"><h3>${esc(d.session?.title||'Session')} · ${d.present_students||0} present / ${d.late_students||0} late / ${d.absent_students||0} absent</h3>${rowsTable(['STUDENT','ROLL NO.','CLASS','STATUS','TIME'],rows,'No check-ins yet.')}</div>`);
}

async function openAdminTeacherAssignmentsModal(teacherId, teacherName) {
  const container = document.querySelector('#admin-teacher-assignment-container');
  if (!container) return;
  const [data, reg] = await Promise.all([
    call('admin/teacher/assignments/list', { query: `&teacher_id=${teacherId}` }),
    callCached('registration/subjects')
  ]);
  catalog = reg;
  const teacher = data.teacher || { id: teacherId, full_name: teacherName };
  const subjects = data.subjects || [];

  container.innerHTML = `<div class="modal-overlay" id="modal-admin-teacher-assignments">
    <div class="modal-card wide">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h3 style="margin:0">Reassign Subjects · ${esc(teacher.full_name)}</h3>
        <button class="button small" data-action="close-modal">✕ Close</button>
      </div>

      <div style="margin-bottom:20px">
        <h4 style="margin:0 0 8px">Currently Assigned Subjects</h4>
        ${subjects.length === 0 ? '<p class="muted">No subjects currently assigned to this teacher.</p>' : `
          <div class="stack">
            ${subjects.map(s => `<div class="assignment" style="flex-direction:row;align-items:center;justify-content:space-between;padding:10px 14px">
              <div>
                <b>${esc(s.academic_year_name)} · ${esc(s.semester_name)} · ${esc(s.class_name)}</b>
                <span style="display:block">${esc(s.code||'')} — ${esc(s.name)}</span>
              </div>
              <button class="button small danger" data-action="admin-delete-teacher-assignment" data-id="${s.assignment_id}" data-teacher="${teacher.id}">Remove</button>
            </div>`).join('')}
          </div>
        `}
      </div>

      <div style="border-top:1px solid var(--line);padding-top:16px">
        <h4 style="margin:0 0 12px">Add / Reassign Subjects</h4>
        <form id="admin-teacher-assignments-form" class="form-stack">
          <input type="hidden" name="teacher_id" value="${teacher.id}">
          <div class="form-grid">
            <label>Academic year
              <select name="academic_year_id" id="admin-assign-year">
                ${(catalog.academic_years||[]).map(y => `<option value="${y.id}">${esc(y.name)}</option>`).join('')}
              </select>
            </label>
            <label>Class<select name="class_id" id="admin-assign-class"></select></label>
            <label>Semester<select name="semester_id" id="admin-assign-sem"></select></label>
          </div>
          <fieldset>
            <legend>Select Subjects to Assign</legend>
            <div id="admin-assign-subjects" class="check-list"></div>
          </fieldset>
          <div style="display:flex;gap:10px;margin-top:10px">
            <button class="button primary" style="flex:1">Save Teacher Assignment</button>
            <button type="button" class="button" data-action="close-modal">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  </div>`;

  updateAdminAssignOptions(teacher.id);
}

function updateAdminAssignOptions(teacherId) {
  const f = document.querySelector('#admin-teacher-assignments-form');
  if (!f || !catalog) return;
  const year = Number(f.elements.academic_year_id.value);
  const cl = f.elements.class_id; const selectedClass = Number(cl.value);
  cl.innerHTML = (catalog.classes||[]).filter(c => Number(c.academic_year_id) === year).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if (selectedClass && [...cl.options].some(o => Number(o.value) === selectedClass)) cl.value = String(selectedClass);
  const sem = f.elements.semester_id; const selectedSem = Number(sem.value);
  sem.innerHTML = (catalog.semesters||[]).filter(s => Number(s.academic_year_id) === year).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  if (selectedSem && [...sem.options].some(o => Number(o.value) === selectedSem)) sem.value = String(selectedSem);

  const matching = (catalog.subjects||[]).filter(s => Number(s.semester_id) === Number(sem.value));
  document.querySelector('#admin-assign-subjects').innerHTML = matching.map(s => `<label class="check"><input type="checkbox" name="subject_ids[]" value="${s.id}"><span>${esc(s.code||'Subject')} — ${esc(s.name)}</span></label>`).join('') || '<span class="muted">No subjects configured for this semester.</span>';
}

// ---------- Event listeners ----------
app.addEventListener('click',async e=>{
  const b=e.target.closest('[data-action]');if(!b)return;
  const action=b.dataset.action;
  try{
    if(action==='create'){location.hash='create';return;}
    if(action==='show-register')return registerView();
    if(action==='register-teacher')return registerView('teacher');
    if(action==='register-student')return registerView('student');
    if(action==='show-login')return loginView();
    if(action==='retry')return render();
    if(action==='logout'){stopActiveSessionPoll();stopQrTimer();await supabase?.auth.signOut();localStorage.removeItem(USER_KEY);user=null;_cachedSession=null;return loginView();}
    if(action==='view-user-profile')return openUserProfileModal(b.dataset.id);
    if(action==='approve'){await call('admin/verify',{method:'POST',body:{user_id:b.dataset.id}});invalidateCache('admin/users');await usersPage();return;}
    if(action==='status'){await call('admin/status',{method:'POST',body:{user_id:b.dataset.id,status:b.dataset.status}});invalidateCache('admin/users');await usersPage();return;}
    if(action==='reset-device'){await call('admin/device/reset',{method:'POST',body:{user_id:b.dataset.id}});notice('Student device registration reset.','success');return;}
    if(action==='admin-teacher-assignments')return openAdminTeacherAssignmentsModal(b.dataset.id, b.dataset.name);
    if(action==='admin-delete-teacher-assignment'){
      if(confirm('Are you sure you want to remove this assignment from the teacher?')){
        try {
          await call('admin/teacher/assignments/delete',{method:'POST',body:{assignment_id:Number(b.dataset.id)}});
        } catch(err) {
          if(err.message.includes('SESSIONS_EXIST') || err.message.includes('attendance sessions have')){
            if(confirm('Attendance sessions have already been recorded for this assignment.\n\nDo you want to FORCE OVERWRITE and delete all recorded sessions for this subject?')){
              await call('admin/teacher/assignments/delete',{method:'POST',body:{assignment_id:Number(b.dataset.id),force:true}});
            } else { return; }
          } else { throw err; }
        }
        await openAdminTeacherAssignmentsModal(b.dataset.teacher);
        notice('Assignment removed successfully.','success');
      }
      return;
    }
    if(action==='teacher-delete-assignment'){
      if(confirm('Are you sure you want to remove this assignment?')){
        try {
          await call('teacher/assignments/delete',{method:'POST',body:{assignment_id:Number(b.dataset.id)}});
        } catch(err) {
          if(err.message.includes('SESSIONS_EXIST') || err.message.includes('attendance sessions have')){
            if(confirm('Attendance sessions have already been recorded for this assignment.\n\nDo you want to FORCE OVERWRITE and delete all recorded sessions for this subject?')){
              await call('teacher/assignments/delete',{method:'POST',body:{assignment_id:Number(b.dataset.id),force:true}});
            } else { return; }
          } else { throw err; }
        }
        const me = await call('me');
        user = me.user;
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        await assignmentPage();
        notice('Assignment removed successfully.','success');
      }
      return;
    }
    if(action==='start-camera')return startCamera();
    if(action==='submit-scan')return submitScan();
    if(action==='end-session'){await call('attendance/end',{method:'POST',body:{session_id:activeSession?.id}});stopQrTimer();notice('QR session ended. Absent students have been marked automatically.','success');return createPage();}
    if(action==='load-sessions')return loadSessions();
    if(action==='load-attendance')return loadAttendanceSessions();
    if(action==='session-detail')return sessionDetail(b.dataset.id);
    if(action==='close-modal'){
      const m=document.querySelector('.modal-overlay');
      if(m)m.remove();
      return;
    }
    if(action==='edit-subject'){
      const spot=document.querySelector('#edit-subject-container');
      if(spot){
        spot.innerHTML=`<div class="modal-overlay" id="modal-edit-subject">
          <div class="modal-card">
            <h3>Edit Subject</h3>
            <form id="edit-subject-form" class="form-stack">
              <input type="hidden" name="id" value="${b.dataset.id}">
              <label>Code (optional)<input name="code" value="${esc(b.dataset.code)}" maxlength="30"></label>
              <label>Name<input name="name" value="${esc(b.dataset.name)}" required maxlength="120"></label>
              <label>Academic year
                <select id="edit-subject-year">
                  ${(catalog.academic_years||[]).map(y=>`<option value="${y.id}" ${Number(y.id)===Number(b.dataset.year)?'selected':''}>${esc(y.name)}</option>`).join('')}
                </select>
              </label>
              <label>Semester
                <select name="semester_id" id="edit-subject-sem">
                  ${(catalog.semesters||[]).filter(x=>Number(x.academic_year_id)===Number(b.dataset.year)).map(x=>`<option value="${x.id}" ${Number(x.id)===Number(b.dataset.sem)?'selected':''}>${esc(x.name)}</option>`).join('')}
                </select>
              </label>
              <div style="display:flex;gap:10px;margin-top:10px">
                <button class="button primary" style="flex:1">Save Changes</button>
                <button type="button" class="button" data-action="close-modal">Cancel</button>
              </div>
            </form>
          </div>
        </div>`;
      }
      return;
    }
    if(action==='delete-subject'){
      if(confirm('Are you sure you want to delete this subject?')){
        await call('admin/subject/delete',{method:'POST',body:{id:Number(b.dataset.id)}});
        invalidateCache('subjects');
        invalidateCache('registration/subjects');
        await subjectsPage();
        notice('Subject deleted successfully.','success');
      }
      return;
    }
    // NEW: load overview with selected month
    if(action==='load-overview'){
      const month=document.querySelector('#overview-month')?.value||monthNow();
      const data=await call('admin/attendance/overview',{query:`&month=${month}`});
      const sessions=data.sessions||[];
      const rows=sessions.map(s=>`<tr><td><b>${esc(s.title)}</b><small>${dateTime(s.starts_at)}</small></td><td><small>${esc(s.teacher_name)}</small></td><td><span class="pill ${s.active?'good':''}">${s.active?'ACTIVE':'ENDED'}</span></td><td style="color:#3d6d3d;font-weight:700">${s.present||0}</td><td style="color:#7a5a1e;font-weight:700">${s.late||0}</td><td style="color:#913b30;font-weight:700">${s.absent||0}</td></tr>`).join('');
      document.querySelector('#overview-table').innerHTML=rowsTable(['SESSION','TEACHER','STATUS','PRESENT','LATE','ABSENT'],rows,'No sessions recorded for this month.');
      return;
    }
    // NEW: export overview CSV
    if(action==='export-overview-csv'){
      const month=document.querySelector('#overview-month')?.value||monthNow();
      const data=await call('admin/attendance/overview',{query:`&month=${month}`});
      const sessions=data.sessions||[];
      exportCsv(`attendance_overview_${month}.csv`,['Session','Teacher','Status','Present','Late','Absent','Started At'],sessions.map(s=>[s.title,s.teacher_name,s.active?'ACTIVE':'ENDED',s.present||0,s.late||0,s.absent||0,dateTime(s.starts_at)]));
      return;
    }
    // NEW: export monthly report CSV
    if(action==='export-monthly-csv'){
      const month=document.querySelector('[name="month"]')?.value||monthNow();
      let query=`&month=${month}`;
      if(user.role==='teacher')query+=`&teacher_subject_id=${document.querySelector('#report-assignment')?.value||user.subjects?.[0]?.assignment_id||''}`;
      const d=await call('reports/monthly',{query});
      const hdrs=user.role==='teacher'?['Student','Roll No','Attended','Total Sessions','Percentage','Status']:['Subject Code','Subject','Attended','Total Sessions','Percentage','Status'];
      const csvRows=(d.report||[]).map(r=>user.role==='teacher'?[r.full_name,r.student_no,r.attended,r.total_sessions,r.percentage+'%',r.status]:[r.code,r.name,r.attended,r.total_sessions,r.percentage+'%',r.status]);
      exportCsv(`attendance_${month}.csv`,hdrs,csvRows);
      return;
    }
  }catch(err){notice(err.message,'error');}
});

app.addEventListener('submit',async e=>{
  const form=e.target;if(!(form instanceof HTMLFormElement))return;e.preventDefault();
  try{
    if(form.id==='login-form'){
      const fd=new FormData(form);
      if(!supabase)throw new Error('Supabase is not configured yet.');
      const {error}=await supabase.auth.signInWithPassword({email:authAddress(fd.get('username')),password:fd.get('password')});
      if(error)throw error;
      _cachedSession=null;_sessionCacheTs=0;
      try{const result=await call('login',{method:'POST',body:{device_uuid:deviceId()}});user=result.user;localStorage.setItem(USER_KEY,JSON.stringify(user));page='dashboard';location.hash='dashboard';await render();}catch(err){await supabase.auth.signOut();throw err;}
      return;
    }
    if(form.id==='admin-reset-password-form'){
      const fd=new FormData(form);
      const userId=fd.get('user_id');
      const newPassword=fd.get('new_password');
      notice('Updating user password…');
      const res=await call('admin/user/reset-password',{method:'POST',body:{user_id:userId,new_password:newPassword}});
      const display=document.querySelector('#user-password-display');
      if(display) display.textContent=newPassword;
      notice(res.message||'Password updated successfully!','success');
      return;
    }
    if(form.id==='admin-create-user-form'){
      const fd=new FormData(form);
      notice('Creating and activating account…');
      const res=await call('admin/create-user',{method:'POST',body:{
        full_name:fd.get('full_name'),
        username:fd.get('username'),
        password:fd.get('password'),
        role:fd.get('role'),
        student_no:fd.get('student_no')
      }});
      invalidateCache('admin/users');
      await usersPage();
      notice(res.message||'Account created and activated!','success');
      return;
    }
    if(form.id==='register-form'){
      const fd=new FormData(form);
      const body={full_name:fd.get('full_name'),username:fd.get('username'),password:fd.get('password'),role:fd.get('role')};
      if(body.role==='student'){body.identifier=fd.get('identifier');body.academic_year_id=Number(fd.get('academic_year_id'));body.semester_id=Number(fd.get('semester_id'));}
      const result=await call('register',{method:'POST',body});
      invalidateCache('admin/users');
      loginView(result.message||'Registration submitted.');
      return;
    }
    if(form.id==='subject-form'){const fd=new FormData(form);await call('admin/subject',{method:'POST',body:{code:fd.get('code'),name:fd.get('name'),semester_id:Number(fd.get('semester_id'))}});invalidateCache('subjects');invalidateCache('registration/subjects');await subjectsPage();notice('Subject saved.','success');return;}
    if(form.id==='edit-subject-form'){
      const fd=new FormData(form);
      await call('admin/subject/update',{method:'POST',body:{
        id:Number(fd.get('id')),
        code:fd.get('code'),
        name:fd.get('name'),
        semester_id:Number(fd.get('semester_id'))
      }});
      invalidateCache('subjects');
      invalidateCache('registration/subjects');
      await subjectsPage();
      notice('Subject updated successfully!','success');
      return;
    }
    if(form.id==='admin-teacher-assignments-form'){
      const fd=new FormData(form);
      const payload = {
        teacher_id:fd.get('teacher_id'),
        academic_year_id:Number(fd.get('academic_year_id')),
        semester_id:Number(fd.get('semester_id')),
        class_id:Number(fd.get('class_id')),
        subject_ids:fd.getAll('subject_ids[]').map(Number)
      };
      let res;
      try {
        res=await call('admin/teacher/assignments',{method:'POST',body:payload});
      } catch(err) {
        if(err.message.includes('SESSIONS_EXIST') || err.message.includes('attendance sessions have')){
          if(confirm('Some removed subjects have recorded attendance sessions.\n\nDo you want to FORCE OVERWRITE and delete all recorded sessions for removed subjects?')){
            res=await call('admin/teacher/assignments',{method:'POST',body:{...payload,force:true}});
          } else { return; }
        } else { throw err; }
      }
      document.querySelector('#modal-admin-teacher-assignments')?.remove();
      invalidateCache('admin/users');
      await usersPage();
      notice(res.message||'Teacher assignment saved successfully!','success');
      return;
    }
    if(form.id==='assignment-form'){
      const fd=new FormData(form);
      const payload = {
        academic_year_id:Number(fd.get('academic_year_id')),
        semester_id:Number(fd.get('semester_id')),
        class_id:Number(fd.get('class_id')),
        subject_ids:fd.getAll('subject_ids[]').map(Number)
      };
      let result;
      try {
        result=await call('teacher/assignments',{method:'POST',body:payload});
      } catch(err) {
        if(err.message.includes('SESSIONS_EXIST') || err.message.includes('attendance sessions have')){
          if(confirm('Some of your removed subjects have recorded attendance sessions.\n\nDo you want to FORCE OVERWRITE and delete all recorded sessions for those subjects?')){
            result=await call('teacher/assignments',{method:'POST',body:{...payload,force:true}});
          } else { return; }
        } else { throw err; }
      }
      user=result.user||user;
      localStorage.setItem(USER_KEY,JSON.stringify(user));
      await assignmentPage();
      notice('Academic assignment saved.','success');
      return;
    }
    if(form.id==='create-session'){const fd=new FormData(form);notice('Getting your location to set the attendance area…');const location=await getFreshLocation();if(location.accuracy>100)throw new Error('Your location is not accurate enough to start a session. Enable precise GPS and try again.');const result=await call('attendance/create',{method:'POST',body:{title:fd.get('title'),teacher_subject_id:Number(fd.get('teacher_subject_id')),...location}});activeSession=result.session||result;await createPage();notice('QR session started. The 100 m area is centered on the saved teacher location.','success');return;}
    // FIX: DOM bug — use stable wrapper container instead of replacing table-wrap node
    if(form.id==='month-form'){
      const month=new FormData(form).get('month');
      let query=`&month=${encodeURIComponent(month)}`;
      if(user.role==='teacher')query+=`&teacher_subject_id=${document.querySelector('#report-assignment')?.value||user.subjects?.[0]?.assignment_id||''}`;
      const d=await call('reports/monthly',{query});
      const rows=buildReportRows(d);
      // FIX: target the stable wrapper div, not the .table-wrap node itself
      const container=document.querySelector('#report-table-container');
      if(container)container.innerHTML=rowsTable(user.role==='teacher'?['STUDENT','ATTENDED','TOTAL CLASSES','ATTENDANCE','STATUS']:['SUBJECT','ATTENDED','TOTAL CLASSES','ATTENDANCE','STATUS'],rows,'No sessions recorded for this month.');
    }
  }catch(err){notice(err.message,'error');}
});

app.addEventListener('change',e=>{
  if(e.target.matches('#register-form [name="role"],#register-form [name="academic_year_id"]'))updateRegistration();
  if(e.target.matches('#admin-user-role')){
    const f=document.querySelector('#admin-student-fields');
    if(f)f.style.display=e.target.value==='student'?'grid':'none';
  }
  if(e.target.matches('#subject-year'))updateSubjectSemesters();
  if(e.target.matches('#edit-subject-year')){
    const s=document.querySelector('#edit-subject-sem');
    if(s&&catalog)s.innerHTML=(catalog.semesters||[]).filter(x=>Number(x.academic_year_id)===Number(e.target.value)).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');
  }
  if(e.target.matches('#admin-assign-year,#admin-assign-class,#admin-assign-sem')){
    const f=document.querySelector('#admin-teacher-assignments-form');
    if(f)updateAdminAssignOptions(f.elements.teacher_id.value);
  }
  if(e.target.matches('#assignment-year,#assignment-class,#assignment-semester'))updateAssignmentOptions();
});
app.addEventListener('change',async e=>{
  if(e.target.id==='qr-file'){
    const file=e.target.files?.[0];if(!file)return;
    try{
      const bitmap=await createImageBitmap(file);
      const rawVal=await decodeQrFromBitmap(bitmap);
      if(!rawVal)throw new Error('No QR code found in that image.');
      document.querySelector('#scan-token').value=await getQrToken(rawVal);
      notice('QR code captured. Tap Record attendance.','success');
    }catch(err){notice(err.message,'error');}
  }
});

window.addEventListener('hashchange',()=>{page=location.hash.slice(1)||'dashboard';render();});

// Warm up the Edge Function immediately on load
warmUpApi();

if(!SUPABASE_URL||!SUPABASE_PUBLISHABLE_KEY||!supabase){loginView('Supabase project settings are not configured yet.');}
else{supabase.auth.getSession().then(async({data:{session}})=>{
  if(!session){localStorage.removeItem(USER_KEY);user=null;loginView();return;}
  _cachedSession=session;_sessionCacheTs=Date.now();
  try{const d=await call('me');user=d.user;localStorage.setItem(USER_KEY,JSON.stringify(user));await render();}
  catch{await supabase.auth.signOut();localStorage.removeItem(USER_KEY);user=null;loginView();}
});}
