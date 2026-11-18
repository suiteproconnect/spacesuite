import {
  getInitial,
  jsonResponse,
  MAX_ROOM_PARTICIPANTS,
  normalizeRoomCode,
  parseJsonBody,
  type ChatMessage,
  type PagesContext,
  type PeerInfo,
  type RoomInteractiveState,
  type SuiteProfile,
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

function sanitizeMediaUrl(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().slice(0, 600) : '';
  if (!s) return '';
  if (/^(https?:\/\/|\/assets\/|data:image\/)/i.test(s)) return s;
  return '';
}

function sanitizeSuiteProfile(raw: unknown, updatedBy?: string): SuiteProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const title = typeof obj.title === 'string' ? obj.title.trim().slice(0, 80) : '';
  const description = typeof obj.description === 'string' ? obj.description.trim().slice(0, 220) : '';
  const coverImage = sanitizeMediaUrl(obj.coverImage);
  const coverVideo = sanitizeMediaUrl(obj.coverVideo);
  if (!title && !description && !coverImage && !coverVideo) return null;
  return {
    title: title || undefined,
    description: description || undefined,
    coverImage: coverImage || undefined,
    coverVideo: coverVideo || undefined,
    updatedBy: updatedBy ? updatedBy.slice(0, 32) : undefined,
    updatedAt: Date.now(),
  };
}

export async function onRequestGet(context: PagesContext<{ code?: string }>): Promise<Response> {
  const code = normalizeRoomCode(context.params.code || '');
  const url = new URL(context.request.url);
  const poll = url.searchParams.get('poll') === '1';

  if (!poll) {
    const summary = await getRoomSummary(context.env, code);
    return jsonResponse({ ok: true, ...summary });
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
        message: 'Esta Suite tiene el acceso restringido para tu dispositivo.',
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

    if (shouldBeHost && body.suiteProfile && typeof body.suiteProfile === 'object') {
      const nextProfile = sanitizeSuiteProfile(body.suiteProfile, cleanName);
      if (nextProfile) {
        state.meta.interactive = { ...(state.meta.interactive || {}), suiteProfile: nextProfile };
        state.meta.suiteProfile = nextProfile;
      }
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
        message: 'Esta Suite está cerrada temporalmente.',
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

    if (state.meta.waitingRoom && !shouldBeHost && !alreadyActive) {
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
        meta: state.meta,
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
    if (patch.name) {
      await pushRoomEvent(
        context.env,
        code,
        'peer:name_updated',
        { peerId, name: patch.name, initial: patch.initial },
        null,
        peerId,
      );
    }
    return jsonResponse({ ok: true, peer: { ...sender, ...patch } });
  }

  if (signalType === 'chat:send') {
    const text = (typeof body.text === 'string' ? body.text : '').trim().slice(0, 500);
    if (!text) return jsonResponse({ ok: true });
    const toPeerId = typeof body.toPeerId === 'string' && body.toPeerId ? body.toPeerId : null;
    const msgId = typeof body.messageId === 'string' && body.messageId ? body.messageId : crypto.randomUUID();
    const timestamp = typeof body.timestamp === 'number' && body.timestamp ? body.timestamp : Date.now();
    const chatMsg: ChatMessage = {
      id: msgId,
      roomCode: code,
      fromPeerId: peerId,
      fromName: sender.name,
      toPeerId,
      text,
      timestamp,
    };
    await addRoomMessage(context.env, chatMsg);
    await pushRoomEvent(
      context.env,
      code,
      'chat:message',
      { message: chatMsg },
      toPeerId,
      peerId,
    );
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
    } else if (act === 'suite:profile') {
      if (sender.role !== 'host') {
        return jsonResponse({ ok: false, error: 'Solo quien abrió la Suite puede personalizar SPACE.' }, 403);
      }
      const nextProfile = sanitizeSuiteProfile(payload, sender.name);
      interactive.suiteProfile = nextProfile;
      state.meta.suiteProfile = nextProfile;
    } else {
      return jsonResponse({ ok: false, error: 'Acción interactiva no válida.' }, 400);
    }

    state.meta.interactive = interactive;
    await saveRoomMetaAndLists(context.env, code, state.meta);
    return jsonResponse({ ok: true, meta: state.meta });
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
      return jsonResponse({ ok: false, error: 'Solo quien abrió la Suite puede ajustar esto.' }, 403);
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
              micOn: waitGuest.micOn ?? true,
              camOn: waitGuest.camOn ?? true,
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
              ? 'Esta Suite tiene el acceso restringido para tu dispositivo.'
              : 'En este momento la Suite está ocupada. Puedes intentar más tarde.',
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
              ? 'Tu acceso a esta Suite fue cerrado.'
              : 'Saliste de esta Suite.',
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
        { reason: 'ended', message: 'La Suite cerró por hoy.' },
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
