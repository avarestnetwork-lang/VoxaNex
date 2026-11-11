import { createExpressApp } from '../server';
import { createGuestSession } from '../src/server/guestSessionManager';
import crypto from 'crypto';

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

async function runDurablePersistenceTests() {
  console.log('\n========================================================================');
  console.log('  CHATLUSTORA: GUEST SESSION DURABLE PERSISTENCE & VALIDATION TESTS');
  console.log('========================================================================\n');

  process.env.GUEST_SESSION_SECRET = 'test_durable_secret_entropy_32_bytes_xyz!!';

  const origFetch = globalThis.fetch;
  const dbGuestSessions: any[] = [];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' 
      ? input 
      : (input instanceof Request ? input.url : input.toString());

    // Bypass mock for local express server test client calls
    if (urlStr.startsWith('http://127.0.0.1') || urlStr.startsWith('http://localhost')) {
      return origFetch(input, init);
    }

    const urlObj = new URL(urlStr);
    const method = init?.method || 'GET';

    if (urlObj.pathname.includes('/rest/v1/guest_sessions')) {
      if (method === 'POST') {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
        if (body.nickname === 'FailInsert') {
          return new Response(JSON.stringify({ error: 'DB error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
        dbGuestSessions.push(body);
        return new Response(JSON.stringify([body]), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (method === 'GET') {
        const hashParam = urlObj.searchParams.get('session_token_hash');
        const hash = hashParam?.startsWith('eq.') ? hashParam.slice(3) : hashParam;
        const found = dbGuestSessions.filter(s => s.session_token_hash === hash && s.is_revoked !== true);
        return new Response(JSON.stringify(found), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (method === 'PATCH') {
        const hashParam = urlObj.searchParams.get('session_token_hash');
        const hash = hashParam?.startsWith('eq.') ? hashParam.slice(3) : hashParam;
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
        const session = dbGuestSessions.find(s => s.session_token_hash === hash);
        if (session) {
          Object.assign(session, body);
        }
        return new Response(JSON.stringify(session ? [session] : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (urlObj.pathname.includes('/auth/v1/user')) {
      const auth = init?.headers && (init.headers as any)['Authorization'];
      if (auth === 'Bearer valid-member-token') {
        return new Response(JSON.stringify({ id: 'member_123' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlObj.pathname.includes('/rest/v1/profiles')) {
      return new Response(JSON.stringify([{ nickname: 'MemberUser', avatar_url: '👤' }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlObj.pathname.includes('/rpc/upsert_message')) {
      return new Response(JSON.stringify([{ inserted: true, id: 'msg_1', content: 'test' }]), { status: 200 });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const app = createExpressApp({
    supabaseUrl: 'https://test.supabase.co',
    supabaseServiceKey: 'test-service-key',
    supabaseAnonKey: 'test-anon-key',
  });

  const server = app.listen(0);
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1 & 2. Guest session creation inserts correct durable record & confirms persistence
    console.log('--- Test 1 & 2: Guest session durable insertion and confirmation ---');
    {
      const res = await fetch(`${baseUrl}/api/guest/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: 'DurableGuest', avatar: '⚡', languagePref: 'en', is18Verified: false }),
      });
      const data = await res.json() as any;

      assert(res.status === 200, '1. Guest session issuance succeeded (HTTP 200)');
      assert(data.success === true, '1. Success is true');
      assert(Boolean(data.session?.token), '1. Token is issued');

      const token = data.session.token;
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      const persistedRecord = dbGuestSessions.find(s => s.session_token_hash === hash);
      assert(persistedRecord !== undefined, '2. Guest session successfully inserted into durable table');
      assert(persistedRecord?.nickname === 'DurableGuest', '2. Persisted nickname matches');
      assert(persistedRecord?.is_revoked === false, '2. Persisted is_revoked is false');
    }

    // 4. Database insert failure returns no usable token
    console.log('\n--- Test 4: Database insert failure protection ---');
    {
      const res = await fetch(`${baseUrl}/api/guest/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: 'FailInsert', avatar: '💥' }),
      });
      assert(res.status === 500, '4. Database insertion failure returns HTTP 500');
      const data = await res.json() as any;
      assert(data.success === false, '4. Success is false');
    }

    // 5 & 8. Newly issued token passes durable verification; missing durable row rejected
    console.log('\n--- Test 5 & 8: Durable verification and missing row rejection ---');
    {
      const sessionRes = createGuestSession({
        nickname: 'VerifyGuest',
        avatar: '🌙',
        languagePref: 'bn',
        is18Verified: false,
        ipAddress: '127.0.0.1',
      });
      const token = sessionRes.session!.token;
      const hash = crypto.createHash('sha256').update(token).digest('hex');

      const valResBefore = await fetch(`${baseUrl}/api/guest/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const valBeforeData = await valResBefore.json() as any;
      assert(valBeforeData.valid === false, '8. Missing durable row is rejected by validate endpoint');

      dbGuestSessions.push({
        id: sessionRes.session!.id,
        session_token_hash: hash,
        nickname: 'VerifyGuest',
        is_revoked: false,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      });

      const valResAfter = await fetch(`${baseUrl}/api/guest/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const valAfterData = await valResAfter.json() as any;
      assert(valAfterData.valid === true, '5. Newly issued token with durable record passes validation');
    }

    // 9. Revoked token is rejected
    console.log('\n--- Test 9: Revoked token rejection ---');
    {
      const sessionRes = createGuestSession({
        nickname: 'RevokeGuest',
        avatar: '⚡',
        languagePref: 'en',
        is18Verified: false,
        ipAddress: '127.0.0.1',
      });
      const token = sessionRes.session!.token;
      const hash = crypto.createHash('sha256').update(token).digest('hex');

      dbGuestSessions.push({
        id: sessionRes.session!.id,
        session_token_hash: hash,
        nickname: 'RevokeGuest',
        is_revoked: false,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      });

      const revRes = await fetch(`${baseUrl}/api/guest/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const revData = await revRes.json() as any;
      assert(revData.success === true, '9. Revocation API call succeeded');

      const valRes = await fetch(`${baseUrl}/api/guest/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const valData = await valRes.json() as any;
      assert(valData.valid === false, '9. Revoked token is rejected by validate endpoint');
    }

    // 13. Member JWT authentication remains unchanged
    console.log('\n--- Test 13: Member authentication preservation ---');
    {
      const res = await fetch(`${baseUrl}/api/chat/rooms/general/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer valid-member-token',
        },
        body: JSON.stringify({
          content: 'Hello member message',
          senderType: 'registered',
          senderId: 'member_123',
        }),
      });
      assert(res.status === 200, '13. Member JWT request accepted (HTTP 200)');
    }

  } finally {
    server.close();
    globalThis.fetch = origFetch;
  }

  console.log('\n========================================================================');
  console.log(`  DURABLE TESTS RESULTS: ${passedTests} PASSED / ${failedTests} FAILED (TOTAL: ${totalTests})`);
  console.log('========================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runDurablePersistenceTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
