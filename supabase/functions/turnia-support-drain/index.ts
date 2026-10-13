// Private Turnia support notification queue drain.
// verify_jwt=false is intentional: pg_cron authenticates with a 256-bit Vault
// token, validated by a service-role-only PostgreSQL SECURITY DEFINER RPC.
// Do not give this endpoint CORS permissions or accept client-supplied recipients.
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { canAutomaticallyRetry } from "./policy.mjs";

const ORIGIN = "https://turnia-kkbm.onrender.com";
const LIMIT = 4;
const reply = (code: number, data: Record<string, unknown>) =>
  new Response(JSON.stringify(data), {
    status: code, headers: { "Content-Type": "application/json; charset=utf-8" },
  });
const goodEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const safeText = (value: unknown, limit: number) =>
  String(value || "").replace(/[\r\n]+/g, " ").slice(0, limit);
type Entry = {
  ticket_id: string;
  status: string;
  attempts: number;
  last_attempt_at: string | null;
  locked_until: string | null;
  last_error: string | null;
  created_at: string;
};
const credentials = {
  auth: { persistSession: false, autoRefreshToken: false },
};

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return reply(405, { error: "method_not_allowed" });
  const token = request.headers.get("x-turnia-cron-token") || "";
  if (!/^[a-f0-9]{64}$/i.test(token)) return reply(403, { error: "not_authorized" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return reply(503, { error: "server_unavailable" });

  const admin = createClient(supabaseUrl, serviceKey, credentials);
  const authorized = await admin.rpc("turnia_support_cron_authorized", { p_token: token });
  if (authorized.error || authorized.data !== true) {
    return reply(403, { error: "not_authorized" });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const sender = Deno.env.get("TURNIA_SUPPORT_FROM");
  const recipient = Deno.env.get("TURNIA_SUPPORT_NOTIFY_TO") || "turnia.notificaciones@gmail.com";
  if (!apiKey || !sender || !goodEmail(recipient)) {
    return reply(503, { error: "mail_not_configured" });
  }
  // Scan candidates in creation order. A database compare-and-set claim below
  // prevents this worker from racing with the browser's direct notification.
  const { data: found, error: listError } = await admin
    .from("turnia_support_email_outbox")
    .select("ticket_id,status,attempts,last_attempt_at,locked_until,last_error,created_at")
    .in("status", ["pending", "failed", "sending"])
    .order("created_at", { ascending: true })
    .limit(100);
  if (listError) return reply(503, { error: "queue_unavailable" });

  const ready = ((found || []) as Entry[])
    .filter((row) => canAutomaticallyRetry(row))
    .slice(0, LIMIT);
  let sent = 0, failed = 0, skipped = 0;

  for (const event of ready) {
    const now = Date.now();
    if (!canAutomaticallyRetry(event, now)) { skipped++; continue; }

    let claim = admin.from("turnia_support_email_outbox").update({
      status: "sending",
      attempts: event.attempts + 1,
      last_attempt_at: new Date(now).toISOString(),
      locked_until: new Date(now + 120_000).toISOString(),
      last_error: null,
    }).eq("ticket_id", event.ticket_id)
      .eq("status", event.status)
      .eq("attempts", event.attempts);
    if (event.status === "sending") {
      claim = claim.lt("locked_until", new Date(now).toISOString());
    }
    const claimed = await claim.select("ticket_id").maybeSingle();
    if (claimed.error || !claimed.data) { skipped++; continue; }

    try {
      const { data: ticket, error: ticketError } = await admin
        .from("turnia_support_tickets")
        .select("id,restaurant_id,subject,category")
        .eq("id", event.ticket_id).maybeSingle();
      if (ticketError || !ticket) throw new Error("ticket_unavailable");
      const { data: restaurant } = await admin
        .from("propina_restaurants")
        .select("name")
        .eq("id", ticket.restaurant_id).maybeSingle();
      const shortId = String(ticket.id).slice(0, 8).toUpperCase();
      const title = safeText(ticket.subject, 150);
      const name = safeText(restaurant?.name || "Restaurante", 120);
      const message = [
        "Hay un nuevo reporte de soporte en Turnia.",
        "Restaurante: " + name,
        "Categoría: " + safeText(ticket.category, 40),
        "Asunto: " + title,
        "Ticket: #" + shortId,
        "",
        "Abre el Panel de propietario en " + ORIGIN + " para leerlo y responder.",
        "Por privacidad, la descripción completa permanece dentro de Turnia.",
      ].join("\n");
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + apiKey,
          "Content-Type": "application/json",
          "Idempotency-Key": "turnia-support-ticket/" + ticket.id,
        },
        body: JSON.stringify({
          from: sender,
          to: [recipient],
          subject: "[Turnia] Nuevo ticket #" + shortId + " · " + title,
          text: message,
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error("provider_http_" + response.status);
      const messageData = await response.json();
      if (!messageData?.id || typeof messageData.id !== "string") {
        throw new Error("provider_no_message_id");
      }
      const confirm = await admin.from("turnia_support_email_outbox").update({
        status: "sent",
        locked_until: null,
        sent_at: new Date().toISOString(),
        provider_message_id: messageData.id,
        last_error: null,
      }).eq("ticket_id", ticket.id).eq("status", "sending")
        .eq("attempts", event.attempts + 1).select("ticket_id").maybeSingle();
      if (confirm.error || !confirm.data) {
        // Delivery may have been accepted; next retry uses the same idempotency key.
        failed++;
      } else {
        sent++;
      }
    } catch (error) {
      const description = error instanceof Error ? error.message : "";
      const failureCode = /^provider_http_\d{3}$/.test(description) ||
        description === "provider_no_message_id" ||
        description === "ticket_unavailable"
        ? description : "network_or_provider_error";
      await admin.from("turnia_support_email_outbox").update({
        status: "failed", locked_until: null, last_error: failureCode,
      }).eq("ticket_id", event.ticket_id).eq("status", "sending")
        .eq("attempts", event.attempts + 1);
      failed++;
    }
  }
  return reply(200, { ok: true, eligible: ready.length, sent, failed, skipped });
});
