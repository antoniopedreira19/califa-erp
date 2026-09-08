# 061 — As previsões se redistribuem inteiras: a trava do consumido cai

**Data:** 2026-09-08
**Status:** aceita
**Contexto:** o formulário de abertura em `/financeiro/jobs/[jobId]`, nos
dois momentos em que ele edita um job já aberto: a revisão de errata
([059](059-revisao-da-abertura-editavel-e-o-historico-das-fotos.md)) e o
"Editar registro" livre ([021](021-projeto-do-financeiro-e-edicao-da-abertura.md)).
Revoga a trava criada na 021 §"edição do registro".

## O que caiu

A regra de 20/08/2026 dizia: o que PP emitida (curva) ou nota emitida
(previsão de recebimento) já tinha consumido ficava **congelado** — data
e valor travados, com cadeado na tela —, e só o saldo restante era
editável. O servidor conferia com `edicaoRespeitaConsumido`.

**Não existe mais.** As duas previsões se redistribuem inteiras, em
qualquer um dos dois caminhos. O que continua valendo é o total: a curva
fecha com o custo previsto e as parcelas fecham com o faturamento
previsto, como na abertura. O que a edição libera é a distribuição, não o
dinheiro.

## Por quê

**1. A trava criou um beco sem saída.** No JOB-0029: uma PP de
R$ 10.000 num item planejado em R$ 8.000 — o que a decisão
[039](039-pp-nasce-gerada-e-o-envio-ao-financeiro-e-uma-acao.md) permite,
pedindo só a confirmação do GP. O consumo (10.000) passou a curva inteira
(8.000), então o caminhamento congelou as duas linhas e ainda sobraram
R$ 2.000 sem lastro. Nenhuma linha editável.

E a errata tinha acabado de subir o custo previsto para R$ 16.000, então
faltava distribuir R$ 8.000. Acrescentar uma terceira data também não
passava: a fatia congelada da curva nova ficava com três linhas contra as
duas da guardada, e a comparação recusava. **A única saída da tela era
recusada pelo servidor** — o job não tinha como sair da revisão.

**2. A trava já protegia pouco.** Desde a
[052](052-todas-as-pps-do-item-foram-geradas.md) o abatimento da curva é
calculado **por item** (planejado menos as PPs que viraram título), e não
pela ordem cronológica das parcelas: mudar as datas não muda o quanto o
fluxo de caixa abate. E desde a
[059](059-revisao-da-abertura-editavel-e-o-historico-das-fotos.md) cada
registro confirmado deixa uma **foto imutável** — o "antes" não depende
mais de congelar linha nenhuma.

## Vale para os dois lados

Custo e recebimento, decisão do Tiago. Na prática o recebimento quase
não muda de mãos: **errata não acontece depois do envio para
faturamento** (`podeErrata = podeAcoes && !jaEnviadoParaFaturamento`), e
depois do envio quem manda na previsão de entrada são as parcelas do
envio, não a curva da abertura
([018](018-previsoes-no-fluxo-de-caixa.md)). Padronizar evitou duas
regras para o mesmo formulário.

## O que sumiu do código

| | |
|---|---|
| `lib/calculos/previsao-congelada.ts` | **apagado** — `repartirPrevisao`, `parteCongelada` e `edicaoRespeitaConsumido` não têm mais quem os chame |
| `editarRegistroDaAbertura` | as duas validações de consumo saíram; `consumoDasPrevisoes` continua, só para o metadata da auditoria |
| `AberturaForm` | sai a prop `consumo`, o campo `congelada` da linha, o cadeado do `LinhaTravada` e o "Distribuir o saldo" (virou "Distribuir") |
| `financeiro/jobs/[jobId]/page.tsx` | uma query a menos por render |

## Fora desta decisão

- **Avisar que a redistribuição contraria uma PP já emitida.** Hoje a
  tela não compara a curva com as datas das PPs; se isso virar
  necessidade, é aviso, não trava.
- A trava do **realizado** (o que já virou título ou nota não se
  reescreve) não tem nada a ver com esta e continua como está.
