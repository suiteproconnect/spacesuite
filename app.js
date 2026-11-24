import { getRoomFromUrl, loadSuiteUser, saveSuiteUser } from './js/identity.js';
import {
  LocalMediaBroadcaster,
  clearPlaylistItems,
  listPlaylistItems,
} from './js/media-playlist.js';
import { initOneSignalAdapter } from './js/push.js';
import { LobbyController } from './js/lobby.js';
import { RoomController } from './js/room-ui.js';

initOneSignalAdapter();

const rootEl = document.getElementById('root');

/**
 * Orquestador central en app.js para:
 * - Botón de emisión (.ss-broadcast-btn) y estado visual del indicador LED (.ss-bp-led)
 * - Menú y selector de archivos multimedia (videos y fotos)
 * - Persistencia de playlist local en IndexedDB (spacesuite_media_playlist_v1)
 */
function createBroadcastMediaHub() {
  const listeners = new Set();
  const state = {
    broadcastStatus: 'idle', // 'idle' | 'preparing' | 'live'
    isSelfEmitter: false,
    sourceType: 'none',
    hydrated: false,
  };

  let hiddenInput = null;
  let onPickedCallback = null;

  const broadcaster = new LocalMediaBroadcaster(() => {
    notify();
  });

  function notify() {
    const snap = getSnapshot();
    listeners.forEach((fn) => {
      try {
        fn(snap);
      } catch {
        // ignore listener errors
      }
    });
    if (rootEl) {
      syncBroadcastButtonLed(rootEl, snap);
    }
  }

  function getLedState() {
    if (state.broadcastStatus === 'live') return 'live';
    if (state.broadcastStatus === 'preparing') return 'prep';
    if (broadcaster.items.length > 0) return 'ready';
    return 'idle';
  }

  function getSnapshot() {
    const media = broadcaster.getSnapshot();
    return {
      ...media,
      broadcastStatus: state.broadcastStatus,
      isSelfEmitter: state.isSelfEmitter,
      sourceType: state.sourceType,
      ledState: getLedState(),
      hydrated: state.hydrated,
    };
  }

  async function hydratePlaylist() {
    await broadcaster.loadStoredPlaylist().catch(() => []);
    state.hydrated = true;
    notify();
    return broadcaster.items;
  }

  function ensureManagedFileInput() {
    if (hiddenInput && document.body.contains(hiddenInput)) return hiddenInput;
    hiddenInput = document.createElement('input');
    hiddenInput.type = 'file';
    hiddenInput.id = 'ss-app-media-picker';
    hiddenInput.accept = 'video/*,image/*';
    hiddenInput.multiple = true;
    hiddenInput.hidden = true;
    hiddenInput.addEventListener('change', async (e) => {
      const files = e.target?.files;
      if (!files || files.length === 0) return;
      const result = await pickMediaFiles(files);
      e.target.value = '';
      if (typeof onPickedCallback === 'function') {
        onPickedCallback(result);
      }
    });
    document.body.appendChild(hiddenInput);
    return hiddenInput;
  }

  function openMediaPicker(targetInput = null, onPicked = null) {
    onPickedCallback = typeof onPicked === 'function' ? onPicked : null;
    if (targetInput && typeof targetInput.click === 'function') {
      targetInput.click();
      return;
    }
    const input = ensureManagedFileInput();
    input.click();
  }

  async function pickMediaFiles(fileList) {
    const result = await broadcaster.addFiles(fileList);
    notify();
    return result;
  }

  async function removeMediaItem(id) {
    await broadcaster.removeItem(id);
    notify();
  }

  async function clearPlaylist() {
    broadcaster.stopPlayback();
    await clearPlaylistItems();
    await broadcaster.loadStoredPlaylist();
    notify();
  }

  function setBroadcastState({ status = 'idle', isSelfEmitter = false, sourceType = 'none' } = {}) {
    const changed =
      state.broadcastStatus !== status ||
      state.isSelfEmitter !== Boolean(isSelfEmitter) ||
      state.sourceType !== sourceType;
    state.broadcastStatus = status;
    state.isSelfEmitter = Boolean(isSelfEmitter);
    state.sourceType = sourceType;
    if (changed) notify();
  }

  function syncBroadcastButtonLed(container, override = null) {
    if (!container) return;
    const btn = container.querySelector('[data-dock="broadcast"], .ss-broadcast-btn');
    if (!btn) return;
    const ledMode = override?.ledState || getLedState();
    const hasMedia = (override?.items?.length ?? broadcaster.items.length) > 0;
    const isLive = ledMode === 'live';
    const isPrep = ledMode === 'prep';

    btn.classList.toggle('is-live', isLive);
    btn.classList.toggle('is-prep', isPrep);
    btn.classList.toggle('has-media', !isLive && !isPrep && hasMedia);
    btn.setAttribute('data-led-state', ledMode);

    const svg = btn.querySelector('.ss-bp-svg');
    if (svg) {
      svg.classList.toggle('is-live', isLive);
      svg.classList.toggle('is-prep', isPrep);
      svg.classList.toggle('has-media', !isLive && !isPrep && hasMedia);
    }
    const ledEl = btn.querySelector('.ss-bp-led');
    if (ledEl) {
      ledEl.setAttribute('data-led', ledMode);
    }
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // Preload persisted IndexedDB playlist entries on boot
  listPlaylistItems()
    .then(() => hydratePlaylist())
    .catch(() => {});

  return {
    broadcaster,
    subscribe,
    getSnapshot,
    getLedState,
    hydratePlaylist,
    openMediaPicker,
    pickMediaFiles,
    removeMediaItem,
    clearPlaylist,
    setBroadcastState,
    syncBroadcastButtonLed,
  };
}

const broadcastHub = createBroadcastMediaHub();

let user = loadSuiteUser();
const initialUrlRoom = getRoomFromUrl();
let activeRoom = initialUrlRoom
  ? { code: initialUrlRoom.code, pass: initialUrlRoom.pass, wantHost: false }
  : null;
let deferredPrompt = null;
let currentCtrl = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (currentCtrl && typeof currentCtrl.setDeferredPrompt === 'function') {
    currentCtrl.setDeferredPrompt(e);
  }
});

function mountActiveView() {
  if (!rootEl) return;
  if (currentCtrl) {
    currentCtrl.destroy();
    currentCtrl = null;
  }

  if (!activeRoom) {
    broadcastHub.setBroadcastState({ status: 'idle', isSelfEmitter: false, sourceType: 'none' });
    currentCtrl = new LobbyController(rootEl, {
      user,
      deferredPrompt,
      onUserChange: (nextUser) => {
        user = nextUser;
      },
      onEnterRoom: (opts) => enterRoom(opts),
    });
    return;
  }

  currentCtrl = new RoomController(rootEl, {
    initialRoomCode: activeRoom.code,
    initialPass: activeRoom.pass,
    initialName: activeRoom.name,
    wantHost: activeRoom.wantHost,
    suiteProfile: activeRoom.suiteProfile || null,
    user,
    broadcastHub,
    onExitHome: exitHome,
    onNewRoom: (newCode, newPass) => {
      enterRoom({
        roomCode: newCode,
        pass: newPass,
        name: user?.name,
        wantHost: true,
      });
    },
    onUpdateUserName: (nextName) => {
      if (!user) return;
      user = { ...user, name: nextName };
      saveSuiteUser(user);
    },
  });
}

function enterRoom(opts) {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('room', opts.roomCode);
  if (opts.pass) {
    url.searchParams.set('p', opts.pass);
  }
  window.history.pushState({}, '', url.toString());
  activeRoom = {
    code: opts.roomCode,
    pass: opts.pass,
    name: opts.name,
    wantHost: opts.wantHost,
    suiteProfile: opts.suiteProfile || null,
  };
  mountActiveView();
}

function exitHome() {
  const url = new URL(window.location.origin + window.location.pathname);
  window.history.pushState({}, '', url.toString());
  activeRoom = null;
  mountActiveView();
}

function syncFromUrl() {
  const urlRoom = getRoomFromUrl();
  activeRoom = urlRoom ? { code: urlRoom.code, pass: urlRoom.pass, wantHost: false } : null;
  mountActiveView();
}

window.addEventListener('popstate', syncFromUrl);
window.addEventListener('hashchange', syncFromUrl);

mountActiveView();
