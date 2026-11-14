const USER_KEY = 'spacesuite_user_v2';
const CHAT_SETTINGS_KEY = 'spacesuite_chat_settings_v1';
const PREFS_KEY = 'ss-pf';

export const DEFAULT_CHAT_SETTINGS = {
  opacity: 45,
  fontSize: 'md',
  soundEnabled: true,
  toastEnabled: true,
  accent: 'emerald',
};

export const ACCENT_TOKENS = {
  emerald: {
    label: 'Esmeralda',
    bg: 'rgba(16, 185, 129, 0.24)',
    border: 'rgba(52, 211, 153, 0.55)',
    swatch: '#10B981',
  },
  cyan: {
    label: 'Cian',
    bg: 'rgba(6, 182, 212, 0.24)',
    border: 'rgba(34, 211, 238, 0.55)',
    swatch: '#06B6D4',
  },
  violet: {
    label: 'Violeta',
    bg: 'rgba(139, 92, 246, 0.26)',
    border: 'rgba(167, 139, 250, 0.55)',
    swatch: '#8B5CF6',
  },
};

export function loadSuiteUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.name || !parsed.suiteCode || !parsed.suitePass) return null;
    if (!parsed.token || parsed.verified === false) return null;
    return {
      name: parsed.name,
      email: parsed.email || '',
      suiteCode: parsed.suiteCode,
      suitePass: parsed.suitePass,
      plan: parsed.plan || 'Prueba gratis',
      role: parsed.role === 'admin' ? 'admin' : 'user',
      verified: Boolean(parsed.verified),
      token: parsed.token,
    };
  } catch {
    return null;
  }
}

export function saveSuiteUser(user) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    localStorage.setItem('spacesuite_name', user.name);
  } catch {
    // ignore storage errors
  }
}

export function clearSuiteUser() {
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    // ignore
  }
}

export function getStoredName(fallback = '') {
  try {
    return localStorage.getItem('spacesuite_name') || fallback;
  } catch {
    return fallback;
  }
}

export function setStoredName(name) {
  try {
    localStorage.setItem('spacesuite_name', name);
  } catch {
    // ignore
  }
}

export function buildRoomInviteUrl(code, pass) {
  const url = new URL(window.location.origin + '/');
  url.searchParams.set('room', code);
  if (pass) url.searchParams.set('p', pass);
  return url.toString();
}

export function getRoomFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const r = params.get('room');
    const p = params.get('p');
    if (r && r.trim()) {
      const code = r.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
      const pass = p ? p.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : undefined;
      if (code) return { code, pass };
    }
    const pathMatch = /^\/sala\/([A-Za-z0-9-]+)\/?$/i.exec(window.location.pathname);
    if (pathMatch) {
      const rawId = pathMatch[1].toUpperCase().replace(/[^A-Z0-9-]/g, '');
      const code = rawId.startsWith('SS-SALA-') ? rawId : `SS-SALA-${rawId}`;
      const pass = p ? p.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : undefined;
      if (code) return { code, pass };
    }
    const hash = window.location.hash.replace(/^#/, '').trim();
    if (hash) {
      const m = /^sala-([A-Za-z0-9-]+)(?:\.([A-Za-z0-9]+))?$/i.exec(hash);
      if (m) {
        const rawId = m[1].toUpperCase();
        const code = rawId.startsWith('SS-SALA-') ? rawId : `SS-SALA-${rawId}`;
        const pass = m[2] ? m[2].toUpperCase() : undefined;
        return { code, pass };
      }
    }
  } catch {
    // ignore URL errors
  }
  return null;
}

export function loadChatSettings() {
  try {
    const raw = localStorage.getItem(CHAT_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_CHAT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      opacity:
        typeof parsed.opacity === 'number'
          ? Math.min(85, Math.max(20, Math.round(parsed.opacity)))
          : DEFAULT_CHAT_SETTINGS.opacity,
      fontSize:
        parsed.fontSize === 'sm' || parsed.fontSize === 'md' || parsed.fontSize === 'lg'
          ? parsed.fontSize
          : DEFAULT_CHAT_SETTINGS.fontSize,
      soundEnabled:
        typeof parsed.soundEnabled === 'boolean'
          ? parsed.soundEnabled
          : DEFAULT_CHAT_SETTINGS.soundEnabled,
      toastEnabled:
        typeof parsed.toastEnabled === 'boolean'
          ? parsed.toastEnabled
          : DEFAULT_CHAT_SETTINGS.toastEnabled,
      accent:
        parsed.accent === 'emerald' || parsed.accent === 'cyan' || parsed.accent === 'violet'
          ? parsed.accent
          : DEFAULT_CHAT_SETTINGS.accent,
    };
  } catch {
    return { ...DEFAULT_CHAT_SETTINGS };
  }
}

export function saveChatSettings(settings) {
  try {
    localStorage.setItem(CHAT_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : { snd: true, vib: true };
  } catch {
    return { snd: true, vib: true };
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, ntf: true }));
  } catch {
    // ignore
  }
}
