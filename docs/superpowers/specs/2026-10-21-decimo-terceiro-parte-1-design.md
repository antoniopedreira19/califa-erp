# 13º Salário — Parte 1 (fundação)

Data: 2026-10-21 · Autor: brainstorm Antonio/Daniel

## Intenção

Primeira parte de um módulo novo em `/rh/decimo-terceiro`. O que a Parte 1 entrega:

- Entidades no banco que vão sustentar o módulo inteiro (`decimo_terceiro_folhas` e `decimo_terceiro_linhas`).
- Página de listagem de folhas de 13º (uma por ano).
- Ação "Criar folha de {ano}" que puxa colaboradores elegíveis, grava snapshot e calcula avos/parcelas automaticamente.
- Página de detalhe da folha que mostra a tabela gerada e permite edição manual linha a linha.

Fora da Parte 1 (vão em partes seguintes):

- Adiantamentos durante o ano (Parte 2).
- Fechar 1ª/2ª parcela e enviar lançamento pro financeiro (Parte 3).
- Retroativo de reajuste (Parte 4).
- Histórico no perfil do colaborador (Parte 5).
- Rescisões, afastamentos > 15 dias, licenças (Parte 6).

## Por quê

Hoje o 13º é calculado numa planilha Excel por fora do sistema. Isso tem três problemas:

1. **Zero histórico auditável.** A planilha de 2026 sobrescreve a de 2025. Impossível auditar quanto um colaborador recebeu em cada ano.
2. **Dado duplicado e defasado.** Salário, data de admissão, regime, cargo — tudo é redigitado na planilha e desatualiza silenciosamente em relação ao cadastro.
3. **O financeiro não vê.** Os lançamentos de 13º entram no financeiro à mão, sem rastreabilidade da origem.

A Parte 1 ataca o problema #2 (snapshot vindo do cadastro) e abre caminho pros problemas #1 e #3 nas partes seguintes.

## Decisão de modelagem: tabelas novas, não reusar `folhas_pagamento`

Existe uma tabela `folhas_pagamento` (folha mensal) com `tipo` enum (`salario`/`ferias`). Reutilizar adicionando `decimo_terceiro` ao enum **não funciona**:

- `folhas_pagamento` é indexada por `competencia_ano + competencia_mes`. 13º é anual.
- 13º tem 2 parcelas fixas (nov e dez) com descontos diferentes em cada uma. `folhas_pagamento` tem um único `data_pagamento`.
- 13º precisa de campos próprios (avos, 1ª parcela, 2ª parcela, INSS, IRRF, total adiantado durante o ano) que não cabem em `folhas_pagamento` sem distorcer o modelo original.

**Decisão:** tabelas separadas `decimo_terceiro_folhas` (uma por ano) e `decimo_terceiro_linhas` (uma por colaborador por folha). Mesmo padrão que RH já usa pra férias (`colaboradores_ferias_periodos` + `colaboradores_ferias_lancamentos`).

## O que a Parte 1 entrega — detalhado

### Banco

**Tabela `decimo_terceiro_folhas`**

Uma linha por (tenant, ano). Unique em (tenant_id, ano).

Campos:

- `id` uuid PK
- `tenant_id` uuid NOT NULL FK → tenants
- `ano` smallint NOT NULL (ex.: 2026)
- `status` enum `decimo_terceiro_folha_status` NOT NULL DEFAULT `'rascunho'`
  - Valores iniciais: `rascunho`
  - (Partes 3+ vão adicionar `fechada_parcial_1`, `fechada_parcial_2`, `concluida` ao enum)
- `criada_em`, `criada_por` (quem/quando rodou "Criar folha de {ano}")
- `recalculada_em`, `recalculada_por` (quem/quando rodou "Recalcular" — opcional na Parte 1, pode ficar NULL)
- `updated_at`, `created_at`

**Tabela `decimo_terceiro_linhas`**

Uma linha por (folha, colaborador). Unique em (folha_id, colaborador_id).

Campos de identificação:

- `id` uuid PK
- `tenant_id` uuid NOT NULL FK → tenants
- `folha_id` uuid NOT NULL FK → decimo_terceiro_folhas (cascade)
- `colaborador_id` uuid NOT NULL FK → colaboradores (restrict)

Campos de snapshot (gravados na criação da folha, puxados do cadastro — não se atualizam sozinhos depois):

- `snapshot_nome` text NOT NULL
- `snapshot_cpf` text NULL (pode faltar no cadastro)
- `snapshot_tipo_contratacao` enum `tipo_contratacao` NOT NULL
- `snapshot_funcao` text NOT NULL
- `snapshot_data_admissao` date NOT NULL
- `snapshot_salario` numeric(14,2) NOT NULL
- `snapshot_empresa_id` uuid NULL FK → empresas (pode faltar se alocação ausente)

Campos calculados automaticamente (podem ser sobrescritos manualmente):

- `avos` smallint NOT NULL — meses de direito (regra do dia 15, 0 a 12)
- `total_adiantado` numeric(14,2) NOT NULL DEFAULT 0 — vem dos adiantamentos (Parte 2). Na Parte 1 é sempre 0.
- `primeira_parcela` numeric(14,2) NOT NULL — `salario/12 * avos/2 - total_adiantado`
- `segunda_parcela` numeric(14,2) NOT NULL — `salario/12 * avos/2`
- `desconto_inss` numeric(14,2) NOT NULL DEFAULT 0 — só CLT. PJ/MEI = 0.
- `desconto_irrf` numeric(14,2) NOT NULL DEFAULT 0 — só CLT. PJ/MEI = 0.
- `total_bruto` numeric(14,2) NOT NULL — `primeira_parcela + segunda_parcela`
- `total_liquido` numeric(14,2) NOT NULL — `total_bruto - desconto_inss - desconto_irrf`

Campos de override manual (edição linha a linha):

- `editado_manualmente` boolean NOT NULL DEFAULT false
- `salario_editado` numeric(14,2) NULL — se preenchido, substitui `snapshot_salario` no recálculo
- `avos_editado` smallint NULL — se preenchido, substitui `avos` calculado
- `obs` text NULL

Campos de audit:

- `created_at`, `updated_at`, `created_by`, `updated_by`

**RLS, GRANT, índices** — padrão do projeto:

- RLS ligada nas duas tabelas.
- Policy de leitura/escrita para `authenticated` filtrada por `tenant_id = (select tenant_id from tenant_members where user_id = (select auth.uid()))`.
- Policy adicional de role: só perfil `rh` ou `administrador` pode escrever (mesmo gate que o resto do RH).
- GRANT para `authenticated`. Nada pra `anon`.
- Índice em `(tenant_id, ano)` em `decimo_terceiro_folhas`.
- Índice em `(folha_id)` e `(colaborador_id)` em `decimo_terceiro_linhas`.

### Elegibilidade: quem entra na folha ao criar

Ao rodar "Criar folha de {ano}", o sistema seleciona colaboradores da tabela `colaboradores` que atendem a:

- `tipo_contratacao` IN (`clt`, `clt_recibo`, `pj`, `mei`) — **estágio** e **sócio** ficam de fora
- E teve algum dia de vínculo no ano:
  - `data_admissao <= '{ano}-12-31'` AND (`data_encerramento` IS NULL OR `data_encerramento` >= `'{ano}-01-01'`)

Minha chamada que o usuário precisa conferir no fim:

- **Estágio fora** — não tem 13º por lei.
- **Sócio fora** — sócio recebe pró-labore, não 13º.
- **CLT recibo dentro** — é CLT, pega 13º normal.
- **Admitidos após 15/12 (avos = 0)** — a linha é criada com zeros e `obs` automática "Admitido após 15/12 — sem direito a avos". Fica listada pra transparência, mas não entra no total a pagar.

### Fonte do salário no snapshot

A tabela `colaboradores_salarios` tem salário vigente (`data_fim IS NULL`) para **todos os tipos de contratação** no banco atual (CLT, CLT recibo, PJ, MEI, estágio, sócio — todos têm linha). Então:

- `snapshot_salario` = `colaboradores_salarios.valor` da linha com `data_fim IS NULL` **no momento da criação da folha** (ou do recálculo).
- Se o salário mudou no ano (reajuste), o snapshot pega o valor **vigente hoje**. A diferença retroativa é tratada na **Parte 4** (Retroativo de reajuste), não aqui.

### Empresa do snapshot

A alocação em `colaboradores_alocacoes` pode ter N linhas vigentes (`data_fim IS NULL`) por colaborador, somando 100%. Pra Parte 1 a folha guarda apenas **uma** `snapshot_empresa_id` — a alocação vigente de **maior percentual** (ou a primeira por `created_at` se empatar). Rateio por empresa/regional entra em parte futura, junto com envio ao financeiro.

### Cálculo dos avos (regra do dia 15)

Lógica equivalente à da planilha atual:

```
if data_admissao > ano-12-31: avos = 0
elif data_admissao <= ano-01-01: avos = 12
elif dia(data_admissao) <= 15: avos = 13 - mes(data_admissao)
else: avos = 12 - mes(data_admissao)
```

Ignora rescisão no ano, afastamento > 15 dias e licença maternidade na Parte 1. Esses viram override manual por enquanto; tratados sistematicamente na Parte 6.

### Cálculo dos descontos (INSS e IRRF 2026)

Lógica: só se aplica em `tipo_contratacao` IN (`clt`, `clt_recibo`). **Base de cálculo = 13º bruto integral** (`salario/12 × avos`), não a 2ª parcela isolada. É a regra legal: INSS/IRRF do 13º é apurado sobre o valor cheio e todo o desconto é retido na 2ª parcela.

> **Divergência com a planilha atual:** a planilha aplica a tabela de IRRF sobre a 2ª parcela (`J2`), e o INSS está com fórmula quebrada (`#REF!`). O design aqui segue a lei, não a planilha. Pra conferir, o valor do novo cálculo vai bater com a planilha **só quando** `avos = 12` e o salário for alto o suficiente pra cair na faixa de 27,5% nas duas bases (coincidência matemática). Pros demais casos vai divergir — e vai estar mais certo que a planilha.

Tabelas progressivas de 2026:

**INSS 2026 (sobre 2ª parcela):**

- até R$ 1.518,00 → 7,5%
- até R$ 2.793,88 → 9% − R$ 22,77
- até R$ 4.190,83 → 12% − R$ 106,59
- até R$ 8.157,41 → 14% − R$ 190,40
- acima → teto R$ 8.157,41 × 14% − R$ 190,40

**IRRF 2026 (sobre 2ª parcela − INSS 2ª parcela):**

- até R$ 1.518,00 → 0
- até R$ 2.793,88 → 7,5% − R$ 169,44
- até R$ 4.190,83 → 15% − R$ 381,44
- até R$ 8.157,41 → 22,5% − R$ 662,77
- acima → 27,5% − R$ 896,00

Essas tabelas vão viver em `lib/decimo-terceiro/calc.ts` como constantes com o ano, não no banco. Facilita evolução pra 2027 (dupla as constantes com o ano novo). Se um dia virar necessário editar via UI, migra pra tabela.

### UI

**Página de listagem — `/rh/decimo-terceiro/page.tsx`**

- `PageHeader` com título "13º Salário" e botão "Criar folha de {próximo ano sem folha}" (ou desabilitado se já existe folha pro ano corrente).
- Lista de folhas (cards ou tabela) ordenada do mais recente pro mais antigo. Cada linha mostra: ano, status, nº de colaboradores, total bruto a pagar, criada em/por.
- Clicar na linha → `/rh/decimo-terceiro/{ano}`.

**Página de detalhe — `/rh/decimo-terceiro/[ano]/page.tsx`**

- `PageHeader` com título "13º {ano}" e badge de status.
- 4 KPI cards no topo: nº de colaboradores, total 1ª parcela, total 2ª parcela, total líquido final (padrão rico, conforme feedback_kpi_cards_ricos — ícone + delta + shadow-soft).
- Tabela com uma linha por colaborador: nome, empresa, tipo contratação, data admissão, salário (snapshot), avos, 1ª parc, 2ª parc, INSS, IRRF, total líquido, obs.
- Linha clicável abre modal/drawer de edição com os campos de override: salário editado, avos editado, obs. Ao salvar, recalcula apenas a linha editada e marca `editado_manualmente=true`.
- Botão "Recalcular folha" no topo recalcula todas as linhas que NÃO estão `editado_manualmente` (as editadas ficam preservadas).
- Botão "Exportar planilha" (XLSX) replica o layout da planilha atual pra conferência.

**Server actions — `/rh/decimo-terceiro/actions.ts`**

- `criarFolhaDecimoTerceiro(ano)` — valida que não existe folha do ano, seleciona colaboradores elegíveis, grava snapshot e campos calculados em transação.
- `recalcularFolhaDecimoTerceiro(folhaId)` — recalcula todas as linhas não editadas manualmente.
- `editarLinhaDecimoTerceiro(linhaId, { salario_editado, avos_editado, obs })` — edita override e recalcula a linha.
- `exportarFolhaDecimoTerceiroXlsx(folhaId)` — gera XLSX pra conferência.

Todas as actions chamam `audit_events` com a ação executada.

### Tipos TypeScript

Em `lib/types.ts` adicionar os tipos das duas tabelas novas, obedecendo CLAUDE.md ("lib/types.ts é escrito à mão, atualizar no mesmo commit da migration").

### Performance

Checklist obrigatório de `docs/PERFORMANCE.md`:

- Query de listagem usa agregação separada pra total/count, nunca embed pesado.
- Queries independentes na página de detalhe (folha + linhas + KPIs) usam `Promise.all`.
- `<Link>` da listagem de folhas (poucos itens, até 10) pode ficar com prefetch default.
- Migration nova com GRANT explícito e índice em todas as FKs.
- Policies RLS usam `(select auth.uid())`.

### Audit

Toda ação do módulo registra em `audit_events` com `acao_tentada`:

- `decimo_terceiro.folha.criada`
- `decimo_terceiro.folha.recalculada`
- `decimo_terceiro.linha.editada`
- `decimo_terceiro.folha.exportada`

## Metas (goals), não-metas (non-goals), anti-metas

**Metas:**

- Folha de 13º do ano fica salva, versionada e consultável a qualquer momento.
- Snapshot garante que a folha de 2026 nunca muda se o salário mudar em 2027.
- RH preenche uma única vez; sistema puxa 90% dos dados.
- Edição manual quando necessária, com rastreamento (`editado_manualmente`).

**Não-metas (ficam pra partes seguintes):**

- Adiantamentos durante o ano.
- Fechar parcela e enviar pro financeiro.
- Retroativo de reajuste.
- Rescisões, afastamentos e licenças tratados sistematicamente.
- Histórico no perfil do colaborador.

**Anti-metas (seria falha mesmo funcionando):**

- Linha de folha de ano fechado mudar silenciosamente por causa de edição de cadastro.
- Cálculo divergir da planilha Excel atual pra os casos simples (admissão limpa, salário vigente, sem retroativo).
- Depender da planilha Excel pra fonte da verdade — a planilha vira só exportação.

## Restrições

- CLAUDE.md: todo cadastro operacional nasce com `tenant_id`, RLS, GRANT explícito, auditoria, índices em FKs.
- `docs/FLUXO-BANCO.md`: migrations versionadas, aplicadas via MCP, commitadas junto do código.
- `docs/PERFORMANCE.md`: queries independentes paralelizadas, agregação separada, policies com `(select auth.uid())`.
- Ortografia: todas as strings de UI em pt-BR completo com acento.
- Nada de PII real em fixtures/migrations/samples do repo.

## O que fica a critério do builder

- Shape exato do dialog/drawer de edição (shadcn Dialog ou Drawer — ver gotchas em memory).
- Visual dos KPI cards (cores, ícones) — seguir padrão `/financeiro` conforme memory `feedback_kpi_cards_ricos`.
- Layout da planilha exportada (replicar as 2 primeiras abas da planilha atual: CLT e PJ).
- Nome das policies RLS (seguir padrão existente nos arquivos de migration do RH).
- Role gate das policies de escrita: `tenant_members.role in ('administrador', 'rh')`, igual ao padrão de férias.
- `created_by`/`updated_by` apontam pra `auth.users` direto, igual aos outros módulos de RH.
- Enum `decimo_terceiro_folha_status` nasce com apenas `'rascunho'`. Partes futuras adicionam valores com `alter type ... add value`, sozinhos na migration (regra do FLUXO-BANCO).
