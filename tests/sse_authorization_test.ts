import worker from '../src/worker';

/**
 * Phase 2.3 — SSE Authorization & Realtime Security Regression Test Suite
 */

function assert(condition: boolean, testName: string, detail?: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}${detail ? ` (${detail})` : ''}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ [PASSED] ${testName}`);
  }
}

async function runTests() {
  console.log('--- VoxaNex Phase 2.3 SSE Authorization Verification ---\n');

  const env = {
    ENVIRONMENT: 'development',
    DEV: true,
    GUEST_SESSION_SECRET: 'test_guest_secret_key_32_bytes_long!!',
  };

  const userA = '00000000-0000-4000-a000-000000000001';
  const userB = '00000000-0000-4000-a000-000000000002';
  const userC = '00000000-0000-4000-a000-000000000003';

  // Test 1: Unauthenticated user events SSE stream -> MUST return 401
  {
    const req = new Request(`https://voxanex.test/api/chat/user/${userA}/events`, {
      method: 'GET',
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 401, 'Unauthenticated user SSE stream request returns HTTP 401');
    const body = await res.json();
    assert(body.success === false, 'Unauthenticated user SSE response success is false');
  }

  // Test 2: Unauthenticated conversation events SSE stream -> MUST return 401
  {
    const convId = `conv_${[userA, userB].sort().join('_')}`;
    const req = new Request(`https://voxanex.test/api/chat/conversations/${convId}/events`, {
      method: 'GET',
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 401, 'Unauthenticated conversation SSE stream request returns HTTP 401');
  }

  // Test 3: Authenticated non-member request to conversation SSE stream -> MUST return 403
  {
    const convId = `conv_${[userA, userB].sort().join('_')}`;
    const fakeTokenUserC = `header.${Buffer.from(JSON.stringify({ sub: userC, id: userC })).toString('base64url')}.sig`;
    const req = new Request(`https://voxanex.test/api/chat/conversations/${convId}/events`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${fakeTokenUserC}`,
      },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 403, 'Authenticated non-member caller to conversation SSE returns HTTP 403 Forbidden');
  }

  // Test 4: Authenticated user accessing another user's DM stream -> MUST return 403
  {
    const fakeTokenUserC = `header.${Buffer.from(JSON.stringify({ sub: userC, id: userC })).toString('base64url')}.sig`;
    const req = new Request(`https://voxanex.test/api/chat/user/${userA}/events`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${fakeTokenUserC}`,
      },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 403, 'Caller requesting user events stream for a different user ID returns HTTP 403');
  }

  // Test 5: Authenticated member accessing their user DM stream -> Returns 200 text/event-stream
  {
    const fakeTokenUserA = `header.${Buffer.from(JSON.stringify({ sub: userA, id: userA })).toString('base64url')}.sig`;
    const req = new Request(`https://voxanex.test/api/chat/user/${userA}/events`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${fakeTokenUserA}`,
      },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 200, 'Authenticated user requesting own events stream returns HTTP 200');
    assert(
      (res.headers.get('content-type') || '').includes('text/event-stream'),
      'User events stream returns text/event-stream content-type'
    );
    await res.body?.cancel();
  }

  // Test 6: Authenticated member accessing conversation SSE stream -> Returns 200 text/event-stream
  {
    const convId = `conv_${[userA, userB].sort().join('_')}`;
    const fakeTokenUserA = `header.${Buffer.from(JSON.stringify({ sub: userA, id: userA })).toString('base64url')}.sig`;
    const req = new Request(`https://voxanex.test/api/chat/conversations/${convId}/events`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${fakeTokenUserA}`,
      },
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 200, 'Authenticated conversation participant requesting conversation SSE stream returns HTTP 200');
    assert(
      (res.headers.get('content-type') || '').includes('text/event-stream'),
      'Conversation events stream returns text/event-stream content-type'
    );
    await res.body?.cancel();
  }

  // Test 7: Public room SSE stream remains open without auth
  {
    const req = new Request('https://voxanex.test/api/chat/rooms/lounge/events', {
      method: 'GET',
    });
    const res = await worker.fetch(req, env);
    assert(res.status === 200, 'Public room SSE stream remains accessible with HTTP 200');
    assert(
      (res.headers.get('content-type') || '').includes('text/event-stream'),
      'Public room stream returns text/event-stream content-type'
    );
    await res.body?.cancel();
  }

  console.log('\n--- All Phase 2.3 SSE Authorization Tests Complete ---');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test execution exception:', err);
  process.exit(1);
});
