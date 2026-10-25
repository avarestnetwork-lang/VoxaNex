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

function getGuestSecretBindingDiagnostics(env: any) {
  const primary = env?.GUEST_SESSION_SECRET;
  const fallback = env?.VITE_GUEST_SESSION_SECRET;
  return {
    guestSessionSecretBindingPresent: primary !== undefined && primary !== null,
    guestSessionSecretNonEmptyString: typeof primary === 'string' && primary.trim().length > 0,
    viteGuestSessionSecretBindingPresent: fallback !== undefined && fallback !== null,
    viteGuestSessionSecretNonEmptyString: typeof fallback === 'string' && fallback.trim().length > 0,
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

function getSupabaseRestConfig(env: any) {
  const baseUrl = env?.SUPABASE_URL || env?.VITE_SUPABASE_URL || '';
  const serviceKey = env?.SUPABASE_SERVICE_ROLE_KEY || '';
  const anonKey = env?.SUPABASE_ANON_KEY || env?.VITE_SUPABASE_ANON_KEY || '';
  return { baseUrl, serviceKey, anonKey };
}

async function adminRest(env: any, path: string, init: RequestInit = {}): Promise<Response> {
  const { baseUrl, serviceKey } = getSupabaseRestConfig(env);
  if (!baseUrl || !serviceKey) throw new Error('Supabase server bindings are unavailable.');
  const headers = new Headers(init.headers);
  headers.set('apikey', serviceKey);
  headers.set('Authorization', `Bearer ${serviceKey}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${baseUrl}/rest/v1/${path}`, { ...init, headers });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

interface VerifiedIdentity {
  id: string;
  type: 'guest' | 'registered';
  session?: GuestSession;
}

async function authenticateIdentity(
  request: Request,
  env: any,
  secretInfo: { secret: string | null; isDevFallback: boolean },
  guestToken?: string
): Promise<{ identity?: VerifiedIdentity; error?: string; status?: number }> {
  guestToken = guestToken || request.headers.get('X-Guest-Token') || undefined;
  const authorization = request.headers.get('Authorization') || '';
  const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const { baseUrl, anonKey } = getSupabaseRestConfig(env);
  if (!accessToken && guestToken) {
    const result = await verifyGuestToken(guestToken, secretInfo, env);
    if (!result.valid || !result.session) return { error: 'Invalid guest session.', status: 401 };
    return { identity: { id: result.session.id, type: 'guest', session: result.session } };
  }
  if (!accessToken || !baseUrl || !anonKey) {
    return { error: 'A valid guest session or signed-in account is required.', status: 401 };
  }

  try {
    const response = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return { error: 'Invalid account session.', status: 401 };
    const user = await response.json() as any;
    if (!user?.id) return { error: 'Invalid account session.', status: 401 };
    return { identity: { id: user.id, type: 'registered' } };
  } catch {
    return { error: 'Account session could not be verified.', status: 503 };
  }
}

async function getParticipantRows(env: any, conversationId: string): Promise<any[]> {
  const response = await adminRest(env, `conversation_participants?conversation_id=eq.${encodeURIComponent(conversationId)}&select=user_id,guest_id`);
  if (!response.ok) throw new Error(`Could not verify conversation membership (HTTP ${response.status}).`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('Conversation membership response was invalid.');
  return rows;
}

async function isDatabaseParticipant(env: any, conversationId: string, identity: VerifiedIdentity): Promise<boolean> {
  const rows = await getParticipantRows(env, conversationId);
  return rows.some((row) => (identity.type === 'guest' ? row.guest_id : row.user_id) === identity.id);
}

async function resolveDatabaseConversationId(env: any, publicId: string, identity: VerifiedIdentity): Promise<string | null> {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(publicId)) return publicId;
  if (!publicId.startsWith('conv_')) return null;
  const parts = publicId.slice(5).split('_');
  if (parts.length !== 2 || !parts.includes(identity.id)) return null;
  const partnerId = parts.find((part) => part !== identity.id);
  if (!partnerId) return null;
  return databaseService.getDeterministicConvId(identity.id, partnerId);
}

async function identityExists(env: any, identity: VerifiedIdentity): Promise<boolean> {
  const table = identity.type === 'guest' ? 'guest_sessions' : 'profiles';
  const suffix = identity.type === 'guest' ? '&is_revoked=eq.false&expires_at=gt.' + encodeURIComponent(new Date().toISOString()) : '';
  const response = await adminRest(env, `${table}?id=eq.${encodeURIComponent(identity.id)}&select=id${suffix}`);
  if (!response.ok) throw new Error(`Could not verify participant record (HTTP ${response.status}).`);
  const rows = await response.json();
  return Array.isArray(rows) && rows.some((row) => row.id === identity.id);
}

async function insertParticipant(env: any, conversationId: string, identity: VerifiedIdentity): Promise<void> {
  const column = identity.type === 'guest' ? 'guest_id' : 'user_id';
  const filter = `${column}=eq.${encodeURIComponent(identity.id)}`;
  const existing = await adminRest(env, `conversation_participants?conversation_id=eq.${encodeURIComponent(conversationId)}&${filter}&select=id`);
  if (!existing.ok) throw new Error(`Could not check conversation participant (HTTP ${existing.status}).`);
  const rows = await existing.json();
  if (Array.isArray(rows) && rows.length) return;
  const inserted = await adminRest(env, 'conversation_participants', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ conversation_id: conversationId, user_id: identity.type === 'registered' ? identity.id : null, guest_id: identity.type === 'guest' ? identity.id : null }),
  });
  if (inserted.ok) return;
  // Another request may have inserted this same participant concurrently.
  if (inserted.status === 409) {
    const retry = await adminRest(env, `conversation_participants?conversation_id=eq.${encodeURIComponent(conversationId)}&${filter}&select=id`);
    if (retry.ok && Array.isArray(await retry.json())) return;
  }
  throw new Error(`Could not create conversation participant (HTTP ${inserted.status}).`);
}

async function createEventTicket(payload: Record<string, unknown>, secret: string): Promise<string> {
  const encoded = toBase64Url(JSON.stringify({ ...payload, exp: Date.now() + 60_000 }));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded));
  const hex = Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join('');
  return `vx_evt_${encoded}.${hex}`;
}

async function verifyEventTicket(token: string | null, secretInfo: { secret: string | null; isDevFallback: boolean }): Promise<any | null> {
  if (!token || !token.startsWith('vx_evt_') || !secretInfo.secret) return null;
  const [encoded, signature] = token.slice('vx_evt_'.length).split('.');
  if (!encoded || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return null;
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secretInfo.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBytes = new Uint8Array(signature.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
    if (!(await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(encoded)))) return null;
    const payload = JSON.parse(fromBase64Url(encoded));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

async function ensureDatabaseConversation(env: any, first: VerifiedIdentity, second: VerifiedIdentity): Promise<string> {
  if (first.id === second.id) throw new Error('A user cannot open a conversation with themselves.');
  if (!(await identityExists(env, first)) || !(await identityExists(env, second))) {
    throw new Error('A conversation participant could not be verified.');
  }
  const conversationId = await databaseService.getDeterministicConvId(first.id, second.id);
  const created = await adminRest(env, 'conversations', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ id: conversationId, type: 'direct' }),
  });
  if (!created.ok) throw new Error(`Could not create conversation (HTTP ${created.status}).`);
  await insertParticipant(env, conversationId, first);
  await insertParticipant(env, conversationId, second);
  return conversationId;
}

async function verifyGuestToken(
  token: string | undefined,
  secretInfo: { secret: string | null; isDevFallback: boolean },
  env?: any
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

  // The in-memory map is only a local-development fallback. Production sessions
  // are checked against durable storage so revocation works across isolates.
  if (secretInfo.isDevFallback && guestSessions.has(token)) {
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

    if (!secretInfo.isDevFallback) {
      const tokenHash = await sha256Hex(token);
      const rowsResponse = await adminRest(env, `guest_sessions?id=eq.${encodeURIComponent(session.id)}&session_token_hash=eq.${tokenHash}&select=id,nickname,avatar,language_pref,is_18_verified,expires_at,is_revoked`);
      if (!rowsResponse.ok) return { valid: false, reason: 'Guest session storage is unavailable.' };
      const rows = await rowsResponse.json();
      const stored = Array.isArray(rows) ? rows[0] : null;
      if (!stored || stored.is_revoked || Date.now() > new Date(stored.expires_at).getTime()) {
        return { valid: false, reason: 'Guest session is missing, expired, or revoked.' };
      }
      session.nickname = stored.nickname;
      session.avatar = stored.avatar;
      session.languagePref = stored.language_pref;
      session.is18Verified = Boolean(stored.is_18_verified);
      session.expiresAt = new Date(stored.expires_at).getTime();
    }

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
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Guest-Token',
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
    const userTicketMatch = url.pathname.match(/^\/api\/chat\/user\/([^/]+)\/events-ticket\/?$/);
    if (userTicketMatch && request.method === 'POST') {
      const userId = decodeURIComponent(userTicketMatch[1]);
      const body: any = await request.json().catch(() => ({}));
      const auth = await authenticateIdentity(request, env, guestSecretInfo, body?.guestToken);
      if (!auth.identity) return jsonResponse({ success: false, error: auth.error }, auth.status || 401);
      if (auth.identity.id !== userId) return jsonResponse({ success: false, error: 'Identity mismatch.' }, 403);
      const ticket = await createEventTicket({ scope: 'user', identityId: auth.identity.id, identityType: auth.identity.type }, guestSecretInfo.secret!);
      return jsonResponse({ success: true, ticket });
    }

    const userSseMatch = url.pathname.match(/^\/api\/chat\/user\/([^/]+)\/events\/?$/);
    if (userSseMatch && request.method === 'GET') {
      const userId = decodeURIComponent(userSseMatch[1]);
      const ticket = await verifyEventTicket(url.searchParams.get('ticket'), guestSecretInfo);
      if (!ticket || ticket.scope !== 'user' || ticket.identityId !== userId) {
        return jsonResponse({ success: false, error: 'Unauthorized event stream.' }, 401);
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
            const authCheck = await verifyGuestToken(guestToken, guestSecretInfo, env);
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
      const userId = url.searchParams.get('userId');
      const auth = await authenticateIdentity(request, env, guestSecretInfo);
      if (!auth.identity) return jsonResponse({ success: false, error: auth.error }, auth.status || 401);
      if (userId && userId !== auth.identity.id) return jsonResponse({ success: false, error: 'Identity mismatch.' }, 403);
      try {
        const column = auth.identity.type === 'guest' ? 'guest_id' : 'user_id';
        const response = await adminRest(env, `conversation_participants?${column}=eq.${encodeURIComponent(auth.identity.id)}&select=conversation_id`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const rows = await response.json();
        const conversations: string[] = [];
        for (const row of Array.isArray(rows) ? rows : []) {
          const participants = await getParticipantRows(env, row.conversation_id);
          const ids = participants.map((participant) => participant.user_id || participant.guest_id).filter(Boolean).sort();
          if (ids.length === 2) conversations.push(`conv_${ids[0]}_${ids[1]}`);
        }
        return jsonResponse({ success: true, conversations });
      } catch (error) {
        console.error('[VX-DM] Conversation list lookup failed:', error instanceof Error ? error.message : 'unknown error');
        return jsonResponse({ success: false, error: 'Conversation list unavailable.' }, 503);
      }
    }

    // POST /api/chat/conversations: Initialize or get conversation ID
    if (url.pathname === '/api/chat/conversations' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const { userId, partnerId } = body || {};
        if (!userId || !partnerId) {
          return jsonResponse({ success: false, error: 'User ID and Partner ID are required.' }, 400);
        }
        const auth = await authenticateIdentity(request, env, guestSecretInfo, body?.guestToken);
        if (!auth.identity) return jsonResponse({ success: false, error: auth.error }, auth.status || 401);
        if (auth.identity.id !== userId || auth.identity.id === partnerId) {
          return jsonResponse({ success: false, error: 'Conversation identity mismatch.' }, 403);
        }
        let partner: VerifiedIdentity | null = null;
        const guestPartner: VerifiedIdentity = { id: partnerId, type: 'guest' };
        const registeredPartner: VerifiedIdentity = { id: partnerId, type: 'registered' };
        if (await identityExists(env, guestPartner)) partner = guestPartner;
        else if (await identityExists(env, registeredPartner)) partner = registeredPartner;
        if (!partner) return jsonResponse({ success: false, error: 'Conversation partner could not be verified.' }, 404);
        await ensureDatabaseConversation(env, auth.identity, partner);
        const convId = `conv_${[auth.identity.id, partner.id].sort().join('_')}`;
        if (!conversationMessages.has(convId)) {
          conversationMessages.set(convId, []);
        }
        return jsonResponse({ success: true, conversationId: convId });
      } catch (error) {
        console.error('[VX-DM] Conversation initialization failed:', error instanceof Error ? error.message : 'unknown error');
        return jsonResponse({ success: false, error: 'Conversation could not be initialized.' }, 503);
      }
    }

    const convTicketMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/events-ticket\/?$/);
    if (convTicketMatch && request.method === 'POST') {
      const publicConversationId = decodeURIComponent(convTicketMatch[1]);
      const body: any = await request.json().catch(() => ({}));
      const auth = await authenticateIdentity(request, env, guestSecretInfo, body?.guestToken);
      if (!auth.identity) return jsonResponse({ success: false, error: auth.error }, auth.status || 401);
      try {
        const dbConversationId = await resolveDatabaseConversationId(env, publicConversationId, auth.identity);
        if (!dbConversationId || !(await isDatabaseParticipant(env, dbConversationId, auth.identity))) {
          return jsonResponse({ success: false, error: 'Conversation membership required.' }, 403);
        }
        const ticket = await createEventTicket({ scope: 'conversation', identityId: auth.identity.id, identityType: auth.identity.type, databaseConversationId: dbConversationId, publicConversationId }, guestSecretInfo.secret!);
        return jsonResponse({ success: true, ticket });
      } catch (error) {
        console.error('[VX-DM] Event ticket could not be issued:', error instanceof Error ? error.message : 'unknown error');
        return jsonResponse({ success: false, error: 'Conversation event access unavailable.' }, 503);
      }
    }

    // GET /api/chat/conversations/:id/events: SSE Stream for conversation
    const convEventsMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/events\/?$/);
    if (convEventsMatch && request.method === 'GET') {
      const convId = decodeURIComponent(convEventsMatch[1]);
      const ticket = await verifyEventTicket(url.searchParams.get('ticket'), guestSecretInfo);
      if (!ticket || ticket.scope !== 'conversation' || ticket.publicConversationId !== convId) {
        return jsonResponse({ success: false, error: 'Unauthorized event stream.' }, 401);
      }
      try {
        const identity: VerifiedIdentity = { id: ticket.identityId, type: ticket.identityType };
        if (!(await isDatabaseParticipant(env, ticket.databaseConversationId, identity))) {
          return jsonResponse({ success: false, error: 'Conversation membership required.' }, 403);
        }
      } catch {
        return jsonResponse({ success: false, error: 'Conversation access could not be verified.' }, 503);
      }
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
        const auth = await authenticateIdentity(request, env, guestSecretInfo);
        if (!auth.identity) return jsonResponse({ success: false, error: auth.error }, auth.status || 401);
        if (reqUserId && reqUserId !== auth.identity.id) return jsonResponse({ success: false, error: 'Identity mismatch.' }, 403);
        try {
          const dbConvId = await resolveDatabaseConversationId(env, convId, auth.identity);
          if (!dbConvId || !(await isDatabaseParticipant(env, dbConvId, auth.identity))) {
            return jsonResponse({ success: false, error: 'Conversation membership required.' }, 403);
          }
          const response = await adminRest(env, `messages?conversation_id=eq.${encodeURIComponent(dbConvId)}&select=id,conversation_id,sender_user_id,sender_guest_id,sender_nickname,sender_avatar,content,media_url,media_type,client_nonce,created_at&order=created_at.asc`);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          const messages = (Array.isArray(data) ? data : []).map((m: any) => ({
            id: m.id,
            conversationId: convId,
            senderId: m.sender_user_id || m.sender_guest_id,
            senderNickname: m.sender_nickname,
            senderAvatar: m.sender_avatar,
            content: m.content,
            mediaUrl: m.media_url || undefined,
            mediaType: m.media_type || undefined,
            clientNonce: m.client_nonce || undefined,
            timestamp: m.created_at,
            isDirect: true,
            status: 'delivered',
          }));
          return jsonResponse({ success: true, messages });
        } catch (error) {
          const diagnosticId = crypto.randomUUID();
          console.error(`[VX-DM] [${diagnosticId}] History retrieval failed:`, error instanceof Error ? error.message : 'unknown error');
          return jsonResponse({ success: false, error: 'Message history is temporarily unavailable.', diagnosticId }, 503);
        }
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

          const auth = await authenticateIdentity(request, env, guestSecretInfo, guestToken);
          if (!auth.identity) return jsonResponse({ success: false, error: auth.error }, auth.status || 401);
          if (auth.identity.id !== senderId) return jsonResponse({ success: false, error: 'Sender identity mismatch.' }, 403);
          if (typeof content === 'string' && content.length > 2000) return jsonResponse({ success: false, error: 'Message exceeds maximum length.' }, 400);

          const publicParts = convId.startsWith('conv_') ? convId.slice(5).split('_') : [];
          const resolvedRecipientId = recipientId || publicParts.find((part) => part !== auth.identity!.id);
          if (!resolvedRecipientId || resolvedRecipientId === auth.identity.id || publicParts.length !== 2 || !publicParts.includes(auth.identity.id) || !publicParts.includes(resolvedRecipientId)) {
            return jsonResponse({ success: false, error: 'Conversation participant mismatch.' }, 403);
          }

          const partnerGuest: VerifiedIdentity = { id: resolvedRecipientId, type: 'guest' };
          const partnerUser: VerifiedIdentity = { id: resolvedRecipientId, type: 'registered' };
          let recipientIdentity: VerifiedIdentity | null = null;
          if (await identityExists(env, partnerGuest)) recipientIdentity = partnerGuest;
          else if (await identityExists(env, partnerUser)) recipientIdentity = partnerUser;
          if (!recipientIdentity) return jsonResponse({ success: false, error: 'Conversation partner could not be verified.' }, 403);

          const dbConvId = await ensureDatabaseConversation(env, auth.identity, recipientIdentity);
          const profileResponse = auth.identity.type === 'registered'
            ? await adminRest(env, `profiles?id=eq.${encodeURIComponent(auth.identity.id)}&select=nickname,avatar_url`)
            : null;
          if (profileResponse && !profileResponse.ok) throw new Error(`Profile lookup failed (HTTP ${profileResponse.status}).`);
          const profileRows = profileResponse ? await profileResponse.json() : [];
          const profile = Array.isArray(profileRows) ? profileRows[0] : null;
          const verifiedNickname = auth.identity.session?.nickname || profile?.nickname || 'User';
          const verifiedAvatar = auth.identity.session?.avatar || profile?.avatar_url || '👤';
          const verifiedSenderId = auth.identity.id;
          const verifiedSenderType = auth.identity.type;
          const cleanContent = sanitizeContent(content || '');
          const correlationId = crypto.randomUUID();
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

          const persisted = await adminRest(env, 'messages', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              id: message.id,
              conversation_id: dbConvId,
              sender_user_id: auth.identity.type === 'registered' ? verifiedSenderId : null,
              sender_guest_id: auth.identity.type === 'guest' ? verifiedSenderId : null,
              sender_nickname: verifiedNickname,
              sender_avatar: verifiedAvatar,
              content: cleanContent,
              media_url: mediaUrl || null,
              media_type: mediaType || null,
              client_nonce: clientNonce || null,
            }),
          });
          if (!persisted.ok) {
            console.error(`[VX-DM] [${correlationId}] Message persistence failed with HTTP ${persisted.status}.`);
            return jsonResponse({ success: false, error: 'Message could not be saved.', diagnosticId: correlationId }, 503);
          }


          const rtDiag: any = {
              persistence: 'confirmed',
              conversationId: dbConvId,
          };

          // Broadcast via local SSE for immediate delivery to clients on THIS isolate
          try {
              broadcastToConversation(convId, 'new_dm', message);
              broadcastToUser(resolvedRecipientId, 'incoming_dm', { conversationId: convId, message });
              rtDiag.localSseAttempted = true;
          } catch (sseErr: any) {
              rtDiag.localSseError = sseErr.message || 'SSE error';
              console.warn(`[VX-DM] [${correlationId}] Local SSE broadcast error:`, sseErr);
          }

          return jsonResponse({ success: true, message, correlationId, serverDiag: rtDiag });


        } catch (err: any) {
          const diagnosticId = crypto.randomUUID();
          console.error(`[VX-DM] [${diagnosticId}] Send failed:`, err instanceof Error ? err.message : 'unknown error');
          return jsonResponse({ success: false, error: 'Message could not be delivered.', diagnosticId }, 503);
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

        if (typeof nickname !== 'string' || nickname.trim().length < 2) {
          return jsonResponse({ success: false, error: 'Nickname must contain at least 2 characters.' }, 400);
        }

        const sessionId = crypto.randomUUID();
        const issuedAt = Date.now();
        const expiresAt = issuedAt + 24 * 60 * 60 * 1000;

        const payload = {
          sid: sessionId,
          nick: nickname.trim().slice(0, 24),
          av: avatar || '⚡',
          gen: gender || 'prefer_not_to_say',
          lng: languagePref || 'en',
          v18: Boolean(is18Verified),
          iat: issuedAt,
          exp: expiresAt,
        };

        if (!guestSecretInfo.secret) {
          console.error('[VX-GUEST] Guest session secret binding diagnostic', getGuestSecretBindingDiagnostics(env));
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

        const { baseUrl, serviceKey } = getSupabaseRestConfig(env);
        if (baseUrl && serviceKey) {
          const tokenHash = await sha256Hex(token);
          const ip = request.headers.get('CF-Connecting-IP') || '';
          const userAgent = request.headers.get('User-Agent') || '';
          const persisted = await adminRest(env, 'guest_sessions', {
            method: 'POST',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              id: sessionId,
              session_token_hash: tokenHash,
              nickname: session.nickname,
              avatar: session.avatar,
              ip_fingerprint_hash: ip ? await sha256Hex(ip) : null,
              user_agent_hash: userAgent ? await sha256Hex(userAgent) : null,
              language_pref: session.languagePref,
              is_18_verified: session.is18Verified,
              expires_at: new Date(expiresAt).toISOString(),
            }),
          });
          if (!persisted.ok) {
            console.error('[VX-GUEST] Session persistence failed:', { status: persisted.status });
            return jsonResponse({ success: false, error: 'Guest session could not be initialized. Please retry.' }, 503);
          }
        } else if (!guestSecretInfo.isDevFallback) {
          const environment = env?.ENVIRONMENT;
          const safeEnvironment = typeof environment === 'string' && /^(development|staging|production|preview)$/i.test(environment.trim())
            ? environment.trim().toLowerCase()
            : 'unset-or-unrecognized';
          console.error('[VX-GUEST] Guest session storage binding diagnostic', {
            hasGuestSessionSecret: Boolean(guestSecretInfo.secret),
            hasSupabaseUrl: typeof baseUrl === 'string' && baseUrl.trim().length > 0,
            hasServiceRoleKey: typeof serviceKey === 'string' && serviceKey.trim().length > 0,
            isDevFallback: guestSecretInfo.isDevFallback,
            requestPath: url.pathname,
            deploymentEnvironment: safeEnvironment,
          });
          return jsonResponse({ success: false, error: 'Guest session storage is not configured.' }, 503);
        }

        guestSessions.set(token, session);

        return jsonResponse({ success: true, session });
      } catch (err: any) {
        return jsonResponse({ success: false, error: 'Malformed guest registration' }, 400);
      }
    }

    if (url.pathname === '/api/guest/validate') {
      const token = url.searchParams.get('token') || (request.method === 'POST' ? ((await request.json().catch(() => ({}))) as any)?.token : null);
      if (token) {
        const authCheck = await verifyGuestToken(token, guestSecretInfo, env);
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
          const { baseUrl, serviceKey } = getSupabaseRestConfig(env);
          if (baseUrl && serviceKey) {
            const tokenHash = await sha256Hex(body.token);
            const response = await adminRest(env, `guest_sessions?session_token_hash=eq.${tokenHash}`, {
              method: 'PATCH',
              headers: { Prefer: 'return=minimal' },
              body: JSON.stringify({ is_revoked: true, revoked_at: new Date().toISOString() }),
            });
            if (!response.ok) return jsonResponse({ success: false, error: 'Guest session could not be revoked.' }, 503);
          } else if (!guestSecretInfo.isDevFallback) {
            return jsonResponse({ success: false, error: 'Guest session storage is not configured.' }, 503);
          }
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
