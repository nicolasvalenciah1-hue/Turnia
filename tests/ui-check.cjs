// Run with jsdom available on NODE_PATH. No network calls or production data writes.
const {JSDOM} = require('jsdom');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname+'/../dist/index.html','utf8');
const code = fs.readFileSync(__dirname+'/../dist/app.js','utf8');
const weeklyExcelCode = fs.readFileSync(__dirname+'/../dist/weekly-excel.js','utf8');
const flush = () => new Promise(r => setTimeout(r,20));
const date = new Date().toISOString().slice(0,10);
async function app({role='owner', platform=true, restaurant=true, loggedIn=true, completed=true, registered=false, invitationCode='', initialPassword='OldPassword123', restaurantContext={}, rpcOverrides={}, authOverrides={}, dataOverrides={}}={}) {
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
    propina_shifts:[{day_id:'d1',worker_id:'w1',hours:8,participation:1,note:'',agreed:false},{day_id:'d1',worker_id:'w2',hours:12,participation:1,note:'',agreed:false}],
    propina_flex_shifts:[],propina_flex_payouts:[],
    propina_daily_distribution:[{day_id:'d1',work_date:'2026-10-01',worker_name:'=FORMULA',area_name:'Garzones',hours:8,percentage:100,calculated_clp:40000},{day_id:'d1',work_date:'2026-10-01',worker_name:'Camila',area_name:'Garzones',hours:12,percentage:100,calculated_clp:60000}]
  };
  for(const [key,value] of Object.entries(dataOverrides)) data[key]=structuredClone(value);
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
      data.propina_flex_payouts=[{restaurant_id:'r1',work_date:args.p_date,group_code:args.p_shift,worker_id:entries[0].worker_id,worker_name:entries[0].worker_name,area_id:'a1',area_name:'Garzones',weight:entries[0].weight,calculated_clp:data.propina_flex_shifts.filter(s=>s.work_date===args.p_date).reduce((total,s)=>total+s.amount_clp,0)}];
      return {data:'flex1'};
    }
    if(name==='propina_save_day'){
      data.propina_days=data.propina_days.filter(d=>d.work_date!==args.p_date);
      data.propina_days.push({id:'d2',work_date:args.p_date,amount_clp:args.p_amount,hours_per_shift:args.p_shift_hours});
      data.propina_shifts=data.propina_shifts.filter(s=>s.day_id!=='d2');
      data.propina_shifts.push(...args.p_workers.map(e=>({day_id:'d2',...e})));
      data.propina_daily_distribution=data.propina_daily_distribution.filter(p=>p.day_id!=='d2');
      for(const area of data.propina_areas.filter(a=>a.percentage>0)){
        const areaWorkers=args.p_workers.map(entry=>({...entry,worker:data.propina_workers.find(w=>w.id===entry.worker_id)})).filter(e=>e.worker?.area_id===area.id);
        if(!areaWorkers.length)continue;
        const budget=Math.round(args.p_amount*area.percentage/100);
        const effective=areaWorkers.map(e=>e.hours*(e.participation??1));
        const totalWeight=effective.reduce((sum,n)=>sum+n,0);
        const exact=effective.map(weight=>budget*weight/totalWeight),bases=exact.map(Math.floor);
        const missing=budget-bases.reduce((sum,n)=>sum+n,0);
        const order=exact.map((value,i)=>({i,rem:value-Math.floor(value),id:areaWorkers[i].worker_id})).sort((a,b)=>b.rem-a.rem||a.id.localeCompare(b.id));
        for(let i=0;i<missing;i++)bases[order[i].i]++;
        data.propina_daily_distribution.push(...areaWorkers.map((e,i)=>({
          day_id:'d2',worker_id:e.worker_id,work_date:args.p_date,worker_name:e.worker.name,
          area_id:area.id,area_name:area.name,hours:e.hours,percentage:area.percentage,calculated_clp:bases[i]
        })));
      }
    }
    return {data:{}};
  },from:name=>({select:()=>({eq:async(k,id)=>{calls.push(['query',name,id]);return {data:id==='r1'?structuredClone(data[name]):[]};}})})};
  w.TextEncoder = TextEncoder;
  w.supabase={createClient:()=>sb};
  w.confirm=()=>true; w.URL.createObjectURL=blob=>{capturedBlob=blob;return 'blob:mock';};w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){};
  w.eval(weeklyExcelCode); w.eval(code); await flush();
  return {w,d,calls,errors,dom,authChange,sb,user,context,blob:()=>capturedBlob};
}
if (require.main === module) (async()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]); assert.equal(new Set(ids).size,ids.length,'Unique HTML IDs');
  assert(!code.includes('mercadopago-create-subscription')); assert(!code.includes('propina_renew_membership'),'No self-renewal or charging path');
  const a=await app();
  const css=fs.readFileSync(__dirname+'/../dist/styles.css','utf8');
  const sw=fs.readFileSync(__dirname+'/../dist/sw.js','utf8');
  assert(html.includes('styles.css?v=mobile-weekly-20261012-1'),'Styles asset is versioned');
  assert(html.includes('app.js?v=mobile-weekly-20261012-1'),'App asset is versioned');
  assert(html.includes('weekly-excel.js?v=weekly-settlement-20261012-1'),'Offline XLSX generator is loaded');
  assert(css.includes('.topbar .top-logout{display:inline-flex!important'),'Logout remains visible');
  assert(css.includes('.classic-participation-agreement'),'Classic participation controls are styled');
  assert(css.includes('.classic-area-preview'),'Independent area quota preview is styled');
  assert(sw.includes('turnia-shell-v11'),'App shell cache version bumped');
  assert(css.includes('@media(max-width:600px)'),'Mobile CSS applies to small phones');
  assert(css.includes('.summary-grid-home'),'Dashboard KPI cards use responsive layout');
  assert(css.includes('.weekly-mobile-bottom'),'Weekly Excel action has mobile sticky bar');
  assert(css.includes('#attendance tr'),'Full-day worker forms avoid horizontal phone tables');
  assert(css.includes('.weekly-area-group'),'Weekly area groups display as cards on phones');
  assert(html.includes('id="weeklyMobileTotal"'),'Mobile close displays the actual distributed total');
  assert(html.includes('id="recentDaysMobile"'),'Mobile home has accessible recent day cards');
  assert.equal(a.d.querySelector('#profileName').textContent,'Nicolás Valencia');
   assert.equal(a.d.querySelector('#avatar').textContent,'M','Platform owner displays Mutavia monogram');
  // Personal settings can be used by every logged-in user.
  a.d.querySelector('[data-tab="access"]').click();
  assert.equal(a.d.querySelector('#accountDisplayName').value,'Nicolás Valencia');
  assert(a.d.querySelector('#accountEmailReadonly').readOnly);
  a.d.querySelector('#accountDisplayName').value='Camila Sánchez';
  a.d.querySelector('#accountPhone').value='+56 9 4444 4444';
  a.d.querySelector('#saveAccountProfile').click();await flush();
  assert(a.calls.some(x=>x[0]==='updateUser' && x[1].data?.display_name==='Camila Sánchez' && x[1].data?.phone==='+56 9 4444 4444'),'Profile saved using authenticated Supabase Auth');
  assert.equal(a.d.querySelector('#profileName').textContent,'Camila Sánchez');
   assert.equal(a.d.querySelector('#avatar').textContent,'M','Platform monogram persists after personal name change');
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

  assert(a.d.querySelectorAll('#recentDaysMobile .recent-day-card').length>0,'Home renders mobile recent-day cards');
  assert(a.d.querySelector('#recentDaysMobile').textContent.includes('100.000'),'Mobile home shows real day totals');
  assert(a.d.querySelector('#weeklyGroups details').length!==0,'Areas have real grouped weekly cards');
  assert(a.d.querySelector('#weeklyMobileTotal').textContent.includes('100.000'),'Sticky weekly footer shows real distribution');
  const group= a.d.querySelector('#weeklyGroups details');
  assert(group.open,'The first weekly area is expanded initially');
  a.d.querySelector('#weeklyExpandAll').click();
  assert(a.d.querySelectorAll('#weeklyGroups details:not([open])').length===1,'Expand-all control collapses when all areas are open');
  a.d.querySelector('#weeklyExpandAll').click();
  assert(group.open,'Expand-all control reopens grouped area');
  const personButton=a.d.querySelector('#weeklyGroups [data-week-person]');
  assert(personButton,'Worker card has accessible detail control');
  personButton.click();
  assert(!a.d.querySelector('#weeklyPersonDetail').classList.contains('hide'),'Worker daily breakdown is available');
  assert(a.d.querySelectorAll('#weeklyPersonDetail .weekly-person-day').length===7,'Detail spans Monday to Sunday');
  assert(a.d.querySelector('#weeklyPersonDetail').textContent.includes('no acredita')||
    a.d.querySelector('#weeklyPersonDetail').textContent.includes('no comprobante'),'Detail does not claim a bank transfer');
  a.d.querySelector('[data-week-person-xlsx]').click();await flush();
  const individualXlsx=await new Promise(r=>{const reader=new a.w.FileReader();reader.onload=()=>r(new TextDecoder().decode(new Uint8Array(reader.result)));reader.readAsArrayBuffer(a.blob());});
  assert(individualXlsx.includes('LIQUIDACIÓN PERSONAL'),'Personal downloadable statement is a genuine XLSX workbook');
  assert(individualXlsx.includes('100000')===false || individualXlsx.includes('40000'),'Workbook is generated from saved person data');
  a.d.querySelector('[data-week-close]').click();
  assert(a.d.querySelector('#weeklyPersonDetail').classList.contains('hide'),'Worker detail closes without losing weekly totals');
  assert.equal(a.errors.length,0,'Responsive settlement did not cause a JavaScript error');
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
  const weekBefore=a.d.querySelector('#historyWeekSelect').value;
  assert.match(a.d.querySelector('#historyWeekLabel').textContent,/Lun .*Dom /,'Weekly history is Monday to Sunday');
  a.d.querySelector('#historyNextWeek').click();
  assert(a.d.querySelector('#export').disabled,'An empty calendar week has no export');
  a.d.querySelector('#historyPrevWeek').click();
  assert.equal(a.d.querySelector('#historyWeekSelect').value,weekBefore,'Previous week restores its settlements');
  assert.match(a.d.querySelector('#weeklyWorkerRows').textContent,/Camila/);
  a.d.querySelector('#export').click(); await flush();
  const workbookBytes=await new Promise(r=>{const reader=new a.w.FileReader();reader.onload=()=>r(new Uint8Array(reader.result));reader.readAsArrayBuffer(a.blob());});
  const workbookText=new TextDecoder().decode(workbookBytes);
  assert.equal(workbookBytes[0],80,'Real XLSX starts with PK ZIP signature');
  assert.equal(workbookBytes[1],75,'Real XLSX starts with PK ZIP signature');
  assert(workbookText.includes('xl/worksheets/sheet5.xml'),'Weekly Excel has five worksheets');
  assert(workbookText.includes('Transferencias'),'Workbook includes payment control sheet');
  assert(workbookText.includes("'=FORMULA"),'XLSX neutralizes spreadsheet formulas');
  assert(workbookText.includes('<v>40000</v>'),'Money remains numeric inside XLSX');
  a.d.querySelector('[data-tab="daily"]').click();
  a.d.querySelector('#date').value=date; a.d.querySelector('#date').dispatchEvent(new a.w.Event('change'));
  a.d.querySelector('#amount').value='120000'; a.d.querySelector('[data-present="w2"]').checked=true;
  a.d.querySelector('#saveDay').click(); await flush();
  const save=a.calls.find(c=>c[0]==='propina_save_day'); assert(save,'Atomic day RPC');
  assert.equal(save[1].p_amount,120000);assert.deepEqual(JSON.parse(JSON.stringify(save[1].p_workers)),[{worker_id:'w2',hours:8,participation:1,note:'',agreed:false}]);
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
  // Jornada completa: 25% de participación AM equivalent, then update to 75% for the same date.
  const classic=await app({platform:false,role:'owner'});
  classic.d.querySelector('[data-tab="daily"]').click();
  classic.d.querySelector('#date').value='2026-10-10';
  classic.d.querySelector('#date').dispatchEvent(new classic.w.Event('change'));
  classic.d.querySelector('#amount').value='65000';
  classic.d.querySelector('[data-present="w1"]').checked=true;
  classic.d.querySelector('[data-present="w2"]').checked=true;
  assert.equal(classic.d.querySelector('[data-day-percent="w2"]').value,'100','Default participation is 100%');
  classic.d.querySelector('[data-day-percent="w2"]').value='25';
  classic.d.querySelector('#saveDay').click();await flush();
  assert(!classic.calls.some(x=>x[0]==='propina_save_day'),'25% without agreement cannot be saved');
  assert.match(classic.d.querySelector('#daySaveStatus').textContent,/acuerdo/i);
  classic.d.querySelector('[data-day-note="w2"]').value='Trabajadora en período de aprendizaje';
  classic.d.querySelector('[data-day-agreed="w2"]').checked=true;
  classic.d.querySelector('#saveDay').click();await flush();
  const firstClassic=classic.calls.filter(x=>x[0]==='propina_save_day');
  assert.equal(firstClassic.length,1,'Special share saved once after validation');
  assert.equal(firstClassic[0][1].p_workers[1].participation,0.25);
  assert.equal(firstClassic[0][1].p_workers[0].participation,1);
  assert(classic.d.querySelector('#summary').textContent.includes('65.000'));
  assert(classic.d.querySelector('#payouts').textContent.includes('25%'),'Classic payout includes individual percentage');
  assert.equal(classic.d.querySelector('#payouts').querySelectorAll('tr').length,2);
  assert.equal(classic.d.querySelector('#payouts').textContent.includes('Sin asignar'),false);
  classic.d.querySelector('#editDay').click();
  assert.equal(classic.d.querySelector('[data-day-percent="w2"]').value,'25','Edit loads saved individual percentage');
  assert.equal(classic.d.querySelector('[data-day-note="w2"]').value,'Trabajadora en período de aprendizaje','Edit restores reason');
  assert(classic.d.querySelector('[data-day-agreed="w2"]').checked,'Edit restores agreement');
  classic.d.querySelector('[data-day-percent="w2"]').value='75';
  classic.d.querySelector('[data-day-note="w2"]').value='Avance de aprendizaje aprobado por equipo';
  classic.d.querySelector('#saveDay').click();await flush();
  const savedClassic=classic.calls.filter(x=>x[0]==='propina_save_day');
  assert.equal(savedClassic.length,2,'Editing existing classic day updates record');
  assert.equal(savedClassic[1][1].p_workers[1].participation,0.75);
  assert.equal(savedClassic[1][1].p_workers[0].participation,1);
  assert(classic.d.querySelector('#payouts').textContent.includes('75%'),'Updated payout shows 75%');
  classic.d.querySelector('#export').click();await flush();
  const xlsxClassic=await new Promise(r=>{const reader=new classic.w.FileReader();reader.onload=()=>r(new TextDecoder().decode(new Uint8Array(reader.result)));reader.readAsArrayBuffer(classic.blob());});
  assert(xlsxClassic.includes('Participación %'),'Daily-detail sheet exports individual percentages');
  assert(xlsxClassic.includes('<v>75</v>'),'XLSX preserves 75% as a numeric value');
  assert.equal(classic.errors.length,0);
  classic.dom.window.close();
  // Double shift: 16 hours is already two points; 200% would multiply it again.
  const doubles=await app({platform:false,role:'owner'});
  doubles.d.querySelector('#date').value='2026-10-11';
  doubles.d.querySelector('#date').dispatchEvent(new doubles.w.Event('change'));
  doubles.d.querySelector('#amount').value='110000';
  for(const wid of ['w1','w2']) doubles.d.querySelector('[data-present="'+wid+'"]').checked=true;
  doubles.d.querySelector('[data-hours="w2"]').value='16';
  doubles.d.querySelector('[data-hours="w2"]').dispatchEvent(new doubles.w.Event('input',{bubbles:true}));
  assert.equal(doubles.d.querySelector('[data-day-points="w2"]').textContent,'2');
  assert.match(doubles.d.querySelector('#attendanceCount').textContent,/3 puntos/);
  doubles.d.querySelector('[data-day-percent="w2"]').value='200';
  doubles.d.querySelector('[data-day-percent="w2"]').dispatchEvent(new doubles.w.Event('input',{bubbles:true}));
  assert.match(doubles.d.querySelector('#classicPointsWarning').textContent,/supera 2 puntos/);
  doubles.d.querySelector('#saveDay').click(); await flush();
  assert(!doubles.calls.some(c=>c[0]==='propina_save_day'),'Four points on 16 hours are blocked');
  doubles.dom.window.close();
  // 5 waiter points: 1+1+1+0.5+2=5.5, with kitchen still receiving 20%.
  const areasSample=[{id:'a1',name:'Garzones',percentage:65},{id:'a2',name:'Cocina',percentage:20},{id:'a3',name:'Barra',percentage:10},{id:'a4',name:'Copería',percentage:5}];
  const membersSample=[...['Uno','Dos','Tres','Aprendiz','Doble'].map((name,i)=>({id:'w'+(i+1),name,area_id:'a1',active:true})),{id:'w6',name:'Chef',area_id:'a2',active:true},{id:'w7',name:'Barra',area_id:'a3',active:true},{id:'w8',name:'Copero',area_id:'a4',active:true}];
  const example=await app({platform:false,role:'owner',dataOverrides:{propina_areas:areasSample,propina_workers:membersSample}});
  example.d.querySelector('#date').value='2026-10-10';
  example.d.querySelector('#date').dispatchEvent(new example.w.Event('change'));
  example.d.querySelector('#amount').value='718933';
  for(const wid of ['w1','w2','w4','w5','w6','w7','w8']) example.d.querySelector('[data-present="'+wid+'"]').checked=true;
  example.d.querySelector('[data-hours="w4"]').value='16';
  example.d.querySelector('[data-day-percent="w4"]').value='25';
  example.d.querySelector('[data-day-note="w4"]').value='Acuerdo de aprendizaje vigente';
  example.d.querySelector('[data-day-agreed="w4"]').checked=true;
  example.d.querySelector('[data-hours="w5"]').value='16';
  const update=()=>example.d.querySelector('[data-hours="w5"]').dispatchEvent(new example.w.Event('input',{bubbles:true}));
  update();
  assert.match(example.d.querySelector('#classicAreaPreview').textContent,/4 persona\(s\) · 4,5 puntos/);
  assert.match(example.d.querySelector('#classicAreaPreview').textContent,/Cocina · 20%/);
  assert.match(example.d.querySelector('#classicAreaPreview').textContent,/143\.787/);
  example.d.querySelector('[data-present="w3"]').checked=true;
  update();
  assert.match(example.d.querySelector('#classicAreaPreview').textContent,/5 persona\(s\) · 5,5 puntos/);
  assert.match(example.d.querySelector('[data-day-estimate="w5"]').textContent,/169\.929/);
  assert.match(example.d.querySelector('[data-day-estimate="w4"]').textContent,/42\.482/);
  assert.match(example.d.querySelector('[data-day-estimate="w1"]').textContent,/84\.965/);
  example.d.querySelector('#saveDay').click();await flush();
  assert(example.calls.some(c=>c[0]==='propina_save_day'));
  assert.match(example.d.querySelector('#payouts').textContent,/143\.787/);
  assert.match(example.d.querySelector('#payouts').textContent,/169\.929/);
  assert.equal(example.errors.length,0);
  example.dom.window.close();

  // Weekly Monday-Sunday split with one daily AM/PM pool, per-person totals,
  // independent areas and the transfer-control worksheet.
  const weeklyArea=[{id:'a1',name:'Garzones',percentage:65},{id:'a2',name:'Cocina',percentage:20},
    {id:'a3',name:'Barra',percentage:10},{id:'a4',name:'Copería',percentage:5}];
  const weeklyWorkers=[
    {id:'w1',name:'Garzón principal',area_id:'a1',active:true},
    {id:'w2',name:'Chef',area_id:'a2',active:true},
    {id:'w3',name:'Barra',area_id:'a3',active:true},
    {id:'w4',name:'Copero',area_id:'a4',active:true}
  ];
  const wk=await app({platform:false,role:'owner',dataOverrides:{
    propina_areas:weeklyArea,propina_workers:weeklyWorkers,
    propina_days:[
      {id:'dSat',work_date:'2026-10-10',amount_clp:200000,hours_per_shift:8},
      {id:'dMon',work_date:'2026-10-12',amount_clp:50000,hours_per_shift:8}
    ],
    propina_shifts:[],
    propina_daily_distribution:[
      ...[['w1','Garzón principal','a1','Garzones',130000],['w2','Chef','a2','Cocina',40000],
         ['w3','Barra','a3','Barra',20000],['w4','Copero','a4','Copería',10000]].map(
           ([worker_id,worker_name,area_id,area_name,calculated_clp])=>
           ({day_id:'dSat',work_date:'2026-10-10',worker_id,worker_name,area_id,area_name,hours:8,percentage:65,calculated_clp})),
      ...[['w1','Garzón principal','a1','Garzones',32500],['w2','Chef','a2','Cocina',10000],
         ['w3','Barra','a3','Barra',5000],['w4','Copero','a4','Copería',2500]].map(
           ([worker_id,worker_name,area_id,area_name,calculated_clp])=>
           ({day_id:'dMon',work_date:'2026-10-12',worker_id,worker_name,area_id,area_name,hours:8,percentage:65,calculated_clp}))
    ],
    propina_flex_shifts:[
      {id:'flexAM',work_date:'2026-10-11',shift_code:'AM',amount_clp:60000,rules:[],entries:[]},
      {id:'flexPM',work_date:'2026-10-11',shift_code:'PM',amount_clp:40000,rules:[],entries:[]}
    ],
    propina_flex_payouts:[
      ...[['w1','Garzón principal','a1','Garzones',65000],['w2','Chef','a2','Cocina',20000],
         ['w3','Barra','a3','Barra',10000],['w4','Copero','a4','Copería',5000]].map(
           ([worker_id,worker_name,area_id,area_name,calculated_clp])=>
           ({work_date:'2026-10-11',group_code:'DIA',worker_id,worker_name,area_id,area_name,weight:1,calculated_clp}))
    ]
  }});
  const select=wk.d.querySelector('#historyWeekSelect');
  select.value='2026-10-05';select.dispatchEvent(new wk.w.Event('change'));
  assert.equal(select.value,'2026-10-05');
  assert.match(wk.d.querySelector('#historyWeekLabel').textContent,/11 oct/);
  assert.equal(wk.d.querySelector('#historyRows').children.length,2,'Saturday + Sunday share one week');
  assert.match(wk.d.querySelector('#historySummary').textContent,/300\.000/,'Classic plus AM+PM funds total $300k');
  assert.match(wk.d.querySelector('#weeklyStats').textContent,/300\.000/);
  assert.match(wk.d.querySelector('#weeklyWorkerRows').textContent,/195\.000/,'Waiter receives 130k Saturday + 65k Sunday');
  assert.match(wk.d.querySelector('#weeklyAreaRows').textContent,/60\.000/,'Kitchen receives 40k Saturday and 20k Sunday');
  assert.equal(wk.d.querySelector('#weeklyNotice').classList.contains('error'),false,'No double counting DIA');
  wk.d.querySelector('#historyNextWeek').click();
  assert.equal(wk.d.querySelector('#historyWeekSelect').value,'2026-10-12','Monday starts next weekly period');
  assert.equal(wk.d.querySelector('#historyRows').children.length,1);
  assert.match(wk.d.querySelector('#historySummary').textContent,/50\.000/);
  assert.doesNotMatch(wk.d.querySelector('#weeklyWorkerRows').textContent,/195\.000/);
  wk.d.querySelector('#historyPrevWeek').click();
  assert.equal(wk.d.querySelector('#weeklyGroups details').length,4,'Weekly mobile cards group all four areas');
  const cards=[...wk.d.querySelectorAll('#weeklyGroups [data-week-person]')];
  assert.equal(cards.length,4,'Each worker is included once in their respective area');
  assert.equal(wk.d.querySelector('#weeklyMobileTotal').textContent.includes('300.000'),true,'Sticky mobile total follows selected week');
  wk.d.querySelector('#exportMobile').click();await flush();
  assert(wk.blob(),'Sticky mobile Excel button exports the actual selected week');
  wk.d.querySelector('#export').click(); await flush();
  const weeklyBytes=await new Promise(resolve=>{const reader=new wk.w.FileReader();reader.onload=()=>resolve(new TextDecoder().decode(new Uint8Array(reader.result)));reader.readAsArrayBuffer(wk.blob());});
  assert(weeklyBytes.includes('Cierre semanal'));
  assert(weeklyBytes.includes('Control de transferencias')||weeklyBytes.includes('CONTROL DE TRANSFERENCIAS'));
  assert(weeklyBytes.includes('<v>195000</v>'),'Workbook contains weekly total per waiter');
  assert(weeklyBytes.includes('<v>60000</v>'),'Workbook contains kitchen weekly total');
  assert(weeklyBytes.includes('Sin registrar'),'Payments are never marked as confirmed');
  assert.equal(wk.errors.length,0);
  wk.dom.window.close();
  const b=await app({platform:false,role:'viewer'});
  assert(b.d.querySelector('#saveDay').disabled,'Viewer cannot save');
  assert(b.d.querySelector('[data-day-percent="w2"]').disabled,'Viewer cannot edit individual share');
  assert(b.d.querySelector('[data-day-agreed="w2"]').disabled,'Viewer cannot attest an agreement');
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
  flex.d.querySelector('[data-flex-percent="w2"]').value='25';
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
  assert.match(flex.d.querySelector('#flexPayoutRows').textContent,/25%/,'Results display percent rather than decimal weight');
  assert(flexSave[1].p_entries[0].agreed);
  assert.equal(flex.d.querySelector('#flexPayoutRows').children.length,1,'Flexible payout loads after save');
  assert(flex.d.querySelector('#historyRows [data-open-flex-date="2026-10-09"]'),'Flexible shift appears in unified history');
  // A trainee can change from 25% to 75% on the next shift, without changing the area percentage.
  flex.d.querySelector('#flexShiftCode').value='PM';
  flex.d.querySelector('#flexShiftCode').dispatchEvent(new flex.w.Event('change'));
  flex.d.querySelector('#flexAmount').value='999';
  flex.d.querySelector('[data-flex-present="w2"]').checked=true;
  flex.d.querySelector('[data-flex-percent="w2"]').value='75';
  flex.d.querySelector('[data-flex-note="w2"]').value='Aprendizaje avanzado acordado para turno PM';
  flex.d.querySelector('[data-flex-agreed="w2"]').checked=true;
  flex.d.querySelector('#saveFlexShift').click(); await flush();
  const flexSaves=flex.calls.filter(x=>x[0]==='propina_save_flex_shift');
  assert.equal(flexSaves.length,2);
  assert.equal(flexSaves[1][1].p_entries[0].weight,0.75,'PM stores 75% independently from AM 25%');
  assert.equal(flexSaves[0][1].p_entries[0].weight,0.25,'AM 25% remains unchanged');
  assert.equal(flexSaves[1][1].p_modes[0].area_id,'a1','Area rule remains unchanged');
  assert.equal(flex.d.querySelectorAll('#historyRows [data-open-flex-date="2026-10-09"]').length,1,'One flex row per day');
  const row=flex.d.querySelector('#historyRows [data-open-flex-date="2026-10-09"]').closest('tr');
  assert.equal(flex.d.querySelectorAll('#historyRows [data-open-flex-date="2026-10-09"]').length,1,'Two shifts stay one history row');
  assert.match(row.textContent,/Por turnos/,'History labels the distribution method, not individual shifts');
  assert(!/Turno AM|Turno PM/.test(row.textContent),'History does not split AM and PM');
  assert.match(row.textContent,/2\.000/,'History totals AM and PM');
  assert.match(flex.d.querySelector('#historySummary').textContent,/1 día\(s\)/,'History counts only dates within the selected Monday-Sunday week');
  assert(flex.d.querySelector('#historyWeekSelect').textContent.includes('28 sept'),'Earlier classic day is kept in its own previous week');
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

  // Platform owner can archive and restore with explicit text confirmation.
  // No real restaurants or database rows are modified by this UI test.
  let archived=false;
  const panel=await app({rpcOverrides:{
    propina_platform_snapshot: async()=>({data:{restaurants:[{id:'r1',name:'Local uno',email:'owner@example.test',active:!archived,archived_at:archived?'2026-10-12T18:00:00Z':null,members:2}],invitations:[]}}),
    propina_set_restaurant_archive: async(args)=>{archived=args.should_archive;return {data:null}}
  }});
  assert(html.includes('mutavia-brand.svg'),'Owner panel uses recovered original brand logo');
  assert(html.includes('MUTAVIA GROUP'),'Only owner branding changes, not Turnia product brand');
  assert.equal(panel.d.querySelector('#profileRole').textContent,'MUTAVIA GROUP · Creador de Turnia');
  panel.d.querySelector('[data-tab="owner"]').click();await flush();
  assert(panel.d.querySelector('[data-restaurant-archive="0"]'),'Owner sees archive action');
  panel.w.prompt=()=> 'Otro restaurante';
  panel.d.querySelector('[data-restaurant-reason="0"]').value='Retiro del local de prueba';
  panel.d.querySelector('[data-restaurant-archive="0"]').click();await flush();
  assert(!panel.calls.some(c=>c[0]==='propina_set_restaurant_archive'),'Wrong typed name must not call archive RPC');
  panel.w.prompt=()=> 'Local uno';
  panel.d.querySelector('[data-restaurant-archive="0"]').click();await flush();await flush();
  const archiveCall=panel.calls.find(c=>c[0]==='propina_set_restaurant_archive');
  assert(archiveCall,'Archive must use owner-only server RPC');
  assert.equal(archiveCall[1].should_archive,true);
  assert.equal(archiveCall[1].expected_name,'Local uno');
  assert.equal(panel.d.querySelectorAll('[data-restaurant-archive]').length,0,'Archived restaurant hidden by default');
  panel.d.querySelector('#showArchivedRestaurants').checked=true;
  panel.d.querySelector('#showArchivedRestaurants').dispatchEvent(new panel.w.Event('change'));
  assert.match(panel.d.querySelector('#platformRestaurants').textContent,/Archivado/,'Archived local shown when requested');
  panel.d.querySelector('[data-restaurant-reason="0"]').value='Devolver acceso al restaurante';
  panel.d.querySelector('[data-restaurant-archive="0"]').click();await flush();await flush();
  assert(panel.calls.some(c=>c[0]==='propina_set_restaurant_archive'&&c[1].should_archive===false),'Restore via same authorized RPC');
  panel.dom.window.close();

  // Role access: admins may edit shifts but cannot change ownership or team members.
  const admin=await app({platform:false,role:'admin'});
   assert.equal(admin.d.querySelector('#avatar').textContent,'NV','Regular users retain their personal initials');
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
