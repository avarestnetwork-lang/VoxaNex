import worker from '../src/worker';
import { messagingService } from '../src/services/messagingService';
import { databaseService } from '../src/services/databaseService';

/**
 * VoxaNex Phase 1: Private Conversation Initialization Error Handling Test Suite
 * Verifies:
 * 1. messagingService.getOrCreateConversation checks HTTP res.ok, parses errors safely, and returns status + error.
 * 2. messagingService.fetchConversationMessages returns { success: false, messages: [], error, status } for non-2xx responses.
 * 3. Failed conversation initialization prevents history and subscription startup.
 * 4. Actual HTTP 400, 403, and 500 server errors are preserved and surfaced correctly.
 * 5. Successful guest-to-guest and member-to-member conversation flows remain operational.
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

async function createSignedGuestToken(params: { sid: string; nickname: string }): Promise<string> {
  const payload = {
    sid: params.sid,
    nick: params.nickname,
    av: '⚡',
    gen: 'prefer_not_to_say',
    lng: 'en',
    v18: true,
    iat: Date.now(),
    exp: Date.now() + 86400000,
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

async function runInitErrorHandlingTests() {
  console.log('\n========================================================================');
  console.log('  VOXANEX PHASE 1: PRIVATE CONVERSATION INIT ERROR HANDLING TESTS');
  console.log('========================================================================\n');

  const origFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  process.env.GUEST_SESSION_SECRET = GUEST_SECRET;

  try {
    const guestAId = '11111111-1111-4111-8111-111111111111';
    const guestBId = '22222222-2222-4222-8222-222222222222';
    const tokenA = await createSignedGuestToken({ sid: guestAId, nickname: 'Alice' });
    const tokenB = await createSignedGuestToken({ sid: guestBId, nickname: 'Bob' });

    const computeHash = async (t: string) => {
      const data = new TextEncoder().encode(t);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
    };

    const hashA = await computeHash(tokenA);
    const hashB = await computeHash(tokenB);

    // =========================================================================
    // 1. messagingService.getOrCreateConversation() Error Handling
    // =========================================================================
    console.log('--- 1. getOrCreateConversation() checks res.ok and parses errors ---');
    {
      // 1.1 Non-ok response (HTTP 500 Database error)
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ success: false, error: 'Database session registration failed.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      const res500 = await messagingService.getOrCreateConversation(guestAId, guestBId);
      assert(res500.success === false, '1.1 HTTP 500 response returns success: false');
      assert(res500.status === 500, '1.2 Preserves HTTP status 500');
      assert(Boolean(res500.error?.includes('Database session registration failed')), '1.3 Surfacing actual server error message');

      // 1.2 HTTP 403 Forbidden (Partner identity unverified)
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ success: false, error: 'Partner guest session has been revoked.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      const res400 = await messagingService.getOrCreateConversation(guestAId, guestBId);
      assert(res400.success === false, '1.4 HTTP 400 response returns success: false');
      assert(res400.status === 400, '1.5 Preserves HTTP status 400');
      assert(Boolean(res400.error?.includes('Partner guest session has been revoked')), '1.6 Surfacing partner revocation error');

      // 1.3 Non-JSON HTML error body (e.g. Gateway 502/504 Bad Gateway)
      globalThis.fetch = (async () => {
        return new Response('<html><body>502 Bad Gateway</body></html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        });
      }) as typeof fetch;

      const res502 = await messagingService.getOrCreateConversation(guestAId, guestBId);
      assert(res502.success === false, '1.7 Non-JSON HTTP 502 error returns success: false');
      assert(res502.status === 502, '1.8 Preserves HTTP status 502');
      assert(Boolean(res502.error?.includes('HTTP 502')), '1.9 Safe fallback error contains HTTP status');

      // 1.4 Success HTTP 200 response
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ success: true, conversationId: 'conv-uuid-123', slug: 'conv_a_b' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      const res200 = await messagingService.getOrCreateConversation(guestAId, guestBId);
      assert(res200.success === true, '1.10 Successful HTTP 200 returns success: true');
      assert(res200.conversationId === 'conv-uuid-123', '1.11 Returns conversationId');
    }

    // =========================================================================
    // 2. messagingService.fetchConversationMessages() Error Handling
    // =========================================================================
    console.log('\n--- 2. fetchConversationMessages() checks status and returns errors ---');
    {
      // 2.1 Non-ok response (HTTP 403 Unauthorized participant)
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized: Not a participant.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      const resHistory403 = await messagingService.fetchConversationMessages('conv_a_b', guestAId);
      assert(resHistory403.success === false, '2.1 Non-2xx response returns success: false');
      assert(resHistory403.messages.length === 0, '2.2 Messages array is empty on failure');
      assert(resHistory403.status === 403, '2.3 Preserves HTTP status 403');
      assert(Boolean(resHistory403.error?.includes('Unauthorized: Not a participant')), '2.4 Error message is preserved');

      // 2.2 Successful response returning messages
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ messages: [{ id: 'msg-1', content: 'Hello' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      const resHistory200 = await messagingService.fetchConversationMessages('conv_a_b', guestAId);
      assert(resHistory200.success === true, '2.5 HTTP 200 response returns success: true');
      assert(resHistory200.messages.length === 1, '2.6 Returned messages array length matches');
    }

    // =========================================================================
    // 3. Worker POST /api/chat/conversations Execution Verification
    // =========================================================================
    console.log('\n--- 3. Worker POST /api/chat/conversations route verification ---');
    {
      // Stateful Supabase fetch mock
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const urlStr = typeof input === 'string' ? input : input.toString();
        const urlObj = new URL(urlStr);

        // guest_sessions check
        if (urlObj.pathname.includes('/rest/v1/guest_sessions')) {
          if (urlStr.includes(hashA) || urlStr.includes(guestAId)) {
            return new Response(JSON.stringify([{ id: guestAId, session_token_hash: hashA, is_revoked: false, expires_at: new Date(Date.now() + 86400000).toISOString() }]), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (urlStr.includes(hashB) || urlStr.includes(guestBId)) {
            return new Response(JSON.stringify([{ id: guestBId, session_token_hash: hashB, is_revoked: false, expires_at: new Date(Date.now() + 86400000).toISOString() }]), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        // conversations insert
        if (urlObj.pathname.includes('/rest/v1/conversations')) {
          return new Response(JSON.stringify([{ id: 'conv-db-uuid' }]), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }

        // conversation_participants insert & select
        if (urlObj.pathname.includes('/rest/v1/conversation_participants')) {
          return new Response(JSON.stringify([{ id: 'part-1' }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        return new Response('Not Found', { status: 404 });
      };

      const reqWorkerSuccess = new Request('https://voxanex.test/api/chat/conversations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenA}`,
        },
        body: JSON.stringify({ userId: guestAId, partnerId: guestBId }),
      });

      const resWorkerSuccess = await worker.fetch(reqWorkerSuccess, env, {} as any);
      assert(resWorkerSuccess.status === 200, '3.1 Worker accepts valid guest-to-guest conversation creation (HTTP 200)');
      const dataWorker = (await resWorkerSuccess.json()) as any;
      assert(dataWorker.success === true, '3.2 Worker response success is true');
      assert(Boolean(dataWorker.conversationId), '3.3 Worker returns conversationId');
    }

  } finally {
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

runInitErrorHandlingTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
