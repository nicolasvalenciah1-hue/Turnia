// Offline CI checks for registration. No Supabase data writes.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const html=fs.readFileSync(__dirname+'/../dist/registro.html','utf8');
const js=fs.readFileSync(__dirname+'/../dist/registro.js','utf8');
const migration=fs.readFileSync(__dirname+'/../supabase/migrations/20261012_turnia_self_registration.sql','utf8');
const activation=fs.readFileSync(__dirname+'/../supabase/migrations/20261012_turnia_verified_payment_activation.sql','utf8');
const checkout=fs.readFileSync(__dirname+'/../supabase/functions/turnia-sandbox-checkout/index.ts','utf8');
const webhook=fs.readFileSync(__dirname+'/../supabase/functions/turnia-sandbox-webhook/index.ts','utf8');
const checkoutMigration=fs.readFileSync(__dirname+'/../supabase/migrations/20261012_turnia_checkout_tracking.sql','utf8');
const wrapperMigration=fs.readFileSync(__dirname+'/../supabase/migrations/20261012_turnia_backend_rpc_wrappers.sql','utf8');
const entry=fs.readFileSync(__dirname+'/../dist/index.html','utf8');

assert(entry.includes('href="registro.html"'),'Signup linked from login');
assert(html.includes('id="password"') && html.includes('id="confirmPassword"'),'Password inputs');
assert(html.includes('registro.js'),'Signup script loaded');
assert(!html.includes('simulateApprove'),'Demo self-approval removed');
assert(!/sb\.functions\.invoke\(|fetch\(/i.test(js),'No network checkout request in browser');
assert(!/insert\s+into\s+public\.propina_access/i.test(migration),'Signup does not grant access');
assert(!/insert\s+into\s+propina_private\.memberships/i.test(migration),'Signup does not create memberships');
assert(migration.includes('pending_payment'),'Pending state required');
assert(migration.includes('valid_self_registration'),'Signup requires validation');
assert(migration.includes('self_registration_enabled boolean NOT NULL DEFAULT FALSE'),'Registration is disabled by default');
assert(migration.includes('automatic_activation_enabled boolean NOT NULL DEFAULT FALSE'),'Activation is disabled by default');
assert(migration.includes('allow_live_activations boolean NOT NULL DEFAULT FALSE'),'Real payments are disabled');
assert(activation.includes('activate_verified_registration'),'Server activation prepared');
assert(activation.includes("COALESCE(auth.role(),'') <> 'service_role'"),'Activation limited to verified service_role');
assert(activation.includes("signup.status <> 'pending_payment'"),'Only pending accounts can be activated');
assert(activation.includes('IF verified.applied_at IS NOT NULL'),'Duplicate payments cannot create another restaurant');
assert(!activation.includes('GRANT EXECUTE ON FUNCTION propina_private.activate_verified_registration(text) TO authenticated'),'Customers cannot activate themselves');
assert(migration.includes('sandbox_checkout_enabled boolean NOT NULL DEFAULT FALSE'),'Checkout disabled by default');
assert(checkout.includes('turnia_prepare_sandbox_checkout'),'Checkout must use verified server RPC');
assert(checkout.includes('seller.email'),'Test seller is required');
assert(checkout.includes('sandbox_init_point'),'Sandbox URL exposed only after provider response');
assert(webhook.includes('crypto.subtle.verify'),'Webhook verifies HMAC');
assert(webhook.includes('payment.live_mode!==false'),'Webhook rejects live payments');
assert(webhook.includes('payment.status!=="approved"'),'Webhook requires approved payment');
assert(webhook.includes('subscription.external_reference'),'Webhook ties payment to registered checkout reference');
assert(webhook.includes('turnia_complete_sandbox_payment'),'Webhook uses server-only RPC');
assert(checkoutMigration.includes('external_reference text NOT NULL UNIQUE'),'Unique attempts');
assert(checkoutMigration.includes("IF attempt.status='completed'"),'Webhook retry is idempotent');
assert(checkoutMigration.includes("'already_active'"),'Repeated payment can succeed without duplicate activation');
assert(checkout.indexOf('Test seller credentials required') < checkout.indexOf('turnia_prepare_sandbox_checkout'),'Seller validated before checkout reservation');
assert(checkout.indexOf('Use a separate Mercado Pago test buyer') < checkout.indexOf('turnia_prepare_sandbox_checkout'),'Buyer validated before checkout reservation');
assert(wrapperMigration.includes("TO service_role"),'Only service can call payment RPC');


const dom=new JSDOM(html,{url:'https://turnia.test/registro.html',runScripts:'outside-only'});
const w=dom.window,d=w.document;
let calls=[],authCalled=0;
w.supabase={createClient:()=>({
 auth:{
   getSession:async()=>({data:{session:null},error:null}),
   signUp:async args=>{authCalled++;calls.push(args);return {data:{user:{id:'test'},session:null},error:null};}
 },
 rpc:async()=>({data:null,error:null})
})};
w.eval(js);
const click=id=>d.getElementById(id).click();
const fill=(id,v)=>{d.getElementById(id).value=v;};
(async()=>{
 fill('firstName','Sofia');fill('lastName','Pérez');fill('email','sofia@example.test');
 fill('phone','+56912345678');fill('password','strong-password-123');fill('confirmPassword','strong-password-123');
 click('next');assert.equal(d.querySelector('.pane:not([hidden])').dataset.stage,'1');
 fill('restaurantName','La Terraza');fill('businessType','Restaurante');fill('city','Copiapo');fill('commune','Copiapo');
 click('next');assert.equal(d.querySelector('.pane:not([hidden])').dataset.stage,'2');
 d.getElementById('acknowledge').checked=true;click('next');assert.equal(d.querySelector('.pane:not([hidden])').dataset.stage,'3');
 click('submitRegistration');await new Promise(r=>setTimeout(r,30));
 assert.equal(authCalled,1);
 assert.equal(calls[0].options.data.turnia_registration,'v1');
 assert.equal(calls[0].options.data.restaurant_name,'La Terraza');
 assert(!('propina_invitation' in calls[0].options.data));
 assert(d.getElementById('status').textContent.includes('pendiente de pago'));
 assert(d.getElementById('payment').hidden,'Checkout stays disabled');
 console.log('PASS: registration form, validation, Supabase Auth payload, pending status and no payments.');
 w.close();
})().catch(e=>{console.error(e);process.exitCode=1;w.close();});
