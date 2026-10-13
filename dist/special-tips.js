(function(root){
'use strict';
const limit=1000000000000;
function pesos(n,zero=false){if(!Number.isSafeInteger(n)||n<(zero?0:1)||n>limit)throw Error('Usa montos en pesos completos y positivos.');return n;}
function allocations(amount,ids,custom){
 pesos(amount);ids=ids.slice().sort();
 if(!ids.length||new Set(ids).size!==ids.length||ids.length>amount)throw Error('Selecciona beneficiarios sin repetir.');
 const rows=ids.map((worker_id,i)=>({worker_id,amount:custom?pesos(custom[worker_id]):Math.floor(amount/ids.length)+(i<amount%ids.length?1:0)}));
 if(rows.reduce((s,a)=>s+a.amount,0)!==amount)throw Error('Los montos personalizados deben sumar la propina.');return rows;
}
function reconcile(gross,tips,present){
 pesos(gross,true);const ids=new Set(),refs=new Set();let special=0;
 for(const t of tips){
  if(!t.id||ids.has(t.id))throw Error('Propina duplicada.');ids.add(t.id);
  const ref=String(t.reference||'').trim().toLowerCase();
  if(ref.length<3||ref.length>120||refs.has(ref))throw Error('Ingresa un comprobante o referencia única.');refs.add(ref);
  if(!['debito','credito','efectivo','transferencia'].includes(t.payment)||!['equal','custom'].includes(t.method))throw Error('Método inválido.');
  pesos(t.amount);
  const expected=allocations(t.amount,t.allocations.map(a=>a.worker_id),t.method==='custom'?Object.fromEntries(t.allocations.map(a=>[a.worker_id,a.amount])):null);
  for(const a of t.allocations){if(expected.find(e=>e.worker_id===a.worker_id)?.amount!==a.amount)throw Error('Asignaciones inválidas.');if(present&&!present.includes(a.worker_id))throw Error('Todos los beneficiarios deben estar presentes.');}
  special+=t.amount;if(special>gross)throw Error('Las propinas especiales superan las propinas de caja.');
 }
 return {gross,special,shared:gross-special};
}
const api={allocations,reconcile};if(typeof module==='object')module.exports=api;else root.TurniaSpecial=api;
})(typeof window==='undefined'?globalThis:window);
