# 203 — RLS de dado pessoal é restrito a admin + rh + financeiro

**Data:** 2026-10-21
**Status:** aceita e implementada em 21/10/2026 (migration `20261021000005_fechar_rls_freelancers_e_buckets.sql`, guard-rail `scripts/check-rls.sh`).
**Quem decidiu:** Daniel, depois do relatório de auditoria do dia que confirmou vazamento ao vivo em `freelancers`, `freelancer_contratos`, `colaboradores_nf_anexos` e nos buckets `freelancer-arquivos` e `colaboradores-nf`.
**Migration:** `20261021000005_fechar_rls_freelancers_e_buckets.sql`.

## O problema

A função `is_tenant_member(tenant_id)` resolve `true` pra qualquer linha de `tenant_members` com `status = 'ativo'`, **sem filtrar por role**. Então uma policy escrita como

```sql
USING (is_tenant_member(tenant_id))
```

libera leitura pra admin, rh, financeiro, gerente_producao, produtor **e freelancer** — todas as 6 roles ativas do tenant.

Isso foi usado em:

| Entidade | Policy afetada | O que vazava |
|---|---|---|
| `public.freelancers` | `freelancers_select` | CPF, email, telefone, dados pessoais de 221 cadastros (210 com CPF). |
| `public.freelancer_contratos` | `freelancer_contratos_select` | Valor, duração, cláusulas de contrato de freelancer. |
| `public.colaboradores_nf_anexos` | `nf_anexos_select` (+ insert/update/delete) | NF fiscal de colaborador. |
| storage `freelancer-arquivos` | `freelancer_arquivos_select` | Listagem (738 objetos) + download. |
| storage `colaboradores-nf` | `nf_bucket_select` (+ demais) | Listagem + download de NF. |

Distribuição de roles ativas no tenant em 21/10/2026: 7 admin, 2 rh, 4 financeiro, 49 gerente_producao, 32 produtor, 7 freelancer. **Dos 101 usuários ativos, 92 (91%) tinham acesso a dado pessoal que não deveriam ter.**

Comparação: `colaboradores` e `colaboradores_salarios` já estavam no padrão certo (`is_tenant_admin OR is_tenant_rh`), então o gap era de inconsistência, não de arquitetura.

## A regra

**Toda tabela ou bucket com dado pessoal protegido** (CPF, email, telefone, data de nascimento, salário, valor de contrato, documento fiscal) tem policy de SELECT no formato:

```sql
USING (
  is_tenant_admin(tenant_id)
  OR is_tenant_rh(tenant_id)
  OR is_tenant_financeiro(tenant_id)
)
```

Nunca `is_tenant_member` sozinho.

Para buckets, o `tenant_id` vem do primeiro segmento do path:

```sql
USING (
  bucket_id = '<nome>'
  AND (
    is_tenant_admin((split_part(name, '/', 1))::uuid)
    OR is_tenant_rh((split_part(name, '/', 1))::uuid)
    OR is_tenant_financeiro((split_part(name, '/', 1))::uuid)
  )
)
```

## Exceções

Entidades operacionais que **não** carregam dado pessoal (ex.: `pedidos-compra`, `envios-faturamento`) podem continuar com `is_tenant_member` combinado com whitelist de `session_role` — já é o padrão delas e segue funcionando.

Se um caso novo exigir `is_tenant_member` numa tabela sensível (ex.: freelancer vê a própria linha), ele vai via **função SECURITY DEFINER específica** que filtra por `auth.uid()`, nunca abrindo a tabela inteira. E a migration precisa carregar o comentário `-- rls-member-ok: <motivo>` pra escapar do guard-rail do pre-commit.

## O guard-rail

`scripts/check-rls.sh` roda no pre-commit (via `.githooks/pre-commit`) e bloqueia migration que:

1. É `supabase/migrations/*.sql`.
2. Cria `policy ... for select` ou `for all`.
3. Toca uma das entidades sensíveis listadas no `SENSIVEIS_REGEX` do script.
4. Usa `is_tenant_member` **sem** combinar com `is_tenant_admin|is_tenant_rh|is_tenant_financeiro`.
5. Não tem o escape `-- rls-member-ok` no arquivo.

Quando entidade nova com dado pessoal nasce (ex.: `rh_rescisoes`, `folha_decimo_terceiro_itens`), adicionar o nome dela ao `SENSIVEIS_REGEX`. É manutenção de 10 segundos.

## O que não resolve essa decisão

- **Clones públicos antigos do repo** com migrations contendo CPF estão listados no `CLAUDE.md` como dívida. Essa decisão é só sobre o banco ao vivo e o fluxo pra frente — não sobre histórico do git.
- **Self-service do freelancer** (freelancer vê a própria linha): não existe hoje, e quando entrar vai via função definer, não via SELECT direto.
- **Audit log de quem leu o quê** nos 92 usuários que tinham acesso indevido: ficou de fora. Supabase não loga SELECT por default. Se virar política interna, abrir decisão separada.

## Rastros técnicos

Migration: `supabase/migrations/20261021000005_fechar_rls_freelancers_e_buckets.sql`
Guard-rail: `scripts/check-rls.sh`
Wire no pre-commit: `.githooks/pre-commit`
Commit: `a9656653` — `security(rls): freelancers/anexos/buckets fecham para admin+rh+financeiro`
Handoff: `docs/handoffs/2026-10-21-vazamento-pii-fase-2.md`
