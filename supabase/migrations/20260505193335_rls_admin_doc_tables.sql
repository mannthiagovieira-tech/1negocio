-- Admin precisa ver/atualizar todas solicitacoes_info, termos_adesao, nda_solicitacoes
-- pra Autorizar Dossiês e ações de listas.

drop policy if exists "admins_solicitacoes_info_all" on public.solicitacoes_info;
create policy "admins_solicitacoes_info_all" on public.solicitacoes_info
  for all using (public.is_admin_atual());

drop policy if exists "admins_termos_adesao_all" on public.termos_adesao;
create policy "admins_termos_adesao_all" on public.termos_adesao
  for all using (public.is_admin_atual());

drop policy if exists "admins_nda_solicitacoes_all" on public.nda_solicitacoes;
create policy "admins_nda_solicitacoes_all" on public.nda_solicitacoes
  for all using (public.is_admin_atual());
