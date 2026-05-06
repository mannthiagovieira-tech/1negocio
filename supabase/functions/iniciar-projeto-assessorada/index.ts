// Edge Function: iniciar-projeto-assessorada
// Admin · cria 10 tarefas default pra um negocio com plano='assessorada'

import { cors, checarAdmin, svc, jsonRes } from "../_shared/admin-auth.ts";

const TAREFAS_DEFAULT = [
  { ordem: 1,  titulo: "Diagnóstico recebido",            descricao: "Análise inicial do negócio." },
  { ordem: 2,  titulo: "Avaliação técnica refinada",      descricao: "Refinamento da avaliação com nossa metodologia." },
  { ordem: 3,  titulo: "Material visual produzido",       descricao: "Apresentação visual e textual do negócio." },
  { ordem: 4,  titulo: "Aprovação do material com cliente", descricao: "Você aprovará antes de irmos ao mercado." },
  { ordem: 5,  titulo: "Anúncio publicado",               descricao: "Negócio ao vivo na plataforma 1Negócio." },
  { ordem: 6,  titulo: "Prospecção ativa iniciada",       descricao: "Começamos a abordar compradores qualificados." },
  { ordem: 7,  titulo: "+200 contatos abordados",         descricao: "Compromisso contratual de prospecção.", contador_atual: 0, contador_alvo: 200 },
  { ordem: 8,  titulo: "Reunião estratégica mês 1",       descricao: "Primeira revisão de andamento." },
  { ordem: 9,  titulo: "Recalibragem mês 1",              descricao: "Ajustes baseados nos primeiros 30 dias." },
  { ordem: 10, titulo: "Reunião trimestral mês 3",        descricao: "Revisão profunda do projeto." },
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonRes({ erro: "Method not allowed" }, 405);

  const auth = await checarAdmin(req);
  if (!auth.ok) return jsonRes({ erro: auth.erro }, auth.status);

  let body: any;
  try { body = await req.json(); } catch { return jsonRes({ erro: "Invalid JSON" }, 400); }

  const { negocio_id } = body || {};
  if (!negocio_id) return jsonRes({ erro: "negocio_id obrigatório" }, 400);

  const sb = svc();
  const { data: neg } = await sb.from("negocios").select("id, plano, nome").eq("id", negocio_id).maybeSingle();
  if (!neg) return jsonRes({ erro: "negócio não encontrado" }, 404);
  if (neg.plano !== "assessorada") {
    return jsonRes({ erro: `plano deve ser 'assessorada' (atual: ${neg.plano || "vazio"})` }, 400);
  }

  const { data: existentes } = await sb.from("projeto_tarefas").select("id, ordem, titulo, concluido").eq("negocio_id", negocio_id).order("ordem");
  if (existentes && existentes.length) {
    return jsonRes({ ok: true, ja_iniciado: true, total_tarefas: existentes.length, tarefas: existentes });
  }

  const linhas = TAREFAS_DEFAULT.map(t => ({ ...t, negocio_id }));
  const { data: novas, error } = await sb.from("projeto_tarefas").insert(linhas).select("id, ordem, titulo").order("ordem");
  if (error) return jsonRes({ erro: "insert tarefas: " + error.message }, 500);

  return jsonRes({
    ok: true,
    ja_iniciado: false,
    total_tarefas: novas.length,
    primeira_tarefa: novas[0] || null,
    tarefas: novas,
  });
});
