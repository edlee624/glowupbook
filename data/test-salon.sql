-- ============================================================================
-- Glowup Book — Test Salon (demo data)
-- Creates a published, bookable salon at /test-salon with services, 2 staff +
-- working hours, sample customers, and appointments across THIS week (so the
-- Day/Week/Month calendar has something to show). Idempotent: re-running
-- deletes and recreates the test salon. Run after migrations 0001–0007.
--
-- Put YOUR login email below to own it (so it shows in your dashboard). Leave
-- as-is to create it ownerless (still public + bookable, just not in a dashboard).
-- ============================================================================
do $$
declare
  v_owner uuid;
  v_salon uuid;
  v_wc uuid; v_mc uuid; v_bal uuid; v_mani uuid;
  v_s1 uuid; v_s2 uuid;
  v_c1 uuid; v_c2 uuid; v_c3 uuid;
  d int;
  tz text := 'America/New_York';
begin
  select id into v_owner from public.profiles where lower(email) = lower('YOUR-LOGIN-EMAIL') limit 1;

  delete from public.salons where slug = 'test-salon';

  insert into public.salons (owner_id, name, slug, business_type, about, phone, email, address, city,
                             timezone, currency, is_published, claimed, source, lat, lon, instagram, website)
  values (v_owner, 'Test Salon (Demo)', 'test-salon', 'hair',
          'A demo salon for trying out Glowup Book — pick a service and book a slot to see the whole flow.',
          '(212) 555-0142', 'hello@testsalon.example', '123 Demo Ave', 'New York',
          tz, 'USD', true, true, 'demo', 40.7361, -73.9903, '@glowupbook', 'https://glowupbook.com')
  returning id into v_salon;

  insert into public.services (salon_id, name, description, duration_min, buffer_min, price, is_active, bookable_online)
  values (v_salon, 'Women''s Haircut', 'Wash, cut & style', 45, 10, 65, true, true) returning id into v_wc;
  insert into public.services (salon_id, name, description, duration_min, buffer_min, price, is_active, bookable_online)
  values (v_salon, 'Men''s Haircut', 'Classic cut', 30, 5, 35, true, true) returning id into v_mc;
  insert into public.services (salon_id, name, description, duration_min, buffer_min, price, is_active, bookable_online)
  values (v_salon, 'Balayage', 'Hand-painted color', 120, 15, 180, true, true) returning id into v_bal;
  insert into public.services (salon_id, name, description, duration_min, buffer_min, price, is_active, bookable_online)
  values (v_salon, 'Gel Manicure', 'Long-lasting gel polish', 45, 5, 45, true, true) returning id into v_mani;

  insert into public.staff (salon_id, name, title, color, is_active, accepts_online_booking)
  values (v_salon, 'Jordan Lee', 'Senior Stylist', '#6C4AB6', true, true) returning id into v_s1;
  insert into public.staff (salon_id, name, title, color, is_active, accepts_online_booking)
  values (v_salon, 'Riley Kim', 'Nail & Beauty Tech', '#FF6FA5', true, true) returning id into v_s2;

  insert into public.staff_services (staff_id, service_id) values
    (v_s1, v_wc), (v_s1, v_mc), (v_s1, v_bal),
    (v_s2, v_mani), (v_s2, v_wc);

  -- Mon–Sat 9:00–18:00 for both staff (dow 1..6)
  for d in 1..6 loop
    insert into public.working_hours (salon_id, staff_id, dow, start_time, end_time) values
      (v_salon, v_s1, d, '09:00', '18:00'),
      (v_salon, v_s2, d, '09:00', '18:00');
  end loop;

  insert into public.customers (salon_id, name, email, phone) values (v_salon, 'Maya Patel', 'maya@example.com', '(212) 555-1001') returning id into v_c1;
  insert into public.customers (salon_id, name, email, phone) values (v_salon, 'Chris Doe',  'chris@example.com', '(212) 555-1002') returning id into v_c2;
  insert into public.customers (salon_id, name, email, phone) values (v_salon, 'Sam Rivera', 'sam@example.com',  '(212) 555-1003') returning id into v_c3;

  -- Sample appointments this week (wall-clock in salon tz)
  insert into public.appointments (salon_id, customer_id, staff_id, service_id, starts_at, ends_at, status, source, price) values
    (v_salon, v_c1, v_s1, v_wc,
       (current_date + time '11:00') at time zone tz, (current_date + time '11:45') at time zone tz, 'booked', 'manual', 65),
    (v_salon, v_c2, v_s1, v_bal,
       (current_date + time '14:00') at time zone tz, (current_date + time '16:00') at time zone tz, 'confirmed', 'online', 180),
    (v_salon, v_c3, v_s2, v_mani,
       ((current_date + 1) + time '10:30') at time zone tz, ((current_date + 1) + time '11:15') at time zone tz, 'booked', 'online', 45),
    (v_salon, v_c1, v_s2, v_mani,
       ((current_date + 2) + time '15:00') at time zone tz, ((current_date + 2) + time '15:45') at time zone tz, 'booked', 'manual', 45),
    (v_salon, v_c2, v_s1, v_mc,
       ((current_date + 3) + time '13:00') at time zone tz, ((current_date + 3) + time '13:30') at time zone tz, 'booked', 'online', 35);
end $$;
