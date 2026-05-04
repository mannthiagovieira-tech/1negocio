// Item 3 · dedup global de leads_google por telefone
// Usado por · cowork-rodar-frente-corretores · classificar-lead-olx · capturar-negocios-floripa
// IA atendente (chat-ia) tem versão inline · não usa este módulo (mais campos específicos)

export interface DedupLead {
  nome?: string | null;
  telefone?: string | null;
  telefone_formatado?: string | null;
  cidade?: string | null;
  estado?: string | null;
  setor?: string | null;
  categoria?: string | null;
  endereco?: string | null;
  bio?: string | null;
  website?: string | null;
  url_anuncio?: string | null;
  place_id?: string | null;
  origem: string;
  campanha?: string | null;
  status?: string | null;
  classificacao_ia?: string | null;
  classificado_em?: string | null;
  notas?: string | null;
  valor_anuncio?: number | null;
  data_publicacao?: string | null;
  tema_conversa?: string | null;
  tags?: string[] | null;
  fontes?: string[] | null;
}

/**
 * Normaliza telefone pra formato canônico:
 * - apenas dígitos
 * - prefixo 55 (BR) se faltando
 * - retorna null se < 10 dígitos (provavelmente inválido)
 */
export function normalizarTelefone(input: any): string | null {
  if (!input) return null;
  let digitos = String(input).replace(/\D/g, "");
  if (!digitos) return null;
  if (digitos.length < 10) return null;
  if (digitos.length > 13) return null;
  if (!digitos.startsWith("55") && (digitos.length === 10 || digitos.length === 11)) {
    digitos = "55" + digitos;
  }
  return digitos;
}

/**
 * Verifica se é celular brasileiro válido.
 * Regra: depois do DDI 55 + DDD (2 dígitos), o próximo dígito deve ser 9.
 */
export function ehCelular(telefone: any): boolean {
  const norm = normalizarTelefone(telefone);
  if (!norm) return false;
  if (norm.length !== 13) return false; // celular = 55 + DD + 9XXXXXXXX
  return norm[4] === "9";
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr.filter(Boolean)));
}

/**
 * UPSERT em leads_google com dedup por telefone.
 * Se já existe lead com mesmo telefone:
 *   - UPDATE com dados novos (não sobrescreve campos populados com null/undefined)
 *   - acumula origem em fontes[] (sem duplicar)
 *   - acumula tags
 *   - marca duplicado_em
 * Se não existe: INSERT
 *
 * Retorna { created: bool, lead_id: string, telefone_normalizado: string }
 */
export async function upsertLeadGoogle(supabase: any, lead: DedupLead): Promise<{
  created: boolean;
  lead_id: string | null;
  telefone_normalizado: string | null;
  pulado_motivo?: string;
}> {
  const tel = normalizarTelefone(lead.telefone);
  if (!tel) {
    return { created: false, lead_id: null, telefone_normalizado: null, pulado_motivo: "telefone_invalido" };
  }

  // checa duplicado
  const { data: existente, error: errLer } = await supabase
    .from("leads_google")
    .select("id, fontes, tags, classificacao_ia, classificado_em, telefone_formatado, status")
    .eq("telefone", tel)
    .maybeSingle();

  if (errLer) {
    return { created: false, lead_id: null, telefone_normalizado: tel, pulado_motivo: errLer.message };
  }

  const novosFontes = uniq([...(existente?.fontes || []), lead.origem, ...(lead.fontes || [])]);
  const novosTags = uniq([...(existente?.tags || []), ...(lead.tags || [])]);

  if (existente) {
    // UPDATE · não sobrescreve com nulls · acumula arrays
    const update: any = {
      duplicado_em: new Date().toISOString(),
      fontes: novosFontes,
      tags: novosTags,
      updated_at: new Date().toISOString(),
    };
    // só atualiza campos populados no novo lead
    if (lead.nome) update.nome = lead.nome;
    if (lead.telefone_formatado && !existente.telefone_formatado) update.telefone_formatado = lead.telefone_formatado;
    if (lead.cidade) update.cidade = lead.cidade;
    if (lead.estado) update.estado = lead.estado;
    if (lead.setor) update.setor = lead.setor;
    if (lead.categoria) update.categoria = lead.categoria;
    if (lead.endereco) update.endereco = lead.endereco;
    if (lead.bio) update.bio = lead.bio;
    if (lead.website) update.website = lead.website;
    if (lead.url_anuncio) update.url_anuncio = lead.url_anuncio;
    if (lead.place_id) update.place_id = lead.place_id;
    if (lead.notas) update.notas = lead.notas;
    if (lead.valor_anuncio != null) update.valor_anuncio = lead.valor_anuncio;
    if (lead.data_publicacao) update.data_publicacao = lead.data_publicacao;
    if (lead.tema_conversa) update.tema_conversa = lead.tema_conversa;
    // classificação · só atualiza se mais qualificada (não pisa em quente)
    if (lead.classificacao_ia && (!existente.classificacao_ia || existente.classificacao_ia === "ambiguo")) {
      update.classificacao_ia = lead.classificacao_ia;
      update.classificado_em = lead.classificado_em || new Date().toISOString();
    }

    const { error: errUpd } = await supabase.from("leads_google").update(update).eq("id", existente.id);
    if (errUpd) return { created: false, lead_id: existente.id, telefone_normalizado: tel, pulado_motivo: errUpd.message };
    return { created: false, lead_id: existente.id, telefone_normalizado: tel };
  }

  // INSERT novo
  const insert: any = {
    nome: lead.nome || null,
    telefone: tel,
    telefone_formatado: lead.telefone_formatado || null,
    cidade: lead.cidade || null,
    estado: lead.estado || null,
    setor: lead.setor || null,
    categoria: lead.categoria || null,
    endereco: lead.endereco || null,
    bio: lead.bio || null,
    website: lead.website || null,
    url_anuncio: lead.url_anuncio || null,
    place_id: lead.place_id || null,
    origem: lead.origem,
    campanha: lead.campanha || null,
    status: lead.status || "novo",
    classificacao_ia: lead.classificacao_ia || null,
    classificado_em: lead.classificado_em || (lead.classificacao_ia ? new Date().toISOString() : null),
    notas: lead.notas || null,
    valor_anuncio: lead.valor_anuncio ?? null,
    data_publicacao: lead.data_publicacao || null,
    tema_conversa: lead.tema_conversa || null,
    tags: novosTags.length ? novosTags : null,
    fontes: novosFontes,
  };

  const { data: novo, error: errIns } = await supabase
    .from("leads_google")
    .insert(insert)
    .select("id")
    .single();
  if (errIns) {
    // race condition · alguém inseriu o mesmo telefone entre o select e o insert
    if (String(errIns.message).includes("leads_google_telefone_unique")) {
      const { data: r } = await supabase.from("leads_google").select("id").eq("telefone", tel).maybeSingle();
      return { created: false, lead_id: r?.id || null, telefone_normalizado: tel, pulado_motivo: "race_dedup" };
    }
    return { created: false, lead_id: null, telefone_normalizado: tel, pulado_motivo: errIns.message };
  }
  return { created: true, lead_id: novo.id, telefone_normalizado: tel };
}
