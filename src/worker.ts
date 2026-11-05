import { databaseService } from './services/databaseService';
import { getSupabaseClientFromEnv } from './lib/supabaseClient';

/**
 * ChatLustora Cloudflare Workers Edge Entrypoint
 * Handles full-featured Edge SSE streaming, message persistence, presence tracking,
 * guest session authorization, and falls back to static assets.
 */

interface HubMessage {
  id: string;
  roomId?: string;
  conversationId?: string;
  senderId: string;
  senderNickname: string;
  senderAvatar: string;
  senderType: 'registered' | 'guest' | 'system';
  content: string;
  rawContent?: string;
  mediaUrl?: string;
  mediaType?: 'gif' | 'image';
  linkPreview?: {
    url: string;
    title?: string;
    description?: string;
    image?: string;
  };
  clientNonce?: string;
  timestamp: string;
  status: 'delivered';
}

interface PresenceMember {
  id: string;
  nickname: string;
  avatar: string;
  isGuest: boolean;
  lastSeen: number;
  gender?: string;
}

interface GuestSession {
  id: string;
  token: string;
  nickname: string;
  avatar: string;
  gender?: string;
  languagePref?: string;
  is18Verified?: boolean;
  createdAt: number;
  expiresAt: number;
}

function getGuestSecret(env: any): { secret: string | null; isDevFallback: boolean } {
  const secretValue = env?.GUEST_SESSION_SECRET;
  const isDevFallback = env?.ENVIRONMENT === 'development' || env?.DEV === true;
  if (secretValue && typeof secretValue === 'string' && secretValue.trim().length > 0) {
    return { secret: secretValue.trim(), isDevFallback };
  }
  return { 
    secret: null, 
    isDevFallback 
  };
}

function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(base64url: string): string {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

async function signGuestToken(payload: any, secret: string): Promise<string> {
  if (!secret) {
    throw new Error('GUEST_SESSION_SECRET is required to sign guest tokens.');
  }
  const base64Payload = toBase64Url(JSON.stringify(payload));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(base64Payload));
  const sigBytes = Array.from(new Uint8Array(sigBuffer));
  const sigHex = sigBytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `vx_gst_${base64Payload}.${sigHex}`;
}

async function computeTokenHash(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyGuestToken(
  token: string | undefined,
  secretInfo: { secret: string | null; isDevFallback?: boolean },
  dbEnv?: { supabaseUrl?: string; supabaseServiceKey?: string }
): Promise<{ valid: boolean; session?: GuestSession; reason?: string; isConfigError?: boolean }> {
  if (!secretInfo.secret) {
    return { valid: false, reason: 'Server configuration error: GUEST_SESSION_SECRET is missing.' };
  }

  if (!token || !token.startsWith('vx_gst_')) {
    return { valid: false, reason: 'Malformed token prefix' };
  }

  // Reject local simulation tokens
  if (token.startsWith('vx_gst_local_') || token.includes('_local_')) {
    return { valid: false, reason: 'Local simulation tokens are prohibited.' };
  }

  const raw = token.slice('vx_gst_'.length);
  const dotIdx = raw.indexOf('.');
  if (dotIdx === -1) {
    return { valid: false, reason: 'Invalid token structure' };
  }

  const base64Payload = raw.slice(0, dotIdx);
  const signatureHex = raw.slice(dotIdx + 1);

  if (!/^[0-9a-f]{64}$/i.test(signatureHex)) {
    return { valid: false, reason: 'Malformed signature' };
  }

  const sigBytes = new Uint8Array(signatureHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  const encoder = new TextEncoder();

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secretInfo.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(base64Payload));
    if (!valid) {
      return { valid: false, reason: 'Invalid cryptographic signature' };
    }

    const payloadJson = fromBase64Url(base64Payload);
    const p = JSON.parse(payloadJson);

    // Required Remediation 1: Require p.sid to be a valid UUID string
    if (
      !p.sid ||
      typeof p.sid !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.sid)
    ) {
      return { valid: false, reason: 'Malformed or invalid session ID in token.' };
    }

    // Required Remediation 3: Strict timestamp and expiry validation
    if (
      typeof p.exp !== 'number' ||
      !Number.isFinite(p.exp) ||
      Date.now() >= p.exp
    ) {
      return { valid: false, reason: 'Guest session expired or invalid expiry timestamp.' };
    }

    if (
      typeof p.iat !== 'number' ||
      !Number.isFinite(p.iat) ||
      p.iat > Date.now() + 60000
    ) {
      return { valid: false, reason: 'Invalid token issuance timestamp.' };
    }

    // Mandatory durable revocation & existence verification against public.guest_sessions
    if (!dbEnv?.supabaseUrl || !dbEnv?.supabaseServiceKey) {
      if (!secretInfo.isDevFallback) {
        return { valid: false, isConfigError: true, reason: 'Server configuration error: Database bindings missing in production.' };
      }
      return { valid: false, reason: 'Database configuration missing for guest session verification.' };
    }

    const tokenHash = await computeTokenHash(token);
    let canonicalRow: any = null;
    try {
      const queryUrl = `${dbEnv.supabaseUrl}/rest/v1/guest_sessions?session_token_hash=eq.${encodeURIComponent(tokenHash)}&select=id,session_token_hash,is_revoked,expires_at`;
      const res = await fetch(queryUrl, {
        headers: {
          'apikey': dbEnv.supabaseServiceKey,
          'Authorization': `Bearer ${dbEnv.supabaseServiceKey}`,
        },
      });

      if (!res.ok) {
        console.error(`[Worker] Guest session DB verification failed HTTP ${res.status}`);
        return { valid: false, reason: `Database verification failed (HTTP ${res.status})` };
      }

      let rows: any;
      try {
        rows = await res.json();
      } catch {
        return { valid: false, reason: 'Malformed JSON response from database.' };
      }

      if (!Array.isArray(rows)) {
        return { valid: false, reason: 'Invalid database response: expected an array.' };
      }

      if (rows.length !== 1) {
        return { valid: false, reason: rows.length === 0 ? 'Guest session not found or unregistered.' : 'Ambiguous session: multiple records matched.' };
      }

      canonicalRow = rows[0];

      if (!canonicalRow || typeof canonicalRow !== 'object') {
        return { valid: false, reason: 'Invalid canonical session record.' };
      }

      // Explicitly enforce row.id === p.sid
      if (canonicalRow.id !== p.sid || typeof canonicalRow.id !== 'string') {
        return { valid: false, reason: 'Session identity mismatch.' };
      }

      // Explicitly enforce session_token_hash match
      if (canonicalRow.session_token_hash !== tokenHash) {
        return { valid: false, reason: 'Token hash verification mismatch.' };
      }

      if (canonicalRow.is_revoked !== false) {
        guestSessions.delete(token);
        return { valid: false, reason: 'Guest session has been revoked or revocation status is invalid.' };
      }

      // Authoritative database expiry validation
      const dbExpiresAt = canonicalRow.expires_at
        ? new Date(canonicalRow.expires_at).getTime()
        : NaN;

      if (!Number.isFinite(dbExpiresAt) || Date.now() >= dbExpiresAt) {
        guestSessions.delete(token);
        return { valid: false, reason: 'Guest session expired in database.' };
      }
    } catch (dbErr: any) {
      console.error('[Worker] Guest session DB lookup exception:', dbErr);
      return { valid: false, reason: 'Database error verifying session revocation.' };
    }

    // Construct session using canonical database identity
    const session: GuestSession = {
      id: canonicalRow.id,
      token,
      nickname: p.nick || p.nickname || 'Guest_User',
      avatar: p.av || p.avatar || '⚡',
      gender: p.gen || p.gender,
      languagePref: p.lng || p.languagePref || 'en',
      is18Verified: Boolean(p.v18 || p.is18Verified),
      createdAt: p.iat,
      expiresAt: p.exp,
    };

    return { valid: true, session };
  } catch (err: any) {
    return { valid: false, reason: 'Token verification exception: ' + (err.message || 'Malformed') };
  }
}

async function authenticateRequest(
  request: Request,
  url: URL,
  guestSecretInfo: { secret: string | null; isDevFallback: boolean },
  dbEnv: { supabaseUrl?: string; supabaseServiceKey?: string; supabaseAnonKey?: string },
  supabaseClient?: any,
  env?: any,
  bodyToken?: string
): Promise<{ verifiedUserId: string; isGuestCaller: boolean; guestSession?: GuestSession } | { errorResponse: Response }> {
  const authHeader = request.headers.get('Authorization');
  const bearerToken = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;

  const headerGuestToken = bearerToken && bearerToken.startsWith('vx_gst_') ? bearerToken : null;
  const memberJwt = bearerToken && !bearerToken.startsWith('vx_gst_') ? bearerToken : null;
  const effectiveBodyToken = bodyToken && bodyToken.startsWith('vx_gst_') ? bodyToken : null;

  // Registered member priority
  if (memberJwt) {
    if (!dbEnv.supabaseUrl && !guestSecretInfo.isDevFallback) {
      return {
        errorResponse: jsonResponse({
          success: false,
          error: 'Server configuration error: Database bindings missing in production.',
        }, 503)
      };
    }

    let verifiedUserId: string | null = null;
    if (dbEnv.supabaseUrl) {
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
      } catch (err) {
        console.warn('[Worker] Supabase member verification fetch exception:', err);
      }
    }

    if (!verifiedUserId && supabaseClient) {
      try {
        const { data: userData, error: userErr } = await supabaseClient.auth.getUser(memberJwt);
        if (!userErr && userData?.user?.id) {
          verifiedUserId = userData.user.id;
        }
      } catch {
        // ignore
      }
    }

    if (verifiedUserId) {
      return { verifiedUserId, isGuestCaller: false };
    }
    
    // If a member JWT was provided but could not be verified, reject immediately.
    // Do not fallback to guest authentication to prevent silent downgrades.
    return {
      errorResponse: jsonResponse({
        success: false,
        error: 'Unauthorized: Invalid or expired member authentication token.',
      }, 401)
    };
  }

  // Guest token handling
  const finalGuestToken = headerGuestToken || effectiveBodyToken;

  if (finalGuestToken) {
    // If both exist, they must match
    if (headerGuestToken && effectiveBodyToken && headerGuestToken !== effectiveBodyToken) {
      return {
        errorResponse: jsonResponse({
          success: false,
          error: 'Conflicting guest authentication tokens in header and body.',
        }, 400)
      };
    }

    const authCheck = await verifyGuestToken(finalGuestToken, guestSecretInfo, dbEnv);
    if (!authCheck.valid || !authCheck.session) {
      const status = (authCheck as any).isConfigError ? 503 : 401;
      return {
        errorResponse: jsonResponse({
          success: false,
          error: (authCheck as any).isConfigError
            ? authCheck.reason
            : `Unauthorized: ${authCheck.reason || 'Invalid or expired guest session token.'}`,
        }, status)
      };
    }
    return { verifiedUserId: authCheck.session.id, isGuestCaller: true, guestSession: authCheck.session };
  }

  return {
    errorResponse: jsonResponse({
      success: false,
      error: 'Unauthorized: Authentication required.',
    }, 401)
  };
}

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
    console.error('[Worker] Error fetching member profile:', err);
  }
  return fallback;
}

// Global in-memory maps for Edge instance
const roomMessages = new Map<string, HubMessage[]>();
const roomPresence = new Map<string, Map<string, PresenceMember>>();
const roomTyping = new Map<string, Map<string, { nickname: string; expiresAt: number }>>();
const guestSessions = new Map<string, GuestSession>();
const activeAccountDeletions = new Set<string>();

// Active SSE client streams per room & conversation (using ReadableStreamDefaultController for synchronous non-promise enqueuing)
const roomStreams = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
const conversationMessages = new Map<string, HubMessage[]>();
const conversationStreams = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
const userDMStreams = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
const conversationTyping = new Map<string, Map<string, { nickname: string; expiresAt: number }>>();
const conversationReadState = new Map<string, Map<string, { readUntilId: string; readAt: string }>>();

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
};

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function broadcastToRoom(roomId: string, eventName: string, data: unknown) {
  const controllers = roomStreams.get(roomId);
  if (!controllers || controllers.size === 0) return;

  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(payload);

  for (const controller of Array.from(controllers)) {
    try {
      controller.enqueue(encoded);
    } catch {
      controllers.delete(controller);
    }
  }
}

function broadcastToConversation(convId: string, eventName: string, data: unknown) {
  const controllers = conversationStreams.get(convId);
  if (!controllers || controllers.size === 0) return;

  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(payload);

  for (const controller of Array.from(controllers)) {
    try {
      controller.enqueue(encoded);
    } catch {
      controllers.delete(controller);
    }
  }
}

function broadcastToUser(userId: string, eventName: string, data: unknown) {
  const controllers = userDMStreams.get(userId);
  if (!controllers || controllers.size === 0) return;

  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(payload);

  for (const controller of Array.from(controllers)) {
    try {
      controller.enqueue(encoded);
    } catch {
      controllers.delete(controller);
    }
  }
}

function sanitizeContent(input: string): string {
  if (!input) return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
}

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url);
    const supabaseClient = getSupabaseClientFromEnv(env);
    const guestSecretInfo = getGuestSecret(env);

    // Resolve explicit Supabase Worker runtime env bindings
    const baseSupabaseUrl = env?.SUPABASE_URL || '';
    const supabaseAnonKey = env?.SUPABASE_ANON_KEY || '';
    const supabaseServiceKey = env?.SUPABASE_SERVICE_ROLE_KEY || '';

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // Optional proxy to external backend if configured
    if (env?.BACKEND_URL && url.pathname.startsWith('/api/')) {
      try {
        const targetUrl = new URL(url.pathname + url.search, env.BACKEND_URL);
        const proxyReq = new Request(targetUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
          redirect: 'follow',
        });
        const proxyRes = await fetch(proxyReq);
        const headers = new Headers(proxyRes.headers);
        Object.entries(CORS_HEADERS).forEach(([k, v]) => headers.set(k, v));
        return new Response(proxyRes.body, {
          status: proxyRes.status,
          statusText: proxyRes.statusText,
          headers,
        });
      } catch (err) {
        console.warn('Backend proxy unreachable, falling back to edge worker logic', err);
      }
    }

    // Health check endpoint
    if (url.pathname === '/api/health') {
      return jsonResponse({
        status: 'healthy',
        app: 'VoxaNex',
        platform: 'Cloudflare Workers (Edge)',
        timestamp: new Date().toISOString(),
      });
    }

    // -------------------------------------------------------------------------
    // 1. SSE LIVE EVENT STREAM: USER DM EVENTS
    // -------------------------------------------------------------------------
    const userSseMatch = url.pathname.match(/^\/api\/chat\/user\/([^/]+)\/events\/?$/);
    if (userSseMatch && request.method === 'GET') {
      const userId = decodeURIComponent(userSseMatch[1]);

      const authResult = await authenticateRequest(
        request,
        url,
        guestSecretInfo,
        { supabaseUrl: baseSupabaseUrl, supabaseServiceKey, supabaseAnonKey },
        supabaseClient
      );

      if ('errorResponse' in authResult) {
        return authResult.errorResponse;
      }

      if (authResult.verifiedUserId !== userId) {
        return jsonResponse({
          success: false,
          error: 'Unauthorized: Cannot subscribe to another user\'s direct message stream.',
        }, 403);
      }

      let intervalId: any = null;
      let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          if (!userDMStreams.has(userId)) {
            userDMStreams.set(userId, new Set());
          }
          const controllers = userDMStreams.get(userId)!;
          controllers.add(controller);

          const encoder = new TextEncoder();
          try {
            controller.enqueue(encoder.encode(`event: connected\ndata: {"status":"connected","userId":"${userId}"}\n\n`));
          } catch {
            if (intervalId) clearInterval(intervalId);
            controllers.delete(controller);
          }

          intervalId = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
            } catch {
              if (intervalId) clearInterval(intervalId);
              if (streamController) controllers.delete(streamController);
            }
          }, 15000);
        },
        cancel(reason) {
          if (intervalId) clearInterval(intervalId);
          const controllers = userDMStreams.get(userId);
          if (controllers && streamController) {
            controllers.delete(streamController);
            if (controllers.size === 0) {
              userDMStreams.delete(userId);
            }
          }
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          ...CORS_HEADERS,
        },
      });
    }

    // -------------------------------------------------------------------------
    // 1B. SSE LIVE EVENT STREAM: ROOM EVENTS
    // -------------------------------------------------------------------------
    const sseMatch = url.pathname.match(/^\/api\/chat\/rooms\/([^/]+)\/events\/?$/);
    if (sseMatch && request.method === 'GET') {
      const roomId = decodeURIComponent(sseMatch[1]);

      const authResult = await authenticateRequest(
        request,
        url,
        guestSecretInfo,
        { supabaseUrl: baseSupabaseUrl, supabaseServiceKey, supabaseAnonKey },
        supabaseClient
      );

      if ('errorResponse' in authResult) {
        return authResult.errorResponse;
      }

      let intervalId: any = null;
      let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          if (!roomStreams.has(roomId)) {
            roomStreams.set(roomId, new Set());
          }
          const controllers = roomStreams.get(roomId)!;
          controllers.add(controller);

          const encoder = new TextEncoder();
          try {
            controller.enqueue(encoder.encode(`event: connected\ndata: {"status":"connected","roomId":"${roomId}"}\n\n`));
          } catch {
            if (intervalId) clearInterval(intervalId);
            controllers.delete(controller);
          }

          intervalId = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
            } catch {
              if (intervalId) clearInterval(intervalId);
              if (streamController) controllers.delete(streamController);
            }
          }, 15000);
        },
        cancel(reason) {
          if (intervalId) clearInterval(intervalId);
          const controllers = roomStreams.get(roomId);
          if (controllers && streamController) {
            controllers.delete(streamController);
            if (controllers.size === 0) {
              roomStreams.delete(roomId);
            }
          }
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          ...CORS_HEADERS,
        },
      });
    }

    // -------------------------------------------------------------------------
    // 2. ROOM MESSAGES: /api/chat/rooms/:roomId/messages
    // -------------------------------------------------------------------------
    const messagesMatch = url.pathname.match(/^\/api\/chat\/rooms\/([^/]+)\/messages$/);
    if (messagesMatch) {
      const roomId = decodeURIComponent(messagesMatch[1]);

      // GET: Retrieve message history
      if (request.method === 'GET') {
        const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
        const limit = Math.min(Math.max(limitParam, 1), 100);

        if (baseSupabaseUrl && supabaseAnonKey) {
          try {
            // Resolve slug to real UUID for database query
            const realRoomId = await databaseService.resolveRoomId(roomId, supabaseClient);
            
            const restUrl = `${baseSupabaseUrl}/rest/v1/messages?room_id=eq.${realRoomId}&order=created_at.desc&limit=${limit}`;
            const headers: Record<string, string> = {
              'apikey': supabaseAnonKey,
            };
            // Pass user's JWT for RLS enforcement
            if (request.headers.has('Authorization')) {
              headers['Authorization'] = request.headers.get('Authorization')!;
            } else {
              headers['Authorization'] = `Bearer ${supabaseAnonKey}`;
            }

            const res = await fetch(restUrl, { headers });
            if (res.ok) {
              const data = await res.json();
              const messages = (Array.isArray(data) ? data : []).reverse().map((m: any) => ({
                id: m.id,
                roomId: m.room_id,
                senderId: m.sender_user_id || m.sender_guest_id || 'anonymous',
                senderNickname: m.sender_nickname,
                senderAvatar: m.sender_avatar,
                content: m.content,
                timestamp: m.created_at,
                isSystem: m.is_system || false,
                status: 'delivered',
              }));
              
              return jsonResponse({ success: true, messages });
            }
          } catch (e) {
            console.warn('Supabase fetch error, falling back to local isolate messages:', e);
          }
        }
        
        // Fallback if Supabase not configured or query returned non-200
        const list = roomMessages.get(roomId) || [];
        const paginated = list.slice(-limit);
        return jsonResponse({ success: true, messages: paginated });
      }

      // POST: Send new message
      if (request.method === 'POST') {
        try {
          const body: any = await request.json().catch(() => ({}));
          const {
            content,
            mediaUrl,
            mediaType,
            linkPreview,
            clientNonce,
            senderId: clientSenderId,
            senderType: clientSenderType,
            guestToken: bodyGuestToken,
          } = body || {};

          // 1. Authenticate Request (Deterministic precedence)
          const authResult = await authenticateRequest(
            request,
            url,
            guestSecretInfo,
            { supabaseUrl: baseSupabaseUrl, supabaseServiceKey, supabaseAnonKey },
            supabaseClient,
            env,
            bodyGuestToken
          );

          if ('errorResponse' in authResult) {
            return authResult.errorResponse;
          }

          const { verifiedUserId, isGuestCaller, guestSession } = authResult;

          // 2. Validate senderType
          if (!clientSenderType || !['registered', 'guest'].includes(clientSenderType)) {
             return jsonResponse({ success: false, error: 'Bad Request: Missing or invalid senderType.' }, 400);
          }

          // Cross-check declared type and verified identity
          if (isGuestCaller && clientSenderType !== 'guest') {
             return jsonResponse({ success: false, error: 'Forbidden: Guest session cannot claim registered identity.' }, 403);
          }
          if (!isGuestCaller && clientSenderType !== 'registered') {
             return jsonResponse({ success: false, error: 'Forbidden: Registered session cannot be downgraded to guest identity.' }, 403);
          }

          // 3. Identity Spoofing Check
          if (clientSenderId && clientSenderId !== verifiedUserId) {
             return jsonResponse({ success: false, error: 'Forbidden: Sender identity mismatch (spoofing attempt rejected).' }, 403);
          }

          if (!content && !mediaUrl) {
            return jsonResponse({ success: false, error: 'Message content or media is required.' }, 400);
          }

          // 4. Derive Identity from Verified Source (Zero-trust fallback)
          let verifiedNickname: string;
          let verifiedAvatar: string;

          if (isGuestCaller && guestSession) {
            verifiedNickname = guestSession.nickname;
            verifiedAvatar = guestSession.avatar;
          } else {
            const profile = await fetchMemberProfile(verifiedUserId, { supabaseUrl: baseSupabaseUrl, supabaseServiceKey });
            verifiedNickname = profile.nickname;
            verifiedAvatar = profile.avatar;
          }

          const cleanContent = sanitizeContent(content || '');

          const message: HubMessage = {
            id: crypto.randomUUID(),
            roomId,
            senderId: verifiedUserId,
            senderNickname: verifiedNickname,
            senderAvatar: verifiedAvatar,
            senderType: isGuestCaller ? 'guest' : 'registered',
            content: cleanContent,
            rawContent: content,
            mediaUrl,
            mediaType,
            linkPreview,
            clientNonce,
            timestamp: new Date().toISOString(),
            status: 'delivered',
          };

          // 5. Atomic Persistence-before-Broadcast
          let isInserted = true;
          if (baseSupabaseUrl && supabaseServiceKey) {
             const result = await databaseService.atomicMessage({
                id: message.id,
                roomId: roomId,
                senderUserId: isGuestCaller ? undefined : verifiedUserId,
                senderGuestId: isGuestCaller ? verifiedUserId : undefined,
                senderNickname: verifiedNickname,
                senderAvatar: verifiedAvatar,
                content: cleanContent,
                clientNonce: clientNonce,
                mediaUrl,
                mediaType,
                linkPreview
             }, supabaseClient);

             if (!result.success) {
               return jsonResponse({
                 success: false,
                 error: result.error || 'Database persistence failed.'
               }, 500);
             }

             isInserted = result.inserted;

             // Use the confirmed canonical message from DB
             if (result.message) {
               message.id = result.message.id;
               message.timestamp = result.message.timestamp;
               message.content = result.message.content;
               message.senderNickname = result.message.senderNickname;
               message.senderAvatar = result.message.senderAvatar;
             }
          } else if (!guestSecretInfo.isDevFallback) {
            return jsonResponse({
              success: false,
              error: 'Server configuration error: Database bindings missing in production.'
            }, 503);
          }

          const rtDiag: any = {
              platform: 'Cloudflare Worker',
              hasSupabaseUrl: !!env?.SUPABASE_URL,
              hasServiceRoleKey: !!env?.SUPABASE_SERVICE_ROLE_KEY,
              supabaseClientReady: !!supabaseClient,
              senderType: isGuestCaller ? 'guest' : 'registered'
          };

          // 6. Update Local Map & Broadcast (Only for newly inserted messages)
          if (isInserted) {
            if (!roomMessages.has(roomId)) {
              roomMessages.set(roomId, []);
            }
            const list = roomMessages.get(roomId)!;

            list.push(message);
            if (list.length > 500) {
              list.shift();
            }

            broadcastToRoom(roomId, 'new_message', message);

            const rtPromise = (async () => {
                if (!supabaseClient) return;
                try {
                    await databaseService.broadcastMessage(roomId, message as any, supabaseClient);
                } catch (e: any) {
                    console.warn(`[Worker] Supabase RT broadcast failed for room ${roomId}:`, e);
                }
            })();

            if (ctx?.waitUntil) {
                ctx.waitUntil(rtPromise);
            }
          }

          return jsonResponse({
            success: true,
            message,
            serverDiag: rtDiag
          });

        } catch (err: any) {
          return jsonResponse({ success: false, error: 'Failed to process message: ' + (err.message || 'Malformed body') }, 400);
        }
      }
    }

    // -------------------------------------------------------------------------
    // 3. ROOM PRESENCE: /api/chat/rooms/:roomId/presence
    // -------------------------------------------------------------------------
    const presenceMatch = url.pathname.match(/^\/api\/chat\/rooms\/([^/]+)\/presence$/);
    if (presenceMatch) {
      const roomId = decodeURIComponent(presenceMatch[1]);

      if (!roomPresence.has(roomId)) {
        roomPresence.set(roomId, new Map());
      }
      const membersMap = roomPresence.get(roomId)!;

      if (request.method === 'POST') {
        try {
          const body: any = await request.json();
          const { id, nickname, avatar, isGuest, gender, action, status } = body || {};

          if (action === 'leave' || status === 'offline') {
            if (id) {
              membersMap.delete(id);
              const currentMembers = Array.from(membersMap.values());
              broadcastToRoom(roomId, 'presence_update', currentMembers);
              // Broadcast to other worker instances via Supabase
              await databaseService.broadcastMessage(roomId, { id: 'presence_sync', roomId, content: JSON.stringify(currentMembers), senderNickname: 'system', senderAvatar: '⚡', timestamp: new Date().toISOString() } as any);
              return jsonResponse({ success: true, members: currentMembers });
            }
          }

          if (id && nickname) {
            membersMap.set(id, {
              id,
              nickname,
              avatar: avatar || '👤',
              isGuest: Boolean(isGuest),
              gender,
              lastSeen: Date.now(),
            });
          }

          // Clean up stale members > 45s
          const now = Date.now();
          for (const [mid, m] of membersMap.entries()) {
            if (now - m.lastSeen > 45000) {
              membersMap.delete(mid);
            }
          }

          const currentMembers = Array.from(membersMap.values());
          broadcastToRoom(roomId, 'presence_update', currentMembers);

          return jsonResponse({ success: true, members: currentMembers });
        } catch {
          return jsonResponse({ success: false, members: Array.from(membersMap.values()) });
        }
      }

      if (request.method === 'GET') {
        const now = Date.now();
        const active = Array.from(membersMap.values()).filter((m) => now - m.lastSeen <= 45000);
        return jsonResponse({ success: true, members: active });
      }
    }

    // -------------------------------------------------------------------------
    // 4. ROOM TYPING: /api/chat/rooms/:roomId/typing
    // -------------------------------------------------------------------------
    const typingMatch = url.pathname.match(/^\/api\/chat\/rooms\/([^/]+)\/typing$/);
    if (typingMatch && request.method === 'POST') {
      const roomId = decodeURIComponent(typingMatch[1]);
      try {
        const body: any = await request.json();
        const { memberId, nickname, isTyping } = body || {};

        if (!roomTyping.has(roomId)) {
          roomTyping.set(roomId, new Map());
        }
        const typersMap = roomTyping.get(roomId)!;

        if (isTyping && memberId && nickname) {
          typersMap.set(memberId, { nickname, expiresAt: Date.now() + 3000 });
        } else if (memberId) {
          typersMap.delete(memberId);
        }

        const now = Date.now();
        for (const [tid, t] of typersMap.entries()) {
          if (now > t.expiresAt) typersMap.delete(tid);
        }

        const activeTypers = Array.from(typersMap.values()).map((t) => t.nickname);
        broadcastToRoom(roomId, 'typing_update', { typers: activeTypers });

        return jsonResponse({ success: true });
      } catch {
        return jsonResponse({ success: true });
      }
    }

    // -------------------------------------------------------------------------
    // 5. DIRECT 1-ON-1 CONVERSATION ENDPOINTS
    // -------------------------------------------------------------------------

    // GET /api/chat/conversations/list: Server-backed conversation discovery
    if (url.pathname === '/api/chat/conversations/list' && request.method === 'GET') {
      const userIdParam = url.searchParams.get('userId');
      const guestTokenParam = url.searchParams.get('guestToken') || request.headers.get('x-guest-token');
      const authHeader = request.headers.get('Authorization');
      const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

      const guestToken = guestTokenParam || (bearerToken && bearerToken.startsWith('vx_gst_') ? bearerToken : null);
      const memberJwt = !guestToken && bearerToken && !bearerToken.startsWith('vx_gst_') ? bearerToken : null;

      let verifiedUserId: string | null = null;
      if (guestToken) {
        const authCheck = await verifyGuestToken(guestToken, guestSecretInfo, { supabaseUrl: baseSupabaseUrl, supabaseServiceKey });
        if (authCheck.valid && authCheck.session) {
          verifiedUserId = authCheck.session.id;
        }
      } else if (memberJwt) {
        if (baseSupabaseUrl) {
          try {
            const userRes = await fetch(`${baseSupabaseUrl}/auth/v1/user`, {
              headers: { 'apikey': supabaseAnonKey || supabaseServiceKey, 'Authorization': `Bearer ${memberJwt}` },
            });
            if (userRes.ok) {
              const u = (await userRes.json()) as { id?: string };
              if (u?.id) verifiedUserId = u.id;
            }
          } catch {}
        }
        if (!verifiedUserId && guestSecretInfo.isDevFallback) {
          try {
            const parts = memberJwt.split('.');
            if (parts.length === 3) {
              const p = JSON.parse(fromBase64Url(parts[1]));
              verifiedUserId = p.sub || p.id;
            }
          } catch {}
        }
      }

      if (!verifiedUserId) {
        return jsonResponse({ success: false, error: 'Unauthorized: Authentication required to list conversations.' }, 401);
      }

      const userId = userIdParam || verifiedUserId;
      if (userId !== verifiedUserId) {
        return jsonResponse({ success: false, error: 'Unauthorized: Cannot list conversations for another user.' }, 403);
      }
      
      if (baseSupabaseUrl && supabaseServiceKey) {
        try {
          const participantFilter = guestToken
            ? `guest_id=eq.${encodeURIComponent(userId)}`
            : `user_id=eq.${encodeURIComponent(userId)}`;
          const convListRestUrl = `${baseSupabaseUrl}/rest/v1/conversation_participants?${participantFilter}&select=conversation_id`;
          const res = await fetch(convListRestUrl, {
            headers: {
              'apikey': supabaseServiceKey,
              'Authorization': `Bearer ${supabaseServiceKey}`
            }
          });
          const data = await res.json();
          const userConvs = (Array.isArray(data) ? data : []).map((p: any) => p.conversation_id);
          return jsonResponse({ success: true, conversations: userConvs });
        } catch (e) {
          console.error('Supabase conv list error:', e);
          return jsonResponse({ success: false, error: 'Database error' }, 500);
        }
      }

      // In production / staging, fail closed if database bindings are missing
      if (!guestSecretInfo.isDevFallback) {
        return jsonResponse({
          success: false,
          error: 'Server configuration error: Database bindings missing in production.',
        }, 503);
      }

      // Fallback for local development testing mode only
      const userConvs: string[] = [];
      for (const convId of conversationMessages.keys()) {
        if (convId.includes(userId)) {
          userConvs.push(convId);
        }
      }
      return jsonResponse({ success: true, conversations: userConvs });
    }

    // POST /api/chat/conversations: Initialize or get conversation ID
    if (url.pathname === '/api/chat/conversations' && request.method === 'POST') {
      try {
        const guestTokenParam = url.searchParams.get('guestToken') || request.headers.get('x-guest-token');
        const authHeader = request.headers.get('Authorization');
        const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
        const guestToken = guestTokenParam || (bearerToken && bearerToken.startsWith('vx_gst_') ? bearerToken : null);
        const memberJwt = !guestToken && bearerToken && !bearerToken.startsWith('vx_gst_') ? bearerToken : null;

        let verifiedUserId: string | null = null;
        let callerType: 'registered' | 'guest' | null = null;
        if (guestToken) {
          const authCheck = await verifyGuestToken(guestToken, guestSecretInfo, { supabaseUrl: baseSupabaseUrl, supabaseServiceKey });
          if (authCheck.valid && authCheck.session) {
            verifiedUserId = authCheck.session.id;
            callerType = 'guest';
          }
        } else if (memberJwt) {
          if (baseSupabaseUrl) {
            try {
              const userRes = await fetch(`${baseSupabaseUrl}/auth/v1/user`, {
                headers: { 'apikey': supabaseAnonKey || supabaseServiceKey, 'Authorization': `Bearer ${memberJwt}` },
              });
              if (userRes.ok) {
                const u = (await userRes.json()) as { id?: string };
                if (u?.id) {
                  verifiedUserId = u.id;
                  callerType = 'registered';
                }
              }
            } catch {}
          }
          if (!verifiedUserId && guestSecretInfo.isDevFallback) {
            try {
              const parts = memberJwt.split('.');
              if (parts.length === 3) {
                const p = JSON.parse(fromBase64Url(parts[1]));
                verifiedUserId = p.sub || p.id;
                if (verifiedUserId) {
                  callerType = 'registered';
                }
              }
            } catch {}
          }
        }

        if (!verifiedUserId || !callerType) {
          return jsonResponse({ success: false, error: 'Unauthorized: Authentication required.' }, 401);
        }

        const body: any = await request.json().catch(() => ({}));
        const { userId: bodyUserId, partnerId } = body || {};
        const userId = bodyUserId || verifiedUserId;

        if (userId !== verifiedUserId) {
          return jsonResponse({ success: false, error: 'Unauthorized: User ID mismatch.' }, 403);
        }
        if (!partnerId || typeof partnerId !== 'string') {
          return jsonResponse({ success: false, error: 'Partner ID is required.' }, 400);
        }

        let dbConvId: string = '';
        let convId: string = '';

        if (baseSupabaseUrl && supabaseServiceKey) {
          try {
            // Authoritative partner identity classification from database
            let resolvedPartnerType: 'registered' | 'guest' | null = null;
            let resolvedPartnerId: string = partnerId;

            // 1. Check if partnerId exists in public.guest_sessions
            const checkGuestRes = await fetch(
              `${baseSupabaseUrl}/rest/v1/guest_sessions?id=eq.${encodeURIComponent(partnerId)}&select=id,is_revoked,expires_at`,
              {
                headers: {
                  'apikey': supabaseServiceKey,
                  'Authorization': `Bearer ${supabaseServiceKey}`,
                },
              }
            );

            if (!checkGuestRes.ok) {
              const errText = await checkGuestRes.text().catch(() => '');
              console.error(`[Worker] Partner guest check failed HTTP ${checkGuestRes.status}:`, errText);
              return jsonResponse({ success: false, error: `Database error verifying partner identity (HTTP ${checkGuestRes.status}).` }, 500);
            }

            const guestRows: any = await checkGuestRes.json().catch(() => []);
            if (Array.isArray(guestRows) && guestRows.length > 0) {
              const guestRow = guestRows[0];
              if (guestRow.is_revoked) {
                return jsonResponse({ success: false, error: 'Partner guest session has been revoked.' }, 400);
              }
              const dbExpiresAt = guestRow.expires_at ? new Date(guestRow.expires_at).getTime() : NaN;
              if (!Number.isFinite(dbExpiresAt) || Date.now() >= dbExpiresAt) {
                return jsonResponse({ success: false, error: 'Partner guest session has expired.' }, 400);
              }
              resolvedPartnerType = 'guest';
              resolvedPartnerId = guestRow.id;
            } else {
              // 2. Not found in guest_sessions -> Check public.profiles
              const checkProfileRes = await fetch(
                `${baseSupabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(partnerId)}&select=id`,
                {
                  headers: {
                    'apikey': supabaseServiceKey,
                    'Authorization': `Bearer ${supabaseServiceKey}`,
                  },
                }
              );

              if (!checkProfileRes.ok) {
                const errText = await checkProfileRes.text().catch(() => '');
                console.error(`[Worker] Partner profile check failed HTTP ${checkProfileRes.status}:`, errText);
                return jsonResponse({ success: false, error: `Database error verifying partner profile (HTTP ${checkProfileRes.status}).` }, 500);
              }

              const profileRows: any = await checkProfileRes.json().catch(() => []);
              if (Array.isArray(profileRows) && profileRows.length > 0) {
                resolvedPartnerType = 'registered';
                resolvedPartnerId = profileRows[0].id;
              }
            }

            if (!resolvedPartnerType) {
              return jsonResponse({ success: false, error: 'Partner identity could not be verified or user does not exist.' }, 400);
            }

            // Generate deterministic conversation ID and slug using verified caller and partner IDs
            dbConvId = await databaseService.getDeterministicConvId(verifiedUserId, resolvedPartnerId);
            convId = `conv_${[verifiedUserId, resolvedPartnerId].sort().join('_')}`;

            // Create or upsert conversation row
            const convRes = await fetch(`${baseSupabaseUrl}/rest/v1/conversations`, {
              method: 'POST',
              headers: {
                'apikey': supabaseServiceKey,
                'Authorization': `Bearer ${supabaseServiceKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
              },
              body: JSON.stringify({ id: dbConvId })
            });

            if (!convRes.ok) {
              const errText = await convRes.text().catch(() => '');
              console.error(`[Worker] Conversation creation failed HTTP ${convRes.status}:`, errText);
              return jsonResponse({ success: false, error: `Database error creating conversation (HTTP ${convRes.status}).` }, 500);
            }

            const participants: Array<{ id: string; type: 'registered' | 'guest' }> = [
              { id: verifiedUserId, type: callerType },
              { id: resolvedPartnerId, type: resolvedPartnerType },
            ];

            for (const p of participants) {
              const payload: any = { conversation_id: dbConvId };
              if (p.type === 'guest') {
                payload.guest_id = p.id;
              } else {
                payload.user_id = p.id;
              }

              const filter = p.type === 'guest'
                ? `conversation_id=eq.${encodeURIComponent(dbConvId)}&guest_id=eq.${encodeURIComponent(p.id)}`
                : `conversation_id=eq.${encodeURIComponent(dbConvId)}&user_id=eq.${encodeURIComponent(p.id)}`;

              const checkRes = await fetch(
                `${baseSupabaseUrl}/rest/v1/conversation_participants?${filter}&select=id`,
                {
                  headers: {
                    'apikey': supabaseServiceKey,
                    'Authorization': `Bearer ${supabaseServiceKey}`,
                  },
                }
              );

              if (!checkRes.ok) {
                const errText = await checkRes.text().catch(() => '');
                console.error(`[Worker] Participant check failed HTTP ${checkRes.status}:`, errText);
                return jsonResponse({ success: false, error: `Database error verifying conversation participant (HTTP ${checkRes.status}).` }, 500);
              }

              const existingRows: any = await checkRes.json().catch(() => []);
              const exists = Array.isArray(existingRows) && existingRows.length > 0;

              if (!exists) {
                const insertRes = await fetch(`${baseSupabaseUrl}/rest/v1/conversation_participants`, {
                  method: 'POST',
                  headers: {
                    'apikey': supabaseServiceKey,
                    'Authorization': `Bearer ${supabaseServiceKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(payload)
                });

                if (!insertRes.ok) {
                  // Concurrent insert race condition handling: re-verify if participant row was persisted concurrently
                  const recheckRes = await fetch(
                    `${baseSupabaseUrl}/rest/v1/conversation_participants?${filter}&select=id`,
                    {
                      headers: {
                        'apikey': supabaseServiceKey,
                        'Authorization': `Bearer ${supabaseServiceKey}`,
                      },
                    }
                  );

                  let recheckExists = false;
                  if (recheckRes.ok) {
                    const recheckRows: any = await recheckRes.json().catch(() => []);
                    recheckExists = Array.isArray(recheckRows) && recheckRows.length > 0;
                  }

                  if (!recheckExists) {
                    const errText = await insertRes.text().catch(() => '');
                    console.error(`[Worker] Participant insertion failed HTTP ${insertRes.status}:`, errText);
                    return jsonResponse({ success: false, error: `Database error adding participant (HTTP ${insertRes.status}).` }, 500);
                  }
                }
              }
            }
          } catch (e: any) {
            console.error('[Worker] Error initializing conversation in DB:', e);
            return jsonResponse({ success: false, error: 'Database error initializing conversation' }, 500);
          }
        } else if (!guestSecretInfo.isDevFallback) {
          return jsonResponse({
            success: false,
            error: 'Server configuration error: Database bindings missing in production.',
          }, 503);
        } else {
          dbConvId = await databaseService.getDeterministicConvId(verifiedUserId, partnerId);
          convId = `conv_${[verifiedUserId, partnerId].sort().join('_')}`;
        }

        if (!conversationMessages.has(convId)) {
          conversationMessages.set(convId, []);
        }
        if (!conversationMessages.has(dbConvId)) {
          conversationMessages.set(dbConvId, []);
        }

        return jsonResponse({ success: true, conversationId: dbConvId, slug: convId });
      } catch {
        return jsonResponse({ success: false, error: 'Malformed conversation request' }, 400);
      }
    }

async function authorizeConversationAccess(
  convIdParam: string,
  verifiedUserId: string,
  isGuestCaller: boolean,
  dbEnv: { supabaseUrl?: string; supabaseServiceKey?: string },
  guestSecretInfo: { isDevFallback: boolean }
): Promise<
  | { authorized: true; dbConvId: string; convSlug: string; recipientId: string }
  | { authorized: false; errorResponse: Response }
> {
  const uuidFullRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let convSlug: string = '';
  let dbConvId: string = '';
  let recipientId: string = '';

  if (convIdParam.startsWith('conv_')) {
    const idWithoutPrefix = convIdParam.slice('conv_'.length);
    const parts = idWithoutPrefix.split('_');

    if (parts.length !== 2) {
      return {
        authorized: false,
        errorResponse: jsonResponse({ success: false, error: 'Invalid conversation slug format.' }, 400),
      };
    }

    const [id1, id2] = parts;
    if (!uuidFullRegex.test(id1) || !uuidFullRegex.test(id2)) {
      return {
        authorized: false,
        errorResponse: jsonResponse({ success: false, error: 'Invalid participant identifier in conversation slug.' }, 400),
      };
    }

    if (id1 === id2) {
      return {
        authorized: false,
        errorResponse: jsonResponse({ success: false, error: 'Invalid conversation slug: Duplicate participant identifiers.' }, 400),
      };
    }

    if (id1 !== verifiedUserId && id2 !== verifiedUserId) {
      return {
        authorized: false,
        errorResponse: jsonResponse({ success: false, error: 'Unauthorized: Authenticated caller is not a participant in this conversation slug.' }, 403),
      };
    }

    recipientId = id1 === verifiedUserId ? id2 : id1;
    convSlug = `conv_${[id1, id2].sort().join('_')}`;
    dbConvId = await databaseService.getDeterministicConvId(verifiedUserId, recipientId);
  } else if (uuidFullRegex.test(convIdParam)) {
    dbConvId = convIdParam;
  } else {
    return {
      authorized: false,
      errorResponse: jsonResponse({ success: false, error: 'Invalid conversation identifier format.' }, 400),
    };
  }

  // Database verification
  if (dbEnv.supabaseUrl && dbEnv.supabaseServiceKey) {
    try {
      const partsUrl = `${dbEnv.supabaseUrl}/rest/v1/conversation_participants?conversation_id=eq.${encodeURIComponent(dbConvId)}&select=user_id,guest_id`;
      const partsRes = await fetch(partsUrl, {
        headers: {
          'apikey': dbEnv.supabaseServiceKey,
          'Authorization': `Bearer ${dbEnv.supabaseServiceKey}`,
        },
      });

      if (!partsRes.ok) {
        console.error(`[Worker] Participant lookup HTTP error ${partsRes.status}`);
        return {
          authorized: false,
          errorResponse: jsonResponse({ success: false, error: `Database error verifying membership (HTTP ${partsRes.status}).` }, 500),
        };
      }

      const rows: any = await partsRes.json().catch(() => null);
      if (!Array.isArray(rows)) {
        return {
          authorized: false,
          errorResponse: jsonResponse({ success: false, error: 'Database error parsing participant records.' }, 500),
        };
      }

      let callerPresent = false;
      let dbRecipientId: string | null = null;

      for (const row of rows) {
        const rowId = row.user_id || row.guest_id;
        if (rowId === verifiedUserId) {
          callerPresent = true;
        } else if (rowId) {
          dbRecipientId = rowId;
        }
      }

      if (callerPresent) {
        if (!recipientId && dbRecipientId) {
          recipientId = dbRecipientId;
        }
        if (!convSlug && recipientId) {
          convSlug = `conv_${[verifiedUserId, recipientId].sort().join('_')}`;
        }
        return { authorized: true, dbConvId, convSlug, recipientId };
      }

      // If participants exist for this conversation but caller is not among them: forbidden!
      if (rows.length > 0 && !callerPresent) {
        return {
          authorized: false,
          errorResponse: jsonResponse({ success: false, error: 'Unauthorized: Authenticated caller is not a participant in this conversation.' }, 403),
        };
      }

      // If rows.length === 0, check partner and lazily initialize conversation & participants
      if (recipientId) {
        let partnerValid = false;
        const gRes = await fetch(
          `${dbEnv.supabaseUrl}/rest/v1/guest_sessions?id=eq.${encodeURIComponent(recipientId)}&select=id,is_revoked,expires_at`,
          { headers: { apikey: dbEnv.supabaseServiceKey, Authorization: `Bearer ${dbEnv.supabaseServiceKey}` } }
        );
        if (gRes.ok) {
          const gRows: any = await gRes.json().catch(() => []);
          if (Array.isArray(gRows) && gRows.length > 0) {
            const g = gRows[0];
            const exp = g.expires_at ? new Date(g.expires_at).getTime() : NaN;
            if (!g.is_revoked && Number.isFinite(exp) && Date.now() < exp) {
              partnerValid = true;
            }
          }
        }
        if (!partnerValid) {
          const pRes = await fetch(
            `${dbEnv.supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(recipientId)}&select=id`,
            { headers: { apikey: dbEnv.supabaseServiceKey, Authorization: `Bearer ${dbEnv.supabaseServiceKey}` } }
          );
          if (pRes.ok) {
            const pRows: any = await pRes.json().catch(() => []);
            if (Array.isArray(pRows) && pRows.length > 0) {
              partnerValid = true;
            }
          }
        }

        if (partnerValid) {
          await fetch(`${dbEnv.supabaseUrl}/rest/v1/conversations`, {
            method: 'POST',
            headers: {
              apikey: dbEnv.supabaseServiceKey,
              Authorization: `Bearer ${dbEnv.supabaseServiceKey}`,
              'Content-Type': 'application/json',
              Prefer: 'resolution=merge-duplicates',
            },
            body: JSON.stringify({ id: dbConvId, type: 'direct' }),
          }).catch(() => {});

          const callerPayload = isGuestCaller
            ? { conversation_id: dbConvId, guest_id: verifiedUserId }
            : { conversation_id: dbConvId, user_id: verifiedUserId };

          await fetch(`${dbEnv.supabaseUrl}/rest/v1/conversation_participants`, {
            method: 'POST',
            headers: {
              apikey: dbEnv.supabaseServiceKey,
              Authorization: `Bearer ${dbEnv.supabaseServiceKey}`,
              'Content-Type': 'application/json',
              Prefer: 'resolution=merge-duplicates',
            },
            body: JSON.stringify(callerPayload),
          }).catch(() => {});

          const recheckUrl = `${dbEnv.supabaseUrl}/rest/v1/conversation_participants?conversation_id=eq.${encodeURIComponent(dbConvId)}&${isGuestCaller ? 'guest_id' : 'user_id'}=eq.${encodeURIComponent(verifiedUserId)}&select=id`;
          const recheckRes = await fetch(recheckUrl, {
            headers: { apikey: dbEnv.supabaseServiceKey, Authorization: `Bearer ${dbEnv.supabaseServiceKey}` },
          });
          if (recheckRes.ok) {
            const recheckRows: any = await recheckRes.json().catch(() => []);
            if (Array.isArray(recheckRows) && recheckRows.length > 0) {
              return { authorized: true, dbConvId, convSlug, recipientId };
            }
          }
        }
      }

      return {
        authorized: false,
        errorResponse: jsonResponse({ success: false, error: 'Unauthorized: Not a member of this conversation.' }, 403),
      };
    } catch (err) {
      console.error('[Worker] DB authorization exception:', err);
      return {
        authorized: false,
        errorResponse: jsonResponse({ success: false, error: 'Database authorization error.' }, 500),
      };
    }
  } else if (!guestSecretInfo.isDevFallback) {
    return {
      authorized: false,
      errorResponse: jsonResponse({ success: false, error: 'Server configuration error: Database bindings missing in production.' }, 503),
    };
  } else {
    if (convSlug && (convSlug.includes(verifiedUserId) || dbConvId.includes(verifiedUserId))) {
      return { authorized: true, dbConvId, convSlug, recipientId };
    }
    return {
      authorized: false,
      errorResponse: jsonResponse({ success: false, error: 'Unauthorized: Not a member of this conversation.' }, 403),
    };
  }
}

    // GET /api/chat/conversations/:id/events: SSE Stream for conversation
    const convEventsMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/events\/?$/);
    if (convEventsMatch && request.method === 'GET') {
      const convIdParam = decodeURIComponent(convEventsMatch[1]);

      const authResult = await authenticateRequest(
        request,
        url,
        guestSecretInfo,
        { supabaseUrl: baseSupabaseUrl, supabaseServiceKey, supabaseAnonKey },
        supabaseClient
      );

      if ('errorResponse' in authResult) {
        return authResult.errorResponse;
      }

      const verifiedUserId = authResult.verifiedUserId;
      const isGuestCaller = authResult.isGuestCaller;

      const authAccess = await authorizeConversationAccess(
        convIdParam,
        verifiedUserId,
        isGuestCaller,
        { supabaseUrl: baseSupabaseUrl, supabaseServiceKey },
        guestSecretInfo
      );

      if (!authAccess.authorized) {
        return authAccess.errorResponse;
      }

      const { dbConvId, convSlug } = authAccess;
      const convId = convSlug || convIdParam;

      let intervalId: any = null;
      let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          if (!conversationStreams.has(convId)) {
            conversationStreams.set(convId, new Set());
          }
          conversationStreams.get(convId)!.add(controller);

          if (dbConvId && dbConvId !== convId) {
            if (!conversationStreams.has(dbConvId)) {
              conversationStreams.set(dbConvId, new Set());
            }
            conversationStreams.get(dbConvId)!.add(controller);
          }

          const encoder = new TextEncoder();
          try {
            controller.enqueue(encoder.encode(`event: connected\ndata: {"status":"connected","convId":"${convId}"}\n\n`));
          } catch {
            if (intervalId) clearInterval(intervalId);
            conversationStreams.get(convId)?.delete(controller);
            if (dbConvId) conversationStreams.get(dbConvId)?.delete(controller);
          }

          intervalId = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
            } catch {
              if (intervalId) clearInterval(intervalId);
              if (streamController) {
                conversationStreams.get(convId)?.delete(streamController);
                if (dbConvId) conversationStreams.get(dbConvId)?.delete(streamController);
              }
            }
          }, 15000);
        },
        cancel() {
          if (intervalId) clearInterval(intervalId);
          if (streamController) {
            const controllers = conversationStreams.get(convId);
            if (controllers) {
              controllers.delete(streamController);
              if (controllers.size === 0) conversationStreams.delete(convId);
            }
            if (dbConvId) {
              const dbControllers = conversationStreams.get(dbConvId);
              if (dbControllers) {
                dbControllers.delete(streamController);
                if (dbControllers.size === 0) conversationStreams.delete(dbConvId);
              }
            }
          }
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          ...CORS_HEADERS,
        },
      });
    }

    // /api/chat/conversations/:id/messages: History and Sending
    const convMessagesMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/messages$/);
    if (convMessagesMatch) {
      const convId = decodeURIComponent(convMessagesMatch[1]);

      if (request.method === 'GET') {
        const guestTokenParam = url.searchParams.get('guestToken') || request.headers.get('x-guest-token');
        const authResult = await authenticateRequest(
          request,
          url,
          guestSecretInfo,
          { supabaseUrl: baseSupabaseUrl, supabaseServiceKey, supabaseAnonKey },
          supabaseClient,
          env,
          guestTokenParam || undefined
        );

        if ('errorResponse' in authResult) {
          return authResult.errorResponse;
        }

        const { verifiedUserId, isGuestCaller } = authResult;
        const clientSuppliedUserId = url.searchParams.get('userId');

        if (clientSuppliedUserId && clientSuppliedUserId !== verifiedUserId) {
          return jsonResponse({
            success: false,
            error: 'Forbidden: Client user ID does not match authenticated identity.',
          }, 403);
        }

        const authAccess = await authorizeConversationAccess(
          convId,
          verifiedUserId,
          isGuestCaller,
          { supabaseUrl: baseSupabaseUrl, supabaseServiceKey },
          guestSecretInfo
        );

        if (!authAccess.authorized) {
          return authAccess.errorResponse;
        }

        const { dbConvId, convSlug } = authAccess;

        // Fetch history using server-side Supabase service-role key
        if (baseSupabaseUrl && supabaseServiceKey) {
          try {
            const convMessagesRestUrl = `${baseSupabaseUrl}/rest/v1/messages?conversation_id=eq.${encodeURIComponent(dbConvId)}&order=created_at.asc`;
            const headers: Record<string, string> = {
              'apikey': supabaseServiceKey,
              'Authorization': `Bearer ${supabaseServiceKey}`,
            };

            const res = await fetch(convMessagesRestUrl, { headers });
            if (!res.ok) {
              const errText = await res.text().catch(() => '');
              console.error(`[Worker] Supabase message history fetch failed HTTP ${res.status}:`, errText);
              return jsonResponse({ success: false, error: 'Database error fetching message history' }, 500);
            }

            let data: any;
            try {
              data = await res.json();
            } catch (jsonErr) {
              console.error('[Worker] JSON parse error fetching message history:', jsonErr);
              return jsonResponse({
                success: false,
                error: 'Database error parsing message history response.',
              }, 500);
            }

            if (!Array.isArray(data)) {
              console.error('[Worker] Message history response is not an array:', data);
              return jsonResponse({
                success: false,
                error: 'Database error fetching message history.',
              }, 500);
            }

            const messages = data.map((m: any) => ({
              id: m.id,
              conversationId: convSlug || convId,
              senderId: m.sender_user_id || m.sender_guest_id || 'anonymous',
              senderNickname: m.sender_nickname,
              senderAvatar: m.sender_avatar,
              senderType: m.sender_user_id ? 'registered' : 'guest',
              content: m.content,
              mediaUrl: m.media_url,
              mediaType: m.media_type,
              linkPreview: m.link_preview,
              clientNonce: m.client_nonce,
              timestamp: m.created_at,
              isDirect: true,
              status: 'delivered',
            }));
            return jsonResponse({ success: true, messages });
          } catch (e) {
            console.error('Supabase DM fetch error:', e);
            return jsonResponse({ success: false, error: 'Database error' }, 500);
          }
        }

        // In production, fail closed if database bindings are missing
        if (!guestSecretInfo.isDevFallback) {
          return jsonResponse({
            success: false,
            error: 'Server configuration error: Database bindings missing in production.',
          }, 503);
        }

        // In development / local testing fallback, return from in-memory store
        const localMessages = conversationMessages.get(convId) || (dbConvId !== convId ? conversationMessages.get(dbConvId) : null) || [];
        return jsonResponse({ success: true, messages: localMessages });
      }

      if (request.method === 'POST') {
        try {
          const body: any = await request.json().catch(() => ({}));
          const {
            senderId: clientSenderId,
            recipientId: clientRecipientId,
            content,
            mediaUrl,
            mediaType,
            linkPreview,
            clientNonce,
            guestToken: bodyGuestToken,
          } = body || {};

          // 1. Authenticate Request
          const authResult = await authenticateRequest(
            request,
            url,
            guestSecretInfo,
            { supabaseUrl: baseSupabaseUrl, supabaseServiceKey, supabaseAnonKey },
            supabaseClient,
            env,
            bodyGuestToken
          );

          if ('errorResponse' in authResult) {
            return authResult.errorResponse;
          }

          const { verifiedUserId, isGuestCaller, guestSession } = authResult;

          // 2. Validate senderType
          const clientSenderType = body?.senderType;
          if (clientSenderType && !['registered', 'guest'].includes(clientSenderType)) {
             return jsonResponse({ success: false, error: 'Bad Request: Invalid senderType.' }, 400);
          }
          if (isGuestCaller && clientSenderType === 'registered') {
             return jsonResponse({ success: false, error: 'Forbidden: Guest session cannot claim registered identity.' }, 403);
          }
          if (!isGuestCaller && clientSenderType === 'guest') {
             return jsonResponse({ success: false, error: 'Forbidden: Registered session cannot be downgraded to guest identity.' }, 403);
          }

          // 3. Identity Spoofing Check
          if (clientSenderId && clientSenderId !== verifiedUserId) {
             return jsonResponse({ success: false, error: 'Forbidden: Sender identity mismatch (spoofing attempt rejected).' }, 403);
          }

          if (!content && !mediaUrl) {
            return jsonResponse({ success: false, error: 'Message content or media is required.' }, 400);
          }

          // 4. Authorize conversation access strictly against database
          const authAccess = await authorizeConversationAccess(
            convId,
            verifiedUserId,
            isGuestCaller,
            { supabaseUrl: baseSupabaseUrl, supabaseServiceKey },
            guestSecretInfo
          );

          if (!authAccess.authorized) {
            return authAccess.errorResponse;
          }

          const { dbConvId, convSlug, recipientId: authorizedRecipientId } = authAccess;

          // 5. Recipient mismatch check if recipientId was passed in POST body
          if (clientRecipientId && authorizedRecipientId && clientRecipientId !== authorizedRecipientId) {
            return jsonResponse({ success: false, error: 'Forbidden: Recipient identity mismatch.' }, 403);
          }

          const resolvedRecipientId = clientRecipientId || authorizedRecipientId;

          // 6. Identity Resolution (Zero-trust)
          let verifiedNickname: string;
          let verifiedAvatar: string;

          if (isGuestCaller && guestSession) {
            verifiedNickname = guestSession.nickname;
            verifiedAvatar = guestSession.avatar;
          } else {
            const profile = await fetchMemberProfile(verifiedUserId, { supabaseUrl: baseSupabaseUrl, supabaseServiceKey });
            verifiedNickname = profile.nickname;
            verifiedAvatar = profile.avatar;
          }

          const cleanContent = sanitizeContent(content || '');
          const message: HubMessage = {
            id: crypto.randomUUID(),
            conversationId: convSlug || convId,
            senderId: verifiedUserId,
            senderNickname: verifiedNickname,
            senderAvatar: verifiedAvatar,
            senderType: isGuestCaller ? 'guest' : 'registered',
            content: cleanContent,
            rawContent: content,
            mediaUrl,
            mediaType,
            linkPreview,
            clientNonce,
            timestamp: new Date().toISOString(),
            status: 'delivered',
          };

          // 7. Atomic Persistence
          let isInserted = true;
          if (baseSupabaseUrl && supabaseServiceKey) {
             await fetch(`${baseSupabaseUrl}/rest/v1/conversations`, {
               method: 'POST',
               headers: {
                 'apikey': supabaseServiceKey,
                 'Authorization': `Bearer ${supabaseServiceKey}`,
                 'Content-Type': 'application/json',
                 'Prefer': 'resolution=merge-duplicates'
               },
               body: JSON.stringify({ id: dbConvId, type: 'direct' })
             }).catch(() => {});

             const result = await databaseService.atomicMessage({
                id: message.id,
                conversationId: dbConvId,
                senderUserId: isGuestCaller ? undefined : verifiedUserId,
                senderGuestId: isGuestCaller ? verifiedUserId : undefined,
                senderNickname: verifiedNickname,
                senderAvatar: verifiedAvatar,
                content: cleanContent,
                clientNonce: clientNonce,
                mediaUrl,
                mediaType,
                linkPreview
             }, supabaseClient);

             if (!result.success) {
                return jsonResponse({ success: false, error: result.error || 'Database DM persistence failed.' }, 500);
             }

             isInserted = result.inserted;

             if (result.message) {
               message.id = result.message.id;
               message.timestamp = result.message.timestamp;
               message.content = result.message.content;
               message.senderNickname = result.message.senderNickname;
               message.senderAvatar = result.message.senderAvatar;
             }
          } else if (!guestSecretInfo.isDevFallback) {
             return jsonResponse({
               success: false,
               error: 'Server configuration error: Database bindings missing in production.'
             }, 503);
          }

          // 8. Broadcast and Local State (Only on genuine new insertions)
          if (isInserted) {
              try {
                  broadcastToConversation(convSlug || convId, 'new_dm', message);
                  if (dbConvId && dbConvId !== (convSlug || convId)) {
                    broadcastToConversation(dbConvId, 'new_dm', message);
                  }
                  if (resolvedRecipientId) {
                    broadcastToUser(resolvedRecipientId, 'incoming_dm', { conversationId: convSlug || convId, message });
                  }
              } catch (sseErr: any) {
                  console.warn(`[VX-DM] Local SSE broadcast error:`, sseErr);
              }

              const broadcastPromise = (async () => {
                  if (!supabaseClient) return;
                  try {
                    await Promise.all([
                        databaseService.broadcastDM(convSlug || convId, resolvedRecipientId, message as any, supabaseClient),
                        resolvedRecipientId ? databaseService.broadcastToUser(resolvedRecipientId, 'incoming_dm', { conversationId: convSlug || convId, message }, supabaseClient) : Promise.resolve()
                    ]);
                  } catch (e: any) {
                    console.error(`[VX-DM] Supabase broadcast fatal error:`, e);
                  }
              })();

              if (ctx?.waitUntil) {
                  ctx.waitUntil(broadcastPromise);
              } else {
                  await broadcastPromise;
              }

              // Store in in-memory map
              if (!conversationMessages.has(convId)) {
                conversationMessages.set(convId, []);
              }
              const localList = conversationMessages.get(convId)!;
              localList.push(message);
              if (localList.length > 500) localList.shift();
          }

          return jsonResponse({ success: true, message });

        } catch (err: any) {
          return jsonResponse({ success: false, error: 'Failed to deliver message: ' + (err.message || 'Unknown error') }, 400);
        }
      }
        }

    // POST /api/chat/conversations/:id/typing
    const convTypingMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/typing$/);
    if (convTypingMatch && request.method === 'POST') {
      const convId = decodeURIComponent(convTypingMatch[1]);
      try {
        const body: any = await request.json();
        const { memberId, nickname, isTyping } = body || {};

        if (!conversationTyping.has(convId)) {
          conversationTyping.set(convId, new Map());
        }
        const typersMap = conversationTyping.get(convId)!;

        if (isTyping && memberId && nickname) {
          typersMap.set(memberId, { nickname, expiresAt: Date.now() + 3000 });
        } else if (memberId) {
          typersMap.delete(memberId);
        }

        const now = Date.now();
        for (const [tid, t] of typersMap.entries()) {
          if (now > t.expiresAt) typersMap.delete(tid);
        }

        const activeTypers = Array.from(typersMap.values()).map((t) => t.nickname);
        broadcastToConversation(convId, 'dm_typing', { typers: activeTypers });

        return jsonResponse({ success: true });
      } catch {
        return jsonResponse({ success: true });
      }
    }

    // POST /api/chat/conversations/:id/read
    const convReadMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/read$/);
    if (convReadMatch && request.method === 'POST') {
      const convId = decodeURIComponent(convReadMatch[1]);
      try {
        const body: any = await request.json();
        const { userId, messageId } = body || {};

        if (userId && messageId) {
          if (convId.startsWith('conv_')) {
            const idWithoutPrefix = convId.replace(/^conv_/, '');
            const isMember =
              idWithoutPrefix.startsWith(userId + '_') ||
              idWithoutPrefix.endsWith('_' + userId) ||
              idWithoutPrefix === userId;
            if (!isMember) {
              return jsonResponse({ success: false, error: 'Unauthorized: Not a member of this conversation.' }, 403);
            }
          }

          if (!conversationReadState.has(convId)) {
            conversationReadState.set(convId, new Map());
          }
          const readMap = conversationReadState.get(convId)!;
          readMap.set(userId, { readUntilId: messageId, readAt: new Date().toISOString() });

          broadcastToConversation(convId, 'dm_read', {
            userId,
            messageId,
            readAt: new Date().toISOString(),
          });
        }

        return jsonResponse({ success: true });
      } catch {
        return jsonResponse({ success: true });
      }
    }

    // -------------------------------------------------------------------------
    // 6. GUEST SESSION ENDPOINTS
    // -------------------------------------------------------------------------
    if (url.pathname === '/api/guest/session' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const { nickname, avatar, gender, languagePref, is18Verified } = body || {};

        const sessionId = crypto.randomUUID();
        const issuedAt = Date.now();
        const expiresAt = issuedAt + 24 * 60 * 60 * 1000;

        const payload = {
          sid: sessionId,
          nick: (nickname || 'Guest_User').slice(0, 24),
          av: avatar || '⚡',
          gen: gender || 'prefer_not_to_say',
          lng: languagePref || 'en',
          v18: Boolean(is18Verified),
          iat: issuedAt,
          exp: expiresAt,
        };

        if (!guestSecretInfo.secret) {
          console.error('[Worker] Guest session creation failed: GUEST_SESSION_SECRET is unconfigured.');
          return jsonResponse({
            success: false,
            error: 'Guest session creation failed: Missing required environment configuration.',
          }, 500);
        }

        if (!baseSupabaseUrl || !supabaseServiceKey) {
          return jsonResponse({
            success: false,
            error: 'Server configuration error: Database bindings missing.',
          }, 503);
        }

        const token = await signGuestToken(payload, guestSecretInfo.secret);
        const tokenHash = await computeTokenHash(token);

        const guestSessionRecord = {
          id: sessionId,
          session_token_hash: tokenHash,
          nickname: payload.nick,
          avatar: payload.av,
          language_pref: payload.lng,
          is_18_verified: payload.v18,
          verified_at: payload.v18 ? new Date(issuedAt).toISOString() : null,
          expires_at: new Date(expiresAt).toISOString(),
          is_revoked: false,
        };

        try {
          const dbRes = await fetch(`${baseSupabaseUrl}/rest/v1/guest_sessions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': supabaseServiceKey,
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Prefer': 'return=representation',
            },
            body: JSON.stringify(guestSessionRecord),
          });

          if (!dbRes.ok) {
            console.error(`[Worker] Supabase guest session insert failed HTTP ${dbRes.status}`);
            return jsonResponse({
              success: false,
              error: `Database session registration failed (HTTP ${dbRes.status}).`
            }, 500);
          }

          let insertedRows: any;
          try {
            insertedRows = await dbRes.json();
          } catch (jsonErr) {
            console.error(`[Worker] Supabase guest session insert JSON parse error HTTP ${dbRes.status}`);
            return jsonResponse({
              success: false,
              error: 'Database session registration failed: Invalid response format.'
            }, 500);
          }

          if (!Array.isArray(insertedRows) || insertedRows.length !== 1) {
            console.error(`[Worker] Supabase guest session insert returned unexpected row count (${Array.isArray(insertedRows) ? insertedRows.length : 'non-array'}) HTTP ${dbRes.status}`);
            return jsonResponse({
              success: false,
              error: 'Database session registration failed: Row persistence unconfirmed.'
            }, 500);
          }

          const insertedRow = insertedRows[0];
          const dbExpiresAt = insertedRow?.expires_at ? new Date(insertedRow.expires_at).getTime() : NaN;

          if (
            !insertedRow ||
            insertedRow.id !== sessionId ||
            insertedRow.session_token_hash !== tokenHash ||
            insertedRow.is_revoked !== false ||
            !Number.isFinite(dbExpiresAt) ||
            Date.now() >= dbExpiresAt ||
            Math.abs(dbExpiresAt - expiresAt) > 5000
          ) {
            console.error(`[Worker] Supabase guest session insert returned invalid row representation HTTP ${dbRes.status}`);
            return jsonResponse({
              success: false,
              error: 'Database session registration failed: Persisted row state invalid.'
            }, 500);
          }
        } catch (dbErr: any) {
          console.error('[Worker] Supabase guest session insert exception:', dbErr);
          return jsonResponse({
            success: false,
            error: 'Database error: Unable to register guest session.'
          }, 500);
        }

        const session: GuestSession = {
          id: sessionId,
          token,
          nickname: payload.nick,
          avatar: payload.av,
          gender: payload.gen,
          languagePref: payload.lng,
          is18Verified: payload.v18,
          createdAt: issuedAt,
          expiresAt: expiresAt,
        };

        guestSessions.set(token, session);

        return jsonResponse({ success: true, session });
      } catch (err: any) {
        return jsonResponse({ success: false, error: 'Malformed guest registration' }, 400);
      }
    }

    if (url.pathname === '/api/guest/validate') {
      const token = url.searchParams.get('token') || (request.method === 'POST' ? ((await request.json().catch(() => ({}))) as any)?.token : null);
      if (token) {
        const authCheck = await verifyGuestToken(token, guestSecretInfo, { supabaseUrl: baseSupabaseUrl, supabaseServiceKey });
        if (authCheck.valid && authCheck.session) {
          return jsonResponse({ success: true, valid: true, session: authCheck.session });
        }
        return jsonResponse({ success: false, valid: false, error: authCheck.reason || 'Invalid guest token' }, 401);
      }
      return jsonResponse({ success: false, valid: false, error: 'Token is required' }, 400);
    }

    if (url.pathname === '/api/guest/revoke' && request.method === 'POST') {
      try {
        const body: any = await request.json().catch(() => ({}));
        const token = body?.token;
        if (!token || typeof token !== 'string' || !token.startsWith('vx_gst_')) {
          return jsonResponse({ success: false, error: 'Valid guest token is required for revocation.' }, 400);
        }

        guestSessions.delete(token);

        if (!baseSupabaseUrl || !supabaseServiceKey) {
          return jsonResponse({
            success: false,
            error: 'Server configuration error: Database bindings missing.',
          }, 503);
        }

        const tokenHash = await computeTokenHash(token);

        try {
          const dbRes = await fetch(`${baseSupabaseUrl}/rest/v1/guest_sessions?session_token_hash=eq.${encodeURIComponent(tokenHash)}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'apikey': supabaseServiceKey,
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Prefer': 'return=representation',
            },
            body: JSON.stringify({
              is_revoked: true,
              revoked_at: new Date().toISOString(),
            }),
          });

          if (!dbRes.ok) {
            const errText = await dbRes.text().catch(() => '');
            console.error(`[Worker] Supabase guest session revoke failed HTTP ${dbRes.status}:`, errText);
            return jsonResponse({
              success: false,
              error: `Database session revocation failed (HTTP ${dbRes.status}).`
            }, 500);
          }

          const rows: any = await dbRes.json().catch(() => []);
          if (!Array.isArray(rows) || rows.length === 0) {
            // Check if already revoked (idempotent logout)
            const checkRes = await fetch(`${baseSupabaseUrl}/rest/v1/guest_sessions?session_token_hash=eq.${encodeURIComponent(tokenHash)}&select=id,is_revoked`, {
              headers: {
                'apikey': supabaseServiceKey,
                'Authorization': `Bearer ${supabaseServiceKey}`,
              },
            });
            if (checkRes.ok) {
              const existingRows: any = await checkRes.json().catch(() => []);
              if (Array.isArray(existingRows) && existingRows.length > 0) {
                if (existingRows[0].is_revoked === true) {
                  return jsonResponse({ success: true, message: 'Session already revoked.' });
                }
                return jsonResponse({ success: false, error: 'Database revocation was not applied.' }, 500);
              }
              return jsonResponse({ success: false, error: 'Session not found for revocation.' }, 404);
            }
            return jsonResponse({ success: false, error: 'Database error verifying revocation status.' }, 500);
          }

          if (rows[0]?.is_revoked === true) {
            return jsonResponse({ success: true });
          }
          return jsonResponse({ success: false, error: 'Database revocation was not applied.' }, 500);
        } catch (dbErr: any) {
          console.error('[Worker] Supabase guest session revoke exception:', dbErr);
          return jsonResponse({
            success: false,
            error: 'Database error: Unable to revoke guest session.'
          }, 500);
        }
      } catch (err: any) {
        return jsonResponse({ success: false, error: 'Malformed revocation request.' }, 400);
      }
    }

    // -------------------------------------------------------------------------
    // 6. AUTHENTICATED ACCOUNT DELETION ENDPOINT
    // -------------------------------------------------------------------------
    if (url.pathname === '/api/auth/delete-account' && request.method === 'POST') {
      try {
        const authHeader = request.headers.get('Authorization');
        const bearerToken = authHeader && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : null;

        if (!bearerToken || bearerToken.startsWith('vx_gst_') || bearerToken === 'local-session-token') {
          return jsonResponse({
            success: false,
            error: 'Unauthorized: Valid member authentication token required.',
          }, 401);
        }

        // Validate Bearer JWT token structure (3 dot-separated components)
        if (bearerToken.split('.').length !== 3) {
          return jsonResponse({
            success: false,
            error: 'Unauthorized: Malformed member authentication token format.',
          }, 401);
        }

        // Fail closed if server-side database configuration is unconfigured
        if (!baseSupabaseUrl || !supabaseServiceKey) {
          return jsonResponse({
            success: false,
            error: 'Server configuration error: Database bindings missing.',
          }, 503);
        }

        let verifiedUserId: string | null = null;

        // 1. Authoritative identity verification via Supabase Auth GET /auth/v1/user
        try {
          const userRes = await fetch(`${baseSupabaseUrl}/auth/v1/user`, {
            headers: {
              'apikey': supabaseAnonKey || supabaseServiceKey,
              'Authorization': `Bearer ${bearerToken}`,
            },
          });
          if (userRes.ok) {
            const userData: any = await userRes.json().catch(() => null);
            if (userData?.id) {
              verifiedUserId = userData.id;
            }
          }
        } catch (err) {
          console.warn('[Worker] Supabase member verification fetch exception:', err);
        }

        // 2. Fallback verification using Supabase client if available
        if (!verifiedUserId && supabaseClient) {
          try {
            const { data: userData, error: userErr } = await supabaseClient.auth.getUser(bearerToken);
            if (!userErr && userData?.user?.id) {
              verifiedUserId = userData.user.id;
            }
          } catch {
            // ignore
          }
        }

        if (!verifiedUserId) {
          return jsonResponse({
            success: false,
            error: 'Unauthorized: Invalid or expired member session token.',
          }, 401);
        }

        // Validate client-supplied userId against server-verified token identity (prevent spoofing)
        const body: any = await request.json().catch(() => ({}));
        const { userId: clientUserId } = body || {};
        if (clientUserId && clientUserId !== verifiedUserId) {
          return jsonResponse({
            success: false,
            error: 'Forbidden: Client user ID does not match authenticated token identity (spoofing rejected).',
          }, 403);
        }

        // Isolate-local in-flight concurrency guard
        if (activeAccountDeletions.has(verifiedUserId)) {
          return jsonResponse({
            success: false,
            error: 'Account deletion operation is already in progress.',
          }, 409);
        }

        activeAccountDeletions.add(verifiedUserId);
        try {
          const adminHeaders: Record<string, string> = {
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          };

          // 1. Anonymize user safety reports (preserve moderation records, scrub reporter personal identity)
          try {
            const reportsRes = await fetch(`${baseSupabaseUrl}/rest/v1/reports?reporter_user_id=eq.${encodeURIComponent(verifiedUserId)}`, {
              method: 'PATCH',
              headers: adminHeaders,
              body: JSON.stringify({ reporter_user_id: null }),
            });
            if (!reportsRes.ok) {
              const errText = await reportsRes.text().catch(() => '');
              console.error(`[Worker] Reports anonymization failed HTTP ${reportsRes.status}:`, errText);
              return jsonResponse({
                success: false,
                error: `Account deletion failed during reports anonymization (HTTP ${reportsRes.status}). Deletion sequence aborted.`,
              }, 500);
            }
          } catch (err: any) {
            console.error('[Worker] Reports anonymization network exception:', err);
            return jsonResponse({
              success: false,
              error: 'Account deletion failed: Network exception during reports anonymization. Deletion sequence aborted.',
            }, 500);
          }

          // 2. Anonymize user messages (preserve room/conversation message history, scrub sender personal identity)
          try {
            const messagesRes = await fetch(`${baseSupabaseUrl}/rest/v1/messages?sender_user_id=eq.${encodeURIComponent(verifiedUserId)}`, {
              method: 'PATCH',
              headers: adminHeaders,
              body: JSON.stringify({
                sender_user_id: null,
                sender_nickname: 'Deleted User',
                sender_avatar: '👤',
                client_nonce: null,
              }),
            });
            if (!messagesRes.ok) {
              const errText = await messagesRes.text().catch(() => '');
              console.error(`[Worker] Messages anonymization failed HTTP ${messagesRes.status}:`, errText);
              return jsonResponse({
                success: false,
                error: `Account deletion failed during messages anonymization (HTTP ${messagesRes.status}). Deletion sequence aborted.`,
              }, 500);
            }
          } catch (err: any) {
            console.error('[Worker] Messages anonymization network exception:', err);
            return jsonResponse({
              success: false,
              error: 'Account deletion failed: Network exception during messages anonymization. Deletion sequence aborted.',
            }, 500);
          }

          // 3. Delete user participation records from conversation_participants
          try {
            const partRes = await fetch(`${baseSupabaseUrl}/rest/v1/conversation_participants?user_id=eq.${encodeURIComponent(verifiedUserId)}`, {
              method: 'DELETE',
              headers: adminHeaders,
            });
            if (!partRes.ok) {
              const errText = await partRes.text().catch(() => '');
              console.error(`[Worker] Conversation participants deletion failed HTTP ${partRes.status}:`, errText);
              return jsonResponse({
                success: false,
                error: `Account deletion failed during conversation participants cleanup (HTTP ${partRes.status}). Deletion sequence aborted.`,
              }, 500);
            }
          } catch (err: any) {
            console.error('[Worker] Conversation participants cleanup network exception:', err);
            return jsonResponse({
              success: false,
              error: 'Account deletion failed: Network exception during conversation participants cleanup. Deletion sequence aborted.',
            }, 500);
          }

          // 4. Delete public user profile row from public.profiles
          try {
            const profileRes = await fetch(`${baseSupabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(verifiedUserId)}`, {
              method: 'DELETE',
              headers: adminHeaders,
            });
            if (!profileRes.ok) {
              const errText = await profileRes.text().catch(() => '');
              console.error(`[Worker] Profile deletion failed HTTP ${profileRes.status}:`, errText);
              return jsonResponse({
                success: false,
                error: `Account deletion failed during profile cleanup (HTTP ${profileRes.status}). Deletion sequence aborted.`,
              }, 500);
            }
          } catch (err: any) {
            console.error('[Worker] Profile cleanup network exception:', err);
            return jsonResponse({
              success: false,
              error: 'Account deletion failed: Network exception during profile cleanup. Deletion sequence aborted.',
            }, 500);
          }

          // 5. Permanently delete user from Supabase Auth via administrative endpoint
          try {
            const authAdminRes = await fetch(`${baseSupabaseUrl}/auth/v1/admin/users/${encodeURIComponent(verifiedUserId)}`, {
              method: 'DELETE',
              headers: adminHeaders,
            });

            if (!authAdminRes.ok && authAdminRes.status !== 404) {
              const errText = await authAdminRes.text().catch(() => '');
              console.error(`[Worker] Administrative Auth user deletion failed HTTP ${authAdminRes.status}:`, errText);
              return jsonResponse({
                success: false,
                error: `Account deletion failed during administrative authentication purge (HTTP ${authAdminRes.status}). Partial deletion aborted.`,
              }, 500);
            }
          } catch (err: any) {
            console.error('[Worker] Auth admin user deletion network exception:', err);
            return jsonResponse({
              success: false,
              error: 'Account deletion failed: Network exception during Auth user purge.',
            }, 500);
          }

          return jsonResponse({
            success: true,
            message: 'Account and associated profile data successfully deleted.',
          });
        } finally {
          activeAccountDeletions.delete(verifiedUserId);
        }
      } catch (err: any) {
        return jsonResponse({
          success: false,
          error: 'Malformed account deletion request.',
        }, 400);
      }
    }

    // -------------------------------------------------------------------------
    // 7. DEFAULT API FALLBACK FOR UNHANDLED /api/* ROUTES
    // -------------------------------------------------------------------------
    if (url.pathname.startsWith('/api/')) {
      return jsonResponse({
        success: true,
        message: 'Endpoint acknowledged by ChatLustora Edge Worker',
        path: url.pathname,
      });
    }

    // -------------------------------------------------------------------------
    // 7. STATIC ASSETS FALLBACK (Vite SPA)
    // -------------------------------------------------------------------------
    if (env?.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      if (assetRes.status === 404 && request.method === 'GET' && !url.pathname.startsWith('/api/')) {
        const indexUrl = new URL('/', request.url);
        return env.ASSETS.fetch(new Request(indexUrl, request));
      }
      return assetRes;
    }

    return new Response('Not Found', { status: 404 });
  },
};
