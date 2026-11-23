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
IGNORE_PATHS_REGEX='^(node_modules/|\.git-filter-replacements\.txt|scripts/sanitize-pii|scripts/check-pii\.sh|scripts/pii-names-hashes\.txt|supabase/migrations/.*_task009_empresas\.sql$)'

# Arquivo com SHA-256 dos nomes reais conhecidos (um por linha). Regenerado por
# scripts/update-pii-names-hashes.sh contra o Supabase. Se nao existir, pula a
# vigia de nomes (acontece em clone novo antes do primeiro update).
# Pode ser sobrescrito via env PII_NAMES_HASHES_FILE (util pra testes).
NAMES_HASHES_FILE="${PII_NAMES_HASHES_FILE:-scripts/pii-names-hashes.txt}"
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

  # 5. Nome real de colaborador/freelancer conhecido (via hash SHA-256).
  # Extrai sequencias de 2+ palavras MAIUSCULAS consecutivas (candidatas a
  # nome completo), normaliza (perl faz unicode normalization + strip de acentos)
  # e checa se o hash bate com a lista conhecida.
  # Pula se faltar sha256sum ou perl, ou se arquivo for binario/grande.
  if [ -f "$NAMES_HASHES_FILE" ] && command -v sha256sum >/dev/null 2>&1 && command -v perl >/dev/null 2>&1; then
    tam=$(wc -c < "$file" 2>/dev/null || echo 0)
    if [ "$tam" -gt 0 ] && [ "$tam" -lt 2000000 ]; then
      # Extrai candidatos: 2+ palavras que PARECEM nome. Dois formatos aceitos:
      #   (a) CAPS: JOAO DA SILVA (regex: 2+ palavras com 2+ letras maiusculas)
      #   (b) Title: Joao Da Silva (regex: palavra que comeca com maiuscula + minusculas)
      # Admite tambem conectores minusculos (da, de, do, das, dos) no meio.
      candidatos=$(perl -CSD -ne '
        while (/((?:\p{Lu}{2,}(?:['\''\-]\p{Lu}+)?[ ]){1,}\p{Lu}{2,}(?:['\''\-]\p{Lu}+)?)/g) { print "$1\n" }
        while (/((?:\p{Lu}\p{Ll}+[ ](?:d[aeo]s?[ ])?){1,}\p{Lu}\p{Ll}+)/g) { print "$1\n" }
      ' "$file" 2>/dev/null | sort -u || true)

      while IFS= read -r candidato; do
        [ -z "$candidato" ] && continue
        # Normaliza: upper + NFD + remove acento + colapsa espaco + trim
        norm=$(printf '%s' "$candidato" | perl -CSD -MUnicode::Normalize -e '
          my $s = <STDIN>; chomp $s;
          $s = uc $s;
          $s = NFD($s);
          $s =~ s/\p{NonspacingMark}//g;
          $s =~ s/\s+/ /g;
          $s =~ s/^\s+|\s+$//g;
          print $s;
        ' 2>/dev/null || true)
        [ -z "$norm" ] && continue
        # So vale se tem 2+ palavras com 3+ letras cada apos normalizar
        echo "$norm" | grep -qE '^[A-Z]{3,}( [A-Z]{2,})+$' || continue
        # Pula placeholders obvios
        case "$norm" in
          "COLABORADOR EXEMPLO"|"FORNECEDOR EXEMPLO"|"PESSOA EXEMPLO"|"FULANO DE TAL"|"CICLANO DE TAL") continue;;
          "COLABORADOR "*" EXEMPLO"|"FORNECEDOR "*" EXEMPLO"|"PESSOA "*" EXEMPLO") continue;;
        esac
        h=$(printf '%s' "$norm" | sha256sum | cut -d' ' -f1)
        if grep -qxF "$h" "$NAMES_HASHES_FILE"; then
          VIOLATIONS+="  Nome real de colaborador/freelancer detectado em $file (hash $h)\n"
          VIOLATIONS+="  (o nome nao e exposto aqui; abra o arquivo e troque pelo placeholder COLABORADOR NNN EXEMPLO)\n"
        fi
      done <<< "$candidatos"
    fi
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
