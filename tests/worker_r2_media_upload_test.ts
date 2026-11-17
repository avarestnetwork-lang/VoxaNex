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

  async put(key: string, value: any, options?: any) {
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

  async delete(key: string) {
    this.store.delete(key);
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

const VALID_MP3_BYTES = new Uint8Array([
  0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20,
  0x54, 0x49, 0x54, 0x32, 0x00, 0x00, 0x00, 0x0c, 0x00, 0x00,
  0x03, 0x54, 0x65, 0x73, 0x74, 0x20, 0x54, 0x72, 0x61, 0x63, 0x6b
]);

const EXECUTABLE_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
const HTML_SCRIPT_BYTES = new TextEncoder().encode('<html><script>alert(1)</script></html>');

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

  // Populate initial state
  const memberAliceId = '11111111-1111-4111-8111-111111111111';
  const memberBobId = '22222222-2222-4222-8222-222222222222';
  const guestCharlieId = '33333333-3333-4333-8333-333333333333';
  const guestDaveId = '44444444-4444-4444-8444-444444444444';
  const nonParticipantId = '99999999-9999-4999-8999-999999999999';

  mockMembers.set('jwt_alice', { id: memberAliceId, email: 'alice@chatlustora.com' });
  mockMembers.set('jwt_bob', { id: memberBobId, email: 'bob@chatlustora.com' });
  mockMembers.set('jwt_stranger', { id: nonParticipantId, email: 'stranger@chatlustora.com' });

  // Conversation with Alice (member) and Charlie (guest)
  const conversationId = '55555555-5555-4555-8555-555555555555';
  mockConversations.set(conversationId, [
    { user_id: memberAliceId, guest_id: null },
    { user_id: null, guest_id: guestCharlieId },
  ]);

  // Intercept globalThis.fetch for Supabase API calls and Backend Proxy
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    // Backend proxy interceptor
    if (urlStr.startsWith(BACKEND_URL)) {
      const url = new URL(urlStr);
      return new Response(JSON.stringify({ proxied: true, path: url.pathname }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Supabase member auth: /auth/v1/user
    if (urlStr.startsWith(`${SUPABASE_URL}/auth/v1/user`)) {
      const authHeader = (init?.headers as any)?.['Authorization'] || (init?.headers as any)?.['authorization'] || '';
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

    // A5: Valid member upload accepted (200)
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

    // D6: Missing CHAT_MEDIA R2 binding rejected with 503
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
      assert(res.status === 503, 'D6: Missing CHAT_MEDIA R2 binding rejected with HTTP 503');
    }

    // D7: Valid MP3 audio clip accepted and assigned audio/mpeg MIME
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

    // E5: Exact object key lookup verified
    {
      const rawStored = await mockR2.get(`media/objects/${memberMediaId}`);
      assert(rawStored !== null, 'E5: Exact key lookup in media/objects/${id} confirmed in R2 store');
      assert(rawStored?.customMetadata?.mediaId === memberMediaId, 'E5.1: Custom metadata correctly stored');
      assert(rawStored?.customMetadata?.metadataVersion === '1.2', 'E5.2: Metadata version 1.2 persisted');
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

    console.log('\n================================================================');
    console.log(` ALL ${passedCount} / ${testCount} PHASE 1.1 INTEGRATION TESTS PASSED SUCCESSFULLY!`);
    console.log('================================================================');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

runSuite().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
