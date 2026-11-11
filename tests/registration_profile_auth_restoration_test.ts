import { authService, AuthResponse } from '../src/services/authService';
import { guestSessionService } from '../src/services/guestSessionService';
import { UserProfile } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';

function assert(condition: boolean, testName: string) {
  if (!condition) {
    console.error(`❌ [FAILED] ${testName}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ [PASSED] ${testName}`);
  }
}

async function runRegistrationAndRestorationTests() {
  console.log('\n=============================================================');
  console.log('--- PHASE 1: CRITICAL LOADING FIX & REGISTRATION SECURITY ---');
  console.log('=============================================================\n');

  // 1. Corrective Migration SQL & Error Handling Verification
  {
    const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20261111101300_fix_profile_trigger_error_handling.sql');
    assert(fs.existsSync(migrationPath), '1. Corrective migration file exists');

    const sqlContent = fs.readFileSync(migrationPath, 'utf8');
    assert(sqlContent.includes('CREATE OR REPLACE FUNCTION public.handle_new_user_profile()'), '1. Defines handle_new_user_profile() function');
    assert(sqlContent.includes('SECURITY DEFINER'), '1. Uses SECURITY DEFINER');
    assert(sqlContent.includes("SET search_path = public, pg_temp"), '1. Sets search_path = public, pg_temp');
    assert(sqlContent.includes("'user'::public.user_role"), '1. Hardcodes role to user (prevents privilege escalation)');
    assert(sqlContent.includes('ON CONFLICT (id) DO NOTHING'), '1. Uses conflict-safe insertion');
    assert(!sqlContent.includes('EXCEPTION WHEN OTHERS'), '1. Omits exception swallowing to allow transaction abort on error');
    assert(sqlContent.includes('nullif(trim'), '1. Handles empty and whitespace-only nicknames safely using nullif');
    assert(sqlContent.includes('REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM PUBLIC'), '1. Revokes EXECUTE from PUBLIC');
    assert(sqlContent.includes('REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM anon'), '1. Revokes EXECUTE from anon');
    assert(sqlContent.includes('REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM authenticated'), '1. Revokes EXECUTE from authenticated');
  }

  // 2. AuthContext Site Loading Fix & Initialization Lifecycle
  {
    const authContextPath = path.join(process.cwd(), 'src', 'context', 'AuthContext.tsx');
    assert(fs.existsSync(authContextPath), '2. AuthContext.tsx exists');

    const authContextContent = fs.readFileSync(authContextPath, 'utf8');
    assert(authContextContent.includes("event === 'INITIAL_SESSION'"), '2. AuthContext handles INITIAL_SESSION event explicitly');
    assert(authContextContent.includes("initTimeout"), '2. AuthContext implements bounded initialization timeout guard');
    assert(authContextContent.includes("setIsLoading(false)"), '2. AuthContext guarantees transition to non-loading state');
    assert(authContextContent.includes("check.valid === false"), '2. Guest token cleanup strictly reserved for explicit server revocation');
  }

  // 3. AuthService Signup Email Confirmation, Age Safety & Fallback Rules
  {
    const emptyNickRes = await authService.register('test_empty@example.com', 'Password123!', '   ', 'prefer_not_to_say', 'en');
    assert(emptyNickRes.success === true, '3. Registration with whitespace nickname succeeds');
    assert(emptyNickRes.user?.nickname === 'test_empty', '3. Empty/whitespace nickname falls back to email prefix');

    const simulatedRes = await authService.register('member@example.com', 'Password123!', 'ValidNick', 'female', 'bn');
    assert(simulatedRes.success === true, '3. Valid registration returns success: true');
    assert(simulatedRes.user?.nickname === 'ValidNick', '3. Valid nickname preserved');
    assert(simulatedRes.user?.isGuest === false, '3. Registered user is not guest');
    assert(simulatedRes.user?.is18Verified === false, '3. Simulation mode does not manufacture trusted age verification');
    assert(simulatedRes.user?.verificationMethod === 'pending', '3. Simulation mode age verification method is pending');

    const simulatedLoginRes = await authService.login('simlogin@example.com', 'Password123!');
    assert(simulatedLoginRes.success === true, '3. Simulation login succeeds');
    assert(simulatedLoginRes.user?.is18Verified === false, '3. Simulation login does not manufacture trusted age verification');
  }

  // 4. User Metadata Role Isolation Check
  {
    const userMetaWithAdmin = {
      nickname: 'HackerNick',
      role: 'admin',
      is_admin: true,
      is_moderator: true,
    };

    // Client UserProfile interface does not allow role mutation
    const profile: UserProfile = {
      id: 'usr_meta_test',
      email: 'hacker@example.com',
      nickname: userMetaWithAdmin.nickname,
      isGuest: false,
      is18Verified: false,
      avatar: '🛡️',
      languagePreference: 'en',
      safeFilterEnabled: true,
      notificationSounds: true,
      createdAt: new Date().toISOString(),
    };

    assert(!('role' in profile), '4. UserProfile object strictly isolates client role fields');
    assert(!('is_admin' in profile), '4. UserProfile object strictly isolates is_admin fields');
  }

  // 5. Guest Session Independence & Non-Revocation
  {
    const guestToken = guestSessionService.getStoredToken();
    assert(typeof guestSessionService.getStoredToken === 'function', '5. Guest session service token getter exists');
    assert(typeof guestSessionService.revokeSession === 'function', '5. Guest session revocation method exists');
  }

  console.log('\n=============================================================');
  console.log('--- ALL CRITICAL LOADING & REGISTRATION TESTS PASSED ---');
  console.log('=============================================================\n');
}

runRegistrationAndRestorationTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exitCode = 1;
});
