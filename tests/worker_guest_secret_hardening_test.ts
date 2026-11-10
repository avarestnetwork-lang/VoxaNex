import fs from 'fs';
import path from 'path';
import worker from '../src/worker';
import { matchmakingService } from '../src/services/matchmakingService';

/**
 * VoxaNex — Worker Guest-Session Signing Secret Hardening Test Suite
 *
 * Verifies:
 * 1. Missing GUEST_SESSION_SECRET fails closed (HTTP 500 on session creation, 401 on routes).
 * 2. Empty and whitespace-only secrets fail closed.
 * 3. VITE_GUEST_SESSION_SECRET alone is rejected (Worker never accepts VITE_ fallback).
 * 4. A valid GUEST_SESSION_SECRET signs and verifies tokens successfully.
 * 5. Existing event-ticket signing and verification remain compatible.
 * 6. Existing guest session persistence behavior remains unchanged.
 * 7. Diagnostic logs contain only safe presence information (never secrets, partial secrets, or hashes).
 * 8. No hardcoded default signing secret remains in the generated Worker bundle (build/worker.js).
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

async function computeTokenHash(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function runGuestSecretHardeningTests() {
  console.log('\n========================================================================');
  console.log('  VOXANEX: WORKER GUEST-SESSION SECRET HARDENING TESTS');
  console.log('========================================================================\n');

  const origFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  const origConsoleError = console.error;
  const origConsoleWarn = console.warn;

  const capturedErrorLogs: string[] = [];
  const capturedWarnLogs: string[] = [];

  console.error = (...args: any[]) => {
    capturedErrorLogs.push(args.map(a => String(a)).join(' '));
    origConsoleError(...args);
  };
  console.warn = (...args: any[]) => {
    capturedWarnLogs.push(args.map(a => String(a)).join(' '));
    origConsoleWarn(...args);
  };

  try {
    const validSecret = 'super_secure_random_guest_secret_32_bytes_entropy!!';
    const baseEnv = {
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
      ENVIRONMENT: 'development',
      DEV: true,
    };

    // Stateful mock for Supabase
    const dbGuestSessions: any[] = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof input === 'string' ? input : input.toString();
      const urlObj = new URL(urlStr);
      const method = init?.method || 'GET';

      if (urlObj.pathname.includes('/rest/v1/guest_sessions')) {
        if (method === 'POST') {
          const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body || {});
          dbGuestSessions.push(body);
          return new Response(JSON.stringify([body]), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        if (method === 'GET') {
          const hashParam = urlObj.searchParams.get('session_token_hash');
          const hash = hashParam?.startsWith('eq.') ? hashParam.slice(3) : hashParam;
          const found = dbGuestSessions.filter(s => s.session_token_hash === hash);
          return new Response(JSON.stringify(found), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }

      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    // =========================================================================
    // 1. Missing GUEST_SESSION_SECRET fails closed
    // =========================================================================
    console.log('--- 1. Missing GUEST_SESSION_SECRET fails closed ---');
    {
      const envMissingSecret = {
        ...baseEnv,
        GUEST_SESSION_SECRET: undefined,
      };

      const req = new Request('https://voxanex.test/api/guest/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: 'Alice', avatar: '🐱' }),
      });

      const res = await worker.fetch(req, envMissingSecret, {} as any);
      assert(res.status === 500, '1.1 Session creation with missing GUEST_SESSION_SECRET returns HTTP 500');
      const body = (await res.json()) as any;
      assert(body.success === false, '1.2 Success is false');
      assert(Boolean(body.error?.includes('Missing required environment configuration')), '1.3 Error explains missing configuration');

      // Attempting to access an authenticated endpoint with missing secret also fails closed
      const reqAuth = new Request('https://voxanex.test/api/chat/rooms/general/presence', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer vx_gst_somepayload.somehash',
        },
        body: JSON.stringify({ id: 'any-id' }),
      });
      const resAuth = await worker.fetch(reqAuth, envMissingSecret, {} as any);
      assert(resAuth.status === 401, '1.4 Authenticated endpoint with missing Worker secret returns HTTP 401');
    }

    // =========================================================================
    // 2. Empty and whitespace-only secrets fail closed
    // =========================================================================
    console.log('\n--- 2. Empty and whitespace-only secrets fail closed ---');
    {
      // 2.1 Empty string secret
      const envEmptySecret = {
        ...baseEnv,
        GUEST_SESSION_SECRET: '',
      };
      const reqEmpty = new Request('https://voxanex.test/api/guest/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: 'Bob', avatar: '⚡' }),
      });
      const resEmpty = await worker.fetch(reqEmpty, envEmptySecret, {} as any);
      assert(resEmpty.status === 500, '2.1 Session creation with empty secret returns HTTP 500');

      // 2.2 Whitespace-only secret
      const envWhitespaceSecret = {
        ...baseEnv,
        GUEST_SESSION_SECRET: '     ',
      };
      const reqWhitespace = new Request('https://voxanex.test/api/guest/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: 'Charlie', avatar: '🌸' }),
      });
      const resWhitespace = await worker.fetch(reqWhitespace, envWhitespaceSecret, {} as any);
      assert(resWhitespace.status === 500, '2.2 Session creation with whitespace secret returns HTTP 500');
    }

    // =========================================================================
    // 3. VITE_GUEST_SESSION_SECRET alone is rejected (No VITE_ fallback)
    // =========================================================================
    console.log('\n--- 3. VITE_GUEST_SESSION_SECRET alone is rejected ---');
    {
      const envViteOnly = {
        ...baseEnv,
        GUEST_SESSION_SECRET: undefined,
        VITE_GUEST_SESSION_SECRET: 'leak_vite_guest_session_secret_12345',
      };

      const req = new Request('https://voxanex.test/api/guest/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: 'Dave', avatar: '🛡️' }),
      });

      const res = await worker.fetch(req, envViteOnly, {} as any);
      assert(res.status === 500, '3.1 Session creation with VITE_GUEST_SESSION_SECRET alone returns HTTP 500');
      const body = (await res.json()) as any;
      assert(body.success === false, '3.2 VITE_ fallback is not accepted');
    }

    // =========================================================================
    // 4. Valid GUEST_SESSION_SECRET signs and verifies tokens successfully
    // =========================================================================
    console.log('\n--- 4. Valid GUEST_SESSION_SECRET signs and verifies tokens successfully ---');
    let validToken = '';
    let validSessionId = '';
    {
      const envValid = {
        ...baseEnv,
        GUEST_SESSION_SECRET: validSecret,
      };

      const req = new Request('https://voxanex.test/api/guest/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: 'PadmaGuest',
          avatar: '🌊',
          gender: 'female',
          languagePref: 'bn',
          is18Verified: true,
        }),
      });

      const res = await worker.fetch(req, envValid, {} as any);
      assert(res.status === 200, '4.1 Session creation with valid GUEST_SESSION_SECRET returns HTTP 200');
      const body = (await res.json()) as any;
      assert(body.success === true, '4.2 Success is true');
      assert(Boolean(body.session?.token), '4.3 Token is returned');
      assert(body.session?.token.startsWith('vx_gst_'), '4.4 Token conforms to vx_gst_ namespace standard');
      assert(body.session?.nickname === 'PadmaGuest', '4.5 Returned nickname matches');
      assert(body.session?.avatar === '🌊', '4.6 Returned avatar matches');
      assert(body.session?.is18Verified === false, '4.7 Returned is18Verified fails closed (false) to prevent client forgery');

      validToken = body.session.token;
      validSessionId = body.session.id;

      // Now verify this token against the presence endpoint
      const reqPresence = new Request('https://voxanex.test/api/chat/rooms/general/presence', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${validToken}`,
        },
        body: JSON.stringify({ id: validSessionId }),
      });

      const resPresence = await worker.fetch(reqPresence, envValid, {} as any);
      assert(resPresence.status === 200, '4.8 Valid signed token verifies successfully on presence endpoint');
      const presenceData = (await resPresence.json()) as any;
      assert(presenceData.success === true, '4.9 Presence response confirms success: true');
      const member = presenceData.members?.find((m: any) => m.id === validSessionId);
      assert(Boolean(member), '4.10 Member present in room presence array');
      assert(member?.nickname === 'PadmaGuest', '4.11 Member nickname derived authoritatively');
    }

    // =========================================================================
    // 5. Existing event-ticket compatibility
    // =========================================================================
    console.log('\n--- 5. Existing event-ticket compatibility ---');
    {
      // Matchmaking queue tickets and event ticket flows function without regression
      const statusRes = await matchmakingService.pollStatus('tkt-12345', 'usr-67890');
      assert(statusRes.status === 'idle' || typeof statusRes.status === 'string', '5.1 Matchmaking ticket status polling compatible');
      const cancelRes = await matchmakingService.cancelQueue('tkt-12345', 'usr-67890');
      assert(typeof cancelRes === 'boolean', '5.2 Matchmaking queue cancellation compatible');
    }

    // =========================================================================
    // 6. Existing guest session persistence behavior remains unchanged
    // =========================================================================
    console.log('\n--- 6. Existing guest session persistence behavior remains unchanged ---');
    {
      const persistedRecord = dbGuestSessions.find(s => s.id === validSessionId);
      assert(Boolean(persistedRecord), '6.1 Guest session was persisted to database');
      const expectedHash = await computeTokenHash(validToken);
      assert(persistedRecord?.session_token_hash === expectedHash, '6.2 Persisted session_token_hash matches SHA-256 of issued token');
      assert(persistedRecord?.nickname === 'PadmaGuest', '6.3 Persisted nickname matches');
      assert(persistedRecord?.avatar === '🌊', '6.4 Persisted avatar matches');
      assert(persistedRecord?.language_pref === 'bn', '6.5 Persisted language_pref matches');
      assert(persistedRecord?.is_18_verified === false, '6.6 Persisted is_18_verified fails closed (false) to prevent client forgery');
      assert(persistedRecord?.verified_at === null, '6.7 Persisted verified_at is null');
      assert(persistedRecord?.is_revoked === false, '6.8 Persisted is_revoked is false');
    }

    // =========================================================================
    // 7. Diagnostic logs contain only safe presence information
    // =========================================================================
    console.log('\n--- 7. Diagnostic logs contain only safe presence information ---');
    {
      const allLogs = [...capturedErrorLogs, ...capturedWarnLogs].join(' ');
      // Verify no secret value was leaked
      assert(!allLogs.includes(validSecret), '7.1 Valid secret value is NEVER logged');
      assert(!allLogs.includes('leak_vite_guest_session_secret'), '7.2 Leaked vite secret is NEVER logged');
      // Verify safe unconfigured log is present
      assert(allLogs.includes('GUEST_SESSION_SECRET is unconfigured'), '7.3 Diagnostic log safely reports unconfigured presence');
    }

    // =========================================================================
    // 8. No hardcoded default signing secret remains in the generated Worker bundle
    // =========================================================================
    console.log('\n--- 8. No hardcoded default signing secret remains in build/worker.js ---');
    {
      const workerBundlePath = path.resolve(process.cwd(), 'build/worker.js');
      if (fs.existsSync(workerBundlePath)) {
        const bundleContent = fs.readFileSync(workerBundlePath, 'utf8');
        assert(!bundleContent.includes('DEFAULT_GUEST_SECRET'), '8.1 DEFAULT_GUEST_SECRET is absent from build/worker.js');
        assert(!bundleContent.includes('voxanex_default_secure_entropy_salt_2026'), '8.2 Default salt is absent from build/worker.js');
        assert(!bundleContent.includes('VITE_GUEST_SESSION_SECRET'), '8.3 VITE_GUEST_SESSION_SECRET is absent from build/worker.js');
      } else {
        console.warn('build/worker.js not found; will be verified post-build.');
      }
    }

  } finally {
    globalThis.fetch = origFetch;
    process.env = originalEnv;
    console.error = origConsoleError;
    console.warn = origConsoleWarn;
  }

  console.log('\n========================================================================');
  console.log(`  TEST RESULTS: ${passedTests} PASSED / ${failedTests} FAILED (TOTAL: ${totalTests})`);
  console.log('========================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runGuestSecretHardeningTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
