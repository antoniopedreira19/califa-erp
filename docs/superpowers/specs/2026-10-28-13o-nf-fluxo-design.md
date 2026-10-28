# 13° no quadro de NF + adiantamento via fluxo People

**Data:** 2026-10-28
**Status:** Design (aguardando aprovação do dono)

## Intenção

Fechar o fluxo de NF para o 13° salário e para o adiantamento de 13°. Hoje a infra do quadro de NF e do tab People do financeiro já valida NF pra folha mensal e férias — 13° e adiantamento ficaram de fora. Esta entrega liga o 13° (1ª e 2ª parcela) nas duas views e refatora o adiantamento pra passar pelo mesmo caminho de aprovação do financeiro, com guard de NF.

## Por quê

O quadro de NF do colaborador (`vw_nf_pendentes_colaborador`) e a lista de aprovação do financeiro (`vw_people_aprovar_financeiro`) nasceram em 2026-10-26 com CTE preparada pra 13° mas marcada como `WHERE false` — a espera de o módulo de 13° entrar em produção. Esse módulo entrou (`decimo_terceiro_folhas`/`decimo_terceiro_linhas` funcionam desde 2026-10-21), mas as views continuam com o stub.

O adiantamento de 13° foi feito antes do padrão People consolidar: ele cria `conta_avulsa` com `status='aprovada'` direto, pulando o financeiro inteiro. Isso é incoerente agora que o 13° vai respeitar o fluxo de aprovação com NF — adiantamento é pago ao mesmo PJ, exige a mesma NF, e precisa cair no mesmo tab People que a 1ª e a 2ª parcela.

A regra do dono: **adiantamento não é feito em cima da hora**, então vale pagar o custo do fluxo extra em troca de consistência.

## Metas

- Linha de 13° (1ª parcela e 2ª parcela) aparece no quadro de NF do colaborador PJ/MEI/CLT-recibo assim que o RH fecha a parcela — ou seja, assim que surge linha em `folhas_pagamento` com `tipo='decimo_terceiro_1a_parcela'`/`'_2a_parcela'`, `origem='california'`, status ≠ `paga`.
- Linha no tab People do financeiro pra cada parcela de 13°, com guard de NF (botão "Revisar"/"Aprovar" bloqueado se NF ausente, igual já funciona pra folha mensal).
- Para híbrido (`clt_recibo`): a linha de NF reflete **só a parte PJ** (`parte_pj_primeira_parcela` / `parte_pj_segunda_parcela`), não o total. Label deixa claro: *"13º 2026 — 1ª parcela (parte PJ)"*.
- Adiantamento de 13° passa a nascer como linha em `folhas_pagamento` com tipo novo `decimo_terceiro_adiantamento`, status `enviada`. Em vez de criar `conta_avulsa` direto, cria linha de folha; a `conta_avulsa` é criada quando o financeiro aprova (reaproveita o fluxo de `aprovarLinhaFolha`).
- Adiantamento aparece no quadro de NF do colaborador e no tab People, com o mesmo guard de NF das parcelas de 13°.
- O cálculo da folha de 13° (`calcularLinhaDecimoTerceiro`) continua abatendo o adiantamento da 1ª parcela — a fonte de verdade do valor adiantado continua sendo a tabela `decimo_terceiro_adiantamentos`.

## Não-metas

- CLT puro, estagiário, sócio. Não emitem NF. 13° de CLT puro continua passando pelo fluxo normal (vai pra `folhas_pagamento` como está) mas não aparece no quadro de NF nem precisa de NF pra ser aprovado — o guard já é condicional em `pj/mei/clt_recibo`.
- Rescisão. 13° proporcional de rescisão é calculado em módulo separado (`/rh/rescisoes`), fora deste escopo.
- Mudar prazo de anexo. O quadro de NF já tem prazos definidos; a entrega não mexe nessas datas.
- Mudar o cálculo do 13° (avos, INSS, IRRF, split híbrido). Tudo isso continua como está.
- Adiantamento genérico (adiantamento salarial fora do 13°). Hoje não existe; se vier, é fluxo separado.
- Backfill de adiantamentos antigos. Adiantamentos já lançados hoje (que viraram `conta_avulsa` aprovada) ficam como estão — não entram no fluxo retroativamente.

## Anti-metas

- Bloquear o RH de fechar parcela do 13° enquanto NF não estiver anexada. O dono já decidiu: a demanda de NF só nasce DEPOIS do RH fechar a parcela (parcela virou `folhas_pagamento`). O bloqueio é no financeiro, não no RH.
- Duplicar fontes no tab People (parte vindo de `folhas_pagamento`, parte de `contas_avulsas`). Adiantamento vira linha de folha pra manter People com fonte única.
- Deixar o adiantamento pagar sem NF via "modo rápido" ou override. Se precisar pagar sem NF, o caminho é não lançar como adiantamento de 13° (lançar como contas avulsa manual com justificativa) — mas isso não faz parte deste design.

## Restrições

- Banco compartilhado — fluxo do MCP de `docs/FLUXO-BANCO.md` sem pular etapa.
- `lib/types.ts` manual — campos novos entram no mesmo commit da migration.
- Nenhum dado pessoal real em código/migration/fixture.
- Performance: GRANT para `authenticated`, índice nas FKs novas, policies RLS com `(select auth.uid())`.
- Strings visíveis ao usuário em pt-BR com acento.
- Mudança no `lancarAdiantamentoDecimoTerceiro` **não pode** quebrar o recálculo de 13° (`calcularLinhaDecimoTerceiro` consulta `decimo_terceiro_adiantamentos` pra abater da 1ª parcela). A tabela continua existindo e sendo populada; o que muda é só o shell de pagamento (não cria mais `conta_avulsa` no lançamento).
- Mudança destrutiva aqui = mudar o default de `status` da `conta_avulsa` do adiantamento, e remover a criação dela do `lancarAdiantamentoDecimoTerceiro`. Precisa de confirmação explícita antes de aplicar (o dono já confirmou neste design).

## Modelo de dados

### 1. Enum `nf_anexo_escopo` — valor novo

Adicionar `decimo_terceiro_adiantamento` ao enum existente.

Os valores `decimo_terceiro_p1` e `decimo_terceiro_p2` já existem desde 2026-10-26 — só a view que não os usa.

### 2. `decimo_terceiro_adiantamentos` — nova coluna

```
folha_pagamento_id uuid NULL REFERENCES folhas_pagamento(id) ON DELETE SET NULL
```

Antes: `conta_avulsa_id` era preenchido no lançamento (porque o adiantamento criava a `conta_avulsa` direto).
Depois: `conta_avulsa_id` passa a ser preenchido só na **aprovação do financeiro** (quando `aprovarLinhaFolha` cria o título). `folha_pagamento_id` é preenchido no lançamento e aponta pra linha de folha que vai ser aprovada.

Adiantamentos antigos (anteriores à migration): mantêm `conta_avulsa_id` populado e `folha_pagamento_id` NULL — fora do novo fluxo, não aparecem no People de novo (já foram aprovados por fora).

**Coluna espelhada em `folhas_pagamento`**: adicionar `decimo_terceiro_adiantamento_id uuid NULL REFERENCES decimo_terceiro_adiantamentos(id) ON DELETE RESTRICT`, análoga ao `lancamento_ferias_id` que já existe pra férias. Isso permite que `resolverEscopoDaFolha` continue sendo função pura (sem I/O) — resolve o `escopo_id` lendo o campo da própria linha de folha, igual os demais escopos.

### 3. `folhas_pagamento` — tipo novo

Enum/coluna `tipo` ganha o valor `decimo_terceiro_adiantamento`.

Linhas desse tipo têm:
- `colaborador_id`: qualquer tipo (CLT, clt_recibo, PJ, MEI)
- `competencia_ano`: ano do 13° (ex: 2026)
- `competencia_mes`: **12 fixo** — adiantamento é "do ano", não de um mês específico. Isso evita que adiantamento retroativo (pago em julho, lançado em outubro) caia abaixo do cutoff `>= 202610` das views e fique invisível.
- `salario_base`: valor do adiantamento (ver §3a pra híbrido)
- `tipo`: `decimo_terceiro_adiantamento`
- `origem`: depende do tipo de contratação (ver §3a)
- `status`: `enviada` (ao lançar) → `aprovada` (financeiro aprova) → `paga` (quando pago)
- `decimo_terceiro_linha_id`: NULL (não vincula a uma linha específica da folha de 13°)
- `decimo_terceiro_adiantamento_id`: FK pra `decimo_terceiro_adiantamentos.id` (ver §2)

### 3a. Shell do adiantamento por tipo de contratação

Espelha o padrão de folha mensal/férias:

- **PJ/MEI puro**: 1 linha, `origem='california'`, `salario_base = valor_adiantamento`. Vai pro quadro de NF do PJ + People. Exige NF.
- **CLT puro**: 1 linha, `origem='contabilidade'`, `salario_base = valor_adiantamento`. Aparece no People junto com folha mensal CLT. Aprovação direta (guard de NF é condicional em `pj/mei/clt_recibo`, CLT passa reto).
- **Híbrido (`clt_recibo`)**: 1 linha, `origem='california'`, `salario_base = valor_adiantamento` (valor cheio vai pro PJ). Minha chamada técnica: adiantamento é um pagamento antecipado único, não é uma parcela de 13° (que tem split calculado) — o colaborador híbrido que recebe adiantamento recebe pela via PJ, emite NF do valor cheio. Alternativa seria split proporcional, mas complica o lançamento e o PJ passaria a emitir NF por valor fracionado estranho. Se ficar errado na prática, revisitar.

Em todos os casos, o cálculo da 1ª parcela de 13° (via `calcularLinhaDecimoTerceiro`) continua abatendo o `valor_adiantamento` cheio, independente da origem. Isso não muda.

### 4. Views

**`vw_nf_pendentes_colaborador`**: remover `WHERE false` da CTE `decimo` e reescrever pra puxar de `folhas_pagamento` (não de `decimo_terceiro_linhas` direto) — assim fica consistente com a lógica da folha mensal, que já parte de `folhas_pagamento`. Casos tratados:
- Linha `tipo='decimo_terceiro_1a_parcela'`, status ≠ paga, origem california → escopo `decimo_terceiro_p1`, valor conforme tipo (PJ = total, híbrido = parte PJ, lido do `decimo_terceiro_linhas` via join).
- Idem pra 2ª parcela → escopo `decimo_terceiro_p2`.
- Linha `tipo='decimo_terceiro_adiantamento'`, status ≠ paga → escopo `decimo_terceiro_adiantamento`, valor = `salario_base`.

**`vw_people_aprovar_financeiro`**: mesma mudança. CTE `decimo` ligada, novo bloco pra adiantamento. Label legível no `tipo_display`.

### 5. `resolverEscopoDaFolha()` em `lib/nf/escopo-da-folha.ts` (função pura)

Função que mapeia `folhas_pagamento` → `(escopo_tipo, escopo_id)` pra procurar NF. Hoje cobre folha mensal, férias, abono. Adicionar:
- `decimo_terceiro_1a_parcela` → `(decimo_terceiro_p1, decimo_terceiro_linha_id)` — escopo_id é a linha de 13°, pra que uma NF da 1ª parcela permaneça válida se a linha de folha_pagamento for recriada por recálculo.
- `decimo_terceiro_2a_parcela` → `(decimo_terceiro_p2, decimo_terceiro_linha_id)`.
- `decimo_terceiro_adiantamento` → `(decimo_terceiro_adiantamento, decimo_terceiro_adiantamento_id)` — campo novo em `folhas_pagamento` (ver §2).

Função continua sem I/O — todos os `escopo_id` vêm de colunas da própria linha de folha. Teste existente em `lib/nf/escopo-da-folha.test.ts` ganha 3 casos novos.

### 5a. Trigger `fn_valida_nf_anexo_escopo`

Hoje valida `decimo_terceiro_p1`/`p2` → `decimo_terceiro_linhas.id` (correto, bate com §5). Adicionar case:
- `decimo_terceiro_adiantamento` → `decimo_terceiro_adiantamentos.id`.

### 6. `tipos_folha` em `lib/types.ts`

Adicionar `decimo_terceiro_adiantamento`. Já tem `decimo_terceiro_1a_parcela` e `decimo_terceiro_2a_parcela`.

## Mudanças de código

### 1. `fecharPrimeiraParcelaDecimoTerceiro` e `fecharSegundaParcelaDecimoTerceiro`

**Mudança no tratamento de híbrido.** Hoje gravam uma única linha com `salario_base = primeira_parcela` (total CLT+PJ). Para `clt_recibo` com `parte_pj_primeira_parcela > 0`, isso infla a view e faz o financeiro criar título pelo total — pagamento em dobro, porque a parte CLT já sai pela contabilidade.

Correção, espelhando o padrão de férias (ver `lib/ferias/montar-invalidas-folhas.ts`):

- **PJ/MEI puro**: 1 linha em `folhas_pagamento`, `origem='california'`, `salario_base = primeira_parcela` (não há parte CLT).
- **CLT puro**: 1 linha, `origem='contabilidade'`, `salario_base = primeira_parcela` (fluxo tradicional, sem NF).
- **Híbrido (`clt_recibo`)**: 2 linhas:
  - `origem='california'`, `salario_base = parte_pj_primeira_parcela` → entra no quadro de NF + People, exige NF.
  - `origem='contabilidade'`, `salario_base = parte_clt_primeira_parcela` → fluxo tradicional do RH, sem NF.
- Linhas com `salario_base = 0` são puladas (híbrido onde `valor_recibo = salário` só gera a linha california; CLT puro com avos=0 já é pulado hoje).

Mesma regra pra 2ª parcela.

Essa mudança é consistente com como férias já funciona desde `20261013*`.

### 2. `lancarAdiantamentoDecimoTerceiro`

Reescrita parcial. Hoje:
1. Insere em `decimo_terceiro_adiantamentos`.
2. Chama RPC `criar_conta_avulsa` com status `aprovada`.
3. Vincula `conta_avulsa_id` no adiantamento.
4. Recalcula linha de 13° (abate da 1ª parcela).

Depois:
1. Insere em `decimo_terceiro_adiantamentos` (sem `conta_avulsa_id`).
2. Insere linha em `folhas_pagamento` com `tipo='decimo_terceiro_adiantamento'`, status `enviada`, valor = `valor_adiantamento`.
3. Vincula `folha_pagamento_id` no adiantamento.
4. Recalcula linha de 13° (idem — a fonte continua sendo `decimo_terceiro_adiantamentos`, não muda nada aqui).

### 3. `excluirAdiantamentoDecimoTerceiro`

Hoje: deleta adiantamento, zera `conta_avulsa_id` (SET NULL por FK), não estorna a `conta_avulsa` (financeiro cancela manual).

Depois: três casos, verificados em ordem:
- Adiantamento **já aprovado** (`folhas_pagamento.status IN ('aprovada','paga')`): bloqueia com erro ("Adiantamento já aprovado pelo financeiro — cancele o título em contas a pagar primeiro"). O RH não pode desfazer o que o financeiro já tocou.
- Adiantamento com NF já anexada (`folha.status='enviada'` + anexo existe em `colaboradores_nf_anexos`): bloqueia com erro ("Colaborador já anexou NF — remova a NF antes de excluir o adiantamento"). Evita anexo órfão no storage e PDF que o colaborador emitiu em vão.
- Adiantamento sem aprovação e sem NF (`folha.status='enviada'`, sem anexo): deleta a linha de folha junto + o adiantamento. Recalcula 13°.

### 4. `aprovarLinhaFolha`

**Sem mudança funcional.** O guard de NF já é condicional em `pj/mei/clt_recibo` + `origem='california'`. O novo tipo `decimo_terceiro_adiantamento` entra naturalmente, desde que `resolverEscopoDaFolha()` saiba resolver o escopo. A criação da `conta_avulsa` (que hoje acontece pra folha mensal/férias/13°) passa a acontecer também pro adiantamento — natureza/plano/categoria vêm da configuração padrão de 13° (igual ao da 1ª parcela, provavelmente).

### 5. `calcularLinhaDecimoTerceiro`

**Sem mudança.** Continua buscando `total_adiantado` em `decimo_terceiro_adiantamentos`. A mudança no shell de pagamento não afeta o cálculo.

### 6. UI do adiantamento (`/rh/decimo-terceiro/[ano]/adiantamentos`)

Hoje mostra lista de adiantamentos sem coluna de status (porque todos nasciam aprovados). Adicionar coluna "Status" com valores:
- "Aguardando NF" (quando `folha_pagamento.status = enviada` e NF ausente)
- "Aguardando aprovação" (quando NF anexada mas financeiro ainda não aprovou)
- "Aprovado — a pagar" (quando `folha_pagamento.status = aprovada`)
- "Pago" (quando `folha_pagamento.status = paga`)

Botão de excluir ganha tooltip explicando o bloqueio quando o estado não permite.

### 7. UI do People (`people-list.tsx`)

**Mudança cosmética.** Novo `tipo_display` pra adiantamento: "13º Adiantamento". O label pra parcelas de híbrido já funciona a partir do `tipo_display` da view.

## Fluxo end-to-end (checagem)

**Caso 1 — PJ puro, parcela de 13°:**
1. RH cria folha de 13° de 2026.
2. RH fecha 1ª parcela → gera linha em `folhas_pagamento` tipo `decimo_terceiro_1a_parcela`, status `enviada`.
3. View puxa pro quadro do PJ.
4. PJ entra em `/perfil`, vê linha "13º 2026 — 1ª parcela · R$ X", anexa PDF.
5. Financeiro entra em `/financeiro/contas-a-pagar` tab People, vê a linha, botão "Revisar" habilitado (NF anexada).
6. Financeiro aprova → `conta_avulsa` criada, folha vai pra `aprovada`, cai em "Títulos a Pagar".
7. Pagamento → folha vira `paga`, some do quadro.

**Caso 2 — Híbrido, parcela de 13°:**
Igual ao caso 1, mas o valor exibido tanto no quadro quanto no People é `parte_pj_primeira_parcela` (não o total). Label mostra "(parte PJ)". A parte CLT da mesma linha de 13° não aparece no quadro (não gera NF).

**Caso 3 — PJ, adiantamento de 13°:**
1. RH entra em `/rh/decimo-terceiro/2026/adiantamentos`, lança R$ Y pra Fulano em data Z.
2. Cria registro em `decimo_terceiro_adiantamentos` + linha em `folhas_pagamento` tipo `decimo_terceiro_adiantamento`, origem `california`, status `enviada`.
3. Se o Fulano já tem linha na folha de 13° de 2026, 1ª parcela recalculada já abate os R$ Y.
4. Quadro do Fulano mostra "13º Adiantamento · R$ Y", ele anexa.
5. Financeiro aprova no People → `conta_avulsa` criada, status `aprovada`.
6. Pagamento normal.

**Caso 4 — CLT puro, qualquer parcela de 13° ou adiantamento:**
Linha vai pra `folhas_pagamento` normalmente, origem `contabilidade`:
- Não aparece no quadro de NF (filtro de tipo de contratação na view).
- Aparece no People (fluxo CLT já aparece lá hoje pra folha mensal), botão Aprovar habilita sem NF (guard é condicional em `pj/mei/clt_recibo`).
- Adiantamento de CLT puro passa pelo mesmo fluxo: lançado em `/rh/decimo-terceiro/[ano]/adiantamentos`, vira linha `origem='contabilidade'`, financeiro aprova sem NF.

**Caso 5 — Híbrido, adiantamento de 13°:**
Igual ao Caso 3: 1 linha `origem='california'` com valor cheio do adiantamento. PJ emite NF do valor total. Não há split proporcional (ver §3a).

## Rollout

1. Migration enum `nf_anexo_escopo` + coluna `folha_pagamento_id` em `decimo_terceiro_adiantamentos` + valor novo em `tipo` de folha. Aditivo, não quebra nada.
2. Migration de atualização das duas views (`vw_nf_pendentes_colaborador`, `vw_people_aprovar_financeiro`). `CREATE OR REPLACE VIEW`.
3. Código: `resolverEscopoDaFolha`, `lancarAdiantamentoDecimoTerceiro`, `excluirAdiantamentoDecimoTerceiro`, `lib/types.ts`, UI de adiantamentos, UI de People (label).
4. Smoke test manual (`npm run dev`):
   - Fecha 1ª parcela de uma folha teste → linha aparece pros PJs no `/perfil`.
   - PJ anexa NF → tab People habilita Revisar.
   - Financeiro aprova → título cai em "Títulos a Pagar".
   - Lança adiantamento pra outro PJ → aparece no quadro dele + People.
5. Commit tudo junto (migration + código + types), seguindo `docs/FLUXO-BANCO.md`.

## Decisões já tomadas (não revisitar)

- Quando a linha de 13° aparece pro colaborador: **quando o RH fecha a parcela** (não antes). Confirmado pelo dono.
- Bloqueio é no financeiro, não no RH. Confirmado.
- Para híbrido, valor na NF é só a parte PJ. Confirmado.
- Adiantamento vira linha em `folhas_pagamento` (Caminho 1), não continua em `conta_avulsa` direto. Confirmado.
- Adiantamentos antigos não entram no backfill — ficam fora do fluxo novo.

## Decisões do dono já tomadas (não revisitar)

- Híbrido no 13° gera 2 linhas em `folhas_pagamento` (uma california com parte PJ, uma contabilidade com parte CLT), espelhando como férias híbrido já funciona. **Confirmado pelo dono.**
- CLT puro também pode receber adiantamento de 13°. **Confirmado pelo dono.** → vira linha `origem='contabilidade'`, sem NF, aprovação direta no People (ver §3a).

## Aberto pro builder (decidir sozinho)

- Nome exato do valor no enum (`decimo_terceiro_adiantamento` vs `adiantamento_13`): manter padrão `decimo_terceiro_*` dos escopos já existentes.
- Natureza / plano de contas / categoria da `conta_avulsa` criada pelo `aprovarLinhaFolha` quando o tipo é `decimo_terceiro_adiantamento`: copiar do padrão da 1ª parcela.
- Formato exato do label no People/quadro ("13º 2026 — 1ª parcela (parte PJ)" é sugestão — se já existir padrão de label no sistema, usar o mesmo).
- Edge case: RH exclui adiantamento depois do fechamento da 1ª parcela (parcela virou linha em `folhas_pagamento` com valor já abatido do adiantamento, mas adiantamento ainda não foi aprovado pelo financeiro). O cálculo da parcela fica desatualizado. Remédio: a tela de 13° mostra aviso "folha desatualizada, recalcule" — o RH roda recalcular + re-fecha. Documentar no help da tela, não bloquear.
