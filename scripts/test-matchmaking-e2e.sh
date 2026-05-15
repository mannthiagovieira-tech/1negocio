#!/bin/bash
# test-matchmaking-e2e.sh · prova amarração tese ↔ negócio ↔ matchmaking
# Cria fixtures · executa modo=par 4x mudando 1 critério por vez · valida elim/score · cleanup
#
# Uso:
#   export SUPABASE_SERVICE_ROLE_KEY="<chave>"
#   bash scripts/test-matchmaking-e2e.sh
#
# Saída esperada: 5 cenários verdes (✓) ou primeiro vermelho com diff esperado vs obtido.
# NÃO rodar em produção sem entender · cria/deleta dados via service-role.

set -e
set -u
set -o pipefail

SUPABASE_URL="${SUPABASE_URL:-https://dbijmgqlcrgjlcfrastg.supabase.co}"
KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

if [[ -z "$KEY" ]]; then
  if [[ -f .env.local ]]; then
    KEY=$(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  fi
fi
if [[ -z "$KEY" ]]; then
  echo "❌ SUPABASE_SERVICE_ROLE_KEY não definida (env ou .env.local)"
  exit 1
fi

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
blue()  { printf "\033[34m%s\033[0m\n" "$*"; }

# Helpers
sb_post() {
  local path="$1"; shift
  local body="$1"; shift
  curl -sS -X POST \
    "$SUPABASE_URL/$path" \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -d "$body"
}
sb_patch() {
  local path="$1"; shift
  local body="$1"; shift
  curl -sS -X PATCH \
    "$SUPABASE_URL/$path" \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "$body"
}
sb_delete() {
  local path="$1"; shift
  curl -sS -X DELETE \
    "$SUPABASE_URL/$path" \
    -H "apikey: $KEY" \
    -H "Authorization: Bearer $KEY"
}
edge_call() {
  local fn="$1"; shift
  local body="$1"; shift
  curl -sS -X POST \
    "$SUPABASE_URL/functions/v1/$fn" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "$body"
}

VENDEDOR_ID=""
COMPRADOR_ID=""
NEGOCIO_ID=""
TESE_ID=""
ANUNCIO_ID=""

cleanup() {
  blue "[cleanup] removendo fixtures..."
  [[ -n "$ANUNCIO_ID" ]] && sb_delete "rest/v1/anuncios_v2?id=eq.$ANUNCIO_ID" >/dev/null 2>&1 || true
  [[ -n "$NEGOCIO_ID" ]] && sb_delete "rest/v1/matchmaking_resultados?negocio_id=eq.$NEGOCIO_ID" >/dev/null 2>&1 || true
  [[ -n "$NEGOCIO_ID" ]] && sb_delete "rest/v1/negocios?id=eq.$NEGOCIO_ID" >/dev/null 2>&1 || true
  [[ -n "$TESE_ID" ]] && sb_delete "rest/v1/teses_investimento?id=eq.$TESE_ID" >/dev/null 2>&1 || true
  [[ -n "$VENDEDOR_ID" ]] && sb_delete "auth/v1/admin/users/$VENDEDOR_ID" >/dev/null 2>&1 || true
  [[ -n "$COMPRADOR_ID" ]] && sb_delete "auth/v1/admin/users/$COMPRADOR_ID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

blue "[1/7] criando ghost users (vendedor + comprador)..."
VEND_RESP=$(sb_post "auth/v1/admin/users" '{"phone":"5511999990001","phone_confirm":false,"user_metadata":{"nome":"E2E Vendedor","ghost":true,"e2e":true}}')
VENDEDOR_ID=$(echo "$VEND_RESP" | jq -r '.id // empty')
COMP_RESP=$(sb_post "auth/v1/admin/users" '{"phone":"5511999990002","phone_confirm":false,"user_metadata":{"nome":"E2E Comprador","ghost":true,"e2e":true}}')
COMPRADOR_ID=$(echo "$COMP_RESP" | jq -r '.id // empty')
[[ -z "$VENDEDOR_ID" || -z "$COMPRADOR_ID" ]] && { red "falha criar ghost users"; exit 1; }
green "  vendedor=$VENDEDOR_ID  comprador=$COMPRADOR_ID"

blue "[2/7] criando tese-fake (alimentacao + presta_servico + SP + 500k)..."
TESE_RESP=$(sb_post "rest/v1/teses_investimento" "{\"usuario_id\":\"$COMPRADOR_ID\",\"status\":\"ativa\",\"setores\":[\"alimentacao\"],\"formas_atuacao\":[\"presta_servico\"],\"localizacao_tipo\":\"estado\",\"estado\":\"SP\",\"valor_alvo\":500000,\"titulo\":\"E2E TEST TESE\",\"descricao_curta\":\"Padaria pequena bairro\",\"origem\":\"e2e_test\"}")
TESE_ID=$(echo "$TESE_RESP" | jq -r '.[0].id // empty')
[[ -z "$TESE_ID" ]] && { red "falha criar tese: $TESE_RESP"; exit 1; }
green "  tese_id=$TESE_ID"

blue "[3/7] criando negocio-fake espelho + anuncio_v2 (550k = +10%)..."
NEG_RESP=$(sb_post "rest/v1/negocios" "{\"vendedor_id\":\"$VENDEDOR_ID\",\"nome\":\"E2E TEST NEGOCIO\",\"setor\":\"alimentacao\",\"formas_atuacao\":[\"presta_servico\"],\"estado\":\"SP\",\"cidade\":\"São Paulo\",\"status\":\"publicado\",\"score_saude\":75,\"descricao_curta\":\"Padaria pequena bairro\",\"faturamento_anual\":1000000,\"origem\":\"e2e_test\"}")
NEGOCIO_ID=$(echo "$NEG_RESP" | jq -r '.[0].id // empty')
[[ -z "$NEGOCIO_ID" ]] && { red "falha criar negocio: $NEG_RESP"; exit 1; }

ANU_RESP=$(sb_post "rest/v1/anuncios_v2" "{\"negocio_id\":\"$NEGOCIO_ID\",\"valor_pedido\":550000,\"status\":\"publicado\",\"publicado_em\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}")
ANUNCIO_ID=$(echo "$ANU_RESP" | jq -r '.[0].id // empty')
[[ -z "$ANUNCIO_ID" ]] && { red "falha criar anuncio_v2: $ANU_RESP"; exit 1; }
green "  negocio_id=$NEGOCIO_ID  anuncio_id=$ANUNCIO_ID"

# CENÁRIOS

assert_score_high() {
  local desc="$1"; shift
  local resp="$1"; shift
  local elim=$(echo "$resp" | jq -r '.resultado.eliminado // null')
  local score=$(echo "$resp" | jq -r '.resultado.score_final // null')
  if [[ "$elim" == "false" && -n "$score" && "$score" -ge 70 ]]; then
    green "  ✓ $desc · score=$score"
  else
    red "  ✗ $desc · esperado score>=70 elim=false · obtido elim=$elim score=$score"
    echo "$resp" | jq .
    exit 1
  fi
}
assert_eliminado() {
  local desc="$1"; shift
  local motivo_pat="$1"; shift
  local resp="$1"; shift
  local elim=$(echo "$resp" | jq -r '.resultado.eliminado // null')
  local motivo=$(echo "$resp" | jq -r '.resultado.motivo_eliminado // ""')
  if [[ "$elim" == "true" && "$motivo" =~ $motivo_pat ]]; then
    green "  ✓ $desc · motivo=$motivo"
  else
    red "  ✗ $desc · esperado elim=true motivo~/$motivo_pat/ · obtido elim=$elim motivo='$motivo'"
    echo "$resp" | jq .
    exit 1
  fi
}

blue "[4/7] cenário 1 · match perfeito (esperado score >=70 · não eliminado)..."
R=$(edge_call "calcular-matchmaking" "{\"modo\":\"par\",\"tese_id\":\"$TESE_ID\",\"negocio_id\":\"$NEGOCIO_ID\"}")
assert_score_high "match perfeito alimentacao+presta_servico+SP+10%" "$R"

blue "[5/7] cenário 2 · forma divergente (saas) · esperado eliminado motivo forma..."
sb_patch "rest/v1/negocios?id=eq.$NEGOCIO_ID" '{"formas_atuacao":["saas"]}' >/dev/null
R=$(edge_call "calcular-matchmaking" "{\"modo\":\"par\",\"tese_id\":\"$TESE_ID\",\"negocio_id\":\"$NEGOCIO_ID\"}")
assert_eliminado "forma sem interseção" "forma" "$R"

blue "[6/7] cenário 3 · estado divergente (RJ) · esperado eliminado motivo estado..."
sb_patch "rest/v1/negocios?id=eq.$NEGOCIO_ID" '{"formas_atuacao":["presta_servico"],"estado":"RJ"}' >/dev/null
R=$(edge_call "calcular-matchmaking" "{\"modo\":\"par\",\"tese_id\":\"$TESE_ID\",\"negocio_id\":\"$NEGOCIO_ID\"}")
assert_eliminado "estado divergente" "estado" "$R"

blue "[7/7] cenário 4 · valor abaixo do piso ±30% (200k) · esperado eliminado motivo ticket..."
sb_patch "rest/v1/negocios?id=eq.$NEGOCIO_ID" '{"estado":"SP"}' >/dev/null
sb_patch "rest/v1/anuncios_v2?id=eq.$ANUNCIO_ID" '{"valor_pedido":200000}' >/dev/null
R=$(edge_call "calcular-matchmaking" "{\"modo\":\"par\",\"tese_id\":\"$TESE_ID\",\"negocio_id\":\"$NEGOCIO_ID\"}")
assert_eliminado "ticket abaixo do piso" "ticket_baixo" "$R"

green ""
green "✅ TODOS OS 4 CENÁRIOS PASSARAM · amarração matchmaking ↔ tese ↔ negócio OK"
green "   (cleanup automático no trap EXIT)"
