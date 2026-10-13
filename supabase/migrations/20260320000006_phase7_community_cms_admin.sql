-- =============================================================================
-- VOXANEX — PHASE 7: COMMUNITY FORUM, CMS BLOG, GUIDES, ROOMS & ADMIN
-- Migration: 20260320000006_phase7_community_cms_admin.sql
-- =============================================================================

-- 1. Community Forum Topics
CREATE TABLE IF NOT EXISTS public.forum_topics (
    id TEXT PRIMARY KEY DEFAULT ('top_' || floor(extract(epoch from now())) || '_' || substr(md5(random()::text), 1, 6)),
    slug TEXT UNIQUE,
    title TEXT NOT NULL CHECK (char_length(trim(title)) >= 5),
    category TEXT NOT NULL CHECK (category IN ('general', 'banglish', 'tech', 'regional', 'safety', 'international')),
    category_label_en TEXT NOT NULL,
    category_label_bn TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_nickname TEXT NOT NULL,
    author_avatar TEXT DEFAULT '⚡',
    author_role TEXT DEFAULT 'user' CHECK (author_role IN ('guest', 'user', 'moderator', 'admin', 'editor')),
    content TEXT NOT NULL CHECK (char_length(trim(content)) >= 10),
    pinned BOOLEAN DEFAULT FALSE,
    is_locked BOOLEAN DEFAULT FALSE,
    replies_count INTEGER DEFAULT 0,
    views_count INTEGER DEFAULT 0,
    last_activity TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_topics_category ON public.forum_topics(category);
CREATE INDEX IF NOT EXISTS idx_forum_topics_last_activity ON public.forum_topics(last_activity DESC);
CREATE INDEX IF NOT EXISTS idx_forum_topics_author ON public.forum_topics(author_id);

-- 2. Forum Replies
CREATE TABLE IF NOT EXISTS public.forum_replies (
    id TEXT PRIMARY KEY DEFAULT ('rep_' || floor(extract(epoch from now())) || '_' || substr(md5(random()::text), 1, 6)),
    topic_id TEXT NOT NULL REFERENCES public.forum_topics(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL,
    author_nickname TEXT NOT NULL,
    author_avatar TEXT DEFAULT '💬',
    author_role TEXT DEFAULT 'user' CHECK (author_role IN ('guest', 'user', 'moderator', 'admin', 'editor')),
    content TEXT NOT NULL CHECK (char_length(trim(content)) >= 2),
    is_moderator_approved BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_replies_topic ON public.forum_replies(topic_id, created_at ASC);

-- 3. CMS Blog Articles
CREATE TABLE IF NOT EXISTS public.blog_articles (
    id TEXT PRIMARY KEY DEFAULT ('art_' || floor(extract(epoch from now())) || '_' || substr(md5(random()::text), 1, 6)),
    slug TEXT UNIQUE NOT NULL,
    title_en TEXT NOT NULL,
    title_bn TEXT NOT NULL,
    summary_en TEXT NOT NULL,
    summary_bn TEXT NOT NULL,
    content_en TEXT NOT NULL,
    content_bn TEXT NOT NULL,
    category TEXT NOT NULL,
    tags TEXT[] DEFAULT '{}',
    read_time TEXT DEFAULT '4 min read',
    author TEXT NOT NULL,
    author_role TEXT DEFAULT 'editor' CHECK (author_role IN ('editor', 'admin', 'staff')),
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
    published_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_articles_slug ON public.blog_articles(slug);
CREATE INDEX IF NOT EXISTS idx_blog_articles_status ON public.blog_articles(status, published_at DESC);

-- 4. Blog Comments
CREATE TABLE IF NOT EXISTS public.blog_comments (
    id TEXT PRIMARY KEY DEFAULT ('com_' || floor(extract(epoch from now())) || '_' || substr(md5(random()::text), 1, 6)),
    article_id TEXT NOT NULL REFERENCES public.blog_articles(id) ON DELETE CASCADE,
    author_nickname TEXT NOT NULL,
    author_avatar TEXT DEFAULT '💬',
    content TEXT NOT NULL CHECK (char_length(trim(content)) >= 2),
    status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'pending', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_comments_article ON public.blog_comments(article_id, created_at ASC);

-- 5. Community Guides
CREATE TABLE IF NOT EXISTS public.community_guides (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    title_en TEXT NOT NULL,
    title_bn TEXT NOT NULL,
    summary_en TEXT NOT NULL,
    summary_bn TEXT NOT NULL,
    icon TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('onboarding', 'safety', 'privacy', 'rules')),
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    sections JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_community_guides_slug ON public.community_guides(slug);

-- 6. Dynamic Room Catalog & International Clusters
CREATE TABLE IF NOT EXISTS public.rooms_dynamic (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name_en TEXT NOT NULL,
    name_bn TEXT NOT NULL,
    description_en TEXT NOT NULL,
    description_bn TEXT NOT NULL,
    category TEXT NOT NULL,
    language TEXT NOT NULL,
    modes TEXT[] NOT NULL DEFAULT '{text}',
    is_18_plus BOOLEAN DEFAULT FALSE,
    requires_account BOOLEAN DEFAULT FALSE,
    country TEXT,
    region TEXT,
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rooms_dynamic_lang ON public.rooms_dynamic(language);
CREATE INDEX IF NOT EXISTS idx_rooms_dynamic_category ON public.rooms_dynamic(category);

-- 7. Validated Media Uploads & Assets
CREATE TABLE IF NOT EXISTS public.media_uploads (
    id TEXT PRIMARY KEY DEFAULT ('med_' || floor(extract(epoch from now())) || '_' || substr(md5(random()::text), 1, 8)),
    uploader_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes <= 10485760), -- 10MB limit
    mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/webm', 'audio/ogg', 'audio/mp3', 'audio/wav')),
    media_url TEXT NOT NULL,
    is_flagged BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_uploads_uploader ON public.media_uploads(uploader_id);

-- 8. Enable Row Level Security (RLS)
ALTER TABLE public.forum_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms_dynamic ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_uploads ENABLE ROW LEVEL SECURITY;

-- Forum Policies
CREATE POLICY "Public users can view forum topics" ON public.forum_topics
    FOR SELECT USING (TRUE);

CREATE POLICY "Authenticated users can create forum topics" ON public.forum_topics
    FOR INSERT WITH CHECK (char_length(trim(title)) >= 5);

CREATE POLICY "Authors or staff can update forum topics" ON public.forum_topics
    FOR UPDATE USING (
        author_id = current_setting('request.jwt.claim.sub', true)
        OR current_setting('request.jwt.claim.role', true) IN ('moderator', 'admin')
    );

CREATE POLICY "Public users can view forum replies" ON public.forum_replies
    FOR SELECT USING (is_moderator_approved = TRUE);

CREATE POLICY "Users can create forum replies" ON public.forum_replies
    FOR INSERT WITH CHECK (char_length(trim(content)) >= 2);

-- Blog Policies
CREATE POLICY "Public users can view published blog articles" ON public.blog_articles
    FOR SELECT USING (status = 'published');

CREATE POLICY "Staff can view all blog articles" ON public.blog_articles
    FOR SELECT USING (current_setting('request.jwt.claim.role', true) IN ('editor', 'admin'));

CREATE POLICY "Staff can insert or update blog articles" ON public.blog_articles
    FOR ALL USING (current_setting('request.jwt.claim.role', true) IN ('editor', 'admin'));

-- Community Guides Policies
CREATE POLICY "Public can view community guides" ON public.community_guides
    FOR SELECT USING (TRUE);

CREATE POLICY "Admins can edit community guides" ON public.community_guides
    FOR UPDATE USING (current_setting('request.jwt.claim.role', true) = 'admin');

-- Media Uploads Policies
CREATE POLICY "Users can view valid media" ON public.media_uploads
    FOR SELECT USING (is_flagged = FALSE);
