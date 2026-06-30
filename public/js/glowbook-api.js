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
  // role: 'owner' (salon owner, signs up at /app) | 'customer' (signs up on the
  // public directory). Employees are NOT created via signup.
  async signUp({ email, password, fullName, role = 'owner' }) {
    return unwrap(await client().auth.signUp({
      email, password,
      options: { data: { full_name: fullName || '', role } },
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
  // Re-send the signup confirmation email.
  async resendConfirmation(email) {
    const { error } = await client().auth.resend({ type: 'signup', email });
    if (error) throw error;
  },
  async currentUser() {
    if (!supabase) return null;
    const { data } = await supabase.auth.getUser();
    return data?.user || null;
  },
  // The profiles row for the current user (role, full_name, ...), or null.
  async profile() {
    if (!supabase) return null;
    const u = await this.currentUser();
    if (!u) return null;
    const data = unwrap(await client().from('profiles').select('*').eq('id', u.id).limit(1));
    return (data || [])[0] || null;
  },
  async updateProfile(patch) {
    const u = await this.currentUser();
    return unwrap(await client().from('profiles').update(patch).eq('id', u.id).select().single());
  },
  onChange(cb) {
    if (!supabase) return () => {};
    const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(session?.user || null));
    return () => data?.subscription?.unsubscribe?.();
  },
};

// ---- Salons ---------------------------------------------------------------
const salons = {
  // The salon(s) the current user owns/belongs to. Uses an RPC so the 10k public
  // seed salons don't leak in. Falls back to a filtered query pre-migration.
  async mine() {
    let { data, error } = await client().rpc('my_salons');
    if (error) {
      const u = await auth.currentUser();
      ({ data, error } = await client().from('salons').select('*').eq('owner_id', u?.id).order('created_at'));
    }
    if (error) throw error;
    return data || [];
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
  // Claim an unclaimed seed listing (caller becomes the owner).
  async claim(salonId) {
    return unwrap(await client().rpc('claim_salon', { p_salon: salonId }));
  },
  async remove(id) {
    const { error } = await client().from('salons').delete().eq('id', id);
    if (error) throw error;
  },
};

// ---- Platform super-admin -------------------------------------------------
const admin = {
  async overview() {
    return unwrap(await client().rpc('admin_overview')) || {};
  },
  // Admin RLS lets this return ALL salons (not just the admin's own).
  async salons({ search, limit = 100 } = {}) {
    let q = client().from('salons')
      .select('id,name,slug,business_type,city,claimed,is_published,owner_id,created_at')
      .order('created_at', { ascending: false }).limit(limit);
    if (search) q = q.or(`name.ilike.*${search}*,city.ilike.*${search}*,slug.ilike.*${search}*`);
    return unwrap(await q) || [];
  },
  async setPublished(id, value) {
    return unwrap(await client().from('salons').update({ is_published: value }).eq('id', id).select().single());
  },
  async remove(id) {
    const { error } = await client().from('salons').delete().eq('id', id);
    if (error) throw error;
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
  // Link a self-registered employee account (by email) to this salon.
  async linkEmployee(salonId, email, name) {
    const { error } = await client().rpc('link_employee', { p_salon: salonId, p_email: email, p_name: name || null });
    if (error) throw error;
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
    if (search) q = q.or(`name.ilike.*${search}*,email.ilike.*${search}*,phone.ilike.*${search}*`);
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
  // Flag an appointment as awaiting customer confirmation; returns the row
  // (incl. confirm_token) so the dashboard can build an email/SMS confirm link.
  async requestConfirmation(id) {
    return unwrap(await client().from('appointments')
      .update({ confirmation_requested_at: new Date().toISOString() }).eq('id', id).select().single());
  },
  async remove(id) {
    const { error } = await client().from('appointments').delete().eq('id', id);
    if (error) throw error;
  },
};

// ---- Public storefront (anonymous) ---------------------------------------
const storefront = {
  // Public directory. RLS already limits anonymous reads to published + unclaimed
  // salons, so we don't filter on claimed here (which also lets us use a single
  // .or() for search without two .or() clauses colliding). Published (bookable)
  // salons sort first; capped since the directory can hold thousands.
  async directory({ search, type } = {}) {
    // Degrade gracefully if a migration hasn't run yet: level 2 = +lat/lon,
    // level 1 = +claimed, level 0 = base columns only.
    const build = (level) => {
      const cols = 'id,name,slug,business_type,about,city,address,logo_url,cover_url,is_published'
        + (level >= 1 ? ',claimed' : '') + (level >= 2 ? ',lat,lon' : '');
      let q = client().from('salons').select(cols)
        .order('is_published', { ascending: false }).order('name').limit(60);
      if (type) q = q.eq('business_type', type);
      if (search) q = q.or(`name.ilike.*${search}*,city.ilike.*${search}*`);
      return q;
    };
    let { data, error } = await build(2);
    if (error && /(lat|lon)/i.test(error.message || '')) ({ data, error } = await build(1));
    if (error && /claimed/i.test(error.message || '')) ({ data, error } = await build(0));
    if (error) throw error;
    return data || [];
  },
  // Public salon by slug — published salons AND unclaimed listings (so the
  // storefront can show a "claim this page" view for unclaimed ones).
  async salon(slug) {
    let { data, error } = await client().from('salons').select('*')
      .eq('slug', slug).or('is_published.eq.true,claimed.eq.false').limit(1);
    if (error && /claimed/i.test(error.message || '')) {
      ({ data, error } = await client().from('salons').select('*').eq('slug', slug).eq('is_published', true).limit(1));
    }
    if (error) throw error;
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
  async rating(salonId) {
    const data = unwrap(await client().rpc('salon_rating', { p_salon: salonId }));
    return (data || [])[0] || { avg_rating: null, review_count: 0 };
  },
  // Confirm an appointment via its emailed/texted token (no login needed).
  async confirm(token) {
    const data = unwrap(await client().rpc('confirm_appointment', { p_token: token }));
    return (data || [])[0] || null;
  },
  // Public portfolio photos for a salon (for the storefront gallery).
  async portfolio(salonId, limit = 12) {
    const rows = unwrap(await client().from('portfolio').select('id,path,caption')
      .eq('salon_id', salonId).eq('is_public', true).order('created_at', { ascending: false }).limit(limit)) || [];
    return rows.map((r) => ({ ...r, url: client().storage.from('portfolio').getPublicUrl(r.path).data.publicUrl }));
  },
};

// ---- Logged-in customer (their own bookings across all salons) ------------
const customer = {
  async myBookings() {
    return unwrap(await client().rpc('my_appointments')) || [];
  },
  async cancel(apptId) {
    const { error } = await client().rpc('cancel_my_appointment', { p_appt: apptId });
    if (error) throw error;
  },
  async confirm(apptId) {
    const { error } = await client().rpc('confirm_my_appointment', { p_appt: apptId });
    if (error) throw error;
  },
  // Favorites
  async favorites() {
    return unwrap(await client().from('favorites')
      .select('salon:salons(id,name,slug,business_type,city,address)')
      .order('created_at', { ascending: false })) || [];
  },
  async favoriteIds() {
    const data = unwrap(await client().from('favorites').select('salon_id')) || [];
    return data.map((r) => r.salon_id);
  },
  async addFavorite(salonId) {
    const u = await auth.currentUser();
    const { error } = await client().from('favorites').insert({ account_id: u.id, salon_id: salonId });
    if (error && error.code !== '23505') throw error;   // ignore duplicate
  },
  async removeFavorite(salonId) {
    const { error } = await client().from('favorites').delete().eq('salon_id', salonId);
    if (error) throw error;
  },
  // Reviews
  async myReviews() {
    return unwrap(await client().from('reviews')
      .select('*, salon:salons(name,slug)').order('created_at', { ascending: false })) || [];
  },
  async review({ appointmentId, salonId, rating, comment }) {
    const u = await auth.currentUser();
    return unwrap(await client().from('reviews')
      .upsert({ account_id: u.id, appointment_id: appointmentId, salon_id: salonId, rating, comment: comment || null },
        { onConflict: 'appointment_id' }).select().single());
  },
  async reviewsByAppointment() {
    const data = unwrap(await client().from('reviews').select('appointment_id,rating')) || [];
    const map = {}; data.forEach((r) => { if (r.appointment_id) map[r.appointment_id] = r.rating; });
    return map;
  },
};

// ---- Logged-in employee ---------------------------------------------------
const employee = {
  async myAppointments() {
    return unwrap(await client().rpc('my_staff_appointments')) || [];
  },
  photoUrl(path) {
    return client().storage.from('portfolio').getPublicUrl(path).data.publicUrl;
  },
  async myPortfolio() {
    const u = await auth.currentUser();
    const rows = unwrap(await client().from('portfolio').select('*').eq('profile_id', u.id).order('created_at', { ascending: false })) || [];
    return rows.map((r) => ({ ...r, url: this.photoUrl(r.path) }));
  },
  async uploadPhoto(file, { salonId = null, caption = null, appointmentId = null } = {}) {
    const u = await auth.currentUser();
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${u.id}/${new Date().getTime()}-${Math.round(Math.random() * 1e6)}.${ext}`;
    const up = await client().storage.from('portfolio').upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (up.error) throw up.error;
    return unwrap(await client().from('portfolio').insert({ profile_id: u.id, salon_id: salonId, caption, appointment_id: appointmentId, path }).select().single());
  },
  async removePhoto(row) {
    await client().storage.from('portfolio').remove([row.path]).catch(() => {});
    const { error } = await client().from('portfolio').delete().eq('id', row.id);
    if (error) throw error;
  },
};

window.GlowbookAPI = {
  enabled,
  raw: supabase,
  auth, salons, services, staff, hours, customers, appointments, storefront, customer, employee, admin,
};
