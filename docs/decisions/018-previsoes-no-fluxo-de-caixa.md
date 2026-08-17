# 018 — As previsões da abertura no fluxo de caixa

**Data:** 2026-08-17
**Status:** aceita
**Contexto:** `/financeiro/fluxo-caixa` (Tela 3.4). Design de referência:
`Fluxo de Caixa.dc.html`, projeto Claude Design `69342d83`.

Esta decisão fecha a lacuna que a [015](015-previsao-de-recebimento-na-abertura.md)
abriu e a [017 §"o que ficou de fora"](017-faturamento-agrupado-parcial-e-avulso.md)
repetiu: **como o título emitido abate a previsão de recebimento da
abertura.** Do lado da SAÍDA a regra já existia
([004](004-previsao-de-desembolso.md)); do lado da ENTRADA, não.

## 1. O envio para faturamento sobrescreve a previsão da abertura

Decisão do Tiago. A previsão de recebimento de um job é lida assim:

| Estado do job | O fluxo de caixa projeta por |
|---|---|
| **Sem** envio para faturamento | `jobs_previsao_recebimento` — a curva da abertura |
| **Com** envio para faturamento | `jobs_envio_faturamento_parcelas` **menos** o que já virou título |

Nas palavras dele: quando a produção envia o job para faturamento, o que
foi enviado **passa a ser** a previsão — é uma previsão mais real, porque
já diz em quantas notas e para quando. Mas **continua previsão**; só vira
título ao ser faturada.

As duas fontes nunca se somam, e não é por sorte: ambas fecham contra
`jobs.faturamento_previsto` ([015](015-previsao-de-recebimento-na-abertura.md)
e [017 §3](017-faturamento-agrupado-parcial-e-avulso.md)). Trocar uma pela
outra preserva o total do job.

**Sobrescrever é leitura, não escrita.** Nada em `jobs_previsao_recebimento`
é apagado ou reescrito — ela continua sendo o registro do que se previa na
abertura, que é o que permite comparar previsto × realizado depois. Mesmo
princípio da [004](004-previsao-de-desembolso.md): "o resíduo é calculado
na leitura".

*(Descartadas: abater a previsão da abertura por valor, cronologicamente,
mantendo as parcelas do envio fora da projeção — projetaria pelas datas da
abertura um job cuja produção já informou datas melhores; e ler as
parcelas do envio inteiras, sem abater o já faturado, que contaria o mesmo
dinheiro duas vezes, em "Títulos em aberto" e em "Só previsão".)*

## 2. Parcela faturada em parte mantém o saldo previsto, na data dela

Parcela de R$ 50 mil com NF parcial de R$ 30 mil: R$ 30 mil viram título e
R$ 20 mil continuam previstos, **no vencimento da parcela do envio**. É o
mesmo saldo remanescente que a aba Faturamento já mostra
([017 §1](017-faturamento-agrupado-parcial-e-avulso.md)).

Aqui a entrada **diverge** da saída de propósito. Na
[004 regra 1](004-previsao-de-desembolso.md), item que ganha PP sai da
previsão pelo planejado inteiro, mesmo com PP menor. Do lado da entrada
não: o saldo a faturar é um número que o sistema conhece com exatidão
(`parcela − itens de NF que a consumiram`), enquanto do lado da saída o
"quanto ainda falta daquele item" não existe — a PP é o título, e o que
sobra é ruído. Simetria por simetria teria escondido dinheiro real.

## 3. Previsão vencida e sem documento rola

| Lado | Rola para |
|---|---|
| Saída (curva de desembolso) | a próxima **janela de pagamento** — dia 08 ou 20, ajustada para o dia útil seguinte ([004 §3](004-previsao-de-desembolso.md)) |
| Entrada (previsão de recebimento) | **hoje + 1** |

A entrada não tem janela: os dias 08 e 20 são o calendário com que a
California **paga fornecedor**, e quem manda na data de entrada é o
cliente ([015](015-previsao-de-recebimento-na-abertura.md)).

O Tiago descreveu a regra como "rolar para o dia seguinte". Como o cálculo
é feito **na leitura**, e não gravado, rolar um dia a cada dia é o mesmo
que pousar sempre em amanhã — as duas formulações são a mesma regra, e
está implementada como `hoje + 1`.

Sem a rolagem, previsão velha ficaria parada numa coluna rotulada
REALIZADO, misturada com o que de fato entrou na conta.

**Título vencido NÃO rola.** Só previsão. Título a pagar ou a receber
vencido e não baixado fica na data dele, numa coluna de passado — é
inadimplência real, e escondê-la seria mentir.

## 4. Rateio de regional entra proporcional

Conta avulsa rateada 60% NE / 40% SP, de R$ 10 mil, entra com R$ 6 mil
quando o filtro é NE. É o que o percentual de `contas_avulsas_regionais`
significa, e faz a soma das regionais bater com o total.

Consequência estrutural: a `vw_fluxo_caixa` passou a emitir **uma linha
por regional** nas origens que têm rateio — a conta avulsa, o lançamento
que a baixou, e o título de NF agrupada (que rateia entre os jobs da nota,
na proporção de `faturamento_itens`). A soma continua correta; o que
deixou de valer é "uma linha = um documento". A tela reagrupa por
documento antes de exibir o drill-down.

## 5. O filtro "Divisão" não existe

O protótipo tem um filtro DIVISÃO (Trade / Live Marketing / Digital). Esse
conceito **não existe no banco** — não há tabela de divisões nem coluna em
job, empresa ou lançamento. O Tiago decidiu **remover o filtro** em vez de
mapeá-lo para `jobs.categoria_id` ou criar o conceito.

A tela sai com Nível, Horizonte, Conta bancária e Regional.

## 6. Saldo bancário vem do razão, não é reconstruído

O protótipo reconstrói o saldo de abertura da janela (saldo de hoje menos
o realizado exibido). Na implementação real ele é lido: `contas_bancarias.
saldo_inicial` na `saldo_inicial_data` + os lançamentos daí em diante,
pela função `fc_saldos_por_conta(date)`.

**O que é o saldo inicial** (Tiago, nesta sessão): a âncora de conciliação
da conta — serve para o sistema bater com o extrato real sem precisar do
histórico inteiro desde que a conta existe. Por isso os dois campos travam
assim que a conta ganha o primeiro lançamento.

Convenção adotada, que não estava escrita em lugar nenhum: `saldo_inicial`
é o saldo **na abertura** do dia `saldo_inicial_data`, então lançamento
daquele dia soma por cima. Não havia lançamento nenhum no banco quando
isto foi decidido; inverter é trocar `>=` por `>` numa linha da função.

## Onde a regra mora

| Onde | O quê |
|---|---|
| `supabase/migrations/20260817000006_vw_fluxo_caixa_previsoes.sql` | a `vw_fluxo_caixa` com a coluna `classe`, o resíduo da curva, a sobrescrita pelo envio, as rolagens e o rateio; mais `fc_proxima_janela_pagamento` e `fc_saldos_por_conta` |
| `supabase/migrations/20260817000007_fc_janelas_grant_public.sql` | correção do `grant execute` das duas funções de data |
| `app/(app)/financeiro/fluxo-caixa/page.tsx` | a janela fixa lida do banco e o saldo de partida |
| `app/(app)/financeiro/fluxo-caixa/fluxo-caixa-view.tsx` | a matriz, o drill-down e a curva — só agrupa e soma, não recalcula regra |

**A regra mora no banco, não na tela.** Qualquer leitor futuro da
`vw_fluxo_caixa` (o DRE, por exemplo) recebe o abatimento e a rolagem
prontos.

## O que ficou de fora, de propósito

- **`security_invoker` nas views.** As três views do schema (`vw_a_pagar`,
  `vw_fluxo_caixa`, `vw_faturamento_pendente`) são do `postgres` e sem
  `security_invoker`, então **ignoram a RLS** das tabelas de baixo. Ligar
  a opção fecha isso numa linha e foi conferido que não quebraria nada.
  Decisão do Tiago: acessos ficam para a fase de cadastro de usuários e
  permissões, depois de todas as telas definidas.
- **Centavo do rateio.** A fatia arredonda a 2 casas, então a soma das
  partes pode ficar um centavo longe do total do documento.
- **Regional e saldo.** Com um filtro de regional ativo, os indicadores de
  saldo e a linha "Saldo projetado" partem do saldo bancário **inteiro**
  (que não tem regional) e acumulam apenas os fluxos da regional
  filtrada — comportamento do protótipo, mantido. Vale confirmar na etapa
  de testes no navegador.
- **Contato de cobrança** (`jobs_contatos`) segue invisível para o
  financeiro. A lacuna da [012](012-contato-de-cobranca-do-job.md)
  continua aberta.
