import {
  dob18,
  esc,
  iconBack,
  iconBell,
  iconCam,
  iconChart,
  iconCheck,
  iconClose,
  iconDownload,
  iconEye,
  iconInvite,
  iconLeave,
  iconSendPlane,
  iconShare,
  iconShield,
  iconUsers,
} from './icons.js';
import {
  buildRoomInviteUrl,
  clearSuiteUser,
  getStoredName,
  loadPrefs,
  savePrefs,
  saveSuiteUser,
} from './identity.js';
import {
  AdminPanelController,
  bindShareSheetEvents,
  renderShareSheetHtml,
} from './sheets.js';

export class LobbyController {
  constructor(mountEl, { user, deferredPrompt, onUserChange, onEnterRoom }) {
    this.mountEl = mountEl;
    this.user = user;
    this.deferredPrompt = deferredPrompt;
    this.onUserChange = onUserChange;
    this.onEnterRoom = onEnterRoom;

    this.screen = user ? 'home' : 'welcome';
    this.sheet = null;
    this.toast = null;
    this.toastTimer = null;
    this.editingName = false;
    this.draftName = '';
    this.logoRefreshing = false;
    this.submitting = false;
    this.adminCtrl = null;
    this.touchStart = null;

    this.form = {
      regName: '',
      regEmail: '',
      regPass: '',
      regPass2: '',
      showRegPass: false,
      showRegPass2: false,
      regDob: '',
      regTerms: false,
      verifyEmail: '',
      verifyCode: '',
      devCodeHint: null,
      deliveredVia: 'dev',
      logEmail: '',
      logPass: '',
      showLogPass: false,
      joinCode: '',
      joinPass: '',
      joinName: user?.name || getStoredName(''),
    };
    this.prefs = loadPrefs();

    this.isIOS =
      typeof navigator !== 'undefined' &&
      (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

    this._renderLayout();
    this._bindGlobalEvents();
    this._validateSession();
  }

  setDeferredPrompt(p) {
    this.deferredPrompt = p;
  }

  _validateSession() {
    if (!this.user?.token) return;
    const token = this.user.token;
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (this._destroyed) return;
        if (res.status === 401) {
          clearSuiteUser();
          this.user = null;
          this.onUserChange(null);
          this.screen = 'welcome';
          this._renderTour();
          return;
        }
        if (res.ok) {
          const json = await res.json();
          if (json.ok && json.user) {
            const refreshed = { ...json.user, token };
            saveSuiteUser(refreshed);
            this.user = refreshed;
            this.form.joinName = refreshed.name;
            this.onUserChange(refreshed);
            if (this.screen === 'home') this._renderTour();
          }
        }
      })
      .catch(() => {});
  }

  showToast(msg) {
    this.toast = msg;
    const toastEl = this.mountEl.querySelector('#lobby-toast');
    if (toastEl) {
      toastEl.textContent = msg;
      toastEl.classList.add('v');
    }
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast = null;
      if (toastEl) toastEl.classList.remove('v');
    }, 2600);
  }

  _handleLobbyRefresh() {
    this.logoRefreshing = true;
    const logos = this.mountEl.querySelectorAll('.tr-logo, .lb-logo');
    logos.forEach((el) => el.classList.add('refreshing'));
    window.setTimeout(() => {
      this.logoRefreshing = false;
      logos.forEach((el) => el.classList.remove('refreshing'));
    }, 480);
    this.showToast('Actualizado');
  }

  async _handleInstall() {
    if (this.deferredPrompt) {
      await this.deferredPrompt.prompt();
      this.deferredPrompt = null;
    } else {
      this._setSheet('install');
    }
  }

  _setScreen(next) {
    this.screen = next;
    this._renderTour();
  }

  _setSheet(next) {
    if (this.adminCtrl) {
      this.adminCtrl.destroy();
      this.adminCtrl = null;
    }
    this.sheet = next;
    this.wrapperEl.classList.toggle('open', Boolean(next));
    this._renderSheet();
  }

  _renderLayout() {
    this.mountEl.innerHTML = `
      <div id="lobby-wrap" class="${this.sheet ? 'open' : ''}">
        <div id="tour" role="dialog" aria-modal="true" aria-label="spaceSUITE"></div>
        <div class="veil" id="lobby-veil"></div>
        <div id="lobby-sheet-slot"></div>
        <div class="toast" id="lobby-toast" role="status" aria-live="polite"></div>
      </div>
    `;
    this.wrapperEl = this.mountEl.querySelector('#lobby-wrap');
    this.tourEl = this.mountEl.querySelector('#tour');
    this.sheetSlot = this.mountEl.querySelector('#lobby-sheet-slot');
    this._renderTour();
    this._renderSheet();
  }

  _renderTour() {
    const sc = this.screen;
    const u = this.user;
    const f = this.form;
    const backBtn =
      sc !== 'welcome' && sc !== 'home'
        ? `<button type="button" class="tr-back-float" data-nav="back">${iconBack()}Atrás</button>`
        : '';

    let body = '';
    if (sc === 'welcome') {
      body = `
        <div class="tr-body">
          <button type="button" class="tlg-btn" style="margin:0 auto 14px;width:132px;height:132px;border-radius:30px" data-act="refresh" aria-label="Actualizar app">
            <img class="tr-logo ${this.logoRefreshing ? 'refreshing' : ''}" style="margin:0" src="/assets/aistudio/logo-app_a1f96350.svg" alt="spaceSUITE" width="132" height="132" />
          </button>
          <div class="tr-wm">space<b>SUITE</b></div>
          <h2>Videollamadas privadas, cara a cara.</h2>
          <p>Salas con tu gente, cifradas y con acceso solo por invitación.</p>
          <p class="tr-s">Solo para mayores de 18 años.</p>
          <button type="button" class="inst" data-act="install">${iconDownload()}Instalar la app<small>Un toque</small></button>
        </div>
        <div class="tr-bar">
          <button type="button" class="tr-b" data-go="reg">Crear cuenta</button>
          <button type="button" class="tr-g" data-go="login">Ya tengo cuenta</button>
          <button type="button" class="tr-k" data-go="code">Entrar con un código de SUITE</button>
        </div>
      `;
    } else if (sc === 'reg') {
      body = `
        <form id="lobby-reg-form" style="display:flex;flex-direction:column;height:100%">
          <div class="tr-body">
            <h2>Crea tu cuenta</h2>
            <p>Validaremos tu correo electrónico antes de activar tu acceso.</p>
            <input type="text" maxlength="24" placeholder="Nombre o alias" data-field="regName" value="${esc(f.regName)}" autocomplete="nickname" />
            <input type="email" maxlength="120" placeholder="Correo electrónico" data-field="regEmail" value="${esc(f.regEmail)}" autocomplete="email" />
            <div class="pw-wrap">
              <input type="${f.showRegPass ? 'text' : 'password'}" maxlength="200" placeholder="Contraseña (8+, con letras y números)" data-field="regPass" value="${esc(f.regPass)}" autocomplete="new-password" />
              <button type="button" class="pw-eye" data-eye="showRegPass" aria-label="${f.showRegPass ? 'Ocultar contraseña' : 'Ver contraseña'}">${iconEye(f.showRegPass)}</button>
            </div>
            <div class="pw-wrap">
              <input type="${f.showRegPass2 ? 'text' : 'password'}" maxlength="200" placeholder="Repite la contraseña" data-field="regPass2" value="${esc(f.regPass2)}" autocomplete="new-password" />
              <button type="button" class="pw-eye" data-eye="showRegPass2" aria-label="${f.showRegPass2 ? 'Ocultar contraseña' : 'Ver contraseña'}">${iconEye(f.showRegPass2)}</button>
            </div>
            <label class="tr-d2">
              <span>Fecha de nacimiento</span>
              <input type="date" max="${dob18()}" data-field="regDob" value="${esc(f.regDob)}" />
            </label>
            <label class="tr-l">
              <input type="checkbox" data-check="regTerms" ${f.regTerms ? 'checked' : ''} />
              <span>Tengo 18 años o más y acepto los términos y el aviso de privacidad</span>
            </label>
          </div>
          <div class="tr-bar">
            <button type="submit" class="tr-b" ${this.submitting ? 'disabled' : ''}>${this.submitting ? 'Enviando código…' : 'Crear mi cuenta'}</button>
            <button type="button" class="tr-g" data-go="welcome">Volver</button>
          </div>
        </form>
      `;
    } else if (sc === 'verify') {
      body = `
        <form id="lobby-verify-form" style="display:flex;flex-direction:column;height:100%">
          <div class="tr-body">
            <h2>Verifica tu correo</h2>
            <p>Enviamos un código de 6 dígitos a <b>${esc(f.verifyEmail)}</b>. Escríbelo para activar tu cuenta.</p>
            ${
              f.deliveredVia === 'dev' && f.devCodeHint
                ? `<div class="verify-banner"><span>Código de verificación:</span><b>${esc(f.devCodeHint)}</b></div>`
                : ''
            }
            <input type="text" inputmode="numeric" maxlength="6" placeholder="Código de 6 dígitos" data-field="verifyCode" value="${esc(f.verifyCode)}" autocomplete="one-time-code" />
            <button type="button" class="tr-k" data-act="resend" ${this.submitting ? 'disabled' : ''}>Reenviar código</button>
          </div>
          <div class="tr-bar">
            <button type="submit" class="tr-b" ${this.submitting ? 'disabled' : ''}>${this.submitting ? 'Verificando…' : 'Confirmar correo'}</button>
            <button type="button" class="tr-g" data-go="reg">Cambiar correo</button>
          </div>
        </form>
      `;
    } else if (sc === 'login') {
      body = `
        <form id="lobby-login-form" style="display:flex;flex-direction:column;height:100%">
          <div class="tr-body">
            <h2>Entrar a tu cuenta</h2>
            <p>Con el correo verificado y la contraseña de tu registro.</p>
            <input type="email" maxlength="120" placeholder="Correo electrónico" data-field="logEmail" value="${esc(f.logEmail)}" autocomplete="email" />
            <div class="pw-wrap">
              <input type="${f.showLogPass ? 'text' : 'password'}" maxlength="200" placeholder="Contraseña" data-field="logPass" value="${esc(f.logPass)}" autocomplete="current-password" />
              <button type="button" class="pw-eye" data-eye="showLogPass" aria-label="${f.showLogPass ? 'Ocultar contraseña' : 'Ver contraseña'}">${iconEye(f.showLogPass)}</button>
            </div>
          </div>
          <div class="tr-bar">
            <button type="submit" class="tr-b" ${this.submitting ? 'disabled' : ''}>${this.submitting ? 'Validando…' : 'Entrar'}</button>
            <button type="button" class="tr-g" data-go="welcome">Volver</button>
          </div>
        </form>
      `;
    } else if (sc === 'home' && u) {
      body = `
        <div class="tr-body">
          <div class="lb-h">
            <button type="button" class="tlg-btn" data-act="refresh" aria-label="Actualizar inicio">
              <img class="lb-logo ${this.logoRefreshing ? 'refreshing' : ''}" src="/assets/aistudio/logo-app_a1f96350.svg" alt="spaceSUITE" width="64" height="64" />
            </button>
            <div>
              <b>Hola, ${esc(u.name)}</b>
              <small>${esc(u.plan)}</small>
            </div>
          </div>
          <div class="lb-tiles">
            <button type="button" class="lb-t g" data-act="new-suite">${iconCam()}<span>Nueva SUITE</span></button>
            <button type="button" class="lb-t" data-go="code">${iconInvite()}<span>Unirse</span></button>
            <button type="button" class="lb-t" data-sheet="invite">${iconSendPlane()}<span>Invitar</span></button>
            ${
              u.role === 'admin'
                ? `<button type="button" class="lb-t" data-sheet="admin">${iconChart()}<span>Panel Admin</span></button>`
                : `<button type="button" class="lb-t" data-go="plans">${iconShield()}<span>Planes</span></button>`
            }
          </div>
          <div class="lb-card">
            <span>Mi SUITE · siempre la misma</span>
            <b>${esc(u.suiteCode)}</b>
            <small>Clave ${esc(u.suitePass)}</small>
            <div class="lb-card-actions">
              <button type="button" data-act="copy-own">Copiar código y clave</button>
              <button type="button" data-sheet="invite">Compartir</button>
            </div>
          </div>
          <button type="button" class="inst" data-act="install">${iconDownload()}Instalar la app<small>Un toque</small></button>
        </div>
        <div class="tr-bar">
          <div class="tr-row2">
            <button type="button" class="tr-k" data-sheet="acct">Mi plan y cuenta</button>
            <button type="button" class="tr-k dg" data-act="logout">Cerrar sesión</button>
          </div>
        </div>
      `;
    } else if (sc === 'code') {
      body = `
        <form id="lobby-code-form" style="display:flex;flex-direction:column;height:100%">
          <div class="tr-body">
            <h2>Entrar a una SUITE</h2>
            <p>Escribe el código y la clave que te compartieron.</p>
            <input type="text" maxlength="24" placeholder="Tu nombre en la sala" data-field="joinName" value="${esc(f.joinName)}" />
            <input type="text" maxlength="24" placeholder="SS-SALA-XXXXXXXXXX" data-field="joinCode" value="${esc(f.joinCode)}" autocapitalize="characters" autocomplete="off" />
            <input type="text" maxlength="8" placeholder="Clave (4 caracteres, opcional)" data-field="joinPass" value="${esc(f.joinPass)}" autocapitalize="characters" autocomplete="off" />
          </div>
          <div class="tr-bar">
            <button type="submit" class="tr-b">Entrar</button>
            <button type="button" class="tr-g" data-go="${u ? 'home' : 'welcome'}">Volver</button>
          </div>
        </form>
      `;
    } else if (sc === 'plans') {
      body = `
        <div class="tr-body">
          <h2>Planes</h2>
          <p>Lanzamiento: 30% de descuento en todos los planes.</p>
          <div class="tr-c tr-hot" data-act="plan-vip" role="button" tabindex="0">
            <em><s>$29</s> <b>$20.30 USD</b> <i class="off">-30%</i> <small>/ semana</small></em>
            <b>VIP</b>
            <span>Salas grupales ilimitadas · sin límite de tiempo · compartir pantalla · 3 timbres y 2 Connect al día.</span>
          </div>
          <details class="tr-more">
            <summary>Más planes: Connect y accesos</summary>
            <div class="tr-row"><span>Connect 14 días · 50 timbres y 30 Connect</span><em>$14.00 USD</em></div>
            <div class="tr-row"><span>Connect 30 días · 150 timbres y 120 Connect</span><em>$24.50 USD</em></div>
            <div class="tr-row"><span>Connect 3 meses · 400 timbres y 300 Connect</span><em>$59.00 USD</em></div>
          </details>
        </div>
        <div class="tr-bar">
          ${!u ? `<button type="button" class="tr-b" data-go="reg">Crear cuenta gratis</button>` : ''}
          <button type="button" class="tr-g" data-go="${u ? 'home' : 'welcome'}">Cerrar</button>
        </div>
      `;
    }

    this.tourEl.innerHTML = `${backBtn}${body}`;
  }

  _renderSheet() {
    this.sheetSlot.innerHTML = '';
    const sh = this.sheet;
    const u = this.user;
    if (!sh) return;

    if (sh === 'admin' && u && u.role === 'admin') {
      this.adminCtrl = new AdminPanelController(this.sheetSlot, {
        user: u,
        onClose: () => this._setSheet(null),
        onToast: (m) => this.showToast(m),
      });
      return;
    }

    if (sh === 'invite' && u) {
      this.sheetSlot.innerHTML = renderShareSheetHtml({
        mode: 'invite',
        code: u.suiteCode,
        pass: u.suitePass,
        link: buildRoomInviteUrl(u.suiteCode, u.suitePass),
        hasSwitchApp: true,
        hasOpenInstall: true,
      });
      bindShareSheetEvents(this.sheetSlot, {
        mode: 'invite',
        code: u.suiteCode,
        pass: u.suitePass,
        link: buildRoomInviteUrl(u.suiteCode, u.suitePass),
        onClose: () => this._setSheet(null),
        onToast: (m) => this.showToast(m),
        onSwitchToAppShare: () => this._setSheet('shareapp'),
        onOpenInstall: () => this._setSheet('install'),
      });
      return;
    }

    if (sh === 'shareapp') {
      const link = typeof window !== 'undefined' ? window.location.origin + '/' : '';
      this.sheetSlot.innerHTML = renderShareSheetHtml({ mode: 'shareapp', link });
      bindShareSheetEvents(this.sheetSlot, {
        mode: 'shareapp',
        link,
        onClose: () => this._setSheet(null),
        onToast: (m) => this.showToast(m),
      });
      return;
    }

    if (sh === 'acct' && u) {
      this.sheetSlot.innerHTML = `
        <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh">
          <button type="button" class="orb sm x" data-lsh="close" aria-label="Cerrar">${iconClose()}</button>
          <h2 id="sh">${esc(u.name)}</h2>
          <p id="sp">${esc(u.plan)}</p>
          <div id="sf">
            ${
              u.role === 'admin'
                ? `<div class="row"><span><b>Panel Admin Pro</b><small>Métricas en vivo, salas y usuarios</small></span><button type="button" class="orb sm active-mint" data-lsh="admin">${iconChart()}</button></div>`
                : ''
            }
            <div class="row"><span><b>Planes</b><small>Cambiar o renovar tu plan</small></span><button type="button" class="orb sm" data-lsh="plans">${iconCheck()}</button></div>
            <div class="row">
              <span><b>Nombre en las salas</b><small>${this.editingName ? 'Mínimo 2 caracteres' : `Ahora: ${esc(u.name)}`}</small></span>
              <button type="button" class="orb sm" data-lsh="${this.editingName ? 'cancel-name' : 'edit-name'}" aria-label="${
                this.editingName ? 'Cancelar edición' : 'Editar nombre'
              }">${this.editingName ? iconClose() : iconUsers()}</button>
            </div>
            ${
              this.editingName
                ? `<form id="lobby-name-form" style="display:flex;gap:8px;margin-top:4px;margin-bottom:8px">
                    <input id="lobby-draft-name" type="text" maxlength="24" value="${esc(this.draftName)}" placeholder="Tu nombre" style="flex:1;min-width:0;padding:10px 12px;border-radius:12px;border:1px solid var(--ln);background:var(--s2);color:var(--moon);font:500 0.92rem var(--sys);outline:none" />
                    <button type="submit" style="padding:0 14px;border-radius:12px;border:0;background:var(--green);color:var(--ink);font:600 0.88rem var(--sys);cursor:pointer">Guardar</button>
                  </form>`
                : ''
            }
            <div class="row"><span><b>Sonidos y avisos</b><small>Sonido y vibración</small></span><button type="button" class="orb sm" data-lsh="prefs">${iconBell()}</button></div>
            <div class="row"><span><b>Compartir la app</b><small>Envía el enlace por WhatsApp, Telegram o X</small></span><button type="button" class="orb sm" data-lsh="shareapp">${iconShare()}</button></div>
            <div class="row"><span><b style="color:var(--danger)">Cerrar sesión</b><small>Sales de tu cuenta en este teléfono</small></span><button type="button" class="orb sm rm" data-lsh="logout">${iconLeave()}</button></div>
          </div>
        </section>
      `;
      if (this.editingName) {
        this.sheetSlot.querySelector('#lobby-draft-name')?.focus();
      }
      return;
    }

    if (sh === 'prefs') {
      this.sheetSlot.innerHTML = `
        <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh">
          <button type="button" class="orb sm x" data-lsh="close" aria-label="Cerrar">${iconClose()}</button>
          <h2 id="sh">Sonidos y avisos</h2>
          <p id="sp">Controla cómo te avisa la app.</p>
          <div id="sf">
            <div class="row">
              <span><b>Sonidos</b><small>Al tocar, entrar, salir y mensajes</small></span>
              <button type="button" class="orb sm ${this.prefs.snd ? 'active-mint' : ''}" data-pref="snd">${iconBell(!this.prefs.snd)}</button>
            </div>
            <div class="row">
              <span><b>Vibración</b><small>Al tocar botones y cuando llega alguien</small></span>
              <button type="button" class="orb sm ${this.prefs.vib ? 'active-mint' : ''}" data-pref="vib">${iconBell(!this.prefs.vib)}</button>
            </div>
          </div>
        </section>
      `;
      return;
    }

    if (sh === 'install') {
      this.sheetSlot.innerHTML = `
        <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh">
          <button type="button" class="orb sm x" data-lsh="close" aria-label="Cerrar">${iconClose()}</button>
          <h2 id="sh">Instalar spaceSUITE</h2>
          <p id="sp">Se instala en un momento y queda como una app más en tu pantalla de inicio.</p>
          <div id="sf">
            ${
              this.isIOS
                ? `<div class="kv st"><span>1</span><b>Toca Compartir (cuadro con flecha)</b></div>
                   <div class="kv st"><span>2</span><b>Añadir a pantalla de inicio</b></div>
                   <div class="kv st"><span>3</span><b>Toca Añadir</b></div>
                   <p>Usa Safari para que aparezca esa opción.</p>`
                : `<div class="kv st"><span>1</span><b>Menú del navegador (⋮)</b></div>
                   <div class="kv st"><span>2</span><b>Instalar app / Añadir a pantalla de inicio</b></div>
                   <div class="kv st"><span>3</span><b>Confirmar</b></div>
                   <p>Si no ves la opción, abre el enlace en Chrome o Brave.</p>`
            }
          </div>
        </section>
      `;
    }
  }

  _bindGlobalEvents() {
    this.mountEl.querySelector('#lobby-veil').addEventListener('click', () => this._setSheet(null));

    this.wrapperEl.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) {
        this.touchStart = null;
        return;
      }
      const target = e.target;
      const scrollable = target?.closest?.('#sf, .tr-body');
      const tag = target?.tagName?.toLowerCase();
      const blocked =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean(scrollable && scrollable.scrollTop > 4);
      this.touchStart = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        t: Date.now(),
        blocked,
      };
    });
    this.wrapperEl.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) this.touchStart = null;
    });
    this.wrapperEl.addEventListener('touchend', (e) => {
      const start = this.touchStart;
      this.touchStart = null;
      if (!start || start.blocked || e.changedTouches.length !== 1) return;
      const dx = e.changedTouches[0].clientX - start.x;
      const dy = e.changedTouches[0].clientY - start.y;
      const dt = Date.now() - start.t;
      if (dy >= 72 && Math.abs(dx) < 48 && dt < 900) {
        this._handleLobbyRefresh();
      }
    });

    this.tourEl.addEventListener('input', (e) => {
      const field = e.target.getAttribute?.('data-field');
      if (!field) return;
      let val = e.target.value;
      if (field === 'verifyCode') {
        val = val.replace(/\D/g, '').slice(0, 6);
        e.target.value = val;
      } else if (field === 'joinCode' || field === 'joinPass') {
        val = val.toUpperCase();
        e.target.value = val;
      }
      this.form[field] = val;
    });

    this.tourEl.addEventListener('change', (e) => {
      const chk = e.target.getAttribute?.('data-check');
      if (chk) {
        this.form[chk] = Boolean(e.target.checked);
      }
    });

    this.tourEl.addEventListener('click', (e) => {
      const eyeBtn = e.target.closest('[data-eye]');
      if (eyeBtn) {
        const key = eyeBtn.getAttribute('data-eye');
        this.form[key] = !this.form[key];
        const show = this.form[key];
        const input = eyeBtn.previousElementSibling;
        if (input) input.type = show ? 'text' : 'password';
        eyeBtn.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Ver contraseña');
        eyeBtn.innerHTML = iconEye(show);
        return;
      }

      const goBtn = e.target.closest('[data-go]');
      if (goBtn) {
        this._setScreen(goBtn.getAttribute('data-go'));
        return;
      }

      const navBtn = e.target.closest('[data-nav]');
      if (navBtn) {
        const next = this.user ? 'home' : this.screen === 'verify' ? 'reg' : 'welcome';
        this._setScreen(next);
        return;
      }

      const shBtn = e.target.closest('[data-sheet]');
      if (shBtn) {
        this._setSheet(shBtn.getAttribute('data-sheet'));
        return;
      }

      const actBtn = e.target.closest('[data-act]');
      if (!actBtn) return;
      const act = actBtn.getAttribute('data-act');
      if (act === 'refresh') this._handleLobbyRefresh();
      else if (act === 'install') this._handleInstall();
      else if (act === 'plan-vip') this.showToast('Plan VIP seleccionado');
      else if (act === 'resend') this._handleResendCode();
      else if (act === 'new-suite' && this.user) {
        this.onEnterRoom({
          roomCode: this.user.suiteCode,
          pass: this.user.suitePass,
          name: this.user.name,
          wantHost: true,
        });
      } else if (act === 'copy-own' && this.user) {
        navigator.clipboard
          ?.writeText(`Código: ${this.user.suiteCode}\nClave: ${this.user.suitePass}`)
          .then(() => this.showToast('Copiado'))
          .catch(() => this.showToast('No se pudo copiar'));
      } else if (act === 'logout') {
        this._logout();
      }
    });

    this.tourEl.addEventListener('submit', (e) => {
      e.preventDefault();
      if (e.target.id === 'lobby-reg-form') this._handleRegister();
      else if (e.target.id === 'lobby-verify-form') this._handleVerifyEmail();
      else if (e.target.id === 'lobby-login-form') this._handleLogin();
      else if (e.target.id === 'lobby-code-form') this._handleJoinByCode();
    });

    this.sheetSlot.addEventListener('click', (e) => {
      const lsh = e.target.closest('[data-lsh]')?.getAttribute('data-lsh');
      if (lsh) {
        if (lsh === 'close') this._setSheet(null);
        else if (lsh === 'admin') this._setSheet('admin');
        else if (lsh === 'prefs') this._setSheet('prefs');
        else if (lsh === 'shareapp') this._setSheet('shareapp');
        else if (lsh === 'plans') {
          this._setSheet(null);
          this._setScreen('plans');
        } else if (lsh === 'edit-name') {
          this.draftName = this.user?.name || '';
          this.editingName = true;
          this._renderSheet();
        } else if (lsh === 'cancel-name') {
          this.editingName = false;
          this._renderSheet();
        } else if (lsh === 'logout') {
          this._logout();
        }
        return;
      }

      const prefKey = e.target.closest('[data-pref]')?.getAttribute('data-pref');
      if (prefKey) {
        this.prefs = { ...this.prefs, [prefKey]: !this.prefs[prefKey] };
        savePrefs(this.prefs);
        this._renderSheet();
      }
    });

    this.sheetSlot.addEventListener('input', (e) => {
      if (e.target.id === 'lobby-draft-name') {
        this.draftName = e.target.value;
      }
    });

    this.sheetSlot.addEventListener('submit', async (e) => {
      if (e.target.id !== 'lobby-name-form' || !this.user) return;
      e.preventDefault();
      const trimmed = this.draftName.trim().slice(0, 24);
      if (trimmed.length < 2) {
        this.showToast('Escribe al menos 2 letras');
        return;
      }
      if (this.user.token) {
        try {
          await fetch('/api/auth/update-name', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.user.token}`,
            },
            body: JSON.stringify({ name: trimmed }),
          });
        } catch {
          // fallback
        }
      }
      const updated = { ...this.user, name: trimmed };
      this.user = updated;
      saveSuiteUser(updated);
      this.onUserChange(updated);
      this.editingName = false;
      this._renderSheet();
      this._renderTour();
      this.showToast('Listo: ahora eres ' + updated.name);
    });
  }

  _logout() {
    clearSuiteUser();
    this.user = null;
    this.onUserChange(null);
    this._setSheet(null);
    this._setScreen('welcome');
    this.showToast('Sesión cerrada');
  }

  async _handleRegister() {
    const f = this.form;
    const cleanName = f.regName.trim();
    if (cleanName.length < 2) return this.showToast('Escribe tu nombre o alias');
    if (!/^\S+@\S+\.\S+$/.test(f.regEmail.trim())) return this.showToast('Escribe un correo válido');
    if (f.regPass.length < 8 || !/[A-Za-z]/.test(f.regPass) || !/\d/.test(f.regPass)) {
      return this.showToast('La contraseña necesita 8+ caracteres, letras y números');
    }
    if (f.regPass !== f.regPass2) return this.showToast('Las contraseñas no coinciden');
    if (!f.regDob || f.regDob > dob18()) return this.showToast('Debes ser mayor de 18 años');
    if (!f.regTerms) return this.showToast('Acepta los términos para continuar');

    this.submitting = true;
    this._renderTour();
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName.slice(0, 24),
          email: f.regEmail.trim(),
          password: f.regPass,
          dob: f.regDob,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        this.showToast(json.error || 'No se pudo iniciar el registro');
        return;
      }
      f.verifyEmail = json.email || f.regEmail.trim().toLowerCase();
      f.verifyCode = '';
      f.deliveredVia = json.deliveredVia || 'dev';
      f.devCodeHint = json.devCode || null;
      this.submitting = false;
      this._setScreen('verify');
      this.showToast('Revisa tu código de verificación');
      return;
    } catch {
      this.showToast('Error de conexión con el servidor');
    } finally {
      if (this.submitting) {
        this.submitting = false;
        this._renderTour();
      }
    }
  }

  async _handleVerifyEmail() {
    const cleanCode = this.form.verifyCode.trim();
    if (cleanCode.length < 6) return this.showToast('Escribe el código de 6 dígitos');
    this.submitting = true;
    this._renderTour();
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: this.form.verifyEmail, code: cleanCode }),
      });
      const json = await res.json();
      if (!res.ok || !json.user) {
        this.showToast(json.error || 'Código incorrecto');
        return;
      }
      saveSuiteUser(json.user);
      this.user = json.user;
      this.form.joinName = json.user.name;
      this.onUserChange(json.user);
      this.form.devCodeHint = null;
      this.form.verifyCode = '';
      this.submitting = false;
      this._setScreen('home');
      this.showToast('Correo verificado · bienvenido a spaceSUITE');
      return;
    } catch {
      this.showToast('Error al verificar correo');
    } finally {
      if (this.submitting) {
        this.submitting = false;
        this._renderTour();
      }
    }
  }

  async _handleResendCode() {
    if (!this.form.verifyEmail) return;
    this.submitting = true;
    this._renderTour();
    try {
      const res = await fetch('/api/auth/resend-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: this.form.verifyEmail }),
      });
      const json = await res.json();
      if (!res.ok) {
        this.showToast(json.error || 'No se pudo reenviar');
        return;
      }
      this.form.deliveredVia = json.deliveredVia || 'dev';
      this.form.devCodeHint = json.devCode || null;
      this.showToast('Código nuevo enviado');
    } catch {
      this.showToast('Error de red al reenviar');
    } finally {
      this.submitting = false;
      this._renderTour();
    }
  }

  async _handleLogin() {
    const email = this.form.logEmail.trim();
    if (!/^\S+@\S+\.\S+$/.test(email) || this.form.logPass.length < 4) {
      return this.showToast('Escribe tu correo y contraseña');
    }
    this.submitting = true;
    this._renderTour();
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: this.form.logPass }),
      });
      const json = await res.json();
      if (res.status === 403 && json.requiresVerification) {
        this.form.verifyEmail = json.email || email.toLowerCase();
        this.form.verifyCode = '';
        this.form.deliveredVia = json.deliveredVia || 'dev';
        this.form.devCodeHint = json.devCode || null;
        this.submitting = false;
        this._setScreen('verify');
        this.showToast(json.error || 'Verifica tu correo electrónico');
        return;
      }
      if (!res.ok || !json.user) {
        this.showToast(json.error || 'Correo o contraseña incorrectos');
        return;
      }
      saveSuiteUser(json.user);
      this.user = json.user;
      this.form.joinName = json.user.name;
      this.onUserChange(json.user);
      this.submitting = false;
      this._setScreen('home');
      this.showToast('Bienvenido de nuevo');
      return;
    } catch {
      this.showToast('Error de conexión con el servidor');
    } finally {
      if (this.submitting) {
        this.submitting = false;
        this._renderTour();
      }
    }
  }

  _handleJoinByCode() {
    const cleanCode = this.form.joinCode.trim().toUpperCase().replace(/\s+/g, '');
    if (cleanCode.length < 4) return this.showToast('Escribe el código de SUITE');
    const normalizedCode = cleanCode.startsWith('SS-SALA-')
      ? cleanCode
      : cleanCode.length === 10 && /^[A-Z0-9]+$/.test(cleanCode)
        ? `SS-SALA-${cleanCode}`
        : cleanCode;
    const finalName = this.form.joinName.trim() || this.user?.name || 'Invitado';
    this.onEnterRoom({
      roomCode: normalizedCode,
      pass: this.form.joinPass.trim().toUpperCase() || undefined,
      name: finalName,
      wantHost: false,
    });
  }

  destroy() {
    this._destroyed = true;
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    if (this.adminCtrl) this.adminCtrl.destroy();
    this.mountEl.innerHTML = '';
  }
}
