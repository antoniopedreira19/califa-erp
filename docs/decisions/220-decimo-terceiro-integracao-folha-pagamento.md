# 219 — 13º Salário: integração com Folha de Pagamento via FK, não via reuso de tabela

**Data:** 2026-10-21
**Status:** aceita; implementado nas migrations `20261021000001` e `20261021000004`.
**Quem decidiu:** Daniel + Antonio em sessão de implementação.
**Contexto:** continua [`docs/modulos/rh/60-decimo-terceiro.md`](../modulos/rh/60-decimo-terceiro.md).

Esta decisão congela como o 13º salário se integra ao fluxo existente de Folha de Pagamento (RH gera → envia → financeiro aprova → vira `contas_avulsas` → entra em Títulos a Pagar) sem reusar diretamente a tabela `folhas_pagamento`.

---

## O problema

A folha de pagamento mensal já tem um fluxo em produção com três atores:

1. RH gera a folha em `/rh/folhas/{competencia}` (`folhas_pagamento` com `status=rascunho`).
2. RH clica "Enviar ao financeiro" (`status=enviada`).
3. Financeiro aprova em `/financeiro/contas-a-pagar?tab=folhas` → chama RPC `criar_conta_avulsa` → vira título a pagar.

O 13º precisa percorrer o **mesmo caminho operacional** (RH envia, financeiro aprova, vira avulsa) porque é a Kika quem fecha e o financeiro quem paga, igual à folha mensal. Mas o 13º tem particularidades que não cabem em `folhas_pagamento`:

- É **anual**, não mensal. Uma por ano, com cálculo cumulativo (avos, adiantamentos somados).
- Tem **duas parcelas** com datas fixas (30/nov e 20/dez) e tratamento diferente de desconto (1ª sem, 2ª com).
- Snapshot específico (`snapshot_valor_recibo` pro híbrido, breakdown de parte CLT/PJ).
- Edição por override, histórico de adiantamentos, flag de reajuste no ano.

Opções consideradas:

| Opção | O que seria |
|---|---|
| **A — Reusar `folhas_pagamento`** | Adicionar tipo `decimo_terceiro` ao enum e armazenar o 13º como se fossem linhas mensais extras. |
| **B — Tabelas separadas + duplicar fluxo** | `decimo_terceiro_folhas` + `decimo_terceiro_linhas` com fluxo próprio de envio ao financeiro (criar `contas_avulsas` direto via service client). |
| **C — Tabelas separadas + integração via FK** (decidida) | `decimo_terceiro_folhas` + `decimo_terceiro_linhas` fazem o cálculo; no fechamento das parcelas, criam linhas em `folhas_pagamento` com `tipo=decimo_terceiro_1a_parcela` (ou `_2a`) e FK `decimo_terceiro_linha_id` apontando pra origem. |

---

## O que fica decidido

### 1. Duas tabelas novas pra o cálculo

`decimo_terceiro_folhas` (uma por ano) e `decimo_terceiro_linhas` (uma por colaborador por folha). Guardam snapshot + cálculo + overrides + breakdown híbrido. **Não** armazenam o lançamento financeiro — só o estado do cálculo.

### 2. Enum `folha_tipo` ganha dois valores

Em vez de criar tabela separada pro envio ao financeiro, o enum `folha_tipo` em `folhas_pagamento` ganhou:

- `decimo_terceiro_1a_parcela`
- `decimo_terceiro_2a_parcela`

E a tabela `folhas_pagamento` ganhou coluna `decimo_terceiro_linha_id` (nullable FK). O unique index trocou pra incluir `tipo`:

```
(tenant_id, competencia_ano, competencia_mes, colaborador_id, origem, tipo)
```

Isso permite o mesmo colaborador ter linhas de `salario`, `ferias`, `decimo_terceiro_1a_parcela` e `_2a_parcela` na mesma competência sem colisão.

### 3. Fechamento das parcelas é um "copia pra folha_pagamento"

Quando o RH clica "Fechar 1ª parcela":

1. Pra cada linha de `decimo_terceiro_linhas` com `avos > 0`, cria uma linha em `folhas_pagamento`:
   - `tipo=decimo_terceiro_1a_parcela`, `origem=california`, `status=enviada`
   - `competencia_ano = ano_folha`, `competencia_mes = 11`
   - `salario_base = primeira_parcela` (valor sem desconto na 1ª)
   - `data_pagamento_prevista = {ano}-11-30`
   - `decimo_terceiro_linha_id = l.id`
   - `enviada_em, enviada_por` carimbados
2. Atualiza `decimo_terceiro_folhas.status` pra `fechada_parcial_1`.

2ª parcela: mesma coisa com `competencia_mes = 12`, `data = {ano}-12-20`, `salario_base = segunda_parcela − INSS − IRRF` (líquido).

### 4. Aprovação no financeiro usa plano de contas correto

A função `subtipoCodigoParaContratacao` em `app/(app)/financeiro/contas-a-pagar/actions-folhas.ts` ganhou um 3º parâmetro `tipoFolha`. Quando é 13º, retorna código `004` ("13° Salário") independente de `tipo_contratacao` ou `origem`. Isso desbloqueia a aprovação de 13º de CLT puro, que antes caia no erro "tipo_contratacao 'clt' não é compatível com origem 'california'".

### 5. Trava de NF existente cobre o 13º sem código novo

A validação em `actions-folhas.ts` que exige NF anexada em `colaboradores_nf_anexos` pra PJ/MEI/CLT_recibo com `origem=california` continua funcionando pra o 13º — mesma competência (ano+mes), mesma trava. Pros 9 colaboradores híbridos, o PJ precisa anexar NF em novembro (1ª parc) e dezembro (2ª parc), igual ao salário mensal.

---

## Por quê não A (reusar `folhas_pagamento`)

- Cálculo cumulativo do 13º (avos, adiantamentos, dependentes IR) não cabe nos campos de folha mensal (`salario_base`, `desconto_beneficios`).
- Snapshot específico (`snapshot_valor_recibo`, `parte_clt_*`, `parte_pj_*`) poluiria a tabela mensal com 10+ colunas usadas por 2 valores do enum.
- Edição manual com override, flag de reajuste, obs — tudo isso é 13º-only; empurrar pra tabela mensal mistura responsabilidades.
- A visão por ano (listagem de folhas) teria que agregar sobre meses 11 e 12, ficando esquisita.

## Por quê não B (fluxo próprio pro financeiro)

- Reinventa fluxo. O financeiro já tem a UI de aprovação de folha pronta — construir uma segunda tela paralela só pra 13º é duplicação de código e de UX.
- RH NÃO tem permissão de criar `contas_avulsas` direto (`criar_conta_avulsa` exige role admin/financeiro). Fazer isso via service client funciona (adiantamentos usam esse padrão), mas pular a aprovação do financeiro remove o controle que a California quer manter.
- Rastreabilidade: avulsa criada direto do RH não tem a visibilidade do fluxo mensal (status enviada → aprovada → paga), não permite devolver com motivo, não liga automaticamente pro CNAB.

## O que a decisão custa

- **Precisamos manter o enum `folha_tipo` sincronizado.** Novos tipos de pagamento (ex.: rescisão?) vão adicionar valores aqui.
- **Função `subtipoCodigoParaContratacao` agora tem 3 parâmetros** — qualquer outro módulo que use essa função precisa saber que o 3º é opcional e muda o plano de contas.
- **Duplicação parcial de audit:** o 13º tem `decimo_terceiro.parcela_1a.fechada` e a folha_pagamento resultante tem `folha.linha.enviada`. Os dois eventos cobrem a mesma transação por perspectivas diferentes.

## Fatos pra conferir se mudar depois

- Hoje a tabela `folhas_pagamento` armazena linhas de `salario`, `ferias`, `decimo_terceiro_1a_parcela` e `decimo_terceiro_2a_parcela`.
- O unique index `folhas_pagamento_tenant_ano_mes_colab_origem_tipo_idx` inclui `tipo` — não voltar pra 5 colunas sem antes migrar os dados.
- A FK `folhas_pagamento.decimo_terceiro_linha_id` é `SET NULL` on delete, então deletar a linha original de 13º não quebra o lançamento financeiro — ele fica órfão com o pagamento mas sem rastreabilidade pro cálculo original.
