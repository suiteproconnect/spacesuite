export const ROOM_CAPACITY = 20;

const BASE_STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

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

async function waitForMeteredSdk(timeoutMs = 2500) {
  if (typeof window !== 'undefined' && window.Metered?.Meeting) return true;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
    if (typeof window !== 'undefined' && window.Metered?.Meeting) return true;
  }
  return false;
}

export class RoomEngine {
  constructor(onChange) {
    this.onChange = typeof onChange === 'function' ? onChange : () => {};

    this.state = {
      status: 'idle',
      sfuMode: 'p2p-fallback',
      videoQuality: '720p',
      roomCapacity: ROOM_CAPACITY,
      rejectionMessage: '',
      self: null,
      peers: [],
      waiting: [],
      messages: [],
      typingPeers: [],
      meta: null,
      localStream: null,
      screenStream: null,
      remoteStreams: {},
      speakingIds: {},
      localAudioLevel: 0,
      weakConnection: false,
      mediaNotice: null,
      lastWave: null,
      lastReaction: null,
      lastParticipantJoin: null,
      facingMode: 'user',
      hostMuteNotice: null,
    };

    this.roomCode = '';
    this.pollTimer = null;
    this.pollActive = false;
    this.lastEventId = 0;
    this.peerId = crypto.randomUUID();
    this.clientId = getPersistentClientId();
    this.connections = new Map();
    this.dataChannels = new Map();
    this.iceCandidateQueues = new Map();
    this.iceRestartTimers = new Map();
    this.iceRestartCooldowns = new Map();
    this.runtimeIceServers = [];

    this.meteredSession = null;
    this.meteredMeeting = null;
    this.meteredJoined = false;
    this.meteredJoining = false;
    this.meteredSessionToPeerId = new Map();
    this.meteredSessionRecords = new Map();
    this.meteredRemoteStreams = new Map();
    this.notifiedMeteredSessionIds = new Set();
    this.currentQuality = '720p';

    this.joinConfig = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.manualLeave = false;
    this.screenBusy = false;
    this.lastTypingSentAt = 0;

    this.audioCtx = null;
    this.analysers = new Map();
    this._lastSpeakingState = {};
    this._holdTimers = {};
    this._destroyed = false;

    this._speakingInterval = window.setInterval(() => this._tickSpeaking(), 120);
    this._typingPruneInterval = window.setInterval(() => this._pruneTyping(), 600);

    this._onPageHide = () => {
      const code = this.roomCode;
      if (!code || this.manualLeave) return;
      const body = JSON.stringify({
        type: 'room:leave',
        peerId: this.peerId,
        clientId: this.clientId,
      });
      fetch(`/api/room/${encodeURIComponent(code)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener('pagehide', this._onPageHide);
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

  _tickSpeaking() {
    if (this._destroyed || this.analysers.size === 0) return;
    let changed = false;
    let levelChanged = false;

    for (const [id, entry] of this.analysers.entries()) {
      entry.analyser.getByteFrequencyData(entry.data);
      let sum = 0;
      for (let i = 0; i < entry.data.length; i++) sum += entry.data[i];
      const avg = sum / entry.data.length;
      const normalized = Math.min(1, avg / 42);

      if (id === 'local') {
        const micActive = Boolean(this.state.self?.micOn);
        const lvl = micActive ? normalized : 0;
        if (Math.abs(lvl - this.state.localAudioLevel) > 0.02) {
          this.state.localAudioLevel = lvl;
          levelChanged = true;
        }
      }

      const isSpeakingNow = id === 'local' ? Boolean(this.state.self?.micOn) && avg > 14 : avg > 14;
      let nextBool = false;
      if (isSpeakingNow) {
        this._holdTimers[id] = Date.now() + 550;
        nextBool = true;
      } else if ((this._holdTimers[id] || 0) > Date.now()) {
        nextBool = true;
      }

      const targetKey = id === 'local' ? this.peerId : id;
      if (this._lastSpeakingState[targetKey] !== nextBool) {
        this._lastSpeakingState[targetKey] = nextBool;
        changed = true;
        if (id === 'local' && this.roomCode) {
          this._sendSignal({ type: 'peer:state', patch: { speaking: nextBool } });
        }
      }
    }

    if (changed) {
      this.state.speakingIds = { ...this.state.speakingIds, ...this._lastSpeakingState };
      this._emit();
    } else if (levelChanged) {
      this._emit();
    }
  }

  _applyAdaptiveQuality() {
    if (this.state.status !== 'connected') return;
    const targetQuality = this.state.peers.length >= 6 ? '540p' : '720p';
    if (this.currentQuality === targetQuality) return;
    this.currentQuality = targetQuality;
    this._emit({ videoQuality: targetQuality });

    const constraints =
      targetQuality === '720p'
        ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
        : { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 24 } };

    if (this.meteredMeeting) {
      this.meteredMeeting.defaultVideoConstraints = { video: { ...constraints } };
    }
    const camTrack = this.state.localStream?.getVideoTracks().find((t) => t.readyState === 'live');
    if (camTrack && typeof camTrack.applyConstraints === 'function') {
      camTrack.applyConstraints(constraints).catch(() => {});
    }
  }

  _appendMessageUnique(incoming) {
    const prev = this.state.messages;
    const existingIndex = prev.findIndex((m) => m.id === incoming.id);
    if (existingIndex >= 0) {
      const updated = [...prev];
      updated[existingIndex] = { ...updated[existingIndex], ...incoming };
      this._emit({ messages: updated });
      return;
    }
    const dup = prev.some(
      (m) =>
        m.fromPeerId === incoming.fromPeerId &&
        m.text === incoming.text &&
        (m.toPeerId || null) === (incoming.toPeerId || null) &&
        Math.abs(m.timestamp - incoming.timestamp) < 2500,
    );
    if (dup) return;
    const nextList = [...prev, incoming].sort((a, b) => a.timestamp - b.timestamp);
    this._emit({ messages: nextList });
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

  _sendSignal(msg) {
    const code = this.roomCode;
    if (!code) return;
    const endpoint = `/api/room/${encodeURIComponent(code)}`;
    const body = JSON.stringify({
      ...msg,
      peerId: this.peerId,
      clientId: this.clientId,
    });

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: msg.type === 'room:leave',
    })
      .then(async (res) => {
        if (!res.ok || this._destroyed) return;
        const json = await res.json().catch(() => null);
        if (!json) return;
        if (json.type === 'chat:message' && json.message) {
          this._appendMessageUnique(json.message);
        }
        const patch = {};
        if (json.meta) patch.meta = json.meta;
        if (json.self) patch.self = json.self;
        if (Array.isArray(json.peers)) patch.peers = json.peers;
        if (Array.isArray(json.waiting)) patch.waiting = json.waiting;
        if (Object.keys(patch).length > 0) {
          this._emit(patch);
          this._applyAdaptiveQuality();
        }
      })
      .catch(() => {});
  }

  _refreshWeakConnection() {
    if (this.state.sfuMode === 'metered-sfu') return;
    let weak = false;
    for (const entry of this.connections.values()) {
      const st = entry.pc.iceConnectionState;
      if (st === 'disconnected' || st === 'failed') {
        weak = true;
        break;
      }
    }
    if (weak !== this.state.weakConnection) {
      this._emit({ weakConnection: weak });
    }
  }

  _detachAnalyser(id) {
    const entry = this.analysers.get(id);
    if (entry) {
      try {
        entry.source.disconnect();
      } catch {
        // ignore
      }
      this.analysers.delete(id);
    }
  }

  _attachAudioAnalyser(id, stream) {
    if (!stream || stream.getAudioTracks().length === 0) return;
    this._detachAnalyser(id);
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.audioCtx) {
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      const source = this.audioCtx.createMediaStreamSource(stream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      this.analysers.set(id, { analyser, source, data });
    } catch {
      // ignore AudioContext block
    }
  }

  _closeMeteredMeeting() {
    if (this.meteredMeeting) {
      try {
        this.meteredMeeting.leaveMeeting();
      } catch {
        // ignore
      }
      this.meteredMeeting = null;
    }
    this.meteredJoined = false;
    this.meteredJoining = false;
    this.meteredSessionToPeerId.clear();
    this.meteredSessionRecords.clear();
    this.meteredRemoteStreams.clear();
    this.notifiedMeteredSessionIds.clear();
  }

  _resolveMeteredPeerId(participant, sessionId, claimedPeerIds = null) {
    const extId = participant?.externalUserId;
    if (extId && extId !== this.peerId) {
      if (sessionId) this.meteredSessionToPeerId.set(sessionId, extId);
      return extId;
    }
    if (sessionId && this.meteredSessionToPeerId.has(sessionId)) {
      const mapped = this.meteredSessionToPeerId.get(sessionId);
      if (mapped && mapped !== this.peerId) return mapped;
    }
    const remotePeers = this.state.peers.filter((p) => p.peerId !== this.peerId);
    const pName = String(participant?.name || participant?.participantName || '').trim().toLowerCase();
    if (pName) {
      const matched = remotePeers.find(
        (p) =>
          p.name.trim().toLowerCase() === pName &&
          (!claimedPeerIds || !claimedPeerIds.has(p.peerId)),
      ) || remotePeers.find((p) => p.name.trim().toLowerCase() === pName);
      if (matched) {
        if (sessionId) this.meteredSessionToPeerId.set(sessionId, matched.peerId);
        return matched.peerId;
      }
    }
    return null;
  }

  _rebuildMeteredRemoteStreams() {
    if (this.state.sfuMode !== 'metered-sfu') return;
    const remotePeers = this.state.peers.filter((p) => p.peerId !== this.peerId);
    const claimedPeerIds = new Set();
    const nextRemoteStreams = {};
    const unresolvedRecords = [];

    for (const [sessionId, rec] of this.meteredSessionRecords.entries()) {
      const resolvedPeerId = this._resolveMeteredPeerId(rec.participant, sessionId, claimedPeerIds);
      if (resolvedPeerId && resolvedPeerId !== this.peerId && remotePeers.some((p) => p.peerId === resolvedPeerId)) {
        claimedPeerIds.add(resolvedPeerId);
        this.meteredRemoteStreams.set(resolvedPeerId, rec.stream);
        nextRemoteStreams[resolvedPeerId] = new MediaStream(rec.stream.getTracks());
        if (rec.stream.getAudioTracks().length > 0 && !this.analysers.has(resolvedPeerId)) {
          this._attachAudioAnalyser(resolvedPeerId, rec.stream);
        }
      } else {
        unresolvedRecords.push({ sessionId, rec });
      }
    }

    const unclaimedPeers = remotePeers.filter((p) => !claimedPeerIds.has(p.peerId));
    if (unresolvedRecords.length > 0 && unclaimedPeers.length > 0) {
      for (let i = 0; i < Math.min(unresolvedRecords.length, unclaimedPeers.length); i++) {
        const { sessionId, rec } = unresolvedRecords[i];
        const targetPeer = unclaimedPeers[i];
        this.meteredSessionToPeerId.set(sessionId, targetPeer.peerId);
        this.meteredRemoteStreams.set(targetPeer.peerId, rec.stream);
        nextRemoteStreams[targetPeer.peerId] = new MediaStream(rec.stream.getTracks());
        if (rec.stream.getAudioTracks().length > 0 && !this.analysers.has(targetPeer.peerId)) {
          this._attachAudioAnalyser(targetPeer.peerId, rec.stream);
        }
      }
    }

    this._emit({ remoteStreams: nextRemoteStreams });
  }

  async _connectMeteredSFU() {
    const session = this.meteredSession;
    if (!session?.configured || !session.roomURL || !session.accessToken) return;
    if (this.meteredJoined || this.meteredJoining) return;

    const sdkReady = await waitForMeteredSdk(2500);
    if (!sdkReady || !window.Metered?.Meeting) {
      this._emit({ mediaNotice: 'SDK SFU no disponible; usando enlace directo.' });
      return;
    }

    this.meteredJoining = true;
    try {
      const meeting = new window.Metered.Meeting();
      this.meteredMeeting = meeting;

      const initialQuality = this.state.peers.length >= 6 ? '540p' : '720p';
      this.currentQuality = initialQuality;
      this._emit({ videoQuality: initialQuality });

      meeting.defaultVideoConstraints = {
        video:
          initialQuality === '720p'
            ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: 30 }
            : { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: 24 },
      };

      const syncParticipantDirectory = (list, markNotified = false) => {
        if (!Array.isArray(list)) return;
        for (const p of list) {
          const sid = p?._id || p?.participantSessionId;
          if (sid && p.externalUserId) {
            this.meteredSessionToPeerId.set(sid, p.externalUserId);
          }
          if (sid && this.meteredSessionRecords.has(sid)) {
            this.meteredSessionRecords.get(sid).participant = p;
          }
          if (markNotified && sid) {
            this.notifiedMeteredSessionIds.add(sid);
          }
        }
        if (this.meteredSessionRecords.size > 0) {
          this._rebuildMeteredRemoteStreams();
        }
      };

      meeting.on('onlineParticipants', (list) => syncParticipantDirectory(list));

      meeting.on('participantJoined', (p) => {
        const sessionId = p?._id || p?.participantSessionId || null;
        if (sessionId && p?.externalUserId) {
          this.meteredSessionToPeerId.set(sessionId, p.externalUserId);
        }
        if (sessionId && this.meteredSessionRecords.has(sessionId)) {
          this.meteredSessionRecords.get(sessionId).participant = p;
          this._rebuildMeteredRemoteStreams();
        }
        const resolvedPeerId = this._resolveMeteredPeerId(p, sessionId);
        const isSelfSession = Boolean(
          (sessionId && meeting.participantSessionId && sessionId === meeting.participantSessionId) ||
            (resolvedPeerId && resolvedPeerId === this.peerId),
        );
        if (isSelfSession) return;

        if (sessionId) {
          if (this.notifiedMeteredSessionIds.has(sessionId)) return;
          this.notifiedMeteredSessionIds.add(sessionId);
        }

        const matchedPeer = resolvedPeerId
          ? this.state.peers.find((peer) => peer.peerId === resolvedPeerId)
          : null;
        const participantName =
          String(p?.name || p?.participantName || p?.participant?.name || matchedPeer?.name || '').trim() ||
          'Nuevo participante';

        this._emit({
          lastParticipantJoin: {
            id: crypto.randomUUID(),
            peerId: resolvedPeerId || sessionId || null,
            name: participantName,
            ts: Date.now(),
          },
        });
      });

      meeting.on('participantLeft', (p) => {
        const sessionId = p?._id || p?.participantSessionId || null;
        const resolvedId = this._resolveMeteredPeerId(p, sessionId);
        if (sessionId) {
          this.meteredSessionToPeerId.delete(sessionId);
          this.meteredSessionRecords.delete(sessionId);
          this.notifiedMeteredSessionIds.delete(sessionId);
        }
        if (resolvedId) {
          this.meteredRemoteStreams.delete(resolvedId);
          this._detachAnalyser(resolvedId);
        }
        this._rebuildMeteredRemoteStreams();
      });

      meeting.on('remoteTrackStarted', (ev) => {
        if (!ev || ev.participantSessionId === meeting.participantSessionId) return;
        const incomingTracks = [];
        if (ev.track) incomingTracks.push(ev.track);
        if (ev.stream && typeof ev.stream.getTracks === 'function') {
          for (const stTrack of ev.stream.getTracks()) {
            if (!incomingTracks.some((t) => t.id === stTrack.id)) incomingTracks.push(stTrack);
          }
        }
        if (incomingTracks.length === 0) return;

        const sessionId = ev.participantSessionId || ev.participant?._id || `sess-${crypto.randomUUID()}`;
        let rec = this.meteredSessionRecords.get(sessionId);
        if (!rec) {
          rec = { sessionId, participant: ev.participant || null, stream: new MediaStream() };
          this.meteredSessionRecords.set(sessionId, rec);
        } else if (ev.participant) {
          rec.participant = ev.participant;
        }

        const triggerRebuild = () => this._rebuildMeteredRemoteStreams();
        for (const tr of incomingTracks) {
          if (tr.kind === 'video') {
            rec.stream.getVideoTracks().forEach((old) => {
              if (old.id !== tr.id) rec.stream.removeTrack(old);
            });
          } else if (tr.kind === 'audio') {
            rec.stream.getAudioTracks().forEach((old) => {
              if (old.id !== tr.id) rec.stream.removeTrack(old);
            });
          }
          if (!rec.stream.getTracks().some((t) => t.id === tr.id)) {
            rec.stream.addTrack(tr);
          }
          tr.onunmute = triggerRebuild;
          tr.onmute = triggerRebuild;
          tr.onended = () => {
            rec.stream.removeTrack(tr);
            triggerRebuild();
          };
        }

        triggerRebuild();
      });

      meeting.on('remoteTrackStopped', (ev) => {
        const sessionId = ev?.participantSessionId || ev?.participant?._id || null;
        const rec = sessionId ? this.meteredSessionRecords.get(sessionId) : null;
        if (!rec) return;
        if (ev.type === 'video') {
          rec.stream.getVideoTracks().forEach((t) => rec.stream.removeTrack(t));
        } else if (ev.type === 'audio') {
          rec.stream.getAudioTracks().forEach((t) => rec.stream.removeTrack(t));
        }
        this._rebuildMeteredRemoteStreams();
      });

      meeting.on('activeSpeaker', (sp) => {
        const resolved = this._resolveMeteredPeerId(undefined, sp?.participantSessionId) || sp?.externalUserId;
        if (!resolved) return;
        this._emit({ speakingIds: { ...this.state.speakingIds, [resolved]: true } });
        window.setTimeout(() => {
          this._emit({ speakingIds: { ...this.state.speakingIds, [resolved]: false } });
        }, 700);
      });

      meeting.on('chatMessageReceived', (m) => {
        if (!m?.text) return;
        const senderId =
          m.sender?.externalUserId ||
          this._resolveMeteredPeerId(undefined, m.sender?._id || m.participantSessionId) ||
          m.sender?._id ||
          'remote';
        if (senderId === this.peerId) return;
        const senderName =
          m.sender?.name ||
          m.participantName ||
          this.state.peers.find((p) => p.peerId === senderId)?.name ||
          'Participante';
        this._appendMessageUnique({
          id: m._id || crypto.randomUUID(),
          roomCode: session.roomName || '',
          fromPeerId: senderId,
          fromName: senderName,
          toPeerId: null,
          text: m.text,
          timestamp: m.createdAt ? new Date(m.createdAt).getTime() || Date.now() : Date.now(),
        });
      });

      meeting.on('chatTyping', (tp) => {
        const resolvedId = tp?.externalUserId || this._resolveMeteredPeerId(undefined, tp?.participantSessionId);
        if (!resolvedId || resolvedId === this.peerId) return;
        const name =
          tp?.participantName ||
          tp?.name ||
          this.state.peers.find((p) => p.peerId === resolvedId)?.name ||
          'Alguien';
        this._registerTypingPeer(resolvedId, name, true, null);
      });

      meeting.on('stateChanged', (stateArg) => {
        const st = String(stateArg || '').toLowerCase();
        if (st.includes('lost')) {
          this._emit({ weakConnection: true });
        } else if (st.includes('restored') || st.includes('joined')) {
          this._emit({ weakConnection: false });
        }
      });

      meeting.on('meetingEnded', () => {
        if (!this.manualLeave) {
          this._emit({ status: 'ended' });
        }
      });

      const joinedInfo = await meeting.join({
        roomURL: session.roomURL,
        name: this.joinConfig?.name || this.state.self?.name || 'Invitado',
        accessToken: session.accessToken,
      });

      syncParticipantDirectory(joinedInfo?.onlineParticipants || [], true);
      this.meteredJoined = true;

      const camStream = this.state.localStream;
      if (camStream) {
        if (camStream.getAudioTracks().length > 0 && typeof meeting.shareCustomAudio === 'function') {
          try {
            await meeting.shareCustomAudio(new MediaStream(camStream.getAudioTracks()));
            if (!this.state.self?.micOn && typeof meeting.muteLocalAudio === 'function') {
              meeting.muteLocalAudio();
            }
          } catch {
            // fallback to default audio if custom share rejects
          }
        }
        const videoTrack = camStream.getVideoTracks()[0];
        if (videoTrack) {
          await videoTrack
            .applyConstraints(
              initialQuality === '720p'
                ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
                : { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 24 } },
            )
            .catch(() => {});
          let videoShared = false;
          if (typeof meeting.shareCustomVideoTrack === 'function') {
            try {
              await meeting.shareCustomVideoTrack(videoTrack);
              videoShared = true;
            } catch {
              videoShared = false;
            }
          }
          if (!videoShared && typeof meeting.shareCustomVideoStream === 'function') {
            try {
              await meeting.shareCustomVideoStream(new MediaStream([videoTrack]));
              videoShared = true;
            } catch {
              videoShared = false;
            }
          }
          if (!videoShared && typeof meeting.startVideo === 'function') {
            await meeting.startVideo().catch(() => {});
          }
          if (!this.state.self?.camOn && typeof meeting.pauseLocalVideo === 'function') {
            meeting.pauseLocalVideo();
          }
        }
      }
    } catch (err) {
      console.error('Metered SFU connect error:', err);
      this._emit({ mediaNotice: 'Reconectando transmisión SFU...' });
    } finally {
      this.meteredJoining = false;
    }
  }

  _getIceServers() {
    const merged = [...BASE_STUN_SERVERS];
    const seen = new Set(merged.map((s) => JSON.stringify(s)));
    const extraLists = [
      Array.isArray(this.runtimeIceServers) ? this.runtimeIceServers : [],
      typeof window !== 'undefined' && Array.isArray(window.__SPACESUITE_ICE_SERVERS__)
        ? window.__SPACESUITE_ICE_SERVERS__
        : [],
    ];
    for (const list of extraLists) {
      for (const item of list) {
        if (!item || !item.urls) continue;
        const urlsStr = Array.isArray(item.urls) ? item.urls.join(',') : String(item.urls);
        if (/turns?:/i.test(urlsStr) && (!item.username || !item.credential)) {
          continue;
        }
        const normalized = {
          urls: item.urls,
          ...(item.username ? { username: String(item.username) } : {}),
          ...(item.credential ? { credential: String(item.credential) } : {}),
        };
        const key = JSON.stringify(normalized);
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(normalized);
        }
      }
    }
    return merged;
  }

  _enqueueIceCandidate(remotePeerId, candidate) {
    if (!remotePeerId || !candidate) return;
    let queue = this.iceCandidateQueues.get(remotePeerId);
    if (!queue) {
      queue = [];
      this.iceCandidateQueues.set(remotePeerId, queue);
    }
    queue.push(candidate);
  }

  async _flushIceCandidateQueue(remotePeerId) {
    const entry = this.connections.get(remotePeerId);
    const queue = this.iceCandidateQueues.get(remotePeerId);
    if (!entry || !entry.pc.remoteDescription || !queue || queue.length === 0) return;
    this.iceCandidateQueues.set(remotePeerId, []);
    for (const candidate of queue) {
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch {
        // ignore stale ICE candidate
      }
    }
  }

  _clearIceRestartTimer(remotePeerId) {
    const timer = this.iceRestartTimers.get(remotePeerId);
    if (timer) {
      window.clearTimeout(timer);
      this.iceRestartTimers.delete(remotePeerId);
    }
  }

  _scheduleIceRestart(remotePeerId, immediate = false) {
    if (this._destroyed || this.manualLeave || this.state.status !== 'connected') return;
    const entry = this.connections.get(remotePeerId);
    if (!entry) return;
    if (immediate) {
      this._clearIceRestartTimer(remotePeerId);
      this._performIceRestart(remotePeerId);
      return;
    }
    if (this.iceRestartTimers.has(remotePeerId)) return;
    const timer = window.setTimeout(() => {
      this.iceRestartTimers.delete(remotePeerId);
      const currentEntry = this.connections.get(remotePeerId);
      if (!currentEntry) return;
      const iceSt = currentEntry.pc.iceConnectionState;
      const connSt = currentEntry.pc.connectionState;
      if (iceSt === 'disconnected' || iceSt === 'failed' || connSt === 'disconnected' || connSt === 'failed') {
        this._performIceRestart(remotePeerId);
      }
    }, 2200);
    this.iceRestartTimers.set(remotePeerId, timer);
  }

  async _performIceRestart(remotePeerId) {
    if (this._destroyed || this.manualLeave || this.state.status !== 'connected') return;
    const entry = this.connections.get(remotePeerId);
    if (!entry || entry.makingOffer) return;
    const now = Date.now();
    const lastRestart = this.iceRestartCooldowns.get(remotePeerId) || 0;
    if (now - lastRestart < 4500) return;
    this.iceRestartCooldowns.set(remotePeerId, now);

    try {
      entry.makingOffer = true;
      if (typeof entry.pc.restartIce === 'function') {
        entry.pc.restartIce();
      }
      const offer = await entry.pc.createOffer({ iceRestart: true });
      await entry.pc.setLocalDescription(offer);
      if (entry.pc.localDescription) {
        this._sendSignal({
          type: 'webrtc:offer',
          to: remotePeerId,
          sdp: entry.pc.localDescription.toJSON(),
        });
      }
    } catch {
      // ignore ICE restart contention
    } finally {
      entry.makingOffer = false;
    }
  }

  _closePeerConnection(remotePeerId) {
    this._clearIceRestartTimer(remotePeerId);
    this.iceCandidateQueues.delete(remotePeerId);
    this.iceRestartCooldowns.delete(remotePeerId);
    const dc = this.dataChannels.get(remotePeerId);
    if (dc) {
      try { dc.close(); } catch (_) {}
      this.dataChannels.delete(remotePeerId);
    }
    const entry = this.connections.get(remotePeerId);
    if (entry) {
      entry.pc.onicecandidate = null;
      entry.pc.ontrack = null;
      entry.pc.onnegotiationneeded = null;
      entry.pc.oniceconnectionstatechange = null;
      entry.pc.onconnectionstatechange = null;
      entry.pc.close();
      this.connections.delete(remotePeerId);
    }
    this._detachAnalyser(remotePeerId);
    if (this.state.remoteStreams[remotePeerId]) {
      const next = { ...this.state.remoteStreams };
      delete next[remotePeerId];
      this._emit({ remoteStreams: next });
    }
    this._refreshWeakConnection();
  }

  _closeAllConnections() {
    for (const timer of this.iceRestartTimers.values()) {
      window.clearTimeout(timer);
    }
    this.iceRestartTimers.clear();
    this.iceCandidateQueues.clear();
    this.iceRestartCooldowns.clear();
    for (const pid of Array.from(this.connections.keys())) {
      this._closePeerConnection(pid);
    }
    for (const dc of this.dataChannels.values()) {
      try { dc.close(); } catch (_) {}
    }
    this.dataChannels.clear();
    this._closeMeteredMeeting();
    this._emit({ remoteStreams: {}, weakConnection: false });
  }

  _setupDataChannel(remotePeerId, channel) {
    if (!channel) return;
    this.dataChannels.set(remotePeerId, channel);
    channel.onclose = () => {
      this.dataChannels.delete(remotePeerId);
    };
    channel.onerror = () => {
      this.dataChannels.delete(remotePeerId);
    };
    channel.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'chat:message' && data.message) {
          this._appendMessageUnique(data.message);
        } else if (data.type === 'peer:name_updated' && data.peerId && data.name) {
          this._emit({
            peers: this.state.peers.map((p) =>
              p.peerId === data.peerId
                ? { ...p, name: data.name, initial: data.initial || data.name[0]?.toUpperCase() || 'S' }
                : p,
            ),
          });
        } else if (data.type === 'chat:typing') {
          this._registerTypingPeer(data.peerId, data.name, data.isTyping, data.toPeerId);
        }
      } catch {
        // ignore malformed frame
      }
    };
  }

  _createPeerConnection(remotePeerId, initiateOffer) {
    const existing = this.connections.get(remotePeerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({
      iceServers: this._getIceServers(),
      iceCandidatePoolSize: 4,
      bundlePolicy: 'max-bundle',
    });
    const remoteStream = new MediaStream();
    const entry = {
      pc,
      makingOffer: false,
      ignoreOffer: false,
      canNegotiate: Boolean(initiateOffer),
      stream: remoteStream,
    };
    this.connections.set(remotePeerId, entry);

    if (initiateOffer) {
      try {
        const dc = pc.createDataChannel('spacesuite-chat', { ordered: true });
        this._setupDataChannel(remotePeerId, dc);
      } catch {
        // ignore
      }
    }
    pc.ondatachannel = (ev) => {
      if (ev.channel) {
        this._setupDataChannel(remotePeerId, ev.channel);
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this._sendSignal({
          type: 'webrtc:ice',
          to: remotePeerId,
          candidate: candidate.toJSON(),
        });
      }
    };

    pc.ontrack = ({ track, streams }) => {
      const incoming = streams?.[0]?.getTracks?.() || [];
      const toAttach = incoming.length > 0 ? incoming : [track];
      for (const tr of toAttach) {
        if (!tr) continue;
        if (tr.kind === 'video') {
          entry.stream.getVideoTracks().forEach((old) => {
            if (old.id !== tr.id) entry.stream.removeTrack(old);
          });
        }
        if (!entry.stream.getTracks().some((t) => t.id === tr.id)) {
          entry.stream.addTrack(tr);
        }
      }
      if (track.kind === 'audio') {
        this._attachAudioAnalyser(remotePeerId, entry.stream);
      }
      const emitUpdatedStream = () => {
        this._emit({
          remoteStreams: {
            ...this.state.remoteStreams,
            [remotePeerId]: new MediaStream(entry.stream.getTracks()),
          },
        });
      };
      track.onended = () => {
        entry.stream.removeTrack(track);
        emitUpdatedStream();
      };
      track.onunmute = emitUpdatedStream;
      track.onmute = emitUpdatedStream;
      emitUpdatedStream();
    };

    const handleIceTransition = () => {
      const iceSt = pc.iceConnectionState;
      const connSt = pc.connectionState;
      if (iceSt === 'connected' || iceSt === 'completed' || connSt === 'connected') {
        this._clearIceRestartTimer(remotePeerId);
      } else if (iceSt === 'failed' || connSt === 'failed') {
        this._scheduleIceRestart(remotePeerId, true);
      } else if (iceSt === 'disconnected' || connSt === 'disconnected') {
        this._scheduleIceRestart(remotePeerId, false);
      }
      this._refreshWeakConnection();
    };

    pc.oniceconnectionstatechange = handleIceTransition;
    pc.onconnectionstatechange = handleIceTransition;

    pc.onnegotiationneeded = async () => {
      if (!entry.canNegotiate || entry.makingOffer || pc.signalingState !== 'stable') return;
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) {
          this._sendSignal({
            type: 'webrtc:offer',
            to: remotePeerId,
            sdp: pc.localDescription.toJSON(),
          });
        }
      } catch {
        // ignore
      } finally {
        entry.makingOffer = false;
      }
    };

    const camStream = this.state.localStream;
    const scrStream = this.state.screenStream;

    if (camStream) {
      for (const audioTrack of camStream.getAudioTracks()) {
        pc.addTrack(audioTrack, camStream);
      }
    }

    const activeVideoTrack =
      scrStream?.getVideoTracks()[0] || camStream?.getVideoTracks()[0] || null;
    if (activeVideoTrack) {
      const ownerStream = scrStream?.getVideoTracks()[0] ? scrStream : camStream;
      pc.addTrack(activeVideoTrack, ownerStream);
    }

    if (initiateOffer && !camStream && !scrStream) {
      pc.addTransceiver('audio', { direction: 'recvonly' });
      pc.addTransceiver('video', { direction: 'recvonly' });
    }

    return entry;
  }

  async _acquireLocalMedia(wantMic, wantCam, facingMode = 'user') {
    if (!navigator.mediaDevices?.getUserMedia) {
      return { stream: null, mic: false, cam: false };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: {
          facingMode: { ideal: facingMode === 'environment' ? 'environment' : 'user' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      stream.getAudioTracks().forEach((t) => {
        t.enabled = wantMic;
      });
      stream.getVideoTracks().forEach((t) => {
        t.enabled = wantCam;
      });
      this._emit({ mediaNotice: null });
      return { stream, mic: wantMic, cam: wantCam };
    } catch {
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
        audioOnly.getAudioTracks().forEach((t) => {
          t.enabled = wantMic;
        });
        return { stream: audioOnly, mic: wantMic, cam: false };
      } catch {
        return { stream: null, mic: false, cam: false };
      }
    }
  }

  _stopRoomPolling() {
    this.pollActive = false;
    if (this.pollTimer) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async _handleRoomEvents(events) {
    for (const ev of events) {
      if (ev.eventType === 'room:rejected') {
        this.manualLeave = true;
        this._stopRoomPolling();
        this._closeAllConnections();
        this._emit({
          rejectionMessage: String(ev.payload?.message || 'La sala fue cerrada.'),
          status: 'rejected',
        });
        return;
      }

      if (ev.eventType === 'peer:name_updated' && ev.payload?.peerId && ev.payload?.name) {
        const { peerId: pid, name, initial } = ev.payload;
        this._emit({
          peers: this.state.peers.map((p) =>
            p.peerId === pid ? { ...p, name, initial: initial || name[0]?.toUpperCase() || 'S' } : p,
          ),
        });
        continue;
      }

      if (ev.eventType === 'chat:message' && ev.payload?.message) {
        this._appendMessageUnique(ev.payload.message);
        continue;
      }

      if (ev.eventType === 'chat:typing') {
        this._registerTypingPeer(
          String(ev.payload?.peerId || ''),
          String(ev.payload?.name || 'Participante'),
          Boolean(ev.payload?.isTyping),
          ev.payload?.toPeerId || null,
        );
        continue;
      }

      if (ev.eventType === 'wave:received' && ev.payload?.wave) {
        this._emit({ lastWave: ev.payload.wave });
        continue;
      }

      if (ev.eventType === 'reaction:received' && ev.payload?.reaction) {
        this._emit({ lastReaction: ev.payload.reaction });
        continue;
      }

      if (ev.eventType === 'subtitle:received' && ev.payload?.subtitle) {
        this._emit({ lastSubtitle: ev.payload.subtitle });
        continue;
      }

      if (ev.eventType === 'host:mute') {
        if (this.state.localStream) {
          this.state.localStream.getAudioTracks().forEach((t) => {
            t.enabled = false;
          });
        }
        if (this.meteredMeeting && this.meteredJoined && typeof this.meteredMeeting.muteLocalAudio === 'function') {
          this.meteredMeeting.muteLocalAudio();
        }
        this._emit({
          self: this.state.self ? { ...this.state.self, micOn: false } : null,
          peers: this.state.peers.map((p) => (p.peerId === this.peerId ? { ...p, micOn: false } : p)),
          hostMuteNotice: `${String(ev.payload?.byName || 'En la Suite')} silenció tu micrófono.`,
        });
        continue;
      }

      if (this.state.sfuMode === 'metered-sfu') continue;

      if (ev.eventType === 'webrtc:offer') {
        const from = String(ev.payload?.from || '');
        const sdp = ev.payload?.sdp;
        if (!from || !sdp) continue;
        const entry = this._createPeerConnection(from, false);
        const polite = this.peerId > from;
        const offerCollision = entry.makingOffer || entry.pc.signalingState !== 'stable';
        entry.ignoreOffer = !polite && offerCollision;
        if (entry.ignoreOffer) continue;
        try {
          entry.canNegotiate = true;
          await entry.pc.setRemoteDescription(sdp);
          await this._flushIceCandidateQueue(from);
          await entry.pc.setLocalDescription();
          if (entry.pc.localDescription) {
            this._sendSignal({
              type: 'webrtc:answer',
              to: from,
              sdp: entry.pc.localDescription.toJSON(),
            });
          }
        } catch {
          // ignore
        }
        continue;
      }

      if (ev.eventType === 'webrtc:answer') {
        const from = String(ev.payload?.from || '');
        const sdp = ev.payload?.sdp;
        const entry = this.connections.get(from);
        if (!entry || !sdp) continue;
        try {
          entry.canNegotiate = true;
          await entry.pc.setRemoteDescription(sdp);
          await this._flushIceCandidateQueue(from);
        } catch {
          // ignore
        }
        continue;
      }

      if (ev.eventType === 'webrtc:ice') {
        const from = String(ev.payload?.from || '');
        const candidate = ev.payload?.candidate;
        if (!from || !candidate) continue;
        this._enqueueIceCandidate(from, candidate);
        await this._flushIceCandidateQueue(from);
      }
    }
  }

  _reconcilePeers(incomingPeers) {
    const incomingIds = new Set(incomingPeers.map((p) => p.peerId));
    for (const old of this.state.peers) {
      if (!incomingIds.has(old.peerId)) {
        this._closePeerConnection(old.peerId);
      }
    }

    const incomingById = new Map(incomingPeers.map((p) => [p.peerId, p]));
    const orderedExisting = this.state.peers
      .filter((p) => incomingById.has(p.peerId))
      .map((p) => incomingById.get(p.peerId));
    const existingIds = new Set(orderedExisting.map((p) => p.peerId));
    const added = incomingPeers.filter((p) => !existingIds.has(p.peerId));
    const nextPeers = [...orderedExisting, ...added];

    const nextTyping = this.state.typingPeers.filter((tp) => incomingIds.has(tp.peerId));
    this._emit({ peers: nextPeers, typingPeers: nextTyping });
    this._applyAdaptiveQuality();

    if (this.state.status === 'connected' && this.state.sfuMode === 'metered-sfu') {
      if (this.meteredSessionRecords.size > 0) {
        this._rebuildMeteredRemoteStreams();
      }
    } else if (this.state.status === 'connected') {
      for (const remote of incomingPeers) {
        if (remote.peerId === this.peerId) continue;
        if (!this.connections.has(remote.peerId)) {
          this._createPeerConnection(remote.peerId, this.peerId < remote.peerId);
        }
      }
    }
  }

  async _startMediaTransportOnAdmit(peersToConnect = []) {
    if (this._destroyed || this.manualLeave || this.state.status !== 'connected') return;
    try {
      const res = await fetch('/api/metered/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomCode: this.roomCode,
          peerId: this.peerId,
          name: this.joinConfig?.name || this.state.self?.name || 'Invitado',
          isAdmin: Boolean(this.joinConfig?.wantHost),
        }),
      });
      const sessionJson = await res.json().catch(() => null);
      if (sessionJson && Array.isArray(sessionJson.iceServers)) {
        this.runtimeIceServers = sessionJson.iceServers;
      }
      if (!res.ok || !sessionJson || sessionJson.ok === false) {
        this.meteredSession = null;
        this._emit({ sfuMode: 'p2p-fallback' });
      } else {
        this.meteredSession = sessionJson;
        this._emit({
          roomCapacity: sessionJson.maxParticipants || ROOM_CAPACITY,
          sfuMode: sessionJson.configured ? 'metered-sfu' : 'p2p-fallback',
        });
      }
    } catch {
      this.meteredSession = null;
      this._emit({ sfuMode: 'p2p-fallback' });
    }

    if (this._destroyed || this.manualLeave || this.state.status !== 'connected') return;

    if (this.state.sfuMode === 'metered-sfu') {
      this._connectMeteredSFU();
    } else {
      const list = Array.isArray(peersToConnect) && peersToConnect.length > 0 ? peersToConnect : this.state.peers;
      for (const remote of list) {
        if (remote.peerId === this.peerId) continue;
        if (!this.connections.has(remote.peerId)) {
          this._createPeerConnection(remote.peerId, this.peerId < remote.peerId);
        }
      }
    }
  }

  _schedulePoll(code) {
    if (!this.pollActive || this.manualLeave || this._destroyed) return;
    if (this.pollTimer) window.clearTimeout(this.pollTimer);
    const intervalMs =
      this.state.status === 'waiting' || this.state.sfuMode === 'p2p-fallback' ? 850 : 1600;

    this.pollTimer = window.setTimeout(async () => {
      if (!this.pollActive || this.manualLeave || this.roomCode !== code || this._destroyed) return;
      try {
        const url = `/api/room/${encodeURIComponent(code)}?poll=1&peerId=${encodeURIComponent(this.peerId)}&afterEventId=${this.lastEventId}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (typeof data.lastEventId === 'number' && data.lastEventId > this.lastEventId) {
            this.lastEventId = data.lastEventId;
          }
          if (data.ended || data.rejected) {
            this.manualLeave = true;
            this._stopRoomPolling();
            this._closeAllConnections();
            this._emit({
              rejectionMessage: data.rejection?.message || 'La sala fue cerrada.',
              status: 'rejected',
            });
            return;
          }
          if (Array.isArray(data.events) && data.events.length > 0) {
            await this._handleRoomEvents(data.events);
            if (this.manualLeave) return;
          }
          if (data.inRoom) {
            const justAdmitted = data.status === 'connected' && this.state.status === 'waiting';
            const patch = {};
            if (justAdmitted) patch.status = 'connected';
            if (data.self) patch.self = data.self;
            if (data.meta) patch.meta = data.meta;
            if (Array.isArray(data.waiting)) patch.waiting = data.waiting;
            if (Object.keys(patch).length > 0) this._emit(patch);
            if (Array.isArray(data.messages)) {
              for (const m of data.messages) this._appendMessageUnique(m);
            }
            if (justAdmitted) {
              await this._startMediaTransportOnAdmit(Array.isArray(data.peers) ? data.peers : []);
            }
            if (Array.isArray(data.peers)) this._reconcilePeers(data.peers);
          }
        }
      } catch {
        // retry next tick
      }
      this._schedulePoll(code);
    }, intervalMs);
  }

  async _connectRoomChannel(joinPayload) {
    this._stopRoomPolling();
    this.roomCode = joinPayload.roomCode;
    this.lastEventId = 0;

    try {
      const res = await fetch(`/api/room/${encodeURIComponent(joinPayload.roomCode)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'room:join',
          roomCode: joinPayload.roomCode,
          pass: joinPayload.pass,
          peerId: this.peerId,
          clientId: this.clientId,
          name: joinPayload.name,
          micOn: joinPayload.micOn,
          camOn: joinPayload.camOn,
          wantHost: joinPayload.wantHost,
          suiteProfile: joinPayload.suiteProfile || undefined,
        }),
      });
      const msg = await res.json();
      if (typeof msg.lastEventId === 'number') this.lastEventId = msg.lastEventId;

      if (msg.type === 'room:waiting') {
        this._emit({
          status: 'waiting',
          ...(msg.meta ? { meta: msg.meta } : {}),
        });
        this.pollActive = true;
        this._schedulePoll(joinPayload.roomCode);
        return;
      }
      if (msg.type === 'room:rejected') {
        this.manualLeave = true;
        this._stopRoomPolling();
        this._closeAllConnections();
        this._emit({
          rejectionMessage: msg.message || 'No fue posible entrar a la sala.',
          status: 'rejected',
        });
        return;
      }
      if (msg.type === 'room:joined' && msg.self) {
        this.reconnectAttempts = 0;
        const initialPeers = Array.isArray(msg.peers) ? msg.peers : [msg.self];
        this._emit({
          self: msg.self,
          peers: initialPeers,
          waiting: Array.isArray(msg.waiting) ? msg.waiting : [],
          messages: Array.isArray(msg.messages) ? msg.messages : [],
          meta: msg.meta || null,
          status: 'connected',
        });
        this._applyAdaptiveQuality();

        await this._startMediaTransportOnAdmit(initialPeers);

        this.pollActive = true;
        this._schedulePoll(joinPayload.roomCode);
      }
    } catch {
      if (!this.manualLeave) {
        const attempt = Math.min(5, this.reconnectAttempts + 1);
        this.reconnectAttempts = attempt;
        const delay = Math.min(8000, 700 * 2 ** (attempt - 1));
        this.reconnectTimer = window.setTimeout(() => {
          if (!this.manualLeave && this.joinConfig) {
            this._connectRoomChannel(this.joinConfig);
          }
        }, delay);
      }
    }
  }

  async joinRoom(opts) {
    this.manualLeave = false;
    this._emit({ rejectionMessage: '', mediaNotice: null, status: 'joining' });

    if (!opts.camOn && opts.requireMedia) {
      this._emit({ mediaNotice: 'Enciende tu cámara para unirte a la sala', status: 'idle' });
      return false;
    }

    let media;
    const pre = opts.precheckedStream;
    const requestedFacing = opts.facingMode === 'environment' ? 'environment' : 'user';
    if (pre && pre.getTracks().some((t) => t.readyState === 'live')) {
      pre.getAudioTracks().forEach((t) => {
        t.enabled = opts.micOn;
      });
      pre.getVideoTracks().forEach((t) => {
        t.enabled = Boolean(opts.camOn);
      });
      const hasLivePreCam = pre.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled);
      media = { stream: pre, mic: opts.micOn, cam: Boolean(opts.camOn && hasLivePreCam) };
    } else {
      media = await this._acquireLocalMedia(opts.micOn, opts.camOn, requestedFacing);
    }

    const hasVideo = Boolean(
      media.stream?.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled),
    );
    if (opts.requireMedia && !hasVideo) {
      if (media.stream && media.stream !== opts.precheckedStream) {
        media.stream.getTracks().forEach((t) => t.stop());
      }
      this._emit({ mediaNotice: 'Enciende tu cámara para unirte a la sala', status: 'idle' });
      return false;
    }

    this._emit({ localStream: media.stream, facingMode: requestedFacing });
    if (media.stream) {
      this._attachAudioAnalyser('local', media.stream);
    }

    this.joinConfig = {
      roomCode: opts.roomCode,
      pass: opts.pass,
      name: opts.name,
      micOn: media.mic,
      camOn: media.cam,
      wantHost: opts.wantHost,
      suiteProfile: opts.suiteProfile || null,
    };
    await this._connectRoomChannel(this.joinConfig);
    return true;
  }

  leaveRoom() {
    this.manualLeave = true;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._stopRoomPolling();
    this._sendSignal({ type: 'room:leave' });
    this.roomCode = '';
    this._closeAllConnections();
    this._detachAnalyser('local');
    if (this.state.localStream) {
      this.state.localStream.getTracks().forEach((t) => t.stop());
    }
    if (this.state.screenStream) {
      this.state.screenStream.getTracks().forEach((t) => t.stop());
    }
    this._emit({
      localStream: null,
      screenStream: null,
      peers: [],
      waiting: [],
      typingPeers: [],
      self: null,
      status: 'ended',
    });
  }

  async _replaceVideoTrackOnPeers(newTrack, ownerStream, isScreen = false) {
    if (this.state.sfuMode === 'metered-sfu' && this.meteredMeeting && this.meteredJoined) {
      if (newTrack && typeof this.meteredMeeting.shareCustomVideoTrack === 'function') {
        try {
          await this.meteredMeeting.shareCustomVideoTrack(newTrack);
        } catch {
          // ignore
        }
      }
      return;
    }

    for (const [remotePeerId, entry] of this.connections.entries()) {
      const videoTransceiver = entry.pc
        .getTransceivers()
        .find((tr) => tr.sender.track?.kind === 'video' || tr.receiver.track?.kind === 'video');
      if (videoTransceiver) {
        const wasPassive =
          videoTransceiver.direction === 'recvonly' || videoTransceiver.direction === 'inactive';
        if (newTrack && wasPassive) {
          videoTransceiver.direction = 'sendrecv';
        }
        await videoTransceiver.sender.replaceTrack(newTrack);
        if (isScreen && newTrack) {
          try {
            const params = videoTransceiver.sender.getParameters();
            if (params && 'degradationPreference' in params) {
              params.degradationPreference = 'maintain-resolution';
              await videoTransceiver.sender.setParameters(params);
            }
          } catch {
            // ignore
          }
        }
        if (wasPassive && newTrack && entry.pc.signalingState === 'stable' && !entry.makingOffer) {
          try {
            entry.makingOffer = true;
            await entry.pc.setLocalDescription();
            if (entry.pc.localDescription) {
              this._sendSignal({
                type: 'webrtc:offer',
                to: remotePeerId,
                sdp: entry.pc.localDescription.toJSON(),
              });
            }
          } catch {
            // ignore
          } finally {
            entry.makingOffer = false;
          }
        }
      } else if (newTrack && ownerStream) {
        entry.pc.addTrack(newTrack, ownerStream);
        if (entry.pc.signalingState === 'stable' && !entry.makingOffer) {
          try {
            entry.makingOffer = true;
            await entry.pc.setLocalDescription();
            if (entry.pc.localDescription) {
              this._sendSignal({
                type: 'webrtc:offer',
                to: remotePeerId,
                sdp: entry.pc.localDescription.toJSON(),
              });
            }
          } catch {
            // ignore
          } finally {
            entry.makingOffer = false;
          }
        }
      }
    }
  }

  async toggleMic() {
    const current = this.state.self;
    if (!current) return;
    const nextMic = !current.micOn;

    if (nextMic && (!this.state.localStream || this.state.localStream.getAudioTracks().length === 0)) {
      const media = await this._acquireLocalMedia(true, current.camOn);
      if (!media.stream) return;
      this._emit({ localStream: media.stream });
      this._attachAudioAnalyser('local', media.stream);
      if (this.state.sfuMode === 'metered-sfu' && this.meteredMeeting && this.meteredJoined) {
        if (typeof this.meteredMeeting.shareCustomAudio === 'function') {
          await this.meteredMeeting.shareCustomAudio(media.stream).catch(() => {});
        }
      } else {
        for (const entry of this.connections.values()) {
          for (const track of media.stream.getTracks()) {
            const existing = entry.pc.getSenders().find((s) => s.track?.kind === track.kind);
            if (existing) await existing.replaceTrack(track);
            else entry.pc.addTrack(track, media.stream);
          }
        }
      }
    } else if (this.state.localStream) {
      this.state.localStream.getAudioTracks().forEach((t) => {
        t.enabled = nextMic;
      });
      if (this.state.sfuMode === 'metered-sfu' && this.meteredMeeting && this.meteredJoined) {
        if (nextMic && typeof this.meteredMeeting.unmuteLocalAudio === 'function') {
          this.meteredMeeting.unmuteLocalAudio();
        } else if (!nextMic && typeof this.meteredMeeting.muteLocalAudio === 'function') {
          this.meteredMeeting.muteLocalAudio();
        }
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
    const nextCam = !current.camOn;

    if (nextCam && (!this.state.localStream || this.state.localStream.getVideoTracks().length === 0)) {
      try {
        const target = this.currentQuality === '720p' ? { w: 1280, h: 720 } : { w: 960, h: 540 };
        const camOnly = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: target.w }, height: { ideal: target.h }, facingMode: this.state.facingMode || 'user' },
        });
        const newTrack = camOnly.getVideoTracks()[0];
        let nextStream;
        if (!this.state.localStream) {
          nextStream = camOnly;
        } else {
          this.state.localStream.addTrack(newTrack);
          nextStream = new MediaStream(this.state.localStream.getTracks());
        }
        this._emit({ localStream: nextStream, mediaNotice: null });
        if (!this.state.screenStream) {
          await this._replaceVideoTrackOnPeers(newTrack, nextStream, false);
        }
      } catch {
        this._emit({ mediaNotice: 'No se pudo activar la cámara en este dispositivo.' });
        return;
      }
    } else if (this.state.localStream) {
      this.state.localStream.getVideoTracks().forEach((t) => {
        t.enabled = nextCam;
      });
      if (this.state.sfuMode === 'metered-sfu' && this.meteredMeeting && this.meteredJoined) {
        if (nextCam && typeof this.meteredMeeting.resumeLocalVideo === 'function') {
          this.meteredMeeting.resumeLocalVideo();
        } else if (!nextCam && typeof this.meteredMeeting.pauseLocalVideo === 'function') {
          this.meteredMeeting.pauseLocalVideo();
        }
      }
    }

    this._emit({
      self: { ...current, camOn: nextCam },
      peers: this.state.peers.map((p) => (p.peerId === this.peerId ? { ...p, camOn: nextCam } : p)),
    });
    this._sendSignal({ type: 'peer:state', patch: { camOn: nextCam } });
  }

  async stopScreenShare() {
    if (this.state.screenStream) {
      this.state.screenStream.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
    }
    this._emit({ screenStream: null });

    let camTrack = this.state.localStream?.getVideoTracks().find((t) => t.readyState === 'live') || null;
    if (!camTrack && this.state.self?.camOn && navigator.mediaDevices?.getUserMedia) {
      try {
        const target = this.currentQuality === '720p' ? { w: 1280, h: 720 } : { w: 960, h: 540 };
        const camOnly = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: target.w }, height: { ideal: target.h }, facingMode: this.state.facingMode || 'user' },
        });
        camTrack = camOnly.getVideoTracks()[0] || null;
        if (camTrack) {
          if (!this.state.localStream) {
            this._emit({ localStream: camOnly });
          } else {
            this.state.localStream.getVideoTracks().forEach((old) => {
              this.state.localStream.removeTrack(old);
            });
            this.state.localStream.addTrack(camTrack);
            this._emit({ localStream: new MediaStream(this.state.localStream.getTracks()) });
          }
        }
      } catch {
        // ignore
      }
    }
    if (camTrack) {
      camTrack.enabled = Boolean(this.state.self?.camOn);
    }

    await this._replaceVideoTrackOnPeers(camTrack, this.state.localStream, false);
    this._emit({
      self: this.state.self ? { ...this.state.self, screenSharing: false } : null,
      peers: this.state.peers.map((p) =>
        p.peerId === this.peerId ? { ...p, screenSharing: false } : p,
      ),
    });
    this._sendSignal({ type: 'peer:state', patch: { screenSharing: false } });
  }

  async toggleScreenShare() {
    if (this.screenBusy) return;
    this.screenBusy = true;
    try {
      if (this.state.screenStream) {
        await this.stopScreenShare();
        return;
      }
      if (!navigator.mediaDevices?.getDisplayMedia) {
        this._emit({ mediaNotice: 'Tu navegador no permite compartir pantalla.' });
        return;
      }
      let displayStream;
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch (err) {
        const errName = err instanceof DOMException ? err.name : '';
        if (errName === 'OverconstrainedError') {
          displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        } else {
          if (errName === 'NotSupportedError') {
            this._emit({ mediaNotice: 'Este navegador no soporta compartir pantalla.' });
          }
          return;
        }
      }
      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) return;
      if ('contentHint' in screenTrack) screenTrack.contentHint = 'detail';
      screenTrack.onended = () => {
        this.stopScreenShare().catch(() => {});
      };
      this._emit({ screenStream: displayStream });
      await this._replaceVideoTrackOnPeers(screenTrack, displayStream, true);
      this._emit({
        self: this.state.self ? { ...this.state.self, screenSharing: true } : null,
        peers: this.state.peers.map((p) =>
          p.peerId === this.peerId ? { ...p, screenSharing: true } : p,
        ),
      });
      this._sendSignal({ type: 'peer:state', patch: { screenSharing: true } });
    } finally {
      this.screenBusy = false;
    }
  }

  toggleHand() {
    const current = this.state.self;
    if (!current) return;
    const nextHand = !current.handRaised;
    this._emit({
      self: { ...current, handRaised: nextHand },
      peers: this.state.peers.map((p) =>
        p.peerId === this.peerId ? { ...p, handRaised: nextHand } : p,
      ),
    });
    this._sendSignal({ type: 'peer:state', patch: { handRaised: nextHand } });
  }

  updateMyName(newName) {
    const cleanName = String(newName || '').trim().slice(0, 32);
    if (!cleanName || cleanName.length < 2) return;
    const initial = cleanName[0].toUpperCase();
    const current = this.state.self;
    if (!current) return;

    const updatedSelf = { ...current, name: cleanName, initial };
    this._emit({
      self: updatedSelf,
      peers: this.state.peers.map((p) => (p.peerId === this.peerId ? { ...p, name: cleanName, initial } : p)),
    });

    const payload = JSON.stringify({
      type: 'peer:name_updated',
      peerId: this.peerId,
      name: cleanName,
      initial,
    });
    for (const dc of this.dataChannels.values()) {
      if (dc.readyState === 'open') {
        try { dc.send(payload); } catch (_) {}
      }
    }

    if (
      this.state.sfuMode === 'metered-sfu' &&
      this.meteredMeeting &&
      this.meteredJoined &&
      typeof this.meteredMeeting.setParticipantName === 'function'
    ) {
      try { this.meteredMeeting.setParticipantName(cleanName); } catch (_) {}
    }

    this._sendSignal({
      type: 'peer:state',
      patch: { name: cleanName },
    });
  }

  sendChat(text, toPeerId = null) {
    const cleanText = String(text || '').trim().slice(0, 500);
    if (!cleanText) return;
    const msgId = crypto.randomUUID();
    const now = Date.now();
    const myName = this.state.self?.name || 'Tú';
    const myPeerId = this.peerId;

    const localMsg = {
      id: msgId,
      roomCode: this.roomCode,
      fromPeerId: myPeerId,
      fromName: myName,
      toPeerId: toPeerId || null,
      text: cleanText,
      timestamp: now,
      status: 'Enviado',
    };

    // 1. Add immediately to sender's local history (instant UX!)
    this._appendMessageUnique(localMsg);

    // 2. Broadcast via RTCDataChannels
    const wirePayload = JSON.stringify({
      type: 'chat:message',
      message: localMsg,
    });
    if (toPeerId) {
      const dc = this.dataChannels.get(toPeerId);
      if (dc && dc.readyState === 'open') {
        try { dc.send(wirePayload); } catch (_) {}
      }
    } else {
      for (const dc of this.dataChannels.values()) {
        if (dc.readyState === 'open') {
          try { dc.send(wirePayload); } catch (_) {}
        }
      }
    }

    // 3. Send via Metered SFU if active
    if (
      !toPeerId &&
      this.state.sfuMode === 'metered-sfu' &&
      this.meteredMeeting &&
      this.meteredJoined &&
      typeof this.meteredMeeting.sendChatMessage === 'function'
    ) {
      try {
        this.meteredMeeting.sendChatMessage(cleanText);
      } catch {
        // ignore
      }
    }

    // 4. Room API fallback
    this._sendSignal({
      type: 'chat:send',
      text: cleanText,
      toPeerId,
      messageId: msgId,
      timestamp: now,
    });
    this._sendSignal({ type: 'chat:typing', isTyping: false, toPeerId });
  }

  notifyTyping(isTyping, toPeerId = null) {
    const now = Date.now();
    if (isTyping && now - this.lastTypingSentAt < 1400) return;
    if (isTyping) this.lastTypingSentAt = now;
    this._sendSignal({ type: 'chat:typing', isTyping, toPeerId });
    if (
      isTyping &&
      !toPeerId &&
      this.state.sfuMode === 'metered-sfu' &&
      this.meteredMeeting &&
      this.meteredJoined &&
      typeof this.meteredMeeting.sendTypingIndicator === 'function'
    ) {
      try {
        this.meteredMeeting.sendTypingIndicator();
      } catch {
        // ignore
      }
    }
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

  updateSuiteProfile(profile) {
    this._sendSignal({
      type: 'room:interactive',
      action: 'suite:profile',
      payload: profile || {},
    });
  }

  async flipCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      this._emit({ mediaNotice: 'Tu navegador no permite cambiar de cámara.' });
      return false;
    }
    const prevFacing = this.state.facingMode === 'environment' ? 'environment' : 'user';
    const nextFacing = prevFacing === 'user' ? 'environment' : 'user';
    const target = this.currentQuality === '720p' ? { w: 1280, h: 720 } : { w: 960, h: 540 };

    let nextCamStream;
    try {
      nextCamStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: target.w },
          height: { ideal: target.h },
          facingMode: { exact: nextFacing },
        },
        audio: false,
      });
    } catch {
      try {
        nextCamStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: target.w },
            height: { ideal: target.h },
            facingMode: { ideal: nextFacing },
          },
          audio: false,
        });
      } catch {
        this._emit({ mediaNotice: 'Solo se detectó una cámara activa en este dispositivo.' });
        return false;
      }
    }

    const newTrack = nextCamStream.getVideoTracks()[0];
    if (!newTrack) {
      nextCamStream.getTracks().forEach((t) => t.stop());
      this._emit({ mediaNotice: 'No fue posible cambiar de cámara.' });
      return false;
    }

    const prevStream = this.state.localStream;
    const wantCam = Boolean(this.state.self?.camOn ?? true);
    newTrack.enabled = wantCam;

    let mergedStream;
    if (prevStream) {
      prevStream.getVideoTracks().forEach((old) => {
        prevStream.removeTrack(old);
        old.stop();
      });
      prevStream.addTrack(newTrack);
      mergedStream = new MediaStream(prevStream.getTracks());
    } else {
      mergedStream = nextCamStream;
    }

    this._emit({ localStream: mergedStream, facingMode: nextFacing, mediaNotice: null });
    if (!this.state.screenStream) {
      await this._replaceVideoTrackOnPeers(newTrack, mergedStream, false);
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
    const current = this.state.self;
    const wantMic = current ? current.micOn : true;
    const wantCam = current ? current.camOn : true;
    const media = await this._acquireLocalMedia(wantMic, wantCam);
    if (!media.stream) return;
    if (this.state.localStream) {
      this.state.localStream.getTracks().forEach((t) => t.stop());
    }
    this._emit({ localStream: media.stream, facingMode: 'user' });
    this._attachAudioAnalyser('local', media.stream);

    if (this.state.sfuMode === 'metered-sfu' && this.meteredMeeting && this.meteredJoined) {
      if (typeof this.meteredMeeting.shareCustomAudio === 'function') {
        await this.meteredMeeting.shareCustomAudio(media.stream).catch(() => {});
      }
      const vTrack = media.stream.getVideoTracks()[0];
      if (vTrack && typeof this.meteredMeeting.shareCustomVideoTrack === 'function') {
        await this.meteredMeeting.shareCustomVideoTrack(vTrack).catch(() => {});
      }
    } else {
      for (const entry of this.connections.values()) {
        for (const track of media.stream.getTracks()) {
          const sender = entry.pc.getSenders().find((s) => s.track?.kind === track.kind);
          if (sender) await sender.replaceTrack(track);
          else entry.pc.addTrack(track, media.stream);
        }
      }
    }
    this._emit({
      self: this.state.self ? { ...this.state.self, micOn: media.mic, camOn: media.cam } : null,
    });
    this._sendSignal({ type: 'peer:state', patch: { micOn: media.mic, camOn: media.cam } });
  }

  softRefresh() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    if (this.pollActive) {
      this._sendSignal({ type: 'room:sync' });
    } else if (this.joinConfig && this.state.status === 'connected') {
      this._connectRoomChannel({
        ...this.joinConfig,
        micOn: this.state.self?.micOn ?? this.joinConfig.micOn,
        camOn: this.state.self?.camOn ?? this.joinConfig.camOn,
      });
    }
    if (this.state.sfuMode === 'metered-sfu' && !this.meteredJoined) {
      this._connectMeteredSFU();
    }
    this._refreshWeakConnection();
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

  clearParticipantJoin() {
    if (this.state.lastParticipantJoin) this._emit({ lastParticipantJoin: null });
  }

  destroy() {
    this._destroyed = true;
    window.removeEventListener('pagehide', this._onPageHide);
    window.clearInterval(this._speakingInterval);
    window.clearInterval(this._typingPruneInterval);
    this.manualLeave = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this._stopRoomPolling();
    if (this.roomCode) {
      this._sendSignal({ type: 'room:leave' });
      this.roomCode = '';
    }
    this._closeAllConnections();
    if (this.state.localStream) {
      this.state.localStream.getTracks().forEach((t) => t.stop());
    }
    if (this.state.screenStream) {
      this.state.screenStream.getTracks().forEach((t) => t.stop());
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
    }
  }
}
