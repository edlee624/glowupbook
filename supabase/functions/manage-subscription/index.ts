// ============================================================================
// Glowup Book — manage-subscription
// Creates a Stripe Checkout session (subscription) or a Billing Portal session
// for the owner's salon. Authenticated: the caller must manage the salon.
//
// POST { action: "checkout" | "portal", salon_id, price_id? }  -> { url }
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_ID (default plan), BIZ_URL,
//          TRIAL_DAYS (optional). SUPABASE_URL / _ANON_KEY / _SERVICE_ROLE_KEY auto.
// Deploy with Verify JWT = OFF (we check the token ourselves).
// ============================================================================
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2025-03-31.basil" });
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BIZ_URL = Deno.env.get("BIZ_URL") ?? "https://biz.glowupbook.com";
const DEFAULT_PRICE = Deno.env.get("STRIPE_PRICE_ID") ?? "";
const TRIAL_DAYS = parseInt(Deno.env.get("TRIAL_DAYS") ?? "0", 10);

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!jwt) return json({ error: "unauthorized" }, 401);
    const { action, salon_id, price_id } = await req.json().catch(() => ({}));
    if (!salon_id || !["checkout", "portal"].includes(action)) return json({ error: "bad request" }, 400);

    // Verify the caller manages this salon (RLS-scoped my_salons under their JWT).
    const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: mine, error: meErr } = await asUser.rpc("my_salons");
    if (meErr) return json({ error: `auth check failed: ${meErr.message}` }, 500);
    const salon = (mine ?? []).find((s: { id: string }) => s.id === salon_id);
    if (!salon) return json({ error: "not your salon" }, 403);

    const svc = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: existing } = await svc.from("subscriptions").select("*").eq("salon_id", salon_id).maybeSingle();

    // Ensure a Stripe customer exists for this salon.
    let customerId = existing?.stripe_customer_id as string | undefined;
    if (!customerId) {
      const cust = await stripe.customers.create({ name: salon.name ?? "Salon", metadata: { salon_id } });
      customerId = cust.id;
      await svc.from("subscriptions").upsert({ salon_id, stripe_customer_id: customerId, status: existing?.status ?? "none" });
    }

    if (action === "portal") {
      const ps = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${BIZ_URL}/app` });
      return json({ url: ps.url });
    }

    // action === "checkout"
    const price = price_id || DEFAULT_PRICE;
    if (!price) return json({ error: "no price configured" }, 500);
    const subData: Record<string, unknown> = { metadata: { salon_id } };
    if (TRIAL_DAYS > 0) subData.trial_period_days = TRIAL_DAYS;
    const cs = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      subscription_data: subData,
      allow_promotion_codes: true,
      success_url: `${BIZ_URL}/app?billing=success`,
      cancel_url: `${BIZ_URL}/app?billing=cancel`,
    });
    return json({ url: cs.url });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
