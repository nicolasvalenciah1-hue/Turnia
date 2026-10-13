// Auth is mocked: do not send real reset emails or update real accounts.
const assert=require('node:assert/strict');
const {app,flush}=require('./ui-check.cjs');
async function click(a,id){a.d.getElementById(id).click();await flush();await flush();}
(async()=>{
  const a=await app({
    initialUrl:'https://turnia.test/#access_token=fixture&type=recovery',
    userMetadata:{turnia_team_setup:'v1'}
  });
  assert(!a.d.getElementById('recovery').classList.contains('hide'),'Recovery UI visible before app');
  assert(a.d.getElementById('auth').classList.contains('hide'),'Login hidden during reset');
  assert(a.d.getElementById('app').classList.contains('hide'),'Restaurant data hidden');
  assert(a.d.getElementById('savePassword').disabled,'Reset locked before Auth verification');
  assert(!a.calls.some(c=>c[0]==='propina_account_context'),'Reset never loads other restaurant data');
  assert.equal(a.navigations.length,0,'No invitation redirect during reset');
  await click(a,'savePassword');
  assert(!a.calls.some(c=>c[0]==='updateUser'),'Unverified reset cannot update password');
  a.authChange('PASSWORD_RECOVERY');
  assert(!a.d.getElementById('savePassword').disabled,'Auth recovery event unlocks form');
  assert.equal(a.w.location.hash,'','Auth URL tokens removed after verification');
  for(const pwd of ['short','123456789']){
    a.d.getElementById('newPassword').value=pwd;
    a.d.getElementById('confirmPassword').value=pwd;
    await click(a,'savePassword');
    assert(!a.calls.some(c=>c[0]==='updateUser'),'Too-short reset password rejected');
  }
  a.d.getElementById('newPassword').value='LongSecurePassword2026';
  a.d.getElementById('confirmPassword').value='LongSecurePassword2026';
  await click(a,'savePassword');
  assert(a.calls.some(c=>c[0]==='updateUser' && c[1].password==='LongSecurePassword2026'),'Verified reset updates Auth');
  assert(a.calls.some(c=>c[0]==='signOut' && c[1].scope==='local'),'Reset session signed out');
  assert(a.d.getElementById('recovery').classList.contains('hide'),'Reset UI closed');
  assert(!a.d.getElementById('auth').classList.contains('hide'),'User prompted to sign in again');
  assert.equal(a.d.getElementById('email').value,'owner@example.test');
  assert.match(a.d.getElementById('authMessage').textContent,/contraseña actualizada/i);
  a.dom.window.close();

  const b=await app({initialUrl:'https://turnia.test/#access_token=fixture&type=recovery'});
  b.authChange('PASSWORD_RECOVERY');
  await click(b,'cancelRecovery');
  assert(!b.calls.some(c=>c[0]==='updateUser'),'Cancel never resets password');
  assert(b.calls.some(c=>c[0]==='signOut'&&c[1].scope==='local'),'Cancel signs out');
  assert(!b.d.getElementById('auth').classList.contains('hide'),'Cancel returns to login');
  b.dom.window.close();

  const c=await app({loggedIn:false,initialUrl:'https://turnia.test/#error=access_denied&error_code=otp_expired'});
  assert(c.d.getElementById('recovery').classList.contains('hide'));
  assert.match(c.d.getElementById('authMessage').textContent,/caducado/i);
  assert.equal(c.w.location.hash,'');
  c.dom.window.close();

  // New password policy never invalidates already established login passwords.
  const legacy=await app({loggedIn:false,initialPassword:'old1234'});
  legacy.d.getElementById('email').value='owner@example.test';
  legacy.d.getElementById('password').value='old1234';
  legacy.d.getElementById('loginForm').dispatchEvent(new legacy.w.Event('submit',{cancelable:true,bubbles:true}));
  await flush();await flush();
  assert(!legacy.d.getElementById('app').classList.contains('hide'),'Existing login unchanged');
  legacy.dom.window.close();

  console.log('PASS: verified recovery, locked reset form, session isolation, 10-char new passwords, exit, expired links and old logins.');
})().catch(e=>{console.error(e);process.exitCode=1});
