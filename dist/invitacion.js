'use strict';
(async () => {
  const $ = id => document.getElementById(id);
  const message = (text, error = false) => { $('invitationStatus').textContent = text; $('invitationStatus').className = 'notice ' + (error ? 'error' : 'info'); };
  const check = result => { if (result.error) throw result.error; return result.data; };
  let code = new URL(location.href).searchParams.get('codigo') || '';
  let sb, needsPassword = false, validated = false, busy = false;
  // Exiting an invitation signs out its temporary session first. Otherwise
  // the app can redirect the same invited account back here indefinitely.
  $('leaveInvitation').addEventListener('click', async () => {
    const button = $('leaveInvitation'); button.disabled = true;
    try {
      if (sb) check(await sb.auth.signOut({ scope: 'local' }));
      (window.__navigate || (target => location.replace(target)))('/');
    } catch (error) {
      message('No pudimos cerrar esta sesión. Reintenta para volver al inicio sin completar la invitación.', true);
    } finally { button.disabled = false; }
  });
  try {
    const keep = localStorage.getItem('propina_keep_session') !== '0';
    sb = window.supabase.createClient('https://kfaolqnrqlypoyzkejlt.supabase.co', 'sb_publishable_uT_FeTqwfX8AhkUtgmo--Q_bemTQkwP', { auth: { storage: keep ? localStorage : sessionStorage, persistSession: true, detectSessionInUrl: true } });
    const session = check(await sb.auth.getSession()).session;
    history.replaceState(null, '', location.pathname);
    if (!session) throw Error('Abre el enlace del correo para confirmar tu dirección. Si venció, solicita al administrador que reenvíe la invitación.');
    const account = check(await sb.auth.getUser()).user;
    code = code || account.user_metadata?.propina_invitation || '';
    $('invitationEmail').value = account.email || '';
    $('invitationCode').value = code;
    $('confirmCode').classList.remove('hide');
    message('Correo verificado. Confirma el código de tu invitación.');
  } catch (error) { message(error.message || 'No se pudo abrir la invitación.', true); return; }
  $('confirmCode').addEventListener('submit', async e => {
    e.preventDefault(); if (busy) return; busy = true;
    const button = e.submitter || $('confirmCode').querySelector('button'); button.disabled = true;
    try {
      code = $('invitationCode').value.trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(code)) throw Error('Introduce el código completo de 64 caracteres.');
      const info = check(await sb.rpc('turnia_validate_invitation_account', { token: code }));
      needsPassword = info.needs_password; validated = true;
      $('confirmCode').classList.add('hide'); $('createInvitationAccount').classList.remove('hide');
      $('newAccountFields').classList.toggle('hide', !needsPassword);
      ['invitationName','invitationPassword','invitationPasswordConfirm'].forEach(id => { $(id).required = needsPassword; });
      $('accountTitle').textContent = needsPassword ? 'Crea tu cuenta' : 'Tu cuenta ya existe';
      $('finishInvitation').textContent = needsPassword ? 'Crear cuenta y entrar a Turnia →' : 'Aceptar invitación y entrar →';
      message(needsPassword ? 'Código confirmado. Elige tu nombre y contraseña.' : 'Código confirmado. Usaremos tu cuenta actual.');
    } catch (error) { message(error.message || 'La invitación no está disponible.', true); }
    finally { busy = false; button.disabled = false; }
  });
  $('createInvitationAccount').addEventListener('submit', async e => {
    e.preventDefault(); if (!validated || busy) return; busy = true; $('finishInvitation').disabled = true;
    try {
      // Recheck revocation/expiry before changing account data. Redemption remains atomic.
      check(await sb.rpc('turnia_validate_invitation_account', { token: code }));
      if (needsPassword) {
        const name = $('invitationName').value.trim(), password = $('invitationPassword').value;
        if (name.length < 2 || password.length < 8) throw Error('Escribe tu nombre y una contraseña de al menos 8 caracteres.');
        if (password !== $('invitationPasswordConfirm').value) throw Error('Las contraseñas deben coincidir.');
        check(await sb.auth.updateUser({ password, data: { display_name: name } }));
        needsPassword = false;
        $('newAccountFields').classList.add('hide');
        ['invitationName','invitationPassword','invitationPasswordConfirm'].forEach(id => { $(id).required = false; });
      }
      const phone = $('invitationPhone').value.trim();
      if (phone && !/^[+0-9 ()-]{7,30}$/.test(phone)) throw Error('Revisa el teléfono de contacto.');
      const desiredName = $('invitationRestaurantName').value.trim().replace(/\\s+/g, ' ');
      if (desiredName && (desiredName.length < 2 || desiredName.length > 80)) throw Error('El nombre del restaurante debe tener entre 2 y 80 caracteres.');
      if (phone) check(await sb.auth.updateUser({ data: { phone } }));
      // The redemption decides the role on the server. Client-entered names cannot grant access.
      const accepted = check(await sb.rpc('propina_accept_invitation', { token: code }));
      // A restaurant-owner invitation authorizes exactly one new restaurant. Other roles skip creation.
      if (accepted?.role === 'restaurant_owner') {
        const restaurantName = desiredName || 'Mi restaurante';
        try {
          const rid = check(await sb.rpc('propina_create_restaurant', { restaurant_name: restaurantName }));
          const current = check(await sb.auth.getUser()).user;
          const managerName = String(current?.user_metadata?.display_name || current?.user_metadata?.full_name || '').trim();
          // Supplementary information stays optional: address, city and tax ID can be entered later.
          try {
            check(await sb.rpc('propina_update_restaurant_business_profile', {
              rid, restaurant_name: restaurantName,
              profile: { legal_name:'', tax_id:'', business_type:'', street_address:'', city:'',
                commune:'', region:'', phone: phone || String(current?.user_metadata?.phone || ''),
                contact_email: current?.email || '', manager_name: managerName }
            }));
          } catch { /* The restaurant already exists; additional details can be edited from Ajustes. */ }
        } catch (error) {
          // Invitation was redeemed; the existing restaurant-setup fallback can safely retry.
          try { sessionStorage.setItem('turnia_pending_setup_name', restaurantName); } catch {}
          message('Tu cuenta está activada. Completa la creación del restaurante desde Turnia. '+(error.message || ''), true);
          location.replace('/');
          return;
        }
      }
      // Metadata only directs the UI. Authorization lives in the database.
      await sb.auth.updateUser({ data: { propina_invitation: null, turnia_invitation_setup: null } });
      $('invitationPassword').value = ''; $('invitationPasswordConfirm').value = '';
      message('Cuenta y acceso activados. Preparando tu guía de Turnia…');
      location.replace('/');
    } catch (error) { message(error.message || 'No se pudo completar la cuenta. Reintenta.', true); }
    finally { busy = false; $('finishInvitation').disabled = false; }
  });
})();
