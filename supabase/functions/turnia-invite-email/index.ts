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
  return reply(200, { status: "accepted_by_smtp" });
});
