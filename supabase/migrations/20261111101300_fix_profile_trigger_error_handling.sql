-- =============================================================================
-- CHATLUSTORA / VOXANEX — SECURE REGISTRATION & PROFILE INITIALIZATION FIX
-- Migration: 20261111101300_fix_profile_trigger_error_handling.sql
-- Description: Corrects handle_new_user_profile() trigger error handling to prevent
--              silent failure swallowing, ensuring registration fails transactionally
--              if profile creation fails. Applies unified nickname fallbacks and
--              preserves role hardening and privilege revocation.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. UPDATE SECURE PROFILE INITIALIZATION FUNCTION
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
    -- Extract and sanitize nickname from user metadata, using nullif for whitespace-only strings
    v_nickname := trim(COALESCE(nullif(trim(NEW.raw_user_meta_data->>'nickname'), ''), split_part(NEW.email, '@', 1), 'Member_' || substr(NEW.id::text, 1, 8)));
    
    -- Ensure nickname strictly respects VARCHAR(32) length constraint
    v_nickname := substr(v_nickname, 1, 32);

    -- Extract avatar with safe platform default
    v_avatar := trim(COALESCE(nullif(trim(NEW.raw_user_meta_data->>'avatar_url'), ''), '🛡️'));

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
    -- Note: EXCEPTION block omitted intentionally so that unexpected database errors
    -- cause transaction abort, preventing Auth user creation without a corresponding profile.
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. PRIVILEGE HARDENING
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user_policy() FROM PUBLIC; -- Safe if present
REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM authenticated;

-- -----------------------------------------------------------------------------
-- 3. UNIFIED IDEMPOTENT BACKFILL WITH IDENTICAL FALLBACKS
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
    substr(trim(COALESCE(nullif(trim(u.raw_user_meta_data->>'nickname'), ''), split_part(u.email, '@', 1), 'Member_' || substr(u.id::text, 1, 8))), 1, 32),
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
