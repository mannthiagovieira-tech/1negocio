-- Helper SECURITY DEFINER · bypassa RLS de admins
-- Bug · admins tem RLS ativa SEM policies (deny-all pra authenticated),
-- então policies que subquery admins via authenticated retornam 0.
-- Fix · função SECURITY DEFINER roda como owner e tem visão completa.

create or replace function public.is_admin_atual()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
begin
  v_phone := auth.jwt() ->> 'phone';
  if v_phone is null or v_phone = '' then return false; end if;
  return exists (
    select 1 from public.admins
    where whatsapp = v_phone and ativo = true
  );
end $$;

grant execute on function public.is_admin_atual() to authenticated, anon, service_role;

drop policy if exists "templates_admin_only" on public.documentos_templates;
create policy "templates_admin_only" on public.documentos_templates
  for all using (public.is_admin_atual());

drop policy if exists "rascunho_admin_only" on public.documentos_templates_rascunho;
create policy "rascunho_admin_only" on public.documentos_templates_rascunho
  for all using (public.is_admin_atual());
