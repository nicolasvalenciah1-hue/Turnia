'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const panes = [...document.querySelectorAll('.pane')];
  const steps = [...document.querySelectorAll('#steps li')];
  const form = $('registration');
  const back = $('back'), next = $('next'), submit = $('submitRegistration');
  const status = $('status'), payment = $('payment');
  let current = 0, submitted = false, sending = false;
  // This is the publishable project key; NEVER embed a service-role key or payment token.
  const PROJECT_URL = 'https://kfaolqnrqlypoyzkejlt.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_uT_FeTqwfX8AhkUtgmo--Q_bemTQkwP';
  const sb = window.supabase?.createClient(PROJECT_URL, PUBLISHABLE_KEY);

  const showMessage = (message, error = false) => {
    status.hidden = false;
    status.textContent = message;
    status.classList.toggle('approved', !error);
  };
  const val = id => $(id).value.trim();
  const valid = i => {
    for (const input of panes[i].querySelectorAll('input[required],select[required]')) {
      if (!input.checkValidity()) { input.reportValidity(); input.focus(); return false; }
    }
    if (i === 0 && val('password') !== val('confirmPassword')) {
      $('confirmPassword').setCustomValidity('Las contraseñas deben coincidir.');
      $('confirmPassword').reportValidity(); $('confirmPassword').focus(); return false;
    }
    $('confirmPassword').setCustomValidity('');
    return true;
  };
  const render = () => {
    panes.forEach((p, i) => { p.hidden = i !== current; });
    steps.forEach((step, i) => {
      step.classList.toggle('current', i === current);
      step.classList.toggle('done', i < current);
      if (i === current) step.setAttribute('aria-current','step'); else step.removeAttribute('aria-current');
    });
    back.hidden = current === 0 || submitted;
    next.hidden = current === 3 || submitted;
    submit.hidden = current !== 3 || submitted;
    $('stepCounter').textContent = 'Paso ' + (current + 1) + ' de 4';
    if (current === 3) summary();
  };
  const summary = () => {
    const el = $('summary');
    el.replaceChildren();
    [
      ['Contacto',val('firstName')+' '+val('lastName')],
      ['Correo',val('email')],
      ['Restaurante',val('restaurantName')],
      ['Tipo',val('businessType')],
      ['Ubicación',val('commune')+', '+val('city')],
      ['Plan','Mensual · $5.000 CLP (referencial)']
    ].forEach(([label,value]) => {
      const line = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = label+': ';
      line.append(strong,document.createTextNode(value));
      el.append(line);
    });
  };
  const signup = async () => {
    if (!valid(0) || !valid(1) || !valid(2)) return;
    if (!sb) { showMessage('No se pudo cargar el servicio de cuentas. Reintenta más tarde.',true); return; }
    if (sending) return;
    sending = true; submit.disabled = true; showMessage('Creando cuenta segura en Supabase…');
    const data = {
      turnia_registration:'v1',turnia_test_token:val('testToken'),
      first_name:val('firstName'), last_name:val('lastName'), phone:val('phone'),
      display_name:val('firstName')+' '+val('lastName'),
      restaurant_name:val('restaurantName'), business_type:val('businessType'),
      rut:val('rut'), city:val('city'), commune:val('commune'),
      street:val('street'), staff:val('staff'),
      plan_code:'monthly', accept_terms:'true'
    };
    try {
      const result = await sb.auth.signUp({
        email:val('email').toLowerCase(),password:$('password').value,
        options:{emailRedirectTo:location.origin+'/',data}
      });
      if (result.error) throw result.error;
      submitted = true;
      $('password').value = ''; $('confirmPassword').value = '';
      showMessage('Cuenta registrada. Revisa tu correo para verificarlo. Tu restaurante quedará pendiente de pago hasta que Turnia habilite la pasarela. No se realizó ningún cobro y aún no tienes acceso al reparto.');
      render();
    } catch (err) {
      showMessage(err?.message || 'No fue posible completar el registro. Reintenta.',true);
    } finally { sending = false; submit.disabled = false; }
  };
  const showExisting = async () => {
    if (!sb) { showMessage('No se pudo cargar el servicio de cuentas.',true); return; }
    try {
      const session = await sb.auth.getSession();
      if (session.error || !session.data?.session) return;
      const result = await sb.rpc('turnia_registration_status');
      if (result.error || !result.data) return;
      const entry = result.data;
      current = 3;
      submitted = true;
      render();
      $('summary').replaceChildren();
      if (entry.status === 'pending_payment') {
        showMessage('Tu cuenta ya está registrada. ' + (entry.restaurant_name || 'Tu restaurante') +
          ' está pendiente de pago. Los cobros aún están desactivados; no se ha generado ningún cargo ni habilitado acceso.');
      } else if (entry.status === 'active') {
        showMessage('Tu restaurante está activado. Puedes ingresar desde la página principal de Turnia.');
      } else {
        showMessage('El estado de tu solicitud es: ' + String(entry.status || 'desconocido'));
      }
    } catch {
      // On network errors, let the user return later without disrupting signup.
    }
  };
  form.addEventListener('submit', e => e.preventDefault());
  $('confirmPassword').addEventListener('input', () => $('confirmPassword').setCustomValidity(''));
  back.addEventListener('click',() => { if (!submitted && current>0) { current--; render(); } });
  next.addEventListener('click',() => { if (valid(current) && current<3) { current++; render(); } });
  submit.addEventListener('click',signup);
  payment.hidden = true; // No payment client, checkout URL or activation button.
  render();
  showExisting();
})();
