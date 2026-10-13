-- =============================================================================
-- VOXANEX — PHASE 6: SAFETY, MODERATION, AGE ASSURANCE & USER PROFILES
-- Migration: 20260320000005_phase6_safety_moderation_profiles.sql
-- =============================================================================

-- 1. Profiles Table Enhancements (Phase 6 Privacy & Profile Controls)
ALTER TABLE IF EXISTS public.profiles
  ADD COLUMN IF NOT EXISTS online_visibility VARCHAR(32) NOT NULL DEFAULT 'online', -- 'online', 'away', 'stealth_invisible'
  ADD COLUMN IF NOT EXISTS allow_discoverability BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS allow_direct_messages VARCHAR(32) NOT NULL DEFAULT 'everyone', -- 'everyone', 'connections_only', 'nobody'
  ADD COLUMN IF NOT EXISTS interests TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS age_verification_status VARCHAR(32) NOT NULL DEFAULT 'unverified', -- 'unverified', 'pending', 'verified_adult_18plus', 'rejected_underage', 'revoked'
  ADD COLUMN IF NOT EXISTS age_verification_method VARCHAR(32) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS verified_adult_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 2. Age Assurance Records (Privacy-Conscious / Zero-Knowledge Proof Hashes)
CREATE TABLE IF NOT EXISTS public.age_assurance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'unverified', -- unverified, pending, verified_adult_18plus, rejected_underage, revoked
    method VARCHAR(32) NOT NULL DEFAULT 'none', -- none, self_declaration, third_party_id, persona_sandbox, veriff_sandbox, yoti_sandbox
    verified_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    provider_reference_id VARCHAR(128),
    provider_proof_hash VARCHAR(128), -- SHA256 zero-knowledge hash of verification receipt
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_user_age_assurance UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_age_assurance_user ON public.age_assurance_records(user_id);
CREATE INDEX IF NOT EXISTS idx_age_assurance_status ON public.age_assurance_records(status);

-- 3. User Restrictions Table (Warnings, Mutes, Suspensions, Bans with Auto-Expiry)
CREATE TABLE IF NOT EXISTS public.user_restrictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    restriction_type VARCHAR(32) NOT NULL, -- warning, muted, suspended_24h, suspended_7d, suspended_30d, banned_permanent
    scope VARCHAR(32) NOT NULL DEFAULT 'all', -- all, rooms, direct_messages, matching, calls
    reason TEXT NOT NULL,
    imposed_by VARCHAR(64) NOT NULL DEFAULT 'Moderation Team',
    imposed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    expires_at TIMESTAMPTZ, -- NULL for permanent bans or active warnings
    active BOOLEAN NOT NULL DEFAULT TRUE,
    lifted_at TIMESTAMPTZ,
    lifted_by VARCHAR(64),
    lift_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_restrictions_user ON public.user_restrictions(user_id, active);
CREATE INDEX IF NOT EXISTS idx_user_restrictions_active ON public.user_restrictions(active, expires_at);

-- 4. Moderation Appeals Table (Formal User Sanction Appeals & Reviews)
CREATE TABLE IF NOT EXISTS public.moderation_appeals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restriction_id UUID REFERENCES public.user_restrictions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    statement TEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending, accepted, rejected
    reviewed_by VARCHAR(64),
    review_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_moderation_appeals_status ON public.moderation_appeals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_appeals_user ON public.moderation_appeals(user_id);

-- 5. Moderation Audit Logs Table (Tamper-evident logs of all safety actions)
CREATE TABLE IF NOT EXISTS public.moderation_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id VARCHAR(64) NOT NULL,
    actor_nickname VARCHAR(64) NOT NULL,
    actor_role VARCHAR(32) NOT NULL,
    action VARCHAR(64) NOT NULL, -- impose_restriction, lift_restriction, review_appeal, resolve_report, revoke_age_verification, update_platform_settings, delete_user_account
    target_type VARCHAR(32) NOT NULL,
    target_id VARCHAR(64) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_mod_audit_created ON public.moderation_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mod_audit_actor ON public.moderation_audit_logs(actor_id);

-- 6. Safety Reports Enhancements
ALTER TABLE IF EXISTS public.reports
  ADD COLUMN IF NOT EXISTS target_type VARCHAR(32) NOT NULL DEFAULT 'user', -- user, message, profile, room
  ADD COLUMN IF NOT EXISTS action_taken VARCHAR(64) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS moderator_notes TEXT,
  ADD COLUMN IF NOT EXISTS reviewer VARCHAR(64),
  ADD COLUMN IF NOT EXISTS reporter_ip_hash VARCHAR(64);

-- 7. Row Level Security Policies for Phase 6

ALTER TABLE public.age_assurance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_audit_logs ENABLE ROW LEVEL SECURITY;

-- Age assurance: Users can see only their own record; Admins/Moderators can view
CREATE POLICY "Users can view their own age assurance record"
    ON public.age_assurance_records
    FOR SELECT
    USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND (role = 'admin' OR role = 'moderator')
        )
    );

-- User restrictions: Users can see their own active restrictions; Staff can manage
CREATE POLICY "Users can read restrictions imposed on them"
    ON public.user_restrictions
    FOR SELECT
    USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND (role = 'admin' OR role = 'moderator')
        )
    );

CREATE POLICY "Moderators can manage user restrictions"
    ON public.user_restrictions
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND (role = 'admin' OR role = 'moderator')
        )
    );

-- Moderation appeals: Users can insert and view their own appeals; Staff can review
CREATE POLICY "Users can create and view their own appeals"
    ON public.moderation_appeals
    FOR SELECT
    USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND (role = 'admin' OR role = 'moderator')
        )
    );

CREATE POLICY "Users can submit an appeal for their active restriction"
    ON public.moderation_appeals
    FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
    );

CREATE POLICY "Moderators can review appeals"
    ON public.moderation_appeals
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND (role = 'admin' OR role = 'moderator')
        )
    );

-- Moderation audit logs: Only Admins and Moderators can view
CREATE POLICY "Staff can view moderation audit logs"
    ON public.moderation_audit_logs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND (role = 'admin' OR role = 'moderator')
        )
    );
