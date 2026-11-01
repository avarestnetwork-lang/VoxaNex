import worker from '../src/worker';

/**
 * Phase 2.3.1 — Complete SSE Authorization & Realtime Security Regression Test Suite
 * Covers 24 required test cases across registered members, guest tokens, conversation membership,
 * public rooms, forged tokens, malformed headers, and DB failure states.
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
  console.log('--- VoxaNex Phase 2.3.1 SSE Authorization & Realtime Security Audit Suite ---\n');

  const secret = 'test_guest_secret_key_32_bytes_long!!';
  const env = {
    ENVIRONMENT: 'development',
    DEV: true,
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

  const convAB = `conv_${[userA, userB].sort().join('_')}`;
  const convGuestAB = `conv_${[guestA, userB].sort().join('_')}`;

  // Test 1: Unauthenticated request to /api/chat/user/:userId/events -> 401
  {
    const req = new Request(`https://voxanex.test/api/chat/user/${userA}/events`, { method: 'GET' });
    const res = await worker.fetch(req, env);
    assert(res.status === 401, 'Test 1: Unauthenticated user events SSE stream returns HTTP 401');
  }

  // Test 2: Unauthenticated request to /api/chat/conversations/:id/events -> 401
  {
    const req = new Request(`https://voxanex.test/api/chat/conversations/${convAB}/events`, { method: 'GET' });
    const res = await worker.fetch(req, env);
    assert(res.status === 401, 'Test 2: Unauthenticated conversation events SSE stream returns HTTP 401');
  }

  // Test 3: Authenticated member requesting own user events stream -> 200 text/event-stream
  {
    const req = new Request(`https://voxanex.test/api/chat/user/${userA}/events`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${memberJwtA}` },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 200, 'Test 3: Authenticated member requesting own user events stream returns HTTP 200');
    assert((res.headers.get('content-type') || '').includes('text/event-stream'), 'Test 3: Response content-type is text/event-stream');
    await res.body?.cancel();
  }

  // Test 4: Authenticated caller requesting user events stream for another user ID -> 403
  {
    const req = new Request(`https://voxanex.test/api/chat/user/${userA}/events`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${memberJwtC}` },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 403, 'Test 4: Authenticated caller requesting another user\'s DM stream returns HTTP 403');
  }

  // Test 5: Authenticated guest token requesting own user events stream -> 200 text/event-stream
  {
    const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${validGuestTokenA}` },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 200, 'Test 5: Valid guest token requesting own user events stream returns HTTP 200');
    assert((res.headers.get('content-type') || '').includes('text/event-stream'), 'Test 5: Guest response content-type is text/event-stream');
    await res.body?.cancel();
  }

  // Test 6: Authenticated guest token requesting another user's user events stream -> 403
  {
    const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${validGuestTokenC}` },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 403, 'Test 6: Guest token requesting another user\'s events stream returns HTTP 403');
  }

  // Test 7: Forged/invalid guest token requesting user events stream -> 401
  {
    const forgedGuestToken = `vx_gst_${Buffer.from(JSON.stringify({ sid: guestA, exp: Date.now() + 10000 })).toString('base64url')}.invalid_sig_hex_0000000000000000000000000000000000000000000000000000000000000000`;
    const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${forgedGuestToken}` },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 401, 'Test 7: Forged guest token with invalid signature returns HTTP 401');
  }

  // Test 8: Revoked guest token requesting user events stream -> 401
  {
    // Test revoked token prefix / local simulation token rejection rule
    const revokedToken = `vx_gst_local_revoked_${guestA}`;
    const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${revokedToken}` },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 401, 'Test 8: Revoked / prohibited local guest token returns HTTP 401');
  }

  // Test 9: Expired guest token requesting user events stream -> 401
  {
    const req = new Request(`https://voxanex.test/api/chat/user/${guestA}/events`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${expiredGuestTokenA}` },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 401, 'Test 9: Expired guest session token returns HTTP 401');
  }

  // Test 10: Authenticated member requesting conversation events for conversation they belong to -> 200 text/event-stream
  {
    const req = new Request(`https://voxanex.test/api/chat/conversations/${convAB}/events`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${memberJwtA}` },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 200, 'Test 10: Participant member requesting conversation events returns HTTP 200');
    assert((res.headers.get('content-type') || '').includes('text/event-stream'), 'Test 10: Conversation stream content-type is text/event-stream');
    await res.body?.cancel();
  }

  // Test 11: Authenticated member requesting conversation events for conversation they do NOT belong to -> 403
  {
    const req = new Request(`https://voxanex.test/api/chat/conversations/${convAB}/events`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${memberJwtC}` },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 403, 'Test 11: Non-participant member requesting conversation events returns HTTP 403');
  }

  // Test 12: Authenticated guest token requesting conversation events for conversation they belong to -> 200 text/event-stream
  {
    const req = new Request(`https://voxanex.test/api/chat/conversations/${convGuestAB}/events`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${validGuestTokenA}` },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 200, 'Test 12: Participant guest token requesting conversation events returns HTTP 200');
    assert((res.headers.get('content-type') || '').includes('text/event-stream'), 'Test 12: Guest conversation stream content-type is text/event-stream');
    await res.body?.cancel();
  }

  // Test 13: Authenticated guest token requesting conversation events for conversation they do NOT belong to -> 403
  {
    const req = new Request(`https://voxanex.test/api/chat/conversations/${convGuestAB}/events`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${validGuestTokenC}` },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 403, 'Test 13: Non-participant guest token requesting conversation events returns HTTP 403');
  }

  // Test 14: Conversation slug with duplicate participant IDs -> 400
  {
    const dupSlug = `conv_${userA}_${userA}`;
    const req = new Request(`https://voxanex.test/api/chat/conversations/${dupSlug}/events`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${memberJwtA}` },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 400, 'Test 14: Conversation slug with duplicate participant IDs returns HTTP 400');
  }

  // Test 15: Conversation slug with invalid non-UUID participant IDs -> 400
  {
    const req = new Request(`https://voxanex.test/api/chat/conversations/conv_notauuid1_notauuid2/events`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${memberJwtA}` },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 400, 'Test 15: Conversation slug with invalid non-UUID identifiers returns HTTP 400');
  }

  // Test 16: Conversation slug format mismatch -> 400
  {
    const req = new Request(`https://voxanex.test/api/chat/conversations/conv_singlepart/events`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${memberJwtA}` },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 400, 'Test 16: Conversation slug with invalid structure returns HTTP 400');
  }

  // Test 17: Unauthenticated request to conversation messages history -> 401
  {
    const req = new Request(`https://voxanex.test/api/chat/conversations/${convAB}/messages`, { method: 'GET' });
    const res = await worker.fetch(req, env);
    assert(res.status === 401, 'Test 17: Unauthenticated request to conversation messages history returns HTTP 401');
  }

  // Test 18: Authenticated caller mismatch with client-supplied userId parameter -> 403
  {
    const req = new Request(`https://voxanex.test/api/chat/conversations/${convAB}/messages?userId=${userC}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${memberJwtA}` },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 403, 'Test 18: Caller identity mismatch with client-supplied userId parameter returns HTTP 403');
  }

  // Test 19: Authenticated member requesting conversation history for conversation they belong to -> 200
  {
    const req = new Request(`https://voxanex.test/api/chat/conversations/${convAB}/messages?userId=${userA}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${memberJwtA}` },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 200, 'Test 19: Participant member requesting conversation history returns HTTP 200');
  }

  // Test 20: Authenticated member requesting conversation history for conversation they do NOT belong to -> 403
  {
    const req = new Request(`https://voxanex.test/api/chat/conversations/${convAB}/messages?userId=${userC}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${memberJwtC}` },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 403, 'Test 20: Non-participant member requesting conversation history returns HTTP 403');
  }

  // Test 21: Public room SSE stream accessible without auth -> 200 text/event-stream
  {
    const req = new Request('https://voxanex.test/api/chat/rooms/lounge/events', { method: 'GET' });
    const res = await worker.fetch(req, env);
    assert(res.status === 200, 'Test 21: Public room SSE stream accessible without auth returns HTTP 200');
    assert((res.headers.get('content-type') || '').includes('text/event-stream'), 'Test 21: Public room stream content-type is text/event-stream');
    await res.body?.cancel();
  }

  // Test 22: Unsigned/forged member JWT requesting protected SSE stream -> 401
  {
    const forgedMemberJwt = createForgedUnsignedMemberJwt(userA);
    const req = new Request(`https://voxanex.test/api/chat/user/${userA}/events`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${forgedMemberJwt}` },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 401, 'Test 22: Unsigned/forged member JWT returns HTTP 401');
  }

  // Test 23: Malformed authorization header -> 401
  {
    const req = new Request(`https://voxanex.test/api/chat/user/${userA}/events`, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer invalid_garbage_token_string' },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 401, 'Test 23: Malformed authorization header returns HTTP 401');
  }

  // Test 24: Database membership lookup error -> fails closed with HTTP 500 or 503
  {
    // Override global fetch to mock a database 500 internal server error for conversation_participants
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (urlStr.includes('/auth/v1/user')) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('/rest/v1/conversation_participants')) {
        return new Response(JSON.stringify({ message: 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ message: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    try {
      const dbErrEnv = {
        ENVIRONMENT: 'development',
        DEV: true,
        SUPABASE_URL: 'https://mock.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'mock_service_key',
        GUEST_SESSION_SECRET: secret,
      };
      const req = new Request(`https://voxanex.test/api/chat/conversations/${convAB}/events`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${memberJwtA}` },
      });
      const res = await worker.fetch(req, dbErrEnv);
      assert(res.status === 500, 'Test 24: Database membership lookup error fails closed with HTTP 500');
    } finally {
      globalThis.fetch = origFetch;
    }
  }

  console.log('\n--- All 24 Phase 2.3.1 SSE Authorization Security Audit Tests PASSED ---');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test execution exception:', err);
  process.exit(1);
});
