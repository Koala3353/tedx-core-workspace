-- FIN has heads only. Retire the seeded "FIN Core" position so it no longer appears in position
-- pickers or in "Positions with no one yet". Skipped (with a notice) while anyone still holds it, so
-- no live seat loses its role; move those people first, then run this again.
begin;

do $$
declare
  fin_core record;
begin
  for fin_core in
    select r.id, r.term_id from public.roles r
    where r.code = 'tedx_fin_core' and r.state = 'active'
  loop
    if exists(select 1 from app_private.tedx_seats s
      where s.role_id = fin_core.id and s.term_id = fin_core.term_id and not s.revoked and s.ends_at > statement_timestamp()) then
      raise notice 'FIN Core still has people in term %, left active', fin_core.term_id;
      continue;
    end if;
    update public.roles set state = 'retired' where id = fin_core.id;
  end loop;
end;
$$;

commit;
