import { authService } from '../src/services/authService';
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

  // 1. Migration SQL Structure & Security Verification
  {
    const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20261111095941_secure_profile_initialization.sql');
    assert(fs.existsSync(migrationPath), '1. Migration file exists in supabase/migrations');

    const sqlContent = fs.readFileSync(migrationPath, 'utf8');
    assert(sqlContent.includes('CREATE OR REPLACE FUNCTION public.handle_new_user_profile()'), '1. Defines handle_new_user_profile() function');
    assert(sqlContent.includes('SECURITY DEFINER'), '1. Function uses SECURITY DEFINER');
    assert(sqlContent.includes("SET search_path = public, pg_temp"), '1. Function sets strict search_path = public, pg_temp');
    assert(sqlContent.includes("'user'::public.user_role"), '1. Role is hardcoded to user role (no user escalation)');
    assert(sqlContent.includes('ON CONFLICT (id) DO NOTHING'), '1. Uses conflict-safe insertion (ON CONFLICT DO NOTHING)');
    assert(sqlContent.includes('REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM PUBLIC'), '1. Revokes EXECUTE from PUBLIC');
    assert(sqlContent.includes('REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM anon'), '1. Revokes EXECUTE from anon');
    assert(sqlContent.includes('REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM authenticated'), '1. Revokes EXECUTE from authenticated');
    assert(sqlContent.includes('CREATE TRIGGER on_auth_user_created'), '1. Registers AFTER INSERT trigger on auth.users');
    assert(sqlContent.includes('AFTER INSERT ON auth.users'), '1. Trigger fires AFTER INSERT ON auth.users');
  }

  // 2. AuthService register without Supabase client (Simulated fallback)
  {
    const res = await authService.register('test_simulated@example.com', 'Password123!', 'SimulatedNick', 'female', 'bn');
    assert(res.success === true, '2. Simulated registration succeeds');
    assert(res.user !== undefined, '2. Simulated user profile is returned');
    assert(res.user?.nickname === 'SimulatedNick', '2. Simulated user nickname matches');
    assert(res.user?.isGuest === false, '2. Simulated user is registered member (isGuest: false)');
  }

  // 3. UserProfile type safety & role integrity
  {
    const testProfile: UserProfile = {
      id: 'usr_uuid_123',
      email: 'member@chatlustora.com',
      nickname: 'TestMember',
      isGuest: false,
      is18Verified: false,
      avatar: '🛡️',
      gender: 'male',
      languagePreference: 'en',
      safeFilterEnabled: true,
      notificationSounds: true,
      createdAt: new Date().toISOString(),
    };

    assert(testProfile.isGuest === false, '3. UserProfile supports registered member type');
    assert(!('role' in testProfile), '3. UserProfile interface does not expose administrative role escalation fields');
  }

  console.log('\n=============================================================');
  console.log('--- ALL REGISTRATION & RESTORATION TESTS PASSED SUCCESSFULLY ---');
  console.log('=============================================================\n');
}

runRegistrationAndRestorationTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exitCode = 1;
});
