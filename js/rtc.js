export const ROOM_CAPACITY = 20;

export const VIEWER_CAM_CONSTRAINTS = {
  width: { ideal: 160, max: 160 },
  height: { ideal: 120, max: 120 },
  frameRate: { ideal: 12, max: 12 },
};

export const SCREEN_CONSTRAINTS = {
  width: { ideal: 1280, max: 1280 },
  height: { ideal: 720, max: 720 },
  frameRate: { ideal: 30, max: 30 },
};

const CF_ICE_SERVERS = [{ urls: 'stun:stun.cloudflare.com:3478' }];

function getPersistentClientId() {
  const key = 'spacesuite_client_id';
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

export class RoomEngine {
  constructor(onChange) {
    this.onChange = typeof onChange === 'function' ? onChange : () => {};

    this.state = {
      status: 'idle',
      sfuMode: 'cloudflare-calls',
      callsConfigured: false,
      videoQuality: '120p-12fps',
      roomCapacity: ROOM_CAPACITY,
      rejectionMessage: '',
      self: null,
      peers: [],
      waiting: [],
      messages: [],
      typingPeers: [],
      meta: null,
      localStream: null,
      broadcastStream: null,
      remoteBroadcastStream: null,
      screenStream: null,
      remoteStreams: {},
      speakingIds: {},
      localAudioLevel: 0,
      weakConnection: false,
      mediaNotice: null,
      lastWave: null,
      lastReaction: null,
      lastSubtitle: null,
      facingMode: 'user',
      hostMuteNotice: null,
      wsConnected: false,
    };

    this.roomCode = '';
    this.roomMode = 'broadcast';
    this.peerId = crypto.randomUUID();
    this.clientId = getPersistentClientId();
    this.joinConfig = null;
    this.manualLeave = false;
    this.screenBusy = false;
    this.lastTypingSentAt = 0;

    // WebSocket + fallback polling
    this.ws = null;
    this.wsHeartbeat = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.pollTimer = null;
    this.pollActive = false;
    this.pollInFlight = false;
    this.lastEventId = 0;
    this._pendingEmitterClaim = null;

    // Cloudflare Calls SFU state (1 PeerConnection)
    this.callsSessionId = null;
    this.sfuPc = null;
    this._sfuQueue = Promise.resolve();
    this._publishedCam = null; // { trackName, mid, trackId, transceiver }
    this._publishedBroadcast = []; // [{ kind, trackName, mid, trackId, transceiver }]
    this._subscribedRemote = new Map(); // subKey -> { kind, ownerKey, remoteSessionId, trackName, mid }
    this._remoteMidOwner = new Map(); // mid -> ownerKey ('__broadcast__' or peerId)
    this._remoteBroadcastMediaStream = null;
    this._visibleViewerPeerIds = new Set();
    this.p2pConnections = new Map();

    this._destroyed = false;
    this._typingPruneInterval = window.setInterval(() => this._pruneTyping(), 600);

    this._onPageHide = () => {
      const code = this.roomCode;
      if (!code || this.manualLeave) return;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'room:leave', peerId: this.peerId, clientId: this.clientId }));
        } catch {
          // ignore
        }
      }
      fetch(`/api/room/${encodeURIComponent(code)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'room:leave', peerId: this.peerId, clientId: this.clientId }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener('pagehide', this._onPageHide);
  }

  isMicUnlocked() {
    return (
      this.roomMode === 'normal' ||
      this.roomMode === 'duo' ||
      this.state.meta?.mode === 'normal' ||
      this.state.meta?.mode === 'duo'
    );
  }

  getDiagnostics() {
    const subs = Array.from(this._subscribedRemote.keys()).join(', ') || 'ninguna';
    return [
      `sala=${this.roomCode || '-'} | estado=${this.state.status} | ws=${this.state.wsConnected}`,
      `sfu=${this.callsSessionId ? this.callsSessionId.slice(0, 8) : 'off'} | peers=${this.state.peers.length}/${this.state.roomCapacity}`,
      `emisor=${this.state.meta?.emitterPeerId ? this.state.meta.emitterPeerId.slice(0, 8) : 'libre'} | camLocal=${Boolean(this._publishedCam)}`,
      `subs(${this._subscribedRemote.size}): ${subs}`,
    ].join('\n');
  }

  _emit(patch) {
    if (this._destroyed) return;
    if (patch) Object.assign(this.state, patch);
    this.onChange(this.state);
  }

  _pruneTyping() {
    if (this.state.typingPeers.length === 0) return;
    const now = Date.now();
    const next = this.state.typingPeers.filter((tp) => tp.expiresAt > now);
    if (next.length !== this.state.typingPeers.length) {
      this._emit({ typingPeers: next });
    }
  }

  _appendMessageUnique(incoming) {
    if (!incoming || !incoming.id) return;
    const prev = this.state.messages;
    if (prev.some((m) => m.id === incoming.id)) return;
    const dup = prev.some(
      (m) =>
        m.fromPeerId === incoming.fromPeerId &&
        m.text === incoming.text &&
        (m.toPeerId || null) === (incoming.toPeerId || null) &&
        Math.abs(m.timestamp - incoming.timestamp) < 2500,
    );
    if (dup) return;
    this._emit({ messages: [...prev, incoming] });
  }

  _registerTypingPeer(peerId, name, isTyping, toPeerId) {
    if (!peerId || peerId === this.peerId) return;
    const filtered = this.state.typingPeers.filter((tp) => tp.peerId !== peerId);
    const next = isTyping
      ? [
          ...filtered,
          {
            peerId,
            name,
            toPeerId: toPeerId || null,
            expiresAt: Date.now() + 3200,
          },
        ]
      : filtered;
    this._emit({ typingPeers: next });
  }

  // Serialized SFU queue so local/remote negotiations never race
  _enqueueSfu(fn) {
    const run = this._sfuQueue.then(() => fn()).catch((err) => {
      console.warn('CF Calls SFU step error:', err);
    });
    this._sfuQueue = run;
    return run;
  }

  _ensureSfuPc() {
    if (this.sfuPc) return this.sfuPc;
    const pc = new RTCPeerConnection({
      iceServers: CF_ICE_SERVERS,
      bundlePolicy: 'max-bundle',
    });

    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      const weak = st === 'disconnected' || st === 'failed';
      if (weak !== this.state.weakConnection) {
        this._emit({ weakConnection: weak });
      }
      if (st === 'failed') {
        try {
          pc.restartIce();
        } catch {
          // ignore
        }
      }
    };

    pc.ontrack = (ev) => {
      const track = ev.track;
      const mid = ev.transceiver?.mid;
      if (!track || !mid) return;
      const ownerKey = this._remoteMidOwner.get(String(mid));
      if (!ownerKey) return;

      const emitStream = () => {
        if (this._destroyed) return;
        if (ownerKey === '__broadcast__') {
          if (!this._remoteBroadcastMediaStream) {
            this._remoteBroadcastMediaStream = new MediaStream();
          }
          const bs = this._remoteBroadcastMediaStream;
          if (!bs.getTracks().some((t) => t.id === track.id)) {
            bs.getTracks()
              .filter((t) => t.kind === track.kind)
              .forEach((old) => bs.removeTrack(old));
            bs.addTrack(track);
          }
          this._emit({ remoteBroadcastStream: new MediaStream(bs.getTracks()) });
        } else {
          const prev = this.state.remoteStreams[ownerKey] || new MediaStream();
          if (!prev.getTracks().some((t) => t.id === track.id)) {
            prev
              .getTracks()
              .filter((t) => t.kind === track.kind)
              .forEach((old) => prev.removeTrack(old));
            prev.addTrack(track);
          }
          this._emit({
            remoteStreams: {
              ...this.state.remoteStreams,
              [ownerKey]: new MediaStream(prev.getTracks()),
            },
          });
        }
      };

      track.onunmute = emitStream;
      track.onended = () => {
        if (ownerKey === '__broadcast__' && this._remoteBroadcastMediaStream) {
          this._remoteBroadcastMediaStream.removeTrack(track);
          const rem = this._remoteBroadcastMediaStream.getTracks();
          this._emit({ remoteBroadcastStream: rem.length > 0 ? new MediaStream(rem) : null });
        } else if (this.state.remoteStreams[ownerKey]) {
          const cur = this.state.remoteStreams[ownerKey];
          cur.removeTrack(track);
          const next = { ...this.state.remoteStreams };
          if (cur.getTracks().length > 0) next[ownerKey] = new MediaStream(cur.getTracks());
          else delete next[ownerKey];
          this._emit({ remoteStreams: next });
        }
      };

      emitStream();
    };

    this.sfuPc = pc;
    return pc;
  }

  async _waitIceGatheringComplete(pc, timeoutMs = 1800) {
    if (pc.iceGatheringState === 'complete') return;
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        pc.removeEventListener('icegatheringstatechange', onState);
        window.clearTimeout(timer);
        resolve();
      };
      const onState = () => {
        if (pc.iceGatheringState === 'complete') done();
      };
      const timer = window.setTimeout(done, timeoutMs);
      pc.addEventListener('icegatheringstatechange', onState);
    });
  }

  async _applyTransceiverBitrate(sender, maxBitrate, maxFramerate, preference = 'maintain-framerate') {
    if (!sender || sender.track?.kind !== 'video' || typeof sender.getParameters !== 'function') return;
    try {
      const params = sender.getParameters();
      if (!params) return;
      if (!Array.isArray(params.encodings) || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = maxBitrate;
      params.encodings[0].maxFramerate = maxFramerate;
      if ('degradationPreference' in params) {
        params.degradationPreference = preference;
      }
      await sender.setParameters(params);
    } catch {
      // ignore unsupported encoder parameter fields
    }
  }

  async _closePublishedSfuTracks(entries) {
    if (!this.callsSessionId || !this.sfuPc || !Array.isArray(entries) || entries.length === 0) return;
    const toClose = [];
    for (const item of entries) {
      const resolvedMid = item?.mid ?? item?.transceiver?.mid;
      if (resolvedMid) toClose.push({ mid: String(resolvedMid) });
      if (item?.transceiver) {
        try {
          await item.transceiver.sender?.replaceTrack(null);
          item.transceiver.direction = 'inactive';
        } catch {
          // ignore
        }
      }
    }
    if (toClose.length === 0) return;
    try {
      await fetch('/api/calls/tracks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.callsSessionId,
          tracks: toClose,
          force: true,
        }),
      });
    } catch {
      // ignore
    }
  }

  async publishLocalCamTrack() {
    if (!this.callsSessionId || this._destroyed || this.state.status !== 'connected') return;
    if (this.state.meta?.emitterPeerId === this.peerId) return;
    const camTrack = this.state.localStream?.getVideoTracks().find((t) => t.readyState === 'live' && t.enabled);
    if (!camTrack) return;

    return this._enqueueSfu(async () => {
      if (!this.callsSessionId || this._destroyed) return;
      if (this.state.meta?.emitterPeerId === this.peerId) return;

      const pc = this._ensureSfuPc();
      if (this._publishedCam?.transceiver) {
        const sender = this._publishedCam.transceiver.sender;
        if (this._publishedCam.trackId === camTrack.id) {
          await this._applyTransceiverBitrate(sender, 90_000, 12, 'maintain-framerate');
          return;
        }
        await sender.replaceTrack(camTrack);
        this._publishedCam.trackId = camTrack.id;
        await this._applyTransceiverBitrate(sender, 90_000, 12, 'maintain-framerate');
        return;
      }

      const trackName = `cam-${this.peerId.slice(0, 8)}-${Date.now()}`;
      const transceiver = pc.addTransceiver(camTrack, {
        direction: 'sendonly',
        streams: [this.state.localStream],
        sendEncodings: [{ maxBitrate: 90_000, maxFramerate: 12 }],
      });
      await this._applyTransceiverBitrate(transceiver.sender, 90_000, 12, 'maintain-framerate');

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this._waitIceGatheringComplete(pc, 1500);

      const res = await fetch('/api/calls/tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.callsSessionId,
          sessionDescription: { type: 'offer', sdp: pc.localDescription.sdp },
          tracks: [{ location: 'local', mid: String(transceiver.mid), trackName }],
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.sessionDescription) {
        transceiver.direction = 'inactive';
        return;
      }
      await pc.setRemoteDescription(json.sessionDescription);
      this._publishedCam = {
        trackName,
        mid: String(transceiver.mid),
        trackId: camTrack.id,
        transceiver,
      };
      this._sendSignal({
        type: 'peer:state',
        patch: {
          callsSessionId: this.callsSessionId,
          camTrackName: trackName,
        },
      });
    });
  }

  async unpublishLocalCamTrack() {
    const prev = this._publishedCam;
    this._publishedCam = null;
    if (prev) {
      await this._enqueueSfu(() => this._closePublishedSfuTracks([prev]));
    }
    this._sendSignal({
      type: 'peer:state',
      patch: { camTrackName: null },
    });
  }

  async _publishBroadcastTracks(stream) {
    if (!this.callsSessionId || !stream || this._destroyed) {
      return { videoTrackName: null, audioTrackName: null };
    }
    return this._enqueueSfu(async () => {
      if (this._publishedBroadcast.length > 0) {
        await this._closePublishedSfuTracks(this._publishedBroadcast);
        this._publishedBroadcast = [];
      }
      const pc = this._ensureSfuPc();
      const pendingEntries = [];

      const vTrack = stream.getVideoTracks().find((t) => t.readyState === 'live');
      if (vTrack) {
        if ('contentHint' in vTrack) vTrack.contentHint = 'motion';
        const vName = `tx-vid-${this.peerId.slice(0, 8)}-${Date.now()}`;
        const vTr = pc.addTransceiver(vTrack, {
          direction: 'sendonly',
          streams: [stream],
          sendEncodings: [{ maxBitrate: 800_000, maxFramerate: 30 }],
        });
        await this._applyTransceiverBitrate(vTr.sender, 800_000, 30, 'maintain-resolution');
        pendingEntries.push({ kind: 'video', trackName: vName, transceiver: vTr, trackId: vTrack.id });
      }

      const aTrack = stream.getAudioTracks().find((t) => t.readyState === 'live');
      if (aTrack) {
        const aName = `tx-aud-${this.peerId.slice(0, 8)}-${Date.now()}`;
        const aTr = pc.addTransceiver(aTrack, {
          direction: 'sendonly',
          streams: [stream],
        });
        pendingEntries.push({ kind: 'audio', trackName: aName, transceiver: aTr, trackId: aTrack.id });
      }

      if (pendingEntries.length === 0) return { videoTrackName: null, audioTrackName: null };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this._waitIceGatheringComplete(pc, 1500);

      const tracksMeta = pendingEntries
        .filter((e) => e.transceiver?.mid)
        .map((e) => ({
          location: 'local',
          mid: String(e.transceiver.mid),
          trackName: e.trackName,
        }));

      if (tracksMeta.length === 0) return { videoTrackName: null, audioTrackName: null };

      const res = await fetch('/api/calls/tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.callsSessionId,
          sessionDescription: { type: 'offer', sdp: pc.localDescription.sdp },
          tracks: tracksMeta,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.sessionDescription) {
        for (const e of pendingEntries) {
          try {
            await e.transceiver.sender?.replaceTrack(null);
            e.transceiver.direction = 'inactive';
          } catch {
            // ignore
          }
        }
        return { videoTrackName: null, audioTrackName: null };
      }
      await pc.setRemoteDescription(json.sessionDescription);
      this._publishedBroadcast = pendingEntries.map((e) => ({
        ...e,
        mid: String(e.transceiver.mid),
      }));
      return {
        videoTrackName: pendingEntries.find((e) => e.kind === 'video')?.trackName || null,
        audioTrackName: pendingEntries.find((e) => e.kind === 'audio')?.trackName || null,
      };
    }).then((res) => res || { videoTrackName: null, audioTrackName: null });
  }

  /**
   * Mantiene sincronizadas las cámaras de los espectadores visibles sin cerrar
   * cámaras activas de la sala al entrar o encenderse otro participante.
   */
  setVisibleViewerPeerIds(peerIds) {
    const next = new Set(Array.isArray(peerIds) ? peerIds : []);
    let changed = next.size !== this._visibleViewerPeerIds.size;
    if (!changed) {
      for (const id of next) {
        if (!this._visibleViewerPeerIds.has(id)) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return;
    this._visibleViewerPeerIds = next;
    if (this.callsSessionId && this.state.status === 'connected') {
      this._syncRemoteSubscriptions();
    }
  }

  _syncRemoteSubscriptions() {
    if (!this.callsSessionId || this._destroyed || this.state.status !== 'connected') return;

    return this._enqueueSfu(async () => {
      if (!this.callsSessionId || this._destroyed || this.state.status !== 'connected') return;

      const desired = new Map(); // subKey -> { kind, ownerKey, remoteSessionId, trackName }
      const b = this.state.meta?.broadcast;
      if (b?.status === 'live' && b.emitterPeerId && b.emitterPeerId !== this.peerId && b.callsSessionId) {
        if (b.videoTrackName) {
          desired.set(`b-vid:${b.videoTrackName}`, {
            kind: 'video',
            ownerKey: '__broadcast__',
            remoteSessionId: b.callsSessionId,
            trackName: b.videoTrackName,
          });
        }
        if (b.audioTrackName) {
          desired.set(`b-aud:${b.audioTrackName}`, {
            kind: 'audio',
            ownerKey: '__broadcast__',
            remoteSessionId: b.callsSessionId,
            trackName: b.audioTrackName,
          });
        }
      }

      // Incluir todas las cámaras activas de la sala (hasta 19 espectadores)
      // para evitar cierres accidentales cuando room-ui re-renderiza el carrusel
      for (const peer of this.state.peers) {
        if (peer.peerId === this.peerId) continue;
        if (peer.peerId === b?.emitterPeerId) continue;
        if (!peer.camOn || !peer.callsSessionId || !peer.camTrackName) continue;
        desired.set(`cam:${peer.peerId}:${peer.camTrackName}`, {
          kind: 'video',
          ownerKey: peer.peerId,
          remoteSessionId: peer.callsSessionId,
          trackName: peer.camTrackName,
        });
      }

      // Cerrar únicamente tracks que realmente dejaron de existir o se apagaron
      const toClose = [];
      for (const [subKey, sub] of this._subscribedRemote.entries()) {
        if (!desired.has(subKey)) {
          toClose.push({ subKey, sub });
        }
      }
      if (toClose.length > 0) {
        const pcNow = this.sfuPc;
        try {
          await fetch('/api/calls/tracks', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: this.callsSessionId,
              tracks: toClose.map((x) => ({ mid: String(x.sub.mid) })),
              force: true,
            }),
          });
        } catch {
          // ignore
        }
        for (const item of toClose) {
          if (pcNow) {
            const tr = pcNow.getTransceivers().find((t) => String(t.mid) === String(item.sub.mid));
            if (tr) {
              try {
                tr.direction = 'inactive';
              } catch {
                // ignore
              }
            }
          }
          this._subscribedRemote.delete(item.subKey);
          this._remoteMidOwner.delete(String(item.sub.mid));
          if (item.sub.ownerKey === '__broadcast__') {
            this._remoteBroadcastMediaStream = null;
            this._emit({ remoteBroadcastStream: null });
          } else if (this.state.remoteStreams[item.sub.ownerKey]) {
            const nextStreams = { ...this.state.remoteStreams };
            delete nextStreams[item.sub.ownerKey];
            this._emit({ remoteStreams: nextStreams });
          }
        }
      }

      // Abrir suscripciones nuevas sin afectar las existentes
      const toOpen = [];
      for (const [subKey, req] of desired.entries()) {
        if (!this._subscribedRemote.has(subKey)) {
          toOpen.push({ subKey, ...req });
        }
      }
      if (toOpen.length === 0) return;

      const pc = this._ensureSfuPc();
      const res = await fetch('/api/calls/tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.callsSessionId,
          tracks: toOpen.map((x) => ({
            location: 'remote',
            sessionId: x.remoteSessionId,
            trackName: x.trackName,
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(json.tracks)) return;

      json.tracks.forEach((respTrack, idx) => {
        const meta = toOpen[idx];
        if (!meta || !respTrack?.mid) return;
        const midStr = String(respTrack.mid);
        this._remoteMidOwner.set(midStr, meta.ownerKey);
        this._subscribedRemote.set(meta.subKey, {
          ...meta,
          mid: midStr,
        });
      });

      if (json.requiresImmediateRenegotiation && json.sessionDescription) {
        await pc.setRemoteDescription(json.sessionDescription);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await fetch('/api/calls/renegotiate', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: this.callsSessionId,
            sessionDescription: { type: 'answer', sdp: pc.localDescription.sdp },
          }),
        });
      }
    });
  }

  _closeSfuConnection() {
    this._closeAllP2P();
    if (this.sfuPc) {
      this.sfuPc.ontrack = null;
      this.sfuPc.oniceconnectionstatechange = null;
      try {
        this.sfuPc.close();
      } catch {
        // ignore
      }
      this.sfuPc = null;
    }
    this._publishedCam = null;
    this._publishedBroadcast = [];
    this._subscribedRemote.clear();
    this._remoteMidOwner.clear();
    this._remoteBroadcastMediaStream = null;
    this.callsSessionId = null;
    this._emit({ remoteStreams: {}, remoteBroadcastStream: null, weakConnection: false });
  }

  _closeAllP2P() {
    for (const [, pc] of this.p2pConnections.entries()) {
      try {
        pc.close();
      } catch {
        // ignore
      }
    }
    this.p2pConnections.clear();
  }

  _getOrCreateP2p(remotePeerId) {
    if (this.p2pConnections.has(remotePeerId)) {
      return this.p2pConnections.get(remotePeerId);
    }
    const pc = new RTCPeerConnection({ iceServers: CF_ICE_SERVERS });
    this.p2pConnections.set(remotePeerId, pc);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this._sendSignal({
          type: 'webrtc:signal',
          targetPeerId: remotePeerId,
          data: { candidate: e.candidate },
        });
      }
    };

    pc.ontrack = (e) => {
      // Si Cloudflare Calls SFU está activo, no mezclar tracks P2P para evitar que se sobreescriban
      if (this.callsSessionId && this.state.callsConfigured) return;

      const incomingStream = e.streams[0] || new MediaStream([e.track]);
      const isEmitterPeer = remotePeerId === this.state.meta?.emitterPeerId;
      if (isEmitterPeer && (e.track.kind === 'video' || e.track.kind === 'audio')) {
        this._emit({ remoteBroadcastStream: incomingStream });
      }
      const curr = this.state.remoteStreams[remotePeerId];
      if (curr) {
        if (!curr.getTracks().some((t) => t.id === e.track.id)) {
          curr.addTrack(e.track);
        }
      } else {
        const next = { ...this.state.remoteStreams, [remotePeerId]: incomingStream };
        this._emit({ remoteStreams: next });
      }
    };

    if (!this.callsSessionId || !this.state.callsConfigured) {
      if (this.state.localStream) {
        this.state.localStream.getTracks().forEach((track) => {
          try { pc.addTrack(track, this.state.localStream); } catch {}
        });
      }
      if (this.state.broadcastStream) {
        this.state.broadcastStream.getTracks().forEach((track) => {
          try { pc.addTrack(track, this.state.broadcastStream); } catch {}
        });
      }
    }

    return pc;
  }

  async _negotiateP2P(remotePeerId) {
    if (this.callsSessionId && this.state.callsConfigured) return;
    const pc = this._getOrCreateP2p(remotePeerId);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this._sendSignal({
        type: 'webrtc:signal',
        targetPeerId: remotePeerId,
        data: { sdp: pc.localDescription },
      });
    } catch {
      // ignore
    }
  }

  async _handlePeerSignal(fromPeerId, data) {
    if (this.callsSessionId && this.state.callsConfigured) return;
    if (!data || !fromPeerId) return;
    const pc = this._getOrCreateP2p(fromPeerId);
    try {
      if (data.sdp) {
        if (data.sdp.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this._sendSignal({
            type: 'webrtc:signal',
            targetPeerId: fromPeerId,
            data: { sdp: pc.localDescription },
          });
        } else if (data.sdp.type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }
      } else if (data.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
      }
    } catch {
      // ignore
    }
  }

  _syncP2PWithRoomPeers() {
    if (this.callsSessionId && this.state.callsConfigured) {
      if (this.p2pConnections.size > 0) this._closeAllP2P();
      return;
    }
    const activePeerIds = new Set(this.state.peers.map((p) => p.peerId));
    for (const [pid, pc] of this.p2pConnections.entries()) {
      if (!activePeerIds.has(pid)) {
        try { pc.close(); } catch {}
        this.p2pConnections.delete(pid);
        const remCopy = { ...this.state.remoteStreams };
        delete remCopy[pid];
        this._emit({ remoteStreams: remCopy });
      }
    }
    for (const peer of this.state.peers) {
      if (peer.peerId === this.peerId) continue;
      if (!this.p2pConnections.has(peer.peerId)) {
        this._getOrCreateP2p(peer.peerId);
        if (this.peerId < peer.peerId) {
          this._negotiateP2P(peer.peerId).catch(() => {});
        }
      }
    }
  }

  _broadcastStreamToP2P(stream) {
    if (this.callsSessionId && this.state.callsConfigured) return;
    if (!stream) return;
    for (const [pid, pc] of this.p2pConnections.entries()) {
      stream.getTracks().forEach((track) => {
        try {
          const senders = pc.getSenders();
          const existing = senders.find((s) => s.track && s.track.kind === track.kind);
          if (existing) {
            existing.replaceTrack(track).catch(() => {});
          } else {
            pc.addTrack(track, stream);
          }
        } catch {}
      });
      if (this.peerId < pid) {
        this._negotiateP2P(pid).catch(() => {});
      }
    }
  }

  _removeBroadcastStreamFromP2P() {
    if (this.callsSessionId && this.state.callsConfigured) return;
    for (const [pid, pc] of this.p2pConnections.entries()) {
      const senders = pc.getSenders();
      senders.forEach((s) => {
        if (s.track && this.state.localStream && !this.state.localStream.getTracks().includes(s.track)) {
          try {
            s.replaceTrack(null).catch(() => {});
          } catch {}
        }
      });
      if (this.peerId < pid) {
        this._negotiateP2P(pid).catch(() => {});
      }
    }
  }

  async _acquireLocalMedia(wantCam, wantMic = false) {
    const isUnlocked = this.isMicUnlocked();
    const isDuo = this.roomMode === 'duo' || this.state.meta?.mode === 'duo';
    const allowMic = isUnlocked && wantMic;
    if (!wantCam && !allowMic) {
      return { stream: null, mic: false, cam: false };
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this._emit({ mediaNotice: 'Cámara o micrófono no disponible en este navegador.' });
      return { stream: null, mic: false, cam: false };
    }
    const videoCfg = wantCam
      ? isDuo
        ? {
            width: { ideal: 1280, max: 1280 },
            height: { ideal: 720, max: 720 },
            frameRate: { ideal: 30, max: 30 },
            facingMode: this.state.facingMode || 'user',
          }
        : {
            ...VIEWER_CAM_CONSTRAINTS,
            facingMode: this.state.facingMode || 'user',
          }
      : false;
    const audioCfg = allowMic
      ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      : false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioCfg, video: videoCfg });
      stream.getTracks().forEach((t) => {
        t.enabled = true;
      });
      this._emit({ mediaNotice: null });
      return {
        stream,
        mic: Boolean(allowMic && stream.getAudioTracks().length > 0),
        cam: Boolean(wantCam && stream.getVideoTracks().length > 0),
      };
    } catch {
      if (wantCam && allowMic) {
        return this._acquireLocalMedia(wantCam, false);
      }
      this._emit({ mediaNotice: 'Permiso denegado para cámara o micrófono; conectado como espectador.' });
      return { stream: null, mic: false, cam: false };
    }
  }

  _stopSocket() {
    if (this.wsHeartbeat) {
      window.clearInterval(this.wsHeartbeat);
      this.wsHeartbeat = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this._emit({ wsConnected: false });
  }

  _stopPolling() {
    this.pollActive = false;
    if (this.pollTimer) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  _sendSignal(msg) {
    const code = this.roomCode;
    if (!code) return Promise.resolve(null);
    const payload = {
      ...msg,
      peerId: this.peerId,
      clientId: this.clientId,
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
        return Promise.resolve({ ok: true, via: 'ws' });
      } catch {
        // fall through to REST fallback
      }
    }

    return fetch(`/api/room/${encodeURIComponent(code)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: msg.type === 'room:leave',
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || this._destroyed || !json) return json;
        if (json.type === 'chat:message' && json.message) {
          this._appendMessageUnique(json.message);
        }
        const patch = {};
        if (json.meta) patch.meta = json.meta;
        if (json.self) patch.self = json.self;
        if (Array.isArray(json.peers)) patch.peers = json.peers;
        if (Array.isArray(json.waiting)) patch.waiting = json.waiting;
        if (Object.keys(patch).length > 0) this._applyRoomStatePatch(patch);
        return json;
      })
      .catch(() => null);
  }

  _applyRoomStatePatch(patch) {
    const prevEmitter = this.state.meta?.emitterPeerId || null;
    this._emit(patch);
    const nextEmitter = this.state.meta?.emitterPeerId || null;

    if (nextEmitter === this.peerId && prevEmitter !== this.peerId) {
      this._disableLocalCamForEmitter();
    }

    if (this.callsSessionId && this.state.status === 'connected') {
      this._syncRemoteSubscriptions();
    }
    if (this.state.status === 'connected') {
      this._syncP2PWithRoomPeers();
    }
  }

  _disableLocalCamForEmitter() {
    if (this.state.localStream) {
      this.state.localStream.getVideoTracks().forEach((t) => {
        t.enabled = false;
        t.stop();
      });
      this._emit({ localStream: null });
    }
    if (this._publishedCam) {
      this.unpublishLocalCamTrack().catch(() => {});
    }
    if (this.state.self?.camOn) {
      this._emit({
        self: { ...this.state.self, camOn: false, isEmitter: true, screenSharing: true },
        peers: this.state.peers.map((p) =>
          p.peerId === this.peerId ? { ...p, camOn: false, isEmitter: true, screenSharing: true } : p,
        ),
      });
    }
  }

  _handleWsPayload(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'pong') return;

    if (msg.type === 'room:rejected') {
      this.manualLeave = true;
      this._stopSocket();
      this._stopPolling();
      this._closeSfuConnection();
      this._emit({
        rejectionMessage: String(msg.message || 'No pudiste entrar a la sala.'),
        status: 'rejected',
      });
      return;
    }

    if (msg.type === 'room:waiting') {
      this._emit({ status: 'waiting' });
      return;
    }

    if (msg.type === 'room:joined' && msg.self) {
      const wasWaiting = this.state.status === 'waiting';
      this.reconnectAttempts = 0;
      const incomingPeers = Array.isArray(msg.peers) ? msg.peers : [msg.self];
      if (msg.meta?.mode) this.roomMode = msg.meta.mode;
      this._applyRoomStatePatch({
        self: msg.self,
        peers: incomingPeers,
        waiting: Array.isArray(msg.waiting) ? msg.waiting : [],
        messages: Array.isArray(msg.messages) ? msg.messages : [],
        meta: msg.meta || null,
        status: 'connected',
      });
      if (this.callsSessionId && (msg.self.camOn || wasWaiting)) {
        this.publishLocalCamTrack().catch(() => {});
      }
      return;
    }

    if (msg.type === 'room:state') {
      const incomingPeers = Array.isArray(msg.peers) ? msg.peers : this.state.peers;
      const updatedSelf = incomingPeers.find((p) => p.peerId === this.peerId) || this.state.self;
      const incomingIds = new Set(incomingPeers.map((p) => p.peerId));
      const nextTyping = this.state.typingPeers.filter((tp) => incomingIds.has(tp.peerId));
      if (msg.meta?.mode) this.roomMode = msg.meta.mode;
      this._applyRoomStatePatch({
        peers: incomingPeers,
        self: updatedSelf,
        meta: msg.meta || this.state.meta,
        typingPeers: nextTyping,
      });
      return;
    }

    if (msg.type === 'room:waiting_list') {
      this._emit({ waiting: Array.isArray(msg.waiting) ? msg.waiting : [] });
      return;
    }

    if (msg.type === 'chat:message' && msg.message) {
      this._appendMessageUnique(msg.message);
      return;
    }

    if (msg.type === 'chat:typing') {
      this._registerTypingPeer(
        String(msg.peerId || ''),
        String(msg.name || 'Participante'),
        Boolean(msg.isTyping),
        msg.toPeerId || null,
      );
      return;
    }

    if (msg.type === 'wave:received' && msg.wave) {
      this._emit({ lastWave: msg.wave });
      return;
    }

    if (msg.type === 'reaction:received' && msg.reaction) {
      this._emit({ lastReaction: msg.reaction });
      return;
    }

    if (msg.type === 'subtitle:received' && msg.subtitle) {
      this._emit({ lastSubtitle: msg.subtitle });
      return;
    }

    if (msg.type === 'webrtc:signal' && msg.fromPeerId) {
      this._handlePeerSignal(msg.fromPeerId, msg.data);
      return;
    }

    if (msg.type === 'emitter:granted') {
      if (msg.meta) this._applyRoomStatePatch({ meta: msg.meta });
      if (this._pendingEmitterClaim) {
        const resolve = this._pendingEmitterClaim.resolve;
        window.clearTimeout(this._pendingEmitterClaim.timer);
        this._pendingEmitterClaim = null;
        resolve({ ok: true, meta: msg.meta });
      }
      return;
    }

    if (msg.type === 'emitter:denied') {
      if (this._pendingEmitterClaim) {
        const resolve = this._pendingEmitterClaim.resolve;
        window.clearTimeout(this._pendingEmitterClaim.timer);
        this._pendingEmitterClaim = null;
        resolve({ ok: false, error: msg.message || 'Otro participante está emitiendo.' });
      } else {
        this._emit({ mediaNotice: msg.message || 'Otro participante está emitiendo.' });
      }
      return;
    }

    if (msg.type === 'emitter:assigned') {
      this._emit({
        mediaNotice: `${String(msg.byName || 'El anfitrión')} te cedió el escenario de emisión.`,
      });
    }
  }

  _connectWebSocket(joinPayload) {
    this._stopSocket();
    this._stopPolling();
    const code = joinPayload.roomCode;
    this.roomCode = code;

    const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = typeof window !== 'undefined' ? window.location.host : '127.0.0.1:3000';
    const wsUrl = `${proto}//${host}/api/room/${encodeURIComponent(code)}/ws`;

    let opened = false;
    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        if (this._destroyed || this.manualLeave || this.ws !== ws) return;
        opened = true;
        this.reconnectAttempts = 0;
        this._emit({ wsConnected: true });

        ws.send(
          JSON.stringify({
            type: 'room:join',
            roomCode: code,
            mode: joinPayload.mode || this.roomMode || 'broadcast',
            pass: joinPayload.pass,
            peerId: this.peerId,
            clientId: this.clientId,
            name: joinPayload.name,
            micOn: Boolean(joinPayload.micOn),
            camOn: Boolean(joinPayload.camOn),
            wantHost: Boolean(joinPayload.wantHost),
            callsSessionId: this.callsSessionId,
          }),
        );

        this.wsHeartbeat = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: 'ping' }));
            } catch {
              // ignore
            }
          }
        }, 15000);
      };

      ws.onmessage = (evt) => {
        if (this._destroyed) return;
        try {
          const parsed = JSON.parse(String(evt.data || ''));
          this._handleWsPayload(parsed);
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (this.ws !== ws) return;
        this._stopSocket();
        if (this.manualLeave || this._destroyed) return;
        if (!opened) {
          this._fallbackJoinViaRest(joinPayload);
          return;
        }
        const attempt = Math.min(5, this.reconnectAttempts + 1);
        this.reconnectAttempts = attempt;
        const delay = Math.min(7000, 500 * 2 ** (attempt - 1));
        this.reconnectTimer = window.setTimeout(() => {
          if (!this.manualLeave && !this._destroyed && this.joinConfig) {
            this._connectWebSocket({
              ...this.joinConfig,
              camOn: this.state.self?.camOn ?? this.joinConfig.camOn,
            });
          }
        }, delay);
      };

      ws.onerror = () => {
        // onclose handles fallback/reconnect cleanly
      };
    } catch {
      this._fallbackJoinViaRest(joinPayload);
    }
  }

  async _fallbackJoinViaRest(joinPayload) {
    try {
      const res = await fetch(`/api/room/${encodeURIComponent(joinPayload.roomCode)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'room:join',
          roomCode: joinPayload.roomCode,
          mode: joinPayload.mode || this.roomMode || 'broadcast',
          pass: joinPayload.pass,
          peerId: this.peerId,
          clientId: this.clientId,
          name: joinPayload.name,
          micOn: Boolean(joinPayload.micOn),
          camOn: Boolean(joinPayload.camOn),
          wantHost: Boolean(joinPayload.wantHost),
          callsSessionId: this.callsSessionId,
        }),
      });
      const msg = await res.json();
      if (typeof msg.lastEventId === 'number') this.lastEventId = msg.lastEventId;
      this._handleWsPayload(msg);
      if (!this.manualLeave && (msg.type === 'room:joined' || msg.type === 'room:waiting')) {
        this.pollActive = true;
        this._scheduleFallbackPoll(joinPayload.roomCode);
      }
    } catch {
      // retry next tick
    }
  }

  _scheduleFallbackPoll(code) {
    if (!this.pollActive || this.manualLeave || this._destroyed) return;
    if (this.pollTimer) window.clearTimeout(this.pollTimer);
    this.pollTimer = window.setTimeout(async () => {
      if (this.pollActive && !this.pollInFlight && !this.manualLeave) {
        this.pollInFlight = true;
        try {
          const res = await fetch(
            `/api/room/${encodeURIComponent(code)}?poll=1&peerId=${encodeURIComponent(this.peerId)}&afterEventId=${this.lastEventId}`,
          );
          if (res.ok) {
            const data = await res.json();
            if (typeof data.lastEventId === 'number' && data.lastEventId > this.lastEventId) {
              this.lastEventId = data.lastEventId;
            }
            if (data.ended || data.rejected) {
              this._handleWsPayload({
                type: 'room:rejected',
                message: data.rejection?.message || 'La sala fue cerrada.',
              });
              return;
            }
            if (Array.isArray(data.events)) {
              for (const ev of data.events) {
                this._handleWsPayload({ type: ev.eventType, ...ev.payload });
              }
            }
            if (data.inRoom) {
              this._applyRoomStatePatch({
                status: data.status || 'connected',
                self: data.self || this.state.self,
                meta: data.meta || this.state.meta,
                waiting: Array.isArray(data.waiting) ? data.waiting : [],
                peers: Array.isArray(data.peers) ? data.peers : this.state.peers,
              });
              if (Array.isArray(data.messages)) {
                for (const m of data.messages) this._appendMessageUnique(m);
              }
            }
          }
        } catch {
          // ignore
        } finally {
          this.pollInFlight = false;
        }
      }
      this._scheduleFallbackPoll(code);
    }, 1500);
  }

  async joinRoom(opts) {
    this.roomMode = opts.mode === 'duo' ? 'duo' : opts.mode === 'normal' ? 'normal' : 'broadcast';
    this.manualLeave = false;
    this._emit({ rejectionMessage: '', mediaNotice: null, status: 'joining' });

    let media;
    const pre = opts.precheckedStream;
    const hasLiveCam = Boolean(pre && pre.getVideoTracks().some((t) => t.readyState === 'live'));
    const isUnlocked = this.isMicUnlocked();
    if (hasLiveCam && opts.camOn) {
      if (!isUnlocked) {
        pre.getAudioTracks().forEach((t) => t.stop());
      }
      const vTrack = pre.getVideoTracks()[0];
      vTrack.enabled = true;
      const tracks = [vTrack];
      if (isUnlocked && opts.micOn && pre.getAudioTracks().length > 0) {
        tracks.push(pre.getAudioTracks()[0]);
      }
      media = { stream: new MediaStream(tracks), mic: Boolean(isUnlocked && opts.micOn), cam: true };
    } else {
      if (pre) pre.getTracks().forEach((t) => t.stop());
      media = await this._acquireLocalMedia(Boolean(opts.camOn), Boolean(opts.micOn));
    }

    try {
      const res = await fetch('/api/calls/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: opts.roomCode, peerId: this.peerId }),
      });
      const sessionJson = await res.json();
      if (res.status === 403) {
        if (media.stream) media.stream.getTracks().forEach((t) => t.stop());
        this._emit({
          rejectionMessage: sessionJson.error || 'La sala alcanzó su capacidad máxima.',
          status: 'rejected',
        });
        return false;
      }
      if (res.ok && sessionJson.ok) {
        this.callsSessionId = sessionJson.sessionId || null;
        this._emit({
          roomCapacity: this.roomMode === 'duo' ? 2 : (sessionJson.maxParticipants || ROOM_CAPACITY),
          callsConfigured: Boolean(sessionJson.configured && sessionJson.sessionId),
          sfuMode: sessionJson.configured && sessionJson.sessionId ? 'cloudflare-calls' : 'ws-local-preview',
        });
      }
    } catch {
      this.callsSessionId = null;
      this._emit({
        roomCapacity: this.roomMode === 'duo' ? 2 : ROOM_CAPACITY,
        callsConfigured: false,
        sfuMode: 'ws-local-preview',
      });
    }

    this._emit({ localStream: media.stream });

    this.joinConfig = {
      roomCode: opts.roomCode,
      mode: this.roomMode,
      pass: opts.pass,
      name: opts.name,
      micOn: Boolean(isUnlocked && opts.micOn),
      camOn: media.cam,
      wantHost: Boolean(opts.wantHost),
    };
    this._connectWebSocket(this.joinConfig);
    return true;
  }

  leaveRoom() {
    this.manualLeave = true;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.state.meta?.emitterPeerId === this.peerId) {
      this._sendSignal({ type: 'emitter:release' });
    }
    this._sendSignal({ type: 'room:leave' });
    this._stopSocket();
    this._stopPolling();
    this.roomCode = '';
    this._closeSfuConnection();
    if (this.state.localStream) {
      this.state.localStream.getTracks().forEach((t) => t.stop());
    }
    if (this.state.broadcastStream) {
      this.state.broadcastStream.getTracks().forEach((t) => t.stop());
    }
    if (this.state.screenStream) {
      this.state.screenStream.getTracks().forEach((t) => t.stop());
    }
    this._emit({
      localStream: null,
      broadcastStream: null,
      remoteBroadcastStream: null,
      screenStream: null,
      peers: [],
      waiting: [],
      typingPeers: [],
      self: null,
      status: 'ended',
    });
  }

  async toggleMic() {
    if (!this.isMicUnlocked()) {
      this._emit({
        mediaNotice: 'Micrófonos bloqueados en Sala de Emisión Pro · Solo se escucha al emisor principal.',
      });
      return;
    }
    const current = this.state.self;
    if (!current) return;
    const nextMic = !current.micOn;

    let aTrack = this.state.localStream?.getAudioTracks().find((t) => t.readyState === 'live') || null;
    if (nextMic) {
      if (!aTrack) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          const newTrack = micStream.getAudioTracks()[0];
          if (newTrack) {
            newTrack.enabled = true;
            if (this.state.localStream) {
              this.state.localStream.addTrack(newTrack);
            } else {
              this.state.localStream = new MediaStream([newTrack]);
            }
            aTrack = newTrack;
          }
        } catch {
          this._emit({ mediaNotice: 'No se pudo activar el micrófono.' });
          return;
        }
      } else {
        aTrack.enabled = true;
      }
    } else {
      if (aTrack) {
        aTrack.enabled = false;
      }
    }

    for (const [, pc] of this.p2pConnections.entries()) {
      try {
        const senders = pc.getSenders();
        const existing = senders.find((s) => s.track && s.track.kind === 'audio');
        if (existing) {
          existing.replaceTrack(nextMic ? aTrack : null).catch(() => {});
        } else if (nextMic && aTrack && this.state.localStream) {
          pc.addTrack(aTrack, this.state.localStream);
        }
      } catch {
        // ignore
      }
    }

    this._emit({
      self: { ...current, micOn: nextMic },
      peers: this.state.peers.map((p) => (p.peerId === this.peerId ? { ...p, micOn: nextMic } : p)),
    });
    this._sendSignal({ type: 'peer:state', patch: { micOn: nextMic } });
  }

  async toggleCam() {
    const current = this.state.self;
    if (!current) return;
    if (this.state.meta?.emitterPeerId === this.peerId) {
      this._emit({
        mediaNotice: 'Tu cámara permanece apagada mientras emites para priorizar el ancho de banda.',
      });
      return;
    }

    const nextCam = !current.camOn;
    if (nextCam) {
      let track = this.state.localStream?.getVideoTracks().find((t) => t.readyState === 'live') || null;
      if (!track) {
        const media = await this._acquireLocalMedia(true);
        if (!media.stream) return;
        this._emit({ localStream: media.stream, mediaNotice: null });
      } else {
        track.enabled = true;
      }
      this._emit({
        self: { ...current, camOn: true },
        peers: this.state.peers.map((p) => (p.peerId === this.peerId ? { ...p, camOn: true } : p)),
      });
      this._sendSignal({ type: 'peer:state', patch: { camOn: true } });
      if (this.callsSessionId) {
        await this.publishLocalCamTrack();
      }
    } else {
      if (this.state.localStream) {
        this.state.localStream.getVideoTracks().forEach((t) => {
          t.enabled = false;
          t.stop();
        });
      }
      this._emit({
        localStream: null,
        self: { ...current, camOn: false },
        peers: this.state.peers.map((p) => (p.peerId === this.peerId ? { ...p, camOn: false } : p)),
      });
      this._sendSignal({ type: 'peer:state', patch: { camOn: false } });
      if (this._publishedCam) {
        await this.unpublishLocalCamTrack();
      }
    }
  }

  claimEmitter(sourceType = 'screen', mediaTitle = null) {
    const currentEmitter = this.state.meta?.emitterPeerId;
    if (currentEmitter && currentEmitter !== this.peerId) {
      return Promise.resolve({
        ok: false,
        error: 'Otro participante ya está emitiendo en la sala.',
      });
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return new Promise((resolve) => {
        if (this._pendingEmitterClaim) {
          window.clearTimeout(this._pendingEmitterClaim.timer);
          this._pendingEmitterClaim.resolve({ ok: false, error: 'Solicitud reemplazada.' });
        }
        const timer = window.setTimeout(() => {
          this._pendingEmitterClaim = null;
          resolve({ ok: true });
        }, 1200);
        this._pendingEmitterClaim = { resolve, timer };
        this.ws.send(
          JSON.stringify({
            type: 'emitter:claim',
            peerId: this.peerId,
            clientId: this.clientId,
            sourceType,
            status: 'preparing',
            mediaTitle,
            callsSessionId: this.callsSessionId,
          }),
        );
      });
    }

    return this._sendSignal({
      type: 'emitter:claim',
      sourceType,
      status: 'preparing',
      mediaTitle,
      callsSessionId: this.callsSessionId,
    }).then((res) => (res && res.ok === false ? { ok: false, error: res.error } : { ok: true }));
  }

  async _waitFirstVideoFrame(stream) {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const tmp = document.createElement('video');
      tmp.muted = true;
      tmp.playsInline = true;
      tmp.srcObject = new MediaStream([track]);
      tmp.onloadeddata = finish;
      tmp.play().catch(() => {});
      window.setTimeout(finish, 900);
    });
  }

  async startScreenBroadcast() {
    if (this.screenBusy) return false;
    this.screenBusy = true;
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        this._emit({ mediaNotice: 'Tu navegador no soporta compartir pantalla.' });
        return false;
      }

      const claim = await this.claimEmitter('screen', 'Pantalla compartida');
      if (!claim.ok) {
        this._emit({ mediaNotice: claim.error || 'El escenario de emisión está ocupado.' });
        return false;
      }

      let displayStream = null;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: true,
        });
      } catch (err) {
        if (err?.name === 'NotAllowedError' && err.message?.toLowerCase().includes('permission denied')) {
          await this.stopBroadcast();
          return false;
        }
        try {
          displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false,
          });
        } catch {
          displayStream = null;
        }
      }

      if (!displayStream) {
        await this.stopBroadcast();
        return false;
      }

      const vTrack = displayStream.getVideoTracks()[0];
      if (!vTrack) {
        displayStream.getTracks().forEach((t) => t.stop());
        await this.stopBroadcast();
        return false;
      }
      if ('contentHint' in vTrack) vTrack.contentHint = 'motion';
      vTrack.onended = () => {
        this.stopBroadcast().catch(() => {});
      };

      await this._waitFirstVideoFrame(displayStream);
      if (this.state.meta) {
        this.state.meta.emitterPeerId = this.peerId;
      }

      this._emit({
        screenStream: displayStream,
        broadcastStream: displayStream,
      });

      this._broadcastStreamToP2P(displayStream);

      const published = await this._publishBroadcastTracks(displayStream);
      this._sendSignal({
        type: 'broadcast:state',
        status: 'live',
        sourceType: 'screen',
        mediaTitle: 'Pantalla compartida',
        callsSessionId: this.callsSessionId,
        videoTrackName: published.videoTrackName,
        audioTrackName: published.audioTrackName,
      });
      return true;
    } finally {
      this.screenBusy = false;
    }
  }

  async startMediaBroadcast(stream, title = 'Multimedia local') {
    if (!stream) return false;
    const claim = await this.claimEmitter('media', title);
    if (!claim.ok) {
      this._emit({ mediaNotice: claim.error || 'El escenario de emisión está ocupado.' });
      return false;
    }

    if (this.state.screenStream && this.state.screenStream !== stream) {
      this.state.screenStream.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
    }

    if (this.state.meta) {
      this.state.meta.emitterPeerId = this.peerId;
    }

    this._emit({
      screenStream: null,
      broadcastStream: stream,
    });

    this._broadcastStreamToP2P(stream);

    const published = await this._publishBroadcastTracks(stream);
    this._sendSignal({
      type: 'broadcast:state',
      status: 'live',
      sourceType: 'media',
      mediaTitle: title,
      callsSessionId: this.callsSessionId,
      videoTrackName: published.videoTrackName,
      audioTrackName: published.audioTrackName,
    });
    return true;
  }

  updateBroadcastTitle(title) {
    if (this.state.meta?.emitterPeerId !== this.peerId) return;
    this._sendSignal({
      type: 'broadcast:state',
      status: this.state.meta?.broadcast?.status || 'live',
      sourceType: 'media',
      mediaTitle: title,
    });
  }

  async stopBroadcast() {
    this._removeBroadcastStreamFromP2P();
    if (this._publishedBroadcast.length > 0) {
      const entries = [...this._publishedBroadcast];
      this._publishedBroadcast = [];
      await this._enqueueSfu(() => this._closePublishedSfuTracks(entries));
    }
    if (this.state.screenStream) {
      this.state.screenStream.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
    }
    // Limpiar el estado local inmediatamente para evitar que se quede congelado en el escenario
    if (this.state.meta && this.state.meta.emitterPeerId === this.peerId) {
      this.state.meta = {
        ...this.state.meta,
        emitterPeerId: null,
        broadcast: { status: 'idle', sourceType: 'none' },
      };
    }
    this._emit({
      screenStream: null,
      broadcastStream: null,
    });
    this._sendSignal({ type: 'emitter:release' });
  }

  toggleHand() {
    const current = this.state.self;
    if (!current) return;
    const nextHand = !current.handRaised;
    this._emit({
      self: { ...current, handRaised: nextHand },
      peers: this.state.peers.map((p) => (p.peerId === this.peerId ? { ...p, handRaised: nextHand } : p)),
    });
    this._sendSignal({ type: 'peer:state', patch: { handRaised: nextHand } });
  }

  sendChat(text, toPeerId = null) {
    const cleanText = String(text || '').trim().slice(0, 500);
    if (!cleanText) return;
    this._sendSignal({ type: 'chat:send', text: cleanText, toPeerId });
    this._sendSignal({ type: 'chat:typing', isTyping: false, toPeerId });
  }

  notifyTyping(isTyping, toPeerId = null) {
    const now = Date.now();
    if (isTyping && now - this.lastTypingSentAt < 1400) return;
    if (isTyping) this.lastTypingSentAt = now;
    this._sendSignal({ type: 'chat:typing', isTyping, toPeerId });
  }

  sendWave(toPeerId = null) {
    this._sendSignal({ type: 'wave:send', toPeerId });
  }

  sendReaction(kind) {
    this._sendSignal({ type: 'reaction:send', kind });
  }

  broadcastSubtitle(text) {
    this._sendSignal({ type: 'subtitle:broadcast', text });
  }

  sendInteractive(action, payload = {}) {
    this._sendSignal({ type: 'room:interactive', action, payload });
  }

  async flipCamera() {
    if (this.state.meta?.emitterPeerId === this.peerId) {
      this._emit({ mediaNotice: 'Cámara desactivada durante emisión.' });
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia) return false;
    const prevFacing = this.state.facingMode === 'environment' ? 'environment' : 'user';
    const nextFacing = prevFacing === 'user' ? 'environment' : 'user';
    let nextCamStream;
    try {
      nextCamStream = await navigator.mediaDevices.getUserMedia({
        video: { ...VIEWER_CAM_CONSTRAINTS, facingMode: { exact: nextFacing } },
        audio: false,
      });
    } catch {
      try {
        nextCamStream = await navigator.mediaDevices.getUserMedia({
          video: { ...VIEWER_CAM_CONSTRAINTS, facingMode: { ideal: nextFacing } },
          audio: false,
        });
      } catch {
        this._emit({ mediaNotice: 'Solo se detectó una cámara activa en este dispositivo.' });
        return false;
      }
    }
    const newTrack = nextCamStream.getVideoTracks()[0];
    if (!newTrack) return false;
    if (this.state.localStream) {
      this.state.localStream.getVideoTracks().forEach((t) => t.stop());
    }
    const wantCam = Boolean(this.state.self?.camOn ?? true);
    newTrack.enabled = wantCam;
    const merged = new MediaStream([newTrack]);
    this._emit({ localStream: merged, facingMode: nextFacing, mediaNotice: null });
    if (this.callsSessionId && wantCam) {
      await this.publishLocalCamTrack();
    }
    return true;
  }

  hostAction(action, opts = {}) {
    this._sendSignal({
      type: 'host:action',
      action,
      targetPeerId: opts.targetPeerId,
      value: opts.value,
      block: opts.block,
    });
  }

  async retryMedia() {
    if (this.state.meta?.emitterPeerId === this.peerId) return;
    const media = await this._acquireLocalMedia(true);
    if (!media.stream) return;
    if (this.state.localStream) {
      this.state.localStream.getTracks().forEach((t) => t.stop());
    }
    this._emit({ localStream: media.stream, facingMode: 'user' });
    this._emit({
      self: this.state.self ? { ...this.state.self, micOn: false, camOn: media.cam } : null,
    });
    this._sendSignal({ type: 'peer:state', patch: { micOn: false, camOn: media.cam } });
    if (this.callsSessionId && media.cam) {
      await this.publishLocalCamTrack();
    }
  }

  softRefresh() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.joinConfig && this.state.status === 'connected') {
        this._connectWebSocket({
          ...this.joinConfig,
          camOn: this.state.self?.camOn ?? this.joinConfig.camOn,
        });
      }
    } else {
      try {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      } catch {
        // ignore
      }
    }
    if (this.callsSessionId) {
      this._syncRemoteSubscriptions();
    }
  }

  clearWave() {
    if (this.state.lastWave) this._emit({ lastWave: null });
  }

  clearReaction() {
    if (this.state.lastReaction) this._emit({ lastReaction: null });
  }

  clearHostMuteNotice() {
    if (this.state.hostMuteNotice) this._emit({ hostMuteNotice: null });
  }

  destroy() {
    this._destroyed = true;
    window.removeEventListener('pagehide', this._onPageHide);
    window.clearInterval(this._typingPruneInterval);
    this.manualLeave = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    if (this._pendingEmitterClaim) {
      window.clearTimeout(this._pendingEmitterClaim.timer);
      this._pendingEmitterClaim = null;
    }
    if (this.roomCode) {
      this._sendSignal({ type: 'room:leave' });
      this.roomCode = '';
    }
    this._stopSocket();
    this._stopPolling();
    this._closeSfuConnection();
    if (this.state.localStream) {
      this.state.localStream.getTracks().forEach((t) => t.stop());
    }
    if (this.state.broadcastStream) {
      this.state.broadcastStream.getTracks().forEach((t) => t.stop());
    }
    if (this.state.screenStream) {
      this.state.screenStream.getTracks().forEach((t) => t.stop());
    }
  }
}
