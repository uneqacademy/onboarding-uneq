/* ============================================================
   subdirectora.js — cuentas de Sub-directora (solo las gestiona el Director, en Configuración).
   Rol "subdirectora" en usuarios/{uid}/roles: ve y hace todo lo del Director, salvo Pagos,
   contratos (acuerdo de pago y firma) y Configuración. La restricción visual vive en main.js
   (clase es-subdirectora) y las reglas de Firebase impiden que escriba pagos y configuración.
   ============================================================ */
import { db, auth, firebaseConfig } from './firebase-config.js';
import { escaparHtml } from './util-html.js';
import { getCurrentRole, esSubdirectora } from './main.js';
import { ref, get, set, update } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut as signOutSecundaria, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

function generarPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const azar = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(azar, n => chars[n % chars.length]).join('');
}

async function pintar() {
  const cont = document.getElementById('panel-subdirectora');
  if (!cont) return;
  if (getCurrentRole() !== 'director' || esSubdirectora()) { cont.classList.add('hidden'); return; }
  cont.classList.remove('hidden');

  let usuarios = {};
  try {
    const snap = await get(ref(db, 'usuarios'));
    usuarios = snap.exists() ? snap.val() : {};
  } catch (err) { console.error('No se pudieron leer las cuentas:', err); }
  const subs = Object.entries(usuarios).filter(([, u]) => u && u.roles && u.roles.subdirectora === true);

  cont.innerHTML = `
    <div class="panel__header"><h3>Sub-directora</h3></div>
    <div class="panel__body">
      <p class="text-soft" style="margin:0 0 12px; font-size:13px;">Ve y puede hacer todo lo del Director, <strong>excepto</strong> Pagos, contratos (acuerdo de pago y firma) y Configuración.</p>
      <div id="subdir-lista">
        ${subs.length ? subs.map(([uid, u]) => `
          <div class="flex-between" style="padding:8px 0; border-bottom:1px solid #EEF0F4; gap:8px; flex-wrap:wrap;">
            <div><strong>${escaparHtml(u.nombre || '—')}</strong> <span class="text-soft">· ${escaparHtml(u.email || '')}</span>
              ${u.activo === false ? '<span class="badge" style="margin-left:6px;">Desactivada</span>' : ''}</div>
            <div style="display:flex; gap:6px;">
              <button class="btn btn--ghost subdir-reset" data-email="${escaparHtml(u.email || '')}" style="font-size:12px; padding:4px 10px;">Enviar correo de contraseña</button>
              <button class="btn btn--ghost subdir-activo" data-uid="${escaparHtml(uid)}" data-activo="${u.activo === false ? '1' : '0'}" style="font-size:12px; padding:4px 10px;">${u.activo === false ? 'Reactivar' : 'Desactivar'}</button>
            </div>
          </div>`).join('') : '<p class="text-soft" style="margin:0 0 12px;">Todavía no hay una Sub-directora.</p>'}
      </div>
      <div class="field-grid" style="margin-top:14px;">
        <div class="field"><label>Nombre</label><input id="subdir-nombre" placeholder="Nombre y apellido"></div>
        <div class="field"><label>Correo</label><input id="subdir-email" type="email" placeholder="correo@ejemplo.com"></div>
      </div>
      <p id="subdir-error" class="hidden" style="color:#C0392B; font-size:13px; margin:6px 0;"></p>
      <button class="btn btn--primary" id="subdir-crear">Crear cuenta de Sub-directora</button>
      <div id="subdir-creada" class="hidden" style="margin-top:12px; padding:12px; background:#F7F8FA; border-radius:10px; font-size:13px;"></div>
    </div>`;

  cont.querySelectorAll('.subdir-reset').forEach(b => b.addEventListener('click', async () => {
    try { await sendPasswordResetEmail(auth, b.dataset.email); alert(`Listo: se envió a ${b.dataset.email} un correo para elegir su contraseña.`); }
    catch (err) { alert('No se pudo enviar el correo. Revisa que el correo esté bien escrito.'); }
  }));
  cont.querySelectorAll('.subdir-activo').forEach(b => b.addEventListener('click', async () => {
    await update(ref(db, `usuarios/${b.dataset.uid}`), { activo: b.dataset.activo === '1' });
    pintar();
  }));
  cont.querySelector('#subdir-crear').addEventListener('click', crear);
}

async function crear(ev) {
  const btn = ev.currentTarget;
  const errorEl = document.getElementById('subdir-error');
  errorEl.classList.add('hidden');
  const nombre = document.getElementById('subdir-nombre').value.trim();
  const email = document.getElementById('subdir-email').value.trim();
  if (!nombre || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorEl.textContent = 'Completa el nombre y un correo válido.'; errorEl.classList.remove('hidden'); return;
  }
  btn.disabled = true; btn.textContent = 'Creando…';
  try {
    const snap = await get(ref(db, 'usuarios'));
    const usuarios = snap.exists() ? snap.val() : {};
    const existente = Object.entries(usuarios).find(([, u]) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (existente) {
      const [uid, datos] = existente;
      const roles = { ...(datos.roles || (datos.rol ? { [datos.rol]: true } : {})), subdirectora: true };
      await update(ref(db, `usuarios/${uid}`), { roles, rol: null, activo: true });
      alert(`${datos.nombre || email} ya tenía una cuenta: se le agregó el rol de Sub-directora a la misma cuenta, sin contraseña nueva.`);
      pintar();
      return;
    }
    const password = generarPassword();
    let secundaria = null;
    try {
      secundaria = initializeApp(firebaseConfig, 'crear-subdir-' + Date.now());
      const authSec = getAuth(secundaria);
      const cred = await createUserWithEmailAndPassword(authSec, email, password);
      await signOutSecundaria(authSec);
      await set(ref(db, `usuarios/${cred.user.uid}`), { nombre, email, roles: { subdirectora: true }, activo: true });
    } finally { if (secundaria) await deleteApp(secundaria); }
    await pintar();
    const caja = document.getElementById('subdir-creada');
    caja.innerHTML = `Cuenta creada. Compártele estos datos (la contraseña no se vuelve a mostrar):<br><strong>Correo:</strong> ${escaparHtml(email)}<br><strong>Contraseña:</strong> <code>${escaparHtml(password)}</code>`;
    caja.classList.remove('hidden');
  } catch (err) {
    console.error('No se pudo crear la Sub-directora:', err);
    errorEl.textContent = err.code === 'auth/email-already-in-use' ? 'Ese correo ya tiene una cuenta creada.' : 'No se pudo crear la cuenta. Intenta de nuevo.';
    errorEl.classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Crear cuenta de Sub-directora';
  }
}

document.querySelector('.nav-item[data-nav="configuracion"]')?.addEventListener('click', pintar);
