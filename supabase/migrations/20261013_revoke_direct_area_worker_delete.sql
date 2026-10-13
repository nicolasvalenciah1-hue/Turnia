-- Turnia security hardening: require the audited RPC for area removal.
-- Direct DELETE could bypass minimum-area, zero-percent, history and transfer checks.
-- Workers are deactivated with UPDATE active=false and retain their historic links.
-- The SECURITY DEFINER RPC public.turnia_delete_unused_area retains its own
-- auth.uid / can_edit_restaurant checks and deletion audit trail.
-- No data is removed by this migration.

REVOKE DELETE ON TABLE public.propina_areas, public.propina_workers
  FROM PUBLIC, anon, authenticated;

-- Read, create and edit operations remain unchanged.
-- service_role retains its existing database rights for trusted backend functions.
COMMENT ON TABLE public.propina_areas IS
  'Tip-sharing areas: direct client DELETE forbidden; use audited turnia_delete_unused_area RPC.';
COMMENT ON TABLE public.propina_workers IS
  'Employees: deactivate via active=false; direct client DELETE forbidden to preserve history.';
