#!/usr/bin/env bash
# Bloqueia commit se qualquer arquivo staged carregar dado pessoal real.
#
# Padroes bloqueados:
#   - CPF com mascara (xxx.xxx.xxx-xx) fora dos placeholders aprovados
#   - CPF sem mascara (11 digitos) em migrations SQL
#   - Nome real de colaborador conhecido
#   - Email pessoal nominal (nome.sobrenome@qualquer dominio) em arquivo nao-UI
#
# Para liberar deliberadamente um falso positivo, adicione o CPF/padrao
# ao whitelist no topo deste script.

set -euo pipefail

# --- Whitelist (padroes que PODEM ficar) ---
# CPFs placeholder conhecidos (regex). Qualquer CPF que bata com um destes
# NAO conta como vazamento. Formato CPF+mascara.
PLACEHOLDER_CPF_REGEX='^(000\.000\.000-00|123\.456\.789-00|111\.444\.777-3[45]|110\.000\.[0-9]{3}-00|190\.000\.[0-9]{3}-[0-9]{2,4}|290\.000\.[0-9]{3}-[0-9]{2,4}|390\.000\.[0-9]{3}-[0-9]{2,4})$'
# CPF sem mascara (11 digitos)
PLACEHOLDER_CPF_RAW_REGEX='^(00000000000|12345678900|1114447773[45]|110000[0-9]{3}00|190000[0-9]{3}[0-9]{2,4}|290000[0-9]{3}[0-9]{2,4}|390000[0-9]{3}[0-9]{2,4})$'
# CNPJs placeholder
PLACEHOLDER_CNPJ_REGEX='^(00\.000\.000/[0-9]{4}-00|11\.222\.333/0001-8[12]|00\.000\.000/0000-00)$'
PLACEHOLDER_CNPJ_RAW_REGEX='^(00000000000100|11222333000181|11222333000182|00000000000000)$'
# CNPJs institucionais da California (publicos na Receita Federal)
CALIFORNIA_CNPJ_REGEX='^(19\.437\.976/[0-9]{4}-[0-9]{2}|29\.943\.648/[0-9]{4}-[0-9]{2})$'
# CNPJs de teste com padroes obvios (digitos repetidos ou sequencia)
TESTE_CNPJ_REGEX='^(([0-9])\2{1}\.\2{3}\.\2{3}/[0-9]{4}-[0-9]{2}|34\.567\.890/0001-30|55\.666\.777/0001-88)$'
# Emails placeholder
PLACEHOLDER_EMAIL_REGEX='^(colaborador|pessoal|exemplo|voce|pessoa|rh|financeiro|fulano|ciclano|teste|contato|comercial|financeiro)[0-9_]*@'

# Arquivos a ignorar
IGNORE_PATHS_REGEX='^(node_modules/|\.git-filter-replacements\.txt|scripts/sanitize-pii|scripts/check-pii\.sh|supabase/migrations/.*_task009_empresas\.sql$)'
# Nota: task009_empresas tem CPF/CNPJ da propria California e empresas-irmas,
# nao e dado de colaborador. Ja sanitizado em commit anterior.

# --- Coleta arquivos staged ---
if [ -z "${PRE_COMMIT_FILES:-}" ]; then
  FILES=$(git diff --cached --name-only --diff-filter=ACM)
else
  FILES="$PRE_COMMIT_FILES"
fi

if [ -z "$FILES" ]; then
  exit 0
fi

VIOLATIONS=""

while IFS= read -r file; do
  [ -z "$file" ] && continue
  echo "$file" | grep -qE "$IGNORE_PATHS_REGEX" && continue
  [ ! -f "$file" ] && continue

  # 1. CPFs com mascara (fora dos placeholders)
  while IFS= read -r cpf; do
    [ -z "$cpf" ] && continue
    if ! echo "$cpf" | grep -qE "$PLACEHOLDER_CPF_REGEX"; then
      VIOLATIONS+="  CPF suspeito '$cpf' em $file\n"
    fi
  done < <(grep -oE '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2,4}' "$file" 2>/dev/null | sort -u)

  # 2. CNPJs com mascara (fora dos placeholders, California, ou teste obvio)
  while IFS= read -r cnpj; do
    [ -z "$cnpj" ] && continue
    if echo "$cnpj" | grep -qE "$PLACEHOLDER_CNPJ_REGEX"; then continue; fi
    if echo "$cnpj" | grep -qE "$CALIFORNIA_CNPJ_REGEX"; then continue; fi
    # Padrao de 8 primeiros digitos iguais (ex: 77.777.777/*, 88.888.888/*)
    primeiros=$(echo "$cnpj" | tr -d '.' | cut -c1-8)
    if echo "$primeiros" | grep -qE '^([0-9])\1{7}$'; then continue; fi
    VIOLATIONS+="  CNPJ suspeito '$cnpj' em $file\n"
  done < <(grep -oE '[0-9]{2}\.[0-9]{3}\.[0-9]{3}/[0-9]{4}-[0-9]{2}' "$file" 2>/dev/null | sort -u)

  # 3. Emails corporativos nominais (nome.sobrenome@dominio ou nomesobrenome@dominio)
  while IFS= read -r email; do
    [ -z "$email" ] && continue
    local_part=$(echo "$email" | sed 's/@.*//')
    # Nao bloqueia se e um placeholder conhecido
    if ! echo "$local_part@" | grep -qiE "$PLACEHOLDER_EMAIL_REGEX"; then
      VIOLATIONS+="  Email possivelmente nominal '$email' em $file\n"
    fi
  done < <(grep -oiE '[a-z][a-z0-9._-]*@agenciacalifornia\.com\.br' "$file" 2>/dev/null | sort -u)

  # 4. CPFs sem mascara em migrations SQL (contexto: SQL VALUES/WHERE)
  if echo "$file" | grep -qE "\.sql$"; then
    while IFS= read -r cpfraw; do
      [ -z "$cpfraw" ] && continue
      # Pula se e placeholder
      if ! echo "$cpfraw" | grep -qE "$PLACEHOLDER_CPF_RAW_REGEX"; then
        # Pula se e sequencia 0-9 ou todos iguais (padrao de teste trivial)
        if ! echo "$cpfraw" | grep -qE "^(0{11}|1{11}|2{11}|3{11}|4{11}|5{11}|6{11}|7{11}|8{11}|9{11}|01234567890|12345678901)$"; then
          VIOLATIONS+="  CPF sem mascara suspeito '$cpfraw' em $file\n"
        fi
      fi
    done < <(grep -oE "'[0-9]{11}'" "$file" 2>/dev/null | tr -d "'" | sort -u)
  fi

done <<< "$FILES"

if [ -n "$VIOLATIONS" ]; then
  echo ""
  echo "============================================================"
  echo "  BLOQUEADO: dados pessoais reais detectados no commit"
  echo "============================================================"
  printf "%b" "$VIOLATIONS"
  echo ""
  echo "Troque por placeholders antes de commitar. Padroes aceitos:"
  echo "  CPF:   190.000.001-00 (folha), 110.000.001-00 (migration),"
  echo "         111.444.777-35 (teste), 000.000.000-00 (vazio)"
  echo "  CNPJ:  00.000.000/0001-00, 11.222.333/0001-81 (teste)"
  echo "  Email: colaborador_NNN@exemplo.com, pessoal_NNN@exemplo.com"
  echo ""
  echo "Se o padrao for falso positivo (ex: fixture institucional),"
  echo "adicione ao whitelist em scripts/check-pii.sh."
  echo "============================================================"
  exit 1
fi

exit 0
