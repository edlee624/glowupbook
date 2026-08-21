// ============================================================================
// Glowup Book — stripe-webhook
// Syncs each salon's subscription status from Stripe into public.subscriptions.
// Verified by the Stripe signature. Deploy with Verify JWT = OFF.
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.  (SUPABASE_* auto.)
// Point a Stripe webhook endpoint at this function and subscribe to:
//   checkout.session.completed, customer.subscription.created/updated/deleted,
//   invoice.paid, invoice.payment_failed
// ============================================================================
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2025-03-31.basil" });
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function syncFromSubscription(sub: Stripe.Subscription) {
  const salonId = (sub.metadata?.salon_id as string) || null;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  // In API 2025-03-31.basil the period end moved onto the subscription item.
  const periodEnd = (sub as { current_period_end?: number }).current_period_end
    ?? sub.items?.data?.[0]?.current_period_end
    ?? null;
  const patch = {
    stripe_subscription_id: sub.id,
    stripe_customer_id: customerId,
    status: sub.status, // trialing | active | past_due | canceled | unpaid | incomplete
    price_id: sub.items?.data?.[0]?.price?.id ?? null,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  if (salonId) await supa.from("subscriptions").upsert({ salon_id: salonId, ...patch });
  else await supa.from("subscriptions").update(patch).eq("stripe_customer_id", customerId);
}

Deno.serve(async (req) => {
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig!, WEBHOOK_SECRET);
  } catch (e) {
    return new Response(`bad signature: ${String(e)}`, { status: 400 });
  }
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.subscription) {
          const sub = await stripe.subscriptions.retrieve(s.subscription as string);
          await syncFromSubscription(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncFromSubscription(event.data.object as Stripe.Subscription);
        break;
      case "invoice.paid":
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        if (inv.subscription) {
          const sub = await stripe.subscriptions.retrieve(inv.subscription as string);
          await syncFromSubscription(sub);
        }
        break;
      }
    }
  } catch (e) {
    return new Response(`handler error: ${String(e)}`, { status: 500 });
  }
  return new Response("ok", { status: 200 });
});
