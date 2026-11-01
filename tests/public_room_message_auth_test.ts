import worker from '../src/worker';

/**
 * VoxaNex Public Room Message Authentication & Identity Security Test
 * Verifies server-side authentication, identity derivation, and spoofing protection.
 */

let passedCount = 0;
let failedCount = 0;
let assertionCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  assertionCount++;
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}${detail ? ` (${detail})` : ''}`);
    failedCount++;
    process.exitCode = 1;
  } else {
    console.log(`✅ [PASSED] ${testName}`);
    passedCount++;
  }
}

const GUEST_SECRET = 'test-guest-secret-32-chars-long-!!';
const SUPABASE_URL = 'https://abc.supabase.co';
const SERVICE_KEY = 'service-role-key';
const ROOM_ID = '11111111-1111-1111-1111-111111111111';

const env = {
  GUEST_SESSION_SECRET: GUEST_SECRET,
  SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  ENVIRONMENT: 'development'
};

// Helper to create a guest token
async function createGuestToken(payload: any) {
  const encoder = new TextEncoder();
  const toBase64Url = (str: string) => btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const base64Payload = toBase64Url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey('raw', encoder.encode(GUEST_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(base64Payload));
  const sigHex = Array.from(new Uint8Array(sigBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `vx_gst_${base64Payload}.${sigHex}`;
}

async function computeHash(token: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function runTests() {
  console.log('🚀 Starting Public Room Message Auth & Identity Security Tests...');
  const originalFetch = globalThis.fetch;

  try {
    // Test 1: Valid registered user - identity derived from profile
    // ... (unchanged)
    {
      const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const jwt = 'valid-jwt';
      let persistenceCalled = false;
      
      globalThis.fetch = (async (url: any, init: any) => {
        const urlStr = url.toString();
        if (urlStr.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: userId }), { status: 200 });
        if (urlStr.includes('/rest/v1/profiles')) return new Response(JSON.stringify([{ nickname: 'RealNick', avatar_url: 'RealAvatar' }]), { status: 200 });
        if (urlStr.includes('/rest/v1/rooms')) return new Response(JSON.stringify([{ id: ROOM_ID }]), { status: 200 });
        if (urlStr.includes('/rest/v1/messages') && init.method === 'POST') {
          persistenceCalled = true;
          const body = JSON.parse(init.body);
          assert(body.sender_user_id === userId, 'T1: sender_user_id match');
          assert(body.sender_nickname === 'RealNick', 'T1: nickname derived from profile');
          assert(body.sender_avatar === 'RealAvatar', 'T1: avatar derived from profile');
          return new Response(null, { status: 201 });
        }
        return new Response('Not Found', { status: 404 });
      }) as any;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Hello World',
          senderId: userId,
          senderNickname: 'FakeNick',
          senderAvatar: 'FakeAvatar'
        })
      });

      const res = await worker.fetch(req, env, {});
      const data: any = await res.json();
      if (res.status !== 200) {
        console.log('T1 Failed Response:', res.status, data);
      }
      assert(res.status === 200, 'T1: Response 200');
      assert(data.success === true, 'T1: Success true');
      if (data && data.message) {
        assert(data.message.senderNickname === 'RealNick', 'T1: Nickname in response matches profile');
      } else {
        assert(false, 'T1: data.message is missing');
      }
      assert(persistenceCalled === true, 'T1: Persistence was called before success');
    }

    // Test 2: Registered user identity spoofing rejected
    {
      const realUserId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
      const spoofedUserId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
      globalThis.fetch = (async (url: any) => {
        if (url.toString().includes('/auth/v1/user')) return new Response(JSON.stringify({ id: realUserId }), { status: 200 });
        return new Response('Not Found', { status: 404 });
      }) as any;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer some-jwt', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello', senderId: spoofedUserId })
      });

      const res = await worker.fetch(req, env, {});
      const data: any = await res.json();
      assert(res.status === 403, 'T2: Spoofing rejected with 403');
      assert(data.error.includes('Sender identity mismatch'), 'T2: Error message check');
    }

    // Test 3: Valid guest success
    {
      const sessionId = '77777777-7777-7777-7777-777777777777';
      const guestToken = await createGuestToken({
        sid: sessionId,
        nick: 'GuestNick',
        av: 'GuestAvatar',
        exp: Date.now() + 10000,
        iat: Date.now()
      });
      const expectedHash = await computeHash(guestToken);
      
      globalThis.fetch = (async (url: any, init: any) => {
        const urlStr = url.toString();
        if (urlStr.includes('/rest/v1/guest_sessions')) return new Response(JSON.stringify([{
          id: sessionId,
          session_token_hash: expectedHash,
          is_revoked: false,
          expires_at: new Date(Date.now() + 10000).toISOString()
        }]), { status: 200 });
        if (urlStr.includes('/rest/v1/rooms')) return new Response(JSON.stringify([{ id: ROOM_ID }]), { status: 200 });
        if (urlStr.includes('/rest/v1/messages') && init.method === 'POST') {
          const body = JSON.parse(init.body);
          assert(body.sender_guest_id === sessionId, 'T3: sender_guest_id match');
          assert(body.sender_nickname === 'GuestNick', 'T3: nickname from token');
          return new Response(null, { status: 201 });
        }
        return new Response('Not Found', { status: 404 });
      }) as any;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${guestToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hi guest', senderId: sessionId, senderNickname: 'FakeGuest' })
      });

      const res = await worker.fetch(req, env, {});
      const data: any = await res.json();
      if (res.status !== 200) {
        console.log('T3 Failed Response:', res.status, data);
      }
      assert(res.status === 200, 'T3: Response 200');
      if (data && data.message) {
        assert(data.message.senderNickname === 'GuestNick', 'T3: Derived nickname match');
      } else {
        assert(false, 'T3: data.message missing');
      }
    }

    // Test 4: Guest identity spoofing rejected
    {
      const realGuestId = '11111111-1111-1111-1111-111111111111';
      const spoofedGuestId = '22222222-2222-2222-2222-222222222222';
      const guestToken = await createGuestToken({
        sid: realGuestId,
        nick: 'GuestNick',
        exp: Date.now() + 10000,
        iat: Date.now()
      });
      const expectedHash = await computeHash(guestToken);
      
      globalThis.fetch = (async (url: any) => {
        if (url.toString().includes('/rest/v1/guest_sessions')) return new Response(JSON.stringify([{
          id: realGuestId,
          session_token_hash: expectedHash,
          is_revoked: false,
          expires_at: new Date(Date.now() + 10000).toISOString()
        }]), { status: 200 });
        return new Response('Not Found', { status: 404 });
      }) as any;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${guestToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hi', senderId: spoofedGuestId })
      });

      const res = await worker.fetch(req, env, {});
      assert(res.status === 403, 'T4: Guest spoofing rejected');
    }

    // Test 5: Unauthenticated rejected
    {
      const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello' })
      });
      const res = await worker.fetch(req, env, {});
      assert(res.status === 401, 'T5: Unauthenticated rejected 401');
    }

    // Test 6: Persistence failure blocks broadcast
    {
      const userId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
      globalThis.fetch = (async (url: any) => {
        const urlStr = url.toString();
        if (urlStr.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: userId }));
        if (urlStr.includes('/rest/v1/profiles')) return new Response(JSON.stringify([{ nickname: 'N' }]));
        if (urlStr.includes('/rest/v1/rooms')) return new Response(JSON.stringify([{ id: ROOM_ID }]));
        if (urlStr.includes('/rest/v1/messages')) return new Response('DB Error', { status: 500 });
        return new Response('Not Found', { status: 404 });
      }) as any;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer some-jwt', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Persist?', senderId: userId })
      });

      const res = await worker.fetch(req, env, {});
      assert(res.status === 500, 'T6: Persistence failure 500');
      const data: any = await res.json();
      assert(data.error.includes('Database persistence failed'), 'T6: Correct error message');
    }

    console.log(`\n🎉 Test Summary: ${passedCount}/${assertionCount} assertions passed.`);
    if (failedCount > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('💥 Test Execution Error:', err);
    process.exit(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

runTests();
