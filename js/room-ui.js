import {
  esc,
  formatDuration,
  getPeerTint,
  iconBack,
  iconBroadcastPro,
  iconCam,
  iconCameraFlip,
  iconCards,
  iconClose,
  iconFit,
  iconHand,
  iconInvite,
  iconLeave,
  iconLock,
  iconMenu,
  iconMic,
  iconNext,
  iconPalette,
  iconPause,
  iconPlay,
  iconPoll,
  iconPrev,
  iconReaction,
  iconShare,
  iconSparkles,
  iconSubtitles,
  iconSuperKey,
  iconTimer,
  iconUsers,
  iconWave,
  iconWifi,
  playSound,
  playSpatialHeartbeatSound,
} from './icons.js';
import {
  addLatidos,
  buildRoomInviteUrl,
  getPurchasedPerks,
  getStoredName,
  loadChatSettings,
  saveChatSettings,
  setStoredName,
} from './identity.js';
import { LocalMediaBroadcaster, clearPlaylistItems } from './media-playlist.js';
import { RoomEngine, VIEWER_CAM_CONSTRAINTS } from './rtc.js';
import {
  AdminPanelController,
  ChatHudController,
  SuperKeyController,
  bindMiniTiendaEvents,
  bindShareSheetEvents,
  renderMiniTiendaHtml,
  renderQuickPeekHtml,
  renderRoomSheetHtml,
  renderShareSheetHtml,
} from './sheets.js';

const VIDEO_FILTERS = [
  { id: 'natural', label: 'Original' },
  { id: 'emerald', label: 'Cine' },
  { id: 'noir', label: 'Obsidiana' },
  { id: 'amber', label: 'Ámbar' },
  { id: 'soft', label: 'Retrato' },
];

const AMBIENT_MOODS = [
  { id: 'cosmos', label: 'Cosmos' },
  { id: 'emerald', label: 'Esmeralda' },
  { id: 'amber', label: 'Ámbar' },
  { id: 'indigo', label: 'Índigo' },
];

const REACTIONS = [
  { id: 'pulse', label: 'Pulso' },
  { id: 'spark', label: 'Destello' },
  { id: 'orbit', label: 'Órbita' },
  { id: 'heart', label: 'Latido' },
  { id: 'toast', label: 'Brindis' },
];

const SPACE_CARDS = [
  { category: 'Carta Cósmica', prompt: '¿Cuál fue el mejor aprendizaje o logro que tuviste esta semana?' },
  { category: 'Rompehielos', prompt: 'Si pudiéramos teletransportar esta reunión a cualquier lugar, ¿a dónde iríamos?' },
  { category: 'Visión', prompt: '¿Qué proyecto o idea te emociona más impulsar en los próximos 30 días?' },
  { category: 'Pulso', prompt: 'Describe cómo llega tu energía hoy usando una sola palabra y el porqué.' },
  { category: 'Enfoque', prompt: '¿Qué obstáculo podríamos resolver hoy juntos en menos de 10 minutos?' },
  { category: 'Creatividad', prompt: 'Si lanzaras una función nueva mañana sin límites técnicos, ¿cuál sería?' },
  { category: 'Conexión', prompt: '¿A quién del grupo te gustaría agradecer o reconocer algo hoy?' },
  { category: 'Reto', prompt: 'Comparte un hábito reciente que haya mejorado tu concentración.' },
  { category: 'Carta Cósmica', prompt: '¿Qué canción o sonido definiría el ritmo de tu semana?' },
  { category: 'Decisiones', prompt: '¿Qué es lo más importante que debemos cerrar antes de terminar esta llamada?' },
];

export class RoomController {
  constructor(mountEl, { initialRoomCode, initialPass, initialName, wantHost, user, broadcastHub, onExitHome, onNewRoom, onUpdateUserName }) {
    this.mountEl = mountEl;
    this.initialRoomCode = initialRoomCode;
    this.initialPass = initialPass || '';
    this.wantHost = Boolean(wantHost);
    this.user = user;
    this.broadcastHub = broadcastHub || null;
    this.onExitHome = onExitHome;
    this.onNewRoom = onNewRoom;
    this.onUpdateUserName = onUpdateUserName;

    this.nameInput = initialName || user?.name || getStoredName('');
    this.passInput = initialPass || '';
    // Microphones are strictly disabled and locked across the 20-user group room
    this.preMicOn = false;
    this.preCamOn = true;
    this.previewStream = null;
    this.permState = 'checking';
    this.permError = null;
    this.handedOffPreview = false;

    this.fitContain = true;
    this.carouselPage = 0;
    this.carouselTiles = new Map();
    this._stageAudioNeedsUnlock = false;

    this.silentMode = false;
    this.sheet = null;
    this.peekPeer = null;

    this.chatTarget = null;
    this.chatSettings = loadChatSettings();

    this.leaveArmed = false;
    this.leaveTimer = null;
    this.endRoomArmed = false;
    this.endRoomTimer = null;
    this.kickArmedId = null;
    this.kickTimer = null;

    this.toastText = null;
    this.toastTimer = null;
    this.waveGlow = false;
    this.elapsedSec = 0;
    this.finalDurationSec = 0;
    this.endTitle = 'Hasta pronto';
    this.editingName = false;
    this.draftName = '';
    this.backVisible = false;
    this.backTimer = null;
    this.logoRefreshing = false;
    this.viewport = { w: window.innerWidth, h: window.innerHeight };

    this.lastHandledWaveId = null;
    this.lastHandledReactionId = null;
    this.lastHandledSubtitleId = null;
    this.localFilter = 'natural';
    this.studioOpen = false;
    this.studioTab = 'reactions';
    this.hideInteractiveLocally = false;
    this._lastInteractiveKey = '';
    this._lastInteractiveHtml = '';
    this._lastStudioSig = '';
    this.pollDraftQuestion = '';
    this.pollDraftOptA = '';
    this.pollDraftOptB = '';

    this.lastRefreshAt = 0;
    this.touchStart = null;
    this.didSwipeRefresh = false;

    this.subtitlesActive = false;
    this.speechRecognizer = null;
    this.subtitleClearTimer = null;
    this.activePerks = getPurchasedPerks();

    this.wakeLock = null;
    this._elapsedStart = null;
    this._elapsedIv = null;
    this._prevWaitingCount = 0;
    this._prevStatus = 'idle';
    this._destroyed = false;
    this._lastMediaNotice = null;
    this._lastJoinSeen = null;
    this._debugEl = null;
    this._debugIv = null;
    this.adminCtrl = null;
    this._lastSheetSig = '';
    this._lastPeekSig = '';
    this._lastUiSig = '';
    this._lastStageHudSig = '';
    this._lastEmitterBarSig = '';
    this._lastCarouselSig = '';
    this._carouselScrollRaf = null;

    if (this.broadcastHub) {
      this.mediaBroadcaster = this.broadcastHub.broadcaster;
      this._unsubBroadcastHub = this.broadcastHub.subscribe(() => this._onMediaBroadcasterChange());
      this.broadcastHub.hydratePlaylist().catch(() => {});
    } else {
      this.mediaBroadcaster = new LocalMediaBroadcaster(() => this._onMediaBroadcasterChange());
      this._unsubBroadcastHub = null;
      this.mediaBroadcaster.loadStoredPlaylist().catch(() => {});
    }

    this._buildScaffold();
    this.engine = new RoomEngine(() => this._onEngineChange());
    this._setupDebugPanel();
    this._bindEvents();
    this._requestPreJoinPermissions();
    this._renderAll();
  }

  _buildScaffold() {
    this.mountEl.innerHTML = `
      <div id="room-root">
        <div class="stage-mood" id="stage-mood" aria-hidden="true"></div>
        <div id="room-prejoin-slot"></div>
        <div id="room-wait-slot"></div>

        <div id="ss-workspace" class="ss-workspace" hidden>
          <section id="ss-stage-pane" class="ss-stage-pane" aria-label="Escenario Principal">
            <video id="ss-stage-vid" autoplay playsinline></video>
            <div id="ss-stage-standby" class="ss-stage-standby" hidden>
              <span class="ss-led is-wait"></span>
              <b id="ss-stage-standby-title">Preparando transmisión privada…</b>
              <small id="ss-stage-standby-sub">La señal permanece en negro hasta recibir el primer cuadro.</small>
            </div>
            <div id="ss-stage-idle" class="ss-stage-idle">
              <div class="ss-stage-idle-badge"><i class="ss-led"></i><span>Escenario en espera</span></div>
              <b id="ss-stage-idle-title">Sin transmisión activa</b>
              <small id="ss-stage-idle-sub">1 emisor exclusivo · hasta 19 espectadores con cámara</small>
              <button type="button" class="ss-stage-cta" id="ss-stage-open-bc">
                ${iconBroadcastPro(false)}
                <span>Abrir Centro de Transmisión</span>
              </button>
            </div>
            <div id="ss-stage-hud" class="ss-stage-hud" hidden>
              <span class="ss-live-badge"><i class="ss-led is-live"></i><b id="ss-stage-badge-txt">EN VIVO</b></span>
              <span class="ss-stage-meta" id="ss-stage-meta"></span>
            </div>
            <button type="button" class="ss-audio-unlock" id="ss-audio-unlock" hidden>Tocar para activar audio</button>
            <div id="ss-stage-emitter-bar" class="ss-stage-emitter-bar" hidden></div>
          </section>

          <section id="ss-carousel-pane" class="ss-carousel-pane" aria-label="Cámaras de espectadores">
            <div id="ss-carousel-empty" class="ss-carousel-empty" hidden></div>
            <div id="ss-carousel-track" class="ss-carousel-track"></div>
            <div id="ss-carousel-dots" class="ss-carousel-dots" hidden></div>
          </section>

          <section id="ss-chat-pane" class="ss-chat-pane" aria-label="Chat en vivo">
            <div id="room-chat-slot"></div>
          </section>
        </div>

        <div id="interactive-stage" aria-live="polite" hidden></div>
        <div class="pill" id="pill">${iconWifi()}<span>Conexión inestable</span></div>
        <div id="live-subtitles" class="live-subtitles-bar" aria-live="polite"></div>
        <div id="heartbeat-vignette-slot"></div>
        <div id="note" role="status" aria-live="polite"></div>
        <div class="ui" id="ui" hidden></div>
        <div id="modal">
          <div class="veil" id="veil"></div>
          <div id="room-sheet-slot"></div>
          <section class="pk" id="pk" role="dialog" aria-modal="true" aria-label="Vista rápida"></section>
        </div>
        <div id="room-studio-slot"></div>
        <div id="room-reactions" aria-hidden="true"></div>
        <div class="glow" id="glow" aria-hidden="true"></div>
        <div id="room-ripples"></div>
        <div class="toast" id="toast" role="status" aria-live="polite"></div>
        <div id="back-shield" aria-hidden="true" hidden></div>
        <button type="button" class="back-pill" id="back-pill" aria-label="Atrás" hidden>${iconBack()}Atrás</button>
        <div class="end" id="end" hidden>
          <img src="/assets/logo-icon.png" alt="SPACE SUITE" width="76" height="76" style="border-radius:18px" />
          <h2 id="end-title">Hasta pronto</h2>
          <p id="dur">Duración · 00:00</p>
          <div class="bs">
            <button class="tr-b p" id="rejoin" type="button">Volver a entrar</button>
            <button class="tr-b" id="mine" type="button" hidden>Iniciar mi propia SUITE</button>
            <button class="tr-g" id="home" type="button">Ir al inicio</button>
          </div>
        </div>
      </div>
    `;

    this.rootEl = this.mountEl.querySelector('#room-root');
    this.prejoinSlot = this.mountEl.querySelector('#room-prejoin-slot');
    this.waitSlot = this.mountEl.querySelector('#room-wait-slot');
    this.workspaceEl = this.mountEl.querySelector('#ss-workspace');
    this.stagePaneEl = this.mountEl.querySelector('#ss-stage-pane');
    this.stageVidEl = this.mountEl.querySelector('#ss-stage-vid');
    this.stageStandbyEl = this.mountEl.querySelector('#ss-stage-standby');
    this.stageStandbyTitleEl = this.mountEl.querySelector('#ss-stage-standby-title');
    this.stageStandbySubEl = this.mountEl.querySelector('#ss-stage-standby-sub');
    this.stageIdleEl = this.mountEl.querySelector('#ss-stage-idle');
    this.stageHudEl = this.mountEl.querySelector('#ss-stage-hud');
    this.stageBadgeTxtEl = this.mountEl.querySelector('#ss-stage-badge-txt');
    this.stageMetaEl = this.mountEl.querySelector('#ss-stage-meta');
    this.stageAudioUnlockBtn = this.mountEl.querySelector('#ss-audio-unlock');
    this.stageEmitterBarEl = this.mountEl.querySelector('#ss-stage-emitter-bar');

    this.carouselPaneEl = this.mountEl.querySelector('#ss-carousel-pane');
    this.carouselEmptyEl = this.mountEl.querySelector('#ss-carousel-empty');
    this.carouselTrackEl = this.mountEl.querySelector('#ss-carousel-track');
    this.carouselDotsEl = this.mountEl.querySelector('#ss-carousel-dots');

    this.interactiveStageEl = this.mountEl.querySelector('#interactive-stage');
    this.noteEl = this.mountEl.querySelector('#note');
    this.uiEl = this.mountEl.querySelector('#ui');
    this.sheetSlot = this.mountEl.querySelector('#room-sheet-slot');
    this.pkEl = this.mountEl.querySelector('#pk');
    this.studioSlot = this.mountEl.querySelector('#room-studio-slot');
    this.reactionsEl = this.mountEl.querySelector('#room-reactions');
    this.glowEl = this.mountEl.querySelector('#glow');
    this.ripplesEl = this.mountEl.querySelector('#room-ripples');
    this.toastEl = this.mountEl.querySelector('#toast');
    this.backShieldEl = this.mountEl.querySelector('#back-shield');
    this.backPillEl = this.mountEl.querySelector('#back-pill');
    this.endEl = this.mountEl.querySelector('#end');

    this.chatHud = new ChatHudController(this.mountEl.querySelector('#room-chat-slot'), {
      embedded: true,
      onSend: (text, to) => this.engine.sendChat(text, to),
      onTyping: (t, to) => this.engine.notifyTyping(t, to),
      onClose: () => {},
      onChangeTarget: (id) => {
        this.chatTarget = id;
        this._renderChat();
      },
      onUpdateSettings: (next) => {
        this.chatSettings = next;
        saveChatSettings(next);
        this._renderChat();
      },
      onPeerDepartedFallback: () => this.showToast('El participante salió · volviendo al chat de sala'),
    });
  }

  _showToast(msg) {
    this.toastText = msg;
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('v');
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastText = null;
      this.toastEl.classList.remove('v');
    }, 2600);
  }
  showToast(msg) {
    this._showToast(msg);
  }

  _setVideoStream(videoEl, stream, { muted = false, mirror = false, filterId = '', onBlockedAudio = null } = {}) {
    if (!videoEl) return;
    if (videoEl.muted !== muted) videoEl.muted = muted;
    videoEl.style.transform = mirror ? 'scaleX(-1)' : 'none';
    for (const f of VIDEO_FILTERS) {
      videoEl.classList.toggle(`vf-${f.id}`, Boolean(filterId && filterId === f.id));
    }
    if (videoEl.srcObject !== (stream || null)) {
      videoEl.srcObject = stream || null;
      if (stream) {
        videoEl.play().catch((err) => {
          if (!muted && err?.name === 'NotAllowedError') {
            videoEl.muted = true;
            videoEl.play().catch(() => {});
            onBlockedAudio?.();
          }
        });
      }
    } else if (stream && videoEl.paused) {
      videoEl.play().catch(() => {});
    }
  }

  _detachVideoEl(videoEl) {
    if (!videoEl) return;
    if (videoEl.srcObject) {
      try {
        videoEl.pause();
      } catch {
        // ignore
      }
      videoEl.srcObject = null;
    }
  }

  async _acquireWakeLock() {
    if (this._destroyed || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    if (this.wakeLock || document.visibilityState !== 'visible') return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener?.('release', () => {
        this.wakeLock = null;
      });
    } catch {
      this.wakeLock = null;
    }
  }

  _releaseWakeLock() {
    if (!this.wakeLock) return;
    try {
      this.wakeLock.release().catch(() => {});
    } catch {
      // ignore
    }
    this.wakeLock = null;
  }

  _stopPreviewStream() {
    if (this.previewStream) {
      this.previewStream.getTracks().forEach((t) => t.stop());
      this.previewStream = null;
    }
  }

  async _requestPreJoinPermissions() {
    this.permState = 'checking';
    this.permError = null;
    this._updatePreJoinDynamic();
    if (!navigator.mediaDevices?.getUserMedia) {
      this.previewStream = null;
      this.preCamOn = false;
      this.preMicOn = false;
      this.permState = 'ready';
      this.permError = 'Sin acceso a cámara · entrarás como espectador en chat y escenario.';
      this._updatePreJoinDynamic();
      return;
    }
    try {
      if (this.previewStream && !this.handedOffPreview) {
        this.previewStream.getTracks().forEach((t) => t.stop());
      }
      this.handedOffPreview = false;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...VIEWER_CAM_CONSTRAINTS,
          facingMode: 'user',
        },
      });
      stream.getVideoTracks().forEach((t) => {
        t.enabled = this.preCamOn;
      });
      this.previewStream = stream;
      this.permState = 'ready';
      this.permError = null;
    } catch {
      this.previewStream = null;
      this.preCamOn = false;
      this.preMicOn = false;
      this.permState = 'ready';
      this.permError = 'Sin cámara disponible · podrás ver el escenario y usar el chat en vivo.';
    }
    this._updatePreJoinDynamic();
  }

  _isCamActiveForJoin() {
    return (
      this.permState === 'ready' &&
      this.preCamOn &&
      Boolean(this.previewStream?.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled))
    );
  }

  _onMediaBroadcasterChange() {
    if (this._destroyed) return;
    const snap = this.mediaBroadcaster.getSnapshot();
    const st = this.engine.state;
    const isSelfEmitter = st.meta?.emitterPeerId === st.self?.peerId;

    if (isSelfEmitter && st.meta?.broadcast?.sourceType === 'media' && snap.activeItem?.name) {
      if (st.meta?.broadcast?.mediaTitle !== snap.activeItem.name) {
        this.engine.updateBroadcastTitle(snap.activeItem.name);
      }
    }

    if (this.sheet === 'broadcast') {
      const nextStructSig = [
        snap.items.map((it) => it.id).join(','),
        snap.activeIndex,
        snap.playing,
        snap.loop,
        st.meta?.emitterPeerId || '',
        st.meta?.broadcast?.status || 'idle',
        st.meta?.broadcast?.sourceType || 'none',
        Boolean(st.broadcastStream),
      ].join('|');

      if (nextStructSig === this._lastBroadcastSheetStructSig) {
        const timeEl = this.sheetSlot.querySelector('.ss-tx-time');
        if (timeEl) {
          timeEl.textContent = `${formatDuration(snap.currentTime)} / ${formatDuration(snap.duration)}`;
        }
        const seekEl = this.sheetSlot.querySelector('#bc-seek');
        if (seekEl && document.activeElement !== seekEl) {
          seekEl.max = String(Math.max(1, Math.floor(snap.duration || 1)));
          seekEl.value = String(Math.floor(snap.currentTime || 0));
        }
      } else {
        this._renderSheetAndPeek();
      }
    }

    if (st.status === 'connected') {
      this._renderUiAndDock();
      if (isSelfEmitter) {
        this._renderStageWorkspace();
      }
    }
  }

  // Panel de diagnóstico: solo aparece si la dirección termina en ?debug=1
  _setupDebugPanel() {
    let on = false;
    try {
      on = new URLSearchParams(window.location.search).get('debug') === '1';
    } catch {
      on = false;
    }
    if (!on) return;
    const el = document.createElement('pre');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText =
      'position:fixed;left:6px;right:6px;bottom:6px;z-index:99999;margin:0;padding:6px 8px;' +
      'font:10px/1.35 ui-monospace,Menlo,monospace;color:#34D399;background:rgba(2,3,10,.88);' +
      'border:1px solid rgba(16,185,129,.35);border-radius:8px;white-space:pre-wrap;pointer-events:none;';
    document.body.appendChild(el);
    this._debugEl = el;
    this._debugIv = window.setInterval(() => {
      el.textContent = this.engine.getDiagnostics();
    }, 1000);
  }

  _onEngineChange() {
    if (this._destroyed) return;
    const st = this.engine.state;

    if (st.lastJoin && st.lastJoin.id !== this._lastJoinSeen) {
      this._lastJoinSeen = st.lastJoin.id;
      const names = Array.isArray(st.lastJoin.names) ? st.lastJoin.names : [];
      this.showToast(
        names.length === 1
          ? `${names[0]} entró a la sala`
          : `${names.length} personas entraron a la sala`,
      );
      if (!this.silentMode) playSound('join');
    }

    if (st.mediaNotice && st.mediaNotice !== this._lastMediaNotice) {
      this._lastMediaNotice = st.mediaNotice;
      this.showToast(st.mediaNotice);
    }
    if (st.hostMuteNotice) {
      this.showToast(st.hostMuteNotice);
      this.engine.clearHostMuteNotice();
    }

    // Stop local playlist playback if emitter role was revoked or released
    if (st.meta?.emitterPeerId !== st.self?.peerId && this.mediaBroadcaster.playing) {
      this.mediaBroadcaster.stopPlayback();
    }

    if (st.lastWave && st.lastWave.id !== this.lastHandledWaveId) {
      this.lastHandledWaveId = st.lastWave.id;
      this._triggerWaveVisual(false);
      if (!this.silentMode) playSound('join');
      this.showToast(`${st.lastWave.fromName} envió una onda`);
      window.setTimeout(() => this.engine.clearWave(), 1180);
    }

    if (st.lastReaction && st.lastReaction.id !== this.lastHandledReactionId) {
      this.lastHandledReactionId = st.lastReaction.id;
      if (st.lastReaction.kind === 'heartbeat') {
        playSpatialHeartbeatSound();
        if ('vibrate' in navigator) {
          try { navigator.vibrate([120, 80, 200]); } catch (_) {}
        }
        this._triggerHeartbeatVignette();
        addLatidos(1);
        this.showToast(`❤️ Latido 1:1 de ${st.lastReaction.name} (+1 Latido ganado)`);
      } else {
        this._spawnReactionFloat(st.lastReaction);
        if (!this.silentMode) playSound('msg');
      }
      this.engine.clearReaction();
    }

    if (st.lastSubtitle && st.lastSubtitle.id !== this.lastHandledSubtitleId) {
      this.lastHandledSubtitleId = st.lastSubtitle.id;
      this._displaySubtitle(st.lastSubtitle.name, st.lastSubtitle.text);
    }

    if (st.waiting.length > this._prevWaitingCount && st.self?.role === 'host' && !this.silentMode) {
      playSound('knock');
    }
    this._prevWaitingCount = st.waiting.length;

    if (st.status === 'connected' && this._prevStatus !== 'connected') {
      this._acquireWakeLock();
      this._elapsedStart = Date.now();
      this.elapsedSec = 0;
      if (this._elapsedIv) window.clearInterval(this._elapsedIv);
      this._elapsedIv = window.setInterval(() => {
        if (this._destroyed || this.engine.state.status !== 'connected') return;
        const s = Math.floor((Date.now() - this._elapsedStart) / 1000);
        this.elapsedSec = s;
        this.finalDurationSec = s;
        const clockEl = this.uiEl.querySelector('#clock');
        if (clockEl) clockEl.textContent = formatDuration(s);

        const activeTimer = this.engine.state.meta?.interactive?.timer;
        if (activeTimer?.endsAt) {
          const remMs = activeTimer.endsAt - Date.now();
          const cdEl = this.interactiveStageEl.querySelector('#ist-timer-countdown');
          if (remMs <= 0) {
            if (!this.silentMode) playSound('knock');
            this._renderInteractiveStage();
          } else if (cdEl) {
            cdEl.textContent = formatDuration(Math.ceil(remMs / 1000));
          }
        }
      }, 1000);
    } else if (st.status !== 'connected' && this._prevStatus === 'connected') {
      this._releaseWakeLock();
      this.mediaBroadcaster.stopPlayback();
      if (this._elapsedIv) {
        window.clearInterval(this._elapsedIv);
        this._elapsedIv = null;
      }
      this.studioOpen = false;
    }
    this._prevStatus = st.status;

    this._renderAll();
  }

  _triggerWaveVisual(sendSignal = false, targetPeerId = null) {
    const rip = document.createElement('div');
    rip.className = 'sw';
    rip.style.left = '50%';
    rip.style.top = '50%';
    rip.setAttribute('aria-hidden', 'true');
    this.ripplesEl.appendChild(rip);
    this.waveGlow = true;
    this.glowEl.classList.add('on');
    window.setTimeout(() => {
      this.waveGlow = false;
      this.glowEl.classList.remove('on');
    }, 1180);
    window.setTimeout(() => rip.remove(), 1220);

    if (sendSignal) {
      this.engine.sendWave(targetPeerId);
      this.showToast(targetPeerId ? 'Onda enviada' : 'Onda enviada a la sala');
    }
  }

  _spawnReactionFloat(reaction) {
    if (!this.reactionsEl || !reaction) return;
    const isMe = reaction.peerId === this.engine.state.self?.peerId;
    const el = document.createElement('div');
    el.className = 'sr-float';
    const leftPct = 18 + Math.round(Math.random() * 64);
    el.style.left = `${leftPct}%`;
    el.innerHTML = `${iconReaction(reaction.kind)}<span>${esc(isMe ? 'Tú' : reaction.name || 'Alguien')}</span>`;
    this.reactionsEl.appendChild(el);
    window.setTimeout(() => el.remove(), 2650);
  }

  _getCarouselPageSize() {
    return this.viewport.w >= 640 ? 6 : 4;
  }

  _getOrderedPeers() {
    const st = this.engine.state;
    return [...st.peers].sort((a, b) => {
      if (Boolean(a.isEmitter) !== Boolean(b.isEmitter)) return a.isEmitter ? -1 : 1;
      if (Boolean(a.camOn) !== Boolean(b.camOn)) return a.camOn ? -1 : 1;
      return (a.joinedAt || 0) - (b.joinedAt || 0);
    });
  }

  _streamForPeer(p) {
    if (!p) return null;
    const st = this.engine.state;
    return p.peerId === st.self?.peerId ? st.localStream : st.remoteStreams[p.peerId] || null;
  }

  _hasLiveVideo(p, stream) {
    return Boolean(
      stream && stream.getVideoTracks().some((t) => t.readyState === 'live') && p.camOn,
    );
  }

  _renderAll() {
    if (this._destroyed) return;
    const st = this.engine.state;
    const mood = st.meta?.interactive?.mood || 'cosmos';

    document.body.classList.toggle('fit', this.fitContain);
    document.body.classList.toggle('weak', st.weakConnection);
    document.body.classList.toggle('open', this.sheet !== null);
    document.body.classList.toggle('peeking', this.peekPeer !== null);
    for (const m of AMBIENT_MOODS) {
      document.body.classList.toggle(`mood-${m.id}`, mood === m.id);
    }

    this._renderPreJoin();
    this._renderWaitOrRejected();

    const connected = st.status === 'connected' && Boolean(st.self);
    this.workspaceEl.hidden = !connected;

    if (connected) {
      this._renderStageWorkspace();
      this._renderCarouselWorkspace();
      this._renderChat();
    } else {
      this._detachVideoEl(this.stageVidEl);
      for (const entry of this.carouselTiles.values()) {
        this._detachVideoEl(entry.vid);
      }
      this.engine.setVisibleViewerPeerIds([]);
    }

    this._renderInteractiveStage();
    this._renderNoteBar();
    this._renderUiAndDock();
    this._renderSheetAndPeek();
    this._renderStudioHud();
    this._renderBackPill();
    this._renderEndScreen();
  }

  _renderPreJoin() {
    const show = this.engine.state.status === 'idle' || this.engine.state.status === 'joining';
    if (!show) {
      if (this._preJoinMounted) {
        this.prejoinSlot.innerHTML = '';
        this._preJoinMounted = false;
      }
      return;
    }
    if (!this._preJoinMounted) {
      this._preJoinMounted = true;
      this.prejoinSlot.innerHTML = `
        <div id="tour" class="prejoin-full" role="dialog" aria-modal="true" aria-label="Antes de entrar">
          <div class="pre-bg">
            <video id="pre-vid" autoplay muted playsinline></video>
            <div class="pre-bg-fallback" id="pre-fallback">
              <div class="pre-avatar" id="pre-avatar"></div>
            </div>
            <div class="pre-scrim"></div>
          </div>
          <button type="button" class="tr-back-float" id="pre-back">${iconBack()}Atrás</button>
          <form id="pre-form" class="pre-overlay-form">
            <div class="pre-top-status">
              <div class="perm-row">
                <span class="perm-pill" id="pre-cam-pill"></span>
                <span class="perm-pill lock" id="pre-mic-pill">Micro: Bloqueado (solo emisión)</span>
              </div>
            </div>
            <div class="pre-bottom-card">
              <div class="pre-cam-bar">
                <button type="button" class="orb sm rm ss-lock-btn" id="pre-mic-btn" aria-label="Micrófono bloqueado">${iconMic(true)}</button>
                <button type="button" class="orb sm" id="pre-cam-btn"></button>
              </div>
              <p class="perm-err" id="pre-err" hidden></p>
              <h2>Antes de entrar</h2>
              <p class="pre-sub">Sala ${esc(this.initialRoomCode)} · Hasta 20 en vivo</p>
              <input id="pre-name" type="text" maxlength="24" placeholder="Tu nombre en la sala" value="${esc(this.nameInput)}" />
              ${
                !this.initialPass && !this.wantHost
                  ? `<input id="pre-pass" type="text" maxlength="8" placeholder="Clave de la SUITE (si tiene)" value="${esc(this.passInput)}" autocapitalize="characters" autocomplete="off" />`
                  : ''
              }
              <div class="pre-actions">
                <button type="button" class="tr-b" id="pre-perm-btn" hidden></button>
                <button type="submit" class="tr-b" id="pre-join-btn" hidden></button>
              </div>
            </div>
          </form>
        </div>
      `;
    }
    this._updatePreJoinDynamic();
  }

  _updatePreJoinDynamic() {
    if (!this._preJoinMounted) return;
    const isCamActive = this._isCamActiveForJoin();
    const vid = this.prejoinSlot.querySelector('#pre-vid');
    const fb = this.prejoinSlot.querySelector('#pre-fallback');
    const av = this.prejoinSlot.querySelector('#pre-avatar');
    const camPill = this.prejoinSlot.querySelector('#pre-cam-pill');
    const camBtn = this.prejoinSlot.querySelector('#pre-cam-btn');
    const errEl = this.prejoinSlot.querySelector('#pre-err');
    const permBtn = this.prejoinSlot.querySelector('#pre-perm-btn');
    const joinBtn = this.prejoinSlot.querySelector('#pre-join-btn');

    const showVid = isCamActive && Boolean(this.previewStream) && this.permState === 'ready';
    this._setVideoStream(vid, this.previewStream, {
      muted: true,
      mirror: true,
      filterId: this.localFilter,
    });
    if (vid) vid.style.opacity = showVid ? '1' : '0';
    if (fb) fb.style.display = showVid ? 'none' : 'flex';
    if (av) av.textContent = (this.nameInput.trim()[0] || this.user?.name?.[0] || 'S').toUpperCase();

    if (camPill) {
      camPill.className = `perm-pill ${isCamActive ? 'ok' : this.permError ? 'err' : ''}`;
      camPill.textContent = `Cámara: ${isCamActive ? '120p · 12fps' : this.permState === 'checking' ? 'Verificando…' : 'Apagada'}`;
    }

    if (camBtn) {
      camBtn.className = `orb sm ${isCamActive ? 'active-mint' : 'rm'}`;
      camBtn.setAttribute('aria-label', isCamActive ? 'Apagar cámara' : 'Encender cámara');
      camBtn.innerHTML = iconCam(!isCamActive);
    }

    if (errEl) {
      if (this.permError && this.permState !== 'checking') {
        errEl.hidden = false;
        errEl.textContent = this.permError;
      } else {
        errEl.hidden = true;
      }
    }

    if (this.permState === 'checking') {
      if (permBtn) {
        permBtn.hidden = false;
        permBtn.disabled = true;
        permBtn.textContent = 'Validando cámara…';
      }
      if (joinBtn) joinBtn.hidden = true;
    } else {
      if (permBtn) {
        const showRetry = !this.previewStream;
        permBtn.hidden = !showRetry;
        permBtn.disabled = false;
        permBtn.textContent = 'Reintentar cámara';
      }
      if (joinBtn) {
        joinBtn.hidden = false;
        joinBtn.disabled = this.engine.state.status === 'joining';
        joinBtn.textContent = this.engine.state.status === 'joining' ? 'Conectando…' : 'Entrar a la sala';
      }
    }
  }

  _renderWaitOrRejected() {
    const st = this.engine.state;
    const sig =
      st.status === 'waiting'
        ? 'wait'
        : st.status === 'rejected'
          ? `rej:${st.rejectionMessage}`
          : '';
    if (sig === this._lastWaitSig) return;
    this._lastWaitSig = sig;
    if (st.status === 'waiting') {
      this.waitSlot.innerHTML = `
        <div id="wait" role="alertdialog" aria-live="polite">
          <button type="button" class="tr-back-float" data-exit-home>${iconBack()}Atrás</button>
          <div class="sp"></div>
          <p>Esperando a que el anfitrión te deje entrar…</p>
          <div class="bs"><button type="button" data-exit-home>Salir</button></div>
        </div>
      `;
    } else if (st.status === 'rejected') {
      this.waitSlot.innerHTML = `
        <div id="wait" role="alertdialog" aria-live="polite">
          <img src="/assets/logo-icon.png" alt="SPACE SUITE" width="76" height="76" style="border-radius:18px" />
          <p>${esc(st.rejectionMessage || 'No pudiste entrar a la sala.')}</p>
          <div class="bs"><button type="button" class="p" data-exit-home>Ir al inicio</button></div>
        </div>
      `;
    } else {
      this.waitSlot.innerHTML = '';
    }
  }

  _renderStageWorkspace() {
    const st = this.engine.state;
    const b = st.meta?.broadcast || { status: 'idle', sourceType: 'none' };
    const emitterId = st.meta?.emitterPeerId || b.emitterPeerId || null;
    const isSelfEmitter = Boolean(emitterId && emitterId === st.self?.peerId);
    const bStatus = b.status || 'idle';
    const bSource = b.sourceType || 'none';
    const stream = isSelfEmitter ? st.broadcastStream : st.remoteBroadcastStream;
    const hasStream = Boolean(stream && stream.getTracks().length > 0);

    if (bStatus === 'preparing' || (bStatus === 'live' && !hasStream)) {
      this._detachVideoEl(this.stageVidEl);
      this.stageVidEl.hidden = true;
      this.stageIdleEl.hidden = true;
      this.stageStandbyEl.hidden = false;
      this.stageStandbyTitleEl.textContent = isSelfEmitter
        ? 'Preparando transmisión privada…'
        : `${b.emitterName || 'Emisor'} está preparando su señal…`;
      this.stageStandbySubEl.textContent =
        bSource === 'media'
          ? 'Iniciando stream multimedia local a 720p.'
          : 'Pantalla protegida en negro hasta capturar el primer cuadro.';
      this.stageAudioUnlockBtn.hidden = true;
    } else if (bStatus === 'live' && hasStream) {
      this.stageIdleEl.hidden = true;
      this.stageStandbyEl.hidden = true;
      this.stageVidEl.hidden = false;
      this._setVideoStream(this.stageVidEl, stream, {
        muted: isSelfEmitter,
        mirror: false,
        filterId: '',
        onBlockedAudio: () => {
          this._stageAudioNeedsUnlock = true;
          this.stageAudioUnlockBtn.hidden = false;
        },
      });
      this.stageAudioUnlockBtn.hidden = !this._stageAudioNeedsUnlock || isSelfEmitter;
    } else {
      this._detachVideoEl(this.stageVidEl);
      this.stageVidEl.hidden = true;
      this.stageStandbyEl.hidden = true;
      this.stageIdleEl.hidden = false;
      this._stageAudioNeedsUnlock = false;
      this.stageAudioUnlockBtn.hidden = true;
    }

    const showHud = bStatus === 'live' || bStatus === 'preparing';
    this.stageHudEl.hidden = !showHud;
    if (showHud) {
      const badgeTxt = bStatus === 'preparing' ? 'EN ESPERA' : 'EN VIVO';
      const metaTxt = `${isSelfEmitter ? 'Tú' : b.emitterName || 'Emisor'} · ${
        bSource === 'media' ? b.mediaTitle || 'Multimedia 720p' : 'Pantalla'
      }`;
      const hudSig = `${badgeTxt}|${metaTxt}`;
      if (hudSig !== this._lastStageHudSig) {
        this._lastStageHudSig = hudSig;
        this.stageBadgeTxtEl.textContent = badgeTxt;
        this.stageMetaEl.textContent = metaTxt;
      }
    }

    this.stageEmitterBarEl.hidden = !(isSelfEmitter && showHud);
    if (isSelfEmitter && showHud) {
      const snap = this.mediaBroadcaster.getSnapshot();
      const barSig = `${bSource}|${snap.playing}|${snap.items.length}|${snap.activeItem?.name || ''}`;
      if (barSig !== this._lastEmitterBarSig) {
        this._lastEmitterBarSig = barSig;
        if (bSource === 'media') {
          this.stageEmitterBarEl.innerHTML = `
            <button type="button" class="orb sm" data-stage-act="prev" aria-label="Anterior">${iconPrev()}</button>
            <button type="button" class="orb sm active-mint" data-stage-act="toggle" aria-label="${snap.playing ? 'Pausar' : 'Reproducir'}">${snap.playing ? iconPause() : iconPlay()}</button>
            <button type="button" class="orb sm" data-stage-act="next" aria-label="Siguiente">${iconNext()}</button>
            <button type="button" class="ss-stage-stop-btn" data-stage-act="stop">Detener</button>
          `;
        } else {
          this.stageEmitterBarEl.innerHTML = `
            <span class="ss-stage-bar-lbl">Emitiendo pantalla protegida</span>
            <button type="button" class="ss-stage-stop-btn" data-stage-act="stop">Detener</button>
          `;
        }
      }
    } else {
      this._lastEmitterBarSig = '';
    }
  }

  _getOrCreateCarouselTile(peer) {
    let entry = this.carouselTiles.get(peer.peerId);
    if (!entry) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ss-ctile';
      btn.innerHTML = `<video autoplay playsinline muted></video><b class="ss-ctile-av"></b><span class="ss-ctile-name"></span>`;
      const vid = btn.querySelector('video');
      const av = btn.querySelector('.ss-ctile-av');
      const name = btn.querySelector('.ss-ctile-name');
      entry = { btn, vid, av, name, peer };
      btn.addEventListener('click', () => {
        this.peekPeer = entry.peer;
        this._renderSheetAndPeek();
      });
      this.carouselTiles.set(peer.peerId, entry);
    }
    entry.peer = peer;
    return entry;
  }

  _renderCarouselWorkspace() {
    const st = this.engine.state;
    const selfId = st.self?.peerId;
    const emitterId = st.meta?.emitterPeerId || null;
    const ordered = this._getOrderedPeers().filter((p) => p.peerId !== emitterId);

    // Clean up tiles for peers who disconnected
    const activePeerIds = new Set(st.peers.map((p) => p.peerId));
    for (const [pid, entry] of this.carouselTiles.entries()) {
      if (!activePeerIds.has(pid)) {
        this._detachVideoEl(entry.vid);
        entry.btn.remove();
        this.carouselTiles.delete(pid);
      }
    }

    if (ordered.length === 0) {
      this.carouselEmptyEl.hidden = false;
      this.carouselEmptyEl.textContent =
        emitterId === selfId
          ? 'Modo Emisor activo · tu cámara permanece apagada para maximizar el video.'
          : 'Sin cámaras de espectadores activas.';
      this.carouselTrackEl.hidden = true;
      this.carouselDotsEl.hidden = true;
      this.engine.setVisibleViewerPeerIds([]);
      return;
    }

    this.carouselEmptyEl.hidden = true;
    this.carouselTrackEl.hidden = false;

    const pageSize = this._getCarouselPageSize();
    const chunks = [];
    for (let i = 0; i < ordered.length; i += pageSize) {
      chunks.push(ordered.slice(i, i + pageSize));
    }
    if (this.carouselPage >= chunks.length) {
      this.carouselPage = Math.max(0, chunks.length - 1);
    }

    while (this.carouselTrackEl.children.length > chunks.length) {
      this.carouselTrackEl.lastElementChild.remove();
    }
    while (this.carouselTrackEl.children.length < chunks.length) {
      const pg = document.createElement('div');
      pg.className = 'ss-carousel-page';
      this.carouselTrackEl.appendChild(pg);
    }

    chunks.forEach((pagePeers, pageIdx) => {
      const pageEl = this.carouselTrackEl.children[pageIdx];
      pageEl.style.gridTemplateColumns = `repeat(${pageSize}, minmax(0, 1fr))`;

      const entries = pagePeers.map((peer) => this._getOrCreateCarouselTile(peer));
      const desiredBtns = entries.map((e) => e.btn);
      Array.from(pageEl.children).forEach((child) => {
        if (!desiredBtns.includes(child)) child.remove();
      });
      desiredBtns.forEach((btn, idx) => {
        if (pageEl.children[idx] !== btn) {
          pageEl.insertBefore(btn, pageEl.children[idx] || null);
        }
      });

      const isPageVisible = pageIdx === this.carouselPage;
      entries.forEach((entry, idx) => {
        const peer = pagePeers[idx];
        const isSelf = peer.peerId === selfId;
        const stream = this._streamForPeer(peer);
        const hasLive = this._hasLiveVideo(peer, stream);

        entry.btn.className = `ss-ctile ${isSelf ? 'is-self' : ''} ${hasLive && isPageVisible ? 'is-live' : 'is-off'}`;
        entry.btn.style.background = getPeerTint(peer.peerId);
        entry.btn.setAttribute('aria-label', isSelf ? 'Tú' : peer.name);
        entry.av.textContent = peer.initial;
        entry.name.textContent = isSelf ? 'Tú' : peer.name;

        // Thermal throttling protection: pause & unbind off-screen video decoders immediately
        if (!isPageVisible || !hasLive) {
          this._detachVideoEl(entry.vid);
        } else {
          this._setVideoStream(entry.vid, stream, {
            muted: true,
            mirror: isSelf && st.facingMode !== 'environment',
            filterId: isSelf ? this.localFilter : '',
          });
        }
      });
    });

    const visiblePeers = chunks[this.carouselPage] || [];
    const visibleRemoteIds = visiblePeers
      .filter((p) => p.peerId !== selfId && p.camOn)
      .map((p) => p.peerId);
    this.engine.setVisibleViewerPeerIds(visibleRemoteIds);

    this._updateCarouselDots(chunks.length);
  }

  _updateCarouselDots(total) {
    this.carouselDotsEl.hidden = total <= 1;
    if (total <= 1) return;
    const html = Array.from({ length: total }, (_, idx) => {
      return `<button type="button" class="ss-cdot ${this.carouselPage === idx ? 'on' : ''}" data-cdot="${idx}" aria-label="Bloque ${idx + 1}"></button>`;
    }).join('');
    if (this.carouselDotsEl._lastHtml !== html) {
      this.carouselDotsEl._lastHtml = html;
      this.carouselDotsEl.innerHTML = html;
    }
  }

  _renderInteractiveStage() {
    const st = this.engine.state;
    const inter = st.meta?.interactive || {};
    const card = inter.card || null;
    const poll = inter.poll || null;
    const timer = inter.timer && inter.timer.endsAt > Date.now() ? inter.timer : null;
    const key = `${card?.id || ''}|${poll?.id || ''}|${timer?.endsAt || ''}`;
    if (key !== this._lastInteractiveKey) {
      this._lastInteractiveKey = key;
      this.hideInteractiveLocally = false;
    }

    const show =
      st.status === 'connected' &&
      Boolean(card || poll || timer) &&
      !this.hideInteractiveLocally &&
      !this.studioOpen &&
      this.sheet === null;

    this.interactiveStageEl.hidden = !show;
    if (!show) return;

    const myId = st.self?.peerId || '';
    const blocks = [];

    if (timer) {
      const remSec = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
      blocks.push(`
        <div class="ist-card">
          <div class="ist-head">
            <span class="ist-tag">${iconTimer()}<span>${esc(timer.label || 'Focus Timer')}</span></span>
            <button type="button" class="ist-close" data-ist="timer:stop" aria-label="Detener temporizador">${iconClose()}</button>
          </div>
          <div class="ist-timer-row">
            <span class="ist-timer-val" id="ist-timer-countdown">${formatDuration(remSec)}</span>
            <span class="ist-sub">Iniciado por ${esc(timer.byName || 'Alguien')}</span>
          </div>
        </div>
      `);
    }

    if (card) {
      blocks.push(`
        <div class="ist-card">
          <div class="ist-head">
            <span class="ist-tag">${iconCards()}<span>${esc(card.category || 'Carta Cósmica')}</span></span>
            <button type="button" class="ist-close" data-ist="card:clear" aria-label="Quitar carta">${iconClose()}</button>
          </div>
          <p class="ist-title">${esc(card.prompt)}</p>
          <div class="ist-sub">Sacada por ${esc(card.byName || 'Alguien')}</div>
        </div>
      `);
    }

    if (poll) {
      const totalVotes = (poll.options || []).reduce((acc, o) => acc + (o.votes?.length || 0), 0);
      blocks.push(`
        <div class="ist-card">
          <div class="ist-head">
            <span class="ist-tag">${iconPoll()}<span>Encuesta rápida · ${totalVotes} voto${totalVotes === 1 ? '' : 's'}</span></span>
            <button type="button" class="ist-close" data-ist="poll:close" aria-label="Cerrar encuesta">${iconClose()}</button>
          </div>
          <p class="ist-title">${esc(poll.question)}</p>
          <div class="ist-poll-opts">
            ${(poll.options || [])
              .map((opt) => {
                const count = opt.votes?.length || 0;
                const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                const voted = Boolean(myId && opt.votes?.includes(myId));
                return `
                  <button type="button" class="ist-poll-opt ${voted ? 'voted' : ''}" data-poll-vote="${esc(opt.id)}">
                    <span class="ist-poll-fill" style="width:${pct}%"></span>
                    <span>${esc(opt.label)}</span>
                    <small>${count} (${pct}%)</small>
                  </button>
                `;
              })
              .join('')}
          </div>
        </div>
      `);
    }

    const html = blocks.join('');
    if (html !== this._lastInteractiveHtml) {
      this._lastInteractiveHtml = html;
      this.interactiveStageEl.innerHTML = html;
    }
  }

  _renderNoteBar() {
    const st = this.engine.state;
    const active = st.self?.role === 'host' && st.waiting.length > 0 ? st.waiting[0] : null;
    this.noteEl.classList.toggle('on', Boolean(active));
    if (!active) {
      if (this.noteEl._lastId) {
        this.noteEl.innerHTML = '';
        this.noteEl._lastId = null;
      }
      return;
    }
    const sig = `${active.peerId}:${st.waiting.length}`;
    if (this.noteEl._lastId === sig) return;
    this.noteEl._lastId = sig;
    this.noteEl.innerHTML = `
      <span><b>${esc(active.name)}</b> quiere entrar${st.waiting.length > 1 ? ` · +${st.waiting.length - 1}` : ''}</span>
      <button type="button" class="p" data-admit="${esc(active.peerId)}">Admitir</button>
      <button type="button" data-reject="${esc(active.peerId)}">Rechazar</button>
    `;
  }

  _renderUiAndDock() {
    const st = this.engine.state;
    const show = st.status === 'connected' && Boolean(st.self);
    this.uiEl.hidden = !show;
    if (!show || !st.self) return;

    const isRoomFull = st.peers.length >= st.roomCapacity;
    const isAdminUser = this.user?.role === 'admin';
    const isHost = st.self.role === 'host';
    const emitterId = st.meta?.emitterPeerId || null;
    const isSelfEmitter = Boolean(emitterId && emitterId === st.self.peerId);
    const bStatus = st.meta?.broadcast?.status || 'idle';
    const isBroadcastLive = bStatus === 'live' && Boolean(emitterId);
    const isPreparing = bStatus === 'preparing' && Boolean(emitterId);
    const hasQueuedMedia = (this.mediaBroadcaster?.items?.length || 0) > 0;
    const studioActive = this.studioOpen || Boolean(st.self.handRaised);

    if (this.broadcastHub) {
      this.broadcastHub.setBroadcastState({
        status: emitterId ? bStatus : 'idle',
        isSelfEmitter,
        sourceType: st.meta?.broadcast?.sourceType || 'none',
      });
    }

    const sig = [
      st.self.role,
      st.self.camOn,
      st.self.micOn,
      this.engine.isMicUnlocked(),
      st.self.handRaised,
      st.peers.length,
      st.roomCapacity,
      Boolean(st.meta?.locked),
      st.waiting.length,
      emitterId || '',
      bStatus,
      hasQueuedMedia,
      this.silentMode,
      this.studioOpen,
      this.subtitlesActive,
      this.leaveArmed,
      isAdminUser,
    ].join('|');

    if (sig === this._lastUiSig) return;
    this._lastUiSig = sig;

    this.uiEl.innerHTML = `
      <div class="top">
        <button type="button" class="tlg-btn" id="room-logo-refresh" aria-label="Actualizar sala" title="Toca para sincronizar">
          <img class="tlg ${this.logoRefreshing ? 'refreshing' : ''}" src="/assets/logo-icon.png" alt="SPACE SUITE" width="44" height="44" />
        </button>
        <div class="tt">
          <h1>SPACE SUITE<span class="role">${isHost ? 'Anfitrión' : isSelfEmitter ? 'Emisor' : 'Espectador'}</span></h1>
          <p>
            ${st.meta?.locked ? `<span id="lk" title="Sala bloqueada">${iconLock(false)}</span>` : ''}
            <i class="dot"></i>
            <span id="online">${st.peers.length} / ${st.roomCapacity} en sala</span> · <span id="clock">${formatDuration(this.elapsedSec)}</span>
          </p>
        </div>
        <div class="tops">
          <button type="button" class="btn-superkey" data-dock="superkey" aria-label="SUPER KEY">${iconSuperKey()}<span>SUPER KEY</span></button>
          <button type="button" class="orb sm pl" id="tPe" aria-label="Participantes">${iconUsers()}<span id="cnt">${st.peers.length}</span></button>
          <button type="button" class="orb sm" id="tIn" ${isRoomFull ? 'disabled' : ''} aria-label="${isRoomFull ? 'Sala llena' : 'Invitar a la sala'}">${iconInvite()}</button>
          <button type="button" class="orb sm" id="tMenu" aria-label="Suite y controles">${iconMenu()}${
            isHost && st.waiting.length > 0 ? `<i class="bdg">${st.waiting.length}</i>` : ''
          }</button>
        </div>
      </div>
      <div class="ctl" id="dock">
        <button type="button" class="orb ss-broadcast-btn ${isBroadcastLive ? 'is-live' : isPreparing ? 'is-prep' : hasQueuedMedia ? 'has-media' : ''}" data-dock="broadcast" aria-label="Centro de Transmisión">
          ${iconBroadcastPro(isBroadcastLive)}
          <span class="lb">${isSelfEmitter ? (isPreparing ? 'Prep…' : 'En vivo') : 'Emitir'}</span>
        </button>
        ${
          this.engine.isMicUnlocked()
            ? `<button type="button" class="orb tg" data-dock="mic" aria-pressed="${Boolean(st.self.micOn)}" aria-label="Micrófono">${iconMic(!st.self.micOn)}<span class="lb">Mic</span></button>`
            : `<button type="button" class="orb tg ss-mic-locked" data-dock="mic" aria-disabled="true" aria-pressed="false" aria-label="Micrófono bloqueado en esta sala">${iconMic(true)}<span class="lb">Bloq.</span></button>`
        }
        <button type="button" class="orb tg" data-dock="cam" aria-pressed="${st.self.camOn}" ${isSelfEmitter ? 'disabled' : ''} aria-label="Cámara">${iconCam(!st.self.camOn)}<span class="lb">Cámara</span></button>
        <button type="button" class="orb btn-latido" data-dock="latido" aria-label="Latido 1:1">${iconReaction('heartbeat')}<span class="lb">Latido</span></button>
        <button type="button" class="orb ${studioActive ? 'active-mint' : ''}" data-dock="studio" aria-pressed="${this.studioOpen}" aria-label="Estudio interactivo">${iconSparkles()}<span class="lb">Estudio</span></button>
        <button type="button" class="orb" data-dock="view" aria-label="Escenario">${iconFit()}<span class="lb">Ajuste</span></button>
        <button type="button" class="orb leave ${this.leaveArmed ? 'arm' : ''}" data-dock="leave" aria-label="Salir">${iconLeave()}<span class="lb">Salir</span></button>
      </div>
    `;
    if (this.broadcastHub) {
      this.broadcastHub.syncBroadcastButtonLed(this.uiEl);
    }
  }

  _renderSheetAndPeek() {
    const st = this.engine.state;
    const orderedPeers = this._getOrderedPeers();
    const currentCode = st.meta?.code || this.initialRoomCode;
    const currentPass = st.meta?.pass || this.initialPass || this.user?.suitePass || '';
    const inviteLink = buildRoomInviteUrl(currentCode, currentPass || undefined);
    const isRoomFull = st.peers.length >= st.roomCapacity;
    const broadcastSnapshot = this.mediaBroadcaster.getSnapshot();

    let sheetSig = String(this.sheet || '');
    if (this.sheet === 'broadcast') {
      const bcSig = [
        broadcastSnapshot.items.map((it) => it.id).join(','),
        broadcastSnapshot.activeIndex,
        broadcastSnapshot.playing,
        broadcastSnapshot.loop,
        st.meta?.emitterPeerId || '',
        st.meta?.broadcast?.status || 'idle',
        st.meta?.broadcast?.sourceType || 'none',
        Boolean(st.broadcastStream),
      ].join('|');
      this._lastBroadcastSheetStructSig = bcSig;
      sheetSig += `|${bcSig}`;
    } else if (this.sheet === 'people') {
      sheetSig += `|${st.peers.map((p) => `${p.peerId}:${p.camOn}:${p.isEmitter}:${p.handRaised}`).join(',')}|${st.meta?.emitterPeerId || ''}|${this.kickArmedId}|${isRoomFull}`;
    } else if (this.sheet === 'view') {
      sheetSig += `|${this.fitContain}|${st.self?.isEmitter}`;
    } else if (this.sheet === 'mod') {
      sheetSig += `|${st.meta?.locked}|${st.meta?.waitingRoom}|${st.meta?.emitterPeerId || ''}|${this.endRoomArmed}`;
    } else if (this.sheet === 'acct') {
      sheetSig += `|${this.editingName}|${st.self?.name}|${this.nameInput}`;
    } else if (this.sheet === 'suite') {
      sheetSig += `|${this.silentMode}|${st.waiting.length}|${isRoomFull}|${st.self?.role}|${this.user?.role}`;
    } else if (this.sheet === 'invite') {
      sheetSig += `|${currentCode}|${currentPass}`;
    }

    if (sheetSig !== this._lastSheetSig) {
      this._lastSheetSig = sheetSig;
      if (this.adminCtrl) {
        this.adminCtrl.destroy();
        this.adminCtrl = null;
      }
      this.sheetSlot.innerHTML = '';

      if (this.sheet === 'superkey') {
        this.adminCtrl = new SuperKeyController(this.sheetSlot, {
          onClose: () => this._setSheet(null),
          onToast: (m) => this.showToast(m),
        });
      } else if (this.sheet === 'tienda') {
        this.sheetSlot.innerHTML = renderMiniTiendaHtml();
        bindMiniTiendaEvents(this.sheetSlot, {
          onClose: () => this._setSheet(null),
          onToast: (m) => this.showToast(m),
          onOpenInvite: () => this._setSheet('invite'),
        });
      } else if (this.sheet === 'admin' && this.user && this.user.role === 'admin') {
        this.adminCtrl = new AdminPanelController(this.sheetSlot, {
          user: this.user,
          onClose: () => this._setSheet(null),
          onToast: (m) => this.showToast(m),
        });
      } else if (this.sheet === 'invite') {
        this.sheetSlot.innerHTML = renderShareSheetHtml({
          mode: 'invite',
          code: currentCode,
          pass: currentPass || undefined,
          link: inviteLink,
          hasSwitchApp: true,
          hasOpenInstall: true,
        });
        bindShareSheetEvents(this.sheetSlot, {
          mode: 'invite',
          code: currentCode,
          pass: currentPass || undefined,
          link: inviteLink,
          onClose: () => this._setSheet(null),
          onToast: (m) => this.showToast(m),
          onSwitchToAppShare: () => this._setSheet('shareapp'),
          onOpenInstall: () => this._setSheet('install'),
        });
      } else if (this.sheet === 'shareapp') {
        const link = typeof window !== 'undefined' ? window.location.origin + '/' : '';
        this.sheetSlot.innerHTML = renderShareSheetHtml({ mode: 'shareapp', link });
        bindShareSheetEvents(this.sheetSlot, {
          mode: 'shareapp',
          link,
          onClose: () => this._setSheet(null),
          onToast: (m) => this.showToast(m),
        });
      } else if (this.sheet) {
        this.sheetSlot.innerHTML = renderRoomSheetHtml(this.sheet, {
          peers: st.peers,
          self: st.self,
          roomCapacity: st.roomCapacity,
          isRoomFull,
          orderedPeers,
          kickArmedId: this.kickArmedId,
          fitContain: this.fitContain,
          screenSharing: Boolean(st.meta?.emitterPeerId === st.self?.peerId),
          meta: st.meta,
          endRoomArmed: this.endRoomArmed,
          user: this.user,
          nameInput: this.nameInput,
          editingName: this.editingName,
          draftName: this.draftName,
          silentMode: this.silentMode,
          waitingCount: st.waiting.length,
          broadcastSnapshot,
          streamActive: Boolean(st.broadcastStream),
        });
        if (this.sheet === 'acct' && this.editingName) {
          this.sheetSlot.querySelector('#room-draft-name')?.focus();
        }
      }
    }

    // Quick Peek
    const isHost = st.self?.role === 'host';
    const isEmitting = Boolean(this.peekPeer && st.meta?.emitterPeerId === this.peekPeer.peerId);
    const peekSig = this.peekPeer ? `${this.peekPeer.peerId}:${isHost}:${isEmitting}` : '';
    if (peekSig !== this._lastPeekSig) {
      this._lastPeekSig = peekSig;
      this.pkEl.innerHTML = this.peekPeer
        ? renderQuickPeekHtml(this.peekPeer, st.self?.peerId, isHost, isEmitting)
        : '';
      this._peekVideoEl = null;
      this._peekSpanEl = null;
      if (this.peekPeer) {
        const pv = this.pkEl.querySelector('#pv');
        const v = document.createElement('video');
        v.autoplay = true;
        v.playsInline = true;
        v.muted = true;
        v.style.position = 'absolute';
        v.style.inset = '0';
        const sp = document.createElement('span');
        sp.textContent = this.peekPeer.initial;
        pv.appendChild(v);
        pv.appendChild(sp);
        this._peekVideoEl = v;
        this._peekSpanEl = sp;
      }
    }
    if (this.peekPeer && this._peekVideoEl) {
      const p = st.peers.find((x) => x.peerId === this.peekPeer.peerId) || this.peekPeer;
      const stream = this._streamForPeer(p);
      const hasLive = this._hasLiveVideo(p, stream);
      this._peekVideoEl.style.opacity = hasLive ? '1' : '0';
      this._peekSpanEl.style.display = hasLive ? 'none' : '';
      this._setVideoStream(this._peekVideoEl, stream, {
        muted: true,
        mirror: p.peerId === st.self?.peerId && st.facingMode !== 'environment',
        filterId: p.peerId === st.self?.peerId ? this.localFilter : '',
      });
    }
  }

  _renderStudioHud() {
    const st = this.engine.state;
    const show = st.status === 'connected' && Boolean(st.self) && this.studioOpen && this.sheet === null;
    if (!show) {
      if (this._lastStudioSig) {
        this._lastStudioSig = '';
        this.studioSlot.innerHTML = '';
      }
      return;
    }

    const inter = st.meta?.interactive || {};
    const mood = inter.mood || 'cosmos';
    const hasCard = Boolean(inter.card);
    const hasPoll = Boolean(inter.poll);
    const hasTimer = Boolean(inter.timer && inter.timer.endsAt > Date.now());
    const isSelfEmitter = Boolean(st.meta?.emitterPeerId && st.meta.emitterPeerId === st.self?.peerId);

    const sig = [
      this.studioTab,
      this.localFilter,
      st.facingMode || 'user',
      Boolean(st.self?.handRaised),
      isSelfEmitter,
      mood,
      hasCard,
      hasPoll,
      hasTimer,
    ].join('|');

    if (sig === this._lastStudioSig) return;
    this._lastStudioSig = sig;

    let bodyHtml = '';
    if (this.studioTab === 'reactions') {
      bodyHtml = `
        <div>
          <div class="studio-sec-title">Reacciones espaciales</div>
          <div class="studio-rx-grid">
            ${REACTIONS.map(
              (r) =>
                `<button type="button" class="studio-rx-btn" data-rx="${r.id}">${iconReaction(r.id)}<span>${r.label}</span></button>`,
            ).join('')}
          </div>
        </div>
        <div>
          <div class="studio-sec-title">Señales de sala</div>
          <div class="studio-chips">
            <button type="button" class="studio-chip" data-st-act="wave">${iconWave()}<span>Enviar onda</span></button>
            <button type="button" class="studio-chip ${st.self?.handRaised ? 'on' : ''}" data-st-act="hand">${iconHand()}<span>${
              st.self?.handRaised ? 'Bajar mano' : 'Levantar mano'
            }</span></button>
          </div>
        </div>
      `;
    } else if (this.studioTab === 'camera') {
      bodyHtml = `
        <div>
          <div class="studio-sec-title">Estética de cámara</div>
          <div class="studio-chips">
            ${VIDEO_FILTERS.map(
              (f) =>
                `<button type="button" class="studio-chip ${this.localFilter === f.id ? 'on' : ''}" data-filter="${f.id}">${iconSparkles()}<span>${f.label}</span></button>`,
            ).join('')}
          </div>
        </div>
        <div>
          <div class="studio-sec-title">Lente y emisión</div>
          <div class="studio-chips">
            <button type="button" class="studio-chip" data-st-act="flip" ${isSelfEmitter ? 'disabled' : ''}>${iconCameraFlip()}<span>Cámara: ${
              st.facingMode === 'environment' ? 'Trasera' : 'Frontal'
            }</span></button>
            <button type="button" class="studio-chip ${isSelfEmitter ? 'on' : ''}" data-st-act="broadcast">${iconBroadcastPro(isSelfEmitter)}<span>Centro de Transmisión</span></button>
          </div>
        </div>
        <div>
          <div class="studio-sec-title">Clima de sala (para todos)</div>
          <div class="studio-chips">
            ${AMBIENT_MOODS.map(
              (m) =>
                `<button type="button" class="studio-chip ${mood === m.id ? 'on' : ''}" data-mood="${m.id}">${iconPalette()}<span>${m.label}</span></button>`,
            ).join('')}
          </div>
        </div>
      `;
    } else {
      bodyHtml = `
        <div>
          <div class="studio-sec-title">Cartas Cósmicas</div>
          <div class="studio-chips">
            <button type="button" class="studio-chip on" data-st-act="deal-card">${iconCards()}<span>${
              hasCard ? 'Otra Carta Cósmica' : 'Sacar Carta Cósmica'
            }</span></button>
            ${
              hasCard
                ? `<button type="button" class="studio-chip" data-st-act="clear-card">${iconClose()}<span>Quitar carta</span></button>`
                : ''
            }
          </div>
        </div>
        <div>
          <div class="studio-sec-title">Temporizador Focus</div>
          <div class="studio-chips">
            <button type="button" class="studio-chip" data-timer="5">${iconTimer()}<span>5 min</span></button>
            <button type="button" class="studio-chip" data-timer="15">${iconTimer()}<span>15 min</span></button>
            <button type="button" class="studio-chip" data-timer="25">${iconTimer()}<span>25 min</span></button>
            ${
              hasTimer
                ? `<button type="button" class="studio-chip on" data-st-act="stop-timer">${iconClose()}<span>Detener</span></button>`
                : ''
            }
          </div>
        </div>
        <div>
          <div class="studio-sec-title">Encuesta rápida</div>
          <div class="studio-chips" style="margin-bottom:8px">
            <button type="button" class="studio-chip" data-preset-poll="ready">${iconPoll()}<span>¿Listos para avanzar?</span></button>
            ${
              hasPoll
                ? `<button type="button" class="studio-chip on" data-st-act="close-poll">${iconClose()}<span>Cerrar encuesta</span></button>`
                : ''
            }
          </div>
          <form class="studio-poll-form" id="studio-poll-form">
            <input type="text" id="st-poll-q" maxlength="100" placeholder="Pregunta rápida para la sala" value="${esc(this.pollDraftQuestion)}" />
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              <input type="text" id="st-poll-a" maxlength="40" placeholder="Opción 1" value="${esc(this.pollDraftOptA)}" />
              <input type="text" id="st-poll-b" maxlength="40" placeholder="Opción 2" value="${esc(this.pollDraftOptB)}" />
            </div>
            <button type="submit" class="studio-chip on" style="justify-content:center">Lanzar encuesta en vivo</button>
          </form>
        </div>
      `;
    }

    this.studioSlot.innerHTML = `
      <section id="studio-hud" role="dialog" aria-label="Estudio spaceSUITE">
        <div class="studio-head">
          <div class="studio-tabs">
            <button type="button" class="ct ${this.studioTab === 'reactions' ? 'a' : ''}" data-st-tab="reactions">Reacciones</button>
            <button type="button" class="ct ${this.studioTab === 'camera' ? 'a' : ''}" data-st-tab="camera">Cámara</button>
            <button type="button" class="ct ${this.studioTab === 'dynamics' ? 'a' : ''}" data-st-tab="dynamics">Dinámicas</button>
          </div>
          <button type="button" class="orb sm chat-icon-btn" id="studio-close-btn" aria-label="Cerrar Estudio">${iconClose()}</button>
        </div>
        <div class="studio-body">${bodyHtml}</div>
      </section>
    `;
  }

  _renderChat() {
    const st = this.engine.state;
    this.chatHud.update({
      open: true,
      selfPeerId: st.self?.peerId || null,
      peers: st.peers,
      messages: st.messages,
      typingPeers: st.typingPeers,
      chatTarget: this.chatTarget,
      settings: this.chatSettings,
    });
  }

  _renderBackPill() {
    const show = this.engine.state.status === 'connected' && this.backVisible;
    this.backShieldEl.hidden = !show;
    this.backPillEl.hidden = !show;
  }

  _renderEndScreen() {
    const show = this.engine.state.status === 'ended';
    this.endEl.hidden = !show;
    if (!show) return;
    this.endEl.querySelector('#end-title').textContent = this.endTitle;
    this.endEl.querySelector('#dur').textContent = `Duración · ${formatDuration(this.finalDurationSec)}`;
    this.endEl.querySelector('#mine').hidden = !this.user;
  }

  _setSheet(next) {
    this.sheet = next;
    this._renderAll();
  }

  _hideBackOnly() {
    if (this.backTimer) {
      window.clearTimeout(this.backTimer);
      this.backTimer = null;
    }
    this.backVisible = false;
    this._renderBackPill();
  }

  _handleBackAction() {
    this._hideBackOnly();
    if (this.peekPeer) {
      this.peekPeer = null;
      return this._renderAll();
    }
    if (this.sheet) {
      this.sheet = null;
      return this._renderAll();
    }
    if (this.studioOpen) {
      this.studioOpen = false;
      return this._renderAll();
    }
    this.endTitle = 'Hasta pronto';
    this.mediaBroadcaster.stopPlayback();
    this.engine.leaveRoom();
    this.onExitHome();
  }

  _handleSafeRefresh() {
    const now = Date.now();
    if (now - this.lastRefreshAt < 700) return;
    this.lastRefreshAt = now;
    this.logoRefreshing = true;
    const tlg = this.uiEl.querySelector('.tlg');
    if (tlg) tlg.classList.add('refreshing');
    window.setTimeout(() => {
      this.logoRefreshing = false;
      if (tlg) tlg.classList.remove('refreshing');
    }, 480);

    this.engine.softRefresh();
    if (this.stageVidEl?.srcObject && this.stageVidEl.paused) {
      this.stageVidEl.play().catch(() => {});
    }
    this.showToast('Actualizado');
  }

  _openInviteSafe() {
    const st = this.engine.state;
    if (st.peers.length >= st.roomCapacity) {
      this.showToast(`Sala llena (${st.roomCapacity} / ${st.roomCapacity})`);
      return;
    }
    this._setSheet('invite');
  }

  _resumeStageAudio() {
    if (!this.stageVidEl || !this.stageVidEl.srcObject) return;
    const isSelfEmitter = this.engine.state.meta?.emitterPeerId === this.engine.state.self?.peerId;
    if (!isSelfEmitter) {
      this.stageVidEl.muted = false;
      this.stageVidEl.volume = 1;
      this.stageVidEl.play().then(() => {
        this._stageAudioNeedsUnlock = false;
        this.stageAudioUnlockBtn.hidden = true;
      }).catch(() => {});
    }
  }

  _bindEvents() {
    this._onResize = () => {
      this.viewport = { w: window.innerWidth, h: window.innerHeight };
      if (this.engine.state.status === 'connected') {
        this._renderCarouselWorkspace();
      }
    };
    window.addEventListener('resize', this._onResize);

    this._onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && this.engine.state.status === 'connected') {
        this._acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);

    this._onPerkUnlocked = (e) => {
      this.activePerks = getPurchasedPerks();
      if (e?.detail?.perkId === 'filter-portrait') {
        this.localFilter = 'soft';
      }
      this._renderAll();
    };
    window.addEventListener('spacesuite:perk_unlocked', this._onPerkUnlocked);

    this._onUserGestureAudio = () => {
      this._resumeStageAudio();
    };
    this.rootEl.addEventListener('pointerdown', this._onUserGestureAudio, { passive: true });
    this.rootEl.addEventListener('keydown', this._onUserGestureAudio);

    // Stage buttons & audio unlock
    this.stagePaneEl.addEventListener('click', (e) => {
      if (e.target.closest('#ss-stage-open-bc')) {
        this._setSheet('broadcast');
        return;
      }
      if (e.target.closest('#ss-audio-unlock')) {
        this._resumeStageAudio();
        return;
      }
      const act = e.target.closest('[data-stage-act]')?.getAttribute('data-stage-act');
      if (act) {
        if (act === 'stop') {
          this.mediaBroadcaster.stopPlayback();
          this.engine.stopBroadcast();
        } else if (act === 'toggle') {
          this.mediaBroadcaster.togglePlay();
        } else if (act === 'prev') {
          const snap = this.mediaBroadcaster.getSnapshot();
          if (snap.items.length > 0) {
            const idx = (snap.activeIndex - 1 + snap.items.length) % snap.items.length;
            this.mediaBroadcaster.selectItem(idx, true);
          }
        } else if (act === 'next') {
          const snap = this.mediaBroadcaster.getSnapshot();
          if (snap.items.length > 0) {
            const idx = (snap.activeIndex + 1) % snap.items.length;
            this.mediaBroadcaster.selectItem(idx, true);
          }
        }
      }
    });

    // Carousel swipe pagination with decoder pause/unbinding on page change
    this.carouselTrackEl.addEventListener('scroll', () => {
      if (this._carouselScrollRaf) return;
      this._carouselScrollRaf = window.requestAnimationFrame(() => {
        this._carouselScrollRaf = null;
        const w = Math.max(1, this.carouselTrackEl.clientWidth);
        const nextPage = Math.round(this.carouselTrackEl.scrollLeft / w);
        if (nextPage !== this.carouselPage) {
          this.carouselPage = nextPage;
          this._renderCarouselWorkspace();
        }
      });
    }, { passive: true });

    this.carouselDotsEl.addEventListener('click', (e) => {
      const dot = e.target.closest('[data-cdot]');
      if (!dot) return;
      const idx = Number(dot.getAttribute('data-cdot'));
      this.carouselPage = idx;
      this.carouselTrackEl.scrollTo({
        left: idx * this.carouselTrackEl.clientWidth,
        behavior: 'smooth',
      });
      this._renderCarouselWorkspace();
    });

    // Pre-join input/clicks
    this.prejoinSlot.addEventListener('input', (e) => {
      if (e.target.id === 'pre-name') {
        this.nameInput = e.target.value;
        const av = this.prejoinSlot.querySelector('#pre-avatar');
        if (av) av.textContent = (this.nameInput.trim()[0] || this.user?.name?.[0] || 'S').toUpperCase();
      } else if (e.target.id === 'pre-pass') {
        this.passInput = e.target.value.toUpperCase();
        e.target.value = this.passInput;
      }
    });
    this.prejoinSlot.addEventListener('click', async (e) => {
      if (e.target.closest('#pre-back')) {
        this._stopPreviewStream();
        this.onExitHome();
      } else if (e.target.closest('#pre-mic-btn')) {
        this.showToast('Micrófonos bloqueados · Solo suena la transmisión en vivo');
      } else if (e.target.closest('#pre-cam-btn')) {
        if (!this.previewStream || this.previewStream.getVideoTracks().length === 0) {
          this.preCamOn = true;
          await this._requestPreJoinPermissions();
          return;
        }
        this.preCamOn = !this.preCamOn;
        this.previewStream.getVideoTracks().forEach((t) => {
          t.enabled = this.preCamOn;
        });
        this._updatePreJoinDynamic();
      } else if (e.target.closest('#pre-perm-btn')) {
        this.preCamOn = true;
        await this._requestPreJoinPermissions();
      }
    });
    this.prejoinSlot.addEventListener('submit', async (e) => {
      if (e.target.id !== 'pre-form') return;
      e.preventDefault();
      if (this.permState === 'checking') return;
      const cleanName = this.nameInput.trim() || this.user?.name || 'Invitado';
      if (cleanName.length < 2) {
        this.showToast('Escribe tu nombre (mínimo 2 letras)');
        return;
      }
      setStoredName(cleanName);
      this.handedOffPreview = Boolean(this.previewStream);
      const ok = await this.engine.joinRoom({
        roomCode: this.initialRoomCode,
        pass: this.passInput.trim().toUpperCase() || undefined,
        name: cleanName,
        micOn: false,
        camOn: this._isCamActiveForJoin(),
        wantHost: this.wantHost,
        precheckedStream: this.previewStream,
        requireMedia: false,
      });
      if (!ok) {
        this.handedOffPreview = false;
        await this._requestPreJoinPermissions();
      } else {
        this.previewStream = null;
      }
    });

    this.waitSlot.addEventListener('click', (e) => {
      if (e.target.closest('[data-exit-home]')) this.onExitHome();
    });

    this.noteEl.addEventListener('click', (e) => {
      const admit = e.target.closest('[data-admit]')?.getAttribute('data-admit');
      if (admit) return this.engine.hostAction('admit', { targetPeerId: admit });
      const reject = e.target.closest('[data-reject]')?.getAttribute('data-reject');
      if (reject) return this.engine.hostAction('reject', { targetPeerId: reject });
    });

    // Top bar + dock
    this.uiEl.addEventListener('click', (e) => {
      if (e.target.closest('#room-logo-refresh')) return this._handleSafeRefresh();
      if (e.target.closest('#tPe')) return this._setSheet('people');
      if (e.target.closest('#tIn')) return this._openInviteSafe();
      if (e.target.closest('#tMenu')) return this._setSheet('suite');

      const dockBtn = e.target.closest('[data-dock]');
      if (!dockBtn) return;
      const d = dockBtn.getAttribute('data-dock');
      if (d === 'broadcast') {
        this.studioOpen = false;
        this._setSheet('broadcast');
      } else if (d === 'mic') {
        if (this.engine.isMicUnlocked()) {
          this.engine.toggleMic();
        } else {
          this.showToast('Micrófonos bloqueados · Solo suena la transmisión en vivo');
        }
      } else if (d === 'cam') {
        this.engine.toggleCam();
      } else if (d === 'superkey') {
        this._setSheet('superkey');
      } else if (d === 'latido') {
        playSpatialHeartbeatSound();
        if ('vibrate' in navigator) {
          try { navigator.vibrate([120, 80, 200]); } catch (_) {}
        }
        this.engine.sendReaction('heartbeat');
        this._triggerHeartbeatVignette();
        this.showToast('❤️ Latido 1:1 enviado con pulso háptico');
      } else if (d === 'studio') {
        this.studioOpen = !this.studioOpen;
        if (this.studioOpen) {
          this.peekPeer = null;
        }
        this._renderAll();
      } else if (d === 'view') {
        this._setSheet('view');
      } else if (d === 'leave') {
        if (!this.leaveArmed) {
          this.leaveArmed = true;
          this.showToast('Toca de nuevo para salir');
          if (this.leaveTimer) window.clearTimeout(this.leaveTimer);
          this.leaveTimer = window.setTimeout(() => {
            this.leaveArmed = false;
            this._renderUiAndDock();
          }, 3000);
          this._renderUiAndDock();
        } else {
          this.endTitle = 'Hasta pronto';
          this.mediaBroadcaster.stopPlayback();
          this.engine.leaveRoom();
        }
      }
    });

    this.interactiveStageEl.addEventListener('click', (e) => {
      const voteBtn = e.target.closest('[data-poll-vote]');
      if (voteBtn) {
        this.engine.sendInteractive('poll:vote', { optionId: voteBtn.getAttribute('data-poll-vote') });
        return;
      }
      const istAct = e.target.closest('[data-ist]')?.getAttribute('data-ist');
      if (istAct) {
        this.hideInteractiveLocally = true;
        this.engine.sendInteractive(istAct);
        this._renderInteractiveStage();
      }
    });

    this.studioSlot.addEventListener('input', (e) => {
      if (e.target.id === 'st-poll-q') this.pollDraftQuestion = e.target.value;
      else if (e.target.id === 'st-poll-a') this.pollDraftOptA = e.target.value;
      else if (e.target.id === 'st-poll-b') this.pollDraftOptB = e.target.value;
    });

    this.studioSlot.addEventListener('submit', (e) => {
      if (e.target.id !== 'studio-poll-form') return;
      e.preventDefault();
      const q = this.pollDraftQuestion.trim();
      const a = this.pollDraftOptA.trim();
      const b = this.pollDraftOptB.trim();
      if (!q || !a || !b) {
        return this.showToast('Escribe la pregunta y al menos 2 opciones');
      }
      this.engine.sendInteractive('poll:start', { question: q, options: [a, b] });
      this.pollDraftQuestion = '';
      this.pollDraftOptA = '';
      this.pollDraftOptB = '';
      this.studioOpen = false;
      this.showToast('Encuesta enviada a la sala');
      this._renderAll();
    });

    this.studioSlot.addEventListener('click', (e) => {
      if (e.target.closest('#studio-close-btn')) {
        this.studioOpen = false;
        return this._renderAll();
      }
      const tabBtn = e.target.closest('[data-st-tab]');
      if (tabBtn) {
        this.studioTab = tabBtn.getAttribute('data-st-tab') || 'reactions';
        return this._renderStudioHud();
      }
      const rxBtn = e.target.closest('[data-rx]');
      if (rxBtn) {
        const kind = rxBtn.getAttribute('data-rx');
        const senderName = this.engine.state.self?.name || 'Tú';
        this.engine.sendReaction(kind);
        this._spawnReactionFloat({
          id: crypto.randomUUID(),
          peerId: this.engine.state.self?.peerId,
          name: senderName,
          kind,
        });
        if (!this.silentMode) playSound('msg');
        return;
      }
      const filterBtn = e.target.closest('[data-filter]');
      if (filterBtn) {
        this.localFilter = filterBtn.getAttribute('data-filter') || 'natural';
        this.showToast(`Filtro: ${filterBtn.textContent.trim()}`);
        return this._renderAll();
      }
      const moodBtn = e.target.closest('[data-mood]');
      if (moodBtn) {
        const moodId = moodBtn.getAttribute('data-mood') || 'cosmos';
        this.engine.sendInteractive('mood:set', { mood: moodId });
        this.showToast(`Clima: ${moodBtn.textContent.trim()}`);
        return;
      }
      const timerBtn = e.target.closest('[data-timer]');
      if (timerBtn) {
        const minutes = Number(timerBtn.getAttribute('data-timer') || 5);
        this.engine.sendInteractive('timer:start', { minutes, label: `Focus ${minutes} min` });
        this.studioOpen = false;
        this.showToast(`Temporizador de ${minutes} min iniciado`);
        return this._renderAll();
      }
      const presetBtn = e.target.closest('[data-preset-poll]');
      if (presetBtn) {
        this.engine.sendInteractive('poll:start', {
          question: '¿Listos para pasar al siguiente punto?',
          options: ['Listos', 'Necesito 2 min'],
        });
        this.studioOpen = false;
        this.showToast('Encuesta rápida en vivo');
        return this._renderAll();
      }
      const stAct = e.target.closest('[data-st-act]')?.getAttribute('data-st-act');
      if (stAct === 'wave') {
        this._triggerWaveVisual(true, null);
        this.studioOpen = false;
        this._renderAll();
      } else if (stAct === 'hand') {
        this.engine.toggleHand();
      } else if (stAct === 'flip') {
        this.engine.flipCamera();
      } else if (stAct === 'broadcast') {
        this.studioOpen = false;
        this._setSheet('broadcast');
      } else if (stAct === 'deal-card') {
        const pick = SPACE_CARDS[Math.floor(Math.random() * SPACE_CARDS.length)];
        this.engine.sendInteractive('card:deal', {
          id: crypto.randomUUID(),
          category: pick.category,
          prompt: pick.prompt,
        });
        this.studioOpen = false;
        this._renderAll();
      } else if (stAct === 'clear-card') {
        this.engine.sendInteractive('card:clear');
      } else if (stAct === 'stop-timer') {
        this.engine.sendInteractive('timer:stop');
      } else if (stAct === 'close-poll') {
        this.engine.sendInteractive('poll:close');
      }
    });

    this.mountEl.querySelector('#veil').addEventListener('click', () => {
      this.sheet = null;
      this.peekPeer = null;
      this._renderAll();
    });

    this.sheetSlot.addEventListener('change', async (e) => {
      if (e.target.id === 'bc-file-input' && e.target.files?.length) {
        const files = e.target.files;
        const result = this.broadcastHub
          ? await this.broadcastHub.pickMediaFiles(files)
          : await this.mediaBroadcaster.addFiles(files);
        e.target.value = '';
        if (result?.error) {
          this.showToast(result.error);
        } else if (result?.added?.length > 0) {
          this.showToast(`${result.added.length} archivo(s) guardados en tu playlist`);
        } else {
          this.showToast('Selecciona videos o fotos compatibles');
        }
      }
    });

    this.sheetSlot.addEventListener('input', (e) => {
      if (e.target.id === 'room-draft-name') {
        this.draftName = e.target.value;
      } else if (e.target.id === 'bc-seek') {
        this.mediaBroadcaster.seek(Number(e.target.value));
      } else if (e.target.id === 'bc-vol') {
        this.mediaBroadcaster.setVolume(Number(e.target.value));
      }
    });

    this.sheetSlot.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.getAttribute('data-act');
      if (act === 'close') return this._setSheet(null);
      if (act === 'open-invite') return this._openInviteSafe();
      if (act === 'open-broadcast') return this._setSheet('broadcast');
      if (act === 'switch-app') return this._setSheet('shareapp');
      if (act === 'open-superkey') return this._setSheet('superkey');
      if (act === 'open-tienda') return this._setSheet('tienda');
      if (act === 'toggle-silent') {
        this.silentMode = !this.silentMode;
        this.showToast(this.silentMode ? 'Modo silencio' : 'Sonidos y avisos activados');
        return this._renderAll();
      }
      if (act === 'open-acct') return this._setSheet('acct');
      if (act === 'open-mod') return this._setSheet('mod');
      if (act === 'open-admin') return this._setSheet('admin');
      if (act === 'retry-media') {
        this.engine.retryMedia();
        return this._setSheet(null);
      }
      if (act === 'edit-name') {
        this.draftName = this.engine.state.self?.name || this.nameInput || '';
        this.editingName = true;
        return this._renderSheetAndPeek();
      }
      if (act === 'cancel-name') {
        this.editingName = false;
        return this._renderSheetAndPeek();
      }

      // Broadcast Center controls
      const bcAct = e.target.closest('[data-bc]')?.getAttribute('data-bc');
      if (bcAct) {
        if (bcAct === 'screen') {
          this.mediaBroadcaster.stopPlayback();
          this._setSheet(null);
          await this.engine.startScreenBroadcast();
        } else if (bcAct === 'pick-files') {
          const inputEl = this.sheetSlot.querySelector('#bc-file-input');
          if (this.broadcastHub) {
            this.broadcastHub.openMediaPicker(inputEl);
          } else {
            inputEl?.click();
          }
        } else if (bcAct === 'clear-files') {
          if (this.broadcastHub) {
            await this.broadcastHub.clearPlaylist();
          } else {
            this.mediaBroadcaster.stopPlayback();
            await clearPlaylistItems();
            await this.mediaBroadcaster.loadStoredPlaylist();
          }
          this.showToast('Playlist local vaciada');
        } else if (bcAct === 'prev') {
          const snap = this.mediaBroadcaster.getSnapshot();
          if (snap.items.length > 0) {
            const idx = (snap.activeIndex - 1 + snap.items.length) % snap.items.length;
            await this.mediaBroadcaster.selectItem(idx, true);
          }
        } else if (bcAct === 'next') {
          const snap = this.mediaBroadcaster.getSnapshot();
          if (snap.items.length > 0) {
            const idx = (snap.activeIndex + 1) % snap.items.length;
            await this.mediaBroadcaster.selectItem(idx, true);
          }
        } else if (bcAct === 'toggle-play') {
          await this.mediaBroadcaster.togglePlay();
        } else if (bcAct === 'toggle-loop') {
          this.mediaBroadcaster.toggleLoop();
        } else if (bcAct === 'start-media') {
          const stream = await this.mediaBroadcaster.prepareStream();
          const title = this.mediaBroadcaster.getSnapshot().activeItem?.name || 'Multimedia local';
          const ok = await this.engine.startMediaBroadcast(stream, title);
          if (ok) {
            this._setSheet(null);
          } else {
            this.mediaBroadcaster.stopPlayback();
          }
        } else if (bcAct === 'stop') {
          this.mediaBroadcaster.stopPlayback();
          await this.engine.stopBroadcast();
        } else if (bcAct === 'release') {
          this.engine.hostAction('releaseEmitter');
          this.showToast('Escenario liberado');
        }
        return;
      }

      const bcItemBtn = e.target.closest('[data-bc-item]');
      if (bcItemBtn) {
        const idx = Number(bcItemBtn.getAttribute('data-bc-item'));
        const isLiveMedia =
          this.engine.state.meta?.emitterPeerId === this.engine.state.self?.peerId &&
          this.engine.state.meta?.broadcast?.sourceType === 'media';
        await this.mediaBroadcaster.selectItem(idx, isLiveMedia || this.mediaBroadcaster.playing);
        return;
      }

      const bcDelBtn = e.target.closest('[data-bc-del]');
      if (bcDelBtn) {
        const id = bcDelBtn.getAttribute('data-bc-del');
        await this.mediaBroadcaster.removeItem(id);
        return;
      }

      const grantBtn = e.target.closest('[data-grant-emitter]');
      if (grantBtn) {
        const targetId = grantBtn.getAttribute('data-grant-emitter') || null;
        this.engine.hostAction('grantEmitter', { targetPeerId: targetId });
        this.showToast(targetId ? 'Escenario cedido' : 'Escenario liberado');
        return;
      }

      const dm = e.target.closest('[data-dm]')?.getAttribute('data-dm');
      if (dm) {
        this.chatTarget = dm;
        this.sheet = null;
        return this._renderAll();
      }

      const kickBtn = e.target.closest('[data-kick]');
      if (kickBtn) {
        const kid = kickBtn.getAttribute('data-kick');
        const kname = kickBtn.getAttribute('data-kick-name');
        if (this.kickArmedId !== kid) {
          this.kickArmedId = kid;
          this.showToast(`Toca de nuevo para quitar a ${kname}`);
          if (this.kickTimer) window.clearTimeout(this.kickTimer);
          this.kickTimer = window.setTimeout(() => {
            this.kickArmedId = null;
            this._renderSheetAndPeek();
          }, 3000);
          this._renderSheetAndPeek();
        } else {
          this.engine.hostAction('kick', { targetPeerId: kid });
          this.kickArmedId = null;
          this._renderSheetAndPeek();
        }
        return;
      }

      const viewAct = e.target.closest('[data-view]')?.getAttribute('data-view');
      if (viewAct) {
        this.sheet = null;
        if (viewAct === 'full') {
          this.fitContain = !this.fitContain;
          this._renderAll();
        } else if (viewAct === 'wave') {
          this._renderAll();
          this._triggerWaveVisual(true, null);
        }
        return;
      }

      const modAct = e.target.closest('[data-mod]')?.getAttribute('data-mod');
      if (modAct) {
        const meta = this.engine.state.meta;
        if (modAct === 'releaseEmitter') {
          this.engine.hostAction('releaseEmitter');
          this.showToast('Escenario liberado');
        } else if (modAct === 'lock') {
          const next = !meta?.locked;
          this.engine.hostAction('lock', { value: next });
          this.showToast(next ? 'Sala bloqueada' : 'Sala abierta');
        } else if (modAct === 'waitingRoom') {
          const next = !meta?.waitingRoom;
          this.engine.hostAction('waitingRoom', { value: next });
          this.showToast(next ? 'Sala de espera activa' : 'Entrada directa activa');
        } else if (modAct === 'endRoom') {
          if (!this.endRoomArmed) {
            this.endRoomArmed = true;
            this.showToast('Toca de nuevo para terminar la sala para todos');
            if (this.endRoomTimer) window.clearTimeout(this.endRoomTimer);
            this.endRoomTimer = window.setTimeout(() => {
              this.endRoomArmed = false;
              this._renderSheetAndPeek();
            }, 3000);
            this._renderSheetAndPeek();
          } else {
            this.engine.hostAction('endRoom');
            this.endTitle = 'Sala terminada';
            this.sheet = null;
            this._renderAll();
          }
        }
      }
    });

    this.sheetSlot.addEventListener('submit', (e) => {
      if (e.target.id !== 'room-name-form') return;
      e.preventDefault();
      const trimmed = this.draftName.trim().slice(0, 24);
      if (trimmed.length < 2) return this.showToast('Escribe al menos 2 letras');
      this.nameInput = trimmed;
      this.onUpdateUserName?.(trimmed);
      setStoredName(trimmed);
      this.editingName = false;
      this._renderSheetAndPeek();
      this.showToast('Nombre actualizado para próximas salas');
    });

    this.pkEl.addEventListener('click', (e) => {
      const pk = e.target.closest('[data-pk]')?.getAttribute('data-pk');
      if (!pk || !this.peekPeer) return;
      if (pk === 'wave') {
        this._triggerWaveVisual(true, this.peekPeer.peerId);
      } else if (pk === 'grant') {
        const isCurrent = this.engine.state.meta?.emitterPeerId === this.peekPeer.peerId;
        this.engine.hostAction('grantEmitter', { targetPeerId: isCurrent ? null : this.peekPeer.peerId });
        this.showToast(isCurrent ? 'Escenario liberado' : `Escenario cedido a ${this.peekPeer.name}`);
      }
      this.peekPeer = null;
      this._renderAll();
    });

    this.backShieldEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._hideBackOnly();
    });
    this.backPillEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this._handleBackAction();
    });

    this.endEl.querySelector('#rejoin').addEventListener('click', () => {
      this.engine.joinRoom({
        roomCode: this.initialRoomCode,
        pass: this.passInput || this.initialPass || this.user?.suitePass,
        name: this.nameInput || this.user?.name || 'Invitado',
        micOn: false,
        camOn: this.preCamOn,
        wantHost: this.wantHost,
        requireMedia: false,
      });
    });
    this.endEl.querySelector('#mine').addEventListener('click', () => {
      if (this.user) this.onNewRoom(this.user.suiteCode, this.user.suitePass);
    });
    this.endEl.querySelector('#home').addEventListener('click', () => this.onExitHome());
  }

  _triggerHeartbeatVignette() {
    const slot = this.mountEl.querySelector('#heartbeat-vignette-slot');
    if (!slot) return;
    const vig = document.createElement('div');
    vig.className = 'heartbeat-vignette';
    slot.appendChild(vig);
    window.setTimeout(() => vig.remove(), 750);
  }

  _displaySubtitle(speaker, text) {
    const el = this.mountEl.querySelector('#live-subtitles');
    if (!el) return;
    if (!this.subtitlesActive || !text) {
      el.textContent = '';
      return;
    }
    el.innerHTML = `<b>${esc(speaker)}:</b> ${esc(text)}`;
    if (this.subtitleClearTimer) window.clearTimeout(this.subtitleClearTimer);
    this.subtitleClearTimer = window.setTimeout(() => {
      if (el) el.textContent = '';
    }, 4500);
  }

  destroy() {
    this._destroyed = true;
    this._releaseWakeLock();
    if (this._unsubBroadcastHub) {
      this._unsubBroadcastHub();
      this._unsubBroadcastHub = null;
    }
    if (this.broadcastHub) {
      this.mediaBroadcaster.stopPlayback();
    } else {
      this.mediaBroadcaster.destroy();
    }
    if (this._carouselScrollRaf) window.cancelAnimationFrame(this._carouselScrollRaf);
    if (this.subtitleClearTimer) window.clearTimeout(this.subtitleClearTimer);
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    if (this._onPerkUnlocked) window.removeEventListener('spacesuite:perk_unlocked', this._onPerkUnlocked);
    if (this._elapsedIv) window.clearInterval(this._elapsedIv);
    if (this.backTimer) window.clearTimeout(this.backTimer);
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    if (this.leaveTimer) window.clearTimeout(this.leaveTimer);
    if (this.endRoomTimer) window.clearTimeout(this.endRoomTimer);
    if (this.kickTimer) window.clearTimeout(this.kickTimer);
    if (this.adminCtrl) this.adminCtrl.destroy();
    this.chatHud.destroy();
    if (!this.handedOffPreview) this._stopPreviewStream();
    if (this._debugIv) window.clearInterval(this._debugIv);
    if (this._debugEl) this._debugEl.remove();
    this.engine.destroy();
    document.body.classList.remove(
      'fit',
      'weak',
      'open',
      'peeking',
      'mood-cosmos',
      'mood-emerald',
      'mood-amber',
      'mood-indigo',
    );
    this.mountEl.innerHTML = '';
  }
}
