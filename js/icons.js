export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderLinkedTextHtml(text) {
  const raw = String(text ?? '');
  const re = /(https?:\/\/[^\s<>"']+)/gi;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) out += esc(raw.slice(last, m.index));
    const url = esc(m[0]);
    out += `<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-link">${url}</a>`;
    last = re.lastIndex;
  }
  if (last < raw.length) out += esc(raw.slice(last));
  return out;
}

const TINTS = [
  ['#2a3f86', '#0e1636'],
  ['#4a3170', '#120c2a'],
  ['#1d4f63', '#08182a'],
  ['#6a4f2e', '#1a1208'],
  ['#2f5a4a', '#0a1c16'],
  ['#5a2f4a', '#1a0a14'],
];

export function getPeerTint(seed) {
  let hash = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  const [c1, c2] = TINTS[hash % TINTS.length];
  return `radial-gradient(100% 100% at 30% 20%, ${c1}66, ${c2}33)`;
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function dob18() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().slice(0, 10);
}

export function playSound(kind) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = {
      join: [
        [660, 0, 0.14, 0.22],
        [880, 0.13, 0.2, 0.22],
      ],
      leave: [
        [880, 0, 0.14, 0.2],
        [587, 0.14, 0.22, 0.2],
      ],
      knock: [
        [784, 0, 0.12, 0.24],
        [988, 0.16, 0.16, 0.24],
      ],
      msg: [
        [988, 0, 0.07, 0.14],
        [1318, 0.07, 0.14, 0.14],
      ],
    };
    const seq = notes[kind] || [];
    seq.forEach(([freq, delay, dur, vol]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + delay;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.04);
    });
    setTimeout(() => ctx.close().catch(() => {}), 700);
  } catch {
    // ignore AudioContext restriction
  }
}

export function iconMic(slashed = false, cls = '') {
  return `<svg viewBox="0 0 24 24" class="ss-svg ${cls}" aria-hidden="true"><path d="M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3Z"/><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V21"/><path class="sl" d="M4 4l16 16"${slashed ? ' style="stroke-dashoffset:0"' : ''}/></svg>`;
}

export function iconCam(slashed = false) {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><rect x="3" y="7" width="12.5" height="10" rx="3"/><path d="m15.5 11 5-3v8l-5-3"/><path class="sl" d="M4 4l16 16"${slashed ? ' style="stroke-dashoffset:0"' : ''}/></svg>`;
}

export function iconShare(cls = '') {
  return `<svg viewBox="0 0 24 24" class="ss-svg ${cls}" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2.5"/><path d="M12 14V8.5m-2.6 2.6L12 8.5l2.6 2.6M8 20.5h8"/></svg>`;
}

export function iconHand(cls = '') {
  return `<svg viewBox="0 0 24 24" class="ss-svg ${cls}" aria-hidden="true"><path d="M8.5 12V6.5a1.5 1.5 0 0 1 3 0V11M11.5 10.5V5a1.5 1.5 0 0 1 3 0v6M14.5 10.5V6.5a1.5 1.5 0 0 1 3 0V14c0 3.5-2.5 6-6 6-2.5 0-4-1-5.3-3L4.5 13.2a1.5 1.5 0 0 1 2.4-1.8L8.5 13"/></svg>`;
}

export function iconWave() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><circle cx="6.5" cy="12" r="1.7"/><path d="M10.5 8.6a5 5 0 0 1 0 6.8M14.2 6a9 9 0 0 1 0 12M18 3.6a13 13 0 0 1 0 16.8"/></svg>`;
}

export function iconChat() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v6A2.5 2.5 0 0 1 17 15h-5.5L7.5 19v-4H7a2.5 2.5 0 0 1-2.5-2.5Z"/></svg>`;
}

export function iconLeave() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M13.5 4.2A8.5 8.5 0 1 0 13.5 19.8"/><path d="M10 12h10m-3-3 3 3-3 3"/></svg>`;
}

export function iconUsers() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><circle cx="9" cy="9" r="3"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><circle cx="17" cy="10" r="2.3"/><path d="M16.5 14.7c2.2.2 3.6 1.6 4.2 4"/></svg>`;
}

export function iconInvite() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><circle cx="10" cy="9" r="3.2"/><path d="M4 19c.6-3.2 3-5 6-5s5.4 1.8 6 5M18 8v6M15 11h6"/></svg>`;
}

export function iconBell(off = false) {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15Z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>${off ? '<path d="M4 4l16 16"/>' : ''}</svg>`;
}

export function iconGrid() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/></svg>`;
}

export function iconPip() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><rect x="12.5" y="11" width="6" height="5" rx="1.4"/></svg>`;
}

export function iconFit() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/></svg>`;
}

export function iconShield() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M12 3.5 5 6v5.5c0 4.2 2.8 7.2 7 9 4.2-1.8 7-4.8 7-9V6Z"/><path d="m9.2 12 2 2 3.6-3.8"/></svg>`;
}

export function iconLock(open = false) {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><rect x="5.5" y="10.5" width="13" height="9" rx="2.5"/>${open ? '<path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.6-1.4"/>' : '<path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'}</svg>`;
}

export function iconClose() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
}

export function iconCheck() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.4 2.7 2.7 4.9-5.3"/></svg>`;
}

export function iconSend() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M20 4 4 11l6 2.5L12.5 20Z"/><path d="m10 13.5 5-5"/></svg>`;
}

export function iconSendPlane() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M4 12 20 4l-4 16-4.5-6.5Z"/><path d="M11.5 13.5 20 4"/></svg>`;
}

export function iconWifi() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M5 18v-3M10 18v-6M15 18V9M20 18V5"/></svg>`;
}

export function iconMuteAll() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3Z"/><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V21M4 4l16 16"/></svg>`;
}

export function iconDownload() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M12 4v11m-4-4 4 4 4-4M5 19.5h14"/></svg>`;
}

export function iconBack() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M15 6 9 12l6 6"/></svg>`;
}

export function iconSwap() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M7 16V4m0 0-3 3m3-3 3 3M17 8v12m0 0 3-3m-3 3-3-3"/></svg>`;
}

export function iconEye(hidden = false) {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5-9.5-6.5-9.5-6.5Z"/><circle cx="12" cy="12" r="2.7"/>${hidden ? '<path d="M4 4l16 16"/>' : ''}</svg>`;
}

export function iconChart() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M4 19.5h16M7 16v-5M12 16V7M17 16v-8"/></svg>`;
}

export function iconSettings() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.01 1.4 1.09H21a2 2 0 0 1 0 4h-.09c-.63.08-1.14.49-1.51 1Z"/></svg>`;
}

export function iconShareTarget(target) {
  if (target === 'native') {
    return '<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M12 15V3m-4.5 4.5L12 3l4.5 4.5M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';
  }
  if (target === 'wa') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#25D366" d="M12 2.5a9.4 9.4 0 0 0-8.1 14.2L2.6 21.5l4.9-1.3A9.4 9.4 0 1 0 12 2.5Z"/><path fill="#fff" d="M8.6 7.6c-.3.3-.9 1-.8 2 .2 1.7 1.7 3.9 3.5 5 1.4.9 2.6 1.1 3.4.9.8-.2 1.3-.9 1.4-1.4 0-.2 0-.4-.2-.5l-1.7-.8c-.2-.1-.4 0-.5.1l-.7.8c-1.1-.5-2-1.4-2.4-2.4l.7-.7c.1-.1.2-.3.1-.5l-.8-1.7c-.1-.2-.3-.3-.5-.3-.4 0-.7 0-.8.1Z"/></svg>';
  }
  if (target === 'tg') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#29A9EB" d="M21.6 3.9 2.9 11.1c-.8.3-.8 1.4 0 1.7l4.7 1.5 1.8 5.6c.2.6 1 .8 1.4.3l2.6-2.5 4.7 3.5c.6.4 1.4.1 1.6-.6l3-15.2c.2-.8-.6-1.5-1.4-1.1Z"/><path fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" d="M8 14.4 17.4 8"/></svg>';
  }
  if (target === 'x') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.3L5.2 21H2l7.2-8.2L1.5 3h6.4l4.4 5.8ZM16.7 19.2h1.7L6.9 4.7H5.1Z"/></svg>';
  }
  if (target === 'gm') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4.5" width="20" height="15" rx="2.2" fill="#fff"/><path fill="none" stroke="#EA4335" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M3 6.8 12 13.6l9-6.8"/><path stroke="#EA4335" stroke-width="2.4" stroke-linecap="round" d="M3 7v11M21 7v11"/></svg>';
  }
  if (target === 'mail') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#3BA2F5" d="M7.2 19a4.4 4.4 0 0 1-.7-8.7A6 6 0 0 1 18 9.6 4.7 4.7 0 0 1 17.3 19Z"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#34C759" d="M5 3.5h14A2.5 2.5 0 0 1 21.5 6v9a2.5 2.5 0 0 1-2.5 2.5h-7.2L7 21.2v-3.7H5A2.5 2.5 0 0 1 2.5 15V6A2.5 2.5 0 0 1 5 3.5Z"/><circle cx="8" cy="10.5" r="1.2" fill="#fff"/><circle cx="12" cy="10.5" r="1.2" fill="#fff"/><circle cx="16" cy="10.5" r="1.2" fill="#fff"/></svg>';
}

export function iconMenu() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><circle cx="12" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="18" r="1.4" fill="currentColor" stroke="none"/></svg>`;
}

export function iconSparkles() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M12 3.5 13.9 8.6 19 10.5l-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9Z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"/><path d="M5.5 4l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6L3.3 6.2l1.6-.6Z"/></svg>`;
}

export function iconCameraFlip() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M4.5 9.5A2.5 2.5 0 0 1 7 7h1.6l1.3-1.8h4.2L15.4 7H17a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 19H7a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M9.5 12.2a2.8 2.8 0 0 1 4.6-1.2l.9.9M14.5 13.8a2.8 2.8 0 0 1-4.6 1.2l-.9-.9"/><path d="M15 9.8v2.1h-2.1M9 16.2v-2.1h2.1"/></svg>`;
}

export function iconPalette() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M12 3.5a8.5 8.5 0 1 0 0 17 1.8 1.8 0 0 0 1.8-1.8c0-.5-.2-.9-.5-1.2-.3-.4-.4-.9-.2-1.4.2-.6.8-1.1 1.5-1.1H16a4.5 4.5 0 0 0 4.5-4.5C20.5 7 16.7 3.5 12 3.5Z"/><circle cx="7.8" cy="11.5" r="1" fill="currentColor" stroke="none"/><circle cx="10.2" cy="7.8" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="7.8" r="1" fill="currentColor" stroke="none"/></svg>`;
}

export function iconCards() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><rect x="6.5" y="4" width="12.5" height="15" rx="2.5"/><path d="M4.5 7.5v10A2.5 2.5 0 0 0 7 20h8.5"/><path d="M12.7 9.2l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8Z"/></svg>`;
}

export function iconPoll() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 15v-3M12 15V9M16 15v-5"/></svg>`;
}

export function iconTimer() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.4 1.6M9.5 3.5h5M12 3.5v2"/></svg>`;
}

export function iconUserPlus() {
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><circle cx="10" cy="8.5" r="3.2"/><path d="M4 19c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><path d="M18.5 7v5M16 9.5h5"/></svg>`;
}

export function iconReaction(kind) {
  if (kind === 'spark') {
    return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2Z"/></svg>`;
  }
  if (kind === 'heart' || kind === 'heartbeat') {
    return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M12 20s-7-4.6-7-10a4.2 4.2 0 0 1 7-3.1A4.2 4.2 0 0 1 19 10c0 5.4-7 10-7 10Z"/></svg>`;
  }
  if (kind === 'orbit') {
    return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><circle cx="12" cy="12" r="3.6"/><ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(-28 12 12)"/></svg>`;
  }
  if (kind === 'toast') {
    return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><path d="M8 4h8l-1 5.5a3 3 0 0 1-6 0Z"/><path d="M12 12.5V19M9 19h6M5 6.5l1.5.5M19 6.5l-1.5.5"/></svg>`;
  }
  // pulse (default)
  return `<svg viewBox="0 0 24 24" class="ss-svg" aria-hidden="true"><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="9.5" stroke-dasharray="3 3"/></svg>`;
}

export function iconSuperKey(cls = '') {
  return `<svg viewBox="0 0 24 24" class="ss-svg ${cls}" aria-hidden="true"><ellipse cx="12" cy="12" rx="9.2" ry="4.2" transform="rotate(-30 12 12)" stroke-opacity="0.85"/><circle cx="9" cy="9.8" r="3"/><path d="M11.3 12l6.7 6.7M15.8 16.5l1.6 1.6M14 18.3l1.6 1.6"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/></svg>`;
}

export function iconHeartbeat(cls = '') {
  return `<svg viewBox="0 0 24 24" class="ss-svg ${cls}" aria-hidden="true"><path d="M3 12h3.5l2-5 3.5 10 2.5-7 1.5 3.5 1.5-1.5H21"/></svg>`;
}

export function iconSubtitles(cls = '') {
  return `<svg viewBox="0 0 24 24" class="ss-svg ${cls}" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 15h3M14 15h3M7 11h10"/></svg>`;
}

export function iconSpatialAudio(cls = '') {
  return `<svg viewBox="0 0 24 24" class="ss-svg ${cls}" aria-hidden="true"><path d="M4 14a8 8 0 0 1 16 0"/><rect x="2" y="14" width="4" height="6" rx="1.5"/><rect x="18" y="14" width="4" height="6" rx="1.5"/><circle cx="12" cy="12" r="2"/></svg>`;
}

export function playSpatialHeartbeatSound() {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([120, 80, 200]);
    } catch (_) {}
  }
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const t0 = ctx.currentTime;
    const thumps = [
      { delay: 0.0, freq: 56, dur: 0.14, vol: 0.42 },
      { delay: 0.15, freq: 44, dur: 0.18, vol: 0.35 },
    ];
    thumps.forEach(({ delay, freq, dur, vol }) => {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      const t = t0 + delay;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.7), t + dur);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(140, t);

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + dur + 0.05);
    });
    setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch (_) {}
}

export function renderBrandIsotipoHtml({ size = 'lg', live = true, idPrefix = 'ss' } = {}) {
  const safeId = String(idPrefix || 'ss').replace(/[^a-zA-Z0-9_-]/g, '');
  const sizeClass = size === 'sm' ? 'is-sm' : size === 'md' ? 'is-md' : 'is-lg';
  return `
    <div class="space-isotipo ${sizeClass} ${live ? 'is-live' : ''}" aria-hidden="true">
      <svg class="iso-svg" viewBox="0 0 120 120" width="96" height="96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="${safeId}-ssBody" x1="15" y1="10" x2="105" y2="110" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#1E46A8" />
            <stop offset="55%" stop-color="#0E2356" />
            <stop offset="100%" stop-color="#061029" />
          </linearGradient>
          <radialGradient id="${safeId}-ssLens" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#061626" />
            <stop offset="70%" stop-color="#040B16" />
            <stop offset="100%" stop-color="#02060D" />
          </radialGradient>
          <filter id="${safeId}-mintGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect x="6" y="6" width="108" height="108" rx="26" fill="url(#${safeId}-ssBody)" stroke="#3B66C4" stroke-opacity="0.45" stroke-width="2" />
        <rect x="10" y="10" width="100" height="100" rx="22" stroke="#030814" stroke-width="2" />
        <circle cx="60" cy="60" r="36" fill="url(#${safeId}-ssLens)" stroke="#1E3A7A" stroke-width="2.5" />
        <ellipse cx="60" cy="60" rx="26" ry="15" transform="rotate(-24 60 60)" stroke="#34D399" stroke-opacity="0.55" stroke-width="1.6" filter="url(#${safeId}-mintGlow)" />
        <ellipse cx="60" cy="60" rx="26" ry="15" transform="rotate(32 60 60)" stroke="#10B981" stroke-opacity="0.4" stroke-width="1.4" />
        <circle cx="93" cy="25" r="3.6" fill="#34D399" filter="url(#${safeId}-mintGlow)" />
        <text x="60" y="72" text-anchor="middle" fill="#F8FAFC" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-weight="800" font-size="36">S</text>
      </svg>
    </div>
  `;
}

export function renderBrandWordmarkHtml({ compact = false } = {}) {
  return `
    <div class="brand-lockup ${compact ? 'is-compact' : ''}">
      <span class="brand-space">SPACE</span>
      <span class="brand-suite"><span class="brand-s">S</span><span class="brand-rest">UITE</span></span>
    </div>
  `;
}


