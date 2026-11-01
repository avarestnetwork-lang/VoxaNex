import worker from '../src/worker';
import { connectCustomSSE, messagingService, setTestAuthTokenResolver } from '../src/services/messagingService';

/**
 * Phase 2.3.4.3 — Complete Guest Security Regression Matrix & SSE Transport Verification
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

async function runTests() {
  console.log('--- VoxaNex Phase 2.3.4.3 Test Suite ---\n');

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
  const guestA = '00000000-0000-4000-b000-000000000001';
  const tokenA = await createTestGuestToken(guestA, secret);
  const hashA = await computeTokenHash(tokenA);

  // =========================================================================
  // TASK 1: RESTORE GUEST SESSION DATABASE INTEGRITY MATRIX (15 SCENARIOS)
  // =========================================================================
  console.log('--- Task 1: Guest Session Database Integrity Matrix ---');

  const origFetch = globalThis.fetch;

  async function runGuestTest(scenarioName: string, mockFetchHandler: () => Response | Promise<Response>, expectedStatus: number) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (urlStr.includes('/rest/v1/guest_sessions')) {
        return await mockFetchHandler();
      }
      return origFetch(input, init);
    }) as typeof fetch;

    try {
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === expectedStatus, `Guest Matrix: ${scenarioName}`, `Expected status ${expectedStatus}, got ${res.status}`);
      await res.body?.cancel();
    } finally {
      globalThis.fetch = origFetch;
    }
  }

  // 1. Valid canonical guest session
  await runGuestTest(
    '1. Valid canonical guest session accepted',
    () => new Response(JSON.stringify([{
      id: guestA,
      session_token_hash: hashA,
      is_revoked: false,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    200
  );

  // 2. Zero database rows
  await runGuestTest(
    '2. Zero database rows rejected',
    () => new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    401
  );

  // 3. Multiple database rows
  await runGuestTest(
    '3. Multiple database rows rejected',
    () => new Response(JSON.stringify([
      { id: guestA, session_token_hash: hashA, is_revoked: false, expires_at: new Date(Date.now() + 86400000).toISOString() },
      { id: guestA, session_token_hash: hashA, is_revoked: false, expires_at: new Date(Date.now() + 86400000).toISOString() }
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    401
  );

  // 4. Non-array database response
  await runGuestTest(
    '4. Non-array database response rejected',
    () => new Response(JSON.stringify({ error: 'object response' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    401
  );

  // 5. Malformed JSON response
  await runGuestTest(
    '5. Malformed JSON response rejected',
    () => new Response('not valid json {', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    401
  );

  // 6. Session ID mismatch
  await runGuestTest(
    '6. Session ID mismatch rejected',
    () => new Response(JSON.stringify([{
      id: '00000000-0000-4000-b000-000000000999',
      session_token_hash: hashA,
      is_revoked: false,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    401
  );

  // 7. Stored session_token_hash mismatch
  await runGuestTest(
    '7. Stored session_token_hash mismatch rejected',
    () => new Response(JSON.stringify([{
      id: guestA,
      session_token_hash: 'bad_hash_value',
      is_revoked: false,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    401
  );

  // 8. is_revoked === true
  await runGuestTest(
    '8. is_revoked === true rejected',
    () => new Response(JSON.stringify([{
      id: guestA,
      session_token_hash: hashA,
      is_revoked: true,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    401
  );

  // 9. Missing is_revoked
  await runGuestTest(
    '9. Missing is_revoked rejected',
    () => new Response(JSON.stringify([{
      id: guestA,
      session_token_hash: hashA,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    401
  );

  // 10. is_revoked === null
  await runGuestTest(
    '10. is_revoked === null rejected',
    () => new Response(JSON.stringify([{
      id: guestA,
      session_token_hash: hashA,
      is_revoked: null,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    401
  );

  // 11. is_revoked === "false" (string)
  await runGuestTest(
    '11. is_revoked === "false" string rejected',
    () => new Response(JSON.stringify([{
      id: guestA,
      session_token_hash: hashA,
      is_revoked: 'false',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    401
  );

  // 12. is_revoked === 0 (number)
  await runGuestTest(
    '12. is_revoked === 0 number rejected',
    () => new Response(JSON.stringify([{
      id: guestA,
      session_token_hash: hashA,
      is_revoked: 0,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    401
  );

  // 13. Expired database session
  await runGuestTest(
    '13. Expired database session rejected',
    () => new Response(JSON.stringify([{
      id: guestA,
      session_token_hash: hashA,
      is_revoked: false,
      expires_at: new Date(Date.now() - 3600000).toISOString(),
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    401
  );

  // 14. Database HTTP error
  await runGuestTest(
    '14. Database HTTP error rejected',
    () => new Response('Internal Server Error', { status: 500 }),
    401
  );

  // 15. Missing database configuration
  {
    const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${tokenA}` },
    });
    const res = await worker.fetch(req, { ...dbEnv, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' });
    assert(res.status === 401, '15. Missing database configuration rejected');
    await res.body?.cancel();
  }


  // =========================================================================
  // TASK 2 & 3: SSE TRANSPORT TESTS (401, 403, 500 retry, AbortController, async unsubscribe)
  // =========================================================================
  console.log('\n--- Task 2 & 3: SSE Transport & Cancellation Verification ---');

  // Test 2A: HTTP 401 independent test
  {
    let authErrorStatus = 0;
    let fetchCount = 0;
    const origFetchMock = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCount++;
      return new Response('Unauthorized', { status: 401 });
    };

    try {
      const cleanup = connectCustomSSE({
        url: 'https://voxanex.test/api/chat/conversations/conv_test/events',
        onEvent: () => {},
        onAuthError: (status) => {
          authErrorStatus = status;
        }
      });
      await new Promise(r => setTimeout(r, 60));
      cleanup();

      assert(authErrorStatus === 401, 'HTTP 401 Test: onAuthError received exact status 401');
      assert(fetchCount === 1, 'HTTP 401 Test: Exactly 1 fetch call executed (no reconnect)');
    } finally {
      globalThis.fetch = origFetchMock;
    }
  }

  // Test 2B: HTTP 403 independent test
  {
    let authErrorStatus = 0;
    let fetchCount = 0;
    const origFetchMock = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCount++;
      return new Response('Forbidden', { status: 403 });
    };

    try {
      const cleanup = connectCustomSSE({
        url: 'https://voxanex.test/api/chat/conversations/conv_test/events',
        onEvent: () => {},
        onAuthError: (status) => {
          authErrorStatus = status;
        }
      });
      await new Promise(r => setTimeout(r, 60));
      cleanup();

      assert(authErrorStatus === 403, 'HTTP 403 Test: onAuthError received exact status 403');
      assert(fetchCount === 1, 'HTTP 403 Test: Exactly 1 fetch call executed (no reconnect)');
    } finally {
      globalThis.fetch = origFetchMock;
    }
  }

  // --- HTTP 500 Retry & Recovery Test ---
  {
    let fetchCount = 0;
    let openCalled = false;
    const origFetchMock = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCount++;
      if (fetchCount === 1) {
        return new Response('Server Error', { status: 500 });
      }
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('event: message\ndata: recovered\n\n'));
          controller.close();
        }
      });
      return new Response(mockStream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    try {
      const cleanup = connectCustomSSE({
        url: 'https://voxanex.test/api/chat/conversations/conv_test/events',
        onOpen: () => { openCalled = true; },
        onEvent: () => {}
      });
      await new Promise(r => setTimeout(r, 1500));
      cleanup();

      assert(fetchCount >= 2, 'HTTP 500 Retry Test: Retried after initial 500 error (fetchCount >= 2)');
      assert(openCalled, 'HTTP 500 Retry Test: Successfully reconnected and established stream on subsequent attempt');
    } finally {
      globalThis.fetch = origFetchMock;
    }
  }

  // --- AbortController Cancellation Signal Test ---
  {
    let capturedSignal: AbortSignal | null = null;
    const origFetchMock = globalThis.fetch;
    const mockStream = new ReadableStream({
      start(controller) {}
    });
    globalThis.fetch = async (input, init) => {
      if (init?.signal) {
        capturedSignal = init.signal;
      }
      return new Response(mockStream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    try {
      const cleanup = connectCustomSSE({
        url: 'https://voxanex.test/api/chat/conversations/conv_test/events',
        onEvent: () => {}
      });
      await new Promise(r => setTimeout(r, 40));

      assert(capturedSignal !== null, 'AbortController Test: Fetch signal was captured');
      assert(capturedSignal?.aborted === false, 'AbortController Test: Signal is not aborted before cleanup');

      cleanup();

      assert(capturedSignal?.aborted === true, 'AbortController Test: Signal becomes aborted after cleanup');
    } finally {
      globalThis.fetch = origFetchMock;
    }
  }

  // --- Deterministic Asynchronous Unsubscribe Test ---
  {
    let resolveDeferredToken: ((val: string) => void) | null = null;
    const deferredTokenPromise = new Promise<string>((resolve) => {
      resolveDeferredToken = resolve;
    });

    setTestAuthTokenResolver(async () => {
      return await deferredTokenPromise;
    });

    let fetchCalled = false;
    const origFetchMock = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response('ok', { status: 200 });
    };

    try {
      const unsubscribe = messagingService.subscribeToUserEvents(userA, {
        onMessage: () => {}
      });

      // Unsubscribe synchronously BEFORE deferred token promise resolves
      unsubscribe();

      // Now resolve the token promise
      resolveDeferredToken?.('async_resolved_token');
      await new Promise(r => setTimeout(r, 60));

      assert(!fetchCalled, 'Async Unsubscribe Test: No SSE fetch initiated after asynchronous subscription was unsubscribed prior to token resolution');
    } finally {
      setTestAuthTokenResolver(null);
      globalThis.fetch = origFetchMock;
    }
  }


  // =========================================================================
  // TASK 4: PARSER COMPLETION AND EVENT COVERAGE
  // =========================================================================
  console.log('\n--- Task 4: Parser Completion & Event Coverage ---');
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

      assert(eventsCount === 2, 'Parser Coverage Test: Successfully parsed 2 events across split UTF-8 chunks');
      assert(receivedEvents[0].data.includes('🚀'), 'Parser Coverage Test: UTF-8 multibyte emoji reassembled correctly');
      assert(receivedEvents[1].data === 'line1\nline2', 'Parser Coverage Test: Multiline data fields correctly joined');
    } finally {
      globalThis.fetch = origFetchMock;
    }
  }

  // =========================================================================
  // TASK 5: TEST RESULTS SUMMARY & EXIT CODE
  // =========================================================================
  console.log(`\n--- Test Results Summary ---`);
  console.log(`Total Assertions Executed: ${assertionCount}`);
  console.log(`Passed: ${passedCount}`);
  console.log(`Failed: ${failedCount}`);

  if (failedCount > 0) {
    console.error(`❌ Test suite failed with ${failedCount} error(s).`);
    process.exit(1);
  } else {
    console.log(`✅ All Phase 2.3.4.3 Test Cases PASSED.`);
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Test execution exception:', err);
  process.exit(1);
});
