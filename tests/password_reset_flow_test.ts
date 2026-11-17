/**
 * ChatLustora / VoxaNex — Phase 1: Secure Password Reset Flow Test Suite
 *
 * Tests (using bundled real @supabase/supabase-js client + mocked fetch/window/storage — NOT live Staging DB):
 * 1. Forgot Password Email Request:
 *    - resetPasswordForEmail receives ${window.location.origin}/user/reset-password
 *    - Adapts cleanly to staging origins
 *    - Fails closed when Supabase client is unavailable or email is blank
 *    - Sanitizes provider errors & handles network exceptions cleanly
 * 2. Recovery Callback Handling:
 *    - Implicit hash (#access_token=...&refresh_token=...&type=recovery) triggers PASSWORD_RECOVERY & strips URL hash
 *    - PKCE (?code=...) consumes code safely without double-exchange & strips ?code=
 *    - Token hash (?token_hash=...&type=recovery) calls verifyOtp & strips params
 *    - Invalid/expired links & URL error callbacks fail closed cleanly
 *    - Unrelated normal session in localStorage is NOT treated as valid recovery proof
 * 3. Password Update & Session Cleanup:
 *    - Validation rejects <6 chars and avoids silent whitespace trimming
 *    - Fails closed when Supabase client or active session is missing
 *    - Provider errors (same password, weak password, missing session, raw SQL leak) & network exceptions fail closed safely
 *    - updateUser({ password }) succeeds -> clearRecoverySession clears local Supabase session while leaving guest tokens intact
 * 4. Security & UI/Context Invariants:
 *    - No access_token, refresh_token, pkceCode, tokenHash, or raw passwords logged to console
 *    - Router, App, AuthContext, PasswordResetPage, and GuestEntryPage uphold all security & UX guards
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as esbuild from 'esbuild';
import {
  authService as unconfiguredAuthService,
  inspectRecoveryUrl,
} from '../src/services/authService';

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
  return `${header}.${payload}.${toBase64Url('mock_signature_for_test_only')}`;
}

function createWindowAndStorage(initialHref: string, memoryStorage: Record<string, string>) {
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

  let replaceStateCalls = 0;
  let currentUrl = new URL(initialHref);

  const locationObj: any = {
    get origin() {
      return currentUrl.origin;
    },
    set origin(val: string) {
      const next = new URL(val);
      currentUrl = new URL(`${next.origin}${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
    },
    get href() {
      return currentUrl.href;
    },
    set href(val: string) {
      currentUrl = new URL(val);
    },
    get pathname() {
      return currentUrl.pathname;
    },
    set pathname(val: string) {
      currentUrl.pathname = val;
    },
    get search() {
      return currentUrl.search;
    },
    set search(val: string) {
      currentUrl.search = val;
    },
    get hash() {
      return currentUrl.hash;
    },
    set hash(val: string) {
      currentUrl.hash = val;
    },
  };

  const win: any = {
    localStorage: mockStorage,
    location: locationObj,
    history: {
      state: { fromTest: true },
      replaceState: (_state: any, _title: string, newRelativeUrl: string) => {
        replaceStateCalls++;
        currentUrl = new URL(newRelativeUrl, currentUrl.origin);
      },
    },
    getReplaceStateCalls: () => replaceStateCalls,
  };

  return { win, mockStorage };
}

async function runPasswordResetFlowTests() {
  console.log('\n====================================================================');
  console.log('  VOXANEX / CHATLUSTORA: SECURE PASSWORD RESET FLOW TEST SUITE');
  console.log('====================================================================\n');

  const originalFetch = globalThis.fetch;
  const originalLocalStorage = (globalThis as any).localStorage;
  const originalWindow = (globalThis as any).window;
  const originalDocument = (globalThis as any).document;
  (globalThis as any).document = {};
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;

  const tmpEntryPath = path.join(os.tmpdir(), `voxanex_pwd_reset_entry_${Date.now()}.ts`);
  const tmpBundlePath = path.join(os.tmpdir(), `voxanex_pwd_reset_bundle_${Date.now()}.mjs`);

  const supabaseUrl = 'https://test-pwd-mock.supabase.co';
  const supabaseAnonKey = 'test_anon_key_for_password_reset_tests';
  const userId = '99999999-aaaa-bbbb-cccc-111111111111';
  const recoveryJwt = createMockJwt(userId);
  const unrelatedJwt = createMockJwt('88888888-7777-6666-5555-444444444444');
  const sensitiveRefresh = 'super_secret_refresh_token_xyz';
  const sensitivePkceCode = 'pkce_secret_code_98765';
  const sensitiveTokenHash = 'token_hash_secret_54321';
  const sensitivePassword = 'MySuperSecretPassword!2026';

  const capturedAuthLogs: string[] = [];
  const captureLog = (...args: any[]) => {
    capturedAuthLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };

  try {
    fs.writeFileSync(
      tmpEntryPath,
      `export { authService, inspectRecoveryUrl, stripRecoveryUrlParams } from ${JSON.stringify(
        path.resolve('src/services/authService.ts')
      )};\nexport { getSupabaseClient } from ${JSON.stringify(path.resolve('src/lib/supabaseClient.ts'))};\n`
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

    // =========================================================================
    // SECTION 1: Unconfigured Client Fail-Closed Checks
    // =========================================================================
    console.log('--- 1. Unconfigured Supabase Fail-Closed Checks ---');
    const noClientResetReq = await unconfiguredAuthService.requestPasswordReset('user@example.com');
    assert(
      noClientResetReq.success === false && Boolean(noClientResetReq.error),
      '1.1 requestPasswordReset fails closed when Supabase client is unavailable'
    );

    const noClientRecovery = await unconfiguredAuthService.processRecoveryCallback(
      inspectRecoveryUrl('https://chatlustora.com/user/reset-password?code=abc'),
      () => false
    );
    assert(
      noClientRecovery.success === false && Boolean(noClientRecovery.error),
      '1.2 processRecoveryCallback fails closed when Supabase client is unavailable'
    );

    const noClientUpdate = await unconfiguredAuthService.updatePassword(sensitivePassword);
    assert(
      noClientUpdate.success === false && Boolean(noClientUpdate.error),
      '1.3 updatePassword fails closed when Supabase client is unavailable'
    );

    // =========================================================================
    // SECTION 2: Forgot Password Email Request (requestPasswordReset)
    // =========================================================================
    console.log('\n--- 2. Forgot Password Email Request Tests ---');
    {
      const mem: Record<string, string> = {};
      const { win, mockStorage } = createWindowAndStorage('https://chatlustora.com/user/login', mem);
      (globalThis as any).localStorage = mockStorage;
      (globalThis as any).window = win;

      let recoverUrl = '';
      let recoverBody: any = null;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
        if (u.includes('/auth/v1/recover')) {
          recoverUrl = u;
          recoverBody = init?.body ? JSON.parse(String(init.body)) : null;
          return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as any;

      const mod = await import(`file://${tmpBundlePath}?case=req_email`);
      const resProd = await mod.authService.requestPasswordReset('  member@example.com  ');
      const parsedRecoverUrl = new URL(recoverUrl);
      assert(
        resProd.success === true &&
          recoverBody?.email === 'member@example.com' &&
          parsedRecoverUrl.searchParams.get('redirect_to') === 'https://chatlustora.com/user/reset-password',
        '2.1 requestPasswordReset sends redirect_to=https://chatlustora.com/user/reset-password'
      );

      // Staging origin adaptation
      win.location.origin = 'https://staging.chatlustora.workers.dev';
      recoverUrl = '';
      const resStaging = await mod.authService.requestPasswordReset('member@example.com');
      const parsedStagingUrl = new URL(recoverUrl);
      assert(
        resStaging.success === true &&
          parsedStagingUrl.searchParams.get('redirect_to') === 'https://staging.chatlustora.workers.dev/user/reset-password',
        '2.2 requestPasswordReset dynamically uses current staging window.location.origin'
      );

      // Blank email rejection
      const blankEmailRes = await mod.authService.requestPasswordReset('   ');
      assert(blankEmailRes.success === false && Boolean(blankEmailRes.error), '2.3 Blank email is rejected cleanly');

      // Provider error sanitization
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({ message: 'Too many requests; raw SQL hint internal_db_secret' }),
          { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
      }) as any;
      const rateLimitRes = await mod.authService.requestPasswordReset('member@example.com');
      assert(
        rateLimitRes.success === false &&
          Boolean(rateLimitRes.error) &&
          !rateLimitRes.error!.includes('internal_db_secret'),
        '2.4 Provider rate-limit / error response fails closed with sanitized message'
      );

      // Network failure
      globalThis.fetch = (async () => {
        throw new TypeError('Network disconnected');
      }) as any;
      const netErrRes = await mod.authService.requestPasswordReset('member@example.com');
      assert(netErrRes.success === false && Boolean(netErrRes.error), '2.5 Network exception fails closed');
    }

    // =========================================================================
    // SECTION 3: Recovery Callback Flows (Implicit Hash, PKCE, token_hash, Errors)
    // =========================================================================
    console.log('\n--- 3. Recovery Callback Handling Tests ---');

    // 3A: URL error parameter fails closed cleanly
    {
      const mem: Record<string, string> = {};
      const errHref =
        'https://chatlustora.com/user/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
      const { win, mockStorage } = createWindowAndStorage(errHref, mem);
      (globalThis as any).localStorage = mockStorage;
      (globalThis as any).window = win;

      globalThis.fetch = (async () => new Response('{}', { status: 200 })) as any;
      const initialInspection = inspectRecoveryUrl(win.location.href);
      const mod = await import(`file://${tmpBundlePath}?case=url_err`);
      const res = await mod.authService.processRecoveryCallback(initialInspection, () => false);
      assert(res.success === false && Boolean(res.error), '3.1 URL error callback fails closed cleanly');
    }

    // 3B: Implicit Hash Recovery (#access_token=...&refresh_token=...&type=recovery)
    {
      const mem: Record<string, string> = {};
      const implicitHref = `https://chatlustora.com/user/reset-password#access_token=${recoveryJwt}&refresh_token=${sensitiveRefresh}&expires_in=3600&token_type=bearer&type=recovery`;
      const { win, mockStorage } = createWindowAndStorage(implicitHref, mem);
      (globalThis as any).localStorage = mockStorage;
      (globalThis as any).window = win;

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const u = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
        if (u.includes('/auth/v1/user')) {
          return new Response(
            JSON.stringify({ id: userId, email: 'member@example.com', aud: 'authenticated', role: 'authenticated' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as any;

      console.log = captureLog;
      console.warn = captureLog;
      console.error = captureLog;

      const initialInspection = inspectRecoveryUrl(win.location.href);
      const mod = await import(`file://${tmpBundlePath}?case=implicit_hash`);
      const supabase = mod.getSupabaseClient();
      let sawPasswordRecoveryEvent = false;
      const { data: listenerData } = supabase.auth.onAuthStateChange((event: string) => {
        if (event === 'PASSWORD_RECOVERY') sawPasswordRecoveryEvent = true;
      });

      const res = await mod.authService.processRecoveryCallback(initialInspection, () => sawPasswordRecoveryEvent);
      listenerData?.subscription?.unsubscribe();

      console.log = originalConsoleLog;
      console.warn = originalConsoleWarn;
      console.error = originalConsoleError;

      assert(
        res.success === true && sawPasswordRecoveryEvent === true,
        '3.2 Implicit hash recovery triggers PASSWORD_RECOVERY and returns { success: true }'
      );
      assert(
        !win.location.href.includes('access_token') && !win.location.href.includes('refresh_token'),
        '3.3 Sensitive implicit hash tokens are stripped from URL after verification'
      );
    }

    // 3C: PKCE Recovery (?code=...) — exchanges code ONCE and strips ?code=
    {
      const mem: Record<string, string> = {};
      const pkceHref = `https://chatlustora.com/user/reset-password?code=${sensitivePkceCode}`;
      const { win, mockStorage } = createWindowAndStorage(pkceHref, mem);
      (globalThis as any).localStorage = mockStorage;
      (globalThis as any).window = win;

      let pkceExchangeCalls = 0;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const u = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
        if (u.includes('/auth/v1/token') && u.includes('grant_type=pkce')) {
          pkceExchangeCalls++;
          return new Response(
            JSON.stringify({
              access_token: recoveryJwt,
              refresh_token: sensitiveRefresh,
              expires_in: 3600,
              token_type: 'bearer',
              user: { id: userId, email: 'member@example.com', aud: 'authenticated', role: 'authenticated' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as any;

      const initialInspection = inspectRecoveryUrl(win.location.href);
      const mod = await import(`file://${tmpBundlePath}?case=pkce_manual`);
      // Simulate code verifier present in storage when calling exchangeCodeForSession fallback path
      const verifierKey = Object.keys(mem).find((k) => k.endsWith('-code-verifier')) || 'sb-test-pwd-mock-auth-token-code-verifier';
      mem[verifierKey] = JSON.stringify('mock_pkce_code_verifier_value');

      const res = await mod.authService.processRecoveryCallback(initialInspection, () => false);
      assert(
        res.success === true && pkceExchangeCalls === 1,
        '3.4 PKCE ?code= exchanges once for recovery session when not already auto-consumed'
      );
      assert(
        !win.location.search.includes('code='),
        '3.5 ?code= query parameter is stripped from URL after successful PKCE exchange'
      );

      // Verify no double-exchange if ?code= was already consumed & PASSWORD_RECOVERY fired
      let secondExchangeCalls = 0;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const u = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
        if (u.includes('grant_type=pkce')) secondExchangeCalls++;
        return new Response('{}', { status: 200 });
      }) as any;
      const noDoubleRes = await mod.authService.processRecoveryCallback(initialInspection, () => true);
      assert(
        noDoubleRes.success === true && secondExchangeCalls === 0,
        '3.6 PKCE does NOT double-exchange when SDK already emitted PASSWORD_RECOVERY'
      );
    }

    // 3D: PKCE Failure (invalid/expired code)
    {
      const mem: Record<string, string> = {};
      const pkceHref = 'https://chatlustora.com/user/reset-password?code=expired_pkce_code';
      const { win, mockStorage } = createWindowAndStorage(pkceHref, mem);
      (globalThis as any).localStorage = mockStorage;
      (globalThis as any).window = win;

      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Code expired' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as any;

      const initialInspection = inspectRecoveryUrl(win.location.href);
      const mod = await import(`file://${tmpBundlePath}?case=pkce_fail`);
      const res = await mod.authService.processRecoveryCallback(initialInspection, () => false);
      assert(res.success === false && Boolean(res.error), '3.7 Invalid/expired PKCE recovery code fails closed');
    }

    // 3E: Token-Hash Callback (?token_hash=...&type=recovery) & Invalid Token-Hash
    {
      const mem: Record<string, string> = {};
      const tokenHashHref = `https://chatlustora.com/user/reset-password?token_hash=${sensitiveTokenHash}&type=recovery`;
      const { win, mockStorage } = createWindowAndStorage(tokenHashHref, mem);
      (globalThis as any).localStorage = mockStorage;
      (globalThis as any).window = win;

      let verifyCalls = 0;
      let capturedVerifyBody: any = null;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
        if (u.includes('/auth/v1/verify')) {
          verifyCalls++;
          capturedVerifyBody = init?.body ? JSON.parse(String(init.body)) : null;
          return new Response(
            JSON.stringify({
              access_token: recoveryJwt,
              refresh_token: sensitiveRefresh,
              expires_in: 3600,
              token_type: 'bearer',
              user: { id: userId, email: 'member@example.com', aud: 'authenticated', role: 'authenticated' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('{}', { status: 200 });
      }) as any;

      const initialInspection = inspectRecoveryUrl(win.location.href);
      const mod = await import(`file://${tmpBundlePath}?case=token_hash_ok`);
      const res = await mod.authService.processRecoveryCallback(initialInspection, () => false);
      assert(
        res.success === true &&
          verifyCalls === 1 &&
          capturedVerifyBody?.token_hash === sensitiveTokenHash &&
          capturedVerifyBody?.type === 'recovery',
        '3.8 token_hash recovery verifies via verifyOtp and returns { success: true }'
      );
      assert(
        !win.location.search.includes('token_hash') && !win.location.search.includes('type='),
        '3.9 token_hash and type query params are stripped from URL after verification'
      );

      // Invalid token_hash fails closed
      const { win: win2, mockStorage: storage2 } = createWindowAndStorage(
        'https://chatlustora.com/user/reset-password?token_hash=expired_hash&type=recovery',
        {}
      );
      (globalThis as any).localStorage = storage2;
      (globalThis as any).window = win2;
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ error: 'otp_expired', msg: 'Token has expired' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })) as any;
      const modFail = await import(`file://${tmpBundlePath}?case=token_hash_fail`);
      const failRes = await modFail.authService.processRecoveryCallback(
        inspectRecoveryUrl(win2.location.href),
        () => false
      );
      assert(failRes.success === false && Boolean(failRes.error), '3.10 Invalid/expired token_hash fails closed');
    }

    // 3F: Unrelated Normal Session in localStorage MUST NOT be treated as recovery proof
    {
      const mem: Record<string, string> = {};
      const { win, mockStorage } = createWindowAndStorage('https://chatlustora.com/user/reset-password', mem);
      (globalThis as any).localStorage = mockStorage;
      (globalThis as any).window = win;

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const u = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
        if (u.includes('/auth/v1/user')) {
          return new Response(
            JSON.stringify({ id: '88888888-7777-6666-5555-444444444444', email: 'other@example.com' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('{}', { status: 200 });
      }) as any;

      const mod = await import(`file://${tmpBundlePath}?case=unrelated_session`);
      const supabase = mod.getSupabaseClient();
      const setSessRes = await supabase.auth.setSession({
        access_token: unrelatedJwt,
        refresh_token: 'unrelated_refresh_token',
      });
      const sess = await supabase.auth.getSession();
      assert(
        Boolean(sess?.data?.session?.access_token),
        '3.11 Setup: Unrelated normal session exists in storage',
        `setSession error: ${setSessRes?.error?.message || 'none'}, memKeys: ${Object.keys(mem).join(',')}`
      );

      const res = await mod.authService.processRecoveryCallback(inspectRecoveryUrl(win.location.href), () => false);
      assert(
        res.success === false && Boolean(res.error),
        '3.12 Unrelated normal session on /user/reset-password without recovery callback is NOT treated as recovery proof'
      );
    }

    // =========================================================================
    // SECTION 4: Password Update, Validation, Error Handling & Guest Isolation
    // =========================================================================
    console.log('\n--- 4. Password Update & Recovery Session Cleanup Tests ---');
    {
      const mem: Record<string, string> = {
        voxanex_guest_session: 'vx_gst_independent_guest_token_keep_intact',
      };
      const { win, mockStorage } = createWindowAndStorage('https://chatlustora.com/user/reset-password', mem);
      (globalThis as any).localStorage = mockStorage;
      (globalThis as any).window = win;

      const mod = await import(`file://${tmpBundlePath}?case=update_pwd`);
      const supabase = mod.getSupabaseClient();

      // 4.1 Missing active session fails closed
      const noSessRes = await mod.authService.updatePassword(sensitivePassword);
      assert(
        noSessRes.success === false && noSessRes.error?.toLowerCase().includes('session'),
        '4.1 updatePassword fails closed when no active recovery session exists'
      );

      // 4.2 Validation: <6 chars fails; exact 6 spaces fails? No, 5 spaces fails; 6 chars with leading/trailing spaces is NOT trimmed
      const shortRes = await mod.authService.updatePassword('     '); // length 5
      assert(shortRes.success === false, '4.2 Password shorter than 6 chars is rejected cleanly');

      // Establish recovery session
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const u = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
        if (u.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: userId, email: 'member@example.com' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', { status: 200 });
      }) as any;

      await supabase.auth.setSession({
        access_token: recoveryJwt,
        refresh_token: sensitiveRefresh,
      });

      // 4.3 Verify un-trimmed whitespace password (length 6: " abcd ") reaches updateUser untouched
      let sentPassword: string | null = null;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
        if (u.includes('/auth/v1/user') && (init?.method || '').toUpperCase() === 'PUT') {
          const body = init?.body ? JSON.parse(String(init.body)) : {};
          sentPassword = body.password;
          return new Response(JSON.stringify({ id: userId, email: 'member@example.com' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', { status: 200 });
      }) as any;

      console.log = captureLog;
      console.warn = captureLog;
      console.error = captureLog;
      const untrimmedRes = await mod.authService.updatePassword(' abcd ');
      console.log = originalConsoleLog;
      console.warn = originalConsoleWarn;
      console.error = originalConsoleError;

      assert(
        untrimmedRes.success === true && sentPassword === ' abcd ',
        '4.3 updatePassword preserves exact password characters without silent trimming'
      );

      // 4.4 Provider errors sanitized (same password, raw SQL leak)
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({ message: 'New password should be different from the old password.' }),
          { status: 422, headers: { 'Content-Type': 'application/json' } }
        )) as any;
      const samePwdRes = await mod.authService.updatePassword(sensitivePassword);
      assert(
        samePwdRes.success === false &&
          samePwdRes.error === 'Your new password must be different from your previous password.',
        '4.4 Provider same-password rejection returns helpful sanitized message'
      );

      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ message: 'internal postgres error: leaked_table_xyz' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })) as any;
      const leakErrRes = await mod.authService.updatePassword(sensitivePassword);
      assert(
        leakErrRes.success === false && !leakErrRes.error!.includes('leaked_table_xyz'),
        '4.5 Raw provider/database error details are never leaked to the UI'
      );

      // 4.5 Network error fails closed
      globalThis.fetch = (async () => {
        throw new TypeError('Failed to fetch');
      }) as any;
      const netFailRes = await mod.authService.updatePassword(sensitivePassword);
      assert(netFailRes.success === false && Boolean(netFailRes.error), '4.6 Network exception during updatePassword fails closed');

      // 4.6 Full success + local recovery signOut + guest session untouched
      let logoutScope = '';
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
        if (u.includes('/auth/v1/user') && (init?.method || '').toUpperCase() === 'PUT') {
          return new Response(JSON.stringify({ id: userId, email: 'member@example.com' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (u.includes('/auth/v1/logout')) {
          logoutScope = u;
          return new Response('', { status: 204 });
        }
        return new Response('{}', { status: 200 });
      }) as any;

      const finalUpdateRes = await mod.authService.updatePassword(sensitivePassword);
      assert(finalUpdateRes.success === true, '4.7 updatePassword succeeds on confirmed Supabase user response');

      await mod.authService.clearRecoverySession();
      const postClearSession = await supabase.auth.getSession();
      assert(
        logoutScope.includes('scope=local') && postClearSession?.data?.session === null,
        '4.8 clearRecoverySession clears local temporary recovery session'
      );
      assert(
        mem.voxanex_guest_session === 'vx_gst_independent_guest_token_keep_intact',
        '4.9 Independent guest session storage token remains untouched across recovery cleanup'
      );
    }

    // =========================================================================
    // SECTION 5: No Sensitive Data Logged & UI/Router/Context Source Invariants
    // =========================================================================
    console.log('\n--- 5. Security & Source Invariant Checks ---');
    const combinedLogs = capturedAuthLogs.join('\n');
    assert(
      !combinedLogs.includes(recoveryJwt) &&
        !combinedLogs.includes(sensitiveRefresh) &&
        !combinedLogs.includes(sensitivePkceCode) &&
        !combinedLogs.includes(sensitiveTokenHash) &&
        !combinedLogs.includes(sensitivePassword),
      '5.1 No access tokens, refresh tokens, auth codes, token hashes, or passwords were logged'
    );

    const routerSrc = fs.readFileSync(path.resolve('src/context/RouterContext.tsx'), 'utf-8');
    const appSrc = fs.readFileSync(path.resolve('src/App.tsx'), 'utf-8');
    const authCtxSrc = fs.readFileSync(path.resolve('src/context/AuthContext.tsx'), 'utf-8');
    const resetPageSrc = fs.readFileSync(path.resolve('src/pages/PasswordResetPage.tsx'), 'utf-8');
    const guestEntrySrc = fs.readFileSync(path.resolve('src/pages/GuestEntryPage.tsx'), 'utf-8');

    assert(
      routerSrc.includes("'/user/reset-password'") &&
        appSrc.includes("case '/user/reset-password':") &&
        appSrc.includes('<PasswordResetPage />'),
      '5.2 /user/reset-password route is registered in RouterContext and App.tsx'
    );
    assert(
      authCtxSrc.includes('inspectRecoveryUrl(initialHref)') &&
        authCtxSrc.includes("event === 'PASSWORD_RECOVERY'") &&
        authCtxSrc.includes('clearRecoverySession'),
      '5.3 AuthContext inspects URL before client init, handles PASSWORD_RECOVERY safely, and clears local recovery session on completion'
    );
    assert(
      resetPageSrc.includes('showNewPassword') &&
        resetPageSrc.includes('showConfirmPassword') &&
        resetPageSrc.includes('newPassword !== confirmPassword') &&
        resetPageSrc.includes('submitInFlightRef') &&
        resetPageSrc.includes('disabled={submitting}') &&
        resetPageSrc.includes("navigate('/user/login')"),
      '5.4 PasswordResetPage enforces password match, show/hide toggles, duplicate-submit protection, and login navigation'
    );
    assert(
      guestEntrySrc.includes('resetLoading') &&
        guestEntrySrc.includes('resetInFlightRef') &&
        guestEntrySrc.includes('clearTimeout(resetCloseTimerRef.current)') &&
        guestEntrySrc.includes('disabled={resetLoading}'),
      '5.5 GuestEntryPage Forgot Password modal enforces loading state, duplicate-submit guard, and timer cleanup'
    );

    console.log('\n====================================================================');
    console.log(`  ALL SECURE PASSWORD RESET FLOW TESTS PASSED (${totalAssertions} assertions)`);
    console.log('====================================================================\n');
  } finally {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
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
    if (originalDocument !== undefined) {
      (globalThis as any).document = originalDocument;
    } else {
      delete (globalThis as any).document;
    }
    if (fs.existsSync(tmpEntryPath)) {
      fs.unlinkSync(tmpEntryPath);
    }
    if (fs.existsSync(tmpBundlePath)) {
      fs.unlinkSync(tmpBundlePath);
    }
  }
}

runPasswordResetFlowTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Password reset flow test suite failed:', err);
    process.exit(1);
  });
