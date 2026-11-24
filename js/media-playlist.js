const DB_NAME = 'spacesuite_media_playlist_v1';
const STORE_NAME = 'items';
const DB_VERSION = 1;

function openPlaylistDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('addedAt', 'addedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Error abriendo IndexedDB'));
  });
}

export async function listPlaylistItems() {
  try {
    const db = await openPlaylistDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = Array.isArray(req.result) ? req.result : [];
        items.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|mkv|avi|3gp|ogv)$/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|heic|heif|avif|bmp)$/i;

export function detectMediaKind(file) {
  if (!file) return null;
  const mime = String(file.type || '').toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  const name = String(file.name || '');
  if (VIDEO_EXT_RE.test(name)) return 'video';
  if (IMAGE_EXT_RE.test(name)) return 'image';
  return null;
}

export async function addPlaylistFiles(fileList) {
  const raw = Array.from(fileList || []);
  const accepted = raw
    .map((file) => ({ file, kind: detectMediaKind(file) }))
    .filter((entry) => Boolean(entry.kind));
  if (accepted.length === 0) {
    return { added: [], skipped: raw.length, error: null };
  }

  const db = await openPlaylistDb();
  const created = [];
  const baseTs = Date.now();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      accepted.forEach(({ file, kind }, idx) => {
        const item = {
          id: crypto.randomUUID(),
          name: file.name || `Archivo ${idx + 1}`,
          kind,
          mime: file.type || (kind === 'image' ? 'image/jpeg' : 'video/mp4'),
          size: file.size || 0,
          blob: file,
          addedAt: baseTs + idx,
        };
        created.push(item);
        store.put(item);
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Error guardando en IndexedDB'));
      tx.onabort = () => reject(tx.error || new Error('Espacio insuficiente en IndexedDB'));
    });
    return { added: created, skipped: raw.length - accepted.length, error: null };
  } catch (err) {
    const msg =
      err?.name === 'QuotaExceededError'
        ? 'Memoria del navegador llena; borra algunos archivos de la playlist.'
        : err?.message || 'No se pudieron guardar los archivos en IndexedDB.';
    return { added: [], skipped: raw.length, error: msg };
  }
}

export async function removePlaylistItem(id) {
  try {
    const db = await openPlaylistDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export async function clearPlaylistItems() {
  try {
    const db = await openPlaylistDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

/**
 * Emits local video/photo playlist items at 720p (~800 kbps target) via a continuous
 * offscreen 720p canvas + Web Audio MediaStreamDestination so transitions between
 * items in the playlist never interrupt the SFU broadcast stream.
 */
export class LocalMediaBroadcaster {
  constructor(onChange) {
    this.onChange = typeof onChange === 'function' ? onChange : () => {};
    this.items = [];
    this.activeIndex = -1;
    this.playing = false;
    this.loop = true;
    this.volume = 0.85;
    this.duration = 0;
    this.currentTime = 0;
    this.activeUrl = null;
    this.imageEl = null;

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.ctx = this.canvas.getContext('2d', { alpha: false });

    this.videoEl = document.createElement('video');
    this.videoEl.playsInline = true;
    this.videoEl.crossOrigin = 'anonymous';
    this.videoEl.preload = 'auto';

    this.audioCtx = null;
    this.audioDest = null;
    this.sourceNode = null;
    this.publishGain = null;
    this.monitorGain = null;
    this.silentOsc = null;
    this.stream = null;

    this._rafId = null;
    this._imageTimer = null;
    this._destroyed = false;

    this._bindVideoEvents();
  }

  _bindVideoEvents() {
    this.videoEl.addEventListener('loadedmetadata', () => {
      this.duration = Number.isFinite(this.videoEl.duration) ? this.videoEl.duration : 0;
      this.currentTime = this.videoEl.currentTime || 0;
      this._emit();
    });
    this.videoEl.addEventListener('timeupdate', () => {
      this.currentTime = this.videoEl.currentTime || 0;
      this.duration = Number.isFinite(this.videoEl.duration) ? this.videoEl.duration : this.duration;
      this._emit();
    });
    this.videoEl.addEventListener('ended', () => {
      if (this.items.length === 0) return;
      if (this.items.length === 1 && this.loop) {
        this.videoEl.currentTime = 0;
        this.videoEl.play().catch(() => {});
        return;
      }
      const nextIdx = this.activeIndex + 1;
      if (nextIdx < this.items.length) {
        this.selectItem(nextIdx, true);
      } else if (this.loop) {
        this.selectItem(0, true);
      } else {
        this.playing = false;
        this._emit();
      }
    });
  }

  _emit() {
    if (this._destroyed) return;
    this.onChange(this.getSnapshot());
  }

  getSnapshot() {
    const active = this.items[this.activeIndex] || null;
    return {
      items: this.items,
      activeIndex: this.activeIndex,
      activeItem: active,
      playing: this.playing,
      loop: this.loop,
      volume: this.volume,
      currentTime: this.currentTime,
      duration: this.duration,
      ready: Boolean(this.stream && active),
    };
  }

  _ensureAudioPipeline() {
    if (this.stream) return this.stream;
    const canvasStream = this.canvas.captureStream(30);
    const tracks = [...canvasStream.getVideoTracks()];

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.audioCtx = new AudioCtx();
        this.audioDest = this.audioCtx.createMediaStreamDestination();
        this.publishGain = this.audioCtx.createGain();
        this.monitorGain = this.audioCtx.createGain();
        this.publishGain.gain.value = this.volume;
        this.monitorGain.gain.value = this.volume;

        this.sourceNode = this.audioCtx.createMediaElementSource(this.videoEl);
        this.sourceNode.connect(this.publishGain);
        this.sourceNode.connect(this.monitorGain);
        this.publishGain.connect(this.audioDest);
        this.monitorGain.connect(this.audioCtx.destination);

        // Keep audio track alive even when showing photos or paused
        this.silentOsc = this.audioCtx.createOscillator();
        const silentGain = this.audioCtx.createGain();
        silentGain.gain.value = 0.00001;
        this.silentOsc.connect(silentGain);
        silentGain.connect(this.audioDest);
        this.silentOsc.start();

        for (const t of this.audioDest.stream.getAudioTracks()) {
          tracks.push(t);
        }
      }
    } catch {
      // Fallback: video-only captureStream if AudioContext is restricted
    }

    this.stream = new MediaStream(tracks);
    this._startRenderLoop();
    return this.stream;
  }

  _startRenderLoop() {
    if (this._rafId) return;
    const draw = () => {
      if (this._destroyed) return;
      const ctx = this.ctx;
      const cw = this.canvas.width;
      const ch = this.canvas.height;
      ctx.fillStyle = '#02030a';
      ctx.fillRect(0, 0, cw, ch);

      const item = this.items[this.activeIndex];
      if (item?.kind === 'image' && this.imageEl && this.imageEl.complete && this.imageEl.naturalWidth > 0) {
        this._drawContain(ctx, this.imageEl, this.imageEl.naturalWidth, this.imageEl.naturalHeight, cw, ch);
      } else if (item?.kind === 'video' && this.videoEl.readyState >= 2 && this.videoEl.videoWidth > 0) {
        this._drawContain(ctx, this.videoEl, this.videoEl.videoWidth, this.videoEl.videoHeight, cw, ch);
      }
      this._rafId = window.requestAnimationFrame(draw);
    };
    this._rafId = window.requestAnimationFrame(draw);
  }

  _drawContain(ctx, source, sw, sh, dw, dh) {
    const scale = Math.min(dw / sw, dh / sh);
    const rw = Math.round(sw * scale);
    const rh = Math.round(sh * scale);
    const rx = Math.round((dw - rw) / 2);
    const ry = Math.round((dh - rh) / 2);
    ctx.drawImage(source, rx, ry, rw, rh);
  }

  async loadStoredPlaylist() {
    this.items = await listPlaylistItems();
    if (this.items.length > 0 && this.activeIndex === -1) {
      this.activeIndex = 0;
    } else if (this.activeIndex >= this.items.length) {
      this.activeIndex = this.items.length - 1;
    }
    this._emit();
    return this.items;
  }

  async addFiles(fileList) {
    const prevLen = this.items.length;
    const result = await addPlaylistFiles(fileList);
    await this.loadStoredPlaylist();
    if (prevLen === 0 && this.items.length > 0) {
      await this.selectItem(0, false);
    }
    return result;
  }

  async removeItem(id) {
    const idx = this.items.findIndex((x) => x.id === id);
    await removePlaylistItem(id);
    await this.loadStoredPlaylist();
    if (this.items.length === 0) {
      this.stopPlayback();
      this.activeIndex = -1;
    } else if (idx === this.activeIndex) {
      const next = Math.min(this.activeIndex, this.items.length - 1);
      await this.selectItem(next, this.playing);
    }
    this._emit();
  }

  async prepareStream() {
    const stream = this._ensureAudioPipeline();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume().catch(() => {});
    }
    if (this.activeIndex === -1 && this.items.length > 0) {
      await this.selectItem(0, true);
    } else if (this.activeIndex >= 0) {
      await this.selectItem(this.activeIndex, true);
    }
    return stream;
  }

  async selectItem(index, autoPlay = true) {
    if (index < 0 || index >= this.items.length) return;
    if (this._imageTimer) {
      window.clearTimeout(this._imageTimer);
      this._imageTimer = null;
    }
    if (this.activeUrl) {
      URL.revokeObjectURL(this.activeUrl);
      this.activeUrl = null;
    }
    this.videoEl.pause();
    this.videoEl.removeAttribute('src');
    this.videoEl.load();
    this.imageEl = null;

    this.activeIndex = index;
    const item = this.items[index];
    this.currentTime = 0;
    this.duration = item.kind === 'image' ? 8 : 0;

    const url = URL.createObjectURL(item.blob);
    this.activeUrl = url;

    if (item.kind === 'image') {
      const img = new Image();
      img.src = url;
      this.imageEl = img;
      this.playing = autoPlay;
      if (autoPlay && this.items.length > 1) {
        this._imageTimer = window.setTimeout(() => {
          const next = this.activeIndex + 1;
          if (next < this.items.length) this.selectItem(next, true);
          else if (this.loop) this.selectItem(0, true);
          else {
            this.playing = false;
            this._emit();
          }
        }, 8000);
      }
      this._emit();
      return;
    }

    this.videoEl.src = url;
    this.videoEl.muted = false;
    this.videoEl.volume = 1;
    if (autoPlay) {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume().catch(() => {});
      }
      await this.videoEl.play().catch(() => {});
      this.playing = !this.videoEl.paused;
    } else {
      this.playing = false;
    }
    this._emit();
  }

  _scheduleImageAdvance() {
    if (this._imageTimer) {
      window.clearTimeout(this._imageTimer);
      this._imageTimer = null;
    }
    if (this.items.length <= 1) return;
    this._imageTimer = window.setTimeout(() => {
      const next = this.activeIndex + 1;
      if (next < this.items.length) this.selectItem(next, true);
      else if (this.loop) this.selectItem(0, true);
      else {
        this.playing = false;
        this._emit();
      }
    }, 8000);
  }

  async togglePlay() {
    const item = this.items[this.activeIndex];
    if (!item) return;
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume().catch(() => {});
    }
    if (item.kind === 'image') {
      this.playing = !this.playing;
      if (this.playing) {
        this._scheduleImageAdvance();
      } else if (this._imageTimer) {
        window.clearTimeout(this._imageTimer);
        this._imageTimer = null;
      }
      this._emit();
      return;
    }
    if (this.videoEl.paused) {
      await this.videoEl.play().catch(() => {});
      this.playing = !this.videoEl.paused;
    } else {
      this.videoEl.pause();
      this.playing = false;
    }
    this._emit();
  }

  seek(seconds) {
    const item = this.items[this.activeIndex];
    if (!item || item.kind !== 'video') return;
    const target = Math.max(0, Math.min(this.duration || 0, Number(seconds) || 0));
    this.videoEl.currentTime = target;
    this.currentTime = target;
    this._emit();
  }

  setVolume(val) {
    const v = Math.max(0, Math.min(1, Number(val)));
    this.volume = v;
    if (this.publishGain) this.publishGain.gain.value = v;
    if (this.monitorGain) this.monitorGain.gain.value = v;
    this._emit();
  }

  toggleLoop() {
    this.loop = !this.loop;
    this._emit();
  }

  stopPlayback() {
    if (this._imageTimer) {
      window.clearTimeout(this._imageTimer);
      this._imageTimer = null;
    }
    this.playing = false;
    this.videoEl.pause();
    this._emit();
  }

  destroy() {
    this._destroyed = true;
    this.stopPlayback();
    if (this._rafId) {
      window.cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this.activeUrl) {
      URL.revokeObjectURL(this.activeUrl);
      this.activeUrl = null;
    }
    if (this.silentOsc) {
      try {
        this.silentOsc.stop();
      } catch {
        // ignore
      }
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }
}
