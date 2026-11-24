import {
  getInitial,
  jsonResponse,
  MAX_ROOM_PARTICIPANTS,
  normalizeRoomCode,
  parseJsonBody,
  type ChatMessage,
  type PagesContext,
  type PeerInfo,
  type RoomBroadcastState,
  type RoomInteractiveState,
} from '../../_shared/cf.ts';
import {
  addAuditEvent,
  addRoomMessage,
  cleanupStaleParticipants,
  getOrCreateRoomState,
  getRoomEventsAfter,
  getRoomParticipants,
  getRoomSummary,
  getVisibleRoomMessages,
  patchParticipantState,
  pushRoomEvent,
  removeParticipant,
  saveRoomMetaAndLists,
  touchParticipant,
  upsertRoomParticipant,
} from '../../_shared/store.ts';

function idleBroadcast(): RoomBroadcastState {
  return {
    emitterPeerId: null,
    emitterName: null,
    status: 'idle',
    sourceType: 'none',
    mediaTitle: null,
    callsSessionId: null,
    videoTrackName: null,
    audioTrackName: null,
    updatedAt: Date.now(),
  };
}

export async function onRequestGet(context: PagesContext<{ code?: string }>): Promise<Response> {
  const code = normalizeRoomCode(context.params.code || '');
  const url = new URL(context.request.url);
  const poll = url.searchParams.get('poll') === '1';

  if (!poll) {
    const summary = await getRoomSummary(context.env, code);
    return jsonResponse(summary);
  }

  const peerId = (url.searchParams.get('peerId') || '').trim();
  const afterEventId = Math.max(0, Number(url.searchParams.get('afterEventId') || '0') || 0);
  if (!peerId) {
    return jsonResponse({ ok: false, error: 'peerId requerido' }, 400);
  }

  await cleanupStaleParticipants(context.env, code);
  const state = await getOrCreateRoomState(context.env, code);

  if (state.ended) {
    const { events, lastEventId } = await getRoomEventsAfter(context.env, code, peerId, afterEventId);
    return jsonResponse({
      ok: true,
      ended: true,
      events,
      lastEventId,
      rejection: {
        reason: 'ended',
        message: 'La sala fue cerrada.',
      },
    });
  }

  await touchParticipant(context.env, code, peerId);
  const { active, waiting } = await getRoomParticipants(context.env, code);
  const selfActive = active.find((p) => p.peerId === peerId) || null;
  const selfWaiting = waiting.find((w) => w.peerId === peerId) || null;
  const { events, lastEventId } = await getRoomEventsAfter(context.env, code, peerId, afterEventId);

  if (!selfActive && !selfWaiting) {
    const rejectedEv = events.find((e) => e.eventType === 'room:rejected');
    if (rejectedEv) {
      return jsonResponse({
        ok: true,
        rejected: true,
        events,
        lastEventId,
        rejection: rejectedEv.payload,
      });
    }
    return jsonResponse({
      ok: true,
      inRoom: false,
      meta: state.meta,
      events,
      lastEventId,
    });
  }

  const messages = selfActive ? await getVisibleRoomMessages(context.env, code, peerId) : [];

  return jsonResponse({
    ok: true,
    inRoom: true,
    status: selfActive ? 'connected' : 'waiting',
    self: selfActive,
    peers: active,
    waiting: selfActive?.role === 'host' ? waiting : [],
    messages,
    meta: state.meta,
    events,
    lastEventId,
  });
}

export async function onRequestPost(context: PagesContext<{ code?: string }>): Promise<Response> {
  const code = normalizeRoomCode(context.params.code || '');
  const body = await parseJsonBody<Record<string, unknown>>(context.request);
  const signalType = typeof body.type === 'string' ? body.type : typeof body.action === 'string' ? body.action : '';
  const peerId = typeof body.peerId === 'string' ? body.peerId.trim() : '';

  if (signalType === 'room:join') {
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : crypto.randomUUID();
    const cleanPass = typeof body.pass === 'string' ? body.pass.trim().toUpperCase() : '';
    const cleanName = (typeof body.name === 'string' ? body.name : 'Invitado').trim().slice(0, 32) || 'Invitado';
    const wantHost = Boolean(body.wantHost);

    await cleanupStaleParticipants(context.env, code);
    const state = await getOrCreateRoomState(context.env, code, wantHost ? cleanPass : undefined, true);
    const { active } = await getRoomParticipants(context.env, code);

    if (state.blockedClientIds.includes(clientId)) {
      return jsonResponse({
        ok: true,
        type: 'room:rejected',
        reason: 'blocked',
        message: 'El anfitrión bloqueó el acceso a esta sala.',
      });
    }

    const alreadyActive = active.find((p) => p.peerId === peerId);
    const shouldBeHost =
      !state.meta.hostId ||
      (active.length === 0 && wantHost) ||
      alreadyActive?.role === 'host';

    if (shouldBeHost && cleanPass) {
      state.meta.pass = cleanPass;
    }

    if (!alreadyActive && active.length >= MAX_ROOM_PARTICIPANTS) {
      return jsonResponse({
        ok: true,
        type: 'room:rejected',
        reason: 'full',
        message: `La sala alcanzó el límite máximo de ${MAX_ROOM_PARTICIPANTS} participantes.`,
      });
    }

    if (state.meta.locked && !shouldBeHost) {
      return jsonResponse({
        ok: true,
        type: 'room:rejected',
        reason: 'locked',
        message: 'El anfitrión bloqueó la sala.',
      });
    }

    if (
      !shouldBeHost &&
      state.meta.pass &&
      cleanPass &&
      cleanPass !== state.meta.pass &&
      !state.admittedClientIds.includes(clientId)
    ) {
      return jsonResponse({
        ok: true,
        type: 'room:rejected',
        reason: 'pass',
        message: 'La clave de esta SUITE no coincide.',
      });
    }

    if (state.meta.waitingRoom && !shouldBeHost && !state.admittedClientIds.includes(clientId)) {
      const waitInfo: PeerInfo = {
        peerId: peerId || crypto.randomUUID(),
        clientId,
        name: cleanName,
        initial: getInitial(cleanName),
        role: 'guest',
        micOn: false,
        micLocked: true,
        camOn: Boolean(body.camOn),
        isEmitter: false,
        handRaised: false,
        screenSharing: false,
        speaking: false,
        callsSessionId: typeof body.callsSessionId === 'string' ? body.callsSessionId : null,
        camTrackName: typeof body.camTrackName === 'string' ? body.camTrackName : null,
        joinedAt: Date.now(),
      };
      await upsertRoomParticipant(context.env, code, waitInfo, 'waiting');
      const { lastEventId } = await getRoomEventsAfter(context.env, code, waitInfo.peerId, 0);
      return jsonResponse({
        ok: true,
        type: 'room:waiting',
        roomCode: code,
        name: cleanName,
        lastEventId,
      });
    }

    const role: PeerInfo['role'] = shouldBeHost ? 'host' : 'guest';
    if (role === 'host') {
      state.meta.hostId = peerId;
    }
    if (!state.admittedClientIds.includes(clientId)) {
      state.admittedClientIds.push(clientId);
    }

    const isEmitter = state.meta.emitterPeerId === peerId;
    const info: PeerInfo = {
      peerId: peerId || crypto.randomUUID(),
      clientId,
      name: cleanName,
      initial: getInitial(cleanName),
      role,
      micOn: false,
      micLocked: true,
      camOn: isEmitter ? false : Boolean(body.camOn),
      isEmitter,
      handRaised: alreadyActive?.handRaised ?? false,
      screenSharing: isEmitter,
      speaking: false,
      callsSessionId: typeof body.callsSessionId === 'string' ? body.callsSessionId : alreadyActive?.callsSessionId ?? null,
      camTrackName: typeof body.camTrackName === 'string' ? body.camTrackName : alreadyActive?.camTrackName ?? null,
      joinedAt: alreadyActive?.joinedAt ?? Date.now(),
    };

    await saveRoomMetaAndLists(context.env, code, state.meta, {
      admittedClientIds: state.admittedClientIds,
      ended: false,
    });
    await upsertRoomParticipant(context.env, code, info, 'active');

    const updated = await getRoomParticipants(context.env, code);
    const messages = await getVisibleRoomMessages(context.env, code, info.peerId);
    const { lastEventId } = await getRoomEventsAfter(context.env, code, info.peerId, 0);
    await addAuditEvent(context.env, 'room', cleanName, `Entró a ${code} (${role})`);

    return jsonResponse({
      ok: true,
      type: 'room:joined',
      self: info,
      peers: updated.active,
      waiting: role === 'host' ? updated.waiting : [],
      messages,
      meta: state.meta,
      lastEventId,
    });
  }

  if (!peerId) {
    return jsonResponse({ ok: false, error: 'peerId requerido' }, 400);
  }

  if (signalType === 'room:leave') {
    const state = await getOrCreateRoomState(context.env, code);
    if (state.meta.emitterPeerId === peerId) {
      state.meta.emitterPeerId = null;
      state.meta.broadcast = idleBroadcast();
      await saveRoomMetaAndLists(context.env, code, state.meta);
    }
    await removeParticipant(context.env, code, peerId);
    return jsonResponse({ ok: true });
  }

  await cleanupStaleParticipants(context.env, code);
  const state = await getOrCreateRoomState(context.env, code);
  const { active, waiting } = await getRoomParticipants(context.env, code);
  const sender = active.find((p) => p.peerId === peerId);

  if (!sender) {
    return jsonResponse({ ok: false, error: 'Participante no activo en la sala.' }, 404);
  }

  await touchParticipant(context.env, code, peerId);

  if (signalType === 'room:sync' || signalType === 'heartbeat') {
    const messages = await getVisibleRoomMessages(context.env, code, peerId);
    return jsonResponse({
      ok: true,
      type: 'room:synced',
      self: sender,
      peers: active,
      waiting: sender.role === 'host' ? waiting : [],
      messages,
      meta: state.meta,
    });
  }

  if (signalType === 'peer:state') {
    const rawPatch = (body.patch && typeof body.patch === 'object' ? body.patch : {}) as Partial<PeerInfo>;
    const patch: Partial<PeerInfo> = { micOn: false, micLocked: true, speaking: false };
    if (typeof rawPatch.camOn === 'boolean') {
      patch.camOn = state.meta.emitterPeerId === peerId ? false : rawPatch.camOn;
    }
    if (typeof rawPatch.handRaised === 'boolean') patch.handRaised = rawPatch.handRaised;
    if (typeof rawPatch.callsSessionId === 'string' || rawPatch.callsSessionId === null) {
      patch.callsSessionId = rawPatch.callsSessionId;
    }
    if (typeof rawPatch.camTrackName === 'string' || rawPatch.camTrackName === null) {
      patch.camTrackName = rawPatch.camTrackName;
    }
    if (typeof rawPatch.name === 'string' && rawPatch.name.trim()) {
      patch.name = rawPatch.name.trim().slice(0, 32);
      patch.initial = getInitial(patch.name);
    }
    await patchParticipantState(context.env, code, peerId, patch);
    return jsonResponse({ ok: true });
  }

  if (signalType === 'emitter:claim') {
    if (state.meta.emitterPeerId && state.meta.emitterPeerId !== peerId) {
      return jsonResponse({
        ok: false,
        type: 'emitter:denied',
        emitterPeerId: state.meta.emitterPeerId,
        error: 'Otro participante ya está emitiendo en este momento.',
      }, 409);
    }
    const sourceType = body.sourceType === 'media' ? 'media' : 'screen';
    const nextStatus = body.status === 'live' ? 'live' : 'preparing';
    state.meta.emitterPeerId = peerId;
    state.meta.broadcast = {
      emitterPeerId: peerId,
      emitterName: sender.name,
      status: nextStatus,
      sourceType,
      mediaTitle: typeof body.mediaTitle === 'string' ? body.mediaTitle.slice(0, 80) : null,
      callsSessionId: typeof body.callsSessionId === 'string' ? body.callsSessionId : sender.callsSessionId || null,
      videoTrackName: typeof body.videoTrackName === 'string' ? body.videoTrackName : null,
      audioTrackName: typeof body.audioTrackName === 'string' ? body.audioTrackName : null,
      updatedAt: Date.now(),
    };
    await patchParticipantState(context.env, code, peerId, {
      isEmitter: true,
      screenSharing: true,
      camOn: false,
    });
    await saveRoomMetaAndLists(context.env, code, state.meta);
    const updatedAfterClaim = await getRoomParticipants(context.env, code);
    return jsonResponse({ ok: true, meta: state.meta, peers: updatedAfterClaim.active });
  }

  if (signalType === 'broadcast:state') {
    if (state.meta.emitterPeerId !== peerId) {
      return jsonResponse({ ok: false, error: 'Solo el emisor activo puede actualizar la transmisión.' }, 403);
    }
    const nextStatus = body.status === 'live' ? 'live' : body.status === 'idle' ? 'idle' : 'preparing';
    if (nextStatus === 'idle') {
      state.meta.emitterPeerId = null;
      state.meta.broadcast = idleBroadcast();
      await patchParticipantState(context.env, code, peerId, { isEmitter: false, screenSharing: false });
    } else {
      state.meta.broadcast = {
        ...state.meta.broadcast,
        emitterPeerId: peerId,
        emitterName: sender.name,
        status: nextStatus,
        sourceType: body.sourceType === 'media' ? 'media' : body.sourceType === 'screen' ? 'screen' : state.meta.broadcast.sourceType,
        mediaTitle: typeof body.mediaTitle === 'string' ? body.mediaTitle.slice(0, 80) : state.meta.broadcast.mediaTitle || null,
        callsSessionId: typeof body.callsSessionId === 'string' ? body.callsSessionId : state.meta.broadcast.callsSessionId || null,
        videoTrackName: typeof body.videoTrackName === 'string' ? body.videoTrackName : state.meta.broadcast.videoTrackName || null,
        audioTrackName: body.audioTrackName !== undefined ? (body.audioTrackName ? String(body.audioTrackName) : null) : state.meta.broadcast.audioTrackName || null,
        updatedAt: Date.now(),
      };
    }
    await saveRoomMetaAndLists(context.env, code, state.meta);
    const updatedAfterBroadcast = await getRoomParticipants(context.env, code);
    return jsonResponse({ ok: true, meta: state.meta, peers: updatedAfterBroadcast.active });
  }

  if (signalType === 'emitter:release') {
    if (state.meta.emitterPeerId === peerId || sender.role === 'host') {
      const prevId = state.meta.emitterPeerId;
      state.meta.emitterPeerId = null;
      state.meta.broadcast = idleBroadcast();
      if (prevId) {
        await patchParticipantState(context.env, code, prevId, { isEmitter: false, screenSharing: false });
      }
      await saveRoomMetaAndLists(context.env, code, state.meta);
    }
    const updatedAfterRelease = await getRoomParticipants(context.env, code);
    return jsonResponse({ ok: true, meta: state.meta, peers: updatedAfterRelease.active });
  }

  if (signalType === 'chat:send') {
    const text = (typeof body.text === 'string' ? body.text : '').trim().slice(0, 500);
    if (!text) return jsonResponse({ ok: true });
    const toPeerId = typeof body.toPeerId === 'string' && body.toPeerId ? body.toPeerId : null;
    const chatMsg: ChatMessage = {
      id: crypto.randomUUID(),
      roomCode: code,
      fromPeerId: peerId,
      fromName: sender.name,
      toPeerId,
      text,
      timestamp: Date.now(),
    };
    await addRoomMessage(context.env, chatMsg);
    return jsonResponse({ ok: true, type: 'chat:message', message: chatMsg });
  }

  if (signalType === 'chat:typing') {
    const toPeerId = typeof body.toPeerId === 'string' && body.toPeerId ? body.toPeerId : null;
    await pushRoomEvent(
      context.env,
      code,
      'chat:typing',
      {
        peerId,
        name: sender.name,
        isTyping: Boolean(body.isTyping),
        toPeerId,
      },
      toPeerId,
      peerId,
    );
    return jsonResponse({ ok: true });
  }

  if (signalType === 'wave:send') {
    const toPeerId = typeof body.toPeerId === 'string' && body.toPeerId ? body.toPeerId : null;
    const wave = {
      id: crypto.randomUUID(),
      fromPeerId: peerId,
      fromName: sender.name,
      toPeerId,
      timestamp: Date.now(),
    };
    await pushRoomEvent(context.env, code, 'wave:received', { wave }, toPeerId, peerId);
    return jsonResponse({ ok: true });
  }

  if (signalType === 'reaction:send') {
    const allowedKinds = new Set(['pulse', 'spark', 'heart', 'heartbeat', 'orbit', 'toast']);
    const rawKind = typeof body.kind === 'string' ? body.kind.trim() : '';
    const kind = allowedKinds.has(rawKind) ? rawKind : 'heartbeat';
    const reaction = {
      id: crypto.randomUUID(),
      peerId,
      name: sender.name,
      kind,
      timestamp: Date.now(),
    };
    await pushRoomEvent(context.env, code, 'reaction:received', { reaction }, null, peerId);
    return jsonResponse({ ok: true, reaction });
  }

  if (signalType === 'subtitle:broadcast') {
    const text = String(body.text || '').trim().slice(0, 300);
    if (text) {
      const subtitle = {
        id: crypto.randomUUID(),
        peerId,
        name: sender.name,
        text,
        timestamp: Date.now(),
      };
      await pushRoomEvent(context.env, code, 'subtitle:received', { subtitle }, null, peerId);
      return jsonResponse({ ok: true, subtitle });
    }
    return jsonResponse({ ok: true });
  }

  if (signalType === 'room:interactive') {
    const act = typeof body.action === 'string' ? body.action.trim() : '';
    const payload = (body.payload && typeof body.payload === 'object' ? body.payload : {}) as Record<string, unknown>;
    const interactive: RoomInteractiveState = { ...(state.meta.interactive || {}) };

    if (act === 'mood:set') {
      const allowedMoods = new Set(['cosmos', 'emerald', 'amber', 'indigo']);
      const nextMood = typeof payload.mood === 'string' && allowedMoods.has(payload.mood)
        ? (payload.mood as RoomInteractiveState['mood'])
        : null;
      interactive.mood = nextMood;
    } else if (act === 'card:deal') {
      const id = String(payload.id || crypto.randomUUID()).slice(0, 48);
      const category = String(payload.category || 'Carta Cósmica').trim().slice(0, 32) || 'Carta Cósmica';
      const prompt = String(payload.prompt || '').trim().slice(0, 180);
      if (prompt) {
        interactive.card = { id, category, prompt, byName: sender.name };
      }
    } else if (act === 'card:clear') {
      interactive.card = null;
    } else if (act === 'poll:start') {
      const question = String(payload.question || '').trim().slice(0, 120);
      const rawOptions = Array.isArray(payload.options) ? payload.options : [];
      const cleanOpts = rawOptions
        .map((o) => (typeof o === 'string' ? o.trim().slice(0, 48) : ''))
        .filter(Boolean)
        .slice(0, 4);
      if (question && cleanOpts.length >= 2) {
        interactive.poll = {
          id: crypto.randomUUID(),
          question,
          options: cleanOpts.map((label, idx) => ({ id: String(idx), label, votes: [] })),
          byName: sender.name,
        };
      }
    } else if (act === 'poll:vote') {
      const optId = typeof payload.optionId === 'string' ? payload.optionId : '';
      if (interactive.poll && optId) {
        interactive.poll = {
          ...interactive.poll,
          options: interactive.poll.options.map((opt) => {
            const withoutSelf = (opt.votes || []).filter((id) => id !== peerId);
            return opt.id === optId ? { ...opt, votes: [...withoutSelf, peerId] } : { ...opt, votes: withoutSelf };
          }),
        };
      }
    } else if (act === 'poll:close') {
      interactive.poll = null;
    } else if (act === 'timer:start') {
      const mins = Math.max(1, Math.min(60, Math.round(Number(payload.minutes) || 5)));
      const label = String(payload.label || `Focus ${mins} min`).trim().slice(0, 40);
      interactive.timer = {
        endsAt: Date.now() + mins * 60_000,
        label,
        byName: sender.name,
      };
    } else if (act === 'timer:stop') {
      interactive.timer = null;
    } else {
      return jsonResponse({ ok: false, error: 'Acción interactiva no válida.' }, 400);
    }

    state.meta.interactive = interactive;
    await saveRoomMetaAndLists(context.env, code, state.meta);
    return jsonResponse({ ok: true, meta: state.meta });
  }

  if (signalType === 'host:action') {
    if (sender.role !== 'host') {
      return jsonResponse({ ok: false, error: 'Solo el anfitrión puede hacer eso.' }, 403);
    }

    const hostAct = typeof body.action === 'string' ? body.action : '';
    const targetPeerId = typeof body.targetPeerId === 'string' ? body.targetPeerId : null;

    if (hostAct === 'lock') {
      state.meta.locked = Boolean(body.value);
      await saveRoomMetaAndLists(context.env, code, state.meta);
    } else if (hostAct === 'waitingRoom') {
      state.meta.waitingRoom = Boolean(body.value);
      await saveRoomMetaAndLists(context.env, code, state.meta);
    } else if (hostAct === 'spotlight') {
      state.meta.spotlightPeerId = targetPeerId;
      await saveRoomMetaAndLists(context.env, code, state.meta);
    } else if (hostAct === 'grantEmitter') {
      const prevEmitter = state.meta.emitterPeerId;
      if (prevEmitter && prevEmitter !== targetPeerId) {
        await patchParticipantState(context.env, code, prevEmitter, { isEmitter: false, screenSharing: false });
      }
      if (targetPeerId) {
        const target = active.find((p) => p.peerId === targetPeerId);
        if (target) {
          state.meta.emitterPeerId = targetPeerId;
          state.meta.broadcast = {
            ...idleBroadcast(),
            emitterPeerId: targetPeerId,
            emitterName: target.name,
            status: 'preparing',
            sourceType: 'screen',
          };
          await patchParticipantState(context.env, code, targetPeerId, {
            isEmitter: true,
            screenSharing: true,
            camOn: false,
          });
        }
      } else {
        state.meta.emitterPeerId = null;
        state.meta.broadcast = idleBroadcast();
      }
      await saveRoomMetaAndLists(context.env, code, state.meta);
    } else if (hostAct === 'admit' && targetPeerId) {
      const waitGuest = waiting.find((w) => w.peerId === targetPeerId);
      if (waitGuest) {
        if (active.length >= MAX_ROOM_PARTICIPANTS) {
          await removeParticipant(context.env, code, targetPeerId);
          await pushRoomEvent(
            context.env,
            code,
            'room:rejected',
            {
              reason: 'full',
              message: `La sala alcanzó el límite máximo de ${MAX_ROOM_PARTICIPANTS} participantes.`,
            },
            targetPeerId,
            peerId,
          );
        } else {
          if (!state.admittedClientIds.includes(waitGuest.clientId)) {
            state.admittedClientIds.push(waitGuest.clientId);
            await saveRoomMetaAndLists(context.env, code, state.meta, {
              admittedClientIds: state.admittedClientIds,
            });
          }
          await upsertRoomParticipant(
            context.env,
            code,
            {
              peerId: waitGuest.peerId,
              clientId: waitGuest.clientId,
              name: waitGuest.name,
              initial: waitGuest.initial,
              role: 'guest',
              micOn: false,
              micLocked: true,
              camOn: Boolean(waitGuest.camOn),
              isEmitter: false,
              handRaised: false,
              screenSharing: false,
              speaking: false,
              joinedAt: Date.now(),
            },
            'active',
          );
        }
      }
    } else if (hostAct === 'reject' && targetPeerId) {
      const waitGuest = waiting.find((w) => w.peerId === targetPeerId);
      if (waitGuest) {
        if (body.block && !state.blockedClientIds.includes(waitGuest.clientId)) {
          state.blockedClientIds.push(waitGuest.clientId);
          await saveRoomMetaAndLists(context.env, code, state.meta, {
            blockedClientIds: state.blockedClientIds,
          });
        }
        await removeParticipant(context.env, code, targetPeerId);
        await pushRoomEvent(
          context.env,
          code,
          'room:rejected',
          {
            reason: body.block ? 'blocked' : 'rejected',
            message: body.block
              ? 'El anfitrión bloqueó el acceso a esta sala.'
              : 'El anfitrión no aceptó tu solicitud.',
          },
          targetPeerId,
          peerId,
        );
      }
    } else if (hostAct === 'mutePeer' || hostAct === 'muteAll') {
      // Microphones are permanently locked at room level
      return jsonResponse({ ok: true, meta: state.meta });
    } else if (hostAct === 'kick' && targetPeerId) {
      const target = active.find((p) => p.peerId === targetPeerId);
      if (target && target.peerId !== peerId) {
        if (state.meta.emitterPeerId === targetPeerId) {
          state.meta.emitterPeerId = null;
          state.meta.broadcast = idleBroadcast();
          await saveRoomMetaAndLists(context.env, code, state.meta);
        }
        if (body.block && !state.blockedClientIds.includes(target.clientId)) {
          state.blockedClientIds.push(target.clientId);
          await saveRoomMetaAndLists(context.env, code, state.meta, {
            blockedClientIds: state.blockedClientIds,
          });
        }
        await removeParticipant(context.env, code, targetPeerId);
        await pushRoomEvent(
          context.env,
          code,
          'room:rejected',
          {
            reason: body.block ? 'blocked' : 'kicked',
            message: body.block
              ? 'Fuiste bloqueado de esta sala por el anfitrión.'
              : 'El anfitrión te quitó de esta sala.',
          },
          targetPeerId,
          peerId,
        );
      }
    } else if (hostAct === 'endRoom') {
      await pushRoomEvent(
        context.env,
        code,
        'room:rejected',
        { reason: 'ended', message: 'El anfitrión cerró la sala.' },
        null,
        peerId,
      );
      state.meta.emitterPeerId = null;
      state.meta.broadcast = idleBroadcast();
      await saveRoomMetaAndLists(context.env, code, state.meta, { ended: true });
      for (const p of active) {
        await removeParticipant(context.env, code, p.peerId);
      }
      for (const w of waiting) {
        await removeParticipant(context.env, code, w.peerId);
      }
    }

    const updatedAfter = await getRoomParticipants(context.env, code);
    return jsonResponse({
      ok: true,
      meta: state.meta,
      peers: updatedAfter.active,
      waiting: updatedAfter.waiting,
    });
  }

  return jsonResponse({ ok: false, error: 'Evento no reconocido' }, 400);
}
