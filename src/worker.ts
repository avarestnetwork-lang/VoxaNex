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

const DEFAULT_GUEST_SECRET = 'voxanex_default_secure_entropy_salt_2026';

function getGuestSecret(env: any): { secret: string | null; isDevFallback: boolean } {
  const secretValue = env?.GUEST_SESSION_SECRET || env?.VITE_GUEST_SESSION_SECRET;
  if (secretValue && typeof secretValue === 'string' && secretValue.trim().length > 0) {
    return { secret: secretValue.trim(), isDevFallback: false };
  }
  // Allow fallback ONLY in explicit local development mode
  if (env?.ENVIRONMENT === 'development' || env?.DEV === true) {
    return { secret: DEFAULT_GUEST_SECRET, isDevFallback: true };
  }
  // Production MUST fail closed!
  return { secret: null, isDevFallback: false };
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
  const base64Payload = toBase64Url(JSON.stringify(payload));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret || DEFAULT_GUEST_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(base64Payload));
  const sigBytes = Array.from(new Uint8Array(sigBuffer));
  const sigHex = sigBytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `vx_gst_${base64Payload}.${sigHex}`;
}

async function verifyGuestToken(
  token: string | undefined,
  secretInfo: { secret: string | null; isDevFallback: boolean }
): Promise<{ valid: boolean; session?: GuestSession; reason?: string }> {
  if (!secretInfo.secret) {
    return { valid: false, reason: 'Server configuration error: GUEST_SESSION_SECRET is missing in production.' };
  }

  if (!token || !token.startsWith('vx_gst_')) {
    return { valid: false, reason: 'Malformed token prefix' };
  }

  // Reject local development tokens in production environments
  if (token.startsWith('vx_gst_local_') || token.includes('_local_')) {
    if (secretInfo.isDevFallback) {
      return {
        valid: true,
        session: {
          id: `guest_local_${Date.now()}`,
          token,
          nickname: 'Guest_User',
          avatar: '⚡',
          is18Verified: false,
          createdAt: Date.now(),
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        },
      };
    } else {
      return { valid: false, reason: 'Local simulation tokens are prohibited in production.' };
    }
  }

  // Accept active in-memory sessions if present in this isolate
  if (guestSessions.has(token)) {
    const s = guestSessions.get(token)!;
    if (Date.now() <= s.expiresAt) {
      return { valid: true, session: s };
    }
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

    if (p.exp && Date.now() > p.exp) {
      return { valid: false, reason: 'Guest session expired' };
    }

    if (p.iat && p.iat > Date.now() + 60000) {
      return { valid: false, reason: 'Invalid token issuance timestamp in future' };
    }

    const session: GuestSession = {
      id: p.sid || p.id,
      token,
      nickname: p.nick || p.nickname || 'Guest_User',
      avatar: p.av || p.avatar || '⚡',
      gender: p.gen || p.gender,
      languagePref: p.lng || p.languagePref || 'en',
      is18Verified: Boolean(p.v18 || p.is18Verified),
      createdAt: p.iat || p.createdAt || Date.now(),
      expiresAt: p.exp || p.expiresAt || (Date.now() + 24 * 60 * 60 * 1000),
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

    // Resolve Supabase environment variable binding aliases safely (SUPABASE_* or VITE_SUPABASE_*)
    const baseSupabaseUrl = env?.SUPABASE_URL || env?.VITE_SUPABASE_URL || '';
    const supabaseAnonKey = env?.SUPABASE_ANON_KEY || env?.VITE_SUPABASE_ANON_KEY || '';
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
            const authCheck = await verifyGuestToken(guestToken, guestSecretInfo);
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
      const userId = url.searchParams.get('userId');
      const guestToken = url.searchParams.get('guestToken');
      
      if (!userId) {
        return jsonResponse({ success: false, error: 'User ID is required.' }, 400);
      }
      
      // Validate guest token if provided (server-side auth)
      if (guestToken) {
        const authCheck = await verifyGuestToken(guestToken, guestSecretInfo);
        if (authCheck.valid && authCheck.session) {
          if (authCheck.session.id !== userId) {
            return jsonResponse({ success: false, error: 'Unauthorized: Guest token mismatch.' }, 403);
          }
        } else if (userId.startsWith('guest_')) {
          return jsonResponse({ success: false, error: `Unauthorized: ${authCheck.reason || 'Invalid guest session.'}` }, 401);
        }
      }
      
      if (baseSupabaseUrl && supabaseServiceKey) {
        try {
          const convListRestUrl = `${baseSupabaseUrl}/rest/v1/conversation_participants?user_id=eq.${userId}&select=conversation_id`;
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

      // Fallback
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
        const body: any = await request.json();
        const { userId, partnerId } = body || {};
        if (!userId || !partnerId) {
          return jsonResponse({ success: false, error: 'User ID and Partner ID are required.' }, 400);
        }
        const convId = `conv_${[userId, partnerId].sort().join('_')}`;
        if (!conversationMessages.has(convId)) {
          conversationMessages.set(convId, []);
        }
        return jsonResponse({ success: true, conversationId: convId });
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
        const reqUserId = url.searchParams.get('userId');
        const guestToken = url.searchParams.get('guestToken');

        let verifiedUserId = reqUserId;
        if (guestToken) {
          const authCheck = await verifyGuestToken(guestToken, guestSecretInfo);
          if (authCheck.valid && authCheck.session) {
            verifiedUserId = authCheck.session.id;
          } else {
            return jsonResponse({ success: false, error: 'Unauthorized: Invalid guest session token.' }, 401);
          }
        }

        if (verifiedUserId && convId.startsWith('conv_')) {
          const idWithoutPrefix = convId.replace(/^conv_/, '');
          const isMember =
            idWithoutPrefix === verifiedUserId ||
            idWithoutPrefix.startsWith(verifiedUserId + '_') ||
            idWithoutPrefix.endsWith('_' + verifiedUserId) ||
            idWithoutPrefix.includes('_' + verifiedUserId + '_');

          if (!isMember) {
            return jsonResponse({ success: false, error: 'Unauthorized: Not a member of this conversation.' }, 403);
          }
        } else if (!verifiedUserId && convId.startsWith('conv_')) {
          return jsonResponse({ success: false, error: 'Unauthorized: User ID or guest token required.' }, 401);
        }

        if (baseSupabaseUrl && supabaseAnonKey) {
          try {
            // Resolve conversation identity
            let dbConvId = convId;
            if (convId.startsWith('conv_') && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(convId)) {
                if (reqUserId) {
                   const parts = convId.replace('conv_', '').split('_');
                   const partnerId = parts.find(p => p !== reqUserId);
                   if (partnerId) {
                      dbConvId = await databaseService.getDeterministicConvId(reqUserId, partnerId);
                   }
                }
            }

            const convMessagesRestUrl = `${baseSupabaseUrl}/rest/v1/messages?conversation_id=eq.${dbConvId}&order=created_at.asc`;
            const headers: Record<string, string> = {
              'apikey': supabaseAnonKey,
            };
            if (request.headers.has('Authorization')) {
              headers['Authorization'] = request.headers.get('Authorization')!;
            } else {
              headers['Authorization'] = `Bearer ${supabaseAnonKey}`;
            }

            const res = await fetch(convMessagesRestUrl, { headers });
            const data = await res.json();
            const messages = (Array.isArray(data) ? data : []).map((m: any) => ({
              id: m.id,
              conversationId: m.conversation_id,
              senderId: m.sender_user_id || m.sender_guest_id || 'anonymous',
              senderNickname: m.sender_nickname,
              senderAvatar: m.sender_avatar,
              content: m.content,
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

        return jsonResponse({ success: true, messages: [] });
      }

      if (request.method === 'POST') {
        try {
          const body: any = await request.json();
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
            guestToken,
          } = body || {};

          if (!senderId || (!content && !mediaUrl)) {
            return jsonResponse({ success: false, error: 'Sender ID and content are required.' }, 400);
          }

          let verifiedSenderId = senderId;
          let verifiedSenderType: 'registered' | 'guest' = 'registered';
          let verifiedNickname = senderNickname || 'User';
          let verifiedAvatar = senderAvatar || '👤';

          if (guestToken) {
            const authCheck = await verifyGuestToken(guestToken, guestSecretInfo);
            if (!authCheck.valid || !authCheck.session) {
              return jsonResponse({ success: false, error: 'Unauthorized: Invalid guest session token.' }, 401);
            }
            if (authCheck.session.id !== senderId) {
              return jsonResponse({ success: false, error: 'Unauthorized: Guest token mismatch.' }, 403);
            }
            verifiedSenderType = 'guest';
            verifiedSenderId = authCheck.session.id;
            verifiedNickname = authCheck.session.nickname;
            verifiedAvatar = authCheck.session.avatar;
          } else if (senderId.startsWith('guest_')) {
            return jsonResponse({ success: false, error: 'Unauthorized: Valid guest session required for guest IDs.' }, 401);
          }

          // Authorize: Verify that verifiedSenderId is a participant in this conversation
          if (convId.startsWith('conv_')) {
            const idWithoutPrefix = convId.replace(/^conv_/, '');
            const isMember =
              (recipientId && convId === `conv_${[verifiedSenderId, recipientId].sort().join('_')}`) ||
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
                 dbConvId = await databaseService.getDeterministicConvId(verifiedSenderId, recipientId);
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
                  sender_user_id: isSenderUuid ? verifiedSenderId : null,
                  sender_guest_id: !isSenderUuid ? verifiedSenderId : null,
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
            } catch (dbErr: any) {
              console.error(`[VX-DM] [${correlationId}] Supabase persistence error:`, dbErr);
              return jsonResponse({ success: false, error: 'Database error: Unable to persist direct message.' }, 500);
            }
          } else if (!guestSecretInfo.isDevFallback) {
            return jsonResponse({ success: false, error: 'Server configuration error: Database bindings missing in production.' }, 503);
          }


          const rtDiag: any = {
              platform: 'Cloudflare Worker',
              hasSupabaseUrl: !!env?.SUPABASE_URL,
              hasServiceRoleKey: !!env?.SUPABASE_SERVICE_ROLE_KEY,
              supabaseClientReady: !!supabaseClient
          };

          // Broadcast via local SSE for immediate delivery to clients on THIS isolate
          try {
              broadcastToConversation(convId, 'new_dm', message);
              broadcastToUser(recipientId, 'incoming_dm', { conversationId: convId, message });
              rtDiag.localSseAttempted = true;
          } catch (sseErr: any) {
              rtDiag.localSseError = sseErr.message || 'SSE error';
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

        const sessionId = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
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
          return jsonResponse({
            success: false,
            error: 'Guest session creation failed: Missing GUEST_SESSION_SECRET configuration in production environment.',
          }, 500);
        }

        const token = await signGuestToken(payload, guestSecretInfo.secret);
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
        const authCheck = await verifyGuestToken(token, guestSecretInfo);
        if (authCheck.valid && authCheck.session) {
          return jsonResponse({ success: true, valid: true, session: authCheck.session });
        }
        return jsonResponse({ success: false, valid: false, error: authCheck.reason || 'Invalid guest token' }, 401);
      }
      return jsonResponse({ success: false, valid: false, error: 'Token is required' }, 400);
    }

    if (url.pathname === '/api/guest/revoke' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        if (body?.token) {
          guestSessions.delete(body.token);
        }
      } catch {
        // ignore
      }
      return jsonResponse({ success: true });
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
