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
  if (secretValue && typeof secretValue === 'string' && secretValue.trim().length > 0) {
    return { secret: secretValue.trim(), isDevFallback: false };
  }
  return { 
    secret: null, 
    isDevFallback: env?.ENVIRONMENT === 'development' || env?.DEV === true 
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
  secretInfo: { secret: string | null },
  dbEnv?: { supabaseUrl?: string; supabaseServiceKey?: string }
): Promise<{ valid: boolean; session?: GuestSession; reason?: string }> {
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
      return { valid: false, reason: 'Database configuration missing for guest session verification.' };
    }

    const tokenHash = await computeTokenHash(token);
    let canonicalRow: any = null;
    try {
      const queryUrl = `${dbEnv.supabaseUrl}/rest/v1/guest_sessions?session_token_hash=eq.${encodeURIComponent(tokenHash)}&select=id,is_revoked,expires_at`;
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

      const rows: any = await res.json().catch(() => []);
      if (!Array.isArray(rows) || rows.length === 0) {
        return { valid: false, reason: 'Guest session not found or unregistered.' };
      }

      canonicalRow = rows[0];

      // Explicitly enforce row.id === p.sid
      if (canonicalRow.id !== p.sid) {
        return { valid: false, reason: 'Session identity mismatch.' };
      }

      if (canonicalRow.is_revoked) {
        guestSessions.delete(token);
        return { valid: false, reason: 'Guest session has been revoked.' };
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

// Global in-memory maps for Edge instance
const roomMessages = new Map<string, HubMessage[]>();
const roomPresence = new Map<string, Map<string, PresenceMember>>();
const roomTyping = new Map<string, Map<string, { nickname: string; expiresAt: number }>>();
const guestSessions = new Map<string, GuestSession>();

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
          const body: any = await request.json();
          const {
            senderId,
            senderNickname,
            senderAvatar,
            senderType = 'guest',
            content,
            mediaUrl,
            mediaType,
            linkPreview,
            clientNonce,
          } = body || {};

          if (!senderId || !senderNickname) {
            return jsonResponse({ success: false, error: 'Invalid sender profile.' }, 400);
          }

          if (!content && !mediaUrl) {
            return jsonResponse({ success: false, error: 'Message content or media is required.' }, 400);
          }

          let verifiedSenderId = senderId;
          let verifiedNickname = senderNickname;
          let verifiedAvatar = senderAvatar || '👤';

          if (senderType === 'guest') {
            const guestToken = body?.guestToken;
            const authCheck = await verifyGuestToken(guestToken, guestSecretInfo, { supabaseUrl: baseSupabaseUrl, supabaseServiceKey });
            if (!authCheck.valid || !authCheck.session) {
              return jsonResponse({
                success: false,
                error: `Unauthorized: ${authCheck.reason || 'Invalid or missing guest session token.'}`,
              }, 401);
            }
            verifiedSenderId = authCheck.session.id;
            verifiedNickname = authCheck.session.nickname;
            verifiedAvatar = authCheck.session.avatar;
          }

          const cleanContent = sanitizeContent(content || '');

          const message: HubMessage = {
            id: crypto.randomUUID(),
            roomId,
            senderId: verifiedSenderId,
            senderNickname: verifiedNickname,
            senderAvatar: verifiedAvatar,
            senderType,
            content: cleanContent,
            rawContent: content,
            mediaUrl,
            mediaType,
            linkPreview,
            clientNonce,
            timestamp: new Date().toISOString(),
            status: 'delivered',
          };

          if (!roomMessages.has(roomId)) {
            roomMessages.set(roomId, []);
          }
          const list = roomMessages.get(roomId)!;

          // Deduplicate if clientNonce already exists
          if (clientNonce && list.some((m) => m.clientNonce === clientNonce)) {
            const existing = list.find((m) => m.clientNonce === clientNonce)!;
            return jsonResponse({ success: true, message: existing });
          }

          list.push(message);
          if (list.length > 500) {
            list.shift();
          }

          // Secure server-side Supabase persistence using service-role key if configured
          if (baseSupabaseUrl && supabaseServiceKey) {
            try {
              // Resolve slug to real UUID for database persistence
              const realRoomId = await databaseService.resolveRoomId(roomId, supabaseClient);
              
              if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(realRoomId)) {
                console.error(`[Worker] Failed to resolve room slug '${roomId}' to valid UUID. Resolved: '${realRoomId}'`);
                return jsonResponse({
                  success: false,
                  error: 'Database persistence failed: Invalid room identifier.'
                }, 400);
              }
              
              const dbRes = await fetch(`${baseSupabaseUrl}/rest/v1/messages`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': supabaseServiceKey,
                  'Authorization': `Bearer ${supabaseServiceKey}`,
                  'Prefer': 'return=minimal',
                },
                body: JSON.stringify({
                  id: message.id,
                  room_id: realRoomId,
                  sender_guest_id: senderType === 'guest' ? verifiedSenderId : null,
                  sender_user_id: senderType === 'registered' ? verifiedSenderId : null,
                  sender_nickname: verifiedNickname,
                  sender_avatar: verifiedAvatar,
                  content: cleanContent,
                  client_nonce: clientNonce,
                }),
              });

              if (!dbRes.ok) {
                const errText = await dbRes.text().catch(() => '');
                console.error(`[Worker] Supabase message persistence failed HTTP ${dbRes.status}:`, errText);
                return jsonResponse({
                  success: false,
                  error: `Database persistence failed (HTTP ${dbRes.status}). Message was not saved.`
                }, 500);
              }
            } catch (dbErr: any) {
              console.error('[Worker] Supabase persistence exception:', dbErr);
              return jsonResponse({
                success: false,
                error: 'Database error: Unable to persist message.'
              }, 500);
            }
          } else if (!guestSecretInfo.isDevFallback) {
            return jsonResponse({
              success: false,
              error: 'Server configuration error: Database bindings missing in production.'
            }, 503);
          }

          // Broadcast to all active SSE subscribers in this room (Isolate-local)
          broadcastToRoom(roomId, 'new_message', message);

          const rtDiag: any = {
              platform: 'Cloudflare Worker',
              hasSupabaseUrl: !!env?.SUPABASE_URL,
              hasServiceRoleKey: !!env?.SUPABASE_SERVICE_ROLE_KEY,
              supabaseClientReady: !!supabaseClient,
              senderType
          };

          // Broadcast to Supabase Realtime (Cross-environment / Cross-isolate)
          const rtPromise = (async () => {
              if (!supabaseClient) {
                  rtDiag.rtStatus = 'no_client';
                  return;
              }
              try {
                  const status = await databaseService.broadcastMessage(roomId, message as any, supabaseClient);
                  rtDiag.rtStatus = status;
                  console.log(`[Worker] Supabase RT broadcast status for room ${roomId}: ${status}`);
              } catch (e: any) {
                  rtDiag.rtError = e.message || 'Unknown RT error';
                  console.warn(`[Worker] Supabase RT broadcast failed for room ${roomId}:`, e);
              }
          })();

          if (ctx?.waitUntil) {
              ctx.waitUntil(rtPromise);
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

    // GET /api/chat/conversations/:id/events: SSE Stream for conversation
    const convEventsMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/events\/?$/);
    if (convEventsMatch && request.method === 'GET') {
      const convId = decodeURIComponent(convEventsMatch[1]);
      let intervalId: any = null;
      let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          if (!conversationStreams.has(convId)) {
            conversationStreams.set(convId, new Set());
          }
          const controllers = conversationStreams.get(convId)!;
          controllers.add(controller);

          const encoder = new TextEncoder();
          try {
            controller.enqueue(encoder.encode(`event: connected\ndata: {"status":"connected","convId":"${convId}"}\n\n`));
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
          const controllers = conversationStreams.get(convId);
          if (controllers && streamController) {
            controllers.delete(streamController);
            if (controllers.size === 0) {
              conversationStreams.delete(convId);
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
        const authHeader = request.headers.get('Authorization');
        const bearerToken = authHeader && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : null;

        // Determine token type: guest tokens start with 'vx_gst_'
        const guestToken = guestTokenParam || (bearerToken && bearerToken.startsWith('vx_gst_') ? bearerToken : null);
        const memberJwt = !guestToken && bearerToken && !bearerToken.startsWith('vx_gst_') ? bearerToken : null;
        const clientSuppliedUserId = url.searchParams.get('userId');

        let verifiedUserId: string | null = null;

        if (guestToken) {
          const authCheck = await verifyGuestToken(guestToken, guestSecretInfo, { supabaseUrl: baseSupabaseUrl, supabaseServiceKey });
          if (!authCheck.valid || !authCheck.session) {
            return jsonResponse({
              success: false,
              error: `Unauthorized: ${authCheck.reason || 'Invalid or expired guest session token.'}`,
            }, 401);
          }
          verifiedUserId = authCheck.session.id;

          if (clientSuppliedUserId && clientSuppliedUserId !== verifiedUserId) {
            return jsonResponse({
              success: false,
              error: 'Unauthorized: Client user ID does not match validated guest session.',
            }, 403);
          }
        } else if (memberJwt) {
          // Independently validate registered user token
          if (baseSupabaseUrl) {
            try {
              const userRes = await fetch(`${baseSupabaseUrl}/auth/v1/user`, {
                headers: {
                  'apikey': supabaseAnonKey || supabaseServiceKey,
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

          // In dev/test fallback or if Supabase client is available:
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

          // In local dev/test fallback without active Supabase network:
          if (!verifiedUserId && guestSecretInfo.isDevFallback) {
            try {
              const parts = memberJwt.split('.');
              if (parts.length === 3) {
                const payload = JSON.parse(fromBase64Url(parts[1]));
                if (payload.sub || payload.id) {
                  verifiedUserId = payload.sub || payload.id;
                }
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

          if (clientSuppliedUserId && clientSuppliedUserId !== verifiedUserId) {
            return jsonResponse({
              success: false,
              error: 'Unauthorized: Client user ID does not match validated session.',
            }, 403);
          }
        } else {
          // Reject unauthenticated requests regardless of clientSuppliedUserId
          return jsonResponse({
            success: false,
            error: 'Unauthorized: Authentication required to access conversation history.',
          }, 401);
        }

        // Authorize conversation membership strictly using verified identity against database
        const isGuestCaller = Boolean(guestToken);
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        let dbConvId: string | null = null;

        if (convId.startsWith('conv_')) {
          const idWithoutPrefix = convId.slice('conv_'.length);
          const parts = idWithoutPrefix.split('_');

          if (parts.length !== 2) {
            return jsonResponse({
              success: false,
              error: 'Invalid conversation slug format.',
            }, 400);
          }

          const [id1, id2] = parts;

          if (!uuidRegex.test(id1) || !uuidRegex.test(id2)) {
            return jsonResponse({
              success: false,
              error: 'Invalid participant identifier in conversation slug.',
            }, 400);
          }

          if (id1 === id2) {
            return jsonResponse({
              success: false,
              error: 'Invalid conversation slug: Duplicate participant identifiers are not allowed.',
            }, 400);
          }

          if (id1 !== verifiedUserId && id2 !== verifiedUserId) {
            return jsonResponse({
              success: false,
              error: 'Unauthorized: Authenticated caller is not a participant in this conversation slug.',
            }, 403);
          }

          const partnerId = (id1 === verifiedUserId) ? id2 : id1;
          dbConvId = await databaseService.getDeterministicConvId(verifiedUserId, partnerId);
        } else if (uuidRegex.test(convId)) {
          // Direct database UUID request
          dbConvId = convId;
        } else {
          // Invalid conversation identifier (neither a valid slug nor a valid UUID)
          return jsonResponse({
            success: false,
            error: 'Invalid conversation identifier format.',
          }, 400);
        }

        if (!dbConvId || !uuidRegex.test(dbConvId)) {
          return jsonResponse({
            success: false,
            error: 'Invalid or unresolved conversation identifier.',
          }, 400);
        }

        let isMember = false;

        if (baseSupabaseUrl && supabaseServiceKey) {
          try {
            const memberFilter = isGuestCaller
              ? `guest_id=eq.${encodeURIComponent(verifiedUserId)}`
              : `user_id=eq.${encodeURIComponent(verifiedUserId)}`;

            // Strictly query conversation_participants using ONLY the canonical conversation UUID
            const participantUrl = `${baseSupabaseUrl}/rest/v1/conversation_participants?conversation_id=eq.${encodeURIComponent(dbConvId)}&${memberFilter}&select=id`;

            const partRes = await fetch(participantUrl, {
              headers: {
                'apikey': supabaseServiceKey,
                'Authorization': `Bearer ${supabaseServiceKey}`,
              },
            });

            if (partRes.ok) {
              let partData: any;
              try {
                partData = await partRes.json();
              } catch (jsonErr) {
                console.error('[Worker] JSON parse error on participant verification:', jsonErr);
                return jsonResponse({
                  success: false,
                  error: 'Database error parsing membership verification response.',
                }, 500);
              }

              if (!Array.isArray(partData)) {
                console.error('[Worker] Unexpected non-array response for participant check:', partData);
                return jsonResponse({
                  success: false,
                  error: 'Database error verifying conversation membership.',
                }, 500);
              }

              if (partData.length > 0) {
                isMember = true;
              }
            } else {
              const errText = await partRes.text().catch(() => '');
              console.error(`[Worker] Participant verification failed HTTP ${partRes.status}:`, errText);
              return jsonResponse({
                success: false,
                error: `Database error verifying conversation membership (HTTP ${partRes.status}).`,
              }, 500);
            }
          } catch (partErr) {
            console.error('[Worker] Participant verification exception:', partErr);
            return jsonResponse({
              success: false,
              error: 'Database error verifying conversation membership.',
            }, 500);
          }
        } else if (guestSecretInfo.isDevFallback) {
          // Local development fallback mode only when explicitly enabled
          if (convId.includes(verifiedUserId) || dbConvId.includes(verifiedUserId)) {
            isMember = true;
          }
        } else {
          return jsonResponse({
            success: false,
            error: 'Server configuration error: Database bindings missing in production.',
          }, 503);
        }

        if (!isMember) {
          return jsonResponse({
            success: false,
            error: 'Unauthorized: Not a member of this conversation.',
          }, 403);
        }

        // Fetch history using server-side Supabase service-role key after identity and membership are proven
        if (baseSupabaseUrl && supabaseServiceKey) {
          try {
            // Strictly query messages using ONLY the canonical conversation UUID
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
              conversationId: convId,
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
          const guestTokenParam = url.searchParams.get('guestToken') || request.headers.get('x-guest-token');
          const authHeader = request.headers.get('Authorization');
          const bearerToken = authHeader && authHeader.startsWith('Bearer ')
            ? authHeader.slice(7).trim()
            : null;

          const guestToken = guestTokenParam || (bearerToken && bearerToken.startsWith('vx_gst_') ? bearerToken : null);
          const memberJwt = !guestToken && bearerToken && !bearerToken.startsWith('vx_gst_') ? bearerToken : null;

          const body: any = await request.json();
          const {
            senderId: clientSenderId,
            senderNickname,
            senderAvatar,
            recipientId,
            content,
            mediaUrl,
            mediaType,
            linkPreview,
            clientNonce,
            guestToken: bodyGuestToken,
          } = body || {};

          const effectiveGuestToken = guestToken || bodyGuestToken;

          let verifiedSenderId: string | null = null;
          let verifiedSenderType: 'registered' | 'guest' = 'registered';
          let verifiedNickname = senderNickname || 'User';
          let verifiedAvatar = senderAvatar || '👤';

          if (effectiveGuestToken) {
            const authCheck = await verifyGuestToken(effectiveGuestToken, guestSecretInfo, { supabaseUrl: baseSupabaseUrl, supabaseServiceKey });
            if (!authCheck.valid || !authCheck.session) {
              return jsonResponse({ success: false, error: 'Unauthorized: Invalid or expired guest session token.' }, 401);
            }
            if (clientSenderId && authCheck.session.id !== clientSenderId) {
              return jsonResponse({ success: false, error: 'Unauthorized: Guest token mismatch.' }, 403);
            }
            verifiedSenderType = 'guest';
            verifiedSenderId = authCheck.session.id;
            verifiedNickname = authCheck.session.nickname;
            verifiedAvatar = authCheck.session.avatar;
          } else if (memberJwt) {
            if (baseSupabaseUrl) {
              try {
                const userRes = await fetch(`${baseSupabaseUrl}/auth/v1/user`, {
                  headers: {
                    'apikey': supabaseAnonKey || supabaseServiceKey,
                    'Authorization': `Bearer ${memberJwt}`,
                  },
                });
                if (userRes.ok) {
                  const userData: any = await userRes.json();
                  if (userData && userData.id) {
                    verifiedSenderId = userData.id;
                  }
                }
              } catch (err) {
                console.warn('[Worker] Supabase member verification fetch exception:', err);
              }
            }

            if (!verifiedSenderId && supabaseClient) {
              try {
                const { data: userData, error: userErr } = await supabaseClient.auth.getUser(memberJwt);
                if (!userErr && userData?.user?.id) {
                  verifiedSenderId = userData.user.id;
                }
              } catch {
                // ignore
              }
            }

            if (!verifiedSenderId && guestSecretInfo.isDevFallback) {
              try {
                const parts = memberJwt.split('.');
                if (parts.length === 3) {
                  const payload = JSON.parse(fromBase64Url(parts[1]));
                  if (payload.sub || payload.id) {
                    verifiedSenderId = payload.sub || payload.id;
                  }
                }
              } catch {
                // ignore
              }
            }

            if (!verifiedSenderId) {
              return jsonResponse({ success: false, error: 'Unauthorized: Invalid or expired member session token.' }, 401);
            }

            if (clientSenderId && clientSenderId !== verifiedSenderId) {
              return jsonResponse({ success: false, error: 'Unauthorized: Sender ID does not match authenticated member token (forgery prevented).' }, 403);
            }
            verifiedSenderType = 'registered';
          } else {
            return jsonResponse({ success: false, error: 'Unauthorized: Authentication required to post messages.' }, 401);
          }

          if (!verifiedSenderId || (!content && !mediaUrl)) {
            return jsonResponse({ success: false, error: 'Sender ID and content are required.' }, 400);
          }

          // Authorize: Verify that verifiedSenderId is a participant in this conversation
          let resolvedRecipientId = recipientId;
          if (!resolvedRecipientId && convId.startsWith('conv_')) {
            const parts = convId.replace(/^conv_/, '').split('_');
            resolvedRecipientId = parts.find(p => p !== verifiedSenderId);
          }

          if (!resolvedRecipientId) {
            return jsonResponse({ success: false, error: 'Unauthorized: Recipient identity could not be verified.' }, 400);
          }

          if (convId.startsWith('conv_')) {
            const idWithoutPrefix = convId.replace(/^conv_/, '');
            const isMember =
              (resolvedRecipientId && convId === `conv_${[verifiedSenderId, resolvedRecipientId].sort().join('_')}`) ||
              idWithoutPrefix === verifiedSenderId ||
              idWithoutPrefix.startsWith(verifiedSenderId + '_') ||
              idWithoutPrefix.endsWith('_' + verifiedSenderId) ||
              idWithoutPrefix.includes('_' + verifiedSenderId + '_');

            if (!isMember) {
              return jsonResponse({ success: false, error: 'Unauthorized: Sender is not a member of this conversation.' }, 403);
            }
          }



          const cleanContent = sanitizeContent(content || '');
          const correlationId = `dm_tx_${crypto.randomUUID().slice(0, 8)}`;
          const rtDiag: Record<string, any> = {};
          const message: HubMessage = {
            id: crypto.randomUUID(),
            roomId: convId, // Legacy shim
            conversationId: convId,
            senderId: verifiedSenderId,
            senderNickname: verifiedNickname,
            senderAvatar: verifiedAvatar,
            senderType: verifiedSenderType,
            content: cleanContent,
            rawContent: content,
            mediaUrl,
            mediaType,
            linkPreview,
            clientNonce,
            timestamp: new Date().toISOString(),
            status: 'delivered',
          };

          // Persist to Supabase if configured
          if (baseSupabaseUrl && supabaseServiceKey) {
            try {
              const directMessagesRestUrl = `${baseSupabaseUrl}/rest/v1/messages`;
              const isSenderUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(verifiedSenderId);
              
              // Resolve deterministic conversation UUID if needed
              let dbConvId = convId;
              if (convId.startsWith('conv_') && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(convId)) {
                 dbConvId = await databaseService.getDeterministicConvId(verifiedSenderId, resolvedRecipientId);
                 // Ensure the conversation record exists in DB to satisfy foreign key
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
              }

              const dbRes = await fetch(directMessagesRestUrl, {
                method: 'POST',
                headers: {
                  'apikey': supabaseServiceKey,
                  'Authorization': `Bearer ${supabaseServiceKey}`,
                  'Content-Type': 'application/json',
                  'Prefer': 'return=minimal',
                },
                body: JSON.stringify({
                  conversation_id: dbConvId,
                  sender_user_id: verifiedSenderType === 'registered' ? verifiedSenderId : null,
                  sender_guest_id: verifiedSenderType === 'guest' ? verifiedSenderId : null,
                  sender_nickname: verifiedNickname,
                  sender_avatar: verifiedAvatar,
                  content: cleanContent,
                  media_url: mediaUrl,
                  media_type: mediaType,
                  client_nonce: clientNonce,
                }),
              });

              if (!dbRes.ok) {
                const errText = await dbRes.text().catch(() => '');
                console.error(`[VX-DM] [${correlationId}] Supabase DM persistence failed HTTP ${dbRes.status}:`, errText);
                return jsonResponse({ success: false, error: `Database DM persistence failed (HTTP ${dbRes.status}).` }, 500);
              }
              // Broadcast to recipient across all instances
              await databaseService.broadcastToUser(resolvedRecipientId, 'incoming_dm', { conversationId: dbConvId, message });
              
              rtDiag.localSseAttempted = true;
            } catch (dbErr: any) {
              console.error(`[VX-DM] [${correlationId}] Supabase persistence error:`, dbErr);
              return jsonResponse({ success: false, error: 'Database error: Unable to persist direct message.' }, 500);
            }
          } else if (!guestSecretInfo.isDevFallback) {
            return jsonResponse({ success: false, error: 'Server configuration error: Database bindings missing in production.' }, 503);
          }
          
          // Broadcast via local SSE for immediate delivery to clients on THIS isolate
          try {
              broadcastToConversation(convId, 'new_dm', message);
              broadcastToUser(recipientId, 'incoming_dm', { conversationId: convId, message });
          } catch (sseErr: any) {
              console.warn(`[VX-DM] [${correlationId}] Local SSE broadcast error:`, sseErr);
          }

          // Broadcast via Supabase Realtime for cross-isolate delivery
          const broadcastPromise = (async () => {
              if (!supabaseClient) {
                  rtDiag.rtStatus = 'no_client';
                  return;
              }
              try {
                const results = await Promise.all([
                    databaseService.broadcastDM(convId, recipientId, message as any, supabaseClient),
                    databaseService.broadcastToUser(recipientId, 'incoming_dm', { conversationId: convId, message }, supabaseClient)
                ]);
                rtDiag.rtResults = results;
                console.log(`[VX-DM] [${correlationId}] Supabase broadcast results:`, results);
              } catch (e: any) {
                rtDiag.rtError = e.message || 'Unknown RT error';
                console.error(`[VX-DM] [${correlationId}] Supabase broadcast fatal error:`, e);
              }
          })();

          // Ensure background work finishes even if we return the response
          if (ctx?.waitUntil) {
              ctx.waitUntil(broadcastPromise);
          } else {
              await broadcastPromise;
          }

          // Store in in-memory map for fast local retrieval and dev fallback
          if (!conversationMessages.has(convId)) {
            conversationMessages.set(convId, []);
          }
          const localList = conversationMessages.get(convId)!;
          if (!clientNonce || !localList.some((m) => m.clientNonce === clientNonce)) {
            localList.push(message);
            if (localList.length > 500) localList.shift();
          }

          return jsonResponse({ success: true, message, correlationId, serverDiag: rtDiag });


        } catch (err: any) {
          return jsonResponse({ success: false, error: 'Failed to deliver message' }, 400);
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
    // 6. DEFAULT API FALLBACK FOR UNHANDLED /api/* ROUTES
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
