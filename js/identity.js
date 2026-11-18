const USER_KEY = 'spacesuite_user_v2';
const CHAT_SETTINGS_KEY = 'spacesuite_chat_settings_v1';
const PREFS_KEY = 'ss-pf';

export const DEFAULT_CHAT_SETTINGS = {
  opacity: 85,
  fontSize: 'md',
  soundEnabled: true,
  toastEnabled: true,
  accent: 'obsidian',
};

export const ACCENT_TOKENS = {
  obsidian: {
    label: 'Obsidiana',
    bg: '#18181B',
    border: '#3F3F46',
    swatch: '#FAFAFA',
  },
  graphite: {
    label: 'Grafito',
    bg: '#1E1E24',
    border: '#52525B',
    swatch: '#A1A1AA',
  },
  carbon: {
    label: 'Carbón',
    bg: '#121215',
    border: '#27272A',
    swatch: '#71717A',
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
  const clean = String(name || '').trim().slice(0, 32);
  if (!clean) return;
  try {
    localStorage.setItem('spacesuite_name', clean);
    const raw = localStorage.getItem(USER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        parsed.name = clean;
        localStorage.setItem(USER_KEY, JSON.stringify(parsed));
      }
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('spacesuite:name_updated', { detail: { name: clean } }));
    }
  } catch {
    // ignore
  }
}

const SPACE_PROFILE_KEY = 'spacesuite_space_profile_v1';

export function generateCleanRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  try {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < 6; i++) {
      out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
  } catch {
    for (let i = 0; i < 6; i++) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }
}

export function normalizeRoomCode(raw) {
  let str = String(raw || '').trim();
  if (!str) return '';
  try {
    if (str.includes('://') || str.includes('?')) {
      const parsed = new URL(str, typeof window !== 'undefined' ? window.location.origin : 'https://spacesuite.pages.dev');
      const qp = parsed.searchParams.get('room');
      if (qp) str = qp;
      else if (parsed.pathname) str = parsed.pathname;
    }
  } catch {
    // ignore URL parse errors
  }
  str = str
    .replace(/^\/?sala\//i, '')
    .replace(/^SS-SALA-/i, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 24);
  return str;
}

export function loadSpaceDraftProfile() {
  try {
    const raw = localStorage.getItem(SPACE_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      title: typeof parsed.title === 'string' ? parsed.title.trim().slice(0, 80) : '',
      description: typeof parsed.description === 'string' ? parsed.description.trim().slice(0, 220) : '',
      coverImage: typeof parsed.coverImage === 'string' ? parsed.coverImage.trim().slice(0, 600) : '',
      coverVideo: typeof parsed.coverVideo === 'string' ? parsed.coverVideo.trim().slice(0, 600) : '',
    };
  } catch {
    return null;
  }
}

export function saveSpaceDraftProfile(profile) {
  try {
    if (!profile) {
      localStorage.removeItem(SPACE_PROFILE_KEY);
      return null;
    }
    const clean = {
      title: String(profile.title || '').trim().slice(0, 80),
      description: String(profile.description || '').trim().slice(0, 220),
      coverImage: String(profile.coverImage || '').trim().slice(0, 600),
      coverVideo: String(profile.coverVideo || '').trim().slice(0, 600),
    };
    if (!clean.title && !clean.description && !clean.coverImage && !clean.coverVideo) {
      localStorage.removeItem(SPACE_PROFILE_KEY);
      return null;
    }
    localStorage.setItem(SPACE_PROFILE_KEY, JSON.stringify(clean));
    return clean;
  } catch {
    return null;
  }
}

export function buildRoomInviteUrl(code, pass) {
  const cleanCode = normalizeRoomCode(code) || String(code || '').trim().toUpperCase();
  const url = new URL(window.location.origin + '/');
  url.searchParams.set('room', cleanCode);
  if (pass) url.searchParams.set('p', String(pass).trim().toUpperCase());
  return url.toString();
}

export function getRoomFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const r = params.get('room');
    const p = params.get('p');
    if (r && r.trim()) {
      const code = normalizeRoomCode(r);
      const pass = p ? p.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : undefined;
      if (code) return { code, pass };
    }
    const pathMatch = /^\/sala\/([A-Za-z0-9-]+)\/?$/i.exec(window.location.pathname);
    if (pathMatch) {
      const code = normalizeRoomCode(pathMatch[1]);
      const pass = p ? p.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : undefined;
      if (code) return { code, pass };
    }
    const hash = window.location.hash.replace(/^#/, '').trim();
    if (hash) {
      const m = /^sala-([A-Za-z0-9-]+)(?:\.([A-Za-z0-9]+))?$/i.exec(hash);
      if (m) {
        const code = normalizeRoomCode(m[1]);
        const pass = m[2] ? m[2].toUpperCase() : undefined;
        if (code) return { code, pass };
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
        parsed.accent === 'obsidian' || parsed.accent === 'graphite' || parsed.accent === 'carbon'
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

const LATIDOS_KEY = 'spacesuite_latidos_points_v1';
const PERKS_KEY = 'spacesuite_active_perks_v1';

export const DIGITAL_PERKS = [
  {
    id: 'aura-crimson',
    title: 'Marco Studio de Cámara',
    desc: 'Borde arquitectónico nítido en tu video personal.',
    cost: 3,
    icon: 'spark',
  },
  {
    id: 'pass-1to1',
    title: 'Pase 1:1 Privado Prioritario',
    desc: 'Petición directa cara a cara sin interrupciones con vibración háptica.',
    cost: 5,
    icon: 'heartbeat',
  },
  {
    id: 'soundscape-nebula',
    title: 'Soundscape Espacial Nebulosa',
    desc: 'Acústica ambiental inmersiva y relajante durante la llamada.',
    cost: 4,
    icon: 'orbit',
  },
  {
    id: 'filter-portrait',
    title: 'Filtro Retrato Espacial',
    desc: 'Optimización de luz y contraste óptico suave en tu cámara.',
    cost: 2,
    icon: 'toast',
  },
];

export function getLatidosBalance() {
  try {
    const raw = localStorage.getItem(LATIDOS_KEY);
    if (raw === null) {
      localStorage.setItem(LATIDOS_KEY, '5');
      return 5;
    }
    const val = Number(raw);
    return Number.isFinite(val) ? Math.max(0, val) : 5;
  } catch {
    return 5;
  }
}

export function addLatidos(amount) {
  try {
    const current = getLatidosBalance();
    const next = current + Math.max(0, Number(amount || 0));
    localStorage.setItem(LATIDOS_KEY, String(next));
    window.dispatchEvent(new CustomEvent('spacesuite:latidos', { detail: { balance: next, added: amount } }));
    return next;
  } catch {
    return getLatidosBalance();
  }
}

export function deductLatidos(amount) {
  try {
    const current = getLatidosBalance();
    if (current < amount) return false;
    const next = current - amount;
    localStorage.setItem(LATIDOS_KEY, String(next));
    window.dispatchEvent(new CustomEvent('spacesuite:latidos', { detail: { balance: next, deducted: amount } }));
    return true;
  } catch {
    return false;
  }
}

export function getPurchasedPerks() {
  try {
    const raw = localStorage.getItem(PERKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function unlockPerk(perkId) {
  const perk = DIGITAL_PERKS.find((p) => p.id === perkId);
  if (!perk) return { ok: false, error: 'Perk inexistente' };
  const perks = getPurchasedPerks();
  if (perks.includes(perkId)) return { ok: true, alreadyUnlocked: true };
  if (!deductLatidos(perk.cost)) {
    return { ok: false, error: 'Latidos insuficientes. Invita amigos para ganar +3 Latidos.' };
  }
  perks.push(perkId);
  try {
    localStorage.setItem(PERKS_KEY, JSON.stringify(perks));
  } catch (_) {}
  window.dispatchEvent(new CustomEvent('spacesuite:perk_unlocked', { detail: { perkId, perks } }));
  return { ok: true, perk };
}

