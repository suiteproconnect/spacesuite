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
  iconHeartbeat,
  iconInvite,
  iconLeave,
  iconLock,
  iconReaction,
  iconSendPlane,
  iconShare,
  iconShield,
  iconSuperKey,
  iconUsers,
  playSpatialHeartbeatSound,
  renderBrandIsotipoHtml,
  renderBrandWordmarkHtml,
} from './icons.js';
import {
  addLatidos,
  buildRoomInviteUrl,
  clearSuiteUser,
  generateCleanRoomCode,
  getLatidosBalance,
  getStoredName,
  loadPrefs,
  loadSpaceDraftProfile,
  normalizeRoomCode,
  savePrefs,
  saveSpaceDraftProfile,
  saveSuiteUser,
} from './identity.js';
import {
  disableOneSignalNotifications,
  enableOneSignalNotifications,
  getNotificationDiscretePref,
  getNotificationStatus,
  syncOneSignalRoomTag,
  toggleNotificationDiscreteMode,
} from './push.js';
import {
  AdminPanelController,
  SuperKeyController,
  bindMiniTiendaEvents,
  bindShareSheetEvents,
  renderMiniTiendaHtml,
  renderShareSheetHtml,
  renderSpaceConfigSheetHtml,
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
      regWantAdmin: false,
      regAdminKey: '',
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
    this.serverStatus = { loaded: false, hasAdmin: false, requiresAdminKey: false };
    this._adminTouched = false;
    this.prefs = loadPrefs();
    this.pushState = {
      provider: 'onesignal',
      configured: false,
      supported: true,
      permission: 'default',
      subscribed: false,
      discrete: getNotificationDiscretePref(),
      busy: false,
    };

    this.isIOS =
      typeof navigator !== 'undefined' &&
      (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

    this._renderLayout();
    this._bindGlobalEvents();
    this._validateSession();
    this._fetchServerStatus();
    this._refreshPushState();
  }

  async _refreshPushState() {
    const st = await getNotificationStatus().catch(() => null);
    if (!st || this._destroyed) return;
    this.pushState = { ...this.pushState, ...st };
    if (this.sheet === 'prefs') this._renderSheet();
  }

  _fetchServerStatus() {
    fetch('/api/auth/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (this._destroyed || !json?.ok) return;
        this.serverStatus = {
          loaded: true,
          hasAdmin: Boolean(json.hasAdmin),
          requiresAdminKey: Boolean(json.requiresAdminKey),
        };
        if (!this._adminTouched && !json.hasAdmin) {
          this.form.regWantAdmin = true;
        }
        if (this.screen === 'reg') this._renderTour();
      })
      .catch(() => {});
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
    const promptObj = this.deferredPrompt || (typeof window !== 'undefined' ? window.__PWA_PROMPT__ : null);
    if (promptObj) {
      try {
        await promptObj.prompt();
        const choice = await promptObj.userChoice;
        if (choice?.outcome === 'accepted') {
          this.showToast('¡spaceSUITE instalada en tu dispositivo!');
          addLatidos(3);
          playSpatialHeartbeatSound();
        }
        this.deferredPrompt = null;
        if (typeof window !== 'undefined') window.__PWA_PROMPT__ = null;
        this._renderTour();
        return;
      } catch (_) {}
    }
    if (this.isIOS) {
      this._setSheet('install');
    } else {
      this.showToast('Toca el menú del navegador (⋮) e "Instalar app"');
    }
  }

  _handleShareSuiteBonus() {
    addLatidos(3);
    playSpatialHeartbeatSound();
    this.showToast('¡7 días de Suite privada y +3 Latidos otorgados!');
    if (this.user) {
      this._setSheet('invite');
    } else {
      this._setSheet('shareapp');
    }
  }

  _handleEnterSuite() {
    const suiteProfile = loadSpaceDraftProfile();
    if (this.user?.suiteCode) {
      const code = normalizeRoomCode(this.user.suiteCode) || this.user.suiteCode;
      syncOneSignalRoomTag(code);
      this.onEnterRoom({
        roomCode: code,
        pass: this.user.suitePass,
        name: this.user.name,
        wantHost: true,
        suiteProfile,
      });
      return;
    }
    const storedName = getStoredName() || 'Invitado';
    const code = generateCleanRoomCode();
    syncOneSignalRoomTag(code);
    this.onEnterRoom({
      roomCode: code,
      name: storedName,
      wantHost: true,
      suiteProfile,
    });
  }

  _setScreen(next) {
    this.screen = next;
    if (next === 'reg') this._fetchServerStatus();
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

    const isStandalone =
      typeof window !== 'undefined' &&
      Boolean(
        window.matchMedia?.('(display-mode: standalone)').matches ||
          window.navigator.standalone === true ||
          document.referrer.includes('android-app://')
      );
    const showShareSuite = isStandalone || Boolean(u);

    const pwaBtnHtml = showShareSuite
      ? `<button type="button" class="inst" data-act="share-suite-bonus">
          ${iconReaction('heartbeat')}
          <span>COMPARTIR SUITE</span>
          <small>7 días privada + 3 Latidos</small>
        </button>`
      : `<button type="button" class="inst" data-act="install">
          ${iconDownload()}
          <span>INSTALAR APP</span>
          <small>Un toque directo</small>
        </button>`;

    let body = '';
    if (sc === 'welcome') {
      body = `
        <header class="welcome-top-bar">
          ${pwaBtnHtml}
        </header>
        <div class="tr-body welcome-body">
          <button type="button" class="tlg-btn welcome-logo-btn" data-act="refresh" aria-label="Actualizar app">
            <div class="tr-logo ${this.logoRefreshing ? 'refreshing' : ''}">${renderBrandIsotipoHtml({ size: 'md', live: true, idPrefix: 'wel-iso' })}</div>
          </button>
          <div class="tr-wm">${renderBrandWordmarkHtml()}</div>
          <h2 class="welcome-title">Bienvenido a SPACE SUITE</h2>
          <p class="welcome-sub">Un espacio hecho para sentir y conectar sin barreras</p>

          <div class="space-superkey-card welcome-sk-card">
            <div class="space-sk-icon">${iconSuperKey()}</div>
            <div class="space-sk-copy">
              <b>SUPER KEY</b>
              <p>Qué onda, bienvenido. Tómate tu espacio con calma, aquí conectas libre, privado y sin barreras a tu ritmo.</p>
            </div>
          </div>

          <div class="plans-container welcome-plans">
            <div class="plan-touch-card" role="button" tabindex="0" data-act="plan-vip">
              <div class="plan-line-1">
                <span class="plan-name">VIP Ilimitado</span>
                <span class="plan-price">$20.30 USD <small>/ sem</small></span>
              </div>
              <div class="plan-line-2">Salas de hasta 20 personas sin límite de tiempo y video 720p.</div>
              <div class="plan-line-3">10 Latidos incluidos · Audio espacial completo.</div>
            </div>

            <div class="plan-touch-card" role="button" tabindex="0" data-act="plan-connect">
              <div class="plan-line-1">
                <span class="plan-name">Connect 30 Días</span>
                <span class="plan-price">$24.50 USD <small>único</small></span>
              </div>
              <div class="plan-line-2">120 llamadas directas cara a cara y enlace privado permanente.</div>
              <div class="plan-line-3">Acceso estable multiplataforma sin cortes.</div>
            </div>

            <div class="plan-touch-card" role="button" tabindex="0" data-act="plan-shield">
              <div class="plan-line-1">
                <span class="plan-name">Pase Escudo 14 Días</span>
                <span class="plan-price">$14.00 USD <small>único</small></span>
              </div>
              <div class="plan-line-2">Acceso completo cara a cara sin restricciones de horario.</div>
              <div class="plan-line-3">50 timbres de cortesía y soporte de SUPER KEY.</div>
            </div>
          </div>
        </div>
        <div class="tr-bar">
          <button type="button" class="tr-b entry-crimson-btn" data-act="enter-suite">Entrar a tu Suite</button>
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
            <div class="reg-admin-box">
              <label class="tr-l">
                <input type="checkbox" data-check="regWantAdmin" ${f.regWantAdmin ? 'checked' : ''} />
                <span>${
                  this.serverStatus.loaded && !this.serverStatus.hasAdmin
                    ? 'Configurar como Cuenta Principal (acceso total)'
                    : 'Registrar como Cuenta Principal'
                }</span>
              </label>
              ${
                f.regWantAdmin && this.serverStatus.hasAdmin
                  ? `<input type="password" maxlength="80" placeholder="${
                      this.serverStatus.requiresAdminKey
                        ? 'Clave de acceso principal (ADMIN_SETUP_KEY)'
                        : 'Código de autorización principal'
                    }" data-field="regAdminKey" value="${esc(f.regAdminKey)}" autocomplete="off" />`
                  : ''
              }
            </div>
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
            <button type="button" class="tr-k" data-go="reg">¿No tienes cuenta? Crear cuenta</button>
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
              <div class="lb-logo ${this.logoRefreshing ? 'refreshing' : ''}">${renderBrandIsotipoHtml({ size: 'sm', live: true, idPrefix: 'hom-iso' })}</div>
            </button>
            <div>
              <b>Hola, ${esc(u.name)}</b>
              <small>${esc(u.plan)} · ${getLatidosBalance()} Latidos</small>
            </div>
          </div>

          <div class="home-primary-row">
            <button type="button" class="tr-b" data-act="enter-suite">Entrar a mi Suite</button>
            <button type="button" class="btn-superkey" data-act="open-superkey">
              ${iconSuperKey()}
              <span>SUPER KEY</span>
            </button>
          </div>

          <div class="lb-tiles">
            <button type="button" class="lb-t g" data-act="new-suite">${iconCam()}<span>Nueva SUITE</span></button>
            <button type="button" class="lb-t" data-act="open-tienda">${iconReaction('heartbeat')}<span>Mini Tienda</span></button>
            <button type="button" class="lb-t" data-go="code">${iconInvite()}<span>Unirse</span></button>
            <button type="button" class="lb-t" data-sheet="invite">${iconSendPlane()}<span>Invitar</span></button>
            ${
              u.role === 'admin'
                ? `<button type="button" class="lb-t" data-sheet="admin">${iconChart()}<span>Panel Control</span></button>`
                : `<button type="button" class="lb-t" data-go="plans">${iconShield()}<span>Planes</span></button>`
            }
          </div>

          <div class="lb-card">
            <span>Mi SUITE · siempre la misma</span>
            <b>${esc(normalizeRoomCode(u.suiteCode) || u.suiteCode)}</b>
            <small>Enlace directo ?room=${esc(normalizeRoomCode(u.suiteCode) || u.suiteCode)}</small>
            <div class="lb-card-actions">
              <button type="button" data-act="copy-own">Copiar enlace</button>
              <button type="button" data-sheet="invite">Compartir</button>
              <button type="button" data-sheet="space-config">Personalizar SPACE</button>
            </div>
          </div>

          <button type="button" class="inst" data-act="share-suite-bonus">
            ${iconReaction('heartbeat')}
            <span>COMPARTIR SUITE</span>
            <small>7 días privada + 3 Latidos</small>
          </button>
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
            <p>Escribe el código de 6 letras o pega el enlace directo que te compartieron.</p>
            <input type="text" maxlength="24" placeholder="Tu nombre o alias en SPACE" data-field="joinName" value="${esc(f.joinName)}" />
            <input type="text" maxlength="160" placeholder="Ej. K9M4P2 (o pega el enlace)" data-field="joinCode" value="${esc(f.joinCode)}" autocapitalize="characters" autocomplete="off" />
            <input type="text" maxlength="8" placeholder="Clave (solo si tiene)" data-field="joinPass" value="${esc(f.joinPass)}" autocapitalize="characters" autocomplete="off" />
          </div>
          <div class="tr-bar">
            <button type="submit" class="tr-b">Ir a SPACE</button>
            <button type="button" class="tr-g" data-go="${u ? 'home' : 'welcome'}">Volver</button>
          </div>
        </form>
      `;
    } else if (sc === 'plans') {
      body = `
        <div class="tr-body">
          <h2>Membresías</h2>
          <p>Conexión directa, ilimitada y sin cortes en tu propio universo.</p>
          <div class="plans-container">
            <div class="plan-touch-card featured" role="button" tabindex="0" data-act="plan-vip">
              <div class="plan-line-1">
                <span class="plan-name">VIP Ilimitado</span>
                <span class="plan-price">$20.30 USD <small>/ sem</small></span>
              </div>
              <div class="plan-line-2">Salas de 20 personas sin límite de tiempo y pantalla completa 720p.</div>
              <div class="plan-line-3"><span class="badge-crimson">10 Latidos incluidos</span> · Auras exclusivas y audio espacial total.</div>
            </div>

            <div class="plan-touch-card" role="button" tabindex="0" data-act="plan-connect">
              <div class="plan-line-1">
                <span class="plan-name">Connect 30 Días</span>
                <span class="plan-price">$24.50 USD <small>único</small></span>
              </div>
              <div class="plan-line-2">120 llamadas directas cara a cara y 150 timbres prioritarios.</div>
              <div class="plan-line-3">Suite fija permanente con transcripción limpia en vivo y soporte ágil.</div>
            </div>

            <div class="plan-touch-card" role="button" tabindex="0" data-act="plan-shield">
              <div class="plan-line-1">
                <span class="plan-name">Pase Escudo 14 Días</span>
                <span class="plan-price">$14.00 USD <small>único</small></span>
              </div>
              <div class="plan-line-2">Acceso completo cara a cara sin restricciones de horario.</div>
              <div class="plan-line-3">50 timbres de cortesía y asistencia directa de SUPER KEY.</div>
            </div>
          </div>
        </div>
        <div class="tr-bar">
          ${!u ? `<button type="button" class="tr-b" data-go="reg">Crear cuenta gratis</button>` : ''}
          <button type="button" class="tr-g" data-go="${u ? 'home' : 'welcome'}">Volver</button>
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

    if (sh === 'superkey') {
      this.adminCtrl = new SuperKeyController(this.sheetSlot, {
        onClose: () => this._setSheet(null),
        onToast: (m) => this.showToast(m),
      });
      return;
    }

    if (sh === 'tienda') {
      this.sheetSlot.innerHTML = renderMiniTiendaHtml();
      bindMiniTiendaEvents(this.sheetSlot, {
        onClose: () => this._setSheet(null),
        onToast: (m) => this.showToast(m),
        onOpenInvite: () => this._setSheet('invite'),
      });
      return;
    }

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

    if (sh === 'space-config') {
      this.sheetSlot.innerHTML = renderSpaceConfigSheetHtml(loadSpaceDraftProfile());
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
                ? `<div class="row"><span><b>Panel de Control</b><small>Métricas en vivo, salas y usuarios</small></span><button type="button" class="orb sm is-active" data-lsh="admin">${iconChart()}</button></div>`
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
                ? `<form id="lobby-name-form" class="inline-name-form">
                    <input id="lobby-draft-name" type="text" maxlength="24" value="${esc(this.draftName)}" placeholder="Tu nombre" />
                    <button type="submit" class="tr-b inline-save-btn">Guardar</button>
                  </form>`
                : ''
            }
            <div class="row"><span><b>Sonidos y avisos</b><small>Sonido, vibración y notificaciones</small></span><button type="button" class="orb sm" data-lsh="prefs">${iconBell()}</button></div>
            <div class="row"><span><b>Compartir la app</b><small>Envía el enlace por WhatsApp, Telegram o X</small></span><button type="button" class="orb sm" data-lsh="shareapp">${iconShare()}</button></div>
            <div class="row"><span><b class="text-danger">Cerrar sesión</b><small>Sales de tu cuenta en este teléfono</small></span><button type="button" class="orb sm rm" data-lsh="logout">${iconLeave()}</button></div>
          </div>
        </section>
      `;
      if (this.editingName) {
        this.sheetSlot.querySelector('#lobby-draft-name')?.focus();
      }
      return;
    }

    if (sh === 'prefs') {
      const ps = this.pushState;
      const pushRoom = this.user?.suiteCode ? normalizeRoomCode(this.user.suiteCode) : '';
      this.sheetSlot.innerHTML = `
        <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh">
          <button type="button" class="orb sm x" data-lsh="close" aria-label="Cerrar">${iconClose()}</button>
          <h2 id="sh">Sonidos y avisos</h2>
          <p id="sp">Preferencias de sonido, vibración y estructura lista para OneSignal.</p>
          <div id="sf">
            <div class="row">
              <span><b>Sonidos</b><small>Al tocar, entrar, salir y mensajes</small></span>
              <button type="button" class="orb sm ${this.prefs.snd ? 'is-active' : ''}" data-pref="snd">${iconBell(!this.prefs.snd)}</button>
            </div>
            <div class="row">
              <span><b>Vibración</b><small>Al tocar botones y cuando llega alguien</small></span>
              <button type="button" class="orb sm ${this.prefs.vib ? 'is-active' : ''}" data-pref="vib">${iconBell(!this.prefs.vib)}</button>
            </div>
            <div class="row">
              <span><b>Notificaciones (OneSignal)</b><small>${
                !ps.supported
                  ? 'No compatible en este navegador'
                  : ps.subscribed
                    ? `Preferencia activa${pushRoom ? ` · Suite ${esc(pushRoom)}` : ''}`
                    : ps.permission === 'denied'
                      ? 'Permiso bloqueado en configuración'
                      : 'Listo para conectar OneSignal cuando lo publiques'
              }</small></span>
              <button type="button" class="orb sm ${ps.subscribed ? 'is-active' : ''}" ${!ps.supported || ps.busy ? 'disabled' : ''} data-push="toggle">${iconBell(!ps.subscribed)}</button>
            </div>
            <div class="row">
              <span><b>Modo discreto</b><small>${
                ps.discrete
                  ? 'Oculta nombres y códigos en pantalla bloqueada'
                  : 'Muestra nombre y código en la notificación'
              }</small></span>
              <button type="button" class="orb sm ${ps.discrete ? 'is-active' : ''}" ${ps.busy ? 'disabled' : ''} data-push="discrete">${iconLock(!ps.discrete)}</button>
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
        if (chk === 'regWantAdmin') {
          this._adminTouched = true;
          this._renderTour();
        }
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
      else if (act === 'enter-suite') this._handleEnterSuite();
      else if (act === 'open-superkey') this._setSheet('superkey');
      else if (act === 'open-tienda') this._setSheet('tienda');
      else if (act === 'share-suite-bonus') this._handleShareSuiteBonus();
      else if (act === 'plan-vip') this.showToast('Plan VIP seleccionado');
      else if (act === 'plan-connect') this.showToast('Plan Connect 30 días seleccionado');
      else if (act === 'plan-shield') this.showToast('Pase Escudo 14 días seleccionado');
      else if (act === 'resend') this._handleResendCode();
      else if (act === 'new-suite' && this.user) {
        this.onEnterRoom({
          roomCode: normalizeRoomCode(this.user.suiteCode) || this.user.suiteCode,
          pass: this.user.suitePass,
          name: this.user.name,
          wantHost: true,
          suiteProfile: loadSpaceDraftProfile(),
        });
      } else if (act === 'copy-own' && this.user) {
        const cleanCode = normalizeRoomCode(this.user.suiteCode) || this.user.suiteCode;
        const inviteUrl = buildRoomInviteUrl(cleanCode);
        navigator.clipboard
          ?.writeText(inviteUrl)
          .then(() => this.showToast('Enlace directo copiado'))
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
      const resetSpace = e.target.closest('[data-act="reset-space-config"]');
      if (resetSpace) {
        saveSpaceDraftProfile(null);
        this.showToast('SPACE usará la escena espacial por defecto');
        this._setSheet(null);
        return;
      }
      const closeAct = e.target.closest('[data-act="close"]');
      if (closeAct) {
        this._setSheet(null);
        return;
      }
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
        return;
      }

      const pushAct = e.target.closest('[data-push]')?.getAttribute('data-push');
      if (pushAct) {
        this._handlePushAction(pushAct);
      }
    });

    this.sheetSlot.addEventListener('input', (e) => {
      if (e.target.id === 'lobby-draft-name') {
        this.draftName = e.target.value;
      }
    });

    this.sheetSlot.addEventListener('submit', async (e) => {
      if (e.target.id === 'space-config-form') {
        e.preventDefault();
        const title = this.sheetSlot.querySelector('#spc-title')?.value || '';
        const description = this.sheetSlot.querySelector('#spc-desc')?.value || '';
        const coverVideo = this.sheetSlot.querySelector('#spc-cover-vid')?.value || '';
        const coverImage = this.sheetSlot.querySelector('#spc-cover-img')?.value || '';
        saveSpaceDraftProfile({ title, description, coverVideo, coverImage });
        this.showToast('Recibidor SPACE actualizado');
        this._setSheet(null);
        return;
      }
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

  async _handlePushAction(act) {
    if (this.pushState.busy) return;
    if (act === 'discrete') {
      const nextDiscrete = !this.pushState.discrete;
      this.pushState = { ...this.pushState, busy: true };
      this._renderSheet();
      const res = await toggleNotificationDiscreteMode(nextDiscrete);
      this.pushState = { ...this.pushState, discrete: res.discrete, busy: false };
      this._renderSheet();
      this.showToast(
        nextDiscrete
          ? 'Modo discreto activo: avisos sin nombres ni códigos'
          : 'Modo detallado activo en tus notificaciones',
      );
      return;
    }
    if (act === 'toggle') {
      this.pushState = { ...this.pushState, busy: true };
      this._renderSheet();
      if (this.pushState.subscribed) {
        await disableOneSignalNotifications();
        this.pushState = { ...this.pushState, subscribed: false, busy: false };
        this._renderSheet();
        this.showToast('Notificaciones desactivadas');
      } else {
        const roomCode = this.user?.suiteCode ? normalizeRoomCode(this.user.suiteCode) : 'ORBIT6';
        const res = await enableOneSignalNotifications({ roomCode, discrete: this.pushState.discrete });
        await this._refreshPushState();
        this.pushState = { ...this.pushState, busy: false };
        this._renderSheet();
        if (res.ok) {
          this.showToast('Notificaciones listas para OneSignal');
        } else {
          this.showToast(res.error || 'No se pudieron activar las notificaciones');
        }
      }
    }
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
          wantAdmin: Boolean(f.regWantAdmin),
          adminKey: f.regAdminKey.trim() || undefined,
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
    const normalizedCode = normalizeRoomCode(this.form.joinCode);
    if (normalizedCode.length < 4) return this.showToast('Escribe un código o enlace válido');
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
