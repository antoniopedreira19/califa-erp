# 004 — Previsão de desembolso e abatimento por PP

## Status

Vigente. Decidida com o financeiro em 12/08/2026, durante a revisão da
tela de Abertura de Job.

## A regra em uma frase

**Previsão de desembolso é o planejado dos itens de calha PP, distribuído
nas janelas de pagamento, e vai sendo abatida item a item conforme as PPs
do job são emitidas.**

## O que entra na previsão

Só os itens cujo custo **sai do caixa da California** — a calha PP:
`AR`, `B`, `C`, `F`, `FI`. Itens de calha BV (`A` e `D`) são pagos pelo
cliente direto ao fornecedor; o planejado deles **continua existindo como
controle interno da planilha, mas nunca gera previsão de custo**. Essa
segunda parte não muda nem em fase futura (decisão do financeiro,
12/08/2026).

A fonte no código é o campo `calha` de `REGRAS_TIPO_CUSTO`
(`lib/calculos/versao-totais.ts`), o mesmo lugar das demais regras por
tipo.

> ⚠️ 13/08/2026 — `AR` passou a aceitar BV também (decisão 003). Isso
> **não mexe nesta decisão**: `calha` continua "PP" no `AR`, então ele
> segue entrando na previsão de desembolso exatamente como antes. "Tem
> BV" e "sai do caixa da California" viraram duas perguntas separadas, e
> só a segunda é que esta decisão lê. Quem responde pela primeira é
> `TIPOS_COM_BV`, validado no banco pelo trigger `bv_exige_item_com_bv`
> (hoje `A`, `AR`, `D`).

Consequência aceita: job 100% A/D abre com custo previsto **zero** e sem
curva. A tela avisa que não há desembolso previsto — é um estado
legítimo, não um erro.

## Janelas de pagamento

A California paga em **duas janelas por mês: dia 08 e dia 20**. Caindo em
sábado, domingo ou feriado, vale o **dia útil seguinte**. As datas da
curva de desembolso só podem ser janelas — o formulário sugere e trava, e
a Server Action revalida.

> ⚠️ Pendência conhecida: o ajuste de dia útil cobre **só fim de semana**.
> Não existe calendário de feriados no sistema ainda; quando existir, o
> ajuste entra em `ajustarParaDiaUtil` (`abertura-de-job/curva.ts`), num
> lugar só.

## Abatimento por PP

A PP **é o título** (inclusive com documento anexado). A previsão é o que
**ainda não virou PP**. As regras, nas palavras do financeiro:

1. **Por item.** Quando um item ganha PP, o planejado **inteiro** daquele
   item sai da previsão — mesmo que a PP seja de valor menor. A partir
   dali quem representa aquele custo no fluxo de caixa é o título, não a
   previsão.
2. **Ordem cronológica, mais próxima primeiro.** O abatimento consome o
   saldo da data mais próxima; só passa à seguinte quando a anterior
   zera. Exemplo validado: curva 08/09 (5 mil), 20/09 (5 mil), 08/10
   (5 mil); PP abate 7 mil → 08/09 zera, 20/09 fica com 3 mil, 08/10
   intacta.
3. **Rolagem.** Saldo de previsão cuja data passou sem virar PP rola para
   a **próxima janela de pagamento**, quantas vezes for preciso.
4. **Encerramento.** Item que nunca gerou PP fica rolando como previsão
   até o job encerrar. No encerramento, **toda previsão remanescente é
   encerrada junto**.

## Como implementar o abatimento (quando o fluxo de caixa chegar)

O abatimento é **resíduo calculado na leitura**, não escrita destrutiva
na curva. A curva gravada na abertura nunca é alterada por PP — ela é o
registro do que o financeiro previa. O fluxo de caixa calcula:

```
resíduo do job = curva da abertura − planejado dos itens que já têm PP
                 (consumindo na ordem da regra 2, piso em zero)
projeção       = títulos (PPs) por vencimento + resíduo rolado por janela
```

Três motivos: cancelar PP (que já existe no sistema) desfaz o abatimento
sozinho; a curva original permanece como base do previsto × realizado; e
não há dois registros para manter em sincronia por trigger.

## O que esta decisão NÃO cobre

- Feriados no ajuste de dia útil (pendência acima).
- A tela de fluxo de caixa em si — fase futura; esta decisão fixa as
  regras que ela vai ler.
- Faturamento (contas a receber) — outra régua, outro documento.
