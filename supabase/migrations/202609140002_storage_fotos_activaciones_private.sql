begin;

update storage.buckets
set public = false
where id = 'fotos-activaciones';

drop policy if exists "Give users authenticated access to folder x7vff7_0"
  on storage.objects;
drop policy if exists "Give users authenticated access to folder x7vff7_1"
  on storage.objects;

drop policy if exists storage_fotos_activaciones_select_own
  on storage.objects;
drop policy if exists storage_fotos_activaciones_insert_own
  on storage.objects;
drop policy if exists storage_fotos_activaciones_update_own
  on storage.objects;

create policy storage_fotos_activaciones_select_own
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'fotos-activaciones'
    and name like ('activaciones/' || auth.uid()::text || '/%')
  );

create policy storage_fotos_activaciones_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'fotos-activaciones'
    and name like ('activaciones/' || auth.uid()::text || '/%')
  );

create policy storage_fotos_activaciones_update_own
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'fotos-activaciones'
    and name like ('activaciones/' || auth.uid()::text || '/%')
  )
  with check (
    bucket_id = 'fotos-activaciones'
    and name like ('activaciones/' || auth.uid()::text || '/%')
  );

commit;
