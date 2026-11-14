import {
  getInitial,
  jsonResponse,
  MAX_ROOM_PARTICIPANTS,
  normalizeRoomCode,
  parseJsonBody,
  type ChatMessage,
  type PagesContext,
  type PeerInfo,
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
    const { active, waiting } = await getRoomParticipants(context.env, code);

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
      (alreadyActive?.role === 'host');

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
        micOn: Boolean(body.micOn),
        camOn: Boolean(body.camOn),
        handRaised: false,
        screenSharing: false,
        speaking: false,
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

    const info: PeerInfo = {
      peerId: peerId || crypto.randomUUID(),
      clientId,
      name: cleanName,
      initial: getInitial(cleanName),
      role,
      micOn: Boolean(body.micOn),
      camOn: Boolean(body.camOn),
      handRaised: alreadyActive?.handRaised ?? false,
      screenSharing: alreadyActive?.screenSharing ?? false,
      speaking: false,
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
      waiting: role === 'host' ? updated.waiting : waiting.filter(() => false),
      messages,
      meta: state.meta,
      lastEventId,
    });
  }

  if (!peerId) {
    return jsonResponse({ ok: false, error: 'peerId requerido' }, 400);
  }

  if (signalType === 'room:leave') {
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
    const patch: Partial<PeerInfo> = {};
    if (typeof rawPatch.micOn === 'boolean') patch.micOn = rawPatch.micOn;
    if (typeof rawPatch.camOn === 'boolean') patch.camOn = rawPatch.camOn;
    if (typeof rawPatch.handRaised === 'boolean') patch.handRaised = rawPatch.handRaised;
    if (typeof rawPatch.screenSharing === 'boolean') patch.screenSharing = rawPatch.screenSharing;
    if (typeof rawPatch.speaking === 'boolean') patch.speaking = rawPatch.speaking;
    if (typeof rawPatch.name === 'string' && rawPatch.name.trim()) {
      patch.name = rawPatch.name.trim().slice(0, 32);
      patch.initial = getInitial(patch.name);
    }
    await patchParticipantState(context.env, code, peerId, patch);
    return jsonResponse({ ok: true });
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

  if (signalType === 'webrtc:offer' || signalType === 'webrtc:answer' || signalType === 'webrtc:ice') {
    const to = typeof body.to === 'string' ? body.to : '';
    if (!to) return jsonResponse({ ok: false, error: 'Destinatario requerido' }, 400);
    const payload =
      signalType === 'webrtc:ice'
        ? { from: peerId, candidate: body.candidate }
        : { from: peerId, sdp: body.sdp };
    await pushRoomEvent(context.env, code, signalType, payload, to, peerId);
    return jsonResponse({ ok: true });
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
              micOn: true,
              camOn: true,
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
    } else if (hostAct === 'mutePeer' && targetPeerId) {
      await patchParticipantState(context.env, code, targetPeerId, { micOn: false });
      await pushRoomEvent(context.env, code, 'host:mute', { byName: sender.name }, targetPeerId, peerId);
    } else if (hostAct === 'muteAll') {
      for (const p of active) {
        if (p.peerId !== peerId) {
          await patchParticipantState(context.env, code, p.peerId, { micOn: false });
          await pushRoomEvent(context.env, code, 'host:mute', { byName: sender.name }, p.peerId, peerId);
        }
      }
    } else if (hostAct === 'kick' && targetPeerId) {
      const target = active.find((p) => p.peerId === targetPeerId);
      if (target && target.peerId !== peerId) {
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
