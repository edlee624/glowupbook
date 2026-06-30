// ============================================================================
// Glowup Book app — drives the SPA. Two modes:
//   • /<salon-slug>  → public storefront booking flow (anonymous)
//   • / (root)       → auth → onboarding → dashboard (salon members)
// ============================================================================
const API = window.GlowbookAPI;

// ---- tiny DOM helpers -----------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) n.append(kid?.nodeType ? kid : document.createTextNode(kid ?? ''));
  return n;
}
function show(id) { $$('.screen').forEach((s) => s.classList.remove('active')); $(id).classList.add('active'); }
let toastT;
function toast(msg, bad = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = 'toast'), 2800);
}
function errToast(e) { console.error(e); toast(e?.message || 'Something went wrong', true); }
function money(n, cur = 'USD') {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(n || 0); }
  catch { return `${cur} ${Number(n || 0).toFixed(2)}`; }
}
function modal(title, bodyNode, { wide } = {}) {
  const root = $('#modal-root');
  const close = () => (root.innerHTML = '');
  const card = el('div', { class: 'modal', style: wide ? 'max-width:620px' : '' },
    el('h2', {}, title), bodyNode);
  const bg = el('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(); } }, card);
  root.innerHTML = ''; root.append(bg);
  return close;
}
// Shows a "check your email to confirm" banner with a Resend link, used after
// signup (when email confirmation is on) and on a "not confirmed" login error.
function showEmailConfirmNotice(container, email, opts = {}) {
  if (!container) return;
  container.querySelector('#email-confirm-note')?.remove();
  container.append(el('div', { id: 'email-confirm-note', class: 'banner', style: 'margin-top:12px' },
    `${opts.prefix || 'Almost there!'} We sent a confirmation link to ${email}. Open it to activate your account, then log in. `,
    el('a', { href: '#', onclick: async (e) => {
      e.preventDefault();
      try { await API.auth.resendConfirmation(email); toast('Confirmation email resent'); }
      catch (err) { errToast(err); }
    } }, 'Resend email')));
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const todayISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtTime = (iso, tz) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz });
const fmtDate = (iso, tz) => new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });

// ===========================================================================
// ROUTER
// ===========================================================================
// The salon storefront lives at the root: glowupbook.com/<salon-slug>.
// These top-level paths are reserved for the app itself, so no salon may use
// them as a slug (enforced at signup too). Anything with a slash or dot is a
// nested route or a static file, never a salon.
const APP_DOMAIN = 'glowupbook.com';
const RESERVED = new Set([
  '', 'app', 'login', 'log-in', 'signin', 'sign-in', 'signup', 'sign-up',
  'dashboard', 'admin', 'api', 'book', 'booking', 'about', 'pricing', 'terms',
  'privacy', 'legal', 'help', 'support', 'contact', 'blog', 'settings',
  'account', 'profile', 'assets', 'static', 'js', 'css', 'img', 'images',
  'fonts', 'config', 'favicon', 'robots', 'sitemap', 'index', 'www', 'home', 'confirm',
]);

// Returns the salon slug if the current URL is a storefront, else null.
function storefrontSlug() {
  const seg = location.pathname.replace(/^\/+|\/+$/g, '');   // trim slashes
  if (!seg || seg.includes('/') || seg.includes('.')) return null;  // root / nested / file
  if (RESERVED.has(seg.toLowerCase())) return null;
  return seg;
}

// Owner area lives at these paths; the root and anything else public shows the
// salon directory.
const APP_PATHS = new Set(['app', 'login', 'log-in', 'signin', 'sign-in', 'dashboard', 'admin', 'account']);

async function boot() {
  const cm = location.pathname.match(/^\/confirm\/([0-9a-fA-F-]{8,})/);
  if (cm) return startConfirm(cm[1]);
  const sl = storefrontSlug();
  if (sl) return startStorefront(sl);
  const p = location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (APP_PATHS.has(p)) return startDashboardApp();
  startDirectory();   // root (and any other public path) → directory
}

// Public appointment-confirmation page (from an emailed/texted link).
async function startConfirm(token) {
  show('#screen-store');
  const root = $('#store-body'); root.innerHTML = '<p class="muted">Confirming your appointment…</p>';
  if (!API.enabled) { root.innerHTML = ''; return root.append(el('div', { class: 'banner' }, 'Not connected to a backend.')); }
  let info = null;
  try { info = await API.storefront.confirm(token); }
  catch (e) { root.innerHTML = ''; return root.append(el('div', { class: 'card empty' }, 'Could not confirm: ' + e.message)); }
  root.innerHTML = '';
  if (!info) { root.append(el('div', { class: 'card empty' }, 'This confirmation link is invalid or expired.')); return; }
  root.append(el('div', { class: 'card', style: 'text-align:center;padding:40px' },
    el('div', { style: 'font-size:48px' }, '✓'),
    el('h2', { style: 'margin:10px 0' }, "You're confirmed!"),
    el('p', { class: 'muted' }, `${info.service_name || 'Appointment'} at ${info.salon_name} on ${new Date(info.starts_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`),
    el('a', { class: 'btn', style: 'margin-top:10px', href: '/' }, 'Browse salons')));
}

// ===========================================================================
// DASHBOARD (authenticated)
// ===========================================================================
const state = { user: null, salon: null };

function startDashboardApp() {
  if (!API.enabled) $('#cfg-banner').classList.remove('hidden');
  wireAuthScreen();

  API.auth.onChange(async (user) => {
    state.user = user;
    if (!user) { show('#screen-auth'); return; }
    await afterLogin();
  });

  // initial check
  (async () => {
    const user = API.enabled ? await API.auth.currentUser() : null;
    state.user = user;
    if (user) await afterLogin(); else show('#screen-auth');
  })();
}

async function afterLogin() {
  try {
    // Pending "claim this salon" intent from a storefront listing.
    let claimed = false;
    const claimSlug = sessionStorage.getItem('claim_slug');
    if (claimSlug) {
      sessionStorage.removeItem('claim_slug');
      try {
        const s = await API.storefront.salon(claimSlug);
        if (s && !s.claimed) { await API.salons.claim(s.id); claimed = true; toast('Salon claimed! Finish setting it up below.'); }
      } catch (e) { errToast(e); }
    }
    const prof = await API.auth.profile();
    // Platform super-admins → console; employees → their profile.
    if (!claimed && prof?.role === 'admin') { startAdmin(); return; }
    if (!claimed && prof?.role === 'staff') { startEmployee(prof); return; }
    const mine = await API.salons.mine();
    if (!mine.length) {
      // A customer account has no salon — send them to the public directory.
      if (prof?.role === 'customer') { location.href = '/'; return; }
      wireOnboarding(); show('#screen-onboarding'); return;
    }
    state.salon = claimed ? (mine.find((s) => s.slug === claimSlug) || mine[0]) : mine[0];
    wireAppShell();
    show('#screen-app');
    navigate(claimed ? 'settings' : 'calendar');
  } catch (e) { errToast(e); }
}

// ---- super-admin console --------------------------------------------------
async function startAdmin() {
  $('#admin-signout').onclick = async () => { await API.auth.signOut(); location.reload(); };
  show('#screen-admin');
  const body = $('#admin-body');
  body.innerHTML = '<p class="muted">Loading…</p>';
  let ov = {};
  try { ov = await API.admin.overview(); } catch (e) { body.innerHTML = ''; return errToast(e); }
  body.innerHTML = '';
  const stats = [
    ['Salons', ov.salons_total], ['Claimed', ov.salons_claimed], ['Published', ov.salons_published],
    ['Customers', ov.customers], ['Appointments', ov.appointments], ['Users', ov.users],
  ];
  const statGrid = el('div', { class: 'admin-stats' });
  stats.forEach(([label, val]) => statGrid.append(el('div', { class: 'card', style: 'text-align:center' },
    el('div', { style: 'font-size:28px;font-weight:800;font-family:Fraunces,serif' }, String(val ?? '—')),
    el('div', { class: 'muted', style: 'font-size:13px' }, label))));
  body.append(el('h1', { style: 'margin-bottom:14px' }, 'Admin'), statGrid);

  const search = el('input', { placeholder: 'Search salons by name, city, slug…', style: 'max-width:340px;margin:20px 0 12px' });
  body.append(search);
  const tableWrap = el('div'); body.append(tableWrap);
  let t;
  async function load() {
    let list = [];
    try { list = await API.admin.salons({ search: search.value.trim() }); } catch (e) { return errToast(e); }
    tableWrap.innerHTML = '';
    if (!list.length) { tableWrap.append(el('div', { class: 'card empty' }, 'No salons found.')); return; }
    const tb = el('tbody');
    list.forEach((s) => {
      const livePill = el('span', { class: 'pill', style: s.is_published ? 'background:#E2F6F2;color:var(--mint)' : 'background:var(--paper-dim);color:var(--grey)' }, s.is_published ? 'Live' : 'Off');
      tb.append(el('tr', {},
        el('td', {}, el('a', { href: `/${s.slug}`, target: '_blank' }, s.name)),
        el('td', {}, TYPE_LABELS[s.business_type] || s.business_type || '—'),
        el('td', {}, s.city || '—'),
        el('td', {}, s.claimed ? 'claimed' : el('span', { class: 'muted' }, 'unclaimed')),
        el('td', {}, livePill),
        el('td', {},
          el('button', { class: 'btn ghost sm', onclick: async () => { try { await API.admin.setPublished(s.id, !s.is_published); load(); toast('Updated'); } catch (e) { errToast(e); } } }, s.is_published ? 'Unpublish' : 'Publish'),
          ' ',
          el('button', { class: 'btn danger sm', onclick: async () => { if (!confirm(`Delete "${s.name}"? This removes the salon and all its data.`)) return; try { await API.admin.remove(s.id); load(); toast('Deleted'); } catch (e) { errToast(e); } } }, 'Delete')),
      ));
    });
    tableWrap.append(el('div', { class: 'card', style: 'padding:0;overflow:auto' },
      el('table', {}, el('thead', {}, el('tr', {}, ...['Salon', 'Type', 'City', 'Listing', 'Bookable', 'Actions'].map((h) => el('th', {}, h)))), tb)));
  }
  search.oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  load();
}

// ---- employee profile -----------------------------------------------------
async function startEmployee(prof) {
  $('#emp-signout').onclick = async () => { await API.auth.signOut(); location.reload(); };
  show('#screen-employee');
  const body = $('#emp-body'); body.innerHTML = '<p class="muted">Loading…</p>';
  const user = state.user || await API.auth.currentUser();
  let mine = []; try { mine = await API.salons.mine(); } catch { /* ignore */ }
  const salonId = mine[0]?.id || null;
  body.innerHTML = '';

  // Profile / contact / skills
  const f = {};
  body.append(el('div', { class: 'card', style: 'max-width:560px;margin-bottom:18px' },
    el('h1', { style: 'margin-bottom:12px' }, 'My profile'),
    field('Name', f.name = el('input', { value: prof?.full_name || '' })),
    field('Phone', f.phone = el('input', { value: prof?.phone || '' })),
    field('Skills', f.skills = el('input', { value: prof?.skills || '', placeholder: 'e.g. Balayage, Fades, Gel nails' })),
    field('Bio', f.bio = el('textarea', { rows: 2 }, prof?.bio || '')),
    el('div', { class: 'muted', style: 'font-size:13px;margin-bottom:10px' }, `Email: ${user?.email || ''}`),
    el('button', { class: 'btn', onclick: async () => { try { await API.auth.updateProfile({ full_name: f.name.value.trim() || null, phone: f.phone.value.trim() || null, skills: f.skills.value.trim() || null, bio: f.bio.value.trim() || null }); toast('Saved'); } catch (e) { errToast(e); } } }, 'Save')));

  body.append(mine.length
    ? el('p', { class: 'muted', style: 'margin:0 0 8px' }, 'You work at: ' + mine.map((s) => s.name).join(', '))
    : el('div', { class: 'banner' }, `You're not linked to a salon yet. Ask your salon's admin to add you using your email: ${user?.email || ''}`));

  // Appointments (upcoming + history)
  let appts = []; try { appts = await API.employee.myAppointments(); } catch (e) { errToast(e); }
  const now = new Date();
  const upcoming = appts.filter((a) => new Date(a.starts_at) >= now && a.status !== 'cancelled');
  const past = appts.filter((a) => new Date(a.starts_at) < now);
  const apptTable = (rows, emptyMsg) => {
    if (!rows.length) return el('div', { class: 'card empty' }, emptyMsg);
    const tb = el('tbody');
    rows.forEach((a) => tb.append(el('tr', {},
      el('td', {}, new Date(a.starts_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })),
      el('td', {}, a.service_name || '—'), el('td', {}, a.customer_name || '—'),
      el('td', {}, a.salon_name || ''), el('td', {}, statusPill(a.status)))));
    return el('div', { class: 'card', style: 'padding:0;overflow:auto' },
      el('table', {}, el('thead', {}, el('tr', {}, ...['When', 'Service', 'Customer', 'Salon', 'Status'].map((h) => el('th', {}, h)))), tb));
  };
  body.append(el('h3', { style: 'margin:20px 0 10px' }, 'Upcoming appointments'), apptTable(upcoming, 'No upcoming appointments assigned to you.'));
  body.append(el('h3', { style: 'margin:24px 0 10px' }, 'Past appointments'), apptTable(past.slice(0, 50), 'No past appointments yet.'));

  // Portfolio
  body.append(el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin:26px 0 10px;gap:12px;flex-wrap:wrap' },
    el('h3', {}, 'My work / portfolio'),
    (() => {
      const fileIn = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
      const btn = el('button', { class: 'btn', onclick: () => fileIn.click() }, '📷 Add photo');
      fileIn.onchange = async () => {
        const file = fileIn.files[0]; if (!file) return;
        const caption = prompt('Add a caption (optional):') || null;
        btn.disabled = true; btn.textContent = 'Uploading…';
        try { await API.employee.uploadPhoto(file, { salonId, caption }); toast('Photo added'); renderPortfolio(); }
        catch (e) { errToast(e); } finally { btn.disabled = false; btn.textContent = '📷 Add photo'; fileIn.value = ''; }
      };
      return el('span', {}, btn, fileIn);
    })()));
  const grid = el('div', { class: 'portfolio-grid' }); body.append(grid);
  async function renderPortfolio() {
    grid.innerHTML = '';
    let photos = []; try { photos = await API.employee.myPortfolio(); } catch (e) { return errToast(e); }
    if (!photos.length) { grid.append(el('div', { class: 'muted', style: 'grid-column:1/-1' }, 'No photos yet. Snap your finished looks to build your portfolio — they can appear on your salon\'s page.')); return; }
    photos.forEach((p) => grid.append(el('div', { class: 'pf-tile' },
      el('img', { src: p.url, alt: p.caption || '' }),
      p.caption ? el('div', { class: 'pf-cap' }, p.caption) : '',
      el('button', { class: 'pf-del', title: 'Delete', onclick: async () => { if (!confirm('Delete this photo?')) return; try { await API.employee.removePhoto(p); renderPortfolio(); } catch (e) { errToast(e); } } }, '✕'))));
  }
  renderPortfolio();
}

// ---- auth screen ----------------------------------------------------------
function wireAuthScreen() {
  let mode = 'login';
  const setMode = (m) => {
    mode = m;
    $('#tab-login').classList.toggle('on', m === 'login');
    $('#tab-signup').classList.toggle('on', m === 'signup');
    $('#name-field').classList.toggle('hidden', m === 'login');
    $('#au-submit').textContent = m === 'login' ? 'Log in' : 'Create account';
    $('#au-pass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  };
  $('#tab-login').onclick = () => setMode('login');
  $('#tab-signup').onclick = () => setMode('signup');
  $('#auth-form').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#au-email').value.trim();
    const password = $('#au-pass').value;
    if (!email || !password) return toast('Enter email and password', true);
    try {
      if (mode === 'signup') {
        const res = await API.auth.signUp({ email, password, fullName: $('#au-name').value.trim() });
        if (!res?.session) { setMode('login'); showEmailConfirmNotice($('.auth-card'), email); toast('Check your email to confirm.'); return; }
      } else {
        await API.auth.signIn({ email, password });
      }
    } catch (err) {
      if (/confirm/i.test(err?.message || '')) { showEmailConfirmNotice($('.auth-card'), email, { prefix: 'Please confirm your email first.' }); toast('Email not confirmed yet', true); return; }
      errToast(err);
    }
  };
  $('#forgot').onclick = async (e) => {
    e.preventDefault();
    const email = $('#au-email').value.trim();
    if (!email) return toast('Enter your email first', true);
    try { await API.auth.sendPasswordReset(email); toast('Password reset email sent'); }
    catch (err) { errToast(err); }
  };
  setMode('login');   // apply initial state so the name field is hidden on load
}

// ---- onboarding -----------------------------------------------------------
function wireOnboarding() {
  const name = $('#onb-name'), slugIn = $('#onb-slug'), tz = $('#onb-tz'), msg = $('#slug-msg');
  try { tz.value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { tz.value = 'UTC'; }
  let touchedSlug = false;
  slugIn.oninput = () => { touchedSlug = true; slugIn.value = slug(slugIn.value); checkSlug(); };
  name.oninput = () => { if (!touchedSlug) { slugIn.value = slug(name.value); checkSlug(); } };
  let slugOk = false;
  async function checkSlug() {
    const s = slugIn.value;
    if (!s) { msg.textContent = ''; slugOk = false; return; }
    if (RESERVED.has(s.toLowerCase())) {
      slugOk = false; msg.textContent = '✗ that name is reserved — pick another'; msg.style.color = 'var(--bad)'; return;
    }
    try {
      slugOk = await API.salons.slugAvailable(s);
      msg.textContent = slugOk ? `✓ ${APP_DOMAIN}/${s}` : '✗ that link is taken';
      msg.style.color = slugOk ? 'var(--mint)' : 'var(--bad)';
    } catch { /* offline */ }
  }
  $('#onb-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!name.value.trim() || !slugIn.value) return toast('Name and link are required', true);
    if (RESERVED.has(slugIn.value.toLowerCase())) return toast('That link name is reserved — pick another', true);
    try {
      state.salon = await API.salons.create({
        name: name.value.trim(), slug: slugIn.value, businessType: $('#onb-type').value,
        timezone: tz.value.trim() || 'UTC', currency: $('#onb-currency').value,
      });
      toast('Salon created 🎉');
      wireAppShell(); show('#screen-app'); navigate('settings');
    } catch (err) { errToast(err); }
  };
}

// ---- app shell / nav ------------------------------------------------------
function wireAppShell() {
  $$('.nav-item[data-page]').forEach((b) => (b.onclick = () => navigate(b.dataset.page)));
  $('#signout').onclick = async () => { await API.auth.signOut(); location.reload(); };
  const link = `${location.origin}/${state.salon.slug}`;
  $('#view-storefront').href = link;
}

const PAGES = {};
function navigate(page) {
  $$('.nav-item[data-page]').forEach((b) => b.classList.toggle('on', b.dataset.page === page));
  const root = $('#page');
  root.innerHTML = '';
  (PAGES[page] || PAGES.calendar)(root);
}

// ---- CALENDAR (day / week / month) ----------------------------------------
const CAL_H0 = 7, CAL_H1 = 21;   // hour grid range (7am–9pm)
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d) => addDays(startOfDay(d), -startOfDay(d).getDay());   // Sunday
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

PAGES.calendar = async (root) => {
  const st = { view: 'week', anchor: new Date() };
  const head = el('div', { class: 'page-head' });
  const body = el('div');
  root.append(head, body);

  function rangeFor() {
    if (st.view === 'day') return [startOfDay(st.anchor), addDays(startOfDay(st.anchor), 1)];
    if (st.view === 'week') { const s = startOfWeek(st.anchor); return [s, addDays(s, 7)]; }
    const first = new Date(st.anchor.getFullYear(), st.anchor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    return [gridStart, addDays(gridStart, 42)];
  }
  function titleFor() {
    if (st.view === 'day') return st.anchor.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    if (st.view === 'month') return st.anchor.toLocaleDateString([], { month: 'long', year: 'numeric' });
    const s = startOfWeek(st.anchor), e = addDays(s, 6);
    return `${s.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  }
  function shift(dir) {
    if (st.view === 'day') st.anchor = addDays(st.anchor, dir);
    else if (st.view === 'week') st.anchor = addDays(st.anchor, dir * 7);
    else st.anchor = new Date(st.anchor.getFullYear(), st.anchor.getMonth() + dir, 1);
    render();
  }
  const setView = (v) => { st.view = v; render(); };

  async function render() {
    head.innerHTML = '';
    const toggle = el('div', { class: 'viewtoggle' },
      ...['day', 'week', 'month'].map((v) => el('button', { class: v === st.view ? 'on' : '', onclick: () => setView(v) }, v[0].toUpperCase() + v.slice(1))));
    head.append(
      el('h1', {}, titleFor()),
      el('div', { class: 'cal-controls' }, toggle,
        el('button', { class: 'btn ghost sm', onclick: () => shift(-1) }, '‹'),
        el('button', { class: 'btn ghost sm', onclick: () => { st.anchor = new Date(); render(); } }, 'Today'),
        el('button', { class: 'btn ghost sm', onclick: () => shift(1) }, '›'),
        el('button', { class: 'btn', onclick: () => openApptModal(st.anchor, render) }, '+ New')));

    const [from, to] = rangeFor();
    let appts = [];
    try { appts = await API.appointments.range(state.salon.id, from.toISOString(), to.toISOString()); } catch (e) { errToast(e); }

    body.innerHTML = '';
    if (st.view === 'month') body.append(renderMonth(from, appts));
    else body.append(renderTimeGrid(st.view === 'week' ? 7 : 1, from, appts));
  }

  function renderTimeGrid(days, from, appts) {
    const cols = `56px repeat(${days}, 1fr)`;
    const wrap = el('div', { class: 'cal-grid' });
    if (days > 1) {
      const hd = el('div', { class: 'cal-dayhead', style: `grid-template-columns:${cols}` }, el('div', {}, ''));
      for (let i = 0; i < days; i++) { const d = addDays(from, i); hd.append(el('div', { style: sameDay(d, new Date()) ? 'color:var(--plum)' : '' }, d.toLocaleDateString([], { weekday: 'short', day: 'numeric' }))); }
      wrap.append(hd);
    }
    for (let h = CAL_H0; h < CAL_H1; h++) {
      const row = el('div', { class: 'cal-row', style: `grid-template-columns:${cols}` },
        el('div', { class: 'cal-timecol' }, `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`));
      for (let i = 0; i < days; i++) {
        const d = addDays(from, i);
        const cell = el('div', { class: 'cal-cell' });
        appts.filter((a) => { const s = new Date(a.starts_at); return sameDay(s, d) && s.getHours() === h; })
          .forEach((a) => cell.append(calChip(a, render, days > 1)));
        row.append(cell);
      }
      wrap.append(row);
    }
    return wrap;
  }

  function renderMonth(gridStart, appts) {
    const wrap = el('div', { class: 'cal-month' });
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d) => wrap.append(el('div', { class: 'cal-mcell', style: 'min-height:auto;background:var(--paper-dim);font-weight:600;font-size:12px;text-align:center;cursor:default' }, d)));
    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      const dayAppts = appts.filter((a) => sameDay(new Date(a.starts_at), d)).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
      const other = d.getMonth() !== st.anchor.getMonth();
      const cell = el('div', { class: 'cal-mcell' + (other ? ' other' : '') + (sameDay(d, new Date()) ? ' today' : ''), onclick: () => { st.view = 'day'; st.anchor = d; render(); } },
        el('div', { class: 'dnum' }, String(d.getDate())));
      dayAppts.slice(0, 3).forEach((a) => cell.append(el('div', { class: 'cal-appt' + (a.status === 'cancelled' ? ' cancelled' : ''), onclick: (e) => { e.stopPropagation(); openApptModal(null, render, a); } },
        `${fmtTime(a.starts_at, state.salon.timezone)} ${a.customer?.name || 'Walk-in'}`)));
      if (dayAppts.length > 3) cell.append(el('div', { class: 'muted', style: 'font-size:11px' }, `+${dayAppts.length - 3} more`));
      wrap.append(cell);
    }
    return wrap;
  }

  render();
};

// Appointment chip for the time grid (compact in week view).
function calChip(a, refresh, compact) {
  const node = el('div', { class: 'cal-appt' + (a.status === 'cancelled' ? ' cancelled' : ''), onclick: () => openApptModal(null, refresh, a) });
  if (compact) node.textContent = `${fmtTime(a.starts_at, state.salon.timezone)} ${a.customer?.name || 'Walk-in'}`;
  else { node.append(el('div', { style: 'font-weight:700' }, `${fmtTime(a.starts_at, state.salon.timezone)} · ${a.customer?.name || 'Walk-in'}`), el('div', {}, `${a.service?.name || ''}${a.staff ? ' — ' + a.staff.name : ''}`)); }
  return node;
}

// ---- APPOINTMENTS (list) --------------------------------------------------
PAGES.appointments = async (root) => {
  root.append(el('div', { class: 'page-head' }, el('h1', {}, 'Upcoming appointments'),
    el('button', { class: 'btn', onclick: () => openApptModal(new Date(), () => navigate('appointments')) }, '+ New')));
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(); to.setDate(to.getDate() + 30);
  let appts = [];
  try { appts = await API.appointments.range(state.salon.id, from.toISOString(), to.toISOString()); } catch (e) { return errToast(e); }
  if (!appts.length) return root.append(el('div', { class: 'card empty' }, 'No appointments in the next 30 days.'));
  const t = el('table', {}, el('thead', {}, el('tr', {},
    ...['When', 'Customer', 'Service', 'Staff', 'Status', ''].map((h) => el('th', {}, h)))));
  const tb = el('tbody');
  appts.forEach((a) => tb.append(el('tr', {},
    el('td', {}, `${fmtDate(a.starts_at, state.salon.timezone)}, ${fmtTime(a.starts_at, state.salon.timezone)}`),
    el('td', {}, a.customer?.name || '—'),
    el('td', {}, a.service?.name || '—'),
    el('td', {}, a.staff?.name || '—'),
    el('td', {}, statusPill(a.status)),
    el('td', {}, el('button', { class: 'btn ghost sm', onclick: () => openApptModal(null, () => navigate('appointments'), a) }, 'Edit')),
  )));
  t.append(tb); root.append(el('div', { class: 'card', style: 'padding:0;overflow:auto' }, t));
};
function statusPill(s) {
  const map = { booked: ['#EEE9FB', 'var(--plum)'], confirmed: ['#E2F6F2', 'var(--mint)'], completed: ['#E9ECEF', '#555'], cancelled: ['#FBE4E5', 'var(--bad)'], no_show: ['#FFF0DA', '#8a5a00'] };
  const [bg, fg] = map[s] || map.booked;
  return el('span', { class: 'pill', style: `background:${bg};color:${fg}` }, s.replace('_', ' '));
}

// ---- appointment create/edit modal ---------------------------------------
async function openApptModal(day, refresh, existing) {
  const [svcs, stf, custs] = await Promise.all([
    API.services.list(state.salon.id), API.staff.list(state.salon.id), API.customers.list(state.salon.id),
  ]);
  const wrap = el('div');
  const f = {};
  const start = existing ? new Date(existing.starts_at) : (day || new Date());
  const dateVal = todayISO(start);
  const timeVal = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;

  wrap.append(
    field('Customer', f.customer = el('select', {},
      el('option', { value: '' }, '— Walk-in / none —'),
      custs.map((c) => el('option', { value: c.id, ...(existing?.customer_id === c.id ? { selected: true } : {}) }, c.name)))),
    field('Or new customer name', f.newName = el('input', { placeholder: 'Leave blank to use selection' })),
    field('Service', f.service = el('select', {}, svcs.map((s) =>
      el('option', { value: s.id, 'data-dur': s.duration_min, 'data-price': s.price, ...(existing?.service_id === s.id ? { selected: true } : {}) }, `${s.name} (${s.duration_min}m)`)))),
    field('Staff', f.staff = el('select', {}, el('option', { value: '' }, '— Unassigned —'),
      stf.map((s) => el('option', { value: s.id, ...(existing?.staff_id === s.id ? { selected: true } : {}) }, s.name)))),
    el('div', { class: 'row' },
      field('Date', f.date = el('input', { type: 'date', value: dateVal })),
      field('Time', f.time = el('input', { type: 'time', value: timeVal })),
    ),
  );
  if (existing) wrap.append(field('Status', f.status = el('select', {},
    ['booked', 'confirmed', 'completed', 'cancelled', 'no_show'].map((s) =>
      el('option', { value: s, ...(existing.status === s ? { selected: true } : {}) }, s.replace('_', ' '))))));
  wrap.append(field('Notes', f.notes = el('textarea', { rows: 2 }, existing?.notes || '')));

  if (existing) {
    const cs = existing.status === 'confirmed' ? '✓ Confirmed by the customer'
      : existing.confirmation_requested_at ? '⏳ Awaiting customer confirmation' : null;
    if (cs) wrap.append(el('div', { class: 'muted', style: 'font-size:13px;margin-bottom:8px' }, cs));
  }

  const actions = el('div', { class: 'row', style: 'margin-top:8px' });
  if (existing) actions.append(el('button', { class: 'btn danger', onclick: async () => {
    if (!confirm('Delete this appointment?')) return;
    try { await API.appointments.remove(existing.id); close(); refresh(); toast('Deleted'); } catch (e) { errToast(e); }
  } }, 'Delete'));
  if (existing && !['confirmed', 'cancelled', 'completed'].includes(existing.status)) {
    actions.append(el('button', { class: 'btn ghost', onclick: requestConfirm }, 'Request confirmation'));
  }
  actions.append(el('button', { class: 'btn', onclick: save }, existing ? 'Save changes' : 'Book appointment'));
  wrap.append(actions);
  const close = modal(existing ? 'Edit appointment' : 'New appointment', wrap);

  async function requestConfirm() {
    try {
      const row = await API.appointments.requestConfirmation(existing.id);
      const link = `${location.origin}/confirm/${row.confirm_token}`;
      const when = new Date(existing.starts_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
      const cust = existing.customer || {};
      const msg = `Hi ${cust.name || ''}, please confirm your appointment at ${state.salon.name} on ${when}. Tap to confirm: ${link}`;
      if (cust.email) window.location.href = `mailto:${encodeURIComponent(cust.email)}?subject=${encodeURIComponent('Please confirm your appointment')}&body=${encodeURIComponent(msg)}`;
      else if (cust.phone) window.location.href = `sms:${(cust.phone || '').replace(/[^0-9+]/g, '')}?&body=${encodeURIComponent(msg)}`;
      else { try { await navigator.clipboard.writeText(link); } catch { /* */ } toast('No email/phone on file — confirm link copied'); }
      close(); refresh();
    } catch (e) { errToast(e); }
  }

  async function save() {
    try {
      const opt = f.service.selectedOptions[0];
      const dur = parseInt(opt?.dataset.dur || '30', 10);
      const starts = new Date(`${f.date.value}T${f.time.value}`);
      const ends = new Date(starts.getTime() + dur * 60000);
      let customerId = f.customer.value || null;
      if (f.newName.value.trim()) {
        const c = await API.customers.create(state.salon.id, { name: f.newName.value.trim() });
        customerId = c.id;
      }
      const payload = {
        customer_id: customerId, staff_id: f.staff.value || null, service_id: f.service.value || null,
        starts_at: starts.toISOString(), ends_at: ends.toISOString(),
        price: parseFloat(opt?.dataset.price || '0'), notes: f.notes.value.trim() || null,
      };
      if (existing) { payload.status = f.status.value; await API.appointments.update(existing.id, payload); }
      else { payload.source = 'manual'; await API.appointments.create(state.salon.id, payload); }
      close(); refresh(); toast('Saved');
    } catch (e) { errToast(e); }
  }
}
function field(label, node) { return el('div', { class: 'field' }, el('label', {}, label), node); }

// ---- CUSTOMERS ------------------------------------------------------------
PAGES.customers = async (root) => {
  const head = el('div', { class: 'page-head' }, el('h1', {}, 'Customers'),
    el('button', { class: 'btn', onclick: () => openCustomerModal(() => navigate('customers')) }, '+ Add customer'));
  const search = el('input', { placeholder: 'Search name, email, phone…', style: 'max-width:280px' });
  root.append(head, el('div', { style: 'margin-bottom:14px' }, search));
  const body = el('div'); root.append(body);
  let t;
  async function load() {
    clearTimeout(t);
    let list = [];
    try { list = await API.customers.list(state.salon.id, { search: search.value.trim() }); } catch (e) { return errToast(e); }
    body.innerHTML = '';
    if (!list.length) return body.append(el('div', { class: 'card empty' }, 'No customers yet.'));
    const tb = el('tbody');
    list.forEach((c) => tb.append(el('tr', {},
      el('td', {}, c.name), el('td', {}, c.email || '—'), el('td', {}, c.phone || '—'),
      el('td', {}, el('button', { class: 'btn ghost sm', onclick: () => openCustomerModal(load, c) }, 'Edit')))));
    body.append(el('div', { class: 'card', style: 'padding:0;overflow:auto' },
      el('table', {}, el('thead', {}, el('tr', {}, ...['Name', 'Email', 'Phone', ''].map((h) => el('th', {}, h)))), tb)));
  }
  search.oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  load();
};
function openCustomerModal(refresh, c) {
  const f = {};
  const wrap = el('div', {},
    field('Name', f.name = el('input', { value: c?.name || '' })),
    field('Email', f.email = el('input', { type: 'email', value: c?.email || '' })),
    field('Phone', f.phone = el('input', { value: c?.phone || '' })),
    field('Notes (private)', f.notes = el('textarea', { rows: 3 }, c?.notes || '')),
  );
  const actions = el('div', { class: 'row', style: 'margin-top:8px' });
  if (c) actions.append(el('button', { class: 'btn danger', onclick: async () => {
    if (!confirm('Delete customer?')) return;
    try { await API.customers.remove(c.id); close(); refresh(); } catch (e) { errToast(e); }
  } }, 'Delete'));
  actions.append(el('button', { class: 'btn', onclick: save }, 'Save'));
  wrap.append(actions);
  const close = modal(c ? 'Edit customer' : 'Add customer', wrap);
  async function save() {
    const payload = { name: f.name.value.trim(), email: f.email.value.trim() || null, phone: f.phone.value.trim() || null, notes: f.notes.value.trim() || null };
    if (!payload.name) return toast('Name is required', true);
    try { c ? await API.customers.update(c.id, payload) : await API.customers.create(state.salon.id, payload); close(); refresh(); toast('Saved'); }
    catch (e) { errToast(e); }
  }
}

// ---- SERVICES -------------------------------------------------------------
PAGES.services = async (root) => {
  root.append(el('div', { class: 'page-head' }, el('h1', {}, 'Services'),
    el('button', { class: 'btn', onclick: () => openServiceModal(() => navigate('services')) }, '+ Add service')));
  let list = [];
  try { list = await API.services.list(state.salon.id); } catch (e) { return errToast(e); }
  if (!list.length) return root.append(el('div', { class: 'card empty' }, 'No services yet. Add the things clients can book.'));
  const tb = el('tbody');
  list.forEach((s) => tb.append(el('tr', {},
    el('td', {}, s.name),
    el('td', {}, `${s.duration_min} min`),
    el('td', {}, money(s.price, state.salon.currency)),
    el('td', {}, s.bookable_online ? statusPill('confirmed') && el('span', { class: 'pill', style: 'background:#E2F6F2;color:var(--mint)' }, 'online') : el('span', { class: 'pill muted', style: 'background:var(--paper-dim)' }, 'in-house')),
    el('td', {}, el('button', { class: 'btn ghost sm', onclick: () => openServiceModal(() => navigate('services'), s) }, 'Edit')))));
  root.append(el('div', { class: 'card', style: 'padding:0;overflow:auto' },
    el('table', {}, el('thead', {}, el('tr', {}, ...['Service', 'Duration', 'Price', 'Booking', ''].map((h) => el('th', {}, h)))), tb)));
};
function openServiceModal(refresh, s) {
  const f = {};
  const wrap = el('div', {},
    field('Name', f.name = el('input', { value: s?.name || '' })),
    field('Description', f.desc = el('textarea', { rows: 2 }, s?.description || '')),
    el('div', { class: 'row' },
      field('Duration (min)', f.dur = el('input', { type: 'number', min: '5', step: '5', value: s?.duration_min ?? 30 })),
      field('Buffer after (min)', f.buf = el('input', { type: 'number', min: '0', step: '5', value: s?.buffer_min ?? 0 })),
      field('Price', f.price = el('input', { type: 'number', min: '0', step: '0.01', value: s?.price ?? 0 })),
    ),
    el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:500' },
      f.online = el('input', { type: 'checkbox', style: 'width:auto', ...(s ? (s.bookable_online ? { checked: true } : {}) : { checked: true }) }), 'Available to book online'),
    el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:500;margin-top:8px' },
      f.active = el('input', { type: 'checkbox', style: 'width:auto', ...(s ? (s.is_active ? { checked: true } : {}) : { checked: true }) }), 'Active'),
  );
  const actions = el('div', { class: 'row', style: 'margin-top:14px' });
  if (s) actions.append(el('button', { class: 'btn danger', onclick: async () => {
    if (!confirm('Delete service?')) return;
    try { await API.services.remove(s.id); close(); refresh(); } catch (e) { errToast(e); }
  } }, 'Delete'));
  actions.append(el('button', { class: 'btn', onclick: save }, 'Save'));
  wrap.append(actions);
  const close = modal(s ? 'Edit service' : 'Add service', wrap);
  async function save() {
    const payload = {
      name: f.name.value.trim(), description: f.desc.value.trim() || null,
      duration_min: parseInt(f.dur.value, 10) || 30, buffer_min: parseInt(f.buf.value, 10) || 0,
      price: parseFloat(f.price.value) || 0, bookable_online: f.online.checked, is_active: f.active.checked,
    };
    if (!payload.name) return toast('Name is required', true);
    try { s ? await API.services.update(s.id, payload) : await API.services.create(state.salon.id, payload); close(); refresh(); toast('Saved'); }
    catch (e) { errToast(e); }
  }
}

// ---- STAFF ----------------------------------------------------------------
PAGES.staff = async (root) => {
  root.append(el('div', { class: 'page-head' }, el('h1', {}, 'Staff'),
    el('div', { style: 'display:flex;gap:8px' },
      el('button', { class: 'btn ghost', onclick: () => openLinkEmployee(() => navigate('staff')) }, '+ Link employee'),
      el('button', { class: 'btn', onclick: () => openStaffModal(() => navigate('staff')) }, '+ Add staff'))));
  let list = [];
  try { list = await API.staff.list(state.salon.id); } catch (e) { return errToast(e); }
  if (!list.length) return root.append(el('div', { class: 'card empty' }, 'No staff yet. Add the people who take appointments.'));
  const tb = el('tbody');
  list.forEach((s) => tb.append(el('tr', {},
    el('td', {}, s.name), el('td', {}, s.title || '—'),
    el('td', {}, s.accepts_online_booking ? el('span', { class: 'pill', style: 'background:#E2F6F2;color:var(--mint)' }, 'online') : el('span', { class: 'pill', style: 'background:var(--paper-dim)' }, 'off')),
    el('td', {},
      el('button', { class: 'btn ghost sm', onclick: () => openHoursModal(s, () => navigate('staff')) }, 'Hours'),
      ' ',
      el('button', { class: 'btn ghost sm', onclick: () => openStaffModal(() => navigate('staff'), s) }, 'Edit')))));
  root.append(el('div', { class: 'card', style: 'padding:0;overflow:auto' },
    el('table', {}, el('thead', {}, el('tr', {}, ...['Name', 'Title', 'Online', ''].map((h) => el('th', {}, h)))), tb)));
};
async function openStaffModal(refresh, s) {
  const allServices = await API.services.list(state.salon.id);
  const assigned = s ? new Set(await API.staff.getServiceIds(s.id)) : new Set(allServices.map((x) => x.id));
  const f = {};
  const svcChecks = allServices.map((sv) => el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:500;margin-bottom:4px' },
    el('input', { type: 'checkbox', value: sv.id, style: 'width:auto', ...(assigned.has(sv.id) ? { checked: true } : {}) }), sv.name));
  const wrap = el('div', {},
    field('Name', f.name = el('input', { value: s?.name || '' })),
    field('Title', f.title = el('input', { value: s?.title || '', placeholder: 'Senior Stylist' })),
    el('div', { class: 'row' },
      field('Calendar colour', f.color = el('input', { type: 'color', value: s?.color || '#6C4AB6' })),
      el('div', { class: 'field' }, el('label', {}, 'Online booking'),
        el('label', { style: 'display:flex;align-items:center;gap:8px;font-weight:500;padding-top:8px' },
          f.online = el('input', { type: 'checkbox', style: 'width:auto', ...(s ? (s.accepts_online_booking ? { checked: true } : {}) : { checked: true }) }), 'Accepts')),
    ),
    el('label', {}, 'Services this person performs'),
    el('div', { style: 'max-height:160px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:8px' },
      allServices.length ? svcChecks : el('span', { class: 'muted' }, 'Add services first.')),
  );
  const actions = el('div', { class: 'row', style: 'margin-top:8px' });
  if (s) actions.append(el('button', { class: 'btn danger', onclick: async () => {
    if (!confirm('Remove staff member?')) return;
    try { await API.staff.remove(s.id); close(); refresh(); } catch (e) { errToast(e); }
  } }, 'Remove'));
  actions.append(el('button', { class: 'btn', onclick: save }, 'Save'));
  wrap.append(actions);
  const close = modal(s ? 'Edit staff' : 'Add staff', wrap);
  async function save() {
    const payload = { name: f.name.value.trim(), title: f.title.value.trim() || null, color: f.color.value, accepts_online_booking: f.online.checked };
    if (!payload.name) return toast('Name is required', true);
    try {
      const saved = s ? await API.staff.update(s.id, payload) : await API.staff.create(state.salon.id, payload);
      const ids = $$('input[type=checkbox]', wrap).filter((c) => c.value && c.checked).map((c) => c.value);
      await API.staff.setServices(saved.id, ids);
      close(); refresh(); toast('Saved');
    } catch (e) { errToast(e); }
  }
}
async function openHoursModal(s, refresh) {
  const existing = (await API.hours.list(state.salon.id)).filter((h) => h.staff_id === s.id);
  const byDow = {}; existing.forEach((h) => (byDow[h.dow] = h));
  const rows = DOW.map((name, dow) => {
    const h = byDow[dow];
    const on = el('input', { type: 'checkbox', style: 'width:auto', ...(h ? { checked: true } : {}) });
    const start = el('input', { type: 'time', value: h?.start_time?.slice(0, 5) || '09:00' });
    const end = el('input', { type: 'time', value: h?.end_time?.slice(0, 5) || '17:00' });
    return { dow, on, start, end, node: el('div', { style: 'display:grid;grid-template-columns:30px 56px 1fr 1fr;gap:8px;align-items:center;margin-bottom:6px' },
      on, el('span', { style: 'font-weight:600;font-size:13px' }, name), start, end) };
  });
  const wrap = el('div', {}, el('p', { class: 'muted', style: 'font-size:13px;margin-top:0' }, `Weekly hours for ${s.name}. These drive online availability.`),
    ...rows.map((r) => r.node), el('button', { class: 'btn block', style: 'margin-top:10px', onclick: save }, 'Save hours'));
  const close = modal(`Working hours — ${s.name}`, wrap);
  async function save() {
    const payload = rows.filter((r) => r.on.checked).map((r) => ({ dow: r.dow, start_time: r.start.value, end_time: r.end.value }));
    if (payload.some((p) => p.end_time <= p.start_time)) return toast('End time must be after start time', true);
    try { await API.hours.setForStaff(state.salon.id, s.id, payload); close(); toast('Hours saved'); if (refresh) refresh(); }
    catch (e) { errToast(e); }
  }
}

function openLinkEmployee(refresh) {
  const f = {};
  const salonName = state.salon?.name || 'our salon';
  const signupUrl = `${location.origin}/`;
  const msg = `Join ${salonName} on Glowup Book! Create your employee account at ${signupUrl} (choose "I'm an employee"), then I'll add you to the team.`;
  const isEmail = (v) => /@/.test(v || '');
  const wrap = el('div', {},
    el('p', { class: 'muted', style: 'margin-top:0;font-size:14px' }, 'Already registered? Link them by the email or phone they used. Not yet? Send an invite to sign up.'),
    field('Employee email or phone', f.id = el('input', { placeholder: 'name@email.com or (555) 123-4567' })),
    field('Display name (optional)', f.name = el('input', { placeholder: 'Shown on the calendar' })),
    el('button', { class: 'btn block', style: 'margin-bottom:12px', onclick: link }, 'Link existing account'),
    el('div', { class: 'muted', style: 'font-size:13px;margin-bottom:6px' }, 'Or invite them to register:'),
    el('div', { class: 'row' },
      el('button', { class: 'btn ghost', onclick: () => { const to = isEmail(f.id.value) ? f.id.value.trim() : ''; window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent('Join ' + salonName + ' on Glowup Book')}&body=${encodeURIComponent(msg)}`; } }, '✉ Invite by email'),
      el('button', { class: 'btn ghost', onclick: () => { const to = !isEmail(f.id.value) ? (f.id.value || '').replace(/[^0-9+]/g, '') : ''; window.location.href = `sms:${to}?&body=${encodeURIComponent(msg)}`; } }, '💬 Invite by text')));
  const close = modal('Add an employee', wrap);
  async function link() {
    if (!f.id.value.trim()) return toast('Enter their email or phone', true);
    try { await API.staff.linkEmployee(state.salon.id, f.id.value.trim(), f.name.value.trim()); close(); refresh(); toast('Employee linked'); }
    catch (e) { errToast(e); }
  }
}

// ---- SETTINGS -------------------------------------------------------------
PAGES.settings = async (root) => {
  const s = state.salon;
  root.append(el('div', { class: 'page-head' }, el('h1', {}, 'Settings')));
  const link = `${location.origin}/${s.slug}`;
  const f = {};
  const card = el('div', { class: 'card', style: 'max-width:560px' },
    el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px' },
      el('div', {}, el('strong', {}, 'Booking page'), el('div', { class: 'muted', style: 'font-size:13px' }, link)),
      el('div', {},
        el('span', { class: 'pill', style: `background:${s.is_published ? '#E2F6F2' : 'var(--paper-dim)'};color:${s.is_published ? 'var(--mint)' : 'var(--grey)'};margin-right:8px` }, s.is_published ? 'Live' : 'Offline'),
        el('button', { class: 'btn sm', onclick: togglePublish }, s.is_published ? 'Take offline' : 'Publish'))),
    field('Business name', f.name = el('input', { value: s.name || '' })),
    field('About', f.about = el('textarea', { rows: 3 }, s.about || '')),
    el('div', { class: 'row' },
      field('Phone', f.phone = el('input', { value: s.phone || '' })),
      field('Email', f.email = el('input', { value: s.email || '' })),
    ),
    field('Address', f.address = el('input', { value: s.address || '' })),
    el('div', { class: 'row' },
      field('Timezone', f.tz = el('input', { value: s.timezone || 'UTC' })),
      field('Currency', f.cur = el('input', { value: s.currency || 'USD' })),
    ),
    el('h3', { style: 'font-size:16px;margin:6px 0 10px' }, 'Social links'),
    el('div', { class: 'row' },
      field('Instagram', f.instagram = el('input', { value: s.instagram || '', placeholder: '@yoursalon or URL' })),
      field('TikTok', f.tiktok = el('input', { value: s.tiktok || '', placeholder: '@yoursalon or URL' })),
    ),
    el('div', { class: 'row' },
      field('Facebook', f.facebook = el('input', { value: s.facebook || '', placeholder: 'page name or URL' })),
      field('Website', f.website = el('input', { value: s.website || '', placeholder: 'https://…' })),
    ),
    el('button', { class: 'btn', onclick: save }, 'Save settings'),
  );
  root.append(card);
  async function save() {
    try {
      state.salon = await API.salons.update(s.id, {
        name: f.name.value.trim(), about: f.about.value.trim() || null, phone: f.phone.value.trim() || null,
        email: f.email.value.trim() || null, address: f.address.value.trim() || null,
        timezone: f.tz.value.trim() || 'UTC', currency: f.cur.value.trim() || 'USD',
        instagram: f.instagram.value.trim() || null, tiktok: f.tiktok.value.trim() || null,
        facebook: f.facebook.value.trim() || null, website: f.website.value.trim() || null,
      });
      toast('Saved'); navigate('settings');
    } catch (e) { errToast(e); }
  }
  async function togglePublish() {
    try { state.salon = await API.salons.update(s.id, { is_published: !s.is_published }); toast(state.salon.is_published ? 'Booking page is live' : 'Booking page offline'); navigate('settings'); }
    catch (e) { errToast(e); }
  }
};

// ===========================================================================
// PUBLIC DIRECTORY (homepage at /)
// ===========================================================================
const TYPE_LABELS = { hair: 'Hair salon', barber: 'Barber shop', nails: 'Nail studio', beauty: 'Beauty & spa' };

async function startDirectory() {
  show('#screen-directory');
  renderDirAuth();
  const grid = $('#dir-grid'), q = $('#dir-q'), type = $('#dir-type');
  const mapEl = $('#dir-map'), btnList = $('#view-list'), btnMap = $('#view-map');
  let t, view = 'list', lastResults = [];

  function renderList(salons) {
    grid.innerHTML = '';
    if (!salons.length) {
      grid.append(el('div', { class: 'empty', style: 'grid-column:1/-1' },
        (q.value.trim() || type.value) ? 'No salons match your search.' : 'No salons are listed yet — be the first to add yours!'));
      return;
    }
    salons.forEach((s) => grid.append(salonCard(s)));
    if (salons.length >= 60) {
      grid.append(el('div', { class: 'muted', style: 'grid-column:1/-1;text-align:center;padding:18px;font-size:14px' },
        'Showing the first 60 salons — search by name or city, or pick a type, to narrow it down.'));
    }
  }

  async function load() {
    if (!API.enabled) { grid.innerHTML = ''; grid.append(el('div', { class: 'banner' }, 'Directory not connected to a backend yet.')); return; }
    if (view === 'list') grid.innerHTML = '<p class="muted">Loading salons…</p>';
    try { lastResults = await API.storefront.directory({ search: q.value.trim(), type: type.value }); }
    catch (e) { grid.innerHTML = ''; return errToast(e); }
    if (view === 'list') renderList(lastResults); else renderMap(mapEl, lastResults);
  }

  function setView(v) {
    view = v;
    btnList.classList.toggle('on', v === 'list');
    btnMap.classList.toggle('on', v === 'map');
    grid.classList.toggle('hidden', v === 'map');
    mapEl.classList.toggle('hidden', v === 'list');
    if (v === 'list') renderList(lastResults); else renderMap(mapEl, lastResults);
  }
  btnList.onclick = () => setView('list');
  btnMap.onclick = () => setView('map');

  q.oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  type.onchange = load;
  await load();
  renderGallery(lastResults);
}

// Themed inspiration images (free Unsplash) used when real portfolio photos
// aren't available yet. Tiles always link to a real salon page.
const SHOWCASE = {
  nails: ['photo-1632345031435-8727f6897d53', 'photo-1604654894610-df63bc536371', 'photo-1610992015762-45dca7fa3a85'],
  hair: ['photo-1634449571010-02389ed0f9b0', 'photo-1580618672591-eb180b1a973f', 'photo-1595475884562-073c30d45670'],
  barber: ['photo-1503951914875-452162b0f3f1', 'photo-1605497788044-5a32c7078486', 'photo-1585747860715-2ba37e788b70'],
  beauty: ['photo-1570172619644-dfd03ed5d881', 'photo-1616394584738-fc6e612e71b9', 'photo-1643684391140-c5056cfd3436'],
};
const showImg = (id) => `https://images.unsplash.com/${id}?w=600&h=600&fit=crop&auto=format&q=70`;

async function renderGallery(salonsForLink) {
  const band = $('#dir-carousel-band'), strip = $('#dir-carousel');
  if (!band || !strip || !API.enabled) return;
  strip.innerHTML = '';
  const tiles = [];
  // Real employee/portfolio photos first.
  try {
    const photos = await API.storefront.recentPortfolio(18);
    photos.forEach((p) => { if (p.salon?.slug) tiles.push({ img: p.url, slug: p.salon.slug, label: p.salon.name, sub: p.caption || 'Recent work' }); });
  } catch { /* */ }
  // Pad with themed inspiration tiles linked to real salons.
  if (tiles.length < 12 && salonsForLink?.length) {
    let i = 0;
    for (const s of salonsForLink) {
      if (tiles.length >= 12) break;
      const imgs = SHOWCASE[s.business_type] || SHOWCASE.hair;
      tiles.push({ img: showImg(imgs[i % imgs.length]), slug: s.slug, label: s.name, sub: TYPE_LABELS[s.business_type] || 'Salon' });
      i++;
    }
  }
  if (!tiles.length) { band.classList.add('hidden'); return; }
  band.classList.remove('hidden');
  tiles.forEach((t) => strip.append(el('a', { class: 'show-tile', href: `/${t.slug}` },
    el('img', { src: t.img, alt: t.label, loading: 'lazy' }),
    el('div', { class: 'cap' }, t.label, t.sub ? el('small', {}, t.sub) : ''))));
}

// Lazy-load Leaflet (map library) only when the map view is first opened.
let _leafletPromise = null;
function ensureLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (_leafletPromise) return _leafletPromise;
  _leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.append(css);
    const js = document.createElement('script');
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    js.onload = () => resolve(window.L);
    js.onerror = () => reject(new Error('Could not load the map library.'));
    document.head.append(js);
  });
  return _leafletPromise;
}

let _map = null, _markers = null;
async function renderMap(container, salons) {
  let L;
  try { L = await ensureLeaflet(); } catch (e) { container.innerHTML = ''; container.append(el('div', { class: 'banner' }, e.message)); return; }
  if (!_map) {
    _map = L.map(container).setView([40.7128, -74.006], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap',
    }).addTo(_map);
    _markers = L.layerGroup().addTo(_map);
  }
  setTimeout(() => _map.invalidateSize(), 50);   // container just became visible
  _markers.clearLayers();
  const pts = [];
  salons.forEach((s) => {
    if (s.lat == null || s.lon == null) return;
    const m = L.marker([s.lat, s.lon]).bindPopup(
      `<a href="/${s.slug}">${s.name}</a><br><span style="color:#8B8898;font-size:12px">${TYPE_LABELS[s.business_type] || ''}${s.city ? ' · ' + s.city : ''}</span>`);
    _markers.addLayer(m); pts.push([s.lat, s.lon]);
  });
  if (pts.length) _map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
}

// Directory header auth area: customer log in / sign up, or account + bookings.
async function renderDirAuth() {
  const box = $('#dir-auth');
  if (!box) return;
  box.innerHTML = '';
  let user = null, prof = null;
  if (API.enabled) { try { user = await API.auth.currentUser(); if (user) prof = await API.auth.profile(); } catch { /* offline */ } }
  if (user) {
    box.append(
      el('button', { class: 'btn ghost sm', onclick: () => openCustomerProfile() }, '👤 My account'),
      el('span', { class: 'who' }, prof?.full_name || user.email),
      el('button', { class: 'btn ghost sm', onclick: async () => { await API.auth.signOut(); location.reload(); } }, 'Sign out'),
    );
  } else {
    box.append(
      el('button', { class: 'btn sm', onclick: () => openCustomerAuth(renderDirAuth) }, 'Log in / Sign up'),
      el('a', { class: 'btn ghost sm', href: '/app' }, 'For salon owners →'),
    );
  }
}

function openCustomerAuth(onDone) {
  let mode = 'login', role = 'customer';
  const f = {};
  const nameField = field('Your name', f.name = el('input', { autocomplete: 'name' }));
  const submitBtn = el('button', { class: 'btn block', onclick: submit }, 'Log in');
  const tabLogin = el('button', { class: 'on' }, 'Log in');
  const tabSignup = el('button', {}, 'Sign up');
  // role chooser (signup only): customer vs employee
  const roleCust = el('button', { class: 'on' }, "I'm a customer");
  const roleEmp = el('button', {}, "I'm an employee");
  const roleRow = field('I want to', el('div', { class: 'tabs' }, roleCust, roleEmp));
  const blurb = el('p', { class: 'muted', style: 'margin-top:0;font-size:14px' }, 'Create a free account to book and manage your appointments at any salon.');
  const wrap = el('div', {}, blurb, el('div', { class: 'tabs' }, tabLogin, tabSignup), roleRow, nameField,
    field('Email', f.email = el('input', { type: 'email', autocomplete: 'email' })),
    field('Password', f.pass = el('input', { type: 'password' })), submitBtn);
  const setRole = (r) => { role = r; roleCust.classList.toggle('on', r === 'customer'); roleEmp.classList.toggle('on', r === 'staff');
    blurb.textContent = r === 'staff' ? 'Create your employee account, then ask your salon admin to add you by your email.' : 'Create a free account to book and manage your appointments at any salon.'; };
  roleCust.onclick = () => setRole('customer'); roleEmp.onclick = () => setRole('staff');
  const setMode = (m) => {
    mode = m;
    tabLogin.classList.toggle('on', m === 'login'); tabSignup.classList.toggle('on', m === 'signup');
    roleRow.classList.toggle('hidden', m === 'login');
    nameField.classList.toggle('hidden', m === 'login');
    submitBtn.textContent = m === 'login' ? 'Log in' : 'Create account';
  };
  tabLogin.onclick = () => setMode('login'); tabSignup.onclick = () => setMode('signup');
  setRole('customer'); setMode('login');
  const close = modal('Your account', wrap);
  async function submit() {
    const email = f.email.value.trim(), password = f.pass.value;
    if (!email || !password) return toast('Enter email and password', true);
    try {
      if (mode === 'signup') {
        const res = await API.auth.signUp({ email, password, fullName: f.name.value.trim(), role });
        if (!res?.session) { showEmailConfirmNotice(wrap, email); toast('Check your email to confirm.'); return; }
        close();
        if (role === 'staff') { location.href = '/app'; return; }   // employee → their profile
      } else {
        await API.auth.signIn({ email, password });
        toast('Welcome back!');
        close();
      }
      // a logged-in employee/owner/admin shouldn't stay on the directory account UI
      const prof = await API.auth.profile();
      if (prof && prof.role !== 'customer') { location.href = '/app'; return; }
      if (onDone) onDone();
    } catch (e) {
      if (/confirm/i.test(e?.message || '')) { showEmailConfirmNotice(wrap, email, { prefix: 'Please confirm your email first.' }); return; }
      errToast(e);
    }
  }
}

// ---- Customer profile (account) — tabs: bookings, favorites, reviews, info -
async function openCustomerProfile() {
  const tabsBar = el('div', { class: 'tabs' });
  const content = el('div', { style: 'margin-top:8px' });
  const wrap = el('div', {}, tabsBar, content);
  const close = modal('My account', wrap, { wide: true });
  const tabs = { Bookings: tabBookings, Favorites: tabFavorites, Reviews: tabReviews, Info: tabInfo };
  const btns = {};
  Object.keys(tabs).forEach((name) => {
    const b = el('button', { class: name === 'Bookings' ? 'on' : '', onclick: () => select(name) }, name);
    btns[name] = b; tabsBar.append(b);
  });
  function select(name) { Object.entries(btns).forEach(([n, b]) => b.classList.toggle('on', n === name)); content.innerHTML = '<p class="muted">Loading…</p>'; tabs[name](); }

  async function tabBookings() {
    let list = [], rated = {};
    try { [list, rated] = await Promise.all([API.customer.myBookings(), API.customer.reviewsByAppointment()]); }
    catch (e) { content.innerHTML = ''; return content.append(el('div', { class: 'banner' }, e.message)); }
    content.innerHTML = '';
    if (!list.length) return content.append(el('div', { class: 'empty' }, 'No bookings yet. Browse salons and book your first appointment!'));
    list.forEach((b) => {
      const past = new Date(b.starts_at) < new Date();
      const upcoming = !past && b.status !== 'cancelled';
      const actions = el('div', { style: 'display:flex;gap:6px;align-items:center' });
      if (upcoming && b.status === 'booked') actions.append(el('button', { class: 'btn sm', onclick: async () => { try { await API.customer.confirm(b.id); select('Bookings'); toast('Confirmed — see you there!'); } catch (e) { errToast(e); } } }, 'Confirm'));
      if (upcoming) actions.append(el('button', { class: 'btn danger sm', onclick: async () => { if (!confirm('Cancel this booking?')) return; try { await API.customer.cancel(b.id); select('Bookings'); toast('Cancelled'); } catch (e) { errToast(e); } } }, 'Cancel'));
      else if (b.status !== 'cancelled') {
        actions.append(rated[b.id]
          ? el('span', { class: 'stars' }, '★'.repeat(rated[b.id]) + '☆'.repeat(5 - rated[b.id]))
          : el('button', { class: 'btn sm', onclick: () => openRate(b, () => select('Bookings')) }, 'Rate'));
      }
      content.append(el('div', { class: 'choice', style: 'cursor:default' },
        el('div', {}, el('strong', {}, b.service_name || 'Appointment'),
          el('div', { class: 'muted', style: 'font-size:13px;margin:2px 0 6px' },
            `${b.salon_name} · ${new Date(b.starts_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${b.staff_name ? ' · ' + b.staff_name : ''}`),
          statusPill(b.status)),
        actions));
    });
  }
  async function tabFavorites() {
    let favs = [];
    try { favs = await API.customer.favorites(); } catch (e) { content.innerHTML = ''; return content.append(el('div', { class: 'banner' }, e.message)); }
    content.innerHTML = '';
    if (!favs.length) return content.append(el('div', { class: 'empty' }, 'No favorites yet. Tap the ♥ on a salon to save it.'));
    favs.map((r) => r.salon).filter(Boolean).forEach((s) => content.append(el('div', { class: 'choice' },
      el('a', { href: `/${s.slug}`, style: 'text-decoration:none;color:inherit' }, el('strong', {}, s.name),
        el('div', { class: 'muted', style: 'font-size:13px' }, [TYPE_LABELS[s.business_type], s.city].filter(Boolean).join(' · '))),
      el('button', { class: 'btn ghost sm', onclick: async () => { try { await API.customer.removeFavorite(s.id); select('Favorites'); } catch (e) { errToast(e); } } }, 'Remove'))));
  }
  async function tabReviews() {
    let revs = [];
    try { revs = await API.customer.myReviews(); } catch (e) { content.innerHTML = ''; return content.append(el('div', { class: 'banner' }, e.message)); }
    content.innerHTML = '';
    if (!revs.length) return content.append(el('div', { class: 'empty' }, 'You haven\'t reviewed any appointments yet.'));
    revs.forEach((r) => content.append(el('div', { class: 'choice', style: 'cursor:default' },
      el('div', {}, el('span', { class: 'stars' }, '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating)),
        el('div', { style: 'font-weight:600;margin-top:4px' }, r.salon?.name || ''),
        r.comment ? el('div', { class: 'muted', style: 'font-size:13px' }, r.comment) : ''))));
  }
  async function tabInfo() {
    let prof = null, user = null;
    try { [prof, user] = await Promise.all([API.auth.profile(), API.auth.currentUser()]); } catch (e) { return errToast(e); }
    content.innerHTML = ''; const f = {};
    content.append(
      field('Name', f.name = el('input', { value: prof?.full_name || '' })),
      field('Phone', f.phone = el('input', { value: prof?.phone || '' })),
      el('div', { class: 'muted', style: 'font-size:13px;margin-bottom:12px' }, `Email: ${user?.email || ''}`),
      el('button', { class: 'btn', onclick: async () => { try { await API.auth.updateProfile({ full_name: f.name.value.trim() || null, phone: f.phone.value.trim() || null }); toast('Saved'); renderDirAuth(); } catch (e) { errToast(e); } } }, 'Save changes'));
  }
  select('Bookings');
}

// Star-rating dialog for a past appointment.
function openRate(booking, onDone) {
  let rating = 5;
  const stars = el('div', { class: 'star-input' });
  const draw = () => [...stars.children].forEach((sp, i) => sp.classList.toggle('on', i < rating));
  for (let i = 1; i <= 5; i++) { const sp = el('span', { onclick: () => { rating = i; draw(); } }, '★'); stars.append(sp); }
  draw();
  const comment = el('textarea', { rows: 3, placeholder: 'Optional: how was it?' });
  const wrap = el('div', {},
    el('p', { style: 'margin-top:0' }, el('strong', {}, booking.service_name || 'Appointment'), el('span', { class: 'muted' }, ` · ${booking.salon_name}`)),
    field('Your rating', stars), field('Comment', comment),
    el('button', { class: 'btn block', onclick: save }, 'Submit review'));
  const close = modal('Rate your visit', wrap);
  async function save() {
    try { await API.customer.review({ appointmentId: booking.id, salonId: booking.salon_id, rating, comment: comment.value.trim() }); }
    catch (e) { return errToast(e); }
    close(); toast('Thanks for the review!'); if (onDone) onDone();
  }
}

async function openMyBookings() {
  const wrap = el('div', {}, el('p', { class: 'muted' }, 'Loading…'));
  const close = modal('My bookings', wrap, { wide: true });
  let list = [];
  try { list = await API.customer.myBookings(); }
  catch (e) { wrap.innerHTML = ''; wrap.append(el('div', { class: 'banner' }, e.message)); return; }
  wrap.innerHTML = '';
  if (!list.length) { wrap.append(el('div', { class: 'empty' }, 'No bookings yet. Browse salons and book your first appointment!')); return; }
  list.forEach((b) => {
    const upcoming = new Date(b.starts_at) > new Date() && b.status !== 'cancelled';
    wrap.append(el('div', { class: 'choice', style: 'cursor:default' },
      el('div', {},
        el('strong', {}, b.service_name || 'Appointment'),
        el('div', { class: 'muted', style: 'font-size:13px;margin:2px 0 6px' },
          `${b.salon_name} · ${new Date(b.starts_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${b.staff_name ? ' · ' + b.staff_name : ''}`),
        statusPill(b.status)),
      upcoming
        ? el('button', { class: 'btn danger sm', onclick: async () => {
            if (!confirm('Cancel this booking?')) return;
            try { await API.customer.cancel(b.id); close(); openMyBookings(); toast('Booking cancelled'); } catch (e) { errToast(e); }
          } }, 'Cancel')
        : el('span', {}),
    ));
  });
}

function salonCard(s) {
  const unclaimed = !s.is_published && s.claimed === false;
  const badge = unclaimed
    ? el('span', { class: 'type-pill', style: 'background:#FFF4E0;color:#8a5a00' }, 'Unclaimed')
    : (s.is_published ? el('span', { class: 'type-pill', style: 'background:#E2F6F2;color:var(--mint)' }, 'Book online') : '');
  return el('a', { class: 'salon-card', href: `/${s.slug}` },
    el('div', { class: 'cover', style: s.cover_url ? `background-image:url('${s.cover_url}')` : '' }),
    el('div', { class: 'body' },
      el('h3', {}, s.name),
      el('div', { class: 'meta' }, [s.city, s.address].filter(Boolean).join(' · ') || ''),
      el('div', { style: 'margin-top:10px;display:flex;gap:6px;flex-wrap:wrap' },
        el('span', { class: 'type-pill' }, TYPE_LABELS[s.business_type] || 'Salon'), badge),
    ));
}

// Normalize a stored social value (handle or URL) into a full link.
function socialUrl(kind, v) {
  if (!v) return null;
  v = String(v).trim();
  if (/^https?:\/\//i.test(v)) return v;
  const h = v.replace(/^@/, '');
  if (kind === 'instagram') return `https://instagram.com/${h}`;
  if (kind === 'tiktok') return `https://tiktok.com/@${h}`;
  if (kind === 'facebook') return `https://facebook.com/${h}`;
  return `https://${v}`;
}
function socialLinks(salon) {
  const defs = [['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['facebook', 'Facebook'], ['website', 'Website']];
  const links = defs
    .map(([k, label]) => { const u = socialUrl(k, salon[k]); return u ? el('a', { href: u, target: '_blank', rel: 'noopener', style: 'color:#fff;text-decoration:underline;font-size:13px;opacity:.95' }, label) : null; })
    .filter(Boolean);
  if (!links.length) return document.createTextNode('');
  const row = el('div', { style: 'margin-top:12px;display:flex;gap:14px;flex-wrap:wrap' });
  links.forEach((a) => row.append(a));
  return row;
}

// Warn a logged-in customer when a just-booked appointment is back-to-back
// (within 30 min) of another of their bookings — leave travel time.
async function warnIfBackToBack(startISO, durMin) {
  try {
    const u = await API.auth.currentUser(); if (!u) return;
    const list = await API.customer.myBookings();
    const newStart = new Date(startISO).getTime();
    const newEnd = newStart + (durMin || 0) * 60000;
    const GAP = 30 * 60000;
    const adj = list.find((b) => {
      if (b.status === 'cancelled') return false;
      const s = new Date(b.starts_at).getTime(), e = new Date(b.ends_at).getTime();
      if (Math.abs(s - newStart) < 60000) return false;   // the booking we just made
      const gap = Math.max(s - newEnd, newStart - e);      // ≥0 means no overlap
      return gap >= 0 && gap <= GAP;
    });
    if (adj) toast('Heads up: this is back-to-back with another of your bookings — leave travel time.');
  } catch { /* non-blocking */ }
}

// ===========================================================================
// PUBLIC STOREFRONT
// ===========================================================================
async function startStorefront(sl) {
  show('#screen-store');
  const root = $('#store-body');
  if (!API.enabled) { root.append(el('div', { class: 'banner' }, 'This booking page is not connected to a backend yet.')); return; }
  let salon;
  try { salon = await API.storefront.salon(sl); } catch (e) { return errToast(e); }
  if (!salon) { root.append(el('div', { class: 'card empty' }, 'Booking page not found or not published.')); return; }

  const sf = { salon, service: null, staff: null, date: todayISO(), slot: null };
  const hero = el('div', { class: 'store-hero' },
    el('h1', {}, salon.name),
    salon.about ? el('p', { style: 'opacity:.92;margin:8px 0 0' }, salon.about) : '',
    el('p', { style: 'opacity:.85;margin:10px 0 0;font-size:14px' }, [salon.address, salon.phone, salon.email].filter(Boolean).join(' · ')),
    socialLinks(salon));
  root.append(hero);

  // Unclaimed seed listing — no online booking set up yet. Offer to claim it.
  if (!salon.is_published) {
    root.append(el('div', { class: 'card', style: 'margin-top:18px;text-align:center' },
      el('h3', { style: 'margin-bottom:8px' }, 'Not bookable online yet'),
      el('p', { class: 'muted' }, 'This salon is listed in our directory but hasn\'t set up online booking.'),
      el('button', { class: 'btn', style: 'margin-top:8px', onclick: () => { sessionStorage.setItem('claim_slug', sl); location.href = '/app'; } },
        'Is this your business? Claim this page'),
      el('p', { class: 'muted', style: 'font-size:13px;margin-top:14px' },
        salon.phone ? `In the meantime, you can call ${salon.phone}.` : 'Browse other salons in the meantime.')));
    return;
  }

  // Rating + favorite (♥) for published salons.
  const meta = el('div', { style: 'margin-top:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap' });
  hero.append(meta);
  API.storefront.rating(salon.id).then((r) => { if (r && r.review_count > 0) meta.append(el('span', { class: 'stars', style: 'color:#FFD27A;font-weight:700' }, `★ ${r.avg_rating} (${r.review_count})`)); }).catch(() => {});
  (async () => {
    let user = null; try { user = await API.auth.currentUser(); } catch { /* */ }
    if (!user) return;
    let faved = false; try { faved = (await API.customer.favoriteIds()).includes(salon.id); } catch { /* */ }
    const btn = el('button', { class: 'btn sm', style: 'background:rgba(255,255,255,.18);color:#fff' });
    const paint = () => { btn.textContent = faved ? '♥ Saved' : '♡ Save'; };
    paint();
    btn.onclick = async () => { try { faved ? await API.customer.removeFavorite(salon.id) : await API.customer.addFavorite(salon.id); faved = !faved; paint(); toast(faved ? 'Added to favorites' : 'Removed from favorites'); } catch (e) { errToast(e); } };
    meta.append(btn);
  })();

  // Portfolio gallery (recent work) — host sits above the booking flow.
  const galleryHost = el('div'); root.append(galleryHost);
  API.storefront.portfolio(salon.id).then((photos) => {
    if (!photos.length) return;
    const gal = el('div', { class: 'store-gallery' });
    photos.forEach((p) => gal.append(el('div', { class: 'pf-tile' }, el('img', { src: p.url, alt: p.caption || '' }), p.caption ? el('div', { class: 'pf-cap' }, p.caption) : '')));
    galleryHost.append(el('div', { class: 'step' }, el('h3', {}, 'Recent work'), gal));
  }).catch(() => {});

  const flow = el('div'); root.append(flow);

  let services = [];
  try { services = await API.storefront.services(salon.id); } catch (e) { errToast(e); }

  function bar(step) {
    return el('div', { class: 'stepbar' }, [0, 1, 2, 3].map((i) => el('div', { class: 's' + (i <= step ? ' on' : '') })));
  }

  function renderServices() {
    flow.innerHTML = '';
    flow.append(bar(0), el('div', { class: 'step' }, el('h3', {}, 'Choose a service')));
    if (!services.length) { flow.append(el('div', { class: 'card empty' }, 'No services available to book right now.')); return; }
    services.forEach((s) => flow.append(el('div', { class: 'choice', onclick: () => { sf.service = s; renderStaff(); } },
      el('div', {}, el('strong', {}, s.name), s.description ? el('div', { class: 'muted', style: 'font-size:13px' }, s.description) : ''),
      el('div', { style: 'text-align:right' }, el('div', {}, money(s.price, salon.currency)), el('div', { class: 'muted', style: 'font-size:13px' }, `${s.duration_min} min`)))));
  }

  async function renderStaff() {
    flow.innerHTML = '';
    flow.append(bar(1), el('div', { class: 'step' },
      el('button', { class: 'btn ghost sm', onclick: renderServices }, '‹ Back'),
      el('h3', { style: 'margin-top:10px' }, `Choose your ${salon.business_type === 'barber' ? 'barber' : 'specialist'}`)));
    let people = [];
    try { people = await API.storefront.staffForService(sf.service.id); } catch (e) { errToast(e); }
    flow.append(el('div', { class: 'choice', onclick: () => { sf.staff = null; renderSlots(); } },
      el('div', {}, el('strong', {}, 'Any available'), el('div', { class: 'muted', style: 'font-size:13px' }, 'First free slot with any team member'))));
    people.forEach((p) => flow.append(el('div', { class: 'choice', onclick: () => { sf.staff = p; renderSlots(); } },
      el('div', {}, el('strong', {}, p.name), p.title ? el('div', { class: 'muted', style: 'font-size:13px' }, p.title) : ''))));
    if (!people.length) flow.append(el('div', { class: 'banner' }, 'No one is set up to perform this service online yet.'));
  }

  async function renderSlots() {
    flow.innerHTML = '';
    const dateIn = el('input', { type: 'date', value: sf.date, min: todayISO(), style: 'max-width:200px' });
    dateIn.onchange = () => { sf.date = dateIn.value; loadSlots(); };
    flow.append(bar(2), el('div', { class: 'step' },
      el('button', { class: 'btn ghost sm', onclick: renderStaff }, '‹ Back'),
      el('h3', { style: 'margin-top:10px' }, 'Pick a time'),
      el('div', { class: 'muted', style: 'font-size:13px;margin-bottom:10px' }, `${sf.service.name}${sf.staff ? ' with ' + sf.staff.name : ''} · ${sf.service.duration_min} min`),
      dateIn));
    const slotBox = el('div', { style: 'margin-top:14px' }); flow.append(slotBox);
    async function loadSlots() {
      slotBox.innerHTML = '<p class="muted">Loading times…</p>';
      let slots = [];
      try { slots = await API.storefront.slots({ slug: sl, serviceId: sf.service.id, date: sf.date, staffId: sf.staff?.id || null }); }
      catch (e) { slotBox.innerHTML = ''; return errToast(e); }
      slotBox.innerHTML = '';
      if (!slots.length) { slotBox.append(el('div', { class: 'card empty' }, 'No times available on this day. Try another date.')); return; }
      // de-dupe identical start times (across staff) when "any" is chosen
      const seen = new Set();
      const grid = el('div', { class: 'slot-grid' });
      slots.forEach((s) => {
        if (seen.has(s.slot_start)) return; seen.add(s.slot_start);
        grid.append(el('div', { class: 'slot', onclick: () => { sf.slot = s; renderDetails(); } }, fmtTime(s.slot_start, salon.timezone)));
      });
      slotBox.append(grid);
    }
    loadSlots();
  }

  function renderDetails() {
    flow.innerHTML = '';
    const f = {};
    flow.append(bar(3), el('div', { class: 'step' },
      el('button', { class: 'btn ghost sm', onclick: renderSlots }, '‹ Back'),
      el('h3', { style: 'margin-top:10px' }, 'Your details'),
      el('div', { class: 'card', style: 'margin-bottom:14px;background:var(--paper-dim)' },
        el('strong', {}, sf.service.name), el('br'),
        `${fmtDate(sf.slot.slot_start, salon.timezone)} at ${fmtTime(sf.slot.slot_start, salon.timezone)}`,
        sf.staff ? ` · ${sf.staff.name}` : '', el('br'), money(sf.service.price, salon.currency)),
      field('Name', f.name = el('input', { autocomplete: 'name' })),
      field('Email', f.email = el('input', { type: 'email', autocomplete: 'email' })),
      field('Phone', f.phone = el('input', { autocomplete: 'tel' })),
      field('Notes (optional)', f.notes = el('textarea', { rows: 2 })),
      el('button', { class: 'btn block', onclick: confirmBooking }, 'Confirm booking')));
    // Prefill for a logged-in customer so they don't retype their details.
    if (API.enabled) (async () => {
      try {
        const u = await API.auth.currentUser(); if (!u) return;
        const p = await API.auth.profile();
        if (!f.name.value) f.name.value = p?.full_name || '';
        if (!f.email.value) f.email.value = u.email || '';
      } catch { /* ignore */ }
    })();
    async function confirmBooking() {
      if (!f.name.value.trim()) return toast('Please enter your name', true);
      try {
        await API.storefront.book({
          slug: sl, serviceId: sf.service.id, staffId: sf.staff?.id || sf.slot.staff_id,
          start: sf.slot.slot_start, name: f.name.value.trim(), email: f.email.value.trim(),
          phone: f.phone.value.trim(), notes: f.notes.value.trim(),
        });
        await warnIfBackToBack(sf.slot.slot_start, sf.service.duration_min);
        renderDone();
      } catch (e) { errToast(e); }
    }
  }

  function renderDone() {
    flow.innerHTML = '';
    flow.append(el('div', { class: 'card', style: 'text-align:center;padding:40px' },
      el('div', { style: 'font-size:48px' }, '✓'),
      el('h2', { style: 'margin:10px 0' }, 'You\'re booked!'),
      el('p', { class: 'muted' }, `${fmtDate(sf.slot.slot_start, salon.timezone)} at ${fmtTime(sf.slot.slot_start, salon.timezone)} for ${sf.service.name}.`),
      el('button', { class: 'btn', style: 'margin-top:10px', onclick: () => { sf.service = sf.staff = sf.slot = null; renderServices(); } }, 'Book another')));
  }

  renderServices();
}

// go
boot();
