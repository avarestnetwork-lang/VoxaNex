-- =============================================================================
-- Migration: Remove Legacy Message Content Constraint
-- Purpose: Allow media-only messages while preserving existing media-aware
--          content validation and other message constraints.
-- Production note: This correction was already applied and verified manually.
-- =============================================================================

ALTER TABLE public.messages
DROP CONSTRAINT IF EXISTS messages_content_not_empty;
