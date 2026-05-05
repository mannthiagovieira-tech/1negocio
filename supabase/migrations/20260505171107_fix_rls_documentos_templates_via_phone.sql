-- Fix · RLS de documentos_templates e _rascunho usavam admins.id = auth.uid(),
-- mas admins.id é independente de auth.users.id. Padrão correto é casar por
-- admins.whatsapp com o phone do JWT (mesmo que admin-api/index.ts:90 usa).

drop policy if exists "templates_admin_only" on public.documentos_templates;
create policy "templates_admin_only" on public.documentos_templates
  for all using (
    exists (
      select 1 from public.admins a
      where a.whatsapp = (auth.jwt() ->> 'phone')
        and a.ativo = true
    )
  );

drop policy if exists "rascunho_admin_only" on public.documentos_templates_rascunho;
create policy "rascunho_admin_only" on public.documentos_templates_rascunho
  for all using (
    exists (
      select 1 from public.admins a
      where a.whatsapp = (auth.jwt() ->> 'phone')
        and a.ativo = true
    )
  );
