import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const ORIGIN = "https://turnia-kkbm.onrender.com";
const cors = { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return reply(200, { ok: true });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  if (req.headers.get("origin") && req.headers.get("origin") !== ORIGIN) return reply(403, { error: "origin_forbidden" });
  const jwt = /^Bearer (.+)$/i.exec(req.headers.get("authorization") || "")?.[1];
  if (!jwt) return reply(401, { error: "authentication_required" });
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!url || !anon || !service) return reply(503, { error: "server_not_ready" });
  const visitor = createClient(url, anon, { global: { headers: { Authorization: "Bearer " + jwt } }, auth: { persistSession: false, autoRefreshToken: false } });
  const auth = await visitor.auth.getUser(jwt);
  if (auth.error || !auth.data.user) return reply(401, { error: "invalid_session" });
  let input;
  try { input = await req.json(); } catch { return reply(400, { error: "invalid_json" }); }
  if (typeof input.token !== "string" || !/^[a-f0-9]{64}$/.test(input.token)) return reply(400, { error: "invalid_code" });
  // Destination, authorization and resend limits come from the stored invitation.
  // The browser cannot choose an arbitrary recipient or email body.
  const claim = await visitor.rpc("turnia_claim_invitation_email", { token: input.token });
  if (claim.error || !claim.data) return reply(403, { error: "invitation_unavailable_or_retry_later" });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const redirectTo = ORIGIN + "/?turnia_invite=" + input.token;
  let failure = false;
  try {
    // Auth sends through the project's existing SMTP. No new email credentials.
    const result = claim.data.existing_account
      ? await admin.auth.signInWithOtp({ email: claim.data.email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } })
      : await admin.auth.admin.inviteUserByEmail(claim.data.email, { redirectTo, data: { propina_invitation: input.token, turnia_invitation_setup: true } });
    failure = !!result.error;
  } catch { failure = true; }
  const recorded = await admin.rpc("turnia_finish_invitation_email", { invitation_id: claim.data.id, attempt: claim.data.attempt, delivered_to_smtp: !failure });
  if (failure) return reply(502, { error: "smtp_send_failed" });
  if (recorded.error) return reply(503, { error: "email_status_pending" });
  // Keep Supabase Auth's signed email: it is required for account confirmation.
  // This second message adds a clear link and the invitation code. It cannot grant access.
  let appLinkEmail = "not_configured";
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const sender = Deno.env.get("TURNIA_SUPPORT_FROM");
  if (resendKey && sender) {
    try {
      const appUrl = ORIGIN + "/";
      const inviteUrl = appUrl + "?turnia_invite=" + input.token;
      const plain = [
        "Te invitaron a Turnia - Cada turno cuenta.",
        "",
        "Primero: abre el otro correo de confirmacion de Turnia y activa tu cuenta.",
        "Luego entra a la aplicacion: " + appUrl,
        "Tu codigo de invitacion: " + input.token,
        "Enlace a tu invitacion: " + inviteUrl,
        "Este codigo es personal. No compartas tu contrasena."
      ].join("\n");
      const html = '<!doctype html><html lang="es"><body style="background:#f5f7f7;padding:24px;font-family:Arial,sans-serif;color:#14283f">'
        + '<div style="max-width:520px;margin:auto;background:#fff;padding:28px;border:1px solid #e2e7e7;border-radius:14px">'
        + '<p style="letter-spacing:2px;color:#087f8c;font-weight:bold">TURNIA</p><h1>Te invitaron a Turnia</h1>'
        + '<p><strong>Primero</strong> abre el otro correo de Turnia con el enlace de confirmación o acceso para activar tu cuenta.</p>'
        + '<p style="text-align:center;margin:28px 0"><a href="' + appUrl + '" style="background:#087f8c;color:white;border-radius:9px;padding:15px 24px;text-decoration:none;font-weight:bold">Abrir la aplicación Turnia</a></p>'
        + '<p>Enlace de Turnia: <a href="' + appUrl + '">' + appUrl + '</a></p>'
        + '<p>Tu código de invitación:</p><p style="background:#f4f6f6;border-radius:8px;padding:12px;overflow-wrap:anywhere"><code>' + input.token + '</code></p>'
        + '<p>Después de confirmar tu correo, puedes <a href="' + inviteUrl + '">abrir tu invitación directamente</a>.</p>'
        + '<p style="font-size:12px;color:#637180">No compartas tu contraseña ni tu código con terceros.</p>'
        + '</div></body></html>';
      const extra = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + resendKey, "Content-Type": "application/json" },
        body: JSON.stringify({ from: sender, to: [claim.data.email], subject: "Turnia · Tu enlace y código de invitación", html, text: plain }),
        signal: AbortSignal.timeout(10000)
      });
      appLinkEmail = extra.ok ? "sent" : "failed";
      if (!extra.ok) console.error("turnia_link_email_not_accepted", extra.status);
    } catch { appLinkEmail = "failed"; }
  }
  return reply(200, { status: "accepted_by_smtp", app_link_email: appLinkEmail, app_url: ORIGIN + "/" });
});
