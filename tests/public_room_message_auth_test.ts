import worker from '../src/worker';
import { databaseService } from '../src/services/databaseService';

/**
 * VoxaNex Public Room & Private Message Authentication, Idempotency & Concurrency Test Suite
 * Exercises actual Worker request handling, stateful database mock, and observability.
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

const GUEST_SECRET = 'test-guest-secret-32-chars-long-!!';
const SUPABASE_URL = 'https://abc.supabase.co';
const SERVICE_KEY = 'service-role-key';
const ROOM_ID_1 = '11111111-1111-1111-1111-111111111111';
const ROOM_ID_2 = '22222222-2222-2222-2222-222222222222';

const env = {
  GUEST_SESSION_SECRET: GUEST_SECRET,
  SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  ENVIRONMENT: 'development'
};

// Helper to create a guest token
async function createGuestToken(payload: any) {
  const encoder = new TextEncoder();
  const toBase64Url = (str: string) => Buffer.from(str).toString('base64url');
  const base64Payload = toBase64Url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey('raw', encoder.encode(GUEST_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(base64Payload));
  const sigHex = Array.from(new Uint8Array(sigBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `vx_gst_${base64Payload}.${sigHex}`;
}

async function computeHash(token: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface MockDbMessage {
  id: string;
  room_id: string | null;
  conversation_id: string | null;
  sender_user_id: string | null;
  sender_guest_id: string | null;
  sender_nickname: string;
  sender_avatar: string;
  content: string;
  media_url?: string | null;
  media_type?: string | null;
  link_preview?: any | null;
  client_nonce: string | null;
  created_at: string;
  is_system: boolean;
  is_flagged: boolean;
}

class StatefulMockDatabase {
  messages: MockDbMessage[] = [];
  broadcastCalls: Array<{ channel: string; payload: any }> = [];

  reset() {
    this.messages = [];
    this.broadcastCalls = [];
  }

  handleUpsert(body: any): Response {
    // 1. Target validation
    const hasRoom = Boolean(body.p_room_id);
    const hasConv = Boolean(body.p_conversation_id);
    if ((!hasRoom && !hasConv) || (hasRoom && hasConv)) {
      return new Response(JSON.stringify({ message: 'Invalid target: exactly one of room_id or conversation_id must be provided.' }), { status: 400 });
    }

    // 2. Sender validation
    const hasReg = Boolean(body.p_sender_user_id);
    const hasGuest = Boolean(body.p_sender_guest_id);
    if ((!hasReg && !hasGuest) || (hasReg && hasGuest)) {
      return new Response(JSON.stringify({ message: 'Invalid sender: exactly one of sender_user_id or sender_guest_id must be provided.' }), { status: 400 });
    }

    // 3. Content and media validation (matches upsert_message SQL)
    const content = body.p_content;
    const mediaUrl = body.p_media_url;
    const hasContent = typeof content === 'string' && content.trim().length > 0;
    const hasMedia = typeof mediaUrl === 'string' && mediaUrl.trim().length > 0;

    if (!hasContent && !hasMedia) {
      return new Response(JSON.stringify({ message: 'Message content or media URL is required.' }), { status: 400 });
    }

    if (hasContent && content.length > 2000) {
      return new Response(JSON.stringify({ message: 'Message content exceeds 2000 characters.' }), { status: 400 });
    }

    // 4. Stateful partial unique index checks
    if (body.p_client_nonce) {
      let existing: MockDbMessage | undefined;
      if (hasRoom && hasReg) {
        existing = this.messages.find(m => m.room_id === body.p_room_id && m.sender_user_id === body.p_sender_user_id && m.client_nonce === body.p_client_nonce);
      } else if (hasRoom && hasGuest) {
        existing = this.messages.find(m => m.room_id === body.p_room_id && m.sender_guest_id === body.p_sender_guest_id && m.client_nonce === body.p_client_nonce);
      } else if (hasConv && hasReg) {
        existing = this.messages.find(m => m.conversation_id === body.p_conversation_id && m.sender_user_id === body.p_sender_user_id && m.client_nonce === body.p_client_nonce);
      } else if (hasConv && hasGuest) {
        existing = this.messages.find(m => m.conversation_id === body.p_conversation_id && m.sender_guest_id === body.p_sender_guest_id && m.client_nonce === body.p_client_nonce);
      }

      if (existing) {
        return new Response(JSON.stringify([{
          ...existing,
          inserted: false
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // Fresh insert
    const newRow: MockDbMessage = {
      id: body.p_id || crypto.randomUUID(),
      room_id: body.p_room_id || null,
      conversation_id: body.p_conversation_id || null,
      sender_user_id: body.p_sender_user_id || null,
      sender_guest_id: body.p_sender_guest_id || null,
      sender_nickname: body.p_sender_nickname,
      sender_avatar: body.p_sender_avatar || '💬',
      content: body.p_content || '',
      media_url: body.p_media_url || null,
      media_type: body.p_media_type || null,
      link_preview: body.p_link_preview || null,
      client_nonce: body.p_client_nonce || null,
      created_at: new Date().toISOString(),
      is_system: false,
      is_flagged: false
    };

    this.messages.push(newRow);

    return new Response(JSON.stringify([{
      ...newRow,
      inserted: true
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
}

const mockDb = new StatefulMockDatabase();

async function runTests() {
  console.log('🚀 Starting Public Room & Private Message Security & Idempotency Tests...');
  const originalFetch = globalThis.fetch;
  const originalBroadcastMessage = databaseService.broadcastMessage;
  const originalBroadcastDM = databaseService.broadcastDM;
  const originalBroadcastToUser = databaseService.broadcastToUser;

  try {
    // -------------------------------------------------------------------------
    // 1. Registered Identity & Profile Fallback
    // -------------------------------------------------------------------------
    
    // Case 1.1: Valid registered user - identity derived from profile
    {
      const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      globalThis.fetch = (async (url: any, init: any) => {
        const urlStr = url.toString();
        if (urlStr.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: userId }), { status: 200 });
        if (urlStr.includes('/rest/v1/profiles')) return new Response(JSON.stringify([{ nickname: 'RealNick', avatar_url: 'RealAvatar' }]), { status: 200 });
        if (urlStr.includes('/rest/v1/rooms')) return new Response(JSON.stringify([{ id: ROOM_ID_1 }]), { status: 200 });
        if (urlStr.includes('/rpc/upsert_message')) {
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
          return mockDb.handleUpsert(body);
        }
        return new Response('Not Found', { status: 404 });
      }) as any;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer valid-jwt', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Hello',
          senderId: userId,
          senderType: 'registered',
          senderNickname: 'ForgeNick',
          senderAvatar: 'ForgeAvatar'
        })
      });

      const res = await worker.fetch(req, env, {});
      const data: any = await res.json();
      assert(res.status === 200, '1.1: Response 200');
      assert(data.message.senderNickname === 'RealNick', '1.1: Nickname derived from profile');
      assert(data.message.senderAvatar === 'RealAvatar', '1.1: Avatar derived from profile');
    }

    // Case 1.2: Registered profile lookup failure fallback
    {
      const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      globalThis.fetch = (async (url: any, init: any) => {
        const urlStr = url.toString();
        if (urlStr.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: userId }), { status: 200 });
        if (urlStr.includes('/rest/v1/profiles')) return new Response('DB Error', { status: 500 });
        if (urlStr.includes('/rest/v1/rooms')) return new Response(JSON.stringify([{ id: ROOM_ID_1 }]), { status: 200 });
        if (urlStr.includes('/rpc/upsert_message')) {
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
          return mockDb.handleUpsert(body);
        }
        return new Response('Not Found', { status: 404 });
      }) as any;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer valid-jwt', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Hello',
          senderId: userId,
          senderType: 'registered',
          senderNickname: 'ForgeNick'
        })
      });

      const res = await worker.fetch(req, env, {});
      const data: any = await res.json();
      assert(res.status === 200, '1.2: Response 200');
      assert(data.message.senderNickname === 'User', '1.2: Fallback to server default nickname');
      assert(data.message.senderAvatar === '👤', '1.2: Fallback to server default avatar');
    }

    // Case 1.3: Registered profile missing fields fallback
    {
      const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      globalThis.fetch = (async (url: any, init: any) => {
        const urlStr = url.toString();
        if (urlStr.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: userId }), { status: 200 });
        if (urlStr.includes('/rest/v1/profiles')) return new Response(JSON.stringify([{ nickname: null, avatar_url: null }]), { status: 200 });
        if (urlStr.includes('/rest/v1/rooms')) return new Response(JSON.stringify([{ id: ROOM_ID_1 }]), { status: 200 });
        if (urlStr.includes('/rpc/upsert_message')) {
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
          return mockDb.handleUpsert(body);
        }
        return new Response('Not Found', { status: 404 });
      }) as any;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer valid-jwt', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Hello',
          senderId: userId,
          senderType: 'registered',
          senderNickname: 'ForgeNick',
          senderAvatar: 'ForgeAvatar'
        })
      });

      const res = await worker.fetch(req, env, {});
      const data: any = await res.json();
      assert(res.status === 200, '1.3: Response 200');
      assert(data.message.senderNickname === 'User', '1.3: Fallback to server default on null profile data');
    }

    // -------------------------------------------------------------------------
    // 2. Guest Authentication & Precedence
    // -------------------------------------------------------------------------

    // Case 2.1: Legacy body guestToken accepted
    {
      const guestId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
      const token = await createGuestToken({ sid: guestId, nick: 'GuestAlice', exp: Date.now() + 10000, iat: Date.now() });
      const tokenHash = await computeHash(token);

      globalThis.fetch = (async (url: any, init: any) => {
        const urlStr = url.toString();
        if (urlStr.includes('/rest/v1/guest_sessions')) {
          return new Response(JSON.stringify([{ id: guestId, is_revoked: false, expires_at: new Date(Date.now() + 10000).toISOString(), session_token_hash: tokenHash }]), { status: 200 });
        }
        if (urlStr.includes('/rest/v1/rooms')) return new Response(JSON.stringify([{ id: ROOM_ID_1 }]), { status: 200 });
        if (urlStr.includes('/rpc/upsert_message')) {
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
          return mockDb.handleUpsert(body);
        }
        return new Response('Not Found', { status: 404 });
      }) as any;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Guest Msg',
          senderId: guestId,
          senderType: 'guest',
          guestToken: token
        })
      });

      const res = await worker.fetch(req, env, {});
      const data: any = await res.json();
      assert(res.status === 200, '2.1: Legacy body token accepted');
      assert(data.message.senderId === guestId, '2.1: Identity derived correctly');
    }

    // Case 2.2: Matching header and body guest tokens accepted
    {
      const guestId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
      const token = await createGuestToken({ sid: guestId, nick: 'GuestAlice', exp: Date.now() + 10000, iat: Date.now() });
      const tokenHash = await computeHash(token);

      globalThis.fetch = (async (url: any, init: any) => {
        const urlStr = url.toString();
        if (urlStr.includes('/rest/v1/guest_sessions')) {
          return new Response(JSON.stringify([{ id: guestId, is_revoked: false, expires_at: new Date(Date.now() + 10000).toISOString(), session_token_hash: tokenHash }]), { status: 200 });
        }
        if (urlStr.includes('/rest/v1/rooms')) return new Response(JSON.stringify([{ id: ROOM_ID_1 }]), { status: 200 });
        if (urlStr.includes('/rpc/upsert_message')) {
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
          return mockDb.handleUpsert(body);
        }
        return new Response('Not Found', { status: 404 });
      }) as any;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          content: 'Guest Msg',
          senderId: guestId,
          senderType: 'guest',
          guestToken: token
        })
      });

      const res = await worker.fetch(req, env, {});
      assert(res.status === 200, '2.2: Matching header/body tokens accepted');
    }

    // Case 2.3: Conflicting header and body tokens rejected
    {
      const token1 = await createGuestToken({ sid: '11111111-1111-1111-1111-111111111111', nick: 'G1', exp: Date.now() + 10000, iat: Date.now() });
      const token2 = await createGuestToken({ sid: '22222222-2222-2222-2222-222222222222', nick: 'G2', exp: Date.now() + 10000, iat: Date.now() });

      const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token1}`
        },
        body: JSON.stringify({
          content: 'Guest Msg',
          senderType: 'guest',
          guestToken: token2
        })
      });

      const res = await worker.fetch(req, env, {});
      const data: any = await res.json();
      assert(res.status === 400, '2.3: Conflicting tokens rejected');
      assert(data.error.includes('Conflicting guest authentication'), '2.3: Correct error message');
    }

    // Case 2.4: Registered wins over guest token
    {
      const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const guestToken = await createGuestToken({ sid: '77777777-7777-7777-7777-777777777777', nick: 'G', exp: Date.now() + 10000, iat: Date.now() });
      
      globalThis.fetch = (async (url: any, init: any) => {
        const urlStr = url.toString();
        if (urlStr.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: userId }), { status: 200 });
        if (urlStr.includes('/rest/v1/profiles')) return new Response(JSON.stringify([{ nickname: 'User', avatar_url: '👤' }]), { status: 200 });
        if (urlStr.includes('/rest/v1/rooms')) return new Response(JSON.stringify([{ id: ROOM_ID_1 }]), { status: 200 });
        if (urlStr.includes('/rpc/upsert_message')) {
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
          return mockDb.handleUpsert(body);
        }
        return new Response('Not Found', { status: 404 });
      }) as any;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer valid-jwt', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Hi',
          senderId: userId,
          senderType: 'registered',
          guestToken: guestToken
        })
      });

      const res = await worker.fetch(req, env, {});
      const data: any = await res.json();
      assert(res.status === 200, '2.4: Registered JWT takes precedence');
      assert(data.message.senderType === 'registered', '2.4: senderType is registered');
    }

    // Case 2.5: Invalid registered JWT with guest token is strictly rejected with 401 (no silent downgrade)
    {
      const guestToken = await createGuestToken({ sid: '77777777-7777-7777-7777-777777777777', nick: 'G', exp: Date.now() + 10000, iat: Date.now() });
      globalThis.fetch = (async (url: any) => {
        const urlStr = url.toString();
        if (urlStr.includes('/auth/v1/user')) return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401 });
        return new Response('Not Found', { status: 404 });
      }) as any;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer bad-jwt', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hi', senderType: 'registered', guestToken })
      });

      const res = await worker.fetch(req, env, {});
      assert(res.status === 401, '2.5: Invalid member JWT cannot silently downgrade to guest (401)');
    }

    // -------------------------------------------------------------------------
    // 3. senderType & Identity Spoofing Validation
    // -------------------------------------------------------------------------

    // Case 3.1: Missing senderType
    {
      const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      globalThis.fetch = (async (url: any) => {
        if (url.toString().includes('/auth/v1/user')) return new Response(JSON.stringify({ id: userId }), { status: 200 });
        return new Response('Not Found', { status: 404 });
      }) as any;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hi', senderId: userId })
      });

      const res = await worker.fetch(req, env, {});
      assert(res.status === 400, '3.1: Missing senderType rejected');
    }

    // Case 3.2: Unsupported senderType
    {
      const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hi', senderType: 'hacker' })
      });
      const res = await worker.fetch(req, env, {});
      assert(res.status === 400, '3.2: Unsupported senderType rejected');
    }

    // Case 3.3: Type mismatch (Registered session claiming guest type)
    {
      const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      globalThis.fetch = (async (url: any) => {
        if (url.toString().includes('/auth/v1/user')) return new Response(JSON.stringify({ id: userId }), { status: 200 });
        return new Response('Not Found', { status: 404 });
      }) as any;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hi', senderId: userId, senderType: 'guest' })
      });

      const res = await worker.fetch(req, env, {});
      assert(res.status === 403, '3.3: Registered session cannot claim guest type');
    }

    // Case 3.4: Sender ID spoofing attempt
    {
      const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const spoofId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      globalThis.fetch = (async (url: any) => {
        if (url.toString().includes('/auth/v1/user')) return new Response(JSON.stringify({ id: userId }), { status: 200 });
        return new Response('Not Found', { status: 404 });
      }) as any;

      const req = new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer jwt', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hi', senderId: spoofId, senderType: 'registered' })
      });

      const res = await worker.fetch(req, env, {});
      assert(res.status === 403, '3.4: Spoofed senderId rejected with 403');
    }

    // -------------------------------------------------------------------------
    // 4. Public Room Concurrency, Scoping & Duplicate Broadcast Suppression
    // -------------------------------------------------------------------------
    mockDb.reset();
    let dbBroadcastCalls: Array<{ channel: string; message: any }> = [];
    databaseService.broadcastMessage = async (channel: string, message: any, client?: any) => {
      dbBroadcastCalls.push({ channel, message });
      return 'ok';
    };
    databaseService.broadcastDM = async (channel: string, recipientId: string, message: any, client?: any) => {
      dbBroadcastCalls.push({ channel, message });
      return 'ok' as any;
    };
    databaseService.broadcastToUser = async (userId: string, event: string, payload: any, client?: any) => {
      dbBroadcastCalls.push({ channel: userId, message: payload });
      return 'ok' as any;
    };

    const setupPublicMockFetch = () => {
      globalThis.fetch = (async (url: any, init: any) => {
        const urlStr = url.toString();
        if (urlStr.includes('/auth/v1/user')) {
          const auth = init?.headers?.Authorization || init?.headers?.authorization || '';
          if (auth.includes('user-1')) return new Response(JSON.stringify({ id: '11111111-0000-0000-0000-000000000001' }), { status: 200 });
          if (auth.includes('user-2')) return new Response(JSON.stringify({ id: '22222222-0000-0000-0000-000000000002' }), { status: 200 });
          return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
        }
        if (urlStr.includes('/rest/v1/profiles')) return new Response(JSON.stringify([{ nickname: 'N', avatar_url: 'A' }]), { status: 200 });
        if (urlStr.includes('/rest/v1/rooms')) return new Response(JSON.stringify([{ id: ROOM_ID_1 }, { id: ROOM_ID_2 }]), { status: 200 });
        if (urlStr.includes('/rpc/upsert_message')) {
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
          return mockDb.handleUpsert(body);
        }
        return new Response('Not Found', { status: 404 });
      }) as any;
    };

    // Case 4.1: Same sender, same room, same nonce: exactly one persisted row & duplicate broadcast suppressed
    {
      setupPublicMockFetch();
      const user1 = '11111111-0000-0000-0000-000000000001';
      const nonce = 'room-nonce-abc';

      // Connect an authentic SSE stream listener to observe Worker room broadcasts
      const sseRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/events`, {
        headers: { 'Authorization': 'Bearer user-1' }
      }), env, { waitUntil: () => {} });
      assert(sseRes.status === 200, '4.1: Room SSE stream connection established');
      const reader = sseRes.body!.getReader();
      const initChunk = await reader.read();
      assert(new TextDecoder().decode(initChunk.value).includes('event: connected'), '4.1: Room SSE stream emitted connected event');

      const initialBroadcastCount = dbBroadcastCalls.length;

      const postMsg = () => worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer user-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello World', senderId: user1, senderType: 'registered', clientNonce: nonce })
      }), env, { waitUntil: () => {} });

      // First call (fresh insertion)
      const res1 = await postMsg();
      const data1: any = await res1.json();
      assert(res1.status === 200, '4.1: Initial message returned 200');
      const initialId = data1.message.id;

      // Observable broadcast 1: SSE reader receives new_message
      const sseMsgChunk = await reader.read();
      const sseMsgText = new TextDecoder().decode(sseMsgChunk.value);
      assert(sseMsgText.includes('event: new_message') && sseMsgText.includes(initialId), '4.1: Newly inserted message produced expected SSE broadcast');

      // Observable broadcast 2: DatabaseService broadcast was invoked
      assert(dbBroadcastCalls.length === initialBroadcastCount + 1, '4.1: Newly inserted message triggered database broadcast');
      assert(dbBroadcastCalls[dbBroadcastCalls.length - 1].message.id === initialId, '4.1: Broadcast payload contains canonical message ID');

      // Second call (duplicate retry with same sender, same room, same nonce)
      const res2 = await postMsg();
      const data2: any = await res2.json();
      assert(res2.status === 200, '4.1: Duplicate retry returned 200');
      assert(data2.message.id === initialId, '4.1: Returned original canonical message ID');

      // Observable broadcast suppression: Assert NO second event on SSE stream
      let duplicateSseEventReceived = false;
      const timeoutP = new Promise(r => setTimeout(r, 60));
      await Promise.race([
        reader.read().then(() => { duplicateSseEventReceived = true; }),
        timeoutP
      ]);
      assert(!duplicateSseEventReceived, '4.1: Duplicate retry produced NO second broadcast on SSE stream');

      // Observable broadcast suppression: Assert NO second database broadcast
      assert(dbBroadcastCalls.length === initialBroadcastCount + 1, '4.1: Duplicate retry produced NO second database broadcast');

      // Check stateful database count
      const matching = mockDb.messages.filter(m => m.room_id === ROOM_ID_1 && m.sender_user_id === user1 && m.client_nonce === nonce);
      assert(matching.length === 1, '4.1: Exactly one row persisted in database');

      await reader.cancel();
    }

    // Case 4.2: Same sender, DIFFERENT room, same nonce: independent message
    {
      const user1 = '11111111-0000-0000-0000-000000000001';
      const nonce = 'room-nonce-abc';

      const resDiffRoom = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_2}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer user-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello Room 2', senderId: user1, senderType: 'registered', clientNonce: nonce })
      }), env, { waitUntil: () => {} });

      const dataDiff: any = await resDiffRoom.json();
      assert(resDiffRoom.status === 200, '4.2: Different room with same nonce returns 200');
      assert(mockDb.messages.filter(m => m.client_nonce === nonce).length === 2, '4.2: Scoped uniqueness permits same nonce in different rooms');
    }

    // Case 4.3: DIFFERENT sender, same room, same nonce: independent message
    {
      const user2 = '22222222-0000-0000-0000-000000000002';
      const nonce = 'room-nonce-abc';

      const resDiffSender = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer user-2', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello from User 2', senderId: user2, senderType: 'registered', clientNonce: nonce })
      }), env, { waitUntil: () => {} });

      assert(resDiffSender.status === 200, '4.3: Different sender with same nonce returns 200');
      assert(mockDb.messages.filter(m => m.room_id === ROOM_ID_1 && m.client_nonce === nonce).length === 2, '4.3: Scoped uniqueness permits same nonce for different senders');
    }

    // Case 4.4: Persistence failure returns 500 and blocks broadcast
    {
      const broadcastCountBefore = dbBroadcastCalls.length;
      const sseRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/events`, {
        headers: { 'Authorization': 'Bearer user-1' }
      }), env, { waitUntil: () => {} });
      const reader = sseRes.body!.getReader();
      await reader.read(); // connected

      globalThis.fetch = (async (url: any) => {
        const urlStr = url.toString();
        if (urlStr.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: '11111111-0000-0000-0000-000000000001' }), { status: 200 });
        if (urlStr.includes('/rest/v1/profiles')) return new Response(JSON.stringify([{ nickname: 'N' }]), { status: 200 });
        if (urlStr.includes('/rest/v1/rooms')) return new Response(JSON.stringify([{ id: ROOM_ID_1 }]), { status: 200 });
        if (urlStr.includes('/rpc/upsert_message')) return new Response(JSON.stringify({ message: 'DB Connection Timeout' }), { status: 500 });
        return new Response('Not Found', { status: 404 });
      }) as any;

      const res = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer user-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Fail?', senderId: '11111111-0000-0000-0000-000000000001', senderType: 'registered' })
      }), env, { waitUntil: () => {} });

      assert(res.status === 500, '4.4: Persistence failure returns 500');

      let failureBroadcastReceived = false;
      await Promise.race([
        reader.read().then(() => { failureBroadcastReceived = true; }),
        new Promise(r => setTimeout(r, 60))
      ]);
      assert(!failureBroadcastReceived, '4.4: Persistence failure produces NO broadcast to room SSE stream');
      assert(dbBroadcastCalls.length === broadcastCountBefore, '4.4: Persistence failure produces NO database broadcast');

      await reader.cancel();
    }

    // Case 4.5: Missing production database configuration produces HTTP 503 and no unpersisted broadcast
    {
      const broadcastCountBefore = dbBroadcastCalls.length;
      const prodEnvWithoutDb = {
        GUEST_SESSION_SECRET: GUEST_SECRET,
        SUPABASE_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
        ENVIRONMENT: 'production'
      };

      const res = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer user-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'No DB in prod', senderId: '11111111-0000-0000-0000-000000000001', senderType: 'registered' })
      }), prodEnvWithoutDb, {});

      assert(res.status === 503, '4.5: Missing database configuration in production returns 503');
      assert(dbBroadcastCalls.length === broadcastCountBefore, '4.5: Missing database configuration produces NO unpersisted broadcast');
    }

    // -------------------------------------------------------------------------
    // 5. Private Conversation Concurrency, Scoping & Fail-Closed Behavior
    // -------------------------------------------------------------------------
    mockDb.reset();
    const convId1 = 'conv_11111111-0000-0000-0000-000000000001_22222222-0000-0000-0000-000000000002';
    const convId2 = 'conv_11111111-0000-0000-0000-000000000001_33333333-0000-0000-0000-000000000003';

    const setupPrivateMockFetch = () => {
      globalThis.fetch = (async (url: any, init: any) => {
        const urlStr = url.toString();
        if (urlStr.includes('/auth/v1/user')) {
          const auth = init?.headers?.Authorization || init?.headers?.authorization || '';
          if (auth.includes('user-1')) return new Response(JSON.stringify({ id: '11111111-0000-0000-0000-000000000001' }), { status: 200 });
          if (auth.includes('user-2')) return new Response(JSON.stringify({ id: '22222222-0000-0000-0000-000000000002' }), { status: 200 });
          return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
        }
        if (urlStr.includes('/rest/v1/profiles')) return new Response(JSON.stringify([{ nickname: 'N', avatar_url: 'A' }]), { status: 200 });
        if (urlStr.includes('/rest/v1/conversations')) return new Response(JSON.stringify([{ id: 'c1' }]), { status: 200 });
        if (urlStr.includes('/rpc/upsert_message')) {
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
          return mockDb.handleUpsert(body);
        }
        return new Response('Not Found', { status: 404 });
      }) as any;
    };

    // Case 5.1: Same sender, same conversation, same nonce: exactly one persisted message & DM broadcast suppression
    {
      setupPrivateMockFetch();
      const user1 = '11111111-0000-0000-0000-000000000001';
      const user2 = '22222222-0000-0000-0000-000000000002';
      const nonce = 'dm-nonce-123';

      // Connect recipient DM stream to observe incoming_dm broadcasts
      const dmSseRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/user/${user2}/events`, {
        headers: { 'Authorization': 'Bearer user-2' }
      }), env, { waitUntil: () => {} });
      assert(dmSseRes.status === 200, '5.1: Recipient user DM SSE listener connected');
      const dmReader = dmSseRes.body!.getReader();
      const initChunk = await dmReader.read();
      assert(new TextDecoder().decode(initChunk.value).includes('event: connected'), '5.1: User DM stream connected event verified');

      const initialDmBroadcastCount = dbBroadcastCalls.length;

      const postDm = () => worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convId1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer user-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Secret DM', senderId: user1, recipientId: user2, senderType: 'registered', clientNonce: nonce })
      }), env, { waitUntil: () => {} });

      const res1 = await postDm();
      const data1: any = await res1.json();
      assert(res1.status === 200, '5.1: First private message returned 200');

      // Observable broadcast 1: Recipient receives incoming_dm event
      const dmChunk = await dmReader.read();
      const dmText = new TextDecoder().decode(dmChunk.value);
      assert(dmText.includes('event: incoming_dm') && dmText.includes(data1.message.id), '5.1: First private message emitted incoming_dm notification');

      // Observable broadcast 2: DatabaseService broadcast was invoked
      assert(dbBroadcastCalls.length > initialDmBroadcastCount, '5.1: Newly inserted DM triggered database broadcast');
      const countAfterFirst = dbBroadcastCalls.length;

      const res2 = await postDm();
      const data2: any = await res2.json();
      assert(res2.status === 200, '5.1: Duplicate DM retry returned 200');
      assert(data2.message.id === data1.message.id, '5.1: Duplicate DM returns canonical original message');

      // Observable broadcast suppression 1: Recipient receives NO second incoming_dm event
      let duplicateDmReceived = false;
      await Promise.race([
        dmReader.read().then(() => { duplicateDmReceived = true; }),
        new Promise(r => setTimeout(r, 60))
      ]);
      assert(!duplicateDmReceived, '5.1: Duplicate DM retry produces NO second broadcast or incoming_dm notification');

      // Observable broadcast suppression 2: Database service receives NO second broadcast
      assert(dbBroadcastCalls.length === countAfterFirst, '5.1: Duplicate DM retry produces NO second database broadcast');

      const matchingDMs = mockDb.messages.filter(m => m.sender_user_id === user1 && m.client_nonce === nonce);
      assert(matchingDMs.length === 1, '5.1: Exactly one DM row persisted for sender+conversation+nonce');

      await dmReader.cancel();
    }

    // Case 5.2: Different conversation, same sender and nonce: independent message
    {
      const user1 = '11111111-0000-0000-0000-000000000001';
      const user3 = '33333333-0000-0000-0000-000000000003';
      const nonce = 'dm-nonce-123';

      const resDiffConv = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convId2}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer user-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Another DM', senderId: user1, recipientId: user3, senderType: 'registered', clientNonce: nonce })
      }), env, { waitUntil: () => {} });

      assert(resDiffConv.status === 200, '5.2: Different conversation with same nonce returns 200');
      assert(mockDb.messages.filter(m => m.client_nonce === nonce).length === 2, '5.2: Separate DM conversation has independent row');
    }

    // Case 5.3: Missing production database configuration fails closed with 503
    {
      const prodEnvWithoutDb = {
        GUEST_SESSION_SECRET: GUEST_SECRET,
        SUPABASE_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
        ENVIRONMENT: 'production'
      };

      const res = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convId1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer user-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Should fail closed', senderId: '11111111-0000-0000-0000-000000000001', recipientId: '22222222-0000-0000-0000-000000000002', senderType: 'registered' })
      }), prodEnvWithoutDb, {});

      assert(res.status === 503, '5.3: Missing database configuration fails closed with 503 in production');
    }

    // -------------------------------------------------------------------------
    // 6. Media-Only Message Persistence & Validation (Task 3)
    // -------------------------------------------------------------------------
    mockDb.reset();
    setupPublicMockFetch();

    // Case 6.1: Public room media-only message (empty content, valid mediaUrl)
    {
      const user1 = '11111111-0000-0000-0000-000000000001';
      const mediaUrl = 'https://voxanex.test/storage/media/image-123.jpg';

      const res = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer user-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: '',
          mediaUrl: mediaUrl,
          mediaType: 'image',
          senderId: user1,
          senderType: 'registered'
        })
      }), env, { waitUntil: () => {} });

      const data: any = await res.json();
      assert(res.status === 200, '6.1: Public room media-only message accepted with 200');
      assert(data.success === true, '6.1: Media-only message returned success: true');
      assert(data.message.mediaUrl === mediaUrl, '6.1: Persisted message contains mediaUrl');
      assert(data.message.content === '', '6.1: Persisted message content is empty string');

      const persisted = mockDb.messages.find(m => m.id === data.message.id);
      assert(Boolean(persisted && persisted.media_url === mediaUrl), '6.1: Media-only message stored in database with media_url');
    }

    // Case 6.2: Private conversation media-only message
    {
      setupPrivateMockFetch();
      const user1 = '11111111-0000-0000-0000-000000000001';
      const user2 = '22222222-0000-0000-0000-000000000002';
      const mediaUrl = 'https://voxanex.test/storage/media/gif-456.gif';

      const res = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convId1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer user-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaUrl: mediaUrl,
          mediaType: 'gif',
          senderId: user1,
          recipientId: user2,
          senderType: 'registered'
        })
      }), env, { waitUntil: () => {} });

      const data: any = await res.json();
      assert(res.status === 200, '6.2: Private conversation media-only message accepted with 200');
      assert(data.message.mediaUrl === mediaUrl, '6.2: Private DM contains mediaUrl');
      assert(data.message.content === '', '6.2: Private DM content is empty string');
    }

    // Case 6.3: Empty content without media is rejected with 400
    {
      const user1 = '11111111-0000-0000-0000-000000000001';
      const res = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer user-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: '',
          senderId: user1,
          senderType: 'registered'
        })
      }), env, { waitUntil: () => {} });

      assert(res.status === 400, '6.3: Message without content or mediaUrl is rejected with 400');
    }

    // Case 6.4: Text-only message without mediaUrl remains accepted
    {
      const user1 = '11111111-0000-0000-0000-000000000001';
      const res = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer user-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Pure text message',
          senderId: user1,
          senderType: 'registered'
        })
      }), env, { waitUntil: () => {} });

      const data: any = await res.json();
      assert(res.status === 200, '6.4: Text-only message accepted with 200');
      assert(data.message.content === 'Pure text message', '6.4: Text content preserved exactly');
      assert(!data.message.mediaUrl, '6.4: Text-only message has no mediaUrl');
    }

    // Case 6.5: Both text and mediaUrl provided is accepted
    {
      const user1 = '11111111-0000-0000-0000-000000000001';
      const mediaUrl = 'https://voxanex.test/storage/media/both.jpg';
      const res = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer user-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Here is the attachment',
          mediaUrl: mediaUrl,
          mediaType: 'image',
          senderId: user1,
          senderType: 'registered'
        })
      }), env, { waitUntil: () => {} });

      const data: any = await res.json();
      assert(res.status === 200, '6.5: Message with both text and media accepted with 200');
      assert(data.message.content === 'Here is the attachment', '6.5: Content verified');
      assert(data.message.mediaUrl === mediaUrl, '6.5: MediaUrl verified');
    }

    // Case 6.6: Content exceeding 2000 characters is rejected
    {
      const user1 = '11111111-0000-0000-0000-000000000001';
      const res = await worker.fetch(new Request(`https://voxanex.test/api/chat/rooms/${ROOM_ID_1}/messages`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer user-1', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'A'.repeat(2001),
          senderId: user1,
          senderType: 'registered'
        })
      }), env, { waitUntil: () => {} });

      assert(res.status === 400 || res.status === 500, '6.6: Content exceeding 2000 characters rejected');
    }

    console.log(`\n🎉 Test Summary: ${passedCount}/${assertionCount} assertions passed.`);
    if (failedCount > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('💥 Test Execution Error:', err);
    process.exit(1);
  } finally {
    globalThis.fetch = originalFetch;
    databaseService.broadcastMessage = originalBroadcastMessage;
    databaseService.broadcastDM = originalBroadcastDM;
    databaseService.broadcastToUser = originalBroadcastToUser;
  }
}

runTests();
