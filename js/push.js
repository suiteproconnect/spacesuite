const CLIENT_ID_KEY = 'spacesuite_client_id';
const NOTIF_ENABLED_KEY = 'spacesuite_onesignal_enabled_v1';
const NOTIF_DISCRETE_KEY = 'spacesuite_onesignal_discrete_v1';
const NOTIF_ROOM_KEY = 'spacesuite_onesignal_room_v1';

let adapterInitialized = false;

export function getOrCreateClientId() {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

export function isNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationDiscretePref() {
  try {
    const raw = localStorage.getItem(NOTIF_DISCRETE_KEY);
    if (raw === null) return true;
    return raw !== '0';
  } catch {
    return true;
  }
}

export function setNotificationDiscretePref(val) {
  try {
    localStorage.setItem(NOTIF_DISCRETE_KEY, val ? '1' : '0');
  } catch {
    // ignore storage errors
  }
}

export function getSavedNotificationRoomCode() {
  try {
    return localStorage.getItem(NOTIF_ROOM_KEY) || '';
  } catch {
    return '';
  }
}

function setSavedNotificationRoomCode(code) {
  try {
    if (code) localStorage.setItem(NOTIF_ROOM_KEY, code);
    else localStorage.removeItem(NOTIF_ROOM_KEY);
  } catch {
    // ignore storage errors
  }
}

function getLocalOptInState() {
  try {
    return localStorage.getItem(NOTIF_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

function setLocalOptInState(enabled) {
  try {
    localStorage.setItem(NOTIF_ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    // ignore storage errors
  }
}

function getOneSignalConfig() {
  if (typeof window === 'undefined') return null;
  const cfg = window.__SPACESUITE_ONESIGNAL__;
  if (cfg && typeof cfg.appId === 'string' && cfg.appId.trim()) {
    return { appId: cfg.appId.trim(), ...cfg };
  }
  return null;
}

function enqueueOneSignal(fn) {
  if (typeof window === 'undefined') return;
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(fn);
}

async function cleanupLegacyServiceWorkers() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      const scriptUrl = reg?.active?.scriptURL || reg?.installing?.scriptURL || reg?.waiting?.scriptURL || '';
      if (scriptUrl.endsWith('/sw.js')) {
        await reg.unregister().catch(() => {});
      }
    }
  } catch {
    // ignore service worker cleanup errors
  }
}

export function initOneSignalAdapter(customConfig = null) {
  if (typeof window === 'undefined') return;
  if (customConfig && typeof customConfig === 'object') {
    window.__SPACESUITE_ONESIGNAL__ = {
      ...(window.__SPACESUITE_ONESIGNAL__ || {}),
      ...customConfig,
    };
  }
  if (adapterInitialized) return;
  adapterInitialized = true;

  cleanupLegacyServiceWorkers();

  const cfg = getOneSignalConfig();
  const clientId = getOrCreateClientId();

  enqueueOneSignal(async (OneSignal) => {
    if (!OneSignal) return;
    if (cfg?.appId && typeof OneSignal.init === 'function') {
      await OneSignal.init({
        appId: cfg.appId,
        allowLocalhostAsSecureOrigin: true,
        ...cfg,
      }).catch(() => {});
    }
    if (typeof OneSignal.login === 'function') {
      await OneSignal.login(clientId).catch(() => {});
    }
    const savedRoom = getSavedNotificationRoomCode();
    if (savedRoom && OneSignal.User?.addTags) {
      OneSignal.User.addTags({
        suite_room: savedRoom,
        discrete_mode: getNotificationDiscretePref() ? '1' : '0',
      });
    }
  });
}

export async function getNotificationStatus() {
  const supported = isNotificationSupported();
  const discrete = getNotificationDiscretePref();
  const roomCode = getSavedNotificationRoomCode();
  const cfg = getOneSignalConfig();

  if (!supported) {
    return {
      provider: 'onesignal',
      configured: Boolean(cfg?.appId),
      supported: false,
      permission: 'unsupported',
      subscribed: false,
      discrete,
      roomCode,
    };
  }

  const permission = Notification.permission;
  const subscribed = permission === 'granted' && getLocalOptInState();

  return {
    provider: 'onesignal',
    configured: Boolean(cfg?.appId),
    supported: true,
    permission,
    subscribed,
    discrete,
    roomCode,
  };
}

export async function enableOneSignalNotifications({ roomCode, discrete } = {}) {
  if (!isNotificationSupported()) {
    return { ok: false, error: 'Tu navegador no soporta notificaciones.' };
  }

  const perm =
    Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();

  if (perm !== 'granted') {
    setLocalOptInState(false);
    return {
      ok: false,
      error:
        perm === 'denied'
          ? 'Permiso bloqueado. Habilita las notificaciones en la configuración del navegador.'
          : 'No se concedió permiso para notificaciones.',
    };
  }

  const useDiscrete = typeof discrete === 'boolean' ? discrete : getNotificationDiscretePref();
  setNotificationDiscretePref(useDiscrete);

  const cleanRoom = String(roomCode || getSavedNotificationRoomCode() || 'ORBIT6')
    .trim()
    .toUpperCase();
  setSavedNotificationRoomCode(cleanRoom);
  setLocalOptInState(true);

  const clientId = getOrCreateClientId();
  enqueueOneSignal(async (OneSignal) => {
    if (!OneSignal) return;
    if (typeof OneSignal.login === 'function') {
      await OneSignal.login(clientId).catch(() => {});
    }
    if (OneSignal.Notifications?.requestPermission) {
      await OneSignal.Notifications.requestPermission().catch(() => {});
    }
    if (OneSignal.User?.PushSubscription?.optIn) {
      await OneSignal.User.PushSubscription.optIn().catch(() => {});
    }
    if (OneSignal.User?.addTags) {
      OneSignal.User.addTags({
        suite_room: cleanRoom,
        discrete_mode: useDiscrete ? '1' : '0',
      });
    }
  });

  return {
    ok: true,
    provider: 'onesignal',
    configured: Boolean(getOneSignalConfig()?.appId),
    subscribed: true,
    roomCode: cleanRoom,
    discrete: useDiscrete,
  };
}

export async function disableOneSignalNotifications() {
  setLocalOptInState(false);
  enqueueOneSignal(async (OneSignal) => {
    if (!OneSignal) return;
    if (OneSignal.User?.PushSubscription?.optOut) {
      await OneSignal.User.PushSubscription.optOut().catch(() => {});
    }
    if (OneSignal.User?.removeTags) {
      OneSignal.User.removeTags(['suite_room']);
    }
  });
  return { ok: true, subscribed: false };
}

export async function syncOneSignalRoomTag(roomCode) {
  if (!roomCode) return;
  const cleanRoom = String(roomCode).trim().toUpperCase();
  setSavedNotificationRoomCode(cleanRoom);

  if (!getLocalOptInState()) return;
  const discrete = getNotificationDiscretePref();

  enqueueOneSignal((OneSignal) => {
    if (OneSignal?.User?.addTags) {
      OneSignal.User.addTags({
        suite_room: cleanRoom,
        discrete_mode: discrete ? '1' : '0',
      });
    }
  });
}

export async function toggleNotificationDiscreteMode(nextDiscrete) {
  const cleanVal = Boolean(nextDiscrete);
  setNotificationDiscretePref(cleanVal);

  enqueueOneSignal((OneSignal) => {
    if (OneSignal?.User?.addTags) {
      OneSignal.User.addTags({
        discrete_mode: cleanVal ? '1' : '0',
      });
    }
  });

  return {
    ok: true,
    discrete: cleanVal,
    subscribed: isNotificationSupported() && Notification.permission === 'granted' && getLocalOptInState(),
  };
}
