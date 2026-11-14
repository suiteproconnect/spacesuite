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
    return '<svg viewBox="0 0 24 24" fill="none" stroke="#3ee6b4" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3m-4.5 4.5L12 3l4.5 4.5M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';
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
