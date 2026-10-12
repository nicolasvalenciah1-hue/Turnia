// Run with jsdom available on NODE_PATH. No network calls or production data writes.
const {JSDOM} = require('jsdom');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname+'/../dist/index.html','utf8');
const code = fs.readFileSync(__dirname+'/../dist/app.js','utf8');
const flush = () => new Promise(r => setTimeout(r,20));
const date = new Date().toISOString().slice(0,10);
async function app({role='owner', platform=true, restaurant=true, loggedIn=true, completed=true, registered=false, invitationCode='', initialPassword='OldPassword123', restaurantContext={}, rpcOverrides={}, authOverrides={}}={}) {
  const dom = new JSDOM(html,{url:'https://turnia.test/',runScripts:'outside-only'}), w=dom.window, d=w.document;
  const calls=[]; let capturedBlob; const errors=[];
  w.addEventListener('error',e=>errors.push(e.error));
  const user={id:'test-user',email:'owner@example.test',user_metadata:registered?{turnia_registration:'v1'}:invitationCode?{propina_invitation:invitationCode}:{}};
  let session=loggedIn?{user}:null, storedPassword=initialPassword;
  const context={display_name:'Nicolás Valencia',platform_admin:platform,can_create:platform||!restaurant&&!invitationCode,restaurants:restaurant?[{id:'r1',name:'Local uno',role,...restaurantContext},{id:'r2',name:'Local dos',role}]:[]};
  if(completed)w.localStorage.setItem('turnia_guide_v1_test-user',JSON.stringify({done:true,step:9}));
  const data={
    propina_areas:[{id:'a1',name:'Garzones',percentage:100}],
    propina_workers:[{id:'w1',name:'=FORMULA',area_id:'a1',active:true},{id:'w2',name:'Camila',area_id:'a1',active:true}],
    propina_days:[{id:'d1',work_date:'2026-10-01',amount_clp:100000,hours_per_shift:8}],
    propina_shifts:[{day_id:'d1',worker_id:'w1',hours:8},{day_id:'d1',worker_id:'w2',hours:12}],
    propina_flex_shifts:[],propina_flex_payouts:[],
    propina_daily_distribution:[{day_id:'d1',work_date:'2026-10-01',worker_name:'=FORMULA',area_name:'Garzones',hours:8,percentage:100,calculated_clp:40000},{day_id:'d1',work_date:'2026-10-01',worker_name:'Camila',area_name:'Garzones',hours:12,percentage:100,calculated_clp:60000}]
  };
  let business={}, redeemed=false;
  let authChange;
  const sb={auth:{
    getSession:async()=>({data:{session}}),
    onAuthStateChange:fn=>{authChange=fn;},
    signInWithPassword:async args=>{calls.push(['signInWithPassword',args]);if(authOverrides.signInWithPassword)return authOverrides.signInWithPassword(args);if(args.password!==storedPassword)return {error:{message:'Invalid login credentials'}};session={user};return {data:{session}};},
    signOut:async args=>{calls.push(['signOut',args]);session=null;authChange('SIGNED_OUT');return {data:{}};},
    signUp:async args=>{calls.push(['signup',args]);return {data:{}};},
    resend:async args=>{calls.push(['resend',args]);return {data:{}};},resetPasswordForEmail:async()=>({data:{}}),updateUser:async args=>{calls.push(['updateUser',args]);if(authOverrides.updateUser)return authOverrides.updateUser(args);if(args.password)storedPassword=args.password;if(args.data){user.user_metadata={...user.user_metadata,...args.data};context.display_name=args.data.display_name||context.display_name;}return {data:{user}};}
  },rpc:async(name,args)=>{
    calls.push([name,args]);
    if(rpcOverrides[name])return rpcOverrides[name](args);
    if(name==='propina_account_context')return {data:context};
    if(name==='propina_accept_invitation') {
      if(redeemed)return {error:{message:'Invitación ya utilizada.'}};
      redeemed=true;context.can_create=true;
      return {data:{role:'restaurant_owner',restaurant_id:null}};
    }
    if(name==='propina_create_restaurant_with_profile') {
      if(!context.can_create)return {error:{message:'No hay una aprobación pendiente.'}};
      business=args.profile;
      context.restaurants.push({id:'rNew',name:args.restaurant_name,role:'owner'});
      context.can_create=false;
      return {data:'rNew'};
    }
    if(name==='propina_restaurant_business_profile')return {data:business};
    if(name==='propina_update_restaurant_business_profile'){
      const r=context.restaurants.find(r=>r.id===args.rid);
      if(r)r.name=args.restaurant_name;
      business=args.profile;
      return {data:{id:args.rid,name:args.restaurant_name}};
    }
    if(name==='propina_update_restaurant_name'){const r=context.restaurants.find(r=>r.id===args.p_restaurant_id);if(r)r.name=args.p_name;return {data:{id:args.p_restaurant_id,name:args.p_name}};}
    if(name==='turnia_registration_status')return {data:{status:'pending_payment',restaurant_name:'Restaurante de prueba'}};
    if(name==='turnia_sandbox_checkout_available')return {data:false};
    if(name==='propina_membership_context')return {data:[{restaurant_id:'r1',status:'active',payment_status:'trial',days_remaining:20,expires_at:'2026-11-01'}]};
    if(name==='propina_save_flex_shift'){
      const rules=args.p_modes.map(m=>({...m,area_name:'Garzones',percentage:100}));
      const entries=args.p_entries.map(e=>({...e,worker_name:e.worker_id==='w2'?'Camila':'=FORMULA',area_id:'a1'}));
      data.propina_flex_shifts=data.propina_flex_shifts.filter(s=>s.work_date!==args.p_date||s.shift_code!==args.p_shift);
      data.propina_flex_shifts.push({id:'flex1',restaurant_id:'r1',work_date:args.p_date,shift_code:args.p_shift,amount_clp:args.p_amount,rules,entries});
      data.propina_flex_payouts=[{restaurant_id:'r1',work_date:args.p_date,group_code:args.p_shift,worker_id:entries[0].worker_id,worker_name:entries[0].worker_name,area_id:'a1',area_name:'Garzones',weight:entries[0].weight,calculated_clp:args.p_amount}];
      return {data:'flex1'};
    }
    if(name==='propina_save_day'){
      data.propina_days.push({id:'d2',work_date:args.p_date,amount_clp:args.p_amount,hours_per_shift:args.p_shift_hours});
      data.propina_daily_distribution.push({day_id:'d2',work_date:args.p_date,worker_name:'Camila',area_name:'Garzones',hours:8,percentage:100,calculated_clp:args.p_amount});
    }
    return {data:{}};
  },from:name=>({select:()=>({eq:async(k,id)=>{calls.push(['query',name,id]);return {data:id==='r1'?structuredClone(data[name]):[]};}})})};
  w.TextEncoder = TextEncoder;
  w.supabase={createClient:()=>sb};
  w.confirm=()=>true; w.URL.createObjectURL=blob=>{capturedBlob=blob;return 'blob:mock';};w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){};
  w.eval(code); await flush();
  return {w,d,calls,errors,dom,authChange,sb,user,context,blob:()=>capturedBlob};
}
if (require.main === module) (async()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]); assert.equal(new Set(ids).size,ids.length,'Unique HTML IDs');
  assert(!code.includes('mercadopago-create-subscription')); assert(!code.includes('propina_renew_membership'),'No self-renewal or charging path');
  const a=await app();
  const css=fs.readFileSync(__dirname+'/../dist/styles.css','utf8');
  const sw=fs.readFileSync(__dirname+'/../dist/sw.js','utf8');
  assert(html.includes('styles.css?v=historial-unificado-20261012-2'),'Styles asset is versioned');
  assert(html.includes('app.js?v=historial-unificado-20261012-2'),'App asset is versioned');
  assert(css.includes('.topbar .top-logout{display:inline-flex!important'),'Logout remains visible');
  assert(sw.includes('turnia-shell-v7'),'App shell cache version bumped');
  assert.equal(a.d.querySelector('#profileName').textContent,'Nicolás Valencia');
  // Personal settings can be used by every logged-in user.
  a.d.querySelector('[data-tab="access"]').click();
  assert.equal(a.d.querySelector('#accountDisplayName').value,'Nicolás Valencia');
  assert(a.d.querySelector('#accountEmailReadonly').readOnly);
  a.d.querySelector('#accountDisplayName').value='Camila Sánchez';
  a.d.querySelector('#accountPhone').value='+56 9 4444 4444';
  a.d.querySelector('#saveAccountProfile').click();await flush();
  assert(a.calls.some(x=>x[0]==='updateUser' && x[1].data?.display_name==='Camila Sánchez' && x[1].data?.phone==='+56 9 4444 4444'),'Profile saved using authenticated Supabase Auth');
  assert.equal(a.d.querySelector('#profileName').textContent,'Camila Sánchez');
  a.d.querySelector('#currentAccountPassword').value='OldPassword123';
  a.d.querySelector('#nextAccountPassword').value='NewPassword123';
  a.d.querySelector('#nextAccountPasswordConfirm').value='NewPassword123';
  a.d.querySelector('#changeAccountPassword').click();await flush();
  assert(a.calls.some(x=>x[0]==='signInWithPassword' && x[1].password==='OldPassword123'),'Current password checked on server');
  assert(a.calls.some(x=>x[0]==='updateUser' && x[1].password==='NewPassword123'),'Password update through Supabase Auth');
  assert.equal(a.d.querySelector('#currentAccountPassword').value,'','Old password is cleared after success');
  a.d.querySelector('#restaurantEditName').value='Restaurante Nuevo';
  a.d.querySelector('#saveRestaurantDetails').click();await flush();
  assert(a.calls.some(x=>x[0]==='propina_update_restaurant_business_profile' && x[1].rid==='r1' && x[1].restaurant_name==='Restaurante Nuevo'),'Restaurant updated via owner RPC');
  assert.equal(a.d.querySelector('#restaurant').selectedOptions[0].textContent,'Restaurante Nuevo','Renamed restaurant appears in selector');

  assert(!a.d.querySelector('#ownerNav').classList.contains('hide'));
  for(const name of ['home','daily','distribution','history','staff','access','guide','owner']){
    a.d.querySelector(`[data-tab="${name}"]`).click(); assert(!a.d.getElementById(name).classList.contains('hide'),name+' navigation');
  }
  a.d.querySelector('[data-tab="daily"]').click();
  a.d.querySelector('#dayEntryMode').value='flex';
  a.d.querySelector('#dayEntryMode').dispatchEvent(new a.w.Event('change'));
  assert(!a.d.querySelector('#flex').classList.contains('hide'),'AM/PM mode appears inside Registrar propinas');
  assert(a.d.querySelector('#classicDayPanel').classList.contains('hide'),'Classic form hidden while AM/PM selected');
  a.d.querySelector('#dayEntryMode').value='classic';
  a.d.querySelector('#dayEntryMode').dispatchEvent(new a.w.Event('change'));
  assert(!a.d.querySelector('#classicDayPanel').classList.contains('hide'),'Classic mode restored');
  assert(a.d.querySelector('[data-tab="flex"]')===null,'Duplicate AM/PM navigation item was removed');
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
  assert.match(a.d.querySelector('#daySaveStatus').textContent,/guardada correctamente/i,'Save must be confirmed next to the form');
  assert(a.d.querySelector('#historyRows').textContent.includes('Jornada completa'),'Classic day appears in unified history');
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
  assert(b.d.querySelector('#saveFlexShift').disabled,'Viewer cannot save AM/PM shifts');
  assert(b.d.querySelector('#saveRestaurantDetails').disabled,'Viewer cannot rename restaurant');
  assert(b.d.querySelector('#restaurantEditName').disabled,'Viewer cannot edit restaurant field');
  assert(!b.d.querySelector('#saveAccountProfile').disabled,'Viewer can update own personal profile');

  assert(b.d.querySelector('#ownerNav').classList.contains('hide'));assert(b.d.querySelector('#staffInvitePanel').classList.contains('hide'));
  assert(!b.d.querySelector('[data-update-area]'));assert(!b.d.querySelector('[data-toggle-worker]'));b.dom.window.close();
  const c=await app({platform:false,restaurant:false,completed:false});
  assert(!c.d.querySelector('#restaurantSetup').classList.contains('hide'),'Approved client goes straight to restaurant setup');
  assert(c.d.querySelector('#app').classList.contains('hide'),'Operational app stays closed until restaurant exists');
  c.d.querySelector('#setupRestaurantName').value='Restaurante Piloto';
  c.d.querySelector('#setupCity').value='Copiapó';
  c.d.querySelector('#setupRegion').value='Atacama';
  c.d.querySelector('#setupPhone').value='+56 9 5555 5555';
  c.d.querySelector('#completeRestaurantSetup').click();await flush();
  assert(c.calls.some(x=>x[0]==='propina_create_restaurant_with_profile' && x[1].profile.city==='Copiapó'),'Onboarding creates restaurant with contact details atomically');
  assert(!c.d.querySelector('#guide').classList.contains('hide'),'New restaurant goes to onboarding guide');
  for(let i=0;i<10;i++)c.d.querySelector('#guideNext').click();
  assert(JSON.parse(c.w.localStorage.getItem('turnia_guide_v1_test-user')).done);
  assert(c.context.restaurants.some(r=>r.name==='Restaurante Piloto'),'Approved restaurant is visible to its owner');
  c.d.querySelector('#restartGuide').click();
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
  d.d.querySelector('#email').value='test-recipient@example.test';
  d.d.querySelector('#resendConfirmation').click();await flush();
  assert(d.calls.some(x=>x[0]==='resend' && x[1].type==='signup' && x[1].email==='test-recipient@example.test' && x[1].options.emailRedirectTo==='https://turnia.test/'),'Confirmation resend uses the existing address and site URL');
  d.d.querySelector('#register').click();await flush();assert(!d.d.querySelector('#inviteBox').classList.contains('hide'));d.dom.window.close();


  // Independent AM/PM mode: enforce a recorded agreement for weighted participants.
  const flex=await app({platform:false,role:'owner'});
  flex.d.querySelector('[data-tab="daily"]').click();
  flex.d.querySelector('#dayEntryMode').value='flex';
  flex.d.querySelector('#dayEntryMode').dispatchEvent(new flex.w.Event('change'));
  flex.d.querySelector('#flexDate').value='2026-10-09';
  flex.d.querySelector('#flexDate').dispatchEvent(new flex.w.Event('change'));
  flex.d.querySelector('#flexAmount').value='1001';
  flex.d.querySelector('[data-flex-mode="a1"]').value='daily_unique';
  const present=flex.d.querySelector('[data-flex-present="w2"]');
  present.checked=true;
  flex.d.querySelector('[data-flex-weight="w2"]').value='0.25';
  flex.d.querySelector('#saveFlexShift').click();await flush();
  assert(!flex.calls.some(x=>x[0]==='propina_save_flex_shift'),'Special share without agreement must be blocked');
  assert.match(flex.d.querySelector('#message').textContent,/acuerdo/i);
  flex.d.querySelector('[data-flex-agreed="w2"]').checked=true;
  flex.d.querySelector('[data-flex-note="w2"]').value='Aprobado por el equipo para el trabajador en prueba';
  flex.d.querySelector('#saveFlexShift').click();await flush();
  const flexSave=flex.calls.find(x=>x[0]==='propina_save_flex_shift');
  assert(flexSave,'AM/PM saved via dedicated server RPC');
  assert.equal(flexSave[1].p_shift,'AM');
  assert.equal(flexSave[1].p_amount,1001);
  assert.deepEqual(JSON.parse(JSON.stringify(flexSave[1].p_modes)),[{area_id:'a1',mode:'daily_unique'}]);
  assert.equal(flexSave[1].p_entries[0].weight,0.25);
  assert(flexSave[1].p_entries[0].agreed);
  assert.equal(flex.d.querySelector('#flexPayoutRows').children.length,1,'Flexible payout loads after save');
  assert(flex.d.querySelector('#historyRows [data-open-flex-date="2026-10-09"]'),'Flexible shift appears in unified history');
  flex.d.querySelector('#historyRows [data-open-flex-date="2026-10-09"]').click();
  assert.equal(flex.d.querySelector('#flexDate').value,'2026-10-09');
  assert.equal(flex.d.querySelector('#dayEntryMode').value,'flex','Unified history opens saved AM/PM mode');
  const beforeClassic = flex.calls.filter(x=>x[0]==='propina_save_day').length;
  flex.d.querySelector('#dayEntryMode').value='classic';
  flex.d.querySelector('#dayEntryMode').dispatchEvent(new flex.w.Event('change'));
  flex.d.querySelector('#date').value='2026-10-09';
  flex.d.querySelector('#date').dispatchEvent(new flex.w.Event('change'));
  flex.d.querySelector('#amount').value='1001';
  flex.d.querySelector('[data-present="w2"]').checked=true;
  flex.d.querySelector('#saveDay').click(); await flush();
  assert.equal(flex.calls.filter(x=>x[0]==='propina_save_day').length,beforeClassic,'Cannot save full day over a flexible turn');
  assert.match(flex.d.querySelector('#daySaveStatus').textContent,/no se guardó.*AM\/PM/i,'Conflict shown beside save button');
  assert(!flex.calls.some(x=>x[0]==='propina_save_day'),'Flexible saves cannot overwrite classic days');
  flex.d.querySelector('#flexDate').value='2026-10-01';
  flex.d.querySelector('#flexDate').dispatchEvent(new flex.w.Event('change'));
  flex.d.querySelector('#flexAmount').value='1000';
  flex.d.querySelector('[data-flex-present="w2"]').checked=true;
  const savedCount=flex.calls.filter(x=>x[0]==='propina_save_flex_shift').length;
  flex.d.querySelector('#saveFlexShift').click();await flush();
  assert.equal(flex.calls.filter(x=>x[0]==='propina_save_flex_shift').length,savedCount,'Cannot duplicate an existing classic date');
  flex.dom.window.close();


  // A token from verified signup is redeemed automatically, exactly once,
  // then the customer is taken to restaurant setup without copying it again.
  const invited=await app({platform:false,restaurant:false,invitationCode:'a'.repeat(64)});
  assert.equal(invited.calls.filter(x=>x[0]==='propina_accept_invitation').length,1,'Signed-up invitation is redeemed once');
  assert.equal(invited.calls.find(x=>x[0]==='propina_accept_invitation')[1].token,'a'.repeat(64));
  assert(!invited.d.querySelector('#restaurantSetup').classList.contains('hide'),'Invited customer sees restaurant setup');
  assert.equal(invited.user.user_metadata.propina_invitation,null,'Redeemed code removed from account metadata');
  await invited.w.eval('void 0');
  assert.equal(invited.calls.filter(x=>x[0]==='propina_accept_invitation').length,1,'No automatic second redemption');
  invited.dom.window.close();

  // A legacy confirmed user without token can activate a single-use code.
  const legacy=await app({platform:false,role:'viewer',restaurant:false,invitationCode:'invalid'});
  assert(!legacy.d.querySelector('#inviteActivation').classList.contains('hide'),'Legacy account can paste activation code');
  legacy.d.querySelector('#activationToken').value='b'.repeat(64);
  legacy.d.querySelector('#activateInvitation').click();await flush();
  assert(legacy.calls.some(x=>x[0]==='propina_accept_invitation'&&x[1].token==='b'.repeat(64)));
  assert(!legacy.d.querySelector('#restaurantSetup').classList.contains('hide'),'Legacy owner activation proceeds to setup');
  legacy.dom.window.close();

  // Password change is accepted only when the supplied current password is valid.
  const invalidCurrent=await app({platform:false,role:'owner'});
  invalidCurrent.d.querySelector('[data-tab="access"]').click();
  invalidCurrent.d.querySelector('#currentAccountPassword').value='WrongPassword123';
  invalidCurrent.d.querySelector('#nextAccountPassword').value='SafeNewPassword123';
  invalidCurrent.d.querySelector('#nextAccountPasswordConfirm').value='SafeNewPassword123';
  invalidCurrent.d.querySelector('#changeAccountPassword').click();await flush();
  assert(!invalidCurrent.calls.some(x=>x[0]==='updateUser' && x[1].password),'Wrong current password must never update the account');
  assert.match(invalidCurrent.d.querySelector('#settingsStatus').textContent,/no coinciden/i);
  invalidCurrent.dom.window.close();

  // Change password, sign out, reject the old password and sign in again with the new one.
  const relog=await app({platform:false,role:'owner'});
  relog.d.querySelector('[data-tab="access"]').click();
  relog.d.querySelector('#currentAccountPassword').value='OldPassword123';
  relog.d.querySelector('#nextAccountPassword').value='ValidNewPassword123';
  relog.d.querySelector('#nextAccountPasswordConfirm').value='ValidNewPassword123';
  relog.d.querySelector('#changeAccountPassword').click();await flush();
  assert(!relog.d.querySelector('#testPasswordLogin').classList.contains('hide'),'Show a manual login verification after password update');
  relog.d.querySelector('#testPasswordLogin').click();await flush();
  assert(!relog.d.querySelector('#auth').classList.contains('hide'),'Password verification first signs out');
  assert.equal(relog.d.querySelector('#email').value,'owner@example.test');
  relog.d.querySelector('#password').value='OldPassword123';
  relog.d.querySelector('#loginForm').dispatchEvent(new relog.w.Event('submit',{bubbles:true,cancelable:true}));await flush();
  assert.match(relog.d.querySelector('#authMessage').textContent,/no coinciden/i,'Old password must be rejected');
  assert(relog.d.querySelector('#app').classList.contains('hide'),'Wrong password does not enter the app');
  relog.d.querySelector('#password').value='ValidNewPassword123';
  relog.d.querySelector('#loginForm').dispatchEvent(new relog.w.Event('submit',{bubbles:true,cancelable:true}));await flush();
  assert(!relog.d.querySelector('#app').classList.contains('hide'),'New password signs in successfully');
  assert.equal(relog.context.restaurants.length,2,'All restaurant memberships survive password changes');
  assert(!relog.calls.some(x=>x[0]==='propina_save_day'),'Password regression test does not write any tips');
  relog.dom.window.close();

  // Role access: admins may edit shifts but cannot change ownership or team members.
  const admin=await app({platform:false,role:'admin'});
  assert(!admin.d.querySelector('#saveDay').disabled,'Restaurant administrator can save a shift');
  assert(admin.d.querySelector('#teamAccessPanel').classList.contains('hide'),'Admin cannot manage owner-only access');
  assert(admin.d.querySelector('#workerLinkPanel').classList.contains('hide'),'Admin cannot link worker accounts');
  assert(admin.d.querySelector('#saveRestaurantDetails').disabled,'Admin cannot rename owner restaurant');
  admin.dom.window.close();

  // Personal-only workers can view personal tips but cannot fetch everyone else's shifts.
  const worker=await app({platform:false,role:'viewer',restaurantContext:{read_scope:'personal',worker_id:'w1',worker_name:'Test Worker'},rpcOverrides:{propina_my_tips:async()=>({data:[{work_date:'2026-10-01',hours:8,calculated_clp:40000}]})}});
  assert(!worker.d.querySelector('#mytips').classList.contains('hide'),'Personal-only worker gets their own tab');
  assert(worker.d.querySelector('#teamAccessPanel').classList.contains('hide'));
  assert(worker.d.querySelector('#staff').classList.contains('hide'));
  assert(!worker.calls.some(x=>x[0]==='query'),'Personal-only worker does not query shared tables');
  assert(worker.calls.some(x=>x[0]==='propina_my_tips'),'Personal-only worker uses scoped server RPC');
  assert(worker.d.querySelector('#saveDay').disabled,'Personal-only worker cannot change shifts');
  worker.dom.window.close();

  console.log('PASS: navigation, account name, role controls, save payload, restaurant isolation, history filter, CSV safety, onboarding, recovery and signed-out state. Role isolation and password re-login tested with mocks. No production writes.');
})().catch(e=>{console.error(e);process.exitCode=1;});

module.exports = {app, flush};
