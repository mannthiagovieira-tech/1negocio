// gerar-queries-arquetipo · v9.34.1 · Sprint 2 · schema V3 (11 campos: gmaps · gmaps_corretores · 3 sociais · 5 web · lusha_filtros)
// Gera 3 queries de busca (gmaps · facebook · instagram) por arquétipo aprovado.
// Híbrido: templates fixos + Claude Sonnet refina por canal.
// v9.33.4 · refino regra (B) · distingue REDE CENTRALIZADA (categoria setorial) de REDE INDEPENDENTE (nome da rede)
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

   PRIMEIRO: identifique se os exemplos[] do arquétipo são B1 ou B2.

   Tipo B1 · REDE CENTRALIZADA (marcas dominantes · 1 sede decide tudo):
     Exemplos: AM/PM (Ipiranga) · BR Mania (Petrobras) · Subway · McDonald's · Madero · redes franqueadoras nacionais.
     → NÃO usar nome dessas marcas em gmaps_query · retornaria APENAS filiais da própria rede (não-decisoras locais)
     → USE CATEGORIA SETORIAL + localização:
       * "lojas de conveniência em ${cidade}"
       * "redes de fast food em ${cidade}"
       * "franquias alimentação em ${cidade}"
     → fb_keywords: "rede conveniência ${cidade}" ou "franquias alimentação"
     → ig_query: handle genérico setorial (ex: "conveniencias${cidade}")

   Tipo B2 · REDE INDEPENDENTE (grupos locais/regionais autônomos):
     Exemplos: "Grupo Porcão" · "Rede Vila do Chopp" · "Empório Árabe" · grupos empresariais regionais que operam várias unidades sob 1 CNPJ regional decisor.
     → PODE usar nome da rede em gmaps_query (cada unidade ainda é da mesma empresa decisora local)
     → "<nome_rede> em ${cidade}"
     → fb_keywords: "<nome_rede> grupo"
     → ig_query: handle da rede

   COMO DECIDIR ENTRE B1 e B2:
   - Se a marca tem >100 unidades NO BRASIL ou sede em outro estado → B1
   - Se a marca tem <50 unidades concentradas em 1-2 estados → B2
   - Se está em dúvida → B1 (categoria setorial · mais seguro · não retorna lixo)

   JUSTIFICATIVA OBRIGATÓRIA no raciocinio:
   - B1: "Marca centralizada · busca por categoria setorial · evita retornar só filiais"
   - B2: "Rede independente regional · busca pelo nome capta unidades empresariais decisoras"

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

REGRAS PARA CANAIS NOVOS (v9.33.7):

FB_GRUPOS (Facebook Groups): nomes plausíveis de GRUPOS LOCAIS / SETORIAIS onde arquétipos participam.
  - 3-5 queries · cada query = busca por nome de grupo
  - Exemplos pra Bar Boteco BH: "empresários BH" · "empreendedores Belo Horizonte" · "associação bares restaurantes BH" · "gastronomia Belo Horizonte"
  - Exemplos pra distribuidora bebidas: "distribuidores bebidas MG" · "atacado alimentos Belo Horizonte"

IG_INFLUENCIADORES (hashtags Instagram pra encontrar criadores do nicho):
  - 3-5 hashtags com '#' explícito · do nicho + cidade
  - Exemplos pra Bar Boteco BH: "#barsbh" · "#gastronomiabh" · "#vidanoturnabh" · "#cervejabh" · "#restaurantesbh"

IG_CORRETORES (hashtags pra corretores na cidade):
  - 3-5 hashtags com '#' explícito
  - Exemplos pra Bar Boteco BH: "#corretorbh" · "#imoveisbh" · "#negociosbh" · "#franquiasbh"

EVENTOS · DEPRECATED (substituído por web_eventos em v9.34.1 · pode omitir ou gerar mesmas queries)

REGRAS PARA CANAIS V3 · ARSENAL EXPANDIDO (v9.34.1):

GMAPS_CORRETORES · 3 queries fixas adaptadas pra cidade do negócio (busca de corretores no GMaps):
  Exemplos: "corretora de negócios ${cidade}" · "imobiliária comercial ${cidade}" · "consultor M&A ${cidade}"

WEB_COMPRADORES · 2-3 queries Google pra encontrar PMEs/grupos compradores do arquétipo:
  Como se fosse pesquisar no Google · curtas · diretas
  Exemplos pra Bar Boteco BH: "grupos de restaurantes Belo Horizonte expansão" · "redes bares MG aquisição"

WEB_INFLUENCIADORES · 2-3 queries pra encontrar criadores micro/médio porte do nicho:
  Exemplos: "influenciador gastronomia Belo Horizonte" · "blogger food service MG"

WEB_EVENTOS · 2-3 queries pra encontrar feiras/encontros próximos 90 dias:
  Exemplos: "feira gastronomia Belo Horizonte 2026" · "festival cerveja artesanal MG 2026" · "abrasel encontro"

WEB_CORRETORES · 2-3 queries pra corretores de negócios na cidade:
  Exemplos: "corretor de negócios Belo Horizonte" · "consultor M&A MG"

WEB_PROFISSIONAIS · 2-3 queries pra profissionais do setor com perfil empreendedor:
  Exemplos: "gerente bar restaurante Belo Horizonte LinkedIn" · "chef que quer abrir negócio MG"

LUSHA_FILTROS · objeto com filtros estruturados pra busca Lusha:
  - jobTitles: array de cargos · "Owner" · "Founder" · "CEO" · "Sócio" · "Gerente Geral" · "Diretor"
  - setor: array de setores do negócio (1-3 strings em PT-BR ou EN)
  - cidade: cidade do briefing (string única)

Retorne EXCLUSIVAMENTE um JSON com este formato:

{
  "gmaps_query": "string · max 100 chars (legacy v9.33.4 · manter)",
  "fb_keywords": "string · max 80 chars (legacy)",
  "ig_query": "string · max 50 chars (legacy)",
  "gmaps": ["string", "..."],
  "gmaps_corretores": ["string", "string", "string"],
  "fb_grupos": ["string", "..."],
  "ig_influenciadores": ["#hashtag", "..."],
  "ig_corretores": ["#hashtag", "..."],
  "web_compradores": ["string", "string"],
  "web_influenciadores": ["string", "string"],
  "web_eventos": ["string", "string"],
  "web_corretores": ["string", "string"],
  "web_profissionais": ["string", "string"],
  "lusha_filtros": { "jobTitles": ["..."], "setor": ["..."], "cidade": "..." },
  "raciocinio": "1 frase explicando a estratégia"
}

REGRAS DE TAMANHO:
- gmaps · fb_grupos · ig_influenciadores · ig_corretores: 3-5 elementos cada
- gmaps_corretores: 3 elementos fixos
- web_*: 2-3 elementos cada (Claude vai fazer web_search depois · não precisa muitas)
- Cada string nos arrays: max 80 chars
- lusha_filtros.jobTitles: 3-6 cargos plausíveis
- Use o mesmo raciocínio (B1 vs B2 · investidor PF · etc) ao gerar as queries

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
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: "user", content: "Gere TODAS as queries agora (todos os 11 campos do schema V3) · só JSON válido." }],
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

    // v9.33.7 · arrays por canal · usados pelos novos sub-canais sociais e gmaps
    const arr = (key: string, max: number): string[] => {
      const raw = parsed[key];
      if (!Array.isArray(raw)) return [];
      return raw
        .map((x: any) => (x == null ? "" : String(x).trim()))
        .filter((s: string) => s.length > 0)
        .map((s: string) => s.slice(0, 80))
        .slice(0, max);
    };

    // v9.34.1 · lusha_filtros (objeto · não array)
    const lushaRaw = (parsed.lusha_filtros && typeof parsed.lusha_filtros === "object") ? parsed.lusha_filtros : {};
    const lushaJobs = Array.isArray(lushaRaw.jobTitles)
      ? lushaRaw.jobTitles.map((s: any) => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, 6)
      : [];
    const lushaSetor = Array.isArray(lushaRaw.setor)
      ? lushaRaw.setor.map((s: any) => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, 3)
      : [];
    const lushaCidade = String(lushaRaw.cidade || "").trim().slice(0, 80);

    return {
      ok: true,
      queries: {
        gmaps_query: gmaps.slice(0, 100),
        fb_keywords: fb.slice(0, 80),
        ig_query: ig.slice(0, 50),
        // v9.33.7 · arrays sociais + gmaps
        gmaps: arr("gmaps", 5),
        gmaps_corretores: arr("gmaps_corretores", 3),
        fb_grupos: arr("fb_grupos", 5),
        ig_influenciadores: arr("ig_influenciadores", 5),
        ig_corretores: arr("ig_corretores", 5),
        eventos: arr("eventos", 5),
        // v9.34.1 · arrays web · 2-3 queries (Claude web_search depois expande)
        web_compradores: arr("web_compradores", 3),
        web_influenciadores: arr("web_influenciadores", 3),
        web_eventos: arr("web_eventos", 3),
        web_corretores: arr("web_corretores", 3),
        web_profissionais: arr("web_profissionais", 3),
        // v9.34.1 · objeto lusha_filtros
        lusha_filtros: { jobTitles: lushaJobs, setor: lushaSetor, cidade: lushaCidade },
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
