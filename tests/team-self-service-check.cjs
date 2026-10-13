// CI-only fixtures. Does not create real Supabase users, teams or subscriptions.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {app,flush}=require('./ui-check.cjs');
const page=fs.readFileSync(__dirname+'/../dist/equipo.html','utf8');
const code=fs.readFileSync(__dirname+'/../dist/equipo.js','utf8');
const migration=fs.readFileSync(__dirname+'/../supabase/migrations/20261013_worker_team_self_service.sql','utf8');
const kind=fs.readFileSync(__dirname+'/../supabase/migrations/20261013_worker_team_kind.sql','utf8');
const signupGateway=fs.readFileSync(__dirname+'/../supabase/migrations/20261013_worker_team_auth_signup_fix.sql','utf8');
function createTeamPage({confirmed=false,keepSession=true}={}){
  const dom=new JSDOM(page,{url:'https://turnia.test/equipo.html',runScripts:'outside-only'});
  const w=dom.window, d=w.document, calls=[];
  w.localStorage.setItem('propina_keep_session',keepSession?'1':'0');
  w.localStorage.setItem('sb-kfaolqnrqlypoyzkejlt-auth-token','old-fixture-session');
  const navigations=[]; w.__navigate=target=>navigations.push(target);
  let clientOptions;
  const account={id:'user01',email:'test@example.test',email_confirmed_at:'2026-10-13T01:00:00Z',user_metadata:{turnia_team_name:'Garzones del centro'}};
  const session=confirmed?{user:account}:null;
  const sb={auth:{
    getSession:async()=>({data:{session}}),
    getUser:async()=>({data:{user:account}}),
    signUp:async(args)=>{calls.push(['signUp',args]);return{data:{session:null,user:{id:'pending'}}};},
    signInWithPassword:async(args)=>{calls.push(['signIn',args]);return{data:{session:{user:account}}};}
  },rpc:async(name,args)=>{calls.push(['rpc',name,args]);return{data:'team-demo-id'};}};
  w.supabase={createClient:(_url,_key,options)=>{clientOptions=options;return sb;}};
  w.eval(code.replaceAll('location.assign(', 'window.__navigate('));
  return {dom,w,d,calls,navigations,clientOptions};
}
(async()=>{
  assert.match(migration,/email_confirmed_at is not null/);
  assert.match(migration,/unique references auth\.users/);
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(migration,/payment_status/);
  assert.match(migration,/0,'trial'/);
  assert.match(migration,/90 days/);
  assert.match(migration,/revoke all on function public\.turnia_create_worker_team\(text\) from public, anon, authenticated/);
  assert.match(migration,/grant execute on function public\.turnia_create_worker_team\(text\) to authenticated/);
  assert.match(kind,/propina_private\.can_read_restaurant/);
  assert.match(signupGateway,/CREATE OR REPLACE FUNCTION propina_private\.valid_worker_team_signup/);
  assert.match(signupGateway,/CREATE OR REPLACE FUNCTION public\.propina_before_user_created/);
  assert.match(signupGateway,/CREATE OR REPLACE FUNCTION propina_private\.validate_new_user/);
  assert.match(signupGateway,/meta->>'turnia_team_setup' = 'v1'/);
  assert.match(signupGateway,/meta->>'propina_invitation' IS NULL/);
  assert.match(signupGateway,/meta->>'turnia_registration' IS NULL/);
  assert.match(signupGateway,/propina_private\.test_signup_allowed/);
  assert.match(signupGateway,/propina_private\.valid_self_registration/);
  assert.match(page,/Beta gratuita/);
  assert(!code.includes('RESEND_API_KEY') && !code.includes('SERVICE_ROLE_KEY'),'No secrets exposed');
  assert(!code.includes('createSubscription') && !code.includes('mercadopago'),'No client payment mechanism');

  const signup=createTeamPage();
  await flush();
  assert.equal(signup.clientOptions.auth.storage,signup.w.localStorage);
  assert.equal(signup.d.querySelector('#authArea').hidden,false);
  signup.d.querySelector('#fullName').value='Camila Soto';
  signup.d.querySelector('#teamNameSignup').value='Garzones del centro';
  signup.d.querySelector('#emailSignup').value='camila@example.test';
  signup.d.querySelector('#passwordSignup').value='VeryLongPass123';
  signup.d.querySelector('#passwordConfirm').value='VeryLongPass123';
  signup.d.querySelector('#consentSignup').checked=true;
  signup.d.querySelector('#signupForm').dispatchEvent(new signup.w.Event('submit',{bubbles:true,cancelable:true}));
  await flush();await flush();
  const signupCall=signup.calls.find(x=>x[0]==='signUp');
  assert(signupCall,'Sign-up requests Supabase Auth');
  assert.equal(signupCall[1].options.emailRedirectTo,'https://turnia.test/equipo.html');
  assert.equal(signupCall[1].options.data.turnia_team_name,'Garzones del centro');
  assert.match(signup.d.querySelector('#status').textContent,/Si el correo es nuevo/);
  assert.match(signup.d.querySelector('#status').textContent,/Ya tengo cuenta/,'Existing user can choose login without expecting a confirmation mail');
  assert(!signup.calls.some(x=>x[0]==='rpc'),'Unverified signup cannot create a team');
  signup.dom.window.close();

  const verified=createTeamPage({confirmed:true});await flush();
  assert.equal(verified.d.querySelector('#createArea').hidden,false);
  assert.equal(verified.d.querySelector('#teamName').value,'Garzones del centro');
  verified.d.querySelector('#teamForm').dispatchEvent(new verified.w.Event('submit',{bubbles:true,cancelable:true}));
  await flush();
  assert(!verified.calls.some(x=>x[0]==='rpc'),'Must confirm team agreement before creating');
  verified.d.querySelector('#acceptAgreement').checked=true;
  verified.d.querySelector('#teamForm').dispatchEvent(new verified.w.Event('submit',{bubbles:true,cancelable:true}));
  await flush();
  assert(verified.calls.some(x=>x[0]==='rpc'&&x[1]==='turnia_create_worker_team'&&x[2].team_name==='Garzones del centro'));
  assert.deepEqual(verified.navigations,['/?equipo_creado=1']);
  verified.dom.window.close();

  const temporary=createTeamPage({confirmed:true,keepSession:false});await flush();
  assert.equal(temporary.clientOptions.auth.storage,temporary.w.sessionStorage,'Team and app use the same temporary session store');
  assert.equal(temporary.w.localStorage.getItem('sb-kfaolqnrqlypoyzkejlt-auth-token'),null,'Temporary login leaves no persistent session behind');
  temporary.dom.window.close();

  const team=await app({platform:false,completed:false,rpcOverrides:{
    turnia_is_worker_team:async()=>({data:true})
  }});
  await flush();
  assert.equal(team.d.querySelector('#teamBetaHelp').classList.contains('hide'),false,'Independent team setup appears to its leader');
  assert.equal(team.d.querySelector('#restaurantDetailsPanel').classList.contains('hide'),true,'Commercial restaurant tax fields are hidden');
  assert.match(team.d.querySelector('#profileRole').textContent,/Coordinador del equipo/);
  assert.equal(team.d.querySelector('#staff').classList.contains('hide'),false,'Team leader starts in staff setup');
  assert(!team.calls.some(x=>x[0]==='propina_create_restaurant'),'Team does not use paid restaurant invitation flows');
  team.dom.window.close();

  const restaurant=await app({platform:false});
  assert(restaurant.d.querySelector('#teamBetaHelp').classList.contains('hide'),'Existing restaurants do not see beta help');
  restaurant.dom.window.close();
  console.log('PASS: independently created team signup, confirmation boundary, 90-day free mode, single-team guard, owner UI and restaurant isolation (mocks only).');
})().catch(e=>{console.error(e);process.exitCode=1});
