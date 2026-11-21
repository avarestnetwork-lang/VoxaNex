/**
 * ChatLustora — Phase 1.1 Remediation R2 Media Integration & Security Test Suite
 *
 * Executes real Cloudflare Worker endpoint handlers via worker.fetch(req, env, ctx).
 * Validates:
 * 1. Authentication & Session Verification (Member JWT, Guest Token, Revocation, 401s)
 * 2. Strict Identity Separation & Fail-Closed Private Conversation Authorization (403s, 502, 503)
 * 3. Adult Room Age Verification Gate (403 for unverified guests)
 * 4. Bounded Request Stream & Binary Validation (15MB limit, streaming abort, binary signatures)
 * 5. Secure Media Retrieval, Cache Headers & Exact Lookup (private no-store, nosniff, 404s)
 * 6. Routing Priority & External Backend Proxy Bypass
 * 7. Media Metadata Validation Endpoint
 */

import worker from '../src/worker';
import { databaseService } from '../src/services/databaseService';
import { EXTERNAL_PROVIDERS_DOCUMENTATION } from '../src/server/mediaAndEmbedManager';
import { validateMediaBinary, validateMediaFileMetadata, isSafeMediaUrl } from '../src/lib/mediaValidation';

let testCount = 0;
let passedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  testCount++;
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
    throw new Error(`Assertion failed: ${testName}`);
  } else {
    passedCount++;
    console.log(`✅ [PASSED] ${testName}`);
  }
}

// ---------------------------------------------------------------------------
// Mock R2 Storage Implementation
// ---------------------------------------------------------------------------
class MockR2Bucket {
  store: Map<string, { body: Uint8Array; httpMetadata: any; customMetadata: any }> = new Map();
  failNextPut = false;

  async put(key: string, value: any, options?: any) {
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error('Simulated R2 write failure');
    }

    let bytes: Uint8Array;
    if (value instanceof Uint8Array) {
      bytes = value;
    } else if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value);
    } else if (typeof value === 'string') {
      bytes = new TextEncoder().encode(value);
    } else {
      bytes = new Uint8Array(await new Response(value).arrayBuffer());
    }

    this.store.set(key, {
      body: bytes,
      httpMetadata: options?.httpMetadata || {},
      customMetadata: options?.customMetadata || {},
    });
    return { key };
  }

  async get(key: string) {
    const item = this.store.get(key);
    if (!item) return null;
    return {
      body: item.body,
      httpMetadata: item.httpMetadata,
      customMetadata: item.customMetadata,
    };
  }

  async delete(key: string | string[]) {
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      this.store.delete(k);
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Cryptographic Guest Token Generator (Matches Worker's verifyGuestToken)
// ---------------------------------------------------------------------------
function toBase64Url(str: string): string {
  const binary = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
    String.fromCharCode(parseInt(p1, 16))
  );
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function computeTokenHash(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function createSignedGuestToken(
  session: { sid: string; nick: string; dec18?: boolean; v18?: boolean; exp?: number },
  secret: string
): Promise<string> {
  const now = Date.now();
  const payload = {
    sid: session.sid,
    nick: session.nick,
    iat: now,
    exp: session.exp || now + 24 * 60 * 60 * 1000,
    dec18: Boolean(session.dec18),
    v18: Boolean(session.v18),
  };

  const base64Payload = toBase64Url(JSON.stringify(payload));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret.trim()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(base64Payload));
  const sigBytes = Array.from(new Uint8Array(sigBuffer));
  const sigHex = sigBytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `vx_gst_${base64Payload}.${sigHex}`;
}

// ---------------------------------------------------------------------------
// Binary Test Fixtures
// ---------------------------------------------------------------------------
const VALID_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

const VALID_JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9
]);

const VALID_GIF_BYTES = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
  0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b
]);

const VALID_MP3_BYTES = new Uint8Array([
  0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20,
  0x54, 0x49, 0x54, 0x32, 0x00, 0x00, 0x00, 0x0c, 0x00, 0x00,
  0x03, 0x54, 0x65, 0x73, 0x74, 0x20, 0x54, 0x72, 0x61, 0x63, 0x6b
]);

const EXECUTABLE_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
const HTML_SCRIPT_BYTES = new TextEncoder().encode('<html><script>alert(1)</script></html>');
const SVG_BYTES = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

// ---------------------------------------------------------------------------
// Test Runner
// ---------------------------------------------------------------------------
async function runSuite() {
  console.log('================================================================');
  console.log(' CHATLUSTORA: COMPLETE WORKER R2 MEDIA & SECURITY INTEGRATION SUITE');
  console.log('================================================================');

  const GUEST_SECRET = 'super-secret-guest-signing-key-minimum-32-chars-long';
  const SUPABASE_URL = 'https://mock-supabase.chatlustora.internal';
  const SERVICE_KEY = 'service-role-key-chatlustora-prod-internal';
  const BACKEND_URL = 'https://external-backend.chatlustora.internal';

  // In-memory mock database state
  const mockMembers = new Map<string, { id: string; email: string }>();
  const mockGuestSessions = new Map<string, {
    id: string;
    session_token_hash: string;
    is_revoked: boolean;
    expires_at: string;
  }>();
  const mockConversations = new Map<string, Array<{ user_id: string | null; guest_id: string | null }>>();
  const mockMediaUploads = new Map<string, any>();
  const mockMessages: any[] = [];
  let failNextMetadataInsert = false;
  let simulateModerationHttpError = false;
  let simulateModerationNetworkError = false;
  let simulateModerationMalformedRow = false;

  // Populate initial state
  const memberAliceId = '11111111-1111-4111-8111-111111111111';
  const memberBobId = '22222222-2222-4222-8222-222222222222';
  const guestCharlieId = '33333333-3333-4333-8333-333333333333';
  const guestDaveId = '44444444-4444-4444-8444-444444444444';
  const nonParticipantId = '99999999-9999-4999-8999-999999999999';
  const rateLimitUserId = '88888888-8888-4888-8888-888888888888';

  mockMembers.set('jwt_alice', { id: memberAliceId, email: 'alice@chatlustora.com' });
  mockMembers.set('jwt_bob', { id: memberBobId, email: 'bob@chatlustora.com' });
  mockMembers.set('jwt_stranger', { id: nonParticipantId, email: 'stranger@chatlustora.com' });
  mockMembers.set('jwt_ratelimit', { id: rateLimitUserId, email: 'ratelimit@chatlustora.com' });

  // Conversation with Alice (member) and Charlie (guest)
  const conversationId = '55555555-5555-4555-8555-555555555555';
  const deterministicAliceCharlieConvId = await databaseService.getDeterministicConvId(memberAliceId, guestCharlieId);
  const aliceCharlieParticipants = [
    { user_id: memberAliceId, guest_id: null },
    { user_id: null, guest_id: guestCharlieId },
  ];
  mockConversations.set(conversationId, aliceCharlieParticipants);
  mockConversations.set(deterministicAliceCharlieConvId, aliceCharlieParticipants);

  // Intercept globalThis.fetch for Supabase API calls and Backend Proxy
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

    // Backend proxy interceptor (deliberately emits wildcard/credentials CORS upstream to test Worker stripping)
    if (urlStr.startsWith(BACKEND_URL)) {
      const url = new URL(urlStr);
      return new Response(JSON.stringify({ proxied: true, path: url.pathname }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': 'true',
        },
      });
    }

    // Supabase member auth: /auth/v1/user
    if (urlStr.startsWith(`${SUPABASE_URL}/auth/v1/user`)) {
      const headersObj: any = init?.headers || {};
      const authHeader =
        typeof headersObj.get === 'function'
          ? headersObj.get('Authorization') || headersObj.get('authorization') || ''
          : headersObj['Authorization'] || headersObj['authorization'] || '';
      const token = authHeader.replace('Bearer ', '').trim();
      const member = mockMembers.get(token);
      if (member) {
        return new Response(JSON.stringify({ id: member.id, email: member.email }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ message: 'Invalid JWT' }), { status: 401 });
    }

    // Supabase guest sessions: /rest/v1/guest_sessions
    if (urlStr.includes('/rest/v1/guest_sessions')) {
      const url = new URL(urlStr);
      const hashParam = url.searchParams.get('session_token_hash');
      const hash = hashParam ? hashParam.replace(/^eq\./, '') : '';
      const session = Array.from(mockGuestSessions.values()).find((s) => s.session_token_hash === hash);
      return new Response(JSON.stringify(session ? [session] : []), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Supabase conversation participants: /rest/v1/conversation_participants
    if (urlStr.includes('/rest/v1/conversation_participants')) {
      const url = new URL(urlStr);
      const convParam = url.searchParams.get('conversation_id');
      const convId = convParam ? convParam.replace(/^eq\./, '') : '';
      if (convId === 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') {
        return new Response(JSON.stringify({ message: 'Internal DB Error' }), { status: 500 });
      }
      const participants = mockConversations.get(convId) || [];
      return new Response(JSON.stringify(participants), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Supabase media_uploads metadata table
    if (urlStr.includes('/rest/v1/media_uploads')) {
      if (method === 'POST') {
        if (failNextMetadataInsert) {
          failNextMetadataInsert = false;
          return new Response(JSON.stringify({ message: 'Simulated DB metadata insert error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const rawBody = typeof init?.body === 'string' ? init.body : '';
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const row = {
          ...payload,
          created_at: new Date().toISOString(),
        };
        mockMediaUploads.set(row.id, row);
        return new Response(JSON.stringify([row]), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (simulateModerationNetworkError) {
        simulateModerationNetworkError = false;
        throw new Error('Simulated Supabase network failure');
      }
      if (simulateModerationHttpError) {
        simulateModerationHttpError = false;
        return new Response(JSON.stringify({ message: 'Simulated DB read error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const url = new URL(urlStr);
      const idParam = url.searchParams.get('id');
      const targetId = idParam ? idParam.replace(/^eq\./, '') : '';
      if (simulateModerationMalformedRow) {
        simulateModerationMalformedRow = false;
        return new Response(JSON.stringify([{ id: targetId, is_flagged: 'invalid_non_bool' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const existing = mockMediaUploads.get(targetId);
      return new Response(JSON.stringify(existing ? [existing] : []), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Supabase profiles lookup
    if (urlStr.includes('/rest/v1/profiles')) {
      const url = new URL(urlStr);
      const idParam = url.searchParams.get('id');
      const targetId = idParam ? idParam.replace(/^eq\./, '') : '';
      return new Response(
        JSON.stringify([{ id: targetId, nickname: targetId === memberAliceId ? 'Alice' : 'Member', avatar_url: '👤' }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Supabase chat_rooms lookup
    if (urlStr.includes('/rest/v1/chat_rooms')) {
      const generalRoomUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      return new Response(JSON.stringify({ id: generalRoomUuid, slug: 'general' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Supabase conversations upsert
    if (urlStr.includes('/rest/v1/conversations')) {
      return new Response(JSON.stringify([{ id: deterministicAliceCharlieConvId }]), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Supabase upsert_message RPC
    if (urlStr.includes('/rest/v1/rpc/upsert_message')) {
      const rawBody = typeof init?.body === 'string' ? init.body : '';
      const p = rawBody ? JSON.parse(rawBody) : {};
      const row = {
        id: p.p_id || crypto.randomUUID(),
        room_id: p.p_room_id || null,
        conversation_id: p.p_conversation_id || null,
        sender_user_id: p.p_sender_user_id || null,
        sender_guest_id: p.p_sender_guest_id || null,
        sender_nickname: p.p_sender_nickname || 'User',
        sender_avatar: p.p_sender_avatar || '👤',
        content: p.p_content || '',
        media_url: p.p_media_url || null,
        media_type: p.p_media_type || null,
        link_preview: p.p_link_preview || null,
        client_nonce: p.p_client_nonce || null,
        created_at: new Date().toISOString(),
        is_system: false,
        inserted: true,
      };
      mockMessages.push(row);
      return new Response(JSON.stringify([row]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Supabase messages REST read
    if (urlStr.includes('/rest/v1/messages')) {
      const url = new URL(urlStr);
      const roomParam = url.searchParams.get('room_id');
      const convParam = url.searchParams.get('conversation_id');
      let filtered = [...mockMessages];
      if (roomParam) {
        const rid = roomParam.replace(/^eq\./, '');
        filtered = filtered.filter((m) => m.room_id === rid);
      }
      if (convParam) {
        const cid = convParam.replace(/^eq\./, '');
        filtered = filtered.filter((m) => m.conversation_id === cid);
      }
      return new Response(JSON.stringify(filtered), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Default fallback
    return originalFetch(input, init);
  };

  const mockR2 = new MockR2Bucket();
  const defaultEnv = {
    CHAT_MEDIA: mockR2,
    GUEST_SESSION_SECRET: GUEST_SECRET,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    BACKEND_URL,
  };

  try {
    // Register active guest Charlie
    const charlieToken = await createSignedGuestToken(
      { sid: guestCharlieId, nick: 'Charlie', dec18: true, v18: true },
      GUEST_SECRET
    );
    mockGuestSessions.set(guestCharlieId, {
      id: guestCharlieId,
      session_token_hash: await computeTokenHash(charlieToken),
      is_revoked: false,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });

    // Register active guest Dave (WITHOUT 18+ declaration)
    const daveToken = await createSignedGuestToken(
      { sid: guestDaveId, nick: 'Dave', dec18: false, v18: false },
      GUEST_SECRET
    );
    mockGuestSessions.set(guestDaveId, {
      id: guestDaveId,
      session_token_hash: await computeTokenHash(daveToken),
      is_revoked: false,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });

    // Register revoked guest
    const revokedGuestId = '77777777-7777-4777-8777-777777777777';
    const revokedToken = await createSignedGuestToken(
      { sid: revokedGuestId, nick: 'Revoked', dec18: true },
      GUEST_SECRET
    );
    mockGuestSessions.set(revokedGuestId, {
      id: revokedGuestId,
      session_token_hash: await computeTokenHash(revokedToken),
      is_revoked: true,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });

    // -------------------------------------------------------------------------
    // CATEGORY A: Authentication & Session Verification
    // -------------------------------------------------------------------------
    console.log('\n--- Category A: Authentication & Session Verification ---');

    // A1: Unauthenticated upload rejected with 401
    {
      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=----WebKitFormBoundaryXYZ' },
        body: 'dummy',
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 401, 'A1: Unauthenticated upload rejected with HTTP 401');
    }

    // A2: Invalid JWT / bad member token rejected with 401
    {
      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer bad_member_jwt_token',
          'Content-Type': 'multipart/form-data; boundary=----WebKitFormBoundaryXYZ',
        },
        body: 'dummy',
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 401, 'A2: Invalid member JWT token rejected with HTTP 401');
    }

    // A3: Tampered guest token rejected with 401
    {
      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer vx_gst_forged_payload.00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
          'Content-Type': 'multipart/form-data; boundary=----WebKitFormBoundaryXYZ',
        },
        body: 'dummy',
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 401, 'A3: Tampered guest token rejected with HTTP 401');
    }

    // A4: Revoked guest session rejected with 401
    {
      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${revokedToken}`,
          'Content-Type': 'multipart/form-data; boundary=----WebKitFormBoundaryXYZ',
        },
        body: 'dummy',
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 401, 'A4: Revoked guest session strictly rejected with HTTP 401');
    }

    // A4b: Expired guest session rejected with 401
    {
      const expiredGuestId = '77777777-7777-4777-8777-777777777778';
      const expiredToken = await createSignedGuestToken(
        { sid: expiredGuestId, nick: 'ExpiredGuest', exp: Date.now() - 60000 },
        GUEST_SECRET
      );
      mockGuestSessions.set(expiredGuestId, {
        id: expiredGuestId,
        session_token_hash: await computeTokenHash(expiredToken),
        is_revoked: false,
        expires_at: new Date(Date.now() - 60000).toISOString(),
      });

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${expiredToken}`,
          'Content-Type': 'multipart/form-data; boundary=----WebKitFormBoundaryXYZ',
        },
        body: 'dummy',
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 401, 'A4b: Expired guest session strictly rejected with HTTP 401');
    }

    // A5: Valid member PNG upload accepted (200) and metadata persisted
    let memberMediaId = '';
    {
      const formData = new FormData();
      formData.append('file', new File([VALID_PNG_BYTES], 'photo.png', { type: 'image/png' }));
      formData.append('contextType', 'room');
      formData.append('contextId', 'general');

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt_alice' },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 200, 'A5: Valid member upload accepted with HTTP 200');
      const data: any = await res.json();
      assert(data.success === true && data.media?.uploadId, 'A5.1: Valid upload response contains media asset and ID');
      memberMediaId = data.media.uploadId;
      const persistedRow = mockMediaUploads.get(memberMediaId);
      assert(
        Boolean(persistedRow && persistedRow.uploader_id === memberAliceId && persistedRow.mime_type === 'image/png'),
        'A5.2: Metadata persisted cleanly to Supabase public.media_uploads with verified uploader_id'
      );
    }

    // A6: Valid guest upload accepted (200)
    let guestMediaId = '';
    {
      const formData = new FormData();
      formData.append('file', new File([VALID_PNG_BYTES], 'guest_pic.png', { type: 'image/png' }));
      formData.append('contextType', 'room');
      formData.append('contextId', 'general');

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${charlieToken}` },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 200, 'A6: Valid guest upload accepted with HTTP 200');
      const data: any = await res.json();
      assert(data.success === true, 'A6.1: Guest media upload success');
      guestMediaId = data.media.uploadId;
    }

    // A7: Valid JPEG image upload accepted (200)
    {
      const formData = new FormData();
      formData.append('file', new File([VALID_JPEG_BYTES], 'avatar.jpg', { type: 'image/jpeg' }));
      formData.append('contextType', 'room');
      formData.append('contextId', 'general');

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt_bob' },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 200, 'A7: Valid JPEG image upload accepted with HTTP 200');
      const data: any = await res.json();
      assert(data.media?.mediaType === 'image' && data.media?.mimeType === 'image/jpeg', 'A7.1: JPEG metadata correct');
    }

    // A8: Valid GIF upload accepted (200) and classified as mediaType 'gif'
    {
      const formData = new FormData();
      formData.append('file', new File([VALID_GIF_BYTES], 'wave.gif', { type: 'image/gif' }));
      formData.append('contextType', 'room');
      formData.append('contextId', 'general');

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt_bob' },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 200, 'A8: Valid GIF upload accepted with HTTP 200');
      const data: any = await res.json();
      assert(data.media?.mediaType === 'gif' && data.media?.mimeType === 'image/gif', 'A8.1: GIF classified as image/gif');
    }

    // -------------------------------------------------------------------------
    // CATEGORY B: Strict Identity Separation & Private Conversation Authorization
    // -------------------------------------------------------------------------
    console.log('\n--- Category B: Strict Identity Separation & Private Conversation Authorization ---');

    // B1: Member Alice matching user_id in conversation authorized (200)
    let privateMediaId = '';
    {
      const formData = new FormData();
      formData.append('file', new File([VALID_PNG_BYTES], 'secret.png', { type: 'image/png' }));
      formData.append('contextType', 'conversation');
      formData.append('contextId', conversationId);

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt_alice' },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 200, 'B1: Member caller matching user_id authorized for private conversation upload');
      const data: any = await res.json();
      privateMediaId = data.media.uploadId;
    }

    // B2: Guest Charlie matching guest_id in conversation authorized (200)
    {
      const formData = new FormData();
      formData.append('file', new File([VALID_PNG_BYTES], 'charlie_private.png', { type: 'image/png' }));
      formData.append('contextType', 'conversation');
      formData.append('contextId', conversationId);

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${charlieToken}` },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 200, 'B2: Guest caller matching guest_id authorized for private conversation upload');
    }

    // B3: Identity Confusion: Member Bob attempting to match Charlie's guest_id strictly denied (403)
    // Setup a conversation where user_id is null and guest_id is Bob's ID
    const guestConfusionConvId = '66666666-6666-4666-8666-666666666666';
    mockConversations.set(guestConfusionConvId, [
      { user_id: null, guest_id: memberBobId }, // Bob's ID mistakenly placed in guest_id
    ]);
    {
      const formData = new FormData();
      formData.append('file', new File([VALID_PNG_BYTES], 'confuse.png', { type: 'image/png' }));
      formData.append('contextType', 'conversation');
      formData.append('contextId', guestConfusionConvId);

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt_bob' },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 403, 'B3: Identity separation: Member matching only guest_id column is strictly denied (403)');
    }

    // B4: Identity Confusion: Guest Charlie attempting to match Alice's user_id strictly denied (403)
    const memberConfusionConvId = '77777777-8888-4888-8888-777777777777';
    mockConversations.set(memberConfusionConvId, [
      { user_id: guestCharlieId, guest_id: null }, // Charlie's ID mistakenly placed in user_id
    ]);
    {
      const formData = new FormData();
      formData.append('file', new File([VALID_PNG_BYTES], 'confuse_guest.png', { type: 'image/png' }));
      formData.append('contextType', 'conversation');
      formData.append('contextId', memberConfusionConvId);

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${charlieToken}` },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 403, 'B4: Identity separation: Guest matching only user_id column is strictly denied (403)');
    }

    // B5: Non-participant caller strictly denied (403)
    {
      const formData = new FormData();
      formData.append('file', new File([VALID_PNG_BYTES], 'intruder.png', { type: 'image/png' }));
      formData.append('contextType', 'conversation');
      formData.append('contextId', conversationId);

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt_stranger' },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 403, 'B5: Non-participant caller denied with HTTP 403');
    }

    // B6: Missing Supabase database configuration fails closed with 503
    {
      const formData = new FormData();
      formData.append('file', new File([VALID_PNG_BYTES], 'test.png', { type: 'image/png' }));
      formData.append('contextType', 'conversation');
      formData.append('contextId', conversationId);

      const brokenEnv = { ...defaultEnv, SUPABASE_SERVICE_ROLE_KEY: undefined };
      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt_alice' },
        body: formData,
      });
      const res = await worker.fetch(req, brokenEnv, {});
      assert(res.status === 503, 'B6: Missing Supabase config fails closed with HTTP 503');
    }

    // B7: Database query failure fails closed with 502
    {
      const formData = new FormData();
      formData.append('file', new File([VALID_PNG_BYTES], 'test.png', { type: 'image/png' }));
      formData.append('contextType', 'conversation');
      formData.append('contextId', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt_alice' },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 502, 'B7: Database server failure fails closed with HTTP 502');
    }

    // -------------------------------------------------------------------------
    // CATEGORY C: Adult Room Age Verification Gate
    // -------------------------------------------------------------------------
    console.log('\n--- Category C: Adult Room Age Verification Gate ---');

    // C1: Registered member uploading to adult room authorized (200)
    let adultMediaId = '';
    {
      const formData = new FormData();
      formData.append('file', new File([VALID_PNG_BYTES], 'adult_img.png', { type: 'image/png' }));
      formData.append('contextType', 'room');
      formData.append('contextId', 'adult');

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt_alice' },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 200, 'C1: Member uploading to adult room authorized (200)');
      const data: any = await res.json();
      adultMediaId = data.media.uploadId;
    }

    // C2: Guest with 18+ declaration uploading to adult room authorized (200)
    {
      const formData = new FormData();
      formData.append('file', new File([VALID_PNG_BYTES], 'charlie_adult.png', { type: 'image/png' }));
      formData.append('contextType', 'room');
      formData.append('contextId', 'adult');

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${charlieToken}` },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 200, 'C2: Verified 18+ guest uploading to adult room authorized (200)');
    }

    // C3: Guest WITHOUT 18+ declaration uploading to adult room strictly denied (403)
    {
      const formData = new FormData();
      formData.append('file', new File([VALID_PNG_BYTES], 'dave_adult.png', { type: 'image/png' }));
      formData.append('contextType', 'room');
      formData.append('contextId', 'adult');

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${daveToken}` },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 403, 'C3: Guest without 18+ declaration uploading to adult room denied (403)');
    }

    // C4: Guest WITHOUT 18+ declaration retrieving adult room media strictly denied (403)
    {
      const req = new Request(`https://chatlustora.com/api/media/${adultMediaId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${daveToken}` },
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 403, 'C4: Guest without 18+ declaration retrieving adult room media denied (403)');
    }

    // -------------------------------------------------------------------------
    // CATEGORY D: Bounded Request Stream & Signature Validation
    // -------------------------------------------------------------------------
    console.log('\n--- Category D: Bounded Request Stream & Signature Validation ---');

    // D1: Request with Content-Length > 15MB rejected with 413
    {
      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer jwt_alice',
          'Content-Length': String(16 * 1024 * 1024),
          'Content-Type': 'multipart/form-data',
        },
        body: 'dummy',
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 413, 'D1: Content-Length > 15MB rejected immediately with HTTP 413');
    }

    // D2: Chunked streaming body exceeding 15MB aborted with 413
    {
      // Simulate chunked streaming where Content-Length is not declared
      const chunk = new Uint8Array(2 * 1024 * 1024); // 2 MB per chunk
      let chunksSent = 0;
      const customStream = new ReadableStream({
        pull(controller) {
          if (chunksSent < 9) { // 9 * 2MB = 18MB
            controller.enqueue(chunk);
            chunksSent++;
          } else {
            controller.close();
          }
        },
      });

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer jwt_alice',
          'Content-Type': 'application/octet-stream',
          'X-Context-Type': 'room',
          'X-Context-Id': 'general',
        },
        body: customStream,
        // @ts-ignore
        duplex: 'half',
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 413, 'D2: Cumulative streaming reader aborts oversized chunks with HTTP 413');
    }

    // D3: Empty request body rejected with 400
    {
      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer jwt_alice',
          'Content-Type': 'application/json',
        },
        body: '',
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 400, 'D3: Empty request body rejected with HTTP 400');
    }

    // D3b: Empty 0-byte file in multipart FormData rejected with 400
    {
      const formData = new FormData();
      formData.append('file', new File([new Uint8Array(0)], 'empty.png', { type: 'image/png' }));
      formData.append('contextType', 'room');
      formData.append('contextId', 'general');

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt_bob' },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 400, 'D3b: Empty 0-byte multipart file rejected with HTTP 400');
    }

    // D3c: Malformed multipart payload rejected cleanly with 400 (never 500)
    {
      const reqMissingBoundary = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer jwt_bob',
          'Content-Type': 'multipart/form-data',
        },
        body: 'not-a-multipart-body',
      });
      const res1 = await worker.fetch(reqMissingBoundary, defaultEnv, {});
      assert(res1.status === 400, 'D3c.1: Multipart missing boundary rejected with HTTP 400');

      const reqCorruptBoundary = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer jwt_bob',
          'Content-Type': 'multipart/form-data; boundary=----FakeBoundary123',
        },
        body: 'corrupted non-boundary content without terminating dashes',
      });
      const res2 = await worker.fetch(reqCorruptBoundary, defaultEnv, {});
      assert(res2.status === 400, 'D3c.2: Corrupted multipart payload rejected cleanly with HTTP 400');
    }

    // D4: Executable masquerading as image rejected with 400
    {
      const formData = new FormData();
      formData.append('file', new File([EXECUTABLE_BYTES], 'malware.png', { type: 'image/png' }));
      formData.append('contextType', 'room');
      formData.append('contextId', 'general');

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt_alice' },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 400, 'D4: Executable masquerading as PNG strictly rejected (400)');
    }

    // D4b: Disallowed MIME types & dangerous/double extensions (.exe, .svg, application/pdf) rejected with 400
    {
      const formPdf = new FormData();
      formPdf.append('file', new File([new TextEncoder().encode('%PDF-1.4')], 'doc.pdf', { type: 'application/pdf' }));
      const resPdf = await worker.fetch(
        new Request('https://chatlustora.com/api/media/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer jwt_bob' },
          body: formPdf,
        }),
        defaultEnv,
        {}
      );
      assert(resPdf.status === 400, 'D4b.1: Disallowed MIME (application/pdf) rejected with HTTP 400');

      const formSvg = new FormData();
      formSvg.append('file', new File([SVG_BYTES], 'vector.svg', { type: 'image/svg+xml' }));
      const resSvg = await worker.fetch(
        new Request('https://chatlustora.com/api/media/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer jwt_bob' },
          body: formSvg,
        }),
        defaultEnv,
        {}
      );
      assert(resSvg.status === 400, 'D4b.2: SVG upload rejected with HTTP 400');

      const formDoubleExt = new FormData();
      formDoubleExt.append('file', new File([VALID_PNG_BYTES], 'payload.exe.png', { type: 'image/png' }));
      const resDouble = await worker.fetch(
        new Request('https://chatlustora.com/api/media/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer jwt_bob' },
          body: formDoubleExt,
        }),
        defaultEnv,
        {}
      );
      assert(resDouble.status === 400, 'D4b.3: Double extension executable (payload.exe.png) rejected with HTTP 400');
    }

    // D4c: MIME and extension mismatch rejected with 400
    {
      const formData = new FormData();
      formData.append('file', new File([VALID_PNG_BYTES], 'mismatch.jpg', { type: 'image/png' }));
      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt_bob' },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 400, 'D4c: MIME (image/png) vs extension (.jpg) mismatch rejected with HTTP 400');
    }

    // D4d: Oversized image (> 5 MB) rejected with 400
    {
      const oversizedPng = new Uint8Array(5 * 1024 * 1024 + 1024);
      oversizedPng.set(VALID_PNG_BYTES, 0);
      const formData = new FormData();
      formData.append('file', new File([oversizedPng], 'huge.png', { type: 'image/png' }));
      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt_bob' },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 400, 'D4d: Oversized image (>5 MB) rejected with HTTP 400');
    }

    // D5: HTML / script payload rejected with 400
    {
      const formData = new FormData();
      formData.append('file', new File([HTML_SCRIPT_BYTES], 'exploit.jpg', { type: 'image/jpeg' }));
      formData.append('contextType', 'room');
      formData.append('contextId', 'general');

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt_alice' },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 400, 'D5: HTML / script polyglot payload strictly rejected (400)');
    }

    // D6: Missing CHAT_MEDIA R2 binding rejected with 503 (upload & retrieval)
    {
      const formData = new FormData();
      formData.append('file', new File([VALID_PNG_BYTES], 'photo.png', { type: 'image/png' }));
      formData.append('contextType', 'room');
      formData.append('contextId', 'general');

      const envWithoutR2 = { ...defaultEnv, CHAT_MEDIA: undefined };
      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt_alice' },
        body: formData,
      });
      const res = await worker.fetch(req, envWithoutR2, {});
      assert(res.status === 503, 'D6: Missing CHAT_MEDIA R2 binding on upload rejected with HTTP 503');

      const getRes = await worker.fetch(
        new Request(`https://chatlustora.com/api/media/${memberMediaId}`, {
          method: 'GET',
          headers: { 'Authorization': 'Bearer jwt_alice' },
        }),
        envWithoutR2,
        {}
      );
      assert(getRes.status === 503, 'D6b: Missing CHAT_MEDIA R2 binding on retrieval rejected with HTTP 503');
    }

    // D7: Valid MP3 audio clip accepted and retrieved with audio/mpeg MIME
    let mp3MediaId = '';
    {
      const formData = new FormData();
      formData.append('file', new File([VALID_MP3_BYTES], 'voice.mp3', { type: 'audio/mp3' }));
      formData.append('contextType', 'room');
      formData.append('contextId', 'general');

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt_alice' },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 200, 'D7: Valid MP3 audio clip upload accepted (200)');
      const data: any = await res.json();
      assert(data.media.mimeType === 'audio/mp3' || data.media.mimeType === 'audio/mpeg', 'D7.1: Canonical audio/mp3 MIME type assigned');
      mp3MediaId = data.media.uploadId;

      const getAudioRes = await worker.fetch(
        new Request(`https://chatlustora.com/api/media/${mp3MediaId}`, {
          method: 'GET',
          headers: { 'Authorization': 'Bearer jwt_alice' },
        }),
        defaultEnv,
        {}
      );
      assert(getAudioRes.status === 200, 'D7.2: MP3 audio retrieval succeeds (200)');
      assert(getAudioRes.headers.get('Content-Type') === 'audio/mpeg', 'D7.3: Audio served with audio/mpeg header');
      assert(Boolean(getAudioRes.headers.get('Content-Disposition')?.includes('voice.mp3')), 'D7.4: Safe inline Content-Disposition header emitted');
    }

    // -------------------------------------------------------------------------
    // CATEGORY E: Secure Media Retrieval & Cache Headers
    // -------------------------------------------------------------------------
    console.log('\n--- Category E: Secure Media Retrieval & Cache Headers ---');

    // E1: Retrieval of non-existent media ID returns 404
    {
      const req = new Request('https://chatlustora.com/api/media/med_nonexistent_123', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer jwt_alice' },
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 404, 'E1: Non-existent media ID returns HTTP 404');
    }

    // E2: Private conversation media returns private, no-store and nosniff
    {
      const req = new Request(`https://chatlustora.com/api/media/${privateMediaId}`, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer jwt_alice' },
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 200, 'E2: Participant retrieves private media with HTTP 200');
      assert(res.headers.get('Cache-Control') === 'private, no-store', 'E2.1: Cache-Control is private, no-store');
      assert(res.headers.get('X-Content-Type-Options') === 'nosniff', 'E2.2: X-Content-Type-Options is nosniff');
    }

    // E2b: Unauthenticated GET /api/media/:id strictly rejected with 401
    {
      const req = new Request(`https://chatlustora.com/api/media/${memberMediaId}`, {
        method: 'GET',
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 401, 'E2b: Unauthenticated media retrieval rejected with HTTP 401');
    }

    // E3: Non-participant attempting to retrieve private media strictly denied (403)
    {
      const req = new Request(`https://chatlustora.com/api/media/${privateMediaId}`, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer jwt_stranger' },
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 403, 'E3: Non-participant retrieving private media denied with HTTP 403');
    }

    // E4: Public room media returns public cache header
    {
      const req = new Request(`https://chatlustora.com/api/media/${memberMediaId}`, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer jwt_alice' },
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 200, 'E4: Public media retrieval returns HTTP 200');
      assert(res.headers.get('Cache-Control') === 'public, max-age=86400', 'E4.1: Public cache header set');
      assert(res.headers.get('X-Content-Type-Options') === 'nosniff', 'E4.2: Nosniff set for public media');
    }

    // E4b: Adult room media served with private, no-store cache header
    {
      const req = new Request(`https://chatlustora.com/api/media/${adultMediaId}`, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer jwt_alice' },
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 200, 'E4b: Authorized adult room media retrieval returns HTTP 200');
      assert(res.headers.get('Cache-Control') === 'private, no-store', 'E4b.1: Adult room media uses private, no-store');
    }

    // E5: Exact object key lookup verified
    {
      const rawStored = await mockR2.get(`media/objects/${memberMediaId}`);
      assert(rawStored !== null, 'E5: Exact key lookup in media/objects/${id} confirmed in R2 store');
      assert(rawStored?.customMetadata?.mediaId === memberMediaId, 'E5.1: Custom metadata correctly stored');
      assert(rawStored?.customMetadata?.metadataVersion === '1.2', 'E5.2: Metadata version 1.2 persisted');
    }

    // E6: Object with missing contextType metadata rejected (400, no public cache)
    {
      const testKey = 'media/objects/med_missing_context_type';
      await mockR2.put(testKey, VALID_PNG_BYTES, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: {
          mediaId: 'med_missing_context_type',
          contextId: 'general',
          metadataVersion: '1.2',
        },
      });

      const req = new Request('https://chatlustora.com/api/media/med_missing_context_type', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer jwt_alice' },
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 400, 'E6: Missing contextType metadata returns HTTP 400');
      const cacheControl = res.headers.get('Cache-Control') || '';
      assert(!cacheControl.includes('public'), 'E6.1: Missing contextType never receives public cache headers');
      const data: any = await res.json();
      assert(data.success === false, 'E6.2: Missing contextType returns error response');
    }

    // E7: Object with unsupported contextType metadata rejected (400, no public cache)
    {
      const testKey = 'media/objects/med_unsupported_context_type';
      await mockR2.put(testKey, VALID_PNG_BYTES, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: {
          mediaId: 'med_unsupported_context_type',
          contextType: 'broadcast_channel',
          contextId: 'chan_123',
          metadataVersion: '1.2',
        },
      });

      const req = new Request('https://chatlustora.com/api/media/med_unsupported_context_type', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer jwt_alice' },
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 400, 'E7: Unsupported contextType returns HTTP 400');
      const cacheControl = res.headers.get('Cache-Control') || '';
      assert(!cacheControl.includes('public'), 'E7.1: Unsupported contextType never receives public cache headers');
    }

    // E8: Object with missing or empty contextId metadata rejected (400, no public cache)
    {
      const testKey = 'media/objects/med_empty_context_id';
      await mockR2.put(testKey, VALID_PNG_BYTES, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: {
          mediaId: 'med_empty_context_id',
          contextType: 'room',
          contextId: '   ',
          metadataVersion: '1.2',
        },
      });

      const req = new Request('https://chatlustora.com/api/media/med_empty_context_id', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer jwt_alice' },
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 400, 'E8: Empty contextId metadata returns HTTP 400');
      const cacheControl = res.headers.get('Cache-Control') || '';
      assert(!cacheControl.includes('public'), 'E8.1: Empty contextId never receives public cache headers');
    }

    // E9: Object with conversation contextType but invalid UUID rejected (400, no public cache)
    {
      const testKey = 'media/objects/med_invalid_conv_uuid';
      await mockR2.put(testKey, VALID_PNG_BYTES, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: {
          mediaId: 'med_invalid_conv_uuid',
          contextType: 'conversation',
          contextId: 'not-a-valid-uuid-12345',
          metadataVersion: '1.2',
        },
      });

      const req = new Request('https://chatlustora.com/api/media/med_invalid_conv_uuid', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer jwt_alice' },
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 400, 'E9: Conversation media with non-UUID contextId returns HTTP 400');
      const cacheControl = res.headers.get('Cache-Control') || '';
      assert(!cacheControl.includes('public'), 'E9.1: Malformed conversation media never receives public cache headers');
    }

    // E10: Comprehensive metadataVersion enforcement tests
    // E10.1: Missing metadataVersion rejected (400, no public cache, no body returned)
    {
      const testKey = 'media/objects/med_missing_meta_version';
      await mockR2.put(testKey, VALID_PNG_BYTES, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: {
          mediaId: 'med_missing_meta_version',
          contextType: 'room',
          contextId: 'general',
          // metadataVersion omitted entirely
        },
      });

      const req = new Request('https://chatlustora.com/api/media/med_missing_meta_version', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer jwt_alice' },
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 400, 'E10.1: Missing metadataVersion returns HTTP 400');
      const cacheControl = res.headers.get('Cache-Control') || '';
      assert(!cacheControl.includes('public'), 'E10.1a: Missing metadataVersion never receives public cache headers');
      const data: any = await res.json();
      assert(data.success === false && data.error, 'E10.1b: Missing metadataVersion returns JSON error response');
    }

    // E10.2: null metadataVersion rejected (400, no public cache)
    {
      const testKey = 'media/objects/med_null_meta_version';
      await mockR2.put(testKey, VALID_PNG_BYTES, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: {
          mediaId: 'med_null_meta_version',
          contextType: 'room',
          contextId: 'general',
          metadataVersion: null as any,
        },
      });

      const req = new Request('https://chatlustora.com/api/media/med_null_meta_version', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer jwt_alice' },
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 400, 'E10.2: Null metadataVersion returns HTTP 400');
      const cacheControl = res.headers.get('Cache-Control') || '';
      assert(!cacheControl.includes('public'), 'E10.2a: Null metadataVersion never receives public cache headers');
      const data: any = await res.json();
      assert(data.success === false, 'E10.2b: Null metadataVersion returns JSON error');
    }

    // E10.3: Empty string metadataVersion rejected (400, no public cache)
    {
      const testKey = 'media/objects/med_empty_meta_version';
      await mockR2.put(testKey, VALID_PNG_BYTES, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: {
          mediaId: 'med_empty_meta_version',
          contextType: 'room',
          contextId: 'general',
          metadataVersion: '',
        },
      });

      const req = new Request('https://chatlustora.com/api/media/med_empty_meta_version', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer jwt_alice' },
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 400, 'E10.3: Empty metadataVersion returns HTTP 400');
      const cacheControl = res.headers.get('Cache-Control') || '';
      assert(!cacheControl.includes('public'), 'E10.3a: Empty metadataVersion never receives public cache headers');
      const data: any = await res.json();
      assert(data.success === false, 'E10.3b: Empty metadataVersion returns JSON error');
    }

    // E10.4: Whitespace-only metadataVersion rejected (400, no public cache)
    {
      const testKey = 'media/objects/med_whitespace_meta_version';
      await mockR2.put(testKey, VALID_PNG_BYTES, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: {
          mediaId: 'med_whitespace_meta_version',
          contextType: 'room',
          contextId: 'general',
          metadataVersion: '     ',
        },
      });

      const req = new Request('https://chatlustora.com/api/media/med_whitespace_meta_version', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer jwt_alice' },
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 400, 'E10.4: Whitespace-only metadataVersion returns HTTP 400');
      const cacheControl = res.headers.get('Cache-Control') || '';
      assert(!cacheControl.includes('public'), 'E10.4a: Whitespace metadataVersion never receives public cache headers');
      const data: any = await res.json();
      assert(data.success === false, 'E10.4b: Whitespace metadataVersion returns JSON error');
    }

    // E10.5: Numeric or other non-string metadataVersion rejected (400, no public cache)
    {
      const testKey = 'media/objects/med_numeric_meta_version';
      await mockR2.put(testKey, VALID_PNG_BYTES, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: {
          mediaId: 'med_numeric_meta_version',
          contextType: 'room',
          contextId: 'general',
          metadataVersion: 1.2 as any,
        },
      });

      const req = new Request('https://chatlustora.com/api/media/med_numeric_meta_version', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer jwt_alice' },
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 400, 'E10.5: Numeric metadataVersion returns HTTP 400');
      const cacheControl = res.headers.get('Cache-Control') || '';
      assert(!cacheControl.includes('public'), 'E10.5a: Numeric metadataVersion never receives public cache headers');
      const data: any = await res.json();
      assert(data.success === false, 'E10.5b: Numeric metadataVersion returns JSON error');
    }

    // E10.6: Unsupported/incompatible metadataVersion rejected (400, no public cache)
    {
      const testKey = 'media/objects/med_unsupported_meta_version';
      await mockR2.put(testKey, VALID_PNG_BYTES, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: {
          mediaId: 'med_unsupported_meta_version',
          contextType: 'room',
          contextId: 'general',
          metadataVersion: '2.0',
        },
      });

      const req = new Request('https://chatlustora.com/api/media/med_unsupported_meta_version', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer jwt_alice' },
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 400, 'E10.6: Unsupported metadataVersion 2.0 returns HTTP 400');
      const cacheControl = res.headers.get('Cache-Control') || '';
      assert(!cacheControl.includes('public'), 'E10.6a: Unsupported metadataVersion never receives public cache headers');
      const data: any = await res.json();
      assert(data.success === false, 'E10.6b: Unsupported metadataVersion returns JSON error');
    }

    // E10.7: Valid metadataVersion 1.2 succeeds for authorized room media
    {
      const testKey = 'media/objects/med_valid_meta_version';
      await mockR2.put(testKey, VALID_PNG_BYTES, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: {
          mediaId: 'med_valid_meta_version',
          contextType: 'room',
          contextId: 'general',
          metadataVersion: '1.2',
        },
      });
      mockMediaUploads.set('med_valid_meta_version', {
        id: 'med_valid_meta_version',
        is_flagged: false,
      });

      const req = new Request('https://chatlustora.com/api/media/med_valid_meta_version', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer jwt_alice' },
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 200, 'E10.7: Valid metadataVersion 1.2 returns HTTP 200');
      assert(res.headers.get('Cache-Control') === 'public, max-age=86400', 'E10.7a: Public cache header set for valid 1.2 room media');
    }

    // E11: Flagged media (is_flagged: true) denied with 403 on retrieval
    {
      const flaggedRow = mockMediaUploads.get(guestMediaId);
      assert(Boolean(flaggedRow), 'E11.0: Guest media record exists before moderation flag');
      flaggedRow.is_flagged = true;
      mockMediaUploads.set(guestMediaId, flaggedRow);

      const res = await worker.fetch(
        new Request(`https://chatlustora.com/api/media/${guestMediaId}`, {
          method: 'GET',
          headers: { 'Authorization': 'Bearer jwt_alice' },
        }),
        defaultEnv,
        {}
      );
      assert(res.status === 403, 'E11: Moderated/flagged media strictly blocked on retrieval (403)');
    }

    // -------------------------------------------------------------------------
    // CATEGORY F: Routing Priority & Proxy Bypass
    // -------------------------------------------------------------------------
    console.log('\n--- Category F: Routing Priority & Proxy Bypass ---');

    // F1: /api/media/upload intercepted by Worker even when BACKEND_URL configured
    {
      const formData = new FormData();
      formData.append('file', new File([VALID_PNG_BYTES], 'proxy_bypass.png', { type: 'image/png' }));
      formData.append('contextType', 'room');
      formData.append('contextId', 'general');

      const req = new Request('https://chatlustora.com/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt_alice' },
        body: formData,
      });
      const res = await worker.fetch(req, defaultEnv, {});
      const text = await res.text();
      assert(!text.includes('"proxied":true'), 'F1: /api/media/upload intercepted by Worker and NOT proxied to external backend');
      assert(res.status === 200, 'F1.1: Upload route handled natively by Worker');
    }

    // F2: /api/media/:id intercepted by Worker even when BACKEND_URL configured
    {
      const req = new Request(`https://chatlustora.com/api/media/${memberMediaId}`, {
        method: 'GET',
        headers: { 'Authorization': 'Bearer jwt_alice' },
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 200, 'F2: /api/media/:id intercepted by Worker and NOT proxied');
    }

    // F3: Unhandled /api/* route proxied to BACKEND_URL
    {
      const req = new Request('https://chatlustora.com/api/some/external/service', {
        method: 'GET',
      });
      const res = await worker.fetch(req, defaultEnv, {});
      const data: any = await res.json();
      assert(data.proxied === true, 'F3: Unhandled /api/* route correctly proxied to BACKEND_URL');
    }

    // -------------------------------------------------------------------------
    // CATEGORY G: Media Metadata Validation Endpoint
    // -------------------------------------------------------------------------
    console.log('\n--- Category G: Media Metadata Validation Endpoint ---');

    // G1: Valid metadata returns 200
    {
      const req = new Request('https://chatlustora.com/api/media/upload/validate', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer jwt_alice',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: 'valid.png',
          fileSize: 1024,
          mimeType: 'image/png',
          contextType: 'room',
          contextId: 'general',
        }),
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 200, 'G1: Valid pre-upload metadata validation returns HTTP 200');
    }

    // G2: Invalid contextType returns 400
    {
      const req = new Request('https://chatlustora.com/api/media/upload/validate', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer jwt_alice',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: 'valid.png',
          fileSize: 1024,
          mimeType: 'image/png',
          contextType: 'invalid_context',
        }),
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 400, 'G2: Invalid contextType in validate endpoint returns HTTP 400');
    }

    // G3: Conversation membership check applied in validate endpoint
    {
      const req = new Request('https://chatlustora.com/api/media/upload/validate', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer jwt_stranger',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: 'valid.png',
          fileSize: 1024,
          mimeType: 'image/png',
          contextType: 'conversation',
          contextId: conversationId,
        }),
      });
      const res = await worker.fetch(req, defaultEnv, {});
      assert(res.status === 403, 'G3: Non-participant caller denied with HTTP 403 in validate endpoint');
    }

    // -------------------------------------------------------------------------
    // CATEGORY H: R2 Failure/Rollback, Chat/GIF/DM Regressions & Rate Limiting
    // -------------------------------------------------------------------------
    console.log('\n--- Category H: Failure Rollback, Chat/GIF/DM Regressions & Rate Limit ---');

    // H1: Metadata DB persistence failure triggers R2 delete() rollback with ZERO orphans
    {
      const storeSizeBefore = mockR2.store.size;
      const dbSizeBefore = mockMediaUploads.size;
      failNextMetadataInsert = true;

      const formData = new FormData();
      formData.append('file', new File([VALID_PNG_BYTES], 'rollback_test.png', { type: 'image/png' }));
      formData.append('contextType', 'room');
      formData.append('contextId', 'general');

      const res = await worker.fetch(
        new Request('https://chatlustora.com/api/media/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer jwt_bob' },
          body: formData,
        }),
        defaultEnv,
        {}
      );
      assert(res.status === 502, 'H1: Metadata persistence failure returns HTTP 502');
      assert(mockR2.store.size === storeSizeBefore, 'H1.1: R2 object rolled back (zero orphaned objects)');
      assert(mockMediaUploads.size === dbSizeBefore, 'H1.2: No partial metadata row saved');
    }

    // H2: R2 put() write failure returns HTTP 502 and leaves no DB metadata
    {
      const dbSizeBefore = mockMediaUploads.size;
      mockR2.failNextPut = true;

      const formData = new FormData();
      formData.append('file', new File([VALID_PNG_BYTES], 'r2_fail.png', { type: 'image/png' }));
      formData.append('contextType', 'room');
      formData.append('contextId', 'general');

      const res = await worker.fetch(
        new Request('https://chatlustora.com/api/media/upload', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer jwt_bob' },
          body: formData,
        }),
        defaultEnv,
        {}
      );
      assert(res.status === 502, 'H2: R2 write failure returns HTTP 502');
      assert(mockMediaUploads.size === dbSizeBefore, 'H2.1: No orphaned DB metadata row on R2 write failure');
    }

    const nativeChatEnv = {
      ...defaultEnv,
      BACKEND_URL: undefined,
    };
    const nonBlockingCtx = { waitUntil: (_p: Promise<any>) => {} };

    // H3: Public chat text message regression + message history retrieval
    {
      const sendRes = await worker.fetch(
        new Request('https://chatlustora.com/api/chat/rooms/general/messages', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer jwt_alice',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            senderId: memberAliceId,
            senderType: 'registered',
            content: 'Hello from public room regression check',
            clientNonce: 'nonce_text_1',
          }),
        }),
        nativeChatEnv,
        nonBlockingCtx
      );
      assert(sendRes.status === 200, 'H3: Public room text message send succeeds (200)');
      const sendData: any = await sendRes.json();
      assert(sendData.message?.content === 'Hello from public room regression check', 'H3.1: Public text content preserved');
    }

    // H4: External GIF message regression (must keep working without R2 upload)
    {
      const gifUrl = 'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif';
      const gifRes = await worker.fetch(
        new Request('https://chatlustora.com/api/chat/rooms/general/messages', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer jwt_alice',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            senderId: memberAliceId,
            senderType: 'registered',
            content: '',
            mediaUrl: gifUrl,
            mediaType: 'gif',
            clientNonce: 'nonce_gif_1',
          }),
        }),
        nativeChatEnv,
        nonBlockingCtx
      );
      assert(gifRes.status === 200, 'H4: External GIF message in public chat succeeds (200)');

      const histRes = await worker.fetch(
        new Request('https://chatlustora.com/api/chat/rooms/general/messages?limit=20', {
          method: 'GET',
        }),
        nativeChatEnv,
        nonBlockingCtx
      );
      assert(histRes.status === 200, 'H4.1: Public room history GET returns 200');
      const histData: any = await histRes.json();
      const gifMsg = (histData.messages || []).find((m: any) => m.clientNonce === 'nonce_gif_1');
      assert(Boolean(gifMsg && gifMsg.mediaUrl === gifUrl && gifMsg.mediaType === 'gif'), 'H4.2: Public room history maps mediaUrl, mediaType, and clientNonce');
    }

    // H5: Private DM message with uploaded R2 media regression + unsafe URL rejection
    {
      const dmMediaUrl = `/api/media/${privateMediaId}`;
      const dmRes = await worker.fetch(
        new Request(`https://chatlustora.com/api/chat/conversations/${deterministicAliceCharlieConvId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer jwt_alice',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            senderId: memberAliceId,
            senderType: 'registered',
            recipientId: guestCharlieId,
            content: 'Private R2 image attachment',
            mediaUrl: dmMediaUrl,
            mediaType: 'image',
            clientNonce: 'nonce_dm_r2_1',
          }),
        }),
        nativeChatEnv,
        nonBlockingCtx
      );
      assert(dmRes.status === 200, 'H5: Private DM with uploaded R2 media succeeds (200)');
      const dmData: any = await dmRes.json();
      assert(dmData.message?.mediaUrl === dmMediaUrl, 'H5.1: Private DM returns /api/media/:id URL');

      const badUrlRes = await worker.fetch(
        new Request(`https://chatlustora.com/api/chat/conversations/${deterministicAliceCharlieConvId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer jwt_alice',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            senderId: memberAliceId,
            senderType: 'registered',
            recipientId: guestCharlieId,
            content: 'XSS check',
            mediaUrl: 'javascript:alert(1)',
            mediaType: 'image',
          }),
        }),
        nativeChatEnv,
        nonBlockingCtx
      );
      assert(badUrlRes.status === 400, 'H5.2: Unsafe javascript: mediaUrl rejected in DM endpoint (400)');
      assert(isSafeMediaUrl(dmMediaUrl) && !isSafeMediaUrl('javascript:alert(1)'), 'H5.3: Shared isSafeMediaUrl check aligns');
    }

    // H6: Provider docs check + Upload Rate Limit (HTTP 429 after 25 requests in window)
    {
      assert(
        EXTERNAL_PROVIDERS_DOCUMENTATION.contentStorage.name.includes('Cloudflare R2'),
        'H6.0: Provider docs reflect Cloudflare R2 storage'
      );

      let hit429 = false;
      let retryAfterHeader = '';
      for (let i = 0; i < 27; i++) {
        const fd = new FormData();
        fd.append('file', new File([VALID_PNG_BYTES], `rl_${i}.png`, { type: 'image/png' }));
        const rlRes = await worker.fetch(
          new Request('https://chatlustora.com/api/media/upload', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer jwt_ratelimit' },
            body: fd,
          }),
          defaultEnv,
          {}
        );
        if (rlRes.status === 429) {
          hit429 = true;
          retryAfterHeader = rlRes.headers.get('Retry-After') || '';
          break;
        }
      }
      assert(hit429, 'H6.1: Upload rate limit enforces HTTP 429 after 25 uploads within 60s');
      assert(Number(retryAfterHeader) >= 1, 'H6.2: Rate limit response includes valid Retry-After header');
    }

    // -------------------------------------------------------------------------
    // CATEGORY I: Production-Grade CORS Policy Enforcement
    // -------------------------------------------------------------------------
    console.log('\n--- Category I: Production-Grade CORS Policy Enforcement ---');

    // I1: Trusted production origin allowed with exact origin & Vary: Origin
    {
      const res = await worker.fetch(
        new Request('https://chatlustora.com/api/health', {
          method: 'GET',
          headers: { 'Origin': 'https://chatlustora.com' },
        }),
        nativeChatEnv,
        {}
      );
      assert(res.status === 200, 'I1: Trusted production origin succeeds on /api/health');
      assert(res.headers.get('Access-Control-Allow-Origin') === 'https://chatlustora.com', 'I1.1: Emits exact trusted origin (no *)');
      assert((res.headers.get('Vary') || '').includes('Origin'), 'I1.2: Includes Vary: Origin');
      assert(res.headers.get('Access-Control-Allow-Credentials') === null, 'I1.3: Does not enable Access-Control-Allow-Credentials');
    }

    // I2: Untrusted, subdomain, lookalike, HTTP-downgrade, and null origins rejected (never reflected or wildcarded)
    {
      const untrustedOrigins = [
        'https://evil.com',
        'https://evil.chatlustora.com',
        'https://chatlustora.com.evil.com',
        'https://notchatlustora.com',
        'http://chatlustora.com',
        'null',
        'https://chatlustora.com/',
      ];
      for (const badOrigin of untrustedOrigins) {
        const res = await worker.fetch(
          new Request('https://chatlustora.com/api/health', {
            method: 'GET',
            headers: { 'Origin': badOrigin },
          }),
          nativeChatEnv,
          {}
        );
        assert(res.headers.get('Access-Control-Allow-Origin') === null, `I2 (${badOrigin}): No Access-Control-Allow-Origin emitted`);
        assert((res.headers.get('Vary') || '').includes('Origin'), `I2a (${badOrigin}): Vary: Origin emitted`);
      }
    }

    // I3: OPTIONS preflight trusted (204) vs untrusted (403) vs disallowed method (405)
    {
      const okPreflight = await worker.fetch(
        new Request('https://chatlustora.com/api/media/upload', {
          method: 'OPTIONS',
          headers: {
            'Origin': 'https://chatlustora.com',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'Authorization, Content-Type, X-Guest-Token',
          },
        }),
        nativeChatEnv,
        {}
      );
      assert(okPreflight.status === 204, 'I3.1: Trusted OPTIONS preflight returns 204');
      assert(okPreflight.headers.get('Access-Control-Allow-Origin') === 'https://chatlustora.com', 'I3.2: Preflight returns exact origin');
      assert(okPreflight.headers.get('Access-Control-Allow-Methods') === 'GET, POST, OPTIONS', 'I3.3: Native route preflight restricts methods to GET, POST, OPTIONS');
      const allowHdrs = okPreflight.headers.get('Access-Control-Allow-Headers') || '';
      assert(
        allowHdrs.includes('Authorization') &&
        allowHdrs.includes('X-Guest-Token') &&
        allowHdrs.includes('X-Context-Type') &&
        allowHdrs.includes('X-Context-Id') &&
        allowHdrs.includes('X-File-Name'),
        'I3.4: Preflight allows verified upload/auth headers'
      );
      assert((okPreflight.headers.get('Vary') || '').includes('Origin'), 'I3.5: Preflight includes Vary: Origin');
      assert(okPreflight.headers.get('Access-Control-Allow-Credentials') === null, 'I3.6: Preflight omits Allow-Credentials');

      const badPreflight = await worker.fetch(
        new Request('https://chatlustora.com/api/media/upload', {
          method: 'OPTIONS',
          headers: {
            'Origin': 'https://evil.chatlustora.com',
            'Access-Control-Request-Method': 'POST',
          },
        }),
        nativeChatEnv,
        {}
      );
      assert(badPreflight.status === 403, 'I3.7: Untrusted OPTIONS preflight denied with 403');
      assert(badPreflight.headers.get('Access-Control-Allow-Origin') === null, 'I3.8: Denied preflight emits no ACAO');
      assert((badPreflight.headers.get('Vary') || '').includes('Origin'), 'I3.9: Denied preflight emits Vary: Origin');

      const missingOriginPreflight = await worker.fetch(
        new Request('https://chatlustora.com/api/media/upload', {
          method: 'OPTIONS',
          headers: { 'Access-Control-Request-Method': 'POST' },
        }),
        nativeChatEnv,
        {}
      );
      assert(missingOriginPreflight.status === 403, 'I3.10: Preflight without Origin header denied with 403');

      const disallowedMethodPreflight = await worker.fetch(
        new Request('https://chatlustora.com/api/media/upload', {
          method: 'OPTIONS',
          headers: {
            'Origin': 'https://chatlustora.com',
            'Access-Control-Request-Method': 'DELETE',
          },
        }),
        nativeChatEnv,
        {}
      );
      assert(disallowedMethodPreflight.status === 405, 'I3.11: Disallowed preflight method DELETE on native route returns 405');
      assert((disallowedMethodPreflight.headers.get('Vary') || '').includes('Origin'), 'I3.12: Disallowed preflight method emits Vary: Origin');
    }

    // I4: Localhost origins rejected in prod/staging, allowed ONLY in development
    {
      const prodLocalRes = await worker.fetch(
        new Request('https://chatlustora.com/api/health', {
          method: 'GET',
          headers: { 'Origin': 'http://localhost:3000' },
        }),
        nativeChatEnv,
        {}
      );
      assert(prodLocalRes.headers.get('Access-Control-Allow-Origin') === null, 'I4.1: http://localhost:3000 rejected in production');

      const stagingLocalRes = await worker.fetch(
        new Request('https://voxanex-staging.workers.dev/api/health', {
          method: 'GET',
          headers: { 'Origin': 'http://localhost:3000' },
        }),
        { ...nativeChatEnv, ENVIRONMENT: 'staging' },
        {}
      );
      assert(stagingLocalRes.headers.get('Access-Control-Allow-Origin') === null, 'I4.2: http://localhost:3000 rejected in staging');

      const devLocalRes = await worker.fetch(
        new Request('http://localhost:8787/api/health', {
          method: 'GET',
          headers: { 'Origin': 'http://localhost:3000' },
        }),
        { ...nativeChatEnv, ENVIRONMENT: 'development' },
        {}
      );
      assert(devLocalRes.headers.get('Access-Control-Allow-Origin') === 'http://localhost:3000', 'I4.3: http://localhost:3000 allowed in recognized dev mode');
    }

    // I5: Optional ALLOWED_ORIGINS env override rejects wildcards/HTTP in prod, allows exact HTTPS origins
    {
      const envWithOverride = {
        ...nativeChatEnv,
        ALLOWED_ORIGINS: 'https://staging.chatlustora.com, *, http://insecure.example.com, https://evil.com/path',
      };
      const allowedOverrideRes = await worker.fetch(
        new Request('https://staging.chatlustora.com/api/health', {
          method: 'GET',
          headers: { 'Origin': 'https://staging.chatlustora.com' },
        }),
        envWithOverride,
        {}
      );
      assert(allowedOverrideRes.headers.get('Access-Control-Allow-Origin') === 'https://staging.chatlustora.com', 'I5.1: Valid HTTPS ALLOWED_ORIGINS entry allowed');

      const rejectedHttpOverride = await worker.fetch(
        new Request('https://chatlustora.com/api/health', {
          method: 'GET',
          headers: { 'Origin': 'http://insecure.example.com' },
        }),
        envWithOverride,
        {}
      );
      assert(rejectedHttpOverride.headers.get('Access-Control-Allow-Origin') === null, 'I5.2: Non-HTTPS ALLOWED_ORIGINS entry ignored in prod');
    }

    // I6: Consistent CORS across R2 media download, SSE stream, proxied BACKEND_URL (stripping upstream *), and same-origin
    {
      const mediaCorsRes = await worker.fetch(
        new Request(`https://chatlustora.com/api/media/${memberMediaId}`, {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer jwt_alice',
            'Origin': 'https://chatlustora.com',
          },
        }),
        defaultEnv,
        {}
      );
      assert(mediaCorsRes.status === 200, 'I6.1: Media download succeeds for trusted origin');
      assert(mediaCorsRes.headers.get('Access-Control-Allow-Origin') === 'https://chatlustora.com', 'I6.2: Media download uses exact trusted origin');
      assert((mediaCorsRes.headers.get('Vary') || '').includes('Origin'), 'I6.3: Media download includes Vary: Origin');

      // SSE stream check
      const sseRes = await worker.fetch(
        new Request('https://chatlustora.com/api/chat/rooms/general/events', {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer jwt_alice',
            'Origin': 'https://chatlustora.com',
          },
        }),
        nativeChatEnv,
        {}
      );
      assert(sseRes.status === 200, 'I6.4: Room SSE stream connects with HTTP 200');
      assert(sseRes.headers.get('Access-Control-Allow-Origin') === 'https://chatlustora.com', 'I6.5: SSE stream emits exact trusted origin (no *)');
      assert((sseRes.headers.get('Vary') || '').includes('Origin'), 'I6.6: SSE stream emits Vary: Origin');
      assert((sseRes.headers.get('Content-Type') || '').includes('text/event-stream'), 'I6.7: SSE Content-Type preserved');
      if (sseRes.body) {
        const reader = sseRes.body.getReader();
        const firstChunk = await reader.read();
        const decodedChunk = new TextDecoder().decode(firstChunk.value || new Uint8Array());
        assert(decodedChunk.includes('event: connected'), 'I6.8: SSE stream emits connected event chunk cleanly');
        await reader.cancel();
      }

      // Proxied BACKEND_URL response must strip upstream '*' and 'Allow-Credentials: true'
      const proxyTrustedRes = await worker.fetch(
        new Request('https://chatlustora.com/api/some/external/service', {
          method: 'GET',
          headers: { 'Origin': 'https://chatlustora.com' },
        }),
        defaultEnv,
        {}
      );
      assert(proxyTrustedRes.status === 200, 'I6.9: Proxied response succeeds');
      assert(proxyTrustedRes.headers.get('Access-Control-Allow-Origin') === 'https://chatlustora.com', 'I6.10: Proxied response overrides upstream * with exact trusted origin');
      assert(proxyTrustedRes.headers.get('Access-Control-Allow-Credentials') === null, 'I6.11: Proxied response strips upstream Allow-Credentials');
      assert((proxyTrustedRes.headers.get('Vary') || '').includes('Origin'), 'I6.12: Proxied response emits Vary: Origin');

      const proxyUntrustedRes = await worker.fetch(
        new Request('https://chatlustora.com/api/some/external/service', {
          method: 'GET',
          headers: { 'Origin': 'https://evil.com' },
        }),
        defaultEnv,
        {}
      );
      assert(proxyUntrustedRes.headers.get('Access-Control-Allow-Origin') === null, 'I6.13: Proxied response strips upstream * and emits no ACAO for untrusted origin');

      const proxyNonNativePreflight = await worker.fetch(
        new Request('https://chatlustora.com/api/admin/rooms/123', {
          method: 'OPTIONS',
          headers: {
            'Origin': 'https://chatlustora.com',
            'Access-Control-Request-Method': 'DELETE',
          },
        }),
        defaultEnv,
        {}
      );
      assert(proxyNonNativePreflight.status === 204, 'I6.14: Proxied non-native route preflight permits DELETE when BACKEND_URL configured');

      // Same-origin / no-Origin request
      const sameOriginRes = await worker.fetch(
        new Request('https://chatlustora.com/api/health', { method: 'GET' }),
        nativeChatEnv,
        {}
      );
      assert(sameOriginRes.status === 200, 'I6.15: Request without Origin header succeeds cleanly');
      assert(sameOriginRes.headers.get('Access-Control-Allow-Origin') === null, 'I6.16: Request without Origin never emits Access-Control-Allow-Origin: *');
      assert((sameOriginRes.headers.get('Vary') || '').includes('Origin'), 'I6.17: Request without Origin emits Vary: Origin');
    }

    // -------------------------------------------------------------------------
    // CATEGORY J: Fail-Closed Media Moderation & Security/Regression Checks
    // -------------------------------------------------------------------------
    console.log('\n--- Category J: Fail-Closed Media Moderation & Regressions ---');

    // J1: R2 object exists, metadata record missing in Supabase -> fail closed 404
    {
      const orphanId = 'med_orphan_no_db_row';
      await mockR2.put(`media/objects/${orphanId}`, VALID_PNG_BYTES, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: {
          mediaId: orphanId,
          contextType: 'room',
          contextId: 'general',
          metadataVersion: '1.2',
        },
      });
      const res = await worker.fetch(
        new Request(`https://chatlustora.com/api/media/${orphanId}`, {
          method: 'GET',
          headers: { 'Authorization': 'Bearer jwt_alice' },
        }),
        defaultEnv,
        {}
      );
      assert(res.status === 404, 'J1: Media missing public.media_uploads metadata fails closed with HTTP 404');
      assert(res.headers.get('Cache-Control') === 'private, no-store', 'J1.1: Error response enforces Cache-Control: private, no-store');
      const bodyText = await res.text();
      assert(!bodyText.includes('media/objects/'), 'J1.2: Error response never leaks R2 object key');
    }

    // J2: DB HTTP 500 error during moderation lookup -> fail closed 502
    {
      simulateModerationHttpError = true;
      const res = await worker.fetch(
        new Request(`https://chatlustora.com/api/media/${memberMediaId}`, {
          method: 'GET',
          headers: { 'Authorization': 'Bearer jwt_alice' },
        }),
        defaultEnv,
        {}
      );
      assert(res.status === 502, 'J2: Moderation lookup DB HTTP 500 fails closed with HTTP 502');
      assert(res.headers.get('Cache-Control') === 'private, no-store', 'J2.1: DB error response enforces private, no-store');
    }

    // J3: DB network exception during moderation lookup -> fail closed 503
    {
      simulateModerationNetworkError = true;
      const res = await worker.fetch(
        new Request(`https://chatlustora.com/api/media/${memberMediaId}`, {
          method: 'GET',
          headers: { 'Authorization': 'Bearer jwt_alice' },
        }),
        defaultEnv,
        {}
      );
      assert(res.status === 503, 'J3: Moderation lookup network failure fails closed with HTTP 503');
      assert(res.headers.get('Cache-Control') === 'private, no-store', 'J3.1: Network failure response enforces private, no-store');
    }

    // J4: Non-boolean/ambiguous is_flagged value -> fail closed 502
    {
      simulateModerationMalformedRow = true;
      const res = await worker.fetch(
        new Request(`https://chatlustora.com/api/media/${memberMediaId}`, {
          method: 'GET',
          headers: { 'Authorization': 'Bearer jwt_alice' },
        }),
        defaultEnv,
        {}
      );
      assert(res.status === 502, 'J4: Malformed non-boolean is_flagged record fails closed with HTTP 502');
    }

    // J5: Missing Supabase credentials in production -> fail closed 503 on GET /api/media/:id
    {
      // Keep mockMembers token verification working? No, if SUPABASE_URL missing in prod, authenticateRequest fails closed 503 first;
      // verify specifically with guest token + missing SUPABASE_SERVICE_ROLE_KEY or missing SUPABASE_URL in prod:
      const prodMissingServiceKeyEnv = {
        CHAT_MEDIA: mockR2,
        GUEST_SESSION_SECRET: GUEST_SECRET,
        SUPABASE_URL,
        SUPABASE_ANON_KEY: 'anon_only',
        // SUPABASE_SERVICE_ROLE_KEY omitted in production
      };
      const res = await worker.fetch(
        new Request(`https://chatlustora.com/api/media/${memberMediaId}`, {
          method: 'GET',
          headers: { 'Authorization': 'Bearer jwt_alice' },
        }),
        prodMissingServiceKeyEnv,
        {}
      );
      assert(res.status === 503, 'J5: Missing SUPABASE_SERVICE_ROLE_KEY in production fails closed with HTTP 503 on media retrieval');
      assert(res.headers.get('Cache-Control') === 'private, no-store', 'J5.1: Production missing-DB error uses private, no-store');
    }

    // J6: Dev fallback isolation — dev still fails closed if DB creds ARE configured, only skips DB when unconfigured in dev
    {
      simulateModerationHttpError = true;
      const devWithDbRes = await worker.fetch(
        new Request(`https://chatlustora.com/api/media/${memberMediaId}`, {
          method: 'GET',
          headers: { 'Authorization': 'Bearer jwt_alice' },
        }),
        { ...defaultEnv, ENVIRONMENT: 'development' },
        {}
      );
      assert(devWithDbRes.status === 502, 'J6: Dev mode still fails closed on moderation DB failure when DB creds are configured');
    }

    // J7: Flagged media returns 403 with private no-store and no R2 key leakage
    {
      const res = await worker.fetch(
        new Request(`https://chatlustora.com/api/media/${guestMediaId}`, {
          method: 'GET',
          headers: { 'Authorization': 'Bearer jwt_alice' },
        }),
        defaultEnv,
        {}
      );
      assert(res.status === 403, 'J7: Flagged media returns 403');
      assert(res.headers.get('Cache-Control') === 'private, no-store', 'J7.1: Flagged media error enforces Cache-Control: private, no-store');
      assert(res.headers.get('X-Content-Type-Options') === 'nosniff', 'J7.2: Flagged media error emits X-Content-Type-Options: nosniff');
      const errJson = await res.text();
      assert(!errJson.includes('media/objects/'), 'J7.3: Flagged media error does not expose R2 key');
    }

    // J8: Admin & private DM regression checks with new CORS policy
    {
      const adminMeRes = await worker.fetch(
        new Request('https://chatlustora.com/api/admin/me', {
          method: 'GET',
          headers: { 'Origin': 'https://chatlustora.com' },
        }),
        nativeChatEnv,
        {}
      );
      assert(adminMeRes.status === 401, 'J8.1: Unauthenticated /api/admin/me still returns 401');
      assert(adminMeRes.headers.get('Access-Control-Allow-Origin') === 'https://chatlustora.com', 'J8.2: Admin route applies exact CORS policy');

      const dmParticipantMediaRes = await worker.fetch(
        new Request(`https://chatlustora.com/api/media/${privateMediaId}`, {
          method: 'GET',
          headers: { 'Authorization': 'Bearer jwt_alice', 'Origin': 'https://chatlustora.com' },
        }),
        defaultEnv,
        {}
      );
      assert(dmParticipantMediaRes.status === 200, 'J8.3: Authorized participant private DM media retrieval still succeeds');
      assert(dmParticipantMediaRes.headers.get('Cache-Control') === 'private, no-store', 'J8.4: Private DM media keeps Cache-Control: private, no-store');
      assert(dmParticipantMediaRes.headers.get('X-Content-Type-Options') === 'nosniff', 'J8.5: Private DM media keeps nosniff');
      assert(dmParticipantMediaRes.headers.get('Access-Control-Allow-Origin') === 'https://chatlustora.com', 'J8.6: Private DM media emits exact origin');
    }

    console.log('\n================================================================');
    console.log(` ALL ${passedCount} / ${testCount} R2 MEDIA & SECURITY TESTS PASSED SUCCESSFULLY!`);
    console.log('================================================================');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

runSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
  });
