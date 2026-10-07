# Folha de pagamento em dois fluxos (PJ gerada e CLT importada)

Data: 2026-10-06
Status: Design aprovado em brainstorm. Pendente de revisão e aprovação do spec antes do plano de implementação.

## Problema

Hoje `gerarFolha(ano, mes)` em [app/(app)/rh/folhas/actions.ts](../../../app/(app)/rh/folhas/actions.ts) varre **todos** os colaboradores ativos no mês, sem distinção de `tipo_contratacao`. A California, porém, só paga diretamente os colaboradores PJ/MEI e a parte Recibo (RPA) dos híbridos CLT+Recibo. A parte CLT dos híbridos e os colaboradores CLT puros são calculados externamente pela contabilidade, que entrega mensalmente uma planilha com os valores a pagar.

A consequência é que a California gera, aprova e paga internamente linhas de folha que, no mundo real, não são responsabilidade dela — ou que estão com valor incorreto (no caso do híbrido, o `salario_base` da folha gerada é o total do contrato, não a parte Recibo).

## Entendimento do pedido

- **Fluxo PJ**: sistema gera a partir do cadastro de colaboradores. Entram `pj`, `mei` e a parte Recibo dos `clt_recibo`.
- **Fluxo CLT**: planilha mensal da contabilidade é importada. Entram `clt` puros e a parte CLT dos `clt_recibo`.
- Nenhum lado é opcional no caso de uso normal da California: toda competência tem PJ a gerar e CLT a importar.
- Depois que ambos existem, o RH **envia a competência inteira ao financeiro** num passo explícito. A aprovação em `/financeiro/contas-a-pagar` e a geração de `contas_avulsas` seguem exatamente o fluxo atual.
- Linguagem na UI é **PJ** e **CLT**. A palavra "Recibo" não aparece na UI — fica só no cadastro técnico do contrato.

## Matriz tipo × fluxo

A ponte entre `tipo_contratacao` e os dois fluxos:

| `tipo_contratacao` | Fluxo PJ (gera, origem=california)    | Fluxo CLT (importa, origem=contabilidade) |
| ------------------ | ------------------------------------- | ----------------------------------------- |
| `pj`               | ✓ `salario_base = valor` (total)      | —                                         |
| `mei`              | ✓ `salario_base = valor` (total)      | —                                         |
| `clt_recibo`       | ✓ `salario_base = valor_recibo` (RPA) | ✓ `salario_base = valor da planilha` (CLT)|
| `clt`              | —                                     | ✓ `salario_base = valor da planilha`      |
| `estagio`          | —                                     | ✓ `salario_base = valor da planilha`      |
| `socio`            | —                                     | ✓ `salario_base = valor da planilha`      |

**O híbrido (`clt_recibo`) é o único tipo que aparece nos dois fluxos.** As duas linhas são complementares, não duplicadas: valor Recibo (gerado) + valor CLT (importado) = total do contrato. O `valor` em `colaboradores_salarios` continua sendo o total do contrato; `valor_recibo` guarda só a fatia. A fatia CLT **não fica armazenada no cadastro** — ela vem da planilha porque é a contabilidade que calcula com encargos.

## Decisões de design

### D1 — Mesma tabela `folhas_pagamento`, discriminada por `origem`

As duas origens produzem linhas no mesmo lugar: `folhas_pagamento`. A diferença é um enum `folha_origem` com valores `'california'` (gerada) e `'contabilidade'` (importada).

Motivo: a aprovação, o rateio por alocação, a propagação para Camada 1 (D8 do módulo RH) e a geração de `contas_avulsas` já funcionam. Fragmentar em duas tabelas duplicaria todos esses caminhos sem ganho — a origem é um atributo da linha, não um domínio separado.

Permitir que um híbrido tenha **duas linhas na mesma competência** (uma por origem) é o core da divisão. A unique antiga `(tenant_id, competencia_ano, competencia_mes, colaborador_id)` passa a incluir `origem`.

### D2 — Split do híbrido em `colaboradores_salarios.valor_recibo`

Para `clt_recibo`, o salário vigente passa a ter duas partes:

- `valor` continua sendo o **total mensal** do colaborador.
- Nova coluna `valor_recibo numeric(14,2)` guarda a parcela Recibo.
- A parcela CLT é derivada por diferença (`valor - valor_recibo`); não é armazenada.

CHECK: `valor_recibo IS NOT NULL` se, e somente se, o colaborador é `clt_recibo`. Para todos os outros tipos (`pj`, `mei`, `clt`, `estagio`), `valor_recibo` fica NULL.

**Backfill**: todos os `clt_recibo` existentes recebem `valor_recibo = valor / 2` (split 50/50 inicial). O operador ajusta manualmente depois, caso a caso. Vale para a linha vigente (`data_fim IS NULL`) e também para o histórico fechado, para que relatórios por competência passada permaneçam coerentes.

Nomenclatura: o campo técnico mantém o nome contratual (`valor_recibo`, RPA é o instrumento legal). A UI chama o fluxo de "PJ" porque é a linguagem do operador. Essa divergência está documentada aqui para quem for ler o schema.

### D3 — Importação idempotente por hash, não cria colaborador

A contabilidade entrega mensalmente um **PDF** chamado "Relação Geral dos Líquidos" (não planilha Excel). O PDF tem estrutura tabular com três seções fixas:

- **Empregados** — colaboradores CLT (puros e parte CLT dos híbridos).
- **Estagiários** — bolsistas.
- **Contribuintes** — sócios (contribuinte individual, terminologia INSS).

Cada linha: `código_interno_contabilidade | nome | CPF | valor líquido | data de pagamento`.

Rodapé com totalizadores (contagem por seção + total da empresa).

Importante: o PDF traz **só o valor líquido a pagar** por colaborador. Encargos (FGTS, INSS patronal, IR Retido) são repasses a União/Caixa que vêm por **outros documentos** (GRCS, DARF, GFIP) e **ficam fora deste fluxo** — a contabilidade os entrega e processa por outro circuito do financeiro.

A importação é uma server action `importarFolhaContabilidade(ano, mes, arquivo)`:

1. Calcula SHA-256 do PDF. Se já existe `folha_importacoes` com mesmo hash e competência, aborta e devolve o resultado anterior (idempotência).
2. Parser (`pdf-parse`) extrai texto do PDF e identifica as três seções pelos cabeçalhos.
3. Valida competência do PDF contra `(ano, mes)` passados; divergência → erro bloqueante.
4. Para cada linha de cada seção, extrai `{ secao, nome, cpf, valor, data_pagamento }` e normaliza CPF (remove máscara).
5. Match por `cpf_cnpj` contra `colaboradores`:

   | Seção PDF    | Tipo aceito              | `salario_base`     |
   | ------------ | ------------------------ | ------------------ |
   | Empregados   | `clt`, `clt_recibo`      | valor do PDF (parte CLT) |
   | Estagiários  | `estagio`                | valor do PDF       |
   | Contribuintes| `socio`                  | valor do PDF       |

6. Para match na seção certa: UPSERT em `folhas_pagamento` conforme regras do D1 (ver fluxo detalhado em "Fluxo backend").
7. Para match em seção errada (ex: estagiário cadastrado como `clt`): warning "colaborador cadastrado como X, encontrado na seção Y, ignorado".
8. Sem match (CPF não encontrado): warning "colaborador não cadastrado, ignorado". **Não cria colaborador novo** — isso é problema de cadastro, não de importação.
9. Grava `folha_importacoes` (auditoria) com totais, warnings e os totalizadores do rodapé do PDF (pra conferir que a importação bateu com o que a contabilidade mandou).

**Reimportação com hash novo** (PDF corrigido): atualiza apenas linhas em `status='rascunho'`. Linhas já em `enviada`/`aprovada` ficam intactas e geram warning.

A rota dedicada `/rh/folhas/importar` **não existe**: o upload é um modal/drawer disparado da própria `/rh/folhas` (ver D5).

### D4 — Envio ao financeiro é passo explícito

`gerarFolha` e `importarFolhaContabilidade` nascem com `status='rascunho'`. **Nada aparece no financeiro ainda.**

Nova server action `enviarCompetencia(ano, mes)` vira todos os rascunhos da competência (das duas origens) em `status='enviada'`. A partir daí, o fluxo em `/financeiro/contas-a-pagar` aba "Folhas de Pagamento" é o atual: aprovar linha → gera `contas_avulsas`.

Motivo: o fechamento de competência é um ato gerencial deliberado, não um efeito colateral de "gerar" ou "importar". O rascunho permite revisar, corrigir, reimportar.

### D5 — UI orientada por competência, dois pontos de criação

`/rh/folhas` passa a ser orientada por competência selecionada. Para cada competência:

- Dois **checkpoints**: ☑ PJ gerada / ☑ CLT importada (derivados por `EXISTS` de linhas por origem).
- Enquanto um dos lados não existe: ☐ + botão inline ("Gerar PJ" / "Importar CLT").
- Quando ambos existem: botão **"Enviar ao financeiro"** fica habilitado.
- Lista abaixo, agrupada em duas seções visuais: **PJ** e **CLT**. Cada linha mostra colaborador, valor, status. Híbrido aparece nas duas seções, sem a palavra "Recibo".

Rótulo da linha segue o **fluxo** (PJ / CLT), não o `tipo_contratacao` do colaborador.

### D6 — Plano de contas discriminado em `contas_avulsas`

Hoje o mapeamento em [actions-folhas.ts](../../../app/(app)/financeiro/contas-a-pagar/actions-folhas.ts) é por `tipo_contratacao` só, e tem imprecisões:
- `pj`/`mei`/`socio` todos vão pro `05.011 ProLabore` — mas ProLabore é especificamente de sócio.
- `clt`/`clt_recibo` vão pro `05.001 Salário` — mas Recibo (RPA) é prestação de serviço de pessoa física, não salário CLT.

O plano de contas real da California (categoria `05 Despesa com Pessoal`) tem 14 subtipos: Salário, Benefícios, Bonificação, 13º Salário, Estagiário, Férias, FGTS, INSS, IR Retido, Outros, ProLabore, Processo trabalhista, Rescisão, Transporte.

**Pré-requisito da implementação:** criar o subtipo **`05.015 Serviços de Terceiros (PJ)`** em `plano_contas_subtipos` (via UI do financeiro em `/financeiro/cadastros/plano-de-contas`, ou migration de seed). PJ, MEI e a parte Recibo do híbrido vão todos pra lá — a California prefere colapsar PJ e RPA no mesmo subtipo (separação fiscal entre PJ e PF autônomo não é prioridade no DRE gerencial).

Mapeamento final:

| origem         | tipo              | subtipo plano de contas                      |
| -------------- | ----------------- | -------------------------------------------- |
| california     | `pj`, `mei`       | **05.015 Serviços de Terceiros (PJ)** (novo) |
| california     | `clt_recibo`      | **05.015 Serviços de Terceiros (PJ)** (parte Recibo) |
| contabilidade  | `clt`             | 05.001 Salário                               |
| contabilidade  | `clt_recibo`      | 05.001 Salário (parte CLT)                   |
| contabilidade  | `estagio`         | 05.005 Estagiário                            |
| contabilidade  | `socio`           | 05.011 ProLabore                             |

Como `contas_avulsas` referencia plano de contas por **FK** (`plano_conta_tipo_id`, `plano_conta_subtipo_id`), não por string, o mapeamento em código resolve os IDs via lookup pelos códigos (uma consulta de resolução no startup da action, cacheada por request).

## Modelo de dados — migrations

Todas as migrations seguem [docs/FLUXO-BANCO.md](../../FLUXO-BANCO.md): ler o banco pelo MCP antes de escrever, aplicar via `apply_migration`, conferir pelo MCP, commitar junto do código que depende. GRANT para `authenticated` em qualquer tabela nova; RLS planejado desde o início; `(select auth.uid())` nas policies.

### Migration — enum `folha_origem`

```sql
CREATE TYPE folha_origem AS ENUM ('california', 'contabilidade');
```

### Migration — `colaboradores_salarios.valor_recibo`

```sql
ALTER TABLE colaboradores_salarios
  ADD COLUMN valor_recibo numeric(14,2) NULL;

-- CHECK: valor_recibo preenchido se e somente se o colaborador é clt_recibo
-- (implementado via trigger, porque CHECK em coluna de outra tabela não existe em pg)
```

Trigger (`BEFORE INSERT OR UPDATE`) consulta `colaboradores.tipo_contratacao` e exige coerência.

**Backfill** (confirmação explícita necessária — mexe em dado existente, exigido pelo `docs/FLUXO-BANCO.md`):

```sql
UPDATE colaboradores_salarios cs
SET valor_recibo = round(cs.valor / 2, 2)
FROM colaboradores c
WHERE c.id = cs.colaborador_id
  AND c.tipo_contratacao = 'clt_recibo'
  AND cs.valor_recibo IS NULL;
```

Vale para linhas vigentes e histórico fechado.

Atualizar `lib/types.ts` no mesmo commit.

### Migration — `folhas_pagamento.origem` e `data_pagamento_prevista`

```sql
ALTER TABLE folhas_pagamento
  ADD COLUMN origem folha_origem NOT NULL DEFAULT 'california',
  ADD COLUMN data_pagamento_prevista date NULL;

-- Nome real da unique antiga deve ser confirmado pelo MCP antes de aplicar.
-- Padrão gerado pelo postgres é folhas_pagamento_<cols>_key.
ALTER TABLE folhas_pagamento
  DROP CONSTRAINT <nome_unique_antiga>;

ALTER TABLE folhas_pagamento
  ADD CONSTRAINT folhas_pagamento_tenant_ano_mes_colab_origem_key
  UNIQUE (tenant_id, competencia_ano, competencia_mes, colaborador_id, origem);

CREATE INDEX folhas_pagamento_competencia_origem_idx
  ON folhas_pagamento (tenant_id, competencia_ano, competencia_mes, origem);
```

`data_pagamento_prevista` é preenchida pela importação a partir da coluna "Data de pagamento" do PDF. Para linhas geradas pela California (fluxo PJ), fica NULL (pagamento segue regra do financeiro).

Linhas existentes já ficam marcadas como `california` pelo DEFAULT, que é o comportamento certo (foram todas geradas internamente).

### Migration — tabela `folha_importacoes`

Mesmo padrão de `orcamento_importacoes` (Task 004):

```sql
CREATE TABLE folha_importacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  competencia_ano int NOT NULL,
  competencia_mes int NOT NULL,
  arquivo_nome text NOT NULL,
  arquivo_hash text NOT NULL,
  linhas_total int NOT NULL,
  linhas_criadas int NOT NULL,
  linhas_atualizadas int NOT NULL,
  linhas_ignoradas int NOT NULL,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  totalizadores_pdf jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by uuid NOT NULL REFERENCES profiles(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX folha_importacoes_hash_competencia_idx
  ON folha_importacoes (tenant_id, competencia_ano, competencia_mes, arquivo_hash);

-- RLS + policies por tenant_id
-- GRANT SELECT, INSERT ON folha_importacoes TO authenticated;
```

`totalizadores_pdf` guarda o snapshot do rodapé do PDF: `{ empregados: 30, estagiarios: 2, contribuintes: 1, total: 125281.45 }` pra conferência futura.

## Fluxo backend

### `gerarFolha(ano, mes)` — alterações

Em [app/(app)/rh/folhas/actions.ts](../../../app/(app)/rh/folhas/actions.ts):

1. Filtro de colaboradores passa a ser `tipo_contratacao IN ('pj', 'mei', 'clt_recibo')`. `clt`, `estagio` e `socio` saem — vão todos pelo fluxo CLT (importação).
2. Para cada colaborador selecionado:
   - Se `tipo_contratacao = 'clt_recibo'`: `salario_base = colaboradores_salarios.valor_recibo` (parte RPA, não o total).
   - Caso contrário (`pj`, `mei`): `salario_base = colaboradores_salarios.valor`.
3. Linhas nascem com `status='rascunho'`, `origem='california'`.
4. Comportamento D1 (admitidos/demitidos no mês), D2 (editável), D3 (snapshot de alocações) inalterado.
5. Idempotência: `ON CONFLICT (tenant_id, competencia_ano, competencia_mes, colaborador_id, origem) DO NOTHING` para permitir re-executar sem duplicar.

### `importarFolhaContabilidade(ano, mes, arquivoBuffer)` — nova server action

Em `app/(app)/rh/folhas/actions.ts` ou arquivo irmão:

1. Hash SHA-256 do PDF.
2. Lookup em `folha_importacoes (tenant_id, ano, mes, arquivo_hash)` — se já existe, aborta e devolve o resultado anterior.
3. Parser (`pdf-parse`, nova dependência) extrai texto do PDF.
4. Identificação de seções pelos cabeçalhos "Empregados", "Estagiários", "Contribuintes". Cada seção fica entre o cabeçalho e o próximo cabeçalho/rodapé.
5. Validação do header do PDF:
   - CNPJ do emissor bate com o tenant atual.
   - Competência do PDF bate com `(ano, mes)` passados; divergência → erro bloqueante.
6. Extração das linhas de cada seção via regex (formato `cod nome CPF valor data`). Normalização de CPF (remove pontos/traços) e valor (vírgula → ponto decimal).
7. Para cada linha:
   - Match por `cpf_cnpj` contra `colaboradores`.
   - Validação de que o `tipo_contratacao` casa com a seção do PDF (tabela do D3).
   - Se casa:
     - Consulta linha existente em `folhas_pagamento` por `(tenant, ano, mes, colaborador_id, origem='contabilidade')`.
     - **Não existe** → INSERT com `salario_base = valor do PDF`, `status='rascunho'`, snapshot de alocações da Camada 1 em `folhas_pagamento_alocacoes`, `data_pagamento_planilha = data do PDF`. Conta como "criada".
     - **Existe em `status='rascunho'`** → UPDATE de `salario_base` e `data_pagamento_planilha` (preserva alocações já editadas). Conta como "atualizada".
     - **Existe em `status IN ('enviada','aprovada','paga')`** → **não altera**, warning "linha já X, não sobrescrita". Conta como "ignorada".
   - Se não casa (seção errada, sem match, tipo incompatível): warning específico, não grava.
8. Validação final: soma dos valores importados por seção bate com os totalizadores do rodapé do PDF; divergência → warning (não bloqueia, mas sinaliza possível problema de parsing).
9. Grava `folha_importacoes` com totais, warnings e snapshot dos totalizadores do PDF.
10. Retorna o resumo pra UI.

### `enviarCompetencia(ano, mes)` — nova server action

```typescript
async function enviarCompetencia(ano: number, mes: number) {
  // UPDATE folhas_pagamento
  //   SET status='enviada', enviada_at=now(), enviada_por=auth.uid()
  //   WHERE tenant_id=? AND competencia_ano=? AND competencia_mes=?
  //     AND status='rascunho';
  // audit_log: folha_competencia.enviada { ano, mes, linhas_afetadas }
}
```

Guarda rail na UI: botão só é renderizado quando `EXISTS` de linhas das duas origens na competência. (Edge case "competência sem CLT" é TBD-4.)

Aprovação individual em `/financeiro/contas-a-pagar` continua sendo linha a linha, como já é.

### Mapeamento `tipo_contratacao` → plano de contas em `actions-folhas.ts`

Função `subtipoCodigoParaContratacao` recebe `(tipo, origem)` em vez de só `tipo`, e devolve o **código** do subtipo (3 dígitos). O chamador resolve o `plano_conta_subtipo_id` via lookup na tabela mestre:

```typescript
function subtipoCodigoParaContratacao(
  tipo: TipoContratacao,
  origem: FolhaOrigem,
): string {
  if (origem === 'california') {
    switch (tipo) {
      case 'pj':
      case 'mei':
      case 'clt_recibo': return '015'; // Serviços de Terceiros (PJ)
      default: throw new Error(`origem california incompatível com tipo ${tipo}`);
    }
  }
  // origem === 'contabilidade'
  switch (tipo) {
    case 'clt':
    case 'clt_recibo': return '001'; // Salário
    case 'estagio':    return '005'; // Estagiário
    case 'socio':      return '011'; // ProLabore
    default: throw new Error(`origem contabilidade incompatível com tipo ${tipo}`);
  }
}
```

O tipo pai do subtipo (`plano_conta_tipo_id`) é sempre `05 Despesa com Pessoal` nesse fluxo.

## Fluxo UI

### `/rh/folhas` — redesenho

Página passa a ser orientada por competência selecionada no topo. Layout:

```
┌─ Folhas de Pagamento ──────────────────────────────────┐
│                                                        │
│ Competência: [outubro / 2026 ▼]                        │
│                                                        │
│  ☑ PJ gerada           12 linhas · R$ 54.300,00        │
│  ☑ CLT importada        8 linhas · R$ 38.900,00        │
│                                                        │
│                              [Enviar ao financeiro]    │
│                                                        │
│ ─ PJ ─────────────────────────────────────────         │
│ ┌────────────────────────────────────────────┐         │
│ │ João Silva         R$ 8.000,00   rascunho  │         │
│ │ Ana Pereira        R$ 2.500,00   rascunho  │         │
│ │ ...                                        │         │
│ └────────────────────────────────────────────┘         │
│                                                        │
│ ─ CLT ────────────────────────────────────────         │
│ ┌────────────────────────────────────────────┐         │
│ │ Ana Pereira        R$ 2.500,00   rascunho  │         │
│ │ Pedro Costa        R$ 6.200,00   rascunho  │         │
│ │ ...                                        │         │
│ └────────────────────────────────────────────┘         │
└────────────────────────────────────────────────────────┘
```

Estados possíveis dos checkpoints:

- ☐ PJ **(botão: Gerar PJ)** → ação dispara `gerarFolha(ano, mes)`.
- ☑ PJ gerada (contagem + total) → não há ação; a seção "PJ" lista as linhas.
- ☐ CLT **(botão: Importar CLT)** → abre modal/drawer de upload.
- ☑ CLT importada (contagem + total) → não há ação.

Botão **"Enviar ao financeiro"**:
- Enabled quando ambos checks estão ☑.
- Disabled com tooltip explicativo quando falta um.
- Confirmação antes de disparar (`"Enviar X linhas ao financeiro? Depois disso, a aprovação segue em Contas a Pagar."`).

Linhas individuais continuam editáveis em rascunho (preserva D2 do módulo RH). Depois de enviada, só leitura.

### Modal/drawer "Importar CLT"

Disparado do botão inline ao lado do checkpoint CLT:

1. Seletor de arquivo (.pdf — "Relação Geral dos Líquidos" entregue pela contabilidade).
2. Botão "Pré-visualizar" → chama server action em modo dry-run (parseia, matcha, mas não grava).
3. Mostra tabela de prévia agrupada pelas três seções do PDF (Empregados / Estagiários / Contribuintes): linhas que serão criadas, atualizadas, ignoradas (com motivo). Mostra também o total do PDF vs o total casado, pra conferência visual.
4. Botão "Confirmar importação" → chama a server action real.
5. Resultado: toast com contagens + redireciona pra competência atualizada.

### `/financeiro/contas-a-pagar` aba "Folhas de Pagamento"

Alteração pequena:

- Nova coluna/badge **"Origem"** por linha: PJ / CLT (derivada de `folhas_pagamento.origem`, mas rotulada na linguagem do fluxo).
- Filtro no topo "Origem: Todas / PJ / CLT".
- Agrupamento interno existente (por `tipo_contratacao`) continua funcionando.

## Auditoria

Novos eventos no `audit_log`:

- `folha.importada` — ator, competência, arquivo_nome, arquivo_hash, linhas_criadas, linhas_atualizadas, linhas_ignoradas.
- `folha_competencia.enviada` — ator, competência, linhas_afetadas.

Eventos existentes mantidos:

- `folha.gerada` — passa a receber o filtro aplicado no payload (tipos incluídos).

## Testes

- **Parser** (`vitest`): fixtures de PDF sintético cobrindo as três seções, linhas válidas, CPF inválido, valor zero, colaborador inexistente, seção errada pro tipo cadastrado, divergência de competência no header do PDF, divergência entre soma e totalizador do rodapé, reimportação idempotente.
- **`gerarFolha`**: colaborador `pj` → gera com `valor`; `clt_recibo` → gera com `valor_recibo`; `clt` → não gera; `estagio` → não gera (confirmar TBD-2).
- **CHECK `valor_recibo`**: tentar gravar `valor_recibo` em colaborador `pj` falha; tentar gravar `valor_recibo IS NULL` em colaborador `clt_recibo` falha.
- **Backfill 50/50**: antes/depois, soma deve bater exatamente com `valor` original.
- **Unique `(..., origem)`**: inserir duas linhas pro mesmo híbrido na mesma competência, uma por origem, não conflita.
- **`enviarCompetencia`**: só muda rascunhos; preserva `enviada`/`aprovada`/`paga`.
- **E2E do híbrido**: Ana Pereira (`clt_recibo`, salário total R$ 5.000, `valor_recibo` R$ 2.500) → `gerarFolha` cria linha california R$ 2.500 → `importarFolhaContabilidade` cria linha contabilidade R$ 2.500 (vinda da seção "Empregados" do PDF) → `enviarCompetencia` → aprovar as duas → gera 2 `contas_avulsas`: uma em 05.015 Serviços de Terceiros (PJ) e outra em 05.001 Salário.

## Rollout e ordem de implementação

0. **Pré-requisito operacional**: criar o subtipo `05.015 Serviços de Terceiros (PJ)` em `plano_contas_subtipos` via UI em `/financeiro/cadastros/plano-de-contas`. Pode ser feito antes de qualquer código, pelo próprio operador.
1. Migrations 1–4 pelo MCP, com confirmação explícita antes do backfill 50/50 (muda dado existente).
2. Instalar `pdf-parse` como dependência.
3. Atualização de `lib/types.ts` + mapeamento `subtipoCodigoParaContratacao` + ajuste de `gerarFolha` + aprovação em `actions-folhas.ts` recebendo `(tipo, origem)` **no mesmo commit** das migrations.
4. Server action `importarFolhaContabilidade` + parser PDF.
5. Server action `enviarCompetencia`.
6. UI nova de `/rh/folhas` (checkpoint, seções PJ/CLT, botão enviar) e modal de importação.
7. Ajustes finos em `/financeiro/contas-a-pagar` (badge de origem, filtro).

## TBDs

Todos resolvidos. Mantidos aqui como histórico de decisão:

- **TBD-1 — Mapeamento de plano de contas — RESOLVIDO.**
  - **1a** PJ/MEI vão para o novo subtipo **05.015 Serviços de Terceiros (PJ)**.
  - **1b** Recibo (parte RPA do híbrido, gerada pela California) vai no mesmo 05.015, junto com PJ. California opta por não separar PJ de PF autônomo no DRE gerencial.
  - **1c** A importação é "um valor por colaborador" — o PDF só traz o líquido a pagar. Encargos (FGTS, INSS, IR Retido) vêm por outros documentos e ficam fora deste fluxo.
- **TBD-2 — Estagiário — RESOLVIDO.** Estagiário vem pela planilha da contabilidade (fluxo CLT), mapeia pro 05.005 Estagiário. Sócio idem, pro 05.011 ProLabore.
- **TBD-3 — Formato do arquivo — RESOLVIDO.** PDF (não XLSX). Nome: "Relação Geral dos Líquidos". Três seções fixas: Empregados, Estagiários, Contribuintes. Parser: `pdf-parse` (nova dependência).
- **TBD-4 — Competência sem CLT.** No caso de uso normal da California sempre há CLT a importar. Se um dia não houver, precisa de um "Marcar CLT como não aplicável" para liberar o envio ao financeiro. **Melhoria futura, não bloqueante.**

## Fora de escopo

- Cálculo interno de encargos/INSS/FGTS da parte CLT. É da contabilidade.
- **Importação de FGTS/INSS/IR Retido como `contas_avulsas`.** Esses repasses vêm por outros documentos (GRCS, DARF, GFIP) e são tratados por outro circuito do financeiro, não por esse fluxo.
- Envio automático do PDF pela contabilidade (SFTP, e-mail parsing). Upload manual pelo RH.
- Reconciliação automática entre o `valor` cadastrado do híbrido e o valor que vem no PDF. Divergência vira warning informativo, não bloqueio.
- Edição em massa das alocações de folhas importadas (continua linha a linha como já é).
- Separação fiscal entre PJ e RPA (PF autônomo) no plano de contas — colapsados em 05.015 por decisão.
