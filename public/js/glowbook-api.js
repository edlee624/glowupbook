// ============================================================================
// Glowbook API layer — thin wrapper over Supabase.
//
// Loaded as an ES module. Reads config from window.GLOWBOOK_CONFIG (config.js).
// Exposes window.GlowbookAPI for the app's inline script to call.
//
// The anon key is safe to ship to the browser: it is gated by the Row Level
// Security policies in supabase/migrations. The public booking flow goes through
// the get_available_slots / book_appointment RPCs. Never put the service_role
// key here.
// ============================================================================
const { createClient } = window.supabase || {};

const cfg = window.GLOWBOOK_CONFIG || {};
const enabled = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

const supabase = enabled ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

function client() {
  if (!supabase) {
    throw new Error('Glowbook backend not configured. Copy config.example.js to config.js and add your Supabase URL + anon key.');
  }
  return supabase;
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

// ---- Auth -----------------------------------------------------------------
const auth = {
  async signUp({ email, password, fullName }) {
    return unwrap(await client().auth.signUp({
      email, password,
      options: { data: { full_name: fullName || '', role: 'owner' } },
    }));
  },
  async signIn({ email, password }) {
    return unwrap(await client().auth.signInWithPassword({ email, password }));
  },
  async signInWithGoogle() {
    return unwrap(await client().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    }));
  },
  async signOut() {
    const { error } = await client().auth.signOut();
    if (error) throw error;
  },
  async sendPasswordReset(email) {
    const { error } = await client().auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) throw error;
  },
  async currentUser() {
    if (!supabase) return null;
    const { data } = await supabase.auth.getUser();
    return data?.user || null;
  },
  onChange(cb) {
    if (!supabase) return () => {};
    const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(session?.user || null));
    return () => data?.subscription?.unsubscribe?.();
  },
};

// ---- Salons ---------------------------------------------------------------
const salons = {
  // The salon(s) the current user owns/belongs to. Most owners have exactly one.
  async mine() {
    return unwrap(await client().from('salons').select('*').order('created_at')) || [];
  },
  async create({ name, slug, businessType, timezone, currency }) {
    const user = await auth.currentUser();
    const row = {
      owner_id: user.id,
      name,
      slug,
      business_type: businessType || null,
      timezone: timezone || 'UTC',
      currency: currency || 'USD',
    };
    const data = unwrap(await client().from('salons').insert(row).select().single());
    return data;
  },
  async update(id, patch) {
    return unwrap(await client().from('salons').update(patch).eq('id', id).select().single());
  },
  async slugAvailable(slug) {
    const data = unwrap(await client().from('salons').select('id').eq('slug', slug).limit(1));
    return (data || []).length === 0;
  },
};

// ---- Services -------------------------------------------------------------
const services = {
  async list(salonId) {
    return unwrap(await client().from('services').select('*').eq('salon_id', salonId).order('sort_order').order('name')) || [];
  },
  async create(salonId, s) {
    return unwrap(await client().from('services').insert({ salon_id: salonId, ...s }).select().single());
  },
  async update(id, patch) {
    return unwrap(await client().from('services').update(patch).eq('id', id).select().single());
  },
  async remove(id) {
    const { error } = await client().from('services').delete().eq('id', id);
    if (error) throw error;
  },
};

// ---- Staff ----------------------------------------------------------------
const staff = {
  async list(salonId) {
    return unwrap(await client().from('staff').select('*').eq('salon_id', salonId).order('sort_order').order('name')) || [];
  },
  async create(salonId, s) {
    return unwrap(await client().from('staff').insert({ salon_id: salonId, ...s }).select().single());
  },
  async update(id, patch) {
    return unwrap(await client().from('staff').update(patch).eq('id', id).select().single());
  },
  async remove(id) {
    const { error } = await client().from('staff').delete().eq('id', id);
    if (error) throw error;
  },
  // Which services a staff member can perform.
  async setServices(staffId, serviceIds) {
    const c = client();
    const { error: delErr } = await c.from('staff_services').delete().eq('staff_id', staffId);
    if (delErr) throw delErr;
    if (serviceIds.length) {
      const rows = serviceIds.map((service_id) => ({ staff_id: staffId, service_id }));
      const { error } = await c.from('staff_services').insert(rows);
      if (error) throw error;
    }
  },
  async getServiceIds(staffId) {
    const data = unwrap(await client().from('staff_services').select('service_id').eq('staff_id', staffId)) || [];
    return data.map((r) => r.service_id);
  },
};

// ---- Working hours --------------------------------------------------------
const hours = {
  async list(salonId) {
    return unwrap(await client().from('working_hours').select('*').eq('salon_id', salonId).order('dow').order('start_time')) || [];
  },
  // Replace a staff member's whole weekly schedule.
  async setForStaff(salonId, staffId, rows) {
    const c = client();
    const { error: delErr } = await c.from('working_hours').delete().eq('staff_id', staffId);
    if (delErr) throw delErr;
    if (rows.length) {
      const payload = rows.map((r) => ({ salon_id: salonId, staff_id: staffId, ...r }));
      const { error } = await c.from('working_hours').insert(payload);
      if (error) throw error;
    }
  },
};

// ---- Customers ------------------------------------------------------------
const customers = {
  async list(salonId, { search } = {}) {
    let q = client().from('customers').select('*').eq('salon_id', salonId).order('name');
    if (search) q = q.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
    return unwrap(await q) || [];
  },
  async create(salonId, c) {
    return unwrap(await client().from('customers').insert({ salon_id: salonId, ...c }).select().single());
  },
  async update(id, patch) {
    return unwrap(await client().from('customers').update(patch).eq('id', id).select().single());
  },
  async remove(id) {
    const { error } = await client().from('customers').delete().eq('id', id);
    if (error) throw error;
  },
};

// ---- Appointments (dashboard) --------------------------------------------
const appointments = {
  // Fetch appointments in [from, to) with joined names for display.
  async range(salonId, fromISO, toISO) {
    return unwrap(await client()
      .from('appointments')
      .select('*, customer:customers(name,email,phone), staff:staff(name,color), service:services(name,duration_min)')
      .eq('salon_id', salonId)
      .gte('starts_at', fromISO)
      .lt('starts_at', toISO)
      .order('starts_at')) || [];
  },
  async create(salonId, a) {
    return unwrap(await client().from('appointments').insert({ salon_id: salonId, ...a }).select().single());
  },
  async update(id, patch) {
    return unwrap(await client().from('appointments').update(patch).eq('id', id).select().single());
  },
  async setStatus(id, status) {
    return unwrap(await client().from('appointments').update({ status }).eq('id', id).select().single());
  },
  async remove(id) {
    const { error } = await client().from('appointments').delete().eq('id', id);
    if (error) throw error;
  },
};

// ---- Public storefront (anonymous) ---------------------------------------
const storefront = {
  // Public directory of published salons (RLS only returns is_published rows).
  async directory({ search, type } = {}) {
    let q = client().from('salons')
      .select('id,name,slug,business_type,about,city,address,logo_url,cover_url')
      .eq('is_published', true).order('name');
    if (type) q = q.eq('business_type', type);
    if (search) q = q.or(`name.ilike.%${search}%,city.ilike.%${search}%,about.ilike.%${search}%`);
    return unwrap(await q) || [];
  },
  // Public salon profile by slug (only returns rows for published salons via RLS).
  async salon(slug) {
    const data = unwrap(await client().from('salons').select('*').eq('slug', slug).eq('is_published', true).limit(1));
    return (data || [])[0] || null;
  },
  async services(salonId) {
    return unwrap(await client()
      .from('services')
      .select('*, category:service_categories(name,sort_order)')
      .eq('salon_id', salonId).eq('is_active', true).eq('bookable_online', true)
      .order('sort_order')) || [];
  },
  async staff(salonId) {
    return unwrap(await client().from('staff').select('id,name,title,photo_url,color')
      .eq('salon_id', salonId).eq('is_active', true).eq('accepts_online_booking', true)
      .order('sort_order')) || [];
  },
  async staffForService(serviceId) {
    const rows = unwrap(await client().from('staff_services')
      .select('staff:staff(id,name,title,photo_url,accepts_online_booking,is_active)')
      .eq('service_id', serviceId)) || [];
    return rows.map((r) => r.staff).filter((s) => s && s.is_active && s.accepts_online_booking);
  },
  async slots({ slug, serviceId, date, staffId = null, stepMin = 15 }) {
    return unwrap(await client().rpc('get_available_slots', {
      p_slug: slug, p_service: serviceId, p_date: date, p_staff: staffId, p_slot_step_min: stepMin,
    })) || [];
  },
  async book({ slug, serviceId, staffId, start, name, email, phone, notes }) {
    return unwrap(await client().rpc('book_appointment', {
      p_slug: slug, p_service: serviceId, p_staff: staffId, p_start: start,
      p_customer_name: name, p_customer_email: email, p_customer_phone: phone, p_notes: notes,
    }));
  },
};

window.GlowbookAPI = {
  enabled,
  raw: supabase,
  auth, salons, services, staff, hours, customers, appointments, storefront,
};
