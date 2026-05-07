// _shared/matchmaking-tags.ts · V7 FASE A · catálogo de tags admin + helper aplicar
// Cap delta ±10 · 0 sinaliza neutro (registra na lista mas sem afetar score)

export const TAGS_PESOS: Record<string, number> = {
  // PRONTIDÃO
  capital_pronto: 8,
  capital_em_construcao: 0,
  capital_indefinido: -6,
  // URGÊNCIA
  urgencia_alta: 4,
  urgencia_media: 0,
  urgencia_baixa: -2,
  // EXPERIÊNCIA
  primeiro_negocio: 0,
  empreendedor_serial: 3,
  investidor_passivo: 0,
  // TIPO COMPRADOR
  estrategico: 3,
  financeiro: 0,
  operacional: 0,
  // SINAIS DE FECHAMENTO
  decidido: 5,
  fechador_rapido: 5,
  indeciso: -4,
  desconfiado: -5,
  negociador_duro: 0,
  // LIMITES (não afetam score · só sinalizam)
  nao_topa_franquia: 0,
  so_negocio_cnpj: 0,
  prefere_minoritario: 0,
};

export const TAGS_CATEGORIAS = {
  prontidao: ["capital_pronto", "capital_em_construcao", "capital_indefinido"],
  urgencia: ["urgencia_alta", "urgencia_media", "urgencia_baixa"],
  experiencia: ["primeiro_negocio", "empreendedor_serial", "investidor_passivo"],
  tipo: ["estrategico", "financeiro", "operacional"],
  fechamento: ["decidido", "fechador_rapido", "indeciso", "desconfiado", "negociador_duro"],
  limites: ["nao_topa_franquia", "so_negocio_cnpj", "prefere_minoritario"],
};

export type TagAplicada = { tag: string; peso: number };

export function aplicarTags(
  scoreBase: number,
  tagsAdmin: string[] | null | undefined
): { score: number; aplicadas: TagAplicada[] } {
  if (!tagsAdmin || tagsAdmin.length === 0) return { score: scoreBase, aplicadas: [] };
  let delta = 0;
  const aplicadas: TagAplicada[] = [];
  for (const tag of tagsAdmin) {
    const peso = TAGS_PESOS[tag] ?? 0;
    delta += peso;
    aplicadas.push({ tag, peso }); // registra todas · inclusive 0 (limites/sinais neutros)
  }
  const deltaFinal = Math.max(-10, Math.min(10, delta));
  const score = Math.max(0, Math.min(100, scoreBase + deltaFinal));
  return { score, aplicadas };
}
