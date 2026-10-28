/**
 * ChatLustora / VoxaNex — Worker Conversation History Security & Reload Test Suite
 *
 * Verifies:
 * 1. Authorized guest history access with valid guestToken -> 200 OK with messages.
 * 2. Authorized member history access with valid Bearer token -> 200 OK with messages.
 * 3. Unauthorized participant rejection (caller is not in conversation) -> 403 Forbidden.
 * 4. Invalid guest token rejection -> 401 Unauthorized.
 * 5. Invalid member token rejection -> 401 Unauthorized.
 * 6. Missing authentication credentials (even with userId query param) -> 401 Unauthorized.
 * 7. Client-supplied participant ID mismatch (caller token != ?userId) -> 403 Forbidden.
 * 8. Empty conversation history access for authorized participant -> 200 OK with empty array.
 * 9. Supabase service-role key usage: History retrieval MUST use supabaseServiceKey (never anonKey)
 *    and ONLY after validating caller identity and conversation membership.
 */

import worker from '../src/worker';
import { createGuestSession } from '../src/server/guestSessionManager';

function assert(condition: boolean, testName: string, detail?: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
    throw new Error(`Assertion failed: ${testName} - ${detail || ''}`);
  } else {
    console.log(`✅ [PASSED] ${testName}`);
  }
}

// Helper to encode Base64Url for mock JWTs
function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return Buffer.from(binary, 'binary').toString('base64url');
}

function createMockJwt(userId: string): string {
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = toBase64Url(JSON.stringify({
    sub: userId,
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const signature = 'mock_valid_signature_for_testing_purposes_only_1234567890abcdef';
  return `${header}.${payload}.${signature}`;
}

async function runWorkerHistoryTests() {
  console.log('\n=============================================================');
  console.log('  CHATLUSTORA — WORKER CONVERSATION HISTORY & SECURITY TESTS');
  console.log('=============================================================\n');

  // Test setup
  const mockServiceKey = 'sb_secret_service_role_key_staging_test_2026';
  const mockAnonKey = 'sb_public_anon_key_staging_test_2026';
  const mockSupabaseUrl = 'https://iccxxsuincnqwbfyypho.supabase.co';
  const guestSecret = process.env.GUEST_SESSION_SECRET || 'voxanex_default_secure_entropy_salt_2026';

  const guestA = createGuestSession({ nickname: 'GuestAlice', avatar: '⚡', languagePref: 'en', is18Verified: false, ipAddress: '127.0.0.1' });
  const guestB = createGuestSession({ nickname: 'GuestBob', avatar: '🌸', languagePref: 'en', is18Verified: false, ipAddress: '127.0.0.2' });
  const guestC = createGuestSession({ nickname: 'GuestCharlie', avatar: '🛡️', languagePref: 'en', is18Verified: false, ipAddress: '127.0.0.3' });

  const idA = guestA.session!.id;
  const idB = guestB.session!.id;
  const idC = guestC.session!.id;
  const tokenA = guestA.session!.token;
  const tokenB = guestB.session!.token;
  const tokenC = guestC.session!.token;

  const regMember1Id = '44444444-4444-4444-4444-444444444444';
  const regMember2Id = '55555555-5555-5555-5555-555555555555';
  const regMemberJwt1 = createMockJwt(regMember1Id);
  const regMemberJwt2 = createMockJwt(regMember2Id);

  const convGuestId = `conv_${[idA, idB].sort().join('_')}`;
  const convRegId = `conv_${[regMember1Id, regMember2Id].sort().join('_')}`;

  // Track Supabase fetch calls to verify service key usage
  const interceptedCalls: Array<{ url: string; headers: Record<string, string>; method: string }> = [];
  const storedMessages: any[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const headers = (init?.headers || {}) as Record<string, string>;
    const method = init?.method || 'GET';

    interceptedCalls.push({ url: urlStr, headers, method });

    // Mock Supabase REST calls
    if (urlStr.includes('/rest/v1/messages')) {
      if (method === 'GET') {
        // Return stored messages matching the query
        return new Response(JSON.stringify(storedMessages), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'POST') {
        const body = JSON.parse(init?.body as string || '{}');
        storedMessages.push({
          id: body.id || 'msg_' + Date.now(),
          conversation_id: body.conversation_id,
          sender_guest_id: body.sender_guest_id || null,
          sender_user_id: body.sender_user_id || null,
          sender_nickname: body.sender_nickname,
          sender_avatar: body.sender_avatar,
          content: body.content,
          created_at: new Date().toISOString(),
        });
        return new Response(JSON.stringify({ success: true }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (urlStr.includes('/rest/v1/conversations')) {
      return new Response(JSON.stringify({ success: true }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (urlStr.includes('/auth/v1/user')) {
      const authHeader = headers['Authorization'] || headers['authorization'];
      if (authHeader && authHeader.includes(regMemberJwt1)) {
        return new Response(JSON.stringify({ id: regMember1Id, email: 'member1@example.com' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (authHeader && authHeader.includes(regMemberJwt2)) {
        return new Response(JSON.stringify({ id: regMember2Id, email: 'member2@example.com' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'invalid_token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };

  const env = {
    SUPABASE_URL: mockSupabaseUrl,
    SUPABASE_ANON_KEY: mockAnonKey,
    SUPABASE_SERVICE_ROLE_KEY: mockServiceKey,
    GUEST_SESSION_SECRET: guestSecret,
    ENVIRONMENT: 'development',
    DEV: true,
  };

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Missing authentication credentials -> 401 Unauthorized
    // -------------------------------------------------------------------------
    console.log('--- Test 1: Missing credentials ---');
    const reqNoAuth = new Request(`https://worker.test/api/chat/conversations/${convGuestId}/messages?userId=${idA}`, {
      method: 'GET',
    });
    const resNoAuth = await worker.fetch(reqNoAuth, env, {} as any);
    assert(resNoAuth.status === 401, '1.1 Missing credentials rejected with 401 Unauthorized');
    const dataNoAuth = await resNoAuth.json();
    assert(dataNoAuth.success === false, '1.2 Response JSON success is false');

    // -------------------------------------------------------------------------
    // TEST 2: Invalid guest token -> 401 Unauthorized
    // -------------------------------------------------------------------------
    console.log('\n--- Test 2: Invalid guest token ---');
    const reqInvalidGuest = new Request(`https://worker.test/api/chat/conversations/${convGuestId}/messages?userId=${idA}&guestToken=vx_gst_invalid.signature`, {
      method: 'GET',
    });
    const resInvalidGuest = await worker.fetch(reqInvalidGuest, env, {} as any);
    assert(resInvalidGuest.status === 401, '2.1 Invalid guest token rejected with 401 Unauthorized');

    // -------------------------------------------------------------------------
    // TEST 3: Invalid member bearer token -> 401 Unauthorized
    // -------------------------------------------------------------------------
    console.log('\n--- Test 3: Invalid member bearer token ---');
    const reqInvalidMember = new Request(`https://worker.test/api/chat/conversations/${convRegId}/messages`, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer invalid_garbage_token_not_a_jwt',
      },
    });
    const resInvalidMember = await worker.fetch(reqInvalidMember, env, {} as any);
    assert(resInvalidMember.status === 401, '3.1 Invalid member bearer token rejected with 401 Unauthorized');

    // -------------------------------------------------------------------------
    // TEST 4: Client-supplied user ID mismatch -> 403 Forbidden
    // -------------------------------------------------------------------------
    console.log('\n--- Test 4: Client userId mismatch ---');
    const reqMismatch = new Request(`https://worker.test/api/chat/conversations/${convGuestId}/messages?userId=${idB}&guestToken=${tokenA}`, {
      method: 'GET',
    });
    const resMismatch = await worker.fetch(reqMismatch, env, {} as any);
    assert(resMismatch.status === 403, '4.1 Token identity mismatch with query param rejected with 403 Forbidden');

    // -------------------------------------------------------------------------
    // TEST 5: Unauthorized participant (Charlie trying to access Alice-Bob conversation) -> 403 Forbidden
    // -------------------------------------------------------------------------
    console.log('\n--- Test 5: Unauthorized participant ---');
    const reqUnauthorized = new Request(`https://worker.test/api/chat/conversations/${convGuestId}/messages?guestToken=${tokenC}`, {
      method: 'GET',
    });
    const resUnauthorized = await worker.fetch(reqUnauthorized, env, {} as any);
    assert(resUnauthorized.status === 403, '5.1 Valid non-member token rejected with 403 Forbidden');

    // -------------------------------------------------------------------------
    // TEST 6: Empty history access for authorized participant -> 200 OK with []
    // -------------------------------------------------------------------------
    console.log('\n--- Test 6: Empty history access ---');
    interceptedCalls.length = 0;
    const reqEmptyHistory = new Request(`https://worker.test/api/chat/conversations/${convGuestId}/messages?guestToken=${tokenA}`, {
      method: 'GET',
    });
    const resEmptyHistory = await worker.fetch(reqEmptyHistory, env, {} as any);
    assert(resEmptyHistory.status === 200, '6.1 Authorized empty history access returns 200 OK');
    const dataEmptyHistory = await resEmptyHistory.json();
    assert(dataEmptyHistory.success === true, '6.2 Success is true');
    assert(Array.isArray(dataEmptyHistory.messages) && dataEmptyHistory.messages.length === 0, '6.3 Messages is empty array');

    // -------------------------------------------------------------------------
    // TEST 7: Post a message and retrieve history as authorized Guest -> 200 OK
    // -------------------------------------------------------------------------
    console.log('\n--- Test 7: Authorized guest history access ---');
    // Post message from Alice to Bob
    const postReq = new Request(`https://worker.test/api/chat/conversations/${convGuestId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderId: idA,
        senderNickname: 'GuestAlice',
        senderAvatar: '⚡',
        recipientId: idB,
        content: 'Hello Bob! This is a test message for history reload.',
        clientNonce: `nonce_${Date.now()}`,
        guestToken: tokenA,
      }),
    });
    const postRes = await worker.fetch(postReq, env, {} as any);
    assert(postRes.status === 200, '7.1 Message posted successfully');

    interceptedCalls.length = 0;

    // Bob retrieves history on reload
    const reqBobHistory = new Request(`https://worker.test/api/chat/conversations/${convGuestId}/messages?guestToken=${tokenB}`, {
      method: 'GET',
    });
    const resBobHistory = await worker.fetch(reqBobHistory, env, {} as any);
    assert(resBobHistory.status === 200, '7.2 Bob (recipient) retrieves history with 200 OK');
    const dataBobHistory = await resBobHistory.json();
    assert(dataBobHistory.success === true, '7.3 History response success is true');
    assert(dataBobHistory.messages.length >= 1, '7.4 Retrieved at least 1 message in conversation');
    assert(dataBobHistory.messages[0].content === 'Hello Bob! This is a test message for history reload.', '7.5 Message content matches');

    // Verify service role key was used for the Supabase fetch
    const historyDbCall = interceptedCalls.find(c => c.url.includes('/rest/v1/messages') && c.method === 'GET');
    assert(!!historyDbCall, '7.6 Supabase messages REST query was invoked');
    assert(
      historyDbCall?.headers['apikey'] === mockServiceKey &&
      historyDbCall?.headers['Authorization'] === `Bearer ${mockServiceKey}`,
      '7.7 History retrieval strictly used supabaseServiceKey (never anonKey)'
    );

    // -------------------------------------------------------------------------
    // TEST 8: Authorized registered member history access via Bearer JWT -> 200 OK
    // -------------------------------------------------------------------------
    console.log('\n--- Test 8: Authorized registered member history access ---');
    // Seed a message between registered members
    storedMessages.push({
      id: 'reg_msg_101',
      conversation_id: convRegId,
      sender_user_id: regMember1Id,
      sender_nickname: 'MemberAlice',
      sender_avatar: '👩',
      content: 'Private registered conversation message',
      created_at: new Date().toISOString(),
    });

    interceptedCalls.length = 0;
    const reqMemberHistory = new Request(`https://worker.test/api/chat/conversations/${convRegId}/messages`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${regMemberJwt2}`,
      },
    });
    const resMemberHistory = await worker.fetch(reqMemberHistory, env, {} as any);
    assert(resMemberHistory.status === 200, '8.1 Registered member 2 retrieves history with 200 OK');
    const dataMemberHistory = await resMemberHistory.json();
    assert(dataMemberHistory.success === true, '8.2 Registered history success is true');
    assert(dataMemberHistory.messages.length >= 1, '8.3 Member retrieved message');
    assert(dataMemberHistory.messages.some((m: any) => m.content === 'Private registered conversation message'), '8.4 Member content verified');

    console.log('\n=============================================================');
    console.log('  ALL WORKER CONVERSATION HISTORY TESTS COMPLETED WITH 100% SUCCESS');
    console.log('=============================================================\n');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

runWorkerHistoryTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
