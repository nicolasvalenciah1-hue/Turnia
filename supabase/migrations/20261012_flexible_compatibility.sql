-- Phase 2 compatibility: keep both systems isolated and include flexible
-- allocations in the private personal-payroll endpoint.
CREATE OR REPLACE FUNCTION propina_private.propina_prevent_mixed_ledger()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF EXISTS(
  SELECT 1 FROM public.propina_flex_shifts s
  WHERE s.restaurant_id=NEW.restaurant_id AND s.work_date=NEW.work_date
 ) THEN RAISE EXCEPTION 'La fecha ya tiene turnos AM/PM. No mezcles ambos métodos de reparto.';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS propina_prevent_mixed_ledger ON public.propina_days;
CREATE TRIGGER propina_prevent_mixed_ledger
BEFORE INSERT OR UPDATE OF restaurant_id,work_date ON public.propina_days
FOR EACH ROW EXECUTE FUNCTION propina_private.propina_prevent_mixed_ledger();

CREATE OR REPLACE FUNCTION propina_private.propina_my_tips(rid uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE wid uuid;
BEGIN
 SELECT a.worker_id INTO wid
 FROM public.propina_access a
 JOIN public.propina_restaurants r ON r.id=a.restaurant_id
 JOIN auth.users u ON u.id=a.user_id
 WHERE a.user_id=auth.uid() AND a.restaurant_id=rid AND a.active AND r.active
   AND u.email_confirmed_at IS NOT NULL;
 IF wid IS NULL THEN
  RAISE EXCEPTION 'No tienes una ficha de trabajador vinculada en este restaurante.'
    USING ERRCODE='42501';
 END IF;
 RETURN (
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'work_date',t.work_date,'hours',t.hours,
   'calculated_clp',t.calculated_clp,'kind',t.kind,
   'group_code',t.group_code,'weight',t.weight
 ) ORDER BY t.work_date DESC,t.group_code),'[]'::jsonb)
 FROM (
 SELECT d.work_date,d.hours,d.calculated_clp,
    'classic'::text AS kind,'CLASICO'::text AS group_code,NULL::numeric AS weight
 FROM public.propina_daily_distribution d
 WHERE d.restaurant_id=rid AND d.worker_id=wid
 UNION ALL
 SELECT f.work_date,NULL::numeric AS hours,f.calculated_clp,
   'flex'::text AS kind,f.group_code,f.weight
 FROM public.propina_flex_payouts f
 WHERE f.restaurant_id=rid AND f.worker_id=wid
 ) t
 );
END $$;
