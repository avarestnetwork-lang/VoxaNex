-- ============================================================================
-- Migration: Repair & Expand public.media_uploads Schema for All Chat Media
-- File: supabase/migrations/20261122000001_repair_media_uploads_schema.sql
-- Forward-only, idempotent migration:
--   1. Ensures public.media_uploads exists with all expected columns
--   2. Repairs/updates CHECK constraints on file_size_bytes (1..10MB) & mime_type
--      to allow Images, Video (MP4/WebM/MOV), Audio, and Documents (PDF/TXT/CSV/DOCX/XLSX/PPTX)
--   3. Hardens table security:
--      - Enables Row Level Security (RLS)
--      - Drops legacy public-facing policy ("Users can view valid media")
--      - Creates no replacement public SELECT policy
--      - Revokes all privileges from PUBLIC, anon, and authenticated
--      - Grants only SELECT and INSERT to service_role (Cloudflare Worker backend)
--   4. Prompts PostgREST to reload its schema cache
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.media_uploads (
    id TEXT PRIMARY KEY DEFAULT ('med_' || floor(extract(epoch from now())) || '_' || substr(md5(random()::text), 1, 8)),
    uploader_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    media_url TEXT NOT NULL,
    is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.media_uploads
    ADD COLUMN IF NOT EXISTS uploader_id TEXT,
    ADD COLUMN IF NOT EXISTS file_name TEXT,
    ADD COLUMN IF NOT EXISTS file_size_bytes INTEGER,
    ADD COLUMN IF NOT EXISTS mime_type TEXT,
    ADD COLUMN IF NOT EXISTS media_url TEXT,
    ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Drop legacy anonymous or named CHECK constraints on file_size_bytes and mime_type safely
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'public'
          AND t.relname = 'media_uploads'
          AND c.contype = 'c'
          AND (
              pg_get_constraintdef(c.oid) ILIKE '%file_size_bytes%'
              OR pg_get_constraintdef(c.oid) ILIKE '%mime_type%'
              OR c.conname IN ('chk_media_uploads_file_size', 'chk_media_uploads_mime_type')
          )
    LOOP
        EXECUTE format('ALTER TABLE public.media_uploads DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;
END
$$;

ALTER TABLE public.media_uploads
    ADD CONSTRAINT chk_media_uploads_file_size
    CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760);

ALTER TABLE public.media_uploads
    ADD CONSTRAINT chk_media_uploads_mime_type
    CHECK (
        mime_type IN (
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/gif',
            'video/mp4',
            'video/webm',
            'video/quicktime',
            'audio/webm',
            'audio/ogg',
            'audio/mp3',
            'audio/wav',
            'application/pdf',
            'text/plain',
            'text/csv',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        )
    );

CREATE INDEX IF NOT EXISTS idx_media_uploads_uploader
    ON public.media_uploads(uploader_id);

CREATE INDEX IF NOT EXISTS idx_media_uploads_created_at
    ON public.media_uploads(created_at DESC);

-- ----------------------------------------------------------------------------
-- Row Level Security & Explicit Privilege Hardening
-- ----------------------------------------------------------------------------
-- 1. Ensure Row Level Security is enabled on public.media_uploads
ALTER TABLE public.media_uploads ENABLE ROW LEVEL SECURITY;

-- 2. Drop the legacy public-facing policy if previously applied
--    Browser clients MUST NOT have direct access to media metadata.
DROP POLICY IF EXISTS "Users can view valid media" ON public.media_uploads;

-- 3. Revoke all table privileges from PUBLIC, anon, and authenticated roles
REVOKE ALL PRIVILEGES ON TABLE public.media_uploads FROM PUBLIC, anon, authenticated;

-- 4. Grant only SELECT and INSERT privileges exclusively to service_role
--    Used by the Cloudflare Worker server-side backend for upload insertion,
--    metadata retrieval verification, and moderation-status lookup.
GRANT SELECT, INSERT ON TABLE public.media_uploads TO service_role;

-- ----------------------------------------------------------------------------
-- PostgREST Schema Cache Reload
-- ----------------------------------------------------------------------------
-- Instruct PostgREST to reload its schema cache immediately after applying migration
NOTIFY pgrst, 'reload schema';
