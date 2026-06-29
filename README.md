# Glowup Book

Booking CRM **and** online storefront for salons, barbers, hairdressers and nail studios.
Live at **glowupbook.com**.

One app, two faces:

- **Staff dashboard** (login required) — appointment calendar, customer records, services, staff & working hours, manual bookings.
- **Public storefront** (`/book/<salon-slug>`) — clients browse services, see real availability and book online. No login needed to book.

## Stack

Same stack as GigCute: a **static HTML/CSS/JS single-page app** in `public/`, talking directly to **Supabase** (Postgres + Auth) from the browser, deployed to **Vercel** from **GitHub**. No build step.

Security boundary is **Row Level Security** — the browser only holds the anon (publishable) key, and every table has explicit RLS policies. Online booking goes through `SECURITY DEFINER` RPCs so anonymous visitors can book without ever reading other customers' data.

## Run locally

```bash
npm install
npm run dev          # serves public/ at http://localhost:3000
```

## Connect Supabase

1. Create a project at https://supabase.com.
2. Run the SQL in `supabase/migrations/` **in order** (SQL Editor, or `supabase db push`).
3. Copy your Project URL + anon key into `public/config.js` (template in `config.example.js`).

## Data model (high level)

`salons` → `staff`, `services`, `customers`, `appointments`. `working_hours` + `time_off`
drive availability. Multi-tenant: each salon's data is isolated by RLS, so one
deployment can serve many businesses.

## Roadmap

- [x] Phase 1 — Schema + RLS + auth + scaffolding
- [ ] Phase 2 — Dashboard CRUD (services, staff, hours, customers)
- [ ] Phase 3 — Appointment calendar + manual booking
- [ ] Phase 4 — Public booking storefront + availability engine
- [ ] Phase 5 — Email confirmations & reminders
- [ ] Phase 6 — Online payments / deposits (Stripe)
