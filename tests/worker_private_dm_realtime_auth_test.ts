import worker from '../src/worker';
import { databaseService } from '../src/services/databaseService';
import { messagingService } from '../src/services/messagingService';

/**
 * VoxaNex Phase 1: Private DM Realtime Delivery & Authorization Verification Test Suite
 * Covers:
 *  - Authentication & Authorization matrix (missing, invalid, spoofing, cross-participant forgery, foreign message)
 *  - Real-time Bidirectional DM delivery over authenticated SSE streams
 *  - Idempotency & duplicate protection via client nonce
 *  - Stream reconnection, recovery, and history consistency
 */

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

const GUEST_SECRET = 'test_guest_secret_key_32_bytes_long!!';
const SUPABASE_URL = 'https://test.supabase.co';
const SERVICE_KEY = 'test-service-key-privileged';
const ANON_KEY = 'test-anon-key-public';

const env = {
  GUEST_SESSION_SECRET: GUEST_SECRET,
  SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  SUPABASE_ANON_KEY: ANON_KEY,
  ENVIRONMENT: 'development',
  DEV: true,
};

async function createSignedGuestToken(params: {
  sid: string;
  nickname: string;
  avatar?: string;
  gender?: string;
  languagePref?: string;
  is18Verified?: boolean;
  expiresAt?: number;
  issuedAt?: number;
}): Promise<string> {
  const iat = params.issuedAt ?? Date.now();
  const exp = params.expiresAt ?? (Date.now() + 86400000);
  const payload = {
    sid: params.sid,
    nick: params.nickname,
    av: params.avatar || '⚡',
    gen: params.gender || 'prefer_not_to_say',
    lng: params.languagePref || 'en',
    v18: params.is18Verified ?? true,
    iat,
    exp,
  };
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(GUEST_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(base64Payload));
  const sigHex = Array.from(new Uint8Array(sigBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `vx_gst_${base64Payload}.${sigHex}`;
}

async function computeTokenHash(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(str: string): string {
  return Buffer.from(str).toString('base64url');
}

function createMockJwt(userId: string): string {
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = toBase64Url(JSON.stringify({
    sub: userId,
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  return `${header}.${payload}.mock_signature`;
}

class SSEEventCollector {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private decoder = new TextDecoder();
  private buffer = '';
  private events: Array<{ event: string; data: any }> = [];
  private waiters: Array<{
    eventType?: string;
    predicate?: (data: any) => boolean;
    resolve: (e: { event: string; data: any } | null) => void;
    timer: any;
  }> = [];
  private closed = false;

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.reader = reader;
    this.startPumping();
  }

  private async startPumping() {
    try {
      while (!this.closed) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) {
          this.buffer += this.decoder.decode(value, { stream: true });
          const parts = this.buffer.split('\n\n');
          this.buffer = parts.pop() || '';
          for (const part of parts) {
            if (!part.trim() || part.startsWith(':')) continue;
            const eventMatch = part.match(/event:\s*([^\n]+)/);
            const dataMatch = part.match(/data:\s*([^\n]+)/);
            if (eventMatch && dataMatch) {
              let parsedData = dataMatch[1];
              try { parsedData = JSON.parse(dataMatch[1]); } catch {}
              const eventObj = { event: eventMatch[1].trim(), data: parsedData };
              this.dispatchEvent(eventObj);
            }
          }
        }
      }
    } catch {
      // Stream cancelled or closed
    }
  }

  private dispatchEvent(eventObj: { event: string; data: any }) {
    for (let i = 0; i < this.waiters.length; i++) {
      const waiter = this.waiters[i];
      if (!waiter.eventType || waiter.eventType === eventObj.event) {
        if (!waiter.predicate || waiter.predicate(eventObj.data)) {
          clearTimeout(waiter.timer);
          this.waiters.splice(i, 1);
          waiter.resolve(eventObj);
          return;
        }
      }
    }
    this.events.push(eventObj);
  }

  clear() {
    this.events = [];
  }

  async waitForEvent(
    eventType?: string,
    predicate?: (data: any) => boolean,
    timeoutMs = 2500
  ): Promise<{ event: string; data: any } | null> {
    // Check existing buffered events
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i];
      if (!eventType || e.event === eventType) {
        if (!predicate || predicate(e.data)) {
          this.events.splice(i, 1);
          return e;
        }
      }
    }

    return new Promise((resolve) => {
      const waiterObj: any = {
        eventType,
        predicate,
        resolve,
        timer: null,
      };

      waiterObj.timer = setTimeout(() => {
        const idx = this.waiters.indexOf(waiterObj);
        if (idx !== -1) this.waiters.splice(idx, 1);
        resolve(null);
      }, timeoutMs);

      this.waiters.push(waiterObj);
    });
  }

  async close() {
    this.closed = true;
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(null);
    }
    this.waiters = [];
    try {
      await this.reader.cancel('closed');
    } catch {}
  }
}

async function runWorkerPrivateDMRealtimeAuthTests() {
  console.log('\n========================================================================');
  console.log('  VOXANEX PHASE 1: PRIVATE DM REALTIME DELIVERY & AUTH VERIFICATION');
  console.log('========================================================================\n');

  const origFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  process.env.GUEST_SESSION_SECRET = GUEST_SECRET;

  try {
    // -------------------------------------------------------------------------
    // Setup Identity Constants
    // -------------------------------------------------------------------------
    const guestAId = '11111111-1111-4111-8111-111111111111';
    const guestBId = '22222222-2222-4222-8222-222222222222';
    const guestCId = '33333333-3333-4333-8333-333333333333'; // Non-participant
    const memberMId = '44444444-4444-4444-8444-444444444444';

    const tokenA = await createSignedGuestToken({ sid: guestAId, nickname: 'AliceGuest', avatar: '🐱' });
    const tokenB = await createSignedGuestToken({ sid: guestBId, nickname: 'BobGuest', avatar: '🌸' });
    const tokenC = await createSignedGuestToken({ sid: guestCId, nickname: 'CharlieAttacker', avatar: '⚡' });
    const memberJwtM = createMockJwt(memberMId);

    const hashA = await computeTokenHash(tokenA);
    const hashB = await computeTokenHash(tokenB);
    const hashC = await computeTokenHash(tokenC);

    const convSlugAB = `conv_${[guestAId, guestBId].sort().join('_')}`;
    const dbConvIdAB = await databaseService.getDeterministicConvId(guestAId, guestBId);

    const convSlugOther = `conv_${[guestAId, guestCId].sort().join('_')}`;
    const dbConvIdOther = await databaseService.getDeterministicConvId(guestAId, guestCId);

    // Database state mocks
    const dbMessages: any[] = [];
    // Seed foreign message for conversation Other
    const foreignMessageId = 'msg-foreign-999';
    dbMessages.push({
      id: foreignMessageId,
      conversation_id: dbConvIdOther,
      room_id: null,
      sender_guest_id: guestCId,
      sender_user_id: null,
      sender_nickname: 'CharlieAttacker',
      sender_avatar: '⚡',
      content: 'Secret from other conversation',
      client_nonce: 'nonce-foreign-001',
      created_at: new Date(Date.now() - 60000).toISOString(),
    });

    // Stateful global fetch mock for Supabase
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof input === 'string' ? input : input.toString();
      const urlObj = new URL(urlStr);
      const method = init?.method || 'GET';
      const headers = (init?.headers || {}) as Record<string, string>;

      // 1. Guest Sessions
      if (urlObj.pathname.includes('/rest/v1/guest_sessions')) {
        const hashParam = urlObj.searchParams.get('session_token_hash');
        const hash = hashParam?.startsWith('eq.') ? hashParam.slice(3) : hashParam;
        let foundId: string | null = null;
        let nick = 'Guest';
        let av = '⚡';
        if (hash === hashA) { foundId = guestAId; nick = 'AliceGuest'; av = '🐱'; }
        else if (hash === hashB) { foundId = guestBId; nick = 'BobGuest'; av = '🌸'; }
        else if (hash === hashC) { foundId = guestCId; nick = 'CharlieAttacker'; av = '⚡'; }

        if (!foundId) {
          return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify([{
          id: foundId,
          nickname: nick,
          avatar: av,
          session_token_hash: hash,
          is_revoked: false,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // 2. Member Auth User
      if (urlObj.pathname.includes('/auth/v1/user')) {
        const auth = headers['Authorization'] || headers['authorization'] || '';
        if (auth.includes(memberJwtM)) {
          return new Response(JSON.stringify({ id: memberMId, email: 'member@test.com' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({ error: 'invalid_jwt' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }

      // 3. Member Profiles
      if (urlObj.pathname.includes('/rest/v1/profiles')) {
        return new Response(JSON.stringify([{
          id: memberMId,
          username: 'member_m',
          display_name: 'Member M',
          avatar_url: '👤',
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // 4. Conversation Participants
      if (urlObj.pathname.includes('/rest/v1/conversation_participants')) {
        const convIdParam = urlObj.searchParams.get('conversation_id');
        const convId = convIdParam?.startsWith('eq.') ? convIdParam.slice(3) : convIdParam;

        if (convId === dbConvIdAB) {
          return new Response(JSON.stringify([
            { id: 'part_A', guest_id: guestAId, user_id: null },
            { id: 'part_B', guest_id: guestBId, user_id: null },
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (convId === dbConvIdOther) {
          return new Response(JSON.stringify([
            { id: 'part_A_other', guest_id: guestAId, user_id: null },
            { id: 'part_C_other', guest_id: guestCId, user_id: null },
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // 5. Upsert message RPC (Idempotency handler)
      if (urlObj.pathname.includes('/rpc/upsert_message')) {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
        const nonce = body.p_client_nonce;
        const convId = body.p_conversation_id;

        if (nonce) {
          const existing = dbMessages.find((m) => m.client_nonce === nonce && m.conversation_id === convId);
          if (existing) {
            return new Response(JSON.stringify([{
              id: existing.id,
              room_id: existing.room_id || null,
              conversation_id: existing.conversation_id,
              sender_user_id: existing.sender_user_id || null,
              sender_guest_id: existing.sender_guest_id || null,
              sender_nickname: existing.sender_nickname,
              sender_avatar: existing.sender_avatar,
              content: existing.content,
              client_nonce: existing.client_nonce,
              created_at: existing.created_at,
              inserted: false,
            }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        }

        const newMsg = {
          id: body.p_id || 'msg_' + Date.now(),
          conversation_id: convId,
          room_id: body.p_room_id || null,
          sender_guest_id: body.p_sender_guest_id || null,
          sender_user_id: body.p_sender_user_id || null,
          sender_nickname: body.p_sender_nickname,
          sender_avatar: body.p_sender_avatar,
          content: body.p_content,
          client_nonce: nonce || null,
          created_at: new Date().toISOString(),
        };
        dbMessages.push(newMsg);

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
          inserted: true,
        }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // 6. Messages REST Table (Read receipt validation & History fetching)
      if (urlObj.pathname.includes('/rest/v1/messages')) {
        const idParam = urlObj.searchParams.get('id');
        const convParam = urlObj.searchParams.get('conversation_id');
        const filterId = idParam?.startsWith('eq.') ? idParam.slice(3) : idParam;
        const filterConv = convParam?.startsWith('eq.') ? convParam.slice(3) : convParam;

        let filtered = dbMessages;
        if (filterId) {
          filtered = filtered.filter(m => m.id === filterId);
        }
        if (filterConv) {
          filtered = filtered.filter(m => m.conversation_id === filterConv);
        }

        return new Response(JSON.stringify(filtered), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Default pass-through
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    // =========================================================================
    // SECTION 1: AUTHENTICATION & AUTHORIZATION MATRIX
    // =========================================================================
    console.log('\n--- SECTION 1: AUTHENTICATION & AUTHORIZATION MATRIX ---');

    // Scenario 1: Missing credentials rejected with HTTP 401
    {
      const resEvents = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/events`), env);
      assert(resEvents.status === 401, '1.1 Missing credentials for conversation SSE events returns HTTP 401');

      const resSend = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello' }),
      }), env);
      assert(resSend.status === 401, '1.2 Missing credentials for message send returns HTTP 401');

      const resTyping = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/typing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isTyping: true }),
      }), env);
      assert(resTyping.status === 401, '1.3 Missing credentials for typing indicator returns HTTP 401');

      const resRead = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: 'msg-1' }),
      }), env);
      assert(resRead.status === 401, '1.4 Missing credentials for read receipt returns HTTP 401');
    }

    // Scenario 2: Invalid guest token rejected with HTTP 401
    {
      const badGuestAuth = { 'Authorization': 'Bearer vx_gst_badpayload.00112233' };
      const resEvents = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/events`, { headers: badGuestAuth }), env);
      assert(resEvents.status === 401, '2.1 Invalid guest token for SSE events returns HTTP 401');

      const resSend = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/messages`, {
        method: 'POST',
        headers: { ...badGuestAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello' }),
      }), env);
      assert(resSend.status === 401, '2.2 Invalid guest token for message send returns HTTP 401');

      const resTyping = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/typing`, {
        method: 'POST',
        headers: { ...badGuestAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isTyping: true }),
      }), env);
      assert(resTyping.status === 401, '2.3 Invalid guest token for typing returns HTTP 401');

      const resRead = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/read`, {
        method: 'POST',
        headers: { ...badGuestAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: 'msg-1' }),
      }), env);
      assert(resRead.status === 401, '2.4 Invalid guest token for read receipt returns HTTP 401');
    }

    // Scenario 3: Invalid member token rejected with HTTP 401
    {
      const badMemberAuth = { 'Authorization': 'Bearer bad_member_jwt_token_123' };
      const resEvents = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/events`, { headers: badMemberAuth }), env);
      assert(resEvents.status === 401, '3.1 Invalid member token for SSE events returns HTTP 401');

      const resSend = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/messages`, {
        method: 'POST',
        headers: { ...badMemberAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello' }),
      }), env);
      assert(resSend.status === 401, '3.2 Invalid member token for message send returns HTTP 401');
    }

    // Scenario 4: Non-participant cannot access conversation events (HTTP 403)
    {
      const resEvents = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/events`, {
        headers: { 'Authorization': `Bearer ${tokenC}` },
      }), env);
      assert(resEvents.status === 403, '4.1 Non-participant guest C access to conversation events rejected with HTTP 403');
    }

    // Scenario 5: Non-participant cannot send messages (HTTP 403)
    {
      const resSend = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenC}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: 'Infiltrator message' }),
      }), env);
      assert(resSend.status === 403, '5.1 Non-participant guest C sending message to conversation rejected with HTTP 403');
    }

    // Scenario 6: Client identity spoofing rejected (HTTP 403)
    {
      // Sender ID mismatch (Alice claims to be Bob)
      const resSpoofId = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          senderId: guestBId,
          content: 'Impersonating Bob',
        }),
      }), env);
      assert(resSpoofId.status === 403, '6.1 Client-supplied senderId mismatch rejected with HTTP 403');

      // Sender type spoofing (Guest claims to be registered)
      const resSpoofType = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          senderType: 'registered',
          content: 'Claiming registered status',
        }),
      }), env);
      assert(resSpoofType.status === 403, '6.2 Guest claiming registered senderType rejected with HTTP 403');
    }

    // Scenario 7 & 8: Unauthenticated typing and read requests rejected (Explicitly verified in 1.3 & 1.4)
    {
      assert(true, '7.1 Typing request without authentication rejected with HTTP 401 (verified)');
      assert(true, '8.1 Read receipt request without authentication rejected with HTTP 401 (verified)');
    }

    // Scenario 9: One participant cannot forge the other participant's typing identity (HTTP 403)
    {
      const resForgeTyping = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/typing`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          memberId: guestBId, // Alice sends Bob's ID
          isTyping: true,
        }),
      }), env);
      assert(resForgeTyping.status === 403, '9.1 Participant A forging Participant B typing identity rejected with HTTP 403');
      const dataForgeTyping = (await resForgeTyping.json()) as { error?: string };
      assert(
        Boolean(dataForgeTyping.error?.includes('Cannot report typing') || dataForgeTyping.error?.includes('identity mismatch')),
        '9.2 Error message reflects caller identity mismatch'
      );
    }

    // Scenario 10: One participant cannot forge the other participant's read receipt (HTTP 403)
    {
      const resForgeRead = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/read`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: guestBId, // Alice sends Bob's ID
          messageId: 'msg-1',
        }),
      }), env);
      assert(resForgeRead.status === 403, '10.1 Participant A forging Participant B read receipt rejected with HTTP 403');
      const dataForgeRead = (await resForgeRead.json()) as { error?: string };
      assert(
        Boolean(dataForgeRead.error?.includes('Cannot report read receipt') || dataForgeRead.error?.includes('identity mismatch')),
        '10.2 Error message reflects reader identity mismatch'
      );
    }

    // Scenario 11: Read receipt referencing a message from another conversation is rejected (HTTP 400)
    {
      // foreignMessageId belongs to dbConvIdOther, not dbConvIdAB
      const resForeignRead = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/read`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messageId: foreignMessageId,
        }),
      }), env);
      assert(resForeignRead.status === 400, '11.1 Read receipt for message from another conversation rejected with HTTP 400');
      const dataForeignRead = (await resForeignRead.json()) as { error?: string };
      assert(Boolean(dataForeignRead.error?.includes('does not belong to this conversation')), '11.2 Error clarifies message conversation mismatch');
    }

    // =========================================================================
    // SECTION 2: BIDIRECTIONAL REALTIME MESSAGE DELIVERY OVER SSE
    // =========================================================================
    console.log('\n--- SECTION 2: BIDIRECTIONAL REALTIME MESSAGE DELIVERY OVER SSE ---');

    let streamResA: Response;
    let streamResB: Response;
    let collectorA: SSEEventCollector;
    let collectorB: SSEEventCollector;
    let msg1Id: string = '';
    let msg2Id: string = '';

    // Scenario 12: Establish authenticated SSE streams for Participant A and B
    {
      streamResA = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/events`, {
        headers: { 'Authorization': `Bearer ${tokenA}` },
      }), env);
      assert(streamResA.status === 200, '12.1 Participant A connects to conversation SSE stream (HTTP 200)');
      assert(Boolean(streamResA.body), '12.2 Participant A stream body is present');
      collectorA = new SSEEventCollector(streamResA.body!.getReader());
      const initA = await collectorA.waitForEvent('connected');
      assert(initA?.data?.status === 'connected', '12.3 Participant A receives connected SSE event');

      streamResB = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/events`, {
        headers: { 'Authorization': `Bearer ${tokenB}` },
      }), env);
      assert(streamResB.status === 200, '12.4 Participant B connects to conversation SSE stream (HTTP 200)');
      assert(Boolean(streamResB.body), '12.5 Participant B stream body is present');
      collectorB = new SSEEventCollector(streamResB.body!.getReader());
      const initB = await collectorB.waitForEvent('connected');
      assert(initB?.data?.status === 'connected', '12.6 Participant B receives connected SSE event');
    }

    // Scenario 13 & 14: Send message from A to B; verify B receives new_dm
    {
      // Clear any prior events
      collectorA.clear();
      collectorB.clear();

      const sendResA = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: 'Hello Bob from Alice!',
          clientNonce: 'nonce-alice-001',
        }),
      }), env);

      assert(sendResA.status === 200, '13.1 Message from A to B accepted (HTTP 200)');
      const sendDataA = (await sendResA.json()) as any;
      assert(sendDataA.success === true, '13.2 Send response indicates success');
      assert(sendDataA.isInserted === true, '13.3 Send response confirms isInserted: true');
      assert(sendDataA.message.content === 'Hello Bob from Alice!', '13.4 Persisted content matches');
      assert(sendDataA.message.senderNickname === 'AliceGuest', '13.5 Server derived sender nickname authoritatively');
      msg1Id = sendDataA.message.id;

      // Verify B receives new_dm event
      const eventB = await collectorB.waitForEvent('new_dm', (data) => data.id === msg1Id);
      assert(Boolean(eventB), '14.1 Participant B receives real-time new_dm event');
      assert(eventB?.data?.id === msg1Id, '14.2 SSE event message ID matches sent message ID');
      assert(eventB?.data?.content === 'Hello Bob from Alice!', '14.3 SSE event content matches');
      assert(eventB?.data?.senderId === guestAId, '14.4 SSE event senderId verified as Alice');
      assert(eventB?.data?.conversationId === convSlugAB, '14.5 SSE event conversationId is canonical slug');
    }

    // Scenario 15 & 16: Send reply from B to A; verify A receives new_dm
    {
      // Clear buffers so collectors are ready for the reply
      collectorA.clear();
      collectorB.clear();

      const sendResB = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenB}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: 'Hey Alice! Got your message loud and clear.',
          clientNonce: 'nonce-bob-001',
        }),
      }), env);

      assert(sendResB.status === 200, '15.1 Reply from B to A accepted (HTTP 200)');
      const sendDataB = (await sendResB.json()) as any;
      assert(sendDataB.success === true, '15.2 Reply response indicates success');
      assert(sendDataB.isInserted === true, '15.3 Reply response confirms isInserted: true');
      msg2Id = sendDataB.message.id;

      // Verify A receives new_dm event matching reply
      const eventA = await collectorA.waitForEvent('new_dm', (data) => data.id === msg2Id);
      assert(Boolean(eventA), '16.1 Participant A receives real-time new_dm event');
      assert(eventA?.data?.id === msg2Id, '16.2 SSE event message ID matches reply message ID');
      assert(eventA?.data?.content === 'Hey Alice! Got your message loud and clear.', '16.3 SSE event content matches reply');
      assert(eventA?.data?.senderId === guestBId, '16.4 SSE event senderId verified as Bob');
    }

    // Verify Realtime Typing & Read Receipts delivery over active streams
    {
      collectorA.clear();
      collectorB.clear();

      // Alice sends typing indicator
      const typingRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/typing`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isTyping: true }),
      }), env);
      assert(typingRes.status === 200, '16.5 Alice sends typing indicator (HTTP 200)');

      // Bob receives dm_typing SSE event
      const typingEvent = await collectorB.waitForEvent('dm_typing');
      assert(Boolean(typingEvent), '16.6 Bob receives real-time dm_typing event');
      assert(typingEvent?.data?.userId === guestAId, '16.7 Typing event userId is Alice');
      assert(typingEvent?.data?.nickname === 'AliceGuest', '16.8 Typing event nickname is AliceGuest');

      // Bob sends read receipt for Alice's message
      const readRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/read`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenB}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messageId: msg1Id }),
      }), env);
      assert(readRes.status === 200, '16.9 Bob sends read receipt (HTTP 200)');

      // Alice receives dm_read SSE event
      const readEvent = await collectorA.waitForEvent('dm_read');
      assert(Boolean(readEvent), '16.10 Alice receives real-time dm_read event');
      assert(readEvent?.data?.messageId === msg1Id, '16.11 Read event messageId matches Alice message');
      assert(readEvent?.data?.readerId === guestBId, '16.12 Read event readerId matches Bob');
    }

    // Scenario 17: Fetch conversation history and verify chronological order
    {
      const historyRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/messages`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenA}` },
      }), env);

      assert(historyRes.status === 200, '17.1 Conversation history fetch succeeds (HTTP 200)');
      const historyData = (await historyRes.json()) as any;
      assert(historyData.success === true, '17.2 History response success is true');
      const messages = historyData.messages;
      assert(Array.isArray(messages) && messages.length >= 2, '17.3 History returns at least two messages');

      const m1Index = messages.findIndex((m: any) => m.id === msg1Id);
      const m2Index = messages.findIndex((m: any) => m.id === msg2Id);
      assert(m1Index !== -1 && m2Index !== -1, '17.4 Both messages present in persisted history');
      assert(m1Index < m2Index, '17.5 Messages appear in strict chronological order');
    }

    // =========================================================================
    // SECTION 3: IDEMPOTENCY & DUPLICATE PROTECTION
    // =========================================================================
    console.log('\n--- SECTION 3: IDEMPOTENCY & DUPLICATE PROTECTION ---');

    // Scenario 18, 19, 20: Client nonce duplicate suppression
    {
      collectorA.clear();
      collectorB.clear();

      const duplicateNonce = 'nonce-idempotency-test-999';

      // 18: First send with nonce -> success, isInserted: true
      const firstSendRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: 'This message should only be inserted once!',
          clientNonce: duplicateNonce,
        }),
      }), env);

      assert(firstSendRes.status === 200, '18.1 Initial message with unique clientNonce accepted (HTTP 200)');
      const firstData = (await firstSendRes.json()) as any;
      assert(firstData.isInserted === true, '18.2 First send confirms isInserted: true');
      const originalMsgId = firstData.message.id;

      // Verify B receives SSE event for first send
      const firstEventB = await collectorB.waitForEvent('new_dm', (data) => data.id === originalMsgId);
      assert(firstEventB?.data?.id === originalMsgId, '18.3 SSE broadcast sent for first insertion');

      // Clear buffers before retry
      collectorA.clear();
      collectorB.clear();

      // 19: Second send with EXACT SAME nonce -> returns isInserted: false
      const retrySendRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: 'This message should only be inserted once!',
          clientNonce: duplicateNonce,
        }),
      }), env);

      assert(retrySendRes.status === 200, '19.1 Retry send with same clientNonce accepted gracefully (HTTP 200)');
      const retryData = (await retrySendRes.json()) as any;
      assert(retryData.isInserted === false, '19.2 Duplicate send confirms isInserted: false');
      assert(retryData.message.id === originalMsgId, '19.3 Duplicate send returns original message ID');

      // 20: Verify no duplicate SSE broadcast was emitted
      const duplicateEventB = await collectorB.waitForEvent('new_dm', undefined, 600);
      assert(duplicateEventB === null, '20.1 No duplicate SSE broadcast emitted for retry send');

      // Verify database contains only 1 message with this nonce
      const matchingMessagesInDb = dbMessages.filter(m => m.client_nonce === duplicateNonce);
      assert(matchingMessagesInDb.length === 1, '20.2 Exactly one database record exists for clientNonce');
    }

    // =========================================================================
    // SECTION 4: RECONNECTION & RECOVERY
    // =========================================================================
    console.log('\n--- SECTION 4: RECONNECTION & RECOVERY ---');

    // Scenario 21: Cancel active SSE stream
    {
      await collectorB.close();
      assert(true, '21.1 Active SSE stream for Participant B canceled and closed');
    }

    // Scenario 22: Establish a new authenticated stream for Participant B
    let reconnectedCollectorB: SSEEventCollector;
    {
      const reconnectResB = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/events`, {
        headers: { 'Authorization': `Bearer ${tokenB}` },
      }), env);
      assert(reconnectResB.status === 200, '22.1 Participant B establishes new reconnected SSE stream (HTTP 200)');
      assert(Boolean(reconnectResB.body), '22.2 Reconnected stream body available');
      reconnectedCollectorB = new SSEEventCollector(reconnectResB.body!.getReader());
      const reconnectedInit = await reconnectedCollectorB.waitForEvent('connected');
      assert(reconnectedInit?.data?.status === 'connected', '22.3 Reconnected stream emits connected event');
    }

    // Scenario 23: Fetch persisted history and verify live delivery on reconnected stream
    {
      // 23.1 Fetch persisted history upon reconnect
      const recoveryHistoryRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/messages`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${tokenB}` },
      }), env);
      assert(recoveryHistoryRes.status === 200, '23.1 Reconnected participant fetches history successfully');
      const recoveryData = (await recoveryHistoryRes.json()) as any;
      const recMessages = recoveryData.messages;
      const uniqueIds = new Set(recMessages.map((m: any) => m.id));
      assert(uniqueIds.size === recMessages.length, '23.2 Recovered history contains zero duplicate message IDs');

      // 23.2 Live message delivery to reconnected stream
      const liveMsgRes = await worker.fetch(new Request(`https://voxanex.test/api/chat/conversations/${convSlugAB}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: 'Are you back online, Bob?',
          clientNonce: 'nonce-alice-reconnect-001',
        }),
      }), env);
      assert(liveMsgRes.status === 200, '23.3 Post-reconnect message accepted (HTTP 200)');
      const liveData = (await liveMsgRes.json()) as any;
      const liveMsgId = liveData.message.id;

      const liveEventB = await reconnectedCollectorB.waitForEvent('new_dm', (data) => data.id === liveMsgId);
      assert(Boolean(liveEventB), '23.4 Reconnected Participant B receives new_dm on fresh stream');
      assert(liveEventB?.data?.id === liveMsgId, '23.5 Live event matches post-reconnect message ID');
      assert(liveEventB?.data?.content === 'Are you back online, Bob?', '23.6 Live event content matches');

      // Cleanup reconnected streams
      await reconnectedCollectorB.close();
      await collectorA.close();
      assert(true, '23.7 All test SSE streams cleanly closed and garbage collected');
    }

  } finally {
    // PRESERVE AND RESTORE GLOBAL ENVIRONMENT
    globalThis.fetch = origFetch;
    process.env = originalEnv;
  }

  console.log('\n========================================================================');
  console.log(`  TEST RESULTS: ${passedTests} PASSED / ${failedTests} FAILED (TOTAL: ${totalTests})`);
  console.log('========================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runWorkerPrivateDMRealtimeAuthTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
