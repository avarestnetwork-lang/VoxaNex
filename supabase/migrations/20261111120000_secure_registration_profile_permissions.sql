-- Secure registered-profile initialization and least-privilege profile access.
-- Reviewed against the supplied read-only catalogs for production and staging:
-- profiles has the core 12-column shape, UUID id -> auth.users(id), non-null
-- nickname, public.user_role defaulting to 'user', RLS enabled, and no existing
-- application policies or profile/auth-user triggers. Apply separately to each
-- environment after confirming these preconditions still hold.

DO $preflight$
BEGIN
    IF EXISTS (
        SELECT required.column_name
        FROM (VALUES
            ('id'), ('nickname'), ('avatar_url'), ('bio'), ('role'),
            ('is_18_verified'), ('verified_at'), ('verification_method'),
            ('safe_filter_enabled'), ('notification_sounds'), ('created_at'), ('updated_at')
        ) AS required(column_name)
        WHERE NOT EXISTS (
            SELECT 1
            FROM information_schema.columns c
            WHERE c.table_schema = 'public'
              AND c.table_name = 'profiles'
              AND c.column_name = required.column_name
        )
    ) THEN
        RAISE EXCEPTION 'profiles is missing one or more columns required by the reviewed application contract';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'id'
          AND data_type = 'uuid'
          AND is_nullable = 'NO'
    ) OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'nickname'
          AND data_type = 'character varying'
          AND is_nullable = 'NO'
    ) OR NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'role'
          AND udt_schema = 'public'
          AND udt_name = 'user_role'
          AND column_default LIKE '%user%'
    ) THEN
        RAISE EXCEPTION 'profiles schema does not match the reviewed registration migration preflight';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_type t
        JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname = 'public'
          AND t.typname = 'user_role'
          AND e.enumlabel = 'user'
    ) THEN
        RAISE EXCEPTION 'public.user_role is missing the required user label';
    END IF;

    IF (
        SELECT pg_catalog.array_agg(e.enumlabel ORDER BY e.enumsortorder)
        FROM pg_catalog.pg_type t
        JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname = 'public' AND t.typname = 'user_role'
    ) IS DISTINCT FROM ARRAY['user', 'moderator', 'admin']::text[] THEN
        RAISE EXCEPTION 'public.user_role labels differ from the reviewed application contract';
    END IF;

    IF EXISTS (
        SELECT required.column_name
        FROM (VALUES
            ('avatar_url'), ('bio'), ('role'), ('is_18_verified'), ('verified_at'),
            ('verification_method'), ('safe_filter_enabled'), ('notification_sounds'),
            ('created_at'), ('updated_at')
        ) AS required(column_name)
        JOIN information_schema.columns c
          ON c.table_schema = 'public'
         AND c.table_name = 'profiles'
         AND c.column_name = required.column_name
        WHERE c.column_default IS NULL AND c.is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'an omitted profile column is NOT NULL without a database default';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint c
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = c.conrelid AND a.attname = 'id'
        WHERE c.conrelid = 'public.profiles'::regclass
          AND c.contype = 'p'
          AND c.conkey = ARRAY[a.attnum]::smallint[]
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint c
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = c.conrelid AND a.attname = 'id'
        WHERE c.conrelid = 'public.profiles'::regclass
          AND c.contype = 'f'
          AND c.conkey = ARRAY[a.attnum]::smallint[]
          AND c.confrelid = 'auth.users'::regclass
          AND c.confdeltype = 'c'
    ) THEN
        RAISE EXCEPTION 'profiles id primary key or auth.users cascade foreign key differs from the reviewed schema';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policy p
        WHERE p.polrelid = 'public.profiles'::regclass
          AND p.polname <> 'profiles_select_own'
    ) THEN
        RAISE EXCEPTION 'profiles has an unreviewed policy; reconcile it before applying this migration';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = 'auth.users'::regclass
          AND NOT t.tgisinternal
          AND t.tgname <> 'trg_create_profile_for_auth_user'
    ) THEN
        RAISE EXCEPTION 'auth.users has an unreviewed application trigger; reconcile it before applying this migration';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = 'auth.users'::regclass
          AND NOT t.tgisinternal
          AND t.tgname = 'trg_create_profile_for_auth_user'
          AND t.tgfoid IS DISTINCT FROM pg_catalog.to_regprocedure('public.create_profile_for_auth_user()')::oid
    ) THEN
        RAISE EXCEPTION 'the profile trigger name is already bound to an unexpected function';
    END IF;

    IF pg_catalog.to_regprocedure('public.create_profile_for_auth_user()') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM pg_catalog.pg_trigger t
           WHERE t.tgrelid = 'auth.users'::regclass
             AND NOT t.tgisinternal
             AND t.tgname = 'trg_create_profile_for_auth_user'
             AND t.tgfoid = pg_catalog.to_regprocedure('public.create_profile_for_auth_user()')::oid
       ) THEN
        RAISE EXCEPTION 'an unreviewed profile-creation function already exists';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid = 'public.profiles'::regclass
          AND NOT t.tgisinternal
    ) THEN
        RAISE EXCEPTION 'profiles has an unreviewed application trigger; reconcile it before applying this migration';
    END IF;
END;
$preflight$;

-- The trigger function is restricted to auth.users row creation. SECURITY
-- DEFINER is required because callers cannot INSERT into profiles under RLS;
-- its trusted owner is postgres, search_path is empty, and all objects are
-- schema-qualified. It is not exposed as a client-callable RPC.
CREATE OR REPLACE FUNCTION public.create_profile_for_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    profile_nickname text;
BEGIN
    profile_nickname := pg_catalog.left(
        pg_catalog.btrim(COALESCE(NEW.raw_user_meta_data ->> 'nickname', '')),
        32
    );

    IF profile_nickname = '' THEN
        profile_nickname := pg_catalog.left(
            pg_catalog.btrim(pg_catalog.split_part(COALESCE(NEW.email, ''), '@', 1)),
            32
        );
    END IF;

    IF profile_nickname = '' THEN
        profile_nickname := 'User';
    END IF;

    INSERT INTO public.profiles (id, nickname)
    VALUES (NEW.id, profile_nickname)
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.create_profile_for_auth_user() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_profile_for_auth_user()
    FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_create_profile_for_auth_user ON auth.users;
CREATE TRIGGER trg_create_profile_for_auth_user
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.create_profile_for_auth_user();

-- RLS stays enabled. Only authenticated users may select the UI's own-profile
-- projection; anonymous reads and client profile writes remain revoked.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE SELECT (
    id, nickname, avatar_url, bio, role, is_18_verified, verified_at,
    verification_method, safe_filter_enabled, notification_sounds, created_at, updated_at
) ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE INSERT (
    id, nickname, avatar_url, bio, role, is_18_verified, verified_at,
    verification_method, safe_filter_enabled, notification_sounds, created_at, updated_at
) ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (
    id, nickname, avatar_url, bio, role, is_18_verified, verified_at,
    verification_method, safe_filter_enabled, notification_sounds, created_at, updated_at
) ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE REFERENCES (
    id, nickname, avatar_url, bio, role, is_18_verified, verified_at,
    verification_method, safe_filter_enabled, notification_sounds, created_at, updated_at
) ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT (
    id,
    nickname,
    avatar_url,
    bio,
    is_18_verified,
    verified_at,
    verification_method,
    safe_filter_enabled,
    notification_sounds,
    created_at
) ON TABLE public.profiles TO authenticated;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
ON public.profiles
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = id);

-- The Worker PATCH endpoint is the only application update path. Normalize
-- service_role's UPDATE privilege to exactly the payload fields it writes.
REVOKE UPDATE ON TABLE public.profiles FROM service_role;
REVOKE UPDATE (
    id, nickname, avatar_url, bio, role, is_18_verified, verified_at,
    verification_method, safe_filter_enabled, notification_sounds, created_at, updated_at
) ON TABLE public.profiles FROM service_role;
GRANT UPDATE (
    nickname,
    bio,
    avatar_url,
    safe_filter_enabled,
    notification_sounds,
    updated_at
) ON TABLE public.profiles TO service_role;
