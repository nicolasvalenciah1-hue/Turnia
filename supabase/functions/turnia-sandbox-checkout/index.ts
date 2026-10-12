// Turnia sandbox checkout. Never deploy for live purchases without an explicit review.
import { createClient } from "npm:@supabase/supabase-js@2";
const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = { "Access-Control-Allow-Origin": "https://turnia-kkbm.onrender.com",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers:cors});
Deno.serve(async req => {
 if (req.method === "OPTIONS") return new Response("ok", {headers:cors});
 if (req.method !== "POST") return reply({error:"Method not allowed"},405);
 try {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return reply({error:"Authentication required"},401);
  const userClient = createClient(url, anonKey, {global:{headers:{Authorization:auth}},
    auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError} = await userClient.auth.getUser(auth.slice(7));
  if (userError || !user || !user.email_confirmed_at) return reply({error:"Confirm your email first"},403);
  const admin = createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  // A service-role-only RPC resolves the account and checks the disabled-by-default flag.
  const reference=`turnia:${user.id}:${crypto.randomUUID()}`;
  const {data:registration,error:registrationError}=await admin.rpc("turnia_prepare_sandbox_checkout",{
    p_user_id:user.id,p_reference:reference
  });
  if(registrationError || !registration) return reply({error:"Sandbox checkout unavailable"},403);
  if(Number(registration.price_clp)!==5000) return reply({error:"Invalid sandbox plan"},403);
  const mpToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  if(!mpToken) return reply({error:"Sandbox seller credentials unavailable"},503);
  const sellerResponse=await fetch("https://api.mercadopago.com/users/me",
    {headers:{Authorization:`Bearer ${mpToken}`},signal:AbortSignal.timeout(10000)});
  const seller=await sellerResponse.json().catch(()=>({}));
  if(!sellerResponse.ok || !/@testuser\.com$/i.test(String(seller.email||"")))
    return reply({error:"Test seller credentials required"},403);
  const {payer_email}=await req.json().catch(()=>({}));
  if(!/^[^@\s]+@testuser\.com$/i.test(String(payer_email||""))
    || String(payer_email).toLowerCase()===String(seller.email).toLowerCase())
    return reply({error:"Use a separate Mercado Pago test buyer"},400);
  const response=await fetch("https://api.mercadopago.com/preapproval",{
    method:"POST",headers:{Authorization:`Bearer ${mpToken}`,"Content-Type":"application/json"},
    signal:AbortSignal.timeout(15000),
    body:JSON.stringify({
      reason:`Turnia · Mensual · ${registration.restaurant_name}`,
      external_reference:reference,payer_email,
      auto_recurring:{frequency:1,frequency_type:"months",transaction_amount:5000,currency_id:"CLP"},
      back_url:"https://turnia-kkbm.onrender.com/registro.html?payment=return",
      status:"pending"
    })
  });
  const mp=await response.json().catch(()=>({}));
  if(!response.ok || !mp.id) return reply({error:"Mercado Pago could not create test subscription"},502);
  const {error:attachError}=await admin.rpc("turnia_attach_sandbox_preapproval",{
    p_reference:reference,p_preapproval_id:String(mp.id)
  });
  if(attachError) return reply({error:"Checkout created but could not be linked"},500);
  return reply({mode:"sandbox",status:"pending",init_point:mp.sandbox_init_point || mp.init_point});
 } catch(e) {
  console.error("turnia_sandbox_checkout_failed", e instanceof Error?e.name:"unknown");
  return reply({error:"Could not start sandbox checkout"},500);
 }
});
