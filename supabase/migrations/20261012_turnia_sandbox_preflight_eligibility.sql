-- Read-only eligibility gate for a sandbox preflight check.
-- Does not enable checkout, activation, or public registration.
CREATE OR REPLACE FUNCTION public.turnia_sandbox_preflight_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT COALESCE(
    (SELECT f.sandbox_test_user_id=auth.uid()
            AND EXISTS (SELECT 1 FROM propina_private.turnia_registrations r
              JOIN auth.users u ON u.id=r.user_id
              WHERE r.user_id=auth.uid()
                AND r.status='pending_payment'
                AND u.email_confirmed_at IS NOT NULL)
     FROM propina_private.turnia_runtime_flags f WHERE f.id=1),false)
$$;
REVOKE ALL ON FUNCTION public.turnia_sandbox_preflight_allowed() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.turnia_sandbox_preflight_allowed() TO authenticated;
