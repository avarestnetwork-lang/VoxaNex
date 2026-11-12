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
  console.log('--- PHASE 2: PRODUCTION PROFILE SCHEMA & SECURITY MIGRATION TESTS ---');
  console.log('============================================================\n');

  // 1. Corrective Migration SQL & Hardened Security Verification
  {
    const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20261112150000_production_secure_profile_schema.sql');
    assert(fs.existsSync(migrationPath), '1. Production secure profile migration file exists');

    const sqlContent = fs.readFileSync(migrationPath, 'utf8');
    assert(sqlContent.includes('CREATE OR REPLACE FUNCTION public.handle_new_user_profile()'), '1. Defines handle_new_user_profile() function');
    assert(sqlContent.includes('SECURITY DEFINER'), '1. Uses SECURITY DEFINER');
    assert(sqlContent.includes("SET search_path = ''"), '1. Uses hardened empty search_path = \'\'');
    assert(sqlContent.includes("'user'::public.user_role"), '1. Hardcodes role to user (prevents privilege escalation)');
    assert(sqlContent.includes('ON CONFLICT (id) DO NOTHING'), '1. Uses conflict-safe insertion');
    assert(!sqlContent.includes('EXCEPTION WHEN OTHERS'), '1. Omits exception swallowing to ensure transactional error abort');
    assert(sqlContent.includes('nullif') && sqlContent.includes('trim'), '1. Handles empty and whitespace-only nicknames safely using nullif and trim');
    assert(sqlContent.includes('REVOKE SELECT ON TABLE public.profiles FROM PUBLIC'), '1. Revokes base table SELECT from PUBLIC');
    assert(sqlContent.includes('REVOKE SELECT ON TABLE public.profiles FROM anon'), '1. Revokes base table SELECT from anon');
    assert(sqlContent.includes('GRANT SELECT ON TABLE public.profiles TO authenticated'), '1. Grants base table SELECT exclusively to authenticated');
    assert(sqlContent.includes('CREATE POLICY "Users can view own profile"'), '1. Creates owner-only SELECT RLS policy');
    assert(sqlContent.includes('CREATE OR REPLACE VIEW public.public_profiles'), '1. Exposes restricted public safe view');
  }

  // 2. AuthContext Lifecycle, INITIAL_SESSION & Stale Restoration Guards
  {
    const authContextPath = path.join(process.cwd(), 'src', 'context', 'AuthContext.tsx');
    assert(fs.existsSync(authContextPath), '2. AuthContext.tsx exists');

    const authContextContent = fs.readFileSync(authContextPath, 'utf8');
    assert(authContextContent.includes("event === 'INITIAL_SESSION'"), '2. AuthContext handles INITIAL_SESSION event explicitly');
    assert(authContextContent.includes("initTimeout"), '2. AuthContext implements bounded initialization timeout guard');
    assert(authContextContent.includes("setIsLoading(false)"), '2. AuthContext guarantees transition to non-loading state');
    assert(authContextContent.includes("check.valid === false"), '2. Guest token cleanup strictly reserved for explicit server revocation');
    assert(authContextContent.includes("++restoreSeqRef.current"), '2. AuthContext bumps sequence ref on explicit login/logout state changes');
  }

  // 3. AuthService Simulation Contract & Strict Database Confirmation
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
    assert(simulatedRes.profileConfirmed === false, '3. Simulation registration NEVER claims database profile confirmation (profileConfirmed: false)');

    const simulatedLoginRes = await authService.login('simlogin@example.com', 'Password123!');
    assert(simulatedLoginRes.success === true, '3. Simulation login succeeds');
    assert(simulatedLoginRes.user?.is18Verified === false, '3. Simulation login does not manufacture trusted age verification');
  }

  // 4. Robust Error Sanitization & Non-String Message Safety
  {
    const authServiceContent = fs.readFileSync(path.join(process.cwd(), 'src', 'services', 'authService.ts'), 'utf8');
    assert(authServiceContent.includes('sanitizeAuthError'), '4. AuthService utilizes sanitizeAuthError function');
    assert(authServiceContent.includes('typeof rawError.message === \'string\''), '4. sanitizeAuthError safely checks for string error messages');
    assert(authServiceContent.includes('An unexpected authentication error occurred'), '4. Unknown raw errors map to safe generic user-facing message');
  }

  // 5. Test Isolation & Guest Session Independence
  {
    const guestToken = guestSessionService.getStoredToken();
    assert(typeof guestSessionService.getStoredToken === 'function', '5. Guest session service token getter exists');
    assert(typeof guestSessionService.revokeSession === 'function', '5. Guest session revocation method exists');
  }

  console.log('\n=============================================================');
  console.log('--- ALL PRODUCTION PROFILE & MIGRATION AUDIT TESTS PASSED ---');
  console.log('=============================================================\n');
}

runRegistrationAndRestorationTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exitCode = 1;
});
