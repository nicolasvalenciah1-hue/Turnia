-- Turnia: covering indexes for restaurant-scoped RLS, shifts, and teams.
-- Additive only: no UPDATE/DELETE, no changes to tips, accounts, memberships or payments.
-- Avoid duplicate indexes already supplied by primary/unique keys.
CREATE INDEX IF NOT EXISTS propina_shifts_restaurant_day_idx
  ON public.propina_shifts (restaurant_id, day_id);
CREATE INDEX IF NOT EXISTS propina_shifts_worker_restaurant_idx
  ON public.propina_shifts (worker_id, restaurant_id);
CREATE INDEX IF NOT EXISTS propina_workers_restaurant_area_idx
  ON public.propina_workers (restaurant_id, area_id);
CREATE INDEX IF NOT EXISTS propina_areas_restaurant_idx
  ON public.propina_areas (restaurant_id);
CREATE INDEX IF NOT EXISTS propina_access_worker_restaurant_idx
  ON public.propina_access (worker_id, restaurant_id)
  WHERE worker_id IS NOT NULL;
