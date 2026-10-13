'use strict';
(() => {
const $ = id => document.getElementById(id);
const SUPABASE_URL = 'https://kfaolqnrqlypoyzkejlt.supabase.co';
// Keep the existing storage and database identifiers so the rebrand preserves sessions and data.
const KEEP_SESSION_KEY = 'propina_keep_session';
const AUTH_STORAGE_KEY = 'sb-kfaolqnrqlypoyzkejlt-auth-token';
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} }
};
const keepSession = storage.get(KEEP_SESSION_KEY) !== '0';
let sessionStorageBackend;
try { sessionStorageBackend = keepSession ? localStorage : sessionStorage; if (!keepSession) localStorage.removeItem(AUTH_STORAGE_KEY); } catch { sessionStorageBackend = undefined; }
if (!window.supabase) {
  $('loading').textContent = 'No pudimos cargar la conexión. Revisa tu internet y vuelve a cargar Turnia.';
  return;
}
const sb = window.supabase.createClient(SUPABASE_URL, 'sb_publishable_uT_FeTqwfX8AhkUtgmo--Q_bemTQkwP', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: sessionStorageBackend }
});
let context = null, user = null, rid = '', areas = [], workers = [], days = [], shifts = [], payouts = [];
let myTips = [], myTipsLoaded = false;
let flexShifts = [], flexPayouts = [];
let restaurantBusiness = {}, restaurantBusinessFor = '', inviteError = '';
let membershipContext = [], tab = 'home', loadingData = false, loadVersion = 0, recoveryMode = false;
let guideIndex = 0, guideDone = false, tourDismissed = false;
let selectedHistoryMonday = '';
let selectedWeeklyPerson = '';
let authVersion = 0, teamVersion = 0, platformVersion = 0;
let teamMembers = [], teamInvitations = [], platformRestaurants = [], platformInvitations = [];
let supportTickets = [], ownerSupportTickets = [], selectedSupportTicket = null, supportVersion = 0, ownerSupportVersion = 0;
let ownerNotificationItems = [], ownerNotificationVersion = 0, notificationsAuthorized = false;
let teamSpace = false;
const canViewNotifications = () => !!context?.platform_admin && notificationsAuthorized;
const busyButtons = new Set();
const clp = n => new Intl.NumberFormat('es-CL', {style:'currency', currency:'CLP', maximumFractionDigits:0}).format(Number(n) || 0);
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,10);
const dateLabel = s => s ? new Date(s + 'T12:00:00').toLocaleDateString('es-CL', {day:'2-digit',month:'short',year:'numeric'}) : '—';
const safe = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const emptyRow = (n, text) => `<tr><td colspan="${n}" class="empty">${text}</td></tr>`;
const check = r => { if (r.error) throw r.error; return r.data; };
const call = async (fn, args = {}) => check(await sb.rpc(fn, args));
const query = async (table, restaurantId) => check(await sb.from(table).select('*').eq('restaurant_id', restaurantId));
const currentRestaurant = () => context?.restaurants?.find(r => r.id === rid);
const canEdit = () => !!rid && !!context && (context.platform_admin || ['owner','admin'].includes(currentRestaurant()?.role));
const canInvite = () => !!rid && !!context && (context.platform_admin || currentRestaurant()?.role === 'owner');
const personalOnly = () => currentRestaurant()?.read_scope === 'personal' && currentRestaurant()?.role === 'viewer' && !context?.platform_admin;
const hasWorkerLink = () => !!currentRestaurant()?.worker_id;
const canManageTeam = () => !!rid && currentRestaurant()?.role === 'owner';
const roleLabel = role => ({owner:'Propietario del local',admin:'Administrador del local',viewer:'Solo consulta'}[role] || 'Cliente');
const titles = {mytips:'Mis propinas',home:'Inicio',daily:'Registrar propinas',distribution:'Reparto',history:'Historial',staff:'Equipo y áreas',access:'Accesos y ajustes',owner:'Panel de propietario',notifications:'Notificaciones',support:'Ayuda y soporte',guide:'Guía de uso'};
function msg(text = '', tone = 'info') {
  const target = recoveryMode ? $('recoveryMessage')
    : !$('restaurantSetup').classList.contains('hide') ? $('setupMessage')
    : !$('inviteActivation').classList.contains('hide') ? $('activationMessage')
    : context ? $('message') : $('authMessage');
  target.textContent = text;
  target.className = 'notice ' + tone;
}
function errorText(e) {
  const message = e?.message || String(e);
  if (/Invalid login credentials/i.test(message)) return 'El correo o la contraseña no coinciden. Revísalos e inténtalo de nuevo.';
  if (/same_password/i.test(e?.code || '') || /different from the old/i.test(message)) return 'La nueva contraseña debe ser diferente de la actual.';
  if (/weak_password/i.test(e?.code || '')) return 'La contraseña no cumple los requisitos de seguridad. Usa una más larga con letras, números y símbolos.';
  if (/reauthentication_needed|reauthentication_not_valid/i.test(e?.code || '')) return 'Vuelve a iniciar sesión y repite el cambio de contraseña.';
  if (/Email not confirmed/i.test(message)) return 'Confirma tu correo antes de iniciar sesión.';
  if (/rate limit exceeded|over_email_send_rate_limit|429/i.test(message)) return 'Supabase alcanzó el límite temporal de correos. Espera antes de solicitar otro enlace y revisa tu bandeja de entrada.';
  if (/Email link is invalid|token expired/i.test(message)) return 'El enlace de confirmación ya no es válido. Solicita uno nuevo.';
  if (/Failed to fetch|NetworkError/i.test(message)) return 'No pudimos conectar. Revisa tu internet e inténtalo de nuevo.';
  return message;
}
async function guard(fn, button) {
  if (button?.disabled || busyButtons.has(button)) return;
  if (button) { busyButtons.add(button); button.disabled = true; }
  const settingsAction = ['saveAccountProfile','changeAccountPassword','saveRestaurantDetails'].includes(button?.id);
  const savingClassic = button?.id === 'saveDay';
  if (savingClassic) { $('daySaveStatus').textContent = ''; $('daySaveStatus').className = 'state-text'; }
  if (settingsAction) { $('settingsStatus').textContent = ''; $('settingsStatus').classList.add('hide'); }
  msg();
  try { await fn(); } catch (e) {
    if (settingsAction) setSettingsStatus(errorText(e), 'error');
    if (savingClassic) { $('daySaveStatus').textContent = 'No se guardó la jornada: ' + errorText(e); $('daySaveStatus').className = 'notice error spaced'; }
    msg(errorText(e), 'error');
  }
  finally { if (button) { busyButtons.delete(button); button.disabled = false; } updatePermissions(); }
}
function bind(id, fn) { $(id).addEventListener('click', () => guard(fn, $(id))); }
function requireEdit() { if (!canEdit() || loadingData) throw Error('Selecciona un restaurante autorizado para realizar cambios.'); }
function closeDrawer(restoreFocus = false) {
  $('drawer').classList.remove('open'); $('drawerBackdrop').classList.remove('open');
  $('menuToggle').setAttribute('aria-expanded','false');
  if (restoreFocus) $('menuToggle').focus();
}
function setTab(name) {
  if (name === 'flex') { setDayMode('flex'); name = 'daily'; }
  if (!titles[name] || name === 'owner' && !context?.platform_admin || name === 'notifications' && !canViewNotifications()) return;
  if (personalOnly() && !['mytips','access','support'].includes(name)) name = 'mytips';
  if (name === 'mytips' && !hasWorkerLink()) name = 'access';
  tab = name;
  document.querySelectorAll('.tab').forEach(el => el.classList.toggle('hide', el.id !== name));
  document.querySelectorAll('[data-tab]').forEach(el => {
    const active = el.dataset.tab === name;
    el.classList.toggle('active', active);
    if (active) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current');
  });
  $('currentSection').textContent = titles[name];
  closeDrawer();
  if (name === 'guide') renderGuide();
  if (name === 'distribution') renderPayouts();
  if (name === 'access') void loadTeam();
  if (name === 'owner') { void loadPlatform(); void loadOwnerSupport(); }
  if (name === 'notifications') void loadOwnerNotifications();
  if (name === 'support') void loadSupport();
  renderTour();
}
function updatePermissions() {
  const editing = canEdit() && !loadingData;
  document.querySelectorAll('.edit-only').forEach(el => el.classList.toggle('hide', !canEdit()));
  $('saveFlexShift').disabled = !editing;
  ['saveDay','addArea','addWorker','amount','shiftHours'].forEach(id => $(id).disabled = !editing);
  $('createRestaurantPanel').classList.toggle('hide', !context?.can_create || teamSpace);
  $('staffInvitePanel').classList.toggle('hide', !canInvite());
  $('teamAccessPanel').classList.toggle('hide', !canManageTeam());
  $('workerLinkPanel').classList.toggle('hide', !canManageTeam());
  $('myTipsNav').classList.toggle('hide', !hasWorkerLink());
  $('viewGlobalTips').classList.toggle('hide', !rid || personalOnly());
  $('membershipCard').classList.toggle('hide', personalOnly());
  $('teamBetaHelp').classList.toggle('hide', !teamSpace);
  ['home','daily','distribution','history','staff','guide'].forEach(name => {
    document.querySelector(`[data-tab="${name}"]`).classList.toggle('hide', personalOnly());
  });
  document.querySelector('.side-help').classList.toggle('hide', personalOnly());
  if (personalOnly()) $('onboardingBanner').classList.add('hide');
  $('ownerNav').classList.toggle('hide', !context?.platform_admin);
  $('notificationsNav').classList.toggle('hide', !canViewNotifications());
  $('supportComposePanel').classList.toggle('hide', !rid);
  $('sendSupportTicket').disabled = !rid;
  $('adminPanel').classList.toggle('hide', !context?.platform_admin);
  const restaurantOwner = !!rid && currentRestaurant()?.role === 'owner';
  $('restaurantDetailsPanel').classList.toggle('hide', !rid || teamSpace);
  $('restaurantEditName').disabled = !restaurantOwner;
  $('saveRestaurantDetails').disabled = !restaurantOwner || restaurantBusinessFor!==rid;
  $('restaurantBusinessFields').classList.toggle('hide', !restaurantOwner);
  document.querySelectorAll('[data-business-field]').forEach(el => el.disabled = !restaurantOwner);
  $('restaurantEditHelp').textContent = restaurantOwner
    ? 'Puedes actualizar el nombre de este local sin modificar las jornadas ni las propinas.'
    : 'Solo el propietario de este restaurante puede cambiar su nombre.';
  document.querySelectorAll('[data-present],[data-hours],[data-day-percent],[data-day-note],[data-day-agreed],[data-pct],[data-update-area],[data-toggle-worker]').forEach(el => el.disabled = !editing);
  busyButtons.forEach(button => { button.disabled = true; });
}
function renderAccountSettings() {
  if (!user || !context) return;
  const name = user.user_metadata?.display_name || user.user_metadata?.full_name || context.display_name || '';
  $('accountDisplayName').value = name === user.email ? '' : name;
  $('accountPhone').value = user.user_metadata?.phone || '';
  $('accountEmailReadonly').value = user.email || '';
  $('restaurantEditName').value = currentRestaurant()?.name || '';
  applyBusinessDetails();
  updatePermissions();
}

const businessKeys={legal_name:'LegalName',tax_id:'TaxId',business_type:'BusinessType',street_address:'StreetAddress',city:'City',commune:'Commune',region:'Region',phone:'Phone',contact_email:'ContactEmail',manager_name:'ManagerName'};
function collectBusiness(prefix) {
  return Object.fromEntries(Object.entries(businessKeys).map(([key,suffix])=>[key,$(prefix+suffix).value.trim()]));
}
function populateBusiness(prefix,values={}) {
  Object.entries(businessKeys).forEach(([key,suffix])=>{$(prefix+suffix).value=values[key]||'';});
}
function applyBusinessDetails() {
  populateBusiness('business',restaurantBusinessFor===rid?restaurantBusiness:{});
}
async function loadRestaurantBusiness(selected) {
  if(!selected || currentRestaurant()?.role!=='owner')return;
  try {
    const data=await call('propina_restaurant_business_profile',{rid:selected});
    if(rid!==selected || currentRestaurant()?.role!=='owner')return;
    restaurantBusiness=data && typeof data==='object' ? data : {};
    restaurantBusinessFor=selected;
    applyBusinessDetails();updatePermissions();
  } catch (error) {
    if(rid===selected){restaurantBusinessFor='';$('restaurantEditHelp').textContent='No se pudieron cargar los datos del restaurante. '+errorText(error);}
  }
}
bind('completeRestaurantSetup',async()=>{
  if(!user || !context?.can_create || rid)throw Error('Esta cuenta no tiene una invitación pendiente para crear el restaurante.');
  const name=$('setupRestaurantName').value.trim();
  const profile=collectBusiness('setup');
  if(name.length<2||name.length>80)throw Error('Escribe un nombre comercial de 2 a 80 caracteres.');
  if(!profile.city || !profile.region || !profile.phone)throw Error('Completa ciudad, región y teléfono del restaurante.');
  if(!$('setupContactEmail').checkValidity())throw Error('Revisa el correo de contacto.');
  const created=await call('propina_create_restaurant_with_profile',{restaurant_name:name,profile});
  if(!created)throw Error('No pudimos confirmar la creación del restaurante.');
  $('restaurantSetup').classList.add('hide');
  populateBusiness('setup',{});
  $('setupRestaurantName').value='';
  try { sessionStorage.removeItem('turnia_pending_setup_name'); } catch {}
  await init();
  guideIndex=2;guideDone=false;tourDismissed=false;saveGuideProgress();setTab('guide');
  msg('Restaurante creado y configurado. Comienza por conocer cómo funciona Turnia.','success');
});
bind('activateInvitation',async()=>{
  const token=$('activationToken').value.trim().toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(token))throw Error('Pega el código completo de 64 caracteres.');
  await call('propina_accept_invitation',{token});
  $('activationToken').value='';
  await init();
  if(!rid && context?.can_create) {msg('Invitación activada. Completa los datos de tu restaurante.','success');return;}
  if(personalOnly())setTab('mytips');
  else {guideIndex=2;guideDone=false;tourDismissed=false;saveGuideProgress();setTab('guide');}
  msg('Tu invitación quedó activada.','success');
});
bind('logoutSetup',logout);
bind('logoutActivation',logout);

function setSettingsStatus(text, kind = 'success') {
  const target = $('settingsStatus');
  target.textContent = text;
  target.className = 'notice '+kind;
}
function resetData() {
  areas = []; workers = []; days = []; shifts = []; payouts = []; flexShifts = []; flexPayouts = []; restaurantBusiness = {}; restaurantBusinessFor = ''; membershipContext = []; myTips = []; myTipsLoaded = false;
  resetWorkerForm();
  $('myTipsFrom').value = ''; $('myTipsTo').value = '';
  $('myTipsStatus').textContent = '';
  $('inviteResult').textContent = ''; $('staffInviteResult').textContent = '';
  selectedHistoryMonday = ''; selectedWeeklyPerson = '';
  render(); renderMembershipCard(null);
  teamVersion++; teamMembers = []; teamInvitations = [];
  $('teamMembers').innerHTML = ''; $('teamInvitations').innerHTML = ''; $('teamStatus').textContent = ''; renderWorkerOptions();
}
async function init() {
  const version = ++authVersion;
  const result = check(await sb.auth.getSession());
  if (version !== authVersion) return;
  user = result.session?.user || null;
  if (!user) {
    teamSpace=false;
    $('restaurantSetup').classList.add('hide'); $('inviteActivation').classList.add('hide');
    context = null; rid = ''; loadVersion++; resetData();
    $('app').classList.add('hide'); $('pendingRegistration').classList.add('hide'); $('sandboxCheckoutPanel').classList.add('hide'); $('auth').classList.remove('hide'); $('loading').classList.add('hide');
    return;
  }
  let nextContext = await call('propina_account_context');
  if (version !== authVersion) return;
  const emailedToken = new URL(location.href).searchParams.get('turnia_invite');
  if (/^[a-f0-9]{64}$/.test(emailedToken || '') ||
      user.user_metadata?.turnia_invitation_setup && !nextContext.can_create && !(nextContext.restaurants || []).length) {
    location.replace('/invitacion.html' + (emailedToken ? '?codigo=' + encodeURIComponent(emailedToken) : ''));
    return;
  }
  const token=String(user.user_metadata?.propina_invitation||'');
  inviteError='';
  if (!nextContext.can_create && !(nextContext.restaurants||[]).length
      && !user.user_metadata?.turnia_registration && /^[a-f0-9]{64}$/.test(token)) {
    try {
      await call('propina_accept_invitation',{token});
      if(version !== authVersion)return;
      nextContext=await call('propina_account_context');
      if(version !== authVersion)return;
      try { const updated=check(await sb.auth.updateUser({data:{propina_invitation:null}}));if(updated?.user)user=updated.user; } catch {}
    } catch (error) { inviteError=errorText(error); }
  }
  context=nextContext;
  notificationsAuthorized=false;
  if (context?.platform_admin) {
    // Navigation is hidden until the server confirms the specific account ID.
    try { notificationsAuthorized=(await call('turnia_notifications_access'))===true; }
    catch { notificationsAuthorized=false; }
    if (version !== authVersion) return;
  }
  // A newly registered customer never enters the operations dashboard unless
  // the server has granted restaurant access after validating the payment.
  // User metadata is only a UX hint; actual authorization stays in Supabase RLS.
  if (user.user_metadata?.turnia_registration === 'v1' && !(context.restaurants || []).length) {
    let registration = null;
    try { registration = await call('turnia_registration_status'); } catch {
      // Fail closed even if the status endpoint is unavailable.
    }
    if (version !== authVersion) return;
    $('pendingRestaurant').textContent = registration?.restaurant_name || 'Tu restaurante';
    $('pendingNotice').textContent = registration?.status === 'cancelled'
      ? 'Este registro fue cancelado. Contacta con soporte.'
      : 'Cuenta pendiente de activación. Los cobros siguen desactivados.';
    $('app').classList.add('hide');
    $('auth').classList.add('hide');
    $('loading').classList.add('hide');
    $('pendingRegistration').classList.remove('hide');
    $('sandboxCheckoutPanel').classList.add('hide');
    // Availability is display-only; the checkout backend repeats all checks.
    if (registration?.status === 'pending_payment') {
      try {
        if (await call('turnia_sandbox_checkout_available') === true && version === authVersion)
          $('sandboxCheckoutPanel').classList.remove('hide');
      } catch {
        // If the gate cannot be verified, keep payment controls hidden.
      }
    }
    return;
  }
  $('pendingRegistration').classList.add('hide');
  const list = context.restaurants || [];
  rid = list.some(r => r.id === rid) ? rid : list[0]?.id || '';
  teamSpace=false;
  if (rid) {
    try { teamSpace=(await call('turnia_is_worker_team',{p_workspace_id:rid}))===true; }
    catch { teamSpace=false; }
    if(version!==authVersion)return;
  }
  $('restaurant').innerHTML = list.length ? list.map(r => `<option value="${safe(r.id)}">${safe(r.name)}</option>`).join('') : '<option value="">Sin restaurante autorizado</option>';
  $('restaurant').value = rid;
  $('account').textContent = user.email;
  const name = context.display_name || user.email;
  $('profileName').textContent = name;
  $('profileRole').textContent = context.platform_admin ? 'MUTAVIA GROUP · Creador de Turnia' : teamSpace && currentRestaurant()?.role==='owner' ? 'Coordinador del equipo' : teamSpace ? 'Integrante del equipo' : roleLabel(currentRestaurant()?.role);
  renderAccountSettings();
  if (rid && !teamSpace && currentRestaurant()?.role === 'owner') void loadRestaurantBusiness(rid);
  $('avatar').textContent = context.platform_admin ? 'M' : name.split(/\s+/).slice(0,2).map(s => s[0]).join('').toUpperCase();
  $('greeting').textContent = context.platform_admin ? 'Hola, Nicolás.' : 'Tu equipo. Cada turno.';
  $('todayLabel').textContent = new Date().toLocaleDateString('es-CL', {weekday:'long',day:'numeric',month:'long'});
  $('auth').classList.add('hide'); $('loading').classList.add('hide');
  $('restaurantSetup').classList.add('hide'); $('inviteActivation').classList.add('hide');
  $('app').classList.toggle('hide', recoveryMode);
  if (!rid && !context.platform_admin && !recoveryMode) {
    $('app').classList.add('hide');
    if (context.can_create) {
      $('restaurantSetup').classList.remove('hide');
      $('setupAccountEmail').value=user.email||'';
      if (!$('setupManagerName').value) $('setupManagerName').value=context.display_name===user.email?'':context.display_name||'';
      if (!$('setupContactEmail').value) $('setupContactEmail').value=user.email||'';
      try { const draft = sessionStorage.getItem('turnia_pending_setup_name'); if (draft && !$('setupRestaurantName').value) $('setupRestaurantName').value=draft; } catch {}
    } else {
      $('inviteActivation').classList.remove('hide');
      $('activationMessage').textContent=inviteError||'Tu cuenta está confirmada. Introduce el código para continuar.';
      $('activationMessage').className='notice '+(inviteError?'error':'info');
    }
    updatePermissions();return;
  }
  updatePermissions();
  if(tab==='notifications' && !canViewNotifications()) setTab('home');
  readGuideProgress();
  if (rid) await load(); else resetData();
  if (version !== authVersion) return;
  if (tab === 'access') void loadTeam();
  if (tab === 'support') void loadSupport();
  if (!rid) {
    setTab('access');
    msg(context.can_create ? 'Tu acceso está aprobado. Crea tu restaurante para comenzar.' : 'Activa tu código de invitación para entrar al restaurante autorizado.');
  }
  if (personalOnly()) setTab(tab === 'access' ? 'access' : 'mytips');
  else if (tab === 'mytips' && !hasWorkerLink()) setTab('home');
  else if (!guideDone && teamSpace) setTab('staff');
  else if (!guideDone && !context.platform_admin && (rid || context.can_create)) setTab('guide');
}
async function load() {
  if (!rid) { resetData(); return; }
  const version = ++loadVersion, selectedId = rid;
  loadingData = true; updatePermissions();
  myTips = []; myTipsLoaded = false; renderMyTips();
  if (personalOnly()) { areas = []; workers = []; days = []; shifts = []; payouts = []; flexShifts = []; flexPayouts = []; membershipContext = []; render(); }
  try {
    if (personalOnly()) {
      await loadMyTips(version, selectedId);
      return;
    }
    const data = await Promise.all(['propina_areas','propina_workers','propina_days','propina_shifts','propina_daily_distribution','propina_flex_shifts','propina_flex_payouts'].map(t => query(t, selectedId)));
    if (version !== loadVersion || selectedId !== rid) return;
    [areas,workers,days,shifts,payouts,flexShifts,flexPayouts] = data;
    areas.sort((a,b) => a.name.localeCompare(b.name,'es'));
    workers.sort((a,b) => a.name.localeCompare(b.name,'es'));
    days.sort((a,b) => b.work_date.localeCompare(a.work_date));
    render();
    await loadMembershipContext(version, selectedId);
    if (hasWorkerLink()) await loadMyTips(version, selectedId);
  } finally { if (version === loadVersion) { loadingData = false; updatePermissions(); } }
}
function render() {
  renderMyTips(); renderStaff(); renderWorkerOptions(); renderFlex(); renderDay(); renderHistory(); renderPayouts(); renderHome(); updatePermissions(); renderTour();
}
function renderStaff() {
  const total = areas.reduce((n,a) => n + Number(a.percentage), 0), correct = Math.abs(total-100) < .0001;
  $('pctStatus').textContent = `Total asignado: ${total.toLocaleString('es-CL')}% / 100%. ` + (correct ? 'Todo listo para repartir.' : 'Ajusta los porcentajes hasta sumar 100%.');
  $('pctStatus').className = 'notice spaced ' + (correct ? 'success' : 'info');
  $('areas').innerHTML = areas.map(a => `<tr><td>${safe(a.name)}</td><td>${canEdit() ? `<input aria-label="Porcentaje de ${safe(a.name)}" data-pct="${safe(a.id)}" type="number" min="0" max="100" step="0.01" value="${Number(a.percentage)}">` : `${Number(a.percentage)}%`}</td><td>${canEdit() ? `<button class="secondary small" data-update-area="${safe(a.id)}">Guardar</button>` : ''}</td></tr>`).join('') || emptyRow(3,'<strong>Comienza con tus áreas</strong>Agrega, por ejemplo, Garzones, Cocina y Barra.');
  $('workerArea').innerHTML = areas.map(a => `<option value="${safe(a.id)}">${safe(a.name)}</option>`).join('') || '<option value="">Primero agrega un área</option>';
  $('workers').innerHTML = workers.map(w => `<tr><td>${safe(w.name)}</td><td>${safe(areas.find(a => a.id === w.area_id)?.name || '—')}</td><td><span class="badge ${w.active ? '' : 'gray'}">${w.active ? 'Activo' : 'Inactivo'}</span></td><td>${canEdit() ? `<button class="ghost small" data-toggle-worker="${safe(w.id)}">${w.active ? 'Desactivar' : 'Reactivar'}</button>` : ''}</td></tr>`).join('') || emptyRow(4,'<strong>Aún no hay personas en tu equipo</strong>Agrega su nombre y el área donde trabajan.');
}

function setDayMode(mode) {
  const flexible=mode==='flex';
  $('dayEntryMode').value=flexible?'flex':'classic';
  $('classicDayPanel').classList.toggle('hide',flexible);
  $('flex').classList.toggle('hide',!flexible);
  $('dayState').classList.toggle('hide',flexible);
  if(flexible)renderFlex();else renderDay();
}
$('dayEntryMode').onchange=()=>setDayMode($('dayEntryMode').value);
function selectedFlexShift() {
  return flexShifts.find(s => s.work_date === $('flexDate').value && s.shift_code === $('flexShiftCode').value);
}
function renderFlex() {
  const date=$('flexDate').value,shift=$('flexShiftCode').value,existing=selectedFlexShift();
  const other=flexShifts.find(s=>s.work_date===date);
  const savedModes=existing?.rules||other?.rules||[];
  $('flexAmount').value=existing?String(existing.amount_clp):'';
  $('flexState').textContent=existing?'Turno '+shift+' guardado. Puedes editarlo.':'Turno '+shift+' aún sin registrar.';
  $('flexAreaModes').innerHTML=areas.filter(a=>Number(a.percentage)>0).map(a=>{
    const mode=savedModes.find(m=>m.area_id===a.id)?.mode||'per_shift';
    return '<div class="flex-area-row"><strong>'+safe(a.name)+' · '+Number(a.percentage)+'%</strong><label>Método <select data-flex-mode="'+safe(a.id)+'" '+(!canEdit()?'disabled':'')+'><option value="per_shift" '+(mode==='per_shift'?'selected':'')+'>Por turno</option><option value="daily_unique" '+(mode==='daily_unique'?'selected':'')+'>Fondo diario · persona única</option></select></label></div>';
  }).join('')||'<p class="muted">Agrega áreas con porcentajes positivos en Equipo y áreas.</p>';
  $('flexWorkerRows').innerHTML=workers.filter(w=>w.active||existing?.entries?.some(e=>e.worker_id===w.id)).filter(w=>areas.some(a=>a.id===w.area_id&&Number(a.percentage)>0)).map(w=>{
    const saved=existing?.entries?.find(e=>e.worker_id===w.id);
    const weight=saved?Number(saved.weight):1,percentage=Number((weight*100).toFixed(2)),note=saved?.note||'',disabled=!canEdit()?'disabled':'';
    return '<div class="flex-person"><label class="check"><input type="checkbox" data-flex-present="'+safe(w.id)+'" '+(saved?'checked':'')+' '+disabled+'><strong>'+safe(w.name)+'</strong> · '+safe(areas.find(a=>a.id===w.area_id)?.name||'')+'</label><div class="flex-person-config"><label>Participación (%)<input type="number" data-flex-percent="'+safe(w.id)+'" min="1" max="200" step="0.01" value="'+percentage+'" aria-label="Participación porcentual de '+safe(w.name)+'" '+disabled+'></label><label>Motivo del acuerdo<input data-flex-note="'+safe(w.id)+'" maxlength="300" placeholder="Motivo si las partes son distintas de 1" value="'+safe(note)+'" '+disabled+'></label><label class="check"><input type="checkbox" data-flex-agreed="'+safe(w.id)+'" '+(saved?.agreed?'checked':'')+' '+disabled+'>Acuerdo confirmado</label></div></div>';
  }).join('')||'<p class="muted">Agrega trabajadores activos para registrar un turno.</p>';
  renderFlexResults();renderFlexHistory();updatePermissions();
}
function renderFlexResults() {
  const date=$('flexDate').value,records=flexShifts.filter(s=>s.work_date===date),result=flexPayouts.filter(p=>p.work_date===date);
  const amount=records.reduce((n,s)=>n+Number(s.amount_clp),0),paid=result.reduce((n,s)=>n+Number(s.calculated_clp),0);
  $('flexSummary').innerHTML=records.length?'<div><small>Total AM + PM</small><strong>'+clp(amount)+'</strong></div><div><small>Distribuido</small><strong>'+clp(paid)+'</strong></div><div><small>Diferencia</small><strong>'+clp(amount-paid)+'</strong></div>':'<p class="muted">Guarda un turno para ver su reparto.</p>';
  $('flexPayoutRows').innerHTML=result.map(p=>'<tr><td>'+safe(p.worker_name)+'</td><td>'+safe(p.area_name)+'</td><td>'+(p.group_code==='DIA'?'Fondo diario':safe(p.group_code))+'</td><td>'+Number((Number(p.weight)*100).toFixed(2))+'%</td><td class="money">'+clp(p.calculated_clp)+'</td></tr>').join('')||emptyRow(5,'Aún no hay reparto flexible para esta fecha.');
  $('flexExport').disabled=!result.length;
}
function renderFlexHistory() {
  $('flexHistoryRows').innerHTML=flexShifts.slice().sort((a,b)=>b.work_date.localeCompare(a.work_date)||a.shift_code.localeCompare(b.shift_code)).map(s=>'<tr><td>'+safe(dateLabel(s.work_date))+'</td><td>'+safe(s.shift_code)+'</td><td class="money">'+clp(s.amount_clp)+'</td><td><button type="button" class="ghost small" data-flex-open="'+safe(s.work_date)+'" data-flex-code="'+safe(s.shift_code)+'">Abrir →</button></td></tr>').join('')||emptyRow(4,'Sin turnos AM/PM.');
}
$('flexDate').onchange=renderFlex;
$('flexShiftCode').onchange=renderFlex;
$('flexHistoryRows').onclick=event=>{
  const button=event.target.closest('[data-flex-open]');if(!button)return;
  $('flexDate').value=button.dataset.flexOpen;
  $('flexShiftCode').value=button.dataset.flexCode;
  renderFlex();
};
bind('reloadFlexShift',async()=>{if(!rid)return;await load();msg('Turnos actualizados.','success');});
bind('saveFlexShift',async()=>{
  requireEdit();
  const date=$('flexDate').value,shift=$('flexShiftCode').value,amount=Number($('flexAmount').value);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!['AM','PM'].includes(shift)||$('flexAmount').value===''||!Number.isSafeInteger(amount)||amount<0)throw Error('Revisa fecha, turno y monto.');
  if(days.some(d=>d.work_date===date))throw Error('Ya existe una jornada clásica para esta fecha.');
  const eligible=areas.filter(a=>Number(a.percentage)>0);
  if(!eligible.length||Math.abs(eligible.reduce((n,a)=>n+Number(a.percentage),0)-100)>.000001)throw Error('Los porcentajes deben sumar 100%.');
  const modes=eligible.map(a=>({area_id:a.id,mode:document.querySelector('[data-flex-mode="'+a.id+'"]').value}));
  const entries=[...document.querySelectorAll('[data-flex-present]:checked')].map(el=>{
    const worker_id=el.dataset.flexPresent;
    return {worker_id,weight:Number(document.querySelector('[data-flex-percent="'+worker_id+'"]').value)/100,note:document.querySelector('[data-flex-note="'+worker_id+'"]').value.trim(),agreed:document.querySelector('[data-flex-agreed="'+worker_id+'"]').checked};
  });
  if(!entries.length)throw Error('Selecciona al menos un trabajador.');
  if(entries.some(e=>!Number.isFinite(e.weight)||e.weight<0.01||e.weight>2))throw Error('La participación debe estar entre 1% y 200%.');
  if(entries.some(e=>Math.abs(e.weight-1)>0.0000001&&(!e.agreed||e.note.length<10)))throw Error('Registra acuerdo y explicación de 10 caracteres o más para una participación distinta de 100%.');
  const presentAreas=new Set(entries.map(e=>workers.find(w=>w.id===e.worker_id)?.area_id));
  if(eligible.some(a=>!presentAreas.has(a.id)))throw Error('Cada área necesita una persona presente.');
  const other=flexShifts.find(s=>s.work_date===date&&s.shift_code!==shift);
  if(other&&modes.some(m=>other.rules?.some(r=>r.area_id===m.area_id&&r.mode!==m.mode)))throw Error('AM y PM deben usar el mismo método de reparto por área.');
  if(selectedFlexShift()&&!window.confirm('¿Reemplazar el turno guardado y recalcular el reparto?'))return;
  await call('propina_save_flex_shift',{p_restaurant:rid,p_date:date,p_shift:shift,p_amount:amount,p_modes:modes,p_entries:entries});
  await load();setTab('flex');msg('Turno guardado y reparto actualizado.','success');
});
bind('flexExport',async()=>{
  const date=$('flexDate').value,data=flexPayouts.filter(p=>p.work_date===date);
  if(!data.length)throw Error('No hay repartos para exportar.');
  const rows=[['Fecha','Restaurante','Turno/fondo','Trabajador','Área','Participación (%)','Propina CLP'],...data.map(p=>[p.work_date,currentRestaurant()?.name||'',p.group_code,p.worker_name,p.area_name,Number((Number(p.weight)*100).toFixed(2)),p.calculated_clp])];
  const csv='\ufeff'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
  link.href=url;link.download='turnia_am_pm_'+date+'.csv';document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);msg('Reparto AM/PM exportado.','success');
});

function renderDay() {
  const current = days.find(d => d.work_date === $('date').value);
  $('amount').value = current ? current.amount_clp : '';
  $('shiftHours').value = current?.hours_per_shift || $('shiftHours').value || 8;
  $('dayState').textContent = current ? 'Jornada guardada' : flexShifts.some(s=>s.work_date===$('date').value) ? 'Fecha usada en AM/PM' : 'Nueva jornada';
  $('attendance').innerHTML = workers.filter(w => w.active || current && shifts.some(s => s.day_id === current.id && s.worker_id === w.id)).map(w => {
    const shift = current ? shifts.find(s => s.day_id === current.id && s.worker_id === w.id) : null;
    const participation = Number((Number(shift?.participation ?? 1) * 100).toFixed(2));
    const note = shift?.note || '', agreed = !!shift?.agreed;
    return `<tr><td><input type="checkbox" aria-label="${safe(w.name)} trabajó" data-present="${safe(w.id)}" ${shift ? 'checked' : ''}></td><td>${safe(w.name)}</td><td>${safe(areas.find(a => a.id === w.area_id)?.name || '—')}</td><td><input aria-label="Horas de ${safe(w.name)}" type="number" data-hours="${safe(w.id)}" min="0.5" max="24" step="0.5" value="${Number(shift?.hours || $('shiftHours').value || 8)}"></td><td><input aria-label="Participación porcentual de ${safe(w.name)}" type="number" data-day-percent="${safe(w.id)}" min="1" max="200" step="0.01" value="${participation}"></td><td><strong data-day-points="${safe(w.id)}" class="point-cell">—</strong></td><td class="money"><span data-day-estimate="${safe(w.id)}">—</span></td><td><div class="classic-participation-agreement"><input aria-label="Motivo del acuerdo para ${safe(w.name)}" data-day-note="${safe(w.id)}" maxlength="300" placeholder="Motivo para menos de 100%" value="${safe(note)}"><label class="check"><input type="checkbox" data-day-agreed="${safe(w.id)}" ${agreed ? 'checked' : ''}>Acuerdo confirmado</label></div></td></tr>`;
  }).join('') || emptyRow(8,'Agrega trabajadores en Equipo y áreas para registrar una jornada.');
  renderAttendanceCount(); updatePermissions();
}
function classicEffectivePoints(hours, participationPercent, baseHours) {
  if (!Number.isFinite(hours) || hours <= 0 || !Number.isFinite(participationPercent) ||
      participationPercent < 1 || participationPercent > 200 || !Number.isFinite(baseHours) || baseHours <= 0) return NaN;
  return hours / baseHours * participationPercent / 100;
}
function renderAttendanceCount() {
  const base = Number($('shiftHours').value);
  const total = Number($('amount').value);
  const validAmount = $('amount').value !== '' && Number.isSafeInteger(total) && total >= 0;
  const entries = workers.map(worker => {
    const wid = worker.id;
    const selected = !!document.querySelector(`[data-present="${wid}"]`)?.checked;
    const hours = Number(document.querySelector(`[data-hours="${wid}"]`)?.value);
    const input = document.querySelector(`[data-day-percent="${wid}"]`);
    const pct = input?.value === '' ? NaN : Number(input?.value);
    const points = classicEffectivePoints(hours, pct, base);
    const badge = document.querySelector(`[data-day-points="${wid}"]`);
    const estimate = document.querySelector(`[data-day-estimate="${wid}"]`);
    if (badge) badge.textContent = selected && Number.isFinite(points) ? Number(points.toFixed(4)).toLocaleString('es-CL') : '—';
    if (estimate) estimate.textContent = '—';
    return {worker,selected,hours,points,estimate};
  });
  const chosen = entries.filter(e => e.selected);
  const selectedHours = chosen.reduce((sum,e) => sum + (Number.isFinite(e.hours) ? e.hours : 0),0);
  const selectedPoints = chosen.reduce((sum,e) => sum + (Number.isFinite(e.points) ? e.points : 0),0);
  $('attendanceCount').textContent = `${chosen.length} persona(s) presente(s) · ${selectedHours.toLocaleString('es-CL')} horas · ${Number(selectedPoints.toFixed(2)).toLocaleString('es-CL')} puntos efectivos`;
  const tooMany = chosen.filter(e => Number.isFinite(e.points) && e.points > 2.000001);
  const warning = $('classicPointsWarning');
  warning.classList.toggle('hide', !tooMany.length);
  warning.textContent = tooMany.length ? `Puntos duplicados: ${tooMany.map(e=>e.worker.name).join(', ')} supera 2 puntos. Si trabajó 16 h y el turno base es de 8 h, ya tiene 2 puntos al 100%. No agregues otro 200%.` : '';
  const areaPanel = $('classicAreaPreview');
  if (!validAmount || !Number.isFinite(base) || base <= 0 || !areas.length) {
    areaPanel.innerHTML = '<p class="muted">Ingresa las propinas y las horas de un turno para revisar los fondos de cada área.</p>';
    return;
  }
  areaPanel.innerHTML = areas.filter(area=>Number(area.percentage)>0).map(area=>{
    const members = chosen.filter(e => e.worker.area_id === area.id);
    const validMembers = members.filter(e => Number.isFinite(e.points) && e.points > 0);
    const sumPoints = validMembers.reduce((sum,e)=>sum+e.points,0);
    const budget = Math.round(total * Number(area.percentage) / 100);
    if (sumPoints > 0) {
      const results = validMembers.map(e=>{
        const exact = budget * e.points / sumPoints;
        return {...e,estimateAmount:Math.floor(exact),remainder:exact-Math.floor(exact)};
      });
      const left = budget - results.reduce((sum,e)=>sum+e.estimateAmount,0);
      const rank = results.slice().sort((a,b)=>b.remainder-a.remainder || a.worker.id.localeCompare(b.worker.id));
      for(let i=0;i<left && i<rank.length;i++)rank[i].estimateAmount++;
      results.forEach(e=>{if(e.estimate)e.estimate.textContent=clp(e.estimateAmount);});
    }
    return `<div class="classic-area-preview-row"><span><strong>${safe(area.name)} · ${Number(area.percentage)}%</strong><small>${members.length} persona(s) · ${Number(sumPoints.toFixed(2)).toLocaleString('es-CL')} puntos</small></span><strong>${clp(budget)}</strong>${!members.length?'<span class="muted">Falta personal</span>':''}</div>`;
  }).join('') || '<p class="muted">Configura las áreas de tu restaurante.</p>';
}
$('attendance').addEventListener('input',renderAttendanceCount);
$('attendance').addEventListener('change',renderAttendanceCount);
$('amount').addEventListener('input',renderAttendanceCount);
$('shiftHours').addEventListener('input',renderAttendanceCount);

function renderPayouts() {
  const day = days.find(d => d.work_date === $('payoutDate').value);
  const data = day ? payouts.filter(p => p.day_id === day.id) : [];
  const assigned = data.reduce((n,p) => n + Number(p.calculated_clp), 0);
  $('summary').innerHTML = day ? `<div><small>Total de la jornada</small><strong>${clp(day.amount_clp)}</strong></div><div><small>Distribuido</small><strong>${clp(assigned)}</strong></div><div><small>Sin asignar</small><strong>${clp(Number(day.amount_clp)-assigned)}</strong></div>` : '<p class="muted" style="margin:0">Todavía no hay una jornada guardada para esta fecha.</p>';
  $('payouts').innerHTML = data.map(p => {
    const shift = shifts.find(s => s.day_id === p.day_id && s.worker_id === p.worker_id);
    const percentage = Number((Number(shift?.participation ?? 1) * 100).toFixed(2));
    return `<tr><td>${safe(p.worker_name)}</td><td>${safe(p.area_name)}</td><td>${Number(p.hours)}</td><td>${percentage}%</td><td>${Number((Number(p.hours)*Number(shift?.participation??1)/Number(day?.hours_per_shift||8)).toFixed(2)).toLocaleString('es-CL')}</td><td class="money">${clp(p.calculated_clp)}</td></tr>`;
  }).join('') || emptyRow(6,'Registra una jornada o selecciona otra fecha para ver su reparto.');
  $('editDay').disabled = !day;
}

function localDateOffset(iso,delta) {
  const date=new Date(iso+'T12:00:00');
  if(!Number.isFinite(date.getTime()))return today();
  date.setDate(date.getDate()+delta);
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}
function weekMonday(iso) {
  const d=new Date(iso+'T12:00:00');
  if(!Number.isFinite(d.getTime()))return weekMonday(today());
  return localDateOffset(iso,-(d.getDay()+6)%7);
}
function weekSunday(monday){return localDateOffset(monday,6);}
function weekDescription(monday) {
  return 'Lun '+dateLabel(monday)+' — Dom '+dateLabel(weekSunday(monday));
}
function allHistoryDays() {
  // Every calendar date appears exactly once, including dates with AM and PM.
  const grouped=new Map();
  const get=date=>{
    if(!grouped.has(date))grouped.set(date,{date,amount:0,day:null,flexShifts:[]});
    return grouped.get(date);
  };
  for(const d of days){const entry=get(d.work_date);entry.day=d;entry.amount+=Number(d.amount_clp);}
  for(const s of flexShifts){const entry=get(s.work_date);entry.flexShifts.push(s);entry.amount+=Number(s.amount_clp);}
  return [...grouped.values()].sort((a,b)=>b.date.localeCompare(a.date));
}
function chosenHistoryWeek() {
  if(selectedHistoryMonday)return selectedHistoryMonday;
  const all=allHistoryDays(),current=weekMonday(today());
  return all.some(d=>weekMonday(d.date)===current)?current:all.length?weekMonday(all[0].date):current;
}
function visibleHistory() {
  const start=chosenHistoryWeek(),end=weekSunday(start);
  return allHistoryDays().filter(d=>d.date>=start&&d.date<=end);
}
function weeklySettlement() {
  const from=chosenHistoryWeek(),to=weekSunday(from),dates=Array.from({length:7},(_,i)=>localDateOffset(from,i));
  const recorded=visibleHistory(),validIds=new Set(recorded.filter(d=>d.day).map(d=>d.day.id));
  const activeDates=new Set(recorded.filter(d=>d.flexShifts.length).map(d=>d.date));
  const details=[];
  for(const p of payouts.filter(row=>validIds.has(row.day_id))) {
    const day=recorded.find(d=>d.day?.id===p.day_id)?.day;
    const entry=shifts.find(s=>s.day_id===p.day_id&&s.worker_id===p.worker_id);
    const participation=Number(entry?.participation??1);
    details.push({date:p.work_date,area_id:p.area_id||areas.find(a=>a.name===p.area_name)?.id||p.area_name,
      area_name:p.area_name,worker_id:p.worker_id||'',
      worker_name:p.worker_name,kind:'Jornada completa',turno:'Día',hours:Number(p.hours),
      participation:participation*100,points:day?.hours_per_shift?Number(p.hours)*participation/Number(day.hours_per_shift):null,
      amount:Number(p.calculated_clp)});
  }
  // Flex payout 'DIA' is one daily pool, and must NOT be counted once per AM/PM shift.
  for(const p of flexPayouts.filter(row=>activeDates.has(row.work_date))) {
    details.push({date:p.work_date,area_id:p.area_id||areas.find(a=>a.name===p.area_name)?.id||p.area_name,
      area_name:p.area_name,worker_id:p.worker_id||'',worker_name:p.worker_name,
      kind:'AM/PM',turno:p.group_code==='DIA'?'Fondo diario':p.group_code,
      hours:null,participation:Number(p.weight)*100,points:Number(p.weight),
      amount:Number(p.calculated_clp)});
  }
  const people=new Map(),areaTotals=new Map();
  for(const item of details){
    const key=String(item.area_id)+'|'+(item.worker_id||'nombre:'+item.worker_name);
    if(!people.has(key))people.set(key,{key,area_id:item.area_id,area:item.area_name,
      worker_id:item.worker_id,name:item.worker_name,total:0,perDay:new Map(),dates:new Set()});
    const person=people.get(key);
    person.total+=item.amount;person.perDay.set(item.date,(person.perDay.get(item.date)||0)+item.amount);
    person.dates.add(item.date);
    const areaKey=String(item.area_id);
    if(!areaTotals.has(areaKey))areaTotals.set(areaKey,{area_id:item.area_id,name:item.area_name,total:0,workers:new Set(),dates:new Set()});
    const area=areaTotals.get(areaKey);
    area.total+=item.amount;area.workers.add(key);area.dates.add(item.date);
  }
  const peopleSorted=[...people.values()].sort((a,b)=>a.area.localeCompare(b.area,'es')||a.name.localeCompare(b.name,'es'));
  const areaSorted=[...areaTotals.values()].sort((a,b)=>a.name.localeCompare(b.name,'es'));
  const amount=recorded.reduce((sum,d)=>sum+d.amount,0);
  const distributed=details.reduce((sum,d)=>sum+d.amount,0);
  return {from,to,dates,recorded,details,people:peopleSorted,areas:areaSorted,amount,distributed,difference:amount-distributed};
}
// Interactive weekly settlement: collapsible area groups, each worker's seven-day
// detail, and a downloadable personal XLSX. Nothing here changes tip calculations.
function weeklyPersonIdentity(item) {
  return String(item.area_id)+'|'+(item.worker_id||'nombre:'+item.worker_name);
}
function workerInitials(name) {
  return String(name||'').trim().split(/\s+/).slice(0,2).map(piece=>piece[0]||'').join('').toUpperCase()||'—';
}
function renderWeeklyPersonDetail(week=weeklySettlement()) {
  const target=$('weeklyPersonDetail');
  const person=week.people.find(p=>p.key===selectedWeeklyPerson);
  if(!person){target.classList.add('hide');target.innerHTML='';return;}
  const rows=week.details.filter(item=>weeklyPersonIdentity(item)===person.key);
  target.classList.remove('hide');
  target.innerHTML='<div class="weekly-person-title"><div><p class="eyebrow">LIQUIDACIÓN INDIVIDUAL</p><h3>'+
    safe(person.name)+'</h3><p class="muted">'+safe(person.area)+' · '+person.dates.size+' día(s) registrado(s)</p></div>'+
    '<button type="button" class="ghost small" data-week-close aria-label="Cerrar detalle individual">Cerrar ×</button></div>'+
    '<div class="weekly-person-total"><small>Total calculado de la semana</small><strong>'+clp(person.total)+'</strong></div>'+
    '<div class="weekly-person-days">'+week.dates.map(date=>{
      const parts=rows.filter(row=>row.date===date);
      return '<div class="weekly-person-day"><div><strong>'+safe(dateLabel(date))+'</strong>'+
      '<small>'+(parts.length?parts.map(p=>safe(p.turno)).join(' · '):'Sin monto asignado')+'</small></div>'+
      '<strong class="money">'+clp(parts.reduce((sum,p)=>sum+p.amount,0))+'</strong></div>';
    }).join('')+'</div>'+
    '<div class="weekly-person-actions"><button class="secondary" type="button" data-week-person-xlsx>'+
    'Descargar liquidación individual</button><p class="muted">Documento de cálculo, no comprobante de transferencia bancaria.</p></div>';
}
function renderWeeklyGroups(week=weeklySettlement()){
  const rows=week.areas.map((area,index)=>{
    const members=week.people.filter(p=>String(p.area_id)===String(area.area_id));
    const elements=members.map(p=>'<button type="button" class="weekly-worker" data-week-person="'+safe(p.key)+
      '" aria-label="Ver liquidación de '+safe(p.name)+'"><span class="weekly-worker-avatar" aria-hidden="true">'+safe(workerInitials(p.name))+
      '</span><span class="weekly-worker-copy"><strong>'+safe(p.name)+'</strong><small>'+p.dates.size+' día(s) trabajado(s) · Pago sin registrar</small></span>'+
      '<span class="weekly-worker-amount">'+clp(p.total)+'</span><span class="weekly-worker-arrow" aria-hidden="true">›</span></button>').join('');
    return '<details class="weekly-area-group" '+(index===0?'open':'')+'>'+
      '<summary><span class="weekly-area-icon" aria-hidden="true">≡</span><span class="weekly-area-copy"><strong>'+safe(area.name)+
      '</strong><small>'+members.length+' persona(s)</small></span><span class="weekly-area-amount"><small>Total del área</small><strong>'+
      clp(area.total)+'</strong></span><span class="weekly-area-chevron" aria-hidden="true">⌄</span></summary>'+
      '<div class="weekly-group-workers">'+elements+'</div></details>';
  }).join('');
  $('weeklyGroups').innerHTML=rows||'<p class="muted">Todavía no hay liquidaciones para esta semana.</p>';
  $('weeklyExpandAll').disabled=!week.areas.length;
  $('weeklyExpandAll').textContent='Expandir todas ↓';
  renderWeeklyPersonDetail(week);
}
function downloadWeeklyPerson(){
  const week=weeklySettlement(),person=week.people.find(p=>p.key===selectedWeeklyPerson);
  if(!person)throw Error('Selecciona un trabajador antes de exportar.');
  if(!window.TurniaXlsx)throw Error('No se pudo cargar el generador de Excel.');
  const entries=week.details.filter(item=>weeklyPersonIdentity(item)===person.key)
    .slice().sort((a,b)=>a.date.localeCompare(b.date)||a.turno.localeCompare(b.turno));
  const subtitle=(currentRestaurant()?.name||'Restaurante')+' · '+weekDescription(week.from);
  window.TurniaXlsx.download([
    {name:'Liquidación individual',title:'TURNIA · LIQUIDACIÓN PERSONAL',subtitle,
      note:person.name+' · '+person.area+' · Documento de cálculo, no acredita transferencia.',
      headers:['Fecha','Área','Turno','Participación %','Horas','Propina CLP'],
      rows:entries.map(item=>[item.date,item.area_name,item.turno,Number(item.participation.toFixed(2)),item.hours??'',item.amount]),
      total:['TOTAL','','','',person.dates.size,person.total],money:[5],widths:[19,24,24,21,16,22]}
  ],'Turnia_Liquidacion_'+week.from+'_'+person.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,45)+'.xlsx');
  msg('Liquidación individual descargada. No se confirma ningún pago.','success');
}
$('weeklyGroups').addEventListener('click',event=>{
  const button=event.target.closest('[data-week-person]');
  if(!button)return;
  selectedWeeklyPerson=button.dataset.weekPerson;
  renderWeeklyPersonDetail();
  const panel=$('weeklyPersonDetail');
  if(typeof panel.scrollIntoView==='function')panel.scrollIntoView({behavior:'smooth',block:'nearest'});
});
$('weeklyWorkerRows').addEventListener('click',event=>{
  const button=event.target.closest('[data-week-person]');
  if(!button)return;
  selectedWeeklyPerson=button.dataset.weekPerson;
  renderWeeklyPersonDetail();
  const panel=$('weeklyPersonDetail');
  if(typeof panel.scrollIntoView==='function')panel.scrollIntoView({behavior:'smooth',block:'nearest'});
});
$('weeklyPersonDetail').addEventListener('click',event=>{
  if(event.target.closest('[data-week-close]')){
    selectedWeeklyPerson='';renderWeeklyPersonDetail();
  }else if(event.target.closest('[data-week-person-xlsx]')){
    guard(async()=>downloadWeeklyPerson(),event.target.closest('[data-week-person-xlsx]'));
  }
});
$('weeklyExpandAll').onclick=()=>{
  const groups=[...$('weeklyGroups').querySelectorAll('details')];
  const expand=groups.some(group=>!group.open);
  for(const group of groups)group.open=expand;
  $('weeklyExpandAll').textContent=expand?'Contraer todas ↑':'Expandir todas ↓';
};


function renderHistoryDay(day, week) {
  // Exactly one accordion per calendar date, even when AM and PM both exist.
  // All values come from the already-saved, tenant-scoped daily allocations.
  const entries=week.details.filter(item=>item.date===day.date);
  const distributed=entries.reduce((sum,item)=>sum+item.amount,0);
  const difference=day.amount-distributed;
  const flexible=day.flexShifts.length>0;
  const modality=flexible&&day.day?'Modalidades registradas':flexible?'Por turnos AM/PM':'Jornada completa';
  const date=new Date(day.date+'T12:00:00');
  const longDate=date.toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'});
  const month=date.toLocaleDateString('es-CL',{month:'short'});
  const areasForDay=new Map();
  const uniquePeople=new Set();
  for(const item of entries){
    const areaKey=String(item.area_id);
    if(!areasForDay.has(areaKey))areasForDay.set(areaKey,{name:item.area_name,total:0,people:new Map()});
    const area=areasForDay.get(areaKey);
    area.total+=item.amount;
    const personKey=item.worker_id||'nombre:'+item.worker_name;
    uniquePeople.add(areaKey+'|'+personKey);
    if(!area.people.has(personKey))area.people.set(personKey,{name:item.worker_name,amount:0,turnos:new Set()});
    const person=area.people.get(personKey);
    person.amount+=item.amount;
    person.turnos.add(item.turno);
  }
  const distribution=[...areasForDay.values()].sort((a,b)=>a.name.localeCompare(b.name,'es')).map(area=>
    '<div class="history-day-area"><div class="history-day-area-title"><strong>'+safe(area.name)+'</strong>'+
    '<span>'+clp(area.total)+'</span></div>'+
    [...area.people.values()].sort((a,b)=>a.name.localeCompare(b.name,'es')).map(person=>
      '<div class="history-day-person"><span><strong>'+safe(person.name)+'</strong>'+
      '<small>'+safe([...person.turnos].join(' + '))+'</small></span>'+
      '<strong class="money">'+clp(person.amount)+'</strong></div>').join('')+'</div>'
  ).join('')||'<p class="muted history-day-no-payout">Esta jornada aún no tiene un reparto calculado.</p>';
  const open=flexible?'data-open-flex-date':'data-open-date';
  const consistency=difference===0?
    '<span class="history-day-balanced">Reparto cuadrado</span>':
    '<span class="history-day-mismatch">Diferencia por revisar: '+clp(Math.abs(difference))+'</span>';
  return '<details class="history-day" data-history-date="'+safe(day.date)+'">'+
    '<summary aria-label="Abrir u ocultar el reparto del '+safe(longDate)+'">'+
      '<span class="history-day-calendar" aria-hidden="true">'+safe(String(date.getDate()))+'<small>'+safe(month)+'</small></span>'+
      '<span class="history-day-label"><strong>'+safe(longDate)+'</strong>'+
        '<small>'+safe(modality)+' · '+uniquePeople.size+' persona(s)</small></span>'+
      '<span class="history-day-amount"><small>Propinas</small><strong>'+clp(day.amount)+'</strong></span>'+
      '<span class="history-day-caret" aria-hidden="true">⌄</span>'+
    '</summary>'+
    '<div class="history-day-detail"><div class="history-day-totals">'+
      '<span><small>Propinas registradas</small><strong>'+clp(day.amount)+'</strong></span>'+
      '<span><small>Distribuido al equipo</small><strong>'+clp(distributed)+'</strong></span>'+
      '<span>'+consistency+'</span></div>'+
      '<div class="history-day-area-list">'+distribution+'</div>'+
      '<div class="history-day-actions"><button class="secondary small" type="button" '+open+'="'+safe(day.date)+'">'+
       'Abrir reparto completo →</button><span class="muted">Vuelve a tocar la fecha para ocultar este detalle.</span></div>'+
    '</div></details>';
}
function updateHistoryToggleLabel() {
  const all=[...$('historyRows').querySelectorAll('details.history-day')];
  const allOpen=all.length&&all.every(day=>day.open);
  $('historyToggleAll').textContent=allOpen?'Ocultar todas ↑':'Mostrar todas ↓';
}
$('historyToggleAll').onclick=()=>{
  const items=[...$('historyRows').querySelectorAll('details.history-day')];
  const open=items.some(day=>!day.open);
  items.forEach(day=>{day.open=open;});
  updateHistoryToggleLabel();
};
$('historyRows').addEventListener('toggle',updateHistoryToggleLabel,true);

function renderHistory() {
  const week=weeklySettlement(),data=week.recorded;
  const available=new Set(allHistoryDays().map(d=>weekMonday(d.date)));
  available.add(weekMonday(today()));available.add(week.from);
  $('historyWeekSelect').innerHTML=[...available].sort((a,b)=>b.localeCompare(a)).map(start=>
    '<option value="'+safe(start)+'" '+(start===week.from?'selected':'')+'>'+safe(weekDescription(start))+'</option>').join('');
  $('historyWeekLabel').textContent=weekDescription(week.from);
  const finished=week.to<today();
  $('historyWeekStatus').textContent=finished?'Semana finalizada':'Semana en curso';
  $('historyWeekStatus').className='badge '+(finished?'':'gray');
  $('historyRows').innerHTML=data.map(day=>renderHistoryDay(day,week)).join('')||
    '<p class="muted history-day-empty">No hay jornadas guardadas para la semana seleccionada.</p>';
  $('historyToggleAll').disabled=!data.length;
  updateHistoryToggleLabel();
  $('historySummary').textContent=data.length+' día(s) registrado(s) · '+clp(week.amount)+' en propinas. Las transferencias bancarias no se confirman automáticamente.';
  $('weeklyStats').innerHTML=[
    ['Propinas de la semana',week.amount],['Distribuido entre el equipo',week.distributed],['Diferencia por revisar',week.difference]
  ].map(([name,amount])=>'<div class="weekly-kpi"><small>'+name+'</small><strong>'+clp(amount)+'</strong></div>').join('');
  const notice=$('weeklyNotice');
  notice.className='notice spaced '+(week.difference?'error':'info');
  notice.textContent=!data.length?'Selecciona una semana que tenga jornadas para consultar las liquidaciones.':
    week.difference?'Atención: el total de las jornadas y el reparto no coinciden por '+clp(Math.abs(week.difference))+'. Revisa las áreas antes de pagar.':
    'Los montos calculados cuadran con las jornadas registradas. Este resumen NO confirma que se haya hecho ninguna transferencia.';
  renderWeeklyGroups(week);
  $('weeklyMobileTotal').textContent=clp(week.distributed);
  $('weeklyWorkerRows').innerHTML=week.people.map(person=>
    '<tr><td>'+safe(person.area)+'</td><td><button class="weekly-desktop-worker" type="button" data-week-person="'+safe(person.key)+'" aria-label="Ver detalle semanal de '+safe(person.name)+'">'+safe(person.name)+'</button></td><td>'+person.dates.size+
    '</td><td class="money">'+clp(person.total)+'</td></tr>').join('')+
    (week.people.length?'<tr class="weekly-total-row"><td colspan="3">TOTAL A LIQUIDAR</td><td class="money">'+clp(week.distributed)+'</td></tr>':
      emptyRow(4,'Todavía no existen montos asignados para esta semana.'));
  $('weeklyAreaRows').innerHTML=week.areas.map(area=>
    '<tr><td>'+safe(area.name)+'</td><td>'+area.workers.size+'</td><td class="money">'+clp(area.total)+'</td></tr>').join('')+
    (week.areas.length?'<tr class="weekly-total-row"><td colspan="2">TOTAL DISTRIBUIDO</td><td class="money">'+clp(week.distributed)+'</td></tr>':
      emptyRow(3,'No hay áreas con repartos esta semana.'));
  $('export').disabled=!week.details.length;
  $('exportMobile').disabled=!week.details.length;
}
$('historyWeekSelect').onchange=()=>{
  selectedHistoryMonday=weekMonday($('historyWeekSelect').value);
  selectedWeeklyPerson='';
  renderHistory();
};
$('historyPrevWeek').onclick=()=>{selectedHistoryMonday=localDateOffset(chosenHistoryWeek(),-7);selectedWeeklyPerson='';renderHistory();};
$('historyNextWeek').onclick=()=>{selectedHistoryMonday=localDateOffset(chosenHistoryWeek(),7);selectedWeeklyPerson='';renderHistory();};
$('historyCurrentWeek').onclick=()=>{selectedHistoryMonday=weekMonday(today());selectedWeeklyPerson='';renderHistory();};

function renderHome() {
  const month=today().slice(0,7),classic=days.filter(d=>d.work_date.startsWith(month));
  const flexible=flexShifts.filter(s=>s.work_date.startsWith(month));
  const total=classic.reduce((n,d)=>n+Number(d.amount_clp),0)+flexible.reduce((n,s)=>n+Number(s.amount_clp),0);
  $('monthTotal').textContent=clp(total);
  $('monthDays').textContent=new Set([...classic.map(d=>d.work_date),...flexible.map(s=>s.work_date)]).size;
  $('activeWorkers').textContent=workers.filter(w=>w.active).length;
  $('monthLabel').textContent=new Date().toLocaleDateString('es-CL',{month:'long',year:'numeric'});
  const recent=days.map(d=>({date:d.work_date,amount:Number(d.amount_clp),flex:false}));
  const byDate=new Map();
  flexShifts.forEach(s=>byDate.set(s.work_date,(byDate.get(s.work_date)||0)+Number(s.amount_clp)));
  byDate.forEach((amount,date)=>recent.push({date,amount,flex:true}));
  recent.sort((a,b)=>b.date.localeCompare(a.date));
  $('recentDays').innerHTML=recent.slice(0,4).map(d=>'<tr><td>'+safe(dateLabel(d.date))+(d.flex?' · Por turnos':'')+'</td><td class="money">'+clp(d.amount)+'</td><td><button class="ghost small" '+(d.flex?'data-open-flex-date':'data-open-date')+'="'+safe(d.date)+'" aria-label="Ver reparto">→</button></td></tr>').join('')||emptyRow(3,'<strong>Tu próxima jornada empieza aquí</strong>Cuando guardes un día, lo encontrarás en este espacio.');
  $('recentDaysMobile').innerHTML=recent.slice(0,4).map(d=>{
    const participants=new Set((d.flex?flexPayouts.filter(p=>p.work_date===d.date):payouts.filter(p=>p.work_date===d.date))
      .map(p=>p.worker_id||p.worker_name));
    return '<button type="button" class="recent-day-card" '+(d.flex?'data-open-flex-date':'data-open-date')+'="'+safe(d.date)+
    '" aria-label="Ver propinas del '+safe(dateLabel(d.date))+'"><span class="recent-day-date">'+safe(d.date.slice(8))+
    '<small>'+safe(new Date(d.date+'T12:00:00').toLocaleDateString('es-CL',{month:'short'}))+'</small></span>'+
    '<span class="recent-day-copy"><strong>'+safe(dateLabel(d.date))+'</strong><small>'+
    (participants.size?participants.size+' persona(s) · ':'')+(d.flex?'Turnos AM/PM':'Jornada completa')+'</small></span>'+
    '<span class="recent-day-money">'+clp(d.amount)+'</span><span class="recent-day-chevron" aria-hidden="true">›</span></button>';
  }).join('')||'<p class="muted">Tus próximas jornadas aparecerán aquí.</p>';
}
function renderMembershipCard(item) {
  if (!item) { $('membershipCard').innerHTML = '<h2>'+(teamSpace?'Prueba del equipo':'Membresía del restaurante')+'</h2><p class="muted">' + (rid ? 'No hay información de acceso disponible para este espacio.' : 'Selecciona un espacio para consultar su acceso.') + '</p><span class="badge gray">Cobros desactivados</span>'; return; }
  const labels = teamSpace ? {active:'Prueba gratuita del equipo',expiring:'Prueba próxima a vencer',expired:'Prueba finalizada',payment_pending:'Acceso pendiente'} : {active:'Membresía activa',expiring:'Próxima a vencer',expired:'Membresía vencida',payment_pending:'Pendiente de habilitación'};
  const pay = {trial:'Período de prueba',paid:'Registrada como pagada',pending:'Pendiente'};
  $('membershipCard').innerHTML = `<div class="panel-heading"><div><h2>${safe(labels[item.status] || 'Membresía')}</h2><p class="muted">${safe(pay[item.payment_status] || item.payment_status || '')}</p></div><span class="badge ${['expired','payment_pending'].includes(item.status) ? 'gold' : ''}">${Number(item.days_remaining) || 0} días restantes</span></div><p>Vence: <strong>${safe(item.expires_at ? new Date(item.expires_at).toLocaleDateString('es-CL') : '—')}</strong></p><p class="muted">Responsable: ${safe(item.responsible_email || 'No definido')}</p><div class="notice info">Los cobros están desactivados. Para revisar tu acceso o renovar, contacta al propietario de Turnia.</div><button class="secondary" data-go="guide">Abrir guía de uso →</button>`;
}
async function loadMembershipContext(version = loadVersion, restaurantId = rid) {
  if (!context || !restaurantId) return;
  try {
    const data = await call('propina_membership_context');
    if (version !== loadVersion || restaurantId !== rid) return;
    membershipContext = Array.isArray(data) ? data : [];
    renderMembershipCard(membershipContext.find(m => m.restaurant_id === restaurantId));
  } catch {
    if (version !== loadVersion || restaurantId !== rid) return;
    $('membershipCard').innerHTML = '<h2>Membresía</h2><p class="muted">No se pudo consultar el estado de tu membresía. Vuelve a seleccionar el restaurante para reintentar.</p><span class="badge gray">Cobros desactivados</span>';
  }
}
function invitationState(item) {
  if (item.revoked_at) return 'Revocada';
  if (item.used_at) return 'Activada';
  if (new Date(item.expires_at).getTime() <= Date.now()) return 'Vencida';
  return 'Pendiente';
}
function invitationRows(items, platform = false) {
  return items.map((item, index) => {
    const state = invitationState(item);
    const role = item.worker_id ? (item.read_scope === 'personal' ? 'Solo sus propinas' : 'Propinas y todo el local') : item.role === 'restaurant_owner' ? 'Crear restaurante' : roleLabel(item.role);
    return `<tr><td>${safe(item.email)}</td><td>${safe(role)}</td><td><span class="badge ${state === 'Pendiente' ? 'gold' : 'gray'}">${state}</span><small class="state-text">Vence: ${safe(new Date(item.expires_at).toLocaleDateString('es-CL'))}</small></td><td>${state === 'Pendiente' ? `<button class="ghost small" data-${platform ? 'platform' : 'team'}-revoke="${index}">Revocar</button>` : '—'}</td></tr>`;
  }).join('') || emptyRow(4,'Todavía no hay invitaciones.');
}
async function loadTeam() {
  const version = ++teamVersion, selected = rid;
  if (!canManageTeam()) return;
  $('teamStatus').textContent = 'Consultando accesos…';
  $('teamMembers').innerHTML = ''; $('teamInvitations').innerHTML = '';
  teamMembers = []; teamInvitations = []; renderWorkerOptions();
  try {
    const result = await call('propina_restaurant_team', {rid:selected});
    if (version !== teamVersion || selected !== rid || !canManageTeam()) return;
    teamMembers = result.members || []; teamInvitations = result.invitations || [];
    $('teamMembers').innerHTML = teamMembers.map((member, index) => `<tr><td>${safe(member.email)}<small class="state-text">${member.worker_id ? `${safe(member.worker_name)} · ${member.role === 'admin' || member.read_scope !== 'personal' ? 'Consulta del local' : 'Solo sus propinas'}` : 'Sin trabajador vinculado'}</small>${member.role === 'viewer' ? `<button class="ghost small" data-worker-edit="${index}">${member.worker_id ? 'Revisar vinculación' : 'Vincular trabajador'}</button>` : ''}</td><td><select data-member-role="${index}" aria-label="Permiso de ${safe(member.email)}"><option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Administrar el local</option><option value="viewer" ${member.role === 'viewer' ? 'selected' : ''}>${member.read_scope === 'personal' ? 'Consultar sus propinas' : 'Consultar todo el local'}</option></select></td><td><button class="secondary small" data-member-save="${index}">Guardar permiso</button> <button class="ghost small" data-member-remove="${index}">Retirar acceso</button></td></tr>`).join('') || emptyRow(3,'No hay colaboradores con acceso. Puedes invitarlos abajo.');
    $('teamInvitations').innerHTML = invitationRows(teamInvitations);
    renderWorkerOptions();
    $('teamStatus').textContent = `${teamMembers.length} colaborador(es). El acceso del propietario está protegido.`;
  } catch (error) {
    if (version === teamVersion && selected === rid) $('teamStatus').textContent = 'No se pudieron consultar los accesos. ' + errorText(error);
  }
}
function resetWorkerForm() {
  $('workerAccountMode').value = 'existing'; $('workerEmail').value = '';
  $('linkMember').innerHTML = ''; $('linkWorker').innerHTML = '';
  $('linkScope').value = 'personal'; $('linkAgreement').checked = false;
  $('linkAgreementNote').value = ''; $('workerLinkResult').textContent = '';
  renderWorkerForm();
}
function renderWorkerOptions() {
  const account = $('linkMember').value, worker = $('linkWorker').value;
  $('linkMember').innerHTML = '<option value="">Selecciona una cuenta</option>' + teamMembers.filter(m => m.role === 'viewer').map(m => `<option value="${safe(m.email)}">${safe(m.email)}${m.worker_name ? ' · '+safe(m.worker_name) : ''}</option>`).join('');
  if (teamMembers.some(m => m.email === account && m.role === 'viewer')) $('linkMember').value = account;
  $('linkWorker').innerHTML = '<option value="">Selecciona su ficha</option>' + workers.map(w => `<option value="${safe(w.id)}">${safe(w.name)}${w.active ? '' : ' (inactivo)'}</option>`).join('');
  if (workers.some(w => w.id === worker)) $('linkWorker').value = worker;
  renderWorkerForm();
}
function renderWorkerForm() {
  const invite = $('workerAccountMode').value === 'invite';
  $('linkMemberField').classList.toggle('hide', invite); $('workerEmailField').classList.toggle('hide', !invite);
  $('saveWorkerLink').textContent = invite ? 'Crear invitación personal' : 'Guardar vinculación';
  $('linkScopeHelp').textContent = $('linkScope').value === 'personal'
    ? 'La cuenta verá solo las fechas, horas y propinas de esta ficha, incluido su historial anterior.'
    : 'La cuenta podrá ver y exportar los trabajadores, jornadas y montos de todo el local. Usa esta opción solo con el acuerdo de todos.';
}
function selectWorkerAccount() {
  const member = teamMembers.find(m => m.email === $('linkMember').value);
  $('linkWorker').value = member?.worker_id || '';
  $('linkScope').value = member?.worker_id ? member.read_scope || 'personal' : 'personal';
  $('linkAgreement').checked = false; $('linkAgreementNote').value = '';
  renderWorkerForm();
}
$('workerAccountMode').onchange = () => { $('linkAgreement').checked = false; $('workerLinkResult').textContent = ''; renderWorkerForm(); };
$('linkMember').onchange = selectWorkerAccount;
$('linkScope').onchange = () => { $('linkAgreement').checked = false; renderWorkerForm(); };
$('linkWorker').onchange = () => { $('linkAgreement').checked = false; };
$('teamMembers').addEventListener('click', event => {
  const button = event.target.closest('[data-worker-edit]'); if (!button || !canManageTeam()) return;
  const member = teamMembers[Number(button.dataset.workerEdit)]; if (!member) return;
  $('workerAccountMode').value = 'existing'; $('linkMember').value = member.email; selectWorkerAccount();
  $('linkWorker').focus();
});
bind('saveWorkerLink', async () => {
  if (!canManageTeam()) throw Error('Solo el propietario puede vincular cuentas.');
  const selected = rid, invite = $('workerAccountMode').value === 'invite';
  const email = (invite ? $('workerEmail').value : $('linkMember').value).trim();
  const worker = workers.find(w => w.id === $('linkWorker').value);
  const scope = $('linkScope').value, note = $('linkAgreementNote').value.trim();
  if (!email || invite && !$('workerEmail').checkValidity()) throw Error('Selecciona una cuenta o escribe un correo válido.');
  if (!worker) throw Error('Selecciona la ficha del trabajador.');
  if (!$('linkAgreement').checked || note.length < 10 || note.length > 500) throw Error('Confirma el acuerdo de todos los trabajadores y deja una nota de 10 a 500 caracteres.');
  if (!confirm(`${invite ? '¿Invitar' : '¿Vincular'} a ${email} con ${worker.name}? Podrá consultar ${scope === 'personal' ? 'solo sus propinas' : 'todo el local'}, incluido el historial anterior.`)) return;
  const args = {rid:selected,target_worker:worker.id,visibility:scope,agreement_confirmed:true,agreement_note:note};
  const result = await call(invite ? 'propina_issue_worker_invitation' : 'propina_link_worker', {...args,[invite ? 'invitee_email' : 'member_email']:email});
  if (selected !== rid || !canManageTeam()) return;
  $('linkAgreement').checked = false;
  $('workerLinkResult').className = 'notice success spaced';
  if (invite) await sendInvitationEmail(result,'workerLinkResult');
  else $('workerLinkResult').textContent = `Cuenta vinculada a ${worker.name}. La persona puede actualizar Turnia para ver sus propinas.`;
  await loadTeam();
});
async function loadMyTips(version, selectedId) {
  $('myTipsStatus').textContent = 'Consultando tus propinas…';
  try {
    const data = await call('propina_my_tips', {rid:selectedId});
    if (version !== loadVersion || selectedId !== rid) return;
    myTips = Array.isArray(data) ? data : []; myTipsLoaded = true;
    $('myTipsStatus').textContent = ''; renderMyTips();
  } catch (error) {
    if (version !== loadVersion || selectedId !== rid) return;
    myTips = []; myTipsLoaded = false; renderMyTips();
    $('myTipsStatus').textContent = 'No pudimos consultar tus propinas. '+errorText(error);
  }
}
function renderMyTips() {
  $('myWorkerName').textContent = currentRestaurant()?.worker_name || '';
  $('myVisibility').textContent = personalOnly() ? 'Tu acceso permite consultar únicamente tus propinas.' : 'Tu cuenta también tiene acceso a la información del local.';
  const from = $('myTipsFrom').value, to = $('myTipsTo').value;
  const invalid = from && to && from > to;
  const rows = invalid ? [] : myTips.filter(p => (!from || p.work_date >= from) && (!to || p.work_date <= to));
  $('myTipsTotal').textContent = myTipsLoaded ? clp(rows.reduce((n,p) => n + Number(p.calculated_clp),0)) : '—';
  $('myTipsDays').textContent = myTipsLoaded ? new Set(rows.map(p=>p.work_date)).size : '—';
  $('myTipsRows').innerHTML = rows.map(p => `<tr><td>${safe(dateLabel(p.work_date))}</td><td>${p.kind==='flex' ? safe(p.group_code==='DIA'?'Fondo diario':p.group_code)+' · '+Number((Number(p.weight)*100).toFixed(2))+'% participación' : safe(p.hours)+' h'+(p.weight==null?'':' · '+Number((Number(p.weight)*100).toFixed(2))+'%')}</td><td class="money">${clp(p.calculated_clp)}</td></tr>`).join('') || emptyRow(3,invalid ? 'La fecha Desde debe ser anterior o igual a Hasta.' : myTipsLoaded ? 'No hay jornadas asignadas a tu ficha en este período.' : 'Pulsa Actualizar para consultar tus propinas.');
}
$('myTipsFrom').onchange = renderMyTips; $('myTipsTo').onchange = renderMyTips;
$('clearMyTips').onclick = () => { $('myTipsFrom').value = ''; $('myTipsTo').value = ''; renderMyTips(); };
bind('viewGlobalTips', async () => {
  if (!rid || personalOnly()) throw Error('El propietario debe habilitar la consulta global según el acuerdo del equipo.');
  if (!days.some(d => d.work_date === $('payoutDate').value)) $('payoutDate').value = days[0]?.work_date || today();
  setTab('distribution');
});
bind('refreshMyTips', async () => { await init(); setTab(hasWorkerLink() ? 'mytips' : 'access'); });
function renderPlatformRestaurants() {
  const showArchived = $('showArchivedRestaurants').checked;
  const visible = platformRestaurants.map((restaurant,index) => ({restaurant,index}))
    .filter(({restaurant}) => showArchived || !restaurant.archived_at);
  $('platformRestaurants').innerHTML = visible.map(({restaurant,index}) => {
    const archived = !!restaurant.archived_at;
    const state = archived ? 'Archivado' : restaurant.active ? 'Activo' : 'Suspendido';
    const actions = archived
      ? `<button class="ghost small" type="button" data-restaurant-archive="${index}">Restaurar restaurante</button>`
      : `<button class="ghost small" type="button" data-restaurant-status="${index}">${restaurant.active ? 'Suspender acceso' : 'Reactivar acceso'}</button> <button class="ghost small" type="button" data-restaurant-archive="${index}">Archivar restaurante</button>`;
    return `<tr><td><strong>${safe(restaurant.name)}</strong><small class="state-text">${safe(restaurant.email)}</small></td><td><span class="badge ${archived || !restaurant.active ? 'gray' : ''}">${state}</span></td><td>${Number(restaurant.members)||0}</td><td><label class="state-text" for="restaurantReason${index}">Motivo del cambio</label><input id="restaurantReason${index}" data-restaurant-reason="${index}" maxlength="500" placeholder="Indica el motivo"><div class="row spaced">${actions}</div></td></tr>`;
  }).join('') || emptyRow(4,showArchived ? 'No hay restaurantes registrados.' : 'No hay restaurantes sin archivar.');
}
$('showArchivedRestaurants').onchange=renderPlatformRestaurants;
async function loadPlatform() {
  const version = ++platformVersion;
  if (!context?.platform_admin) return;
  $('platformStatus').textContent = 'Consultando restaurantes e invitaciones…';
  $('platformRestaurants').innerHTML = ''; $('platformInvitations').innerHTML = '';
  platformRestaurants = []; platformInvitations = [];
  try {
    const result = await call('propina_platform_snapshot');
    if (version !== platformVersion || !context?.platform_admin) return;
    platformRestaurants = result.restaurants || []; platformInvitations = result.invitations || [];
    renderPlatformRestaurants();
    // Restaurant names can arrive after the ticket list; refresh labels once the platform snapshot resolves.
    if (ownerSupportTickets.length) $('ownerSupportTickets').innerHTML = ownerSupportTickets.map(t=>supportCard(t,true)).join('');
    $('platformInvitations').innerHTML = invitationRows(platformInvitations, true);
    const archived=platformRestaurants.filter(r=>!!r.archived_at).length;
    $('platformStatus').textContent = `${platformRestaurants.length} restaurante(s) · ${platformRestaurants.filter(r => r.active && !r.archived_at).length} activo(s) · ${archived} archivado(s). Los cobros permanecen desactivados.`;
  } catch (error) {
    if (version === platformVersion && context?.platform_admin) $('platformStatus').textContent = 'No se pudo consultar el panel. ' + errorText(error);
  }
}
bind('refreshTeam', loadTeam);
bind('refreshPlatform', loadPlatform);
$('teamAccessPanel').addEventListener('click', event => {
  const button = event.target.closest('[data-member-save],[data-member-remove],[data-team-revoke]');
  if (!button) return;
  guard(async () => {
    if (!canManageTeam()) throw Error('Solo el propietario puede administrar estos accesos.');
    const selected = rid;
    if (button.dataset.teamRevoke !== undefined) {
      const invitation = teamInvitations[Number(button.dataset.teamRevoke)];
      if (!invitation || invitationState(invitation) !== 'Pendiente') throw Error('Actualiza la lista de invitaciones.');
      if (!confirm(`¿Revocar la invitación de ${invitation.email}? Ese código dejará de funcionar.`)) return;
      await call('propina_revoke_staff_invitation', {rid:selected,iid:invitation.id});
    } else {
      const removing = button.dataset.memberRemove !== undefined;
      const index = Number(removing ? button.dataset.memberRemove : button.dataset.memberSave);
      const member = teamMembers[index];
      if (!member || member.role === 'owner') throw Error('Actualiza la lista de colaboradores.');
      const newRole = removing ? null : document.querySelector(`[data-member-role="${index}"]`).value;
      if (!removing && !['admin','viewer'].includes(newRole)) throw Error('Permiso inválido.');
      if (!confirm(removing ? `¿Retirar el acceso de ${member.email} a este restaurante? Sus registros se conservarán.` : `¿Cambiar el permiso de ${member.email} a ${roleLabel(newRole)}?`)) return;
      await call('propina_manage_member', {rid:selected,member_email:member.email,new_role:newRole});
    }
    if (selected === rid) { await loadTeam(); msg('Accesos actualizados. Los registros del restaurante se conservaron.', 'success'); }
  }, button);
});
$('platformOverview').addEventListener('click', event => {
  const button = event.target.closest('[data-restaurant-status],[data-restaurant-archive],[data-platform-revoke]');
  if (!button) return;
  guard(async () => {
    if (!context?.platform_admin) throw Error('Solo el propietario de Turnia puede administrar la plataforma.');
    if (button.dataset.platformRevoke !== undefined) {
      const invitation = platformInvitations[Number(button.dataset.platformRevoke)];
      if (!invitation || invitationState(invitation) !== 'Pendiente') throw Error('Actualiza la lista de invitaciones.');
      if (!confirm(`¿Revocar la invitación de ${invitation.email}? Ese código dejará de funcionar.`)) return;
      await call('propina_revoke_invitation', {iid:invitation.id});
    } else {
      const archiving = button.dataset.restaurantArchive !== undefined;
      const index = Number(archiving ? button.dataset.restaurantArchive : button.dataset.restaurantStatus);
      const restaurant = platformRestaurants[index];
      if (!restaurant) throw Error('Actualiza la lista de restaurantes.');
      const reason = document.querySelector(`[data-restaurant-reason="${index}"]`)?.value.trim() || '';
      if (reason.length < 3 || reason.length > 500) throw Error('Indica un motivo de entre 3 y 500 caracteres.');
      if (archiving) {
        const shouldArchive = !restaurant.archived_at;
        const entered = prompt(`Para ${shouldArchive ? 'archivar' : 'restaurar'} este restaurante, escribe exactamente su nombre: ${restaurant.name}`);
        if (entered === null) return;
        if (entered.trim() !== restaurant.name) throw Error('El nombre de confirmación no coincide. No se hizo ningún cambio.');
        if (!confirm(`${shouldArchive ? 'Archivar' : 'Restaurar'} «${restaurant.name}»? ${shouldArchive ? 'Se ocultará del uso normal y perderá acceso operativo, pero se conservarán los usuarios, trabajadores y todas las propinas.' : 'Se devolverá su acceso anterior y se conservarán sus datos.'}`)) return;
        await call('propina_set_restaurant_archive', {rid:restaurant.id,should_archive:shouldArchive,change_reason:reason,expected_name:restaurant.name});
      } else {
        if (restaurant.archived_at) throw Error('Restaura este restaurante antes de modificar su acceso.');
        if (!confirm(`¿${restaurant.active ? 'Suspender' : 'Reactivar'} el acceso de ${restaurant.name}? Sus usuarios, jornadas y propinas se conservarán.`)) return;
        await call('propina_set_restaurant_status', {rid:restaurant.id,enabled:!restaurant.active,change_reason:reason});
      }
      await init(); setTab('owner');
    }
    await loadPlatform(); msg('Administración actualizada. Los restaurantes y las propinas se conservan. No se realizó ningún cobro.', 'success');
  }, button);
});
const guideSteps = [
  ['Activa tu acceso','Tu invitación es el punto de partida.', ['Usa el correo que Nicolás Valencia autorizó e ingresa el código en «Tengo una invitación».','Confirma el correo de registro e inicia sesión.','En Accesos y ajustes, pega el código y pulsa «Activar acceso».'], 'La autorización es individual. No compartas tu contraseña ni publiques tu código.', 'access'],
  ['Prepara tu restaurante','Cada local tiene su propio espacio.', ['Si eres propietario autorizado, crea tu local en Accesos y ajustes.','Si te invitaron como colaborador, el local aparecerá en el selector superior.','Cuando tengas más de un local, comprueba cuál está seleccionado antes de registrar.'], 'Si ya existe tu restaurante, selecciónalo para continuar.', 'access'],
  ['Define áreas y porcentajes','La suma debe ser exactamente 100%.', ['En Equipo y áreas, agrega los grupos que reciben propina.','Indica el porcentaje de cada área según el acuerdo de tu equipo.','Revisa el total y guarda cada cambio de porcentaje.'], 'Ejemplo: Garzones 60% + Cocina 25% + Barra 10% + Coperos 5% = 100%.', 'staff'],
  ['Agrega a tu equipo','Una persona, su nombre y su área.', ['Ingresa cada trabajador en Equipo y áreas.','Asigna el área correcta antes de agregarlo.','Desactiva a quienes ya no trabajan contigo; su historial se conserva.'], 'No necesitas crear una cuenta de acceso para cada persona que participa del reparto.', 'staff'],
  ['Elige la fecha y el turno','Registra el día en que se generaron las propinas.', ['Abre Registrar día y selecciona la fecha.','Define cuántas horas tiene un turno normal en tu restaurante.','Si ya existe una jornada en esa fecha, verás sus datos guardados.'], 'Con turnos de 8 horas: 8 h = 1 turno; 12 h = 1,5; 16 h = 2.', 'daily'],
  ['Ingresa las propinas','Usa el total del día en pesos chilenos.', ['Reúne el total de propinas que se va a distribuir.','Ingresa pesos completos, sin puntos ni decimales.','Comprueba la fecha y el monto antes de continuar.'], 'Para $200.000 escribe 200000. Se repartirá según los porcentajes de tus áreas.', 'daily'],
  ['Marca quién trabajó','El reparto de cada área depende de las horas.', ['Selecciona solamente a las personas que trabajaron ese día.','Anota las horas reales de cada una.','Cada área con porcentaje positivo necesita una persona presente. Si falta un área, revisa el acuerdo del equipo antes de ajustar.'], 'En una misma área, quien trabajó 12 h recibe 1,5 veces lo de alguien que trabajó 8 h.', 'daily'],
  ['Guarda y revisa el reparto','Comprueba el resultado antes de entregarlo.', ['Pulsa Guardar jornada y calcular.','En Reparto verás cuánto corresponde a cada persona.','Compara el total con lo distribuido. Si necesitas corregir una jornada existente, revisa los datos antes de confirmar su reemplazo.'], 'Revisa también el valor «Sin asignar». Todos los montos se muestran en CLP.', 'distribution'],
  ['Consulta y exporta','El historial te ayuda a cerrar cada semana.', ['En Historial, elige una semana de lunes a domingo.','Abre cualquier jornada para consultar su reparto y revisa el cierre semanal por trabajador.','Exporta un Excel con el cierre, detalle diario y control de transferencias para revisar o compartir.'], 'La descarga contiene el detalle por persona del restaurante seleccionado.', 'history'],
  ['Administra y vuelve cuando quieras','Tu restaurante ya tiene una rutina clara.', ['Invita administradores o usuarios de consulta desde Accesos, si tienes permiso de propietario.','Consulta ahí la fecha de vencimiento de tu membresía. Los cobros están desactivados.','Esta guía siempre estará en el menú. Al usar un equipo compartido, cierra tu sesión.'], 'Guía completada. Ya puedes registrar tu primera jornada.', 'home']
];
function guideKey() { return user ? `turnia_guide_v1_${user.id}` : ''; }
function readGuideProgress() {
  try {
    const raw = storage.get(guideKey()), saved = raw ? JSON.parse(raw) : {};
    // Email verification and restaurant creation are already complete on first entry.
    guideIndex = Math.max(0, Math.min(guideSteps.length - 1, Number(saved.step ?? (rid ? 2 : 0)) || 0));
    guideDone = saved.done === true;
  } catch { guideIndex = rid ? 2 : 0; guideDone = false; }
  $('onboardingBanner').classList.toggle('hide', guideDone || personalOnly() || context?.platform_admin || !(rid || context?.can_create));
  renderGuide();
  renderTour();
}
function saveGuideProgress() { if (user) storage.set(guideKey(), JSON.stringify({step:guideIndex,done:guideDone})); }
function renderGuide() {
  const step = guideSteps[guideIndex];
  $('guideProgressText').textContent = guideDone ? 'Completaste la guía. Puedes repasar cualquier paso.' : `Paso ${guideIndex+1} de ${guideSteps.length}`;
  $('guideProgress').style.width = `${guideDone ? 100 : Math.round((guideIndex+1)*100/guideSteps.length)}%`;
  $('guideNav').innerHTML = guideSteps.map((s,i) => `<li><button data-guide-step="${i}" class="${i === guideIndex ? 'active' : ''} ${guideDone || i < guideIndex ? 'done' : ''}" ${i === guideIndex ? 'aria-current="step"' : ''}><span>${guideDone || i < guideIndex ? '✓' : i+1}</span>${s[0]}</button></li>`).join('');
  $('guideContent').innerHTML = `<p class="eyebrow">PASO ${String(guideIndex+1).padStart(2,'0')}</p><h2>${step[0]}</h2><p class="muted">${step[1]}</p><ul>${step[2].map(s => `<li>${s}</li>`).join('')}</ul><div class="guide-example">${step[3]}</div><button class="secondary" data-go="${step[4]}">Ir a ${titles[step[4]]} →</button>`;
  $('guidePrev').disabled = guideIndex === 0;
  $('guideNext').textContent = 'Abrir esta tarea →';
}
$('guideNav').addEventListener('click', e => { const el = e.target.closest('[data-guide-step]'); if (el) { guideIndex = Number(el.dataset.guideStep); saveGuideProgress(); renderGuide(); } });
$('guidePrev').onclick = () => { if (guideIndex > 0) guideIndex--; saveGuideProgress(); renderGuide(); };
// Unlike a static article, the assistant opens the correct section at each step.
function finishGuide() {
  guideDone = true; saveGuideProgress(); $('onboardingBanner').classList.add('hide');
  renderTour(); setTab('home');
  msg('Guía completada. Puedes volver a consultarla desde el menú.', 'success');
}
function advanceGuide() {
  if (guideIndex >= guideSteps.length - 1) return finishGuide();
  guideIndex++; saveGuideProgress(); renderGuide();
  setTab(guideSteps[guideIndex][4]);
  const focusIds = { 2:'areaName', 3:'workerName', 4:'date', 5:'amount', 6:'attendance', 7:'payoutDate', 8:'historyWeekSelect' };
  $(focusIds[guideIndex])?.focus();
}
function renderTour() {
  const el = $('onboardingTour');
  if (!el) return;
  const show = !!rid && !!context && !context.platform_admin && canEdit() && !guideDone && !tourDismissed && tab !== 'guide';
  el.classList.toggle('hide', !show);
  if (!show) return;
  const step = guideSteps[guideIndex];
  $('tourStepLabel').textContent = 'Tu configuración · Paso ' + (guideIndex + 1) + ' de ' + guideSteps.length;
  $('tourTitle').textContent = step[0];
  $('tourDescription').textContent = step[2].join(' ');
  $('tourExample').textContent = step[3];
  $('tourStatus').textContent = '';
  $('tourContinue').textContent = tab !== step[4] ? 'Ir a ' + titles[step[4]] + ' →' :
    guideIndex === guideSteps.length - 1 ? 'Terminar guía ✓' : 'Continuar →';
}
$('guideNext').onclick = () => {
  // The guide's button opens the task before advancing; the contextual Continue
  // button moves to the next stage once the user completes this one.
  if (tab === 'guide') { setTab(guideSteps[guideIndex][4]); return; }
  advanceGuide();
};
$('tourContinue').onclick = () => {
  if (!context || !rid || guideDone) return;
  const step = guideSteps[guideIndex];
  if (tab !== step[4]) { setTab(step[4]); return; }
  // Do not claim a configuration task is finished before its data is saved.
  if (guideIndex === 2 && (!areas.length || Math.abs(areas.reduce((n,a)=>n+Number(a.percentage),0)-100) > .0001)) {
    $('tourStatus').textContent = 'Primero agrega tus áreas y haz que los porcentajes sumen 100%.';
    $('areaName').focus(); return;
  }
  if (guideIndex === 3 && !workers.some(w=>w.active)) {
    $('tourStatus').textContent = 'Agrega al menos una persona de tu equipo para continuar.';
    $('workerName').focus(); return;
  }
  if (guideIndex === 6 && !days.length && !flexShifts.length) {
    $('tourStatus').textContent = 'Guarda una jornada antes de continuar al reparto.';
    $('saveDay').focus(); return;
  }
  advanceGuide();
};
$('tourHelp').onclick = () => setTab('guide');
$('tourClose').onclick = () => { tourDismissed = true; renderTour(); };
$('restartGuide').onclick = () => { guideIndex = 0; guideDone = false; saveGuideProgress(); renderGuide(); };
$('keepSession').checked = keepSession;
$('keepSession').onchange = () => { storage.set(KEEP_SESSION_KEY,$('keepSession').checked ? '1' : '0'); location.reload(); };
$('loginForm').addEventListener('submit', e => { e.preventDefault(); guard(async () => {
  check(await sb.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value}));
  $('password').value = ''; await init();
}, $('login')); });
bind('register', async () => {
  if ($('inviteBox').classList.contains('hide')) { $('inviteBox').classList.remove('hide'); $('register').textContent = 'Crear cuenta con invitación'; $('password').autocomplete = 'new-password'; $('invite').focus(); return; }
  const token = $('invite').value.trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Pega tu código completo: debe contener 64 caracteres.');
  if (!$('email').checkValidity() || !$('email').value || $('password').value.length < 8) throw Error('Ingresa un correo válido y una contraseña de al menos 8 caracteres.');
  check(await sb.auth.signUp({email:$('email').value.trim(),password:$('password').value,options:{emailRedirectTo:location.origin+'/',data:{propina_invitation:token}}}));
  $('password').value=''; $('invite').value='';
  msg('Confirma tu correo y vuelve a iniciar sesión. Activaremos tu código automáticamente y podrás configurar tu restaurante.','success');
});
bind('resendConfirmation', async () => {
  const email=$('email').value.trim();
  if(!email || !$('email').checkValidity()) throw Error('Escribe primero el correo con el que creaste tu cuenta.');
  check(await sb.auth.resend({type:'signup',email,options:{emailRedirectTo:location.origin+'/'}}));
  msg('Si tu correo está pendiente de confirmación, recibirás un nuevo enlace. Abre únicamente el mensaje más reciente.','success');
});
bind('forgot', async () => {
  if (!$('email').value || !$('email').checkValidity()) throw Error('Escribe primero tu correo electrónico.');
  check(await sb.auth.resetPasswordForEmail($('email').value.trim(),{redirectTo:location.origin+'/'}));
  msg('Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.','success');
});
bind('savePassword', async () => {
  validateNewPassword($('newPassword').value, $('confirmPassword').value);
  check(await sb.auth.updateUser({password:$('newPassword').value}));
  $('newPassword').value = ''; $('confirmPassword').value = ''; recoveryMode = false;
  $('recovery').classList.add('hide'); await init(); msg('Contraseña actualizada.','success');
});
bind('saveAccountProfile', async () => {
  if (!user) throw Error('Debes iniciar sesión.');
  const name = $('accountDisplayName').value.trim().replace(/\s+/g,' ');
  const phone = $('accountPhone').value.trim();
  if (name.length < 2 || name.length > 100) throw Error('Escribe tu nombre y apellido (2 a 100 caracteres).');
  if (phone && !/^[+0-9 ()-]{7,30}$/.test(phone)) throw Error('Revisa el teléfono: usa números, espacios o el signo +.');
  const update = check(await sb.auth.updateUser({data:{display_name:name,full_name:name,phone}}));
  if (update?.user) user = update.user;
  await init(); setTab('access');
  setSettingsStatus('Tus datos personales se guardaron correctamente.');
});
bind('changeAccountPassword', async () => {
  $('testPasswordLogin').classList.add('hide');
  if (!user?.email) throw Error('Debes iniciar sesión.');
  const current = $('currentAccountPassword').value;
  const next = $('nextAccountPassword').value;
  if (!current) throw Error('Escribe tu contraseña actual.');
  validateNewPassword(next, $('nextAccountPasswordConfirm').value);
  if (current === next) throw Error('La nueva contraseña debe ser diferente de la actual.');
  const email = user.email, expectedUser = user.id;
  const verified = check(await sb.auth.signInWithPassword({email,password:current}));
  if (verified.session?.user?.id !== expectedUser || user?.id !== expectedUser) throw Error('La sesión cambió. Vuelve a iniciar sesión.');
  check(await sb.auth.updateUser({password:next,current_password:current}));
  $('currentAccountPassword').value = '';
  $('nextAccountPassword').value = '';
  $('nextAccountPasswordConfirm').value = '';
  setSettingsStatus('Contraseña actualizada. La próxima vez podrás iniciar sesión con tu nueva clave.');
  $('testPasswordLogin').classList.remove('hide');
});
function validateNewPassword(password, confirmation) {
  if (password.length < 8) throw Error('Usa una contraseña de al menos 8 caracteres.');
  if (new TextEncoder().encode(password).length > 72) throw Error('La contraseña es demasiado larga. Usa una más corta.');
  if (password !== confirmation) throw Error('Las contraseñas nuevas no coinciden.');
}
bind('testPasswordLogin', async () => {
  const email = user?.email || '';
  await logout(); $('email').value = email;
  msg('Inicia sesión con tu nueva contraseña para comprobar el cambio.', 'success'); $('password').focus();
});
bind('saveRestaurantDetails', async () => {
  const selected = rid;
  const newName = $('restaurantEditName').value.trim().replace(/\s+/g,' ');
  if (!selected || currentRestaurant()?.role !== 'owner') throw Error('Solo el propietario puede editar este restaurante.');
  if (restaurantBusinessFor!==selected) throw Error('Espera mientras se cargan los datos del restaurante.');
  if (newName.length < 2 || newName.length > 80) throw Error('Ingresa un nombre de restaurante entre 2 y 80 caracteres.');
  const profile=collectBusiness('business');
  if(!$('businessContactEmail').checkValidity())throw Error('Revisa el correo de contacto.');
  await call('propina_update_restaurant_business_profile',{rid:selected,restaurant_name:newName,profile});
  restaurantBusiness=profile;
  await init(); setTab('access');
  setSettingsStatus('La información de tu restaurante se actualizó y se conserva su historial.');
});
async function logout() {
  check(await sb.auth.signOut({scope:'local'}));
  $('restaurantSetup').classList.add('hide'); $('inviteActivation').classList.add('hide'); context = null; user = null; rid = ''; loadVersion++;
  resetData(); closeDrawer(); setTab('home'); $('settingsStatus').textContent = ''; $('settingsStatus').className = 'notice hide'; $('currentAccountPassword').value = ''; $('nextAccountPassword').value = ''; $('nextAccountPasswordConfirm').value = ''; $('password').value = ''; $('invite').value = ''; $('acceptToken').value = '';
  $('authMessage').textContent = ''; $('message').textContent = ''; await init();
}
bind('logout', logout);
bind('logoutTop', logout);
bind('pendingLogout', logout);
bind('sandboxPreflight', async () => {
  const notice=$('sandboxPreflightStatus');
  notice.classList.remove('hide');
  notice.textContent='Comprobando vendedor de Mercado Pago sin iniciar pagos…';
  try {
    const response=check(await sb.functions.invoke('turnia-sandbox-preflight',{body:{}}));
    notice.textContent=response.ready
      ? 'Vendedor de prueba verificado. Los pagos siguen desactivados hasta completar la verificación.'
      : 'Comprobación pendiente: '+String(response.reason || response.note || 'Revisa la configuración del vendedor de prueba.');
  } catch(e) { notice.textContent='No se pudo comprobar el vendedor: '+errorText(e); }
});
bind('inspectSubscription', async () => {
  const notice=$('inspectionResult');
  notice.classList.remove('hide');
  notice.textContent='Consultando el estado de la orden en Mercado Pago, sin iniciar un pago…';
  try {
    const result=check(await sb.functions.invoke('turnia-inspect-test-subscription',{body:{}}));
    if (!result?.found) {
      notice.textContent='No se encontró una orden de prueba asociada a esta cuenta. No realices pagos.';
      return;
    }
    if (!result.checked) {
      notice.textContent='No pudimos verificar el estado directamente en Mercado Pago. Mantendremos los cobros desactivados.';
      return;
    }
    const yesNo=x=>x===true?'sí':x===false?'no':'no verificado';
    const valid=result.eligible_for_payment_test===true;
    const environment= result.environment==='test'?'Indicador de prueba presente'
      :result.environment==='live'?'Indicador de producción (NO continuar)':'No informado por la API';
    const lines=[
      'Diagnóstico Turnia: versión 2',
      'Estado de la suscripción: '+String(result.status||'desconocido'),
      'Vendedor de prueba: '+yesNo(result.seller_is_test),
      'Comprador de prueba: '+yesNo(result.buyer_is_test),
      'Identificador de comprador disponible: '+yesNo(result.payer_id_returned),
      'Comprador autorizado configurado: '+yesNo(result.trusted_buyer_id_configured),
      'Identificador coincide: '+yesNo(result.trusted_buyer_id_matches),
      'Monto y moneda correctos: '+yesNo(result.amount_and_currency_match),
      'Orden vinculada a Turnia: '+yesNo(result.reference_matches),
      'Suscripción pertenece al vendedor: '+yesNo(result.collector_matches_seller),
      'Cuentas de prueba vinculadas: '+yesNo(result.test_accounts_aligned),
      'Entorno: '+environment,
      valid?'Verificación preliminar correcta. Los cobros siguen desactivados.'
        :'No continuar con pagos hasta validar las condiciones anteriores.'
    ];
    notice.textContent=lines.join('\n');
  } catch (e) {
    notice.textContent='No se pudo verificar la orden: '+errorText(e)+'. No realices pagos.';
  }
});
bind('sandboxPay', async () => {
 try {
  if ($('sandboxCheckoutPanel').classList.contains('hide'))
    throw Error('Las pruebas de pago todavía no están habilitadas.');
  const notice = $('sandboxPayMessage');
  notice.classList.remove('hide');
  notice.textContent='Preparando la operación de prueba…';
  const buyer = $('sandboxBuyer').value.trim().toLowerCase();
  if (!/^[^@\s]+@testuser\.com$/i.test(buyer))
    throw Error('Ingresa un comprador de pruebas de Mercado Pago.');
  const result = check(await sb.functions.invoke('turnia-sandbox-checkout', {
    body: {payer_email: buyer}
  }));
  if (result?.mode !== 'sandbox' || result?.status !== 'pending' ||
      !/^https:\/\//.test(result?.init_point || ''))
    throw Error('Mercado Pago no devolvió un enlace de prueba válido.');
  const target = new URL(result.init_point);
  if (target.hostname !== 'mercadopago.com' &&
      !target.hostname.endsWith('.mercadopago.com') &&
      target.hostname !== 'mercadopago.cl' &&
      !target.hostname.endsWith('.mercadopago.cl'))
    throw Error('El destino de pago no pertenece a Mercado Pago.');
  notice.textContent='Mercado Pago abrió una orden de prueba. Continuando…';
  location.assign(target.href);
 } catch (e) {
  $('sandboxPayMessage').classList.remove('hide');
  $('sandboxPayMessage').textContent='No se pudo preparar el pago de prueba: '+errorText(e);
 }
});
$('restaurant').onchange = () => guard(async () => {
  rid = $('restaurant').value; loadVersion++; teamSpace=false;
  const selected=rid, changeVersion=loadVersion;
  if(selected){
    try { teamSpace=(await call('turnia_is_worker_team',{p_workspace_id:selected}))===true; } catch { teamSpace=false; }
    if(selected!==rid || changeVersion!==loadVersion)return;
  }
  resetData(); renderAccountSettings();
  if(!teamSpace && currentRestaurant()?.role==='owner')void loadRestaurantBusiness(rid);
  if (tab === 'access') void loadTeam();
  if (tab === 'support') void loadSupport();
  $('profileRole').textContent = context?.platform_admin ? 'MUTAVIA GROUP · Creador de Turnia' : teamSpace && currentRestaurant()?.role==='owner' ? 'Coordinador del equipo' : teamSpace ? 'Integrante del equipo' : roleLabel(currentRestaurant()?.role);
  setTab(personalOnly() ? 'mytips' : tab === 'mytips' && !hasWorkerLink() ? 'home' : tab);
  await load();
});
bind('createRestaurant', async () => {
  const name = $('restaurantName').value.trim();
  if (!context?.can_create || !name || name.length > 80) throw Error('Escribe un nombre de restaurante de hasta 80 caracteres.');
  rid = await call('propina_create_restaurant',{restaurant_name:name});
  $('restaurantName').value = ''; await init(); setTab('staff'); msg('Restaurante creado. Agrega las áreas y sus porcentajes.','success');
});
$('date').onchange = renderDay;
$('payoutDate').onchange = renderPayouts;
$('editDay').onclick = () => { $('date').value = $('payoutDate').value; renderDay(); setTab('daily'); };
$('shiftHours').onchange = () => {
  document.querySelectorAll('[data-hours]').forEach(el => { if (!document.querySelector(`[data-present="${el.dataset.hours}"]`).checked) el.value = $('shiftHours').value; }); renderAttendanceCount();
};
$('attendance').addEventListener('change',renderAttendanceCount);
bind('addArea', async () => {
  requireEdit(); const name = $('areaName').value.trim(), percentage = Number($('areaPct').value);
  if (!name || $('areaPct').value === '' || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) throw Error('Escribe un área y un porcentaje entre 0 y 100.');
  check(await sb.from('propina_areas').insert({restaurant_id:rid,name,percentage}));
  $('areaName').value = ''; $('areaPct').value = ''; await load(); msg('Área agregada.','success');
});
bind('addWorker', async () => {
  requireEdit(); const name = $('workerName').value.trim(), area_id = $('workerArea').value;
  if (!name || !area_id) throw Error('Completa el nombre y selecciona un área.');
  check(await sb.from('propina_workers').insert({restaurant_id:rid,name,area_id}));
  $('workerName').value = ''; await load(); msg('Persona agregada al equipo.','success');
});
$('areas').onclick = e => { const el = e.target.closest('[data-update-area]'); if (!el) return;
  guard(async () => {
    requireEdit(); const id = el.dataset.updateArea, input = document.querySelector(`[data-pct="${id}"]`), percentage = Number(input.value);
    if (input.value === '' || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) throw Error('Ingresa un porcentaje entre 0 y 100.');
    check(await sb.from('propina_areas').update({percentage}).eq('id',id).eq('restaurant_id',rid)); await load(); msg('Porcentaje guardado.','success');
  }, el);
};
$('workers').onclick = e => { const el = e.target.closest('[data-toggle-worker]'); if (!el) return;
  guard(async () => {
    requireEdit(); const w = workers.find(w => w.id === el.dataset.toggleWorker);
    if (!w) return;
    check(await sb.from('propina_workers').update({active:!w.active}).eq('id',w.id).eq('restaurant_id',rid)); await load(); msg('Estado del trabajador actualizado. Su historial se conserva.','success');
  }, el);
};
bind('saveDay', async () => {
  requireEdit();
  if (Math.abs(areas.reduce((n,a) => n + Number(a.percentage),0) - 100) > .0001) throw Error('Los porcentajes de las áreas deben sumar exactamente 100%.');
  const date = $('date').value, amount = Number($('amount').value), hours_per_shift = Number($('shiftHours').value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || $('amount').value === '' || !Number.isSafeInteger(amount) || amount < 0 || !Number.isFinite(hours_per_shift) || hours_per_shift <= 0 || hours_per_shift > 24) throw Error('Revisa la fecha, el monto en pesos completos y las horas del turno.');
  const present = [...document.querySelectorAll('[data-present]:checked')].map(el => {
    const wid = el.dataset.present;
    const pct = document.querySelector(`[data-day-percent="${wid}"]`).value;
    return {worker_id:wid,hours:Number(document.querySelector(`[data-hours="${wid}"]`).value),
      participation:pct === '' ? null : Number((Number(pct) / 100).toFixed(4)),
      note:document.querySelector(`[data-day-note="${wid}"]`).value.trim(),agreed:document.querySelector(`[data-day-agreed="${wid}"]`).checked};
  });
  if (!present.length || present.some(x => !Number.isFinite(x.hours) || x.hours <= 0 || x.hours > 24)) throw Error('Selecciona personal e ingresa horas válidas, entre 0,5 y 24.');
  if (present.some(x => x.participation === null || !Number.isFinite(x.participation) || x.participation < 0.01 || x.participation > 2)) throw Error('La participación de cada persona debe estar entre 1% y 200%.');
  if (present.some(x => x.note.length > 300 || x.participation !== 1 && (!x.agreed || x.note.length < 10))) throw Error('Una participación distinta de 100% requiere acuerdo confirmado y un motivo de al menos 10 caracteres.');
  if (present.some(x => x.hours / hours_per_shift * x.participation > 2.000001)) throw Error('Máximo 2 puntos por persona en jornada completa. Si trabajó 16 horas y el turno base es de 8 horas, ya tiene 2 puntos al 100%: no sumes otro 200%.');
  const presentAreas = new Set(present.map(x => workers.find(w => w.id === x.worker_id)?.area_id));
  if (areas.some(a => Number(a.percentage) > 0 && !presentAreas.has(a.id))) throw Error('Cada área con porcentaje positivo necesita al menos una persona presente.');
  if (flexShifts.some(s => s.work_date === date)) throw Error('El ' + dateLabel(date) + ' ya tiene propinas AM/PM. Abre esa modalidad para revisar el reparto y evita duplicar los montos.');
  if (days.some(d => d.work_date === date) && !window.confirm('Ya existe una jornada para esta fecha. ¿Guardar estos cambios y recalcular su reparto?')) return;
  await call('propina_save_day',{p_restaurant:rid,p_date:date,p_amount:amount,p_shift_hours:hours_per_shift,p_workers:present});
  $('payoutDate').value = date; await load();
  const stored = days.find(d=>d.work_date===date);
  if (!stored || Number(stored.amount_clp)!==amount) throw Error('La base de datos no confirmó el monto de la jornada. Revisa el historial antes de intentarlo de nuevo.');
  $('daySaveStatus').textContent = 'Jornada del '+dateLabel(date)+' guardada correctamente por '+clp(amount)+'.';
  $('daySaveStatus').className = 'notice success spaced';
  if (!guideDone && guideIndex >= 4 && guideIndex <= 6) { guideIndex = 7; saveGuideProgress(); }
  setTab('distribution'); msg('Jornada del '+dateLabel(date)+' guardada: '+clp(amount)+'. Reparto calculado.','success');
});
function openPayout(e) {
  const flexible=e.target.closest('[data-open-flex-date]');
  if(flexible){$('flexDate').value=flexible.dataset.openFlexDate;if(flexible.dataset.openFlexCode)$('flexShiftCode').value=flexible.dataset.openFlexCode;renderFlex();setTab('flex');return;}
  const el = e.target.closest('[data-open-date]'); if (!el) return;
  $('payoutDate').value = el.dataset.openDate; renderPayouts(); setTab('distribution');
}
$('historyRows').onclick = openPayout; $('recentDays').onclick = openPayout; $('recentDaysMobile').onclick = openPayout;
function csvCell(value) {
  const text = String(value ?? '');
  // Prevent spreadsheet formulas in customer-provided names.
  return '"' + (/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replace(/"/g,'""') + '"';
}

bind('export',async()=>{
  if(!window.TurniaXlsx)throw Error('No se pudo cargar el generador Excel. Actualiza Turnia e inténtalo de nuevo.');
  const week=weeklySettlement();
  if(!week.details.length)throw Error('Selecciona una semana con propinas registradas para exportar.');
  const restaurant=currentRestaurant()?.name||'Restaurante';
  const subtitle=restaurant+' · '+weekDescription(week.from)+' · Valores CLP';
  const labels=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const dayHeadings=week.dates.map((date,i)=>labels[i]+' '+date.slice(8,10)+'/'+date.slice(5,7));
  const byDay=date=>week.details.filter(row=>row.date===date).reduce((sum,row)=>sum+row.amount,0);
  const closing=[
    ...week.people.map(person=>[
      person.area,person.name,...week.dates.map(date=>person.perDay.get(date)||0),
      person.total,'No informado'
    ])
  ];
  const closingTotal=['TOTAL SEMANAL','',...week.dates.map(byDay),week.distributed,''];
  const daily=week.recorded.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(day=>{
    const calc=week.details.filter(item=>item.date===day.date).reduce((sum,item)=>sum+item.amount,0);
    const label=day.flexShifts.length&&day.day?'Mixto (revisar)':day.flexShifts.length?'AM/PM':'Jornada completa';
    return [day.date,label,day.amount,calc,day.amount-calc];
  });
  const totalDaily=['TOTAL',week.recorded.length+' día(s)',week.amount,week.distributed,week.difference];
  const detail=week.details.slice().sort((a,b)=>a.date.localeCompare(b.date)||a.area_name.localeCompare(b.area_name,'es')||a.worker_name.localeCompare(b.worker_name,'es')).map(item=>[
    item.date,item.area_name,item.worker_name,item.kind,item.turno,
    item.hours??'',Number(item.participation.toFixed(2)),
    item.points==null?'':Number(item.points.toFixed(4)),item.amount
  ]);
  const areas=week.areas.map(area=>[area.name,area.workers.size,area.dates.size,area.total]);
  const transfer=week.people.map(person=>[
    person.name,person.area,person.total,'Sin registrar','','','',''
  ]);
  const note='Cierre calculado con las jornadas guardadas. No acredita transferencias bancarias.';
  const sheets=[
    {name:'Cierre semanal',title:'TURNIA · CIERRE SEMANAL',subtitle,note,
      headers:['Área','Trabajador',...dayHeadings,'TOTAL CLP','Pago confirmado'],
      rows:closing,total:closingTotal,money:[2,3,4,5,6,7,8,9],
      widths:[21,29,16,16,16,16,16,16,16,19,23]},
    {name:'Jornadas',title:'TURNIA · CONTROL DE JORNADAS',subtitle,
      note:'Cada fecha aparece una sola vez. Los fondos diarios AM/PM se cuentan una sola vez por persona.',
      headers:['Fecha','Modalidad','Propinas CLP','Distribuido CLP','Diferencia CLP'],
      rows:daily,total:totalDaily,money:[2,3,4],widths:[18,28,21,22,22]},
    {name:'Detalle diario',title:'TURNIA · DETALLE DE PROPINA',subtitle,
      note:'Para AM/PM con fondo diario, DIA es un solo reparto. Horas vacías significa modalidad por turnos.',
      headers:['Fecha','Área','Trabajador','Modalidad','Turno/Fondo','Horas','Participación %','Puntos/Peso','Propina CLP'],
      rows:detail,money:[8],widths:[17,22,29,22,20,13,19,17,20]},
    {name:'Totales por área',title:'TURNIA · FONDOS POR ÁREA',subtitle,
      note:'Sumas de los repartos guardados. No mueve dinero entre Cocina, Garzones u otras áreas.',
      headers:['Área','Trabajadores','Días con reparto','Total CLP'],
      rows:areas,total:['TOTAL',week.people.length,week.recorded.length,week.distributed],
      money:[3],widths:[29,19,22,23]},
    {name:'Transferencias',title:'TURNIA · CONTROL DE TRANSFERENCIAS',subtitle,
      note:'Referencia para anotar pagos manualmente. Sin registrar NO significa que el banco haya realizado un pago.',
      headers:['Trabajador','Área','Monto calculado CLP','Estado','Banco','Fecha transferencia','N° operación','Observaciones / comprobante'],
      rows:transfer,money:[2],widths:[29,21,23,22,26,24,24,42]}
  ];
  window.TurniaXlsx.download(sheets,'Turnia_Cierre_'+week.from+'_al_'+week.to+'.xlsx');
  msg('Excel semanal generado: cierre, jornadas, detalle, áreas y control de transferencias. El archivo no confirma pagos.','success');
});

$('exportMobile').addEventListener('click',()=> $('export').click());

function showToken(data, target) {
  $(target).textContent = `Invitación para ${data.email}\nCódigo: ${data.token}\nVence: ${new Date(data.expires_at).toLocaleString('es-CL')}${data.duration_days ? `\nMembresía: ${data.duration_days} días` : ''}\nComparte este código por un canal privado.`;
}
async function sendInvitationEmail(data, target) {
  showToken(data,target);
  const output = $(target);
  const details = output.textContent;
  output.textContent = details + '\nEnviando correo de invitación…';
  const retry = async () => {
    let sent = false;
    try {
      const result = await sb.functions.invoke('turnia-invite-email',{body:{token:data.token}});
      sent = !result.error && result.data?.status === 'accepted_by_smtp';
    } catch {}
    output.replaceChildren(document.createTextNode(details + (sent ? '\nCorreo enviado al servicio de correo. La persona podrá confirmar el código y completar su cuenta desde el enlace. Revisa también spam.' : '\nLa invitación se creó, pero no se confirmó el envío del correo. Espera un minuto y reintenta.')));
    if (!sent) {
      const button = document.createElement('button'); button.type='button'; button.className='secondary spaced'; button.textContent='Reenviar correo';
      button.onclick = async () => { button.disabled=true; await retry(); }; output.append(button);
    }
    return sent;
  };
  return retry();
}
bind('adminInvite', async () => {
  if (!context?.platform_admin) throw Error('Esta acción requiere permisos de propietario de Turnia.');
  const role = $('adminRole').value, email = $('adminEmail').value.trim();
  if (!email || !$('adminEmail').checkValidity()) throw Error('Escribe un correo válido.');
  if (role !== 'restaurant_owner' && !rid) throw Error('Selecciona un restaurante para esta invitación.');
  const data = role === 'restaurant_owner' ? await call('propina_issue_membership_invitation',{invitee_email:email,duration_days:Number($('membershipDuration').value),price_clp:5000}) : await call('propina_issue_invitation',{invitee_email:email,invitee_role:role,rid});
  const sent = await sendInvitationEmail(data,'inviteResult'); msg(sent ? 'Invitación creada y correo enviado. No se realizó ningún cobro.' : 'Invitación creada. El correo necesita un reintento.',sent ? 'success' : 'info');
  await loadPlatform();
});
$('adminRole').onchange = () => { $('membershipDuration').disabled = $('adminRole').value !== 'restaurant_owner'; };
bind('staffInvite', async () => {
  if (!canInvite()) throw Error('Necesitas permiso de propietario del restaurante.');
  if (!$('staffEmail').value || !$('staffEmail').checkValidity()) throw Error('Escribe un correo válido.');
  await sendInvitationEmail(await call('propina_issue_staff_invitation',{invitee_email:$('staffEmail').value.trim(),invitee_role:$('staffRole').value,rid}),'staffInviteResult');
  await loadTeam();
});
bind('acceptInvite', async () => {
  const token = $('acceptToken').value.trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Pega el código completo de 64 caracteres.');
  await call('propina_accept_invitation',{token}); $('acceptToken').value = '';
  await init();
  if (!rid && context?.can_create && !context?.platform_admin) { msg('Código activado. Completa tu restaurante para continuar.','success'); return; }
  if (personalOnly()) setTab('mytips');
  else { guideIndex = 0; guideDone = false; saveGuideProgress(); setTab('guide'); }
  msg('Acceso activado. Bienvenido a Turnia.','success');
});

const supportStatusLabels = {pendiente:'Pendiente',en_revision:'En revisión',resuelto:'Resuelto'};
const supportCategoryLabels = {consulta:'Consulta',error:'Problema técnico',mejora:'Sugerencia',otro:'Otro'};
const supportStamp = value => value ? new Date(value).toLocaleString('es-CL',{dateStyle:'short',timeStyle:'short'}) : '—';
const supportShortId = value => String(value||'').slice(0,8).toUpperCase();
function supportStatus(message, error=false) {
  $('supportListStatus').textContent=message;
  $('supportListStatus').className=error?'notice error spaced':'state-text';
}
function supportCard(ticket, owner=false) {
  const name = owner ? (platformRestaurants.find(r=>r.id===ticket.restaurant_id)?.name||'Restaurante')+' · ' : '';
  return `<div class="support-ticket-card">
    <div><strong>${safe(name)}#${safe(supportShortId(ticket.id))} · ${safe(ticket.subject)}</strong><p class="muted">${safe(supportCategoryLabels[ticket.category]||'Consulta')} · ${safe(supportStamp(ticket.created_at))}</p></div>
    <div><span class="badge gray">${safe(supportStatusLabels[ticket.status]||ticket.status)}</span>
    <button class="secondary small" type="button" data-support-open="${safe(ticket.id)}">Ver conversación</button></div>
  </div>`;
}
async function loadSupport() {
  const version=++supportVersion, restaurantId=rid;
  selectedSupportTicket=null;
  $('supportThread').classList.add('hide');
  if (!restaurantId) {supportTickets=[];$('supportTickets').innerHTML='';supportStatus('Selecciona un restaurante para ver sus solicitudes.');return;}
  supportStatus('Cargando tus solicitudes…');
  try {
    const response=await sb.from('turnia_support_tickets').select('*').eq('restaurant_id',restaurantId);
    const list=check(response)||[];
    if (version!==supportVersion || rid!==restaurantId) return;
    supportTickets=list.slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
    $('supportTickets').innerHTML=supportTickets.map(item=>supportCard(item)).join('')||'<p class="muted">Todavía no tienes solicitudes.</p>';
    supportStatus(supportTickets.length+' solicitud(es) para el restaurante seleccionado.');
  } catch(e){if(version===supportVersion)supportStatus('No se pudieron cargar las solicitudes: '+errorText(e),true);}
}
const notificationStatusLabels={sent:'Enviada',pending:'Pendiente',sending:'Procesando',failed:'Fallida'};
const notificationClass=status=>status==='sent'?'sent':status==='failed'?'failed':'pending';
function renderOwnerNotifications(){
  if(!canViewNotifications())return;
  const filter=$('ownerNotificationsFilter').value;
  const rows=ownerNotificationItems.filter(item=>
    filter==='all' || (filter==='pending' ? ['pending','sending'].includes(item.status) : item.status===filter)
  );
  $('ownerNotificationsRows').innerHTML=rows.map(item=>{
    const display=notificationStatusLabels[item.status]||'Desconocido';
    return '<tr><td><strong>#'+safe(supportShortId(item.ticket_id))+'</strong></td>'+
      '<td class="notification-subject"><strong>'+safe(item.restaurant_name||'Restaurante')+'</strong>'+safe(item.subject||'Sin asunto')+'</td>'+
      '<td><span class="notify-pill '+notificationClass(item.status)+'">'+safe(display)+'</span></td>'+
      '<td>'+safe(Math.max(0,Number(item.attempts)||0))+'</td>'+
      '<td>'+safe(supportStamp(item.created_at))+'</td>'+
      '<td><button type="button" class="secondary small" data-notification-open="'+safe(item.ticket_id)+'">Ver ticket</button></td></tr>';
  }).join('')||emptyRow(6,filter==='all'?'No existen notificaciones registradas.':'No hay avisos con ese estado en los últimos 50.');
}
async function loadOwnerNotifications(){
  const version=++ownerNotificationVersion;
  if(!canViewNotifications())return;
  $('ownerNotificationsStatus').textContent='Consultando notificaciones…';
  try{
    const data=await call('turnia_owner_support_notification_overview');
    if(version!==ownerNotificationVersion || !canViewNotifications())return;
    const stats=data?.totals||{};
    $('ownerNotificationsSent').textContent=Number(stats.sent)||0;
    $('ownerNotificationsPending').textContent=Number(stats.pending)||0;
    $('ownerNotificationsFailed').textContent=Number(stats.failed)||0;
    ownerNotificationItems=Array.isArray(data?.recent)?data.recent:[];
    renderOwnerNotifications();
    $('ownerNotificationsStatus').textContent='Últimos '+ownerNotificationItems.length+' avisos · '+(Number(stats.total)||0)+' en el historial. Actualizado: '+supportStamp(new Date().toISOString())+'.';
  }catch(e){
    if(version===ownerNotificationVersion && canViewNotifications()){
      $('ownerNotificationsStatus').textContent='No se pudieron consultar las notificaciones. Intenta actualizar.';
      $('ownerNotificationsRows').innerHTML=emptyRow(6,'No se pudo recuperar el historial.');
    }
  }
}
bind('refreshOwnerNotifications',loadOwnerNotifications);
$('ownerNotificationsFilter').addEventListener('change',renderOwnerNotifications);
$('ownerNotificationsPanel').addEventListener('click',event=>{
  const button=event.target.closest('[data-notification-open]');
  if(!button)return;
  void guard(async()=>{
    if(!canViewNotifications())throw Error('Solo la cuenta propietaria autorizada puede consultar notificaciones.');
    const ticketId=button.dataset.notificationOpen;
    if(!ownerSupportTickets.some(t=>t.id===ticketId))await loadOwnerSupport();
    if(!ownerSupportTickets.some(t=>t.id===ticketId))throw Error('No se encontró el ticket. Actualiza las solicitudes de soporte.');
    await openSupportTicket(ticketId);
  },button);
});
async function loadOwnerSupport() {
  const version=++ownerSupportVersion;
  if (!context?.platform_admin) return;
  $('ownerSupportStatus').textContent='Cargando reportes…';
  try {
    const response=await sb.from('turnia_support_tickets').select('*');
    const list=check(response)||[];
    if (version!==ownerSupportVersion || !context?.platform_admin)return;
    ownerSupportTickets=list.slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
    $('ownerSupportTickets').innerHTML=ownerSupportTickets.map(t=>supportCard(t,true)).join('')||'<p class="muted">Todavía no hay solicitudes de soporte.</p>';
    $('ownerSupportStatus').textContent=ownerSupportTickets.filter(t=>t.status!=='resuelto').length+' solicitudes pendientes o en revisión · '+ownerSupportTickets.length+' totales.';
  }catch(e){if(version===ownerSupportVersion)$('ownerSupportStatus').textContent='No se pudo cargar soporte: '+errorText(e);}
}
async function openSupportTicket(id){
  const ticket=[...supportTickets,...ownerSupportTickets].find(t=>t.id===id);
  if(!ticket)throw Error('Actualiza la lista de solicitudes.');
  selectedSupportTicket=ticket;
  const messages=check(await sb.from('turnia_support_messages').select('*').eq('ticket_id',id))||[];
  if(selectedSupportTicket?.id!==id)return;
  // Always switch to the support tab so owner can answer tickets for any restaurant.
  tab='support';
  document.querySelectorAll('.tab').forEach(el=>el.classList.toggle('hide',el.id!=='support'));
  document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tab==='support'));
  $('currentSection').textContent='Ayuda y soporte';
  $('supportThread').classList.remove('hide');
  $('supportThreadTitle').textContent='#'+supportShortId(ticket.id)+' · '+ticket.subject;
  $('supportThreadMeta').textContent=(supportCategoryLabels[ticket.category]||'Consulta')+' · '+(supportStatusLabels[ticket.status]||ticket.status)+' · '+supportStamp(ticket.created_at);
  const firstMessage = '<div class="support-message support-original"><small>Solicitud original · '+safe(supportStamp(ticket.created_at))+'</small><p>'+safe(ticket.description).replace(/\n/g,'<br>')+'</p></div>';
  const replies = messages.slice().sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))).map(m=>
    '<div class="support-message"><small>'+safe(m.author_id===user?.id?'Tú':m.author_id===ticket.created_by?'Solicitante':'Equipo de Turnia')+' · '+safe(supportStamp(m.created_at))+'</small><p>'+safe(m.body).replace(/\n/g,'<br>')+'</p></div>'
  ).join('');
  $('supportThreadMessages').innerHTML = firstMessage + (replies || '<p class="muted">Aún no hay respuestas. Puedes escribir la primera.</p>');
  $('supportStatusControls').classList.toggle('hide',!context?.platform_admin);
  $('supportStatusSelect').value=ticket.status;
  $('supportReply').value='';$('supportReplyStatus').textContent='';
  $('supportThread').scrollIntoView?.({behavior:'smooth',block:'start'});
}
bind('sendSupportTicket',async()=>{
  if(!rid)throw Error('Selecciona tu restaurante.');
  const category=$('supportCategory').value,subject=$('supportSubject').value.trim(),description=$('supportDescription').value.trim();
  if(subject.length<4||subject.length>150)throw Error('El asunto debe tener entre 4 y 150 caracteres.');
  if(description.length<10||description.length>5000)throw Error('Describe tu solicitud con al menos 10 caracteres.');
  const restaurantId=rid;
  const result=check(await sb.from('turnia_support_tickets').insert({
    restaurant_id:restaurantId,created_by:user.id,category,subject,description,status:'pendiente'
  }).select('id').single());
  // Commit the ticket first. Email failure must never roll back the support request.
  const stillHere=restaurantId===rid;
  if(stillHere){
    $('supportSubject').value='';$('supportDescription').value='';
    $('supportComposeStatus').textContent='Solicitud #'+supportShortId(result.id)+' registrada. Verificando aviso por correo…';
  }
  let emailNote='Aviso por correo pendiente de configuración.';
  try {
    if(sb.functions?.invoke){
      const notified=await sb.functions.invoke('turnia-support-notify',{body:{ticket_id:result.id}});
      if(!notified.error){
        if(notified.data?.status==='accepted_by_provider') emailNote='Aviso aceptado por el servicio de correo.';
        else if(notified.data?.status==='already_sent') emailNote='Aviso por correo registrado previamente.';
        else if(notified.data?.status==='processing') emailNote='Aviso por correo en proceso.';
        else if(notified.data?.status==='retry_later') emailNote='Aviso por correo pendiente de reintento.';
      } else emailNote='No fue posible confirmar el aviso por correo; tu solicitud sí quedó guardada.';
    }
  } catch { emailNote='No fue posible confirmar el aviso por correo; tu solicitud sí quedó guardada.'; }
  // Ignore stale UI updates when the user switches restaurants while a request is in flight.
  if(restaurantId!==rid)return;
  $('supportComposeStatus').textContent='Solicitud #'+supportShortId(result.id)+' registrada. '+emailNote;
  await loadSupport();
});
bind('refreshSupport',loadSupport);
bind('refreshOwnerSupport',loadOwnerSupport);
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-support-open]');
  if(button)void guard(()=>openSupportTicket(button.dataset.supportOpen),button);
});
bind('sendSupportReply',async()=>{
  if(!selectedSupportTicket)throw Error('Abre una solicitud para responder.');
  const body=$('supportReply').value.trim(),ticketId=selectedSupportTicket.id;
  if(body.length<1||body.length>5000)throw Error('La respuesta debe contener entre 1 y 5000 caracteres.');
  check(await sb.from('turnia_support_messages').insert({ticket_id:ticketId,author_id:user.id,body}));
  $('supportReplyStatus').textContent='Respuesta enviada.';
  await openSupportTicket(ticketId);
  $('supportReplyStatus').textContent='Respuesta enviada.';
});
bind('saveSupportStatus',async()=>{
  if(!context?.platform_admin)throw Error('Solo el propietario de Turnia puede actualizar estados.');
  if(!selectedSupportTicket)throw Error('Abre una solicitud.');
  const id=selectedSupportTicket.id,status=$('supportStatusSelect').value;
  if(!Object.hasOwn(supportStatusLabels,status))throw Error('Estado inválido.');
  check(await sb.from('turnia_support_tickets').update({status}).eq('id',id).select('id').single());
  selectedSupportTicket.status=status;
  $('supportThreadMeta').textContent=(supportCategoryLabels[selectedSupportTicket.category]||'Consulta')+' · '+supportStatusLabels[status]+' · '+supportStamp(selectedSupportTicket.created_at);
  $('supportReplyStatus').textContent='Estado guardado.';
  await loadOwnerSupport();
});

document.addEventListener('click', e => {
  const el = e.target.closest('[data-tab],[data-go]'); if (el) setTab(el.dataset.tab || el.dataset.go);
});
$('menuToggle').onclick = () => { $('drawer').classList.add('open'); $('drawerBackdrop').classList.add('open'); $('menuToggle').setAttribute('aria-expanded','true'); $('drawerClose').focus(); };
$('drawerClose').onclick = () => closeDrawer(true); $('drawerBackdrop').onclick = () => closeDrawer(true);
document.addEventListener('keydown', e => {
  if (!$('drawer').classList.contains('open')) return;
  if (e.key === 'Escape') closeDrawer(true);
  if (e.key === 'Tab') {
    const focusable = [...$('drawer').querySelectorAll('button:not(.hide):not(:disabled)')].filter(el => el.offsetParent !== null);
    const first = focusable[0], last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }
});
sb.auth.onAuthStateChange(event => {
  if (event === 'PASSWORD_RECOVERY') {
    recoveryMode = true; $('auth').classList.add('hide'); $('app').classList.add('hide'); $('loading').classList.add('hide'); $('recovery').classList.remove('hide');
  }
  if (event === 'SIGNED_OUT') {
    teamSpace=false;
    $('restaurantSetup').classList.add('hide'); $('inviteActivation').classList.add('hide');
    authVersion++; teamVersion++; platformVersion++; supportVersion++; ownerSupportVersion++; ownerNotificationVersion++; notificationsAuthorized=false; tab='home'; selectedSupportTicket=null; supportTickets=[]; ownerSupportTickets=[]; ownerNotificationItems=[];
    platformRestaurants = []; platformInvitations = [];
    $('platformRestaurants').innerHTML = ''; $('platformInvitations').innerHTML = '';
    ['accountDisplayName','accountPhone','accountEmailReadonly','restaurantEditName','currentAccountPassword','nextAccountPassword','nextAccountPasswordConfirm','newPassword','confirmPassword'].forEach(id => { $(id).value = ''; });
    $('testPasswordLogin').classList.add('hide'); $('settingsStatus').classList.add('hide');
    context = null; user = null; rid = ''; loadVersion++; recoveryMode = false; loadingData = false;
    resetData(); $('app').classList.add('hide'); $('pendingRegistration').classList.add('hide'); $('recovery').classList.add('hide'); $('auth').classList.remove('hide');
  }
});
$('date').value = today(); $('flexDate').value = today(); $('payoutDate').value = today(); setTab('home');
guard(async () => { try { await init(); } finally { $('loading').classList.add('hide'); if (!context) $('auth').classList.remove('hide'); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
})();
