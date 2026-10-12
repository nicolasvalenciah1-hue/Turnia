const assert = require('node:assert/strict');
const {app,flush} = require('./ui-check.cjs');
const tips = [{work_date:'2026-10-01',hours:8,calculated_clp:40000},{work_date:'2026-10-03',hours:12,calculated_clp:60001}];
const linked = {worker_id:'w1',worker_name:'Ana <script>bad()</script>',read_scope:'personal'};
const click = (a,id)=>a.d.getElementById(id).click();
const value = (a,id,v)=>{a.d.getElementById(id).value=v;};
const change=(a,id)=>a.d.getElementById(id).dispatchEvent(new a.w.Event('change'));
const visible=(a,id)=>!a.d.getElementById(id).classList.contains('hide');
(async()=>{
 const a=await app({role:'viewer',platform:false,completed:false,restaurantContext:linked,rpcOverrides:{propina_my_tips:()=>({data:tips})}});
 assert(visible(a,'mytips'),'Personal reader lands on own history, even before onboarding');
 assert(!a.calls.some(c=>c[0]==='query'),'No broad data requested by personal reader');
 assert(!a.calls.some(c=>c[0]==='propina_membership_context'),'Personal reader does not request membership');
 assert.equal(a.d.getElementById('myTipsRows').children.length,2);
 assert.equal(a.d.getElementById('myWorkerName').querySelector('script'),null,'Worker names are text');
 assert.match(a.d.getElementById('myTipsTotal').textContent,/100.001/);
 for(const name of ['home','daily','distribution','history','staff','guide']){
  const nav=a.d.querySelector(`[data-tab="${name}"]`); assert(nav.classList.contains('hide'));nav.click();assert(visible(a,'mytips'),'Navigation guard '+name);
 }
 a.d.querySelector('[data-tab="access"]').click(); assert(visible(a,'access'));assert(!visible(a,'workerLinkPanel'));assert(!visible(a,'membershipCard'));
 value(a,'myTipsFrom','2026-10-02'); change(a,'myTipsFrom');assert.match(a.d.getElementById('myTipsTotal').textContent,/60.001/);
 value(a,'myTipsTo','2026-09-01');change(a,'myTipsTo');assert.match(a.d.getElementById('myTipsRows').textContent,/Desde debe/);
 click(a,'clearMyTips');assert.equal(a.d.getElementById('myTipsDays').textContent,'2');
 value(a,'restaurant','r2');change(a,'restaurant');await flush();assert(!visible(a,'myTipsNav'));assert(!a.d.getElementById('myTipsRows').textContent.includes('40.000'));assert(visible(a,'access'));
 value(a,'restaurant','r1');change(a,'restaurant');await flush();assert(visible(a,'mytips'));
 click(a,'logout');await flush();assert(!a.d.getElementById('myTipsRows').textContent.includes('40.000'));assert.equal(a.errors.length,0);a.dom.window.close();
 const b=await app({role:'viewer',platform:false,restaurantContext:{...linked,read_scope:'shared'},rpcOverrides:{propina_my_tips:()=>({data:tips})}});
 assert(b.calls.some(c=>c[0]==='query'),'Shared reader retains authorized global data');assert(visible(b,'myTipsNav'));assert(!b.d.querySelector('[data-tab="history"]').classList.contains('hide'));
 b.d.querySelector('[data-tab="mytips"]').click();assert(visible(b,'mytips'));b.dom.window.close();
 const c=await app({role:'owner',platform:false,rpcOverrides:{propina_restaurant_team:()=>({data:{members:[{email:'ana@example.test',role:'viewer'},{email:'boss@example.test',role:'admin'}],invitations:[]}}),propina_issue_worker_invitation:()=>({data:{email:'new@example.test',token:'a'.repeat(64),expires_at:'2026-12-01'}})}});
 c.d.querySelector('[data-tab="access"]').click();await flush();assert(visible(c,'workerLinkPanel'));
 assert(![...c.d.getElementById('linkMember').options].some(o=>o.value==='boss@example.test'),'Only viewer accounts can link');
 c.d.querySelector('[data-worker-edit="0"]').click();value(c,'linkWorker','w1');
 click(c,'saveWorkerLink');await flush();assert(!c.calls.some(x=>x[0]==='propina_link_worker'),'Agreement required before RPC');
 value(c,'linkAgreementNote','Acuerdo de todo el equipo, 12 de octubre.');c.d.getElementById('linkAgreement').checked=true;
 click(c,'saveWorkerLink');await flush();const call=c.calls.find(x=>x[0]==='propina_link_worker');assert(call);assert.equal(call[1].target_worker,'w1');assert.equal(call[1].visibility,'personal');assert.equal(call[1].member_email,'ana@example.test');assert.equal(call[1].agreement_confirmed,true);
 value(c,'workerAccountMode','invite');change(c,'workerAccountMode');value(c,'workerEmail','new@example.test');value(c,'linkWorker','w2');value(c,'linkScope','shared');change(c,'linkScope');assert(!c.d.getElementById('linkAgreement').checked,'Changing visibility clears agreement');
 c.d.getElementById('linkAgreement').checked=true;click(c,'saveWorkerLink');await flush();assert(c.calls.some(x=>x[0]==='propina_issue_worker_invitation' && x[1].visibility==='shared' && x[1].target_worker==='w2'));assert.match(c.d.getElementById('workerLinkResult').textContent,/a{64}/);
 value(c,'restaurant','r2');change(c,'restaurant');await flush();assert(!c.d.getElementById('workerLinkResult').textContent.includes('a'.repeat(64)));assert.equal(c.d.getElementById('workerEmail').value,'');assert.equal(c.errors.length,0);c.dom.window.close();
 // Late personal data must not reappear after logout or restaurant change.
 let resolve;
 const d=await app({role:'viewer',platform:false,restaurantContext:linked,rpcOverrides:{propina_my_tips:()=>new Promise(r=>{resolve=r;})}});
 click(d,'logout');await flush();resolve({data:tips});await flush();assert(!d.d.getElementById('myTipsRows').textContent.includes('40.000'));assert(!visible(d,'app'));d.dom.window.close();
 const e=await app({role:'viewer',platform:false,restaurantContext:linked,rpcOverrides:{propina_my_tips:()=>({error:{message:'Sin permiso'}})}});
 assert.match(e.d.getElementById('myTipsStatus').textContent,/Sin permiso/);assert.equal(e.d.getElementById('myTipsTotal').textContent,'—','Failed request must not report $0');assert(!e.calls.some(c=>c[0]==='query'));e.dom.window.close();
 // A revoked link after refresh removes the personal page.
 const f=await app({role:'viewer',platform:false,restaurantContext:linked,rpcOverrides:{propina_my_tips:()=>({data:[]})}});
 f.context.restaurants[0]={id:'r1',name:'Local uno',role:'viewer'};click(f,'refreshMyTips');await flush();assert(!visible(f,'myTipsNav'));assert(visible(f,'access'));f.dom.window.close();
 console.log('PASS: personal/shared routes, no broad personal queries, filters, safe names, explicit linking/agreement, personal invitations, errors and stale-response isolation. Auth simulated.');
})().catch(e=>{console.error(e);process.exit(1);});
