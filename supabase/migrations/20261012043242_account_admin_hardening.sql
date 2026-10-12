-- Preserve every row. Keep privileged implementation out of the exposed schema.
create or replace function propina_private.propina_update_restaurant_name(p_restaurant_id uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  clean_name text := btrim(regexp_replace(coalesce(p_name,''), '\s+', ' ', 'g'));
  previous_name text;
begin
  if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then
    raise exception 'Debes iniciar sesión con el correo confirmado.' using errcode='42501';
  end if;
  if p_restaurant_id is null or char_length(clean_name) not between 2 and 80 then
    raise exception 'El nombre del restaurante debe tener entre 2 y 80 caracteres.';
  end if;
  select r.name into previous_name from public.propina_restaurants r
  join public.propina_access a on a.restaurant_id=r.id
  where r.id=p_restaurant_id and r.active and r.owner_id=uid
    and a.user_id=uid and a.active and a.role='owner'
  for update of r, a;
  if not found then
    raise exception 'Solo el propietario autorizado puede editar este restaurante.' using errcode='42501';
  end if;
  if previous_name is distinct from clean_name then
    update public.propina_restaurants set name=clean_name where id=p_restaurant_id;
    insert into propina_private.access_audit(actor,action,target,details)
    values(uid,'rename_restaurant',p_restaurant_id,jsonb_build_object('previous_name',previous_name,'new_name',clean_name));
  end if;
  return jsonb_build_object('id',p_restaurant_id,'name',clean_name);
end $$;
revoke all on function propina_private.propina_update_restaurant_name(uuid,text) from public, anon;
grant execute on function propina_private.propina_update_restaurant_name(uuid,text) to authenticated;

create or replace function public.propina_update_restaurant_name(p_restaurant_id uuid, p_name text)
returns jsonb language sql security invoker set search_path = '' as $$
  select propina_private.propina_update_restaurant_name(p_restaurant_id,p_name)
$$;
revoke all on function public.propina_update_restaurant_name(uuid,text) from public, anon;
grant execute on function public.propina_update_restaurant_name(uuid,text) to authenticated;

-- Do not report success for an already removed member. A previous invitation
-- must not restore the old privilege after an owner changes or removes access.
create or replace function propina_private.propina_manage_member(rid uuid, member_email text, new_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
  previous text;
  mail text := lower(btrim(coalesce(member_email,'')));
begin
  if not propina_private.is_restaurant_owner(rid) then
    raise exception 'Solo el propietario puede administrar accesos.' using errcode='42501';
  end if;
  if new_role is not null and new_role not in ('admin','viewer') then raise exception 'Rol inválido.'; end if;
  select id into uid from auth.users where lower(email)=mail;
  select role into previous from public.propina_access
  where user_id=uid and restaurant_id=rid and active for update;
  if not found then raise exception 'Esta persona ya no tiene acceso activo. Actualiza la lista.'; end if;
  if previous='owner' then raise exception 'No se puede retirar ni cambiar el rol del propietario.'; end if;
  if new_role is null then
    update public.propina_access set active=false where user_id=uid and restaurant_id=rid;
  else
    update public.propina_access set role=new_role where user_id=uid and restaurant_id=rid;
  end if;
  update propina_private.invitations set revoked_at=now()
  where restaurant_id=rid and email=mail and used_at is null and revoked_at is null;
  insert into propina_private.access_audit(actor,action,target,details)
  values((select auth.uid()),'member_access',rid,jsonb_build_object('email',mail,'before',previous,'after',new_role));
end $$;
revoke all on function propina_private.propina_manage_member(uuid,text,text) from public, anon;
grant execute on function propina_private.propina_manage_member(uuid,text,text) to authenticated;
