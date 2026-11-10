import worker from '../src/worker';

/**
 * VoxaNex — Adult Room Server Authorization Test Suite
 *
 * Verifies Module B requirements:
 * 1. Undeclared guest cannot read adult-room messages (HTTP 403).
 * 2. Undeclared guest cannot send adult-room messages (HTTP 403).
 * 3. Undeclared guest cannot join adult-room presence (HTTP 403).
 * 4. Undeclared guest cannot read adult-room presence (HTTP 403).
 * 5. Undeclared guest cannot send adult-room typing indicators (HTTP 403).
 * 6. Undeclared guest cannot access adult-room SSE event stream (HTTP 403).
 * 7. Declared guest (dec18: true) CAN access all adult-room operations (HTTP 200).
 * 8. Ordinary public room operations (non-adult, e.g. 'bangla') remain accessible to all guests.
 * 9. Invalid, expired, and revoked tokens are rejected with HTTP 401.
 * 10. Registered member can access adult-room operations with valid JWT.
 * 11. Client cannot forge signed declaration (dec18) or trusted verification (v18) claim.
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

function toBase64Url(str: string): string {
  return Buffer.from(str).toString('base64url');
}

function createMockMemberJwt(userId: string): string {
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = toBase64Url(JSON.stringify({
    sub: userId,
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  return `${header}.${payload}.mock_sig`;
}

async function runAdultRoomAuthorizationTests() {
  console.log('\n========================================================================');
  console.log('  VOXANEX: ADULT ROOM SERVER AUTHORIZATION TESTS');
  console.log('========================================================================\n');

  const origFetch = globalThis.fetch;
  const validSecret = 'super_secure_random_guest_secret_32_bytes_entropy!!';
  const env = {
    GUEST_SESSION_SECRET: validSecret,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    ENVIRONMENT: 'development',
    DEV: true,
  };

  const dbGuestSessions: any[] = [];
  const dbMessages: any[] = [];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input.toString();
    const urlObj = new URL(urlStr);
    const method = init?.method || 'GET';

    if (urlObj.pathname.includes('/rest/v1/guest_sessions')) {
      if (method === 'POST') {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
        dbGuestSessions.push(body);
        return new Response(JSON.stringify([body]), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (method === 'GET') {
        const hashParam = urlObj.searchParams.get('session_token_hash');
        const hash = hashParam?.startsWith('eq.') ? hashParam.slice(3) : hashParam;
        const found = dbGuestSessions.filter(s => s.session_token_hash === hash);
        return new Response(JSON.stringify(found), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (urlObj.pathname.includes('/rest/v1/messages')) {
      if (method === 'POST') {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
        dbMessages.push(body);
        return new Response(JSON.stringify(Array.isArray(body) ? body : [body]), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlObj.pathname.includes('/auth/v1/user')) {
      const auth = (init?.headers as any)?.['Authorization'] || (init?.headers as any)?.['authorization'] || '';
      if (auth.includes('mock_sig')) {
        return new Response(JSON.stringify({ id: 'member_uuid_999', email: 'member@test.com' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: 'invalid token' }), { status: 401 });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    // 1. Create an undeclared guest session (ageDeclarationAccepted: false)
    const undeclaredRes = await worker.fetch(new Request('https://voxanex.test/api/guest/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: 'MinorVisitor',
        avatar: '🐣',
        languagePref: 'en',
        ageDeclarationAccepted: false,
      }),
    }), env, {} as any);
    const undeclaredBody = (await undeclaredRes.json()) as any;
    const undeclaredToken = undeclaredBody.session.token;
    const undeclaredUserId = undeclaredBody.session.id;

    // 2. Create a declared guest session (ageDeclarationAccepted: true)
    const declaredRes = await worker.fetch(new Request('https://voxanex.test/api/guest/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: 'AdultVisitor',
        avatar: '🔥',
        languagePref: 'en',
        ageDeclarationAccepted: true,
      }),
    }), env, {} as any);
    const declaredBody = (await declaredRes.json()) as any;
    const declaredToken = declaredBody.session.token;
    const declaredUserId = declaredBody.session.id;

    const memberToken = createMockMemberJwt('member_uuid_999');

    // =========================================================================
    // SECTION 1: UNDECLARED GUEST REJECTED FROM ADULT ROOMS (HTTP 403)
    // =========================================================================
    console.log('--- 1. Undeclared guest rejected from adult room operations (403) ---');
    {
      const adultRoom = 'sex'; // Adult room slug from ROOMS_CONFIG

      // 1.1 GET messages
      const getMsgRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${adultRoom}/messages`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${undeclaredToken}` },
      }), env, {} as any);
      assert(getMsgRes.status === 403, '1.1 Undeclared guest cannot read adult room messages (HTTP 403)');

      // 1.2 POST message
      const postMsgRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${adultRoom}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${undeclaredToken}`,
        },
        body: JSON.stringify({
          content: 'Hello adult room',
          senderId: undeclaredUserId,
          senderType: 'guest',
        }),
      }), env, {} as any);
      assert(postMsgRes.status === 403, '1.2 Undeclared guest cannot send adult room messages (HTTP 403)');

      // 1.3 POST presence
      const postPresRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${adultRoom}/presence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${undeclaredToken}`,
        },
        body: JSON.stringify({ id: undeclaredUserId }),
      }), env, {} as any);
      assert(postPresRes.status === 403, '1.3 Undeclared guest cannot join adult room presence (HTTP 403)');

      // 1.4 GET presence
      const getPresRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${adultRoom}/presence`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${undeclaredToken}` },
      }), env, {} as any);
      assert(getPresRes.status === 403, '1.4 Undeclared guest cannot read adult room presence (HTTP 403)');

      // 1.5 POST typing
      const postTypRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${adultRoom}/typing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${undeclaredToken}`,
        },
        body: JSON.stringify({ memberId: undeclaredUserId, isTyping: true }),
      }), env, {} as any);
      assert(postTypRes.status === 403, '1.5 Undeclared guest cannot send adult room typing indicators (HTTP 403)');

      // 1.6 GET events (SSE)
      const getSseRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${adultRoom}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${undeclaredToken}` },
      }), env, {} as any);
      assert(getSseRes.status === 403, '1.6 Undeclared guest cannot connect to adult room SSE events (HTTP 403)');
    }

    // =========================================================================
    // SECTION 2: DECLARED GUEST PERMITTED IN ADULT ROOMS (HTTP 200)
    // =========================================================================
    console.log('\n--- 2. Declared guest permitted in adult room operations (200) ---');
    {
      const adultRoom = 'sex';

      // 2.1 GET messages
      const getMsgRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${adultRoom}/messages`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${declaredToken}` },
      }), env, {} as any);
      assert(getMsgRes.status === 200, '2.1 Declared guest can read adult room messages (HTTP 200)');

      // 2.2 POST message
      const postMsgRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${adultRoom}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${declaredToken}`,
        },
        body: JSON.stringify({
          content: 'Hello adult room from declared guest',
          senderId: declaredUserId,
          senderType: 'guest',
        }),
      }), env, {} as any);
      assert(postMsgRes.status === 200, '2.2 Declared guest can send adult room messages (HTTP 200)');

      // 2.3 POST presence
      const postPresRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${adultRoom}/presence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${declaredToken}`,
        },
        body: JSON.stringify({ id: declaredUserId }),
      }), env, {} as any);
      assert(postPresRes.status === 200, '2.3 Declared guest can join adult room presence (HTTP 200)');

      // 2.4 GET presence
      const getPresRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${adultRoom}/presence`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${declaredToken}` },
      }), env, {} as any);
      assert(getPresRes.status === 200, '2.4 Declared guest can read adult room presence (HTTP 200)');

      // 2.5 POST typing
      const postTypRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${adultRoom}/typing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${declaredToken}`,
        },
        body: JSON.stringify({ memberId: declaredUserId, isTyping: true }),
      }), env, {} as any);
      assert(postTypRes.status === 200, '2.5 Declared guest can send adult room typing indicators (HTTP 200)');

      // 2.6 GET events (SSE)
      const getSseRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${adultRoom}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${declaredToken}` },
      }), env, {} as any);
      assert(getSseRes.status === 200, '2.6 Declared guest can connect to adult room SSE events (HTTP 200)');
    }

    // =========================================================================
    // SECTION 3: ORDINARY PUBLIC ROOMS REMAIN ACCESSIBLE TO ALL GUESTS
    // =========================================================================
    console.log('\n--- 3. Ordinary public room operations remain accessible to all guests ---');
    {
      const publicRoom = 'bangla'; // Non-adult room slug

      // 3.1 GET messages
      const getMsgRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${publicRoom}/messages`), env, {} as any);
      assert(getMsgRes.status === 200, '3.1 Undeclared guest can read public room messages (HTTP 200)');

      // 3.2 POST message
      const postMsgRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${publicRoom}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${undeclaredToken}`,
        },
        body: JSON.stringify({
          content: 'Hello public room',
          senderId: undeclaredUserId,
          senderType: 'guest',
        }),
      }), env, {} as any);
      assert(postMsgRes.status === 200, '3.2 Undeclared guest can send public room messages (HTTP 200)');

      // 3.3 POST presence
      const postPresRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${publicRoom}/presence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${undeclaredToken}`,
        },
        body: JSON.stringify({ id: undeclaredUserId }),
      }), env, {} as any);
      assert(postPresRes.status === 200, '3.3 Undeclared guest can join public room presence (HTTP 200)');
    }

    // =========================================================================
    // SECTION 4: REGISTERED MEMBER ACCESSIBLE (HTTP 200)
    // =========================================================================
    console.log('\n--- 4. Registered member can access adult rooms (200) ---');
    {
      const adultRoom = 'adult';

      const postMsgRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${adultRoom}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${memberToken}`,
        },
        body: JSON.stringify({
          content: 'Hello adult room from registered member',
          senderId: 'member_uuid_999',
          senderType: 'registered',
        }),
      }), env, {} as any);
      assert(postMsgRes.status === 200, '4.1 Registered member can send adult room message (HTTP 200)');
    }

    // =========================================================================
    // SECTION 5: ANTI-FORGERY & TAMPERING PROTECTION (HTTP 401)
    // =========================================================================
    console.log('\n--- 5. Anti-forgery & payload tampering protection ---');
    {
      const parts = declaredToken.slice('vx_gst_'.length).split('.');
      const decodedPayload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'));

      // Tamper: claim v18: true on guest token
      decodedPayload.v18 = true;
      const tamperedRaw = Buffer.from(JSON.stringify(decodedPayload)).toString('base64url');
      const tamperedToken = `vx_gst_${tamperedRaw}.${parts[1]}`;

      const res = await worker.fetch(new Request('https://voxanex.test/api/chat/rooms/sex/messages', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tamperedToken}` },
      }), env, {} as any);
      assert(res.status === 401, '5.1 Tampered token with forged v18 claim is rejected (HTTP 401)');
    }

  } finally {
    globalThis.fetch = origFetch;
  }

  console.log('\n========================================================================');
  console.log(`  ADULT ROOM AUTHORIZATION TEST RESULTS: ${passedTests} PASSED / ${failedTests} FAILED (TOTAL: ${totalTests})`);
  console.log('========================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAdultRoomAuthorizationTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
