// Read-only test seller preflight. Never creates a checkout, charge or membership.
import {createClient} from "npm:@supabase/supabase-js@2";
const origin="https://turnia-kkbm.onrender.com";
const headers={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Content-Type":"application/json"};
const respond=(obj:unknown,status=200)=>new Response(JSON.stringify(obj),{status,headers});
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers});
 if(req.method!=="POST")return respond({error:"Method not allowed"},405);
 try{
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!key)return respond({error:"Supabase credentials not configured"},503);
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer /,"");
  if(!token)return respond({error:"Authentication required"},401);
  const sb=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await sb.auth.getUser(token);
  if(error||!user||!user.email_confirmed_at)return respond({error:"Confirmed user required"},403);
  // Use an authenticated client to call the invoker-based RPC.
  const authed=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const decision=await authed.rpc("turnia_sandbox_preflight_allowed");
  if(decision.error||decision.data!==true)return respond({error:"Account not authorized for test preflight"},403);
  const mpToken=Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  if(!mpToken)return respond({ready:false,reason:"No Mercado Pago seller token configured"});
  const response=await fetch("https://api.mercadopago.com/users/me",{headers:{Authorization:`Bearer ${mpToken}`},signal:AbortSignal.timeout(10000)});
  if(!response.ok)return respond({ready:false,reason:"Seller authentication failed"});
  const seller=await response.json().catch(()=>({}));
  const testSeller=/@testuser\.com$/i.test(String(seller.email||""));
  return respond({ready:testSeller,seller_mode:testSeller?"test":"not_test",sandbox_checkout_enabled:false,
    note:testSeller?"Test seller verified":"Seller token is not a test seller; checkout remains disabled"});
 }catch{
  return respond({ready:false,reason:"Preflight unavailable"},503);
 }
});
