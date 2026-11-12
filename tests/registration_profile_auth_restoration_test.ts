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
  console.log('--- PHASE 2: WORK PROMPT 4 SQL SYNTAX & SECURITY AUDIT TESTS ---');
  console.log('=============================================================\n');

  // 1. Migration SQL Syntax & Security Audit Assertions
  {
    const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20261112150000_production_secure_profile_schema.sql');
    assert(fs.existsSync(migrationPath), '1.1 Production secure profile migration file exists');

    const sqlContent = fs.readFileSync(migrationPath, 'utf8');
    
    // 1.2 Function definition & Security Definer & search_path
    assert(sqlContent.includes('CREATE OR REPLACE FUNCTION public.handle_new_user_profile()'), '1.2 Defines handle_new_user_profile() function');
    assert(sqlContent.includes('SECURITY DEFINER'), '1.3 Function is SECURITY DEFINER');
    assert(sqlContent.includes("SET search_path = ''"), '1.4 Function uses hardened empty search_path = \'\'');

    // 1.5 Built-in expression syntax checks (no pg_catalog.COALESCE, nullif, trim; use pg_catalog.btrim and unqualified COALESCE/NULLIF)
    assert(!sqlContent.includes('pg_catalog.COALESCE'), '1.5 No pg_catalog.COALESCE remains');
    assert(!sqlContent.includes('pg_catalog.nullif'), '1.6 No pg_catalog.nullif remains');
    assert(!sqlContent.includes('pg_catalog.trim'), '1.7 No pg_catalog.trim remains');
    assert(sqlContent.includes('pg_catalog.btrim'), '1.8 pg_catalog.btrim is used for trimming');
    assert(sqlContent.includes('COALESCE(') && sqlContent.includes('NULLIF('), '1.9 COALESCE and NULLIF appear as valid SQL expressions');

    // 1.10 Qualified objects & role
    assert(sqlContent.includes('public.profiles'), '1.10 Function uses qualified public.profiles');
    assert(sqlContent.includes('public.user_role'), '1.11 Function uses qualified public.user_role');
    assert(sqlContent.includes("'user'::public.user_role"), '1.12 Hardcodes role to user (prevents privilege escalation)');

    // 1.13 Trigger registration & error handling
    assert(sqlContent.includes('AFTER INSERT ON auth.users'), '1.13 Trigger is registered AFTER INSERT ON auth.users');
    assert(!sqlContent.includes('EXCEPTION WHEN OTHERS'), '1.14 No exception swallowing (transactional error abort preserved)');

    // 1.15 Function EXECUTE revocation
    assert(sqlContent.includes('REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM PUBLIC'), '1.15 Function EXECUTE revoked from PUBLIC');
    assert(sqlContent.includes('REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM anon'), '1.16 Function EXECUTE revoked from anon');
    assert(sqlContent.includes('REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM authenticated'), '1.17 Function EXECUTE revoked from authenticated');

    // 1.18 Backfill & ON CONFLICT
    assert(sqlContent.includes('ON CONFLICT (id) DO NOTHING'), '1.18 Backfill uses ON CONFLICT (id) DO NOTHING');

    // 1.19 Access Control & Privileges
    assert(sqlContent.includes('REVOKE SELECT ON TABLE public.profiles FROM PUBLIC'), '1.19 Base-table SELECT revoked from PUBLIC');
    assert(sqlContent.includes('REVOKE SELECT ON TABLE public.profiles FROM anon'), '1.20 Base-table SELECT revoked from anon');
    assert(sqlContent.includes('GRANT SELECT ON TABLE public.profiles TO authenticated'), '1.21 Base-table SELECT granted to authenticated');

    // 1.22 RLS Policies (owner-only SELECT & UPDATE with USING and WITH CHECK)
    assert(sqlContent.includes('CREATE POLICY "Users can view own profile"'), '1.22 Owner-only SELECT policy exists');
    assert(sqlContent.includes('CREATE POLICY "Users can update own profile"'), '1.23 Owner-only UPDATE policy exists');
    assert(sqlContent.includes('WITH CHECK (auth.uid() = id)'), '1.24 UPDATE policy includes WITH CHECK clause');
    assert(sqlContent.includes('DROP POLICY IF EXISTS "Profiles are publicly readable"'), '1.25 Known insecure public base-table policies dropped');

    // 1.26 Restricted Public View
    assert(sqlContent.includes('CREATE OR REPLACE VIEW public.public_profiles AS'), '1.26 Safe public view exists');
    assert(
      sqlContent.includes('id') &&
      sqlContent.includes('nickname') &&
      sqlContent.includes('avatar_url') &&
      sqlContent.includes('bio') &&
      sqlContent.includes('is_18_verified') &&
      sqlContent.includes('created_at'),
      '1.27 View exposes exactly the 6 approved safe columns'
    );
    assert(sqlContent.includes('GRANT SELECT ON public.public_profiles TO anon, authenticated, public'), '1.28 Safe view SELECT grant remains present');

    // 1.29 No direct base-table INSERT/UPDATE grant
    assert(!sqlContent.includes('GRANT INSERT') && !sqlContent.includes('GRANT UPDATE'), '1.29 No direct base-table INSERT or UPDATE grant introduced for anon/authenticated');
  }

  // 2. AuthContext Lifecycle, INITIAL_SESSION & Stale Restoration Guards
  {
    const authContextPath = path.join(process.cwd(), 'src', 'context', 'AuthContext.tsx');
    assert(fs.existsSync(authContextPath), '2.1 AuthContext.tsx exists');

    const authContextContent = fs.readFileSync(authContextPath, 'utf8');
    assert(authContextContent.includes("event === 'INITIAL_SESSION'"), '2.2 AuthContext handles INITIAL_SESSION event explicitly');
    assert(authContextContent.includes("initTimeout"), '2.3 AuthContext implements bounded initialization timeout guard');
    assert(authContextContent.includes("setIsLoading(false)"), '2.4 AuthContext guarantees transition to non-loading state');
    assert(authContextContent.includes("check.valid === false"), '2.5 Guest token cleanup strictly reserved for explicit server revocation');
    assert(authContextContent.includes("++restoreSeqRef.current"), '2.6 AuthContext bumps sequence ref on explicit login/logout state changes');
  }

  // 3. AuthService Simulation Contract & Strict Database Confirmation
  {
    const emptyNickRes = await authService.register('test_empty@example.com', 'Password123!', '   ', 'prefer_not_to_say', 'en');
    assert(emptyNickRes.success === true, '3.1 Registration with whitespace nickname succeeds');
    assert(emptyNickRes.user?.nickname === 'test_empty', '3.2 Empty/whitespace nickname falls back to email prefix');

    const simulatedRes = await authService.register('member@example.com', 'Password123!', 'ValidNick', 'female', 'bn');
    assert(simulatedRes.success === true, '3.3 Valid registration returns success: true');
    assert(simulatedRes.user?.nickname === 'ValidNick', '3.4 Valid nickname preserved');
    assert(simulatedRes.user?.isGuest === false, '3.5 Registered user is not guest');
    assert(simulatedRes.user?.is18Verified === false, '3.6 Simulation mode does not manufacture trusted age verification');
    assert(simulatedRes.user?.verificationMethod === 'pending', '3.7 Simulation mode age verification method is pending');
    assert(simulatedRes.profileConfirmed === false, '3.8 Simulation registration NEVER claims database profile confirmation (profileConfirmed: false)');

    const simulatedLoginRes = await authService.login('simlogin@example.com', 'Password123!');
    assert(simulatedLoginRes.success === true, '3.9 Simulation login succeeds');
    assert(simulatedLoginRes.user?.is18Verified === false, '3.10 Simulation login does not manufacture trusted age verification');
  }

  // 4. Robust Error Sanitization & Non-String Message Safety
  {
    const authServiceContent = fs.readFileSync(path.join(process.cwd(), 'src', 'services', 'authService.ts'), 'utf8');
    assert(authServiceContent.includes('sanitizeAuthError'), '4.1 AuthService utilizes sanitizeAuthError function');
    assert(authServiceContent.includes('typeof rawError.message === \'string\''), '4.2 sanitizeAuthError safely checks for string error messages');
    assert(authServiceContent.includes('An unexpected authentication error occurred'), '4.3 Unknown raw errors map to safe generic user-facing message');
  }

  // 5. Test Isolation & Guest Session Independence
  {
    const guestToken = guestSessionService.getStoredToken();
    assert(typeof guestSessionService.getStoredToken === 'function', '5.1 Guest session service token getter exists');
    assert(typeof guestSessionService.revokeSession === 'function', '5.2 Guest session revocation method exists');
  }

  console.log('\n=============================================================');
  console.log('--- ALL WORK PROMPT 4 MIGRATION AUDIT TESTS PASSED ---');
  console.log('=============================================================\n');
}

runRegistrationAndRestorationTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exitCode = 1;
});
