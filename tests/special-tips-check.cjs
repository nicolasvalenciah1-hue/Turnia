'use strict';
const assert = require('node:assert/strict');
function reconcile(gross, tips) {
 if(!Number.isSafeInteger(gross)||gross<0) throw Error('gross');
 const ids=new Set();let special=0;
 for(const tip of tips){
  if(ids.has(tip.key)) throw Error('duplicate');ids.add(tip.key);
  if(!Number.isSafeInteger(tip.amount)||tip.amount<=0) throw Error('amount');
  if(!tip.allocations.length||tip.allocations.some(a=>!Number.isSafeInteger(a)||a<=0)) throw Error('allocations');
  if(tip.allocations.reduce((a,b)=>a+b,0)!==tip.amount) throw Error('unbalanced');
  special+=tip.amount;
 }
 if(special>gross) throw Error('exceeds gross');
 return {shared:gross-special,special};
}
assert.deepEqual(reconcile(250000,[{key:'a',amount:20000,allocations:[10000,10000]}]),{shared:230000,special:20000});
assert.deepEqual(reconcile(250000,[]),{shared:250000,special:0});
assert.throws(()=>reconcile(10000,[{key:'a',amount:20000,allocations:[10000,10000]}]));
assert.throws(()=>reconcile(250000,[{key:'a',amount:20000,allocations:[20000]},{key:'a',amount:20000,allocations:[20000]}]));
assert.throws(()=>reconcile(250000,[{key:'a',amount:20000,allocations:[9999,10000]}]));
console.log('Special tips reconciliation draft checks passed');
