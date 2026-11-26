-- Registers the tables added by the committee roster (app_private.tedx_*), run of show
-- (app_private.run_of_show_*) and crew check-in (app_private.crew_checkin*) migrations in the
-- disposition registry, so app_private.disposition_catalog_current() is true again and privacy
-- review, replay and recovery checks stop refusing with privacy_disposition_catalog_changed.
-- Additive only: registry rows, no table or data changes. Same projection shape as
-- 20261127300000_speaker_portal.sql and 20261127100000_member_client_state.sql.
begin;

insert into app_private.disposition_sources(source_key,category,scope_kind,key_columns,query_sql,structure_hash,preserve)
select 'app_private.'||source,category,'term',key_columns,
  format('select app_private.disposition_key(%L,array[%s]) target_hash,
    %L category,null::uuid root_id,app_private.retention_is_held($1,%L,null::uuid,null::uuid) held,
    encode(sha256(convert_to(to_jsonb(x)::text,''UTF8'')),''hex'') state_hash from app_private.%I x %s',
    'app_private.'||source,
    (select string_agg(format('x.%I::text',k),',' order by o) from unnest(key_columns) with ordinality u(k,o)),
    category,category,source,scope_sql),
  app_private.disposition_structure('app_private.'||source),false
from (values
  ('tedx_positions','operational',array['role_id'],'where x.term_id=$1'),
  ('tedx_seats','security',array['id'],'where x.term_id=$1'),
  ('tedx_seat_grants','security',array['grant_id'],'join app_private.tedx_seats s on s.id=x.seat_id where s.term_id=$1'),
  ('tedx_seat_history','security',array['seat_id','version'],'join app_private.tedx_seats s on s.id=x.seat_id where s.term_id=$1'),
  ('run_of_show_segments','operational',array['id'],'where x.term_id=$1'),
  ('run_of_show_state','operational',array['term_id'],'where x.term_id=$1'),
  ('crew_checkin_tokens','security',array['term_id'],'where x.term_id=$1'),
  ('crew_checkins','privacy',array['term_id','generation','term_membership_id'],'where x.term_id=$1')
) definitions(source,category,key_columns,scope_sql)
on conflict(source_key) do update set category=excluded.category,scope_kind=excluded.scope_kind,key_columns=excluded.key_columns,
  query_sql=excluded.query_sql,structure_hash=excluded.structure_hash,preserve=excluded.preserve;

do $$
begin
  if not app_private.disposition_catalog_current() then
    raise exception using errcode='55000',message='privacy_disposition_catalog_changed',
      detail='A public or app_private table is still missing from app_private.disposition_sources.';
  end if;
end $$;

commit;
