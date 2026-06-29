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
  'fonts', 'config', 'favicon', 'robots', 'sitemap', 'index', 'www', 'home',
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
  const sl = storefrontSlug();
  if (sl) return startStorefront(sl);
  const p = location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (APP_PATHS.has(p)) return startDashboardApp();
  startDirectory();   // root (and any other public path) → directory
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
    const mine = await API.salons.mine();
    if (!mine.length) { wireOnboarding(); show('#screen-onboarding'); return; }
    state.salon = mine[0];
    wireAppShell();
    show('#screen-app');
    navigate('calendar');
  } catch (e) { errToast(e); }
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
        await API.auth.signUp({ email, password, fullName: $('#au-name').value.trim() });
        toast('Account created! Check your email if confirmation is on.');
      } else {
        await API.auth.signIn({ email, password });
      }
    } catch (err) { errToast(err); }
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

// ---- CALENDAR (day view) --------------------------------------------------
PAGES.calendar = async (root) => {
  let day = new Date();
  const head = el('div', { class: 'page-head' });
  const grid = el('div', { class: 'day-grid' });
  root.append(head, grid);

  async function render() {
    head.innerHTML = '';
    const label = el('h1', {}, day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
    const controls = el('div', { class: 'cal-controls' },
      el('button', { class: 'btn ghost sm', onclick: () => { day.setDate(day.getDate() - 1); render(); } }, '‹'),
      el('button', { class: 'btn ghost sm', onclick: () => { day = new Date(); render(); } }, 'Today'),
      el('button', { class: 'btn ghost sm', onclick: () => { day.setDate(day.getDate() + 1); render(); } }, '›'),
      el('button', { class: 'btn', onclick: () => openApptModal(day, render) }, '+ New appointment'),
    );
    head.append(label, controls);

    const from = new Date(day); from.setHours(0, 0, 0, 0);
    const to = new Date(day); to.setHours(23, 59, 59, 999);
    let appts = [];
    try { appts = await API.appointments.range(state.salon.id, from.toISOString(), to.toISOString()); }
    catch (e) { errToast(e); }

    grid.innerHTML = '';
    for (let h = 7; h <= 20; h++) {
      const slotAppts = appts.filter((a) => new Date(a.starts_at).getHours() === h);
      grid.append(el('div', { class: 'hour-row' },
        el('div', { class: 'hour-label' }, `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`),
        el('div', {}, slotAppts.map((a) => apptChip(a, render))),
      ));
    }
    if (!appts.length) grid.append(el('div', { class: 'empty' }, 'No appointments this day.'));
  }
  render();
};

function apptChip(a, refresh) {
  return el('div', { class: 'appt' + (a.status === 'cancelled' ? ' cancelled' : ''), onclick: () => openApptModal(null, refresh, a) },
    el('div', { class: 'who' }, `${fmtTime(a.starts_at, state.salon.timezone)} · ${a.customer?.name || 'Walk-in'}`),
    el('div', {}, `${a.service?.name || ''}${a.staff ? ' — ' + a.staff.name : ''}`),
  );
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

  const actions = el('div', { class: 'row', style: 'margin-top:8px' });
  if (existing) actions.append(el('button', { class: 'btn danger', onclick: async () => {
    if (!confirm('Delete this appointment?')) return;
    try { await API.appointments.remove(existing.id); close(); refresh(); toast('Deleted'); } catch (e) { errToast(e); }
  } }, 'Delete'));
  actions.append(el('button', { class: 'btn', onclick: save }, existing ? 'Save changes' : 'Book appointment'));
  wrap.append(actions);
  const close = modal(existing ? 'Edit appointment' : 'New appointment', wrap);

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
    el('button', { class: 'btn', onclick: () => openStaffModal(() => navigate('staff')) }, '+ Add staff')));
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
    el('button', { class: 'btn', onclick: save }, 'Save settings'),
  );
  root.append(card);
  async function save() {
    try {
      state.salon = await API.salons.update(s.id, {
        name: f.name.value.trim(), about: f.about.value.trim() || null, phone: f.phone.value.trim() || null,
        email: f.email.value.trim() || null, address: f.address.value.trim() || null,
        timezone: f.tz.value.trim() || 'UTC', currency: f.cur.value.trim() || 'USD',
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
  const grid = $('#dir-grid'), q = $('#dir-q'), type = $('#dir-type');
  let t;
  async function load() {
    grid.innerHTML = '<p class="muted">Loading salons…</p>';
    if (!API.enabled) { grid.innerHTML = ''; grid.append(el('div', { class: 'banner' }, 'Directory not connected to a backend yet.')); return; }
    let salons = [];
    try { salons = await API.storefront.directory({ search: q.value.trim(), type: type.value }); }
    catch (e) { grid.innerHTML = ''; return errToast(e); }
    grid.innerHTML = '';
    if (!salons.length) {
      const msg = (q.value.trim() || type.value) ? 'No salons match your search.' : 'No salons are listed yet — be the first to add yours!';
      grid.append(el('div', { class: 'empty', style: 'grid-column:1/-1' }, msg));
      return;
    }
    salons.forEach((s) => grid.append(salonCard(s)));
  }
  q.oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  type.onchange = load;
  load();
}

function salonCard(s) {
  return el('a', { class: 'salon-card', href: `/${s.slug}` },
    el('div', { class: 'cover', style: s.cover_url ? `background-image:url('${s.cover_url}')` : '' }),
    el('div', { class: 'body' },
      el('h3', {}, s.name),
      el('div', { class: 'meta' }, [s.city, s.address].filter(Boolean).join(' · ') || 'Book online'),
      el('span', { class: 'type-pill' }, TYPE_LABELS[s.business_type] || 'Salon'),
    ));
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
    el('p', { style: 'opacity:.85;margin:10px 0 0;font-size:14px' }, [salon.address, salon.phone].filter(Boolean).join(' · ')));
  root.append(hero);
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
    async function confirmBooking() {
      if (!f.name.value.trim()) return toast('Please enter your name', true);
      try {
        await API.storefront.book({
          slug: sl, serviceId: sf.service.id, staffId: sf.staff?.id || sf.slot.staff_id,
          start: sf.slot.slot_start, name: f.name.value.trim(), email: f.email.value.trim(),
          phone: f.phone.value.trim(), notes: f.notes.value.trim(),
        });
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
