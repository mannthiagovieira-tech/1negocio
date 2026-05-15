alter table public.negocios
  add column if not exists criado_por_procuracao boolean default false;

alter table public.negocios
  add column if not exists criado_por_admin uuid references public.admins(id) on delete set null;

create index if not exists idx_negocios_procuracao
  on public.negocios(criado_por_procuracao)
  where criado_por_procuracao = true;

drop policy if exists "admins_negocios_via_helper" on public.negocios;
create policy "admins_negocios_via_helper" on public.negocios
  for all using (public.is_admin_atual());
