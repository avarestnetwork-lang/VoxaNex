-- =============================================================================
-- VOXANEX DATABASE SCHEMA - PHASE 3 REAL-TIME MESSAGING ENHANCEMENTS
-- Migration: 20260320000002_phase3_messaging_enhancements.sql
-- Description: Pagination indexes, content length constraints, duplicate
--              delivery prevention (client_nonce), and block enforcement.
-- =============================================================================

-- 1. Add content length check constraint on messages table
ALTER TABLE public.messages
    DROP CONSTRAINT IF EXISTS chk_message_content_length;

ALTER TABLE public.messages
    ADD CONSTRAINT chk_message_content_length
    CHECK (char_length(content) > 0 AND char_length(content) <= 2000);

-- 2. Add client nonce column for idempotency (deduplication on network retry)
ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS client_nonce VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_messages_client_nonce
    ON public.messages(client_nonce)
    WHERE client_nonce IS NOT NULL;

-- 3. Composite pagination indexes for fast cursor-based retrieval
CREATE INDEX IF NOT EXISTS idx_messages_room_pagination
    ON public.messages(room_id, created_at DESC)
    WHERE room_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conv_pagination
    ON public.messages(conversation_id, created_at DESC)
    WHERE conversation_id IS NOT NULL;

-- 4. Fast presence & room membership indexes
CREATE INDEX IF NOT EXISTS idx_room_members_presence
    ON public.room_members(room_id, last_seen_at DESC);

-- 5. RLS Policy: Prevent sending messages if recipient has blocked sender
-- Check function for peer block state
CREATE OR REPLACE FUNCTION public.can_send_to_conversation(p_conv_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    v_partner_id UUID;
BEGIN
    -- Check if sender is participant
    IF NOT public.is_conversation_member(p_conv_id) THEN
        RETURN FALSE;
    END IF;

    -- For 1-on-1 direct conversations, find partner
    SELECT user_id INTO v_partner_id
    FROM public.conversation_participants
    WHERE conversation_id = p_conv_id AND user_id <> auth.uid()
    LIMIT 1;

    -- If partner exists, verify neither has blocked the other
    IF v_partner_id IS NOT NULL THEN
        IF public.is_blocked_between(auth.uid(), v_partner_id) THEN
            RETURN FALSE;
        END IF;
    END IF;

    RETURN TRUE;
END;
$$;
