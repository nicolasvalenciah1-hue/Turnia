// Run with jsdom available on NODE_PATH. No network calls or production data writes.
const {JSDOM} = require('jsdom');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname+'/../dist/index.html','utf8');
const code = fs.readFileSync(__dirname+'/../dist/app.js','utf8');
const flush = () => new Promise(r => setTimeout(r,20));
const date = new Date().toISOString().slice(0,10);
async function app({role='owner', platform=true, restaurant=true, loggedIn=true, completed=true, registered=false}={}) {
  const dom = new JSDOM(html,{url:'https://turnia.test/',runScripts:'outside-only'}), w=dom.window, d=w.document;
  const calls=[]; let capturedBlob; const errors=[];
  w.addEventListener('error',e=>errors.push(e.error));
  const user={id:'test-user',email:'owner@example.test',user_metadata:registered?{turnia_registration:'v1'}:{}};
  let session=loggedIn?{user}:null;
  const context={display_name:'Nicolás Valencia',platform_admin:platform,can_create:platform||!restaurant,restaurants:restaurant?[{id:'r1',name:'Local uno',role},{id:'r2',name:'Local dos',role}]:[]};
  if(completed)w.localStorage.setItem('turnia_guide_v1_test-user',JSON.stringify({done:true,step:9}));
  const data={
    propina_areas:[{id:'a1',name:'Garzones',percentage:100}],
    propina_workers:[{id:'w1',name:'=FORMULA',area_id:'a1',active:true},{id:'w2',name:'Camila',area_id:'a1',active:true}],
    propina_days:[{id:'d1',work_date:'2026-10-01',amount_clp:100000,hours_per_shift:8}],
    propina_shifts:[{day_id:'d1',worker_id:'w1',hours:8},{day_id:'d1',worker_id:'w2',hours:12}],
    propina_daily_distribution:[{day_id:'d1',work_date:'2026-10-01',worker_name:'=FORMULA',area_name:'Garzones',hours:8,percentage:100,calculated_clp:40000},{day_id:'d1',work_date:'2026-10-01',worker_name:'Camila',area_name:'Garzones',hours:12,percentage:100,calculated_clp:60000}]
  };
  let authChange;
  const sb={auth:{
    getSession:async()=>({data:{session}}),
    onAuthStateChange:fn=>{authChange=fn;},
    signInWithPassword:async()=>{session={user};return {data:{session}};},
    signOut:async()=>{session=null;authChange('SIGNED_OUT');return {data:{}};},
    signUp:async args=>{calls.push(['signup',args]);return {data:{}};},
    resetPasswordForEmail:async()=>({data:{}}),updateUser:async args=>{calls.push(['updateUser',args]);return {data:{user}};}
  },rpc:async(name,args)=>{
    calls.push([name,args]);
    if(name==='propina_account_context')return {data:context};
    if(name==='turnia_registration_status')return {data:{status:'pending_payment',restaurant_name:'Restaurante de prueba'}};
    if(name==='turnia_sandbox_checkout_available')return {data:false};
    if(name==='propina_membership_context')return {data:[{restaurant_id:'r1',status:'active',payment_status:'trial',days_remaining:20,expires_at:'2026-11-01'}]};
    if(name==='propina_save_day'){
      data.propina_days.push({id:'d2',work_date:args.p_date,amount_clp:args.p_amount,hours_per_shift:args.p_shift_hours});
      data.propina_daily_distribution.push({day_id:'d2',work_date:args.p_date,worker_name:'Camila',area_name:'Garzones',hours:8,percentage:100,calculated_clp:args.p_amount});
    }
    return {data:{}};
  },from:name=>({select:()=>({eq:async(k,id)=>{calls.push(['query',name,id]);return {data:id==='r1'?structuredClone(data[name]):[]};}})})};
  w.supabase={createClient:()=>sb};
  w.confirm=()=>true; w.URL.createObjectURL=blob=>{capturedBlob=blob;return 'blob:mock';};w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){};
  w.eval(code); await flush();
  return {w,d,calls,errors,dom,authChange,blob:()=>capturedBlob};
}
(async()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]); assert.equal(new Set(ids).size,ids.length,'Unique HTML IDs');
  assert(!code.includes('mercadopago-create-subscription')); assert(!code.includes('propina_renew_membership'),'No self-renewal or charging path');
  const a=await app();
  const css=fs.readFileSync(__dirname+'/../dist/styles.css','utf8');
  const sw=fs.readFileSync(__dirname+'/../dist/sw.js','utf8');
  assert(html.includes('styles.css?v=registro-v1'),'Styles asset is versioned');
  assert(html.includes('app.js?v=sandbox-v1'),'App asset is versioned');
  assert(css.includes('.topbar .top-logout{display:inline-flex!important'),'Logout remains visible');
  assert(sw.includes('turnia-shell-v3'),'App shell cache version bumped');
  assert.equal(a.d.querySelector('#profileName').textContent,'Nicolás Valencia');
  assert(!a.d.querySelector('#ownerNav').classList.contains('hide'));
  for(const name of ['home','daily','distribution','history','staff','access','guide','owner']){
    a.d.querySelector(`[data-tab="${name}"]`).click(); assert(!a.d.getElementById(name).classList.contains('hide'),name+' navigation');
  }
  a.d.querySelector('#historyRows [data-open-date]').click();
  assert.equal(a.d.querySelector('#payouts').children.length,2);
  assert.match(a.d.querySelector('#summary').textContent,/100.000/);
  a.d.querySelector('#historyFrom').value='2026-10-02'; a.d.querySelector('#historyFrom').dispatchEvent(new a.w.Event('change'));
  assert(a.d.querySelector('#export').disabled); a.d.querySelector('#clearHistory').click();
  a.d.querySelector('#export').click(); await flush();
  const csv=await new Promise(r=>{const reader=new a.w.FileReader(); reader.onload=()=>r(reader.result);reader.readAsText(a.blob());});
  assert(csv.includes("'=FORMULA"),'CSV neutralizes formulas'); assert(csv.includes('40000'));
  a.d.querySelector('[data-tab="daily"]').click();
  a.d.querySelector('#date').value=date; a.d.querySelector('#date').dispatchEvent(new a.w.Event('change'));
  a.d.querySelector('#amount').value='120000'; a.d.querySelector('[data-present="w2"]').checked=true;
  a.d.querySelector('#saveDay').click(); await flush();
  const save=a.calls.find(c=>c[0]==='propina_save_day'); assert(save,'Atomic day RPC');
  assert.equal(save[1].p_amount,120000);assert.deepEqual(JSON.parse(JSON.stringify(save[1].p_workers)),[{worker_id:'w2',hours:8}]);
  assert(!a.d.querySelector('#distribution').classList.contains('hide'),'Saved day opens distribution');
  a.d.querySelector('#restaurant').value='r2';a.d.querySelector('#restaurant').dispatchEvent(new a.w.Event('change'));await flush();
  assert(!a.d.querySelector('#payouts').textContent.includes('Camila'),'Restaurant switch clears old data');
  assert(!a.d.querySelector('#membershipCard').textContent.includes('20 días'),'No membership fallback from another restaurant');
  // Both the main topbar and scrolling sidebar must expose sign-out.
  assert.equal(a.d.querySelector('#logoutTop').getAttribute('aria-label'),'Cerrar sesión');
  a.d.querySelector('#logoutTop').click();await flush();
  assert(a.d.querySelector('#app').classList.contains('hide'),'Topbar logout hides app');
  assert(!a.d.querySelector('#auth').classList.contains('hide'),'Topbar logout shows auth screen');
  assert(a.calls.some(call=>call[0]==='signOut')===false || !a.errors.length);
  
  assert.equal(a.errors.length,0);a.dom.window.close();
  const side=await app();
  side.d.querySelector('#logout').click();await flush();
  assert(side.d.querySelector('#app').classList.contains('hide'),'Sidebar logout still works');
  assert(!side.d.querySelector('#auth').classList.contains('hide'));
  side.dom.window.close();
  const b=await app({platform:false,role:'viewer'});
  assert(b.d.querySelector('#saveDay').disabled,'Viewer cannot save');
  assert(b.d.querySelector('#ownerNav').classList.contains('hide'));assert(b.d.querySelector('#staffInvitePanel').classList.contains('hide'));
  assert(!b.d.querySelector('[data-update-area]'));assert(!b.d.querySelector('[data-toggle-worker]'));b.dom.window.close();
  const c=await app({platform:false,restaurant:false,completed:false});
  assert(!c.d.querySelector('#guide').classList.contains('hide'),'Approved new client sees tutorial');
  for(let i=0;i<10;i++)c.d.querySelector('#guideNext').click();
  assert(JSON.parse(c.w.localStorage.getItem('turnia_guide_v1_test-user')).done);
  c.d.querySelector('#acceptToken').value='a'.repeat(64); c.d.querySelector('#acceptInvite').click();await flush();
  assert(!c.d.querySelector('#guide').classList.contains('hide'),'Invite activation opens tutorial');
  assert.equal(c.d.querySelector('#guideProgressText').textContent,'Paso 1 de 10');
  c.authChange('PASSWORD_RECOVERY');assert(!c.d.querySelector('#recovery').classList.contains('hide'));
  c.d.querySelector('#newPassword').value='NewPass1234';c.d.querySelector('#confirmPassword').value='NewPass1234';c.d.querySelector('#savePassword').click();await flush();
  assert(c.calls.some(x=>x[0]==='updateUser'));assert(c.d.querySelector('#recovery').classList.contains('hide'));c.dom.window.close();
  assert(html.includes('href="registro.html"'),'Public registration link is visible');
  assert(html.includes('id="pendingRegistration"'),'Pending UI exists');
  const pending=await app({platform:false,restaurant:false,registered:true});
  assert(!pending.d.querySelector('#pendingRegistration').classList.contains('hide'),'Unpaid customer gets pending screen');
  assert(pending.d.querySelector('#app').classList.contains('hide'),'Unpaid customer cannot access operational panel');
  assert(pending.d.querySelector('#sandboxCheckoutPanel').classList.contains('hide'),'Sandbox payment UI stays hidden while DB flag is off');
  assert(!pending.calls.some(x=>x[0]==='turnia-sandbox-checkout'),'No sandbox checkout request without explicit action');
  pending.d.querySelector('#pendingLogout').click();await flush();
  assert(!pending.d.querySelector('#auth').classList.contains('hide'),'Pending customer can sign out');
  pending.dom.window.close();
  const d=await app({loggedIn:false});assert(!d.d.querySelector('#auth').classList.contains('hide'));assert(d.d.querySelector('#app').classList.contains('hide'));
  d.d.querySelector('#register').click();await flush();assert(!d.d.querySelector('#inviteBox').classList.contains('hide'));d.dom.window.close();
  console.log('PASS: navigation, account name, role controls, save payload, restaurant isolation, history filter, CSV safety, onboarding, recovery and signed-out state. No production writes.');
})().catch(e=>{console.error(e);process.exitCode=1;});
