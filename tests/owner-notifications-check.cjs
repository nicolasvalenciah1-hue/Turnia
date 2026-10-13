// UI-only tests with fake RPC responses; does NOT contact production Supabase or Resend.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {app,flush}=require('./ui-check.cjs');
const sql=fs.readFileSync(__dirname+'/../supabase/migrations/20261013_owner_support_notification_dashboard.sql','utf8');
const privateAccess=fs.readFileSync(__dirname+'/../supabase/migrations/20261013_turnia_private_notification_access.sql','utf8');
const privateRpc=fs.readFileSync(__dirname+'/../supabase/migrations/20261013_turnia_private_notification_rpc.sql','utf8');
const id1='4694fa56-0000-4000-8000-000000000001';
const id2='8141f66b-0000-4000-8000-000000000002';
const id3='9a9a9a9a-0000-4000-8000-000000000003';
const latest=()=>{
  const shared={attempts:1,created_at:'2026-10-13T02:12:00Z',sent_at:null,category:'consulta'};
  return {totals:{sent:2,pending:1,failed:1,total:4},recent:[
    {...shared,ticket_id:id1,restaurant_name:'Turín Ristorante',subject:'Consulta enviada',status:'sent'},
    {...shared,ticket_id:id2,restaurant_name:'Local B',subject:'Aviso en cola',status:'sending'},
    {...shared,ticket_id:id3,restaurant_name:'Local C',subject:'<img src=x>',status:'failed',attempts:5}
  ],limit:50};
};
(async()=>{
  assert.match(sql,/security definer/i);
  assert.match(sql,/set search_path = ''/i);
  assert.match(sql,/propina_private\.is_platform_admin\(\)/i);
  assert.match(sql,/auth\.uid\(\) is null/i);
  assert.match(sql,/revoke all on function public\.turnia_owner_support_notification_overview\(\)/i);
  assert.match(sql,/grant execute on function public\.turnia_owner_support_notification_overview\(\)\s+to authenticated/i);
  assert(!/grant\s+select\s+on\s+public\.turnia_support_email_outbox\s+to authenticated/i.test(sql));
  let data=latest();
  assert.match(privateAccess,/propina_private\.turnia_notification_owner/);
  assert.match(privateAccess,/sole_account boolean not null default true unique/);
  assert.match(privateAccess,/propina_private\.is_platform_admin\(\)/);
  assert.match(privateAccess,/revoke all on propina_private\.turnia_notification_owner from public, anon, authenticated/);
  assert.match(privateRpc,/propina_private\.is_turnia_notification_owner\(\)/);
  assert.match(privateAccess,/grant execute on function public\.turnia_notifications_access\(\) to authenticated/);
  const owner=await app({platform:true,rpcOverrides:{
    propina_platform_snapshot:async()=>({data:{restaurants:[],invitations:[]}}),
    turnia_owner_support_notification_overview:async()=>({data})
  }});
  assert(!owner.d.querySelector('#notificationsNav').classList.contains('hide'),'Exclusive navigation is displayed to authorized account');
  owner.d.querySelector('[data-tab="notifications"]').click();
  await flush();await flush();
  assert.equal(owner.d.querySelector('#ownerNotificationsSent').textContent,'2');
  assert.equal(owner.d.querySelector('#ownerNotificationsPending').textContent,'1');
  assert.equal(owner.d.querySelector('#ownerNotificationsFailed').textContent,'1');
  assert.equal(owner.d.querySelectorAll('#ownerNotificationsRows tr').length,3);
  assert.match(owner.d.querySelector('#ownerNotificationsRows').textContent,/8141F66B/);
  assert(!owner.d.querySelector('#ownerNotificationsRows img'),'Support subjects must be HTML-escaped');
  assert.equal(owner.d.querySelectorAll('[data-notification-open]').length,3,'Every row links to its ticket');
  assert.equal(owner.d.querySelector('#ownerNotificationsFilter').value,'all');
  const filter=owner.d.querySelector('#ownerNotificationsFilter');
  filter.value='pending';filter.dispatchEvent(new owner.w.Event('change',{bubbles:true}));
  assert.equal(owner.d.querySelectorAll('#ownerNotificationsRows tr').length,1);
  assert.match(owner.d.querySelector('#ownerNotificationsRows').textContent,/Procesando/);
  assert.equal(owner.d.querySelector('#ownerNotificationsSent').textContent,'2','Filter must not change global counters');
  filter.value='failed';filter.dispatchEvent(new owner.w.Event('change',{bubbles:true}));
  assert.match(owner.d.querySelector('#ownerNotificationsRows').textContent,/Fallida/);
  assert(!owner.d.querySelector('#ownerNotificationsRows img'));
  data={totals:{sent:3,pending:0,failed:0,total:3},recent:[{...latest().recent[0],subject:'Correo entregado'}],limit:50};
  owner.d.querySelector('#refreshOwnerNotifications').click();
  await flush();
  assert.equal(owner.d.querySelector('#ownerNotificationsSent').textContent,'3');
  filter.value='all';filter.dispatchEvent(new owner.w.Event('change',{bubbles:true}));
  assert.match(owner.d.querySelector('#ownerNotificationsRows').textContent,/Correo entregado/);
  assert.equal(owner.errors.length,0,'No browser errors in notification owner dashboard');
  assert(owner.d.querySelector('#ownerNotificationsPanel').closest('section').id==='notifications','Panel is separate from owner page');
  owner.dom.window.close();
  const client=await app({platform:false,role:'viewer',restaurantContext:{read_scope:'personal',worker_id:'w1'}});
  assert(client.d.querySelector('#ownerNav').classList.contains('hide'),'Owner panel must be hidden from restaurant viewers');
  assert(client.d.querySelector('#notificationsNav').classList.contains('hide'),'Notification menu must be hidden from customers');
  client.d.querySelector('[data-tab="notifications"]').click();await flush();
  assert(client.d.querySelector('#notifications').classList.contains('hide'),'Customers cannot open notifications by a hidden button');
  client.d.querySelector('[data-tab="owner"]').click();
  await flush();
  assert(client.d.querySelector('#owner').classList.contains('hide'),'Non-owner cannot switch to privileged owner tab');
  assert(!client.calls.some(call=>call[0]==='turnia_owner_support_notification_overview'),'Non-owner never requests private notification RPC');
  assert.equal(client.errors.length,0);
  client.dom.window.close();

  const restricted=await app({platform:true,rpcOverrides:{turnia_notifications_access:async()=>({data:false})}});
  assert(restricted.d.querySelector('#ownerNav').classList.contains('hide')===false,'Future platform administrators retain normal owner navigation');
  assert(restricted.d.querySelector('#notificationsNav').classList.contains('hide'),'Non-whitelisted platform administrator cannot see notifications menu');
  restricted.d.querySelector('[data-tab="notifications"]').click();await flush();
  assert(restricted.d.querySelector('#notifications').classList.contains('hide'),'Non-whitelisted admin cannot navigate to the notification page');
  assert(!restricted.calls.some(call=>call[0]==='turnia_owner_support_notification_overview'),'Private delivery summary is never requested without permission');
  restricted.dom.window.close();
  const denied=await app({platform:true,rpcOverrides:{
    propina_platform_snapshot:async()=>({data:{restaurants:[],invitations:[]}}),
    turnia_owner_support_notification_overview:async()=>({error:{message:'permission denied'}})
  }});
  denied.d.querySelector('[data-tab="notifications"]').click();await flush();await flush();
  assert.match(denied.d.querySelector('#ownerNotificationsStatus').textContent,/No se pudieron consultar/);
  assert(!/permission denied/i.test(denied.d.querySelector('#ownerNotificationsStatus').textContent),'No sensitive error details displayed');
  denied.dom.window.close();
  console.log('PASS: standalone private notifications tab, future-admin access denial, filters, escaping, refresh and safe error UX. Mock tests only.');
})().catch(e=>{console.error(e);process.exitCode=1});
