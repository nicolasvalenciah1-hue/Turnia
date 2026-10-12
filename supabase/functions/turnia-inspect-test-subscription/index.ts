import {createClient} from "npm:@supabase/supabase-js@2";
const base="https://turnia-kkbm.onrender.com";
const heads={"Content-Type":"application/json","Access-Control-Allow-Origin":base,"Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info"};
const answer=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:heads});
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response("ok",{headers:heads});
 if(request.method!=="POST")return answer({error:"Method not allowed"},405);
 try{
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service)return answer({error:"Backend unavailable"},503);
  const bearer=request.headers.get("authorization")||"";
  if(!bearer.startsWith("Bearer "))return answer({error:"Authentication required"},401);
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await auth.auth.getUser(bearer.slice(7));
  if(error||!user||!user.email_confirmed_at)return answer({error:"Verified user required"},403);
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:target,error:targetError}=await admin.rpc("turnia_subscription_inspection_target",{p_user_id:user.id});
  if(targetError)return answer({error:"Not allowed"},403);
  if(!target?.found)return answer({found:false});
  const token=Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  if(!token)return answer({error:"Seller token unavailable"},503);
  const headers={Authorization:`Bearer ${token}`};
  const [sellerResponse,subResponse]=await Promise.all([
    fetch("https://api.mercadopago.com/users/me",{headers,signal:AbortSignal.timeout(10000)}),
    fetch("https://api.mercadopago.com/preapproval/"+encodeURIComponent(target.preapproval_id),{headers,signal:AbortSignal.timeout(10000)})
  ]);
  if(!sellerResponse.ok||!subResponse.ok)return answer({found:true,checked:false,reason:"Provider lookup unsuccessful"});
  const [seller,sub]=await Promise.all([sellerResponse.json(),subResponse.json()]);
  const isSellerTest=/@testuser\.com$/i.test(String(seller.email||""));
  // Mercado Pago preapproval GET may return payer_id without payer_email.
  // Missing fields are unverified, never proof that the payer is not a test user.
  const returnedBuyerEmail=typeof sub.payer_email==="string" && sub.payer_email.trim().length>0;
  const buyerEmailTest=returnedBuyerEmail
    ? /@testuser\\.com$/i.test(sub.payer_email.trim()) : null;
  const payerIdPresent=sub.payer_id!==null && sub.payer_id!==undefined && String(sub.payer_id).length>0;
  const {data:verifiedBuyer,error:verifyError}=await admin.rpc("turnia_verify_test_buyer_mp_id",{
    p_turnia_user_id:user.id,p_provider_payer_id:sub.payer_id==null?"":String(sub.payer_id)
  });
  if(verifyError)return answer({found:true,checked:false,reason:"Buyer identity verification unavailable"});
  const trustedBuyer=verifiedBuyer?.matches===true;
  const amountsMatch=Number(sub.auto_recurring?.transaction_amount)===Number(target.price_clp)&&sub.auto_recurring?.currency_id===target.currency;
  const referenceMatches=sub.external_reference===target.external_reference;
  const status=String(sub.status||"unknown").slice(0,32);
  // Some provider responses omit live_mode for subscriptions: treat absent as unverified, never as false.
  const liveMode=sub.live_mode===true?"live":sub.live_mode===false?"test":"unverified";
  return answer({found:true,checked:true,status,local_status:target.local_status,
    seller_is_test:isSellerTest,buyer_is_test:buyerEmailTest,
    buyer_email_returned:returnedBuyerEmail,payer_id_returned:payerIdPresent,
    trusted_buyer_id_configured:verifiedBuyer?.configured===true,
    trusted_buyer_id_matches:verifiedBuyer?.matches??null,
    amount_and_currency_match:amountsMatch,reference_matches:referenceMatches,
    environment:liveMode,
    eligible_for_payment_test:isSellerTest&&trustedBuyer&&amountsMatch&&referenceMatches&&liveMode==="test"});
 }catch{return answer({error:"Inspection unavailable"},503)}
});