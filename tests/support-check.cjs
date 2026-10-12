// Simulated support flow. No external requests or real customer data.
const assert=require('node:assert/strict');
const {app,flush}=require('./ui-check.cjs');

function installSupportStore(ctx,{tickets=[],messages=[]}={}){
  let sequence=0;
  const {sb,calls,user}=ctx;
  const list=(table)=>table==='turnia_support_tickets'?tickets:messages;
  sb.from=table=>{
    assert(['turnia_support_tickets','turnia_support_messages'].includes(table),'Support requests must use support tables only');
    return {
      select(fields='*'){
        const result=()=>({data:list(table).map(x=>({...x})),error:null});
        return {
          eq:async(key,value)=>({data:list(table).filter(x=>x[key]===value).map(x=>({...x})),error:null}),
          then(onFulfilled,onRejected){return Promise.resolve(result()).then(onFulfilled,onRejected);}
        };
      },
      insert(payload){
        calls.push(['support_insert',table,payload]);
        const item={id:'support-'+(++sequence),created_at:'2026-10-12T19:00:00Z',...payload};
        list(table).push(item);
        return {select:()=>({single:async()=>({data:{id:item.id},error:null})})};
      },
      update(payload){
        return {eq(key,val){
          return {select:()=>({single:async()=>{
            const item=list(table).find(x=>x[key]===val);
            if(!item)return {error:{message:'Not found'}};
            Object.assign(item,payload);
            calls.push(['support_update',table,payload]);
            return {data:{id:item.id},error:null};
          }})};
        }};
      }
    };
  };
  return {tickets,messages};
}
(async()=>{
  let completePlatform;
  const a=await app({platform:true,rpcOverrides:{propina_platform_snapshot:()=>new Promise(resolve=>{completePlatform=resolve;})}});
  const store=installSupportStore(a);
  a.d.querySelector('[data-tab="support"]').click(); await flush();
  assert(!a.d.querySelector('#support').classList.contains('hide'),'Support navigation opens for restaurant');
  assert.match(a.d.querySelector('#supportListStatus').textContent,/0 solicitud/);
  a.d.querySelector('#supportSubject').value='Problema al guardar';
  a.d.querySelector('#supportDescription').value='El botón de guardar no confirma el registro de la jornada.';
  a.d.querySelector('#supportCategory').value='error';
  a.d.querySelector('#sendSupportTicket').click();await flush();await flush();
  assert.equal(store.tickets.length,1,'Creating a support ticket stores one record');
  assert.equal(store.tickets[0].restaurant_id,'r1','Ticket belongs to selected restaurant');
  assert.equal(store.tickets[0].created_by,'test-user','Ticket attributed to signed-in user');
  assert.equal(store.tickets[0].status,'pendiente','Support ticket starts pending');
  assert.match(a.d.querySelector('#supportComposeStatus').textContent,/registrada/i,'Success is shown only after insert');
  assert.match(a.d.querySelector('#supportTickets').textContent,/Problema al guardar/);
  a.d.querySelector('#supportTickets [data-support-open]').click();await flush();
  assert.match(a.d.querySelector('#supportThreadMessages').textContent,/El botón de guardar no confirma/,'Original incident description is visible');
  a.d.querySelector('#supportReply').value='Revisaremos la fecha y la conexión.';
  a.d.querySelector('#sendSupportReply').click();await flush();
  assert.equal(store.messages.length,1,'Replies are stored');
  assert.equal(store.messages[0].ticket_id,store.tickets[0].id);
  assert.match(a.d.querySelector('#supportThreadMessages').textContent,/Revisaremos la fecha/,'Reply is shown');
  a.d.querySelector('#supportStatusSelect').value='en_revision';
  a.d.querySelector('#saveSupportStatus').click();await flush();
  assert.equal(store.tickets[0].status,'en_revision','Platform owner may change status');
  assert(a.calls.some(x=>x[0]==='support_update'),'Status change persisted');
  a.d.querySelector('[data-tab="owner"]').click();await flush();
  assert.match(a.d.querySelector('#ownerSupportTickets').textContent,/Problema al guardar/,'Platform owner inbox sees report');
  assert.match(a.d.querySelector('#ownerSupportStatus').textContent,/1 solicitudes/);
  assert.match(a.d.querySelector('#ownerSupportTickets').textContent,/Restaurante/,'Before snapshot, placeholder may appear');
  assert.equal(typeof completePlatform,'function','Platform overview should be requested');
  completePlatform({data:{restaurants:[{id:'r1',name:'Local uno',email:'owner@example.test',active:true,members:1}],invitations:[]}});
  await flush();
  assert.match(a.d.querySelector('#ownerSupportTickets').textContent,/Local uno/,'After restaurant data loads, the owner inbox must show the correct restaurant name');
  assert.equal(a.errors.length,0,'No browser errors in owner flow');
  a.dom.window.close();

  // A read-only worker still has a way to report a problem.
  const w=await app({platform:false,role:'viewer',restaurantContext:{read_scope:'personal',worker_id:'w1'}});
  const workerStore=installSupportStore(w,{tickets:[{
    id:'visible-ticket',restaurant_id:'r1',created_by:'test-user',category:'consulta',
    subject:'Consulta propia',description:'Quiero consultar el reparto de mi jornada.',
    status:'pendiente',created_at:'2026-10-12T19:00:00Z'
  }]});
  assert(!w.d.querySelector('[data-tab="support"]').classList.contains('hide'),'Support remains available to personal viewer');
  w.d.querySelector('[data-tab="support"]').click();await flush();
  assert(!w.d.querySelector('#support').classList.contains('hide'),'Personal viewer can open support');
  assert.equal(w.d.querySelector('#supportTickets [data-support-open]').dataset.supportOpen,'visible-ticket');
  w.d.querySelector('#supportTickets [data-support-open]').click();await flush();
  assert(w.d.querySelector('#supportStatusControls').classList.contains('hide'),'Only platform owner sees status controls');
  w.d.querySelector('#supportSubject').value='<img src=x onerror=alert(1)> reporte';
  w.d.querySelector('#supportDescription').value='No puedo ver mi monto diario por turno.';
  w.d.querySelector('#sendSupportTicket').click();await flush();
  assert(!w.d.querySelector('#supportTickets img'),'Untrusted support subject is escaped before display');
  assert.equal(workerStore.tickets.length,2);
  assert.equal(w.errors.length,0);
  w.dom.window.close();
  console.log('PASS: support creation, original description, replies, status updates, owner inbox, worker support and escaped text. Mock tests only.');
})().catch(error=>{console.error(error);process.exitCode=1});
