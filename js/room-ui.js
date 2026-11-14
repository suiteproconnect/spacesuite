import {
  esc,
  formatDuration,
  getPeerTint,
  iconBack,
  iconBell,
  iconCam,
  iconChart,
  iconChat,
  iconFit,
  iconGrid,
  iconHand,
  iconInvite,
  iconLeave,
  iconLock,
  iconMic,
  iconPip,
  iconShare,
  iconShield,
  iconSwap,
  iconUsers,
  iconWave,
  iconWifi,
  playSound,
} from './icons.js';
import {
  buildRoomInviteUrl,
  getStoredName,
  loadChatSettings,
  saveChatSettings,
  setStoredName,
} from './identity.js';
import { ROOM_CAPACITY, RoomEngine } from './rtc.js';
import {
  AdminPanelController,
  bindShareSheetEvents,
  ChatHudController,
  renderQuickPeekHtml,
  renderRoomSheetHtml,
  renderShareSheetHtml,
} from './sheets.js';

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

function computeSymmetricalGrid(count, width, height) {
  if (count <= 1) return { sizes: [1], colsLcm: 1 };
  if (count === 2) {
    return width >= height ? { sizes: [2], colsLcm: 2 } : { sizes: [1, 1], colsLcm: 1 };
  }
  if (count === 3 || count === 4) {
    return { sizes: [2, count === 3 ? 1 : 2], colsLcm: 2 };
  }
  let best = null;
  for (let c = 1; c <= count; c++) {
    const r = Math.ceil(count / c);
    const aspect = width / c / (height / r);
    const sc = Math.abs(Math.log(aspect / 1.4)) + (c * r - count) * 0.25;
    if (!best || sc < best.sc) best = { r, sc };
  }
  const r = best ? best.r : 1;
  const sizes = Array.from({ length: r }, (_, i) => Math.floor(count / r) + (i < count % r ? 1 : 0));
  const colsLcm = sizes.reduce((a, b) => (a * b) / gcd(a, b), 1);
  return { sizes, colsLcm };
}

export class RoomController {
  constructor(mountEl, { initialRoomCode, initialPass, initialName, wantHost, user, onExitHome, onNewRoom, onUpdateUserName }) {
    this.mountEl = mountEl;
    this.initialRoomCode = initialRoomCode;
    this.initialPass = initialPass || '';
    this.wantHost = Boolean(wantHost);
    this.user = user;
    this.onExitHome = onExitHome;
    this.onNewRoom = onNewRoom;
    this.onUpdateUserName = onUpdateUserName;

    this.nameInput = initialName || user?.name || getStoredName('');
    this.passInput = initialPass || '';
    this.preMicOn = true;
    this.preCamOn = true;
    this.previewStream = null;
    this.previewAudioLevel = 0;
    this.permState = 'checking';
    this.permError = null;
    this.handedOffPreview = false;
    this._previewAudioCtx = null;
    this._previewAudioIv = null;

    this.viewMode = 'auto';
    this.pipSwapped = false;
    this.pipCorner = 'c-tr';
    this.pipDragOffset = null;
    this.gridSelfFirst = false;
    this.fitContain = false;
    this.gridPage = 0;
    this.barsHidden = false;

    this.silentMode = false;
    this.sheet = null;
    this.peekPeer = null;
    this.pinnedPeerId = null;
    this.selfFocused = false;
    this.lastRemotePeerId = null;

    this.chatOpen = false;
    this.chatTarget = null;
    this.chatSettings = loadChatSettings();
    this.unreadCount = 0;
    this.chatToast = null;
    this.lastSeenMsgCount = 0;
    this.chatToastTimer = null;

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
    this.lastRefreshAt = 0;
    this.lastVideoTapAt = 0;
    this.touchStart = null;
    this.didSwipeRefresh = false;
    this.pipDrag = null;

    this._elapsedStart = null;
    this._elapsedIv = null;
    this._prevWaitingCount = 0;
    this._prevStatus = 'idle';
    this._destroyed = false;

    // Persistent DOM caches (zero video flicker)
    this.videoCache = new Map();
    this.gridTileCache = new Map();
    this.satTileCache = new Map();
    this.adminCtrl = null;
    this._lastSheetSig = '';
    this._lastPeekSig = '';

    this._buildScaffold();
    this.engine = new RoomEngine(() => this._onEngineChange());
    this._bindEvents();
    this._requestPreJoinPermissions();
    this._renderAll();
  }

  _buildScaffold() {
    this.mountEl.innerHTML = `
      <div id="room-root">
        <div id="room-prejoin-slot"></div>
        <div id="room-wait-slot"></div>
        <section id="grid" aria-label="Participantes" hidden></section>
        <main class="main" id="main" aria-live="polite" hidden>
          <div class="lay" id="stage-lay"></div>
          <div class="vig"></div>
        </main>
        <section class="deck" id="deck" aria-label="Pantalla compartida"></section>
        <div class="who" id="who" hidden></div>
        <div class="sats" id="sats" hidden></div>
        <div class="me c-tr" id="me" title="Arrastra a cualquier esquina · Toca para intercambiar" hidden>
          <span></span>
          <div class="me-foot">
            <small class="me-tag"></small>
            <em class="me-mic on" aria-hidden="true"></em>
          </div>
          <i class="hb">${iconHand()}</i>
        </div>
        <div class="cam-bar" id="cam-bar" role="toolbar" aria-label="Modos de cámara" hidden>
          <button type="button" class="cam-btn" data-cbar="grid">${iconGrid()}<span>Todos</span></button>
          <button type="button" class="cam-btn" data-cbar="pip">${iconPip()}<span>Flotante</span></button>
          <button type="button" class="cam-btn" data-cbar="full">${iconFit()}<span id="cbar-full-lbl">Completa</span></button>
          <button type="button" class="cam-btn swap" data-cbar="swap" aria-label="Intercambiar cámara principal">${iconSwap()}<span>Intercambio</span></button>
        </div>
        <div class="pill" id="pill">${iconWifi()}<span>Conexión inestable</span></div>
        <section id="empty" aria-live="polite" hidden>
          <div><b>Tu sala está lista</b><span>Invita a alguien para empezar.</span></div>
          <button type="button" id="eInv">Invitar</button>
        </section>
        <button type="button" class="chat-toast" id="room-chat-toast" aria-label="Abrir mensaje nuevo en chat" hidden></button>
        <div id="note" role="status" aria-live="polite"></div>
        <div class="ui" id="ui" hidden></div>
        <button type="button" class="restore-bars-btn" id="restore-bars-btn" aria-label="Mostrar controles" hidden>
          <i class="dot"></i><span>Controles</span>
        </button>
        <div id="modal">
          <div class="veil" id="veil"></div>
          <div id="room-sheet-slot"></div>
          <section class="pk" id="pk" role="dialog" aria-modal="true" aria-label="Vista rápida"></section>
        </div>
        <div id="room-chat-slot"></div>
        <div class="glow" id="glow" aria-hidden="true"></div>
        <div id="room-ripples"></div>
        <div class="toast" id="toast" role="status" aria-live="polite"></div>
        <div id="back-shield" aria-hidden="true" hidden></div>
        <button type="button" class="back-pill" id="back-pill" aria-label="Atrás" hidden>${iconBack()}Atrás</button>
        <div class="end" id="end" hidden>
          <img src="/assets/aistudio/logo-app_a1f96350.svg" alt="spaceSUITE" width="76" height="76" />
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
    this.gridEl = this.mountEl.querySelector('#grid');
    this.mainEl = this.mountEl.querySelector('#main');
    this.layEl = this.mountEl.querySelector('#stage-lay');
    this.deckEl = this.mountEl.querySelector('#deck');
    this.whoEl = this.mountEl.querySelector('#who');
    this.satsEl = this.mountEl.querySelector('#sats');
    this.meEl = this.mountEl.querySelector('#me');
    this.camBarEl = this.mountEl.querySelector('#cam-bar');
    this.emptyEl = this.mountEl.querySelector('#empty');
    this.chatToastEl = this.mountEl.querySelector('#room-chat-toast');
    this.noteEl = this.mountEl.querySelector('#note');
    this.uiEl = this.mountEl.querySelector('#ui');
    this.restoreBarsBtn = this.mountEl.querySelector('#restore-bars-btn');
    this.sheetSlot = this.mountEl.querySelector('#room-sheet-slot');
    this.pkEl = this.mountEl.querySelector('#pk');
    this.glowEl = this.mountEl.querySelector('#glow');
    this.ripplesEl = this.mountEl.querySelector('#room-ripples');
    this.toastEl = this.mountEl.querySelector('#toast');
    this.backShieldEl = this.mountEl.querySelector('#back-shield');
    this.backPillEl = this.mountEl.querySelector('#back-pill');
    this.endEl = this.mountEl.querySelector('#end');

    // Dedicated Video elements for PiP & Deck
    this.pipVideoEl = document.createElement('video');
    this.pipVideoEl.id = 'vid';
    this.pipVideoEl.autoplay = true;
    this.pipVideoEl.playsInline = true;
    this.meEl.prepend(this.pipVideoEl);

    this.chatHud = new ChatHudController(this.mountEl.querySelector('#room-chat-slot'), {
      onSend: (text, to) => this.engine.sendChat(text, to),
      onTyping: (t, to) => this.engine.notifyTyping(t, to),
      onClose: () => {
        this.chatOpen = false;
        this._renderAll();
      },
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

  _setVideoStream(videoEl, stream, { muted = false, mirror = false } = {}) {
    if (!videoEl) return;
    if (videoEl.muted !== muted) videoEl.muted = muted;
    videoEl.style.transform = mirror ? 'scaleX(-1)' : 'none';
    if (videoEl.srcObject !== (stream || null)) {
      videoEl.srcObject = stream || null;
      if (stream) {
        videoEl.play().catch(() => {});
      }
    } else if (stream && videoEl.paused) {
      videoEl.play().catch(() => {});
    }
  }

  _attachSwipeHandlers(el, getPeerFn, isSelfTileFn) {
    if (el._swipeBound) return;
    el._swipeBound = true;
    let tStart = null;
    let pStart = null;
    let lastSwipe = null;
    let suppressUntil = 0;

    const register = (dx, dy, dt) => {
      if (isSelfTileFn()) return;
      if (Math.abs(dx) >= 38 && Math.abs(dy) < 52 && dt < 600) {
        suppressUntil = Date.now() + 350;
        const dir = dx > 0 ? 'right' : 'left';
        const now = Date.now();
        if (lastSwipe && now - lastSwipe.time <= 950) {
          lastSwipe = null;
          this._handleDoubleSwipePeer(getPeerFn(), dir);
        } else {
          lastSwipe = { time: now, dir };
        }
      }
    };

    el.addEventListener('touchstart', (e) => {
      tStart = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
    });
    el.addEventListener('touchend', (e) => {
      const s = tStart;
      tStart = null;
      if (!s || e.changedTouches.length !== 1) return;
      register(e.changedTouches[0].clientX - s.x, e.changedTouches[0].clientY - s.y, Date.now() - s.t);
    });
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') pStart = { x: e.clientX, y: e.clientY, t: Date.now() };
    });
    el.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return;
      const s = pStart;
      pStart = null;
      if (!s) return;
      register(e.clientX - s.x, e.clientY - s.y, Date.now() - s.t);
    });
    el._isClickSuppressed = () => Date.now() < suppressUntil;
  }

  _stopPreviewStream() {
    if (this._previewAudioIv) {
      window.clearInterval(this._previewAudioIv);
      this._previewAudioIv = null;
    }
    if (this._previewAudioCtx) {
      this._previewAudioCtx.close().catch(() => {});
      this._previewAudioCtx = null;
    }
    if (this.previewStream) {
      this.previewStream.getTracks().forEach((t) => t.stop());
      this.previewStream = null;
    }
  }

  _startPreviewMicMeter() {
    if (this._previewAudioIv) window.clearInterval(this._previewAudioIv);
    if (this._previewAudioCtx) this._previewAudioCtx.close().catch(() => {});
    this._previewAudioIv = null;
    this._previewAudioCtx = null;
    this.previewAudioLevel = 0;

    if (!this.previewStream || this.engine.state.status !== 'idle' || !this.preMicOn) {
      this._updatePreJoinDynamic();
      return;
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx && this.previewStream.getAudioTracks().length > 0) {
        const ctx = new AudioCtx();
        this._previewAudioCtx = ctx;
        const src = ctx.createMediaStreamSource(this.previewStream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        this._previewAudioIv = window.setInterval(() => {
          if (this._destroyed || this.engine.state.status !== 'idle') return;
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          this.previewAudioLevel = Math.min(1, sum / data.length / 42);
          const bar = this.prejoinSlot.querySelector('#pre-mic-bar');
          if (bar) bar.style.width = `${Math.round(this.previewAudioLevel * 100)}%`;
        }, 100);
      }
    } catch {
      // ignore
    }
  }

  async _requestPreJoinPermissions() {
    this.permState = 'checking';
    this.permError = null;
    this._updatePreJoinDynamic();
    if (!navigator.mediaDevices?.getUserMedia) {
      this.permState = 'denied';
      this.permError = 'Enciende tu cámara para unirte a la sala';
      this._updatePreJoinDynamic();
      return;
    }
    try {
      if (this.previewStream && !this.handedOffPreview) {
        this.previewStream.getTracks().forEach((t) => t.stop());
      }
      this.handedOffPreview = false;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      });
      stream.getAudioTracks().forEach((t) => {
        t.enabled = this.preMicOn;
      });
      stream.getVideoTracks().forEach((t) => {
        t.enabled = true;
      });
      this.preCamOn = true;
      this.previewStream = stream;
      const hasCam = stream.getVideoTracks().some((t) => t.readyState === 'live');
      if (hasCam) {
        this.permState = 'ready';
      } else {
        this.permState = 'denied';
        this.permError = 'Enciende tu cámara para unirte a la sala';
      }
    } catch {
      this.permState = 'denied';
      this.permError = 'Enciende tu cámara para unirte a la sala';
    }
    this._startPreviewMicMeter();
    this._updatePreJoinDynamic();
  }

  _isCamActiveForJoin() {
    return (
      this.permState === 'ready' &&
      this.preCamOn &&
      Boolean(this.previewStream?.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled))
    );
  }

  _onEngineChange() {
    if (this._destroyed) return;
    const st = this.engine.state;

    if (st.mediaNotice && st.mediaNotice !== this._lastMediaNotice) {
      this._lastMediaNotice = st.mediaNotice;
      this.showToast(st.mediaNotice);
    }
    if (st.hostMuteNotice) {
      this.showToast(st.hostMuteNotice);
      this.engine.clearHostMuteNotice();
    }

    if (st.lastWave && st.lastWave.id !== this.lastHandledWaveId) {
      this.lastHandledWaveId = st.lastWave.id;
      this._triggerWaveVisual(false);
      if (!this.silentMode) playSound('join');
      this.showToast(`${st.lastWave.fromName} envió una onda`);
      window.setTimeout(() => this.engine.clearWave(), 1180);
    }

    if (st.waiting.length > this._prevWaitingCount && st.self?.role === 'host' && !this.silentMode) {
      playSound('knock');
    }
    this._prevWaitingCount = st.waiting.length;

    if (st.status === 'connected' && this._prevStatus !== 'connected') {
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
      }, 1000);
    } else if (st.status !== 'connected' && this._prevStatus === 'connected') {
      if (this._elapsedIv) {
        window.clearInterval(this._elapsedIv);
        this._elapsedIv = null;
      }
      this.barsHidden = false;
    }
    this._prevStatus = st.status;

    // Smart chat notifications
    if (this.chatOpen) {
      this.lastSeenMsgCount = st.messages.length;
      this.unreadCount = 0;
      this.chatToast = null;
    } else if (st.messages.length > this.lastSeenMsgCount) {
      const newlyArrived = st.messages.slice(this.lastSeenMsgCount);
      this.lastSeenMsgCount = st.messages.length;
      const remoteIncoming = newlyArrived.filter((m) => m.fromPeerId !== st.self?.peerId);
      if (remoteIncoming.length > 0 && st.status === 'connected') {
        this.unreadCount += remoteIncoming.length;
        if (!this.silentMode && this.chatSettings.soundEnabled) playSound('msg');
        if (this.chatSettings.toastEnabled) {
          const latest = remoteIncoming[remoteIncoming.length - 1];
          this.chatToast = {
            id: latest.id,
            senderName: latest.fromName,
            text: latest.text,
            targetPeerId: latest.toPeerId ? latest.fromPeerId : null,
          };
          if (this.chatToastTimer) window.clearTimeout(this.chatToastTimer);
          this.chatToastTimer = window.setTimeout(() => {
            this.chatToast = null;
            this._renderChatToast();
          }, 4000);
        }
      }
    }

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

  _getComputedLayout() {
    const st = this.engine.state;
    const presentingPeer = st.peers.find((p) => p.screenSharing) || null;
    const isPresenting = Boolean(presentingPeer);
    const orderedPeers = [...st.peers].sort((a, b) => {
      if (a.peerId === st.self?.peerId && st.peers.length === 1) return 0;
      if (a.peerId === this.pinnedPeerId) return -1;
      if (b.peerId === this.pinnedPeerId) return 1;
      const aSpeak = Boolean(st.speakingIds[a.peerId] || a.speaking);
      const bSpeak = Boolean(st.speakingIds[b.peerId] || b.speaking);
      if (aSpeak !== bSpeak) return aSpeak ? -1 : 1;
      if (a.peerId === st.self?.peerId) return this.gridSelfFirst ? -1 : 1;
      if (b.peerId === st.self?.peerId) return this.gridSelfFirst ? 1 : -1;
      return a.joinedAt - b.joinedAt;
    });

    let effectiveMode = 'grid';
    if (isPresenting || this.viewMode === 'fullscreen') effectiveMode = 'fullscreen';
    else if (this.viewMode === 'pip') effectiveMode = 'stage-pip';
    else if (this.viewMode === 'grid') effectiveMode = 'grid';
    else effectiveMode = orderedPeers.length === 2 ? 'stage-pip' : 'grid';

    const viewMain = effectiveMode === 'fullscreen' || effectiveMode === 'stage-pip';
    const remotes = orderedPeers.filter((p) => p.peerId !== st.self?.peerId);
    let primaryRemotePeer = null;
    if (remotes.length > 0) {
      primaryRemotePeer =
        (this.pinnedPeerId && remotes.find((p) => p.peerId === this.pinnedPeerId)) ||
        (this.lastRemotePeerId && remotes.find((p) => p.peerId === this.lastRemotePeerId)) ||
        remotes[0];
    }

    let stagePeer = null;
    if (effectiveMode === 'stage-pip') {
      stagePeer = this.pipSwapped && st.self ? st.self : primaryRemotePeer || st.self || null;
    } else if (this.selfFocused && st.self) {
      stagePeer = st.self;
    } else if (this.pinnedPeerId) {
      stagePeer = orderedPeers.find((p) => p.peerId === this.pinnedPeerId) || orderedPeers[0] || null;
    } else {
      stagePeer =
        orderedPeers.find(
          (p) => p.peerId !== st.self?.peerId && (st.speakingIds[p.peerId] || p.speaking),
        ) ||
        remotes[0] ||
        st.self ||
        null;
    }

    let pipPeer = null;
    if (st.self) {
      if (effectiveMode === 'stage-pip' && this.pipSwapped && primaryRemotePeer) {
        pipPeer = primaryRemotePeer;
      } else if (
        effectiveMode === 'stage-pip' ||
        isPresenting ||
        (viewMain && stagePeer?.peerId !== st.self.peerId)
      ) {
        pipPeer = st.self;
      }
    }

    return { presentingPeer, isPresenting, orderedPeers, effectiveMode, viewMain, stagePeer, pipPeer };
  }

  _streamForPeer(p) {
    if (!p) return null;
    const st = this.engine.state;
    return p.peerId === st.self?.peerId ? st.localStream : st.remoteStreams[p.peerId] || null;
  }

  _hasLiveVideo(p, stream) {
    return Boolean(
      stream && stream.getVideoTracks().some((t) => t.readyState === 'live') && (p.camOn || p.screenSharing),
    );
  }

  _renderAll() {
    if (this._destroyed) return;
    const st = this.engine.state;
    const layout = this._getComputedLayout();
    const { isPresenting, effectiveMode } = layout;

    // Sync body classes
    document.body.classList.toggle('grid', effectiveMode === 'grid' && !isPresenting);
    document.body.classList.toggle('pres', isPresenting);
    document.body.classList.toggle('fit', this.fitContain);
    document.body.classList.toggle('weak', st.weakConnection);
    document.body.classList.toggle('open', this.sheet !== null);
    document.body.classList.toggle('peeking', this.peekPeer !== null);
    document.body.classList.toggle('bars-hidden', this.barsHidden);

    this._renderPreJoin();
    this._renderWaitOrRejected();
    this._renderGrid(layout);
    this._renderStage(layout);
    this._renderDeck(layout);
    this._renderWho(layout);
    this._renderSats(layout);
    this._renderPip(layout);
    this._renderCamBar(layout);
    this._renderEmptyBanner();
    this._renderChatToast();
    this._renderNoteBar();
    this._renderUiAndDock();
    this.restoreBarsBtn.hidden = !(st.status === 'connected' && this.barsHidden);
    this._renderSheetAndPeek();
    this._renderChat();
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
                <span class="perm-pill" id="pre-mic-pill"></span>
              </div>
            </div>
            <div class="pre-bottom-card">
              <div class="pre-cam-bar">
                <button type="button" class="orb sm" id="pre-mic-btn"></button>
                <button type="button" class="orb sm" id="pre-cam-btn"></button>
              </div>
              <div class="mic-meter" aria-hidden="true"><div id="pre-mic-bar" style="width:0%"></div></div>
              <p class="perm-err" id="pre-err" hidden></p>
              <h2>Antes de entrar</h2>
              <p class="pre-sub">Sala ${esc(this.initialRoomCode)}</p>
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
    const micPill = this.prejoinSlot.querySelector('#pre-mic-pill');
    const micBtn = this.prejoinSlot.querySelector('#pre-mic-btn');
    const camBtn = this.prejoinSlot.querySelector('#pre-cam-btn');
    const errEl = this.prejoinSlot.querySelector('#pre-err');
    const permBtn = this.prejoinSlot.querySelector('#pre-perm-btn');
    const joinBtn = this.prejoinSlot.querySelector('#pre-join-btn');

    const showVid = this.preCamOn && Boolean(this.previewStream) && this.permState === 'ready';
    this._setVideoStream(vid, this.previewStream, { muted: true, mirror: false });
    if (vid) vid.style.opacity = showVid ? '1' : '0';
    if (fb) fb.style.display = showVid ? 'none' : 'flex';
    if (av) av.textContent = (this.nameInput.trim()[0] || this.user?.name?.[0] || 'S').toUpperCase();

    if (camPill) {
      camPill.className = `perm-pill ${isCamActive ? 'ok' : 'err'}`;
      camPill.textContent = `Cámara: ${isCamActive ? 'Activa' : this.permState === 'checking' ? 'Verificando…' : 'Apagada'}`;
    }
    if (micPill) {
      micPill.className = `perm-pill ${
        this.permState === 'ready' && this.preMicOn ? 'ok' : this.permState === 'denied' ? 'err' : ''
      }`;
      micPill.textContent = `Micro: ${
        this.permState === 'ready' ? (this.preMicOn ? 'Listo' : 'Silenciado') : 'Verificando…'
      }`;
    }

    if (micBtn) {
      micBtn.className = `orb sm ${this.preMicOn ? 'active-mint' : 'rm'}`;
      micBtn.setAttribute('aria-label', this.preMicOn ? 'Silenciar micrófono' : 'Activar micrófono');
      micBtn.innerHTML = iconMic(!this.preMicOn);
    }
    if (camBtn) {
      camBtn.className = `orb sm ${isCamActive ? 'active-mint' : 'rm'}`;
      camBtn.setAttribute('aria-label', isCamActive ? 'Apagar cámara' : 'Encender cámara');
      camBtn.innerHTML = iconCam(!isCamActive);
    }

    if (errEl) {
      if (!isCamActive && this.permState !== 'checking') {
        errEl.hidden = false;
        errEl.textContent = 'Enciende tu cámara para unirte a la sala';
      } else if (this.permError && isCamActive) {
        errEl.hidden = false;
        errEl.textContent = this.permError;
      } else {
        errEl.hidden = true;
      }
    }

    if (this.permState !== 'ready') {
      if (permBtn) {
        permBtn.hidden = false;
        permBtn.disabled = this.permState === 'checking';
        permBtn.textContent = this.permState === 'checking' ? 'Validando cámara…' : 'Activar cámara y micrófono';
      }
      if (joinBtn) joinBtn.hidden = true;
    } else {
      if (permBtn) permBtn.hidden = true;
      if (joinBtn) {
        joinBtn.hidden = false;
        joinBtn.disabled = this.engine.state.status === 'joining' || !isCamActive;
        joinBtn.textContent = this.engine.state.status === 'joining' ? 'Conectando...' : 'Entrar a la sala';
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
          <img src="/assets/aistudio/logo-app_a1f96350.svg" alt="" width="76" height="76" style="border-radius:18px" />
          <p>${esc(st.rejectionMessage || 'No pudiste entrar a la sala.')}</p>
          <div class="bs"><button type="button" class="p" data-exit-home>Ir al inicio</button></div>
        </div>
      `;
    } else {
      this.waitSlot.innerHTML = '';
    }
  }

  _getOrCreateGridTile(peer) {
    let entry = this.gridTileCache.get(peer.peerId);
    if (!entry) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gt';
      btn.innerHTML = `<b class="gi"></b><video autoplay playsinline></video><span class="gn"></span><em class="gb"></em>`;
      const vid = btn.querySelector('video');
      const gi = btn.querySelector('.gi');
      const gn = btn.querySelector('.gn');
      const gb = btn.querySelector('.gb');
      entry = { btn, vid, gi, gn, gb, peer };
      this._attachSwipeHandlers(
        btn,
        () => entry.peer,
        () => entry.peer.peerId === this.engine.state.self?.peerId,
      );
      btn.addEventListener('click', () => {
        if (btn._isClickSuppressed?.() || this.didSwipeRefresh) return;
        const peersCount = this.engine.state.peers.length;
        if (peersCount > 1) {
          this._activateFullscreenMode(entry.peer);
        } else {
          this._handleVideoAreaTap();
        }
      });
      this.gridTileCache.set(peer.peerId, entry);
    }
    entry.peer = peer;
    return entry;
  }

  _updateGridTile(entry, peer, span) {
    const st = this.engine.state;
    const isSelf = peer.peerId === st.self?.peerId;
    const isSpeaking = Boolean(st.speakingIds[peer.peerId] || peer.speaking);
    const stream = this._streamForPeer(peer);
    const hasLive = this._hasLiveVideo(peer, stream);

    entry.btn.className = `gt ${isSelf ? 'self' : ''} ${!hasLive ? 'off' : ''} ${isSpeaking ? 'sp' : ''}`;
    entry.btn.style.background = getPeerTint(peer.peerId);
    entry.btn.style.gridColumn = span ? `span ${span}` : '';
    entry.btn.setAttribute('aria-label', `Ver a ${peer.name}`);
    entry.gi.textContent = peer.initial;
    entry.gn.textContent = isSelf ? 'Tú' : peer.name;

    const badgesHtml = `${!peer.micOn ? iconMic(true) : ''}${peer.handRaised ? iconHand('hand-ic') : ''}${
      peer.screenSharing ? iconShare('scr-ic') : ''
    }`;
    if (entry.gb._lastHtml !== badgesHtml) {
      entry.gb.innerHTML = badgesHtml;
      entry.gb._lastHtml = badgesHtml;
    }

    this._setVideoStream(entry.vid, stream, {
      muted: isSelf,
      mirror: isSelf && !peer.screenSharing,
    });
  }

  _renderGrid(layout) {
    const { effectiveMode, isPresenting, orderedPeers } = layout;
    const show = effectiveMode === 'grid' && !isPresenting && this.engine.state.status === 'connected';
    this.gridEl.hidden = !show;
    if (!show) return;

    const isPaginated = orderedPeers.length > 4;
    this.gridEl.classList.toggle('paginated', isPaginated);

    if (isPaginated) {
      this.gridEl.style.gridTemplateColumns = '';
      this.gridEl.style.gridTemplateRows = '';

      const chunks = [];
      for (let i = 0; i < orderedPeers.length; i += 4) {
        chunks.push(orderedPeers.slice(i, i + 4));
      }
      if (this.gridPage >= chunks.length) this.gridPage = Math.max(0, chunks.length - 1);

      let pager = this.gridEl.querySelector('.grid-pager');
      if (!pager) {
        this.gridEl.innerHTML = '<div class="grid-pager"></div><div class="grid-dots" aria-label="Páginas de cámara"></div>';
        pager = this.gridEl.querySelector('.grid-pager');
        pager.addEventListener('scroll', () => {
          const idx = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth));
          if (idx !== this.gridPage) {
            this.gridPage = idx;
            this._updateGridDots(chunks.length);
          }
        });
      }

      // Ensure page count matches
      while (pager.children.length > chunks.length) pager.lastElementChild.remove();
      while (pager.children.length < chunks.length) {
        const pg = document.createElement('div');
        pg.className = 'grid-page';
        pager.appendChild(pg);
      }

      chunks.forEach((pagePeers, pageIdx) => {
        const pageEl = pager.children[pageIdx];
        const desiredIds = pagePeers.map((p) => p.peerId);
        // Remove stale children not in this page
        Array.from(pageEl.children).forEach((child, idx) => {
          if (idx >= desiredIds.length || child !== this.gridTileCache.get(desiredIds[idx])?.btn) {
            child.remove();
          }
        });
        pagePeers.forEach((peer, idx) => {
          const entry = this._getOrCreateGridTile(peer);
          this._updateGridTile(entry, peer, null);
          if (pageEl.children[idx] !== entry.btn) {
            pageEl.insertBefore(entry.btn, pageEl.children[idx] || null);
          }
        });
      });

      this._updateGridDots(chunks.length);
    } else {
      // Non-paginated grid (1..4 peers)
      if (this.gridEl.querySelector('.grid-pager')) {
        this.gridEl.innerHTML = '';
      }
      const plan = computeSymmetricalGrid(orderedPeers.length, this.viewport.w, this.viewport.h);
      const spans = [];
      plan.sizes.forEach((sz) => {
        const span = plan.colsLcm / sz;
        for (let i = 0; i < sz; i++) spans.push(span);
      });
      this.gridEl.style.gridTemplateColumns = `repeat(${plan.colsLcm}, 1fr)`;
      this.gridEl.style.gridTemplateRows = `repeat(${plan.sizes.length}, 1fr)`;

      const desiredBtns = orderedPeers.map((peer, idx) => {
        const entry = this._getOrCreateGridTile(peer);
        this._updateGridTile(entry, peer, spans[idx]);
        return entry.btn;
      });
      Array.from(this.gridEl.children).forEach((child) => {
        if (!desiredBtns.includes(child)) child.remove();
      });
      desiredBtns.forEach((btn, idx) => {
        if (this.gridEl.children[idx] !== btn) {
          this.gridEl.insertBefore(btn, this.gridEl.children[idx] || null);
        }
      });
    }
  }

  _updateGridDots(total) {
    const dotsEl = this.gridEl.querySelector('.grid-dots');
    if (!dotsEl) return;
    dotsEl.hidden = total <= 1;
    if (total <= 1) return;
    dotsEl.innerHTML = Array.from({ length: total }, (_, idx) => {
      return `<button type="button" class="g-dot ${this.gridPage === idx ? 'on' : ''}" data-gdot="${idx}" aria-label="Página ${idx + 1}"></button>`;
    }).join('');
  }

  _renderStage(layout) {
    const { viewMain, isPresenting, stagePeer } = layout;
    const show = viewMain && !isPresenting && this.engine.state.status === 'connected';
    this.mainEl.hidden = !show;
    if (!show || !stagePeer) return;

    if (!this._stageTile) {
      const div = document.createElement('div');
      div.className = 'stage-tile';
      div.innerHTML = `<video class="mv" autoplay playsinline></video><span class="li"></span>`;
      const vid = div.querySelector('video');
      const li = div.querySelector('.li');
      this._stageTile = { div, vid, li, peer: stagePeer };
      this._attachSwipeHandlers(
        div,
        () => this._stageTile.peer,
        () => this._stageTile.peer.peerId === this.engine.state.self?.peerId,
      );
      this.layEl.appendChild(div);
    }
    this._stageTile.peer = stagePeer;
    const isSelf = stagePeer.peerId === this.engine.state.self?.peerId;
    const stream = this._streamForPeer(stagePeer);
    const hasLive = this._hasLiveVideo(stagePeer, stream);
    this._stageTile.vid.style.opacity = hasLive ? '1' : '0';
    this._stageTile.li.style.display = hasLive ? 'none' : '';
    this._stageTile.li.textContent = stagePeer.initial;
    this._setVideoStream(this._stageTile.vid, stream, {
      muted: true,
      mirror: isSelf && !stagePeer.screenSharing,
    });
  }

  _renderDeck(layout) {
    const { presentingPeer } = layout;
    if (!presentingPeer) {
      if (this._deckMounted) {
        this.deckEl.innerHTML = '';
        this._deckMounted = false;
        this._deckVideoEl = null;
      }
      return;
    }
    if (!this._deckMounted) {
      this._deckMounted = true;
      this.deckEl.innerHTML = `<video autoplay playsinline muted></video><div class="deck-badge"></div>`;
      this._deckVideoEl = this.deckEl.querySelector('video');
      this._deckBadgeEl = this.deckEl.querySelector('.deck-badge');
    }
    const isSelf = presentingPeer.peerId === this.engine.state.self?.peerId;
    const stream = isSelf ? this.engine.state.screenStream : this.engine.state.remoteStreams[presentingPeer.peerId] || null;
    this._setVideoStream(this._deckVideoEl, stream, { muted: true, mirror: false });
    this._deckBadgeEl.textContent = isSelf
      ? 'Estás compartiendo tu pantalla'
      : `${presentingPeer.name} comparte su pantalla`;
  }

  _renderWho(layout) {
    const { viewMain, isPresenting, stagePeer } = layout;
    const show = viewMain && !isPresenting && stagePeer && !this.barsHidden && this.engine.state.status === 'connected';
    this.whoEl.hidden = !show;
    if (!show) return;
    const isSelf = stagePeer.peerId === this.engine.state.self?.peerId;
    const sig = `${stagePeer.peerId}:${stagePeer.initial}:${stagePeer.name}:${stagePeer.role}:${isSelf}`;
    if (sig === this._lastWhoSig) return;
    this._lastWhoSig = sig;
    this.whoEl.innerHTML = `
      <i>${esc(stagePeer.initial)}</i>
      <span><b>${isSelf ? 'Tú' : esc(stagePeer.name)}</b>${stagePeer.role === 'host' ? 'Anfitrión' : 'En escena'}</span>
      ${!isSelf ? `<button type="button" class="orb sm" data-who-wave="${esc(stagePeer.peerId)}" aria-label="Enviar una onda">${iconWave()}</button>` : ''}
    `;
  }

  _renderSats(layout) {
    const { isPresenting, orderedPeers } = layout;
    const show =
      this.engine.state.status === 'connected' &&
      (this.viewMode === 'fullscreen' || isPresenting) &&
      orderedPeers.length > 2 &&
      !this.barsHidden;
    this.satsEl.hidden = !show;
    if (!show) return;

    const st = this.engine.state;
    const desired = orderedPeers.map((peer) => {
      let entry = this.satTileCache.get(peer.peerId);
      if (!entry) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sat';
        btn.innerHTML = `<div class="vw"><video autoplay playsinline muted></video></div><b></b><small></small>`;
        entry = {
          btn,
          vid: btn.querySelector('video'),
          b: btn.querySelector('b'),
          sm: btn.querySelector('small'),
          peer,
        };
        btn.addEventListener('click', () => this._activateFullscreenMode(entry.peer));
        this.satTileCache.set(peer.peerId, entry);
      }
      entry.peer = peer;
      const isSelf = peer.peerId === st.self?.peerId;
      const isSp = Boolean(st.speakingIds[peer.peerId] || peer.speaking);
      const stream = this._streamForPeer(peer);
      const hasLive = this._hasLiveVideo(peer, stream);

      entry.btn.className = `sat ${isSp ? 'sp' : ''}`;
      entry.btn.style.background = getPeerTint(peer.peerId);
      entry.btn.setAttribute('aria-label', peer.name);
      entry.vid.style.opacity = hasLive ? '1' : '0';
      entry.b.style.display = hasLive ? 'none' : '';
      entry.b.textContent = peer.initial;
      entry.sm.textContent = isSelf ? 'Tú' : peer.name;
      this._setVideoStream(entry.vid, stream, { muted: true, mirror: isSelf && !peer.screenSharing });
      return entry.btn;
    });

    Array.from(this.satsEl.children).forEach((ch) => {
      if (!desired.includes(ch)) ch.remove();
    });
    desired.forEach((btn, idx) => {
      if (this.satsEl.children[idx] !== btn) this.satsEl.insertBefore(btn, this.satsEl.children[idx] || null);
    });
  }

  _renderPip(layout) {
    const { pipPeer } = layout;
    const show = this.engine.state.status === 'connected' && Boolean(pipPeer);
    this.meEl.hidden = !show;
    if (!show || !pipPeer) return;

    const st = this.engine.state;
    const isSelf = pipPeer.peerId === st.self?.peerId;
    const stream = isSelf ? st.localStream : st.remoteStreams[pipPeer.peerId] || null;
    const hasLive = Boolean(pipPeer.camOn && stream && stream.getVideoTracks().some((t) => t.readyState === 'live'));

    this.meEl.className = `me ${this.pipCorner} ${hasLive ? 'live' : ''} ${pipPeer.handRaised ? 'hand' : ''} ${
      this.pipDragOffset ? 'dragging' : ''
    }`;
    this.meEl.style.transform = this.pipDragOffset
      ? `translate3d(${this.pipDragOffset.x}px, ${this.pipDragOffset.y}px, 0)`
      : '';

    this._setVideoStream(this.pipVideoEl, stream, {
      muted: isSelf,
      mirror: isSelf && !pipPeer.screenSharing,
    });

    this.meEl.querySelector(':scope > span').textContent = pipPeer.initial;
    this.meEl.querySelector('.me-tag').textContent = isSelf ? 'Tú' : pipPeer.name;
    const micEl = this.meEl.querySelector('.me-mic');
    micEl.className = `me-mic ${pipPeer.micOn ? 'on' : 'off'}`;
    const micSvg = iconMic(!pipPeer.micOn);
    if (micEl._lastHtml !== micSvg) {
      micEl.innerHTML = micSvg;
      micEl._lastHtml = micSvg;
    }
  }

  _renderCamBar(layout) {
    const st = this.engine.state;
    const show =
      st.status === 'connected' && Boolean(st.self) && !this.chatOpen && this.sheet === null && !this.barsHidden;
    this.camBarEl.hidden = !show;
    if (!show) return;
    const { effectiveMode, isPresenting } = layout;
    this.camBarEl.querySelector('[data-cbar="grid"]').classList.toggle('on', effectiveMode === 'grid' && !isPresenting);
    this.camBarEl.querySelector('[data-cbar="pip"]').classList.toggle('on', effectiveMode === 'stage-pip' && !isPresenting);
    this.camBarEl
      .querySelector('[data-cbar="full"]')
      .classList.toggle('on', this.viewMode === 'fullscreen' || this.fitContain);
    this.camBarEl.querySelector('#cbar-full-lbl').textContent =
      this.viewMode === 'fullscreen' && this.fitContain ? 'Llenar' : 'Completa';
  }

  _renderEmptyBanner() {
    const st = this.engine.state;
    const show =
      st.status === 'connected' && st.peers.length <= 1 && !this.chatOpen && this.sheet === null && !this.barsHidden;
    this.emptyEl.hidden = !show;
    if (!show) return;
    const full = st.peers.length >= st.roomCapacity;
    const btn = this.emptyEl.querySelector('#eInv');
    btn.disabled = full;
    btn.textContent = full ? 'Sala llena' : 'Invitar';
  }

  _renderChatToast() {
    const show = this.engine.state.status === 'connected' && Boolean(this.chatToast) && !this.chatOpen;
    this.chatToastEl.hidden = !show;
    if (!show) return;
    this.chatToastEl.innerHTML = `<i class="ct-dot"></i><div><b>${esc(this.chatToast.senderName)}</b><span>${esc(this.chatToast.text)}</span></div>`;
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
    const selfInitial = (st.self.initial || this.user?.name?.[0] || this.nameInput?.[0] || 'T').toUpperCase();
    const isAdminUser = this.user?.role === 'admin';
    const isHost = st.self.role === 'host';
    const sig = [
      st.self.role,
      st.self.micOn,
      st.self.camOn,
      st.self.screenSharing,
      st.self.handRaised,
      st.peers.length,
      st.roomCapacity,
      Boolean(st.meta?.locked),
      st.waiting.length,
      this.silentMode,
      this.chatOpen,
      this.unreadCount,
      this.leaveArmed,
      isAdminUser,
      selfInitial,
    ].join('|');

    if (sig === this._lastUiSig) return;
    this._lastUiSig = sig;

    this.uiEl.innerHTML = `
      <div class="top">
        <button type="button" class="tlg-btn" id="room-logo-refresh" aria-label="Actualizar sala sin mover cámaras" title="Toca para sincronizar">
          <img class="tlg ${this.logoRefreshing ? 'refreshing' : ''}" src="/assets/aistudio/logo-app_a1f96350.svg" alt="spaceSUITE" width="48" height="48" />
        </button>
        <div class="tt">
          <h1>spaceSUITE<span class="role">${isHost ? 'Anfitrión' : 'Invitado'}</span></h1>
          <p>
            ${st.meta?.locked ? `<span id="lk" title="Sala bloqueada">${iconLock(false)}</span>` : ''}
            <i class="dot"></i>
            <span id="online">${st.peers.length} / ${st.roomCapacity} en sala</span> · <span id="clock">${formatDuration(this.elapsedSec)}</span>
          </p>
        </div>
        ${
          isAdminUser
            ? `<div class="tops">
                <button type="button" class="orb sm pl" id="tPe" aria-label="Participantes">${iconUsers()}<span id="cnt">${st.peers.length}</span></button>
                <button type="button" class="orb sm" id="tIn" ${isRoomFull ? 'disabled' : ''} aria-label="${isRoomFull ? 'Sala llena' : 'Invitar a la sala'}">${iconInvite()}</button>
                <button type="button" class="orb sm" id="tSn" aria-pressed="${this.silentMode}" aria-label="Modo silencio">${iconBell(this.silentMode)}</button>
                <button type="button" class="orb sm" id="tMe" aria-label="Mi cuenta"><span style="font-weight:700;font-size:0.9rem">${esc(selfInitial)}</span></button>
                <button type="button" class="orb sm" id="tPro" aria-label="Panel Admin Pro">${iconChart()}</button>
                ${
                  isHost
                    ? `<button type="button" class="orb sm" id="tAd" aria-label="Opciones de sala">${iconShield()}${
                        st.waiting.length > 0 ? `<i class="bdg">${st.waiting.length}</i>` : ''
                      }</button>`
                    : ''
                }
              </div>`
            : ''
        }
      </div>
      <div class="ctl" id="dock">
        <button type="button" class="orb tg" data-dock="mic" aria-pressed="${st.self.micOn}" aria-label="Micrófono">${iconMic(!st.self.micOn)}<span class="lb">Micro</span></button>
        <button type="button" class="orb tg" data-dock="cam" aria-pressed="${st.self.camOn}" aria-label="Cámara">${iconCam(!st.self.camOn)}<span class="lb">Cámara</span></button>
        <button type="button" class="orb ${st.self.screenSharing ? 'active-mint' : ''}" data-dock="share" data-k="share" aria-pressed="${st.self.screenSharing}" aria-label="Compartir pantalla">${iconShare()}<span class="lb">${st.self.screenSharing ? 'Dejar' : 'Pantalla'}</span></button>
        <button type="button" class="orb ${this.chatOpen ? 'active-mint' : ''}" data-dock="chat" aria-label="Chat">
          ${iconChat()}
          ${this.unreadCount > 0 && !this.chatOpen ? `<i class="chat-pulse-dot" aria-hidden="true"></i><em class="bdg">${this.unreadCount}</em>` : ''}
          <span class="lb">Chat</span>
        </button>
        <button type="button" class="orb" data-dock="view" aria-label="Vista">${iconGrid()}<span class="lb">Vista</span></button>
        ${
          !isHost
            ? `<button type="button" class="orb ${st.self.handRaised ? 'active-mint' : ''}" data-dock="hand" aria-pressed="${st.self.handRaised}" aria-label="Levantar la mano">${iconHand()}<span class="lb">Mano</span></button>`
            : ''
        }
        <button type="button" class="orb leave ${this.leaveArmed ? 'arm' : ''}" data-dock="leave" aria-label="Salir">${iconLeave()}<span class="lb">Salir</span></button>
      </div>
    `;
  }

  _renderSheetAndPeek() {
    const st = this.engine.state;
    const layout = this._getComputedLayout();
    const currentCode = st.meta?.code || this.initialRoomCode;
    const currentPass = st.meta?.pass || this.initialPass || this.user?.suitePass || '';
    const inviteLink = buildRoomInviteUrl(currentCode, currentPass || undefined);
    const isRoomFull = st.peers.length >= st.roomCapacity;

    let sheetSig = String(this.sheet || '');
    if (this.sheet === 'people') {
      sheetSig += `|${st.peers.map((p) => `${p.peerId}:${p.micOn}:${p.handRaised}`).join(',')}|${this.kickArmedId}|${isRoomFull}`;
    } else if (this.sheet === 'view') {
      sheetSig += `|${layout.effectiveMode}|${this.viewMode}|${this.fitContain}|${st.self?.screenSharing}`;
    } else if (this.sheet === 'mod') {
      sheetSig += `|${st.meta?.locked}|${st.meta?.waitingRoom}|${this.endRoomArmed}`;
    } else if (this.sheet === 'acct') {
      sheetSig += `|${this.editingName}|${st.self?.name}|${this.nameInput}`;
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

      if (this.sheet === 'admin' && this.user && this.user.role === 'admin') {
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
          orderedPeers: layout.orderedPeers,
          kickArmedId: this.kickArmedId,
          effectiveMode: layout.effectiveMode,
          viewMode: this.viewMode,
          fitContain: this.fitContain,
          screenSharing: Boolean(st.self?.screenSharing),
          meta: st.meta,
          endRoomArmed: this.endRoomArmed,
          user: this.user,
          nameInput: this.nameInput,
          editingName: this.editingName,
          draftName: this.draftName,
        });
        if (this.sheet === 'acct' && this.editingName) {
          this.sheetSlot.querySelector('#room-draft-name')?.focus();
        }
      }
    }

    // Quick Peek
    const peekSig = this.peekPeer ? this.peekPeer.peerId : '';
    if (peekSig !== this._lastPeekSig) {
      this._lastPeekSig = peekSig;
      this.pkEl.innerHTML = this.peekPeer ? renderQuickPeekHtml(this.peekPeer, st.self?.peerId) : '';
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
        mirror: p.peerId === st.self?.peerId && !p.screenSharing,
      });
    }
  }

  _renderChat() {
    const st = this.engine.state;
    this.chatHud.update({
      open: this.chatOpen,
      selfPeerId: st.self?.peerId || null,
      peers: st.peers,
      messages: st.messages,
      typingPeers: st.typingPeers,
      chatTarget: this.chatTarget,
      settings: this.chatSettings,
    });
  }

  _renderBackPill() {
    const show = this.engine.state.status === 'connected' && this.backVisible && !this.barsHidden;
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

  _showBackTemporarily() {
    this.backVisible = true;
    this._renderBackPill();
    if (this.backTimer) window.clearTimeout(this.backTimer);
    this.backTimer = window.setTimeout(() => {
      this.backVisible = false;
      this.backTimer = null;
      this._renderBackPill();
    }, 6000);
  }

  _hideBackOnly() {
    if (this.backTimer) {
      window.clearTimeout(this.backTimer);
      this.backTimer = null;
    }
    this.backVisible = false;
    this._renderBackPill();
  }

  _handleVideoAreaTap() {
    if (this.didSwipeRefresh) return;
    const now = Date.now();
    if (now - this.lastVideoTapAt <= 300) {
      this.lastVideoTapAt = 0;
      this.barsHidden = !this.barsHidden;
      this._renderAll();
    } else {
      this.lastVideoTapAt = now;
      if (!this.barsHidden && !this.backVisible) {
        this._showBackTemporarily();
      }
    }
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
    if (this.chatOpen) {
      this.chatOpen = false;
      return this._renderAll();
    }
    if (this.viewMode === 'fullscreen') {
      this.viewMode = 'auto';
      this.pipSwapped = false;
      this.selfFocused = false;
      this.pinnedPeerId = null;
      return this._renderAll();
    }
    this.endTitle = 'Hasta pronto';
    this.engine.leaveRoom();
    this.onExitHome();
  }

  _activateGridMode() {
    this.viewMode = 'grid';
    this.pipSwapped = false;
    this.selfFocused = false;
    this.pinnedPeerId = null;
    this._renderAll();
  }

  _activatePipMode() {
    this.pipSwapped = false;
    this.selfFocused = false;
    this.viewMode = this.viewMode === 'pip' ? 'auto' : 'pip';
    this._renderAll();
  }

  _activateFullscreenMode(target) {
    this.pipSwapped = false;
    if (target) {
      if (target.peerId === this.engine.state.self?.peerId) {
        this.selfFocused = true;
        this.pinnedPeerId = null;
      } else {
        this.lastRemotePeerId = target.peerId;
        this.selfFocused = false;
        this.pinnedPeerId = target.peerId;
      }
    }
    this.viewMode = 'fullscreen';
    this._renderAll();
  }

  _handleSwapCameras() {
    const { orderedPeers, effectiveMode, stagePeer } = this._getComputedLayout();
    const selfId = this.engine.state.self?.peerId;
    const remotes = orderedPeers.filter((p) => p.peerId !== selfId);
    if (remotes.length === 0) return this.showToast('Esperando invitados para intercambiar');
    if (effectiveMode === 'stage-pip') {
      this.pipSwapped = !this.pipSwapped;
      this.showToast(this.pipSwapped ? 'Tu cámara en vista principal' : 'Invitado en vista principal');
      return this._renderAll();
    }
    if (effectiveMode === 'fullscreen') {
      if (stagePeer && stagePeer.peerId !== selfId) {
        this.lastRemotePeerId = stagePeer.peerId;
        this.selfFocused = true;
        this.pinnedPeerId = null;
        this.showToast('Vista principal: Tú');
      } else {
        const nextRemote = remotes.find((p) => p.peerId === this.lastRemotePeerId) || remotes[0];
        this.lastRemotePeerId = nextRemote.peerId;
        this.selfFocused = false;
        this.pinnedPeerId = nextRemote.peerId;
        this.showToast(`Vista principal: ${nextRemote.name}`);
      }
      return this._renderAll();
    }
    this.gridSelfFirst = !this.gridSelfFirst;
    this.showToast(this.gridSelfFirst ? 'Intercambio: Tu cámara primero' : 'Intercambio: Invitado primero');
    this._renderAll();
  }

  _handleDoubleSwipePeer(peer, dir) {
    const { effectiveMode, orderedPeers, stagePeer } = this._getComputedLayout();
    const selfId = this.engine.state.self?.peerId;
    if (effectiveMode === 'fullscreen') {
      if (orderedPeers.length <= 1) return;
      const currentId = stagePeer?.peerId || peer.peerId;
      const idx = orderedPeers.findIndex((p) => p.peerId === currentId);
      const step = dir === 'right' ? 1 : -1;
      const nextIdx = ((idx === -1 ? 0 : idx) + step + orderedPeers.length) % orderedPeers.length;
      const nextPeer = orderedPeers[nextIdx];
      if (nextPeer.peerId === selfId) {
        this.selfFocused = true;
        this.pinnedPeerId = null;
        this.showToast('Intercambio rápido: Tú');
      } else {
        this.lastRemotePeerId = nextPeer.peerId;
        this.selfFocused = false;
        this.pinnedPeerId = nextPeer.peerId;
        this.showToast(`Intercambio rápido: ${nextPeer.name}`);
      }
      return this._renderAll();
    }
    if (effectiveMode === 'stage-pip') {
      this.pipSwapped = !this.pipSwapped;
      this.showToast(`Intercambio rápido: ${peer.name}`);
      return this._renderAll();
    }
    this._activateFullscreenMode(peer);
    this.showToast(`Vista completa: ${peer.name}`);
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
    document.querySelectorAll('video').forEach((vid) => {
      if (vid.srcObject && vid.paused) vid.play().catch(() => {});
    });
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

  _bindEvents() {
    this._onResize = () => {
      this.viewport = { w: window.innerWidth, h: window.innerHeight };
      this._renderGrid(this._getComputedLayout());
    };
    window.addEventListener('resize', this._onResize);

    // Stage pull-to-refresh
    this.rootEl.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) {
        this.touchStart = null;
        return;
      }
      const target = e.target;
      const tag = target?.tagName?.toLowerCase();
      const scrollable = target?.closest?.('#sf, .msgs, .tr-body, .grid-pager');
      const blocked =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean(target?.closest?.('.me')) ||
        Boolean(scrollable && scrollable.scrollTop > 4);
      this.touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), blocked };
    });
    this.rootEl.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) this.touchStart = null;
    });
    this.rootEl.addEventListener('touchend', (e) => {
      const start = this.touchStart;
      this.touchStart = null;
      if (!start || start.blocked || e.changedTouches.length !== 1) return;
      const dx = e.changedTouches[0].clientX - start.x;
      const dy = e.changedTouches[0].clientY - start.y;
      const dt = Date.now() - start.t;
      if (dy >= 72 && Math.abs(dx) < 48 && dt < 900) {
        this.didSwipeRefresh = true;
        window.setTimeout(() => {
          this.didSwipeRefresh = false;
        }, 300);
        this._handleSafeRefresh();
      }
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
        this.preMicOn = !this.preMicOn;
        this.previewStream?.getAudioTracks().forEach((t) => {
          t.enabled = this.preMicOn;
        });
        this._startPreviewMicMeter();
        this._updatePreJoinDynamic();
      } else if (e.target.closest('#pre-cam-btn')) {
        if (this.permState !== 'ready' || !this.previewStream) {
          await this._requestPreJoinPermissions();
          return;
        }
        this.preCamOn = !this.preCamOn;
        this.previewStream.getVideoTracks().forEach((t) => {
          t.enabled = this.preCamOn;
        });
        this._updatePreJoinDynamic();
      } else if (e.target.closest('#pre-perm-btn')) {
        await this._requestPreJoinPermissions();
      }
    });
    this.prejoinSlot.addEventListener('submit', async (e) => {
      if (e.target.id !== 'pre-form') return;
      e.preventDefault();
      if (!this._isCamActiveForJoin() || !this.previewStream) {
        this.showToast('Enciende tu cámara para unirte a la sala');
        if (this.permState !== 'ready') await this._requestPreJoinPermissions();
        return;
      }
      const cleanName = this.nameInput.trim() || this.user?.name || 'Invitado';
      if (cleanName.length < 2) {
        this.showToast('Escribe tu nombre (mínimo 2 letras)');
        return;
      }
      setStoredName(cleanName);
      this.handedOffPreview = true;
      if (this._previewAudioIv) window.clearInterval(this._previewAudioIv);
      if (this._previewAudioCtx) this._previewAudioCtx.close().catch(() => {});
      const ok = await this.engine.joinRoom({
        roomCode: this.initialRoomCode,
        pass: this.passInput.trim().toUpperCase() || undefined,
        name: cleanName,
        micOn: this.preMicOn,
        camOn: true,
        wantHost: this.wantHost,
        precheckedStream: this.previewStream,
        requireMedia: true,
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

    // Video taps
    this.gridEl.addEventListener('click', (e) => {
      const dot = e.target.closest('[data-gdot]');
      if (dot) {
        e.stopPropagation();
        const idx = Number(dot.getAttribute('data-gdot'));
        this.gridPage = idx;
        const pager = this.gridEl.querySelector('.grid-pager');
        pager?.scrollTo({ left: idx * pager.clientWidth, behavior: 'smooth' });
        this._updateGridDots(this.gridEl.querySelectorAll('.g-dot').length);
        return;
      }
      if (!e.target.closest('.gt')) this._handleVideoAreaTap();
    });
    this.mainEl.addEventListener('click', () => this._handleVideoAreaTap());
    this.deckEl.addEventListener('click', () => this._handleVideoAreaTap());

    this.whoEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-who-wave]');
      if (btn) {
        e.stopPropagation();
        this._triggerWaveVisual(true, btn.getAttribute('data-who-wave'));
      }
    });

    // Floating PiP drag + 4-corner snap + tap
    this.meEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.meEl.setPointerCapture(e.pointerId);
      this.pipDrag = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false };
    });
    this.meEl.addEventListener('pointermove', (e) => {
      const d = this.pipDrag;
      if (!d || d.pointerId !== e.pointerId) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.hypot(dx, dy) > 6) d.moved = true;
      if (d.moved) {
        this.pipDragOffset = { x: dx, y: dy };
        this.meEl.classList.add('dragging');
        this.meEl.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      }
    });
    const onPipEnd = (e) => {
      const d = this.pipDrag;
      if (!d || d.pointerId !== e.pointerId) return;
      this.pipDrag = null;
      try {
        this.meEl.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      if (!d.moved) {
        this.pipDragOffset = null;
        const layout = this._getComputedLayout();
        if (layout.effectiveMode === 'stage-pip') this._handleSwapCameras();
        else if (layout.pipPeer) this._activateFullscreenMode(layout.pipPeer);
        else this._renderAll();
        return;
      }
      const rect = this.meEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const isRight = cx >= this.viewport.w / 2;
      const isBottom = cy >= this.viewport.h / 2;
      this.pipCorner = isBottom ? (isRight ? 'c-br' : 'c-bl') : isRight ? 'c-tr' : 'c-tl';
      this.pipDragOffset = null;
      this._renderPip(this._getComputedLayout());
    };
    this.meEl.addEventListener('pointerup', onPipEnd);
    this.meEl.addEventListener('pointercancel', onPipEnd);

    // Cam bar
    this.camBarEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cbar]');
      if (!btn) return;
      const mode = btn.getAttribute('data-cbar');
      if (mode === 'grid') this._activateGridMode();
      else if (mode === 'pip') this._activatePipMode();
      else if (mode === 'full') {
        if (this.viewMode === 'fullscreen') {
          this.fitContain = !this.fitContain;
          this._renderAll();
        } else {
          const layout = this._getComputedLayout();
          this._activateFullscreenMode(layout.stagePeer || this.engine.state.self);
        }
      } else if (mode === 'swap') this._handleSwapCameras();
    });

    this.emptyEl.querySelector('#eInv').addEventListener('click', () => this._openInviteSafe());

    this.chatToastEl.addEventListener('click', () => {
      if (this.chatToast?.targetPeerId) this.chatTarget = this.chatToast.targetPeerId;
      this.chatOpen = true;
      this.chatToast = null;
      this._renderAll();
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
      if (e.target.closest('#tSn')) {
        this.silentMode = !this.silentMode;
        this.showToast(this.silentMode ? 'Modo silencio' : 'Sonidos y avisos activados');
        return this._renderAll();
      }
      if (e.target.closest('#tMe')) return this._setSheet('acct');
      if (e.target.closest('#tPro')) return this._setSheet('admin');
      if (e.target.closest('#tAd')) return this._setSheet('mod');

      const dockBtn = e.target.closest('[data-dock]');
      if (!dockBtn) return;
      const d = dockBtn.getAttribute('data-dock');
      if (d === 'mic') this.engine.toggleMic();
      else if (d === 'cam') this.engine.toggleCam();
      else if (d === 'share') this.engine.toggleScreenShare();
      else if (d === 'chat') {
        this.chatOpen = !this.chatOpen;
        this.chatToast = null;
        this._renderAll();
      } else if (d === 'view') this._setSheet('view');
      else if (d === 'hand') this.engine.toggleHand();
      else if (d === 'leave') {
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
          this.engine.leaveRoom();
        }
      }
    });

    this.restoreBarsBtn.addEventListener('click', () => {
      this.barsHidden = false;
      this._renderAll();
    });

    this.mountEl.querySelector('#veil').addEventListener('click', () => {
      this.sheet = null;
      this.peekPeer = null;
      this._renderAll();
    });

    this.sheetSlot.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.getAttribute('data-act');
      if (act === 'close') return this._setSheet(null);
      if (act === 'open-invite') return this._openInviteSafe();
      if (act === 'switch-app') return this._setSheet('shareapp');
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

      const dm = e.target.closest('[data-dm]')?.getAttribute('data-dm');
      if (dm) {
        this.chatTarget = dm;
        this.chatOpen = true;
        this.sheet = null;
        return this._renderAll();
      }

      const muteId = e.target.closest('[data-mute]')?.getAttribute('data-mute');
      if (muteId) return this.engine.hostAction('mutePeer', { targetPeerId: muteId });

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
        if (viewAct === 'grid') this._activateGridMode();
        else if (viewAct === 'pip') this._activatePipMode();
        else if (viewAct === 'full') {
          if (this.viewMode !== 'fullscreen') {
            const layout = this._getComputedLayout();
            this._activateFullscreenMode(layout.stagePeer || this.engine.state.self);
          } else {
            this.fitContain = !this.fitContain;
            this._renderAll();
          }
        } else if (viewAct === 'swap') this._handleSwapCameras();
        else if (viewAct === 'screen') {
          this._renderAll();
          this.engine.toggleScreenShare();
        } else if (viewAct === 'wave') {
          this._renderAll();
          this._triggerWaveVisual(true, null);
        }
        return;
      }

      const modAct = e.target.closest('[data-mod]')?.getAttribute('data-mod');
      if (modAct) {
        const meta = this.engine.state.meta;
        if (modAct === 'muteAll') {
          this.engine.hostAction('muteAll');
          this.showToast('Todos en silencio');
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

    this.sheetSlot.addEventListener('input', (e) => {
      if (e.target.id === 'room-draft-name') this.draftName = e.target.value;
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
      if (pk === 'wave') this._triggerWaveVisual(true, this.peekPeer.peerId);
      else if (pk === 'full') this._activateFullscreenMode(this.peekPeer);
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
        micOn: this.preMicOn,
        camOn: true,
        wantHost: this.wantHost,
        requireMedia: true,
      });
    });
    this.endEl.querySelector('#mine').addEventListener('click', () => {
      if (this.user) this.onNewRoom(this.user.suiteCode, this.user.suitePass);
    });
    this.endEl.querySelector('#home').addEventListener('click', () => this.onExitHome());
  }

  destroy() {
    this._destroyed = true;
    window.removeEventListener('resize', this._onResize);
    if (this._elapsedIv) window.clearInterval(this._elapsedIv);
    if (this.backTimer) window.clearTimeout(this.backTimer);
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    if (this.chatToastTimer) window.clearTimeout(this.chatToastTimer);
    if (this.leaveTimer) window.clearTimeout(this.leaveTimer);
    if (this.endRoomTimer) window.clearTimeout(this.endRoomTimer);
    if (this.kickTimer) window.clearTimeout(this.kickTimer);
    if (this.adminCtrl) this.adminCtrl.destroy();
    this.chatHud.destroy();
    if (!this.handedOffPreview) this._stopPreviewStream();
    this.engine.destroy();
    document.body.classList.remove('grid', 'pres', 'fit', 'weak', 'open', 'peeking', 'bars-hidden');
    this.mountEl.innerHTML = '';
  }
}
