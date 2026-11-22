import { databaseService } from './services/databaseService';
import { getSupabaseClientFromEnv } from './lib/supabaseClient';
import { ROOMS_CONFIG } from './config/voxanexConfig';
import bcrypt from 'bcryptjs';
import {
  validateMediaBinary,
  validateMediaFileMetadata,
  ALLOWED_MEDIA_SPECS,
  normalizeMimeType,
  sanitizeDisplayFileName,
  isSafeMediaUrl,
  isValidChatMediaType,
} from './lib/mediaValidation';

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
  mediaType?: 'gif' | 'image' | 'audio';
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
  ageDeclarationAccepted?: boolean;
  createdAt: number;
  expiresAt: number;
}

const ADULT_ROOM_IDENTIFIERS = new Set<string>(
  ROOMS_CONFIG.filter((r) => r.is18Plus).flatMap((r) => [
    r.slug.toLowerCase(),
    r.id.toLowerCase(),
    `room-${r.slug.toLowerCase()}`,
  ])
);

function safeDecodeURIComponent(str: string): string {
  if (!str) return '';
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

function isAdultRoom(roomIdOrSlug: string): boolean {
  if (!roomIdOrSlug) return false;
  const clean = safeDecodeURIComponent(roomIdOrSlug).trim().toLowerCase();
  if (!clean) return false;
  if (ADULT_ROOM_IDENTIFIERS.has(clean)) return true;
  return clean === 'sex' || clean === 'adult' || clean === 'adults' || clean.startsWith('adult-') || clean.startsWith('adult_') || clean.endsWith('-adult') || clean.endsWith('_adult');
}

function isAuthorizedForAdultRoom(authResult: { verifiedUserId: string; isGuestCaller: boolean; guestSession?: GuestSession }): boolean {
  if (!authResult.isGuestCaller) {
    // Registered member is authenticated
    return true;
  }
  // Guest caller must have signed dec18 claim (ageDeclarationAccepted) or v18 claim (is18Verified)
  return Boolean(authResult.guestSession?.ageDeclarationAccepted || authResult.guestSession?.is18Verified);
}

function getGuestSecret(env: any): { secret: string | null; isDevFallback: boolean } {
  // GUEST_SESSION_SECRET is the ONLY accepted Worker signing-secret binding.
  // VITE_GUEST_SESSION_SECRET and hardcoded defaults are strictly prohibited.
  const secretValue = env?.GUEST_SESSION_SECRET;
  const isDevFallback = env?.ENVIRONMENT === 'development' || env?.DEV === true;
  if (typeof secretValue === 'string' && secretValue.trim().length > 0) {
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
  if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
    throw new Error('GUEST_SESSION_SECRET is required to sign guest tokens.');
  }
  const cleanSecret = secret.trim();
  const base64Payload = toBase64Url(JSON.stringify(payload));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(cleanSecret),
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
  if (!secretInfo.secret || typeof secretInfo.secret !== 'string' || secretInfo.secret.trim().length === 0) {
    return { valid: false, reason: 'Server configuration error: GUEST_SESSION_SECRET is missing.' };
  }
  const cleanSecret = secretInfo.secret.trim();

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
      encoder.encode(cleanSecret),
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
      is18Verified: Boolean(canonicalRow.is_18_verified),
      ageDeclarationAccepted: Boolean(p.dec18 ?? p.ageDeclarationAccepted),
      createdAt: p.iat,
      expiresAt: p.exp,
    };

    return { valid: true, session };
  } catch (err: any) {
    return { valid: false, reason: 'Token verification exception: ' + (err.message || 'Malformed') };
  }
}

export async function signAdminToken(payload: any, secret: string): Promise<string> {
  if (!secret || typeof secret !== 'string' || secret.trim().length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters.');
  }
  const fullPayload = {
    ...payload,
    iss: 'chatlustora-admin-auth',
    aud: 'chatlustora-admin-console',
  };
  const base64Payload = toBase64Url(JSON.stringify(fullPayload));
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
  return `vx_adm_${base64Payload}.${sigHex}`;
}

export async function verifyAdminToken(
  token: string | undefined,
  secret: string | undefined
): Promise<{ valid: boolean; payload?: any; reason?: string }> {
  if (!secret || secret.trim().length < 32) {
    return { valid: false, reason: 'Server configuration error: Invalid JWT_SECRET.' };
  }
  if (!token || !token.startsWith('vx_adm_')) {
    return { valid: false, reason: 'Missing or invalid token prefix.' };
  }

  const raw = token.slice('vx_adm_'.length);
  const dotIdx = raw.indexOf('.');
  if (dotIdx === -1) return { valid: false, reason: 'Invalid token structure.' };

  const base64Payload = raw.slice(0, dotIdx);
  const signatureHex = raw.slice(dotIdx + 1);

  if (!/^[0-9a-f]{64}$/i.test(signatureHex)) {
    return { valid: false, reason: 'Malformed signature.' };
  }

  const sigBytes = new Uint8Array(signatureHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  const encoder = new TextEncoder();

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(base64Payload));
    if (!valid) return { valid: false, reason: 'Invalid signature.' };

    const payload = JSON.parse(fromBase64Url(base64Payload));
    const now = Date.now();
    
    if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0) {
      return { valid: false, reason: 'Invalid subject.' };
    }

    if (payload.role !== 'admin') {
      return { valid: false, reason: 'Incorrect role.' };
    }

    if (payload.iss !== 'chatlustora-admin-auth') {
      return { valid: false, reason: 'Invalid issuer.' };
    }

    if (payload.aud !== 'chatlustora-admin-console') {
      return { valid: false, reason: 'Invalid audience.' };
    }

    if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) {
      return { valid: false, reason: 'Invalid timestamps.' };
    }

    if (payload.iat > now + 60000) {
      return { valid: false, reason: 'Token issued in the future.' };
    }

    if (now >= payload.exp) {
      return { valid: false, reason: 'Session expired.' };
    }
    
    const maxLife = 8 * 60 * 60 * 1000;
    if (payload.exp - payload.iat > maxLife + 5000) { // 5s grace
      return { valid: false, reason: 'Session lifetime exceeds limit.' };
    }

    return { valid: true, payload };
  } catch (err) {
    return { valid: false, reason: 'Token verification failed.' };
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
const adminLoginAttempts = new Map<string, { attempts: number; windowStart: number }>();
// NOTE: Per-isolate upload rate limit tracking (25 uploads / 60s per user/guest).
// Not synchronized across Cloudflare edge isolates; supplement with Cloudflare WAF /
// Rate Limiting rules if global coordination across pops/isolates is required.
const uploadRateLimits = new Map<string, { count: number; windowStart: number }>();

const UPLOAD_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const UPLOAD_RATE_LIMIT_MAX_REQUESTS = 25;

export interface R2ObjectPutOptions {
  httpMetadata?: {
    contentType?: string;
    contentDisposition?: string;
    cacheControl?: string;
  };
  customMetadata?: Record<string, string>;
}

export interface R2ObjectBody {
  body: ReadableStream<Uint8Array> | Uint8Array | ArrayBuffer | string;
  size?: number;
  httpMetadata?: {
    contentType?: string;
    contentDisposition?: string;
    cacheControl?: string;
  };
  customMetadata?: Record<string, string>;
}

export interface R2BucketBinding {
  put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: R2ObjectPutOptions
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(keys: string | string[]): Promise<void | boolean>;
}

export interface WorkerEnv {
  CHAT_MEDIA?: R2BucketBinding;
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  GUEST_SESSION_SECRET?: string;
  BACKEND_URL?: string;
  ALLOWED_ORIGINS?: string;
  ENVIRONMENT?: string;
  DEV?: boolean;
  ADMIN_USER?: string;
  ADMIN_PASS_HASH?: string;
  JWT_SECRET?: string;
  [key: string]: any;
}

function checkAndConsumeUploadRateLimit(rateKey: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  if (uploadRateLimits.size > 500 || Math.random() < 0.05) {
    for (const [k, entry] of uploadRateLimits.entries()) {
      if (now - entry.windowStart >= UPLOAD_RATE_LIMIT_WINDOW_MS) {
        uploadRateLimits.delete(k);
      }
    }
  }

  let record = uploadRateLimits.get(rateKey);
  if (!record || now - record.windowStart >= UPLOAD_RATE_LIMIT_WINDOW_MS) {
    uploadRateLimits.set(rateKey, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (record.count >= UPLOAD_RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSec = Math.max(1, Math.ceil((record.windowStart + UPLOAD_RATE_LIMIT_WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSec };
  }

  record.count += 1;
  return { allowed: true };
}

function buildSafeContentDisposition(rawFileName: string, fallbackExt: string): string {
  const cleaned = sanitizeDisplayFileName(rawFileName || `media.${fallbackExt}`)
    .replace(/["\\;\r\n]/g, '_');
  return `inline; filename="${cleaned}"`;
}

// Active SSE client streams per room & conversation (using ReadableStreamDefaultController for synchronous non-promise enqueuing)
const roomStreams = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
const conversationMessages = new Map<string, HubMessage[]>();
const conversationStreams = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
const userDMStreams = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
const conversationTyping = new Map<string, Map<string, { nickname: string; expiresAt: number }>>();
const conversationReadState = new Map<string, Map<string, { readUntilId: string; readAt: string }>>();

const DEFAULT_PRODUCTION_CORS_ORIGIN = 'https://chatlustora.com';
const DEV_ALLOWED_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8787',
  'http://127.0.0.1:8787',
] as const;

const NATIVE_CORS_METHODS = ['GET', 'POST', 'OPTIONS'] as const;
const PROXIED_CORS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
const NATIVE_CORS_HEADERS = [
  'Content-Type',
  'Authorization',
  'Accept',
  'X-Guest-Token',
  'X-Context-Type',
  'X-Context-Id',
  'X-File-Name',
  'X-Idempotency-Key',
  'X-Requested-With',
] as const;
const PROXIED_CORS_HEADERS = [
  ...NATIVE_CORS_HEADERS,
  'X-User-Role',
  'X-User-Id',
] as const;

function isRecognizedDevMode(env?: WorkerEnv): boolean {
  return env?.ENVIRONMENT === 'development' || env?.DEV === true;
}

function isLoopbackHost(hostname: string): boolean {
  const cleanHost = hostname.toLowerCase();
  return cleanHost === 'localhost' || cleanHost === '127.0.0.1' || cleanHost === '[::1]';
}

function parseExactOrigin(rawOrigin: string, allowHttpLoopback: boolean): string | null {
  if (!rawOrigin || typeof rawOrigin !== 'string') return null;
  if (rawOrigin !== rawOrigin.trim()) return null;
  const lower = rawOrigin.toLowerCase();
  if (lower === 'null' || rawOrigin.includes('*')) return null;

  try {
    const parsed = new URL(rawOrigin);
    if (parsed.username || parsed.password) return null;
    if (parsed.origin !== rawOrigin) return null;
    if (parsed.protocol === 'https:') {
      return parsed.origin;
    }
    if (allowHttpLoopback && parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) {
      return parsed.origin;
    }
    return null;
  } catch {
    return null;
  }
}

function buildAllowedCorsOrigins(env?: WorkerEnv): Set<string> {
  const isDev = isRecognizedDevMode(env);
  const origins = new Set<string>([DEFAULT_PRODUCTION_CORS_ORIGIN]);

  if (isDev) {
    for (const devOrigin of DEV_ALLOWED_CORS_ORIGINS) {
      origins.add(devOrigin);
    }
  }

  if (typeof env?.ALLOWED_ORIGINS === 'string' && env.ALLOWED_ORIGINS.trim().length > 0) {
    for (const candidate of env.ALLOWED_ORIGINS.split(',')) {
      const parsed = parseExactOrigin(candidate.trim(), isDev);
      if (parsed) {
        origins.add(parsed);
      }
    }
  }

  return origins;
}

function isWorkerNativeEndpoint(pathname: string): boolean {
  if (
    pathname === '/api/health' ||
    pathname === '/api/admin/login' ||
    pathname === '/api/admin/me' ||
    pathname === '/api/admin/logout' ||
    pathname === '/api/media/upload' ||
    pathname === '/api/media/upload/validate' ||
    pathname === '/api/chat/conversations'
  ) {
    return true;
  }
  if (/^\/api\/media\/[^/]+$/.test(pathname)) return true;
  if (/^\/api\/guest\/(session|validate|revoke)$/.test(pathname)) return true;
  if (/^\/api\/auth\/(delete-account|data-export|profile\/update)$/.test(pathname)) return true;
  if (/^\/api\/chat\/user\/[^/]+\/events\/?$/.test(pathname)) return true;
  if (/^\/api\/chat\/rooms\/[^/]+\/(events\/?|messages|presence|typing)$/.test(pathname)) return true;
  if (/^\/api\/chat\/conversations\/[^/]+\/(events\/?|messages|typing|read)$/.test(pathname)) return true;
  return false;
}

interface ResolvedCorsPolicy {
  hasOriginHeader: boolean;
  allowedOrigin: string | null;
  allowedMethods: readonly string[];
  allowedHeaders: readonly string[];
}

function resolveCorsPolicy(
  request: Request,
  env: WorkerEnv | undefined,
  pathname: string
): ResolvedCorsPolicy {
  const isDev = isRecognizedDevMode(env);
  const rawOrigin = request.headers.get('Origin');
  const allowedSet = buildAllowedCorsOrigins(env);

  let allowedOrigin: string | null = null;
  if (rawOrigin !== null) {
    const parsedOrigin = parseExactOrigin(rawOrigin, isDev);
    if (parsedOrigin && allowedSet.has(parsedOrigin)) {
      allowedOrigin = parsedOrigin;
    }
  }

  const isProxiedNonNative = Boolean(env?.BACKEND_URL) && pathname.startsWith('/api/') && !isWorkerNativeEndpoint(pathname);
  return {
    hasOriginHeader: rawOrigin !== null,
    allowedOrigin,
    allowedMethods: isProxiedNonNative ? PROXIED_CORS_METHODS : NATIVE_CORS_METHODS,
    allowedHeaders: isProxiedNonNative ? PROXIED_CORS_HEADERS : NATIVE_CORS_HEADERS,
  };
}

function mergeVaryOrigin(headers: Headers): void {
  const existing = headers.get('Vary');
  if (!existing || !existing.trim()) {
    headers.set('Vary', 'Origin');
    return;
  }
  const tokens = existing
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (tokens.some((part) => part.toLowerCase() === 'origin' || part === '*')) {
    return;
  }
  headers.set('Vary', [...tokens, 'Origin'].join(', '));
}

function stripCorsHeaders(headers: Headers): void {
  headers.delete('Access-Control-Allow-Origin');
  headers.delete('Access-Control-Allow-Methods');
  headers.delete('Access-Control-Allow-Headers');
  headers.delete('Access-Control-Allow-Credentials');
  headers.delete('Access-Control-Expose-Headers');
  headers.delete('Access-Control-Max-Age');
}

function handleCorsPreflight(
  request: Request,
  pathname: string,
  env: WorkerEnv | undefined
): Response {
  const policy = resolveCorsPolicy(request, env, pathname);
  const headers = new Headers();
  mergeVaryOrigin(headers);

  if (!policy.hasOriginHeader || !policy.allowedOrigin) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Forbidden: Cross-origin request from untrusted origin denied.',
      }),
      { status: 403, headers }
    );
  }

  const reqMethod = request.headers.get('Access-Control-Request-Method');
  if (reqMethod) {
    const normalizedReqMethod = reqMethod.trim().toUpperCase();
    if (!policy.allowedMethods.includes(normalizedReqMethod)) {
      headers.set('Content-Type', 'application/json; charset=utf-8');
      headers.set('Allow', policy.allowedMethods.join(', '));
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Method Not Allowed for CORS preflight.',
        }),
        { status: 405, headers }
      );
    }
  }

  headers.set('Access-Control-Allow-Origin', policy.allowedOrigin);
  headers.set('Access-Control-Allow-Methods', policy.allowedMethods.join(', '));
  headers.set('Access-Control-Allow-Headers', policy.allowedHeaders.join(', '));
  headers.set('Access-Control-Max-Age', '86400');

  return new Response(null, { status: 204, headers });
}

function applyCorsToApiResponse(
  response: Response,
  request: Request,
  env: WorkerEnv | undefined,
  pathname: string
): Response {
  const headers = new Headers(response.headers);
  stripCorsHeaders(headers);
  mergeVaryOrigin(headers);

  const policy = resolveCorsPolicy(request, env, pathname);
  if (policy.allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', policy.allowedOrigin);
    headers.set('Access-Control-Allow-Methods', policy.allowedMethods.join(', '));
    headers.set('Access-Control-Allow-Headers', policy.allowedHeaders.join(', '));
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function mediaErrorResponse(error: string, status: number): Response {
  return jsonResponse(
    { success: false, error },
    status,
    {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    }
  );
}

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
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

const MAX_MEDIA_REQUEST_BODY_BYTES = 15 * 1024 * 1024; // 15 MB
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readBoundedRequestBody(
  request: Request,
  maxBytes: number = MAX_MEDIA_REQUEST_BODY_BYTES
): Promise<{ success: true; bytes: Uint8Array } | { success: false; status: 413 | 400; error: string }> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const parsedLen = parseInt(contentLength, 10);
    if (Number.isFinite(parsedLen) && parsedLen > maxBytes) {
      return {
        success: false,
        status: 413,
        error: `Payload Too Large: Request body exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
      };
    }
  }

  if (!request.body) {
    return { success: false, status: 400, error: 'Empty request body.' };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    if (typeof (request.body as any).getReader === 'function') {
      const reader = (request.body as any).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel('Request body exceeded limit').catch(() => {});
            return {
              success: false,
              status: 413,
              error: `Payload Too Large: Request body exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
            };
          }
          chunks.push(value);
        }
      }
    } else {
      const buf = await request.arrayBuffer();
      if (buf.byteLength > maxBytes) {
        return {
          success: false,
          status: 413,
          error: `Payload Too Large: Request body exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
        };
      }
      return { success: true, bytes: new Uint8Array(buf) };
    }
  } catch {
    return { success: false, status: 400, error: 'Malformed or interrupted request stream.' };
  }

  if (totalBytes === 0) {
    return { success: false, status: 400, error: 'Empty request body.' };
  }

  if (chunks.length === 1) {
    return { success: true, bytes: chunks[0] };
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { success: true, bytes: combined };
}

async function verifyConversationParticipant(
  conversationId: string,
  authResult: { verifiedUserId: string; isGuestCaller: boolean },
  dbEnv: { supabaseUrl?: string; supabaseServiceKey?: string }
): Promise<{ authorized: boolean; errorResponse?: Response }> {
  if (!dbEnv.supabaseUrl || !dbEnv.supabaseServiceKey) {
    return {
      authorized: false,
      errorResponse: jsonResponse({
        success: false,
        error: 'Service Unavailable: Supabase configuration required for conversation authorization.',
      }, 503),
    };
  }

  const cleanConvId = (conversationId || '').trim();
  if (!cleanConvId || !UUID_REGEX.test(cleanConvId)) {
    return {
      authorized: false,
      errorResponse: jsonResponse({
        success: false,
        error: 'Invalid conversation identifier format.',
      }, 400),
    };
  }

  try {
    const partsUrl = `${dbEnv.supabaseUrl}/rest/v1/conversation_participants?conversation_id=eq.${encodeURIComponent(cleanConvId)}&select=user_id,guest_id`;
    const partsRes = await fetch(partsUrl, {
      headers: {
        'apikey': dbEnv.supabaseServiceKey,
        'Authorization': `Bearer ${dbEnv.supabaseServiceKey}`,
      },
    });

    if (!partsRes.ok) {
      return {
        authorized: false,
        errorResponse: jsonResponse({
          success: false,
          error: `Database error verifying conversation membership (HTTP ${partsRes.status}).`,
        }, 502),
      };
    }

    const rows: any[] = await partsRes.json().catch(() => null as any);
    if (!Array.isArray(rows)) {
      return {
        authorized: false,
        errorResponse: jsonResponse({
          success: false,
          error: 'Invalid participant data format.',
        }, 502),
      };
    }

    const verifiedId = authResult.verifiedUserId;
    const isGuest = authResult.isGuestCaller;

    // Strict identity separation:
    // Registered members must match only user_id (and NOT guest_id)
    // Guests must match only guest_id (and NOT user_id)
    let callerFound = false;
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      const hasUserId = typeof r.user_id === 'string' && r.user_id.trim().length > 0;
      const hasGuestId = typeof r.guest_id === 'string' && r.guest_id.trim().length > 0;

      // Reject invalid participant records where both or neither are populated
      if ((hasUserId && hasGuestId) || (!hasUserId && !hasGuestId)) continue;

      if (isGuest) {
        if (hasGuestId && r.guest_id.trim() === verifiedId) {
          callerFound = true;
          break;
        }
      } else {
        if (hasUserId && r.user_id.trim() === verifiedId) {
          callerFound = true;
          break;
        }
      }
    }

    if (!callerFound) {
      return {
        authorized: false,
        errorResponse: jsonResponse({
          success: false,
          error: 'Forbidden: Caller is not an authorized participant in this conversation.',
        }, 403),
      };
    }

    return { authorized: true };
  } catch (err: any) {
    return {
      authorized: false,
      errorResponse: jsonResponse({
        success: false,
        error: 'Database error verifying conversation membership.',
      }, 503),
    };
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: any): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight strictly for /api/* routes (exact origin allowlist, method check, Vary: Origin)
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return handleCorsPreflight(request, url.pathname, env);
    }

    if (url.pathname.startsWith('/api/')) {
      const apiResponse = await handleApiFetch(request, url, env, ctx);
      return applyCorsToApiResponse(apiResponse, request, env, url.pathname);
    }

    // Static Assets fallback (Vite SPA)
    if (env?.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      if (assetRes.status === 404 && request.method === 'GET') {
        const indexUrl = new URL('/', request.url);
        return env.ASSETS.fetch(new Request(indexUrl, request));
      }
      return assetRes;
    }

    return new Response('Not Found', { status: 404 });
  },
};

function normalizeSupabaseBaseUrl(raw?: string): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\/+$/, '');
}

function normalizeCredentialValue(raw?: string): string {
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

function inspectJwtRoleSafe(token: string): string | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(fromBase64Url(parts[1]));
    return typeof payload?.role === 'string' ? payload.role.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

async function deriveIdempotentUploadId(params: {
  idempotencyKey: string;
  userId: string;
  contextType: string;
  contextId: string;
}): Promise<string> {
  const input = `${params.userId}|${params.contextType}|${params.contextId}|${params.idempotencyKey}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const hex = Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `med_idem_${hex}`;
}

interface MediaDbErrorClassification {
  status: 400 | 409 | 502 | 503;
  code: string;
  pgCode?: string;
  userMessage: string;
}

function classifyMediaDbInsertError(httpStatus: number, rawBodyText: string): MediaDbErrorClassification {
  let parsed: any = null;
  if (rawBodyText) {
    try {
      parsed = JSON.parse(rawBodyText);
    } catch {
      parsed = null;
    }
  }
  const pgCode = typeof parsed?.code === 'string' ? parsed.code.trim() : '';
  const msgLower = String(parsed?.message || rawBodyText || '').toLowerCase();

  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    pgCode === '42501' ||
    msgLower.includes('row-level security') ||
    msgLower.includes('permission denied')
  ) {
    return {
      status: 503,
      code: 'MEDIA_DB_PERMISSION_DENIED',
      pgCode: pgCode || undefined,
      userMessage: 'Failed to persist media metadata due to database authorization policy; uploaded object was cleaned up.',
    };
  }

  if (
    httpStatus === 404 ||
    pgCode === 'PGRST205' ||
    pgCode === '42P01' ||
    msgLower.includes('does not exist') ||
    msgLower.includes('schema cache')
  ) {
    return {
      status: 503,
      code: 'MEDIA_DB_SCHEMA_MISSING',
      pgCode: pgCode || undefined,
      userMessage: 'Media metadata storage schema is unavailable or missing migration; uploaded object was cleaned up.',
    };
  }

  if (httpStatus === 409 || pgCode === '23505' || msgLower.includes('duplicate key')) {
    return {
      status: 409,
      code: 'MEDIA_DB_CONFLICT',
      pgCode: pgCode || undefined,
      userMessage: 'Media metadata record conflict occurred; uploaded object was cleaned up.',
    };
  }

  if (
    httpStatus === 400 ||
    httpStatus === 422 ||
    pgCode === '23514' ||
    pgCode === '23502' ||
    pgCode === '22P02' ||
    msgLower.includes('check constraint') ||
    msgLower.includes('violates')
  ) {
    return {
      status: 400,
      code: 'MEDIA_DB_CONSTRAINT_FAILED',
      pgCode: pgCode || undefined,
      userMessage: 'Media metadata failed database schema validation; uploaded object was cleaned up.',
    };
  }

  return {
    status: 502,
    code: 'MEDIA_DB_UPSTREAM_FAILURE',
    pgCode: pgCode || undefined,
    userMessage: 'Failed to persist media metadata; uploaded object was cleaned up.',
  };
}

async function handleApiFetch(request: Request, url: URL, env: WorkerEnv, ctx: any): Promise<Response> {
    const supabaseClient = getSupabaseClientFromEnv(env);
    const guestSecretInfo = getGuestSecret(env);

    // Resolve explicit Supabase Worker runtime env bindings (normalized without trailing slashes/whitespace)
    const baseSupabaseUrl = normalizeSupabaseBaseUrl(env?.SUPABASE_URL || env?.VITE_SUPABASE_URL || '');
    const supabaseAnonKey = normalizeCredentialValue(env?.SUPABASE_ANON_KEY);
    const supabaseServiceKey = normalizeCredentialValue(env?.SUPABASE_SERVICE_ROLE_KEY);

    // -------------------------------------------------------------------------
    // 0. ADULT ROOM SECURITY GATE (Enforced regardless of BACKEND_URL proxy)
    // -------------------------------------------------------------------------
    const roomPathMatch = url.pathname.match(/^\/api\/chat\/rooms\/([^/]+)/);
    if (roomPathMatch) {
      const rawRoomId = safeDecodeURIComponent(roomPathMatch[1]);

      if (isAdultRoom(rawRoomId)) {
        const guestTokenParam = url.searchParams.get('guestToken') || request.headers.get('x-guest-token');
        let bodyGuestToken: string | undefined = undefined;

        if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
          try {
            const bodyCopy: any = await request.clone().json();
            if (bodyCopy && typeof bodyCopy.guestToken === 'string') {
              bodyGuestToken = bodyCopy.guestToken;
            }
          } catch {
            // Ignore JSON parse error; authenticateRequest handles malformed/missing payloads safely
          }
        }

        const authResult = await authenticateRequest(
          request,
          url,
          guestSecretInfo,
          { supabaseUrl: baseSupabaseUrl, supabaseServiceKey, supabaseAnonKey },
          supabaseClient,
          env,
          bodyGuestToken || guestTokenParam || undefined
        );

        if ('errorResponse' in authResult) {
          return authResult.errorResponse;
        }

        if (!isAuthorizedForAdultRoom(authResult)) {
          return jsonResponse({
            success: false,
            error: 'Forbidden: Age declaration or verification required for adult room operations.',
          }, 403);
        }
      }
    }

    // -------------------------------------------------------------------------
    // ADMIN AUTHENTICATION
    // -------------------------------------------------------------------------
    
    // POST /api/admin/login
    if (url.pathname === '/api/admin/login' && request.method === 'POST') {
      try {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const now = Date.now();
        const windowMs = 15 * 60 * 1000;
        
        // NOTE: This rate limiting is per-isolate (local to the current edge instance).
        // It provides protection against rapid-fire brute force but is not globally synchronized.
        // For production-grade global rate limiting, Cloudflare WAF or Rate Limiting rules should be used.
        
        // Per-isolate stale entry cleanup
        if (Math.random() < 0.1) {
          for (const [entryIp, entry] of adminLoginAttempts.entries()) {
            if (now - entry.windowStart > windowMs) adminLoginAttempts.delete(entryIp);
          }
        }

        let record = adminLoginAttempts.get(ip);
        if (record && now - record.windowStart > windowMs) {
          adminLoginAttempts.delete(ip);
          record = undefined;
        }
        
        if (record && record.attempts >= 5) {
          return jsonResponse({ success: false, error: 'Too many login attempts. Please try again later.' }, 429);
        }

        const body: any = await request.json().catch(() => ({}));
        const { username, password } = body;

        if (typeof username !== 'string' || typeof password !== 'string') {
          return jsonResponse({ success: false, error: 'Invalid input.' }, 400);
        }

        if (username.length > 100 || password.length > 256) {
           return jsonResponse({ success: false, error: 'Input too long.' }, 400);
        }

        const configUser = env.ADMIN_USER;
        const configHash = env.ADMIN_PASS_HASH;
        const jwtSecret = env.JWT_SECRET;

        if (!configUser || !configHash || !jwtSecret || jwtSecret.length < 32) {
          console.error('[Admin] Missing or weak server-side credentials configuration.');
          return jsonResponse({ success: false, error: 'Authentication unavailable.' }, 503);
        }

        const isUserValid = username === configUser;
        let isPassValid = false;
        
        if (isUserValid) {
          try {
            isPassValid = await bcrypt.compare(password, configHash);
          } catch (err) {
            console.error('[Admin] Password comparison error:', err);
          }
        }

        if (!isUserValid || !isPassValid) {
          const current = adminLoginAttempts.get(ip) || { attempts: 0, windowStart: now };
          adminLoginAttempts.set(ip, {
            attempts: current.attempts + 1,
            windowStart: current.windowStart
          });
          return jsonResponse({ success: false, error: 'Invalid credentials.' }, 401);
        }

        // Success: reset attempts
        adminLoginAttempts.delete(ip);

        const sessionDuration = 8 * 60 * 60 * 1000; // 8 hours
        const payload = {
          sub: username,
          role: 'admin',
          iat: now,
          exp: now + sessionDuration
        };

        const token = await signAdminToken(payload, jwtSecret);
        const cookie = `admin_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${8 * 3600}`;
        
        return jsonResponse({ success: true }, 200, { 'Set-Cookie': cookie });
      } catch (err: any) {
        return jsonResponse({ success: false, error: 'Internal error.' }, 500);
      }
    }

    // GET /api/admin/me
    if (url.pathname === '/api/admin/me' && request.method === 'GET') {
      const cookieHeader = request.headers.get('Cookie') || '';
      const cookieObj: Record<string, string> = {};
      cookieHeader.split(';').forEach(c => {
        const [k, v] = c.trim().split('=');
        if (k && v) cookieObj[k] = v;
      });
      const token = cookieObj['admin_token'];

      const verify = await verifyAdminToken(token, env.JWT_SECRET);
      
      if (!verify.valid) {
        return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
      }

      return jsonResponse({
        success: true,
        user: {
          username: verify.payload.sub,
          role: 'admin'
        }
      });
    }

    // POST /api/admin/logout
    if (url.pathname === '/api/admin/logout' && request.method === 'POST') {
      const cookie = `admin_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      return jsonResponse({ success: true }, 200, { 'Set-Cookie': cookie });
    }

    // -------------------------------------------------------------------------
    // R2 MEDIA UPLOAD, VALIDATION & SECURE RETRIEVAL ENDPOINTS (PHASE 1.1 REMEDIATION)
    // -------------------------------------------------------------------------

    // POST /api/media/upload/validate
    if (url.pathname === '/api/media/upload/validate' && request.method === 'POST') {
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

      try {
        const body: any = await request.json().catch(() => ({}));
        const { fileName, fileSize, mimeType, contextType, contextId } = body;
        
        if (contextType && contextType !== 'room' && contextType !== 'conversation') {
          return jsonResponse({ valid: false, error: 'Invalid contextType. Must be room or conversation.' }, 400);
        }

        if (contextType === 'conversation' && contextId) {
          const partCheck = await verifyConversationParticipant(
            contextId,
            authResult,
            { supabaseUrl: baseSupabaseUrl, supabaseServiceKey }
          );
          if (!partCheck.authorized) {
            return partCheck.errorResponse!;
          }
        }

        if (contextType === 'room' && contextId && isAdultRoom(contextId) && !isAuthorizedForAdultRoom(authResult)) {
          return jsonResponse({ valid: false, error: 'Age verification required for adult rooms.' }, 403);
        }

        const meta = validateMediaFileMetadata({
          fileName,
          fileSize: Number(fileSize),
          mimeType,
          inferMimeFromExtIfEmpty: true,
        });
        return jsonResponse(meta, meta.valid ? 200 : 400);
      } catch (err: any) {
        return jsonResponse({ valid: false, error: 'Invalid validation request payload.' }, 400);
      }
    }

    // POST /api/media/upload
    if (url.pathname === '/api/media/upload' && request.method === 'POST') {
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

      if (!env?.CHAT_MEDIA) {
        return jsonResponse({
          success: false,
          error: 'R2 storage binding CHAT_MEDIA is not configured in Cloudflare Worker environment.',
        }, 503);
      }

      const rateKey = `${authResult.isGuestCaller ? 'guest' : 'member'}:${authResult.verifiedUserId}`;
      const rateCheck = checkAndConsumeUploadRateLimit(rateKey);
      if (!rateCheck.allowed) {
        return jsonResponse(
          {
            success: false,
            error: 'Too many uploads. Please wait a moment before uploading again.',
          },
          429,
          { 'Retry-After': String(rateCheck.retryAfterSec || 60) }
        );
      }

      const boundedResult = await readBoundedRequestBody(request, MAX_MEDIA_REQUEST_BODY_BYTES);
      if (!boundedResult.success) {
        return jsonResponse({ success: false, error: boundedResult.error }, boundedResult.status);
      }

      try {
        let fileBytes: Uint8Array | null = null;
        let fileName = '';
        let fileSize = 0;
        let mimeType = 'application/octet-stream';
        let contextType = 'room';
        let contextId = 'general';

        const contentTypeHeader = (request.headers.get('content-type') || '').toLowerCase();
        if (contentTypeHeader.includes('multipart/form-data')) {
          if (!contentTypeHeader.includes('boundary=')) {
            return jsonResponse({ success: false, error: 'Malformed multipart upload payload: missing boundary.' }, 400);
          }
          let formData: FormData;
          try {
            const syntheticResponse = new Response(boundedResult.bytes as unknown as BodyInit, {
              headers: { 'Content-Type': request.headers.get('content-type') || contentTypeHeader },
            });
            formData = await syntheticResponse.formData();
          } catch {
            return jsonResponse({ success: false, error: 'Malformed multipart form-data upload payload.' }, 400);
          }

          const fileField = formData.get('file');
          if (!fileField || typeof fileField === 'string' || typeof (fileField as any).arrayBuffer !== 'function') {
            return jsonResponse({ success: false, error: 'No valid file provided in multipart form data.' }, 400);
          }

          const uploadedFile = fileField as File;
          fileName = uploadedFile.name || '';
          fileSize = uploadedFile.size;
          mimeType = uploadedFile.type || 'application/octet-stream';
          const arrayBuf = await uploadedFile.arrayBuffer();
          fileBytes = new Uint8Array(arrayBuf);

          const rawContextType = formData.get('contextType');
          const rawContextId = formData.get('contextId');
          contextType = typeof rawContextType === 'string' ? rawContextType.trim() : 'room';
          if (rawContextId === null) {
            contextId = 'general';
          } else if (typeof rawContextId === 'string') {
            contextId = rawContextId.trim();
          } else {
            contextId = '';
          }
        } else if (contentTypeHeader.includes('application/json')) {
          let body: any;
          try {
            const text = new TextDecoder().decode(boundedResult.bytes);
            body = JSON.parse(text);
          } catch {
            return jsonResponse({ success: false, error: 'Malformed JSON upload payload.' }, 400);
          }

          fileName = typeof body?.fileName === 'string' ? body.fileName : '';
          mimeType = typeof body?.mimeType === 'string' ? body.mimeType : 'application/octet-stream';
          contextType = typeof body?.contextType === 'string' ? body.contextType.trim() : 'room';
          contextId = body?.contextId === undefined ? 'general' : typeof body.contextId === 'string' ? body.contextId.trim() : '';

          if (typeof body?.base64Data === 'string' && body.base64Data.length > 0) {
            try {
              const binStr = atob(body.base64Data);
              fileBytes = new Uint8Array(binStr.length);
              for (let i = 0; i < binStr.length; i++) {
                fileBytes[i] = binStr.charCodeAt(i);
              }
              fileSize = fileBytes.byteLength;
            } catch {
              return jsonResponse({ success: false, error: 'Malformed base64 media payload.' }, 400);
            }
          }
        } else {
          fileBytes = boundedResult.bytes;
          fileName = url.searchParams.get('fileName') || request.headers.get('x-file-name') || '';
          mimeType = contentTypeHeader || 'application/octet-stream';
          contextType = (url.searchParams.get('contextType') || request.headers.get('x-context-type') || 'room').trim();
          const rawCtxId = url.searchParams.get('contextId') ?? request.headers.get('x-context-id');
          contextId = rawCtxId === null ? 'general' : rawCtxId.trim();
        }

        if (contextType !== 'room' && contextType !== 'conversation') {
          return jsonResponse({ success: false, error: 'Invalid contextType. Must be room or conversation.' }, 400);
        }

        if (!contextId || typeof contextId !== 'string' || contextId.trim().length === 0) {
          return jsonResponse({ success: false, error: 'Invalid or missing contextId.' }, 400);
        }

        // Fail-closed authorization checks
        if (contextType === 'conversation') {
          const participantCheck = await verifyConversationParticipant(
            contextId,
            authResult,
            { supabaseUrl: baseSupabaseUrl, supabaseServiceKey }
          );
          if (!participantCheck.authorized) {
            return participantCheck.errorResponse!;
          }
        } else if (contextType === 'room') {
          if (isAdultRoom(contextId) && !isAuthorizedForAdultRoom(authResult)) {
            return jsonResponse({ success: false, error: 'Age verification required to upload media to adult rooms.' }, 403);
          }
        }

        if (!fileBytes || fileBytes.byteLength === 0) {
          return jsonResponse({ success: false, error: 'No file data provided in upload request.' }, 400);
        }

        if (fileBytes.byteLength > MAX_MEDIA_REQUEST_BODY_BYTES) {
          return jsonResponse({ success: false, error: 'Payload Too Large: File exceeds 15 MB limit.' }, 413);
        }

        const binValidation = validateMediaBinary({
          fileName,
          mimeType,
          bytes: fileBytes,
        });

        if (!binValidation.valid || !binValidation.canonicalMime || !binValidation.extension || !binValidation.chatMediaType) {
          return jsonResponse({ success: false, error: binValidation.error || 'Binary validation failed.' }, 400);
        }

        // Require valid server-side Supabase credentials in production to store media metadata
        if ((!baseSupabaseUrl || !supabaseServiceKey) && !guestSecretInfo.isDevFallback) {
          return jsonResponse({
            success: false,
            error: 'Service Unavailable: Database bindings missing for media metadata persistence.',
            code: 'MEDIA_DB_BINDINGS_MISSING',
            stage: 'config',
          }, 503);
        }

        if (supabaseServiceKey) {
          const serviceJwtRole = inspectJwtRoleSafe(supabaseServiceKey);
          if (serviceJwtRole === 'anon' || serviceJwtRole === 'authenticated') {
            console.error('[Worker][media-upload] Misconfigured SUPABASE_SERVICE_ROLE_KEY role detected:', {
              role: serviceJwtRole,
            });
            return jsonResponse({
              success: false,
              error: 'Service Unavailable: Media metadata service-role credential is misconfigured.',
              code: 'MEDIA_DB_ROLE_MISCONFIGURED',
              stage: 'config',
            }, 503);
          }
        }

        const sanitizedFileName = (binValidation.sanitizedOriginalName || `media.${binValidation.extension}`)
          .trim()
          .slice(0, 255) || `media.${binValidation.extension}`;
        if (!Number.isInteger(fileBytes.byteLength) || fileBytes.byteLength <= 0 || fileBytes.byteLength > 10485760) {
          return jsonResponse({
            success: false,
            error: 'Invalid media payload size for metadata persistence.',
            code: 'MEDIA_INVALID_SIZE',
            stage: 'validation',
          }, 400);
        }

        const rawIdempotencyKey = (request.headers.get('x-idempotency-key') || '').trim();
        const validIdempotencyKey = /^[a-zA-Z0-9_-]{8,96}$/.test(rawIdempotencyKey) ? rawIdempotencyKey : '';
        const requestId = crypto.randomUUID().slice(0, 12);

        const uploadId = validIdempotencyKey
          ? await deriveIdempotentUploadId({
              idempotencyKey: validIdempotencyKey,
              userId: authResult.verifiedUserId,
              contextType,
              contextId,
            })
          : `med_${crypto.randomUUID()}`;
        const objectKey = `media/objects/${uploadId}`;
        const sanitizedUrl = `/api/media/${uploadId}`;
        const contentDisposition = buildSafeContentDisposition(sanitizedFileName, binValidation.extension);

        // Idempotent replay pre-check: if caller retries with same X-Idempotency-Key and record + R2 object already exist cleanly, return it without duplicate insert
        if (validIdempotencyKey && baseSupabaseUrl && supabaseServiceKey) {
          try {
            const replayCheckRes = await fetch(
              `${baseSupabaseUrl}/rest/v1/media_uploads?id=eq.${encodeURIComponent(uploadId)}&select=id,uploader_id,file_name,file_size_bytes,mime_type,media_url,is_flagged`,
              {
                headers: {
                  'apikey': supabaseServiceKey,
                  'Authorization': `Bearer ${supabaseServiceKey}`,
                },
              }
            );
            if (replayCheckRes.ok) {
              const replayRows: any = await replayCheckRes.json().catch(() => null);
              if (Array.isArray(replayRows) && replayRows.length === 1) {
                const existing = replayRows[0];
                if (existing?.uploader_id !== authResult.verifiedUserId) {
                  return jsonResponse({
                    success: false,
                    error: 'Idempotency conflict: Media identifier owned by another user.',
                    code: 'MEDIA_IDEMPOTENCY_FORBIDDEN',
                    stage: 'idempotency',
                  }, 409);
                }
                if (existing?.is_flagged === true) {
                  return jsonResponse({
                    success: false,
                    error: 'Forbidden: This media asset has been flagged by moderation.',
                    code: 'MEDIA_FLAGGED',
                    stage: 'moderation',
                  }, 403);
                }
                const existingObj = await env.CHAT_MEDIA.get(objectKey).catch(() => null);
                if (existingObj && existingObj.body) {
                  return jsonResponse({
                    success: true,
                    idempotentReplay: true,
                    media: {
                      uploadId,
                      url: existing.media_url || sanitizedUrl,
                      mediaType: binValidation.chatMediaType,
                      mimeType: existing.mime_type || binValidation.canonicalMime,
                      fileName: existing.file_name || sanitizedFileName,
                      fileSize: Number(existing.file_size_bytes) || fileBytes.byteLength,
                    },
                  }, 200);
                }
              }
            }
          } catch (replayErr) {
            console.warn('[Worker][media-upload] Idempotency pre-check skipped:', { requestId });
          }
        }

        const customMetadata = {
          mediaId: uploadId,
          contextType,
          contextId,
          ownerType: authResult.isGuestCaller ? 'guest' : 'member',
          ownerId: authResult.verifiedUserId,
          canonicalMime: binValidation.canonicalMime,
          extension: binValidation.extension,
          originalFileName: sanitizedFileName,
          fileSize: String(fileBytes.byteLength),
          uploadedAt: new Date().toISOString(),
          metadataVersion: '1.2',
        };

        try {
          await env.CHAT_MEDIA.put(objectKey, fileBytes, {
            httpMetadata: {
              contentType: binValidation.canonicalMime,
              contentDisposition,
            },
            customMetadata,
          });
        } catch (r2Err: any) {
          console.error('[Worker][media-upload] R2 put failed:', {
            requestId,
            uploadId,
            stage: 'r2_put',
            message: r2Err?.message || 'Storage write failure',
          });
          return jsonResponse({
            success: false,
            error: 'Storage write failure while saving media to Cloudflare R2.',
            code: 'MEDIA_R2_WRITE_FAILED',
            stage: 'r2_put',
            requestId,
          }, 502);
        }

        // Persist metadata in Supabase public.media_uploads; rollback scoped R2 object on any failure
        if (baseSupabaseUrl && supabaseServiceKey) {
          let metadataPersisted = false;
          let existingRowPreserved = false;
          let failureClassification: MediaDbErrorClassification = {
            status: 502,
            code: 'MEDIA_DB_UPSTREAM_FAILURE',
            userMessage: 'Failed to persist media metadata; uploaded object was cleaned up.',
          };

          try {
            const dbRes = await fetch(`${baseSupabaseUrl}/rest/v1/media_uploads`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'apikey': supabaseServiceKey,
                'Authorization': `Bearer ${supabaseServiceKey}`,
                'Prefer': 'return=representation',
              },
              body: JSON.stringify({
                id: uploadId,
                uploader_id: authResult.verifiedUserId,
                file_name: sanitizedFileName,
                file_size_bytes: fileBytes.byteLength,
                mime_type: binValidation.canonicalMime,
                media_url: sanitizedUrl,
                is_flagged: false,
              }),
            });

            const dbBodyText = await dbRes.text().catch(() => '');

            if (dbRes.ok) {
              let parsedBody: any = null;
              if (dbBodyText && dbBodyText.trim().length > 0) {
                try {
                  parsedBody = JSON.parse(dbBodyText);
                } catch {
                  parsedBody = null;
                }
              }

              if (Array.isArray(parsedBody) && parsedBody.length === 1 && parsedBody[0]?.id === uploadId) {
                metadataPersisted = true;
              } else if (parsedBody && !Array.isArray(parsedBody) && typeof parsedBody === 'object' && parsedBody.id === uploadId) {
                metadataPersisted = true;
              } else if (dbRes.status === 201 || dbRes.status === 200 || dbRes.status === 204) {
                // Verify via explicit read-back when PostgREST omits representation payload
                const verifyRes = await fetch(
                  `${baseSupabaseUrl}/rest/v1/media_uploads?id=eq.${encodeURIComponent(uploadId)}&select=id,uploader_id,is_flagged`,
                  {
                    headers: {
                      'apikey': supabaseServiceKey,
                      'Authorization': `Bearer ${supabaseServiceKey}`,
                    },
                  }
                ).catch(() => null);
                if (verifyRes && verifyRes.ok) {
                  const verifyRows: any = await verifyRes.json().catch(() => null);
                  if (Array.isArray(verifyRows) && verifyRows.length === 1 && verifyRows[0]?.id === uploadId) {
                    metadataPersisted = true;
                  }
                }
                if (!metadataPersisted) {
                  failureClassification = {
                    status: 502,
                    code: 'MEDIA_DB_INVALID_RESPONSE',
                    userMessage: 'Failed to confirm media metadata persistence; uploaded object was cleaned up.',
                  };
                  console.error('[Worker][media-upload] Unexpected Supabase insert response shape:', {
                    requestId,
                    uploadId,
                    httpStatus: dbRes.status,
                  });
                }
              }
            } else {
              failureClassification = classifyMediaDbInsertError(dbRes.status, dbBodyText);

              // On 409 / 23505 duplicate key when retrying with same idempotency key, verify matching ownership safely
              if (failureClassification.status === 409 && validIdempotencyKey) {
                const conflictRes = await fetch(
                  `${baseSupabaseUrl}/rest/v1/media_uploads?id=eq.${encodeURIComponent(uploadId)}&select=id,uploader_id,file_size_bytes,mime_type,is_flagged`,
                  {
                    headers: {
                      'apikey': supabaseServiceKey,
                      'Authorization': `Bearer ${supabaseServiceKey}`,
                    },
                  }
                ).catch(() => null);
                if (conflictRes && conflictRes.ok) {
                  const rows: any = await conflictRes.json().catch(() => null);
                  if (
                    Array.isArray(rows) &&
                    rows.length === 1 &&
                    rows[0]?.uploader_id === authResult.verifiedUserId &&
                    rows[0]?.is_flagged === false
                  ) {
                    metadataPersisted = true;
                    existingRowPreserved = true;
                  } else if (Array.isArray(rows) && rows.length === 1) {
                    existingRowPreserved = true;
                  }
                }
              }

              if (!metadataPersisted) {
                console.error('[Worker][media-upload] Supabase media_uploads insert failed:', {
                  requestId,
                  uploadId,
                  stage: 'db_insert',
                  httpStatus: dbRes.status,
                  code: failureClassification.code,
                  pgCode: failureClassification.pgCode || null,
                });
              }
            }
          } catch (dbErr: any) {
            failureClassification = {
              status: 502,
              code: 'MEDIA_DB_NETWORK_EXCEPTION',
              userMessage: 'Failed to persist media metadata due to database connection error; uploaded object was cleaned up.',
            };
            console.error('[Worker][media-upload] Supabase media_uploads insert exception:', {
              requestId,
              uploadId,
              stage: 'db_insert',
              message: dbErr?.name || 'NetworkException',
            });
          }

          if (!metadataPersisted) {
            let cleanupSucceeded = false;
            if (!existingRowPreserved) {
              try {
                await env.CHAT_MEDIA.delete(objectKey);
                cleanupSucceeded = true;
              } catch (cleanupErr: any) {
                cleanupSucceeded = false;
                console.error('[Worker][media-upload] R2 rollback delete failed after DB metadata error:', {
                  requestId,
                  uploadId,
                  stage: 'r2_rollback',
                  dbCode: failureClassification.code,
                  cleanupError: cleanupErr?.name || 'R2DeleteError',
                });
              }
            }
            const errorMsg = existingRowPreserved
              ? failureClassification.userMessage
              : cleanupSucceeded
              ? failureClassification.userMessage
              : `${failureClassification.userMessage.replace(/; uploaded object was cleaned up\.$/, '')}; R2 cleanup also failed.`;
            return jsonResponse({
              success: false,
              error: errorMsg,
              code: failureClassification.code,
              stage: 'db_insert',
              requestId,
              cleanupAttempted: !existingRowPreserved,
              cleanupSucceeded: existingRowPreserved ? undefined : cleanupSucceeded,
            }, failureClassification.status);
          }
        }

        const mediaAsset = {
          uploadId,
          url: sanitizedUrl,
          mediaType: binValidation.chatMediaType,
          mimeType: binValidation.canonicalMime,
          fileName: sanitizedFileName,
          fileSize: fileBytes.byteLength,
        };

        return jsonResponse({
          success: true,
          media: mediaAsset,
        }, 200);
      } catch (err: any) {
        console.error('[Worker][media-upload] Unhandled upload processing error:', {
          message: err?.name || 'InternalError',
        });
        return jsonResponse({ success: false, error: 'Internal error processing media upload.' }, 500);
      }
    }

    // GET /api/media/:id
    const mediaGetMatch = url.pathname.match(/^\/api\/media\/([^/]+)$/);
    if (mediaGetMatch && request.method === 'GET') {
      const mediaIdOrFileName = safeDecodeURIComponent(mediaGetMatch[1]);

      if (!env?.CHAT_MEDIA) {
        return mediaErrorResponse('R2 storage binding CHAT_MEDIA is not configured.', 503);
      }

      const authResult = await authenticateRequest(
        request,
        url,
        guestSecretInfo,
        { supabaseUrl: baseSupabaseUrl, supabaseServiceKey, supabaseAnonKey },
        supabaseClient
      );
      if ('errorResponse' in authResult) {
        const errHeaders = new Headers(authResult.errorResponse.headers);
        errHeaders.set('Cache-Control', 'private, no-store');
        errHeaders.set('X-Content-Type-Options', 'nosniff');
        return new Response(authResult.errorResponse.body, {
          status: authResult.errorResponse.status,
          statusText: authResult.errorResponse.statusText,
          headers: errHeaders,
        });
      }

      if (
        !mediaIdOrFileName ||
        mediaIdOrFileName.includes('..') ||
        mediaIdOrFileName.startsWith('.') ||
        !/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9]+)?$/.test(mediaIdOrFileName)
      ) {
        return mediaErrorResponse('Invalid media asset identifier.', 400);
      }

      const cleanId = mediaIdOrFileName.split('.')[0];
      if (!cleanId || !/^[a-zA-Z0-9_-]{3,128}$/.test(cleanId)) {
        return mediaErrorResponse('Invalid media asset identifier.', 400);
      }

      try {
        const objectKey = `media/objects/${cleanId}`;
        const matchedObj = await env.CHAT_MEDIA.get(objectKey);

        if (!matchedObj || !matchedObj.body) {
          return mediaErrorResponse('Media object not found.', 404);
        }

        const meta = matchedObj.customMetadata || {};

        // 1. Strict metadata validation: accept only exact context types
        const rawContextType = typeof meta.contextType === 'string' ? meta.contextType.trim() : '';
        if (rawContextType !== 'room' && rawContextType !== 'conversation') {
          return mediaErrorResponse('Malformed or unsupported media context type.', 400);
        }
        const contextType = rawContextType as 'room' | 'conversation';

        // 2. Reject missing, empty, or malformed contextId
        const contextId = typeof meta.contextId === 'string' ? meta.contextId.trim() : '';
        if (!contextId) {
          return mediaErrorResponse('Missing or empty media context identifier.', 400);
        }

        // 3. Mandatory metadata version enforcement (storage contract requires exactly '1.2')
        if (
          typeof meta.metadataVersion !== 'string' ||
          meta.metadataVersion.trim() !== '1.2'
        ) {
          return mediaErrorResponse('Malformed, missing, or unsupported media metadata version.', 400);
        }

        // 4. Context-specific fail-closed authorization checks
        const isAdultContext = contextType === 'room' && isAdultRoom(contextId);
        if (contextType === 'conversation') {
          // Require valid conversation UUID
          if (!UUID_REGEX.test(contextId)) {
            return mediaErrorResponse('Invalid conversation identifier format.', 400);
          }

          const participantCheck = await verifyConversationParticipant(
            contextId,
            authResult,
            { supabaseUrl: baseSupabaseUrl, supabaseServiceKey }
          );
          if (!participantCheck.authorized) {
            const errRes = participantCheck.errorResponse!;
            const errHeaders = new Headers(errRes.headers);
            errHeaders.set('Cache-Control', 'private, no-store');
            errHeaders.set('X-Content-Type-Options', 'nosniff');
            return new Response(errRes.body, {
              status: errRes.status,
              statusText: errRes.statusText,
              headers: errHeaders,
            });
          }
        } else if (isAdultContext) {
          if (!isAuthorizedForAdultRoom(authResult)) {
            return mediaErrorResponse('Age verification required to view media from adult rooms.', 403);
          }
        }

        // 5. Fail-closed moderation verification against public.media_uploads
        if (!baseSupabaseUrl || !supabaseServiceKey) {
          if (!guestSecretInfo.isDevFallback) {
            return mediaErrorResponse(
              'Service Unavailable: Database configuration required to verify media moderation status.',
              503
            );
          }
        } else {
          let flagRes: Response;
          try {
            const flagCheckUrl = `${baseSupabaseUrl}/rest/v1/media_uploads?id=eq.${encodeURIComponent(cleanId)}&select=id,is_flagged`;
            flagRes = await fetch(flagCheckUrl, {
              headers: {
                'apikey': supabaseServiceKey,
                'Authorization': `Bearer ${supabaseServiceKey}`,
              },
            });
          } catch (err) {
            console.error('[Worker] Media moderation lookup network exception:', err);
            return mediaErrorResponse('Service Unavailable: Unable to verify media moderation status.', 503);
          }

          if (!flagRes.ok) {
            console.error(`[Worker] Media moderation lookup failed HTTP ${flagRes.status}`);
            return mediaErrorResponse('Bad Gateway: Failed to verify media moderation status.', 502);
          }

          const flagRows: any = await flagRes.json().catch(() => null);
          if (!Array.isArray(flagRows)) {
            return mediaErrorResponse('Bad Gateway: Invalid media moderation metadata response.', 502);
          }

          if (flagRows.length === 0) {
            return mediaErrorResponse('Media metadata record not found.', 404);
          }

          if (flagRows.length !== 1) {
            return mediaErrorResponse('Bad Gateway: Ambiguous media moderation metadata.', 502);
          }

          const moderationRow = flagRows[0];
          if (
            !moderationRow ||
            typeof moderationRow !== 'object' ||
            moderationRow.id !== cleanId ||
            typeof moderationRow.is_flagged !== 'boolean'
          ) {
            return mediaErrorResponse('Bad Gateway: Malformed media moderation record.', 502);
          }

          if (moderationRow.is_flagged === true) {
            return mediaErrorResponse('Forbidden: This media asset is unavailable due to moderation.', 403);
          }
        }

        // 6. Validate stored Content-Type against allowlist and emit safe security headers
        const rawStoredContentType = matchedObj.httpMetadata?.contentType || meta.canonicalMime || '';
        const normalizedStoredMime = normalizeMimeType(rawStoredContentType);
        const allowedSpec = normalizedStoredMime ? ALLOWED_MEDIA_SPECS[normalizedStoredMime] : undefined;
        if (!allowedSpec) {
          return mediaErrorResponse('Unsupported or unsafe media content type.', 400);
        }

        const safeContentType =
          allowedSpec.canonicalMime === 'audio/mp3' ? 'audio/mpeg' : allowedSpec.canonicalMime;
        const safeDisposition = buildSafeContentDisposition(
          typeof meta.originalFileName === 'string' && meta.originalFileName.trim()
            ? meta.originalFileName
            : `${cleanId}.${allowedSpec.allowedExts[0]}`,
          allowedSpec.allowedExts[0]
        );

        const headers = new Headers();
        headers.set('Content-Type', safeContentType);
        headers.set('Content-Disposition', safeDisposition);
        headers.set('X-Content-Type-Options', 'nosniff');

        if (contextType === 'conversation' || isAdultContext) {
          headers.set('Cache-Control', 'private, no-store');
        } else {
          headers.set('Cache-Control', 'public, max-age=86400');
        }

        return new Response(matchedObj.body as BodyInit, {
          status: 200,
          headers,
        });
      } catch (err: any) {
        console.error('[Worker] R2 Media Retrieval Error:', err);
        return mediaErrorResponse('Error retrieving media object.', 500);
      }
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
        app: 'ChatLustora',
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
        },
      });
    }

    // -------------------------------------------------------------------------
    // 1B. SSE LIVE EVENT STREAM: ROOM EVENTS
    // -------------------------------------------------------------------------
    const sseMatch = url.pathname.match(/^\/api\/chat\/rooms\/([^/]+)\/events\/?$/);
    if (sseMatch && request.method === 'GET') {
      const roomId = safeDecodeURIComponent(sseMatch[1]);

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

      if (isAdultRoom(roomId) && !isAuthorizedForAdultRoom(authResult)) {
        return jsonResponse({
          success: false,
          error: 'Forbidden: Age declaration or verification required for adult room operations.',
        }, 403);
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
        },
      });
    }

    // -------------------------------------------------------------------------
    // 2. ROOM MESSAGES: /api/chat/rooms/:roomId/messages
    // -------------------------------------------------------------------------
    const messagesMatch = url.pathname.match(/^\/api\/chat\/rooms\/([^/]+)\/messages$/);
    if (messagesMatch) {
      const roomId = safeDecodeURIComponent(messagesMatch[1]);

      // GET: Retrieve message history
      if (request.method === 'GET') {
        const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
        const limit = Math.min(Math.max(limitParam, 1), 100);

        if (isAdultRoom(roomId)) {
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

          if (!isAuthorizedForAdultRoom(authResult)) {
            return jsonResponse({
              success: false,
              error: 'Forbidden: Age declaration or verification required for adult room operations.',
            }, 403);
          }
        }

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
                mediaUrl: m.media_url,
                mediaType: m.media_type,
                linkPreview: m.link_preview,
                clientNonce: m.client_nonce,
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

          if (isAdultRoom(roomId) && !isAuthorizedForAdultRoom(authResult)) {
            return jsonResponse({
              success: false,
              error: 'Forbidden: Age declaration or verification required for adult room operations.',
            }, 403);
          }

          const { verifiedUserId, isGuestCaller, guestSession } = authResult;

          // 2. Validate senderType
          const senderType = clientSenderType || 'guest';
          if (!['registered', 'guest'].includes(senderType)) {
             return jsonResponse({ success: false, error: 'Bad Request: Missing or invalid senderType.' }, 400);
          }

          // Cross-check declared type and verified identity
          if (isGuestCaller && senderType !== 'guest') {
             return jsonResponse({ success: false, error: 'Forbidden: Guest session cannot claim registered identity.' }, 403);
          }
          if (!isGuestCaller && senderType !== 'registered') {
             return jsonResponse({ success: false, error: 'Forbidden: Registered session cannot be downgraded to guest identity.' }, 403);
          }

          // 3. Identity Spoofing Check
          if (clientSenderId && clientSenderId !== verifiedUserId) {
             return jsonResponse({ success: false, error: 'Forbidden: Sender identity mismatch (spoofing attempt rejected).' }, 403);
          }

          if (!content && !mediaUrl) {
            return jsonResponse({ success: false, error: 'Message content or media is required.' }, 400);
          }

          if (mediaUrl && !isSafeMediaUrl(mediaUrl)) {
            return jsonResponse({ success: false, error: 'Invalid or unsafe media URL.' }, 400);
          }

          if (mediaType && !isValidChatMediaType(mediaType)) {
            return jsonResponse({ success: false, error: 'Invalid mediaType.' }, 400);
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
      const roomId = safeDecodeURIComponent(presenceMatch[1]);

      if (!roomPresence.has(roomId)) {
        roomPresence.set(roomId, new Map());
      }
      const membersMap = roomPresence.get(roomId)!;

      if (request.method === 'POST') {
        try {
          const body: any = await request.json().catch(() => ({}));
          const { id, action, status, guestToken: bodyGuestToken } = body || {};

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

          if (isAdultRoom(roomId) && !isAuthorizedForAdultRoom(authResult)) {
            return jsonResponse({
              success: false,
              error: 'Forbidden: Age declaration or verification required for adult room operations.',
            }, 403);
          }

          // 2. Reject mismatched client ID
          if (id && id !== authResult.verifiedUserId) {
            return jsonResponse({
              success: false,
              error: 'Forbidden: Identity mismatch in presence update.',
            }, 403);
          }

          // 3. Handle leave / offline (remove only authenticated caller)
          if (action === 'leave' || status === 'offline') {
            membersMap.delete(authResult.verifiedUserId);
            const currentMembers = Array.from(membersMap.values());
            broadcastToRoom(roomId, 'presence_update', currentMembers);
            // Broadcast to other worker instances via Supabase
            await databaseService.broadcastMessage(roomId, {
              id: 'presence_sync',
              roomId,
              content: JSON.stringify(currentMembers),
              senderNickname: 'system',
              senderAvatar: '⚡',
              timestamp: new Date().toISOString()
            } as any);
            return jsonResponse({ success: true, members: currentMembers });
          }

          // 4. Derive Authoritative Identity
          let verifiedNickname: string;
          let verifiedAvatar: string;
          let verifiedGender: string | undefined;

          if (authResult.isGuestCaller && authResult.guestSession) {
            verifiedNickname = authResult.guestSession.nickname || 'Guest';
            verifiedAvatar = authResult.guestSession.avatar || '⚡';
            verifiedGender = authResult.guestSession.gender || 'prefer_not_to_say';
          } else {
            const profile = await fetchMemberProfile(authResult.verifiedUserId, {
              supabaseUrl: baseSupabaseUrl,
              supabaseServiceKey,
            });
            verifiedNickname = profile.nickname;
            verifiedAvatar = profile.avatar;
            verifiedGender = undefined; // Do not invent or fabricate profile gender if unavailable
          }

          membersMap.set(authResult.verifiedUserId, {
            id: authResult.verifiedUserId,
            nickname: verifiedNickname,
            avatar: verifiedAvatar,
            isGuest: authResult.isGuestCaller,
            gender: verifiedGender,
            lastSeen: Date.now(),
          });

          // 5. Clean up stale members > 45s
          const now = Date.now();
          for (const [mid, m] of membersMap.entries()) {
            if (now - m.lastSeen > 45000) {
              membersMap.delete(mid);
            }
          }

          const currentMembers = Array.from(membersMap.values());
          broadcastToRoom(roomId, 'presence_update', currentMembers);

          return jsonResponse({ success: true, members: currentMembers });
        } catch (err: any) {
          return jsonResponse({ success: false, error: err.message || 'Presence update failed' }, 500);
        }
      }

      if (request.method === 'GET') {
        if (isAdultRoom(roomId)) {
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

          if (!isAuthorizedForAdultRoom(authResult)) {
            return jsonResponse({
              success: false,
              error: 'Forbidden: Age declaration or verification required for adult room operations.',
            }, 403);
          }
        }

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
      const roomId = safeDecodeURIComponent(typingMatch[1]);
      try {
        const body: any = await request.json().catch(() => ({}));
        const { memberId, isTyping, guestToken: bodyGuestToken } = body || {};

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

        if (isAdultRoom(roomId) && !isAuthorizedForAdultRoom(authResult)) {
          return jsonResponse({
            success: false,
            error: 'Forbidden: Age declaration or verification required for adult room operations.',
          }, 403);
        }

        // 2. Reject mismatched member ID
        if (memberId && memberId !== authResult.verifiedUserId) {
          return jsonResponse({
            success: false,
            error: 'Forbidden: Identity mismatch in typing update.',
          }, 403);
        }

        // 3. Derive Authoritative Nickname
        let verifiedNickname: string;
        if (authResult.isGuestCaller && authResult.guestSession) {
          verifiedNickname = authResult.guestSession.nickname || 'Guest';
        } else {
          const profile = await fetchMemberProfile(authResult.verifiedUserId, {
            supabaseUrl: baseSupabaseUrl,
            supabaseServiceKey,
          });
          verifiedNickname = profile.nickname;
        }

        if (!roomTyping.has(roomId)) {
          roomTyping.set(roomId, new Map());
        }
        const typersMap = roomTyping.get(roomId)!;

        if (isTyping) {
          typersMap.set(authResult.verifiedUserId, { nickname: verifiedNickname, expiresAt: Date.now() + 3000 });
        } else {
          typersMap.delete(authResult.verifiedUserId);
        }

        const now = Date.now();
        for (const [tid, t] of typersMap.entries()) {
          if (now > t.expiresAt) typersMap.delete(tid);
        }

        const activeTypers = Array.from(typersMap.values()).map((t) => t.nickname);
        broadcastToRoom(roomId, 'typing_update', { typers: activeTypers });

        return jsonResponse({ success: true });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err.message || 'Typing update failed' }, 500);
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

            dbConvId = await databaseService.getDeterministicConvId(verifiedUserId, resolvedPartnerId);
            convId = `conv_${[verifiedUserId, resolvedPartnerId].sort().join('_')}`;

            // Create or upsert conversation row
            const convRes = await fetch(`${baseSupabaseUrl}/rest/v1/conversations`, {
              method: 'POST',
              headers: {
                'apikey': supabaseServiceKey,
                'Authorization': `Bearer ${supabaseServiceKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=ignore-duplicates'
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
                    'Prefer': 'resolution=ignore-duplicates',
                  },
                  body: JSON.stringify(payload)
                });

                if (!insertRes.ok) {
                  // Concurrent insert race condition handling: re-verify if participant row was persisted concurrently
                  const recheckRes = await fetch(
                    `${baseSupabaseUrl}/rest/v1/conversation_participants?${filter}&select=conversation_id,user_id,guest_id`,
                    {
                      headers: {
                        'apikey': supabaseServiceKey,
                        'Authorization': `Bearer ${supabaseServiceKey}`,
                      },
                    }
                  );

                  let recheckExists = false;
                  if (recheckRes.ok) {
                    try {
                      const recheckRows: any = await recheckRes.json();
                      if (Array.isArray(recheckRows)) {
                        recheckExists = recheckRows.some((row: any) => {
                          if (!row || typeof row !== 'object') return false;
                          const matchesConv = row.conversation_id === dbConvId;
                          const matchesId = p.type === 'guest'
                            ? row.guest_id === p.id
                            : row.user_id === p.id;
                          return matchesConv && matchesId;
                        });
                      }
                    } catch {
                      recheckExists = false;
                    }
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
  let requestedSlugRecipientId: string | null = null;
  let convSlug: string = '';
  let dbConvId: string = '';

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

    requestedSlugRecipientId = id1 === verifiedUserId ? id2 : id1;
    convSlug = `conv_${[id1, id2].sort().join('_')}`;
    dbConvId = await databaseService.getDeterministicConvId(verifiedUserId, requestedSlugRecipientId);
  } else if (uuidFullRegex.test(convIdParam)) {
    dbConvId = convIdParam;
  } else {
    return {
      authorized: false,
      errorResponse: jsonResponse({ success: false, error: 'Invalid conversation identifier format.' }, 400),
    };
  }

  // Database verification (Strictly Read-Only)
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

      let rows: any;
      try {
        rows = await partsRes.json();
      } catch (err) {
        console.error('[Worker] Participant JSON parse error:', err);
        return {
          authorized: false,
          errorResponse: jsonResponse({ success: false, error: 'Database error parsing participant records.' }, 500),
        };
      }

      if (!Array.isArray(rows)) {
        return {
          authorized: false,
          errorResponse: jsonResponse({ success: false, error: 'Unauthorized: Invalid participant data format.' }, 403),
        };
      }

      if (rows.length !== 2) {
        return {
          authorized: false,
          errorResponse: jsonResponse({ success: false, error: 'Unauthorized: Conversation must have exactly two participant records.' }, 403),
        };
      }

      const verifiedParticipantIds: string[] = [];
      let callerFound = false;

      for (const row of rows) {
        if (!row || typeof row !== 'object') {
          return {
            authorized: false,
            errorResponse: jsonResponse({ success: false, error: 'Unauthorized: Invalid participant record format.' }, 403),
          };
        }

        const hasUserId = typeof row.user_id === 'string' && row.user_id.trim().length > 0;
        const hasGuestId = typeof row.guest_id === 'string' && row.guest_id.trim().length > 0;

        // Reject rows where both columns are populated or both columns are null/invalid
        if ((hasUserId && hasGuestId) || (!hasUserId && !hasGuestId)) {
          return {
            authorized: false,
            errorResponse: jsonResponse({ success: false, error: 'Unauthorized: Participant record must have exactly one identity column populated.' }, 403),
          };
        }

        const identityId = hasUserId ? row.user_id.trim() : row.guest_id.trim();
        if (!uuidFullRegex.test(identityId)) {
          return {
            authorized: false,
            errorResponse: jsonResponse({ success: false, error: 'Unauthorized: Invalid identity identifier in participant record.' }, 403),
          };
        }

        // Require authenticated caller to match the correct identity column
        if (identityId === verifiedUserId) {
          if (isGuestCaller && !hasGuestId) {
            return {
              authorized: false,
              errorResponse: jsonResponse({ success: false, error: 'Unauthorized: Guest caller identity mismatch with user_id column.' }, 403),
            };
          }
          if (!isGuestCaller && !hasUserId) {
            return {
              authorized: false,
              errorResponse: jsonResponse({ success: false, error: 'Unauthorized: Registered caller identity mismatch with guest_id column.' }, 403),
            };
          }
          callerFound = true;
        }

        verifiedParticipantIds.push(identityId);
      }

      if (!callerFound) {
        return {
          authorized: false,
          errorResponse: jsonResponse({ success: false, error: 'Unauthorized: Authenticated caller is not a participant in this conversation.' }, 403),
        };
      }

      // Reject duplicate participant identities
      const uniqueIds = Array.from(new Set(verifiedParticipantIds));
      if (uniqueIds.length !== 2) {
        return {
          authorized: false,
          errorResponse: jsonResponse({ success: false, error: 'Unauthorized: Conversation participant identities must be distinct.' }, 403),
        };
      }

      // Derive actual recipient from database records
      const dbRecipientId = verifiedParticipantIds.find((id) => id !== verifiedUserId);
      if (!dbRecipientId) {
        return {
          authorized: false,
          errorResponse: jsonResponse({ success: false, error: 'Unauthorized: Recipient participant not found in conversation.' }, 403),
        };
      }

      // If a slug was requested, the slug's recipient must match the DB's recipient
      if (requestedSlugRecipientId && requestedSlugRecipientId !== dbRecipientId) {
        return {
          authorized: false,
          errorResponse: jsonResponse({ success: false, error: 'Unauthorized: Conversation slug does not match database participants.' }, 403),
        };
      }

      // Verify the dbConvId matches the deterministic UUID for (verifiedUserId, dbRecipientId)
      const expectedDbConvId = await databaseService.getDeterministicConvId(verifiedUserId, dbRecipientId);
      if (dbConvId !== expectedDbConvId) {
        return {
          authorized: false,
          errorResponse: jsonResponse({ success: false, error: 'Unauthorized: Conversation UUID mismatch.' }, 403),
        };
      }

      const canonicalSlug = `conv_${[verifiedUserId, dbRecipientId].sort().join('_')}`;
      return { authorized: true, dbConvId, convSlug: canonicalSlug, recipientId: dbRecipientId };
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
    // Local development fallback
    const recipientId = requestedSlugRecipientId || 'dev_partner';
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

          if (mediaUrl && !isSafeMediaUrl(mediaUrl)) {
            return jsonResponse({ success: false, error: 'Invalid or unsafe media URL.' }, 400);
          }

          if (mediaType && !isValidChatMediaType(mediaType)) {
            return jsonResponse({ success: false, error: 'Invalid mediaType.' }, 400);
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
                 'Prefer': 'resolution=ignore-duplicates'
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

          return jsonResponse({ success: true, message, isInserted });

        } catch (err: any) {
          return jsonResponse({ success: false, error: 'Failed to deliver message: ' + (err.message || 'Unknown error') }, 400);
        }
      }
        }

    // POST /api/chat/conversations/:id/typing
    const convTypingMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/typing$/);
    if (convTypingMatch && request.method === 'POST') {
      const convIdParam = decodeURIComponent(convTypingMatch[1]);
      try {
        const body: any = await request.json().catch(() => ({}));
        const { memberId, isTyping, guestToken: bodyGuestToken } = body || {};

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

        // 2. Reject client identity spoofing / forgery
        if (memberId && memberId !== verifiedUserId) {
          return jsonResponse({
            success: false,
            error: 'Forbidden: Cannot report typing for another participant (identity mismatch).',
          }, 403);
        }

        // 3. Authorize Conversation Access
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

        // 4. Derive authoritative participant nickname
        let verifiedNickname: string;
        if (isGuestCaller && guestSession) {
          verifiedNickname = guestSession.nickname || 'Guest';
        } else {
          const profile = await fetchMemberProfile(verifiedUserId, {
            supabaseUrl: baseSupabaseUrl,
            supabaseServiceKey,
          });
          verifiedNickname = profile.nickname || 'User';
        }

        const canonicalConvId = authAccess.convSlug || authAccess.dbConvId;
        if (!conversationTyping.has(canonicalConvId)) {
          conversationTyping.set(canonicalConvId, new Map());
        }
        const typersMap = conversationTyping.get(canonicalConvId)!;

        if (isTyping) {
          typersMap.set(verifiedUserId, { nickname: verifiedNickname, expiresAt: Date.now() + 3000 });
        } else {
          typersMap.delete(verifiedUserId);
        }

        const now = Date.now();
        for (const [tid, t] of typersMap.entries()) {
          if (now > t.expiresAt) typersMap.delete(tid);
        }

        const activeTypers = Array.from(typersMap.values()).map((t) => t.nickname);
        const typingPayload = {
          typers: activeTypers,
          userId: verifiedUserId,
          nickname: verifiedNickname,
          isTyping: Boolean(isTyping),
        };
        broadcastToConversation(canonicalConvId, 'dm_typing', typingPayload);
        if (authAccess.dbConvId && authAccess.dbConvId !== canonicalConvId) {
          broadcastToConversation(authAccess.dbConvId, 'dm_typing', typingPayload);
        }

        return jsonResponse({ success: true });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err.message || 'Typing update failed' }, 500);
      }
    }

    // POST /api/chat/conversations/:id/read
    const convReadMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/read$/);
    if (convReadMatch && request.method === 'POST') {
      const convIdParam = decodeURIComponent(convReadMatch[1]);
      try {
        const body: any = await request.json().catch(() => ({}));
        const { userId, messageId, guestToken: bodyGuestToken } = body || {};

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

        const { verifiedUserId, isGuestCaller } = authResult;

        // 2. Reject client identity spoofing / forgery
        if (userId && userId !== verifiedUserId) {
          return jsonResponse({
            success: false,
            error: 'Forbidden: Cannot report read receipt for another user (identity mismatch).',
          }, 403);
        }

        // 3. Authorize Conversation Access
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
        const canonicalConvId = convSlug || dbConvId;

        // 4. Validate messageId
        if (!messageId || typeof messageId !== 'string' || messageId.trim().length === 0) {
          return jsonResponse({
            success: false,
            error: 'Message ID is required.',
          }, 400);
        }

        // 5. Database message ownership verification (must belong to this conversation)
        if (baseSupabaseUrl && supabaseServiceKey) {
          try {
            const msgQueryUrl = `${baseSupabaseUrl}/rest/v1/messages?id=eq.${encodeURIComponent(messageId.trim())}&conversation_id=eq.${encodeURIComponent(dbConvId)}&select=id,conversation_id`;
            const msgRes = await fetch(msgQueryUrl, {
              headers: {
                'apikey': supabaseServiceKey,
                'Authorization': `Bearer ${supabaseServiceKey}`,
              },
            });

            if (!msgRes.ok) {
              console.error(`[Worker] Message lookup HTTP error ${msgRes.status}`);
              return jsonResponse({
                success: false,
                error: `Database error verifying message (HTTP ${msgRes.status}).`,
              }, 500);
            }

            const msgRows: any = await msgRes.json();
            if (!Array.isArray(msgRows) || msgRows.length !== 1) {
              return jsonResponse({
                success: false,
                error: 'Bad Request: Message does not belong to this conversation.',
              }, 400);
            }
          } catch (err: any) {
            console.error('[Worker] DB message verification exception:', err);
            return jsonResponse({
              success: false,
              error: 'Database error verifying message.',
            }, 500);
          }
        } else if (!guestSecretInfo.isDevFallback) {
          return jsonResponse({
            success: false,
            error: 'Server configuration error: Database bindings missing in production.',
          }, 503);
        } else {
          // Dev fallback: verify message in in-memory message history
          const memMsgs = conversationMessages.get(dbConvId) || conversationMessages.get(canonicalConvId) || [];
          const found = memMsgs.some((m) => m.id === messageId);
          if (!found) {
            return jsonResponse({
              success: false,
              error: 'Bad Request: Message does not belong to this conversation.',
            }, 400);
          }
        }

        // 6. Update in-memory read state
        if (!conversationReadState.has(canonicalConvId)) {
          conversationReadState.set(canonicalConvId, new Map());
        }
        const readMap = conversationReadState.get(canonicalConvId)!;
        const readAt = new Date().toISOString();
        readMap.set(verifiedUserId, { readUntilId: messageId, readAt });

        // 7. Broadcast dm_read to canonical conversation identifier
        const readPayload = {
          userId: verifiedUserId,
          readerId: verifiedUserId,
          messageId,
          readAt,
        };

        broadcastToConversation(canonicalConvId, 'dm_read', readPayload);
        if (dbConvId && dbConvId !== canonicalConvId) {
          broadcastToConversation(dbConvId, 'dm_read', readPayload);
        }

        return jsonResponse({ success: true, messageId, readerId: verifiedUserId });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err.message || 'Read receipt failed' }, 500);
      }
    }

    // -------------------------------------------------------------------------
    // 6. GUEST SESSION ENDPOINTS
    // -------------------------------------------------------------------------
    if (url.pathname === '/api/guest/session' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const { nickname, avatar, gender, languagePref, is18Verified, ageDeclarationAccepted } = body || {};

        const sessionId = crypto.randomUUID();
        const issuedAt = Date.now();
        const expiresAt = issuedAt + 24 * 60 * 60 * 1000;

        // User explicit 18+ declaration & consent.
        // Recorded as a signed token claim (dec18), but NEVER as trusted verification (v18 / is_18_verified).
        const hasDeclared = Boolean(ageDeclarationAccepted ?? is18Verified);

        const payload = {
          sid: sessionId,
          nick: (nickname || 'Guest_User').slice(0, 24),
          av: avatar || '⚡',
          gen: gender || 'prefer_not_to_say',
          lng: languagePref || 'en',
          v18: false,
          dec18: hasDeclared,
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
          is_18_verified: false,
          verified_at: null,
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
          is18Verified: false,
          ageDeclarationAccepted: payload.dec18,
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
    // 6B. AUTHENTICATED DATA EXPORT ENDPOINT
    // -------------------------------------------------------------------------
    if (url.pathname === '/api/auth/data-export' && request.method === 'GET') {
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

      if (authResult.isGuestCaller) {
        return jsonResponse({
          success: false,
          error: 'Forbidden: Data export is only available for registered members.',
        }, 403);
      }

      // Authoritative profile fetch
      const profile = await fetchMemberProfile(authResult.verifiedUserId, {
        supabaseUrl: baseSupabaseUrl,
        supabaseServiceKey,
      });

      return jsonResponse({
        success: true,
        export: {
          user: {
            id: authResult.verifiedUserId,
            ...profile,
          },
          exportedAt: new Date().toISOString(),
          platform: 'ChatLustora',
        },
      });
    }

    // -------------------------------------------------------------------------
    // 6C. AUTHENTICATED PROFILE UPDATE ENDPOINT (Audit Layer)
    // -------------------------------------------------------------------------
    if (url.pathname === '/api/auth/profile/update' && request.method === 'POST') {
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

      if (authResult.isGuestCaller) {
        return jsonResponse({
          success: false,
          error: 'Forbidden: Profile updates via this endpoint are restricted to registered members.',
        }, 403);
      }

      try {
        const body: any = await request.json();
        const { updates } = body || {};

        if (!updates || typeof updates !== 'object') {
          return jsonResponse({ success: false, error: 'Bad Request: Missing update payload.' }, 400);
        }

        // Fail closed if database bindings missing
        if (!baseSupabaseUrl || !supabaseServiceKey) {
          return jsonResponse({ success: false, error: 'Server configuration error: Database bindings missing.' }, 503);
        }

        // Correction 2: Generic profile updates must never modify trusted verification fields.
        const allowedUpdates: any = {
          nickname: updates.nickname,
          bio: updates.bio,
          avatar_url: updates.avatar,
          safe_filter_enabled: updates.safeFilterEnabled,
          notification_sounds: updates.notificationSounds,
          updated_at: new Date().toISOString(),
        };

        // Perform authoritative update strictly scoped to the verifiedUserId.
        // Use 'Prefer: return=representation' to verify the target row was actually affected.
        const res = await fetch(`${baseSupabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(authResult.verifiedUserId)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Prefer': 'return=representation',
          },
          body: JSON.stringify(allowedUpdates),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.error(`[Worker] Profile update failed HTTP ${res.status}:`, errText);
          return jsonResponse({ success: false, error: `Profile update failed (HTTP ${res.status}).` }, 500);
        }

        const updatedRows: any = await res.json().catch(() => []);
        if (!Array.isArray(updatedRows) || updatedRows.length !== 1) {
          console.warn(`[Worker] Profile update for ${authResult.verifiedUserId} affected ${Array.isArray(updatedRows) ? updatedRows.length : 0} rows.`);
          return jsonResponse({
            success: false,
            error: 'Profile update failed: Identity record not found or inaccessible.',
          }, 404);
        }

        return jsonResponse({ success: true, message: 'Profile updated successfully.' });
      } catch (err: any) {
        return jsonResponse({ success: false, error: 'Malformed profile update request.' }, 400);
      }
    }

    // -------------------------------------------------------------------------
    // 7. DEFAULT API FALLBACK FOR UNHANDLED /api/* ROUTES
    // -------------------------------------------------------------------------
    return jsonResponse({
      success: false,
      error: 'Not Found: The requested API endpoint is not implemented on this worker instance.',
      path: url.pathname,
    }, 404);
}
