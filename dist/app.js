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
let membershipContext = [], tab = 'home', loadingData = false, loadVersion = 0, recoveryMode = false;
let guideIndex = 0, guideDone = false;
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
const roleLabel = role => ({owner:'Propietario del local',admin:'Administrador del local',viewer:'Solo consulta'}[role] || 'Cliente');
const titles = {home:'Inicio',daily:'Registrar día',distribution:'Reparto',history:'Historial',staff:'Equipo y áreas',access:'Accesos y ajustes',owner:'Panel de propietario',guide:'Guía de uso'};
function msg(text = '', tone = 'info') {
  const target = recoveryMode ? $('recoveryMessage') : context ? $('message') : $('authMessage');
  target.textContent = text;
  target.className = 'notice ' + tone;
}
function errorText(e) {
  const message = e?.message || String(e);
  if (/Invalid login credentials/i.test(message)) return 'El correo o la contraseña no coinciden. Revísalos e inténtalo de nuevo.';
  if (/Email not confirmed/i.test(message)) return 'Confirma tu correo antes de iniciar sesión.';
  if (/Failed to fetch|NetworkError/i.test(message)) return 'No pudimos conectar. Revisa tu internet e inténtalo de nuevo.';
  return message;
}
async function guard(fn, button) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  msg();
  try { await fn(); } catch (e) { msg(errorText(e), 'error'); }
  finally { if (button) button.disabled = false; updatePermissions(); }
}
function bind(id, fn) { $(id).addEventListener('click', () => guard(fn, $(id))); }
function requireEdit() { if (!canEdit() || loadingData) throw Error('Selecciona un restaurante autorizado para realizar cambios.'); }
function closeDrawer(restoreFocus = false) {
  $('drawer').classList.remove('open'); $('drawerBackdrop').classList.remove('open');
  $('menuToggle').setAttribute('aria-expanded','false');
  if (restoreFocus) $('menuToggle').focus();
}
function setTab(name) {
  if (!titles[name] || name === 'owner' && !context?.platform_admin) return;
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
}
function updatePermissions() {
  const editing = canEdit() && !loadingData;
  document.querySelectorAll('.edit-only').forEach(el => el.classList.toggle('hide', !canEdit()));
  ['saveDay','addArea','addWorker','amount','shiftHours'].forEach(id => $(id).disabled = !editing);
  $('createRestaurantPanel').classList.toggle('hide', !context?.can_create);
  $('staffInvitePanel').classList.toggle('hide', !canInvite());
  $('ownerNav').classList.toggle('hide', !context?.platform_admin);
  $('adminPanel').classList.toggle('hide', !context?.platform_admin);
  document.querySelectorAll('[data-present],[data-hours],[data-pct],[data-update-area],[data-toggle-worker]').forEach(el => el.disabled = !editing);
}
function resetData() {
  areas = []; workers = []; days = []; shifts = []; payouts = []; membershipContext = [];
  $('inviteResult').textContent = ''; $('staffInviteResult').textContent = '';
  $('historyFrom').value = ''; $('historyTo').value = '';
  render(); renderMembershipCard(null);
}
async function init() {
  const result = check(await sb.auth.getSession());
  user = result.session?.user || null;
  if (!user) {
    context = null; rid = ''; loadVersion++; resetData();
    $('app').classList.add('hide'); $('pendingRegistration').classList.add('hide'); $('auth').classList.remove('hide'); $('loading').classList.add('hide');
    return;
  }
  context = await call('propina_account_context');
  // A newly registered customer never enters the operations dashboard unless
  // the server has granted restaurant access after validating the payment.
  // User metadata is only a UX hint; actual authorization stays in Supabase RLS.
  if (user.user_metadata?.turnia_registration === 'v1' && !(context.restaurants || []).length) {
    let registration = null;
    try { registration = await call('turnia_registration_status'); } catch {
      // Fail closed even if the status endpoint is unavailable.
    }
    $('pendingRestaurant').textContent = registration?.restaurant_name || 'Tu restaurante';
    $('pendingNotice').textContent = registration?.status === 'cancelled'
      ? 'Este registro fue cancelado. Contacta con soporte.'
      : 'Cuenta pendiente de activación. Los cobros siguen desactivados.';
    $('app').classList.add('hide');
    $('auth').classList.add('hide');
    $('loading').classList.add('hide');
    $('pendingRegistration').classList.remove('hide');
    return;
  }
  $('pendingRegistration').classList.add('hide');
  const list = context.restaurants || [];
  rid = list.some(r => r.id === rid) ? rid : list[0]?.id || '';
  $('restaurant').innerHTML = list.length ? list.map(r => `<option value="${safe(r.id)}">${safe(r.name)}</option>`).join('') : '<option value="">Sin restaurante autorizado</option>';
  $('restaurant').value = rid;
  $('account').textContent = user.email;
  const name = context.display_name || user.email;
  $('profileName').textContent = name;
  $('profileRole').textContent = context.platform_admin ? 'Propietario de Turnia' : roleLabel(currentRestaurant()?.role);
  $('avatar').textContent = name.split(/\s+/).slice(0,2).map(s => s[0]).join('').toUpperCase();
  $('greeting').textContent = context.platform_admin ? 'Hola, Nicolás.' : 'Tu equipo. Cada turno.';
  $('todayLabel').textContent = new Date().toLocaleDateString('es-CL', {weekday:'long',day:'numeric',month:'long'});
  $('auth').classList.add('hide'); $('loading').classList.add('hide');
  $('app').classList.toggle('hide', recoveryMode);
  updatePermissions();
  readGuideProgress();
  if (rid) await load(); else resetData();
  if (!rid) {
    setTab('access');
    msg(context.can_create ? 'Tu acceso está aprobado. Crea tu restaurante para comenzar.' : 'Activa tu código de invitación para entrar al restaurante autorizado.');
  }
  if (!guideDone && !context.platform_admin && (rid || context.can_create)) setTab('guide');
}
async function load() {
  if (!rid) { resetData(); return; }
  const version = ++loadVersion, selectedId = rid;
  loadingData = true; updatePermissions();
  try {
    const data = await Promise.all(['propina_areas','propina_workers','propina_days','propina_shifts','propina_daily_distribution'].map(t => query(t, selectedId)));
    if (version !== loadVersion || selectedId !== rid) return;
    [areas,workers,days,shifts,payouts] = data;
    areas.sort((a,b) => a.name.localeCompare(b.name,'es'));
    workers.sort((a,b) => a.name.localeCompare(b.name,'es'));
    days.sort((a,b) => b.work_date.localeCompare(a.work_date));
    render();
    await loadMembershipContext(version, selectedId);
  } finally { if (version === loadVersion) { loadingData = false; updatePermissions(); } }
}
function render() {
  renderStaff(); renderDay(); renderHistory(); renderPayouts(); renderHome(); updatePermissions();
}
function renderStaff() {
  const total = areas.reduce((n,a) => n + Number(a.percentage), 0), correct = Math.abs(total-100) < .0001;
  $('pctStatus').textContent = `Total asignado: ${total.toLocaleString('es-CL')}% / 100%. ` + (correct ? 'Todo listo para repartir.' : 'Ajusta los porcentajes hasta sumar 100%.');
  $('pctStatus').className = 'notice spaced ' + (correct ? 'success' : 'info');
  $('areas').innerHTML = areas.map(a => `<tr><td>${safe(a.name)}</td><td>${canEdit() ? `<input aria-label="Porcentaje de ${safe(a.name)}" data-pct="${safe(a.id)}" type="number" min="0" max="100" step="0.01" value="${Number(a.percentage)}">` : `${Number(a.percentage)}%`}</td><td>${canEdit() ? `<button class="secondary small" data-update-area="${safe(a.id)}">Guardar</button>` : ''}</td></tr>`).join('') || emptyRow(3,'<strong>Comienza con tus áreas</strong>Agrega, por ejemplo, Garzones, Cocina y Barra.');
  $('workerArea').innerHTML = areas.map(a => `<option value="${safe(a.id)}">${safe(a.name)}</option>`).join('') || '<option value="">Primero agrega un área</option>';
  $('workers').innerHTML = workers.map(w => `<tr><td>${safe(w.name)}</td><td>${safe(areas.find(a => a.id === w.area_id)?.name || '—')}</td><td><span class="badge ${w.active ? '' : 'gray'}">${w.active ? 'Activo' : 'Inactivo'}</span></td><td>${canEdit() ? `<button class="ghost small" data-toggle-worker="${safe(w.id)}">${w.active ? 'Desactivar' : 'Reactivar'}</button>` : ''}</td></tr>`).join('') || emptyRow(4,'<strong>Aún no hay personas en tu equipo</strong>Agrega su nombre y el área donde trabajan.');
}
function renderDay() {
  const current = days.find(d => d.work_date === $('date').value);
  $('amount').value = current ? current.amount_clp : '';
  $('shiftHours').value = current?.hours_per_shift || $('shiftHours').value || 8;
  $('dayState').textContent = current ? 'Jornada guardada' : 'Nueva jornada';
  $('attendance').innerHTML = workers.filter(w => w.active || current && shifts.some(s => s.day_id === current.id && s.worker_id === w.id)).map(w => {
    const shift = current ? shifts.find(s => s.day_id === current.id && s.worker_id === w.id) : null;
    return `<tr><td><input type="checkbox" aria-label="${safe(w.name)} trabajó" data-present="${safe(w.id)}" ${shift ? 'checked' : ''}></td><td>${safe(w.name)}</td><td>${safe(areas.find(a => a.id === w.area_id)?.name || '—')}</td><td><input aria-label="Horas de ${safe(w.name)}" type="number" data-hours="${safe(w.id)}" min="0.5" max="24" step="0.5" value="${Number(shift?.hours || $('shiftHours').value || 8)}"></td></tr>`;
  }).join('') || emptyRow(4,'Agrega trabajadores en Equipo y áreas para registrar una jornada.');
  renderAttendanceCount(); updatePermissions();
}
function renderAttendanceCount() {
  const rows = [...document.querySelectorAll('[data-present]:checked')];
  const hours = rows.reduce((sum,el) => sum + Number(document.querySelector(`[data-hours="${el.dataset.present}"]`).value || 0), 0);
  $('attendanceCount').textContent = `${rows.length} persona(s) presente(s) · ${hours.toLocaleString('es-CL')} horas en total`;
}
function renderPayouts() {
  const day = days.find(d => d.work_date === $('payoutDate').value);
  const data = day ? payouts.filter(p => p.day_id === day.id) : [];
  const assigned = data.reduce((n,p) => n + Number(p.calculated_clp), 0);
  $('summary').innerHTML = day ? `<div><small>Total de la jornada</small><strong>${clp(day.amount_clp)}</strong></div><div><small>Distribuido</small><strong>${clp(assigned)}</strong></div><div><small>Sin asignar</small><strong>${clp(Number(day.amount_clp)-assigned)}</strong></div>` : '<p class="muted" style="margin:0">Todavía no hay una jornada guardada para esta fecha.</p>';
  $('payouts').innerHTML = data.map(p => `<tr><td>${safe(p.worker_name)}</td><td>${safe(p.area_name)}</td><td>${Number(p.hours)}</td><td class="money">${clp(p.calculated_clp)}</td></tr>`).join('') || emptyRow(4,'Registra una jornada o selecciona otra fecha para ver su reparto.');
  $('editDay').disabled = !day;
}
function visibleDays() {
  const from = $('historyFrom').value, to = $('historyTo').value;
  return days.filter(d => (!from || d.work_date >= from) && (!to || d.work_date <= to));
}
function renderHistory() {
  const data = visibleDays();
  $('historyRows').innerHTML = data.map(d => `<tr><td>${safe(dateLabel(d.work_date))}</td><td class="money">${clp(d.amount_clp)}</td><td class="money">${clp(payouts.filter(p => p.day_id === d.id).reduce((n,p) => n + Number(p.calculated_clp),0))}</td><td><button class="ghost small" data-open-date="${safe(d.work_date)}">Ver reparto →</button></td></tr>`).join('') || emptyRow(4,'No hay jornadas registradas en este período.');
  const invalid = $('historyFrom').value && $('historyTo').value && $('historyFrom').value > $('historyTo').value;
  $('historySummary').textContent = invalid ? 'La fecha inicial debe ser anterior a la fecha final.' : `${data.length} jornada(s) · ${clp(data.reduce((n,d) => n + Number(d.amount_clp),0))} en propinas`;
  $('export').disabled = !data.length;
}
function renderHome() {
  const month = today().slice(0,7), monthDays = days.filter(d => d.work_date.startsWith(month));
  $('monthTotal').textContent = clp(monthDays.reduce((n,d) => n + Number(d.amount_clp),0));
  $('monthDays').textContent = monthDays.length;
  $('activeWorkers').textContent = workers.filter(w => w.active).length;
  $('monthLabel').textContent = new Date().toLocaleDateString('es-CL',{month:'long',year:'numeric'});
  $('recentDays').innerHTML = days.slice(0,4).map(d => `<tr><td>${safe(dateLabel(d.work_date))}</td><td class="money">${clp(d.amount_clp)}</td><td><button class="ghost small" data-open-date="${safe(d.work_date)}" aria-label="Ver reparto del ${safe(dateLabel(d.work_date))}">→</button></td></tr>`).join('') || emptyRow(3,'<strong>Tu próxima jornada empieza aquí</strong>Cuando guardes un día, lo encontrarás en este espacio.');
}
function renderMembershipCard(item) {
  if (!item) { $('membershipCard').innerHTML = '<h2>Membresía del restaurante</h2><p class="muted">' + (rid ? 'No hay información de membresía disponible para este local.' : 'Selecciona o crea un restaurante para consultar su acceso.') + '</p><span class="badge gray">Cobros desactivados</span>'; return; }
  const labels = {active:'Membresía activa',expiring:'Próxima a vencer',expired:'Membresía vencida',payment_pending:'Pendiente de habilitación'};
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
const guideSteps = [
  ['Activa tu acceso','Tu invitación es el punto de partida.', ['Usa el correo que Nicolás Valencia autorizó e ingresa el código en «Tengo una invitación».','Confirma el correo de registro e inicia sesión.','En Accesos y ajustes, pega el código y pulsa «Activar acceso y ver la guía».'], 'La autorización es individual. No compartas tu contraseña ni publiques tu código.', 'access'],
  ['Prepara tu restaurante','Cada local tiene su propio espacio.', ['Si eres propietario autorizado, crea tu local en Accesos y ajustes.','Si te invitaron como colaborador, el local aparecerá en el selector superior.','Cuando tengas más de un local, comprueba cuál está seleccionado antes de registrar.'], 'Si ya existe tu restaurante, selecciónalo para continuar.', 'access'],
  ['Define áreas y porcentajes','La suma debe ser exactamente 100%.', ['En Equipo y áreas, agrega los grupos que reciben propina.','Indica el porcentaje de cada área según el acuerdo de tu equipo.','Revisa el total y guarda cada cambio de porcentaje.'], 'Ejemplo: Garzones 60% + Cocina 25% + Barra 10% + Coperos 5% = 100%.', 'staff'],
  ['Agrega a tu equipo','Una persona, su nombre y su área.', ['Ingresa cada trabajador en Equipo y áreas.','Asigna el área correcta antes de agregarlo.','Desactiva a quienes ya no trabajan contigo; su historial se conserva.'], 'No necesitas crear una cuenta de acceso para cada persona que participa del reparto.', 'staff'],
  ['Elige la fecha y el turno','Registra el día en que se generaron las propinas.', ['Abre Registrar día y selecciona la fecha.','Define cuántas horas tiene un turno normal en tu restaurante.','Si ya existe una jornada en esa fecha, verás sus datos guardados.'], 'Con turnos de 8 horas: 8 h = 1 turno; 12 h = 1,5; 16 h = 2.', 'daily'],
  ['Ingresa las propinas','Usa el total del día en pesos chilenos.', ['Reúne el total de propinas que se va a distribuir.','Ingresa pesos completos, sin puntos ni decimales.','Comprueba la fecha y el monto antes de continuar.'], 'Para $200.000 escribe 200000. Se repartirá según los porcentajes de tus áreas.', 'daily'],
  ['Marca quién trabajó','El reparto de cada área depende de las horas.', ['Selecciona solamente a las personas que trabajaron ese día.','Anota las horas reales de cada una.','Cada área con porcentaje positivo necesita una persona presente. Si falta un área, revisa el acuerdo del equipo antes de ajustar.'], 'En una misma área, quien trabajó 12 h recibe 1,5 veces lo de alguien que trabajó 8 h.', 'daily'],
  ['Guarda y revisa el reparto','Comprueba el resultado antes de entregarlo.', ['Pulsa Guardar jornada y calcular.','En Reparto verás cuánto corresponde a cada persona.','Compara el total con lo distribuido. Si necesitas corregir una jornada existente, revisa los datos antes de confirmar su reemplazo.'], 'Revisa también el valor «Sin asignar». Todos los montos se muestran en CLP.', 'distribution'],
  ['Consulta y exporta','El historial te ayuda a cerrar cada semana.', ['En Historial, usa Desde y Hasta para elegir un período.','Abre cualquier jornada para consultar su reparto.','Exporta el período como CSV y ábrelo con Excel para revisar o compartir.'], 'La descarga contiene el detalle por persona del restaurante seleccionado.', 'history'],
  ['Administra y vuelve cuando quieras','Tu restaurante ya tiene una rutina clara.', ['Invita administradores o usuarios de consulta desde Accesos, si tienes permiso de propietario.','Consulta ahí la fecha de vencimiento de tu membresía. Los cobros están desactivados.','Esta guía siempre estará en el menú. Al usar un equipo compartido, cierra tu sesión.'], 'Guía completada. Ya puedes registrar tu primera jornada.', 'home']
];
function guideKey() { return user ? `turnia_guide_v1_${user.id}` : ''; }
function readGuideProgress() {
  try { const saved = JSON.parse(storage.get(guideKey()) || '{}'); guideIndex = Math.max(0,Math.min(9,Number(saved.step) || 0)); guideDone = saved.done === true; } catch { guideIndex = 0; guideDone = false; }
  $('onboardingBanner').classList.toggle('hide', guideDone || context?.platform_admin || !(rid || context?.can_create));
  renderGuide();
}
function saveGuideProgress() { if (user) storage.set(guideKey(), JSON.stringify({step:guideIndex,done:guideDone})); }
function renderGuide() {
  const step = guideSteps[guideIndex];
  $('guideProgressText').textContent = guideDone ? 'Completaste la guía. Puedes repasar cualquier paso.' : `Paso ${guideIndex+1} de ${guideSteps.length}`;
  $('guideProgress').style.width = `${guideDone ? 100 : (guideIndex+1)*10}%`;
  $('guideNav').innerHTML = guideSteps.map((s,i) => `<li><button data-guide-step="${i}" class="${i === guideIndex ? 'active' : ''} ${guideDone || i < guideIndex ? 'done' : ''}" ${i === guideIndex ? 'aria-current="step"' : ''}><span>${guideDone || i < guideIndex ? '✓' : i+1}</span>${s[0]}</button></li>`).join('');
  $('guideContent').innerHTML = `<p class="eyebrow">PASO ${String(guideIndex+1).padStart(2,'0')}</p><h2>${step[0]}</h2><p class="muted">${step[1]}</p><ul>${step[2].map(s => `<li>${s}</li>`).join('')}</ul><div class="guide-example">${step[3]}</div><button class="secondary" data-go="${step[4]}">Ir a ${titles[step[4]]} →</button>`;
  $('guidePrev').disabled = guideIndex === 0;
  $('guideNext').textContent = guideIndex === 9 ? 'Terminar guía ✓' : 'Siguiente →';
}
$('guideNav').addEventListener('click', e => { const el = e.target.closest('[data-guide-step]'); if (el) { guideIndex = Number(el.dataset.guideStep); saveGuideProgress(); renderGuide(); } });
$('guidePrev').onclick = () => { if (guideIndex > 0) guideIndex--; saveGuideProgress(); renderGuide(); };
$('guideNext').onclick = () => {
  if (guideIndex < 9) { guideIndex++; saveGuideProgress(); renderGuide(); }
  else { guideDone = true; saveGuideProgress(); $('onboardingBanner').classList.add('hide'); setTab('home'); msg('Guía completada. Puedes volver a consultarla desde el menú.', 'success'); }
};
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
  msg('Revisa tu correo y confirma tu cuenta. Después inicia sesión y activa tu invitación en Accesos y ajustes.','success');
});
bind('forgot', async () => {
  if (!$('email').value || !$('email').checkValidity()) throw Error('Escribe primero tu correo electrónico.');
  check(await sb.auth.resetPasswordForEmail($('email').value.trim(),{redirectTo:location.origin+'/'}));
  msg('Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.','success');
});
bind('savePassword', async () => {
  if ($('newPassword').value.length < 8 || $('newPassword').value !== $('confirmPassword').value) throw Error('Escribe la misma contraseña en ambos campos, con al menos 8 caracteres.');
  check(await sb.auth.updateUser({password:$('newPassword').value}));
  $('newPassword').value = ''; $('confirmPassword').value = ''; recoveryMode = false;
  $('recovery').classList.add('hide'); await init(); msg('Contraseña actualizada.','success');
});
async function logout() {
  check(await sb.auth.signOut()); context = null; user = null; rid = ''; loadVersion++;
  resetData(); closeDrawer(); setTab('home'); $('password').value = ''; $('invite').value = ''; $('acceptToken').value = '';
  $('authMessage').textContent = ''; $('message').textContent = ''; await init();
}
bind('logout', logout);
bind('logoutTop', logout);
bind('pendingLogout', logout);
$('restaurant').onchange = () => guard(async () => {
  rid = $('restaurant').value; loadVersion++; resetData();
  $('profileRole').textContent = context?.platform_admin ? 'Propietario de Turnia' : roleLabel(currentRestaurant()?.role);
  await load();
});
bind('createRestaurant', async () => {
  const name = $('restaurantName').value.trim();
  if (!context?.can_create || !name) throw Error('Escribe el nombre del restaurante para el que tienes autorización.');
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
  const present = [...document.querySelectorAll('[data-present]:checked')].map(el => ({worker_id:el.dataset.present,hours:Number(document.querySelector(`[data-hours="${el.dataset.present}"]`).value)}));
  if (!present.length || present.some(x => !Number.isFinite(x.hours) || x.hours <= 0 || x.hours > 24)) throw Error('Selecciona personal e ingresa horas válidas, entre 0,5 y 24.');
  const presentAreas = new Set(present.map(x => workers.find(w => w.id === x.worker_id)?.area_id));
  if (areas.some(a => Number(a.percentage) > 0 && !presentAreas.has(a.id))) throw Error('Cada área con porcentaje positivo necesita al menos una persona presente.');
  if (days.some(d => d.work_date === date) && !window.confirm('Ya existe una jornada para esta fecha. ¿Guardar estos cambios y recalcular su reparto?')) return;
  await call('propina_save_day',{p_restaurant:rid,p_date:date,p_amount:amount,p_shift_hours:hours_per_shift,p_workers:present});
  $('payoutDate').value = date; await load(); setTab('distribution'); msg('Jornada guardada y reparto calculado.','success');
});
function openPayout(e) {
  const el = e.target.closest('[data-open-date]'); if (!el) return;
  $('payoutDate').value = el.dataset.openDate; renderPayouts(); setTab('distribution');
}
$('historyRows').onclick = openPayout; $('recentDays').onclick = openPayout;
$('historyFrom').onchange = renderHistory; $('historyTo').onchange = renderHistory;
$('clearHistory').onclick = () => { $('historyFrom').value = ''; $('historyTo').value = ''; renderHistory(); };
function csvCell(value) {
  const text = String(value ?? '');
  // Prevent spreadsheet formulas in customer-provided names.
  return '"' + (/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replace(/"/g,'""') + '"';
}
bind('export', async () => {
  const ids = new Set(visibleDays().map(d => d.id));
  const data = payouts.filter(p => ids.has(p.day_id)).sort((a,b) => a.work_date.localeCompare(b.work_date));
  if (!data.length) throw Error('No hay repartos para exportar en este período.');
  const rows = [['Fecha','Restaurante','Trabajador','Área','Horas','Porcentaje área','Propina CLP'],...data.map(p => [p.work_date,currentRestaurant()?.name || '',p.worker_name,p.area_name,p.hours,p.percentage,p.calculated_clp])];
  const csv = '\ufeff' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})), link = document.createElement('a');
  link.href = url; link.download = `turnia_propinas_${today()}.csv`; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000); msg('Archivo CSV descargado. Puedes abrirlo con Excel.','success');
});
function showToken(data, target) {
  $(target).textContent = `Invitación para ${data.email}\nCódigo: ${data.token}\nVence: ${new Date(data.expires_at).toLocaleString('es-CL')}${data.duration_days ? `\nMembresía: ${data.duration_days} días` : ''}\nComparte este código por un canal privado.`;
}
bind('adminInvite', async () => {
  if (!context?.platform_admin) throw Error('Esta acción requiere permisos de propietario de Turnia.');
  const role = $('adminRole').value, email = $('adminEmail').value.trim();
  if (!email || !$('adminEmail').checkValidity()) throw Error('Escribe un correo válido.');
  if (role !== 'restaurant_owner' && !rid) throw Error('Selecciona un restaurante para esta invitación.');
  const data = role === 'restaurant_owner' ? await call('propina_issue_membership_invitation',{invitee_email:email,duration_days:Number($('membershipDuration').value),price_clp:5000}) : await call('propina_issue_invitation',{invitee_email:email,invitee_role:role,rid});
  showToken(data,'inviteResult'); msg('Invitación creada. No se realizó ningún cobro.','success');
});
$('adminRole').onchange = () => { $('membershipDuration').disabled = $('adminRole').value !== 'restaurant_owner'; };
bind('staffInvite', async () => {
  if (!canInvite()) throw Error('Necesitas permiso de propietario del restaurante.');
  if (!$('staffEmail').value || !$('staffEmail').checkValidity()) throw Error('Escribe un correo válido.');
  showToken(await call('propina_issue_staff_invitation',{invitee_email:$('staffEmail').value.trim(),invitee_role:$('staffRole').value,rid}),'staffInviteResult');
});
bind('acceptInvite', async () => {
  const token = $('acceptToken').value.trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Pega el código completo de 64 caracteres.');
  await call('propina_accept_invitation',{token}); $('acceptToken').value = '';
  await init(); guideIndex = 0; guideDone = false; saveGuideProgress(); setTab('guide'); msg('Acceso activado. Bienvenido a Turnia.','success');
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
    context = null; user = null; rid = ''; loadVersion++; recoveryMode = false; loadingData = false;
    resetData(); $('app').classList.add('hide'); $('pendingRegistration').classList.add('hide'); $('recovery').classList.add('hide'); $('auth').classList.remove('hide');
  }
});
$('date').value = today(); $('payoutDate').value = today(); setTab('home');
guard(async () => { try { await init(); } finally { $('loading').classList.add('hide'); if (!context) $('auth').classList.remove('hide'); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
})();
