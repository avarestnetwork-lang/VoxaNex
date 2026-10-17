-- =============================================================================
-- FIX GUEST MESSAGE INSERT RLS POLICY
-- Allows verified guest users (sender_guest_id IS NOT NULL, auth.uid() IS NULL)
-- to insert messages into public rooms alongside authenticated users.
-- =============================================================================

DROP POLICY IF EXISTS "Authenticated users can insert messages" ON public.messages;

CREATE POLICY "Authenticated and guest users can insert messages"
ON public.messages FOR INSERT
WITH CHECK (
    -- Registered user check
    (auth.uid() IS NOT NULL AND auth.uid() = sender_user_id AND (
        room_id IS NOT NULL OR
        (conversation_id IS NOT NULL AND public.is_conversation_member(conversation_id))
    ))
    OR
    -- Guest user check
    (auth.uid() IS NULL AND sender_guest_id IS NOT NULL AND room_id IS NOT NULL)
);
