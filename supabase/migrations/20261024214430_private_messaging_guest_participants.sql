-- Let direct conversations represent either an authenticated profile or a
-- server-issued guest session without fabricating profile rows.
ALTER TABLE public.conversation_participants
    ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.conversation_participants
    ADD COLUMN IF NOT EXISTS guest_id UUID REFERENCES public.guest_sessions(id) ON DELETE CASCADE;

ALTER TABLE public.conversation_participants
    ADD CONSTRAINT chk_conversation_participant_identity
    CHECK ((user_id IS NOT NULL) <> (guest_id IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_guest_participant
    ON public.conversation_participants(conversation_id, guest_id)
    WHERE guest_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_participants_guest
    ON public.conversation_participants(guest_id)
    WHERE guest_id IS NOT NULL;

-- The application already accepts DM media, so persist the fields its Worker
-- sends instead of allowing media inserts to fail on an unknown column.
ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS media_url TEXT,
    ADD COLUMN IF NOT EXISTS media_type VARCHAR(16);
