#!/usr/bin/env bash
# Regenera scripts/pii-names-hashes.txt a partir dos nomes atuais do banco.
# Rode isto quando entrar gente nova no cadastro de colaboradores/freelancers,
# ou periodicamente (uma vez por mes, por exemplo).
#
# A query roda via psql direto no projeto Supabase. Exige a variavel de ambiente
# SUPABASE_DB_URL (connection string do pooler ou direto). Pegue em:
# https://supabase.com/dashboard/project/_/settings/database (Connection string
# com password).
#
# O arquivo gerado NUNCA contem nome em claro, so hashes SHA-256. Seguro de
# commitar no repo publico.
#
# Uso:
#   export SUPABASE_DB_URL='postgresql://...'   # uma vez
#   bash scripts/update-pii-names-hashes.sh
#   git add scripts/pii-names-hashes.txt
#   git commit -m "chore(pii): atualiza lista de hashes de nomes"

set -euo pipefail

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "ERRO: defina SUPABASE_DB_URL com a connection string do projeto."
  echo "Exemplo: export SUPABASE_DB_URL='postgresql://postgres:...@...supabase.co:5432/postgres'"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERRO: psql nao encontrado no PATH. Instale o postgresql-client ou use o MCP."
  exit 1
fi

OUT="scripts/pii-names-hashes.txt"
TMP=$(mktemp)
trap "rm -f $TMP" EXIT

HOJE=$(date +%Y-%m-%d)

# Cabecalho
cat > "$TMP" <<EOF
# SHA-256 de nomes de colaboradores+freelancers conhecidos no banco.
# Normalizacao: UPPER, sem acento, espacos colapsados, trim.
# Regenerar com: scripts/update-pii-names-hashes.sh
# Ultima atualizacao: $HOJE
EOF

# Query: nome -> normalizado -> SHA-256 -> ordenado
psql "$SUPABASE_DB_URL" -At <<'SQL' >> "$TMP"
WITH nomes AS (
  SELECT nome AS n FROM public.colaboradores WHERE nome IS NOT NULL AND nome <> ''
  UNION
  SELECT nome_completo AS n FROM public.freelancers WHERE nome_completo IS NOT NULL AND nome_completo <> ''
  UNION
  SELECT nome_social AS n FROM public.freelancers WHERE nome_social IS NOT NULL AND nome_social <> ''
),
normalizados AS (
  SELECT TRIM(REGEXP_REPLACE(
    TRANSLATE(UPPER(n), 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ', 'AAAAAACEEEEIIIINOOOOOUUUUY'),
    '\s+', ' ', 'g'
  )) AS n FROM nomes
),
validos AS (
  SELECT DISTINCT n FROM normalizados
  WHERE n ~ '^[A-Z]{3,}( [A-Z]{2,})+$' AND LENGTH(n) >= 6
    AND n NOT IN ('COLABORADOR EXEMPLO','FORNECEDOR EXEMPLO','PESSOA EXEMPLO')
)
SELECT ENCODE(extensions.digest(n, 'sha256'), 'hex')
FROM validos
ORDER BY 1;
SQL

mv "$TMP" "$OUT"
TOTAL=$(grep -cE '^[a-f0-9]{64}$' "$OUT")
echo "Gerado $OUT com $TOTAL hashes."
echo "Confira com: git diff $OUT"
