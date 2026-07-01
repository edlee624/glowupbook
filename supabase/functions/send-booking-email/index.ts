// ============================================================================
// Glowup Book — send-booking-email (Supabase Edge Function)
//
// Triggered by a Database Webhook on INSERT into public.appointments. Emails the
// customer a booking confirmation with a "confirm your appointment" link (the
// reconfirmation token from migration 0010), sent via Resend.
//
// Secrets required (Edge Functions → Secrets):
//   RESEND_API_KEY   — your Resend API key (re_…)
//   EMAIL_FROM       — e.g. "Glowup Book <bookings@glowupbook.com>" (verified domain)
//   SITE_URL         — e.g. https://glowupbook.com   (optional; defaults below)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL") ?? "https://glowupbook.com";
const FROM = Deno.env.get("EMAIL_FROM") ?? "Glowup Book <bookings@glowupbook.com>";

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const record = body.record ?? body;                 // DB webhook sends { record }
    const apptId = record?.id;
    if (!apptId) return new Response("no appointment id", { status: 200 });

    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: a } = await supa
      .from("appointments")
      .select("id, starts_at, confirm_token, customer:customers(name,email), salon:salons(name,timezone), service:services(name)")
      .eq("id", apptId).single();
    if (!a?.customer?.email) return new Response("no recipient", { status: 200 });

    const tz = a.salon?.timezone ?? "UTC";
    const when = new Date(a.starts_at).toLocaleString("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "short" });
    const confirmUrl = `${SITE_URL}/confirm/${a.confirm_token}`;
    const salonName = a.salon?.name ?? "the salon";
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1d1b2e">
        <h2 style="font-family:Georgia,serif;color:#1d1b2e">You're booked at ${salonName} 🎉</h2>
        <p>Hi ${a.customer?.name ?? "there"}, here are your appointment details:</p>
        <p style="font-size:16px"><strong>${a.service?.name ?? "Appointment"}</strong><br>${when}</p>
        <p>Please confirm you'll be coming:</p>
        <p><a href="${confirmUrl}" style="background:#6C4AB6;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">Confirm my appointment</a></p>
        <p style="color:#8B8898;font-size:13px">Can't make it? Please contact ${salonName} to reschedule.</p>
        <p style="color:#8B8898;font-size:12px">Booked via Glowup Book</p>
      </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: a.customer.email, subject: `Your booking at ${salonName}`, html }),
    });
    return new Response(await res.text(), { status: res.ok ? 200 : 500 });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
