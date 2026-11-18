import { getRoomFromUrl, loadSuiteUser, saveSuiteUser } from './js/identity.js';
import { LobbyController } from './js/lobby.js';
import { initOneSignalAdapter } from './js/push.js';
import { RoomController } from './js/room-ui.js';

initOneSignalAdapter();

const rootEl = document.getElementById('root');

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
