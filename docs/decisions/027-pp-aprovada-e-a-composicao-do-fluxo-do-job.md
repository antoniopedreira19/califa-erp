# 027 — PP aprovada é título, e a composição do valor no fluxo do job

**Data:** 2026-08-26
**Migrations:** `20260826000001_fluxo_caixa_job_pp_aprovada_e_recebimento.sql`,
`20260826000002_backfill_previsao_recebimento_legada.sql`,
`20260826000003_cronograma_de_desembolsos_no_texto.sql`
**Contexto:** aba "Fluxo de Caixa do Job" (`/financeiro/jobs/[jobId]`).
Nasceu de uma investigação com dado real: o JOB-0013 mostrava a coluna
Entradas inteira vazia e R$ 25.000,00 de saída onde havia R$ 65.000,00
previstos.

---

## 1. Quem abate a previsão é a APROVAÇÃO da PP, não a PP

A [004](004-previsao-de-desembolso.md) já dizia "a PP **é o título**",
mas não dizia em que status. A view resolvia isso com dois filtros que
não conversavam: a curva era abatida por qualquer PP que não estivesse
cancelada ou rejeitada, enquanto só PP `aprovada`/`pago` virava título.
No intervalo entre criar e aprovar, o custo não existia em lugar nenhum.

Decisão do Tiago (26/08/2026), nas palavras dele:

> As previsões só se transformam em títulos quando os itens que faziam a
> parte do "planejado" (que alimenta as previsões) vão se tornando
> "realizado" ao serem aprovados e transformado em um título a pagar,
> depois de terem se tornado uma PP.

Os dois filtros passam a ser `status in ('aprovada','pago')`. PP em
avaliação volta a rolar como previsão — que é onde o dinheiro está
enquanto o financeiro não aprovou.

Tudo o mais da 004 continua: abate o planejado **inteiro** do item mesmo
com PP menor, na ordem cronológica, com piso em zero, e o resíduo é
calculado na leitura.

*(Descartada: manter o abatimento na criação da PP e fazer a PP em
avaliação aparecer como título. Foi considerada — a 004 chama a PP de
título —, mas colocaria no fluxo de caixa um valor que o financeiro
ainda pode recusar.)*

## 2. O que não é PP só entra no fluxo do JOB depois da baixa

Conta avulsa e desembolso aprovados aparecem no **Fluxo de Caixa geral**
— são compromisso real da empresa. No **recorte por job**, não: eles só
entram como movimento, depois de pagos.

O motivo é o abatimento da regra 1. A curva de desembolso da abertura só
é abatida por PP; uma avulsa aprovada somaria como título a pagar do job
sem tirar nada da previsão, e o job apareceria devendo o mesmo dinheiro
duas vezes.

O filtro vive em dois lugares, de propósito: em
`app/(app)/financeiro/jobs/[jobId]/fluxo-do-job.ts`, para a aba, e na
`vw_fluxo_caixa_job_totais`, para a lista "Visualizar Jobs" — as duas
leituras precisam concordar. A `vw_fluxo_caixa` **não** filtra: a
tesouraria tem de continuar vendo esses títulos.

## 3. O recebimento pago é rateado por job pela composição da nota

`dar_baixa_titulo`, `dar_baixa_titulo_com_plano` e
`estornar_baixa_titulo` inserem o lançamento sem `job_id` — são as
únicas três de oito RPCs de baixa que não gravam o campo. O efeito era
estrutural: ao receber, o título saía da classe `titulo` e o movimento
não entrava com job. A linha "Já movimentado na conta" das Entradas era
sempre zero, em job nenhum.

**Preencher `job_id` não é o conserto.** Uma nota pode somar vários jobs,
e uma coluna só não representa isso — foi por isso que as RPCs a
deixaram vazia. O lançamento já grava `titulo_receber_id`, então o job
sai do mesmo caminho que a classe `titulo` já usava: título →
faturamento → `fat_composicao`, rateado pela participação de cada job na
nota.

Assim o previsto e o realizado do mesmo recebimento são atribuídos pela
mesma régua, nenhuma RPC muda, e a soma é preservada (os fatores de um
mesmo lançamento somam 1).

## 4. O estorno continua somando, e quem o separa é a composição

O estorno cria um par: o lançamento original vira `*_baixa_estornada` e
um contra-lançamento `*_estorno` entra com a natureza invertida. No fluxo
do job isso faz um estorno de PP aparecer como **entrada**.

Decisão do Tiago (26/08/2026): **os dois continuam somando nas linhas de
movimento** — o número é o do extrato, o dinheiro saiu e voltou. O que
muda é que agora dá para ver o que há por trás.

Consequências assumidas, com o JOB-0015 como exemplo:

| Linha | Mostra | Composição |
|---|---|---|
| Entradas · já movimentado | R$ 18.959,11 | R$ 10.959,11 de recebimento + 2 × R$ 4.000,00 de estorno de PP |
| Saídas · já movimentado | R$ 16.000,00 | 2 baixas reais + 2 baixas estornadas da mesma parcela 3/3 |

Os rótulos das sub-linhas de movimento deixaram de dizer "recebimentos
do cliente" e "PPs e contas pagas": com o estorno somando ali, essas
promessas passaram a ser falsas. Agora dizem "o que entrou/saiu na
conta".

## 5. A composição do valor no hover e no clique

Toda célula da matriz abre a lista dos documentos que a formam — no
hover (com atraso curto, para varrer a tabela não disparar um popover
por célula) e no clique, que **fixa** o popover para dar tempo de ler e
rolar.

Cada item traz rótulo, código, descrição, data e valor. O rótulo é o que
nomeia o estorno como estorno **da PP em questão** ("ESTORNO DE PP ·
PP-00009 3/3"), e estorno recebe fundo âmbar.

Vale para as três sub-linhas, para a linha total de cada natureza, para a
linha **Líquido do período** e, na visão agregada do projeto, para a
contribuição de cada job.

O líquido é o único lugar onde as duas naturezas convivem numa célula, e
por isso é o único que mostra **sinal**: entrada com `+` em verde, saída
com `−` em vermelho, entradas listadas primeiro. A cor do próprio valor
também sai do sinal ali, não da natureza — sobrou dinheiro no mês (verde)
ou faltou (vermelho).

O **Saldo acumulado** ficou de fora de propósito: ele é a soma corrida de
todos os meses anteriores, e a composição dele seria a matriz inteira
repetida em cada coluna.

**Só na aba do job**, por ora. A tela geral `/financeiro/fluxo-caixa` tem
Mensal/Semanal/Diário e uma implementação de matriz própria; levar a
composição para lá — respeitando o nível ativo, como o Tiago descreveu —
é entrega seguinte.

## 6. O nome é "Cronograma de desembolsos"

A previsão de custo do job era chamada de três formas diferentes na
interface: "Previsão de custos" (o `<h2>` da seção no form de Abertura do
Job), "Curva de desembolso" (o bloco dentro dessa seção, e a sub-linha da
aba de Fluxo de Caixa) e "Curva {codigo} · desembolso {n}/{m}" (o texto
que a view monta e que a composição do valor passou a mostrar).

Decisão do Tiago (26/08/2026): o nome é **Cronograma de desembolsos**, um
nível abaixo de "Previsão de custos", que já nomeia a seção que o contém.

```text
Previsão de custos › Cronograma de desembolsos
```

Trocado nos três lugares — a sub-linha da aba, o form de abertura (bloco,
subtítulo e as 4 mensagens de erro) e a `descricao` do branch 6 da view,
que passou ao formato do branch de recebimento: `Cronograma de
desembolsos · JOB-0013 1/2`.

⚠️ Como a `descricao` vem do banco, a tela geral `/financeiro/fluxo-caixa`
também passa a dizer o nome novo. É intencional: é a mesma linha, e o
objetivo da mudança era acabar com dois nomes para uma coisa só.

A tabela continua `jobs_previsao_custo`. Renomear tabela em uso é
destrutivo e não traria nada.

## 7. "Saldo do job hoje" é só o que passou pela conta

O card somava a COLUNA do mês corrente, com as três classes. Isso
contradizia o próprio subtítulo ("Entradas menos saídas já movimentadas")
e brigava com a rolagem da [018 §3](018-previsoes-no-fluxo-de-caixa.md):
previsão vencida sem documento rola para frente, mas rolar de 19/08 para
27/08 mantém a linha DENTRO de agosto, e a coluna a engolia de volta. O
JOB-0013 mostrava R$ 104.064,87 "já movimentados" num job sem um centavo
na conta.

Decisão do Tiago (26/08/2026), nas palavras dele:

> A regra da previsão deve permanecer, onde se a data da previsão tiver
> se materializado e a previsão não tiver ocorrido ela deverá rolar para
> frente, e desse modo, não fazer parte do saldo do job de hoje.

A rolagem fica como está. O que muda é o card: passa a somar **só a
classe `movimento`, e só até hoje**, contado por DATA e não por mês.

Perguntado e decidido junto: **título vencido e não pago NÃO entra.** Uma
PP aprovada que passou do vencimento tem data no passado e não rola, mas
o dinheiro não saiu da conta — e o card promete "já movimentadas".
Descartada a alternativa de somar as três classes com data ≤ hoje: daria
o mesmo número hoje (nenhum job tem título vencido em aberto), mas no
primeiro atraso o subtítulo passaria a mentir.

O `saldoFim` não muda: a projeção do fim do job continua somando tudo.

O cálculo saiu da matriz e passou a percorrer as linhas direto, para não
depender do recorte mensal nem do teto de 36 colunas.

## 8. Backfill da previsão de recebimento legada

`jobs_previsao_recebimento` nasceu em 17/08/2026. Todo job aberto antes
disso ficou sem previsão de entrada, e a aba nascia com a coluna
Entradas vazia — foi o que apareceu no JOB-0013.

Decisão do Tiago: uma parcela única, no valor de
`jobs.faturamento_previsto`, na data de `jobs.data_prevista_faturamento`.
Não existe coluna de prazo de recebimento em lugar nenhum do banco, e
somar um prazo por cima seria inventar número.

8 dos 10 jobs abertos foram preenchidos. **JOB-0001 e JOB-0002 ficaram de
fora**: `data_prevista_faturamento` nula. Os dois seguem sem previsão até
alguém informar a data pela tela "editar registro de abertura".

`created_by` fica nulo no backfill — é o que distingue a linha gravada
por régua da linha decidida por uma pessoa na abertura.

## 9. O que esta decisão NÃO cobre

- A composição na tela geral de Fluxo de Caixa (regra 5) — só o texto
  do banco chegou lá, não o popover.
- A composição da linha Saldo acumulado (regra 5).
- `estornar_baixa_pp` (estorno da PP inteira), que segue sem porta na
  interface desde a decisão 016 e continua com a pendência registrada em
  `20260818000001`.
- Prazo de recebimento como dado do cliente ou do job — hoje não existe,
  e é o que obrigaria o backfill a usar a data de faturamento.
