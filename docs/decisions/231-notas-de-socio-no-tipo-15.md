# 231 — Notas de sócio no Tipo 15

**Data:** 2026-11-02
**Status:** aceita e implementada em 02/11/2026.
**Quem decidiu:** Tiago, ao aprovar o protótipo em 02/11/2026 ("Aprovar assim"). A linha líquida da DRE é de 31/10/2026.
**Revê:** a [230](230-mutuo-entre-empresas.md), no reconhecimento pela linha do banco: o PIX de empresa de fora deixa de aparecer como devolução de mútuo.
**Migration:** `20261102100004`.

## O problema

A empresa emite nota a quem paga o sócio e repassa o dinheiro aos sócios. Na planilha, a entrada e as saídas ficam no Tipo DL. No sistema, o Tipo 15 era só de saída e o Recebimento avulso não o oferecia: a entrada não tinha como ser lançada.

Pior: o PIX da Community aparecia na Conciliação como "Devolução de mútuo", com o botão "Lançar mútuo", e a linha nem oferecia avulso. Um clique abateria a nota do saldo do mútuo.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | Onde mora | Tipo 15, subtipo 15.001 "Notas de sócio". O Tipo 15 passa de Saída para Ambos, como o Tipo 12. O nome não leva o pagador: a entrada veio da FitDance de 08/2024 a 01/2026 e da Community desde 04/2026 |
| D2 | Como entra | Pelo Recebimento avulso e pelo "Lançar" da linha do banco. Uma nota por PIX: é uma linha no banco e um lançamento |
| D3 | PIX de empresa de fora | A linha pergunta: "PIX da Community", com "Lançar" oferecendo Notas de sócio, Avulso e Devolução de mútuo. O CNPJ diz quem pagou, não o que é |
| D4 | Regional | TD, sem rateio, como a planilha e o mútuo. A trava "toda conta avulsa precisa de rateio" abre exceção só para este subtipo. As listas mostram TD |
| D5 | Número da nota | Campo próprio, `contas_avulsas.numero_nf`, obrigatório só na entrada deste subtipo. Vai também para a descrição, que é o que as listas mostram |
| D6 | Saídas | Repasse aos sócios e impostos da nota usam o mesmo subtipo, pelo Pagamento avulso. Também sem rateio |
| D7 | DRE | A linha fica líquida: a entrada desconta o repasse, pela regra que já existe em `lib/historico-financeiro/dre.ts` |

## Por que perguntar na linha

Foram três opções no protótipo: perguntar sempre, tratar todo PIX da empresa de fora como nota, ou decidir pelo valor do mês anterior. Perguntar é a única que nunca rotula errado. Custa um clique a mais em duas linhas por mês.

A regra do extrato não serve: ela olha só o começo do histórico, roda antes dos títulos e pegaria também a devolução real. A volta prevista do mútuo tem título e casa antes de chegar a essa seção. Quem cria a nota antes de o PIX chegar também não vê a pergunta: a linha acha o título.

Vale só para empresa de fora. Entre CNPJs do grupo, a linha continua na seção "Mútuo entre empresas".

## A nota e o saldo do mútuo

A nota é uma conta avulsa. O saldo do mútuo soma só `transferencias_contas`, então lançar a nota não mexe nele.

## A DRE e a planilha

A DRE só lê o histórico. O lançamento novo chega a ela pela carga da planilha, e não pelo sistema.

Quando a DRE passar a ler o sistema, o trimestre vem da nota, e não da data do PIX: o PIX de 02/10 é nota de setembro, DL 3T. Por isso o número da nota fica guardado.

**A planilha continua diferente.** A coluna da Santander GoCrazy na linha da DRE não soma a entrada. Essa diferença é a DIV-001: R$ 630.000 na planilha de 01/11, e cresce a cada mês enquanto a fórmula não mudar. O Lucro líquido não muda: mudam a Distribuição de lucro e o Reinvestimento.

## O que ficou de fora

- **A nota no Fiscal:** esta entrega registra o dinheiro, não a nota. Nenhuma nota real está em Faturamento ainda.
- **Impostos da nota pelo Fiscal:** seguem pelo Pagamento avulso, no mesmo subtipo, como na planilha.
- **Trimestre na nota:** não há campo. O número da nota permite recuperá-lo depois.
- **Entrada em "Geral (provisório)":** continua possível, porque o plano não separa entrada e saída por subtipo. A DRE soma igual.
