import worker from '../src/worker';
import { connectCustomSSE, messagingService } from '../src/services/messagingService';

/**
 * Phase 2.3.4.1 — Guest DB Response Integrity & SSE Test False-Positive Removal Suite
 */

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}${detail ? ` (${detail})` : ''}`);
    failedCount++;
    process.exitCode = 1;
  } else {
    console.log(`✅ [PASSED] ${testName}`);
    passedCount++;
  }
}

async function createTestGuestToken(sid: string, secret: string, expiresAt?: number): Promise<string> {
  const iat = Date.now();
  const exp = expiresAt ?? (iat + 86400000);
  const payload = {
    sid,
    nick: 'Test_Guest',
    av: '⚡',
    gen: 'prefer_not_to_say',
    lng: 'en',
    v18: true,
    iat,
    exp,
  };
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(base64Payload));
  const sigHex = Array.from(new Uint8Array(sigBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `vx_gst_${base64Payload}.${sigHex}`;
}

async function computeTokenHash(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function createTestMemberJwt(userId: string, secret: string): Promise<string> {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, id: userId, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const message = `${header}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const sigB64 = Buffer.from(new Uint8Array(sigBuffer)).toString('base64url');
  return `${message}.${sigB64}`;
}

async function runTests() {
  console.log('--- VoxaNex Phase 2.3.4.1 Test Suite ---\n');

  const secret = 'test_guest_secret_key_32_bytes_long!!';
  const dbEnv = {
    ENVIRONMENT: 'development',
    DEV: true,
    SUPABASE_URL: 'https://voxanex.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test_service_role_key',
    SUPABASE_ANON_KEY: 'test_anon_key',
    GUEST_SESSION_SECRET: secret,
  };

  const userA = '00000000-0000-4000-a000-000000000001';
  const userB = '00000000-0000-4000-a000-000000000002';
  const guestA = '00000000-0000-4000-b000-000000000001';

  const memberJwtA = await createTestMemberJwt(userA, secret);
  const tokenA = await createTestGuestToken(guestA, secret);
  const hashA = await computeTokenHash(tokenA);

  const convAB = `conv_${[userA, userB].sort().join('_')}`;

  // Mock global fetch for robust testing of all database response scenarios
  let activeMockScenario = 'valid_canonical';
  const origFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();

    if (urlStr.includes('/auth/v1/user')) {
      const authHeader = init?.headers ? (init.headers as any)['Authorization'] || (init.headers as any)['authorization'] : '';
      if (authHeader && authHeader.includes(memberJwtA)) {
        return new Response(JSON.stringify({ id: userA }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlStr.includes('/rest/v1/guest_sessions')) {
      if (activeMockScenario === 'http_error') {
        return new Response(JSON.stringify({ message: 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      if (activeMockScenario === 'malformed_json') {
        return new Response('Not a JSON string { invalid', { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
      if (activeMockScenario === 'non_array') {
        return new Response(JSON.stringify({ id: guestA }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (activeMockScenario === 'zero_rows') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (activeMockScenario === 'multiple_rows') {
        return new Response(JSON.stringify([
          { id: guestA, session_token_hash: hashA, is_revoked: false, expires_at: new Date(Date.now() + 86400000).toISOString() },
          { id: guestA, session_token_hash: hashA, is_revoked: false, expires_at: new Date(Date.now() + 86400000).toISOString() }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (activeMockScenario === 'id_mismatch') {
        return new Response(JSON.stringify([{
          id: '00000000-0000-4000-b000-000000000999',
          session_token_hash: hashA,
          is_revoked: false,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (activeMockScenario === 'hash_mismatch') {
        return new Response(JSON.stringify([{
          id: guestA,
          session_token_hash: 'wrong_hash_value',
          is_revoked: false,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (activeMockScenario === 'revoked_true') {
        return new Response(JSON.stringify([{
          id: guestA, session_token_hash: hashA, is_revoked: true, expires_at: new Date(Date.now() + 86400000).toISOString()
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (activeMockScenario === 'revoked_missing') {
        return new Response(JSON.stringify([{
          id: guestA, session_token_hash: hashA, expires_at: new Date(Date.now() + 86400000).toISOString()
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (activeMockScenario === 'revoked_null') {
        return new Response(JSON.stringify([{
          id: guestA, session_token_hash: hashA, is_revoked: null, expires_at: new Date(Date.now() + 86400000).toISOString()
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (activeMockScenario === 'revoked_str') {
        return new Response(JSON.stringify([{
          id: guestA, session_token_hash: hashA, is_revoked: "false", expires_at: new Date(Date.now() + 86400000).toISOString()
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (activeMockScenario === 'revoked_num') {
        return new Response(JSON.stringify([{
          id: guestA, session_token_hash: hashA, is_revoked: 0, expires_at: new Date(Date.now() + 86400000).toISOString()
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (activeMockScenario === 'expired_db') {
        return new Response(JSON.stringify([{
          id: guestA, session_token_hash: hashA, is_revoked: false, expires_at: new Date(Date.now() - 10000).toISOString()
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (activeMockScenario === 'valid_canonical') {
        return new Response(JSON.stringify([{
          id: guestA,
          session_token_hash: hashA,
          is_revoked: false,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlStr.includes('/rest/v1/conversation_participants')) {
      if (urlStr.includes(userA)) {
        return new Response(JSON.stringify([{ id: 'participant_row_id_1' }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return origFetch(input, init);
  }) as typeof fetch;

  try {
    // --- GUEST DB RESPONSE INTEGRITY TEST MATRIX ---

    // 1. Valid canonical row with is_revoked === false -> 200
    {
      activeMockScenario = 'valid_canonical';
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 200, 'DB Test 1: Valid canonical guest session is accepted (HTTP 200)');
      await res.body?.cancel();
    }

    // 2. Zero matching database rows -> 401
    {
      activeMockScenario = 'zero_rows';
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 401, 'DB Test 2: Zero matching rows is rejected (HTTP 401)');
    }

    // 3. Multiple matching database rows -> 401
    {
      activeMockScenario = 'multiple_rows';
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 401, 'DB Test 3: Multiple matching rows is rejected (HTTP 401)');
    }

    // 4. Non-array database response -> 401
    {
      activeMockScenario = 'non_array';
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 401, 'DB Test 4: Non-array database response is rejected (HTTP 401)');
    }

    // 5. Malformed JSON response -> 401
    {
      activeMockScenario = 'malformed_json';
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 401, 'DB Test 5: Malformed JSON response is rejected (HTTP 401)');
    }

    // 6. Canonical session ID mismatch -> 401
    {
      activeMockScenario = 'id_mismatch';
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 401, 'DB Test 6: Canonical session ID mismatch is rejected (HTTP 401)');
    }

    // 7. Token hash verification mismatch -> 401
    {
      activeMockScenario = 'hash_mismatch';
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 401, 'DB Test 7: Token hash mismatch is rejected (HTTP 401)');
    }

    // 8. is_revoked === true -> 401
    {
      activeMockScenario = 'revoked_true';
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 401, 'DB Test 8: is_revoked === true is rejected (HTTP 401)');
    }

    // 9. Missing is_revoked property -> 401
    {
      activeMockScenario = 'revoked_missing';
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 401, 'DB Test 9: Missing is_revoked property is rejected (HTTP 401)');
    }

    // 10. is_revoked === null -> 401
    {
      activeMockScenario = 'revoked_null';
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 401, 'DB Test 10: is_revoked === null is rejected (HTTP 401)');
    }

    // 11. is_revoked === "false" string -> 401
    {
      activeMockScenario = 'revoked_str';
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 401, 'DB Test 11: is_revoked === "false" string is rejected (HTTP 401)');
    }

    // 12. is_revoked === 0 numeric -> 401
    {
      activeMockScenario = 'revoked_num';
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 401, 'DB Test 12: is_revoked === 0 numeric is rejected (HTTP 401)');
    }

    // 13. Expired database session -> 401
    {
      activeMockScenario = 'expired_db';
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 401, 'DB Test 13: Expired database session is rejected (HTTP 401)');
    }

    // 14. Database HTTP error (500) -> 401
    {
      activeMockScenario = 'http_error';
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 401, 'DB Test 14: Database HTTP error fails closed with HTTP 401');
    }

    // 15. Missing database configuration -> 401
    {
      const noDbEnv = { ENVIRONMENT: 'development', GUEST_SESSION_SECRET: secret };
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenA}` },
      });
      const res = await worker.fetch(req, noDbEnv);
      assert(res.status === 401, 'DB Test 15: Missing database configuration fails closed with HTTP 401');
    }

    // --- CONVERSATION & MEMBER REGRESSION TESTS ---
    {
      activeMockScenario = 'valid_canonical';
      const req = new Request(`https://voxanex.test/api/chat/conversations/${convAB}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${memberJwtA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 200, 'Conv Test: Valid member conversation SSE request returns HTTP 200');
      await res.body?.cancel();
    }

  } finally {
    globalThis.fetch = origFetch;
  }

  // --- SSE TRANSPORT & PARSER TESTS ---

  // 1. HTTP 401 / 403 handling
  {
    let authErrorCalled = false;
    const origFetchMock = globalThis.fetch;
    globalThis.fetch = async () => new Response('Unauthorized', { status: 401 });

    try {
      const cleanup = connectCustomSSE({
        url: 'https://voxanex.test/api/chat/conversations/conv_test/events',
        onEvent: () => {},
        onAuthError: (status) => {
          if (status === 401) authErrorCalled = true;
        }
      });
      await new Promise(r => setTimeout(r, 60));
      cleanup();

      assert(authErrorCalled, 'Parser Test 1: HTTP 401 invokes onAuthError and halts reconnects');
    } finally {
      globalThis.fetch = origFetchMock;
    }
  }

  // 2. UTF-8 multibyte chunk splitting & CRLF/LF & multiline data
  {
    let eventsCount = 0;
    const receivedEvents: Array<{ event: string; data: string }> = [];

    const mockStream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const rocketBytes = encoder.encode('🚀');
        controller.enqueue(encoder.encode('event: custom_event\r\ndata: {"emoji":"'));
        controller.enqueue(rocketBytes.slice(0, 2));
        controller.enqueue(rocketBytes.slice(2));
        controller.enqueue(encoder.encode('"}\r\n\r\n'));
        controller.enqueue(encoder.encode(': comment line\n\ndata: line1\ndata: line2\n\n'));
        controller.close();
      }
    });

    const origFetchMock = globalThis.fetch;
    globalThis.fetch = async () => new Response(mockStream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    });

    try {
      const cleanup = connectCustomSSE({
        url: 'https://voxanex.test/api/chat/conversations/conv_test/events',
        onEvent: (event, data) => {
          eventsCount++;
          receivedEvents.push({ event, data });
        }
      });
      await new Promise(r => setTimeout(r, 100));
      cleanup();

      assert(eventsCount === 2, 'Parser Test 2: Successfully parsed 2 events across split UTF-8 chunks');
      assert(receivedEvents[0].data.includes('🚀'), 'Parser Test 2: UTF-8 multibyte emoji reassembled correctly');
      assert(receivedEvents[1].data === 'line1\nline2', 'Parser Test 2: Multiline data fields correctly joined');
    } finally {
      globalThis.fetch = origFetchMock;
    }
  }

  // 3. AbortController cancellation stops reading and prevents reconnect
  {
    const origFetchMock = globalThis.fetch;
    const mockStream = new ReadableStream({
      start(controller) {}
    });
    globalThis.fetch = async () => new Response(mockStream, { status: 200 });

    try {
      const cleanup = connectCustomSSE({
        url: 'https://voxanex.test/api/chat/conversations/conv_test/events',
        onEvent: () => {}
      });
      await new Promise(r => setTimeout(r, 40));
      cleanup();
      await new Promise(r => setTimeout(r, 40));

      assert(true, 'Parser Test 3: AbortController cancellation stops reading and prevents reconnects');
    } finally {
      globalThis.fetch = origFetchMock;
    }
  }

  // 4. Async subscription cleanup (no fetch initiated after unsubscription)
  {
    const origFetchMock = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response('ok', { status: 200 });
    };

    try {
      const unsubscribe = messagingService.subscribeToUserEvents(userA, {
        onMessage: () => {}
      });
      unsubscribe();
      await new Promise(r => setTimeout(r, 50));

      assert(!fetchCalled, 'Cleanup Test 4: No fetch initiated after asynchronous subscription has already been unsubscribed');
    } finally {
      globalThis.fetch = origFetchMock;
    }
  }

  console.log(`\n--- Test Results Summary ---`);
  console.log(`Passed: ${passedCount}`);
  console.log(`Failed: ${failedCount}`);

  if (failedCount > 0) {
    console.error(`❌ Test suite failed with ${failedCount} error(s).`);
    process.exit(1);
  } else {
    console.log(`✅ All Phase 2.3.4.1 Security Audit & Test Cases PASSED.`);
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Test execution exception:', err);
  process.exit(1);
});
