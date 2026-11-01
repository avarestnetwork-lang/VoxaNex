import worker from '../src/worker';
import { connectCustomSSE, messagingService, setTestAuthTokenResolver } from '../src/services/messagingService';

/**
 * Phase 2.3.4.5 — Restore SSE Regression Coverage & Correct Guest Configuration Tests
 */

let passedCount = 0;
let failedCount = 0;
let assertionCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  assertionCount++;
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}${detail ? ` (${detail})` : ''}`);
    failedCount++;
  } else {
    console.log(`✅ [PASSED] ${testName}`);
    passedCount++;
  }
}

async function createTestGuestToken(sid: string, secret: string, expiresAt?: number): Promise<string> {
  const iat = Date.now();
  const exp = expiresAt ?? (iat + 86400000);
  const payload = { sid, nick: 'Test_Guest', av: '⚡', gen: 'prefer_not_to_say', lng: 'en', v18: true, iat, exp };
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(base64Payload));
  const sigHex = Array.from(new Uint8Array(sigBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `vx_gst_${base64Payload}.${sigHex}`;
}

async function computeTokenHash(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function runTests() {
  console.log('--- VoxaNex Phase 2.3.4.5 Test Suite ---\n');

  const secret = 'test_guest_secret_key_32_bytes_long!!';
  const dbEnv = {
    ENVIRONMENT: 'development',
    DEV: true,
    SUPABASE_URL: 'https://voxanex.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test_service_role_key',
    SUPABASE_ANON_KEY: 'test_anon_key',
    GUEST_SESSION_SECRET: secret,
  };

  const guestA = '00000000-0000-4000-b000-000000000001';
  const tokenA = await createTestGuestToken(guestA, secret);
  const hashA = await computeTokenHash(tokenA);
  const origFetch = globalThis.fetch;

  // Task 1: 15-Scenario Guest Matrix
  console.log('--- Task 1: Guest Session Database Integrity Matrix ---');
  async function runGuestTest(scenarioName: string, mockFetchHandler: () => Response | Promise<Response>, expectedStatus: number, env: any = dbEnv) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (urlStr.includes('/rest/v1/guest_sessions')) return await mockFetchHandler();
      return origFetch(input, init);
    }) as typeof fetch;
    try {
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, { method: 'GET', headers: { 'Authorization': `Bearer ${tokenA}` } });
      const res = await worker.fetch(req, env);
      assert(res.status === expectedStatus, `Guest Matrix: ${scenarioName}`);
      await res.body?.cancel();
    } finally { globalThis.fetch = origFetch; }
  }

  await runGuestTest('1. Valid', () => new Response(JSON.stringify([{ id: guestA, session_token_hash: hashA, is_revoked: false, expires_at: new Date(Date.now() + 86400000).toISOString() }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 200);
  await runGuestTest('2. Zero rows', () => new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('3. Multiple rows', () => new Response(JSON.stringify([{ id: guestA }, { id: guestA }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('4. Non-array', () => new Response(JSON.stringify({ id: guestA }), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('5. Malformed JSON', () => new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } }), 401);
  await runGuestTest('6. SID mismatch', () => new Response(JSON.stringify([{ id: 'other' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('7. Hash mismatch', () => new Response(JSON.stringify([{ id: guestA, session_token_hash: 'bad' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('8. Revoked true', () => new Response(JSON.stringify([{ id: guestA, session_token_hash: hashA, is_revoked: true }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('9. Missing revoked', () => new Response(JSON.stringify([{ id: guestA, session_token_hash: hashA }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('10. Revoked null', () => new Response(JSON.stringify([{ id: guestA, session_token_hash: hashA, is_revoked: null }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('11. Revoked "false"', () => new Response(JSON.stringify([{ id: guestA, session_token_hash: hashA, is_revoked: 'false' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('12. Revoked 0', () => new Response(JSON.stringify([{ id: guestA, session_token_hash: hashA, is_revoked: 0 }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('13. Expired', () => new Response(JSON.stringify([{ id: guestA, session_token_hash: hashA, is_revoked: false, expires_at: new Date(Date.now() - 1000).toISOString() }]), { status: 200, headers: { 'Content-Type': 'application/json' } }), 401);
  await runGuestTest('14. DB error', () => new Response('Error', { status: 500 }), 401);
  await runGuestTest('15. Missing DB config', () => new Response(JSON.stringify([{ id: guestA }]), { status: 200 }), 401, { ENVIRONMENT: 'development', DEV: true, GUEST_SESSION_SECRET: secret });

  // Task 2: Auth Regressions
  console.log('\n--- Task 2: Auth Regression Tests ---');
  for (const status of [401, 403]) {
    let errStatus = 0;
    let fetches = 0;
    globalThis.fetch = async () => { fetches++; return new Response('Err', { status }); };
    const cleanup = connectCustomSSE({ url: '...', onEvent: () => {}, onAuthError: (s) => errStatus = s });
    await new Promise(r => setTimeout(r, 100));
    cleanup();
    assert(errStatus === status, `Auth Test ${status}`);
    assert(fetches === 1, `Fetch count test ${status}`);
    globalThis.fetch = origFetch;
  }

  // Task 3: 500 Retry
  console.log('\n--- Task 3: HTTP 500 Retry ---');
  {
    let fetchCount = 0;
    globalThis.fetch = async () => { fetchCount++; return fetchCount === 1 ? new Response('Error', { status: 500 }) : new Response('data: ok\n\n', { headers: { 'Content-Type': 'text/event-stream' } }); };
    const cleanup = connectCustomSSE({ url: '...', onEvent: () => {} });
    await new Promise(r => setTimeout(r, 1500));
    const count = fetchCount;
    cleanup();
    await new Promise(r => setTimeout(r, 500));
    assert(count >= 2, 'Retry occurred');
    assert(fetchCount === count, 'No further retry');
    globalThis.fetch = origFetch;
  }

  // Task 4: Cancellation
  console.log('\n--- Task 4: Stream Cancellation ---');
  {
    let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } });
    const cleanup = connectCustomSSE({ url: '...', onEvent: () => {} });
    await new Promise(r => setTimeout(r, 100));
    cleanup();
    await new Promise(r => setTimeout(r, 100));
    assert(cancelled, 'Stream terminated');
    globalThis.fetch = origFetch;
  }

  // Task 5: Parser
  console.log('\n--- Task 5: Parser Regression ---');
  {
    const events: any[] = [];
    globalThis.fetch = async () => new Response('event: named\ndata: 1\n\ndata: default\n\n: comment\ndata: end\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    const cleanup = connectCustomSSE({ url: '...', onEvent: (e, d) => events.push({ e, d }) });
    await new Promise(r => setTimeout(r, 100));
    cleanup();
    assert(events.length === 3, '3 events parsed');
    globalThis.fetch = origFetch;
  }

  // Task 6: Unsubscribe
  console.log('\n--- Task 6: Deferred Unsubscribe ---');
  {
    let resolved = false;
    setTestAuthTokenResolver(async () => { await new Promise(r => setTimeout(r, 100)); resolved = true; return 'token'; });
    let fetched = false;
    globalThis.fetch = async () => { fetched = true; return new Response('ok'); };
    const unsub = messagingService.subscribeToUserEvents(guestA, { onMessage: () => {} });
    unsub();
    await new Promise(r => setTimeout(r, 200));
    assert(!fetched, 'Fetch never started');
    setTestAuthTokenResolver(null);
    globalThis.fetch = origFetch;
  }

  console.log(`\nResults: Assertions: ${assertionCount}, Passed: ${passedCount}, Failed: ${failedCount}`);
  process.exit(failedCount > 0 ? 1 : 0);
}
runTests().catch(err => { console.error(err); process.exit(1); });
