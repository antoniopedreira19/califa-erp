# 100 — A abertura do job prevê os impostos, e a margem vira Rentabilidade

**Data:** 2026-09-23
**Decidido por:** Tiago
**Migration:** `20260923160001_previsao_de_impostos_na_abertura.sql`

Revê a [015](015-previsao-de-recebimento-na-abertura.md) (a margem
prevista), a [021](021-projeto-do-financeiro-e-edicao-da-abertura.md) §2
(contas opcionais) e a [038](038-previsoes-em-tabela-unica.md) (o rodapé
das Previsões).

---

## 1. O problema

O registro da abertura e a planilha interna do job mostravam dois números
diferentes para a mesma coisa. A abertura calculava
`faturamento previsto − custo previsto`. O card de Totais da planilha
calcula `valor do job − impostos − custo planejado`. Faltavam os
impostos.

No JOB-0036 (AMB-0006/26, Mochilas térmicas), em 22/09/2026:

| | Valor |
|---|---:|
| Faturamento previsto | R$ 145.000,12 |
| Custo previsto | R$ 76.000,00 |
| Margem da abertura (antes) | R$ 69.000,12 · 47,59% |
| Impostos da versão (19,53%) | R$ 28.318,52 |
| Resultado operacional da planilha | R$ 40.681,60 · 28,1% |

A diferença entre as duas é exatamente o imposto.

## 2. A regra

A abertura ganha uma terceira previsão, ao lado do recebimento e dos
custos: o **cronograma de recolhimento de impostos**. Ela funciona como
as outras duas: conta própria, linhas com data e valor, soma que precisa
fechar com o total.

- **O total** é o imposto embutido no faturamento previsto. Vem do mesmo
  `calcularTotaisVersao` do card de Totais, pelo lado `faturamento` (o
  imposto da nota que a California emite). Sem save, é o mesmo número do
  card.
- **Internacional:** entram o imposto brasileiro e as int. taxes. Os
  custos de transação **ficam de fora por ora**. O Tiago deve decidir em
  breve e provavelmente vai retirá-los.
- **As linhas** nascem uma por parcela de recebimento, com o imposto
  repartido na proporção de cada parcela.
- **A data nasce vazia e é escolhida à mão.** A ideia é o mês seguinte ao
  faturamento, mas a data de recebimento nem sempre coincide com a do
  faturamento (muitas vezes fatura-se antes), então o sistema não sugere
  data. Não há regra de janela, ao contrário dos custos (dias 08 e 20).
- **A conta "Impostos em"** fica no cabeçalho das Previsões, ao lado de
  "Recebimento em" e "Pagamento em". Nasce vazia.
- **Nada abate esta previsão ainda, e ela não entra no Fluxo de Caixa.**
  Virá um módulo fiscal que calcula o tributo a partir do contas a receber
  e do contas a pagar, transforma o valor em título e dá baixa. Levar a
  previsão ao fluxo antes disso faria o imposto pago por conta avulsa
  aparecer duas vezes, e a previsão vencida nunca sairia.

## 3. As três contas passam a ser obrigatórias

Cada conta é obrigatória **quando a previsão dela existe**:

| Conta | Obrigatória quando |
|---|---|
| Recebimento em | faturamento previsto > 0 |
| Pagamento em | custo previsto > 0 |
| Impostos em | imposto previsto > 0 |

Até 23/09/2026 as contas de recebimento e de pagamento eram opcionais
sempre (021 §2). O Tiago confirmou a mudança: "Como a do pagamento e
recebimento, começa vazia, e é obrigatória." A obrigação vale para a
abertura e para a edição do registro. É conferida pela Server Action
(`conferirContasObrigatorias`), não pelo banco: jobs abertos antes desta
data não têm a conta de impostos, e um `NOT NULL` os deixaria inválidos.

## 4. "Margem prevista" vira "Rentabilidade"

O nome muda no rodapé das Previsões e no Resumo do registro. A conta passa
a ser:

```text
Rentabilidade = faturamento previsto − custo previsto − impostos previstos
```

Ao lado dela aparece a conta por extenso e um selo:

- **verde**, "Bate com o resultado operacional planejado da planilha
  interna", quando os dois números coincidem (JOB-0036: R$ 40.681,60);
- **amarelo**, com o valor da planilha, quando não coincidem.

A diferença não é erro. A Rentabilidade da abertura olha o dinheiro que
passa pelo caixa da California. A planilha olha o valor do job inteiro,
inclusive o que o cliente paga direto ao fornecedor. No JOB-0032
(TES-0001/26), Rentabilidade R$ 40.800,00 e planilha R$ 39.600,00: os
R$ 1.200,00 são rentabilidade de itens que o cliente paga direto.

## 5. Como a tela se comporta

- Enquanto ninguém mexe nos **valores**, o cronograma **segue as
  parcelas**: dividir o recebimento em duas parcelas gera duas linhas de
  imposto. Escolher a data não solta o cronograma.
- Mexer num valor, incluir, remover ou usar "Distribuir" **solta** o
  cronograma. O subtítulo passa a avisar isso e aparece o botão "Seguir as
  parcelas", que refaz tudo a partir do recebimento.
- Job já aberto com cronograma gravado carrega o que foi gravado, já
  solto. Job aberto antes desta decisão carrega sem cronograma: na
  primeira edição do registro, as linhas seguem as parcelas e pedem data
  e conta.
- A barra de baixo cobra, nesta ordem: data de cada recolhimento, valores
  maiores que zero, soma igual aos impostos e, por fim, as três contas.

## 6. O dado

- `jobs.conta_impostos_id` — FK para `contas_bancarias`, nula nos jobs
  antigos.
- `jobs_previsao_impostos` — espelho de `jobs_previsao_custo`: `ordem`,
  `data_prevista`, `valor`. É regravada inteira a cada abertura ou edição,
  com a mesma RLS por tenant.
- `jobs_aberturas` (as fotos da 059) ganhou `conta_impostos_id`,
  `impostos` (jsonb) e `imposto_previsto`. Foto anterior a 23/09/2026 fica
  com as três nulas, e o diálogo "Visualizar" mostra "Registro anterior à
  previsão de impostos (23/09/2026)".

Nenhuma linha existente foi alterada.

## 7. Onde a regra mora

- `app/(app)/financeiro/abertura-de-job/imposto-previsto.ts` — o total,
  numa função só (`impostoDoJob`), lida pela página e pela Server Action.
- `app/(app)/financeiro/abertura-de-job/curva.ts` — `sugerirImpostos`, a
  repartição proporcional.
- `app/(app)/financeiro/abertura-de-job/actions.ts` —
  `conferirImpostos` e `conferirContasObrigatorias`, nas duas actions
  (abrir e editar).
- `lib/validations/abertura-financeiro.ts` — `previsaoImpostosSchema` e
  `conta_impostos_id`.

## 8. O que ficou de fora, de propósito

- **Fluxo de Caixa** (`vw_fluxo_caixa`), **abatimento** e **título**:
  chegam com o módulo fiscal.
- **Custos de transação do internacional**: decisão adiada.
- **Data sugerida**: não há, pelo motivo do §2.

## 9. Como foi conferido (23/09/2026)

- JOB-0036, em ramo com a gravação desligada: imposto R$ 28.318,52,
  Rentabilidade R$ 40.681,60 · 28,06% com selo verde; dividir o
  recebimento gerou duas linhas de R$ 14.159,26; o ajuste manual mostrou
  "Falta" e "Seguir as parcelas"; a barra cobrou projeto, data e conta,
  nessa ordem, até chegar em "Tudo pronto".
- JOB-0032 (TES-0001/26), gravando de verdade pela edição do registro:
  `jobs.conta_impostos_id` = Conta Teste, uma linha de R$ 24.949,47 em
  `jobs_previsao_impostos`, e a foto nº 4 com cronograma, total e conta.
  O diálogo "Visualizar" mostrou o card, a conta e a tabela.
- **Não conferido na tela:** a action de abrir (não havia job de teste
  aguardando abertura; ela usa as mesmas conferências e a mesma gravação
  da edição) e o rótulo das int. taxes (não existe job internacional no
  banco).
