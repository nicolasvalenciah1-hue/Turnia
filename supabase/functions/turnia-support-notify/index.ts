// Authenticated Turnia support alert. Only the ticket creator can request one send.
// All mail credentials live in Supabase Edge Function secrets, never in the web app.
// A private RLS-protected outbox prevents duplicate and unrestricted messages.
import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const ORIGIN = "https://turnia-kkbm.onrender.com";
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
function reply(status: number, value: Record<string, unknown>): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}
const validId = (id: unknown) => typeof id === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return reply(200, { ok: true });
  if (request.method !== "POST") return reply(405, { error: "method_not_allowed" });
  const origin = request.headers.get("origin");
  if (origin && origin !== ORIGIN) return reply(403, { error: "origin_forbidden" });
  const token = /^Bearer (.+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) return reply(401, { error: "authentication_required" });
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(503, { error: "server_not_ready" });

  const visitor = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const auth = await visitor.auth.getUser(token);
  if (auth.error || !auth.data.user) return reply(401, { error: "invalid_session" });

  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return reply(400, { error: "invalid_json" }); }
  const id = input.ticket_id;
  if (!validId(id)) return reply(400, { error: "invalid_ticket" });

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: ticket, error: ticketError } = await admin
    .from("turnia_support_tickets")
    .select("id,restaurant_id,created_by,category,subject")
    .eq("id", id).maybeSingle();
  if (ticketError) return reply(503, { error: "support_unavailable" });
  // Never allow a user to trigger alerts for another user's ticket.
  if (!ticket || ticket.created_by !== auth.data.user.id) {
    return reply(403, { error: "not_authorized" });
  }

  const { data: event, error: queueError } = await admin.from("turnia_support_email_outbox")
    .select("ticket_id,status,attempts,last_attempt_at,locked_until,sent_at")
    .eq("ticket_id", id).maybeSingle();
  if (queueError || !event) return reply(503, { error: "notification_queue_not_ready" });
  if (event.status === "sent") return reply(200, { status: "already_sent" });

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const sender = Deno.env.get("TURNIA_SUPPORT_FROM");
  const recipient = Deno.env.get("TURNIA_SUPPORT_NOTIFY_TO") || "turnia.notificaciones@gmail.com";
  // Fail closed: Resend must be explicitly configured by the project owner.
  if (!apiKey || !sender || !recipient) return reply(202, { status: "not_configured" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return reply(503, { error: "recipient_not_configured" });
  const now = Date.now();
  if (event.status === "sending" && Date.parse(event.locked_until || "") > now) {
    return reply(202, { status: "processing" });
  }
  if (event.status === "failed" && now - Date.parse(event.last_attempt_at || "") < 60_000) {
    return reply(202, { status: "retry_later" });
  }
  // Compare status + attempt counter to claim a single worker atomically.
  let claimQuery = admin.from("turnia_support_email_outbox")
    .update({
      status: "sending",
      attempts: event.attempts + 1,
      locked_until: new Date(now + 60_000).toISOString(),
      last_attempt_at: new Date(now).toISOString(),
      last_error: null,
    })
    .eq("ticket_id", id)
    .eq("status", event.status)
    .eq("attempts", event.attempts);
  if (event.status === "sending") {
    claimQuery = claimQuery.lt("locked_until", new Date(now).toISOString());
  }
  const claim = await claimQuery.select("ticket_id").maybeSingle();
  if (claim.error) return reply(503, { error: "notification_queue_unavailable" });
  if (!claim.data) return reply(202, { status: "processing" });

  const { data: restaurant } = await admin.from("propina_restaurants")
    .select("name").eq("id", ticket.restaurant_id).maybeSingle();
  const label = String(restaurant?.name || "Restaurante").slice(0, 120);
  const shortId = String(id).slice(0, 8).toUpperCase();
  const subject = "[Turnia] Nuevo ticket #" + shortId + " · " +
    String(ticket.subject).slice(0, 150);
  const message = [
    "Hay un nuevo reporte de soporte en Turnia.",
    "Restaurante: " + label,
    "Categoría: " + String(ticket.category),
    "Asunto: " + String(ticket.subject),
    "Ticket: #" + shortId,
    "",
    "Abre el Panel de propietario en " + ORIGIN + " para leerlo y responder.",
    "Por privacidad, la descripción completa permanece dentro de Turnia.",
  ].join("\n");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
        "Idempotency-Key": "turnia-support-ticket/" + id,
      },
      body: JSON.stringify({ from: sender, to: [recipient], subject, text: message }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw Error("provider_http_" + response.status);
    const sent = await response.json();
    if (!sent?.id || typeof sent.id !== "string") throw Error("provider_no_message_id");
    const confirmed = await admin.from("turnia_support_email_outbox").update({
      status: "sent",
      locked_until: null,
      sent_at: new Date().toISOString(),
      provider_message_id: sent.id,
      last_error: null,
    }).eq("ticket_id", id).eq("status", "sending").eq("attempts", event.attempts + 1);
    if (confirmed.error) return reply(503, { error: "confirmation_pending" });
    // Accepted by mail provider; receipt in Gmail is not yet guaranteed.
    return reply(200, { status: "accepted_by_provider" });
  } catch (error) {
    // Store only a sanitized code, never raw provider response or secrets.
    const code = /^provider_http_\d{3}$/.test(String(error?.message)) ? String(error.message) : "network_or_provider_error";
    await admin.from("turnia_support_email_outbox").update({
      status: "failed", locked_until: null, last_error: code,
    }).eq("ticket_id", id).eq("status", "sending").eq("attempts", event.attempts + 1);
    return reply(502, { error: "email_temporarily_unavailable" });
  }
});
