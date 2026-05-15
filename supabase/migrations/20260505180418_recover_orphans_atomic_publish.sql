-- Recover · termo_adesao assessorada perdeu versão ativa após falha do publish
-- (UPDATE desativou v1 antes do INSERT da v2 falhar com FK violation pre-fix).
update public.documentos_templates t
set ativo = true
where t.id in (
  select distinct on (tipo, coalesce(formato,'_nda_')) id
  from public.documentos_templates
  where (tipo, coalesce(formato,'_nda_')) in (
    select tipo, coalesce(formato,'_nda_')
    from public.documentos_templates
    group by tipo, coalesce(formato,'_nda_')
    having sum(case when ativo then 1 else 0 end) = 0
  )
  order by tipo, coalesce(formato,'_nda_'), versao desc
);

-- Função atômica · publicar_template_v2
-- PL/pgSQL roda numa única transação implícita · UPDATE+INSERT+DELETE
-- todos juntos · qualquer falha desfaz tudo (sem mais órfãos).
create or replace function public.publicar_template_v2(
  p_tipo text, p_formato text, p_texto text, p_notas text, p_admin_id uuid
) returns table(nova_versao int, template_id uuid)
language plpgsql security definer set search_path = public
as $func$
declare v_max_versao int; v_new_id uuid;
begin
  select coalesce(max(versao), 0) + 1 into v_max_versao
  from public.documentos_templates
  where tipo = p_tipo and coalesce(formato,'_nda_') = coalesce(p_formato,'_nda_')
  for update;

  update public.documentos_templates
  set ativo = false
  where tipo = p_tipo
    and coalesce(formato,'_nda_') = coalesce(p_formato,'_nda_')
    and ativo = true;

  insert into public.documentos_templates (tipo, formato, versao, texto, ativo, notas_versao, created_by)
  values (p_tipo, p_formato, v_max_versao, p_texto, true, p_notas, p_admin_id)
  returning id into v_new_id;

  delete from public.documentos_templates_rascunho
  where tipo = p_tipo and coalesce(formato,'_nda_') = coalesce(p_formato,'_nda_');

  return query select v_max_versao, v_new_id;
end $func$;
grant execute on function public.publicar_template_v2(text, text, text, text, uuid)
  to authenticated, service_role;

-- Função atômica · reverter_template_atomico
create or replace function public.reverter_template_atomico(
  p_template_id_origem uuid, p_admin_id uuid
) returns table(nova_versao int, template_id uuid, revertido_de_versao int)
language plpgsql security definer set search_path = public
as $func$
declare v_origem record; v_max_versao int; v_new_id uuid;
begin
  select id, tipo, formato, versao, texto into v_origem
  from public.documentos_templates where id = p_template_id_origem;
  if v_origem.id is null then
    raise exception 'template origem não encontrado: %', p_template_id_origem;
  end if;

  select coalesce(max(versao), 0) + 1 into v_max_versao
  from public.documentos_templates
  where tipo = v_origem.tipo
    and coalesce(formato,'_nda_') = coalesce(v_origem.formato,'_nda_')
  for update;

  update public.documentos_templates
  set ativo = false
  where tipo = v_origem.tipo
    and coalesce(formato,'_nda_') = coalesce(v_origem.formato,'_nda_')
    and ativo = true;

  insert into public.documentos_templates (tipo, formato, versao, texto, ativo, notas_versao, created_by)
  values (v_origem.tipo, v_origem.formato, v_max_versao, v_origem.texto, true,
          'Reverter para conteúdo da v' || v_origem.versao, p_admin_id)
  returning id into v_new_id;

  delete from public.documentos_templates_rascunho
  where tipo = v_origem.tipo
    and coalesce(formato,'_nda_') = coalesce(v_origem.formato,'_nda_');

  return query select v_max_versao, v_new_id, v_origem.versao;
end $func$;
grant execute on function public.reverter_template_atomico(uuid, uuid)
  to authenticated, service_role;
