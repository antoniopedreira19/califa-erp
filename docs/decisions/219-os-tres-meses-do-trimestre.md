# 219 — Fee e Always On: os três meses do trimestre

**Data:** 2026-10-27
**Status:** entrega 1 (orçamento e planilhas) implementada em 27/10/2026;
entrega 2 (mês novo no job pela errata) em andamento.
**Quem decidiu:** Tiago. Pedido em 27/10/2026: "Atualmente GPs tem esquecido
de adicionar os meses seguintes frequentemente." Protótipo aprovado no mesmo
dia, depois de onze versões comentadas por ele:
https://claude.ai/artifact/F3zt3F9Q9ogt8SqMrEJVMQ ("Design aprovado, pode
implementar").
**Revê:** a [078](078-orcamento-mensal-fee-e-always-on.md) na régua (o
bloco "Trimestre" vira "Total" e é onde a tela abre) e no aviso do mês
enviado.
**Migrations:** nenhuma na entrega 1.

## O problema

Em 27/10/2026, 14 dos 41 orçamentos de Fee e Always On tinham um mês só,
vários começando em novembro ou dezembro: o GP punha o fim no último dia do
mês de início, o orçamento nascia com um mês e os seguintes viravam
orçamentos separados. Com o job aberto, o mês que faltou não tinha como
entrar: a saída era cancelar o job.

## A regra — entrega 1

1. **O Fim previsto vem no fim do trimestre.** No formulário do orçamento
   (criação e edição, o mesmo formulário), com Fee ou Always On, escolher o
   Início previsto preenche o Fim com o último dia do trimestre do início.
   Só quando o fim está vazio, antes do início ou em outro trimestre: o fim
   que o GP encurtou fica.
2. **Os meses aparecem abaixo das datas.** "Meses da planilha: Outubro ·
   Novembro · Dezembro", cada um com o × do campo de data ao lado. O
   primeiro mês não tem ×: ele vem do Início previsto. Só o último sai — o
   Fim volta ao último dia do mês anterior; o × do mês do meio fica apagado
   (o período é contínuo). O mês do trimestre que ficou depois do fim
   aparece num aviso: "Dezembro fica de fora do 4º trimestre de 2026."
3. **Orçamento e planilha do job abrem no Total.** Sem `?mes=` na URL, a
   régua seleciona o primeiro bloco, que passa a se chamar "Total" (a chave
   na URL continua `trimestre`); os meses só abrem sozinhos quando são
   escolhidos. Vale para a tela do orçamento, para a planilha interna do
   job na produção e para a do financeiro (o componente é o mesmo).
4. **Na vista Total do orçamento, a barra de cada mês fica acima da linha do
   mês.** "Recolher todos" (dos grupos), "Save" e "Exibir" deixam de ficar
   entre a linha do mês e a planilha.
5. **O aviso do mês enviado aparece na tentativa.** A faixa fixa "Outubro já
   foi enviado para faturamento: errata e consumo de save ficam travados
   nesse mês" saiu da régua do job. Com a errata ligada, quem clica numa
   linha de mês enviado vê, acima da planilha do mês: "Outubro já foi
   enviado para faturamento: as linhas desse mês não mudam pela errata."
   (fecha no ×; clicar em botão, como recolher grupo, não conta). O consumo
   de save já avisava no próprio pop-up.

## Como funciona

- `lib/calculos/meses-trimestre.ts`: `fimDoTrimestre` e
  `mesesForaDoPeriodo` (com testes).
- `app/(app)/orcamentos/[projetoId]/orcamento-form.tsx`: o Fim previsto
  ficou controlado; um efeito sobre o início e o modelo preenche o fim. Os
  meses e o × são `meses-do-periodo.tsx`.
- `planilha-mensal.tsx` e `job-realizado-section.tsx`: `mesPedido`
  ausente = Total; rótulo "Total".
- `app/(app)/_planilha/lugar-da-barra.tsx`: o `TrimestreEmpilhado`
  (prop `barraAcimaDoMes`, só no orçamento) põe um lugar acima da linha de
  cada mês aberto e o entrega por contexto; a barra da `GruposSection` vai
  para lá por portal. Fora dele, a barra fica onde sempre esteve.
- `app/(app)/jobs/[jobId]/realizado/aviso-do-mes-enviado.tsx`: o aviso; a
  tabela do mês travado escuta o clique na errata.

## Entrega 2 — mês novo no job pela errata

Aprovada no protótipo, em implementação:

- Fora da errata a régua do job fica como hoje. Com "Realizar errata", os
  meses do trimestre que o job não tem aparecem tracejados ao lado dos
  outros; o clique põe o mês na errata, com os itens do último mês do job
  ou vazio.
- A errata abre mesmo com todos os meses do job enviados para faturamento,
  quando falta mês no trimestre.
- O "Confirmar errata" lista os meses novos; o mês deixado vazio não entra.
- Só meses do mesmo trimestre: um job continua sendo um trimestre.
