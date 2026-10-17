-- =============================================================================
-- ROLLBACK GUEST INSERT RLS POLICY ON public.messages
-- Since guest message writes now occur exclusively server-side via the Cloudflare
-- Worker using SUPABASE_SERVICE_ROLE_KEY, direct anonymous client inserts are no
-- longer needed. This restores public.messages INSERT RLS strictly to authenticated
-- registered users and the secure server-side service role.
-- =============================================================================

DROP POLICY IF EXISTS "Authenticated and guest users can insert messages" ON public.messages;
DROP POLICY IF EXISTS "Authenticated users can insert messages" ON public.messages;

CREATE POLICY "Authenticated users can insert messages"
ON public.messages FOR INSERT
WITH CHECK (
    auth.uid() IS NOT NULL AND auth.uid() = sender_user_id AND (
        room_id IS NOT NULL OR
        (conversation_id IS NOT NULL AND public.is_conversation_member(conversation_id))
    )
);
