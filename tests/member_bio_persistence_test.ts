/**
 * ChatLustora / VoxaNex — Phase 1: Registered Member Bio Persistence Test Suite
 *
 * Tests (with mocked Supabase/Worker/fetch infrastructure — NOT live Staging DB):
 * 1. Supabase client unavailable -> authService.updateProfile fails closed.
 * 2. Missing authenticated session -> authService.updateProfile fails closed.
 * 3. Worker returns HTTP 401 -> authService.updateProfile reports failure.
 * 4. Worker returns HTTP 404 -> authService.updateProfile reports failure.
 * 5. Worker returns HTTP 500 -> authService.updateProfile reports failure.
 * 6. Network exception -> authService.updateProfile reports failure.
 * 7. Worker returns malformed JSON -> authService.updateProfile reports failure.
 * 8. Worker confirms success (via real worker.fetch + in-memory DB mock) -> returns success: true.
 * 9. Registered member Bio and nickname are submitted together in one request.
 * 10. Reloading profile via authService.restoreSession() / getProfile() retrieves persisted Bio.
 * 11. Guest behavior remains unchanged (AuthContext skips DB persistence for guests; Worker rejects guests with 403).
 * 12. AuthContext, MemberDashboardPage, and ProfileSettingsPage enforce fail-closed & single-request save flows.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as esbuild from 'esbuild';
import worker from '../src/worker';
import { authService as unconfiguredAuthService } from '../src/services/authService';

let totalAssertions = 0;
function assert(condition: boolean, testName: string, detail?: string) {
  totalAssertions++;
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
    throw new Error(`Assertion failed: ${testName}${detail ? ` (${detail})` : ''}`);
  } else {
    console.log(`✅ [PASSED] ${testName}`);
  }
}

function toBase64Url(str: string): string {
  return Buffer.from(str, 'utf-8').toString('base64url');
}

function createMockJwt(userId: string): string {
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = toBase64Url(
    JSON.stringify({
      sub: userId,
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  );
  return `${header}.${payload}.mock_signature_for_test_only`;
}

async function runMemberBioPersistenceTests() {
  console.log('\n====================================================================');
  console.log('  VOXANEX / CHATLUSTORA: MEMBER BIO PERSISTENCE RELIABILITY TESTS');
  console.log('====================================================================\n');

  const originalFetch = globalThis.fetch;
  const originalLocalStorage = (globalThis as any).localStorage;
  const originalWindow = (globalThis as any).window;
  const tmpEntryPath = path.join(os.tmpdir(), `voxanex_auth_entry_${Date.now()}.ts`);
  const tmpBundlePath = path.join(os.tmpdir(), `voxanex_auth_service_test_${Date.now()}.mjs`);

  const memberId = '11111111-2222-3333-4444-555555555555';
  const memberJwt = createMockJwt(memberId);
  const supabaseUrl = 'https://test-staging-mock.supabase.co';
  const supabaseAnonKey = 'test_anon_key_for_unit_tests_only';

  const workerEnv = {
    ENVIRONMENT: 'development',
    DEV: true,
    GUEST_SESSION_SECRET: 'test_guest_session_secret_1234567890_super_secure',
    SUPABASE_URL: supabaseUrl,
    SUPABASE_ANON_KEY: supabaseAnonKey,
    SUPABASE_SERVICE_ROLE_KEY: 'test_service_role_key_for_unit_tests_only',
  };

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Supabase client unavailable -> profile update fails closed
    // -------------------------------------------------------------------------
    console.log('--- 1. Supabase Unavailable Fail-Closed Check ---');
    const unconfiguredRes = await unconfiguredAuthService.updateProfile(memberId, {
      nickname: 'UpdatedNick',
      bio: 'Persisted Bio Check',
    });
    assert(
      unconfiguredRes.success === false && typeof unconfiguredRes.error === 'string' && unconfiguredRes.error.length > 0,
      '1.1 Supabase client unavailable returns { success: false, error }'
    );

    // -------------------------------------------------------------------------
    // Build isolated bundle exporting authService + getSupabaseClient with test env
    // -------------------------------------------------------------------------
    const memoryStorage: Record<string, string> = {};
    const mockStorage = {
      getItem: (k: string) => (k in memoryStorage ? memoryStorage[k] : null),
      setItem: (k: string, v: string) => {
        memoryStorage[k] = String(v);
      },
      removeItem: (k: string) => {
        delete memoryStorage[k];
      },
      clear: () => {
        for (const k of Object.keys(memoryStorage)) delete memoryStorage[k];
      },
    };
    (globalThis as any).localStorage = mockStorage;
    (globalThis as any).window = {
      localStorage: mockStorage,
      location: { origin: 'https://chatlustora.com' },
    };

    const absAuthService = path.resolve('src/services/authService.ts');
    const absSupabaseClient = path.resolve('src/lib/supabaseClient.ts');
    fs.writeFileSync(
      tmpEntryPath,
      `export { authService } from ${JSON.stringify(absAuthService)};\nexport { getSupabaseClient } from ${JSON.stringify(absSupabaseClient)};\n`
    );

    esbuild.buildSync({
      entryPoints: [tmpEntryPath],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      outfile: tmpBundlePath,
      define: {
        'import.meta.env': JSON.stringify({
          VITE_SUPABASE_URL: supabaseUrl,
          VITE_SUPABASE_ANON_KEY: supabaseAnonKey,
        }),
      },
    });

    const bundledModule = await import(`file://${tmpBundlePath}`);
    const configuredAuthService = bundledModule.authService;
    const supabaseClient = bundledModule.getSupabaseClient();
    assert(Boolean(supabaseClient), '1.2 Bundled test Supabase client initializes properly');

    // -------------------------------------------------------------------------
    // TEST 2: Missing authenticated session -> profile update fails closed
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Missing Authenticated Session Fail-Closed Check ---');
    mockStorage.clear();
    const noSessionRes = await configuredAuthService.updateProfile(memberId, {
      nickname: 'TestNick',
      bio: 'Should fail without session',
    });
    assert(
      noSessionRes.success === false && typeof noSessionRes.error === 'string' && noSessionRes.error.includes('session'),
      '2.1 Missing authenticated session returns { success: false, error }'
    );

    // Activate authenticated session via supabaseClient.auth.setSession()
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (urlStr.includes('/auth/v1/user')) {
        return new Response(
          JSON.stringify({
            id: memberId,
            aud: 'authenticated',
            role: 'authenticated',
            email: 'member@example.com',
            user_metadata: { nickname: 'InitialNick', gender: 'male' },
            created_at: '2026-01-01T00:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    await supabaseClient.auth.setSession({
      access_token: memberJwt,
      refresh_token: 'mock_refresh_token',
    });
    const sessionCheck = await supabaseClient.auth.getSession();
    assert(
      sessionCheck?.data?.session?.access_token === memberJwt,
      '2.2 Authenticated member session established in Supabase client'
    );

    // -------------------------------------------------------------------------
    // TEST 3: Worker returns HTTP 401 -> failure
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Worker HTTP Error & Edge-Case Handling ---');
    let endpointCalledCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (urlStr === '/api/auth/profile/update') endpointCalledCount++;
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized: leaked stack trace' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;
    const res401 = await configuredAuthService.updateProfile(memberId, { nickname: 'Nick', bio: 'Bio' });
    assert(endpointCalledCount === 1, '3.0 Worker endpoint was actually invoked for 401 test');
    assert(res401.success === false && Boolean(res401.error), '3.1 Worker HTTP 401 returns failure');
    assert(!res401.error!.includes('leaked stack trace'), '3.2 Sensitive raw server error is not leaked to UI');

    // -------------------------------------------------------------------------
    // TEST 4: Worker returns HTTP 404 -> failure
    // -------------------------------------------------------------------------
    endpointCalledCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (urlStr === '/api/auth/profile/update') endpointCalledCount++;
      return new Response(JSON.stringify({ success: false, error: 'Profile not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;
    const res404 = await configuredAuthService.updateProfile(memberId, { nickname: 'Nick', bio: 'Bio' });
    assert(endpointCalledCount === 1 && res404.success === false && Boolean(res404.error), '4.1 Worker HTTP 404 returns failure');

    // -------------------------------------------------------------------------
    // TEST 5: Worker returns HTTP 500 -> failure
    // -------------------------------------------------------------------------
    endpointCalledCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (urlStr === '/api/auth/profile/update') endpointCalledCount++;
      return new Response(JSON.stringify({ success: false, error: 'Internal DB error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;
    const res500 = await configuredAuthService.updateProfile(memberId, { nickname: 'Nick', bio: 'Bio' });
    assert(endpointCalledCount === 1 && res500.success === false && Boolean(res500.error), '5.1 Worker HTTP 500 returns failure');

    // -------------------------------------------------------------------------
    // TEST 6: Network exception -> failure
    // -------------------------------------------------------------------------
    endpointCalledCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (urlStr === '/api/auth/profile/update') endpointCalledCount++;
      throw new TypeError('Failed to fetch');
    }) as any;
    const resNetErr = await configuredAuthService.updateProfile(memberId, { nickname: 'Nick', bio: 'Bio' });
    assert(endpointCalledCount === 1 && resNetErr.success === false && Boolean(resNetErr.error), '6.1 Network exception returns failure');

    // -------------------------------------------------------------------------
    // TEST 7: Worker returns malformed JSON (or success !== true) -> failure
    // -------------------------------------------------------------------------
    endpointCalledCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (urlStr === '/api/auth/profile/update') endpointCalledCount++;
      return new Response('{broken-json-response', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;
    const resMalformed = await configuredAuthService.updateProfile(memberId, { nickname: 'Nick', bio: 'Bio' });
    assert(endpointCalledCount === 1 && resMalformed.success === false && Boolean(resMalformed.error), '7.1 Malformed JSON on HTTP 200 returns failure');

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;
    const resFalseSuccess = await configuredAuthService.updateProfile(memberId, { nickname: 'Nick', bio: 'Bio' });
    assert(resFalseSuccess.success === false, '7.2 HTTP 200 with success !== true returns failure');

    // -------------------------------------------------------------------------
    // TEST 8, 9, 10: End-to-End with Real Worker + Stateful Mock DB + Reload Read
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Worker End-to-End Save & Reload Read-Path Tests ---');
    const mockDbProfileRow: any = {
      id: memberId,
      nickname: 'InitialNick',
      avatar_url: '🛡️',
      bio: '',
      role: 'user',
      is_18_verified: false,
      verified_at: null,
      verification_method: 'pending',
      safe_filter_enabled: true,
      notification_sounds: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };

    const capturedWorkerPayloads: any[] = [];
    let dbPatchCalls = 0;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();

      // Client -> Worker API request
      if (urlStr === '/api/auth/profile/update') {
        const reqBody = init?.body ? JSON.parse(String(init.body)) : null;
        capturedWorkerPayloads.push(reqBody);
        const workerReq = new Request(`https://chatlustora.com${urlStr}`, {
          method: init?.method || 'POST',
          headers: init?.headers,
          body: init?.body,
        });
        return worker.fetch(workerReq, workerEnv, {});
      }

      // Worker -> Supabase Auth user verification
      if (urlStr.includes('/auth/v1/user')) {
        const authHeader =
          init?.headers instanceof Headers
            ? init.headers.get('Authorization')
            : (init?.headers as any)?.Authorization || (init?.headers as any)?.authorization;
        if (authHeader === `Bearer ${memberJwt}`) {
          return new Response(
            JSON.stringify({
              id: memberId,
              email: 'member@example.com',
              user_metadata: { nickname: 'InitialNick', gender: 'male' },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      }

      // Worker PATCH or Supabase Client SELECT on /rest/v1/profiles
      if (urlStr.includes('/rest/v1/profiles')) {
        const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (method === 'PATCH') {
          dbPatchCalls++;
          const patchBody = init?.body ? JSON.parse(String(init.body)) : {};
          Object.assign(mockDbProfileRow, patchBody);
          return new Response(JSON.stringify([mockDbProfileRow]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (method === 'GET') {
          const accept =
            input instanceof Request
              ? input.headers.get('Accept') || ''
              : init?.headers instanceof Headers
              ? init.headers.get('Accept') || ''
              : String((init?.headers as any)?.Accept || (init?.headers as any)?.accept || '');
          const isSingle = accept.includes('vnd.pgrst.object+json');
          return new Response(JSON.stringify(isSingle ? mockDbProfileRow : [mockDbProfileRow]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response(JSON.stringify({ error: 'Unexpected fetch call' }), { status: 500 });
    }) as any;

    const saveRes = await configuredAuthService.updateProfile(memberId, {
      nickname: 'Dhaka_Member',
      bio: 'Hello! I enjoy Bangla chat and music.',
      interests: ['Music & Bands'], // unsupported by worker DB whitelist
      is18Verified: true, // privileged field must be stripped
    });

    assert(saveRes.success === true, '8.1 Worker-confirmed profile update returns { success: true }');
    assert(dbPatchCalls === 1, '9.1 Bio and nickname submitted in ONE database PATCH request');
    assert(
      capturedWorkerPayloads.length === 1 &&
        capturedWorkerPayloads[0]?.updates?.nickname === 'Dhaka_Member' &&
        capturedWorkerPayloads[0]?.updates?.bio === 'Hello! I enjoy Bangla chat and music.',
      '9.2 Payload sends both nickname and bio together in one request'
    );
    assert(
      capturedWorkerPayloads[0]?.updates?.is18Verified === undefined &&
        capturedWorkerPayloads[0]?.updates?.interests === undefined,
      '9.3 Privileged and unsupported fields are stripped before sending to Worker'
    );
    assert(
      mockDbProfileRow.nickname === 'Dhaka_Member' &&
        mockDbProfileRow.bio === 'Hello! I enjoy Bangla chat and music.' &&
        mockDbProfileRow.is_18_verified === false,
      '9.4 Stateful mock DB reflects persisted nickname + bio and intact verification flag'
    );

    // Reload read path via restoreSession() -> getProfile()
    const reloadedProfile = await configuredAuthService.restoreSession();
    assert(
      reloadedProfile !== null &&
        reloadedProfile.nickname === 'Dhaka_Member' &&
        reloadedProfile.bio === 'Hello! I enjoy Bangla chat and music.',
      '10.1 Reloading session retrieves persisted Bio and nickname from public.profiles read path'
    );

    // -------------------------------------------------------------------------
    // TEST 11: Guest token rejected by /api/auth/profile/update (HTTP 403)
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Guest Access Isolation & Structural Verification ---');
    const guestInitReq = new Request('https://chatlustora.com/api/guest/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: 'GuestTester', avatar: '⚡', languagePref: 'en', ageDeclarationAccepted: true }),
    });
    const prevFetch = globalThis.fetch;
    const savedGuestRows: any[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (u.includes('/rest/v1/guest_sessions')) {
        const method = (init?.method || 'GET').toUpperCase();
        if (method === 'POST') {
          const row = init?.body ? JSON.parse(String(init.body)) : {};
          savedGuestRows.push(row);
          return new Response(JSON.stringify([row]), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify(savedGuestRows), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return prevFetch(input, init);
    }) as any;
    const guestInitRes = await worker.fetch(guestInitReq, workerEnv, {});
    const guestInitData: any = await guestInitRes.json();
    const guestToken = guestInitData?.session?.token;
    assert(Boolean(guestToken && guestToken.startsWith('vx_gst_')), '11.1 Guest session initialization still works');

    const guestUpdateReq = new Request('https://chatlustora.com/api/auth/profile/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${guestToken}`,
      },
      body: JSON.stringify({ updates: { bio: 'Guest bio attempt' } }),
    });
    const guestUpdateRes = await worker.fetch(guestUpdateReq, workerEnv, {});
    assert(
      guestUpdateRes.status === 403,
      '11.2 Guest token is strictly rejected with HTTP 403 on /api/auth/profile/update'
    );

    // -------------------------------------------------------------------------
    // TEST 12: Source-level invariants across AuthContext & UI Pages
    // -------------------------------------------------------------------------
    const authServiceSrc = fs.readFileSync(path.resolve('src/services/authService.ts'), 'utf-8');
    const authContextSrc = fs.readFileSync(path.resolve('src/context/AuthContext.tsx'), 'utf-8');
    const dashboardSrc = fs.readFileSync(path.resolve('src/pages/MemberDashboardPage.tsx'), 'utf-8');
    const settingsSrc = fs.readFileSync(path.resolve('src/pages/ProfileSettingsPage.tsx'), 'utf-8');

    assert(
      !authContextSrc.includes('!user.isGuest && isSupabaseActive'),
      '12.1 AuthContext never bypasses persistence for registered members when isSupabaseActive is false'
    );
    assert(
      authContextSrc.includes('if (!user.isGuest)') &&
        authContextSrc.includes('if (!res.success)') &&
        authServiceSrc.includes('success: false'),
      '12.2 AuthContext & authService enforce fail-closed persistence for registered members'
    );
    assert(
      dashboardSrc.includes('nickname: nicknameInput.trim()') &&
        dashboardSrc.includes('bio: bioInput.trim()') &&
        !dashboardSrc.includes('setNickname(nicknameInput'),
      '12.3 MemberDashboardPage submits nickname and bio together in one request'
    );
    assert(
      settingsSrc.includes('nickname: nicknameInput.trim()') &&
        settingsSrc.includes('bio: bioInput.trim()') &&
        !settingsSrc.includes('setNickname(nicknameInput'),
      '12.4 ProfileSettingsPage submits nickname and bio together in one request'
    );
    assert(
      dashboardSrc.includes('hasUnsavedIdentityChanges') &&
        settingsSrc.includes('hasUnsavedChanges') &&
        dashboardSrc.includes('if (saving) return') &&
        settingsSrc.includes('if (saving) return'),
      '12.5 Both pages implement unsaved-input dirty-tracking and duplicate-submission guards'
    );
    assert(
      dashboardSrc.indexOf('const [saving, setSaving]') < dashboardSrc.indexOf('if (!hasActiveSession)'),
      '12.6 MemberDashboardPage declares all React hooks before conditional returns'
    );

    console.log('\n====================================================================');
    console.log(`  ALL MEMBER BIO PERSISTENCE TESTS PASSED (${totalAssertions} assertions)`);
    console.log('====================================================================\n');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalStorage !== undefined) {
      (globalThis as any).localStorage = originalLocalStorage;
    } else {
      delete (globalThis as any).localStorage;
    }
    if (originalWindow !== undefined) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
    if (fs.existsSync(tmpEntryPath)) {
      fs.unlinkSync(tmpEntryPath);
    }
    if (fs.existsSync(tmpBundlePath)) {
      fs.unlinkSync(tmpBundlePath);
    }
  }
}

runMemberBioPersistenceTests().catch((err) => {
  console.error('Member Bio persistence test suite failed:', err);
  process.exit(1);
});
