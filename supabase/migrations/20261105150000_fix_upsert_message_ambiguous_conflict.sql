-- =============================================================================
-- VOXANEX DATABASE SCHEMA - AMBIGUOUS CONFLICT COLUMN RESOLUTION
-- Migration: 20261105150000_fix_upsert_message_ambiguous_conflict.sql
-- Description: Adds #variable_conflict use_column directive to upsert_message to
--              resolve PL/pgSQL output variable vs column name ambiguity (42702)
--              in ON CONFLICT clauses.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.upsert_message(
    p_id UUID,
    p_room_id UUID DEFAULT NULL,
    p_conversation_id UUID DEFAULT NULL,
    p_sender_user_id UUID DEFAULT NULL,
    p_sender_guest_id UUID DEFAULT NULL,
    p_sender_nickname VARCHAR(32) DEFAULT NULL,
    p_sender_avatar TEXT DEFAULT '💬',
    p_content TEXT DEFAULT NULL,
    p_client_nonce VARCHAR(64) DEFAULT NULL,
    p_media_url TEXT DEFAULT NULL,
    p_media_type VARCHAR(16) DEFAULT NULL,
    p_link_preview JSONB DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    room_id UUID,
    conversation_id UUID,
    sender_user_id UUID,
    sender_guest_id UUID,
    sender_nickname VARCHAR(32),
    sender_avatar TEXT,
    content TEXT,
    is_system BOOLEAN,
    is_flagged BOOLEAN,
    client_nonce VARCHAR(64),
    media_url TEXT,
    media_type VARCHAR(16),
    link_preview JSONB,
    created_at TIMESTAMPTZ,
    inserted BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
    v_role TEXT;
BEGIN
    -- Authorization check: Only allow service_role to execute this privileged atomic op
    BEGIN
        v_role := coalesce(
            nullif(current_setting('request.jwt.claim.role', true), ''),
            nullif(current_setting('role', true), ''),
            session_user
        );
    EXCEPTION WHEN OTHERS THEN
        v_role := session_user;
    END;

    IF v_role <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized: upsert_message can only be called by service_role.';
    END IF;

    -- 1. Validate mutually exclusive target: exactly one of room_id or conversation_id
    IF (p_room_id IS NULL AND p_conversation_id IS NULL) OR (p_room_id IS NOT NULL AND p_conversation_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Invalid target: exactly one of room_id or conversation_id must be provided.';
    END IF;

    -- 2. Validate mutually exclusive sender identity: exactly one of sender_user_id or sender_guest_id
    IF (p_sender_user_id IS NULL AND p_sender_guest_id IS NULL) OR (p_sender_user_id IS NOT NULL AND p_sender_guest_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Invalid sender: exactly one of sender_user_id or sender_guest_id must be provided.';
    END IF;

    -- 3. Validate message content and media
    IF (p_content IS NULL OR length(trim(p_content)) = 0) AND 
       (p_media_url IS NULL OR length(trim(p_media_url)) = 0) THEN
        RAISE EXCEPTION 'Message content or media URL is required.';
    END IF;

    IF p_content IS NOT NULL AND length(p_content) > 2000 THEN
        RAISE EXCEPTION 'Message content exceeds 2000 characters.';
    END IF;

    -- 4. Validate client_nonce length
    IF p_client_nonce IS NOT NULL AND length(p_client_nonce) > 64 THEN
        RAISE EXCEPTION 'Client nonce exceeds 64 characters.';
    END IF;

    -- 5. Validate sender nickname
    IF p_sender_nickname IS NULL OR length(trim(p_sender_nickname)) = 0 THEN
        RAISE EXCEPTION 'Sender nickname cannot be empty.';
    END IF;

    -- PATH A: Public Room Message
    IF p_room_id IS NOT NULL THEN
        -- Subpath A1: Registered User
        IF p_sender_user_id IS NOT NULL THEN
            IF p_client_nonce IS NOT NULL THEN
                RETURN QUERY
                INSERT INTO public.messages (
                    id, room_id, conversation_id, sender_user_id, sender_guest_id,
                    sender_nickname, sender_avatar, content, client_nonce,
                    media_url, media_type, link_preview
                )
                VALUES (
                    p_id, p_room_id, NULL, p_sender_user_id, NULL,
                    p_sender_nickname, coalesce(p_sender_avatar, '💬'), coalesce(p_content, ''), p_client_nonce,
                    p_media_url, p_media_type, p_link_preview
                )
                ON CONFLICT (room_id, sender_user_id, client_nonce)
                WHERE room_id IS NOT NULL AND sender_user_id IS NOT NULL AND client_nonce IS NOT NULL
                DO NOTHING
                RETURNING 
                    public.messages.id, public.messages.room_id, public.messages.conversation_id,
                    public.messages.sender_user_id, public.messages.sender_guest_id,
                    public.messages.sender_nickname, public.messages.sender_avatar,
                    public.messages.content, public.messages.is_system, public.messages.is_flagged,
                    public.messages.client_nonce, public.messages.media_url, public.messages.media_type,
                    public.messages.link_preview, public.messages.created_at,
                    TRUE AS inserted;

                IF NOT FOUND THEN
                    RETURN QUERY
                    SELECT 
                        m.id, m.room_id, m.conversation_id,
                        m.sender_user_id, m.sender_guest_id,
                        m.sender_nickname, m.sender_avatar,
                        m.content, m.is_system, m.is_flagged,
                        m.client_nonce, m.media_url, m.media_type,
                        m.link_preview, m.created_at,
                        FALSE AS inserted
                    FROM public.messages m
                    WHERE m.room_id = p_room_id
                      AND m.sender_user_id = p_sender_user_id
                      AND m.client_nonce = p_client_nonce
                    ORDER BY m.created_at ASC
                    LIMIT 1;
                END IF;
            ELSE
                RETURN QUERY
                INSERT INTO public.messages (
                    id, room_id, conversation_id, sender_user_id, sender_guest_id,
                    sender_nickname, sender_avatar, content, client_nonce,
                    media_url, media_type, link_preview
                )
                VALUES (
                    p_id, p_room_id, NULL, p_sender_user_id, NULL,
                    p_sender_nickname, coalesce(p_sender_avatar, '💬'), coalesce(p_content, ''), NULL,
                    p_media_url, p_media_type, p_link_preview
                )
                RETURNING 
                    public.messages.id, public.messages.room_id, public.messages.conversation_id,
                    public.messages.sender_user_id, public.messages.sender_guest_id,
                    public.messages.sender_nickname, public.messages.sender_avatar,
                    public.messages.content, public.messages.is_system, public.messages.is_flagged,
                    public.messages.client_nonce, public.messages.media_url, public.messages.media_type,
                    public.messages.link_preview, public.messages.created_at,
                    TRUE AS inserted;
            END IF;

        -- Subpath A2: Guest User
        ELSE
            IF p_client_nonce IS NOT NULL THEN
                RETURN QUERY
                INSERT INTO public.messages (
                    id, room_id, conversation_id, sender_user_id, sender_guest_id,
                    sender_nickname, sender_avatar, content, client_nonce,
                    media_url, media_type, link_preview
                )
                VALUES (
                    p_id, p_room_id, NULL, NULL, p_sender_guest_id,
                    p_sender_nickname, coalesce(p_sender_avatar, '💬'), coalesce(p_content, ''), p_client_nonce,
                    p_media_url, p_media_type, p_link_preview
                )
                ON CONFLICT (room_id, sender_guest_id, client_nonce)
                WHERE room_id IS NOT NULL AND sender_guest_id IS NOT NULL AND client_nonce IS NOT NULL
                DO NOTHING
                RETURNING 
                    public.messages.id, public.messages.room_id, public.messages.conversation_id,
                    public.messages.sender_user_id, public.messages.sender_guest_id,
                    public.messages.sender_nickname, public.messages.sender_avatar,
                    public.messages.content, public.messages.is_system, public.messages.is_flagged,
                    public.messages.client_nonce, public.messages.media_url, public.messages.media_type,
                    public.messages.link_preview, public.messages.created_at,
                    TRUE AS inserted;

                IF NOT FOUND THEN
                    RETURN QUERY
                    SELECT 
                        m.id, m.room_id, m.conversation_id,
                        m.sender_user_id, m.sender_guest_id,
                        m.sender_nickname, m.sender_avatar,
                        m.content, m.is_system, m.is_flagged,
                        m.client_nonce, m.media_url, m.media_type,
                        m.link_preview, m.created_at,
                        FALSE AS inserted
                    FROM public.messages m
                    WHERE m.room_id = p_room_id
                      AND m.sender_guest_id = p_sender_guest_id
                      AND m.client_nonce = p_client_nonce
                    ORDER BY m.created_at ASC
                    LIMIT 1;
                END IF;
            ELSE
                RETURN QUERY
                INSERT INTO public.messages (
                    id, room_id, conversation_id, sender_user_id, sender_guest_id,
                    sender_nickname, sender_avatar, content, client_nonce,
                    media_url, media_type, link_preview
                )
                VALUES (
                    p_id, p_room_id, NULL, NULL, p_sender_guest_id,
                    p_sender_nickname, coalesce(p_sender_avatar, '💬'), coalesce(p_content, ''), NULL,
                    p_media_url, p_media_type, p_link_preview
                )
                RETURNING 
                    public.messages.id, public.messages.room_id, public.messages.conversation_id,
                    public.messages.sender_user_id, public.messages.sender_guest_id,
                    public.messages.sender_nickname, public.messages.sender_avatar,
                    public.messages.content, public.messages.is_system, public.messages.is_flagged,
                    public.messages.client_nonce, public.messages.media_url, public.messages.media_type,
                    public.messages.link_preview, public.messages.created_at,
                    TRUE AS inserted;
            END IF;
        END IF;

    -- PATH B: Private Conversation Message
    ELSE
        -- Subpath B1: Registered User
        IF p_sender_user_id IS NOT NULL THEN
            IF p_client_nonce IS NOT NULL THEN
                RETURN QUERY
                INSERT INTO public.messages (
                    id, room_id, conversation_id, sender_user_id, sender_guest_id,
                    sender_nickname, sender_avatar, content, client_nonce,
                    media_url, media_type, link_preview
                )
                VALUES (
                    p_id, NULL, p_conversation_id, p_sender_user_id, NULL,
                    p_sender_nickname, coalesce(p_sender_avatar, '💬'), coalesce(p_content, ''), p_client_nonce,
                    p_media_url, p_media_type, p_link_preview
                )
                ON CONFLICT (conversation_id, sender_user_id, client_nonce)
                WHERE conversation_id IS NOT NULL AND sender_user_id IS NOT NULL AND client_nonce IS NOT NULL
                DO NOTHING
                RETURNING 
                    public.messages.id, public.messages.room_id, public.messages.conversation_id,
                    public.messages.sender_user_id, public.messages.sender_guest_id,
                    public.messages.sender_nickname, public.messages.sender_avatar,
                    public.messages.content, public.messages.is_system, public.messages.is_flagged,
                    public.messages.client_nonce, public.messages.media_url, public.messages.media_type,
                    public.messages.link_preview, public.messages.created_at,
                    TRUE AS inserted;

                IF NOT FOUND THEN
                    RETURN QUERY
                    SELECT 
                        m.id, m.room_id, m.conversation_id,
                        m.sender_user_id, m.sender_guest_id,
                        m.sender_nickname, m.sender_avatar,
                        m.content, m.is_system, m.is_flagged,
                        m.client_nonce, m.media_url, m.media_type,
                        m.link_preview, m.created_at,
                        FALSE AS inserted
                    FROM public.messages m
                    WHERE m.conversation_id = p_conversation_id
                      AND m.sender_user_id = p_sender_user_id
                      AND m.client_nonce = p_client_nonce
                    ORDER BY m.created_at ASC
                    LIMIT 1;
                END IF;
            ELSE
                RETURN QUERY
                INSERT INTO public.messages (
                    id, room_id, conversation_id, sender_user_id, sender_guest_id,
                    sender_nickname, sender_avatar, content, client_nonce,
                    media_url, media_type, link_preview
                )
                VALUES (
                    p_id, NULL, p_conversation_id, p_sender_user_id, NULL,
                    p_sender_nickname, coalesce(p_sender_avatar, '💬'), coalesce(p_content, ''), NULL,
                    p_media_url, p_media_type, p_link_preview
                )
                RETURNING 
                    public.messages.id, public.messages.room_id, public.messages.conversation_id,
                    public.messages.sender_user_id, public.messages.sender_guest_id,
                    public.messages.sender_nickname, public.messages.sender_avatar,
                    public.messages.content, public.messages.is_system, public.messages.is_flagged,
                    public.messages.client_nonce, public.messages.media_url, public.messages.media_type,
                    public.messages.link_preview, public.messages.created_at,
                    TRUE AS inserted;
            END IF;

        -- Subpath B2: Guest User
        ELSE
            IF p_client_nonce IS NOT NULL THEN
                RETURN QUERY
                INSERT INTO public.messages (
                    id, room_id, conversation_id, sender_user_id, sender_guest_id,
                    sender_nickname, sender_avatar, content, client_nonce,
                    media_url, media_type, link_preview
                )
                VALUES (
                    p_id, NULL, p_conversation_id, NULL, p_sender_guest_id,
                    p_sender_nickname, coalesce(p_sender_avatar, '💬'), coalesce(p_content, ''), p_client_nonce,
                    p_media_url, p_media_type, p_link_preview
                )
                ON CONFLICT (conversation_id, sender_guest_id, client_nonce)
                WHERE conversation_id IS NOT NULL AND sender_guest_id IS NOT NULL AND client_nonce IS NOT NULL
                DO NOTHING
                RETURNING 
                    public.messages.id, public.messages.room_id, public.messages.conversation_id,
                    public.messages.sender_user_id, public.messages.sender_guest_id,
                    public.messages.sender_nickname, public.messages.sender_avatar,
                    public.messages.content, public.messages.is_system, public.messages.is_flagged,
                    public.messages.client_nonce, public.messages.media_url, public.messages.media_type,
                    public.messages.link_preview, public.messages.created_at,
                    TRUE AS inserted;

                IF NOT FOUND THEN
                    RETURN QUERY
                    SELECT 
                        m.id, m.room_id, m.conversation_id,
                        m.sender_user_id, m.sender_guest_id,
                        m.sender_nickname, m.sender_avatar,
                        m.content, m.is_system, m.is_flagged,
                        m.client_nonce, m.media_url, m.media_type,
                        m.link_preview, m.created_at,
                        FALSE AS inserted
                    FROM public.messages m
                    WHERE m.conversation_id = p_conversation_id
                      AND m.sender_guest_id = p_sender_guest_id
                      AND m.client_nonce = p_client_nonce
                    ORDER BY m.created_at ASC
                    LIMIT 1;
                END IF;
            ELSE
                RETURN QUERY
                INSERT INTO public.messages (
                    id, room_id, conversation_id, sender_user_id, sender_guest_id,
                    sender_nickname, sender_avatar, content, client_nonce,
                    media_url, media_type, link_preview
                )
                VALUES (
                    p_id, NULL, p_conversation_id, NULL, p_sender_guest_id,
                    p_sender_nickname, coalesce(p_sender_avatar, '💬'), coalesce(p_content, ''), NULL,
                    p_media_url, p_media_type, p_link_preview
                )
                RETURNING 
                    public.messages.id, public.messages.room_id, public.messages.conversation_id,
                    public.messages.sender_user_id, public.messages.sender_guest_id,
                    public.messages.sender_nickname, public.messages.sender_avatar,
                    public.messages.content, public.messages.is_system, public.messages.is_flagged,
                    public.messages.client_nonce, public.messages.media_url, public.messages.media_type,
                    public.messages.link_preview, public.messages.created_at,
                    TRUE AS inserted;
            END IF;
        END IF;
    END IF;
END;
$$;

-- Restrict EXECUTE privileges strictly to service_role
REVOKE ALL ON FUNCTION public.upsert_message(UUID, UUID, UUID, UUID, UUID, VARCHAR, TEXT, TEXT, VARCHAR, TEXT, VARCHAR, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_message(UUID, UUID, UUID, UUID, UUID, VARCHAR, TEXT, TEXT, VARCHAR, TEXT, VARCHAR, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.upsert_message(UUID, UUID, UUID, UUID, UUID, VARCHAR, TEXT, TEXT, VARCHAR, TEXT, VARCHAR, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_message(UUID, UUID, UUID, UUID, UUID, VARCHAR, TEXT, TEXT, VARCHAR, TEXT, VARCHAR, JSONB) TO service_role;
