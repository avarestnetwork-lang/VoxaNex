/**
 * VoxaNex Private Messaging & Participant Retry Persistence Test Suite
 */

import worker from '../src/worker';
import { databaseService } from '../src/services/databaseService';

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

const env = {
  GUEST_SESSION_SECRET: GUEST_SECRET,
  SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  ENVIRONMENT: 'development'
};

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

async function runTests() {
  console.log('🚀 Starting Private Messaging & Participant Retry Persistence Tests...');
  const originalFetch = globalThis.fetch;

  try {
    const guestAId = '44444444-0000-0000-0000-000000000004';
    const guestBId = '55555555-0000-0000-0000-000000000005';
    const tokenGuestA = await createGuestToken({ sid: guestAId, nick: 'GuestA', exp: Date.now() + 100000, iat: Date.now() });
    const hashGuestA = await computeHash(tokenGuestA);
    const dbConvId = await databaseService.getDeterministicConvId(guestAId, guestBId);

    // Scenario A: Successful duplicate recovery (POST returns 409, retry GET returns matching participant row)
    {
      globalThis.fetch = (async (url: any, init: any) => {
        const urlStr = url.toString();
        if (urlStr.includes('/rest/v1/guest_sessions')) {
          if (urlStr.includes(hashGuestA) || urlStr.includes(guestAId)) {
            return new Response(JSON.stringify([{ id: guestAId, is_revoked: false, expires_at: new Date(Date.now() + 100000).toISOString(), session_token_hash: hashGuestA }]), { status: 200 });
          }
          if (urlStr.includes(guestBId)) {
            return new Response(JSON.stringify([{ id: guestBId, is_revoked: false, expires_at: new Date(Date.now() + 100000).toISOString() }]), { status: 200 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes('/rest/v1/profiles')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes('/rest/v1/conversations')) {
          return new Response(JSON.stringify([{ id: dbConvId }]), { status: 201 });
        }
        if (urlStr.includes('/rest/v1/conversation_participants')) {
          const method = init?.method || 'GET';
          if (method === 'POST') {
            return new Response(JSON.stringify({ message: 'Conflict duplicate' }), { status: 409 });
          }
          const urlObj = new URL(urlStr);
          const select = urlObj.searchParams.get('select');
          if (select === 'id') {
            return new Response(JSON.stringify([]), { status: 200 });
          } else {
            const guestIdMatch = urlStr.includes(guestAId) ? guestAId : guestBId;
            return new Response(JSON.stringify([
              { conversation_id: dbConvId, guest_id: guestIdMatch, user_id: null }
            ]), { status: 200 });
          }
        }
        return new Response('Not Found', { status: 404 });
      }) as any;

      const req = new Request('https://voxanex.test/api/chat/conversations', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenGuestA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId: guestBId })
      });

      const res = await worker.fetch(req, env, {});
      const data: any = await res.json();
      assert(res.status === 200, 'A.1: Successful duplicate recovery returns 200');
      assert(data.success === true, 'A.2: Success flag true on successful recovery');
    }

    // Scenario B: Failed duplicate recovery (POST returns 409, retry GET returns empty array)
    {
      globalThis.fetch = (async (url: any, init: any) => {
        const urlStr = url.toString();
        if (urlStr.includes('/rest/v1/guest_sessions')) {
          if (urlStr.includes(hashGuestA) || urlStr.includes(guestAId)) {
            return new Response(JSON.stringify([{ id: guestAId, is_revoked: false, expires_at: new Date(Date.now() + 100000).toISOString(), session_token_hash: hashGuestA }]), { status: 200 });
          }
          if (urlStr.includes(guestBId)) {
            return new Response(JSON.stringify([{ id: guestBId, is_revoked: false, expires_at: new Date(Date.now() + 100000).toISOString() }]), { status: 200 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes('/rest/v1/profiles')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes('/rest/v1/conversations')) {
          return new Response(JSON.stringify([{ id: dbConvId }]), { status: 201 });
        }
        if (urlStr.includes('/rest/v1/conversation_participants')) {
          const method = init?.method || 'GET';
          if (method === 'POST') {
            return new Response(JSON.stringify({ message: 'Conflict duplicate' }), { status: 409 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
      }) as any;

      const req = new Request('https://voxanex.test/api/chat/conversations', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenGuestA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId: guestBId })
      });

      const res = await worker.fetch(req, env, {});
      assert(res.status === 500, 'B.1: Failed duplicate recovery (empty retry array) returns 500 error');
    }

    // Scenario C: Incorrect participant recovery (POST returns 409, retry GET returns mismatching participant or conversation)
    {
      globalThis.fetch = (async (url: any, init: any) => {
        const urlStr = url.toString();
        if (urlStr.includes('/rest/v1/guest_sessions')) {
          if (urlStr.includes(hashGuestA) || urlStr.includes(guestAId)) {
            return new Response(JSON.stringify([{ id: guestAId, is_revoked: false, expires_at: new Date(Date.now() + 100000).toISOString(), session_token_hash: hashGuestA }]), { status: 200 });
          }
          if (urlStr.includes(guestBId)) {
            return new Response(JSON.stringify([{ id: guestBId, is_revoked: false, expires_at: new Date(Date.now() + 100000).toISOString() }]), { status: 200 });
          }
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes('/rest/v1/profiles')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (urlStr.includes('/rest/v1/conversations')) {
          return new Response(JSON.stringify([{ id: dbConvId }]), { status: 201 });
        }
        if (urlStr.includes('/rest/v1/conversation_participants')) {
          const method = init?.method || 'GET';
          if (method === 'POST') {
            return new Response(JSON.stringify({ message: 'Conflict duplicate' }), { status: 409 });
          }
          const urlObj = new URL(urlStr);
          const select = urlObj.searchParams.get('select');
          if (select === 'id') {
            return new Response(JSON.stringify([]), { status: 200 });
          }
          // Retry GET returns row with wrong guest_id
          return new Response(JSON.stringify([
            { conversation_id: dbConvId, guest_id: '00000000-0000-0000-0000-000000000099', user_id: null }
          ]), { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
      }) as any;

      const req = new Request('https://voxanex.test/api/chat/conversations', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenGuestA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId: guestBId })
      });

      const res = await worker.fetch(req, env, {});
      assert(res.status === 500, 'C.1: Incorrect participant recovery returns 500 error');
    }

    // Scenario D: Malformed JSON (POST returns 409, retry GET returns malformed JSON)
    {
      globalThis.fetch = (async (url: any, init: any) => {
        const urlStr = url.toString();
        if (urlStr.includes('/rest/v1/guest_sessions')) {
          return new Response(JSON.stringify([{ id: guestAId, is_revoked: false, expires_at: new Date(Date.now() + 100000).toISOString(), session_token_hash: hashGuestA }]), { status: 200 });
        }
        if (urlStr.includes('/rest/v1/profiles')) {
          return new Response(JSON.stringify([{ id: guestBId, nickname: 'GuestB', avatar_url: '🌸' }]), { status: 200 });
        }
        if (urlStr.includes('/rest/v1/conversations')) {
          return new Response(JSON.stringify([{ id: dbConvId }]), { status: 201 });
        }
        if (urlStr.includes('/rest/v1/conversation_participants')) {
          const method = init?.method || 'GET';
          if (method === 'POST') {
            return new Response(JSON.stringify({ message: 'Conflict duplicate' }), { status: 409 });
          }
          // Retry GET returns malformed JSON
          return new Response('NOT_JSON', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('Not Found', { status: 404 });
      }) as any;

      const req = new Request('https://voxanex.test/api/chat/conversations', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${tokenGuestA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId: guestBId })
      });

      const res = await worker.fetch(req, env, {});
      assert(res.status === 500, 'D.1: Malformed JSON retry returns 500 error');
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
  }
}

runTests();
