'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const PROJECT_URL = 'https://kfaolqnrqlypoyzkejlt.supabase.co';
  const PUBLIC_KEY = 'sb_publishable_uT_FeTqwfX8AhkUtgmo--Q_bemTQkwP';
  // Match the main app so a temporary session survives the setup redirect
  // without being persisted on a shared device.
  let sessionStorageBackend;
  try {
    const keepSession=localStorage.getItem('propina_keep_session')!=='0';
    sessionStorageBackend=keepSession?localStorage:sessionStorage;
    if(!keepSession)localStorage.removeItem('sb-kfaolqnrqlypoyzkejlt-auth-token');
  } catch { sessionStorageBackend=undefined; }
  const sb = window.supabase?.createClient(PROJECT_URL, PUBLIC_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage:sessionStorageBackend }
  });
  const check = response => { if(response.error) throw response.error; return response.data; };
  const message = (text, bad=false) => {
    $('status').textContent = text;
    $('status').className = 'notice'+(bad?' error':'');
  };
  let busy=false;
  const withBusy = async (button, action) => {
    if(busy) return; busy=true; button.disabled=true;
    try { await action(); }
    catch(e) { message(e?.message||'No se pudo completar la operación. Intenta nuevamente.',true); }
    finally { busy=false; button.disabled=false; }
  };
  const toggle = (login) => {
    $('loginExisting').hidden=!login;
    $('signupForm').hidden=login;
    $('showSignup').setAttribute('aria-pressed',String(!login));
    $('showLogin').setAttribute('aria-pressed',String(login));
  };
  const showAccount = async () => {
    if(!sb) {message('No se pudo cargar el servicio de cuentas. Recarga la página.',true);return;}
    const session=check(await sb.auth.getSession()).session;
    if (!session) {
      $('authArea').hidden=false; $('createArea').hidden=true;
      message('Crea tu cuenta o inicia sesión. Debes verificar tu correo antes de crear el equipo.');
      return;
    }
    const account=check(await sb.auth.getUser()).user;
    if (!account?.email_confirmed_at) {
      $('authArea').hidden=false; $('createArea').hidden=true;
      message('Confirma el enlace enviado a tu correo para continuar.',true);return;
    }
    $('authArea').hidden=true; $('createArea').hidden=false;
    $('currentEmail').textContent=account.email||'';
    $('teamName').value=String(account.user_metadata?.turnia_team_name||'').slice(0,80);
    message('Tu correo está confirmado. Crea un equipo para comenzar, sin pagos.');
  };
  $('showSignup').addEventListener('click',()=>toggle(false));
  $('showLogin').addEventListener('click',()=>toggle(true));
  $('signupForm').addEventListener('submit', e => {
    e.preventDefault();
    const button=e.submitter||$('signupForm').querySelector('button[type=submit]');
    void withBusy(button,async()=>{
      const fullName=$('fullName').value.trim(), teamName=$('teamNameSignup').value.trim();
      const pwd=$('passwordSignup').value;
      if (fullName.length<2 || fullName.length>80 || teamName.length<2 || teamName.length>80)
        throw Error('Revisa tu nombre y el nombre del equipo.');
      if (pwd.length<10 || pwd!==$('passwordConfirm').value)
        throw Error('Utiliza una contraseña de al menos 10 caracteres y repítela correctamente.');
      if (!$('consentSignup').checked) throw Error('Debes confirmar las condiciones de coordinación.');
      const response=check(await sb.auth.signUp({
        email:$('emailSignup').value.trim().toLowerCase(),
        password:pwd,
        options:{
          emailRedirectTo:location.origin+'/equipo.html',
          data:{display_name:fullName,turnia_team_setup:'v1',turnia_team_name:teamName}
        }
      }));
      $('passwordSignup').value='';$('passwordConfirm').value='';
      if(response.session){
        await showAccount();
      }else{
        $('signupForm').hidden=true;
        message('Revisa tu correo y abre el enlace de confirmación. Cuando vuelvas aquí, podrás crear tu equipo. No se ha creado ni cobrado nada todavía.');
      }
    });
  });
  $('loginExisting').addEventListener('submit',e=>{
    e.preventDefault();
    const button=e.submitter||$('loginExisting').querySelector('button[type=submit]');
    void withBusy(button,async()=>{
      check(await sb.auth.signInWithPassword({email:$('emailExisting').value.trim(),password:$('passwordExisting').value}));
      $('passwordExisting').value='';
      await showAccount();
    });
  });
  $('teamForm').addEventListener('submit',e=>{
    e.preventDefault();
    const button=e.submitter||$('createTeam');
    void withBusy(button,async()=>{
      const teamName=$('teamName').value.trim();
      if(teamName.length<2 || teamName.length>80)throw Error('Nombre de equipo inválido (2 a 80 caracteres).');
      if(!$('acceptAgreement').checked)throw Error('Confirma los acuerdos de gestión del equipo.');
      const result=check(await sb.rpc('turnia_create_worker_team',{team_name:teamName}));
      if(!result)throw Error('No pudimos confirmar la creación del equipo.');
      message('¡Equipo creado! Entrando a Turnia…');
      location.assign('/?equipo_creado=1');
    });
  });
  showAccount().catch(e=>message(e?.message||'No se pudo verificar la sesión.',true));
})();
