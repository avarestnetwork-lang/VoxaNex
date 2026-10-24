import worker from '../src/worker';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`PASSED: ${message}`);
}

const guestSessions = new Map<string, any>();
const profiles = new Map<string, any>();
const conversations = new Map<string, any>();
const participants: any[] = [];
const messages: any[] = [];

function response(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function queryRows(table: string, url: URL): any[] {
  const source = table === 'guest_sessions' ? [...guestSessions.values()]
    : table === 'profiles' ? [...profiles.values()]
      : table === 'conversation_participants' ? participants
        : table === 'conversations' ? [...conversations.values()]
          : table === 'messages' ? messages : [];
  return source.filter((row) => {
    for (const [column, filter] of url.searchParams) {
      if (column === 'select' || column === 'order' || column === 'limit') continue;
      const dot = filter.indexOf('.');
      const operator = dot === -1 ? '' : filter.slice(0, dot);
      const value = dot === -1 ? filter : filter.slice(dot + 1);
      if (operator === 'eq' && String(row[column]) !== value) return false;
      if (operator === 'gt' && !(String(row[column]) > value)) return false;
    }
    return true;
  });
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url);
  if (url.pathname === '/auth/v1/user') {
    const id = new Headers(init?.headers).get('Authorization')?.replace('Bearer ', '') || '';
    const userId = id === 'registered-a-token' ? '11111111-1111-4111-8111-111111111111' : '';
    return userId ? response({ id: userId }) : response({ message: 'Unauthorized' }, 401);
  }
  const table = url.pathname.split('/').pop() || '';
  const method = init?.method || 'GET';
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};

  if (method === 'GET') return response(queryRows(table, url));
  if (table === 'guest_sessions' && method === 'POST') {
    guestSessions.set(body.id, { ...body, is_revoked: false });
    return response(null, 201);
  }
  if (table === 'guest_sessions' && method === 'PATCH') {
    for (const row of queryRows(table, url)) Object.assign(row, body);
    return response(null, 204);
  }
  if (table === 'conversations' && method === 'POST') {
    conversations.set(body.id, body);
    return response(null, 201);
  }
  if (table === 'conversation_participants' && method === 'POST') {
    const duplicate = participants.some((row) => row.conversation_id === body.conversation_id &&
      ((body.guest_id && row.guest_id === body.guest_id) || (body.user_id && row.user_id === body.user_id)));
    if (duplicate) return response({ code: '23505' }, 409);
    participants.push({ id: crypto.randomUUID(), ...body });
    return response(null, 201);
  }
  if (table === 'messages' && method === 'POST') {
    messages.push({ ...body, created_at: new Date().toISOString() });
    return response(null, 201);
  }
  return response({ message: `Unexpected mock request: ${method} ${url.pathname}` }, 500);
}) as typeof fetch;

const env = {
  SUPABASE_URL: 'https://staging.invalid',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  GUEST_SESSION_SECRET: 'test-only-session-secret',
};

async function call(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const request = new Request(`https://app.invalid${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return worker.fetch(request, env, {} as any);
}

async function createGuest(nickname: string) {
  const res = await call('/api/guest/session', 'POST', { nickname, avatar: '⚡', languagePref: 'en', is18Verified: true });
  const data = await res.json() as any;
  assert(res.ok && data.session?.id && data.session.token, `${nickname} guest session is issued and persisted`);
  return data.session;
}

async function run() {
  const guestA = await createGuest('Guest A');
  const guestB = await createGuest('Guest B');
  const guestC = await createGuest('Guest C');
  assert(/^[0-9a-f-]{36}$/i.test(guestA.id), 'guest IDs use UUIDs compatible with guest-session foreign keys');

  const conversationId = `conv_${[guestA.id, guestB.id].sort().join('_')}`;
  const initA = await call('/api/chat/conversations', 'POST', { userId: guestA.id, partnerId: guestB.id, guestToken: guestA.token });
  assert(initA.ok, 'guest A creates the shared conversation and participant records');

  for (const [sender, recipient, expected] of [[guestA, guestB, 'A to B'], [guestB, guestA, 'B to A']] as const) {
    const send = await call(`/api/chat/conversations/${conversationId}/messages`, 'POST', {
      senderId: sender.id,
      recipientId: recipient.id,
      senderNickname: 'client supplied nickname is ignored',
      content: `message ${expected}`,
      mediaUrl: 'https://assets.invalid/test.png',
      mediaType: 'image',
      guestToken: sender.token,
    });
    const sent = await send.json() as any;
    assert(send.ok && sent.success, `${expected} send is accepted only after persistence`);
    const row = messages.find((message) => message.id === sent.message.id);
    assert(row?.sender_guest_id === sender.id && row.sender_user_id === null, `${expected} persistence uses the guest foreign key`);
    assert(row.media_url && row.media_type === 'image', `${expected} media fields persist`);

    const history = await call(`/api/chat/conversations/${conversationId}/messages?userId=${recipient.id}`, 'GET', undefined, { 'X-Guest-Token': recipient.token });
    const historyData = await history.json() as any;
    assert(history.ok && historyData.messages.some((message: any) => message.id === sent.message.id), `${expected} message appears in authorized history`);
  }

  const missingToken = await call(`/api/chat/conversations/${conversationId}/messages`, 'GET');
  assert(missingToken.status === 401, 'history rejects requests without a verified identity');
  const mismatch = await call(`/api/chat/conversations/${conversationId}/messages`, 'POST', {
    senderId: guestB.id, recipientId: guestA.id, content: 'spoofed', guestToken: guestA.token,
  });
  assert(mismatch.status === 403, 'guest-token and claimed-sender mismatch is rejected');
  const nonmember = await call(`/api/chat/conversations/${conversationId}/messages`, 'GET', undefined, { 'X-Guest-Token': guestC.token });
  assert(nonmember.status === 403, 'a nonparticipant cannot read conversation history');
  const unauthorizedSse = await call(`/api/chat/conversations/${conversationId}/events`);
  assert(unauthorizedSse.status === 401, 'conversation SSE refuses a missing event ticket');
  const ticketResponse = await call(`/api/chat/conversations/${conversationId}/events-ticket`, 'POST', { guestToken: guestA.token });
  const ticketData = await ticketResponse.json() as any;
  assert(ticketResponse.ok && ticketData.ticket, 'conversation SSE ticket requires authoritative membership');
  const authorizedSse = await call(`/api/chat/conversations/${conversationId}/events?ticket=${encodeURIComponent(ticketData.ticket)}`);
  assert(authorizedSse.ok && authorizedSse.headers.get('Content-Type')?.includes('text/event-stream'), 'a valid conversation ticket opens the SSE stream');
  await authorizedSse.body?.cancel();
  const forgedSse = await call(`/api/chat/conversations/${conversationId}/events?ticket=${encodeURIComponent(ticketData.ticket.slice(0, -1) + '0')}`);
  assert(forgedSse.status === 401, 'a forged conversation event ticket is rejected');

  const registeredId = '11111111-1111-4111-8111-111111111111';
  profiles.set(registeredId, { id: registeredId, nickname: 'Registered A', avatar_url: '🛡️' });
  const registeredConversation = await call('/api/chat/conversations', 'POST', { userId: registeredId, partnerId: guestA.id }, { Authorization: 'Bearer registered-a-token' });
  assert(registeredConversation.ok, 'registered account creates a conversation with a guest');
  const registeredConvId = `conv_${[registeredId, guestA.id].sort().join('_')}`;
  const registeredSend = await call(`/api/chat/conversations/${registeredConvId}/messages`, 'POST', {
    senderId: registeredId, recipientId: guestA.id, content: 'registered reply', guestToken: 'stale-guest-token',
  }, { Authorization: 'Bearer registered-a-token' });
  const registeredSendData = await registeredSend.json() as any;
  assert(registeredSend.ok && registeredSendData.success, 'registered member can persist a direct message');
  const registeredRow = messages.find((message) => message.id === registeredSendData.message.id);
  assert(registeredRow?.sender_user_id === registeredId && registeredRow.sender_guest_id === null, 'registered persistence uses the profile foreign key');
  const registeredHistory = await call(`/api/chat/conversations/${registeredConvId}/messages?userId=${registeredId}`, 'GET', undefined, { Authorization: 'Bearer registered-a-token' });
  const registeredHistoryData = await registeredHistory.json() as any;
  assert(registeredHistory.ok && registeredHistoryData.messages.some((message: any) => message.id === registeredSendData.message.id), 'registered account can read its persisted direct-message history');

  console.log('\nPrivate messaging persistence tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  globalThis.fetch = originalFetch;
});
