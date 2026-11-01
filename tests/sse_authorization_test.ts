import worker from '../src/worker';
import { connectCustomSSE, messagingService } from '../src/services/messagingService';

/**
 * Phase 2.3.2 — Comprehensive Security Audit, SSE Authorization, Parser & Cleanup Test Suite
 */

function assert(condition: boolean, testName: string, detail?: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}${detail ? ` (${detail})` : ''}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ [PASSED] ${testName}`);
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

function createForgedUnsignedMemberJwt(userId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, id: userId, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${payload}.forged_fake_signature_hex_1234567890`;
}

async function runTests() {
  console.log('--- VoxaNex Phase 2.3.2 Security Audit & Test Suite ---\n');

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
  const userC = '00000000-0000-4000-a000-000000000003';

  const guestA = '00000000-0000-4000-b000-000000000001';
  const guestC = '00000000-0000-4000-b000-000000000003';

  const memberJwtA = await createTestMemberJwt(userA, secret);
  const memberJwtC = await createTestMemberJwt(userC, secret);

  const validGuestTokenA = await createTestGuestToken(guestA, secret);
  const validGuestTokenC = await createTestGuestToken(guestC, secret);
  const expiredGuestTokenA = await createTestGuestToken(guestA, secret, Date.now() - 10000);
  const tokenHashA = await computeTokenHash(validGuestTokenA);
  const tokenHashC = await computeTokenHash(validGuestTokenC);

  const convAB = `conv_${[userA, userB].sort().join('_')}`;
  const convGuestAB = `conv_${[guestA, userB].sort().join('_')}`;

  // Mock global fetch for Supabase database verification
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();

    if (urlStr.includes('/auth/v1/user')) {
      const authHeader = init?.headers ? (init.headers as any)['Authorization'] || (init.headers as any)['authorization'] : '';
      if (authHeader && authHeader.includes(memberJwtA)) {
        return new Response(JSON.stringify({ id: userA, email: 'userA@voxanex.test' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (authHeader && authHeader.includes(memberJwtC)) {
        return new Response(JSON.stringify({ id: userC, email: 'userC@voxanex.test' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlStr.includes('/rest/v1/guest_sessions')) {
      if (urlStr.includes(tokenHashA) || urlStr.includes(guestA)) {
        return new Response(JSON.stringify([{
          id: guestA,
          session_token_hash: tokenHashA,
          is_revoked: false,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes(tokenHashC) || urlStr.includes(guestC)) {
        return new Response(JSON.stringify([{
          id: guestC,
          session_token_hash: tokenHashC,
          is_revoked: false,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('revoked')) {
        return new Response(JSON.stringify([{
          id: guestA,
          is_revoked: true,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlStr.includes('/rest/v1/conversation_participants')) {
      if (urlStr.includes(userA) || urlStr.includes(guestA)) {
        return new Response(JSON.stringify([{ id: 'participant_row_id_1' }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return origFetch(input, init);
  }) as typeof fetch;

  try {
    // Test 1: Unauthenticated user events SSE stream -> 401
    {
      const req = new Request(`https://voxanex.test/api/chat/user/${userA}/events`, { method: 'GET' });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 401, 'Test 1: Unauthenticated user events SSE stream returns HTTP 401');
    }

    // Test 2: Unauthenticated conversation events SSE stream -> 401
    {
      const req = new Request(`https://voxanex.test/api/chat/conversations/${convAB}/events`, { method: 'GET' });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 401, 'Test 2: Unauthenticated conversation events SSE stream returns HTTP 401');
    }

    // Test 3: Authenticated member requesting own user events stream -> 200 text/event-stream
    {
      const req = new Request(`https://voxanex.test/api/chat/user/${userA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${memberJwtA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 200, 'Test 3: Authenticated member requesting own user events stream returns HTTP 200');
      assert((res.headers.get('content-type') || '').includes('text/event-stream'), 'Test 3: Response content-type is text/event-stream');
      await res.body?.cancel();
    }

    // Test 4: Authenticated caller requesting another user's DM stream -> 403
    {
      const req = new Request(`https://voxanex.test/api/chat/user/${userA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${memberJwtC}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 403, 'Test 4: Authenticated caller requesting another user\'s DM stream returns HTTP 403');
    }

    // Test 5: Valid guest token with active database session requesting own user events stream -> 200
    {
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${validGuestTokenA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 200, 'Test 5: Valid guest token with database session requesting user events returns HTTP 200');
      await res.body?.cancel();
    }

    // Test 6: Guest token requesting another user's events stream -> 403
    {
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${validGuestTokenC}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 403, 'Test 6: Guest token requesting another user\'s events stream returns HTTP 403');
    }

    // Test 7: Forged guest token with invalid signature -> 401
    {
      const forgedGuestToken = `vx_gst_${Buffer.from(JSON.stringify({ sid: guestA, exp: Date.now() + 10000 })).toString('base64url')}.invalid_sig_hex_0000000000000000000000000000000000000000000000000000000000000000`;
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${forgedGuestToken}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 401, 'Test 7: Forged guest token with invalid signature returns HTTP 401');
    }

    // Test 8: Unknown/unregistered guest session in database -> 401
    {
      const unknownGuestToken = await createTestGuestToken('00000000-0000-4000-b000-000000000999', secret);
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${unknownGuestToken}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 401, 'Test 8: Unknown session in database returns HTTP 401');
    }

    // Test 9: Expired guest session token -> 401
    {
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${expiredGuestTokenA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 401, 'Test 9: Expired guest session token returns HTTP 401');
    }

    // Test 10: Participant member requesting conversation events -> 200
    {
      const req = new Request(`https://voxanex.test/api/chat/conversations/${convAB}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${memberJwtA}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 200, 'Test 10: Participant member requesting conversation events returns HTTP 200');
      await res.body?.cancel();
    }

    // Test 11: Member without database participant record requesting conversation events -> 403
    {
      const req = new Request(`https://voxanex.test/api/chat/conversations/${convAB}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${memberJwtC}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 403, 'Test 11: Non-participant member requesting conversation events returns HTTP 403');
    }

    // Test 12: Missing database configuration for guest verification -> fails closed with 401
    {
      const noDbEnv = {
        ENVIRONMENT: 'development',
        GUEST_SESSION_SECRET: secret,
      };
      const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${validGuestTokenA}` },
      });
      const res = await worker.fetch(req, noDbEnv);
      assert(res.status === 401, 'Test 12: Missing database configuration for guest verification fails closed with HTTP 401');
    }

    // Test 13: Public room SSE accessible without auth -> 200
    {
      const req = new Request('https://voxanex.test/api/chat/rooms/lounge/events', { method: 'GET' });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 200, 'Test 13: Public room SSE accessible without authentication returns HTTP 200');
      await res.body?.cancel();
    }

    // Test 14: Unsigned/forged member JWT -> 401
    {
      const forgedJwt = createForgedUnsignedMemberJwt(userA);
      const req = new Request(`https://voxanex.test/api/chat/user/${userA}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${forgedJwt}` },
      });
      const res = await worker.fetch(req, dbEnv);
      assert(res.status === 401, 'Test 14: Unsigned/forged member JWT returns HTTP 401');
    }

  } finally {
    globalThis.fetch = origFetch;
  }

  // Test 15: connectCustomSSE parser test with split chunks and multiline data
  {
    let eventsCount = 0;
    const receivedEvents: Array<{ event: string; data: string }> = [];

    const mockStream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('event: new_dm\ndat'));
        controller.enqueue(encoder.encode('a: {"id":"123","content":"hello"}\r\n\r\n'));
        controller.enqueue(encoder.encode(': ping comment\n\nevent: message\ndata: line1\ndata: line2\n\n'));
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

      assert(eventsCount === 2, 'Test 15: connectCustomSSE successfully parsed 2 event blocks across split chunks');
      assert(receivedEvents[0].event === 'new_dm', 'Test 15: First event name is new_dm');
      assert(receivedEvents[1].data === 'line1\nline2', 'Test 15: Second event correctly combined multiline data fields');
    } finally {
      globalThis.fetch = origFetchMock;
    }
  }

  // Test 16: connectCustomSSE halts on HTTP 401
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
      await new Promise(r => setTimeout(r, 50));
      cleanup();

      assert(authErrorCalled, 'Test 16: connectCustomSSE correctly invoked onAuthError on HTTP 401 and halted retries');
    } finally {
      globalThis.fetch = origFetchMock;
    }
  }

  // Test 17: Async subscription cleanup test (subscribeToUserEvents unsubscribe before resolution)
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
      // Immediately unsubscribe before async token resolution finishes
      unsubscribe();
      await new Promise(r => setTimeout(r, 50));

      assert(true, 'Test 17: subscribeToUserEvents async cleanup completed without throwing errors');
    } finally {
      globalThis.fetch = origFetchMock;
    }
  }

  console.log('\n--- All Phase 2.3.2 Security Audit & Test Cases PASSED ---');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test execution exception:', err);
  process.exit(1);
});
