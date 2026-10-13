// UI-only checks: never mutate the real production database.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {app,flush}=require('./ui-check.cjs');
const sql=fs.readFileSync(__dirname+'/../supabase/migrations/20261013_unused_area_safe_delete.sql','utf8');
assert.match(sql,/can_edit_restaurant/);
assert.match(sql,/propina_shifts/);
assert.match(sql,/propina_flex_shifts/);
assert.match(sql,/old_area.percentage <> 0/);
assert.match(sql,/REVOKE ALL ON FUNCTION public\.turnia_delete_unused_area/);
assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.turnia_delete_unused_area/);
const base={
  propina_areas:[{id:'a1',name:'Garzones',percentage:100},{id:'a2',name:'Área de prueba',percentage:0}],
  propina_workers:[{id:'w1',area_id:'a1',name:'Garzón A',active:true},{id:'w2',area_id:'a1',name:'Garzón B',active:true},{id:'w3',area_id:'a2',name:'Garzón prueba',active:true}],
  propina_daily_distribution:[{day_id:'d1',area_id:'a1',area_name:'Garzones',worker_id:'w1',worker_name:'Garzón A',work_date:'2026-10-01',hours:8,percentage:100,calculated_clp:100000}],
  propina_shifts:[{day_id:'d1',worker_id:'w1',hours:8},{day_id:'d1',worker_id:'w2',hours:8}],
  propina_flex_shifts:[],propina_flex_payouts:[]
};
(async()=>{
  const a=await app({platform:false,role:'owner',dataOverrides:base,rpcOverrides:{turnia_delete_unused_area:async args=>({data:{name:'Área de prueba',moved_workers:1}})}});
  await flush();
  assert(a.d.querySelectorAll('#areas [data-select-area-delete]').length===2,'Every editable area has delete action');
  a.d.querySelector('[data-select-area-delete="a1"]').click();
  assert(a.d.querySelector('#removeAreaHelp').textContent.includes('jornadas'),'Historical area locked');
  assert(a.d.querySelector('#confirmAreaDeletion').disabled,'Cannot remove historical area');
  a.d.querySelector('[data-select-area-delete="a2"]').click();
  assert(a.d.querySelector('#removeAreaHelp').textContent.includes('1 persona'),'Reassignment is explained');
  assert(!a.d.querySelector('#removeAreaTransferRow').classList.contains('hide'),'Destination shown');
  a.d.querySelector('#removeAreaConfirm').checked=true;
  a.d.querySelector('#removeAreaConfirm').dispatchEvent(new a.w.Event('change'));
  assert(a.d.querySelector('#confirmAreaDeletion').disabled,'Cannot delete occupied area without destination');
  a.d.querySelector('#removeAreaTarget').value='a1';
  a.d.querySelector('#removeAreaTarget').dispatchEvent(new a.w.Event('change'));
  assert(!a.d.querySelector('#confirmAreaDeletion').disabled,'Can transfer and remove unused area');
  a.d.querySelector('#confirmAreaDeletion').click();
  await flush();await flush();
  assert(a.calls.some(x=>x[0]==='turnia_delete_unused_area'&&x[1].p_area_id==='a2'&&x[1].p_destination_area_id==='a1'),'Uses tenant-checked atomic RPC');
  assert.equal(a.errors.length,0,'No client-side exceptions during deletion');
  a.dom.window.close();

  const blocked=await app({platform:false,role:'viewer',dataOverrides:base});
  assert(blocked.d.querySelector('#areaDeleteTools').classList.contains('hide'),'Read-only members cannot remove areas');
  assert(!blocked.d.querySelector('#areas [data-select-area-delete]'),'Read-only members never see delete buttons');
  blocked.dom.window.close();

  const only=await app({platform:false,role:'owner',dataOverrides:{...base,propina_areas:[{id:'a1',name:'Única área',percentage:0}],propina_workers:[],propina_shifts:[],propina_daily_distribution:[]}});
  only.d.querySelector('#removeArea').value='a1';
  only.d.querySelector('#removeArea').dispatchEvent(new only.w.Event('change'));
  assert(only.d.querySelector('#confirmAreaDeletion').disabled,'Cannot delete last area');
  only.dom.window.close();

  console.log('PASS: safe area delete selector, history protection, worker transfer, access boundaries.');
})().catch(e=>{console.error(e);process.exitCode=1});
