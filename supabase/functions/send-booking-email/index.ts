// ============================================================================
// Glowup Book — send-booking-email
//
// Sends the customer an email via Resend. Two modes:
//   • "booking" (default)        — the confirmation sent when an appointment is
//                                  created (fired by a DB webhook/trigger on INSERT).
//   • "confirm-request"          — a "please confirm you're still coming" reminder,
//                                  sent when the owner clicks "Request confirmation".
// Both include the /confirm/<token> link.
//
// Body: { record: <appointment> }  (from the DB trigger)  OR
//       { id: <uuid>, mode: "confirm-request" }  (from the dashboard button)
//
// Secrets: RESEND_API_KEY, EMAIL_FROM, SITE_URL (SUPABASE_URL + SERVICE key auto).
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
    const record = body.record ?? body;
    const apptId = record?.id;
    const mode = body.mode ?? record?.mode ?? "booking";       // "booking" | "confirm-request"
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
    const name = a.customer?.name ?? "there";
    const service = a.service?.name ?? "Appointment";
    const isReminder = mode === "confirm-request";

    const subject = isReminder ? `Please confirm your appointment at ${salonName}` : `Your booking at ${salonName}`;
    const heading = isReminder ? "Please confirm your appointment" : `You're booked at ${salonName} 🎉`;
    const intro = isReminder
      ? `Hi ${name}, ${salonName} would like to confirm you're still coming to your appointment:`
      : `Hi ${name}, here are your appointment details:`;
    const cta = isReminder ? "Yes, I'll be there" : "Confirm my appointment";

    const html = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1d1b2e">
        <h2 style="font-family:Georgia,serif;color:#1d1b2e">${heading}</h2>
        <p>${intro}</p>
        <p style="font-size:16px"><strong>${service}</strong><br>${when}</p>
        <p><a href="${confirmUrl}" style="background:#6C4AB6;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">${cta}</a></p>
        <p style="color:#8B8898;font-size:13px">${isReminder ? `Can't make it? Please contact ${salonName} to reschedule.` : `We'll send a reminder before your visit.`}</p>
        <p style="color:#8B8898;font-size:12px">Booked via Glowup Book</p>
      </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: a.customer.email, subject, html }),
    });
    return new Response(await res.text(), { status: res.ok ? 200 : 500 });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
