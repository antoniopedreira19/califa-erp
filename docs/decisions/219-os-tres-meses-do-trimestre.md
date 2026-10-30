# 219 — Fee e Always On: os três meses do trimestre

**Data:** 2026-10-27
**Status:** implementada em 27/10/2026 — entrega 1 (orçamento e
planilhas) e entrega 2 (mês novo no job pela errata).
**Quem decidiu:** Tiago. Pedido em 27/10/2026: "Atualmente GPs tem esquecido
de adicionar os meses seguintes frequentemente." Protótipo aprovado no mesmo
dia, depois de onze versões comentadas por ele:
https://claude.ai/artifact/F3zt3F9Q9ogt8SqMrEJVMQ ("Design aprovado, pode
implementar").
**Revê:** a [078](078-orcamento-mensal-fee-e-always-on.md) na régua (o
bloco "Trimestre" vira "Total" e é onde a tela abre) e no aviso do mês
enviado.
**Migrations:** nenhuma na entrega 1; entrega 2:
`20261027960001_mes_novo_no_job_pela_errata.sql` e
`20261027960002_errata_ordem_nula.sql`.

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

## A regra — entrega 2: o mês que faltou entra pela errata

6. **Fora da errata a régua do job fica como hoje.** Com "Realizar errata",
   os meses do trimestre que o job não tem aparecem tracejados ao lado dos
   outros ("Adicionar mês · Entra com esta errata"). O clique pergunta
   como o mês entra: "Com os itens de {último mês do job}" (os grupos e as
   linhas, com orçado e planejado, viram linhas novas da errata) ou
   "Vazio". A tela vai para o mês novo.
7. **A errata abre mesmo com todos os meses do job enviados para
   faturamento** quando falta mês no trimestre; os meses enviados seguem
   travados.
8. **O "Confirmar errata" lista os meses novos** ("Novembro · 1 item";
   "Dezembro · sem item: não entra no job"). O mês deixado vazio não
   entra; o servidor recusa mês novo sem linha.
9. **Só meses do mesmo trimestre do job** — um job continua sendo um
   trimestre. Só Fee e Always On.
10. **Onde o mês fica (escolha do Tiago, opção 1):** o job lê os meses da
    versão aprovada, então o mês novo entra **também na versão aprovada,
    vazio**, com um agrupamento-âncora vazio ("Incluído pela errata do
    job"); os dois ficam marcados com a errata (`incluido_na_errata_id`).
    As linhas são só do job. No orçamento, a régua mostra o mês com
    "Incluído pela errata do job"; o período do orçamento não muda.
11. **O período do job acompanha:** `data_inicio_prevista` e
    `data_fim_prevista` passam a cobrir o mês novo.
12. Como toda errata depois da abertura, o job volta ao mural para a
    revisão do financeiro, que pede a data de recebimento do mês novo
    (uma parcela por mês, como na abertura).

## Como funciona — entrega 2

- `registrar_errata_do_job` aceita `p.meses_novos`
  (`[{ chave: "mes-novo:AAAA-MM", mes: "AAAA-MM-01" }]`): cria o mês e a
  âncora na versão aprovada; agrupamento novo e item da errata levam a
  chave no lugar da âncora; confere que o mês novo tem linha e alarga o
  período do job.
- `actions-errata.ts`: o schema aceita `meses_novos` e a chave do mês no
  `mes_id` do agrupamento novo; `montarErrata` confere mensal, trimestre,
  mês repetido e linha no mês; `montarOrganizacao` usa a chave como âncora.
  A errata pronta (decisão 159) guarda e devolve os meses novos.
- `job-realizado-section.tsx`: os meses novos ficam no estado da tela
  enquanto a errata está aberta (somem ao descartar); a cópia usa as
  ações do rascunho (`criarGrupo`, `adicionar`, `editarCampo`).
  `meses-que-faltam.tsx` desenha os blocos tracejados.
- **Defeito antigo corrigido (20261027960002):** a errata que cria
  agrupamento sem mexer na ordem das linhas mandava `estrutura.ordem =
  null`, e a função quebrava com "cannot extract elements from a scalar"
  — nada era gravado. Valia para qualquer errata da 162 nesse formato.

## Conferência — entrega 2 (27/10/2026)

No `P-0006/26 · Teste`, pelas telas: orçamento "ZZ Teste 219 mês pela
errata" criado só com outubro (× de dezembro e de novembro no formulário),
aprovado, enviado e aberto no financeiro como TES-1035/26. Na errata,
novembro "Com os itens de outubro" e dezembro "Vazio"; o pop-up listou
"Novembro · 1 item" e "Dezembro · sem item". Registrada: no banco, novembro
e a âncora na versão com a marca da errata, "Conteúdo" de novembro no job
com a linha copiada (R$ 5.000 orçado, R$ 4.000 planejado), período
01/10–30/11, abertura em revisão; dezembro não entrou. A revisão do
financeiro pede a data de novembro; o orçamento mostra novembro "Incluído
pela errata do job"; reabrindo a errata, só dezembro aparece. A revisão da
abertura ficou pendente, de propósito.

## ⚠️ Nota de 2026-10-29 — o mês da errata no Histórico do orçamento (decisão 226)

Com a [226](226-linha-vermelha-fora-da-errata-e-versao-aprovada-com-as-erratas.md),
a versão aprovada mostra a planilha do job, e o mês incluído pela errata
aparece com as linhas dele. No "Histórico", porém, a vista "Aprovada pelo
cliente" mostrava o mês vazio: os meses vinham da versão de hoje. A pedido
do Tiago (29/10/2026), nas vistas antigas o mês incluído pela errata só
aparece a partir do momento em que tem linha
(`planilha-mensal-do-historico.tsx`). Conferido no orçamento do
TES-1035/26: "Aprovada pelo cliente" só com outubro (R$ 6.959,12); o
momento da errata com outubro e novembro.

## ⚠️ Nota de 2026-10-30 — a barra, o "Recolher" e a linha do mês (revê o item 4)

Dois pontos que sobraram da entrega 1, levados a protótipo e escolhidos
pelo Tiago depois de nove comentários
(https://claude.ai/artifact/NdCGhD1iwLv9cRjPSbiYLt, proposta "C ·
Recolher no cabeçalho", linha do mês "Junto, com os 3 números"):
na tela de um mês só a barra continuava entre a linha do mês e a planilha,
e na vista Total apareciam dois "Recolher todos" seguidos (o dos meses e
o dos grupos do mês aberto).

1. **"Recolher grupos" no cabeçalho da tabela**, na célula vazia acima de
   "Grupo · Item", ao lado da faixa ORÇADO — nas duas telas do mensal. Na
   vista Total o botão dos meses vira **"Recolher meses"** e fica ao lado
   do título do trimestre.
2. **Tela de um mês só:** "Save", "Histórico" e "Exibir" sobem para a linha
   do título ("Outubro de 2026"), à direita, ao lado de "Copiar itens de
   outro mês". A planilha começa logo abaixo dela.
3. **Vista Total:** a barra do primeiro mês, quando ele está aberto, fica
   na linha do título do trimestre, à direita; os outros meses abertos
   mantêm a sua acima da linha deles. Fechado o primeiro mês, o título
   fica sozinho. As distâncias são as da tela de um mês: 24px da régua ao
   título e do título ao primeiro mês.
4. **A linha do mês aberto encosta na planilha** (um card só, sem o vão) e
   mostra **Faturamento, Resultado op. e Rentabilidade** (o "Geral" de
   antes) em colunas iguais. Saíram o Custo planejado e o "Abrir {mês}" —
   a régua já abre o mês. "Valor do job" foi mostrado e o Tiago tirou.
5. **Onde vale.** No orçamento mensal e, no mesmo dia, a pedido do Tiago,
   na planilha interna do job mensal — a da produção e a que o financeiro
   vê (Jobs, Abertura de job, planilha em leitura: o componente é o
   mesmo, `JobRealizadoSection`). No job a barra já era uma só, acima da
   régua, e ficou onde estava; saiu dela o "Recolher todos", que recolhia
   os grupos de todos os meses de uma vez: o "Recolher grupos" do
   cabeçalho de cada mês recolhe só os daquele mês (`alternarEstes` em
   `recolher-grupos.tsx`). A vista Total do job ganhou o título do
   trimestre com o "Recolher meses", e a linha do mês os mesmos três
   números (as contas de antes, pelo planejado). O job que não é mensal e
   a Mídia Off ficaram como eram. As mudanças entram por props (`titulo`,
   `linhaColada`, `recolherNoCabecalho`) e por contexto
   (`ComRecolherNoCabecalho`, `ComPlanilhaColada`, `TituloComABarra`, em
   `app/(app)/_planilha/lugar-da-barra.tsx`).

Conferido no `ZZ Teste 158 planilha de um mês` (rascunho, três meses) e na
versão aprovada do `ZZ Teste 219 mês pela errata` (com o "Histórico"); o
job no TES-1035/26, pela produção e pelo financeiro (o "Recolher grupos"
de outubro recolhe só outubro).
