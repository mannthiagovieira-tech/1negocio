-- P1 · FK gerado_por/aprovado_por apontavam pra auth.users · trocar pra admins(id)
alter table public.termos_adesao
  drop constraint if exists termos_adesao_gerado_por_fkey;
alter table public.termos_adesao
  alter column gerado_por drop not null;
alter table public.termos_adesao
  add constraint termos_adesao_gerado_por_fkey
  foreign key (gerado_por) references public.admins(id) on delete set null;

alter table public.nda_solicitacoes
  drop constraint if exists nda_solicitacoes_gerado_por_fkey;
alter table public.nda_solicitacoes
  alter column gerado_por drop not null;
alter table public.nda_solicitacoes
  add constraint nda_solicitacoes_gerado_por_fkey
  foreign key (gerado_por) references public.admins(id) on delete set null;

alter table public.nda_solicitacoes
  drop constraint if exists nda_solicitacoes_aprovado_por_fkey;
alter table public.nda_solicitacoes
  alter column aprovado_por drop not null;
alter table public.nda_solicitacoes
  add constraint nda_solicitacoes_aprovado_por_fkey
  foreign key (aprovado_por) references public.admins(id) on delete set null;

-- P3 · RLS de usuarios só permitia (auth.uid() = id) · admin precisa ver todos
drop policy if exists "admins_veem_usuarios" on public.usuarios;
create policy "admins_veem_usuarios" on public.usuarios
  for select using (public.is_admin_atual());
