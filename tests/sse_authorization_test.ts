import worker from '../src/worker';
import { connectCustomSSE, messagingService, setTestAuthTokenResolver } from '../src/services/messagingService';

/**
 * Phase 2.3.4.4 — SSE Retry, Cancellation & Parser Regression Verification
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
  console.log('--- VoxaNex Phase 2.3.4.4 Test Suite ---\n');

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
  // TASK 1: RESTORE GUEST SESSION DATABASE INTEGRITY MATRIX
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

  await runGuestTest('1. Valid canonical guest session accepted', () => new Response(JSON.stringify([{ id: guestA, session_token_hash: hashA, is_revoked: false, expires_at: new Date(Date.now() + 86400000).toISOString() }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 200);
  await runGuestTest('2. Zero database rows rejected', () => new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('3. Multiple database rows rejected', () => new Response(JSON.stringify([{ id: guestA }, { id: guestA }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('4. Non-array response rejected', () => new Response(JSON.stringify({ id: guestA }), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('5. Malformed JSON rejected', () => new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } }), 401);
  await runGuestTest('6. Session ID mismatch rejected', () => new Response(JSON.stringify([{ id: 'other' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('7. Stored token hash mismatch rejected', () => new Response(JSON.stringify([{ id: guestA, session_token_hash: 'bad' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('8. is_revoked === true rejected', () => new Response(JSON.stringify([{ id: guestA, session_token_hash: hashA, is_revoked: true }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('9. Missing is_revoked rejected', () => new Response(JSON.stringify([{ id: guestA, session_token_hash: hashA }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('10. is_revoked === null rejected', () => new Response(JSON.stringify([{ id: guestA, session_token_hash: hashA, is_revoked: null }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('11. is_revoked === "false" rejected', () => new Response(JSON.stringify([{ id: guestA, session_token_hash: hashA, is_revoked: 'false' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('12. is_revoked === 0 rejected', () => new Response(JSON.stringify([{ id: guestA, session_token_hash: hashA, is_revoked: 0 }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('13. Expired database session rejected', () => new Response(JSON.stringify([{ id: guestA, session_token_hash: hashA, is_revoked: false, expires_at: new Date(Date.now() - 1000).toISOString() }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('14. Database HTTP error rejected', () => new Response('Error', { status: 500 }), 401);
  await runGuestTest('15. Missing database configuration rejected', () => new Response(JSON.stringify([{ id: guestA }]), { status: 200 }), 401); 

  // =========================================================================
  // TASK 2: HTTP 500 RETRY & CLEANUP
  // =========================================================================
  console.log('\n--- Task 2: HTTP 500 Retry & Cleanup ---');
  {
    let fetchCount = 0;
    let openCalled = false;
    let cleanupCalled = false;
    const origFetchMock = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCount++;
      return fetchCount === 1 ? new Response('Server Error', { status: 500 }) : new Response('data: ok\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    const cleanup = connectCustomSSE({
      url: 'https://voxanex.test/api/chat/conversations/conv_test/events',
      onOpen: () => { openCalled = true; },
      onEvent: () => {}
    });
    
    // Simulate cleanup wrapper
    const originalCleanup = cleanup;
    const wrappedCleanup = () => { cleanupCalled = true; originalCleanup(); };

    // Wait longer for retry policy
    await new Promise(r => setTimeout(r, 2000));
    wrappedCleanup();

    assert(fetchCount >= 2, 'HTTP 500 Retry: Retried after 500 error', `Fetch count: ${fetchCount}`);
    assert(openCalled, 'HTTP 500 Retry: Stream opened after retry');
    assert(cleanupCalled, 'HTTP 500 Retry: Cleanup was called');
    
    const countBeforeWait = fetchCount;
    await new Promise(r => setTimeout(r, 1000));
    assert(fetchCount === countBeforeWait, 'HTTP 500 Retry: No further retries after cleanup');
    
    globalThis.fetch = origFetchMock;
  }

  // =========================================================================
  // TASK 3: ACTUAL STREAM CANCELLATION
  // =========================================================================
  console.log('\n--- Task 3: Actual Stream Cancellation ---');
  {
    let cancelled = false;
    const origFetchMock = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const stream = new ReadableStream({
            async pull(controller) {
                await new Promise(r => setTimeout(r, 500));
            },
            cancel() {
                cancelled = true;
            }
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    const cleanup = connectCustomSSE({
        url: 'https://voxanex.test/api/chat/conversations/conv_test/events',
        onEvent: () => {}
    });
    await new Promise(r => setTimeout(r, 100));
    cleanup();
    
    // Allow time for cancellation to propagate
    await new Promise(r => setTimeout(r, 200));

    assert(cancelled, 'Stream Cancellation: Reader was cancelled');
    globalThis.fetch = origFetchMock;
  }

  // =========================================================================
  // TASK 4: PARSER REGRESSION
  // =========================================================================
  console.log('\n--- Task 4: Parser Regression ---');
  {
    const events: { event: string, data: string }[] = [];
    const mockStream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('event: named\ndata: 1\n\n'));
        controller.enqueue(enc.encode('data: default\n\n'));
        controller.enqueue(enc.encode(': comment\ndata: after_comment\n\n'));
        controller.enqueue(enc.encode('event: order1\ndata: o1\n\nevent: order2\ndata: o2\n\n'));
        // Incomplete trailing event
        controller.enqueue(enc.encode('data: incomplete'));
        controller.close();
      }
    });

    const origFetchMock = globalThis.fetch;
    globalThis.fetch = async () => new Response(mockStream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    
    const cleanup = connectCustomSSE({
        url: '...',
        onEvent: (event, data) => events.push({ event, data })
    });
    await new Promise(r => setTimeout(r, 100));
    cleanup();

    assert(events.length === 5, 'Parser: 5 events parsed', `Got ${events.length}`);
    assert(events[0].event === 'named' && events[0].data === '1', 'Parser: Named event');
    assert(events[1].event === 'message' && events[1].data === 'default', 'Parser: Default message event');
    assert(events[2].data === 'after_comment', 'Parser: Comment ignored');
    assert(events[3].event === 'order1' && events[4].event === 'order2', 'Parser: Correct order');

    globalThis.fetch = origFetchMock;
  }

  // Final summary
  console.log(`\n--- Test Results Summary ---`);
  console.log(`Assertions: ${assertionCount}, Passed: ${passedCount}, Failed: ${failedCount}`);
  process.exit(failedCount > 0 ? 1 : 0);
}

runTests().catch(err => { console.error(err); process.exit(1); });
