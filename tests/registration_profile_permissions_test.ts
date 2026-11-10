import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  fetchProfileResultWithClient,
  loginWithSupabaseClient,
  registerWithSupabaseClient,
  restoreSessionWithSupabaseClient,
} from '../src/services/authService';
import { restoreAuthContextState } from '../src/context/AuthContext';
import { buildAllowedProfileUpdatePayload } from '../src/worker';

const profileRow = {
  id: 'member-1', nickname: 'Member', avatar_url: '🛡️', bio: '',
  is_18_verified: false, verified_at: null, verification_method: 'pending',
  safe_filter_enabled: true, notification_sounds: true, created_at: '2026-01-01T00:00:00Z',
};
const authUser = { id: 'member-1', email: 'member@example.test', user_metadata: { nickname: 'Member', gender: 'other' } };

function makeClient(options: {
  profileResult?: { data: any; error?: any; status?: number };
  signInError?: any;
  signUpResult?: any;
  signOutResult?: any;
  getSessionResults?: any[];
} = {}) {
  const calls = { signOut: [] as any[], profileSelect: '', profileFilter: '' };
  let sessionReadIndex = 0;
  const client = {
    auth: {
      signInWithPassword: async () => ({ data: { user: authUser, session: { user: authUser } }, error: options.signInError || null }),
      signUp: async () => options.signUpResult || ({ data: { user: authUser, session: { user: authUser } }, error: null }),
      signOut: async (args: any) => { calls.signOut.push(args); return options.signOutResult || { error: null }; },
      getSession: async () => {
        const results = options.getSessionResults || [{ data: { session: null }, error: null }];
        const result = results[Math.min(sessionReadIndex, results.length - 1)];
        sessionReadIndex += 1;
        return result;
      },
    },
    from: (table: string) => {
      assert.equal(table, 'profiles');
      return {
        select: (columns: string) => {
          calls.profileSelect = columns;
          return {
            eq: (column: string, value: string) => {
              assert.equal(column, 'id');
              calls.profileFilter = value;
              return { maybeSingle: async () => options.profileResult || { data: profileRow, error: null, status: 200 } };
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

async function testAuthFlows() {
  const confirmationClient = makeClient({
    signUpResult: { data: { user: authUser, session: null }, error: null },
  });
  const confirmation = await registerWithSupabaseClient(confirmationClient.client, 'member@example.test', 'pw', ' Member ', 'other', 'en');
  assert.deepEqual(confirmation, { success: true, requiresEmailConfirmation: true });
  assert.equal(confirmationClient.calls.profileSelect, '', 'confirmation-pending signup does not become an app session or fetch a profile');

  const activeSignup = makeClient();
  const registered = await registerWithSupabaseClient(activeSignup.client, 'member@example.test', 'pw', 'Member', 'other', 'bn');
  assert.equal(registered.success, true);
  assert.equal(registered.user?.id, 'member-1');
  assert.equal(registered.user?.languagePreference, 'bn');
  assert.equal(activeSignup.calls.profileFilter, 'member-1');

  const validLoginClient = makeClient();
  const validLogin = await loginWithSupabaseClient(validLoginClient.client, 'member@example.test', 'pw');
  assert.equal(validLogin.success, true);
  assert.equal(validLogin.user?.id, 'member-1');
  assert.equal(validLoginClient.calls.profileFilter, 'member-1');
  assert.equal(validLoginClient.calls.profileSelect.includes('*'), false);
  assert.equal(validLoginClient.calls.profileSelect.includes('role'), false);

  const profileDenied = makeClient({
    profileResult: { data: null, error: { code: '42501', message: 'profile SELECT denied' }, status: 403 },
    getSessionResults: [
      { data: { session: null }, error: null },
      { data: { session: null }, error: null },
    ],
  });
  const deniedLogin = await loginWithSupabaseClient(profileDenied.client, 'member@example.test', 'pw');
  assert.equal(deniedLogin.success, false);
  assert.equal(deniedLogin.user, undefined);
  assert.match(deniedLogin.error || '', /profile SELECT denied/);
  assert.deepEqual(profileDenied.calls.signOut, [{ scope: 'local' }]);

  const cleanupFailed = makeClient({
    profileResult: { data: null, error: { code: 'FETCH_ERROR', message: 'profile network unavailable' }, status: 0 },
    signOutResult: { error: { message: 'local signout unavailable' } },
    getSessionResults: [{ data: { session: { user: authUser } }, error: null }],
  });
  const cleanupFailure = await loginWithSupabaseClient(cleanupFailed.client, 'member@example.test', 'pw');
  assert.equal(cleanupFailure.success, false);
  assert.equal(cleanupFailure.sessionCleanupFailed, true);
  assert.match(cleanupFailure.error || '', /profile network unavailable/);
  assert.match(cleanupFailure.error || '', /local signout unavailable/);
  assert.match(cleanupFailure.error || '', /session remains active/i);

  const authRejected = makeClient({ signInError: { message: 'Invalid login credentials' } });
  const rejected = await loginWithSupabaseClient(authRejected.client, 'member@example.test', 'pw');
  assert.equal(rejected.success, false);
  assert.equal(rejected.error, 'Invalid login credentials');
  assert.equal(authRejected.calls.signOut.length, 0);
}

async function testSessionRestoration() {
  const restoredClient = makeClient({
    getSessionResults: [{ data: { session: { user: authUser } }, error: null }],
  });
  const restored = await restoreSessionWithSupabaseClient(restoredClient.client);
  assert.equal(restored.status, 'restored');
  if (restored.status === 'restored') assert.equal(restored.user.id, 'member-1');

  const missingProfileClient = makeClient({
    profileResult: { data: null, error: null, status: 200 },
    getSessionResults: [
      { data: { session: { user: authUser } }, error: null },
      { data: { session: null }, error: null },
    ],
  });
  const missing = await restoreSessionWithSupabaseClient(missingProfileClient.client);
  assert.equal(missing.status, 'profile-missing');
  assert.deepEqual(missingProfileClient.calls.signOut, [{ scope: 'local' }]);

  const queryFailureClient = makeClient({
    profileResult: { data: null, error: { code: '42501', message: 'profile permission denied' }, status: 403 },
    getSessionResults: [
      { data: { session: { user: authUser } }, error: null },
      { data: { session: null }, error: null },
    ],
  });
  const queryFailure = await restoreSessionWithSupabaseClient(queryFailureClient.client);
  assert.equal(queryFailure.status, 'profile-error');
  assert.match(queryFailure.error, /profile permission denied/);

  const noSessionClient = makeClient({ getSessionResults: [{ data: { session: null }, error: null }] });
  assert.deepEqual(await restoreSessionWithSupabaseClient(noSessionClient.client), { status: 'no-session' });
  const unreadableSession = makeClient({ getSessionResults: [{ data: { session: null }, error: { message: 'session storage unavailable' } }] });
  const sessionError = await restoreSessionWithSupabaseClient(unreadableSession.client);
  assert.equal(sessionError.status, 'session-error');
  assert.equal(sessionError.sessionCleanupFailed, true);
  assert.match(sessionError.error, /session storage unavailable/);
  assert.deepEqual(unreadableSession.calls.signOut, [{ scope: 'local' }]);
}

async function testAuthContextRestoration() {
  const initialState = () => ({
    user: undefined as any,
    active: undefined as boolean | undefined,
    loading: true,
    clearedProfile: false,
    guestValidated: false,
  });

  const memberState = initialState();
  await restoreAuthContextState({
    isSupabaseActive: true,
    auth: { restoreSession: async () => ({ status: 'restored', user: { ...profileRow, isGuest: false } as any }) },
    guest: { getStoredToken: () => 'independent-guest-token', validateSession: async () => { memberState.guestValidated = true; return { valid: false }; } },
    setUser: (user) => { memberState.user = user; },
    setHasActiveSession: (active) => { memberState.active = active; },
    setIsLoading: (loading) => { memberState.loading = loading; },
    clearStoredProfile: () => { memberState.clearedProfile = true; },
  });
  assert.equal(memberState.active, true);
  assert.equal(memberState.user.id, 'member-1');
  assert.equal(memberState.guestValidated, false);
  assert.equal(memberState.loading, false);

  const failedMemberState = initialState();
  await restoreAuthContextState({
    isSupabaseActive: true,
    auth: { restoreSession: async () => ({ status: 'profile-error', error: 'profile unavailable' }) },
    guest: { getStoredToken: () => 'preserved-guest-token', validateSession: async () => { failedMemberState.guestValidated = true; return { valid: true }; } },
    setUser: (user) => { failedMemberState.user = user; },
    setHasActiveSession: (active) => { failedMemberState.active = active; },
    setIsLoading: (loading) => { failedMemberState.loading = loading; },
    clearStoredProfile: () => { failedMemberState.clearedProfile = true; },
  });
  assert.equal(failedMemberState.active, false);
  assert.equal(failedMemberState.user.isGuest, false);
  assert.equal(failedMemberState.user.nickname, 'Account unavailable');
  assert.equal(failedMemberState.user.id, '');
  assert.equal(failedMemberState.guestValidated, false, 'a failed member profile lookup does not silently switch to a guest identity');
  assert.equal(failedMemberState.clearedProfile, false);
  assert.equal(failedMemberState.loading, false);

  const uncertainMemberState = initialState();
  await restoreAuthContextState({
    isSupabaseActive: true,
    auth: { restoreSession: async () => { throw new Error('session state unavailable'); } },
    guest: { getStoredToken: () => 'preserved-token', validateSession: async () => { uncertainMemberState.guestValidated = true; return { valid: true }; } },
    setUser: (user) => { uncertainMemberState.user = user; },
    setHasActiveSession: (active) => { uncertainMemberState.active = active; },
    setIsLoading: (loading) => { uncertainMemberState.loading = loading; },
    clearStoredProfile: () => { uncertainMemberState.clearedProfile = true; },
  });
  assert.equal(uncertainMemberState.active, false);
  assert.equal(uncertainMemberState.user.isGuest, false);
  assert.equal(uncertainMemberState.guestValidated, false);
  assert.equal(uncertainMemberState.loading, false);

  const noMemberState = initialState();
  await restoreAuthContextState({
    isSupabaseActive: true,
    auth: { restoreSession: async () => ({ status: 'no-session' }) },
    guest: {
      getStoredToken: () => 'valid-guest-token',
      validateSession: async () => { noMemberState.guestValidated = true; return { valid: true, session: { id: 'guest-1', nickname: 'Guest', avatar: '⚡', is18Verified: false } }; },
    },
    setUser: (user) => { noMemberState.user = user; },
    setHasActiveSession: (active) => { noMemberState.active = active; },
    setIsLoading: (loading) => { noMemberState.loading = loading; },
    clearStoredProfile: () => { noMemberState.clearedProfile = true; },
  });
  assert.equal(noMemberState.active, true);
  assert.equal(noMemberState.user.isGuest, true);
  assert.equal(noMemberState.user.id, 'guest-1');
  assert.equal(noMemberState.loading, false);

  const invalidGuestState = initialState();
  await restoreAuthContextState({
    isSupabaseActive: false,
    auth: { restoreSession: async () => ({ status: 'no-session' }) },
    guest: { getStoredToken: () => 'revoked-token', validateSession: async () => ({ valid: false }) },
    setUser: (user) => { invalidGuestState.user = user; },
    setHasActiveSession: (active) => { invalidGuestState.active = active; },
    setIsLoading: (loading) => { invalidGuestState.loading = loading; },
    clearStoredProfile: () => { invalidGuestState.clearedProfile = true; },
  });
  assert.equal(invalidGuestState.active, false);
  assert.equal(invalidGuestState.user.id, '');
  assert.equal(invalidGuestState.clearedProfile, true);
  assert.equal(invalidGuestState.loading, false);

  let releaseGuestValidation!: (value: { valid: boolean }) => void;
  const deferredState = initialState();
  const restorePromise = restoreAuthContextState({
    isSupabaseActive: false,
    auth: { restoreSession: async () => ({ status: 'no-session' }) },
    guest: { getStoredToken: () => 'slow-token', validateSession: () => new Promise((resolve) => { releaseGuestValidation = resolve; }) },
    setUser: (user) => { deferredState.user = user; },
    setHasActiveSession: (active) => { deferredState.active = active; },
    setIsLoading: (loading) => { deferredState.loading = loading; },
    clearStoredProfile: () => { deferredState.clearedProfile = true; },
  });
  await Promise.resolve();
  assert.equal(deferredState.loading, true, 'initial loading stays active while async guest validation is pending');
  releaseGuestValidation({ valid: false });
  await restorePromise;
  assert.equal(deferredState.loading, false);
}

async function run() {
  await testAuthFlows();
  await testSessionRestoration();
  await testAuthContextRestoration();

  const payload = buildAllowedProfileUpdatePayload({
    nickname: 'Changed', bio: 'Bio', avatar: '⭐', safeFilterEnabled: false,
    notificationSounds: false, role: 'admin', is18Verified: true,
    verifiedAt: 'untrusted', verificationMethod: 'untrusted', id: 'other-user',
  }, '2026-02-01T00:00:00.000Z');
  assert.deepEqual(payload, {
    nickname: 'Changed', bio: 'Bio', avatar_url: '⭐', safe_filter_enabled: false,
    notification_sounds: false, updated_at: '2026-02-01T00:00:00.000Z',
  });
  assert.equal('role' in payload, false);
  assert.equal('is_18_verified' in payload, false);

  const migration = readFileSync('supabase/migrations/20261111120000_secure_registration_profile_permissions.sql', 'utf8');
  assert.match(migration, /INSERT INTO public\.profiles\s*\(id, nickname\)/i);
  assert.match(migration, /ON CONFLICT \(id\) DO NOTHING/i);
  assert.match(migration, /an omitted profile column is NOT NULL without a database default/i);
  assert.match(migration, /auth\.users has an unreviewed application trigger/i);
  assert.match(migration, /the profile trigger name is already bound to an unexpected function/i);
  assert.match(migration, /column_default IS NULL AND c\.is_nullable = 'NO'/i);
  assert.match(migration, /SET search_path = ''/i);
  assert.match(migration, /ARRAY\['user', 'moderator', 'admin'\]::text\[\]/i);
  assert.match(migration, /USING \(\(SELECT auth\.uid\(\)\) = id\)/i);
  assert.match(migration, /GRANT SELECT \([\s\S]*\) ON TABLE public\.profiles TO authenticated/i);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.profiles FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /AFTER INSERT ON auth\.users/i);
  assert.doesNotMatch(migration, /GRANT\s+SELECT\s+ON TABLE public\.profiles TO anon/i);
  assert.doesNotMatch(migration, /raw_user_meta_data\s*->>\s*'role'/i);

  const authContextSource = readFileSync('src/context/AuthContext.tsx', 'utf8');
  assert.match(authContextSource, /res\.requiresEmailConfirmation\)\s*\{\s*return \{ success: true, requiresEmailConfirmation: true \};/);
  assert.match(authContextSource, /finally\s*\{\s*options\.setIsLoading\(false\);/);
  const authServiceSource = readFileSync('src/services/authService.ts', 'utf8');
  assert.equal((authServiceSource.match(/is18Verified: false/g) || []).length >= 2, true);
  assert.doesNotMatch(authServiceSource, /is18Verified: true/);

  console.log('Registration/profile session consistency tests passed.');
}

run().catch((error) => {
  console.error('Registration/profile session consistency tests failed:', error);
  process.exitCode = 1;
});
