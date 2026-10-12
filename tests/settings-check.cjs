const assert = require('node:assert/strict');
const {app, flush} = require('./ui-check.cjs');
const deferred = () => { let resolve; const promise = new Promise(r => {resolve=r;}); return {resolve,promise}; };
const passwordForm = (a, current, next, confirmation=next) => {
  for (const [id,value] of Object.entries({currentAccountPassword:current,nextAccountPassword:next,nextAccountPasswordConfirm:confirmation})) a.d.getElementById(id).value=value;
};
const click = async(a,id) => {a.d.getElementById(id).click();await flush();};
const hasCall = (a,name) => a.calls.some(c=>c[0]===name);
const invitation = {id:'i1',email:'staff@example.test',role:'admin',expires_at:'2099-01-01'};
(async()=>{
  const a=await app();
  a.d.querySelector('[data-tab="access"]').click();await flush();
  passwordForm(a,'wrong-password','NewPassword123');
  await click(a,'changeAccountPassword');
  assert(!hasCall(a,'updateUser'),'Incorrect current password must not update Auth');
  assert.match(a.d.getElementById('settingsStatus').textContent,/no coinciden/);
  for (const [next,confirmation] of [['short','short'],['NewPassword123','other'],['OldPassword123','OldPassword123'],['é'.repeat(37),'é'.repeat(37)]]) {
    const before=a.calls.length; passwordForm(a,'OldPassword123',next,confirmation);
    await click(a,'changeAccountPassword'); assert.equal(a.calls.length,before,'Invalid passwords make no Auth call');
  }
  passwordForm(a,'OldPassword123','NewPassword123');await click(a,'changeAccountPassword');
  assert(a.calls.some(c=>c[0]==='updateUser' && c[1].current_password==='OldPassword123'));
  assert(!a.d.getElementById('testPasswordLogin').classList.contains('hide'));
  assert.equal(a.d.getElementById('nextAccountPassword').value,'');
  await click(a,'testPasswordLogin');
  assert(a.d.getElementById('app').classList.contains('hide'));
  assert.equal(a.d.getElementById('email').value,'owner@example.test');
  assert.equal(a.d.getElementById('accountPhone').value,'','Logout clears personal fields');
  assert(a.calls.some(c=>c[0]==='signOut' && c[1].scope==='local'));
  a.d.getElementById('password').value='OldPassword123';
  a.d.getElementById('loginForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));await flush();
  assert(a.d.getElementById('app').classList.contains('hide'),'Old password no longer signs in');
  a.d.getElementById('password').value='NewPassword123';
  a.d.getElementById('loginForm').dispatchEvent(new a.w.Event('submit',{cancelable:true}));await flush();
  assert(!a.d.getElementById('app').classList.contains('hide'),'New password signs in');
  a.d.getElementById('restaurantEditName').value='x'.repeat(81);
  await click(a,'saveRestaurantDetails');assert(!hasCall(a,'propina_update_restaurant_name'));
  a.d.getElementById('restaurantEditName').value='x'.repeat(80);
  await click(a,'saveRestaurantDetails');assert(hasCall(a,'propina_update_restaurant_name'));
  a.dom.window.close();

  const failed=await app({authOverrides:{updateUser:async()=>({error:{code:'weak_password',message:'weak'}})}});
  passwordForm(failed,'OldPassword123','NewPassword123');await click(failed,'changeAccountPassword');
  assert(failed.d.getElementById('testPasswordLogin').classList.contains('hide'),'Failed change offers no success action');
  assert.match(failed.d.getElementById('settingsStatus').textContent,/requisitos/);
  failed.dom.window.close();
  const legacy=await app({loggedIn:false,initialPassword:'old123'});
  legacy.d.getElementById('password').value='old123';assert(legacy.d.getElementById('password').checkValidity(),'Existing shorter passwords can reach Auth');
  legacy.dom.window.close();

  const rpcOverrides={
    propina_restaurant_team:async()=>({data:{members:[{email:'staff@example.test',role:'admin'}],invitations:[invitation,{...invitation,id:'i2',used_at:'2026-01-01'},{...invitation,id:'i3',revoked_at:'2026-01-01'}]}}),
    propina_platform_snapshot:async()=>({data:{restaurants:[{id:'r1',name:'Local uno',email:'owner@example.test',active:true,members:2}],invitations:[invitation]}})
  };
  const owner=await app({rpcOverrides});
  owner.d.querySelector('[data-tab="access"]').click();await flush();
  assert.equal(owner.d.querySelectorAll('[data-team-revoke]').length,1,'Only pending invitations can be revoked');
  owner.d.querySelector('[data-member-role]').value='viewer';owner.d.querySelector('[data-member-save]').click();await flush();
  assert(owner.calls.some(c=>c[0]==='propina_manage_member' && c[1].rid==='r1' && c[1].member_email==='staff@example.test' && c[1].new_role==='viewer'));
  owner.w.confirm=()=>false;const before=owner.calls.length;
  owner.d.querySelector('[data-member-remove]').click();await flush();assert.equal(owner.calls.length,before,'Cancel does not change access');
  owner.w.confirm=()=>true;owner.d.querySelector('[data-member-remove]').click();await flush();
  assert(owner.calls.some(c=>c[0]==='propina_manage_member' && c[1].new_role===null));
  owner.d.querySelector('[data-team-revoke]').click();await flush();assert(hasCall(owner,'propina_revoke_staff_invitation'));
  owner.d.querySelector('[data-tab="owner"]').click();await flush();
  assert.equal(owner.d.getElementById('platformOverview').parentElement.id,'owner');
  owner.d.querySelector('[data-restaurant-status]').click();await flush();assert(!hasCall(owner,'propina_set_restaurant_status'),'Suspension needs a reason');
  owner.d.querySelector('[data-restaurant-reason]').value='Solicitud del responsable';
  owner.d.querySelector('[data-restaurant-status]').click();await flush();
  assert(owner.calls.some(c=>c[0]==='propina_set_restaurant_status' && c[1].enabled===false && c[1].rid==='r1'));
  owner.d.querySelector('[data-platform-revoke]').click();await flush();assert(hasCall(owner,'propina_revoke_invitation'));
  owner.dom.window.close();
  for (const role of ['viewer','admin']) {
    const member=await app({platform:false,role});
    member.d.querySelector('[data-tab="access"]').click();await flush();
    assert(member.d.getElementById('teamAccessPanel').classList.contains('hide'));
    assert(!hasCall(member,'propina_restaurant_team'));
    await click(member,'refreshPlatform');assert(!hasCall(member,'propina_platform_snapshot'));
    assert(member.d.getElementById('saveRestaurantDetails').disabled);
    member.dom.window.close();
  }
  const slow=deferred();
  const race=await app({rpcOverrides:{propina_restaurant_team:async args=>args.rid==='r1'?slow.promise:{data:{members:[],invitations:[]}}}});
  race.d.querySelector('[data-tab="access"]').click();await flush();
  race.d.getElementById('restaurant').value='r2';race.d.getElementById('restaurant').dispatchEvent(new race.w.Event('change'));await flush();
  slow.resolve({data:{members:[{email:'private-r1@example.test',role:'admin'}],invitations:[]}});await flush();
  assert(!race.d.getElementById('teamMembers').textContent.includes('private-r1'),'Late data from other restaurant is discarded');
  const pendingContext=deferred(), originalRPC=race.sb.rpc;
  race.sb.rpc=(name,args)=>name==='propina_account_context'?pendingContext.promise:originalRPC(name,args);
  race.d.getElementById('accountDisplayName').value='Nuevo Nombre';race.d.getElementById('saveAccountProfile').click();await flush();
  await click(race,'logoutTop');pendingContext.resolve({data:race.context});await flush();
  assert(race.d.getElementById('app').classList.contains('hide'),'Late initialization cannot reopen a signed-out app');
  assert.equal(race.d.getElementById('accountDisplayName').value,'');
  race.dom.window.close();
  console.log('PASS: password failure/change/logout/relogin, name boundaries, owner/admin/viewer controls, invitation revocation, status confirmation, late-response isolation. Auth is simulated.');
})().catch(e=>{console.error(e);process.exitCode=1;});
