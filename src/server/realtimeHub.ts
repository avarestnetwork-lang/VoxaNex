import { Response } from 'express';
import crypto from 'crypto';
import dns from 'dns';
import { promisify } from 'util';
import { validateGuestToken } from './guestSessionManager';
import { getSupabaseClient } from '../lib/supabaseClient';
import { databaseService } from '../services/databaseService';
import {
  checkUserRestriction,
  isUserEligibleForAdultAreas,
  filterProhibitedContent,
} from './communityAdminHub';

const lookupAsync = promisify(dns.lookup);

export interface HubMessage {
  id: string;
  roomId?: string;
  conversationId?: string;
  senderId: string;
  senderNickname: string;
  senderAvatar: string;
  senderType: 'registered' | 'guest' | 'system';
  content: string;
  rawContent: string;
  mediaUrl?: string;
  mediaType?: 'gif' | 'image';
  linkPreview?: {
    url: string;
    title?: string;
    description?: string;
    image?: string;
  };
  clientNonce?: string;
  timestamp: string; // ISO 8601
  status: 'delivered';
}

export interface PresenceMember {
  id: string;
  nickname: string;
  avatar: string;
  isGuest: boolean;
  lastSeen: number;
  gender?: string;
}

// In-memory data stores
const roomMessages = new Map<string, HubMessage[]>();
const conversationMessages = new Map<string, HubMessage[]>();
const conversationMembers = new Map<string, Set<string>>(); // conversationId -> Set of userIds
const userBlocks = new Map<string, Set<string>>(); // blockerId -> Set of blockedIds

// SSE active response streams
const roomSSEStreams = new Map<string, Set<Response>>();
const conversationSSEStreams = new Map<string, Set<Response>>();
const userDMStreams = new Map<string, Set<Response>>(); // userId -> Set of active SSE streams

// Typing indicators & Presence
const roomPresence = new Map<string, Map<string, PresenceMember>>(); // roomId -> (memberId -> PresenceMember)
const roomTyping = new Map<string, Map<string, { nickname: string; expiresAt: number }>>(); // roomId -> (memberId -> info)

// Rate limiting & spam detection
const recentUserMessages = new Map<string, { lastText: string; lastTime: number; count: number; windowStart: number }>();

// -----------------------------------------------------------------------------
// SANITIZATION & SECURITY HELPERS
// -----------------------------------------------------------------------------

export function sanitizeContent(input: string): string {
  if (!input) return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // Strip non-printable control chars
    .trim();
}

export function extractSafeUrl(text: string): string | null {
  const urlRegex = /(https?:\/\/[^\s<>"']+)/i;
  const match = text.match(urlRegex);
  if (!match) return null;

  try {
    const parsed = new URL(match[0]);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}

export function checkRateLimitAndSpam(
  senderId: string,
  content: string
): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const userRecord = recentUserMessages.get(senderId) || {
    lastText: '',
    lastTime: 0,
    count: 0,
    windowStart: now,
  };

  // 1. Throttling minimum interval between sends (500ms)
  if (now - userRecord.lastTime < 500) {
    return { allowed: false, reason: 'Sending too quickly. Please wait a moment.' };
  }

  // 2. Duplicate content spam within 4 seconds
  if (userRecord.lastText === content && now - userRecord.lastTime < 4000) {
    return { allowed: false, reason: 'Repeated identical messages throttled.' };
  }

  // 3. Sliding window limit (30 messages per 60 seconds)
  if (now - userRecord.windowStart > 60000) {
    userRecord.count = 0;
    userRecord.windowStart = now;
  }

  if (userRecord.count >= 30) {
    return { allowed: false, reason: 'Message rate limit exceeded. Please slow down.' };
  }

  userRecord.count += 1;
  userRecord.lastTime = now;
  userRecord.lastText = content;
  recentUserMessages.set(senderId, userRecord);

  return { allowed: true };
}

// -----------------------------------------------------------------------------
// SSE BROADCAST ENGINE
// -----------------------------------------------------------------------------

function broadcastToRoom(roomId: string, eventName: string, data: any) {
  const streams = roomSSEStreams.get(roomId);
  if (!streams || streams.size === 0) return;

  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of streams) {
    try {
      res.write(payload);
    } catch {
      streams.delete(res);
    }
  }
}

function broadcastToConversation(convId: string, eventName: string, data: any) {
  const streams = conversationSSEStreams.get(convId);
  if (!streams || streams.size === 0) return;

  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of streams) {
    try {
      res.write(payload);
    } catch {
      streams.delete(res);
    }
  }
}

export function registerRoomStream(roomId: string, res: Response) {
  if (!roomSSEStreams.has(roomId)) {
    roomSSEStreams.set(roomId, new Set());
  }
  const streamSet = roomSSEStreams.get(roomId)!;
  streamSet.add(res);

  // Send initial keepalive
  res.write(`event: connected\ndata: ${JSON.stringify({ roomId, timestamp: new Date().toISOString() })}\n\n`);

  res.on('close', () => {
    streamSet.delete(res);
  });
}

export function registerConversationStream(convId: string, res: Response) {
  if (!conversationSSEStreams.has(convId)) {
    conversationSSEStreams.set(convId, new Set());
  }
  const streamSet = conversationSSEStreams.get(convId)!;
  streamSet.add(res);

  res.write(`event: connected\ndata: ${JSON.stringify({ convId, timestamp: new Date().toISOString() })}\n\n`);

  res.on('close', () => {
    streamSet.delete(res);
  });
}

export function registerUserDMStream(userId: string, res: Response) {
  if (!userDMStreams.has(userId)) {
    userDMStreams.set(userId, new Set());
  }
  const streamSet = userDMStreams.get(userId)!;
  streamSet.add(res);

  res.write(`event: connected\ndata: ${JSON.stringify({ userId, timestamp: new Date().toISOString() })}\n\n`);

  res.on('close', () => {
    streamSet.delete(res);
  });
}

export function broadcastToUser(userId: string, event: string, data: any) {
  const streamSet = userDMStreams.get(userId);
  if (!streamSet || streamSet.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of streamSet) {
    try {
      res.write(payload);
    } catch {
      streamSet.delete(res);
    }
  }
}

// -----------------------------------------------------------------------------
// PUBLIC ROOM OPERATIONS
// -----------------------------------------------------------------------------

export function getRoomMessages(roomId: string, limit = 50, beforeTimestamp?: string): HubMessage[] {
  const list = roomMessages.get(roomId) || [];
  if (!beforeTimestamp) {
    return list.slice(-limit);
  }

  const cutoff = new Date(beforeTimestamp).getTime();
  const filtered = list.filter((m) => new Date(m.timestamp).getTime() < cutoff);
  return filtered.slice(-limit);
}

export function postRoomMessage(params: {
  roomId: string;
  senderId: string;
  senderNickname: string;
  senderAvatar: string;
  senderType: 'registered' | 'guest';
  rawContent: string;
  mediaUrl?: string;
  mediaType?: 'gif' | 'image';
  linkPreview?: any;
  clientNonce?: string;
}): { success: boolean; message?: HubMessage; error?: string } {
  const { roomId, senderId, senderNickname, senderAvatar, senderType, rawContent } = params;

  if (!rawContent || rawContent.trim().length === 0) {
    return { success: false, error: 'Message cannot be empty.' };
  }

  if (rawContent.length > 2000) {
    return { success: false, error: 'Message exceeds maximum length of 2000 characters.' };
  }

  // 1. Check user restriction (ban/suspension/mute)
  const restr = checkUserRestriction(senderId);
  if (restr.isRestricted && restr.restriction) {
    if (restr.restriction.type === 'banned_permanent' || restr.restriction.type.startsWith('suspended')) {
      return { success: false, error: `Account suspended (${restr.restriction.type}): ${restr.restriction.reason}` };
    }
    if (restr.restriction.type === 'muted') {
      return { success: false, error: `You are currently muted from posting: ${restr.restriction.reason}` };
    }
  }

  // 2. Adult Room 18+ Verification check
  if (roomId === 'room-bangla-adult') {
    const adultCheck = isUserEligibleForAdultAreas(senderId, senderType === 'guest');
    if (!adultCheck.eligible) {
      return { success: false, error: adultCheck.reason || 'Adult eligibility check failed: 18+ verification required.' };
    }
  }

  // 3. Prohibited content filter
  const filter = filterProhibitedContent(rawContent);
  if (filter.flagged) {
    return { success: false, error: filter.reason || 'Prohibited content detected.' };
  }

  if (!roomMessages.has(roomId)) {
    roomMessages.set(roomId, []);
  }

  const list = roomMessages.get(roomId)!;

  // Deduplicate by clientNonce (check before rate limits for retry resilience)
  if (params.clientNonce && list.some((m) => m.clientNonce === params.clientNonce)) {
    const existing = list.find((m) => m.clientNonce === params.clientNonce)!;
    return { success: true, message: existing };
  }

  // Rate limit
  const rateCheck = checkRateLimitAndSpam(senderId, rawContent);
  if (!rateCheck.allowed) {
    return { success: false, error: rateCheck.reason };
  }

  // Sanitize and construct message
  const cleanContent = sanitizeContent(rawContent);

  const message: HubMessage = {
    id: `msg_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    roomId,
    senderId,
    senderNickname,
    senderAvatar,
    senderType,
    content: cleanContent,
    rawContent,
    mediaUrl: params.mediaUrl,
    mediaType: params.mediaType,
    linkPreview: params.linkPreview,
    clientNonce: params.clientNonce,
    timestamp: new Date().toISOString(),
    status: 'delivered',
  };

  list.push(message);

  // Keep last 500 messages in memory per room
  if (list.length > 500) {
    list.shift();
  }

  // Broadcast to all listening clients in this room via local SSE
  broadcastToRoom(roomId, 'new_message', message);

  // Cross-environment delivery: Broadcast to Supabase Realtime if configured
  try {
    databaseService.broadcastMessage(roomId, message as any);
  } catch (e) {
    console.warn('[VX-RT] Failed to broadcast room message to Supabase:', e);
  }

  return { success: true, message };
}


export function updateRoomPresence(roomId: string, member: PresenceMember) {
  // Adult room presence gate: Never permit unverified participants or minors
  if (roomId === 'room-bangla-adult') {
    const adultCheck = isUserEligibleForAdultAreas(member.id, member.isGuest);
    if (!adultCheck.eligible) {
      return; // Do not register presence for ineligible users
    }
  }

  if (!roomPresence.has(roomId)) {
    roomPresence.set(roomId, new Map());
  }
  const members = roomPresence.get(roomId)!;
  members.set(member.id, { ...member, lastSeen: member.lastSeen || Date.now() });

  // Clean stale presence older than 45 seconds
  const now = Date.now();
  for (const [id, m] of members.entries()) {
    if (now - m.lastSeen > 45000) {
      members.delete(id);
    }
  }

  broadcastToRoom(roomId, 'presence_update', Array.from(members.values()));
}

export function removeRoomPresence(roomId: string, memberId: string) {
  if (!roomPresence.has(roomId)) return;
  const members = roomPresence.get(roomId)!;
  members.delete(memberId);
  broadcastToRoom(roomId, 'presence_update', Array.from(members.values()));
}

export function getRoomPresence(roomId: string): PresenceMember[] {
  const members = roomPresence.get(roomId);
  if (!members) return [];
  const now = Date.now();
  return Array.from(members.values()).filter((m) => now - m.lastSeen <= 45000);
}

export function setRoomTyping(roomId: string, memberId: string, nickname: string, isTyping: boolean) {
  if (!roomTyping.has(roomId)) {
    roomTyping.set(roomId, new Map());
  }
  const typers = roomTyping.get(roomId)!;

  if (isTyping) {
    typers.set(memberId, { nickname, expiresAt: Date.now() + 3000 });
  } else {
    typers.delete(memberId);
  }

  // Filter expired
  const now = Date.now();
  for (const [id, t] of typers.entries()) {
    if (now > t.expiresAt) typers.delete(id);
  }

  const activeTypers = Array.from(typers.values()).map((t) => t.nickname);
  broadcastToRoom(roomId, 'typing_update', { roomId, typers: activeTypers });
}

// -----------------------------------------------------------------------------
// PRIVATE CONVERSATION OPERATIONS
// -----------------------------------------------------------------------------

export function registerConversationMembers(convId: string, memberIds: string[]) {
  if (!conversationMembers.has(convId)) {
    conversationMembers.set(convId, new Set());
  }
  const set = conversationMembers.get(convId)!;
  memberIds.forEach((id) => set.add(id));
}

// Check persistent membership
async function isPersistentMember(convId: string, userId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  try {
    const { data } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', convId)
      .eq('user_id', userId)
      .single();
    return !!data;
  } catch {
    return false;
  }
}

export async function isConversationMember(convId: string, userId: string): Promise<boolean> {
  const members = conversationMembers.get(convId);
  if (members && members.has(userId)) return true;
  
  // Try persistent check
  if (await isPersistentMember(convId, userId)) {
    registerConversationMembers(convId, [userId]);
    return true;
  }

  // Fallback: check deterministic convId format "conv_<id1>_<id2>"
  if (convId.startsWith('conv_')) {
    const withoutPrefix = convId.slice(5);
    if (withoutPrefix.startsWith(userId + '_')) {
      const partnerId = withoutPrefix.slice(userId.length + 1);
      if (partnerId) {
        registerConversationMembers(convId, [userId, partnerId]);
        return true;
      }
    } else if (withoutPrefix.endsWith('_' + userId)) {
      const partnerId = withoutPrefix.slice(0, withoutPrefix.length - userId.length - 1);
      if (partnerId) {
        registerConversationMembers(convId, [partnerId, userId]);
        return true;
      }
    } else if (withoutPrefix === userId) {
      registerConversationMembers(convId, [userId]);
      return true;
    }
  }
  return false;
}

export async function getUserConversations(userId: string): Promise<string[]> {
  const result = new Set<string>();
  for (const [convId, members] of conversationMembers.entries()) {
    if (members.has(userId)) result.add(convId);
  }
  for (const convId of conversationMessages.keys()) {
    if (await isConversationMember(convId, userId)) result.add(convId);
  }
  return Array.from(result);
}

export async function getConversationMessages(convId: string, requesterId: string, limit = 50): Promise<HubMessage[]> {
  if (!(await isConversationMember(convId, requesterId))) {
    return [];
  }
  
  // Use durable source
  const msgs = await databaseService.getConversationMessages(convId);
  return msgs as HubMessage[];
}

export async function postConversationMessage(params: {
  conversationId: string;
  senderId: string;
  senderNickname: string;
  senderAvatar: string;
  rawContent: string;
  mediaUrl?: string;
  mediaType?: 'gif' | 'image';
  linkPreview?: any;
  clientNonce?: string;
}): Promise<{ success: boolean; message?: HubMessage; error?: string }> {
  const { conversationId, senderId, senderNickname, senderAvatar, rawContent } = params;

  // Authorization check
  if (!(await isConversationMember(conversationId, senderId))) {
    return { success: false, error: 'Unauthorized: You are not a member of this conversation.' };
  }

  // Derive recipientId server-side
  let members = conversationMembers.get(conversationId);
  if ((!members || members.size < 2) && conversationId.startsWith('conv_')) {
    const withoutPrefix = conversationId.slice(5);
    if (withoutPrefix.startsWith(senderId + '_')) {
      const partnerId = withoutPrefix.slice(senderId.length + 1);
      if (partnerId) registerConversationMembers(conversationId, [senderId, partnerId]);
    } else if (withoutPrefix.endsWith('_' + senderId)) {
      const partnerId = withoutPrefix.slice(0, withoutPrefix.length - senderId.length - 1);
      if (partnerId) registerConversationMembers(conversationId, [partnerId, senderId]);
    }
    members = conversationMembers.get(conversationId);
  }

  if (!members || members.size < 2) {
      return { success: false, error: 'Recipient not found in conversation.' };
  }
  const recipientId = Array.from(members).find(id => id !== senderId) || '';

  // Suspension / Ban check
  const restr = checkUserRestriction(senderId);
  if (restr.isRestricted && restr.restriction) {
    if (restr.restriction.type === 'banned_permanent' || restr.restriction.type.startsWith('suspended')) {
      return { success: false, error: `Account suspended (${restr.restriction.type}): ${restr.restriction.reason}` };
    }
    if (restr.restriction.type === 'muted') {
      return { success: false, error: `You are currently muted: ${restr.restriction.reason}` };
    }
  }

  // Bidirectional Block check
  if (isUserBlocked(senderId, recipientId)) {
    return { success: false, error: 'Unable to deliver message: Direct communication blocked between participants.' };
  }

  if (!rawContent || rawContent.trim().length === 0) {
    return { success: false, error: 'Message cannot be empty.' };
  }

  if (rawContent.length > 2000) {
    return { success: false, error: 'Message exceeds maximum length.' };
  }

  // Prohibited content filter
  const filter = filterProhibitedContent(rawContent);
  if (filter.flagged) {
    return { success: false, error: filter.reason || 'Prohibited content detected.' };
  }

  // Rate check
  const rate = checkRateLimitAndSpam(senderId, rawContent);
  if (!rate.allowed) {
    return { success: false, error: rate.reason };
  }

  // Sanitize and construct message
  const cleanContent = sanitizeContent(rawContent);

  const message: HubMessage = {
    id: `dm_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    conversationId,
    senderId,
    senderNickname,
    senderAvatar,
    senderType: 'registered',
    content: cleanContent,
    rawContent,
    mediaUrl: params.mediaUrl,
    mediaType: params.mediaType,
    linkPreview: params.linkPreview,
    clientNonce: params.clientNonce,
    timestamp: new Date().toISOString(),
    status: 'delivered',
  };

  // Broadcast via Supabase
  try {
    const [status1, status2] = await Promise.all([
      databaseService.broadcastDM(conversationId, recipientId, message as any),
      databaseService.broadcastToUser(recipientId, 'incoming_dm', { conversationId, message })
    ]);
    console.log(`[VX-DM] [${conversationId}] Supabase broadcast results: ${status1}, ${status2}`);
  } catch (e) {
    console.error('[VX-DM] Failed to broadcast DM via Supabase:', e);
    return { success: false, error: 'Message persistence or delivery failed.' };
  }
  
  return { success: true, message };
}


export function setUserBlock(blockerId: string, targetId: string, blocked: boolean) {
  if (!userBlocks.has(blockerId)) {
    userBlocks.set(blockerId, new Set());
  }
  const set = userBlocks.get(blockerId)!;
  if (blocked) {
    set.add(targetId);
  } else {
    set.delete(targetId);
  }
}

export function isUserBlocked(userA: string, userB: string): boolean {
  const blocksA = userBlocks.get(userA);
  const blocksB = userBlocks.get(userB);
  return Boolean((blocksA && blocksA.has(userB)) || (blocksB && blocksB.has(userA)));
}

// -----------------------------------------------------------------------------
// SAFE LINK PREVIEW WITH SSRF PROTECTION
// -----------------------------------------------------------------------------

function isPrivateIP(ip: string): boolean {
  return (
    ip.startsWith('127.') ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('169.254.') ||
    ip === '::1' ||
    ip === '0.0.0.0' ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

export async function fetchSafeLinkPreview(rawUrl: string): Promise<{
  url: string;
  title?: string;
  description?: string;
  image?: string;
} | null> {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    // SSRF Check: resolve DNS
    const { address } = await lookupAsync(parsed.hostname);
    if (isPrivateIP(address)) {
      return null; // Block internal server requests
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000); // 3s timeout

    const response = await fetch(parsed.href, {
      signal: controller.signal,
      headers: { 'User-Agent': 'VoxaNex-LinkPreview-Bot/1.0' },
    });
    clearTimeout(timeout);

    if (!response.ok) return null;
    const text = await response.text();

    const titleMatch = text.match(/<meta property="og:title" content="([^"]+)"/i) || text.match(/<title>([^<]+)<\/title>/i);
    const descMatch = text.match(/<meta property="og:description" content="([^"]+)"/i) || text.match(/<meta name="description" content="([^"]+)"/i);
    const imgMatch = text.match(/<meta property="og:image" content="([^"]+)"/i);

    return {
      url: parsed.href,
      title: titleMatch ? sanitizeContent(titleMatch[1]).slice(0, 100) : undefined,
      description: descMatch ? sanitizeContent(descMatch[1]).slice(0, 180) : undefined,
      image: imgMatch ? imgMatch[1] : undefined,
    };
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// CURATED SAFE GIF PROVIDER
// -----------------------------------------------------------------------------

const CURATED_GIFS = [
  { id: 'gif-1', title: 'Thumbs Up / Good Job', url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80', tags: ['thumbsup', 'nice', 'valo'] },
  { id: 'gif-2', title: 'Celebrate / Party', url: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=400&q=80', tags: ['party', 'celebrate', 'anondo'] },
  { id: 'gif-3', title: 'Wave / Hello Dhaka', url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80', tags: ['hello', 'hi', 'kmn acho'] },
  { id: 'gif-4', title: 'Tea Cup / Cha Adda', url: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=400&q=80', tags: ['tea', 'cha', 'adda'] },
  { id: 'gif-5', title: 'Laughing / Haha', url: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=400&q=80', tags: ['laugh', 'haha', 'lol'] },
  { id: 'gif-6', title: 'Love & Heart', url: 'https://images.unsplash.com/photo-1518199266791-5375a83190b7?auto=format&fit=crop&w=400&q=80', tags: ['love', 'heart', 'valobashi'] },
];

export function searchGifs(query = ''): typeof CURATED_GIFS {
  if (!query.trim()) return CURATED_GIFS;
  const q = query.toLowerCase().trim();
  return CURATED_GIFS.filter(
    (g) => g.title.toLowerCase().includes(q) || g.tags.some((t) => t.includes(q))
  );
}
