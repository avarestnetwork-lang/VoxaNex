-- =============================================================================
-- VOXANEX DATABASE SCHEMA - PHASE 4 MATCHMAKING & PAIRING STATE
-- Migration: 20260320000003_phase4_matchmaking_schema.sql
-- Description: Queue tables, active matches, match history, and RLS policies
--              for server-owned anonymous matchmaking.
-- =============================================================================

-- 1. Matching queue table
CREATE TABLE IF NOT EXISTS public.matching_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    nickname VARCHAR(32) NOT NULL,
    avatar TEXT NOT NULL DEFAULT '⚡',
    is_guest BOOLEAN NOT NULL DEFAULT TRUE,
    language_pref VARCHAR(8) NOT NULL DEFAULT 'all', -- all, bn, en
    region_pool VARCHAR(16) NOT NULL DEFAULT 'bangladesh', -- bangladesh, international, any
    interests TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    is_18_verified BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(16) NOT NULL DEFAULT 'waiting', -- waiting, matched, cancelled, expired
    active_match_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_active_queue_user UNIQUE (user_id, status)
);

CREATE INDEX IF NOT EXISTS idx_matching_queue_status_pool
    ON public.matching_queue(status, region_pool, created_at ASC);

-- 2. Active matches table
CREATE TABLE IF NOT EXISTS public.active_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    participant_a_id TEXT NOT NULL,
    participant_b_id TEXT NOT NULL,
    participant_a_nickname VARCHAR(32) NOT NULL,
    participant_b_nickname VARCHAR(32) NOT NULL,
    region_pool VARCHAR(16) NOT NULL,
    shared_interests TEXT[] DEFAULT ARRAY[]::TEXT[],
    status VARCHAR(16) NOT NULL DEFAULT 'matched', -- matched, connected, disconnected
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    ended_at TIMESTAMPTZ,
    ended_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_active_matches_participants
    ON public.active_matches(participant_a_id, participant_b_id, status);

-- 3. Match history for analytics, abuse detection & rematch prevention
CREATE TABLE IF NOT EXISTS public.match_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL,
    user_a_id TEXT NOT NULL,
    user_b_id TEXT NOT NULL,
    duration_seconds INT DEFAULT 0,
    end_reason VARCHAR(32) DEFAULT 'normal_skip', -- normal_skip, timeout, report, disconnect
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_match_history_pair
    ON public.match_history(user_a_id, user_b_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.matching_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_history ENABLE ROW LEVEL SECURITY;

-- Matching queue policies:
-- Users can only view or cancel their own queue entries
CREATE POLICY "Users manage own matching queue entries"
ON public.matching_queue FOR ALL
USING (user_id = auth.uid()::text)
WITH CHECK (user_id = auth.uid()::text);

-- Active matches policies:
-- Only participants can view their active match
CREATE POLICY "Participants view own active match"
ON public.active_matches FOR SELECT
USING (participant_a_id = auth.uid()::text OR participant_b_id = auth.uid()::text);
