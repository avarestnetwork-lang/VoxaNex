import worker from '../src/worker';

// Set mandatory secret for tests
process.env.GUEST_SESSION_SECRET = 'test_secret_for_audit_only';

import {
  createGuestSession,
} from '../src/server/guestSessionManager';

async function computeHash(token: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function assert(condition: boolean, testName: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ [PASSED] ${testName}`);
  }
}

const ROOM_ID = '11111111-1111-1111-1111-111111111111';
const env = { 
    GUEST_SESSION_SECRET: 'test_secret_for_audit_only',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    ENVIRONMENT: 'development'
};

async function runRouteTests() {
  console.log('\n--- STARTING ROUTE AUTHORIZATION REGRESSION TESTS ---\n');

  // Case 1: Valid guest message
  {
    const sessionRes = createGuestSession({
        nickname: 'RealGuest',
        avatar: '⚡',
        languagePref: 'en',
        is18Verified: false,
        ipAddress: '127.0.0.1'
    });
    const token = sessionRes.session!.token;
    const tokenHash = await computeHash(token);

    globalThis.fetch = (async (url: any) => {
        const u = url.toString();
        if (u.includes('/rest/v1/guest_sessions')) {
            return new Response(JSON.stringify([{ 
                id: sessionRes.session!.id, 
                session_token_hash: tokenHash, 
                is_revoked: false, 
                expires_at: new Date(Date.now() + 100000).toISOString() 
            }]), { status: 200 });
        }
        if (u.includes('/rpc/upsert_message')) return new Response(JSON.stringify([{ 
            inserted: true, 
            id: 'msg1', 
            content: 'Valid guest message',
            sender_nickname: 'RealGuest',
            sender_avatar: '⚡',
            created_at: new Date().toISOString()
        }]), { status: 200 });
        if (u.includes('/rest/v1/rooms')) return new Response(JSON.stringify([{ id: ROOM_ID }]), { status: 200 });
        return new Response('Not Found', { status: 404 });
    }) as any;

    const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Valid guest message',
        senderType: 'guest',
        guestToken: token
      })
    });
    const res = await worker.fetch(req, env, {});
    assert(res.status === 200, '1. Valid guest message accepted');
    const data: any = await res.json();
    assert(data.message.senderNickname === 'RealGuest', '1. Nickname derived from session');
  }

  // Case 2: Missing token
  {
    const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'No token', senderType: 'guest' })
    });
    const res = await worker.fetch(req, env, {});
    assert(res.status === 401, '2. Missing token rejected with 401');
  }

  // Case 3: Missing senderType (defaults to guest)
  {
    const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'No senderType' })
    });
    const res = await worker.fetch(req, env, {});
    assert(res.status === 401, '3. Missing senderType defaults to guest and requires token (401)');
  }

  // Case 4: Client-supplied identity spoofing rejection
  {
    const sessionRes = createGuestSession({
        nickname: 'LegitName',
        avatar: '⚡',
        languagePref: 'en',
        is18Verified: false,
        ipAddress: '127.0.0.1'
    });
    const token = sessionRes.session!.token;
    const tokenHash = await computeHash(token);

    globalThis.fetch = (async (url: any) => {
        const u = url.toString();
        if (u.includes('/rest/v1/guest_sessions')) {
            return new Response(JSON.stringify([{ 
                id: sessionRes.session!.id, 
                session_token_hash: tokenHash, 
                is_revoked: false, 
                expires_at: new Date(Date.now() + 100000).toISOString() 
            }]), { status: 200 });
        }
        if (u.includes('/rpc/upsert_message')) return new Response(JSON.stringify([{ 
            inserted: true, 
            id: 'msg2', 
            content: 'Spoof attempt',
            sender_nickname: 'LegitName', 
            sender_avatar: '⚡',
            sender_guest_id: sessionRes.session!.id,
            created_at: new Date().toISOString()
        }]), { status: 200 });
        if (u.includes('/rest/v1/rooms')) return new Response(JSON.stringify([{ id: ROOM_ID }]), { status: 200 });
        return new Response('Not Found', { status: 404 });
    }) as any;

    // Subcase 4a: Mismatching senderId is rejected with 403
    {
        const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: 'ID spoof',
                senderType: 'guest',
                guestToken: token,
                senderId: 'evil-id'
            })
        });
        const res = await worker.fetch(req, env, {});
        assert(res.status === 403, '4a. Mismatching senderId rejected with 403');
    }

    // Subcase 4b: Correct senderId but spoofed nickname is overridden by session
    {
        const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: 'Nick spoof',
                senderType: 'guest',
                guestToken: token,
                senderId: sessionRes.session!.id,
                senderNickname: 'HackerName'
            })
        });
        const res = await worker.fetch(req, env, {});
        assert(res.status === 200, '4b. Nick spoof message accepted');
        const data: any = await res.json();
        assert(data.message.senderNickname === 'LegitName', '4b. Spoofed nickname ignored, session identity used');
    }
  }

  // Case 5: Unsupported sender type
  {
    const sessionRes = createGuestSession({
        nickname: 'Any',
        avatar: '⚡',
        languagePref: 'en',
        is18Verified: false,
        ipAddress: '127.0.0.1'
    });
    const token = sessionRes.session!.token;
    const tokenHash = await computeHash(token);

    globalThis.fetch = (async (url: any) => {
        const u = url.toString();
        if (u.includes('/rest/v1/guest_sessions')) {
            return new Response(JSON.stringify([{ 
                id: sessionRes.session!.id, 
                session_token_hash: tokenHash, 
                is_revoked: false, 
                expires_at: new Date(Date.now() + 100000).toISOString() 
            }]), { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
    }) as any;

    const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
          content: 'Invalid type', 
          senderType: 'bot',
          guestToken: token
      })
    });
    const res = await worker.fetch(req, env, {});
    assert(res.status === 400, '5. Unsupported sender type rejected with 400');
  }

  // Case 6: Revoked guest token
  {
    const sessionRes = createGuestSession({
        nickname: 'RevokedUser',
        avatar: '⚡',
        languagePref: 'en',
        is18Verified: false,
        ipAddress: '127.0.0.1'
    });
    const token = sessionRes.session!.token;
    const tokenHash = await computeHash(token);

    globalThis.fetch = (async (url: any) => {
        const u = url.toString();
        if (u.includes('/rest/v1/guest_sessions')) {
            return new Response(JSON.stringify([{ 
                id: sessionRes.session!.id, 
                session_token_hash: tokenHash, 
                is_revoked: true, // REVOKED
                expires_at: new Date(Date.now() + 100000).toISOString() 
            }]), { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
    }) as any;

    const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Revoked msg',
        senderType: 'guest',
        guestToken: token
      })
    });
    const res = await worker.fetch(req, env, {});
    assert(res.status === 401, '6. Revoked guest token rejected with 401');
  }

  // Case 7: Registered user behavior preservation
  {
    const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    globalThis.fetch = (async (url: any) => {
        const u = url.toString();
        if (u.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: userId }), { status: 200 });
        if (u.includes('/rest/v1/profiles')) return new Response(JSON.stringify([{ nickname: 'MemberNick', avatar_url: '👤' }]), { status: 200 });
        if (u.includes('/rpc/upsert_message')) return new Response(JSON.stringify([{ 
            inserted: true, 
            id: 'msg-reg', 
            content: 'Member message',
            sender_nickname: 'MemberNick',
            sender_avatar: '👤',
            sender_user_id: userId,
            created_at: new Date().toISOString()
        }]), { status: 200 });
        if (u.includes('/rest/v1/rooms')) return new Response(JSON.stringify([{ id: ROOM_ID }]), { status: 200 });
        return new Response('Not Found', { status: 404 });
    }) as any;

    const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID}/messages`, {
      method: 'POST',
      headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer valid-member-jwt'
      },
      body: JSON.stringify({
        content: 'Member message',
        senderType: 'registered',
        senderId: userId
      })
    });
    const res = await worker.fetch(req, env, {});
    assert(res.status === 200, '7. Registered member message accepted');
    const data: any = await res.json();
    assert(data.message.senderNickname === 'MemberNick', '7. Member nickname derived correctly');
  }

  console.log('\n--- ROUTE AUTHORIZATION TESTS COMPLETED ---\n');
}

runRouteTests().catch(console.error);
