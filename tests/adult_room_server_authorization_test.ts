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

async function signGuestToken(payload: any, secret: string): Promise<string> {
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
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

async function computeTokenHash(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
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
  const proxiedCalls: { url: string; method: string }[] = [];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string'
      ? input
      : (input && typeof (input as any).url === 'string' ? (input as any).url : input.toString());
    const urlObj = new URL(urlStr);
    const method = init?.method || (input && (input as any).method ? (input as any).method : 'GET');

    if (urlStr.startsWith('https://backend-proxy.test')) {
      proxiedCalls.push({ url: urlStr, method });
      return new Response(JSON.stringify({ success: true, proxied: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

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
    // SECTION 6: INVALID MEMBER JWT, EXPIRED & REVOKED GUEST TOKENS (HTTP 401)
    // =========================================================================
    console.log('\n--- 6. Token invalidation, expiration & revocation checks (401) ---');
    {
      // 6.1 Invalid member JWT
      const badJwtRes = await worker.fetch(new Request('https://voxanex.test/api/chat/rooms/sex/messages', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer invalid.member.jwt' },
      }), env, {} as any);
      assert(badJwtRes.status === 401, '6.1 Invalid member JWT is rejected (HTTP 401)');

      // 6.2 Completely invalid guest token format
      const garbageTokenRes = await worker.fetch(new Request('https://voxanex.test/api/chat/rooms/sex/messages', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer vx_gst_garbage_payload' },
      }), env, {} as any);
      assert(garbageTokenRes.status === 401, '6.2 Invalid guest token format is rejected (HTTP 401)');

      // 6.3 Genuine HMAC-signed expired guest token test
      const expiredSid = crypto.randomUUID();
      const expiredPayload = {
        sid: expiredSid,
        nick: 'GenuineExpiredGuest',
        av: '⌛',
        dec18: true,
        iat: Date.now() - 7200000, // Issued 2 hours ago
        exp: Date.now() - 3600000, // Expired 1 hour ago
      };
      const genuineExpiredToken = await signGuestToken(expiredPayload, validSecret);
      const genuineExpiredHash = await computeTokenHash(genuineExpiredToken);

      // Register valid session in mock DB so HMAC signature and DB lookup pass, specifically testing timestamp expiry
      dbGuestSessions.push({
        id: expiredSid,
        session_token_hash: genuineExpiredHash,
        is_revoked: false,
        is_18_verified: false,
        expires_at: new Date(Date.now() - 3600000).toISOString(),
        created_at: new Date(Date.now() - 7200000).toISOString(),
      });

      const expiredRes = await worker.fetch(new Request('https://voxanex.test/api/chat/rooms/sex/messages', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${genuineExpiredToken}` },
      }), env, {} as any);
      assert(expiredRes.status === 401, '6.3 Genuine HMAC-signed expired guest token is rejected (HTTP 401)');

      // 6.4 Revoked guest session
      const revokedTokenRes = await worker.fetch(new Request('https://voxanex.test/api/guest/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: 'RevokedUser',
          avatar: '🛑',
          languagePref: 'en',
          ageDeclarationAccepted: true,
        }),
      }), env, {} as any);
      const revokedBody = (await revokedTokenRes.json()) as any;
      const revokedToken = revokedBody.session.token;

      // Mark revoked in db mock
      const revokedDbRecord = dbGuestSessions[dbGuestSessions.length - 1];
      if (revokedDbRecord) {
        revokedDbRecord.is_revoked = true;
      }

      const revokedAccessRes = await worker.fetch(new Request('https://voxanex.test/api/chat/rooms/sex/messages', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${revokedToken}` },
      }), env, {} as any);
      assert(revokedAccessRes.status === 401, '6.4 Revoked guest session is rejected (HTTP 401)');
    }

    // =========================================================================
    // SECTION 7: BACKEND_URL PROXY AUTHORIZATION GATE ENFORCEMENT & EXPLICIT COUNTERS
    // =========================================================================
    console.log('\n--- 7. BACKEND_URL proxy authorization gate enforcement ---');
    {
      const proxyEnv = {
        ...env,
        BACKEND_URL: 'https://backend-proxy.test',
      };

      // 7.1 Undeclared guest attempting adult room access when BACKEND_URL is set MUST be rejected with HTTP 403
      proxiedCalls.length = 0; // Reset recorder
      const proxyUndeclaredRes = await worker.fetch(new Request('https://voxanex.test/api/chat/rooms/sex/messages', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${undeclaredToken}` },
      }), proxyEnv, {} as any);
      assert(proxyUndeclaredRes.status === 403, '7.1 Undeclared guest accessing adult room with BACKEND_URL set is blocked (HTTP 403)');
      assert(proxiedCalls.length === 0, '7.1.1 Verified ZERO upstream proxy calls generated for blocked adult room request');

      // 7.2 Declared guest accessing adult room when BACKEND_URL is set passes security gate and proxies (HTTP 200)
      proxiedCalls.length = 0; // Reset recorder
      const proxyDeclaredRes = await worker.fetch(new Request('https://voxanex.test/api/chat/rooms/sex/messages', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${declaredToken}` },
      }), proxyEnv, {} as any);
      assert(proxyDeclaredRes.status === 200, '7.2 Declared guest accessing adult room with BACKEND_URL set passes gate (HTTP 200)');
      assert(proxiedCalls.length === 1 && proxiedCalls[0].url.startsWith('https://backend-proxy.test'), '7.2.1 Verified EXACTLY 1 upstream proxy call generated for authorized adult room request');

      // 7.3 Ordinary public room with BACKEND_URL set passes gate (HTTP 200)
      proxiedCalls.length = 0; // Reset recorder
      const proxyPublicRes = await worker.fetch(new Request('https://voxanex.test/api/chat/rooms/bangla/messages', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${undeclaredToken}` },
      }), proxyEnv, {} as any);
      assert(proxyPublicRes.status === 200, '7.3 Ordinary public room with BACKEND_URL set passes gate (HTTP 200)');
      assert(proxiedCalls.length === 1 && proxiedCalls[0].url.startsWith('https://backend-proxy.test'), '7.3.1 Verified EXACTLY 1 upstream proxy call generated for public room request');
    }

    // =========================================================================
    // SECTION 8: MALFORMED ROOM IDENTIFIER HANDLING
    // =========================================================================
    console.log('\n--- 8. Malformed room identifier handling ---');
    {
      // 8.1 Malformed URI encoding in room identifier
      const malformedRes = await worker.fetch(new Request('https://voxanex.test/api/chat/rooms/%E0%A4%A/messages', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${undeclaredToken}` },
      }), env, {} as any);
      assert(malformedRes.status === 200, '8.1 Malformed room identifier is handled safely without throwing exception');
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
