# Empresas Contábeis — Separação da dimensão contábil da gerencial

**Data:** 2026-09-11
**Status:** Aprovado para implementação (pendente revisão final do spec)

## Contexto

A Agência California opera com duas dimensões de classificação distintas no financeiro que hoje o sistema conflate numa única entidade `empresas`:

- **Gerencial** — como o negócio se organiza internamente: California, Hitlab, CCH. Cada uma se subdivide em regionais (California: NE/NO/RJ/SP/SS; Hitlab: Hitlab; CCH: Agency/Doca). É a visão pra decisão de negócio, orçamento e responsabilidade.
- **Contábil** — as pessoas jurídicas reais, definidas por CNPJ, donas das contas bancárias:
  - CALIFÓRNIA FILMES E PUBLICIDADE LTDA — CNPJ 19.437.976/0001-54
  - HITLAB PRODUÇÃO MUSICAL LTDA — CNPJ 04.409.741/0001-81
  - GO CRAZY CONSULTORIA E MARKETING LTDA — CNPJ 29.943.648/0001-83

As duas dimensões **não têm mapeamento 1:1**:
- CCH é 100% gerencial — não tem CNPJ próprio. As contas usadas pra pagar despesas de CCH pertencem a uma das 3 PJs contábeis, dependendo da conta.
- Um lançamento gerencial California-NE pago por uma conta da GoCrazy é: gerencialmente California-NE, contabilmente GoCrazy.
- GoCrazy nem existe hoje como empresa gerencial no sistema — só aparece informalmente no *nome* de algumas contas bancárias ("BB GoCrazy", "Santander GoCrazy", "XP GoCrazy").

O modelo atual não representa isso: `contas_bancarias.empresa_id` aponta pra `empresas` (a gerencial), o que é semanticamente errado — uma conta bancária pertence a uma PJ, não a uma empresa gerencial. Prova disso: **7 das 11 contas hoje estão com `empresa_id = NULL`** — o campo está órfão, não está sendo preenchido.

## Regra de negócio central

**A empresa contábil de um lançamento é sempre e exclusivamente derivada da conta bancária que o gera. Nunca é escolhida pelo usuário, nunca diverge da PJ dona da conta.**

Consequência: `lancamentos_financeiros` **não** ganha coluna nova. A contábil se lê por join via `conta_bancaria_id → contas_bancarias.empresa_contabil_id`.

## Modelo de dados

### Nova tabela `empresas_contabeis`

```sql
create table empresas_contabeis (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  razao_social  text not null,
  nome_fantasia text,
  cnpj          text not null,
  ativo         boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  constraint empresas_contabeis_cnpj_tenant_uk unique (tenant_id, cnpj)
);
```

- CNPJ armazenado só com dígitos (14 chars), consistente com `empresas.cnpj` atual.
- RLS: leitura/escrita restrita ao tenant do usuário. GRANT `select, insert, update, delete` pra `authenticated`. Nada pra `anon`.
- Índice em `(tenant_id, ativo)` pra filtros de dropdown.

**Seed inicial (mesmo migration ou migration separada de dados):**
- California Filmes e Publicidade LTDA — 19437976000154
- Hitlab Produção Musical LTDA — 04409741000181
- Go Crazy Consultoria e Marketing LTDA — 29943648000183

Todas ativas, tenant Agência California.

### Alteração em `contas_bancarias`

**Adiciona:**
```sql
alter table contas_bancarias
  add column empresa_contabil_id uuid references empresas_contabeis(id);
```

**Backfill (antes de tornar NOT NULL):**

Regras aplicadas na ordem, primeira que casar vence (evita `%Santander%` pegar "Santander GoCrazy"):

1. `nome ilike '%GoCrazy%'` OU `nome ilike '%Go Crazy%'` → **GoCrazy LTDA**. Casa: `BB GoCrazy`, `Santander GoCrazy`, `XP GoCrazy`.
2. `nome ilike '%Hitlab%'` → **Hitlab LTDA**. Casa: `Santander Hitlab`.
3. `nome ilike '%California%'` → **California LTDA**. Casa: `California Santander`, `BB California`, `Bradesco California`, `Paypal California`, `XP California`.
4. Restante → não casa; ficam pra decisão manual.

Contas ambíguas ou de teste esperadas pra decisão manual: `Conta Teste`, `ZZ Teste Fatia 2`. **Listar antes** e resolver com o Daniel na sessão de implementação — não chutar.

**Depois do backfill:**
```sql
alter table contas_bancarias
  alter column empresa_contabil_id set not null;

alter table contas_bancarias
  drop column empresa_id;
```

`empresa_id` (gerencial) é removido. Aprovado como destrutiva. Justificativa: 64% das linhas está NULL, o campo é semanticamente errado (conta pertence à PJ, não à empresa gerencial), e não há caso de uso legítimo pra "empresa gerencial dona da conta" — qualquer empresa gerencial usa qualquer conta.

**Índice:**
```sql
create index contas_bancarias_empresa_contabil_id_idx
  on contas_bancarias(empresa_contabil_id);
```

### `lancamentos_financeiros` — sem mudança de schema

A empresa contábil é obtida por join. Nenhuma coluna nova.

### View `vw_lancamentos_com_contabil`

Facilita relatórios sem forçar cada consumidor a lembrar do join:

```sql
create or replace view vw_lancamentos_com_contabil as
select
  lf.*,
  cb.empresa_contabil_id,
  ec.razao_social  as empresa_contabil_razao_social,
  ec.nome_fantasia as empresa_contabil_nome_fantasia,
  ec.cnpj          as empresa_contabil_cnpj
from lancamentos_financeiros lf
join contas_bancarias cb   on cb.id = lf.conta_bancaria_id
join empresas_contabeis ec on ec.id = cb.empresa_contabil_id;
```

GRANT SELECT pra `authenticated`.

### Tipos TypeScript

`lib/types.ts` recebe:
- Novo tipo `EmpresaContabil` com os campos da tabela.
- Ajuste em `ContaBancaria`: remove `empresa_id`, adiciona `empresa_contabil_id: string` (obrigatório) e, quando útil, `empresa_contabil?: EmpresaContabil` para joins.
- Tipo de view `LancamentoComContabil` opcional se algum consumidor tipa a view diretamente.

**Regra crítica (CLAUDE.md):** tipos e migration no mesmo commit. Passar o tipo completo, não estreitar (`EmpresaContabil` inteira, não `{ id, razao_social }`), pra não perder proteção do TypeScript.

## Superfícies de UI afetadas

### 1. Tela nova: Empresas Contábeis (aba)

Localização: dentro da tela atual de Empresas (`app/(app)/empresas/page.tsx` ou equivalente — a explorar na implementação), como uma **aba** ao lado da lista atual.

- Listagem com razão social, nome fantasia, CNPJ formatado, status ativo.
- CRUD completo: criar, editar, ativar/desativar. Não deletar (empresa contábil referenciada por conta e por lançamentos históricos).
- CNPJ com máscara e validação (dígito verificador). BrasilAPI opcional pra pré-preencher razão social (padrão já usado em fornecedores — reaproveitar hook).
- Audit event em criação/edição/desativação.

### 2. Cadastro/edição de conta bancária

- Substituir dropdown "Empresa" (gerencial, que hoje aponta pra `empresas`) por **"Empresa Contábil"** — dropdown obrigatório, alimentado por `empresas_contabeis` ativas do tenant.
- Descrição/label deixa claro que é a PJ titular da conta.

### 3. Telas de lançamento financeiro

- Adicionar coluna "Contábil" ao lado da coluna "Empresa" (gerencial). Mostra `nome_fantasia` da PJ; se estiver vazio, cai pra `razao_social`. Somente leitura — derivada da conta.
- Filtros: adicionar filtro por empresa contábil no header, em paralelo ao filtro de empresa gerencial existente.
- Formulário de novo lançamento: mostrar a empresa contábil ao selecionar a conta, como confirmação visual (não editável).

### 4. Relatórios afetados (a mapear na implementação)

Levantar na fase de implementação quais relatórios/dashboards financeiros precisam de segmentação por contábil. Candidatos: caixa, fluxo, DRE embrionário (quando existir). Ajuste caso a caso, sem tocar o que não precisa.

## Segurança / RLS / Performance

- **RLS** em `empresas_contabeis`: policy por `tenant_id = (select tenant_id from tenant_members where user_id = (select auth.uid()) limit 1)` — mesmo padrão do resto do schema.
- **GRANT** `select, insert, update, delete` pra `authenticated`. Nada pra `anon`.
- **Índice** em `(tenant_id, ativo)` na tabela nova + índice em `contas_bancarias.empresa_contabil_id`.
- **Performance:** a view `vw_lancamentos_com_contabil` só faz sentido pra relatórios; telas transacionais devem continuar consultando `lancamentos_financeiros` direto e resolver a contábil via prop, seguindo `docs/PERFORMANCE.md` (nada de embed pesado onde só se precisa contar/somar).

## Auditoria

Registrar eventos em `audit_events`:
- `empresa_contabil.criada`
- `empresa_contabil.atualizada`
- `empresa_contabil.desativada`
- `conta_bancaria.empresa_contabil_alterada` (quando o usuário troca a PJ de uma conta existente — evento de alto impacto contábil)

## Migração e ordem de execução

Uma migration destrutiva não se aplica sozinha (regra do CLAUDE.md). Ordem prevista, com confirmação explícita no ponto destrutivo:

1. **Migration aditiva** — cria `empresas_contabeis`, RLS, policies, GRANT, índice.
2. **Migration de seed** — insere as 3 PJs contábeis pra tenant California.
3. **Migration aditiva** — adiciona `empresa_contabil_id` (nullable) em `contas_bancarias`, cria índice.
4. **Backfill** — script que preenche `empresa_contabil_id` das 11 contas. Contas ambíguas são LISTADAS pra decisão manual antes do próximo passo — não são chutadas.
5. **Verificação MCP** — confirma que todas as 11 contas têm `empresa_contabil_id` preenchido.
6. **Migration destrutiva (confirmação explícita)** — torna `empresa_contabil_id` NOT NULL, remove `empresa_id`.
7. **Migration da view** — cria `vw_lancamentos_com_contabil`.
8. **Tipos TS** atualizados no mesmo commit do frontend que os consome.
9. **Frontend** — tela nova, edição de conta bancária, colunas/filtros de lançamentos.

Cada passo commitado separadamente pra rollback granular.

## Fora de escopo

- **DRE contábil** — a segregação por PJ contábil é a base pra DRE contábil, mas o DRE em si continua fora do MVP (CLAUDE.md).
- **Split de lançamento entre múltiplas contábeis** — não existe: 1 lançamento = 1 conta = 1 contábil.
- **Override manual da contábil** — não previsto. Se surgir demanda depois, entra como coluna opcional em `lancamentos_financeiros`.
- **Emissão de NF por contábil** — fora do escopo do MVP financeiro.
- **Empresa gerencial "GoCrazy"** — não vai virar empresa gerencial. GoCrazy é PJ contábil e ponto; gerencialmente segue como California/Hitlab/CCH.

## Riscos e mitigações

- **Contas ambíguas no backfill** — mitigado por listagem manual antes do NOT NULL.
- **Código que hoje lê `contas_bancarias.empresa_id`** — precisa ser mapeado antes da remoção destrutiva. Grep em `contas_bancarias` no frontend e nas views. Se algum lugar usa, precisa migrar pra `empresa_contabil_id` ou remover a dependência.
- **Relatórios existentes que filtram por empresa gerencial via conta** — nenhum deveria fazer isso (semanticamente errado), mas verificar.
- **Confusão de nomenclatura na UI** — mitigado por labels explícitos ("Empresa (Gerencial)" vs "Empresa Contábil") e pela colocação lado a lado nas telas.
