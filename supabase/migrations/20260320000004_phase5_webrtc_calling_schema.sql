-- =============================================================================
-- VOXANEX — PHASE 5: WEBRTC CALLING & MEDIA RELAY SCHEMA
-- Migration: 20260320000004_phase5_webrtc_calling_schema.sql
-- =============================================================================

-- Ensure call_sessions has full Phase 5 metadata and states
ALTER TABLE IF EXISTS public.call_sessions
  ADD COLUMN IF NOT EXISTS callee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS media_kind VARCHAR(16) NOT NULL DEFAULT 'video', -- 'audio' or 'video'
  ADD COLUMN IF NOT EXISTS signaling_state VARCHAR(32) NOT NULL DEFAULT 'initiated', -- initiated, ringing, accepted, active, rejected, missed, timed_out, ended
  ADD COLUMN IF NOT EXISTS ended_reason VARCHAR(64),
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER DEFAULT 0;

-- Signaling message exchange log for WebRTC negotiation audit
CREATE TABLE IF NOT EXISTS public.webrtc_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID NOT NULL REFERENCES public.call_sessions(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    signal_type VARCHAR(32) NOT NULL, -- offer, answer, ice_candidate, mute_state, hangup
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_webrtc_signals_call ON public.webrtc_signals(call_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_webrtc_signals_receiver ON public.webrtc_signals(receiver_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webrtc_signals ENABLE ROW LEVEL SECURITY;

-- Call session policies
CREATE POLICY "Users can view call sessions they participate in"
    ON public.call_sessions
    FOR SELECT
    USING (
        auth.uid() = initiator_id OR
        auth.uid() = callee_id
    );

CREATE POLICY "Users can create call sessions where they are the initiator"
    ON public.call_sessions
    FOR INSERT
    WITH CHECK (
        auth.uid() = initiator_id
    );

CREATE POLICY "Participants can update their call session"
    ON public.call_sessions
    FOR UPDATE
    USING (
        auth.uid() = initiator_id OR
        auth.uid() = callee_id
    );

-- WebRTC signals policies
CREATE POLICY "Participants can read their signaling messages"
    ON public.webrtc_signals
    FOR SELECT
    USING (
        auth.uid() = sender_id OR
        auth.uid() = receiver_id
    );

CREATE POLICY "Senders can write signaling messages"
    ON public.webrtc_signals
    FOR INSERT
    WITH CHECK (
        auth.uid() = sender_id
    );
