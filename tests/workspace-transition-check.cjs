const assert = require('node:assert/strict');
const {app,flush} = require('./ui-check.cjs');
const deferred = () => { let resolve; const promise=new Promise(r=>{resolve=r;}); return {promise,resolve}; };
const change = (a,id) => { a.d.getElementById('restaurant').value=id; a.d.getElementById('restaurant').dispatchEvent(new a.w.Event('change')); };
(async()=>{
  const pending=deferred();
  const a=await app({platform:false,rpcOverrides:{turnia_is_worker_team:args=>args.p_workspace_id==='r2'?pending.promise:Promise.resolve({data:false})}});
  assert.match(a.d.getElementById('workers').textContent,/Camila/);
  change(a,'r2');
  assert(!a.d.getElementById('workers').textContent.includes('Camila'),'Previous workspace data clears before awaiting network');
  assert(a.d.getElementById('saveDay').disabled,'Writes are blocked throughout the transition');
  assert(a.d.getElementById('saveFlexShift').disabled);
  change(a,'r1'); await flush();
  pending.resolve({data:true}); await flush();
  // Trigger a permission refresh after the stale result arrives.
  a.d.querySelector('[data-tab="access"]').click(); await flush();
  assert(a.d.getElementById('teamBetaHelp').classList.contains('hide'),'Late team classification cannot overwrite current restaurant');
  a.dom.window.close();

  const late=deferred();
  const b=await app({platform:false,rpcOverrides:{turnia_is_worker_team:args=>args.p_workspace_id==='r2'?late.promise:Promise.resolve({data:false})}});
  change(b,'r2'); b.authChange('SIGNED_OUT'); late.resolve({data:true}); await flush();
  assert(b.d.getElementById('app').classList.contains('hide'));
  assert(b.d.getElementById('teamBetaHelp').classList.contains('hide'),'Sign-out discards pending workspace responses');
  b.dom.window.close();

  const team=await app({platform:false,restaurant:false,userMetadata:{turnia_team_setup:'v1'},rpcOverrides:{propina_account_context:async()=>({data:{platform_admin:false,can_create:false,restaurants:[]}})}});
  assert.deepEqual(team.navigations,['/equipo.html'],'An unfinished team resumes setup when Auth returns to the home page');
  assert(team.d.getElementById('inviteActivation').classList.contains('hide'));
  team.dom.window.close();
  console.log('PASS: workspace transition blocks stale data/writes, reversed responses and logout; team signup resumes correctly. Simulated network.');
})().catch(e=>{console.error(e);process.exitCode=1;});
