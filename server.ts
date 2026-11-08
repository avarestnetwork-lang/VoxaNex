import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import {
  createGuestSession,
  validateGuestToken,
  revokeGuestSession,
  cleanupExpiredSessions,
} from './src/server/guestSessionManager';
import { adminAuthMiddleware, parseCookies } from './src/server/adminAuthMiddleware';
import {
  registerRoomStream,
  registerConversationStream,
  getRoomMessages,
  postRoomMessage,
  updateRoomPresence,
  removeRoomPresence,
  getRoomPresence,
  setRoomTyping,
  registerConversationMembers,
  getConversationMessages,
  postConversationMessage,
  isConversationMember,
  registerUserDMStream,
  getUserConversations,
  setUserBlock,
  fetchSafeLinkPreview,
  searchGifs,
} from './src/server/realtimeHub';
import {
  joinMatchmakingQueue,
  cancelMatchmakingQueue,
  pollTicketStatus,
  disconnectMatch,
  getActiveMatchForUser,
  registerTicketStream,
  registerMatchStream,
} from './src/server/matchmakingEngine';
import {
  getIceServers,
  initiateCall,
  acceptCall,
  rejectCall,
  endCall,
  postSignal,
  getCallSession,
  getActiveCallForUser,
  registerUserSignalingStream,
} from './src/server/webrtcCallHub';
import {
  getForumTopics,
  getForumTopicById,
  createForumTopic,
  editForumTopic,
  toggleLockForumTopic,
  togglePinForumTopic,
  replyToForumTopic,
  deleteForumTopic,
  deleteForumReply,
  moderateForumReply,
  getBlogArticles,
  getBlogArticleBySlug,
  saveBlogArticle,
  deleteBlogArticle,
  addBlogComment,
  moderateBlogComment,
  deleteBlogComment,
  getCommunityGuides,
  getCommunityGuideBySlug,
  updateCommunityGuide,
  COMMUNITY_GUIDES,
  EXTENDED_ROOMS_CATALOG,
  getDynamicRoomsCatalog,
  createDynamicRoom,
  updateDynamicRoom,
  deleteDynamicRoom,
  submitSafetyReport,
  getPlatformReports,
  getPublicReportStatus,
  updateReportStatus,
  imposeUserRestriction,
  checkUserRestriction,
  liftUserRestriction,
  getUserRestrictions,
  submitAppeal,
  getModerationAppeals,
  reviewAppeal,
  getModerationAuditLogs,
  getAgeAssuranceConfig,
  updateAgeAssuranceConfig,
  getUserAgeAssurance,
  submitAgeDeclaration,
  initiateAgeProviderSession,
  completeAgeProviderVerification,
  revokeAgeVerification,
  isUserEligibleForAdultAreas,
  getBlockedUsers,
  addBlockedUserEntry,
  removeBlockedUserEntry,
  sendConnectionRequest,
  respondConnectionRequest,
  getUserConnections,
  exportUserData,
  purgeUserData,
  updatePlatformSettings,
  getPlatformSettings,
  getRoomModerators,
  assignRoomModerator,
  revokeRoomModerator,
} from './src/server/communityAdminHub';
import {
  validateYouTubeUrl,
  validateMediaUpload,
  removeMediaUpload,
  flagMediaUpload,
  getMediaList,
  EXTERNAL_PROVIDERS_DOCUMENTATION,
} from './src/server/mediaAndEmbedManager';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Robustly authenticate a request, supporting both registered members (Supabase JWT)
 * and guests (VoxaNex cryptographic tokens).
 */
async function computeTokenHash(token: string): Promise<string> {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function authenticateRequest(
  req: express.Request,
  dbEnv: { supabaseUrl?: string; supabaseServiceKey?: string; supabaseAnonKey?: string },
  bodyToken?: string
): Promise<{ verifiedUserId: string; isGuestCaller: boolean; guestSession?: any } | { errorCode: number; error: string }> {
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;

  const headerGuestToken = bearerToken && bearerToken.startsWith('vx_gst_') ? bearerToken : null;
  const memberJwt = bearerToken && !bearerToken.startsWith('vx_gst_') ? bearerToken : null;
  const effectiveBodyToken = bodyToken && bodyToken.startsWith('vx_gst_') ? bodyToken : null;

  // 1. Registered member priority
  if (memberJwt) {
    if (!dbEnv.supabaseUrl) {
      return { errorCode: 503, error: 'Server configuration error: Database bindings missing.' };
    }

    let verifiedUserId: string | null = null;
    try {
      const userRes = await fetch(`${dbEnv.supabaseUrl}/auth/v1/user`, {
        headers: {
          'apikey': dbEnv.supabaseAnonKey || dbEnv.supabaseServiceKey || '',
          'Authorization': `Bearer ${memberJwt}`,
        },
      });
      if (userRes.ok) {
        const userData: any = await userRes.json();
        if (userData && userData.id) {
          verifiedUserId = userData.id;
        }
      }
    } catch {
      // Intentionally swallow network errors and let verifiedUserId remain null
    }

    if (verifiedUserId) {
      return { verifiedUserId, isGuestCaller: false };
    }
    
    // Explicit rejection if JWT provided but invalid (prevent silent downgrade)
    return { errorCode: 401, error: 'Unauthorized: Invalid or expired member authentication token.' };
  }

  // 2. Guest token handling
  const finalGuestToken = headerGuestToken || effectiveBodyToken;
  if (finalGuestToken) {
    if (headerGuestToken && effectiveBodyToken && headerGuestToken !== effectiveBodyToken) {
      return { errorCode: 400, error: 'Conflicting guest authentication tokens in header and body.' };
    }

    const authCheck = validateGuestToken(finalGuestToken);
    if (!authCheck.valid || !authCheck.session) {
      return { errorCode: 401, error: `Unauthorized: ${authCheck.reason || 'Invalid or expired guest session token.'}` };
    }

    const isProdOrCi = process.env.NODE_ENV === 'production' || 
                       Boolean(process.env.CI) || 
                       process.env.ENVIRONMENT === 'production' || 
                       process.env.ENVIRONMENT === 'staging';

    if (isProdOrCi && (!dbEnv.supabaseUrl || !dbEnv.supabaseServiceKey)) {
      return { errorCode: 503, error: 'Server configuration error: Database bindings unavailable in production environment.' };
    }

    // MANDATORY: Durable database verification if bindings are available (Production Hardening)
    if (dbEnv.supabaseUrl && dbEnv.supabaseServiceKey) {
      try {
        const tokenHash = await computeTokenHash(finalGuestToken);
        const queryUrl = `${dbEnv.supabaseUrl}/rest/v1/guest_sessions?session_token_hash=eq.${encodeURIComponent(tokenHash)}&select=id,is_revoked,expires_at`;
        const res = await fetch(queryUrl, {
          headers: {
            'apikey': dbEnv.supabaseServiceKey,
            'Authorization': `Bearer ${dbEnv.supabaseServiceKey}`,
          },
        });
        if (!res.ok) {
          return { errorCode: 401, error: 'Unauthorized: Durable session verification failed.' };
        }

        const rows: any = await res.json();
        if (!Array.isArray(rows) || rows.length === 0) {
          return { errorCode: 401, error: 'Unauthorized: Guest session not recognized by durable store.' };
        }
        if (rows.length > 1) {
          return { errorCode: 401, error: 'Unauthorized: Duplicate guest session records detected.' };
        }

        const row = rows[0];
        if (row.is_revoked !== false) {
          return { errorCode: 401, error: 'Unauthorized: Guest session has been revoked by security policy.' };
        }
        if (!row.expires_at || isNaN(Date.parse(row.expires_at)) || !Number.isFinite(Date.parse(row.expires_at))) {
          return { errorCode: 401, error: 'Unauthorized: Invalid guest session expiration in database.' };
        }
        if (Date.now() >= Date.parse(row.expires_at)) {
          return { errorCode: 401, error: 'Unauthorized: Guest session has expired in database.' };
        }
      } catch {
        return { errorCode: 401, error: 'Unauthorized: Durable session verification network error.' };
      }
    }

    return { verifiedUserId: authCheck.session.id, isGuestCaller: true, guestSession: authCheck.session };
  }

  return { errorCode: 401, error: 'Unauthorized: Authentication required.' };
}

/**
 * Fetch member profile from Supabase for identity derivation.
 */
async function fetchMemberProfile(
  userId: string,
  dbEnv: { supabaseUrl?: string; supabaseServiceKey?: string }
): Promise<{ nickname: string; avatar: string }> {
  const fallback = { nickname: 'User', avatar: '👤' };
  if (!dbEnv.supabaseUrl || !dbEnv.supabaseServiceKey) return fallback;
  try {
    const res = await fetch(`${dbEnv.supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=nickname,avatar_url`, {
      headers: {
        'apikey': dbEnv.supabaseServiceKey,
        'Authorization': `Bearer ${dbEnv.supabaseServiceKey}`,
      },
    });
    if (res.ok) {
      const rows: any = await res.json();
      if (Array.isArray(rows) && rows.length > 0) {
        return {
          nickname: rows[0].nickname || fallback.nickname,
          avatar: rows[0].avatar_url || fallback.avatar,
        };
      }
    }
  } catch (err) {
    console.error('[Server] Error fetching member profile:', err);
  }
  return fallback;
}

export function createExpressApp(dbEnvOverride?: {
  supabaseUrl?: string;
  supabaseServiceKey?: string;
  supabaseAnonKey?: string;
}) {
  const app = express();

  // Supabase Env Context
  const baseSupabaseUrl = dbEnvOverride?.supabaseUrl ?? (process.env.VITE_SUPABASE_URL || '');
  const supabaseAnonKey = dbEnvOverride?.supabaseAnonKey ?? (process.env.VITE_SUPABASE_ANON_KEY || '');
  const supabaseServiceKey = dbEnvOverride?.supabaseServiceKey ?? (process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  const dbEnv = { supabaseUrl: baseSupabaseUrl, supabaseServiceKey, supabaseAnonKey };

  app.use(express.json());

  // Cross-Origin Resource Sharing (CORS) for Cloudflare Workers & external web clients
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
  });

  // ---------------------------------------------------------------------------
  // SECURE BACKEND API ROUTES
  // ---------------------------------------------------------------------------

  // System Health & Diagnostics
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'healthy',
      app: 'VoxaNex',
      phase: 'Phase 3 Real-Time Public & Private Chat',
      timestamp: new Date().toISOString(),
      supabaseConfigured: Boolean(
        process.env.VITE_SUPABASE_URL &&
        !process.env.VITE_SUPABASE_URL.includes('your-project-ref')
      ),
    });
  });

  // ---------------------------------------------------------------------------
  // GUEST SESSION ENDPOINTS
  // ---------------------------------------------------------------------------
  app.post('/api/guest/session', (req, res) => {
    const { nickname, avatar, languagePref, is18Verified, gender } = req.body || {};

    if (!nickname || typeof nickname !== 'string' || nickname.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Invalid nickname: Must be at least 2 characters.',
      });
    }

    const ipAddress =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1';

    const result = createGuestSession({
      nickname: nickname.trim(),
      avatar: avatar || '⚡',
      languagePref: languagePref === 'bn' ? 'bn' : 'en',
      is18Verified: Boolean(is18Verified),
      ipAddress,
      gender: gender || 'prefer_not_to_say',
    });

    if (!result.success || !result.session) {
      return res.status(429).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      session: {
        id: result.session.id,
        token: result.session.token,
        nickname: result.session.nickname,
        avatar: result.session.avatar,
        languagePref: result.session.languagePref,
        is18Verified: result.session.is18Verified,
        expiresAt: result.session.expiresAt,
      },
      disclaimer:
        'Guest credentials grant server-validated access to public rooms only. Guest sessions are temporary and do not provide absolute cryptographic anonymity against unlawful conduct.',
    });
  });

  app.post('/api/guest/validate', (req, res) => {
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ valid: false, reason: 'Token required' });
    }
    const result = validateGuestToken(token);
    res.json(result);
  });

  app.post('/api/guest/revoke', (req, res) => {
    const { token, sessionId } = req.body || {};
    const target = token || sessionId;
    if (!target) {
      return res.status(400).json({ success: false, error: 'Token or sessionId required' });
    }
    const revoked = revokeGuestSession(target);
    res.json({ success: revoked });
  });

  // ---------------------------------------------------------------------------
  // PUBLIC ROOM REAL-TIME ENDPOINTS
  // ---------------------------------------------------------------------------

  // SSE Real-time event stream for a room
  app.get('/api/chat/rooms/:roomId/events', (req, res) => {
    const { roomId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    registerRoomStream(roomId, res);
  });

  // Get message history with pagination
  app.get('/api/chat/rooms/:roomId/messages', (req, res) => {
    const { roomId } = req.params;
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 100);
    const before = req.query.before as string | undefined;

    const messages = getRoomMessages(roomId, limit, before);
    res.json({ success: true, messages });
  });

  // Post message to room (Authenticated User or Validated Guest)
  app.post('/api/chat/rooms/:roomId/messages', async (req, res) => {
    const { roomId } = req.params;
    const {
      senderId: clientSenderId,
      senderNickname: _clientSenderNickname,
      senderAvatar: _clientSenderAvatar,
      senderType: bodySenderType,
      guestToken,
      content,
      mediaUrl,
      mediaType,
      linkPreview,
      clientNonce,
    } = req.body || {};

    // 1. Normalize effective sender type before authorization
    const senderType = bodySenderType || 'guest';
    if (!['registered', 'guest'].includes(senderType)) {
      return res.status(400).json({ success: false, error: 'Invalid senderType.' });
    }

    // 2. Authenticate Request
    const authResult = await authenticateRequest(req, dbEnv, guestToken);
    if ('errorCode' in authResult) {
      return res.status(authResult.errorCode).json({ success: false, error: authResult.error });
    }

    const { verifiedUserId, isGuestCaller, guestSession } = authResult;

    // Cross-check declared type and verified identity
    if (isGuestCaller && senderType !== 'guest') {
      return res.status(403).json({ success: false, error: 'Forbidden: Guest session cannot claim registered identity.' });
    }
    if (!isGuestCaller && senderType !== 'registered') {
      return res.status(403).json({ success: false, error: 'Forbidden: Registered session cannot be downgraded to guest identity.' });
    }

    // 3. Identity Spoofing Check
    if (clientSenderId && clientSenderId !== verifiedUserId) {
      return res.status(403).json({ success: false, error: 'Forbidden: Sender identity mismatch (spoofing attempt rejected).' });
    }

    // 4. Derive Identity from Verified Source
    let verifiedNickname: string;
    let verifiedAvatar: string;

    if (isGuestCaller) {
      if (!guestSession || !guestSession.id) {
        return res.status(401).json({ success: false, error: 'Unauthorized: Invalid guest session.' });
      }
      verifiedNickname = guestSession.nickname;
      verifiedAvatar = guestSession.avatar;
    } else {
      const profile = await fetchMemberProfile(verifiedUserId, dbEnv);
      verifiedNickname = profile.nickname;
      verifiedAvatar = profile.avatar;
    }

    const postResult = postRoomMessage({
      roomId,
      senderId: verifiedUserId,
      senderNickname: verifiedNickname,
      senderAvatar: verifiedAvatar,
      senderType: isGuestCaller ? 'guest' : 'registered',
      rawContent: content,
      mediaUrl,
      mediaType,
      linkPreview,
      clientNonce,
    });

    if (!postResult.success) {
      return res.status(400).json({ success: false, error: postResult.error });
    }

    res.json({ success: true, message: postResult.message });
  });

  // Post presence / heartbeat
  app.post('/api/chat/rooms/:roomId/presence', async (req, res) => {
    const { roomId } = req.params;
    const { id, action, status, guestToken } = req.body || {};

    // 1. Authenticate to prevent impersonation
    const authResult = await authenticateRequest(req, dbEnv, guestToken);
    if ('errorCode' in authResult) {
      return res.status(authResult.errorCode).json({ success: false, error: authResult.error });
    }

    if (id && id !== authResult.verifiedUserId) {
      return res.status(403).json({ success: false, error: 'Forbidden: Identity mismatch in presence update.' });
    }

    if (action === 'leave' || status === 'offline') {
      removeRoomPresence(roomId, authResult.verifiedUserId);
      return res.json({ success: true, members: getRoomPresence(roomId) });
    }

    let verifiedNickname: string;
    let verifiedAvatar: string;
    let verifiedGender: string | undefined;

    if (authResult.isGuestCaller && authResult.guestSession) {
      verifiedNickname = authResult.guestSession.nickname || 'Guest';
      verifiedAvatar = authResult.guestSession.avatar || '⚡';
      verifiedGender = authResult.guestSession.gender || 'prefer_not_to_say';
    } else {
      const profile = await fetchMemberProfile(authResult.verifiedUserId, dbEnv);
      verifiedNickname = profile.nickname;
      verifiedAvatar = profile.avatar;
      verifiedGender = undefined;
    }

    updateRoomPresence(roomId, {
      id: authResult.verifiedUserId,
      nickname: verifiedNickname,
      avatar: verifiedAvatar,
      isGuest: authResult.isGuestCaller,
      gender: verifiedGender,
      lastSeen: Date.now(),
    });

    res.json({ success: true, members: getRoomPresence(roomId) });
  });

  // Get active online room members
  app.get('/api/chat/rooms/:roomId/presence', (req, res) => {
    const { roomId } = req.params;
    res.json({ success: true, members: getRoomPresence(roomId) });
  });

  // Typing indicator
  app.post('/api/chat/rooms/:roomId/typing', async (req, res) => {
    const { roomId } = req.params;
    const { memberId, isTyping, guestToken } = req.body || {};

    const authResult = await authenticateRequest(req, dbEnv, guestToken);
    if ('errorCode' in authResult) {
      return res.status(authResult.errorCode).json({ success: false, error: authResult.error });
    }

    if (memberId && memberId !== authResult.verifiedUserId) {
      return res.status(403).json({ success: false, error: 'Forbidden: Identity mismatch in typing update.' });
    }

    let verifiedNickname: string;
    if (authResult.isGuestCaller && authResult.guestSession) {
      verifiedNickname = authResult.guestSession.nickname || 'Guest';
    } else {
      const profile = await fetchMemberProfile(authResult.verifiedUserId, dbEnv);
      verifiedNickname = profile.nickname;
    }

    setRoomTyping(roomId, authResult.verifiedUserId, verifiedNickname, Boolean(isTyping));
    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // PRIVATE DIRECT MESSAGING ENDPOINTS
  // ---------------------------------------------------------------------------

  // Initialize or fetch direct conversation
  app.post('/api/chat/conversations', async (req, res) => {
    const { userId, partnerId } = req.body || {};
    if (!userId || !partnerId) {
      return res.status(400).json({ success: false, error: 'User ID and Partner ID are required.' });
    }

    // Auth verification
    const authResult = await authenticateRequest(req, dbEnv);
    if ('errorCode' in authResult) {
      return res.status(authResult.errorCode).json({ success: false, error: authResult.error });
    }

    if (authResult.verifiedUserId !== userId) {
      return res.status(403).json({ success: false, error: 'Forbidden: Identity mismatch.' });
    }

    // Deterministic conversation ID for two peers
    const sorted = [userId, partnerId].sort();
    const convId = `conv_${sorted[0]}_${sorted[1]}`;

    registerConversationMembers(convId, [userId, partnerId]);
    res.json({ success: true, conversationId: convId });
  });

  // User-level SSE Stream for incoming direct messages & notifications
  app.get('/api/chat/user/:userId/events', async (req, res) => {
    const { userId } = req.params;
    
    const authResult = await authenticateRequest(req, dbEnv, req.query.guestToken as string);
    if ('errorCode' in authResult) {
      return res.status(authResult.errorCode).json({ success: false, error: authResult.error });
    }

    if (authResult.verifiedUserId !== userId) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot subscribe to another user\'s DM stream.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    registerUserDMStream(userId, res);
  });

  // Get active conversations list for user
  app.get('/api/chat/conversations/list', async (req, res) => {
    const authResult = await authenticateRequest(req, dbEnv, req.query.guestToken as string);
    if ('errorCode' in authResult) {
      return res.status(authResult.errorCode).json({ success: false, error: authResult.error });
    }

    const convs = await getUserConversations(authResult.verifiedUserId);
    res.json({ success: true, conversations: convs });
  });

  // SSE Stream for direct 1-on-1 conversation
  app.get('/api/chat/conversations/:id/events', async (req, res) => {
    const { id } = req.params;
    
    const authResult = await authenticateRequest(req, dbEnv, req.query.guestToken as string);
    if ('errorCode' in authResult) {
      return res.status(authResult.errorCode).json({ success: false, error: authResult.error });
    }

    const isMember = await isConversationMember(id, authResult.verifiedUserId);
    if (!isMember) {
      return res.status(403).json({ success: false, error: 'Forbidden: You are not a member of this conversation.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    registerConversationStream(id, res);
  });

  // Get conversation history
  app.get('/api/chat/conversations/:id/messages', async (req, res) => {
    const { id } = req.params;
    
    const authResult = await authenticateRequest(req, dbEnv, req.query.guestToken as string);
    if ('errorCode' in authResult) {
      return res.status(authResult.errorCode).json({ success: false, error: authResult.error });
    }

    const messages = await getConversationMessages(id, authResult.verifiedUserId);
    res.json({ success: true, messages });
  });

  // Send direct message
  app.post('/api/chat/conversations/:id/messages', async (req, res) => {
    const { id } = req.params;
    const {
      guestToken,
      senderId: clientSenderId,
      senderNickname: clientSenderNickname,
      senderAvatar: clientSenderAvatar,
      content,
      mediaUrl,
      mediaType,
      linkPreview,
      clientNonce,
    } = req.body || {};

    // 1. Authenticate
    const authResult = await authenticateRequest(req, dbEnv, guestToken);
    if ('errorCode' in authResult) {
      return res.status(authResult.errorCode).json({ success: false, error: authResult.error });
    }

    const { verifiedUserId, isGuestCaller, guestSession } = authResult;

    // 2. Identity Check
    if (clientSenderId && clientSenderId !== verifiedUserId) {
      return res.status(403).json({ success: false, error: 'Forbidden: Sender identity mismatch.' });
    }

    // 3. Derive Identity
    let verifiedNickname: string;
    let verifiedAvatar: string;

    if (isGuestCaller && guestSession) {
      verifiedNickname = guestSession.nickname;
      verifiedAvatar = guestSession.avatar;
    } else {
      const profile = await fetchMemberProfile(verifiedUserId, dbEnv);
      verifiedNickname = profile.nickname;
      verifiedAvatar = profile.avatar;
    }

    const postResult = await postConversationMessage({
      conversationId: id,
      senderId: verifiedUserId,
      senderNickname: verifiedNickname,
      senderAvatar: verifiedAvatar,
      rawContent: content,
      mediaUrl,
      mediaType,
      linkPreview,
      clientNonce,
    });

    if (!postResult.success) {
      return res.status(400).json({ success: false, error: postResult.error });
    }

    res.json({ success: true, message: postResult.message });
  });

  // Block / Unblock peer
  app.post('/api/moderation/block', async (req, res) => {
    const { blockerId, targetId, targetNickname, targetAvatar, blocked, reason } = req.body || {};
    if (!blockerId || !targetId) {
      return res.status(400).json({ success: false, error: 'Both IDs are required.' });
    }
    
    const authResult = await authenticateRequest(req, dbEnv);
    if ('errorCode' in authResult) return res.status(authResult.errorCode).json(authResult);
    if (blockerId !== authResult.verifiedUserId) return res.status(403).json({ error: 'Identity mismatch.' });

    const isBlocked = Boolean(blocked);
    setUserBlock(blockerId, targetId, isBlocked);

    if (isBlocked) {
      addBlockedUserEntry({
        blockerId,
        targetId,
        targetNickname: targetNickname || targetId,
        targetAvatar: targetAvatar || '👤',
        reason,
      });
    } else {
      removeBlockedUserEntry(blockerId, targetId);
    }

    res.json({ success: true, blocked: isBlocked });
  });

  // Get user's blocked list
  app.get('/api/moderation/blocks', async (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId required.' });
    }
    const authResult = await authenticateRequest(req, dbEnv);
    if ('errorCode' in authResult) return res.status(authResult.errorCode).json(authResult);
    if (userId !== authResult.verifiedUserId) return res.status(403).json({ error: 'Identity mismatch.' });

    const blockedList = getBlockedUsers(userId);
    res.json({ success: true, blockedUsers: blockedList });
  });

  // Check active restriction status for a user
  app.get('/api/moderation/status', (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId required.' });
    }
    const status = checkUserRestriction(userId);
    res.json({ success: true, ...status });
  });

  // ---------------------------------------------------------------------------
  // RANDOM MATCHMAKING ENGINE ROUTES (Phase 4)
  // ---------------------------------------------------------------------------

  // Join Queue or Attempt Immediate Match
  app.post('/api/matchmaking/join', (req, res) => {
    const { userId, nickname, avatar, isGuest, languagePref, regionPool, interests, is18Verified } = req.body || {};

    if (!userId || !nickname) {
      return res.status(400).json({ success: false, error: 'User ID and nickname are required.' });
    }

    const result = joinMatchmakingQueue({
      userId,
      nickname,
      avatar,
      isGuest: Boolean(isGuest),
      languagePref: languagePref || 'all',
      regionPool: regionPool || 'bangladesh',
      interests: Array.isArray(interests) ? interests : [],
      is18Verified: Boolean(is18Verified),
    });

    if (!result.success) {
      return res.status(429).json({ success: false, error: result.error });
    }

    res.json(result);
  });

  // Cancel Queue Search
  app.post('/api/matchmaking/cancel', (req, res) => {
    const { ticketId, userId } = req.body || {};
    if (!ticketId || !userId) {
      return res.status(400).json({ success: false, error: 'ticketId and userId required.' });
    }

    const cancelled = cancelMatchmakingQueue(ticketId, userId);
    res.json({ success: cancelled });
  });

  // Poll Ticket Status / Heartbeat
  app.get('/api/matchmaking/status', (req, res) => {
    const ticketId = req.query.ticketId as string;
    const userId = req.query.userId as string;

    if (!ticketId || !userId) {
      return res.status(400).json({ success: false, error: 'ticketId and userId required.' });
    }

    const status = pollTicketStatus(ticketId, userId);
    res.json({ success: true, ...status });
  });

  // SSE Stream for Queue Ticket
  app.get('/api/matchmaking/queue/:ticketId/events', (req, res) => {
    const { ticketId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    registerTicketStream(ticketId, res);
  });

  // SSE Stream for Active Match Lifecycle
  app.get('/api/matchmaking/match/:matchId/events', (req, res) => {
    const { matchId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    registerMatchStream(matchId, res);
  });

  // Disconnect / Skip Active Match
  app.post('/api/matchmaking/disconnect', (req, res) => {
    const { matchId, userId } = req.body || {};
    if (!matchId || !userId) {
      return res.status(400).json({ success: false, error: 'matchId and userId required.' });
    }

    const result = disconnectMatch(matchId, userId);
    res.json(result);
  });

  // Query Current Active Match
  app.get('/api/matchmaking/active', (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId required.' });
    }

    const active = getActiveMatchForUser(userId);
    res.json({ success: true, active: active || null });
  });

  // ---------------------------------------------------------------------------
  // WEBRTC CALLING & SIGNALING ENDPOINTS (PHASE 5)
  // ---------------------------------------------------------------------------

  // Fetch STUN & configured TURN servers (never exposes long-lived secrets to client)
  app.get('/api/webrtc/ice-servers', (req, res) => {
    const iceServers = getIceServers();
    res.json({ success: true, iceServers });
  });

  // User Signaling Stream (SSE for incoming calls, answers, ICE candidates)
  app.get('/api/webrtc/signaling/:userId/events', (req, res) => {
    const { userId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    registerUserSignalingStream(userId, res);
  });

  // Initiate call
  app.post('/api/webrtc/call/initiate', (req, res) => {
    const {
      initiatorId,
      initiatorNickname,
      initiatorAvatar,
      calleeId,
      calleeNickname,
      calleeAvatar,
      mediaKind,
      conversationId,
    } = req.body || {};

    if (!initiatorId || !calleeId) {
      return res.status(400).json({ success: false, error: 'initiatorId and calleeId required.' });
    }

    const result = initiateCall({
      initiatorId,
      initiatorNickname: initiatorNickname || 'Anonymous',
      initiatorAvatar: initiatorAvatar || '👤',
      calleeId,
      calleeNickname: calleeNickname || 'Partner',
      calleeAvatar: calleeAvatar || '👤',
      mediaKind: mediaKind === 'audio' ? 'audio' : 'video',
      conversationId,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  // Accept call
  app.post('/api/webrtc/call/accept', (req, res) => {
    const { callId, calleeId } = req.body || {};
    if (!callId || !calleeId) {
      return res.status(400).json({ success: false, error: 'callId and calleeId required.' });
    }

    const result = acceptCall(callId, calleeId);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  // Reject call
  app.post('/api/webrtc/call/reject', (req, res) => {
    const { callId, calleeId, reason } = req.body || {};
    if (!callId || !calleeId) {
      return res.status(400).json({ success: false, error: 'callId and calleeId required.' });
    }

    const result = rejectCall(callId, calleeId, reason);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  // End call
  app.post('/api/webrtc/call/end', (req, res) => {
    const { callId, userId, reason } = req.body || {};
    if (!callId || !userId) {
      return res.status(400).json({ success: false, error: 'callId and userId required.' });
    }

    const result = endCall(callId, userId, reason);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  // WebRTC Signal Relay (Offer / Answer / ICE Candidates / Mute State)
  app.post('/api/webrtc/signal', (req, res) => {
    const { callId, senderId, type, payload } = req.body || {};
    if (!callId || !senderId || !type || !payload) {
      return res.status(400).json({ success: false, error: 'callId, senderId, type, and payload required.' });
    }

    const result = postSignal({ callId, senderId, type, payload });
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  // Query Active Call for User
  app.get('/api/webrtc/call/active', (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId required.' });
    }

    const call = getActiveCallForUser(userId);
    res.json({ success: true, call: call || null });
  });

  // Query Call Session Details
  app.get('/api/webrtc/call/:callId', (req, res) => {
    const { callId } = req.params;
    const userId = req.query.userId as string;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId required.' });
    }

    const call = getCallSession(callId, userId);
    if (!call) {
      return res.status(404).json({ success: false, error: 'Call not found or unauthorized.' });
    }
    res.json({ success: true, call });
  });

  // ---------------------------------------------------------------------------
  // CONTENT UTILITIES: GIFS & LINK PREVIEW
  // ---------------------------------------------------------------------------
  app.get('/api/gifs/search', (req, res) => {
    const query = (req.query.q as string) || '';
    const results = searchGifs(query);
    res.json({ success: true, gifs: results });
  });

  app.post('/api/link-preview', async (req, res) => {
    const { url } = req.body || {};
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL required' });
    }
    const preview = await fetchSafeLinkPreview(url);
    res.json({ success: true, preview });
  });

  // ---------------------------------------------------------------------------
  // PHASE 6: SAFETY, REPORTING, AGE ASSURANCE, CONNECTIONS & DATA PRIVACY
  // ---------------------------------------------------------------------------

  // Submit Actionable Safety Report
  app.post('/api/safety/report', (req, res) => {
    const {
      targetType,
      targetId,
      reportedTarget,
      reportedUserId,
      reporterId,
      reporterNickname,
      category,
      reasonText,
      evidenceSnapshot,
    } = req.body || {};

    const reporterIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1';

    const result = submitSafetyReport({
      targetType,
      targetId,
      reportedTarget: reportedTarget || 'Target',
      reportedUserId,
      reporterId,
      reporterNickname,
      reporterIp,
      category,
      reasonText,
      evidenceSnapshot,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  // Check Status of User's Own Report (Privacy Protected)
  app.get('/api/safety/report/:id', (req, res) => {
    const reporterId = req.query.reporterId as string;
    const status = getPublicReportStatus(req.params.id, reporterId);
    if (!status) {
      return res.status(404).json({ success: false, error: 'Report not found.' });
    }
    res.json({ success: true, report: status });
  });

  // Age Assurance: Configuration & Statutory Notices
  app.get('/api/safety/age-assurance/config', (req, res) => {
    res.json({ success: true, config: getAgeAssuranceConfig() });
  });

  app.post('/api/admin/age-assurance/config', adminAuthMiddleware('admin'), (req, res) => {
    const actor = (req as any).adminUser?.username || 'Admin';
    const updated = updateAgeAssuranceConfig(req.body || {}, actor);
    res.json({ success: true, config: updated });
  });

  // Age Assurance: User Status & Eligibility Check
  app.get('/api/safety/age-assurance/status', (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId required.' });
    }
    const record = getUserAgeAssurance(userId);
    const eligibility = isUserEligibleForAdultAreas(userId, userId.startsWith('guest_'));
    res.json({ success: true, record, eligibility });
  });

  // Age Assurance: Self-Declaration Submission
  app.post('/api/safety/age-assurance/declare', (req, res) => {
    const { userId, birthYear, consentAffirmed } = req.body || {};
    if (!userId || !birthYear) {
      return res.status(400).json({ success: false, error: 'userId and birthYear required.' });
    }
    const result = submitAgeDeclaration({
      userId,
      birthYear: parseInt(birthYear, 10),
      consentAffirmed: Boolean(consentAffirmed),
    });
    if (!result.success) {
      return res.status(403).json(result);
    }
    res.json(result);
  });

  // Age Assurance: Initiate Sandbox Provider Session (Persona / Yoti / Veriff)
  app.post('/api/safety/age-assurance/provider/session', (req, res) => {
    const { userId, provider } = req.body || {};
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId required.' });
    }
    const session = initiateAgeProviderSession({
      userId,
      provider: provider || 'veriff_sandbox',
    });
    res.json(session);
  });

  // Age Assurance: Complete Sandbox Provider Verification (Zero-Knowledge Hash)
  app.post('/api/safety/age-assurance/provider/complete', (req, res) => {
    const { userId, provider, sessionId, isAdultConfirmed, referenceProofToken } = req.body || {};
    if (!userId || !sessionId) {
      return res.status(400).json({ success: false, error: 'userId and sessionId required.' });
    }
    const result = completeAgeProviderVerification({
      userId,
      provider: provider || 'veriff_sandbox',
      sessionId,
      isAdultConfirmed: Boolean(isAdultConfirmed),
      referenceProofToken: referenceProofToken || 'tok_zk_proof_stub',
    });
    res.json(result);
  });

  // Age Assurance: Revoke Eligibility (Admin / Moderator)
  app.post('/api/admin/age-assurance/revoke', adminAuthMiddleware('moderator'), (req, res) => {
    const { userId, reason } = req.body || {};
    const actor = (req as any).adminUser?.username || 'Staff';
    const success = revokeAgeVerification(
      userId,
      reason || 'Eligibility revoked by moderation investigation.',
      actor
    );
    res.json({ success });
  });

  // User Connections / Friends Requests
  app.get('/api/connections', (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId required.' });
    }
    res.json({ success: true, connections: getUserConnections(userId) });
  });

  app.post('/api/connections/request', (req, res) => {
    const { requesterId, requesterNickname, requesterAvatar, recipientId, recipientNickname, recipientAvatar } = req.body || {};
    if (!requesterId || !recipientId) {
      return res.status(400).json({ success: false, error: 'Both requesterId and recipientId required.' });
    }
    const result = sendConnectionRequest({
      requesterId,
      requesterNickname: requesterNickname || 'User',
      requesterAvatar: requesterAvatar || '👤',
      recipientId,
      recipientNickname: recipientNickname || 'Partner',
      recipientAvatar: recipientAvatar || '👤',
    });
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  app.post('/api/connections/:id/respond', (req, res) => {
    const { recipientId, accept } = req.body || {};
    const conn = respondConnectionRequest(req.params.id, recipientId, Boolean(accept));
    if (!conn) {
      return res.status(404).json({ success: false, error: 'Connection request not found or unauthorized.' });
    }
    res.json({ success: true, connection: conn });
  });

  // Moderation & Restriction Status Endpoint
  app.get('/api/moderation/status', (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) {
      return res.status(400).json({ isRestricted: false, error: 'userId required.' });
    }
    const status = checkUserRestriction(userId);
    res.json(status);
  });

  app.get('/api/moderation/blocks', (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId required.' });
    }
    const blocks = getBlockedUsers(userId);
    res.json({ success: true, blockedUsers: blocks });
  });

  app.post('/api/moderation/block', (req, res) => {
    const { blockerId, targetId, targetNickname, targetAvatar, blocked, reason } = req.body || {};
    if (!blockerId || !targetId) {
      return res.status(400).json({ success: false, error: 'blockerId and targetId required.' });
    }
    if (blocked === false) {
      removeBlockedUserEntry(blockerId, targetId);
      setUserBlock(blockerId, targetId, false);
      return res.json({ success: true, message: 'User unblocked.' });
    } else {
      addBlockedUserEntry({
        blockerId,
        targetId,
        targetNickname: targetNickname || 'User',
        targetAvatar: targetAvatar || '👤',
        reason,
      });
      setUserBlock(blockerId, targetId, true);
      return res.json({ success: true, message: 'User blocked.' });
    }
  });

  // User Block & Mute Operations (Server-Side Enforced)
  app.get('/api/users/:userId/blocks', (req, res) => {
    const { userId } = req.params;
    const blocks = getBlockedUsers(userId);
    res.json({ success: true, blocks });
  });

  app.post('/api/users/block', (req, res) => {
    const { blockerId, targetId, targetNickname, targetAvatar, reason } = req.body || {};
    if (!blockerId || !targetId) {
      return res.status(400).json({ success: false, error: 'blockerId and targetId required.' });
    }
    // Update both community blocked entries and realtime hub memory
    addBlockedUserEntry({
      blockerId,
      targetId,
      targetNickname: targetNickname || 'User',
      targetAvatar: targetAvatar || '👤',
      reason,
    });
    setUserBlock(blockerId, targetId, true);
    res.json({ success: true, message: `User ${targetNickname || targetId} blocked.` });
  });

  app.post('/api/users/unblock', (req, res) => {
    const { blockerId, targetId } = req.body || {};
    if (!blockerId || !targetId) {
      return res.status(400).json({ success: false, error: 'blockerId and targetId required.' });
    }
    removeBlockedUserEntry(blockerId, targetId);
    setUserBlock(blockerId, targetId, false);
    res.json({ success: true, message: `User unblocked.` });
  });

  // Check unique username availability
  app.get('/api/users/check-username', (req, res) => {
    const username = ((req.query.username as string) || '').trim().toLowerCase();
    if (!username || username.length < 3) {
      return res.status(400).json({ available: false, error: 'Username must be at least 3 characters.' });
    }
    const reserved = ['admin', 'moderator', 'system', 'root', 'voxanex', 'official', 'support', 'help'];
    if (reserved.includes(username)) {
      return res.json({ available: false, error: 'Username is reserved by platform.' });
    }
    // Valid format: alphanumeric and underscore
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.json({ available: false, error: 'Username can only contain letters, numbers, and underscores.' });
    }
    res.json({ available: true });
  });

  // User Data Access & Export (GDPR / Right of Access)
  app.get('/api/auth/data-export', (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId required.' });
    }
    const data = exportUserData(userId);
    res.json({ success: true, export: data });
  });

  // Account Deletion & Permanent Purge
  app.post('/api/auth/delete-account', async (req, res) => {
    const { userId } = req.body || {};
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId required.' });
    }
    
    const authResult = await authenticateRequest(req, dbEnv);
    if ('errorCode' in authResult) return res.status(authResult.errorCode).json(authResult);
    if (userId !== authResult.verifiedUserId) return res.status(403).json({ error: 'Identity mismatch.' });

    const result = purgeUserData(userId);
    res.json(result);
  });

  // ---------------------------------------------------------------------------
  // ADMIN AUTHENTICATION ENDPOINTS
  // ---------------------------------------------------------------------------
  const loginAttemptsMap = new Map<string, { count: number; resetAt: number }>();

  app.get('/api/admin/me', adminAuthMiddleware('moderator'), (req, res) => {
    const adminUser = (req as any).adminUser;
    res.json({
      success: true,
      user: {
        username: adminUser?.username || 'admin',
        role: adminUser?.role || 'admin',
      },
    });
  });

  app.post('/api/admin/login', (req, res) => {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1';
    const now = Date.now();
    const record = loginAttemptsMap.get(ip);

    if (record && now < record.resetAt && record.count >= 5) {
      return res.status(429).json({
        success: false,
        error: 'Too many failed login attempts. Please try again in 15 minutes.',
      });
    }

    const { username, password } = req.body || {};
    const expectedUser = process.env.ADMIN_USER;
    const expectedHash = process.env.ADMIN_PASS_HASH;
    const secret = process.env.JWT_SECRET;

    // Fail securely if environment variables are missing or default
    if (
      !expectedUser ||
      !expectedHash ||
      !secret ||
      secret === 'fallback_secret' ||
      secret === 'change_me'
    ) {
      console.error('[Admin Auth] Missing or unsafe ADMIN_USER, ADMIN_PASS_HASH, or JWT_SECRET configuration.');
      return res.status(500).json({
        success: false,
        error: 'Administrator authentication is not properly configured on this server.',
      });
    }

    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required.',
      });
    }

    const isUserValid = username === expectedUser;
    let isPassValid = false;

    try {
      isPassValid = bcrypt.compareSync(password, expectedHash);
    } catch (err) {
      console.error('[Admin Auth] Password hash verification error:', err);
      isPassValid = false;
    }

    if (isUserValid && isPassValid) {
      loginAttemptsMap.delete(ip);
      const token = jwt.sign({ role: 'admin', username: expectedUser }, secret, {
        expiresIn: '2h',
        algorithm: 'HS256',
        issuer: 'chatlustora-auth',
        audience: 'chatlustora-admin',
      });

      res.cookie('admin_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 2 * 60 * 60 * 1000,
      });

      return res.json({
        success: true,
        user: {
          username: expectedUser,
          role: 'admin',
        },
      });
    } else {
      if (!record || now > record.resetAt) {
        loginAttemptsMap.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
      } else {
        record.count++;
      }
      return res.status(401).json({
        success: false,
        error: 'Invalid administrator credentials.',
      });
    }
  });

  app.post('/api/admin/logout', (req, res) => {
    res.clearCookie('admin_token', {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
    });
    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // PHASE 7: COMMUNITY FORUM ENDPOINTS
  // ---------------------------------------------------------------------------
  app.get('/api/forum/topics', (req, res) => {
    const category = (req.query.category as string) || 'all';
    const query = (req.query.q as string) || '';
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

    const data = getForumTopics({ category, query, page, limit });
    res.json({ success: true, ...data });
  });

  app.get('/api/forum/topics/:id', (req, res) => {
    const topic = getForumTopicById(req.params.id);
    if (!topic) {
      return res.status(404).json({ success: false, error: 'Topic not found.' });
    }
    res.json({ success: true, topic });
  });

  app.post('/api/forum/topics', async (req, res) => {
    const { authorId, authorNickname, authorAvatar, authorRole, title, category, categoryLabel, content } = req.body || {};
    if (!authorId || !title || !content) {
      return res.status(400).json({ success: false, error: 'Missing required topic fields.' });
    }

    const authResult = await authenticateRequest(req, dbEnv);
    if ('errorCode' in authResult) return res.status(authResult.errorCode).json(authResult);
    if (authorId !== authResult.verifiedUserId) return res.status(403).json({ error: 'Identity mismatch.' });

    const result = createForumTopic({
      authorId,
      authorNickname: authResult.guestSession?.nickname || authorNickname || 'Anonymous',
      authorAvatar: authResult.guestSession?.avatar || authorAvatar || '⚡',
      authorRole: authorRole || 'user',
      title,
      category: category || 'general',
      categoryLabel: categoryLabel || { en: 'General', bn: 'সাধারণ' },
      content,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  app.post('/api/forum/topics/:id/reply', async (req, res) => {
    const { authorId, authorNickname, authorAvatar, authorRole, content } = req.body || {};
    if (!authorId || !content) {
      return res.status(400).json({ success: false, error: 'Author and content required.' });
    }

    const authResult = await authenticateRequest(req, dbEnv);
    if ('errorCode' in authResult) return res.status(authResult.errorCode).json(authResult);
    if (authorId !== authResult.verifiedUserId) return res.status(403).json({ error: 'Identity mismatch.' });

    const result = replyToForumTopic({
      topicId: req.params.id,
      authorId,
      authorNickname: authResult.guestSession?.nickname || authorNickname || 'User',
      authorAvatar: authResult.guestSession?.avatar || authorAvatar || '💬',
      authorRole: authorRole || 'user',
      content,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  app.put('/api/forum/topics/:id', async (req, res) => {
    const { authorId, title, content } = req.body || {};
    const role = (req.headers['x-user-role'] as string) || req.body?.authorRole || 'user';
    
    const authResult = await authenticateRequest(req, dbEnv);
    if ('errorCode' in authResult) return res.status(authResult.errorCode).json(authResult);
    if (authorId !== authResult.verifiedUserId) return res.status(403).json({ error: 'Identity mismatch.' });

    const result = editForumTopic({
      topicId: req.params.id,
      authorId,
      authorRole: role,
      title,
      content,
    });
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  app.post('/api/forum/topics/:id/lock', adminAuthMiddleware('moderator'), (req, res) => {
    const { isLocked } = req.body || {};
    const role = (req as any).adminUser?.role || 'moderator';
    const result = toggleLockForumTopic(req.params.id, Boolean(isLocked), role);
    if (!result.success) {
      return res.status(403).json(result);
    }
    res.json(result);
  });

  app.post('/api/forum/topics/:id/pin', adminAuthMiddleware('moderator'), (req, res) => {
    const { isPinned } = req.body || {};
    const role = (req as any).adminUser?.role || 'moderator';
    const result = togglePinForumTopic(req.params.id, Boolean(isPinned), role);
    if (!result.success) {
      return res.status(403).json(result);
    }
    res.json(result);
  });

  app.delete('/api/forum/topics/:id', async (req, res) => {
    const authorId = req.query.authorId as string;
    const role = (req.headers['x-user-role'] as string) || 'user';
    
    const authResult = await authenticateRequest(req, dbEnv);
    if ('errorCode' in authResult) return res.status(authResult.errorCode).json(authResult);
    if (authorId !== authResult.verifiedUserId) return res.status(403).json({ error: 'Identity mismatch.' });

    const result = deleteForumTopic(req.params.id, authorId, role);
    if (!result.success) {
      return res.status(403).json(result);
    }
    res.json(result);
  });

  app.delete('/api/forum/replies/:id', async (req, res) => {
    const authorId = req.query.authorId as string;
    const role = (req.headers['x-user-role'] as string) || 'user';

    const authResult = await authenticateRequest(req, dbEnv);
    if ('errorCode' in authResult) return res.status(authResult.errorCode).json(authResult);
    if (authorId !== authResult.verifiedUserId) return res.status(403).json({ error: 'Identity mismatch.' });

    const result = deleteForumReply(req.params.id, authorId, role);
    if (!result.success) {
      return res.status(403).json(result);
    }
    res.json(result);
  });

  app.post('/api/forum/replies/:id/moderate', adminAuthMiddleware('moderator'), (req, res) => {
    const { status, reason } = req.body || {};
    const result = moderateForumReply(req.params.id, status, (req as any).adminUser?.username || 'Staff', reason);
    res.json({ success: result });
  });

  // ---------------------------------------------------------------------------
  // PHASE 8: COMMUNITY BLOG & GUIDES
  // ---------------------------------------------------------------------------
  app.get('/api/blog/articles', (req, res) => {
    res.json({ success: true, articles: getBlogArticles() });
  });

  app.get('/api/blog/articles/:slug', (req, res) => {
    const article = getBlogArticleBySlug(req.params.slug);
    if (!article) return res.status(404).json({ success: false, error: 'Article not found.' });
    res.json({ success: true, article });
  });

  app.post('/api/blog/articles', adminAuthMiddleware('admin'), (req, res) => {
    const article = saveBlogArticle(req.body || {});
    res.json({ success: true, article });
  });

  app.delete('/api/blog/articles/:slug', adminAuthMiddleware('admin'), (req, res) => {
    const success = deleteBlogArticle(req.params.slug);
    res.json({ success });
  });

  app.post('/api/blog/articles/:slug/comments', async (req, res) => {
    const { nickname, content } = req.body || {};
    const result = addBlogComment(req.params.slug, { nickname, content });
    res.json({ success: !!result, comment: result });
  });

  app.put('/api/blog/comments/:id', adminAuthMiddleware('moderator'), (req, res) => {
    const { status } = req.body || {};
    const success = moderateBlogComment(req.params.id, status);
    res.json({ success });
  });

  app.delete('/api/blog/comments/:id', adminAuthMiddleware('moderator'), (req, res) => {
    const success = deleteBlogComment(req.params.id);
    res.json({ success });
  });

  app.get('/api/community/guides', (req, res) => {
    res.json({ success: true, guides: getCommunityGuides() });
  });

  app.get('/api/community/guides/:slug', (req, res) => {
    const guide = getCommunityGuideBySlug(req.params.slug);
    if (!guide) return res.status(404).json({ success: false, error: 'Guide not found.' });
    res.json({ success: true, guide });
  });

  app.put('/api/community/guides/:slug', adminAuthMiddleware('admin'), (req, res) => {
    const guide = updateCommunityGuide(req.params.slug, req.body || {});
    res.json({ success: !!guide, guide });
  });

  // ---------------------------------------------------------------------------
  // DYNAMIC ROOMS CATALOG & MODERATION
  // ---------------------------------------------------------------------------
  app.get('/api/admin/rooms', adminAuthMiddleware('moderator'), (req, res) => {
    res.json({ success: true, rooms: getDynamicRoomsCatalog() });
  });

  app.post('/api/admin/rooms', adminAuthMiddleware('admin'), (req, res) => {
    const room = createDynamicRoom(req.body || {});
    res.json({ success: true, room });
  });

  app.put('/api/admin/rooms/:id', adminAuthMiddleware('admin'), (req, res) => {
    const room = updateDynamicRoom(req.params.id, req.body || {});
    if (!room) return res.status(404).json({ success: false });
    res.json({ success: true, room });
  });

  app.delete('/api/admin/rooms/:id', adminAuthMiddleware('admin'), (req, res) => {
    const success = deleteDynamicRoom(req.params.id);
    res.json({ success });
  });

  // ---------------------------------------------------------------------------
  // ADDITIONAL ADMIN & MODERATION ENDPOINTS
  // ---------------------------------------------------------------------------
  app.get('/api/admin/reports', adminAuthMiddleware('moderator'), (req, res) => {
    res.json({ success: true, reports: getPlatformReports() });
  });

  app.patch('/api/admin/reports/:id', adminAuthMiddleware('moderator'), (req, res) => {
    const { status, actionTaken, moderatorNotes } = req.body || {};
    const success = updateReportStatus(req.params.id, status, actionTaken, (req as any).adminUser?.username || 'Staff', moderatorNotes);
    res.json({ success });
  });

  app.post('/api/admin/restrictions', adminAuthMiddleware('moderator'), (req, res) => {
    const result = imposeUserRestriction(req.body || {}, (req as any).adminUser?.username || 'Staff');
    res.json({ success: !!result, restriction: result });
  });

  app.get('/api/admin/restrictions', adminAuthMiddleware('moderator'), (req, res) => {
    res.json({ success: true, restrictions: getUserRestrictions() });
  });

  app.post('/api/admin/restrictions/:id/lift', adminAuthMiddleware('moderator'), (req, res) => {
    const success = liftUserRestriction(req.params.id, (req as any).adminUser?.username || 'Staff', req.body.reason);
    res.json({ success });
  });

  app.post('/api/moderation/appeals', async (req, res) => {
    const result = submitAppeal(req.body || {});
    res.json({ success: !!result, appeal: result });
  });

  app.get('/api/admin/appeals', adminAuthMiddleware('moderator'), (req, res) => {
    res.json({ success: true, appeals: getModerationAppeals() });
  });

  app.post('/api/admin/appeals/:id/review', adminAuthMiddleware('moderator'), (req, res) => {
    const { status, notes } = req.body || {};
    const success = reviewAppeal(req.params.id, status, (req as any).adminUser?.username || 'Staff', notes);
    res.json({ success });
  });

  app.get('/api/admin/audit-logs', adminAuthMiddleware('admin'), (req, res) => {
    res.json({ success: true, logs: getModerationAuditLogs() });
  });

  app.get('/api/admin/settings', adminAuthMiddleware('moderator'), (req, res) => {
    res.json({ success: true, settings: getPlatformSettings() });
  });

  app.post('/api/admin/settings', adminAuthMiddleware('admin'), (req, res) => {
    const settings = updatePlatformSettings(req.body || {}, (req as any).adminUser?.username || 'Admin');
    res.json({ success: true, settings });
  });

  app.get('/api/chat/rooms/:roomId/moderators', (req, res) => {
    res.json({ success: true, moderators: getRoomModerators(req.params.roomId) });
  });

  app.post('/api/chat/rooms/:roomId/moderators', adminAuthMiddleware('admin'), (req, res) => {
    const success = assignRoomModerator(req.params.roomId, req.body.userId, req.body.nickname);
    res.json({ success });
  });

  app.delete('/api/chat/rooms/:roomId/moderators/:userId', adminAuthMiddleware('admin'), (req, res) => {
    const success = revokeRoomModerator(req.params.roomId, req.params.userId);
    res.json({ success });
  });

  // ---------------------------------------------------------------------------
  // MEDIA ENDPOINTS
  // ---------------------------------------------------------------------------
  app.post('/api/media/upload', async (req, res) => {
    const result = validateMediaUpload(req.body || {});
    res.status(result.valid ? 200 : 400).json(result);
  });

  app.get('/api/media/list', adminAuthMiddleware('moderator'), (req, res) => {
    res.json({ success: true, media: getMediaList((req as any).adminUser?.role) });
  });

  app.delete('/api/media/:id', adminAuthMiddleware('moderator'), (req, res) => {
    const success = removeMediaUpload(req.params.id, (req as any).adminUser?.role);
    res.json({ success });
  });

  app.post('/api/media/:id/flag', (req, res) => {
    const success = flagMediaUpload(req.params.id);
    res.json({ success });
  });

  return app;
}

async function startServer() {
  const app = createExpressApp();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const isProd = process.env.NODE_ENV === 'production';

  // Periodically clean up expired guest sessions every 15 minutes
  setInterval(() => {
    cleanupExpiredSessions();
  }, 15 * 60 * 1000);

  // Serve static assets from public folder (logos, favicons, robots.txt, sitemap.xml, manifest.json)
  app.use(express.static(path.resolve(__dirname, 'public')));
  app.get('/robots.txt', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'public', 'robots.txt'));
  });
  app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml').sendFile(path.resolve(__dirname, 'public', 'sitemap.xml'));
  });

  // ---------------------------------------------------------------------------
  // VITE DEV MIDDLEWARE
  // ---------------------------------------------------------------------------
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, port: PORT },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ChatLustora Backend] Server operational on http://0.0.0.0:${PORT}`);
  });
}

const isMainModule = Boolean(
  process.argv[1] && 
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
   process.argv[1].endsWith('/server.ts') || 
   process.argv[1].endsWith('/server.js') || 
   process.argv[1] === 'server.ts' || 
   process.argv[1] === 'server.js') &&
  !process.argv[1].includes('test')
);

if (isMainModule) {
  startServer().catch((err) => {
    console.error('[ChatLustora Backend] Fatal startup error:', err);
    process.exit(1);
  });
}
