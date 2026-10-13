const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const {JSDOM,VirtualConsole} = require('jsdom');
const flush = () => new Promise(resolve => setTimeout(resolve, 25));
async function account({existing=false,invalid=false,owner=false}={}) {
  const calls=[];
  const dom=new JSDOM(fs.readFileSync('dist/invitacion.html','utf8'),{url:'https://turnia-kkbm.onrender.com/invitacion.html?codigo='+'a'.repeat(64),runScripts:'outside-only',virtualConsole:new VirtualConsole()});
  const sb={auth:{getSession:async()=>({data:{session:{user:{}}}}),getUser:async()=>({data:{user:{email:'invited@example.com',user_metadata:{display_name:'Invitado'}}}}),updateUser:async args=>{calls.push(['update',args]);return {data:{}};}},rpc:async(fn,args)=>{calls.push([fn,args]);return invalid?{error:{message:'Invitación no disponible'}}:{data:fn==='propina_accept_invitation'?{role:owner?'restaurant_owner':'admin'}:fn==='propina_create_restaurant'?'r-new':{needs_password:!existing}};}};
  dom.window.supabase={createClient:()=>sb};dom.window.eval(fs.readFileSync('dist/invitacion.js','utf8'));await flush();
  const d=dom.window.document;
  assert.equal(dom.window.location.search,'','Code removed from URL');
  d.querySelector('#confirmCode').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();
  if(invalid){assert(d.querySelector('#createInvitationAccount').classList.contains('hide'));assert(!calls.some(c=>c[0]==='update'));dom.window.close();return;}
  assert(!d.querySelector('#createInvitationAccount').classList.contains('hide'));
  d.querySelector('#invitationName').value='Invitado';d.querySelector('#invitationPassword').value='SafePassword123';d.querySelector('#invitationPasswordConfirm').value='Mismatch';
  if(!existing){d.querySelector('#createInvitationAccount').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();assert(!calls.some(c=>c[0]==='update'),'Mismatch cannot change password');}
  d.querySelector('#invitationPasswordConfirm').value='SafePassword123';
  if (owner) { d.querySelector('#invitationRestaurantName').value='Restaurante Piloto'; d.querySelector('#invitationPhone').value='+56 9 5555 5555'; }
  d.querySelector('#createInvitationAccount').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await flush();
  assert(calls.some(c=>c[0]==='propina_accept_invitation'));
  if (owner) {
    assert(calls.some(c=>c[0]==='propina_create_restaurant'&&c[1].restaurant_name==='Restaurante Piloto'),'Owner restaurant created automatically');
    assert(calls.some(c=>c[0]==='propina_update_restaurant_business_profile'&&c[1].profile.phone==='+56 9 5555 5555'),'Contact phone saved automatically');
  } else assert(!calls.some(c=>c[0]==='propina_create_restaurant'),'Worker invitations do not create restaurants');
  assert.equal(calls.filter(c=>c[0]==='update'&&c[1].password).length,existing?0:1,'Existing password is preserved');
  assert(calls.some(c=>c[0]==='update'&&c[1].data.turnia_invitation_setup===null));
  dom.window.close();
}
async function server({existing=false,claimError=false,smtpError=false,invalidJwt=false,linkError=false}={}) {
  let handler;const calls=[];
  const visitor={auth:{getUser:async()=>invalidJwt?{error:{}}:{data:{user:{id:'owner'}}}},rpc:async(fn,args)=>{calls.push([fn,args]);return claimError?{error:{}}:{data:{id:'invitation',email:'stored@example.com',existing_account:existing,attempt:1}};}};
  const admin={auth:{admin:{inviteUserByEmail:async(...args)=>{calls.push(['invite',...args]);return {error:smtpError?{}:null};}},signInWithOtp:async args=>{calls.push(['otp',args]);return {error:smtpError?{}:null};}},rpc:async(fn,args)=>{calls.push([fn,args]);return {data:null};}};
  let count=0;
  const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/turnia-invite-email/index.ts','utf8').replace(/^import .*;\n/,''));
  vm.runInNewContext(source,{createClient:()=>count++===0?visitor:admin,Response,Request,AbortSignal,
    fetch:async (url,options)=>{calls.push(['second-email',url,JSON.parse(options.body)]);return {ok:!linkError,status:linkError?403:200};},
    Deno:{env:{get:()=> 'configured'},serve:fn=>handler=fn}});
  const response=await handler(new Request('https://example.com',{method:'POST',headers:{Authorization:'Bearer user-jwt',Origin:'https://turnia-kkbm.onrender.com','Content-Type':'application/json'},body:JSON.stringify({token:'a'.repeat(64),email:'attacker@example.com'})}));
  if(invalidJwt||claimError){assert.equal(response.status,invalidJwt?401:403);assert(!calls.some(c=>['invite','otp'].includes(c[0])));return;}
  assert.equal(response.status,smtpError?502:200);
  if(existing){const otp=calls.find(c=>c[0]==='otp')[1];assert.equal(otp.email,'stored@example.com');assert.equal(otp.options.shouldCreateUser,false);}
  else{const invite=calls.find(c=>c[0]==='invite');assert.equal(invite[1],'stored@example.com');assert.equal(invite[2].data.propina_invitation,'a'.repeat(64));}
  assert.equal(calls.find(c=>c[0]==='turnia_finish_invitation_email')[1].delivered_to_smtp,!smtpError);
  assert.equal(calls.some(c=>c[0]==='second-email'),!smtpError,'Do not send second email when primary failed');
  if(!smtpError){
    const sent=calls.find(c=>c[0]==='second-email')[2];
    assert.equal(sent.to[0],'stored@example.com','Only email the authorized stored recipient');
    assert(sent.html.includes('https://turnia-kkbm.onrender.com/'),'Visible app URL in email');
    assert(sent.html.includes('a'.repeat(64)),'Invitation code in email');
    const result=await response.json();
    assert.equal(result.app_link_email,linkError?'failed':'sent','Secondary failure leaves original confirmation successful');
  }
}
async function automaticEmail() {
  const {app}=require('./ui-check.cjs');
  const invite={email:'invited@example.com',token:'b'.repeat(64),expires_at:'2026-12-01T00:00:00Z'};
  const a=await app({rpcOverrides:{propina_issue_membership_invitation:async()=>({data:invite}),propina_issue_staff_invitation:async()=>({data:invite})}});
  const sent=[];let fail=true;
  a.sb.functions={invoke:async(name,args)=>{sent.push([name,args]);return fail?{error:{message:'SMTP'}}:{data:{status:'accepted_by_smtp'}};}};
  a.d.querySelector('#adminEmail').value=invite.email;
  a.d.querySelector('#adminRole').value='restaurant_owner';
  a.d.querySelector('#adminInvite').click();await flush();
  assert.equal(sent.length,1,'Creating platform invitation sends email automatically');
  assert.match(a.d.querySelector('#inviteResult').textContent,/no se confirmó/);
  fail=false;a.d.querySelector('#inviteResult button').click();await flush();
  assert.equal(sent.length,2,'Retry uses same invitation');
  assert.equal(a.calls.filter(c=>c[0]==='propina_issue_membership_invitation').length,1,'Retry does not generate a new code');
  a.d.querySelector('#staffEmail').value=invite.email;a.d.querySelector('#staffInvite').click();await flush();
  assert.equal(sent.length,3,'Staff invitation sends automatically');
  assert.equal(sent[2][1].body.token,invite.token);
  a.dom.window.close();
}
(async()=>{await account();await account({owner:true});await account({existing:true});await account({invalid:true});await server();await server({existing:true});await server({smtpError:true});await server({linkError:true});await server({claimError:true});await server({invalidJwt:true});await automaticEmail();console.log('PASS: automatic invitation email, same-code retry, code/password validation, existing account, authorized destination, SMTP failure and invalid session. Simulated email; no real messages sent.');})().catch(e=>{console.error(e);process.exitCode=1;});
