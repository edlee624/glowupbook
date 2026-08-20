-- ===========================================================================
-- 0015_subscriptions.sql — platform SaaS billing (you charge salon owners).
-- One row per salon. Owners/managers can READ their subscription; only the
-- Stripe webhook (service role, bypasses RLS) writes it — so no one can mark
-- themselves "active" from the client.
-- ===========================================================================
create table if not exists public.subscriptions (
  salon_id               uuid primary key references public.salons(id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text,
  status                 text not null default 'none',  -- none|trialing|active|past_due|canceled|unpaid|incomplete
  price_id               text,
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);
alter table public.subscriptions enable row level security;

-- Members of the salon can read its subscription. No write policies → the
-- client cannot insert/update/delete; the webhook uses the service role.
drop policy if exists "subs: member read" on public.subscriptions;
create policy "subs: member read" on public.subscriptions
  for select using (public.is_salon_member(salon_id));

-- Convenience: is a salon currently entitled to paid features?
create or replace function public.salon_is_subscribed(p_salon uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subscriptions s
    where s.salon_id = p_salon
      and s.status in ('trialing', 'active')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;
grant execute on function public.salon_is_subscribed(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
