-- Fix · FK created_by apontava pra auth.users(id) mas edge functions
-- inserem admins.id (vem do helper checarAdmin). Resultado: violation
-- documentos_templates_created_by_fkey ao salvar/publicar.
-- Fix · trocar FK target pra admins(id). Coluna fica nullable
-- (caso admin seja deletado · ON DELETE SET NULL preserva o registro).

alter table public.documentos_templates
  drop constraint if exists documentos_templates_created_by_fkey;
alter table public.documentos_templates
  alter column created_by drop not null;
alter table public.documentos_templates
  add constraint documentos_templates_created_by_fkey
  foreign key (created_by) references public.admins(id) on delete set null;

alter table public.documentos_templates_rascunho
  drop constraint if exists documentos_templates_rascunho_created_by_fkey;
alter table public.documentos_templates_rascunho
  alter column created_by drop not null;
alter table public.documentos_templates_rascunho
  add constraint documentos_templates_rascunho_created_by_fkey
  foreign key (created_by) references public.admins(id) on delete set null;

-- Helper · admin_id_atual() · irmão de is_admin_atual()
-- SECURITY DEFINER bypassa RLS de admins (que é deny-all sem policies).
create or replace function public.admin_id_atual()
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare v_phone text; v_id uuid;
begin
  v_phone := auth.jwt() ->> 'phone';
  if v_phone is null or v_phone = '' then return null; end if;
  select id into v_id from public.admins where whatsapp = v_phone and ativo = true limit 1;
  return v_id;
end $func$;

grant execute on function public.admin_id_atual() to authenticated, anon, service_role;
