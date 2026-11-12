-- =============================================================================
-- CHATLUSTORA / VOXANEX — PRODUCTION SECURE PROFILE SCHEMA & INITIALIZATION
-- Migration: 20261112150000_production_secure_profile_schema.sql
-- Description: 
--   1. Implements a transactional, secure profile initialization trigger on auth.users.
--   2. Enforces atomic rollback if profile creation fails (no orphaned auth users).
--   3. Hardcodes role assignment to 'user' to prevent privilege escalation.
--   4. Idempotently backfills missing profile rows for existing auth users.
--   5. Establishes granular table privileges: GRANT SELECT TO authenticated only, REVOKE from anon/PUBLIC.
--   6. Enforces owner-only RLS SELECT/UPDATE policies and exposes a public safe view.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. TABLE PRIVILEGE HARDENING
-- -----------------------------------------------------------------------------
-- Revoke base table SELECT from public, anon, and default roles
REVOKE SELECT ON TABLE public.profiles FROM PUBLIC;
REVOKE SELECT ON TABLE public.profiles FROM anon;
REVOKE SELECT ON TABLE public.profiles FROM authenticated;

-- Grant SELECT exclusively to authenticated users (governed by RLS owner-only policy)
GRANT SELECT ON TABLE public.profiles TO authenticated;

-- Ensure RLS is enabled
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. TRANSACTIONAL SECURE PROFILE INITIALIZATION FUNCTION
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_nickname TEXT;
    v_avatar TEXT;
BEGIN
    -- Extract and sanitize nickname from user metadata, falling back to email prefix, then Member_<uuid_8>
    v_nickname := pg_catalog.trim(pg_catalog.COALESCE(NEW.raw_user_meta_data->>'nickname', ''));
    IF v_nickname = '' OR v_nickname IS NULL THEN
        v_nickname := pg_catalog.trim(pg_catalog.COALESCE(pg_catalog.split_part(NEW.email, '@', 1), ''));
    END IF;
    IF v_nickname = '' OR v_nickname IS NULL THEN
        v_nickname := 'Member_' || pg_catalog.substr(NEW.id::text, 1, 8);
    END IF;
    -- Enforce maximum 32 characters for profiles.nickname
    v_nickname := pg_catalog.substr(v_nickname, 1, 32);

    -- Extract avatar with safe platform default
    v_avatar := pg_catalog.trim(pg_catalog.COALESCE(NEW.raw_user_meta_data->>'avatar_url', ''));
    IF v_avatar = '' OR v_avatar IS NULL THEN
        v_avatar := '🛡️';
    END IF;

    -- Transactional profile insertion.
    -- If this insert fails, transaction aborts and auth.users creation fails atomically.
    -- Role is strictly hardcoded to 'user'::public.user_role to prevent privilege escalation.
    INSERT INTO public.profiles (
        id,
        nickname,
        avatar_url,
        bio,
        role,
        is_18_verified,
        verification_method,
        safe_filter_enabled,
        notification_sounds,
        created_at,
        updated_at
    ) VALUES (
        NEW.id,
        v_nickname,
        v_avatar,
        '',
        'user'::public.user_role,
        FALSE,
        'pending',
        TRUE,
        TRUE,
        pg_catalog.timezone('utc'::text, pg_catalog.now()),
        pg_catalog.timezone('utc'::text, pg_catalog.now())
    );

    RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. PRIVILEGE HARDENING FOR TRIGGER FUNCTION
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM authenticated;

-- -----------------------------------------------------------------------------
-- 4. AUTH.USERS TRIGGER REGISTRATION
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user_profile();

-- -----------------------------------------------------------------------------
-- 5. IDEMPOTENT BACKFILL FOR UNINITIALIZED AUTH USERS
-- -----------------------------------------------------------------------------
INSERT INTO public.profiles (
    id,
    nickname,
    avatar_url,
    bio,
    role,
    is_18_verified,
    verification_method,
    safe_filter_enabled,
    notification_sounds,
    created_at,
    updated_at
)
SELECT
    u.id,
    pg_catalog.substr(
        pg_catalog.COALESCE(
            pg_catalog.nullif(pg_catalog.trim(u.raw_user_meta_data->>'nickname'), ''),
            pg_catalog.nullif(pg_catalog.trim(pg_catalog.split_part(u.email, '@', 1)), ''),
            'Member_' || pg_catalog.substr(u.id::text, 1, 8)
        ),
        1, 32
    ),
    pg_catalog.COALESCE(pg_catalog.nullif(pg_catalog.trim(u.raw_user_meta_data->>'avatar_url'), ''), '🛡️'),
    '',
    'user'::public.user_role,
    FALSE,
    'pending',
    TRUE,
    TRUE,
    u.created_at,
    pg_catalog.timezone('utc'::text, pg_catalog.now())
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6. SECURE RLS POLICIES & ACCESS CONTROL
-- -----------------------------------------------------------------------------
-- Drop insecure wide policies if any exist
DROP POLICY IF EXISTS "Profiles are publicly readable" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

-- Policy A: Profile owners can fully select their own profile row
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Policy B: Profile owners can update their own profile row
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Policy C: Secure public profile view exposing only safe public columns
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT 
    id,
    nickname,
    avatar_url,
    bio,
    is_18_verified,
    created_at
FROM public.profiles;

GRANT SELECT ON public.public_profiles TO anon, authenticated, public;
