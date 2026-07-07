# Moving Glowup Book to a fresh Supabase project

Recreate the backend under a new Supabase account. The frontend (Vercel/GitHub)
stays put — only `public/config.js` changes to point at the new project.

## 1. Create the new project
On the **new Supabase account** → New project. Note the region. Wait for it to finish.

## 2. Install the schema
SQL Editor → paste **all of `supabase/all_migrations.sql`** → Run.
This creates every table, RLS policy, function, the `portfolio` storage bucket,
and its policies (migrations 0001–0011, fixed to run cleanly in one pass).

## 3. Re-seed the directory (optional but recommended)
Run these in SQL Editor (they only INSERT data):
- `data/seed/nyc-seed-part1-of-4.sql` … `part4-of-4.sql`  (10,618 salons)
- `data/seed/nyc-geo-part1-of-4.sql` … `part4-of-4.sql`   (their map coordinates)
- `data/test-salon.sql`  (demo salon — set the owner email first)

> Customer/owner **accounts and bookings do NOT migrate** (they live in Supabase
> auth). On a fresh project everyone re-signs-up. Fine pre-launch.

## 4. Auth settings
Authentication → **URL Configuration**: Site URL `https://glowupbook.com`,
Redirect URLs `https://glowupbook.com/**`. Turn on **Confirm email**.
(Optional) Authentication → **SMTP**: point at Resend (host `smtp.resend.com`,
port 465, user `resend`, pass = Resend API key).

## 5. Edge Functions (email)
Edge Functions → deploy **send-booking-email** and **send-reminders**
(paste from `supabase/functions/*/index.ts`), **Verify JWT = OFF**.
Set **Secrets**: `RESEND_API_KEY`, `EMAIL_FROM`, `SITE_URL`.
Then re-create:
- the booking trigger (SQL):
  ```sql
  create extension if not exists pg_net;
  create or replace function public.notify_booking_email()
  returns trigger language plpgsql security definer set search_path = public as $$
  begin
    perform net.http_post(
      url     := 'https://<NEW_REF>.supabase.co/functions/v1/send-booking-email',
      headers := jsonb_build_object('Content-Type','application/json'),
      body    := jsonb_build_object('record', to_jsonb(new)));
    return new;
  end; $$;
  drop trigger if exists booking_email_on_insert on public.appointments;
  create trigger booking_email_on_insert after insert on public.appointments
    for each row execute function public.notify_booking_email();
  ```
- the reminders cron:
  ```sql
  create extension if not exists pg_cron;
  select cron.schedule('glowup-reminders','0 * * * *', $$
    select net.http_post(url := 'https://<NEW_REF>.supabase.co/functions/v1/send-reminders',
      headers := jsonb_build_object('Content-Type','application/json')); $$);
  ```

## 6. Point the app at the new project
Project Settings → API → copy **Project URL** + **publishable/anon key**.
Send them to me (or edit `public/config.js`), then redeploy Vercel.

## 7. Decommission the old project
Once the new one is verified working end-to-end, pause/delete the old Supabase
project so nothing writes to it.
