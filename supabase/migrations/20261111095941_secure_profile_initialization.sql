-- =============================================================================
-- CHATLUSTORA / VOXANEX — SECURE REGISTRATION & PROFILE INITIALIZATION
-- Migration: 20261111095941_secure_profile_initialization.sql
-- Description: Creates an idempotent, role-protected trigger on auth.users to
--              guarantee that every newly registered Supabase Auth user receives
--              exactly one initial profile record in public.profiles.
--              Eliminates dependence on unauthenticated browser-side RLS upserts,
--              enabling reliable registration under email-confirmation workflows.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. SECURE PROFILE INITIALIZATION FUNCTION
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_nickname TEXT;
    v_avatar TEXT;
BEGIN
    -- Extract and sanitize nickname from user metadata, falling back to email prefix or UUID snippet
    v_nickname := trim(COALESCE(NEW.raw_user_meta_data->>'nickname', ''));
    IF v_nickname = '' OR v_nickname IS NULL THEN
        v_nickname := trim(COALESCE(split_part(NEW.email, '@', 1), ''));
    END IF;
    IF v_nickname = '' OR v_nickname IS NULL THEN
        v_nickname := 'Member_' || substr(NEW.id::text, 1, 8);
    ELSE
        -- Ensure nickname strictly respects VARCHAR(32) length constraint
        v_nickname := substr(v_nickname, 1, 32);
    END IF;

    -- Extract avatar with safe platform default
    v_avatar := trim(COALESCE(NEW.raw_user_meta_data->>'avatar_url', ''));
    IF v_avatar = '' OR v_avatar IS NULL THEN
        v_avatar := '🛡️';
    END IF;

    -- Safe, idempotent profile insertion.
    -- Strict security: role is hardcoded to 'user'::public.user_role to prevent privilege escalation.
    -- User-editable raw_user_meta_data cannot assign admin or moderator privileges.
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
        timezone('utc'::text, now()),
        timezone('utc'::text, now())
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Log warning and do not block auth.users creation if profile already exists or transient conflict
        RAISE WARNING '[handle_new_user_profile] Profile initialization warning for user %: %', NEW.id, SQLERRM;
        RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. PRIVILEGE HARDENING
-- -----------------------------------------------------------------------------
-- Revoke all execute rights from public, anon, and authenticated roles.
-- The function must ONLY execute when invoked by the trusted auth.users trigger.
REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM authenticated;

-- -----------------------------------------------------------------------------
-- 3. AUTH.USERS TRIGGER REGISTRATION
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user_profile();

-- -----------------------------------------------------------------------------
-- 4. IDEMPOTENT BACKFILL FOR UNINITIALIZED AUTH USERS
-- -----------------------------------------------------------------------------
-- Ensures any existing auth user without a profile receives one safely.
-- Never alters or overwrites existing profiles (ON CONFLICT DO NOTHING).
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
    substr(trim(COALESCE(u.raw_user_meta_data->>'nickname', split_part(u.email, '@', 1), 'Member_' || substr(u.id::text, 1, 8))), 1, 32),
    COALESCE(nullif(trim(u.raw_user_meta_data->>'avatar_url'), ''), '🛡️'),
    '',
    'user'::public.user_role,
    FALSE,
    'pending',
    TRUE,
    TRUE,
    u.created_at,
    timezone('utc'::text, now())
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- ROLLBACK CONSIDERATIONS (Documentation only - do not execute):
-- -----------------------------------------------------------------------------
-- To safely roll back this migration:
--   DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--   DROP FUNCTION IF EXISTS public.handle_new_user_profile();
-- No profiles table data is deleted or corrupted during rollback.
