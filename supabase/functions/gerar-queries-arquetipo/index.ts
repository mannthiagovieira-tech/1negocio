// gerar-queries-arquetipo · v9.33.3
// Gera 3 queries de busca (gmaps · facebook · instagram) por arquétipo aprovado.
// Híbrido: templates fixos + Claude Sonnet refina por canal.
// v9.33.3 · regras específicas por tipo de arquétipo (investidor PF → proxies · rede → marca · etc)
// Salva em arquetipos_compradores.queries_busca jsonb.
//
// POST body: { originacao_id: uuid, arquetipo_id?: uuid }
//   - se arquetipo_id ausente · processa TODOS aprovados da originação
// Output: { ok, arquetipos_processados, erros[], custo_estimado_brl }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resp(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function localizadorPorAlcance(alcance: string, cidade: string, estado: string): string {
  const a = (alcance || "cidade").toLowerCase();
  const cid = cidade || "";
  const est = estado || "";
  if (a === "cidade") return cid;
  if (a === "raio_30km") return cid;
  if (a === "raio_100km") return cid ? `${cid} e região` : "região";
  if (a === "estado") return est || cid;
  if (a === "regiao") return "região (sul/sudeste/nordeste conforme contexto)";
  if (a === "brasil") return "Brasil";
  if (a === "internacional") return "Brasil e exterior";
  return cid;
}

function parseExemplos(raw: any): string {
  if (!raw) return "";
  if (Array.isArray(raw)) return raw.join(", ");
  if (typeof raw === "string") {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.join(", ");
    } catch {}
    return raw;
  }
  return String(raw);
}

async function gerarQueriesPraArquetipo(
  arq: any,
  briefing: any,
): Promise<{ ok: boolean; queries?: any; erro?: string }> {
  const negocio = briefing?.negocio || {};
  const setor = negocio.setor || "";
  const subSetor = negocio.sub_setor || negocio.subcategoria || "";
  const cidade = negocio.cidade || "";
  const estado = negocio.estado || "";
  const alcance = briefing?.alcance_geografico_comprador || "cidade";
  const localizador = localizadorPorAlcance(alcance, cidade, estado);

  const templateGmaps = `${arq.nome || subSetor} em ${localizador}`.trim();
  const templateFb = `${subSetor} ${(arq.perfil || "").split(" ").slice(0, 4).join(" ")}`.trim();
  const templateIg = `${(subSetor || "").replace(/\s+/g, "")}${(cidade || "").replace(/\s+/g, "")}`.toLowerCase();

  const exemplos = parseExemplos(arq.exemplos);

  const systemPrompt = `Você é especialista em busca digital de empresas e perfis. Sua tarefa: refinar 3 queries de busca (Google Maps · Facebook · Instagram) pra encontrar empresas que correspondem ao ARQUÉTIPO descrito.

CONTEXTO DO NEGÓCIO QUE ESTÁ À VENDA:
- Setor: ${setor || "(sem setor)"}
- Sub-setor: ${subSetor || "(sem sub-setor)"}
- Cidade: ${cidade || "(sem cidade)"}
- Estado: ${estado || "(sem estado)"}
- Alcance geográfico do comprador desejado: ${alcance}

ARQUÉTIPO A BUSCAR:
- Nome: ${arq.nome || "(sem nome)"}
- Perfil: ${arq.perfil || "(sem perfil)"}
- Motivação pra comprar: ${arq.motivacao || "(sem motivação)"}
- Exemplos nominais: ${exemplos || "(sem exemplos)"}
- Capacidade financeira: ${arq.capacidade_financeira || "(sem capacidade definida)"}

TEMPLATES BASE (use como ponto de partida · refine pra ficar mais preciso):
- gmaps: "${templateGmaps}"
- facebook: "${templateFb}"
- instagram: "${templateIg}"

REGRAS PRA REFINAR:

1. GMAPS_QUERY: termo que vai pra busca do Google Maps
   - DEVE buscar EMPRESAS REAIS (não conceitos abstratos)
   - Inclui localização baseada no alcance:
     * cidade ou raio_30km → "${cidade}"
     * raio_100km → "${cidade} e região"
     * estado → nome do estado (${estado})
     * regiao → "Sul", "Sudeste", etc
     * brasil → "Brasil" ou cidades maiores
     * internacional → adiciona país relevante
   - Exemplo BOM: "rede de farmácias em Florianópolis"
   - Exemplo RUIM: "concorrente farmacêutico" (abstrato)

2. FB_KEYWORDS: termos pra busca interna do Facebook
   - 2-4 palavras-chave separadas por espaço
   - Foca em palavras que aparecem em descrição de PÁGINAS de empresas
   - Não usa hashtag · não usa @
   - Exemplo BOM: "farmácia rede catarinense"
   - Exemplo RUIM: "farmacêutico" (genérico demais)

3. IG_QUERY: termo pra busca do Instagram
   - 1-3 palavras concatenadas (sem espaço) OU hashtag estilo
   - Foco em BIO/HANDLE de perfis business
   - Exemplo BOM: "farmaciafloripa"
   - Exemplo RUIM: "rede de farmácias em Florianópolis" (longo demais)

REGRAS ESPECÍFICAS POR TIPO DE ARQUÉTIPO:

Detecte o TIPO do arquétipo lendo seu nome/perfil. Aplique a regra correspondente abaixo. Se o arquétipo se enquadrar em mais de um tipo, escolha o mais específico e justifique no raciocínio.

(A) INVESTIDOR PESSOA FÍSICA · INVESTIDOR FINANCEIRO · FAMILY OFFICE · INVESTIDOR ANJO · similar:
   - gmaps_query DEVE buscar PROXIES (NÃO "investidor PF" direto · não retorna empresas reais):
     * Tipo 1: family offices → "family office ${cidade}"
     * Tipo 2: gestoras patrimoniais → "gestora patrimonial ${cidade}", "wealth management ${cidade}"
     * Tipo 3: holdings → "holding patrimonial ${cidade}"
     * Escolha o proxy MAIS PLAUSÍVEL baseado nos exemplos nominais do arquétipo
   - fb_keywords: "family office ${cidade}" ou "investidor anjo ${cidade}"
   - ig_query: handle relacionado · ex: "familyoffice${cidade}" · "wealth${cidade}"
   - JUSTIFICATIVA OBRIGATÓRIA no raciocinio: "investidor PF não tem listagem direta · busca via proxies estruturais (family office · gestora · wealth management)"

(B) REDE DE VAREJO · REDE DE FAST FOOD · REDE DE CONVENIÊNCIAS · FRANQUIA · similar:
   - gmaps_query DEVE usar o NOME COMERCIAL de UMA das marcas dos exemplos nominais (mais provável retornar empresa real):
     * Pega o exemplo MAIS RELEVANTE de exemplos[]
     * Formata: "<nome_marca> em ${cidade}"
     * Ex BOM: "AM/PM em Belo Horizonte"
     * Ex RUIM: "rede de conveniências fast food em belo horizonte" (genérico demais · GMaps não agrupa redes)
   - fb_keywords: combina marca + categoria · ex: "AM/PM conveniência"
   - ig_query: handle plausível da marca · ex: "ampmoficial"
   - JUSTIFICATIVA OBRIGATÓRIA no raciocinio: "redes não aparecem agrupadas no GMaps · buscar pelo NOME da rede retorna lojas físicas reais"

(C) CONCORRENTE_DIRETO · ADJACENTE:
   - Mantém estratégia padrão (subsetor + cidade + alcance)
   - gmaps_query: "${subSetor} em ${cidade}" (ou alcance equivalente)

(D) ANTES_CADEIA (fornecedor · fabricante · distribuidor upstream):
   - gmaps_query: nome do segmento UPSTREAM + cidade
     * Pra bar/restaurante → "atacadista alimentos ${cidade}" · "distribuidora bebidas ${cidade}"
     * Pra farmácia → "distribuidor farmacêutico ${cidade}"
     * Pra varejo de roupas → "atacadista confecção ${cidade}"
   - fb_keywords: termos comerciais do segmento upstream
   - ig_query: handle setorial upstream

(E) DEPOIS_CADEIA (cliente · canal · varejo downstream):
   - gmaps_query: nome do segmento DOWNSTREAM + cidade
   - Análogo ao (D) mas no sentido contrário da cadeia

(F) CLIENTES_ATUAIS (B2B · cliente recorrente · integração vertical):
   - Use os exemplos[] do arquétipo como base (são empresas REAIS que já compram)
   - gmaps_query: nome de UMA das empresas exemplo + cidade · NÃO buscar categoria genérica
   - fb_keywords: nome da empresa + categoria
   - ig_query: handle plausível da empresa
   - JUSTIFICATIVA OBRIGATÓRIA no raciocinio: "clientes atuais já são identificáveis · busca por nome real da empresa exemplo"

Retorne EXCLUSIVAMENTE um JSON com este formato:

{
  "gmaps_query": "string · max 100 chars",
  "fb_keywords": "string · max 80 chars",
  "ig_query": "string · max 50 chars",
  "raciocinio": "1 frase explicando a estratégia"
}

NÃO escreva nada fora do JSON.`;

  try {
    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: "user", content: "Gere as 3 queries agora · só JSON válido." }],
      }),
    });
    if (!claudeResp.ok) {
      const errTxt = await claudeResp.text();
      return { ok: false, erro: `claude_api_falhou · ${errTxt.slice(0, 200)}` };
    }
    const claudeData = await claudeResp.json();
    const textBlocks = (claudeData.content || []).filter((b: any) => b.type === "text");
    const fullText = textBlocks.map((b: any) => b.text).join("");

    let parsed: any;
    try {
      const clean = fullText.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(clean);
    } catch (e: any) {
      return { ok: false, erro: `json_parse_falhou · ${e.message} · raw: ${fullText.slice(0, 200)}` };
    }

    const gmaps = (parsed.gmaps_query || "").toString().trim();
    const fb = (parsed.fb_keywords || "").toString().trim();
    const ig = (parsed.ig_query || "").toString().trim();
    if (!gmaps || !fb || !ig) {
      return { ok: false, erro: `query_vazia · gmaps=${!!gmaps} fb=${!!fb} ig=${!!ig}` };
    }

    return {
      ok: true,
      queries: {
        gmaps_query: gmaps.slice(0, 100),
        fb_keywords: fb.slice(0, 80),
        ig_query: ig.slice(0, 50),
        raciocinio: (parsed.raciocinio || "").toString().trim().slice(0, 300),
        gerado_em: new Date().toISOString(),
      },
    };
  } catch (e: any) {
    return { ok: false, erro: `exception · ${e.message}` };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  // Gate admin canônico
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return resp(401, { ok: false, erro: "sem_jwt" });
  const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return resp(401, { ok: false, erro: "jwt_invalido" });
  const { data: admin } = await adminClient
    .from("admins").select("id, ativo")
    .eq("whatsapp", userData.user.phone).eq("ativo", true).maybeSingle();
  if (!admin) return resp(403, { ok: false, erro: "nao_admin" });

  let body: any;
  try { body = await req.json(); } catch { return resp(400, { ok: false, erro: "json_invalido" }); }
  const { originacao_id, arquetipo_id } = body || {};
  if (!originacao_id) return resp(400, { ok: false, erro: "originacao_id_obrigatorio" });

  // Busca originação + briefing
  const { data: orig, error: errOrig } = await adminClient
    .from("projetos_originacao").select("id, projeto_id, briefing_jsonb")
    .eq("id", originacao_id).maybeSingle();
  if (errOrig) return resp(500, { ok: false, erro: "fetch_orig_falhou", detalhe: errOrig.message });
  if (!orig) return resp(404, { ok: false, erro: "originacao_nao_encontrada" });
  if (!orig.briefing_jsonb) return resp(400, { ok: false, erro: "briefing_nao_gerado" });

  // Busca arquétipos
  let arqQuery = adminClient
    .from("arquetipos_compradores")
    .select("id, nome, perfil, motivacao, exemplos, capacidade_financeira, originacao_id, status")
    .eq("originacao_id", originacao_id)
    .eq("status", "aprovado")
    .order("ordem", { ascending: true });

  if (arquetipo_id) arqQuery = arqQuery.eq("id", arquetipo_id);

  const { data: arquetipos, error: errArq } = await arqQuery;
  if (errArq) return resp(500, { ok: false, erro: "fetch_arquetipos_falhou", detalhe: errArq.message });
  if (!arquetipos || arquetipos.length === 0) {
    return resp(400, { ok: false, erro: "nenhum_arquetipo_aprovado" });
  }

  // Itera arquétipos sequencialmente (evita rate limit)
  const erros: Array<{ arquetipo_id: string; nome: string; erro: string }> = [];
  let processados = 0;

  for (const arq of arquetipos) {
    const r = await gerarQueriesPraArquetipo(arq, orig.briefing_jsonb);
    if (!r.ok) {
      erros.push({ arquetipo_id: arq.id, nome: arq.nome || "(sem nome)", erro: r.erro! });
      continue;
    }
    const { error: errUpd } = await adminClient
      .from("arquetipos_compradores")
      .update({ queries_busca: r.queries, updated_at: new Date().toISOString() })
      .eq("id", arq.id);
    if (errUpd) {
      erros.push({ arquetipo_id: arq.id, nome: arq.nome || "(sem nome)", erro: `update_falhou · ${errUpd.message}` });
      continue;
    }
    processados++;
  }

  return resp(200, {
    ok: true,
    arquetipos_processados: processados,
    arquetipos_total: arquetipos.length,
    erros,
    custo_estimado_brl: +(processados * 0.02).toFixed(2),
  });
});
