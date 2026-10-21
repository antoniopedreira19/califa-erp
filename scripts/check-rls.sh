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

  echo "$CONTENT" | grep -oiE 'create policy [^;]+;' | while read -r POLICY; do
    echo "$POLICY" | grep -qiE 'for (select|all)' || continue
    echo "$POLICY" | grep -qiE "$SENSIVEIS_REGEX" || continue
    echo "$POLICY" | grep -qi 'is_tenant_member' || continue
    if ! echo "$POLICY" | grep -qiE 'is_tenant_admin|is_tenant_rh|is_tenant_financeiro'; then
      {
        echo ""
        echo "BLOQUEADO: $f"
        echo "  Policy de SELECT em entidade sensivel usando is_tenant_member sozinho."
        echo "  Padrao correto: USING (is_tenant_admin(...) OR is_tenant_rh(...) OR is_tenant_financeiro(...))."
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
