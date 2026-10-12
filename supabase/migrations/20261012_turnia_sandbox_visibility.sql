-- Read-only availability control. Does not expose secrets or enable checkout.
-- Frontend only presents testing UI if operator enables sandbox explicitly.
CREATE OR REPLACE FUNCTION public.turnia_sandbox_checkout_available()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT COALESCE((SELECT sandbox_checkout_enabled
   FROM propina_private.turnia_runtime_flags WHERE id=1),false)
$$;
REVOKE ALL ON FUNCTION public.turnia_sandbox_checkout_available() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.turnia_sandbox_checkout_available() TO authenticated;
