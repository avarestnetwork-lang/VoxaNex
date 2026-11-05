-- =============================================================================
-- VOXANEX DATABASE SCHEMA - ATOMIC IDEMPOTENCY & SECURE PERSISTENCE
-- Migration: 20261101000001_atomic_idempotency.sql
-- Description: Adds partial unique indexes for client_nonce and a privileged 
--              atomic upsert function for public room messages.
-- =============================================================================

-- 1. Create partial unique indexes for atomic idempotency
-- Handles registered and guest users separately to prevent cross-identity nonce collisions
-- These cover both public rooms (room_id) and direct conversations (conversation_id)

-- Registered Users
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_reg_room_nonce 
ON public.messages (room_id, sender_user_id, client_nonce)
WHERE room_id IS NOT NULL AND sender_user_id IS NOT NULL AND client_nonce IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_reg_conv_nonce 
ON public.messages (conversation_id, sender_user_id, client_nonce)
WHERE conversation_id IS NOT NULL AND sender_user_id IS NOT NULL AND client_nonce IS NOT NULL;

-- Guest Users
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_gst_room_nonce 
ON public.messages (room_id, sender_guest_id, client_nonce)
WHERE room_id IS NOT NULL AND sender_guest_id IS NOT NULL AND client_nonce IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_gst_conv_nonce 
ON public.messages (conversation_id, sender_guest_id, client_nonce)
WHERE conversation_id IS NOT NULL AND sender_guest_id IS NOT NULL AND client_nonce IS NOT NULL;

-- 2. Privileged atomic message persistence function
-- Uses ON CONFLICT to ensure exactly one row exists per (target, sender, nonce)
-- Returns the persisted row data.

CREATE OR REPLACE FUNCTION public.upsert_message(
    p_id UUID,
    p_room_id UUID,
    p_conversation_id UUID,
    p_sender_user_id UUID,
    p_sender_guest_id UUID,
    p_sender_nickname VARCHAR(32),
    p_sender_avatar TEXT,
    p_content TEXT,
    p_client_nonce VARCHAR(64)
)
RETURNS SETOF public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Authorization check: Only allow service_role to execute this privileged atomic op
    IF (SELECT current_setting('role')) <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized: upsert_message can only be called by service_role.';
    END IF;

    -- Handle Registered Users
    IF p_sender_user_id IS NOT NULL THEN
        RETURN QUERY
        INSERT INTO public.messages (
            id, room_id, conversation_id, sender_user_id, sender_guest_id, 
            sender_nickname, sender_avatar, content, client_nonce
        )
        VALUES (
            p_id, p_room_id, p_conversation_id, p_sender_user_id, p_sender_guest_id,
            p_sender_nickname, p_sender_avatar, p_content, p_client_nonce
        )
        ON CONFLICT (room_id, sender_user_id, client_nonce) WHERE room_id IS NOT NULL AND sender_user_id IS NOT NULL AND client_nonce IS NOT NULL
        DO UPDATE SET id = public.messages.id
        RETURNING *;

        -- If the above didn't return (e.g. it was a conversation conflict instead of room conflict)
        IF NOT FOUND AND p_conversation_id IS NOT NULL THEN
            RETURN QUERY
            INSERT INTO public.messages (
                id, room_id, conversation_id, sender_user_id, sender_guest_id, 
                sender_nickname, sender_avatar, content, client_nonce
            )
            VALUES (
                p_id, p_room_id, p_conversation_id, p_sender_user_id, p_sender_guest_id,
                p_sender_nickname, p_sender_avatar, p_content, p_client_nonce
            )
            ON CONFLICT (conversation_id, sender_user_id, client_nonce) WHERE conversation_id IS NOT NULL AND sender_user_id IS NOT NULL AND client_nonce IS NOT NULL
            DO UPDATE SET id = public.messages.id
            RETURNING *;
        END IF;
    
    -- Handle Guest Users
    ELSIF p_sender_guest_id IS NOT NULL THEN
        RETURN QUERY
        INSERT INTO public.messages (
            id, room_id, conversation_id, sender_user_id, sender_guest_id, 
            sender_nickname, sender_avatar, content, client_nonce
        )
        VALUES (
            p_id, p_room_id, p_conversation_id, p_sender_user_id, p_sender_guest_id,
            p_sender_nickname, p_sender_avatar, p_content, p_client_nonce
        )
        ON CONFLICT (room_id, sender_guest_id, client_nonce) WHERE room_id IS NOT NULL AND sender_guest_id IS NOT NULL AND client_nonce IS NOT NULL
        DO UPDATE SET id = public.messages.id
        RETURNING *;

        IF NOT FOUND AND p_conversation_id IS NOT NULL THEN
            RETURN QUERY
            INSERT INTO public.messages (
                id, room_id, conversation_id, sender_user_id, sender_guest_id, 
                sender_nickname, sender_avatar, content, client_nonce
            )
            VALUES (
                p_id, p_room_id, p_conversation_id, p_sender_user_id, p_sender_guest_id,
                p_sender_nickname, p_sender_avatar, p_content, p_client_nonce
            )
            ON CONFLICT (conversation_id, sender_guest_id, client_nonce) WHERE conversation_id IS NOT NULL AND sender_guest_id IS NOT NULL AND client_nonce IS NOT NULL
            DO UPDATE SET id = public.messages.id
            RETURNING *;
        END IF;
    END IF;
END;
$$;

-- 3. Restrict EXECUTE privileges
REVOKE ALL ON FUNCTION public.upsert_message FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_message FROM anon;
REVOKE ALL ON FUNCTION public.upsert_message FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_message TO service_role;
