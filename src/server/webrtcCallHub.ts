import { Response } from 'express';
import crypto from 'crypto';
import { isUserBlocked } from './realtimeHub';
import { checkUserRestriction, currentPlatformSettings } from './communityAdminHub';
import { CallSessionData, WebRTCSignal, IceServerConfig, CallMediaKind, CallSessionStatus } from '../types';

// In-memory server-authoritative stores for WebRTC sessions and signals
const activeCalls = new Map<string, CallSessionData>(); // callId -> CallSessionData
const userActiveCall = new Map<string, string>(); // userId -> callId
const callSignals = new Map<string, WebRTCSignal[]>(); // callId -> signals array
const userSignalingStreams = new Map<string, Set<Response>>(); // userId -> Set of SSE responses
const callTimeouts = new Map<string, NodeJS.Timeout>(); // callId -> ringing timeout timer

// Rate limiting for call initiation (per user)
const userCallRateLimit = new Map<string, { lastCallTime: number; recentCount: number; windowStart: number }>();

// -----------------------------------------------------------------------------
// STUN & TURN RELAY CONFIGURATION
// -----------------------------------------------------------------------------
export function getIceServers(): IceServerConfig[] {
  const stunUrls = [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
    'stun:stun2.l.google.com:19302',
  ];

  const servers: IceServerConfig[] = [{ urls: stunUrls }];

  // Optional TURN Relay (e.g., Twilio, Metered.ca, Coturn) via environment variables
  const turnUrl = process.env.TURN_SERVER_URL;
  const turnUsername = process.env.TURN_USERNAME;
  const turnCredential = process.env.TURN_CREDENTIAL;

  if (turnUrl && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrl.split(','),
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
}

// -----------------------------------------------------------------------------
// CALL INITIATION RATE LIMITER
// -----------------------------------------------------------------------------
export function checkCallRateLimit(userId: string): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const record = userCallRateLimit.get(userId) || { lastCallTime: 0, recentCount: 0, windowStart: now };

  // At least 4 seconds cooldown between new call placements
  if (now - record.lastCallTime < 4000) {
    return { allowed: false, reason: 'Please wait a moment before initiating another call.' };
  }

  // Sliding window: Max 10 calls per 5 minutes to prevent harassment / automated dialing
  if (now - record.windowStart > 5 * 60 * 1000) {
    record.recentCount = 0;
    record.windowStart = now;
  }

  if (record.recentCount >= 10) {
    return { allowed: false, reason: 'Call initiation rate limit reached. Please wait a few minutes.' };
  }

  record.recentCount += 1;
  record.lastCallTime = now;
  userCallRateLimit.set(userId, record);

  return { allowed: true };
}

// -----------------------------------------------------------------------------
// SSE DISPATCH TO PARTICIPANTS
// -----------------------------------------------------------------------------
export function registerUserSignalingStream(userId: string, res: Response) {
  if (!userSignalingStreams.has(userId)) {
    userSignalingStreams.set(userId, new Set());
  }
  const streamSet = userSignalingStreams.get(userId)!;
  streamSet.add(res);

  // Send initial connected confirmation
  res.write(
    `event: connected\ndata: ${JSON.stringify({ userId, timestamp: new Date().toISOString() })}\n\n`
  );

  res.on('close', () => {
    streamSet.delete(res);
  });
}

function broadcastToUser(userId: string, eventName: string, data: any) {
  const streamSet = userSignalingStreams.get(userId);
  if (!streamSet || streamSet.size === 0) return;

  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of streamSet) {
    try {
      res.write(payload);
    } catch {
      streamSet.delete(res);
    }
  }
}

// -----------------------------------------------------------------------------
// CALL LIFECYCLE MANAGEMENT
// -----------------------------------------------------------------------------

/**
 * Initiates an authorized 1-on-1 voice or video call
 */
export function initiateCall(params: {
  initiatorId: string;
  initiatorNickname: string;
  initiatorAvatar: string;
  calleeId: string;
  calleeNickname: string;
  calleeAvatar: string;
  mediaKind: CallMediaKind;
  conversationId?: string;
}): { success: boolean; call?: CallSessionData; error?: string } {
  const { initiatorId, initiatorNickname, initiatorAvatar, calleeId, calleeNickname, calleeAvatar, mediaKind, conversationId } = params;

  if (initiatorId === calleeId) {
    return { success: false, error: 'Cannot call yourself.' };
  }

  // Feature flag check
  if (!currentPlatformSettings.featureFlags.webRtcCallingEnabled) {
    return { success: false, error: 'WebRTC voice/video calling is currently disabled by administrator.' };
  }

  // User restriction checks (initiator & callee)
  const initRestr = checkUserRestriction(initiatorId);
  if (initRestr.isRestricted && initRestr.restriction) {
    if (initRestr.restriction.type === 'banned_permanent' || initRestr.restriction.type.startsWith('suspended')) {
      return { success: false, error: `Account suspended (${initRestr.restriction.type}): ${initRestr.restriction.reason}` };
    }
  }

  const calleeRestr = checkUserRestriction(calleeId);
  if (calleeRestr.isRestricted && calleeRestr.restriction) {
    if (calleeRestr.restriction.type === 'banned_permanent' || calleeRestr.restriction.type.startsWith('suspended')) {
      return { success: false, error: 'Participant is unavailable to receive calls (account suspended).' };
    }
  }

  // Check blocks
  if (isUserBlocked(initiatorId, calleeId)) {
    return { success: false, error: 'Cannot initiate call: User communication blocked.' };
  }

  // Check rate limit
  const rate = checkCallRateLimit(initiatorId);
  if (!rate.allowed) {
    return { success: false, error: rate.reason };
  }

  // Prevent duplicate concurrent calls
  const existingInitCall = userActiveCall.get(initiatorId);
  if (existingInitCall) {
    const existing = activeCalls.get(existingInitCall);
    if (existing && (existing.status === 'ringing' || existing.status === 'active' || existing.status === 'connecting')) {
      return { success: false, error: 'You are already in an active or pending call.' };
    }
  }

  const existingCalleeCall = userActiveCall.get(calleeId);
  if (existingCalleeCall) {
    const existing = activeCalls.get(existingCalleeCall);
    if (existing && existing.status === 'active') {
      return { success: false, error: 'Participant is currently busy on another call.' };
    }
  }

  const callId = `call_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

  const callSession: CallSessionData = {
    callId,
    conversationId,
    initiator: {
      id: initiatorId,
      nickname: initiatorNickname,
      avatar: initiatorAvatar,
    },
    callee: {
      id: calleeId,
      nickname: calleeNickname,
      avatar: calleeAvatar,
    },
    mediaKind,
    status: 'ringing',
    startedAt: Date.now(),
  };

  activeCalls.set(callId, callSession);
  userActiveCall.set(initiatorId, callId);
  userActiveCall.set(calleeId, callId);
  callSignals.set(callId, []);

  // Set 45-second ringing timeout
  const timeoutTimer = setTimeout(() => {
    handleCallTimeout(callId);
  }, 45000);
  if (timeoutTimer.unref) timeoutTimer.unref();
  callTimeouts.set(callId, timeoutTimer);

  // Notify Callee via SSE
  broadcastToUser(calleeId, 'incoming_call', {
    callId,
    initiator: callSession.initiator,
    callee: callSession.callee,
    mediaKind,
    conversationId,
    timestamp: new Date().toISOString(),
  });

  return { success: true, call: callSession };
}

/**
 * Recipient explicitly accepts the call
 */
export function acceptCall(callId: string, calleeId: string): { success: boolean; call?: CallSessionData; error?: string } {
  const call = activeCalls.get(callId);
  if (!call) {
    return { success: false, error: 'Call session not found.' };
  }

  if (call.callee.id !== calleeId) {
    return { success: false, error: 'Unauthorized: You are not the recipient of this call.' };
  }

  // Recipient restriction check
  const restr = checkUserRestriction(calleeId);
  if (restr.isRestricted && restr.restriction) {
    if (restr.restriction.type === 'banned_permanent' || restr.restriction.type.startsWith('suspended')) {
      return { success: false, error: `Account suspended (${restr.restriction.type}): Cannot accept calls.` };
    }
  }

  if (call.status !== 'ringing') {
    return { success: false, error: `Cannot accept call in '${call.status}' state.` };
  }

  // Clear ringing timeout
  const timer = callTimeouts.get(callId);
  if (timer) {
    clearTimeout(timer);
    callTimeouts.delete(callId);
  }

  call.status = 'connecting';
  call.startedAt = Date.now();

  // Notify initiator
  broadcastToUser(call.initiator.id, 'call_accepted', {
    callId,
    calleeId,
    timestamp: new Date().toISOString(),
  });

  return { success: true, call };
}

/**
 * Recipient explicitly rejects the call
 */
export function rejectCall(callId: string, calleeId: string, reason = 'Call declined'): { success: boolean; error?: string } {
  const call = activeCalls.get(callId);
  if (!call) {
    return { success: false, error: 'Call session not found.' };
  }

  if (call.callee.id !== calleeId && call.initiator.id !== calleeId) {
    return { success: false, error: 'Unauthorized to reject this call.' };
  }

  const timer = callTimeouts.get(callId);
  if (timer) {
    clearTimeout(timer);
    callTimeouts.delete(callId);
  }

  call.status = 'rejected';
  call.endedAt = Date.now();
  call.endedReason = reason;

  userActiveCall.delete(call.initiator.id);
  userActiveCall.delete(call.callee.id);

  // Notify other party
  const notifyTarget = call.callee.id === calleeId ? call.initiator.id : call.callee.id;
  broadcastToUser(notifyTarget, 'call_rejected', {
    callId,
    reason,
    timestamp: new Date().toISOString(),
  });

  return { success: true };
}

/**
 * Either participant ends an active, ringing, or connecting call
 */
export function endCall(callId: string, userId: string, reason = 'Call ended'): { success: boolean; call?: CallSessionData; error?: string } {
  const call = activeCalls.get(callId);
  if (!call) {
    return { success: false, error: 'Call session not found or already ended.' };
  }

  if (call.initiator.id !== userId && call.callee.id !== userId) {
    return { success: false, error: 'Unauthorized to end this call.' };
  }

  const timer = callTimeouts.get(callId);
  if (timer) {
    clearTimeout(timer);
    callTimeouts.delete(callId);
  }

  call.status = 'ended';
  call.endedAt = Date.now();
  call.endedReason = reason;
  if (call.startedAt) {
    call.durationSeconds = Math.max(0, Math.floor((call.endedAt - call.startedAt) / 1000));
  }

  userActiveCall.delete(call.initiator.id);
  userActiveCall.delete(call.callee.id);

  // Notify both participants
  const payload = {
    callId,
    endedBy: userId,
    reason,
    durationSeconds: call.durationSeconds,
    timestamp: new Date().toISOString(),
  };

  broadcastToUser(call.initiator.id, 'call_ended', payload);
  broadcastToUser(call.callee.id, 'call_ended', payload);

  return { success: true, call };
}

function handleCallTimeout(callId: string) {
  const call = activeCalls.get(callId);
  if (!call || call.status !== 'ringing') return;

  call.status = 'missed';
  call.endedAt = Date.now();
  call.endedReason = 'No answer (timed out)';

  userActiveCall.delete(call.initiator.id);
  userActiveCall.delete(call.callee.id);
  callTimeouts.delete(callId);

  const payload = { callId, reason: 'Missed call (no answer after 45s)', timestamp: new Date().toISOString() };
  broadcastToUser(call.initiator.id, 'call_timeout', payload);
  broadcastToUser(call.callee.id, 'call_timeout', payload);
}

// -----------------------------------------------------------------------------
// SIGNALING RELAY (OFFER, ANSWER, ICE CANDIDATES)
// -----------------------------------------------------------------------------

export function postSignal(params: {
  callId: string;
  senderId: string;
  type: 'offer' | 'answer' | 'ice_candidate' | 'mute_state' | 'hangup';
  payload: any;
}): { success: boolean; error?: string } {
  const { callId, senderId, type, payload } = params;

  const call = activeCalls.get(callId);
  if (!call) {
    return { success: false, error: 'Call session not found.' };
  }

  // Authorization check: sender must be in call
  if (call.initiator.id !== senderId && call.callee.id !== senderId) {
    return { success: false, error: 'Unauthorized signaling sender.' };
  }

  const receiverId = call.initiator.id === senderId ? call.callee.id : call.initiator.id;

  if (type === 'answer') {
    call.status = 'active';
  }

  const signal: WebRTCSignal = {
    id: `sig_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
    callId,
    senderId,
    receiverId,
    type,
    payload,
    timestamp: new Date().toISOString(),
  };

  if (!callSignals.has(callId)) {
    callSignals.set(callId, []);
  }
  callSignals.get(callId)!.push(signal);

  // Relay to receiver via SSE
  broadcastToUser(receiverId, 'webrtc_signal', signal);

  return { success: true };
}

export function getCallSession(callId: string, userId: string): CallSessionData | null {
  const call = activeCalls.get(callId);
  if (!call) return null;
  if (call.initiator.id !== userId && call.callee.id !== userId) {
    return null;
  }
  return call;
}

export function getActiveCallForUser(userId: string): CallSessionData | null {
  const callId = userActiveCall.get(userId);
  if (!callId) return null;
  const call = activeCalls.get(callId);
  if (!call || call.status === 'ended' || call.status === 'rejected' || call.status === 'missed') {
    userActiveCall.delete(userId);
    return null;
  }
  return call;
}
