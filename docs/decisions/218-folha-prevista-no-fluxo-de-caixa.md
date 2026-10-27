# 218 — A folha ainda não aprovada entra no fluxo de caixa como previsão

**Data:** 2026-10-27
**Status:** a previsão no fluxo implementada em 27/10/2026. A data do
título na aprovação e a folha nascer sozinha dependem do código da frente
do Antonio e estão abertas (ver o fim).
**Quem decidiu:** Tiago, em 27/10/2026, ao combinar que o pessoal dos custos
fixos sai pelo módulo de RH a partir do 4T (decisão
[211](211-importacao-do-historico-da-planilha-financeira.md)): "A folha em
rascunho entra no fluxo de caixa como previsão na data prevista de
pagamento, a folha do mês seguinte nasce em rascunho sozinha com a
antecedência das recorrências, e ao aprovar a previsão vira o título a
pagar, sem duplicar."
**Migrations:** `20261027100002_folha_prevista_no_fluxo_de_caixa.sql`.

## O problema

As recorrências entram no fluxo antes de virar título (a "Recorrência
prevista"). A folha, não: só aparecia depois de aprovada linha a linha,
quando a aprovação cria a conta avulsa (`contas_avulsas.folha_id`). Com o
pessoal saindo pelo RH a partir do 4T, a maior saída do mês (R$ 1,6 mi na
folha 10/2026) ficava fora da projeção até a véspera do pagamento.

## A regra

1. **Entra a linha da folha que ainda não tem título:** rascunho, enviada
   ou pendente de correção, sem conta avulsa com o `folha_id` dela. Ao
   aprovar, a conta avulsa nasce e a linha sai da previsão: não duplica.
2. **A data é a data prevista de pagamento da linha; vazia, o dia 03 do mês
   seguinte à competência**, como a planilha paga o pessoal (as 213 linhas
   de pessoal do histórico).
3. **Só as competências a partir de 10/2026**, quando o sistema começa. A
   folha 09/2026 está toda em rascunho (recriada em 14/10, 202 linhas,
   R$ 1,66 mi), mas foi paga fora do sistema no começo de outubro; com ela,
   o fluxo mostraria R$ 1,66 mi a pagar que já saíram. Da 10/2026 em
   diante, a linha cuja data passou vai para a próxima janela de pagamento,
   como a Recorrência prevista. (Escolha do Tiago entre três opções: tirar
   a vencida de qualquer mês, ou tratá-la toda como recorrência.)
4. **O valor é o `salario_base`**, o mesmo que a aprovação grava no título,
   dividido pelas alocações da linha. A linha sem alocação não tem empresa e
   fica de fora.
5. **Uma linha por competência, empresa e regional, sem nome:** "Folha
   prevista · 10/2026", e a tela junta as regionais da mesma empresa num
   item. O salário de cada pessoa continua só na folha, que o
   administrador, o RH e o financeiro leem.

## O que fica aberto (frente do Antonio)

- **A aprovação grava o título no último dia do mês da competência**
  (`ultimoDiaDoMes` em `contas-a-pagar/actions-folhas.ts`). Pela regra 2,
  passa a gravar a mesma data da previsão. Enquanto não mudar, a linha
  aprovada sai de 03/11 e o título entra em 31/10: não duplica, mas anda
  três dias.
- **A folha do mês seguinte nascer sozinha**, em rascunho, com a
  antecedência das recorrências (30 dias): hoje ela nasce pelo "Gerar
  folha" do RH (`rh/folhas/actions.ts`).
- **CLT, estágio e sócio** só entram na folha com o PDF da contabilidade;
  até lá a competência só tem PJ, MEI e CLT com recibo, e a previsão
  também.

## Conferido em 27/10/2026

- No banco: a view traz 9 linhas `previsao_folha` (4 empresas), todas em
  03/11/2026, somando R$ 1.627.250,00 — o total das 181 linhas da folha
  10/2026. A folha 09/2026 não entra. `vw_fluxo_caixa_job_totais` não muda
  (só soma linha com job). A view continua com leitura só para
  `authenticated`.
- No Fluxo de caixa, como administrador: em 11/2026, "Só previsão" das
  saídas mostra os 4 itens "Folha prevista · 10/2026" em 03/11, um por
  empresa (dois "rateada em 2 / 5 regionais").
