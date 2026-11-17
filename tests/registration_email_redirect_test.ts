/**
 * ChatLustora — Registration Email Confirmation Redirect Test Suite (P0-B)
 *
 * Behaviorally verifies using a bundled real Supabase client + fetch interceptor (mocked server, NOT live Staging DB):
 * 1. authService.register() sends redirect_to=${window.location.origin}/dashboard via supabase.auth.signUp().
 * 2. Registration metadata (nickname, avatar_url, gender) is sent in the signUp payload.
 * 3. Email confirmation required response returns { success: true, requiresEmailConfirmation: true, profileConfirmed: false }.
 * 4. Provider errors are sanitized and fail closed without leaking raw backend messages.
 * 5. Offline simulation mode (unconfigured Supabase) preserves existing non-DB-confirmed fallback contract.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as esbuild from 'esbuild';
import { authService as unconfiguredAuthService } from '../src/services/authService';

let assertionCount = 0;
function assert(condition: boolean, testName: string, detail?: string) {
  assertionCount++;
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
    throw new Error(`Assertion failed: ${testName}${detail ? ` (${detail})` : ''}`);
  } else {
    console.log(`✅ [PASSED] ${testName}`);
  }
}

async function runRegistrationRedirectTests() {
  console.log('\n================================================================');
  console.log('  CHATLUSTORA: P0-B REGISTRATION EMAIL CONFIRMATION REDIRECT TESTS');
  console.log('================================================================\n');

  const originalFetch = globalThis.fetch;
  const originalLocalStorage = (globalThis as any).localStorage;
  const originalWindow = (globalThis as any).window;
  const tmpEntryPath = path.join(os.tmpdir(), `voxanex_reg_redirect_entry_${Date.now()}.ts`);
  const tmpBundlePath = path.join(os.tmpdir(), `voxanex_reg_redirect_test_${Date.now()}.mjs`);

  const supabaseUrl = 'https://test-staging-mock.supabase.co';
  const supabaseAnonKey = 'test_anon_key_for_unit_tests_only';

  try {
    // 1. Source-level invariant check
    const authServiceSource = fs.readFileSync(path.resolve('src/services/authService.ts'), 'utf-8');
    assert(
      authServiceSource.includes('emailRedirectTo') && authServiceSource.includes('${window.location.origin}/dashboard'),
      '1.1 Source preserves emailRedirectTo: `${window.location.origin}/dashboard`'
    );

    // 2. Unconfigured / simulation fallback check
    const simResult = await unconfiguredAuthService.register(
      'test_p0b@example.com',
      'SecurePass123!',
      'SimUser',
      'male',
      'en'
    );
    assert(
      simResult.success === true && simResult.profileConfirmed === false && simResult.user?.nickname === 'SimUser',
      '1.2 Unconfigured Supabase client preserves offline simulation contract with profileConfirmed=false'
    );

    // 3. Bundle real authService + supabaseClient with test Supabase env
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

    const currentWindow: any = {
      localStorage: mockStorage,
      location: {
        origin: 'https://chatlustora.com',
        href: 'https://chatlustora.com/user/register',
        pathname: '/user/register',
        search: '',
        hash: '',
      },
      history: {
        state: null,
        replaceState: () => {},
      },
    };
    (globalThis as any).localStorage = mockStorage;
    (globalThis as any).window = currentWindow;

    fs.writeFileSync(
      tmpEntryPath,
      `export { authService } from ${JSON.stringify(path.resolve('src/services/authService.ts'))};\nexport { getSupabaseClient } from ${JSON.stringify(path.resolve('src/lib/supabaseClient.ts'))};\n`
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

    // 4. Behavioral verification on production origin (confirmation required -> session: null)
    let capturedUrl = '';
    let capturedBody: any = null;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      if (urlStr.includes('/auth/v1/signup')) {
        capturedUrl = urlStr;
        capturedBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(
          JSON.stringify({
            id: 'usr_signup_123',
            aud: 'authenticated',
            role: 'authenticated',
            email: 'newmember@example.com',
            confirmation_sent_at: '2026-11-17T00:00:00.000Z',
            user_metadata: capturedBody?.data || {},
            created_at: '2026-11-17T00:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const regRes = await configuredAuthService.register(
      'newmember@example.com',
      'StrongPass!123',
      '  Dhaka_Newcomer  ',
      'female',
      'en'
    );

    const parsedSignUpUrl = new URL(capturedUrl);
    assert(
      parsedSignUpUrl.searchParams.get('redirect_to') === 'https://chatlustora.com/dashboard',
      '2.1 signUp sends redirect_to=https://chatlustora.com/dashboard',
      `Got ${parsedSignUpUrl.searchParams.get('redirect_to')}`
    );
    assert(
      capturedBody?.email === 'newmember@example.com' &&
        capturedBody?.data?.nickname === 'Dhaka_Newcomer' &&
        capturedBody?.data?.avatar_url === '🛡️' &&
        capturedBody?.data?.gender === 'female',
      '2.2 signUp sends sanitized nickname, avatar_url, and gender metadata'
    );
    assert(
      regRes.success === true &&
        regRes.requiresEmailConfirmation === true &&
        regRes.profileConfirmed === false &&
        typeof regRes.message === 'string' &&
        regRes.message.toLowerCase().includes('confirm'),
      '2.3 Email confirmation required returns requiresEmailConfirmation=true and profileConfirmed=false'
    );

    // 5. Dynamic origin check (e.g. Staging origin)
    currentWindow.location.origin = 'https://staging.chatlustora.workers.dev';
    capturedUrl = '';
    await configuredAuthService.register('staging@example.com', 'StrongPass!123', 'StagingUser', 'male', 'en');
    const stagingSignUpUrl = new URL(capturedUrl);
    assert(
      stagingSignUpUrl.searchParams.get('redirect_to') === 'https://staging.chatlustora.workers.dev/dashboard',
      '2.4 emailRedirectTo dynamically adapts to active Staging/deployment origin'
    );

    // 6. Provider error sanitization check
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          code: 'user_already_exists',
          msg: 'User already registered',
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    const errRes = await configuredAuthService.register('existing@example.com', 'StrongPass!123', 'Existing', 'male', 'en');
    assert(
      errRes.success === false &&
        typeof errRes.error === 'string' &&
        errRes.error.includes('already exists'),
      '2.5 Provider duplicate-account error returns sanitized user-friendly failure'
    );

    console.log(`\n================================================================================`);
    console.log(`   ALL P0-B REGISTRATION REDIRECT TESTS PASSED (Total Assertions: ${assertionCount})`);
    console.log(`================================================================================\n`);
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

runRegistrationRedirectTests().catch((err) => {
  console.error('Registration redirect test failed:', err);
  process.exit(1);
});
