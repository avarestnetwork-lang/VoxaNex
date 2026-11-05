/**
 * ChatLustora / VoxaNex — Worker Conversation History Security & Reload Test Suite
 */

import worker from '../src/worker';
import { createGuestSession } from '../src/server/guestSessionManager';

function assert(condition: boolean, testName: string, detail?: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
    throw new Error(`Assertion failed: ${testName} - ${detail || ''}`);
  } else {
    console.log(`✅ [PASSED] ${testName}`);
  }
}

function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return Buffer.from(binary, 'binary').toString('base64url');
}

function createMockJwt(userId: string): string {
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = toBase64Url(JSON.stringify({ sub: userId, id: userId, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${header}.${payload}.mock_signature`;
}

async function computeTokenHash(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function runWorkerHistoryTests() {
  console.log('\n=============================================================');
  console.log('  CHATLUSTORA — WORKER CONVERSATION HISTORY & SECURITY TESTS');
  console.log('=============================================================\n');

  // PRESERVE ACTUAL ORIGINAL FETCH ONCE
  const originalFetchReference = globalThis.fetch;
  
  const mockServiceKey = 'sb_secret_service_role_key_staging_test_2026';
  const mockAnonKey = 'sb_public_anon_key_staging_test_2026';
  const guestSecret = process.env.GUEST_SESSION_SECRET || 'voxanex_default_secure_entropy_salt_2026';

  const guestA = createGuestSession({ nickname: 'GuestAlice', avatar: '⚡', languagePref: 'en', is18Verified: false, ipAddress: '127.0.0.1' });
  const guestB = createGuestSession({ nickname: 'GuestBob', avatar: '🌸', languagePref: 'en', is18Verified: false, ipAddress: '127.0.0.2' });
  const guestC = createGuestSession({ nickname: 'GuestCharlie', avatar: '🛡️', languagePref: 'en', is18Verified: false, ipAddress: '127.0.0.3' });

  const [idA, idB, idC] = [guestA.session!.id, guestB.session!.id, guestC.session!.id];
  const [tokenA, tokenB, tokenC] = [guestA.session!.token, guestB.session!.token, guestC.session!.token];
  const [hashA, hashB, hashC] = [await computeTokenHash(tokenA), await computeTokenHash(tokenB), await computeTokenHash(tokenC)];
  
  const regMember1Id = '44444444-4444-4444-4444-444444444444';
  const regMember2Id = '55555555-5555-5555-5555-555555555555';
  const [regMemberJwt1, regMemberJwt2] = [createMockJwt(regMember1Id), createMockJwt(regMember2Id)];
  const convGuestId = `conv_${[idA, idB].sort().join('_')}`;
  const convRegId = `conv_${[regMember1Id, regMember2Id].sort().join('_')}`;

  const interceptedCalls: Array<{ url: string; headers: Record<string, string>; method: string }> = [];
  const storedMessages: any[] = [];

  // COMPOSABLE FETCH MOCK
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input.toString();
    const urlObj = new URL(urlStr);
    const method = init?.method || 'GET';
    const headers = (init?.headers || {}) as Record<string, string>;
    interceptedCalls.push({ url: urlStr, headers, method });

    // 1. Messages REST & RPC
    if (urlObj.pathname.includes('/rpc/upsert_message')) {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
      const newMsg = {
        id: body.p_id || 'msg_' + Date.now(),
        conversation_id: body.p_conversation_id,
        room_id: body.p_room_id || null,
        sender_guest_id: body.p_sender_guest_id || null,
        sender_user_id: body.p_sender_user_id || null,
        sender_nickname: body.p_sender_nickname,
        sender_avatar: body.p_sender_avatar,
        content: body.p_content,
        client_nonce: body.p_client_nonce || null,
        created_at: new Date().toISOString(),
      };
      storedMessages.push(newMsg);
      return new Response(JSON.stringify([{
        id: newMsg.id,
        room_id: newMsg.room_id,
        conversation_id: newMsg.conversation_id,
        sender_user_id: newMsg.sender_user_id,
        sender_guest_id: newMsg.sender_guest_id,
        sender_nickname: newMsg.sender_nickname,
        sender_avatar: newMsg.sender_avatar,
        content: newMsg.content,
        client_nonce: newMsg.client_nonce,
        created_at: newMsg.created_at,
        inserted: true
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlObj.pathname.includes('/rest/v1/messages')) {
      if (method === 'POST') {
        const body = JSON.parse(init?.body as string || '{}');
        storedMessages.push({
          id: body.id || 'msg_' + Date.now(),
          conversation_id: body.conversation_id,
          sender_guest_id: body.sender_guest_id || null,
          sender_user_id: body.sender_user_id || null,
          sender_nickname: body.sender_nickname,
          sender_avatar: body.sender_avatar,
          content: body.content,
          created_at: new Date().toISOString(),
        });
        return new Response(JSON.stringify({ success: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify(storedMessages), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // 2. Guest Sessions (Auth Verification)
    if (urlObj.pathname.includes('/rest/v1/guest_sessions')) {
      const hashParam = urlObj.searchParams.get('session_token_hash');
      const hash = hashParam?.startsWith('eq.') ? hashParam.slice(3) : hashParam;
      
      const sid = hash === hashA ? idA : hash === hashB ? idB : hash === hashC ? idC : 'unknown';
      if (sid === 'unknown') return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      
      return new Response(JSON.stringify([{ 
        id: sid, 
        session_token_hash: hash, 
        is_revoked: false, 
        expires_at: new Date(Date.now() + 86400000).toISOString() 
      }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // 3. Auth User (Registered Member Verification)
    if (urlObj.pathname.includes('/auth/v1/user')) {
      const auth = headers['Authorization'] || headers['authorization'] || '';
      if (auth.includes(regMemberJwt1)) return new Response(JSON.stringify({ id: regMember1Id }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (auth.includes(regMemberJwt2)) return new Response(JSON.stringify({ id: regMember2Id }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ error: 'invalid' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    // 4. Conversation Participants (Membership Check)
    if (urlObj.pathname.includes('/rest/v1/conversation_participants')) {
      // Check if Guest C is being looked up (who is not in Alice-Bob conversation)
      const guestIdParam = urlObj.searchParams.get('guest_id');
      const guestId = guestIdParam?.startsWith('eq.') ? guestIdParam.slice(3) : guestIdParam;
      
      if (guestId === idC) {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      
      return new Response(JSON.stringify([
        { id: 'part_1', guest_id: idA, user_id: null },
        { id: 'part_2', guest_id: idB, user_id: null },
        { id: 'part_3', user_id: regMember1Id, guest_id: null },
        { id: 'part_4', user_id: regMember2Id, guest_id: null },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // 5. Default Pass-through/Success
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const env = { 
    SUPABASE_URL: 'https://iccxxsuincnqwbfyypho.supabase.co', 
    SUPABASE_ANON_KEY: mockAnonKey, 
    SUPABASE_SERVICE_ROLE_KEY: mockServiceKey, 
    GUEST_SESSION_SECRET: guestSecret, 
    ENVIRONMENT: 'development', 
    DEV: true 
  };

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Missing authentication credentials
    // -------------------------------------------------------------------------
    console.log('--- Test 1: Missing credentials ---');
    const reqNoAuth = new Request(`https://worker.test/api/chat/conversations/${convGuestId}/messages?userId=${idA}`, { method: 'GET' });
    const resNoAuth = await worker.fetch(reqNoAuth, env, {} as any);
    assert(resNoAuth.status === 401, '1.1 Missing credentials rejected with 401 Unauthorized');
    const dataNoAuth = (await resNoAuth.json()) as { success?: boolean };
    assert(dataNoAuth.success === false, '1.2 Response JSON success is false');

    // -------------------------------------------------------------------------
    // TEST 2: Invalid guest token
    // -------------------------------------------------------------------------
    console.log('\n--- Test 2: Invalid guest token ---');
    const reqInvalidGuest = new Request(`https://worker.test/api/chat/conversations/${convGuestId}/messages?userId=${idA}&guestToken=vx_gst_invalid.signature`, { method: 'GET' });
    const resInvalidGuest = await worker.fetch(reqInvalidGuest, env, {} as any);
    assert(resInvalidGuest.status === 401, '2.1 Invalid guest token rejected with 401 Unauthorized');

    // -------------------------------------------------------------------------
    // TEST 3: Invalid member bearer token
    // -------------------------------------------------------------------------
    console.log('\n--- Test 3: Invalid member bearer token ---');
    const reqInvalidMember = new Request(`https://worker.test/api/chat/conversations/${convRegId}/messages`, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer invalid_garbage_token_not_a_jwt' },
    });
    const resInvalidMember = await worker.fetch(reqInvalidMember, env, {} as any);
    assert(resInvalidMember.status === 401, '3.1 Invalid member bearer token rejected with 401 Unauthorized');

    // -------------------------------------------------------------------------
    // TEST 4: Client-supplied user ID mismatch
    // -------------------------------------------------------------------------
    console.log('\n--- Test 4: Client userId mismatch ---');
    const reqMismatch = new Request(`https://worker.test/api/chat/conversations/${convGuestId}/messages?userId=${idB}&guestToken=${tokenA}`, { method: 'GET' });
    const resMismatch = await worker.fetch(reqMismatch, env, {} as any);
    assert(resMismatch.status === 403, '4.1 Token identity mismatch with query param rejected with 403 Forbidden');

    // -------------------------------------------------------------------------
    // TEST 5: Unauthorized participant
    // -------------------------------------------------------------------------
    console.log('\n--- Test 5: Unauthorized participant ---');
    const reqUnauthorized = new Request(`https://worker.test/api/chat/conversations/${convGuestId}/messages?guestToken=${tokenC}`, { method: 'GET' });
    const resUnauthorized = await worker.fetch(reqUnauthorized, env, {} as any);
    assert(resUnauthorized.status === 403, '5.1 Valid non-member token rejected with 403 Forbidden');

    // -------------------------------------------------------------------------
    // TEST 6: Empty history access
    // -------------------------------------------------------------------------
    console.log('\n--- Test 6: Empty history access ---');
    interceptedCalls.length = 0;
    const reqEmptyHistory = new Request(`https://worker.test/api/chat/conversations/${convGuestId}/messages?guestToken=${tokenA}`, { method: 'GET' });
    const resEmptyHistory = await worker.fetch(reqEmptyHistory, env, {} as any);
    assert(resEmptyHistory.status === 200, '6.1 Authorized empty history access returns 200 OK');
    const dataEmptyHistory = (await resEmptyHistory.json()) as { success?: boolean; messages?: any[] };
    assert(dataEmptyHistory.success === true, '6.2 Success is true');
    assert(Array.isArray(dataEmptyHistory.messages) && dataEmptyHistory.messages.length === 0, '6.3 Messages is empty array');

    // -------------------------------------------------------------------------
    // TEST 7: Post and retrieve history as authorized Guest
    // -------------------------------------------------------------------------
    console.log('\n--- Test 7: Authorized guest history access ---');
    const postReq = new Request(`https://worker.test/api/chat/conversations/${convGuestId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderId: idA,
        senderNickname: 'GuestAlice',
        senderAvatar: '⚡',
        recipientId: idB,
        content: 'Hello Bob! This is a test message.',
        clientNonce: `nonce_${Date.now()}`,
        guestToken: tokenA,
      }),
    });
    const postRes = await worker.fetch(postReq, env, {} as any);
    assert(postRes.status === 200, '7.1 Message posted successfully');

    interceptedCalls.length = 0;
    const reqBobHistory = new Request(`https://worker.test/api/chat/conversations/${convGuestId}/messages?guestToken=${tokenB}`, { method: 'GET' });
    const resBobHistory = await worker.fetch(reqBobHistory, env, {} as any);
    assert(resBobHistory.status === 200, '7.2 Bob retrieves history with 200 OK');
    const dataBobHistory = (await resBobHistory.json()) as { success?: boolean; messages?: any[] };
    assert(dataBobHistory.success === true, '7.3 History response success is true');
    assert(dataBobHistory.messages?.length === 1, '7.4 Retrieved exactly 1 message');

    // -------------------------------------------------------------------------
    // TEST 8: Authorized registered member history access
    // -------------------------------------------------------------------------
    console.log('\n--- Test 8: Authorized member history access ---');
    storedMessages.length = 0;
    storedMessages.push({
      id: 'reg_msg_101',
      conversation_id: convRegId,
      sender_user_id: regMember1Id,
      content: 'Private registered message',
      created_at: new Date().toISOString(),
    });

    const reqMemberHistory = new Request(`https://worker.test/api/chat/conversations/${convRegId}/messages`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${regMemberJwt2}` },
    });
    const resMemberHistory = await worker.fetch(reqMemberHistory, env, {} as any);
    assert(resMemberHistory.status === 200, '8.1 Registered member retrieves history with 200 OK');
    const dataMemberHistory = (await resMemberHistory.json()) as { success?: boolean; messages?: any[] };
    assert(dataMemberHistory.success === true, '8.2 Registered history success is true');
    assert(dataMemberHistory.messages?.length === 1, '8.3 Member retrieved message');

    console.log('\n=============================================================');
    console.log('  ALL WORKER CONVERSATION HISTORY TESTS COMPLETED SUCCESSFULLY');
    console.log('=============================================================\n');
  } finally {
    // RESTORE EXACT ORIGINAL FETCH Reference
    globalThis.fetch = originalFetchReference;
    
    // Final verification that fetch was restored
    if (globalThis.fetch !== originalFetchReference) {
        console.error('CRITICAL: Fetch was NOT restored correctly!');
        process.exitCode = 1;
    } else {
        console.log('✅ Fetch mock successfully removed and original restored.');
    }
  }
}

runWorkerHistoryTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
