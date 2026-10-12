-- Invite-based restaurant onboarding. Preserve existing restaurants, accounts and memberships.
CREATE TABLE IF NOT EXISTS propina_private.restaurant_business_profiles (
 restaurant_id uuid PRIMARY KEY REFERENCES public.propina_restaurants(id),
 legal_name text NOT NULL DEFAULT '',
 tax_id text NOT NULL DEFAULT '',
 business_type text NOT NULL DEFAULT '',
 street_address text NOT NULL DEFAULT '',
 city text NOT NULL DEFAULT '',
 commune text NOT NULL DEFAULT '',
 region text NOT NULL DEFAULT '',
 phone text NOT NULL DEFAULT '',
 contact_email text NOT NULL DEFAULT '',
 manager_name text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON propina_private.restaurant_business_profiles FROM PUBLIC,anon,authenticated;
ALTER TABLE propina_private.restaurant_business_profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION propina_private.normalize_restaurant_profile(data jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE result jsonb; k text; value text; max_len integer;
BEGIN
 IF data IS NULL OR jsonb_typeof(data)<>'object' THEN RAISE EXCEPTION 'Revisa los datos del restaurante.'; END IF;
 result:='{}'::jsonb;
 FOR k IN SELECT unnest(ARRAY['legal_name','tax_id','business_type','street_address','city','commune','region','phone','contact_email','manager_name'])
 LOOP
   value:=btrim(coalesce(data->>k,''));
   max_len:=70;
   IF k IN ('street_address','legal_name') THEN max_len:=120; END IF;
   IF k='contact_email' THEN max_len:=254; END IF;
   IF k='manager_name' THEN max_len:=100; END IF;
   IF length(value)>max_len THEN RAISE EXCEPTION 'Uno de los datos del restaurante es demasiado largo.'; END IF;
   IF k='contact_email' AND value<>'' AND value !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
     THEN RAISE EXCEPTION 'Correo de contacto inválido.'; END IF;
   IF k='phone' AND value<>'' AND value !~ '^[+0-9 ()-]{7,30}$'
     THEN RAISE EXCEPTION 'Número de teléfono inválido.'; END IF;
   result:=result||jsonb_build_object(k,value);
 END LOOP;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION propina_private.normalize_restaurant_profile(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.propina_create_restaurant_with_profile(restaurant_name text, profile jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE rid uuid; payload jsonb; cleaned text;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'Primero confirma tu correo.' USING ERRCODE='42501'; END IF;
 cleaned:=btrim(regexp_replace(coalesce(restaurant_name,''),'\s+',' ','g'));
 IF char_length(cleaned) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'El nombre del restaurante debe tener entre 2 y 80 caracteres.'; END IF;
 payload:=propina_private.normalize_restaurant_profile(profile);
 IF payload->>'city'='' OR payload->>'region'='' OR payload->>'phone'='' THEN
   RAISE EXCEPTION 'Completa ciudad, región y teléfono del restaurante.';
 END IF;
 rid:=propina_private.propina_create_restaurant(cleaned);
 INSERT INTO propina_private.restaurant_business_profiles(
 restaurant_id,legal_name,tax_id,business_type,street_address,city,commune,region,phone,contact_email,manager_name)
 SELECT rid,legal_name,tax_id,business_type,street_address,city,commune,region,phone,contact_email,manager_name
 FROM jsonb_to_record(payload) AS x(legal_name text,tax_id text,business_type text,street_address text,city text,commune text,region text,phone text,contact_email text,manager_name text);
 RETURN rid;
END; $$;
REVOKE ALL ON FUNCTION public.propina_create_restaurant_with_profile(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.propina_create_restaurant_with_profile(text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.propina_restaurant_business_profile(rid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(
 SELECT 1 FROM public.propina_access a JOIN public.propina_restaurants r ON r.id=a.restaurant_id
 WHERE a.restaurant_id=rid AND a.user_id=auth.uid() AND a.role='owner' AND a.active AND r.active
 ) THEN RAISE EXCEPTION 'Solo el propietario puede consultar estos datos.' USING ERRCODE='42501'; END IF;
 RETURN coalesce(
  (SELECT to_jsonb(p)-'restaurant_id'-'created_at'-'updated_at'
    FROM propina_private.restaurant_business_profiles p WHERE p.restaurant_id=rid),
  '{}'::jsonb
 );
END; $$;
REVOKE ALL ON FUNCTION public.propina_restaurant_business_profile(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.propina_restaurant_business_profile(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.propina_update_restaurant_business_profile(rid uuid, restaurant_name text, profile jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE cleaned text; payload jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(
 SELECT 1 FROM public.propina_access a JOIN public.propina_restaurants r ON r.id=a.restaurant_id
 WHERE a.restaurant_id=rid AND a.user_id=auth.uid() AND a.role='owner' AND a.active AND r.active
 ) THEN RAISE EXCEPTION 'Solo el propietario puede modificar estos datos.' USING ERRCODE='42501'; END IF;
 cleaned:=btrim(regexp_replace(coalesce(restaurant_name,''),'\s+',' ','g'));
 IF char_length(cleaned) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'El nombre del restaurante debe tener entre 2 y 80 caracteres.'; END IF;
 payload:=propina_private.normalize_restaurant_profile(profile);
 -- Legacy restaurants may have blank profile fields. Make edits incremental for them.
 PERFORM public.propina_update_restaurant_name(rid,cleaned);
 INSERT INTO propina_private.restaurant_business_profiles(
 restaurant_id,legal_name,tax_id,business_type,street_address,city,commune,region,phone,contact_email,manager_name)
 SELECT rid,legal_name,tax_id,business_type,street_address,city,commune,region,phone,contact_email,manager_name
 FROM jsonb_to_record(payload) AS x(legal_name text,tax_id text,business_type text,street_address text,city text,commune text,region text,phone text,contact_email text,manager_name text)
 ON CONFLICT(restaurant_id) DO UPDATE
 SET legal_name=excluded.legal_name,tax_id=excluded.tax_id,business_type=excluded.business_type,
 street_address=excluded.street_address,city=excluded.city,commune=excluded.commune,
 region=excluded.region,phone=excluded.phone,contact_email=excluded.contact_email,
 manager_name=excluded.manager_name,updated_at=now();
 RETURN jsonb_build_object('name',cleaned,'id',rid);
END; $$;
REVOKE ALL ON FUNCTION public.propina_update_restaurant_business_profile(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.propina_update_restaurant_business_profile(uuid,text,jsonb) TO authenticated;
