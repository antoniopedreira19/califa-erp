# 218 — A folha ainda não aprovada entra no fluxo de caixa como previsão

**Data:** 2026-10-27
**Status:** aceita e implementada em 27/10/2026, nas três partes: a
previsão no fluxo, a data do título na aprovação e a folha do mês seguinte
nascendo sozinha. As duas últimas mexem no código da frente do Antonio, com
autorização do Tiago no mesmo dia: "Pode alterar você a data que a
aprovação grava no título e fazer a folha do mês seguinte nascer sozinha,
mesmo sendo código do Antonio."
**Quem decidiu:** Tiago, em 27/10/2026, ao combinar que o pessoal dos custos
fixos sai pelo módulo de RH a partir do 4T (decisão
[211](211-importacao-do-historico-da-planilha-financeira.md)): "A folha em
rascunho entra no fluxo de caixa como previsão na data prevista de
pagamento, a folha do mês seguinte nasce em rascunho sozinha com a
antecedência das recorrências, e ao aprovar a previsão vira o título a
pagar, sem duplicar."
**Migrations:** `20261027100002_folha_prevista_no_fluxo_de_caixa.sql` e
`20261027100003_folha_do_mes_seguinte_nasce_sozinha.sql`.

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

## A aprovação grava a mesma data

6. **O título da aprovação nasce na data da previsão** (a prevista da
   linha; vazia, dia 03 do mês seguinte), e não mais no último dia do mês
   da competência (`dataDePagamentoDaFolha` em
   `contas-a-pagar/actions-folhas.ts`). A previsão vira o título sem mudar
   de dia.

## A folha do mês seguinte nasce sozinha

7. **A geração passa para o banco,** `gerar_folha_da_competencia`, sem
   mudar a regra do botão "Gerar folha" do RH: PJ, MEI e a parte Recibo do
   CLT com recibo, ativos em algum dia da competência, com salário e
   alocação vigentes; a alocação "toda a empresa" se expande pelo rateio da
   empresa no ano (só regional com percentual acima de zero). O botão chama
   a função, com a RLS de quem clicou, numa transação só.
8. **Uma rotina diária** (`gerar_folhas_automaticas`, pg_cron às 03:00 de
   Brasília) gera a competência quando o pagamento dela (dia 03 do mês
   seguinte) cai dentro da antecedência das recorrências, 30 dias: a folha
   11/2026 nasce em 03/11/2026, em rascunho. **Nasce uma vez:** se a
   competência já tem linha de salário da California, a rotina não mexe, e
   quem entrar depois entra pelo botão, como hoje. A auditoria registra
   `folha.gerada` sem autor e com `automatica: true`.
9. **CLT, estágio e sócio** continuam entrando só com o PDF da
   contabilidade; até lá a competência só tem PJ, MEI e CLT com recibo, e a
   previsão também.

## Conferido em 27/10/2026

- No banco: a view traz 9 linhas `previsao_folha` (4 empresas), todas em
  03/11/2026, somando R$ 1.627.250,00 — o total das 181 linhas da folha
  10/2026. A folha 09/2026 não entra. `vw_fluxo_caixa_job_totais` não muda
  (só soma linha com job). A view continua com leitura só para
  `authenticated`.
- No Fluxo de caixa, como administrador: em 11/2026, "Só previsão" das
  saídas mostra os 4 itens "Folha prevista · 10/2026" em 03/11, um por
  empresa (dois "rateada em 2 / 5 regionais").
- A rotina, num bloco desfeito no fim (nada gravado): com hoje em 02/11
  não gera nada; em 03/11 gera 180 linhas de 11/2026, em rascunho, sem
  autor, com a auditoria automática; em 04/11 não gera de novo. Contra
  outubro, mesmo salário e mesma alocação para os 179 que estão nas duas;
  saem dois PJ encerrados em 10/2026 e entra um CLT com recibo ativo desde
  01/2025 que não está na folha de outubro. A previsão de 11/2026 aparece no
  fluxo (R$ 1.613.750,00).
- O botão, simulando o administrador com a RLS (desfeito no fim): outubro
  daria 1 linha nova (o mesmo CLT com recibo) e 181 já existentes, com o
  autor certo.
- A aprovação com a data nova não foi exercida: aprovar cria um título de
  verdade. O Contas a Pagar e o RH › Folhas abrem sem erro.
