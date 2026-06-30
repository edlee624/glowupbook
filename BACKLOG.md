# Glowup Book — Backlog

Ideas and deferred features, roughly in priority order. Not committed to dates.

## Directory / discovery
- [ ] **Map view when searching for salons** — show results on an interactive map (pins per salon, click to open). We already store `lat`/`lon` for seeded NYC salons, so the data's there. Likely Leaflet + OpenStreetMap tiles (free).
- [ ] Search by **service** (e.g. "balayage", "gel manicure") and by **neighborhood / distance radius**.
- [ ] Enrich seeded listings with **phone, hours, email, social** (website-fetch pipeline or Google Places API).

## Salon owner
- [ ] **Custom domain per salon** (e.g. `book.salonname.com`) — `custom_domain` column + hostname routing + Vercel domain add (manual, or automated via Vercel API + Edge Function).
- [ ] **Employee logins** — admin-provisioned accounts so staff can see their own schedule (needs a Supabase Edge Function to invite/create users, since the site is static).

## Platform
- [ ] **Super-admin console** — view/manage all salons platform-wide (suspend, impersonate, stats).
- [ ] **Online payments / deposits** at booking (Stripe).
- [ ] **Email/SMS confirmations & reminders** for appointments.

## Done (for reference)
- [x] Public salon directory at root with search + type filter
- [x] Customer accounts + "My bookings"
- [x] Unclaimed listings + "claim this page" flow
- [x] Email confirmation UX
- [x] NYC directory seed (~10,600 salons from NY Open Data)
