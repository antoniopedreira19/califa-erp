#!/usr/bin/env bash
# Bloqueia commit se uma migration SQL criar policy de SELECT em tabela
# com dado pessoal usando is_tenant_member sozinho.
#
# Historia: em outubro/2026 descobrimos que freelancers, freelancer_contratos,
# colaboradores_nf_anexos e os buckets freelancer-arquivos/colaboradores-nf
# usavam `USING (is_tenant_member(tenant_id))`, o que libera leitura pra
# QUALQUER role ativa do tenant (inclusive freelancer e produtor). Resultado:
# CPF+email+telefone de 221 cadastros e 738 arquivos acessiveis a 92 usuarios
# que nao deveriam ver. Essa trava existe pra nunca mais passar sem revisao.
#
# Padrao correto pra dado pessoal:
#   USING (is_tenant_admin(tenant_id) OR is_tenant_rh(tenant_id)
#          OR is_tenant_financeiro(tenant_id))
#
# Desde 16/11/2026 (migrations 20261116990001 e 20261120100001, ver o caso 4
# de docs/PERFORMANCE.md) as policies usam a forma de conjunto, que roda uma
# vez por consulta e quer dizer a MESMA coisa:
#   tenant_id IN (SELECT current_tenant_ids())        == is_tenant_member
#   tenant_id IN (SELECT current_tenant_ids_com_papel('administrador'|'rh'|
#                 'financeiro'))                      == is_tenant_admin/rh/financeiro
# A trava reconhece as duas formas. Olha CREATE POLICY de SELECT/ALL e
# ALTER POLICY com USING (o ALTER nao diz o comando; na duvida, confere).
#
# Se o caso novo for legitimamente "member", documente no proprio arquivo
# com um comentario `-- rls-member-ok: motivo`.

set -euo pipefail

# Tabelas/buckets com dado pessoal. Edite esta lista quando criar entidade nova.
SENSIVEIS_REGEX='freelancers|freelancer_contratos|colaboradores|colaboradores_salarios|colaboradores_nf_anexos|colaborador_beneficio|folhas|folha_itens|folha_tipo|freelancer_arquivos|colaboradores_nf|rh_[a-z_]+'

if [ -z "${PRE_COMMIT_FILES:-}" ]; then
  FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '^supabase/migrations/.*\.sql$' || true)
else
  FILES=$(echo "$PRE_COMMIT_FILES" | tr ' ' '\n' | grep -E '^supabase/migrations/.*\.sql$' || true)
fi

[ -z "$FILES" ] && exit 0

TMP=$(mktemp)
trap "rm -f $TMP" EXIT

for f in $FILES; do
  [ -f "$f" ] || continue

  # Escape global do arquivo: documento explicito que a policy member e proposital.
  if grep -qi 'rls-member-ok' "$f"; then
    continue
  fi

  # Normaliza multi-linha em espaco pra regex pegar policies compridas.
  CONTENT=$(tr '\n' ' ' < "$f" | tr -s ' ')

  # `|| true` evita pipefail quando a migration nao tem CREATE POLICY
  # (ex: migrations so de funcoes/grants/indices). Sem isso, grep retorna
  # 1 por "no match" e `set -o pipefail` derruba o hook inteiro.
  echo "$CONTENT" | { grep -oiE '(create|alter) policy [^;]+;' || true; } | while read -r POLICY; do
    if echo "$POLICY" | grep -qiE '^create'; then
      echo "$POLICY" | grep -qiE 'for (select|all)' || continue
    else
      echo "$POLICY" | grep -qiE '[[:space:]]using[[:space:]]*\(' || continue
    fi
    echo "$POLICY" | grep -qiE "$SENSIVEIS_REGEX" || continue
    # Membro do tenant, nas duas formas. `current_tenant_ids()` com o "()"
    # logo depois nao casa com `current_tenant_ids_com_papel(...)`.
    echo "$POLICY" | grep -qiE 'is_tenant_member|current_tenant_ids\(\)' || continue
    if ! echo "$POLICY" | grep -qiE "is_tenant_admin|is_tenant_rh|is_tenant_financeiro|current_tenant_ids_com_papel\([[:space:]]*'(administrador|rh|financeiro)'"; then
      {
        echo ""
        echo "BLOQUEADO: $f"
        echo "  Policy de leitura em entidade sensivel liberada a qualquer membro do tenant"
        echo "  (is_tenant_member ou current_tenant_ids() sozinho)."
        echo "  Padrao correto: USING (is_tenant_admin(...) OR is_tenant_rh(...) OR is_tenant_financeiro(...)),"
        echo "  ou a forma de conjunto: tenant_id IN (SELECT current_tenant_ids_com_papel('administrador'|'rh'|'financeiro'))."
        echo "  Se for intencional, adicione o comentario '-- rls-member-ok: <motivo>' no arquivo."
        echo "  Policy:"
        echo "$POLICY" | sed 's/^/    /' | fold -s -w 100
      } >> "$TMP"
    fi
  done
done

if [ -s "$TMP" ]; then
  cat "$TMP"
  echo ""
  echo "Ajuste a migration ou use o escape 'rls-member-ok' com motivo."
  exit 1
fi

exit 0
