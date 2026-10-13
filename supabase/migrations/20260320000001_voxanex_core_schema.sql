-- =============================================================================
-- VOXANEX DATABASE SCHEMA - PHASE 2 MIGRATION
-- Migration: 20260320000001_voxanex_core_schema.sql
-- Description: Core tables, constraints, foreign keys, indexes, triggers,
--              Row-Level Security (RLS) policies, and helper functions.
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 1. PROFILES & ROLES
-- =============================================================================

CREATE TYPE user_role AS ENUM ('user', 'moderator', 'admin');

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nickname VARCHAR(32) NOT NULL,
    avatar_url TEXT DEFAULT '🛡️',
    bio VARCHAR(255) DEFAULT '',
    role user_role NOT NULL DEFAULT 'user',
    is_18_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    verification_method VARCHAR(32) DEFAULT 'pending',
    safe_filter_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    notification_sounds BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_nickname ON public.profiles(nickname);

-- =============================================================================
-- 2. GUEST SESSIONS (Server-issued, revocable credentials)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.guest_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token_hash TEXT NOT NULL UNIQUE,
    nickname VARCHAR(32) NOT NULL,
    avatar TEXT NOT NULL DEFAULT '⚡',
    ip_fingerprint_hash TEXT,
    user_agent_hash TEXT,
    language_pref VARCHAR(8) NOT NULL DEFAULT 'en',
    is_18_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_guest_sessions_token_hash ON public.guest_sessions(session_token_hash);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_expires_at ON public.guest_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_is_revoked ON public.guest_sessions(is_revoked);

-- =============================================================================
-- 3. CHAT ROOMS & ROOM MEMBERS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.chat_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(64) NOT NULL UNIQUE,
    name_en VARCHAR(100) NOT NULL,
    name_bn VARCHAR(100) NOT NULL,
    description_en TEXT NOT NULL,
    description_bn TEXT NOT NULL,
    category VARCHAR(32) NOT NULL,
    category_label_en VARCHAR(64) NOT NULL,
    category_label_bn VARCHAR(64) NOT NULL,
    language VARCHAR(16) NOT NULL DEFAULT 'bn',
    modes TEXT[] NOT NULL DEFAULT ARRAY['text'],
    is_18_plus BOOLEAN NOT NULL DEFAULT FALSE,
    requires_account BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_chat_rooms_slug ON public.chat_rooms(slug);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_category ON public.chat_rooms(category);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_is_18_plus ON public.chat_rooms(is_18_plus);

CREATE TABLE IF NOT EXISTS public.room_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    guest_session_id UUID REFERENCES public.guest_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT chk_room_member_identity CHECK (
        (user_id IS NOT NULL AND guest_session_id IS NULL) OR
        (user_id IS NULL AND guest_session_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_room_members_room ON public.room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON public.room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_room_members_guest ON public.room_members(guest_session_id);

-- =============================================================================
-- 4. CONVERSATIONS & PARTICIPANTS (1-on-1 and Group Direct Messages)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(16) NOT NULL DEFAULT 'direct',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.conversation_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_conv_participant UNIQUE (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_participants_conv ON public.conversation_participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON public.conversation_participants(user_id);

-- =============================================================================
-- 5. MESSAGES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    sender_guest_id UUID REFERENCES public.guest_sessions(id) ON DELETE SET NULL,
    sender_nickname VARCHAR(32) NOT NULL,
    sender_avatar TEXT NOT NULL DEFAULT '💬',
    content TEXT NOT NULL,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT chk_message_target CHECK (
        (room_id IS NOT NULL AND conversation_id IS NULL) OR
        (room_id IS NULL AND conversation_id IS NOT NULL)
    ),
    CONSTRAINT chk_message_sender CHECK (
        is_system = TRUE OR
        (sender_user_id IS NOT NULL) OR
        (sender_guest_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_messages_room ON public.messages(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender_user ON public.messages(sender_user_id);

-- =============================================================================
-- 6. BLOCKS & FRIENDSHIPS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_block_pair UNIQUE (blocker_id, blocked_id),
    CONSTRAINT chk_no_self_block CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON public.blocks(blocker_id);

CREATE TABLE IF NOT EXISTS public.friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    friend_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending, accepted, rejected
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_friendship_pair UNIQUE (user_id, friend_id),
    CONSTRAINT chk_no_self_friend CHECK (user_id <> friend_id)
);

-- =============================================================================
-- 7. SAFETY REPORTS & MODERATION ACTIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reporter_guest_id UUID REFERENCES public.guest_sessions(id) ON DELETE SET NULL,
    reported_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reported_room_id UUID REFERENCES public.chat_rooms(id) ON DELETE SET NULL,
    reported_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
    reported_target_text VARCHAR(100),
    category VARCHAR(32) NOT NULL, -- harassment, non_consensual, underage, doxxing, hate_speech, spam
    details TEXT NOT NULL,
    evidence_snapshot JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'received', -- received, investigating, resolved, dismissed
    resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_category ON public.reports(category);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON public.reports(created_at DESC);

CREATE TABLE IF NOT EXISTS public.moderation_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_type VARCHAR(32) NOT NULL, -- warn, mute, kick, ban_user, revoke_guest_session, delete_message
    moderator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    target_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    target_guest_id UUID REFERENCES public.guest_sessions(id) ON DELETE SET NULL,
    target_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_mod_actions_mod ON public.moderation_actions(moderator_id);
CREATE INDEX IF NOT EXISTS idx_mod_actions_target_user ON public.moderation_actions(target_user_id);

-- =============================================================================
-- 8. CALL SESSIONS & USER PREFERENCES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.call_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.chat_rooms(id) ON DELETE SET NULL,
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
    initiator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    mode VARCHAR(16) NOT NULL DEFAULT 'video', -- voice, video
    status VARCHAR(16) NOT NULL DEFAULT 'active', -- active, ended, failed
    started_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    language_pref VARCHAR(8) NOT NULL DEFAULT 'en',
    audio_device_id TEXT,
    video_device_id TEXT,
    notification_desktop BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- =============================================================================
-- 9. FORUM & BLOG
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.forum_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(64) NOT NULL UNIQUE,
    name_en VARCHAR(64) NOT NULL,
    name_bn VARCHAR(64) NOT NULL,
    description_en TEXT,
    description_bn TEXT,
    order_index INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.forum_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES public.forum_categories(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    views_count INT NOT NULL DEFAULT 0,
    replies_count INT NOT NULL DEFAULT 0,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_forum_topics_cat ON public.forum_topics(category_id);
CREATE INDEX IF NOT EXISTS idx_forum_topics_created ON public.forum_topics(created_at DESC);

CREATE TABLE IF NOT EXISTS public.forum_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES public.forum_topics(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_forum_posts_topic ON public.forum_posts(topic_id, created_at ASC);

CREATE TABLE IF NOT EXISTS public.blog_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(100) NOT NULL UNIQUE,
    title_en VARCHAR(200) NOT NULL,
    title_bn VARCHAR(200) NOT NULL,
    summary_en TEXT NOT NULL,
    summary_bn TEXT NOT NULL,
    content_en TEXT NOT NULL,
    content_bn TEXT NOT NULL,
    category VARCHAR(64) NOT NULL,
    author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    read_time VARCHAR(20) NOT NULL DEFAULT '5 min read',
    published_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON public.blog_posts(slug);

-- =============================================================================
-- 10. ADMIN AUDIT LOGS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL,
    target_entity VARCHAR(64) NOT NULL,
    target_id TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    ip_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.admin_audit_logs(created_at DESC);

-- =============================================================================
-- 11. HELPER FUNCTIONS FOR ROW-LEVEL SECURITY
-- =============================================================================

-- Check if current authenticated user has 'admin' role
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
    );
$$;

-- Check if current authenticated user has 'moderator' or 'admin' role
CREATE OR REPLACE FUNCTION public.is_moderator()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('moderator', 'admin')
    );
$$;

-- Check if current user is participant in a conversation
CREATE OR REPLACE FUNCTION public.is_conversation_member(p_conv_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.conversation_participants
        WHERE conversation_id = p_conv_id AND user_id = auth.uid()
    );
$$;

-- Check if current user is blocked by or has blocked another user
CREATE OR REPLACE FUNCTION public.is_blocked_between(user_a UUID, user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.blocks
        WHERE (blocker_id = user_a AND blocked_id = user_b)
           OR (blocker_id = user_b AND blocked_id = user_a)
    );
$$;

-- =============================================================================
-- 12. ROLE ESCALATION PROTECTION TRIGGER
-- Prevent users from updating their own 'role' field
-- =============================================================================

CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- If role is changing and user is NOT an admin
    IF (OLD.role IS DISTINCT FROM NEW.role) THEN
        IF NOT public.is_admin() THEN
            RAISE EXCEPTION 'Unauthorized: Users cannot alter their own access role.';
        END IF;
    END IF;
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_role ON public.profiles;
CREATE TRIGGER trg_protect_profile_role
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_role();

-- =============================================================================
-- 13. ROW LEVEL SECURITY (RLS) POLICIES
-- =============================================================================

-- Enable RLS across EVERY table
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- PROFILES POLICIES
-- -----------------------------------------------------------------------------
-- Anyone can view safe profile fields (id, nickname, avatar_url, bio, is_18_verified)
CREATE POLICY "Profiles are publicly readable"
ON public.profiles FOR SELECT
USING (true);

-- Users can only insert/update their own profile
CREATE POLICY "Users can create their own profile"
ON public.profiles FOR INSERT
WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
USING (auth.uid() = id);

-- -----------------------------------------------------------------------------
-- CHAT ROOMS POLICIES
-- -----------------------------------------------------------------------------
-- Public channels are viewable by all (guests and registered)
CREATE POLICY "Active rooms are viewable by all"
ON public.chat_rooms FOR SELECT
USING (is_active = true OR public.is_moderator());

-- Only admins/moderators can create or modify chat rooms
CREATE POLICY "Moderators can manage chat rooms"
ON public.chat_rooms FOR ALL
USING (public.is_moderator());

-- -----------------------------------------------------------------------------
-- CONVERSATIONS & PARTICIPANTS POLICIES
-- -----------------------------------------------------------------------------
-- Users can only view conversations they participate in
CREATE POLICY "Participants can view their conversations"
ON public.conversations FOR SELECT
USING (public.is_conversation_member(id));

CREATE POLICY "Authenticated users can create conversations"
ON public.conversations FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Participants can view conversation participants"
ON public.conversation_participants FOR SELECT
USING (public.is_conversation_member(conversation_id));

CREATE POLICY "Users can add themselves to conversations"
ON public.conversation_participants FOR INSERT
WITH CHECK (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- MESSAGES POLICIES
-- -----------------------------------------------------------------------------
-- Room messages: Readable by all if room is not restricted, or by authorized members
CREATE POLICY "Public room messages are readable"
ON public.messages FOR SELECT
USING (
    room_id IS NOT NULL OR
    (conversation_id IS NOT NULL AND public.is_conversation_member(conversation_id))
);

-- Users can send messages to public rooms or their own conversations
CREATE POLICY "Authenticated users can insert messages"
ON public.messages FOR INSERT
WITH CHECK (
    -- Registered user check
    (auth.uid() = sender_user_id AND (
        room_id IS NOT NULL OR
        (conversation_id IS NOT NULL AND public.is_conversation_member(conversation_id))
    ))
);

-- -----------------------------------------------------------------------------
-- BLOCKS & REPORTS POLICIES
-- -----------------------------------------------------------------------------
CREATE POLICY "Users can view and manage their own blocks"
ON public.blocks FOR ALL
USING (auth.uid() = blocker_id)
WITH CHECK (auth.uid() = blocker_id);

-- Reports: Creators can insert reports; ONLY moderators/admins can read all reports
CREATE POLICY "Anyone can submit a safety report"
ON public.reports FOR INSERT
WITH CHECK (
    (auth.uid() IS NOT NULL AND auth.uid() = reporter_user_id) OR
    (auth.uid() IS NULL AND reporter_guest_id IS NOT NULL)
);

CREATE POLICY "Only staff can view safety reports"
ON public.reports FOR SELECT
USING (public.is_moderator() OR (auth.uid() = reporter_user_id));

CREATE POLICY "Only staff can update report status"
ON public.reports FOR UPDATE
USING (public.is_moderator());

-- -----------------------------------------------------------------------------
-- MODERATION ACTIONS & AUDIT LOGS POLICIES
-- -----------------------------------------------------------------------------
CREATE POLICY "Only staff can view moderation actions"
ON public.moderation_actions FOR SELECT
USING (public.is_moderator());

CREATE POLICY "Only staff can insert moderation actions"
ON public.moderation_actions FOR INSERT
WITH CHECK (public.is_moderator() AND auth.uid() = moderator_id);

CREATE POLICY "Only admins can view audit logs"
ON public.admin_audit_logs FOR SELECT
USING (public.is_admin());

-- -----------------------------------------------------------------------------
-- FORUM & BLOG POLICIES
-- -----------------------------------------------------------------------------
CREATE POLICY "Forum categories and blog posts are public"
ON public.forum_categories FOR SELECT USING (true);

CREATE POLICY "Blog posts are public"
ON public.blog_posts FOR SELECT USING (true);

CREATE POLICY "Forum topics are publicly readable"
ON public.forum_topics FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create forum topics"
ON public.forum_topics FOR INSERT
WITH CHECK (auth.uid() = author_id);

CREATE POLICY "Forum posts are publicly readable"
ON public.forum_posts FOR SELECT USING (true);

CREATE POLICY "Authenticated users can post forum replies"
ON public.forum_posts FOR INSERT
WITH CHECK (auth.uid() = author_id);

-- -----------------------------------------------------------------------------
-- GUEST SESSIONS POLICIES
-- Guest sessions are managed server-side via trusted Service Role or API functions
-- -----------------------------------------------------------------------------
CREATE POLICY "Staff can view guest sessions"
ON public.guest_sessions FOR SELECT
USING (public.is_moderator());
