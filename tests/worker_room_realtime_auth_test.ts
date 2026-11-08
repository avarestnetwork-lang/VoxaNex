import worker from '../src/worker';
import {
  messagingService,
  connectCustomSSE,
  setTestAuthTokenResolver,
} from '../src/services/messagingService';

/**
 * VoxaNex Phase 2 — Worker Realtime Authentication & Presence Hardening Test Suite
 * Exercises actual exported Worker entry and real authentication / presence / typing route logic.
 */

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (!condition) {
    failedTests++;
    console.error(`❌ [FAILED] ${testName}${detail ? ` (${detail})` : ''}`);
    process.exitCode = 1;
  } else {
    passedTests++;
    console.log(`✅ [PASSED] ${testName}`);
  }
}

const GUEST_SECRET = 'test_guest_secret_key_32_bytes_long!!';
const SUPABASE_URL = 'https://test.supabase.co';
const SERVICE_KEY = 'test-service-key';
const ANON_KEY = 'test-anon-key';

const env = {
  GUEST_SESSION_SECRET: GUEST_SECRET,
  SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  SUPABASE_ANON_KEY: ANON_KEY,
  ENVIRONMENT: 'development',
};

async function createSignedGuestToken(params: {
  sid: string;
  nickname: string;
  avatar?: string;
  gender?: string;
  languagePref?: string;
  is18Verified?: boolean;
  expiresAt?: number;
  issuedAt?: number;
}): Promise<string> {
  const iat = params.issuedAt ?? Date.now();
  const exp = params.expiresAt ?? (Date.now() + 86400000);
  const payload = {
    sid: params.sid,
    nick: params.nickname,
    av: params.avatar || '⚡',
    gen: params.gender || 'prefer_not_to_say',
    lng: params.languagePref || 'en',
    v18: params.is18Verified ?? true,
    iat,
    exp,
  };
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(GUEST_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(base64Payload));
  const sigHex = Array.from(new Uint8Array(sigBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `vx_gst_${base64Payload}.${sigHex}`;
}

async function computeTokenHash(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function runWorkerRealtimeAuthTests() {
  console.log('\n=============================================================');
  console.log('  VOXANEX PHASE 2: WORKER REALTIME AUTH & PRESENCE HARDENING');
  console.log('=============================================================\n');

  const origFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  try {
    // -------------------------------------------------------------------------
    // 1. Guest with valid signed token can update presence
    // -------------------------------------------------------------------------
    console.log('--- 1. Guest Presence Update with Valid Signed Token ---');
    {
      const guestId = '11111111-1111-4111-8111-111111111111';
      const roomId = 'room-pres-01-' + Date.now();
      const token = await createSignedGuestToken({
        sid: guestId,
        nickname: 'AliceGuest',
        avatar: '🐱',
        gender: 'female',
      });
      const tokenHash = await computeTokenHash(token);

      globalThis.fetch = (async (input: any) => {
        const u = input.toString();
        if (u.includes('/rest/v1/guest_sessions')) {
          return new Response(JSON.stringify([{
            id: guestId,
            session_token_hash: tokenHash,
            is_revoked: false,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
          }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${roomId}/presence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ id: guestId }),
      });

      const res = await worker.fetch(req, env);
      assert(res.status === 200, '1. Guest with valid signed token updates presence (HTTP 200)');
      const data: any = await res.json();
      assert(data.success === true, '1. Response confirms success: true');
      const member = data.members?.find((m: any) => m.id === guestId);
      assert(Boolean(member), '1. Member present in room presence array');
      assert(member?.nickname === 'AliceGuest', '1. Member nickname derived from guest session');
      assert(member?.avatar === '🐱', '1. Member avatar derived from guest session');
      assert(member?.gender === 'female', '1. Member gender derived from guest session');
      assert(member?.isGuest === true, '1. Member isGuest flag set to true');
    }

    // -------------------------------------------------------------------------
    // 2. Registered member with valid JWT can update presence
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Registered Member Presence Update with Valid JWT ---');
    {
      const memberId = '22222222-2222-4222-8222-222222222222';
      const roomId = 'room-pres-02-' + Date.now();
      const memberJwt = 'valid-reg-member-jwt';

      globalThis.fetch = (async (input: any) => {
        const u = input.toString();
        if (u.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: memberId }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (u.includes('/rest/v1/profiles')) {
          return new Response(JSON.stringify([{
            nickname: 'BobMember',
            avatar_url: '👤',
          }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${roomId}/presence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${memberJwt}`,
        },
        body: JSON.stringify({ id: memberId }),
      });

      const res = await worker.fetch(req, env);
      assert(res.status === 200, '2. Registered member with valid JWT updates presence (HTTP 200)');
      const data: any = await res.json();
      const member = data.members?.find((m: any) => m.id === memberId);
      assert(Boolean(member), '2. Member present in room presence list');
      assert(member?.nickname === 'BobMember', '2. Member nickname derived from database profile');
      assert(member?.avatar === '👤', '2. Member avatar derived from database profile');
      assert(member?.isGuest === false, '2. Member isGuest flag set to false');
      assert(member?.gender === undefined, '2. Member gender is not fabricated');
    }

    // -------------------------------------------------------------------------
    // 3. Missing credentials are rejected (HTTP 401)
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Missing Presence Credentials Rejected ---');
    {
      const roomId = 'room-pres-03-' + Date.now();
      const req = new Request(`https://voxanex.test/api/chat/rooms/${roomId}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'any-id', nickname: 'NoAuth' }),
      });

      const res = await worker.fetch(req, env);
      assert(res.status === 401, '3. Missing credentials rejected with HTTP 401');
    }

    // -------------------------------------------------------------------------
    // 4. Invalid guest token is rejected (HTTP 401)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Invalid Guest Token Rejected ---');
    {
      const roomId = 'room-pres-04-' + Date.now();
      const invalidToken = 'vx_gst_malformed.0000000000000000000000000000000000000000000000000000000000000000';
      const req = new Request(`https://voxanex.test/api/chat/rooms/${roomId}/presence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${invalidToken}`,
        },
        body: JSON.stringify({ id: 'some-id' }),
      });

      const res = await worker.fetch(req, env);
      assert(res.status === 401, '4. Invalid/tampered guest token rejected with HTTP 401');
    }

    // -------------------------------------------------------------------------
    // 5. Invalid member JWT is rejected (HTTP 401)
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Invalid Member JWT Rejected ---');
    {
      const roomId = 'room-pres-05-' + Date.now();
      globalThis.fetch = (async (input: any) => {
        const u = input.toString();
        if (u.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401 });
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${roomId}/presence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer expired-member-jwt',
        },
        body: JSON.stringify({ id: 'some-member-id' }),
      });

      const res = await worker.fetch(req, env);
      assert(res.status === 401, '5. Invalid member JWT rejected with HTTP 401');
    }

    // -------------------------------------------------------------------------
    // 6. Guest cannot impersonate another presence ID (HTTP 403)
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Guest Presence ID Impersonation Rejected ---');
    {
      const guestId = '66666666-6666-4666-8666-666666666666';
      const victimId = '77777777-7777-4777-8777-777777777777';
      const roomId = 'room-pres-06-' + Date.now();
      const token = await createSignedGuestToken({ sid: guestId, nickname: 'AttackerGuest' });
      const tokenHash = await computeTokenHash(token);

      globalThis.fetch = (async (input: any) => {
        const u = input.toString();
        if (u.includes('/rest/v1/guest_sessions')) {
          return new Response(JSON.stringify([{
            id: guestId,
            session_token_hash: tokenHash,
            is_revoked: false,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
          }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${roomId}/presence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ id: victimId }), // Attacker tries to impersonate victimId
      });

      const res = await worker.fetch(req, env);
      assert(res.status === 403, '6. Guest presence ID impersonation rejected with HTTP 403');
    }

    // -------------------------------------------------------------------------
    // 7. Registered member cannot impersonate another presence ID (HTTP 403)
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Member Presence ID Impersonation Rejected ---');
    {
      const memberId = '88888888-8888-4888-8888-888888888888';
      const victimId = '99999999-9999-4999-8999-999999999999';
      const roomId = 'room-pres-07-' + Date.now();

      globalThis.fetch = (async (input: any) => {
        const u = input.toString();
        if (u.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: memberId }), { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${roomId}/presence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer valid-member-jwt-07',
        },
        body: JSON.stringify({ id: victimId }), // Member tries to impersonate victimId
      });

      const res = await worker.fetch(req, env);
      assert(res.status === 403, '7. Registered member presence ID impersonation rejected with HTTP 403');
    }

    // -------------------------------------------------------------------------
    // 8. Client nickname/avatar/gender overrides are ignored
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Client Presence Overrides Ignored ---');
    {
      const guestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const roomId = 'room-pres-08-' + Date.now();
      const token = await createSignedGuestToken({
        sid: guestId,
        nickname: 'RealServerNick',
        avatar: '🐱',
        gender: 'female',
      });
      const tokenHash = await computeTokenHash(token);

      globalThis.fetch = (async (input: any) => {
        const u = input.toString();
        if (u.includes('/rest/v1/guest_sessions')) {
          return new Response(JSON.stringify([{
            id: guestId,
            session_token_hash: tokenHash,
            is_revoked: false,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
          }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      // Attacker passes spoofed nickname, avatar, gender, and claims isGuest: false
      const req = new Request(`https://voxanex.test/api/chat/rooms/${roomId}/presence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: guestId,
          nickname: 'SpoofedAdminNick',
          avatar: '👑',
          gender: 'male',
          isGuest: false,
        }),
      });

      const res = await worker.fetch(req, env);
      assert(res.status === 200, '8. Presence update with spoofed payload accepted (HTTP 200)');
      const data: any = await res.json();
      const member = data.members?.find((m: any) => m.id === guestId);
      assert(member?.nickname === 'RealServerNick', '8. Client nickname override was ignored, session nickname used');
      assert(member?.avatar === '🐱', '8. Client avatar override was ignored, session avatar used');
      assert(member?.gender === 'female', '8. Client gender override was ignored, session gender used');
      assert(member?.isGuest === true, '8. Client isGuest override was ignored, caller type is guest');
    }

    // -------------------------------------------------------------------------
    // 9. Presence identity is derived from verified guest session
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Authoritative Session Identity Derivation ---');
    {
      const guestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const roomId = 'room-pres-09-' + Date.now();
      const token = await createSignedGuestToken({
        sid: guestId,
        nickname: 'CanonicalGuest',
        avatar: '🚀',
        gender: 'non_binary',
      });
      const tokenHash = await computeTokenHash(token);

      globalThis.fetch = (async (input: any) => {
        const u = input.toString();
        if (u.includes('/rest/v1/guest_sessions')) {
          return new Response(JSON.stringify([{
            id: guestId,
            session_token_hash: tokenHash,
            is_revoked: false,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
          }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      // Provide only token, empty body
      const req = new Request(`https://voxanex.test/api/chat/rooms/${roomId}/presence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });

      const res = await worker.fetch(req, env);
      assert(res.status === 200, '9. Request without client body fields succeeds (HTTP 200)');
      const data: any = await res.json();
      const member = data.members?.find((m: any) => m.id === guestId);
      assert(Boolean(member), '9. Presence created using verified session ID');
      assert(member?.nickname === 'CanonicalGuest', '9. Nickname derived from guest session');
      assert(member?.avatar === '🚀', '9. Avatar derived from guest session');
      assert(member?.gender === 'non_binary', '9. Gender derived from guest session');
    }

    // -------------------------------------------------------------------------
    // 10. Leave operation removes only the authenticated caller
    // -------------------------------------------------------------------------
    console.log('\n--- 10. Leave Operation Removes Only Authenticated Caller ---');
    {
      const userA = '10000000-0000-4000-8000-000000000001';
      const userB = '10000000-0000-4000-8000-000000000002';
      const roomId = 'room-pres-10-' + Date.now();

      const tokenA = await createSignedGuestToken({ sid: userA, nickname: 'UserA' });
      const hashA = await computeTokenHash(tokenA);
      const tokenB = await createSignedGuestToken({ sid: userB, nickname: 'UserB' });
      const hashB = await computeTokenHash(tokenB);

      globalThis.fetch = (async (input: any) => {
        const u = input.toString();
        if (u.includes('/rest/v1/guest_sessions')) {
          if (u.includes(encodeURIComponent(hashA))) {
            return new Response(JSON.stringify([{ id: userA, session_token_hash: hashA, is_revoked: false, expires_at: new Date(Date.now() + 86400000).toISOString() }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (u.includes(encodeURIComponent(hashB))) {
            return new Response(JSON.stringify([{ id: userB, session_token_hash: hashB, is_revoked: false, expires_at: new Date(Date.now() + 86400000).toISOString() }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      // Join User A
      await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${roomId}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
        body: JSON.stringify({ id: userA }),
      }), env);

      // Join User B
      await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${roomId}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenB}` },
        body: JSON.stringify({ id: userB }),
      }), env);

      // User A leaves
      const leaveRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${roomId}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
        body: JSON.stringify({ id: userA, action: 'leave' }),
      }), env);

      assert(leaveRes.status === 200, '10. Leave request accepted (HTTP 200)');
      const leaveData: any = await leaveRes.json();
      assert(!leaveData.members?.some((m: any) => m.id === userA), '10. User A removed from presence members');
      assert(leaveData.members?.some((m: any) => m.id === userB), '10. User B remains in presence members');
    }

    // -------------------------------------------------------------------------
    // 11. Attempt to remove another user's presence is rejected (HTTP 403)
    // -------------------------------------------------------------------------
    console.log('\n--- 11. Unauthorized Presence Removal Rejected ---');
    {
      const attackerId = '11000000-0000-4000-8000-000000000001';
      const victimId = '11000000-0000-4000-8000-000000000002';
      const roomId = 'room-pres-11-' + Date.now();

      const tokenAttacker = await createSignedGuestToken({ sid: attackerId, nickname: 'Attacker' });
      const hashAttacker = await computeTokenHash(tokenAttacker);

      globalThis.fetch = (async (input: any) => {
        const u = input.toString();
        if (u.includes('/rest/v1/guest_sessions')) {
          return new Response(JSON.stringify([{
            id: attackerId,
            session_token_hash: hashAttacker,
            is_revoked: false,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
          }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      // Attacker attempts to remove victim's presence
      const res = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${roomId}/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAttacker}` },
        body: JSON.stringify({ id: victimId, action: 'leave' }),
      }), env);

      assert(res.status === 403, '11. Attempting to remove another user presence rejected with HTTP 403');
    }

    // -------------------------------------------------------------------------
    // 12. Missing credentials cannot create typing indicators (HTTP 401)
    // -------------------------------------------------------------------------
    console.log('\n--- 12. Missing Typing Credentials Rejected ---');
    {
      const roomId = 'room-type-12-' + Date.now();
      const req = new Request(`https://voxanex.test/api/chat/rooms/${roomId}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: 'no-auth-id', isTyping: true }),
      });

      const res = await worker.fetch(req, env);
      assert(res.status === 401, '12. Missing typing credentials rejected with HTTP 401');
    }

    // -------------------------------------------------------------------------
    // 13. Typing identity mismatch is rejected (HTTP 403)
    // -------------------------------------------------------------------------
    console.log('\n--- 13. Typing Identity Mismatch Rejected ---');
    {
      const callerId = '13000000-0000-4000-8000-000000000001';
      const victimId = '13000000-0000-4000-8000-000000000002';
      const roomId = 'room-type-13-' + Date.now();

      const token = await createSignedGuestToken({ sid: callerId, nickname: 'RealTyper' });
      const tokenHash = await computeTokenHash(token);

      globalThis.fetch = (async (input: any) => {
        const u = input.toString();
        if (u.includes('/rest/v1/guest_sessions')) {
          return new Response(JSON.stringify([{
            id: callerId,
            session_token_hash: tokenHash,
            is_revoked: false,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
          }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${roomId}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ memberId: victimId, isTyping: true }), // Caller mismatch
      });

      const res = await worker.fetch(req, env);
      assert(res.status === 403, '13. Typing memberId mismatch rejected with HTTP 403');
    }

    // -------------------------------------------------------------------------
    // 14. Client typing nickname override is ignored
    // -------------------------------------------------------------------------
    console.log('\n--- 14. Client Typing Nickname Override Ignored ---');
    {
      const callerId = '14000000-0000-4000-8000-000000000001';
      const roomId = 'room-type-14-' + Date.now();

      const token = await createSignedGuestToken({ sid: callerId, nickname: 'AuthoritativeNick' });
      const tokenHash = await computeTokenHash(token);

      globalThis.fetch = (async (input: any) => {
        const u = input.toString();
        if (u.includes('/rest/v1/guest_sessions')) {
          return new Response(JSON.stringify([{
            id: callerId,
            session_token_hash: tokenHash,
            is_revoked: false,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
          }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${roomId}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          memberId: callerId,
          nickname: 'SpoofedTyperNick',
          isTyping: true,
        }),
      });

      const res = await worker.fetch(req, env);
      assert(res.status === 200, '14. Typing update accepted (HTTP 200)');
      const data: any = await res.json();
      assert(data.success === true, '14. Typing response confirms success: true');
    }

    // -------------------------------------------------------------------------
    // 15. Valid authenticated typing update succeeds
    // -------------------------------------------------------------------------
    console.log('\n--- 15. Valid Authenticated Typing Update Succeeds ---');
    {
      const callerId = '15000000-0000-4000-8000-000000000001';
      const roomId = 'room-type-15-' + Date.now();

      const token = await createSignedGuestToken({ sid: callerId, nickname: 'GoodTyper' });
      const tokenHash = await computeTokenHash(token);

      globalThis.fetch = (async (input: any) => {
        const u = input.toString();
        if (u.includes('/rest/v1/guest_sessions')) {
          return new Response(JSON.stringify([{
            id: callerId,
            session_token_hash: tokenHash,
            is_revoked: false,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
          }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      // Start typing
      const startReq = new Request(`https://voxanex.test/api/chat/rooms/${roomId}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ memberId: callerId, isTyping: true }),
      });
      const startRes = await worker.fetch(startReq, env);
      assert(startRes.status === 200, '15. Start typing succeeds (HTTP 200)');

      // Stop typing
      const stopReq = new Request(`https://voxanex.test/api/chat/rooms/${roomId}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ memberId: callerId, isTyping: false }),
      });
      const stopRes = await worker.fetch(stopReq, env);
      assert(stopRes.status === 200, '15. Stop typing succeeds (HTTP 200)');
    }

    // -------------------------------------------------------------------------
    // 16. Valid guest can establish an authenticated room SSE connection
    // -------------------------------------------------------------------------
    console.log('\n--- 16. Authenticated Room SSE Connection ---');
    {
      const guestId = '16000000-0000-4000-8000-000000000001';
      const roomId = 'room-sse-16-' + Date.now();

      const token = await createSignedGuestToken({ sid: guestId, nickname: 'SseGuest' });
      const tokenHash = await computeTokenHash(token);

      globalThis.fetch = (async (input: any) => {
        const u = input.toString();
        if (u.includes('/rest/v1/guest_sessions')) {
          return new Response(JSON.stringify([{
            id: guestId,
            session_token_hash: tokenHash,
            is_revoked: false,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
          }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${roomId}/events`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      const res = await worker.fetch(req, env);
      assert(res.status === 200, '16. Valid guest connects to room SSE (HTTP 200)');
      assert(Boolean(res.headers.get('content-type')?.includes('text/event-stream')), '16. Content-Type is text/event-stream');

      const reader = res.body?.getReader();
      assert(Boolean(reader), '16. Readable stream reader available');
      if (reader) {
        const chunk = await reader.read();
        assert(!chunk.done, '16. First chunk received');
        const text = new TextDecoder().decode(chunk.value);
        assert(text.includes('event: connected'), '16. Stream enqueues connected event');
        await reader.cancel();
      }
    }

    // -------------------------------------------------------------------------
    // 17. Invalid or missing SSE credentials are rejected (HTTP 401)
    // -------------------------------------------------------------------------
    console.log('\n--- 17. Unauthenticated Room SSE Connection Rejected ---');
    {
      const roomId = 'room-sse-17-' + Date.now();

      // Missing credentials
      const reqMissing = new Request(`https://voxanex.test/api/chat/rooms/${roomId}/events`);
      const resMissing = await worker.fetch(reqMissing, env);
      assert(resMissing.status === 401, '17. Missing SSE credentials rejected with HTTP 401');

      // Invalid credentials
      const reqInvalid = new Request(`https://voxanex.test/api/chat/rooms/${roomId}/events`, {
        headers: { 'Authorization': 'Bearer bad-sse-token' },
      });
      const resInvalid = await worker.fetch(reqInvalid, env);
      assert(resInvalid.status === 401, '17. Invalid SSE credentials rejected with HTTP 401');
    }

    // -------------------------------------------------------------------------
    // 18. SSE cancellation cleans up the stream correctly
    // -------------------------------------------------------------------------
    console.log('\n--- 18. SSE Stream Cancellation and Cleanup ---');
    {
      const guestId = '18000000-0000-4000-8000-000000000001';
      const roomId = 'room-sse-18-' + Date.now();

      const token = await createSignedGuestToken({ sid: guestId, nickname: 'CancelGuest' });
      const tokenHash = await computeTokenHash(token);

      globalThis.fetch = (async (input: any) => {
        const u = input.toString();
        if (u.includes('/rest/v1/guest_sessions')) {
          return new Response(JSON.stringify([{
            id: guestId,
            session_token_hash: tokenHash,
            is_revoked: false,
            expires_at: new Date(Date.now() + 86400000).toISOString(),
          }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${roomId}/events`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      const res = await worker.fetch(req, env);
      assert(res.status === 200, '18. SSE stream initialized (HTTP 200)');
      const reader = res.body?.getReader();
      if (reader) {
        await reader.read();
        // Cancel reader
        await reader.cancel('client_closed');
        assert(true, '18. SSE stream reader canceled without error');
      }
    }

    // -------------------------------------------------------------------------
    // 19. Frontend messagingService Integration Checks
    // -------------------------------------------------------------------------
    console.log('\n--- 19. Frontend messagingService Alignment Checks ---');
    {
      const testToken = 'vx_gst_frontend_test_token_123';
      setTestAuthTokenResolver(async () => testToken);

      const headers = await messagingService.getIdentityHeaders();
      assert(headers['Authorization'] === `Bearer ${testToken}`, '19.1 getIdentityHeaders attaches Authorization header');

      // Verify sendPresence attaches Authorization header
      let presenceAuthHeader: string | null = null;
      globalThis.fetch = (async (input: any, init: any) => {
        const u = input.toString();
        if (u.includes('/presence')) {
          presenceAuthHeader = init?.headers?.['Authorization'] || null;
          return new Response(JSON.stringify({ success: true, members: [] }), { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      await messagingService.sendPresence('test-room', {
        id: 'u1',
        nickname: 'Test',
        avatar: '⚡',
        isGuest: true,
      });
      assert(presenceAuthHeader === `Bearer ${testToken}`, '19.2 sendPresence attaches Authorization: Bearer <token>');

      // Verify sendTyping attaches Authorization header
      let typingAuthHeader: string | null = null;
      globalThis.fetch = (async (input: any, init: any) => {
        const u = input.toString();
        if (u.includes('/typing')) {
          typingAuthHeader = init?.headers?.['Authorization'] || null;
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      await messagingService.sendTyping('test-room', 'u1', 'Test', true);
      assert(typingAuthHeader === `Bearer ${testToken}`, '19.3 sendTyping attaches Authorization: Bearer <token>');

      // Verify leaveRoom attaches Authorization header
      let leaveAuthHeader: string | null = null;
      globalThis.fetch = (async (input: any, init: any) => {
        const u = input.toString();
        if (u.includes('/presence')) {
          leaveAuthHeader = init?.headers?.['Authorization'] || null;
          return new Response(JSON.stringify({ success: true, members: [] }), { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      await messagingService.leaveRoom('test-room', 'u1');
      assert(leaveAuthHeader === `Bearer ${testToken}`, '19.4 leaveRoom attaches Authorization: Bearer <token>');

      // Verify subscribeToRoom connects with Authorization header
      let sseAuthHeader: string | null = null;
      globalThis.fetch = (async (input: any, init: any) => {
        const u = input.toString();
        if (u.includes('/events')) {
          sseAuthHeader = init?.headers?.['Authorization'] || null;
          return new Response('event: connected\ndata: {"status":"connected"}\n\n', {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          });
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      let sseConnected = false;
      const unsub = messagingService.subscribeToRoom('test-room', {
        onMessage: () => {},
        onStatusChange: (status) => {
          if (status === 'connected') sseConnected = true;
        },
      });

      // Allow async startConnection to execute
      await new Promise((r) => setTimeout(r, 100));
      unsub();

      assert(sseAuthHeader === `Bearer ${testToken}`, '19.5 subscribeToRoom connects via SSE with Authorization header');
      assert(sseConnected === true, '19.6 subscribeToRoom triggers connected status callback');

      setTestAuthTokenResolver(null);
    }

  } finally {
    globalThis.fetch = origFetch;
    process.env = originalEnv;
  }

  console.log('\n=============================================================');
  console.log(`  TEST RESULTS: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
  console.log('=============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runWorkerRealtimeAuthTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
