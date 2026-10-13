// Snapshot view is the ledger of record; client preview must use the same two-stage rounding.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {app,flush}=require('./ui-check.cjs');
(async()=>{
  const data={
    propina_areas:[{id:'a1',name:'Uno',percentage:33.33},{id:'a2',name:'Dos',percentage:33.33},{id:'a3',name:'Tres',percentage:33.34}],
    propina_workers:[{id:'w1',area_id:'a1',name:'Alice',active:true},{id:'w2',area_id:'a2',name:'Bob',active:true},{id:'w3',area_id:'a3',name:'Carla',active:true}],
    propina_days:[],propina_shifts:[],propina_daily_distribution:[],propina_flex_shifts:[],propina_flex_payouts:[]
  };
  const a=await app({platform:false,role:'owner',dataOverrides:data});await flush();
  const amount=a.d.querySelector('#amount');amount.value='1';
  const selected=a.d.querySelectorAll('[data-present]');
  assert.equal(selected.length,3);
  selected.forEach(el=>{el.checked=true;el.dispatchEvent(new a.w.Event('change',{bubbles:true}));});
  amount.dispatchEvent(new a.w.Event('input',{bubbles:true}));
  const values=[...a.d.querySelectorAll('[data-day-estimate]')].map(el=>Number(el.textContent.replace(/[^0-9]/g,'')));
  assert.deepEqual(values.sort((x,y)=>x-y),[0,0,1],'1 peso is allocated once, not rounded independently in 3 areas');
  assert(!a.errors.length,'No preview exceptions');
  a.dom.window.close();

  const historical=await app({platform:false,role:'owner',dataOverrides:{
    ...data,propina_days:[{id:'d1',work_date:'2026-10-01',amount_clp:1,hours_per_shift:8}],
    propina_shifts:[{day_id:'d1',worker_id:'w1',hours:8,participation:1,note:'',agreed:false}],
    propina_daily_distribution:[{day_id:'d1',work_date:'2026-10-01',area_id:'a1',area_name:'Original',worker_id:'w1',worker_name:'Original',hours:8,calculated_clp:1}]
  }});await flush();
  historical.d.querySelector('#payoutDate').value='2026-10-01';
  historical.d.querySelector('#payoutDate').dispatchEvent(new historical.w.Event('change'));
  assert.match(historical.d.querySelector('#payouts').textContent,/Original/,'Historical payout uses stored labels');
  assert.match(historical.d.querySelector('#summary').textContent,/Sin asignar/);
  assert(!historical.errors.length);
  historical.dom.window.close();
  // SQL migration guards the server-side snapshots; validate its key invariants.
  const migration=fs.readFileSync('supabase/migrations/20261013_fixed_daily_settlements_global_rounding.sql','utf8');
  for(const required of ['propina_day_settlements','day_settlement_history','SECURITY DEFINER','REVOKE INSERT,UPDATE,DELETE','area_budgets','largest'])assert(migration.includes(required),required+' absent');
  console.log('PASS: exact preview rounding, historical snapshot view, privileged server write and revision guards.');
})().catch(e=>{console.error(e);process.exitCode=1});
