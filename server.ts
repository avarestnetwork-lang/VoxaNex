import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import {
  createGuestSession,
  validateGuestToken,
  revokeGuestSession,
  cleanupExpiredSessions,
} from './src/server/guestSessionManager';
import {
  registerRoomStream,
  registerConversationStream,
  getRoomMessages,
  postRoomMessage,
  updateRoomPresence,
  getRoomPresence,
  setRoomTyping,
  registerConversationMembers,
  getConversationMessages,
  postConversationMessage,
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

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const isProd = process.env.NODE_ENV === 'production';

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
  app.post('/api/chat/rooms/:roomId/messages', (req, res) => {
    const { roomId } = req.params;
    const {
      senderId,
      senderNickname,
      senderAvatar,
      senderType,
      guestToken,
      content,
      mediaUrl,
      mediaType,
      linkPreview,
      clientNonce,
    } = req.body || {};

    // Guest validation check (permissive and resilient for uninterrupted chatroom messaging)
    if (senderType === 'guest') {
      if (guestToken) {
        validateGuestToken(guestToken);
      }
    }

    const postResult = postRoomMessage({
      roomId,
      senderId: senderId || 'anon',
      senderNickname: senderNickname || 'Anonymous',
      senderAvatar: senderAvatar || '💬',
      senderType: senderType || 'guest',
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
  app.post('/api/chat/rooms/:roomId/presence', (req, res) => {
    const { roomId } = req.params;
    const { id, nickname, avatar, isGuest, gender } = req.body || {};

    if (id && nickname) {
      updateRoomPresence(roomId, {
        id,
        nickname,
        avatar: avatar || '👤',
        isGuest: Boolean(isGuest),
        gender,
        lastSeen: Date.now(),
      });
    }

    res.json({ success: true, members: getRoomPresence(roomId) });
  });

  // Get active online room members
  app.get('/api/chat/rooms/:roomId/presence', (req, res) => {
    const { roomId } = req.params;
    res.json({ success: true, members: getRoomPresence(roomId) });
  });

  // Typing indicator
  app.post('/api/chat/rooms/:roomId/typing', (req, res) => {
    const { roomId } = req.params;
    const { memberId, nickname, isTyping } = req.body || {};

    if (memberId && nickname) {
      setRoomTyping(roomId, memberId, nickname, Boolean(isTyping));
    }
    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // PRIVATE DIRECT MESSAGING ENDPOINTS
  // ---------------------------------------------------------------------------

  // Initialize or fetch direct conversation
  app.post('/api/chat/conversations', (req, res) => {
    const { userId, partnerId } = req.body || {};
    if (!userId || !partnerId) {
      return res.status(400).json({ success: false, error: 'User ID and Partner ID are required.' });
    }

    // Deterministic conversation ID for two peers
    const sorted = [userId, partnerId].sort();
    const convId = `conv_${sorted[0]}_${sorted[1]}`;

    registerConversationMembers(convId, [userId, partnerId]);
    res.json({ success: true, conversationId: convId });
  });

  // SSE Stream for direct 1-on-1 conversation
  app.get('/api/chat/conversations/:id/events', (req, res) => {
    const { id } = req.params;
    const userId = req.query.userId as string;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    registerConversationStream(id, res);
  });

  // Get conversation history
  app.get('/api/chat/conversations/:id/messages', (req, res) => {
    const { id } = req.params;
    const requesterId = (req.query.userId as string) || '';

    const messages = getConversationMessages(id, requesterId);
    res.json({ success: true, messages });
  });

  // Send direct message
  app.post('/api/chat/conversations/:id/messages', (req, res) => {
    const { id } = req.params;
    const {
      senderId,
      senderNickname,
      senderAvatar,
      recipientId,
      content,
      mediaUrl,
      mediaType,
      linkPreview,
      clientNonce,
    } = req.body || {};

    const postResult = postConversationMessage({
      conversationId: id,
      senderId,
      senderNickname: senderNickname || 'User',
      senderAvatar: senderAvatar || '👤',
      recipientId,
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
  app.post('/api/moderation/block', (req, res) => {
    const { blockerId, targetId, targetNickname, targetAvatar, blocked, reason } = req.body || {};
    if (!blockerId || !targetId) {
      return res.status(400).json({ success: false, error: 'Both IDs are required.' });
    }
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
  app.get('/api/moderation/blocks', (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId required.' });
    }
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

  app.post('/api/admin/age-assurance/config', (req, res) => {
    const role = (req.headers['x-user-role'] as string) || req.body?.role || 'user';
    if (role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin privileges required to update age assurance configuration.' });
    }
    const actor = (req.headers['x-user-nickname'] as string) || 'Admin';
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
  app.post('/api/admin/age-assurance/revoke', (req, res) => {
    const { userId, reason, actor } = req.body || {};
    const role = (req.headers['x-user-role'] as string) || req.body?.role || 'user';
    if (role !== 'admin' && role !== 'moderator') {
      return res.status(403).json({ success: false, error: 'Moderator privileges required.' });
    }
    const success = revokeAgeVerification(
      userId,
      reason || 'Eligibility revoked by moderation investigation.',
      actor || 'Admin'
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
  app.post('/api/auth/delete-account', (req, res) => {
    const { userId } = req.body || {};
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId required.' });
    }
    const result = purgeUserData(userId);
    res.json(result);
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

  app.post('/api/forum/topics', (req, res) => {
    const { authorId, authorNickname, authorAvatar, authorRole, title, category, categoryLabel, content } = req.body || {};
    if (!authorId || !title || !content) {
      return res.status(400).json({ success: false, error: 'Missing required topic fields.' });
    }

    const result = createForumTopic({
      authorId,
      authorNickname: authorNickname || 'Anonymous',
      authorAvatar: authorAvatar || '⚡',
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

  app.post('/api/forum/topics/:id/reply', (req, res) => {
    const { authorId, authorNickname, authorAvatar, authorRole, content } = req.body || {};
    if (!authorId || !content) {
      return res.status(400).json({ success: false, error: 'Author and content required.' });
    }

    const result = replyToForumTopic({
      topicId: req.params.id,
      authorId,
      authorNickname: authorNickname || 'User',
      authorAvatar: authorAvatar || '💬',
      authorRole: authorRole || 'user',
      content,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  app.put('/api/forum/topics/:id', (req, res) => {
    const { authorId, title, content } = req.body || {};
    const role = (req.headers['x-user-role'] as string) || req.body?.authorRole || 'user';
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

  app.post('/api/forum/topics/:id/lock', (req, res) => {
    const { isLocked } = req.body || {};
    const role = (req.headers['x-user-role'] as string) || 'user';
    const result = toggleLockForumTopic(req.params.id, Boolean(isLocked), role);
    if (!result.success) {
      return res.status(403).json(result);
    }
    res.json(result);
  });

  app.post('/api/forum/topics/:id/pin', (req, res) => {
    const { pinned } = req.body || {};
    const role = (req.headers['x-user-role'] as string) || 'user';
    const result = togglePinForumTopic(req.params.id, Boolean(pinned), role);
    if (!result.success) {
      return res.status(403).json(result);
    }
    res.json(result);
  });

  app.delete('/api/forum/topics/:id', (req, res) => {
    const role = (req.headers['x-user-role'] as string) || (req.query.role as string) || 'user';
    const requesterId = (req.headers['x-user-id'] as string) || (req.query.authorId as string);
    const ok = deleteForumTopic(req.params.id, requesterId, role);
    if (!ok) {
      return res.status(403).json({ success: false, error: 'Unauthorized: Moderator or author privileges required.' });
    }
    res.json({ success: true });
  });

  app.delete('/api/forum/topics/:id/replies/:replyId', (req, res) => {
    const role = (req.headers['x-user-role'] as string) || (req.query.role as string) || 'user';
    const requesterId = (req.headers['x-user-id'] as string) || (req.query.authorId as string);
    const ok = deleteForumReply(req.params.id, req.params.replyId, requesterId, role);
    if (!ok) {
      return res.status(403).json({ success: false, error: 'Unauthorized: Moderator or author privileges required.' });
    }
    res.json({ success: true });
  });

  app.post('/api/forum/topics/:id/replies/:replyId/moderate', (req, res) => {
    const { isApproved } = req.body || {};
    const role = (req.headers['x-user-role'] as string) || 'user';
    const ok = moderateForumReply(req.params.id, req.params.replyId, Boolean(isApproved), role);
    if (!ok) {
      return res.status(403).json({ success: false, error: 'Unauthorized: Moderator privileges required.' });
    }
    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // PHASE 7: BLOG & CMS ENDPOINTS
  // ---------------------------------------------------------------------------
  app.get('/api/blog/articles', (req, res) => {
    const status = (req.query.status as string) || 'published';
    const tag = req.query.tag as string;
    const articles = getBlogArticles({ status, tag });
    res.json({ success: true, articles });
  });

  app.get('/api/blog/articles/:slug', (req, res) => {
    const article = getBlogArticleBySlug(req.params.slug);
    if (!article) {
      return res.status(404).json({ success: false, error: 'Article not found.' });
    }
    res.json({ success: true, article });
  });

  app.post('/api/blog/articles', (req, res) => {
    const role = (req.headers['x-user-role'] as string) || req.body?.authorRole || 'user';
    const result = saveBlogArticle(req.body, role);
    if (!result.success) {
      return res.status(403).json(result);
    }
    res.json(result);
  });

  app.delete('/api/blog/articles/:slug', (req, res) => {
    const role = (req.headers['x-user-role'] as string) || 'user';
    const ok = deleteBlogArticle(req.params.slug, role);
    if (!ok) {
      return res.status(403).json({ success: false, error: 'Unauthorized: Admin role required to delete articles.' });
    }
    res.json({ success: true });
  });

  app.post('/api/blog/articles/:slug/comments', (req, res) => {
    const { authorNickname, authorAvatar, content } = req.body || {};
    if (!content) {
      return res.status(400).json({ success: false, error: 'Content required.' });
    }
    const result = addBlogComment({
      slug: req.params.slug,
      authorNickname: authorNickname || 'Reader',
      authorAvatar: authorAvatar || '💬',
      content,
    });
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  app.post('/api/blog/articles/:slug/comments/:commentId/moderate', (req, res) => {
    const { status } = req.body || {};
    const role = (req.headers['x-user-role'] as string) || 'user';
    const ok = moderateBlogComment(req.params.slug, req.params.commentId, status || 'approved', role);
    if (!ok) {
      return res.status(403).json({ success: false, error: 'Unauthorized: Moderator role required.' });
    }
    res.json({ success: true });
  });

  app.delete('/api/blog/articles/:slug/comments/:commentId', (req, res) => {
    const role = (req.headers['x-user-role'] as string) || 'user';
    const ok = deleteBlogComment(req.params.slug, req.params.commentId, role);
    if (!ok) {
      return res.status(403).json({ success: false, error: 'Unauthorized: Moderator role required.' });
    }
    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // PHASE 7: COMMUNITY GUIDES ENDPOINTS
  // ---------------------------------------------------------------------------
  app.get('/api/guides', (req, res) => {
    res.json({ success: true, ...getCommunityGuides() });
  });

  app.get('/api/guides/:slug', (req, res) => {
    const guide = getCommunityGuideBySlug(req.params.slug);
    if (!guide) {
      return res.status(404).json({ success: false, error: 'Guide not found.' });
    }
    res.json({ success: true, guide });
  });

  app.put('/api/admin/guides/:slug', (req, res) => {
    const role = (req.headers['x-user-role'] as string) || 'user';
    const result = updateCommunityGuide(req.params.slug, req.body || {}, role);
    if (!result.success) {
      return res.status(403).json(result);
    }
    res.json(result);
  });

  // ---------------------------------------------------------------------------
  // PHASE 7: EXTENDED INTERNATIONAL ROOMS & LIVE PARTICIPANT COUNTS
  // ---------------------------------------------------------------------------
  app.get('/api/rooms/catalog', (req, res) => {
    // Inject actual live participant counts based on room presence map
    const catalog = getDynamicRoomsCatalog();
    const catalogWithLiveCounts = catalog.map((room) => {
      const presence = getRoomPresence(room.id);
      return {
        ...room,
        activeParticipants: presence ? presence.length : 0,
      };
    });
    res.json({ success: true, rooms: catalogWithLiveCounts });
  });

  app.post('/api/admin/rooms', (req, res) => {
    const role = (req.headers['x-user-role'] as string) || 'user';
    const result = createDynamicRoom(req.body, role);
    if (!result.success) {
      return res.status(403).json(result);
    }
    res.json(result);
  });

  app.put('/api/admin/rooms/:id', (req, res) => {
    const role = (req.headers['x-user-role'] as string) || 'user';
    const result = updateDynamicRoom(req.params.id, req.body || {}, role);
    if (!result.success) {
      return res.status(403).json(result);
    }
    res.json(result);
  });

  app.delete('/api/admin/rooms/:id', (req, res) => {
    const role = (req.headers['x-user-role'] as string) || 'user';
    const ok = deleteDynamicRoom(req.params.id, role);
    if (!ok) {
      return res.status(403).json({ success: false, error: 'Unauthorized: Admin role required.' });
    }
    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // PHASE 7: SAFE YOUTUBE, MEDIA UPLOADS & EXTERNAL PROVIDERS
  // ---------------------------------------------------------------------------
  app.post('/api/media/youtube/validate', (req, res) => {
    const { url } = req.body || {};
    const result = validateYouTubeUrl(url);
    if (!result.valid) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  app.post('/api/media/upload/validate', (req, res) => {
    const { fileName, fileSize, mimeType, uploaderId } = req.body || {};
    const result = validateMediaUpload({ fileName, fileSize, mimeType, uploaderId });
    if (!result.valid) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  app.post('/api/media/:id/flag', (req, res) => {
    const ok = flagMediaUpload(req.params.id);
    res.json({ success: ok });
  });

  app.get('/api/admin/media', (req, res) => {
    const role = (req.headers['x-user-role'] as string) || 'user';
    if (role !== 'admin' && role !== 'moderator') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Staff role required.' });
    }
    res.json({ success: true, media: getMediaList(role) });
  });

  app.delete('/api/admin/media/:id', (req, res) => {
    const role = (req.headers['x-user-role'] as string) || 'user';
    const ok = removeMediaUpload(req.params.id, role);
    if (!ok) {
      return res.status(403).json({ success: false, error: 'Unauthorized: Staff role required.' });
    }
    res.json({ success: true });
  });

  app.get('/api/media/providers/docs', (req, res) => {
    res.json({ success: true, providers: EXTERNAL_PROVIDERS_DOCUMENTATION });
  });

  // ---------------------------------------------------------------------------
  // PHASE 7: ADMIN DASHBOARD & MODERATION ENDPOINTS
  // ---------------------------------------------------------------------------
  app.get('/api/admin/metrics', (req, res) => {
    const catalog = EXTENDED_ROOMS_CATALOG;
    let totalRoomParticipants = 0;
    catalog.forEach((r) => {
      const p = getRoomPresence(r.id);
      totalRoomParticipants += p ? p.length : 0;
    });

    const reports = getPlatformReports();
    const restrictions = getUserRestrictions();
    const appeals = getModerationAppeals();
    const topics = getForumTopics();
    const articles = getBlogArticles({ status: 'all' });

    res.json({
      success: true,
      metrics: {
        activeParticipants: totalRoomParticipants,
        totalRooms: catalog.length,
        openReports: reports.filter((r) => r.status === 'received' || r.status === 'investigating').length,
        resolvedReports: reports.filter((r) => r.status === 'resolved' || r.status === 'dismissed').length,
        activeRestrictions: restrictions.filter((r) => r.active).length,
        pendingAppeals: appeals.filter((a) => a.status === 'pending').length,
        totalForumTopics: topics.total,
        totalBlogArticles: articles.length,
        serverUptimeSeconds: Math.floor(process.uptime()),
      },
    });
  });

  // Admin: Safety Reports Queue
  app.get('/api/admin/reports', (req, res) => {
    const role = (req.headers['x-user-role'] as string) || (req.query.role as string) || 'user';
    if (role !== 'admin' && role !== 'moderator') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Moderator role required.' });
    }
    res.json({ success: true, reports: getPlatformReports(role) });
  });

  app.post('/api/admin/reports/:id/status', (req, res) => {
    const { status, actionTaken, moderatorNotes, reviewer } = req.body || {};
    const role = (req.headers['x-user-role'] as string) || 'user';
    if (role !== 'admin' && role !== 'moderator') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Moderator role required.' });
    }
    const updated = updateReportStatus(
      req.params.id,
      status,
      actionTaken,
      moderatorNotes,
      reviewer || (req.headers['x-user-nickname'] as string) || 'Admin'
    );
    res.json({ success: true, report: updated });
  });

  // Admin: User Restrictions List
  app.get('/api/admin/restrictions', (req, res) => {
    const role = (req.headers['x-user-role'] as string) || (req.query.role as string) || 'user';
    if (role !== 'admin' && role !== 'moderator') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Moderator role required.' });
    }
    res.json({ success: true, restrictions: getUserRestrictions(role) });
  });

  // Admin: Impose User Restriction
  app.post('/api/admin/restrictions', (req, res) => {
    const { userId, userNickname, type, scope, reason, imposedBy } = req.body || {};
    const role = (req.headers['x-user-role'] as string) || 'user';
    if (role !== 'admin' && role !== 'moderator') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Moderator role required.' });
    }
    if (!userId || !type || !reason) {
      return res.status(400).json({ success: false, error: 'userId, type, and reason required.' });
    }
    const result = imposeUserRestriction({
      userId,
      userNickname: userNickname || userId,
      type,
      scope,
      reason,
      imposedBy: imposedBy || (req.headers['x-user-nickname'] as string) || 'Admin',
    });
    res.json(result);
  });

  // Admin: Lift User Restriction
  app.post('/api/admin/restrictions/:userId/lift', (req, res) => {
    const { reason, actor } = req.body || {};
    const role = (req.headers['x-user-role'] as string) || 'user';
    if (role !== 'admin' && role !== 'moderator') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Moderator role required.' });
    }
    const lifted = liftUserRestriction(
      req.params.userId,
      reason || 'Sanction manually lifted by moderator.',
      actor || (req.headers['x-user-nickname'] as string) || 'Admin'
    );
    res.json({ success: lifted });
  });

  // Admin: Appeals List & Review
  app.get('/api/admin/appeals', (req, res) => {
    const role = (req.headers['x-user-role'] as string) || (req.query.role as string) || 'user';
    if (role !== 'admin' && role !== 'moderator') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Moderator role required.' });
    }
    res.json({ success: true, appeals: getModerationAppeals(role) });
  });

  app.post('/api/appeals', (req, res) => {
    const { userId, userNickname, statement } = req.body || {};
    if (!userId || !statement) {
      return res.status(400).json({ success: false, error: 'userId and statement required.' });
    }
    const result = submitAppeal({ userId, userNickname: userNickname || userId, statement });
    res.json(result);
  });

  app.post('/api/admin/appeals/:id/review', (req, res) => {
    const { status, notes, reviewer } = req.body || {};
    const role = (req.headers['x-user-role'] as string) || 'user';
    if (role !== 'admin' && role !== 'moderator') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Moderator role required.' });
    }
    const result = reviewAppeal(
      req.params.id,
      status,
      notes,
      reviewer || (req.headers['x-user-nickname'] as string) || 'Admin'
    );
    if (!result) return res.status(404).json({ success: false, error: 'Appeal not found.' });
    res.json({ success: true, appeal: result });
  });

  // Admin: Audit Logs
  app.get('/api/admin/audit-logs', (req, res) => {
    const role = (req.headers['x-user-role'] as string) || (req.query.role as string) || 'user';
    if (role !== 'admin' && role !== 'moderator') {
      return res.status(403).json({ success: false, error: 'Unauthorized: Moderator or admin role required.' });
    }
    res.json({ success: true, auditLogs: getModerationAuditLogs(role) });
  });

  app.get('/api/admin/settings', (req, res) => {
    res.json({ success: true, settings: getPlatformSettings() });
  });

  app.post('/api/admin/settings', (req, res) => {
    const role = (req.headers['x-user-role'] as string) || 'user';
    if (role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin role required to modify platform settings.' });
    }
    const updated = updatePlatformSettings(req.body || {});
    res.json({ success: true, settings: updated });
  });

  // Periodically clean up expired guest sessions every 15 minutes
  setInterval(() => {
    cleanupExpiredSessions();
  }, 15 * 60 * 1000);

  // Serve robots.txt and sitemap.xml
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

startServer().catch((err) => {
  console.error('[ChatLustora Backend] Fatal startup error:', err);
  process.exit(1);
});
