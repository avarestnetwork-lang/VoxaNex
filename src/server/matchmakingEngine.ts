import { Response } from 'express';
import crypto from 'crypto';
import { isUserBlocked, registerConversationMembers } from './realtimeHub';
import { checkUserRestriction, currentPlatformSettings } from './communityAdminHub';

export interface QueueTicket {
  ticketId: string;
  userId: string;
  nickname: string;
  avatar: string;
  isGuest: boolean;
  languagePref: 'all' | 'bn' | 'en';
  regionPool: 'bangladesh' | 'international' | 'any';
  interests: string[];
  is18Verified: boolean;
  status: 'waiting' | 'matched' | 'cancelled' | 'expired';
  matchId?: string;
  createdAt: number;
  lastHeartbeat: number;
}

export interface MatchParticipant {
  id: string;
  nickname: string;
  avatar: string;
  isGuest: boolean;
  regionPool: string;
  interests: string[];
}

export interface MatchSession {
  matchId: string;
  conversationId: string;
  userA: MatchParticipant;
  userB: MatchParticipant;
  sharedInterests: string[];
  regionPool: string;
  language: string;
  status: 'matched' | 'connected' | 'disconnected';
  createdAt: number;
  endedAt?: number;
  endedBy?: string;
}

// In-memory server-authoritative matchmaking stores
const waitingQueue = new Map<string, QueueTicket>(); // ticketId -> QueueTicket
const userActiveTickets = new Map<string, string>(); // userId -> ticketId
const activeMatches = new Map<string, MatchSession>(); // matchId -> MatchSession
const userActiveMatches = new Map<string, string>(); // userId -> matchId

// Matchmaking SSE connection streams
const ticketSSEStreams = new Map<string, Response>();
const matchSSEStreams = new Map<string, Set<Response>>(); // matchId -> Set of Responses

// Rematch avoidance store (pairKey -> timestamp)
const recentPairings = new Map<string, number>();

// User skip cooldowns (userId -> timestamp of last skip)
const userSkipCooldowns = new Map<string, number>();

function getPairKey(userA: string, userB: string): string {
  const sorted = [userA, userB].sort();
  return `pair_${sorted[0]}_${sorted[1]}`;
}

function isRecentPair(userA: string, userB: string): boolean {
  const key = getPairKey(userA, userB);
  const pairedAt = recentPairings.get(key);
  if (!pairedAt) return false;
  // Avoid rematching the exact same pair for 3 minutes (180,000ms)
  return Date.now() - pairedAt < 180000;
}

function recordRecentPair(userA: string, userB: string) {
  const key = getPairKey(userA, userB);
  recentPairings.set(key, Date.now());
}

// -----------------------------------------------------------------------------
// MATCHMAKING CORE LOGIC
// -----------------------------------------------------------------------------

export function joinMatchmakingQueue(params: {
  userId: string;
  nickname: string;
  avatar: string;
  isGuest: boolean;
  languagePref: 'all' | 'bn' | 'en';
  regionPool: 'bangladesh' | 'international' | 'any';
  interests: string[];
  is18Verified: boolean;
}): { success: boolean; ticket?: QueueTicket; match?: MatchSession; error?: string } {
  const { userId, nickname, avatar, isGuest, languagePref, regionPool, interests, is18Verified } = params;
  const now = Date.now();

  // Feature flag check
  if (!currentPlatformSettings.featureFlags.randomMatchingEnabled) {
    return {
      success: false,
      error: 'Random partner matching is currently disabled by platform administrator.',
    };
  }

  // User restriction check (banned or suspended users cannot enter queue)
  const restr = checkUserRestriction(userId);
  if (restr.isRestricted && restr.restriction) {
    if (restr.restriction.type === 'banned_permanent' || restr.restriction.type.startsWith('suspended')) {
      return {
        success: false,
        error: `Account suspended (${restr.restriction.type}): ${restr.restriction.reason}`,
      };
    }
  }

  // 1. Abuse & Cooldown Protection (minimum 1.5 seconds between skips)
  const lastSkip = userSkipCooldowns.get(userId);
  if (lastSkip && now - lastSkip < 1500) {
    return {
      success: false,
      error: 'Please wait a moment before searching for another partner (cooldown active).',
    };
  }
  userSkipCooldowns.set(userId, now);

  // 2. Clean up any existing active ticket or match for this user
  if (userActiveTickets.has(userId)) {
    const oldTicketId = userActiveTickets.get(userId)!;
    waitingQueue.delete(oldTicketId);
    userActiveTickets.delete(userId);
  }

  if (userActiveMatches.has(userId)) {
    const oldMatchId = userActiveMatches.get(userId)!;
    disconnectMatch(oldMatchId, userId);
  }

  // 3. Create Ticket
  const ticketId = `tkt_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const ticket: QueueTicket = {
    ticketId,
    userId,
    nickname: nickname.trim().slice(0, 24),
    avatar: avatar || '⚡',
    isGuest,
    languagePref: languagePref || 'all',
    regionPool: regionPool || 'bangladesh',
    interests: Array.isArray(interests) ? interests.slice(0, 5) : [],
    is18Verified: Boolean(is18Verified),
    status: 'waiting',
    createdAt: now,
    lastHeartbeat: now,
  };

  // 4. Atomic Search for Candidate in Queue
  const match = attemptPairing(ticket);
  if (match) {
    return { success: true, match };
  }

  // If no match found immediately, place ticket in waiting queue
  waitingQueue.set(ticketId, ticket);
  userActiveTickets.set(userId, ticketId);

  return { success: true, ticket };
}

function attemptPairing(ticket: QueueTicket): MatchSession | null {
  const now = Date.now();
  let bestCandidate: QueueTicket | null = null;
  let bestScore = -1;

  for (const [candidateId, candidate] of waitingQueue.entries()) {
    // Cannot match oneself
    if (candidate.userId === ticket.userId) continue;

    // Must be actively waiting
    if (candidate.status !== 'waiting') continue;

    // Expiration check (stale ticket > 40s)
    if (now - candidate.lastHeartbeat > 40000) {
      waitingQueue.delete(candidateId);
      userActiveTickets.delete(candidate.userId);
      continue;
    }

    // Candidate restriction check
    const candRestr = checkUserRestriction(candidate.userId);
    if (candRestr.isRestricted) {
      waitingQueue.delete(candidateId);
      userActiveTickets.delete(candidate.userId);
      continue;
    }

    // Block check (bidirectional block check)
    if (isUserBlocked(ticket.userId, candidate.userId)) continue;

    // Avoid recent pairs (3-min avoidance)
    if (isRecentPair(ticket.userId, candidate.userId)) continue;

    // Region pool compatibility
    const poolCompatible =
      ticket.regionPool === 'any' ||
      candidate.regionPool === 'any' ||
      ticket.regionPool === candidate.regionPool;

    if (!poolCompatible) continue;

    // Language compatibility
    const langCompatible =
      ticket.languagePref === 'all' ||
      candidate.languagePref === 'all' ||
      ticket.languagePref === candidate.languagePref;

    if (!langCompatible) continue;

    // Scoring: shared interests boost
    let score = 10;
    const shared = ticket.interests.filter((i) => candidate.interests.includes(i));
    score += shared.length * 5;

    if (ticket.regionPool === candidate.regionPool && ticket.regionPool !== 'any') {
      score += 5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate) {
    return null;
  }

  // ATOMIC CLAIM: Remove candidate from waiting queue
  waitingQueue.delete(bestCandidate.ticketId);
  userActiveTickets.delete(bestCandidate.userId);

  // Mark status
  bestCandidate.status = 'matched';
  ticket.status = 'matched';

  const matchId = `match_${now}_${crypto.randomUUID().slice(0, 8)}`;
  const conversationId = `conv_${matchId}`;

  const sharedInterests = ticket.interests.filter((i) =>
    bestCandidate!.interests.includes(i)
  );

  const finalPool =
    ticket.regionPool === bestCandidate.regionPool
      ? ticket.regionPool
      : 'global';

  const matchSession: MatchSession = {
    matchId,
    conversationId,
    userA: {
      id: ticket.userId,
      nickname: ticket.nickname,
      avatar: ticket.avatar,
      isGuest: ticket.isGuest,
      regionPool: ticket.regionPool,
      interests: ticket.interests,
    },
    userB: {
      id: bestCandidate.userId,
      nickname: bestCandidate.nickname,
      avatar: bestCandidate.avatar,
      isGuest: bestCandidate.isGuest,
      regionPool: bestCandidate.regionPool,
      interests: bestCandidate.interests,
    },
    sharedInterests,
    regionPool: finalPool,
    language: ticket.languagePref === 'bn' ? 'Bangla' : ticket.languagePref === 'en' ? 'English' : 'Any',
    status: 'connected',
    createdAt: now,
  };

  // Register state
  activeMatches.set(matchId, matchSession);
  userActiveMatches.set(ticket.userId, matchId);
  userActiveMatches.set(bestCandidate.userId, matchId);
  recordRecentPair(ticket.userId, bestCandidate.userId);

  // Authorize conversation in messaging system
  registerConversationMembers(conversationId, [ticket.userId, bestCandidate.userId]);

  // Notify Candidate via SSE stream if listening
  const candidateStream = ticketSSEStreams.get(bestCandidate.ticketId);
  if (candidateStream) {
    try {
      candidateStream.write(
        `event: match_found\ndata: ${JSON.stringify({ match: matchSession, partner: matchSession.userA })}\n\n`
      );
    } catch {
      // ignore
    }
  }

  return matchSession;
}

export function cancelMatchmakingQueue(ticketId: string, userId: string): boolean {
  const ticket = waitingQueue.get(ticketId);
  if (ticket && ticket.userId === userId) {
    ticket.status = 'cancelled';
    waitingQueue.delete(ticketId);
    userActiveTickets.delete(userId);
    return true;
  }
  return false;
}

export function pollTicketStatus(ticketId: string, userId: string): {
  status: 'waiting' | 'matched' | 'cancelled' | 'expired';
  match?: MatchSession;
  partner?: MatchParticipant;
} {
  // Update heartbeat
  const ticket = waitingQueue.get(ticketId);
  if (ticket && ticket.userId === userId) {
    ticket.lastHeartbeat = Date.now();
  }

  // Check if matched
  const activeMatchId = userActiveMatches.get(userId);
  if (activeMatchId) {
    const match = activeMatches.get(activeMatchId);
    if (match && match.status !== 'disconnected') {
      const partner = match.userA.id === userId ? match.userB : match.userA;
      return { status: 'matched', match, partner };
    }
  }

  if (ticket && ticket.status === 'waiting') {
    return { status: 'waiting' };
  }

  return { status: 'expired' };
}

export function disconnectMatch(matchId: string, userId: string): { success: boolean; match?: MatchSession } {
  const match = activeMatches.get(matchId);
  if (!match) return { success: false };

  // Verify caller is one of the participants
  if (match.userA.id !== userId && match.userB.id !== userId) {
    return { success: false };
  }

  match.status = 'disconnected';
  match.endedAt = Date.now();
  match.endedBy = userId;

  // Clean active references
  userActiveMatches.delete(match.userA.id);
  userActiveMatches.delete(match.userB.id);

  // Notify both participants via SSE
  broadcastToMatch(matchId, 'match_ended', {
    matchId,
    endedBy: userId,
    reason: 'Partner left or skipped the chat.',
  });

  return { success: true, match };
}

export function getActiveMatchForUser(userId: string): {
  match?: MatchSession;
  partner?: MatchParticipant;
} | null {
  const matchId = userActiveMatches.get(userId);
  if (!matchId) return null;
  const match = activeMatches.get(matchId);
  if (!match || match.status === 'disconnected') return null;

  const partner = match.userA.id === userId ? match.userB : match.userA;
  return { match, partner };
}

// -----------------------------------------------------------------------------
// SSE MATCH EVENT STREAMS
// -----------------------------------------------------------------------------

export function registerTicketStream(ticketId: string, res: Response) {
  ticketSSEStreams.set(ticketId, res);
  res.write(`event: queue_connected\ndata: ${JSON.stringify({ ticketId, time: Date.now() })}\n\n`);

  res.on('close', () => {
    ticketSSEStreams.delete(ticketId);
  });
}

export function registerMatchStream(matchId: string, res: Response) {
  if (!matchSSEStreams.has(matchId)) {
    matchSSEStreams.set(matchId, new Set());
  }
  const streamSet = matchSSEStreams.get(matchId)!;
  streamSet.add(res);

  res.write(`event: match_connected\ndata: ${JSON.stringify({ matchId })}\n\n`);

  res.on('close', () => {
    streamSet.delete(res);
  });
}

function broadcastToMatch(matchId: string, eventName: string, data: any) {
  const streams = matchSSEStreams.get(matchId);
  if (!streams) return;

  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of streams) {
    try {
      res.write(payload);
    } catch {
      streams.delete(res);
    }
  }
}

// -----------------------------------------------------------------------------
// STALE QUEUE SWEEPER (Every 15 seconds)
// -----------------------------------------------------------------------------
const queueSweeper = setInterval(() => {
  const now = Date.now();
  for (const [tktId, ticket] of waitingQueue.entries()) {
    if (now - ticket.lastHeartbeat > 40000) {
      waitingQueue.delete(tktId);
      userActiveTickets.delete(ticket.userId);
    }
  }

  // Expire recent pairings older than 5 minutes
  for (const [pairKey, timestamp] of recentPairings.entries()) {
    if (now - timestamp > 300000) {
      recentPairings.delete(pairKey);
    }
  }
}, 15000);
if (queueSweeper.unref) {
  queueSweeper.unref();
}

