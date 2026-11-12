-- Restore the existing public profile-read contract.
-- RLS remains enabled. This restores SELECT only; no write privileges are added.

GRANT SELECT ON TABLE public.profiles TO anon, authenticated;

CREATE POLICY "Profiles are publicly readable"
ON public.profiles
FOR SELECT
TO public
USING (true);
