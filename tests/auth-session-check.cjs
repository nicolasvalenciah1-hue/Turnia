const assert=require('node:assert/strict');
const {app,flush}=require('./ui-check.cjs');
const authError={name:'AuthSessionMissingError',code:'session_not_found',message:'Auth session missing!'};
(async()=>{
  const a=await app();
  assert(!a.d.getElementById('app').classList.contains('hide'));
  assert.match(a.d.getElementById('workers').textContent,/Camila/);
  a.sb.rpc=async()=>({error:authError});
  a.d.getElementById('refreshPlatform').click();
  await flush();await flush();
  assert(a.d.getElementById('app').classList.contains('hide'),'Old dashboard hidden after losing the session');
  assert(!a.d.getElementById('auth').classList.contains('hide'),'Login shown');
  assert.match(a.d.getElementById('authMessage').textContent,/sesión/i,'Friendly explanation');
  assert(!a.d.getElementById('workers').textContent.includes('Camila'),'Cached workers cleared');
  assert.equal(a.d.getElementById('email').value,'owner@example.test');
  assert(a.calls.some(x=>x[0]==='signOut'),'Auth client instructed to close unusable session');
  a.dom.window.close();

  const b=await app();
  b.sb.auth.getUser=async()=>({error:authError});
  b.w.dispatchEvent(new b.w.Event('focus'));
  await flush();await flush();
  assert(b.d.getElementById('app').classList.contains('hide'),'Expired session found after returning to tab');
  b.dom.window.close();

  const c=await app();
  c.sb.auth.getUser=async()=>({error:{message:'Failed to fetch',code:'network_error'}});
  c.w.dispatchEvent(new c.w.Event('focus'));
  await flush();await flush();
  assert(!c.d.getElementById('app').classList.contains('hide'),'Network outage alone cannot sign the user out');
  c.dom.window.close();

  console.log('PASS: invalid session hides historic dashboard, resumes safely, preserves accounts on network errors.');
})().catch(e=>{console.error(e);process.exitCode=1});