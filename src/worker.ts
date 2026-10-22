/**
 * ChatLustora Cloudflare Workers Edge Entrypoint
 * Handles full-featured Edge SSE streaming, message persistence, presence tracking,
 * guest session authorization, and falls back to static assets.
 */

interface HubMessage {
  id: string;
  roomId?: string;
  conversationId?: string;
  senderId: string;
  senderNickname: string;
  senderAvatar: string;
  senderType: 'registered' | 'guest' | 'system';
  content: string;
  rawContent?: string;
  mediaUrl?: string;
  mediaType?: 'gif' | 'image';
  linkPreview?: {
    url: string;
    title?: string;
    description?: string;
    image?: string;
  };
  clientNonce?: string;
  timestamp: string;
  status: 'delivered';
}

interface PresenceMember {
  id: string;
  nickname: string;
  avatar: string;
  isGuest: boolean;
  lastSeen: number;
  gender?: string;
}

interface GuestSession {
  id: string;
  token: string;
  nickname: string;
  avatar: string;
  gender?: string;
  languagePref?: string;
  is18Verified?: boolean;
  createdAt: number;
  expiresAt: number;
}

// Global in-memory maps for Edge instance
const roomMessages = new Map<string, HubMessage[]>();
const roomPresence = new Map<string, Map<string, PresenceMember>>();
const roomTyping = new Map<string, Map<string, { nickname: string; expiresAt: number }>>();
const guestSessions = new Map<string, GuestSession>();

// Active SSE client streams per room & conversation
const roomStreams = new Map<string, Set<WritableStreamDefaultWriter<Uint8Array>>>();
const conversationMessages = new Map<string, HubMessage[]>();
const conversationStreams = new Map<string, Set<WritableStreamDefaultWriter<Uint8Array>>>();
const userDMStreams = new Map<string, Set<WritableStreamDefaultWriter<Uint8Array>>>();
const conversationTyping = new Map<string, Map<string, { nickname: string; expiresAt: number }>>();
const conversationReadState = new Map<string, Map<string, { readUntilId: string; readAt: string }>>();

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
};

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function broadcastToRoom(roomId: string, eventName: string, data: unknown) {
  const writers = roomStreams.get(roomId);
  if (!writers || writers.size === 0) return;

  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(payload);

  for (const writer of writers) {
    try {
      writer.write(encoded).catch(() => {
        writers.delete(writer);
      });
    } catch {
      writers.delete(writer);
    }
  }
}

function broadcastToConversation(convId: string, eventName: string, data: unknown) {
  const writers = conversationStreams.get(convId);
  if (!writers || writers.size === 0) return;

  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(payload);

  for (const writer of writers) {
    try {
      writer.write(encoded).catch(() => {
        writers.delete(writer);
      });
    } catch {
      writers.delete(writer);
    }
  }
}

function broadcastToUser(userId: string, eventName: string, data: unknown) {
  const writers = userDMStreams.get(userId);
  if (!writers || writers.size === 0) return;

  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(payload);

  for (const writer of writers) {
    try {
      writer.write(encoded).catch(() => {
        writers.delete(writer);
      });
    } catch {
      writers.delete(writer);
    }
  }
}

function sanitizeContent(input: string): string {
  if (!input) return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
}

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // Optional proxy to external backend if configured
    if (env?.BACKEND_URL && url.pathname.startsWith('/api/')) {
      try {
        const targetUrl = new URL(url.pathname + url.search, env.BACKEND_URL);
        const proxyReq = new Request(targetUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
          redirect: 'follow',
        });
        const proxyRes = await fetch(proxyReq);
        const headers = new Headers(proxyRes.headers);
        Object.entries(CORS_HEADERS).forEach(([k, v]) => headers.set(k, v));
        return new Response(proxyRes.body, {
          status: proxyRes.status,
          statusText: proxyRes.statusText,
          headers,
        });
      } catch (err) {
        console.warn('Backend proxy unreachable, falling back to edge worker logic', err);
      }
    }

    // Health check endpoint
    if (url.pathname === '/api/health') {
      return jsonResponse({
        status: 'healthy',
        app: 'VoxaNex',
        platform: 'Cloudflare Workers (Edge)',
        timestamp: new Date().toISOString(),
      });
    }

    // -------------------------------------------------------------------------
    // 1. SSE LIVE EVENT STREAM: /api/chat/rooms/:roomId/events
    // -------------------------------------------------------------------------
    const userSseMatch = url.pathname.match(/^\/api\/chat\/user\/([^/]+)\/events\/?$/);
    if (userSseMatch && request.method === 'GET') {
      const userId = decodeURIComponent(userSseMatch[1]);
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      if (!userDMStreams.has(userId)) {
        userDMStreams.set(userId, new Set());
      }
      const writers = userDMStreams.get(userId)!;
      writers.add(writer);

      writer.write(encoder.encode(`event: connected\ndata: {"status":"connected","userId":"${userId}"}\n\n`));

      const intervalId = setInterval(() => {
        try {
          writer.write(encoder.encode(`: ping ${Date.now()}\n\n`)).catch(() => {
            clearInterval(intervalId);
            writers.delete(writer);
          });
        } catch {
          clearInterval(intervalId);
          writers.delete(writer);
        }
      }, 15000);

      request.signal?.addEventListener('abort', () => {
        clearInterval(intervalId);
        writers.delete(writer);
        try {
          writer.close();
        } catch {}
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          ...CORS_HEADERS,
        },
      });
    }

    const sseMatch = url.pathname.match(/^\/api\/chat\/rooms\/([^/]+)\/events\/?$/);
    console.log(`[Worker] Incoming request: ${request.method} ${url.pathname}, matched SSE: ${!!sseMatch}`);
    if (sseMatch && request.method === 'GET') {
      const roomId = decodeURIComponent(sseMatch[1]);

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      if (!roomStreams.has(roomId)) {
        roomStreams.set(roomId, new Set());
      }
      const writers = roomStreams.get(roomId)!;
      writers.add(writer);

      // Send initial connection acknowledgement event immediately
      writer.write(encoder.encode(`event: connected\ndata: {"status":"connected","roomId":"${roomId}"}\n\n`));

      // Periodic ping heartbeat to prevent Cloudflare stream termination
      const intervalId = setInterval(() => {
        try {
          writer.write(encoder.encode(`: ping ${Date.now()}\n\n`)).catch(() => {
            clearInterval(intervalId);
            writers.delete(writer);
          });
        } catch {
          clearInterval(intervalId);
          writers.delete(writer);
        }
      }, 15000);

      // Clean up when stream closes
      request.signal?.addEventListener('abort', () => {
        clearInterval(intervalId);
        writers.delete(writer);
        try {
          writer.close();
        } catch {
          // ignore
        }
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          ...CORS_HEADERS,
        },
      });
    }

    // -------------------------------------------------------------------------
    // 2. ROOM MESSAGES: /api/chat/rooms/:roomId/messages
    // -------------------------------------------------------------------------
    const messagesMatch = url.pathname.match(/^\/api\/chat\/rooms\/([^/]+)\/messages$/);
    if (messagesMatch) {
      const roomId = decodeURIComponent(messagesMatch[1]);

      // GET: Retrieve message history
      if (request.method === 'GET') {
        const limitParam = parseInt(url.searchParams.get('limit') || '50', 10);
        const limit = Math.min(Math.max(limitParam, 1), 100);

        if (env?.SUPABASE_URL && env?.SUPABASE_ANON_KEY) {
          try {
            const supabaseUrl = `${env.SUPABASE_URL}/rest/v1/messages?room_id=eq.${roomId}&order=created_at.desc&limit=${limit}`;
            const headers: Record<string, string> = {
              'apikey': env.SUPABASE_ANON_KEY,
            };
            // Pass user's JWT for RLS enforcement
            if (request.headers.has('Authorization')) {
              headers['Authorization'] = request.headers.get('Authorization')!;
            } else {
              headers['Authorization'] = `Bearer ${env.SUPABASE_ANON_KEY}`;
            }

            const res = await fetch(supabaseUrl, { headers });
            const data = await res.json();
            const messages = (Array.isArray(data) ? data : []).reverse().map((m: any) => ({
              id: m.id,
              roomId: m.room_id,
              senderId: m.sender_user_id || m.sender_guest_id || 'anonymous',
              senderNickname: m.sender_nickname,
              senderAvatar: m.sender_avatar,
              content: m.content,
              timestamp: m.created_at,
              isSystem: m.is_system || false,
              status: 'delivered',
            }));
            
            return jsonResponse({ success: true, messages });
          } catch (e) {
            console.error('Supabase fetch error:', e);
            return jsonResponse({ success: false, error: 'Database error' }, 500);
          }
        }
        
        // Fallback if Supabase not configured
        const list = roomMessages.get(roomId) || [];
        const paginated = list.slice(-limit);
        return jsonResponse({ success: true, messages: paginated });
      }

      // POST: Send new message
      if (request.method === 'POST') {
        try {
          const body: any = await request.json();
          const {
            senderId,
            senderNickname,
            senderAvatar,
            senderType = 'guest',
            content,
            mediaUrl,
            mediaType,
            linkPreview,
            clientNonce,
          } = body || {};

          if (!senderId || !senderNickname) {
            return jsonResponse({ success: false, error: 'Invalid sender profile.' }, 400);
          }

          if (!content && !mediaUrl) {
            return jsonResponse({ success: false, error: 'Message content or media is required.' }, 400);
          }

          let verifiedSenderId = senderId;
          let verifiedNickname = senderNickname;
          let verifiedAvatar = senderAvatar || '👤';

          if (senderType === 'guest') {
            const guestToken = body?.guestToken;
            if (!guestToken || !guestSessions.has(guestToken)) {
              return jsonResponse({ success: false, error: 'Unauthorized: Invalid or missing guest session token.' }, 401);
            }
            const session = guestSessions.get(guestToken)!;
            if (Date.now() > session.expiresAt) {
              guestSessions.delete(guestToken);
              return jsonResponse({ success: false, error: 'Unauthorized: Guest session has expired.' }, 401);
            }
            verifiedSenderId = session.id;
            verifiedNickname = session.nickname;
            verifiedAvatar = session.avatar;
          }

          const cleanContent = sanitizeContent(content || '');

          const message: HubMessage = {
            id: crypto.randomUUID(),
            roomId,
            senderId: verifiedSenderId,
            senderNickname: verifiedNickname,
            senderAvatar: verifiedAvatar,
            senderType,
            content: cleanContent,
            rawContent: content,
            mediaUrl,
            mediaType,
            linkPreview,
            clientNonce,
            timestamp: new Date().toISOString(),
            status: 'delivered',
          };

          if (!roomMessages.has(roomId)) {
            roomMessages.set(roomId, []);
          }
          const list = roomMessages.get(roomId)!;

          // Deduplicate if clientNonce already exists
          if (clientNonce && list.some((m) => m.clientNonce === clientNonce)) {
            const existing = list.find((m) => m.clientNonce === clientNonce)!;
            return jsonResponse({ success: true, message: existing });
          }

          list.push(message);
          if (list.length > 500) {
            list.shift();
          }

          // Secure server-side Supabase persistence using service-role key if configured
          if (env?.SUPABASE_URL && env?.SUPABASE_SERVICE_ROLE_KEY) {
            try {
              await fetch(`${env.SUPABASE_URL}/rest/v1/messages`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                  'Prefer': 'return=minimal',
                },
                body: JSON.stringify({
                  id: message.id,
                  room_id: roomId,
                  sender_guest_id: senderType === 'guest' ? verifiedSenderId : null,
                  sender_user_id: senderType === 'registered' ? verifiedSenderId : null,
                  sender_nickname: verifiedNickname,
                  sender_avatar: verifiedAvatar,
                  content: cleanContent,
                  client_nonce: clientNonce,
                }),
              });
            } catch (dbErr) {
              console.warn('Supabase service-role persistence warning:', dbErr);
            }
          }

          // Broadcast to all active SSE subscribers in this room
          broadcastToRoom(roomId, 'new_message', message);

          return jsonResponse({
            success: true,
            message,
          });
        } catch (err: any) {
          return jsonResponse({ success: false, error: 'Failed to process message: ' + (err.message || 'Malformed body') }, 400);
        }
      }
    }

    // -------------------------------------------------------------------------
    // 3. ROOM PRESENCE: /api/chat/rooms/:roomId/presence
    // -------------------------------------------------------------------------
    const presenceMatch = url.pathname.match(/^\/api\/chat\/rooms\/([^/]+)\/presence$/);
    if (presenceMatch) {
      const roomId = decodeURIComponent(presenceMatch[1]);

      if (!roomPresence.has(roomId)) {
        roomPresence.set(roomId, new Map());
      }
      const membersMap = roomPresence.get(roomId)!;

      if (request.method === 'POST') {
        try {
          const body: any = await request.json();
          const { id, nickname, avatar, isGuest, gender, action, status } = body || {};

          if (action === 'leave' || status === 'offline') {
            if (id) {
              membersMap.delete(id);
              const currentMembers = Array.from(membersMap.values());
              broadcastToRoom(roomId, 'presence_update', currentMembers);
              return jsonResponse({ success: true, members: currentMembers });
            }
          }

          if (id && nickname) {
            membersMap.set(id, {
              id,
              nickname,
              avatar: avatar || '👤',
              isGuest: Boolean(isGuest),
              gender,
              lastSeen: Date.now(),
            });
          }

          // Clean up stale members > 45s
          const now = Date.now();
          for (const [mid, m] of membersMap.entries()) {
            if (now - m.lastSeen > 45000) {
              membersMap.delete(mid);
            }
          }

          const currentMembers = Array.from(membersMap.values());
          broadcastToRoom(roomId, 'presence_update', currentMembers);

          return jsonResponse({ success: true, members: currentMembers });
        } catch {
          return jsonResponse({ success: false, members: Array.from(membersMap.values()) });
        }
      }

      if (request.method === 'GET') {
        const now = Date.now();
        const active = Array.from(membersMap.values()).filter((m) => now - m.lastSeen <= 45000);
        return jsonResponse({ success: true, members: active });
      }
    }

    // -------------------------------------------------------------------------
    // 4. ROOM TYPING: /api/chat/rooms/:roomId/typing
    // -------------------------------------------------------------------------
    const typingMatch = url.pathname.match(/^\/api\/chat\/rooms\/([^/]+)\/typing$/);
    if (typingMatch && request.method === 'POST') {
      const roomId = decodeURIComponent(typingMatch[1]);
      try {
        const body: any = await request.json();
        const { memberId, nickname, isTyping } = body || {};

        if (!roomTyping.has(roomId)) {
          roomTyping.set(roomId, new Map());
        }
        const typersMap = roomTyping.get(roomId)!;

        if (isTyping && memberId && nickname) {
          typersMap.set(memberId, { nickname, expiresAt: Date.now() + 3000 });
        } else if (memberId) {
          typersMap.delete(memberId);
        }

        const now = Date.now();
        for (const [tid, t] of typersMap.entries()) {
          if (now > t.expiresAt) typersMap.delete(tid);
        }

        const activeTypers = Array.from(typersMap.values()).map((t) => t.nickname);
        broadcastToRoom(roomId, 'typing_update', { typers: activeTypers });

        return jsonResponse({ success: true });
      } catch {
        return jsonResponse({ success: true });
      }
    }

    // -------------------------------------------------------------------------
    // 5. DIRECT 1-ON-1 CONVERSATION ENDPOINTS
    // -------------------------------------------------------------------------

    // GET /api/chat/conversations/list: Server-backed conversation discovery
    if (url.pathname === '/api/chat/conversations/list' && request.method === 'GET') {
      const userId = url.searchParams.get('userId');
      const guestToken = url.searchParams.get('guestToken');
      
      if (!userId) {
        return jsonResponse({ success: false, error: 'User ID is required.' }, 400);
      }
      
      // Validate guest token if provided (server-side auth)
      if (guestToken && (!guestSessions.has(guestToken) || guestSessions.get(guestToken)?.id !== userId)) {
        return jsonResponse({ success: false, error: 'Unauthorized: Invalid guest session.' }, 401);
      }
      
      if (env?.SUPABASE_URL && env?.SUPABASE_SERVICE_ROLE_KEY) {
        try {
          const supabaseUrl = `${env.SUPABASE_URL}/rest/v1/conversation_participants?user_id=eq.${userId}&select=conversation_id`;
          const res = await fetch(supabaseUrl, {
            headers: {
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
            }
          });
          const data = await res.json();
          const userConvs = (Array.isArray(data) ? data : []).map((p: any) => p.conversation_id);
          return jsonResponse({ success: true, conversations: userConvs });
        } catch (e) {
          console.error('Supabase conv list error:', e);
          return jsonResponse({ success: false, error: 'Database error' }, 500);
        }
      }

      // Fallback
      const userConvs: string[] = [];
      for (const convId of conversationMessages.keys()) {
        if (convId.includes(userId)) {
          userConvs.push(convId);
        }
      }
      return jsonResponse({ success: true, conversations: userConvs });
    }

    // POST /api/chat/conversations: Initialize or get conversation ID
    if (url.pathname === '/api/chat/conversations' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const { userId, partnerId } = body || {};
        if (!userId || !partnerId) {
          return jsonResponse({ success: false, error: 'User ID and Partner ID are required.' }, 400);
        }
        const convId = `conv_${[userId, partnerId].sort().join('_')}`;
        if (!conversationMessages.has(convId)) {
          conversationMessages.set(convId, []);
        }
        return jsonResponse({ success: true, conversationId: convId });
      } catch {
        return jsonResponse({ success: false, error: 'Malformed conversation request' }, 400);
      }
    }

    // GET /api/chat/conversations/:id/events: SSE Stream for conversation
    const convEventsMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/events\/?$/);
    if (convEventsMatch && request.method === 'GET') {
      const convId = decodeURIComponent(convEventsMatch[1]);
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      if (!conversationStreams.has(convId)) {
        conversationStreams.set(convId, new Set());
      }
      const writers = conversationStreams.get(convId)!;
      writers.add(writer);

      writer.write(encoder.encode(`event: connected\ndata: {"status":"connected","convId":"${convId}"}\n\n`));

      const intervalId = setInterval(() => {
        try {
          writer.write(encoder.encode(`: ping ${Date.now()}\n\n`)).catch(() => {
            clearInterval(intervalId);
            writers.delete(writer);
          });
        } catch {
          clearInterval(intervalId);
          writers.delete(writer);
        }
      }, 15000);

      request.signal?.addEventListener('abort', () => {
        clearInterval(intervalId);
        writers.delete(writer);
        try {
          writer.close();
        } catch {
          // ignore
        }
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          ...CORS_HEADERS,
        },
      });
    }

    // /api/chat/conversations/:id/messages: History and Sending
    const convMessagesMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/messages$/);
    if (convMessagesMatch) {
      const convId = decodeURIComponent(convMessagesMatch[1]);

      if (request.method === 'GET') {
        const reqUserId = url.searchParams.get('userId');
        if (reqUserId && convId.startsWith('conv_')) {
          const idWithoutPrefix = convId.replace(/^conv_/, '');
          const isMember =
            idWithoutPrefix.startsWith(reqUserId + '_') ||
            idWithoutPrefix.endsWith('_' + reqUserId) ||
            idWithoutPrefix === reqUserId;
          if (!isMember) {
            return jsonResponse({ success: false, error: 'Unauthorized: Not a member of this conversation.' }, 403);
          }
        }

        if (env?.SUPABASE_URL && env?.SUPABASE_ANON_KEY) {
          try {
            const supabaseUrl = `${env.SUPABASE_URL}/rest/v1/messages?conversation_id=eq.${convId}&order=created_at.asc`;
            const headers: Record<string, string> = {
              'apikey': env.SUPABASE_ANON_KEY,
            };
            // Pass user's JWT for RLS enforcement
            if (request.headers.has('Authorization')) {
              headers['Authorization'] = request.headers.get('Authorization')!;
            } else {
              headers['Authorization'] = `Bearer ${env.SUPABASE_ANON_KEY}`;
            }

            const res = await fetch(supabaseUrl, { headers });
            const data = await res.json();
            const messages = (Array.isArray(data) ? data : []).map((m: any) => ({
              id: m.id,
              conversationId: m.conversation_id,
              senderId: m.sender_user_id || m.sender_guest_id || 'anonymous',
              senderNickname: m.sender_nickname,
              senderAvatar: m.sender_avatar,
              content: m.content,
              timestamp: m.created_at,
              isDirect: true,
              status: 'delivered',
            }));
            return jsonResponse({ success: true, messages });
          } catch (e) {
            console.error('Supabase DM fetch error:', e);
            return jsonResponse({ success: false, error: 'Database error' }, 500);
          }
        }

        const list = conversationMessages.get(convId) || [];
        return jsonResponse({ success: true, messages: list });
      }

      if (request.method === 'POST') {
        try {
          const body: any = await request.json();
          const {
            senderId,
            senderNickname,
            senderAvatar,
            recipientId,
            content,
            mediaUrl,
            mediaType,
            linkPreview,
            clientNonce,
            guestToken,
          } = body || {};

          if (!senderId || (!content && !mediaUrl)) {
            return jsonResponse({ success: false, error: 'Sender ID and content are required.' }, 400);
          }

          // Authorize: Verify that sender is a participant in this conversation
          if (convId.startsWith('conv_')) {
            const idWithoutPrefix = convId.replace(/^conv_/, '');
            const isMember =
              (recipientId && convId === `conv_${[senderId, recipientId].sort().join('_')}`) ||
              idWithoutPrefix.startsWith(senderId + '_') ||
              idWithoutPrefix.endsWith('_' + senderId) ||
              idWithoutPrefix === senderId;

            if (!isMember) {
              return jsonResponse({ success: false, error: 'Unauthorized: Sender is not a member of this conversation.' }, 403);
            }
          }

          // Authorize guest sessions if guest token provided
          if (guestToken && guestSessions.has(guestToken)) {
            const gSession = guestSessions.get(guestToken)!;
            if (gSession.id !== senderId) {
              return jsonResponse({ success: false, error: 'Unauthorized: Guest token mismatch.' }, 403);
            }
          }

          const cleanContent = sanitizeContent(content || '');
          const message: HubMessage = {
            id: crypto.randomUUID(),
            roomId: convId,
            senderId,
            senderNickname: senderNickname || 'User',
            senderAvatar: senderAvatar || '👤',
            senderType: 'registered',
            content: cleanContent,
            rawContent: content,
            mediaUrl,
            mediaType,
            linkPreview,
            clientNonce,
            timestamp: new Date().toISOString(),
            status: 'delivered',
          };

          if (!conversationMessages.has(convId)) {
            conversationMessages.set(convId, []);
          }
          const list = conversationMessages.get(convId)!;

          // Deduplicate by clientNonce
          if (clientNonce && list.some((m) => m.clientNonce === clientNonce)) {
            const existing = list.find((m) => m.clientNonce === clientNonce)!;
            return jsonResponse({ success: true, message: existing });
          }

          list.push(message);
          if (list.length > 500) list.shift();

          // Persist to Supabase if configured
          if (env?.SUPABASE_URL && env?.SUPABASE_SERVICE_ROLE_KEY) {
            try {
              const supabaseUrl = `${env.SUPABASE_URL}/rest/v1/messages`;
              await fetch(supabaseUrl, {
                method: 'POST',
                headers: {
                  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                  'Content-Type': 'application/json',
                  'Prefer': 'return=minimal',
                },
                body: JSON.stringify({
                  conversation_id: convId,
                  sender_user_id: senderId,
                  sender_nickname: senderNickname || 'User',
                  sender_avatar: senderAvatar || '👤',
                  content: cleanContent,
                  media_url: mediaUrl,
                  media_type: mediaType,
                  client_nonce: clientNonce,
                }),
              });
            } catch (dbErr) {
              console.warn('Supabase service-role DM persistence warning:', dbErr);
            }
          }

          // Broadcast to active SSE subscribers on this direct conversation
          broadcastToConversation(convId, 'new_dm', message);
          if (recipientId) {
            broadcastToUser(recipientId, 'incoming_dm', { conversationId: convId, message });
            
            // Bridge across environments
            if (env?.SUPABASE_URL) {
              try {
                // We need to import databaseService or use its implementation.
                // Since this is worker.ts, I will just replicate the broadcast logic here
                // to avoid complex import issues in edge runtime if any.
                const supabase = await import('./lib/supabaseClient').then(m => m.getSupabaseClient());
                if (supabase) {
                    supabase.channel(`user_dm:${recipientId}`).send({
                        type: 'broadcast',
                        event: 'incoming_dm',
                        payload: { conversationId: convId, message },
                    });
                }
              } catch (e) {
                console.warn('[VX-RT] Failed to broadcast DM from worker:', e);
              }
            }
          }

          return jsonResponse({ success: true, message });
        } catch (err: any) {
          return jsonResponse({ success: false, error: 'Failed to deliver message' }, 400);
        }
      }
    }

    // POST /api/chat/conversations/:id/typing
    const convTypingMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/typing$/);
    if (convTypingMatch && request.method === 'POST') {
      const convId = decodeURIComponent(convTypingMatch[1]);
      try {
        const body: any = await request.json();
        const { memberId, nickname, isTyping } = body || {};

        if (!conversationTyping.has(convId)) {
          conversationTyping.set(convId, new Map());
        }
        const typersMap = conversationTyping.get(convId)!;

        if (isTyping && memberId && nickname) {
          typersMap.set(memberId, { nickname, expiresAt: Date.now() + 3000 });
        } else if (memberId) {
          typersMap.delete(memberId);
        }

        const now = Date.now();
        for (const [tid, t] of typersMap.entries()) {
          if (now > t.expiresAt) typersMap.delete(tid);
        }

        const activeTypers = Array.from(typersMap.values()).map((t) => t.nickname);
        broadcastToConversation(convId, 'dm_typing', { typers: activeTypers });

        return jsonResponse({ success: true });
      } catch {
        return jsonResponse({ success: true });
      }
    }

    // POST /api/chat/conversations/:id/read
    const convReadMatch = url.pathname.match(/^\/api\/chat\/conversations\/([^/]+)\/read$/);
    if (convReadMatch && request.method === 'POST') {
      const convId = decodeURIComponent(convReadMatch[1]);
      try {
        const body: any = await request.json();
        const { userId, messageId } = body || {};

        if (userId && messageId) {
          if (convId.startsWith('conv_')) {
            const idWithoutPrefix = convId.replace(/^conv_/, '');
            const isMember =
              idWithoutPrefix.startsWith(userId + '_') ||
              idWithoutPrefix.endsWith('_' + userId) ||
              idWithoutPrefix === userId;
            if (!isMember) {
              return jsonResponse({ success: false, error: 'Unauthorized: Not a member of this conversation.' }, 403);
            }
          }

          if (!conversationReadState.has(convId)) {
            conversationReadState.set(convId, new Map());
          }
          const readMap = conversationReadState.get(convId)!;
          readMap.set(userId, { readUntilId: messageId, readAt: new Date().toISOString() });

          broadcastToConversation(convId, 'dm_read', {
            userId,
            messageId,
            readAt: new Date().toISOString(),
          });
        }

        return jsonResponse({ success: true });
      } catch {
        return jsonResponse({ success: true });
      }
    }

    // -------------------------------------------------------------------------
    // 6. GUEST SESSION ENDPOINTS
    // -------------------------------------------------------------------------
    if (url.pathname === '/api/guest/session' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const { nickname, avatar, gender, languagePref, is18Verified } = body || {};

        const token = `vx_gst_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
        const session: GuestSession = {
          id: `guest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          token,
          nickname: nickname || 'Guest_User',
          avatar: avatar || '⚡',
          gender,
          languagePref: languagePref || 'en',
          is18Verified: Boolean(is18Verified),
          createdAt: Date.now(),
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        };

        guestSessions.set(token, session);

        return jsonResponse({ success: true, session });
      } catch (err: any) {
        return jsonResponse({ success: false, error: 'Malformed guest registration' }, 400);
      }
    }

    if (url.pathname === '/api/guest/validate') {
      const token = url.searchParams.get('token') || (request.method === 'POST' ? ((await request.json().catch(() => ({}))) as any)?.token : null);
      if (token && guestSessions.has(token)) {
        const session = guestSessions.get(token)!;
        return jsonResponse({ success: true, valid: true, session });
      }
      return jsonResponse({ success: true, valid: true });
    }

    if (url.pathname === '/api/guest/revoke' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        if (body?.token) {
          guestSessions.delete(body.token);
        }
      } catch {
        // ignore
      }
      return jsonResponse({ success: true });
    }

    // -------------------------------------------------------------------------
    // 6. DEFAULT API FALLBACK FOR UNHANDLED /api/* ROUTES
    // -------------------------------------------------------------------------
    if (url.pathname.startsWith('/api/')) {
      return jsonResponse({
        success: true,
        message: 'Endpoint acknowledged by ChatLustora Edge Worker',
        path: url.pathname,
      });
    }

    // -------------------------------------------------------------------------
    // 7. STATIC ASSETS FALLBACK (Vite SPA)
    // -------------------------------------------------------------------------
    if (env?.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
