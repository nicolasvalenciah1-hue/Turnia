// Turnia new-customer sandbox webhook. Draft only, do not deploy or connect real events.
import { createClient } from "npm:@supabase/supabase-js@2";
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{"Content-Type":"application/json"}});
const mpToken=Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
async function getMp(path:string){
 const response=await fetch("https://api.mercadopago.com"+path,{
  headers:{Authorization:`Bearer ${mpToken}`},signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error("Mercado Pago verification failed");
 return await response.json();
}
async function authenticatedNotification(req:Request, resourceId:string){
 const secret=Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET");
 const requestId=req.headers.get("x-request-id")||"";
 const sig=req.headers.get("x-signature")||"";
 const parts=Object.fromEntries(sig.split(",").map(x=>x.trim().split("=")));
 if(!secret || !requestId || !/^\d+$/.test(parts.ts||"") ||
    !/^[a-f0-9]{64}$/i.test(parts.v1||""))return false;
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),
  {name:"HMAC",hash:"SHA-256"},false,["verify"]);
 const given=new Uint8Array(parts.v1.match(/.{2}/g)!.map((x:string)=>parseInt(x,16)));
 const canonical=`id:${resourceId.toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
 return crypto.subtle.verify("HMAC",key,given,new TextEncoder().encode(canonical));
}
Deno.serve(async req=>{
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 try{
  if(!mpToken)return reply({error:"Test payment backend disabled"},503);
  const url=new URL(req.url);
  const signedId=url.searchParams.get("data.id")||"";
  if(!signedId || !(await authenticatedNotification(req,signedId)))
   return reply({error:"Invalid notification signature"},401);
  const event=await req.json().catch(()=>({}));
  const type=String(event.type||event.topic||url.searchParams.get("type")||"");
  if(type!=="subscription_authorized_payment")return reply({ok:true,ignored:true});
  const resourceId=String(event.data?.id||"");
  if(!resourceId || resourceId.toLowerCase()!==signedId.toLowerCase())
   return reply({error:"Signed resource mismatch"},400);
  const authorized=await getMp("/authorized_payments/"+encodeURIComponent(resourceId));
  const subscriptionId=String(authorized.preapproval_id||authorized.subscription_id||authorized.preapproval?.id||"");
  const paymentId=String(authorized.payment?.id||"");
  if(!subscriptionId || !paymentId)return reply({ok:true,ignored:true});
  const [subscription,payment]=await Promise.all([
   getMp("/preapproval/"+encodeURIComponent(subscriptionId)),
   getMp("/v1/payments/"+encodeURIComponent(paymentId))
  ]);
  if(payment.status!=="approved" || payment.live_mode!==false)
   return reply({ok:true,ignored:true});
  if(!/@testuser\.com$/i.test(String(subscription.payer_email||"")))
   return reply({ok:true,ignored:true});
  const ref=String(subscription.external_reference||"");
  if(!/^turnia:[a-f0-9-]{36}:[a-f0-9-]{36}$/i.test(ref))
   return reply({ok:true,ignored:true});
  if(String(payment.currency_id)!=="CLP" || Number(payment.transaction_amount)!==5000)
   return reply({error:"Payment does not match sandbox plan"},409);
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl=Deno.env.get("SUPABASE_URL");
  if(!serviceKey||!supabaseUrl)return reply({error:"Backend not configured"},503);
  const admin=createClient(supabaseUrl,serviceKey,{
   auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await admin.rpc("turnia_complete_sandbox_payment",{
   p_reference:ref,p_payment_id:paymentId,p_subscription:subscriptionId,
   p_amount:5000,p_currency:"CLP",p_live_mode:false
  });
  if(error)throw error;
  return reply({ok:true,status:data?.status||"processed"});
 }catch(e){
  console.error("turnia_sandbox_notification_failed",e instanceof Error?e.name:"unknown");
  return reply({error:"Unable to verify test payment"},500);
 }
});
