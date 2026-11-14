import {
  esc,
  getPeerTint,
  iconBell,
  iconCam,
  iconChart,
  iconChat,
  iconCheck,
  iconClose,
  iconFit,
  iconGrid,
  iconLeave,
  iconLock,
  iconMic,
  iconMuteAll,
  iconPip,
  iconSend,
  iconSettings,
  iconShare,
  iconShareTarget,
  iconShield,
  iconSwap,
  iconUsers,
  iconWave,
  renderLinkedTextHtml,
} from './icons.js';
import { ACCENT_TOKENS } from './identity.js';

const SHARE_TARGETS = [
  { key: 'native', label: 'Compartir' },
  { key: 'wa', label: 'WhatsApp' },
  { key: 'tg', label: 'Telegram' },
  { key: 'x', label: 'X' },
  { key: 'gm', label: 'Gmail' },
  { key: 'mail', label: 'iCloud' },
  { key: 'sms', label: 'SMS' },
];

export function renderShareSheetHtml(opts) {
  const isApp = opts.mode === 'shareapp';
  const hostDisplay = typeof window !== 'undefined' ? window.location.host : opts.link;

  return `
    <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh">
      <button type="button" class="orb sm x" data-act="close" aria-label="Cerrar">
        ${iconClose()}
      </button>
      <h2 id="sh">${isApp ? 'Compartir spaceSUITE' : 'Invitar a tu SUITE'}</h2>
      <p id="sp">${isApp ? 'Manda el enlace de la app a quien quieras.' : 'Cada persona espera tu aprobación para entrar.'}</p>
      <div id="sf">
        ${
          isApp
            ? `<div class="kv"><span>Enlace</span><b>${esc(hostDisplay)}</b></div>`
            : `<div class="kv"><span>Código de SUITE</span><b>${esc(opts.code)}</b></div>
               <div class="kv"><span>Clave</span><b>${esc(opts.pass || 'Libre')}</b></div>`
        }
        <div class="shr">
          ${SHARE_TARGETS.map(
            (t) => `
            <button type="button" data-sh="${t.key}" aria-label="${esc(t.label)}">
              ${iconShareTarget(t.key)}
              <span>${esc(t.label)}</span>
            </button>`,
          ).join('')}
        </div>
        <div class="row2">
          <button type="button" data-act="copy-link">Copiar enlace</button>
          ${!isApp ? `<button type="button" data-act="copy-cred">Copiar código y clave</button>` : ''}
        </div>
        ${
          !isApp
            ? `<p>El enlace entra directo con la clave. Si prefieres, comparte solo el código y la clave por separado.</p>
               <div class="row2">
                 ${opts.hasSwitchApp ? `<button type="button" data-act="switch-app">Compartir la app</button>` : ''}
                 ${opts.hasOpenInstall ? `<button type="button" data-act="open-install">Instalar la app</button>` : ''}
               </div>`
            : ''
        }
      </div>
    </section>
  `;
}

export function bindShareSheetEvents(container, opts) {
  const isApp = opts.mode === 'shareapp';
  const buildMsg = () =>
    isApp
      ? `Instala spaceSUITE: videollamadas privadas 🔒\n${opts.link}`
      : `Te invito a mi SUITE en spaceSUITE 🔒\nCódigo: ${opts.code}\nClave: ${opts.pass || '—'}\nEntra directo: ${opts.link}`;

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      opts.onToast('Copiado');
    } catch {
      opts.onToast('No se pudo copiar');
    }
  };

  const openExternal = (url) => {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  container.addEventListener('click', async (e) => {
    const targetBtn = e.target.closest('[data-sh]');
    if (targetBtn) {
      const key = targetBtn.getAttribute('data-sh');
      const msg = buildMsg();
      const E = encodeURIComponent;
      if (key === 'native') {
        if (navigator.share) {
          try {
            await navigator.share({ title: 'spaceSUITE', text: msg });
            return;
          } catch {
            // cancelled
          }
        }
        await copyText(msg);
      } else if (key === 'wa') {
        openExternal('https://wa.me/?text=' + E(msg));
      } else if (key === 'tg') {
        const tgText = isApp
          ? 'Instala spaceSUITE 🔒'
          : `Te invito a mi SUITE en spaceSUITE 🔒\nCódigo: ${opts.code}\nClave: ${opts.pass || '—'}`;
        openExternal(`https://t.me/share/url?url=${E(opts.link)}&text=${E(tgText)}`);
      } else if (key === 'x') {
        openExternal(
          `https://twitter.com/intent/tweet?text=${E(
            `${isApp ? 'Instala spaceSUITE' : 'Te invito a mi SUITE en spaceSUITE'} 🔒 ${opts.link}`,
          )}`,
        );
      } else if (key === 'gm') {
        openExternal(
          `https://mail.google.com/mail/?view=cm&fs=1&su=${E('Te invito a mi SUITE')}&body=${E(msg)}`,
        );
      } else if (key === 'mail') {
        window.location.href = `mailto:?subject=${E('Te invito a mi SUITE')}&body=${E(msg)}`;
      } else if (key === 'sms') {
        window.location.href = `sms:?&body=${E(msg)}`;
      }
      return;
    }

    const actBtn = e.target.closest('[data-act]');
    if (!actBtn) return;
    const act = actBtn.getAttribute('data-act');
    if (act === 'close') opts.onClose();
    else if (act === 'copy-link') copyText(opts.link);
    else if (act === 'copy-cred') copyText(`Código: ${opts.code}\nClave: ${opts.pass || '—'}`);
    else if (act === 'switch-app') opts.onSwitchToAppShare?.();
    else if (act === 'open-install') opts.onOpenInstall?.();
  });
}

function formatUptime(sec) {
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const rem = sec % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${rem}s`;
  return `${rem}s`;
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

export class AdminPanelController {
  constructor(mountEl, { user, onClose, onToast }) {
    this.mountEl = mountEl;
    this.user = user;
    this.onClose = onClose;
    this.onToast = onToast;
    this.tab = 'rooms';
    this.data = null;
    this.loading = true;
    this.error = null;
    this.busyKey = null;
    this._mounted = true;

    this._renderShell();
    this._bindEvents();
    this.fetchMetrics();
    this._iv = window.setInterval(() => this.fetchMetrics(), 6000);
  }

  destroy() {
    this._mounted = false;
    if (this._iv) window.clearInterval(this._iv);
  }

  async fetchMetrics() {
    if (!this.user?.token) {
      this.error = 'Sesión sin token de administrador.';
      this.loading = false;
      this._renderContent();
      return;
    }
    try {
      const res = await fetch('/api/admin/metrics', {
        headers: { Authorization: `Bearer ${this.user.token}` },
      });
      const json = await res.json();
      if (!this._mounted) return;
      if (!res.ok) {
        this.error = json.error || 'No se pudieron cargar las métricas.';
      } else {
        this.data = json;
        this.error = null;
      }
    } catch {
      if (!this._mounted) return;
      this.error = 'Error de red al consultar el servidor.';
    } finally {
      if (this._mounted) {
        this.loading = false;
        this._renderContent();
      }
    }
  }

  async handleRoomAction(code, action, value) {
    if (!this.user?.token) return;
    this.busyKey = `${code}:${action}`;
    this._renderContent();
    try {
      const res = await fetch(`/api/admin/rooms/${encodeURIComponent(code)}/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.user.token}`,
        },
        body: JSON.stringify({ action, value }),
      });
      const json = await res.json();
      if (!res.ok) {
        this.onToast(json.error || 'No se pudo ejecutar la acción');
      } else {
        this.onToast('Acción aplicada');
        await this.fetchMetrics();
      }
    } catch {
      this.onToast('Error de conexión');
    } finally {
      this.busyKey = null;
      this._renderContent();
    }
  }

  async handleUserUpdate(email, patch) {
    if (!this.user?.token) return;
    this.busyKey = `user:${email}`;
    this._renderContent();
    try {
      const res = await fetch('/api/admin/users/role', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.user.token}`,
        },
        body: JSON.stringify({ email, ...patch }),
      });
      const json = await res.json();
      if (!res.ok) {
        this.onToast(json.error || 'No se pudo actualizar el usuario');
      } else {
        this.onToast('Usuario actualizado');
        await this.fetchMetrics();
      }
    } catch {
      this.onToast('Error de conexión');
    } finally {
      this.busyKey = null;
      this._renderContent();
    }
  }

  _renderShell() {
    this.mountEl.innerHTML = `
      <section class="sheet admin-sheet" role="dialog" aria-modal="true" aria-labelledby="sh">
        <button type="button" class="orb sm x" data-adm="close" aria-label="Cerrar">${iconClose()}</button>
        <h2 id="sh">Panel Admin Pro</h2>
        <p id="sp">Métricas en vivo · Cloudflare Pages Edge</p>
        <div id="admin-kpis"></div>
        <div class="admin-tabs" role="tablist" id="admin-tabs"></div>
        <div id="sf"></div>
        <div class="row2" style="margin-bottom:0">
          <button type="button" data-adm="refresh">Actualizar</button>
          <button type="button" data-adm="close">Cerrar</button>
        </div>
      </section>
    `;
    this._renderContent();
  }

  _renderContent() {
    if (!this._mounted) return;
    const kpiEl = this.mountEl.querySelector('#admin-kpis');
    const tabsEl = this.mountEl.querySelector('#admin-tabs');
    const bodyEl = this.mountEl.querySelector('#sf');
    if (!kpiEl || !tabsEl || !bodyEl) return;

    const d = this.data;
    kpiEl.innerHTML = d
      ? `<div class="kpi-grid">
          <div class="kpi-card"><small>Salas activas</small><b>${d.summary.activeRooms}</b></div>
          <div class="kpi-card"><small>En llamada</small><b>${d.summary.totalParticipants}</b></div>
          <div class="kpi-card"><small>Verificados</small><b>${d.summary.verifiedUsers}/${d.summary.registeredUsers}</b></div>
          <div class="kpi-card"><small>Mensajes / Uptime</small><b>${d.summary.totalMessages} · ${formatUptime(d.summary.uptimeSec)}</b></div>
        </div>`
      : '';

    tabsEl.innerHTML = `
      <button type="button" class="admin-tab ${this.tab === 'rooms' ? 'on' : ''}" data-adm-tab="rooms">Salas (${d?.rooms?.length ?? 0})</button>
      <button type="button" class="admin-tab ${this.tab === 'users' ? 'on' : ''}" data-adm-tab="users">Usuarios (${d?.users?.length ?? 0})</button>
      <button type="button" class="admin-tab ${this.tab === 'audit' ? 'on' : ''}" data-adm-tab="audit">Auditoría</button>
    `;

    const prevScroll = bodyEl.scrollTop;
    const dis = this.busyKey !== null ? 'disabled' : '';

    if (this.loading) {
      bodyEl.innerHTML = `<p>Cargando métricas en vivo…</p>`;
    } else if (this.error) {
      bodyEl.innerHTML = `<p style="color:var(--danger)">${esc(this.error)}</p>`;
    } else if (d && this.tab === 'rooms') {
      bodyEl.innerHTML =
        d.rooms.length === 0
          ? `<div class="admin-empty">No hay salas activas en este momento.</div>`
          : d.rooms
              .map(
                (r) => `
              <div class="admin-card">
                <div class="admin-card-head">
                  <div>
                    <b>${esc(r.code)}</b>
                    <small>Anfitrión: ${esc(r.hostName)} · ${r.participants} en línea${r.waiting > 0 ? ` · ${r.waiting} en espera` : ''} · ${r.messagesCount} msg</small>
                  </div>
                  <span class="admin-badge ${r.locked ? 'warn' : 'ok'}">${r.locked ? 'Bloqueada' : 'Abierta'}</span>
                </div>
                <div class="admin-actions">
                  <button type="button" class="orb sm ${r.locked ? 'active-mint' : ''}" ${dis} data-room-act="lock" data-code="${esc(r.code)}" data-val="${!r.locked}" title="${r.locked ? 'Abrir sala' : 'Bloquear sala'}">${iconLock(!r.locked)}</button>
                  <button type="button" class="orb sm ${r.waitingRoom ? 'active-mint' : ''}" ${dis} data-room-act="waitingRoom" data-code="${esc(r.code)}" data-val="${!r.waitingRoom}" title="Alternar sala de espera">${iconShield()}</button>
                  <button type="button" class="orb sm" ${dis} data-room-act="muteAll" data-code="${esc(r.code)}" title="Silenciar sala">${iconMuteAll()}</button>
                  <button type="button" class="orb sm rm" ${dis} data-room-act="endRoom" data-code="${esc(r.code)}" title="Cerrar sala">${iconLeave()}</button>
                </div>
              </div>`,
              )
              .join('');
    } else if (d && this.tab === 'users') {
      bodyEl.innerHTML = d.users
        .map((u) => {
          const isSelf = u.email.toLowerCase() === (this.user.email || '').toLowerCase();
          return `
            <div class="row">
              <i class="av">${esc((u.name || 'U').charAt(0).toUpperCase())}</i>
              <span>
                <b>${esc(u.name)} <span class="admin-badge ${u.role === 'admin' ? 'ok' : ''}">${u.role === 'admin' ? 'Admin' : 'Usuario'}</span></b>
                <small>${esc(u.email)} · ${u.verified ? 'Verificado' : 'Pendiente'} · ${esc(u.suiteCode)}</small>
              </span>
              ${!u.verified ? `<button type="button" class="orb sm" ${dis} data-user-verify="${esc(u.email)}" title="Verificar manualmente">${iconCheck()}</button>` : ''}
              ${!isSelf ? `<button type="button" class="orb sm ${u.role === 'admin' ? 'active-mint' : ''}" ${dis} data-user-role="${esc(u.email)}" data-next-role="${u.role === 'admin' ? 'user' : 'admin'}" title="${u.role === 'admin' ? 'Cambiar a usuario' : 'Promover a admin'}">${iconUsers()}</button>` : ''}
            </div>`;
        })
        .join('');
    } else if (d && this.tab === 'audit') {
      bodyEl.innerHTML =
        d.audit.length === 0
          ? `<div class="admin-empty">Sin eventos registrados todavía.</div>`
          : d.audit
              .map(
                (ev) => `
              <div class="row">
                <span>
                  <b>${esc(ev.detail)}</b>
                  <small>${esc(String(ev.type || '').toUpperCase())} · ${esc(ev.actor)} · ${esc(formatTime(ev.timestamp))}</small>
                </span>
              </div>`,
              )
              .join('');
    }
    bodyEl.scrollTop = prevScroll;
  }

  _bindEvents() {
    this.mountEl.addEventListener('click', (e) => {
      const admBtn = e.target.closest('[data-adm]');
      if (admBtn) {
        const a = admBtn.getAttribute('data-adm');
        if (a === 'close') this.onClose();
        else if (a === 'refresh') this.fetchMetrics();
        return;
      }
      const tabBtn = e.target.closest('[data-adm-tab]');
      if (tabBtn) {
        this.tab = tabBtn.getAttribute('data-adm-tab');
        this._renderContent();
        return;
      }
      const roomBtn = e.target.closest('[data-room-act]');
      if (roomBtn) {
        const action = roomBtn.getAttribute('data-room-act');
        const code = roomBtn.getAttribute('data-code');
        const rawVal = roomBtn.getAttribute('data-val');
        const val = rawVal === 'true' ? true : rawVal === 'false' ? false : undefined;
        this.handleRoomAction(code, action, val);
        return;
      }
      const verifyBtn = e.target.closest('[data-user-verify]');
      if (verifyBtn) {
        this.handleUserUpdate(verifyBtn.getAttribute('data-user-verify'), { verified: true });
        return;
      }
      const roleBtn = e.target.closest('[data-user-role]');
      if (roleBtn) {
        this.handleUserUpdate(roleBtn.getAttribute('data-user-role'), {
          role: roleBtn.getAttribute('data-next-role'),
        });
      }
    });
  }
}

function formatMessageTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export class ChatHudController {
  constructor(mountEl, { onSend, onTyping, onClose, onChangeTarget, onUpdateSettings, onPeerDepartedFallback }) {
    this.mountEl = mountEl;
    this.onSend = onSend;
    this.onTyping = onTyping;
    this.onClose = onClose;
    this.onChangeTarget = onChangeTarget;
    this.onUpdateSettings = onUpdateSettings;
    this.onPeerDepartedFallback = onPeerDepartedFallback;

    this.open = false;
    this.selfPeerId = null;
    this.peers = [];
    this.messages = [];
    this.typingPeers = [];
    this.chatTarget = null;
    this.settings = { opacity: 45, fontSize: 'md', soundEnabled: true, toastEnabled: true, accent: 'emerald' };

    this.settingsOpen = false;
    this.tabUnread = {};
    this.showNewBelow = false;
    this.kbInset = 0;
    this.vvHeight = null;
    this.isNearBottom = true;
    this.lastProcessedMsgId = null;
    this.justSent = false;
    this.typingTimeout = null;
    this.renderedMsgIds = [];
    this.lastRenderedTarget = '__init__';

    this._buildDom();
    this._syncViewport = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      this.kbInset = keyboard > 40 ? keyboard : 0;
      this.vvHeight = vv.height;
      this._applyHudStyle();
    };
  }

  _buildDom() {
    this.mountEl.innerHTML = `
      <div id="chatp" class="chat-hud" hidden>
        <div class="chat-hud-head">
          <div id="ctabs"></div>
          <div class="chat-head-acts">
            <button type="button" class="orb sm chat-icon-btn" id="chat-cfg-btn" aria-label="Ajustes del chat" title="Ajustes del chat">${iconSettings()}</button>
            <button type="button" class="orb sm chat-icon-btn" id="chat-cls-btn" aria-label="Cerrar chat">${iconClose()}</button>
          </div>
        </div>
        <div id="chat-settings-box" class="chat-settings" role="region" aria-label="Ajustes del chat" hidden></div>
        <div id="chat-body-box" style="display:flex;flex-direction:column;min-height:0;flex:1">
          <div class="msgs" id="msgs" aria-live="polite"></div>
          <div class="chat-typing" id="chat-typing" aria-live="polite" hidden>
            <span class="typing-dots"><i></i><i></i><i></i></span>
            <span id="chat-typing-txt"></span>
          </div>
          <button type="button" class="chat-jump" id="chat-jump" hidden>↓ Mensajes nuevos</button>
          <form class="cb" id="cb" autocomplete="off">
            <input id="ci" enterkeyhint="send" maxlength="500" aria-label="Mensaje" placeholder="Mensaje para toda la sala" />
            <button type="submit" class="orb sm" id="cs" aria-label="Enviar">${iconSend()}</button>
          </form>
        </div>
      </div>
    `;

    this.hudEl = this.mountEl.querySelector('#chatp');
    this.tabsEl = this.mountEl.querySelector('#ctabs');
    this.cfgBtn = this.mountEl.querySelector('#chat-cfg-btn');
    this.clsBtn = this.mountEl.querySelector('#chat-cls-btn');
    this.settingsBox = this.mountEl.querySelector('#chat-settings-box');
    this.bodyBox = this.mountEl.querySelector('#chat-body-box');
    this.msgsEl = this.mountEl.querySelector('#msgs');
    this.typingEl = this.mountEl.querySelector('#chat-typing');
    this.typingTxtEl = this.mountEl.querySelector('#chat-typing-txt');
    this.jumpBtn = this.mountEl.querySelector('#chat-jump');
    this.formEl = this.mountEl.querySelector('#cb');
    this.inputEl = this.mountEl.querySelector('#ci');

    this.clsBtn.addEventListener('click', () => this.onClose());
    this.cfgBtn.addEventListener('click', () => {
      this.settingsOpen = !this.settingsOpen;
      this._renderSettingsBox();
    });

    this.tabsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ctab]');
      if (!btn) return;
      const val = btn.getAttribute('data-ctab');
      this.onChangeTarget(val === '__sala__' ? null : val);
    });

    this.msgsEl.addEventListener('scroll', () => {
      const dist = this.msgsEl.scrollHeight - this.msgsEl.scrollTop - this.msgsEl.clientHeight;
      this.isNearBottom = dist < 72;
      if (this.isNearBottom && this.showNewBelow) {
        this.showNewBelow = false;
        this.jumpBtn.hidden = true;
      }
    });

    this.jumpBtn.addEventListener('click', () => {
      this.isNearBottom = true;
      this.showNewBelow = false;
      this.jumpBtn.hidden = true;
      this.msgsEl.scrollTo({ top: this.msgsEl.scrollHeight, behavior: 'smooth' });
    });

    this.inputEl.addEventListener('input', () => {
      const val = this.inputEl.value;
      if (val.trim().length > 0) {
        this.onTyping(true, this.chatTarget);
        if (this.typingTimeout) window.clearTimeout(this.typingTimeout);
        this.typingTimeout = window.setTimeout(() => {
          this.onTyping(false, this.chatTarget);
        }, 2200);
      } else {
        if (this.typingTimeout) window.clearTimeout(this.typingTimeout);
        this.onTyping(false, this.chatTarget);
      }
    });

    this.inputEl.addEventListener('blur', () => {
      this.onTyping(false, this.chatTarget);
    });

    this.formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      const trimmed = this.inputEl.value.trim();
      if (!trimmed) return;
      if (this.typingTimeout) window.clearTimeout(this.typingTimeout);
      this.justSent = true;
      this.onSend(trimmed, this.chatTarget);
      this.onTyping(false, this.chatTarget);
      this.inputEl.value = '';
    });

    this.settingsBox.addEventListener('input', (e) => {
      if (e.target.matches('[data-cs-opacity]')) {
        this.onUpdateSettings({ ...this.settings, opacity: Number(e.target.value) });
      }
    });

    this.settingsBox.addEventListener('change', (e) => {
      if (e.target.matches('[data-cs-sound]')) {
        this.onUpdateSettings({ ...this.settings, soundEnabled: Boolean(e.target.checked) });
      } else if (e.target.matches('[data-cs-toast]')) {
        this.onUpdateSettings({ ...this.settings, toastEnabled: Boolean(e.target.checked) });
      }
    });

    this.settingsBox.addEventListener('click', (e) => {
      const fsBtn = e.target.closest('[data-cs-fs]');
      if (fsBtn) {
        this.onUpdateSettings({ ...this.settings, fontSize: fsBtn.getAttribute('data-cs-fs') });
        return;
      }
      const acBtn = e.target.closest('[data-cs-acc]');
      if (acBtn) {
        this.onUpdateSettings({ ...this.settings, accent: acBtn.getAttribute('data-cs-acc') });
      }
    });
  }

  _applyHudStyle() {
    const accent = ACCENT_TOKENS[this.settings.accent] || ACCENT_TOKENS.emerald;
    const alpha = (this.settings.opacity / 100).toFixed(2);
    const fontSizeCss =
      this.settings.fontSize === 'sm' ? '0.82rem' : this.settings.fontSize === 'lg' ? '1.08rem' : '0.94rem';

    this.hudEl.style.background = `rgba(10, 15, 20, ${alpha})`;
    this.hudEl.style.bottom = this.kbInset > 0 ? `${this.kbInset + 10}px` : '';
    this.hudEl.style.maxHeight = this.vvHeight
      ? `${Math.max(200, Math.min(this.vvHeight * 0.54, 420))}px`
      : '';
    this.hudEl.style.setProperty('--chat-bubble-bg', accent.bg);
    this.hudEl.style.setProperty('--chat-bubble-border', accent.border);
    this.hudEl.style.setProperty('--chat-msg-size', fontSizeCss);
  }

  _renderSettingsBox() {
    this.cfgBtn.classList.toggle('active-mint', this.settingsOpen);
    this.settingsBox.hidden = !this.settingsOpen;
    this.bodyBox.style.display = this.settingsOpen ? 'none' : 'flex';
    if (!this.settingsOpen) return;

    this.settingsBox.innerHTML = `
      <div class="cs-row">
        <div class="cs-label"><b>Transparencia</b><span>${this.settings.opacity}%</span></div>
        <input type="range" min="20" max="85" step="5" value="${this.settings.opacity}" class="cs-slider" data-cs-opacity aria-label="Transparencia del fondo" />
      </div>
      <div class="cs-row">
        <div class="cs-label"><b>Tamaño de texto</b></div>
        <div class="cs-seg">
          ${[
            ['sm', 'Chico'],
            ['md', 'Normal'],
            ['lg', 'Grande'],
          ]
            .map(
              ([k, lbl]) =>
                `<button type="button" class="${this.settings.fontSize === k ? 'on' : ''}" data-cs-fs="${k}">${lbl}</button>`,
            )
            .join('')}
        </div>
      </div>
      <div class="cs-row">
        <div class="cs-label"><b>Color de tus burbujas</b></div>
        <div class="cs-accents">
          ${Object.keys(ACCENT_TOKENS)
            .map((k) => {
              const tok = ACCENT_TOKENS[k];
              return `<button type="button" class="cs-swatch ${this.settings.accent === k ? 'on' : ''}" data-cs-acc="${k}"><i style="background:${tok.swatch}"></i><span>${tok.label}</span></button>`;
            })
            .join('')}
        </div>
      </div>
      <div class="cs-switches">
        <label class="cs-switch">
          <span>Sonido de mensajes</span>
          <input type="checkbox" ${this.settings.soundEnabled ? 'checked' : ''} data-cs-sound />
        </label>
        <label class="cs-switch">
          <span>Vista previa flotante</span>
          <input type="checkbox" ${this.settings.toastEnabled ? 'checked' : ''} data-cs-toast />
        </label>
      </div>
    `;
  }

  update({ open, selfPeerId, peers, messages, typingPeers, chatTarget, settings }) {
    const prevOpen = this.open;
    this.open = open;
    this.selfPeerId = selfPeerId;
    this.peers = peers || [];
    this.messages = messages || [];
    this.typingPeers = typingPeers || [];
    this.chatTarget = chatTarget || null;
    this.settings = settings;

    if (prevOpen !== open) {
      const vv = window.visualViewport;
      if (open) {
        if (vv) {
          this._syncViewport();
          vv.addEventListener('resize', this._syncViewport);
          vv.addEventListener('scroll', this._syncViewport);
        }
        this.isNearBottom = true;
        this.showNewBelow = false;
        this.jumpBtn.hidden = true;
      } else {
        if (vv) {
          vv.removeEventListener('resize', this._syncViewport);
          vv.removeEventListener('scroll', this._syncViewport);
        }
        this.kbInset = 0;
        this.vvHeight = null;
        this.settingsOpen = false;
      }
    }

    this.hudEl.hidden = !open;
    this._applyHudStyle();

    const remotePeers = this.peers.filter((p) => p.peerId !== this.selfPeerId);
    if (this.chatTarget && !remotePeers.some((p) => p.peerId === this.chatTarget)) {
      this.onChangeTarget(null);
      this.onPeerDepartedFallback?.();
      return;
    }

    const activeTabKey = this.chatTarget || '__sala__';
    if (this.messages.length > 0) {
      let startIdx = 0;
      if (this.lastProcessedMsgId) {
        const idx = this.messages.findIndex((m) => m.id === this.lastProcessedMsgId);
        startIdx = idx >= 0 ? idx + 1 : 0;
      }
      const newlyArrived = this.messages.slice(startIdx);
      this.lastProcessedMsgId = this.messages[this.messages.length - 1].id;
      for (const m of newlyArrived) {
        if (m.fromPeerId === this.selfPeerId) continue;
        const tabKey = m.toPeerId ? m.fromPeerId : '__sala__';
        if (!open || tabKey !== activeTabKey) {
          this.tabUnread[tabKey] = (this.tabUnread[tabKey] || 0) + 1;
        }
      }
    }
    if (open && this.tabUnread[activeTabKey]) {
      delete this.tabUnread[activeTabKey];
    }

    // Tabs
    const tabsHtml = [
      `<button type="button" class="ct ${this.chatTarget === null ? 'a' : ''}" data-ctab="__sala__">Sala${
        (this.tabUnread.__sala__ || 0) > 0 ? `<i class="ct-bdg">${this.tabUnread.__sala__}</i>` : ''
      }</button>`,
      ...remotePeers.map((p) => {
        const unread = this.tabUnread[p.peerId] || 0;
        return `<button type="button" class="ct ${this.chatTarget === p.peerId ? 'a' : ''}" data-ctab="${esc(p.peerId)}">${esc(p.name)}${
          unread > 0 ? `<i class="ct-bdg">${unread}</i>` : ''
        }</button>`;
      }),
    ].join('');
    if (this.tabsEl._lastHtml !== tabsHtml) {
      this.tabsEl.innerHTML = tabsHtml;
      this.tabsEl._lastHtml = tabsHtml;
    }

    if (this.settingsOpen) {
      this._renderSettingsBox();
    } else {
      this.settingsBox.hidden = true;
      this.bodyBox.style.display = 'flex';
    }

    const visibleMessages = this.messages.filter((m) => {
      if (!this.chatTarget) return !m.toPeerId;
      return (
        (m.fromPeerId === this.selfPeerId && m.toPeerId === this.chatTarget) ||
        (m.fromPeerId === this.chatTarget && m.toPeerId === this.selfPeerId)
      );
    });

    const targetName = this.chatTarget
      ? remotePeers.find((p) => p.peerId === this.chatTarget)?.name || ''
      : '';

    const desiredPlaceholder = this.chatTarget
      ? `Mensaje privado a ${targetName}`
      : 'Mensaje para toda la sala';
    if (this.inputEl.placeholder !== desiredPlaceholder) {
      this.inputEl.placeholder = desiredPlaceholder;
    }

    const msgIds = visibleMessages.map((m) => m.id);
    const sameTarget = this.lastRenderedTarget === activeTabKey;
    const sameList =
      sameTarget &&
      msgIds.length === this.renderedMsgIds.length &&
      msgIds.every((id, i) => id === this.renderedMsgIds[i]);

    if (!sameList) {
      this.lastRenderedTarget = activeTabKey;
      this.renderedMsgIds = msgIds;
      if (visibleMessages.length === 0) {
        this.msgsEl.innerHTML = `<div class="chat-empty-hint">${
          this.chatTarget ? `Chat privado con ${esc(targetName)}.` : 'Aún no hay mensajes.'
        }</div>`;
      } else {
        this.msgsEl.innerHTML = visibleMessages
          .map((m) => {
            const isSelf = m.fromPeerId === this.selfPeerId;
            return `<div class="msg ${isSelf ? 'me' : ''}"><small>${
              isSelf ? 'Tú' : esc(m.fromName)
            } · ${esc(formatMessageTime(m.timestamp))}</small><span>${renderLinkedTextHtml(m.text)}</span></div>`;
          })
          .join('');
      }
      if (open) {
        if (!prevOpen || this.justSent || this.isNearBottom) {
          this.justSent = false;
          this.showNewBelow = false;
          this.jumpBtn.hidden = true;
          requestAnimationFrame(() => {
            this.msgsEl.scrollTop = this.msgsEl.scrollHeight;
          });
        } else if (visibleMessages.length > 0) {
          this.showNewBelow = true;
          this.jumpBtn.hidden = false;
        }
      }
    } else if (open && !prevOpen) {
      requestAnimationFrame(() => {
        this.msgsEl.scrollTop = this.msgsEl.scrollHeight;
      });
    }

    const relevantTyping = this.typingPeers.filter((tp) => {
      if (!this.chatTarget) return !tp.toPeerId;
      return tp.peerId === this.chatTarget && tp.toPeerId === this.selfPeerId;
    });
    let typingText = null;
    if (relevantTyping.length === 1) typingText = `${relevantTyping[0].name} está escribiendo…`;
    else if (relevantTyping.length === 2)
      typingText = `${relevantTyping[0].name} y ${relevantTyping[1].name} están escribiendo…`;
    else if (relevantTyping.length > 2)
      typingText = `${relevantTyping.length} personas están escribiendo…`;

    if (typingText) {
      this.typingEl.hidden = false;
      this.typingTxtEl.textContent = typingText;
    } else {
      this.typingEl.hidden = true;
    }
  }

  destroy() {
    if (this.typingTimeout) window.clearTimeout(this.typingTimeout);
    const vv = window.visualViewport;
    if (vv) {
      vv.removeEventListener('resize', this._syncViewport);
      vv.removeEventListener('scroll', this._syncViewport);
    }
  }
}

export function renderRoomSheetHtml(sheet, ctx) {
  if (sheet === 'people') {
    const { peers, self, roomCapacity, isRoomFull, orderedPeers, kickArmedId } = ctx;
    const isHost = self?.role === 'host';
    return `
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh">
        <button type="button" class="orb sm x" data-act="close" aria-label="Cerrar">${iconClose()}</button>
        <h2 id="sh">Participantes · ${peers.length}/${roomCapacity}</h2>
        <p id="sp">${isHost ? 'Silencia con el micrófono o quita con la x (dos toques).' : 'Quién está en la sala.'}</p>
        <div id="sf">
          ${
            isHost
              ? `<div class="row">
                  <span><b>Invitar</b><small>${
                    isRoomFull ? `Capacidad máxima (${roomCapacity}) alcanzada` : 'Código, clave o enlace'
                  }</small></span>
                  <button type="button" class="orb sm" ${isRoomFull ? 'disabled' : ''} data-act="open-invite" aria-label="Invitar">${iconShare()}</button>
                </div>`
              : ''
          }
          ${orderedPeers
            .map((p) => {
              const isMe = p.peerId === self?.peerId;
              return `
                <div class="row">
                  <i class="av" style="background:${getPeerTint(p.peerId)}">${esc(p.initial)}</i>
                  <span>
                    <b>${isMe ? 'Tú' : esc(p.name)}</b>
                    <small>${p.role === 'host' ? 'Anfitrión' : 'En línea'}${p.handRaised ? ' · Mano levantada' : ''}</small>
                  </span>
                  ${!isMe ? `<button type="button" class="orb sm" data-dm="${esc(p.peerId)}" aria-label="Chat privado con ${esc(p.name)}">${iconChat()}</button>` : ''}
                  ${
                    isHost && !isMe
                      ? `<button type="button" class="orb sm tg" aria-pressed="${Boolean(p.micOn)}" data-mute="${esc(p.peerId)}" aria-label="Silenciar a ${esc(p.name)}">${iconMic(!p.micOn)}</button>
                         <button type="button" class="orb sm rm ${kickArmedId === p.peerId ? 'arm' : ''}" data-kick="${esc(p.peerId)}" data-kick-name="${esc(p.name)}" aria-label="Quitar a ${esc(p.name)}">${iconClose()}</button>`
                      : ''
                  }
                </div>`;
            })
            .join('')}
        </div>
      </section>
    `;
  }

  if (sheet === 'view') {
    const { effectiveMode, viewMode, fitContain, screenSharing } = ctx;
    const canDisplay = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);
    return `
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh">
        <button type="button" class="orb sm x" data-act="close" aria-label="Cerrar">${iconClose()}</button>
        <h2 id="sh">Vista</h2>
        <p id="sp">Elige cómo ver la sala.</p>
        <div id="sf">
          <div class="row">
            <span><b>Todos juntos</b><small>Cuadrícula adaptable (4 por página en grupos)</small></span>
            <button type="button" class="orb sm ${effectiveMode === 'grid' ? 'active-mint' : ''}" data-view="grid">${iconGrid()}</button>
          </div>
          <div class="row">
            <span><b>Mi cámara flotante</b><small>Modo 1:1 Pro con PiP en cualquier esquina</small></span>
            <button type="button" class="orb sm ${effectiveMode === 'stage-pip' ? 'active-mint' : ''}" data-view="pip">${iconPip()}</button>
          </div>
          <div class="row">
            <span><b>Imagen completa</b><small>Ver cámara completa sin recortar</small></span>
            <button type="button" class="orb sm ${viewMode === 'fullscreen' || fitContain ? 'active-mint' : ''}" data-view="full">${iconFit()}</button>
          </div>
          <div class="row">
            <span><b>Intercambiar cámaras</b><small>Alterna entre tu cámara y el invitado</small></span>
            <button type="button" class="orb sm active-mint" data-view="swap">${iconSwap()}</button>
          </div>
          ${
            canDisplay
              ? `<div class="row">
                  <span><b>Compartir mi pantalla</b><small>Pantalla completa, una ventana o una pestaña</small></span>
                  <button type="button" class="orb sm ${screenSharing ? 'active-mint' : ''}" data-view="screen">${iconShare()}</button>
                </div>`
              : ''
          }
          <div class="row">
            <span><b>Enviar una onda</b><small>Aviso luminoso para toda la sala</small></span>
            <button type="button" class="orb sm" data-view="wave">${iconWave()}</button>
          </div>
        </div>
      </section>
    `;
  }

  if (sheet === 'mod') {
    const { meta, endRoomArmed } = ctx;
    const locked = Boolean(meta?.locked);
    const waitingRoom = Boolean(meta?.waitingRoom);
    return `
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh">
        <button type="button" class="orb sm x" data-act="close" aria-label="Cerrar">${iconClose()}</button>
        <h2 id="sh">Sala</h2>
        <p id="sp">Solo el anfitrión ve esto.</p>
        <div id="sf">
          <div class="row">
            <span><b>Silenciar a todos</b><small>Los participantes pueden volver a activarse</small></span>
            <button type="button" class="orb sm" data-mod="muteAll">${iconMuteAll()}</button>
          </div>
          <div class="row">
            <span><b>Bloquear la sala</b><small>Nadie más puede entrar</small></span>
            <button type="button" class="orb sm ${locked ? 'active-mint' : ''}" data-mod="lock">${iconLock(!locked)}</button>
          </div>
          <div class="row">
            <span><b>Sala de espera</b><small>Aprobar manualmente a cada invitado</small></span>
            <button type="button" class="orb sm ${waitingRoom ? 'active-mint' : ''}" data-mod="waitingRoom">${iconShield()}</button>
          </div>
          <div class="row">
            <span><b style="color:var(--danger)">Terminar sala para todos</b><small>Saca a todos y cierra la sala</small></span>
            <button type="button" class="orb sm rm ${endRoomArmed ? 'arm' : ''}" data-mod="endRoom">${iconLeave()}</button>
          </div>
        </div>
      </section>
    `;
  }

  if (sheet === 'acct') {
    const { self, user, nameInput, editingName, draftName } = ctx;
    const displayName = self?.name || nameInput || 'Invitado';
    return `
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh">
        <button type="button" class="orb sm x" data-act="close" aria-label="Cerrar">${iconClose()}</button>
        <h2 id="sh">${esc(self?.name || 'Mi cuenta')}</h2>
        <p id="sp">${esc(user?.plan || (self?.role === 'host' ? 'Anfitrión' : 'Invitado'))}</p>
        <div id="sf">
          <div class="row">
            <span>
              <b>Nombre en las salas</b>
              <small>${editingName ? 'Mínimo 2 caracteres' : `Ahora: ${esc(displayName)}`}</small>
            </span>
            <button type="button" class="orb sm" data-act="${editingName ? 'cancel-name' : 'edit-name'}" aria-label="${
              editingName ? 'Cancelar edición' : 'Editar nombre'
            }">${editingName ? iconClose() : iconUsers()}</button>
          </div>
          ${
            editingName
              ? `<form id="room-name-form" style="display:flex;gap:8px;margin-top:4px;margin-bottom:8px">
                  <input id="room-draft-name" type="text" maxlength="24" value="${esc(draftName)}" placeholder="Tu nombre" style="flex:1;min-width:0;padding:10px 12px;border-radius:12px;border:1px solid var(--ln);background:var(--s2);color:var(--moon);font:500 0.92rem var(--sys);outline:none" />
                  <button type="submit" style="padding:0 14px;border-radius:12px;border:0;background:var(--green);color:var(--ink);font:600 0.88rem var(--sys);cursor:pointer">Guardar</button>
                </form>`
              : ''
          }
          <div class="row">
            <span><b>Compartir la app</b><small>Envía el enlace por WhatsApp, Telegram o X</small></span>
            <button type="button" class="orb sm" data-act="switch-app">${iconShare()}</button>
          </div>
          <div class="row">
            <span><b>Reconectar cámara y micrófono</b><small>Si cambiaste permisos o dispositivos</small></span>
            <button type="button" class="orb sm" data-act="retry-media">${iconCam()}</button>
          </div>
        </div>
      </section>
    `;
  }

  if (sheet === 'install') {
    return `
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sh">
        <button type="button" class="orb sm x" data-act="close" aria-label="Cerrar">${iconClose()}</button>
        <h2 id="sh">Instalar spaceSUITE</h2>
        <p id="sp">Se instala en un momento y queda como una app en tu pantalla de inicio.</p>
        <div id="sf">
          <div class="kv st"><span>1</span><b>Menú del navegador / Compartir</b></div>
          <div class="kv st"><span>2</span><b>Añadir a pantalla de inicio / Instalar app</b></div>
        </div>
      </section>
    `;
  }

  return '';
}

export function renderQuickPeekHtml(peer, selfPeerId) {
  if (!peer) return '';
  return `
    <div class="pv" id="pv"></div>
    <div class="pm">
      <div>
        <b>${esc(peer.name)}</b>
        <span>${peer.role === 'host' ? 'Anfitrión' : 'En línea'}</span>
      </div>
      <div class="a">
        ${
          peer.peerId !== selfPeerId
            ? `<button type="button" class="orb" data-pk="wave" aria-label="Enviar una onda">${iconWave()}</button>`
            : ''
        }
        <button type="button" class="orb" data-pk="full" aria-label="Ver en grande">${iconFit()}</button>
        <button type="button" class="orb" data-pk="close" aria-label="Cerrar">${iconClose()}</button>
      </div>
    </div>
  `;
}
