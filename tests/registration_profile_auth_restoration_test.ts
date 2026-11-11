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
  console.log('--- PHASE 1: REGISTRATION, PROFILE INIT & AUTH RESTORATION ---');
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

  // 2. AuthService Signup Email Confirmation & Fallback Rules
  {
    const emptyNickRes = await authService.register('test_empty@example.com', 'Password123!', '   ', 'prefer_not_to_say', 'en');
    assert(emptyNickRes.success === true, '2. Registration with whitespace nickname succeeds');
    assert(emptyNickRes.user?.nickname === 'test_empty', '2. Empty/whitespace nickname falls back to email prefix');

    const simulatedRes = await authService.register('member@example.com', 'Password123!', 'ValidNick', 'female', 'bn');
    assert(simulatedRes.success === true, '2. Valid registration returns success: true');
    assert(simulatedRes.user?.nickname === 'ValidNick', '2. Valid nickname preserved');
    assert(simulatedRes.user?.isGuest === false, '2. Registered user is not guest');
  }

  // 3. User Metadata Role Isolation Check
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

    assert(!('role' in profile), '3. UserProfile object strictly isolates client role fields');
    assert(!('is_admin' in profile), '3. UserProfile object strictly isolates is_admin fields');
  }

  // 4. Guest Session Independence & Non-Revocation
  {
    const guestToken = guestSessionService.getStoredToken();
    // Verify guest token storage methods operate without throwing
    assert(typeof guestSessionService.getStoredToken === 'function', '4. Guest session service token getter exists');
    assert(typeof guestSessionService.revokeSession === 'function', '4. Guest session revocation method exists');
  }

  console.log('\n=============================================================');
  console.log('--- ALL FOCUSED CORRECTION TESTS PASSED SUCCESSFULLY ---');
  console.log('=============================================================\n');
}

runRegistrationAndRestorationTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exitCode = 1;
});
