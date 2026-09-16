# 078 — Fee e Always On: um orçamento por trimestre, dividido em meses

**Data:** 2026-09-14
**Status:** aceita — entregas 1 (orçamento) e 2 (aprovação, abertura e planilha do job) de 3
**Contexto:** `categorias_dominio`, `versoes_orcamento_meses` (nova),
`versoes_orcamento_grupos.mes_id`, a tela da versão do orçamento e o
formulário do orçamento. Pedido do Tiago em 12/09/2026, com a planilha
`INTERNA - DRE + Planilhas Ânima 2026.xlsx` (aba SUL) e o design
`Planilha Fee e Always On` (canvas aprovado em 14/09/2026).

## O problema

Fee e Always On são contratos recorrentes, faturados mês a mês. A California
controla cada regional numa planilha em que cada mês é um bloco inteiro —
equipe e verbas que mudam de um mês para o outro, com orçado, planejado e
realizado próprios. No ERP não havia onde pôr isso: a versão do orçamento é
uma lista só de grupos e itens.

## As decisões (Tiago, 12–14/09/2026)

1. **Um orçamento por trimestre civil**, com 1 a 3 meses. É como o controle
   de jobs de 2026 já trabalha ("ÂNIMA EDUCAÇÃO | JAN, FEV E MAR" é um job,
   com uma linha de faturamento por mês). Foram descartados: um orçamento
   com todos os meses e vários envios à abertura (quebraria "um job ativo
   por orçamento", que o banco garante), e um job anual com rateio na
   abertura (o envio para faturamento é único e travaria errata e save do
   ano inteiro).
2. **O serviço decide a categoria.** Serviço Fee só aceita a categoria Fee;
   Always On, a Always On. E essas categorias só valem para os seus
   serviços. A relação é o campo `categorias_dominio.servico_exclusivo_id`,
   nunca o nome.
3. **Quem escolhe a planilha é a categoria**, pelo enum `modelo_planilha`
   (valor novo `mensal`) — o mesmo mecanismo da [072](072-orcamento-internacional.md).
4. **O período é obrigatório e cabe num trimestre.** Início e fim no mesmo
   trimestre civil, de qualquer ano (trimestre futuro vale). Os meses
   nascem dos meses que o período cobre.
5. **Os meses se editam** ("Editar meses"): adicionar só meses do mesmo
   trimestre; apagar é permitido, mas o orçamento nunca fica sem mês. **O
   período acompanha os meses**, mantendo o dia digitado quando o mês da
   ponta continua.
6. **Mudar o período para outro trimestre** só com as versões sem itens — e
   aí os meses são refeitos. No mesmo trimestre, os meses ficam como estão.
7. **"Copiar itens de outro mês" só para mês vazio.** Copia grupos e itens
   (orçado e planejado); BV e save ficam no mês de origem.
8. **Trocar a categoria de/para Fee ou Always On pede confirmação.** Entrando
   no mensal, os grupos existentes vão para o primeiro mês; saindo, **só o
   primeiro mês permanece** — o resto é apagado, em todas as versões.
9. **Os 5 orçamentos que já tinham serviço Fee/Always On com categoria
   nacional ficam como estão.** A trava só confere o par quando serviço ou
   categoria mudam.
10. **Na visão agregada do projeto o orçamento mensal é só consulta**: soma
    no total do contrato, mas o editor de lá não conhece meses. Também não
    se cria Fee/Always On por lá.
11. Visual: régua de meses (Trimestre + um bloco por mês); o mês abre a
    planilha e os Totais dele; o Trimestre abre os meses empilhados e os
    Totais do trimestre. "Ano consolidado" em tabela foi rejeitado; o
    limite de faturamento e a "conta para sobra" da planilha saíram.

## O modelo de dados

```
versoes_orcamento ─┬─ versoes_orcamento_meses (1..3, mesmo trimestre)
                   └─ versoes_orcamento_grupos ── mes_id ──┘
                            └─ versoes_orcamento_itens (herdam o mês pelo grupo)
```

- **O mês entra no grupo, não no item.** Pôr nos dois criaria duas fontes
  para a mesma informação.
- **O mês é linha própria** porque existe vazio (o trimestre nasce com os
  meses antes de qualquer grupo).
- FK composta `(versao_orcamento_id, mes_id)` garante que o mês do grupo é
  da mesma versão, sem trigger.
- Trigger `versoes_orcamento_meses_mesmo_trimestre` mantém os meses no
  mesmo trimestre.
- ⚠️ **Nome de grupo**: `uniq_grupo_nome_por_versao` virou parcial (grupo
  sem mês) e ganhou `uniq_grupo_nome_por_mes` (grupo com mês). Troca de
  índice autorizada pelo Tiago em 14/09/2026; nenhum dado apagado, e o
  índice antigo manteve o nome que o tratamento de erro procura.
- Trigger `orcamento_servico_e_categoria_coerentes` trava o par serviço ×
  categoria no banco, só quando um dos dois muda.

## As contas

O fechamento de cada mês é o nacional, com os percentuais da versão. O
trimestre soma os meses — com percentuais iguais, é a mesma conta sobre
todos os itens, e o resumo do topo da versão (Valor do Job, Resultado Op.,
Rentab.) continua saindo de `calcularTotaisVersao` sobre a versão inteira.
Nenhuma função de cálculo mudou.

## Transações

Adicionar, apagar e copiar mês, e a troca de modelo, mexem em mais de uma
tabela: vão por RPC (`adicionar_mes_na_versao`, `remover_mes_da_versao`,
`copiar_mes_da_versao`, `trocar_modelo_mensal_do_orcamento`), todas
SECURITY INVOKER. O período novo é calculado em TypeScript
(`periodoQueAcompanhaOsMeses`, com testes) e gravado junto.

## Entrega 2 — aprovação, abertura e planilha do job (14/09/2026)

Decisões do Tiago em 14/09/2026:

1. **Mês sem item bloqueia a aprovação.** A mesma função
   (`bloqueioAprovacaoVersao`) desabilita o botão com o motivo e recusa em
   `aprovarVersao`, que relê meses, grupos e itens do banco.
2. **As datas de início e fim do envio à abertura ficam travadas no período
   do orçamento.** O modal as mostra desabilitadas e `enviarJobParaAbertura`
   recusa datas diferentes: o envio grava as datas de volta no orçamento, e
   uma data nova desalinharia os meses.
3. **Data do evento e data prevista para recebimento seguem como hoje** —
   uma de cada, obrigatórias. O recebimento mês a mês é da entrega 3.
4. **A entrega 2 só vai para o main junto com a entrega 3.** Sozinha, ela
   deixaria abrir job de Fee/Always On sem conseguir faturar nenhum mês.

O que mudou:

- A barra de aprovação e abertura aparece na tela do orçamento mensal (até
  aqui ela não aparecia, e versão mensal não tinha como ser aprovada).
- **O job não ganhou coluna nem tabela.** O item do job aponta para o grupo
  da versão aprovada (`jobs_itens_orcado.grupo_id`), e o grupo tem o mês;
  as telas do job leem os meses da versão aprovada.
- Planilha interna do job (tela do GP e do financeiro): régua "Meses do
  job" — Trimestre e um bloco por mês, com o faturamento previsto e a
  situação do envio —, planilha e Totais do mês, trimestre empilhado com os
  Totais do trimestre. O mês mora na URL: `?aba=planilha&mes=2026-10`.
- Conferência da abertura e visão agregada de jobs: a planilha inteira, com
  o mês no nome do grupo e os grupos na ordem dos meses.
- **O envio único para faturamento é recusado para job mensal** (tela e
  `enviarJobParaFaturamento`): congelaria o trimestre inteiro. A barra do
  job diz que o faturamento é mês a mês.
- Competência: nenhum código novo. O pré-preenchimento sai de
  `data_inicio_prevista`, que no mensal é o período travado — cai 100% no
  trimestre.
- **Errata e save travando por mês ficam para a entrega 3**: quem trava um
  mês é o envio dele para faturamento, que ainda não existe. Até lá errata
  e save do job mensal seguem as regras de sempre.

## Entrega 3 — faturamento por mês (14/09/2026)

**Respostas do Tiago:**

- **Sem devolução.** Hoje o financeiro não devolve envio para faturamento, e
  o mensal segue igual: o envio de um mês é definitivo. O desenho perdeu o
  estado "Devolvido" e o "Revisar e reenviar". (O envio à abertura continua
  um só por orçamento, isto é, por trimestre.)
- **Previsão de recebimento: uma linha por mês.** Na abertura, o financeiro
  informa só o **dia do recebimento**. Cada mês recebe nesse dia do **mês
  seguinte** (outubro → 20/11), e a data de cada mês continua editável na
  abertura e na revisão, como hoje.
- **Mudanças no banco confirmadas** (abaixo).

**Como ficou:**

- **Um envio por mês.** `jobs_envio_faturamento` ganha `mes` (primeiro dia
  do mês; nulo nos outros jobs) e `valor_save`. O `unique (job_id)` virou
  dois índices parciais: um envio sem mês por job, e um por mês. A RPC
  `enviar_job_para_faturamento` grava os dois campos.
- **O valor do envio é o faturamento do mês** pela conta da planilha
  (`calcularTotaisVersao` sobre os itens do mês, com as erratas), relido no
  servidor. O vencimento nasce vazio. Várias parcelas por mês, somando o
  valor do mês. `enviarJobParaFaturamento` exige o mês no job mensal e o
  recusa nos outros.
- **Barra no rodapé do job**, recolhida e expandida. Recolhida: a situação
  de cada mês e o botão do mês mais antigo ainda a enviar. Expandida: uma
  linha por mês com valor, situação, detalhe, "Enviar faturamento" ou
  "Ver envio". As situações são *A enviar → Na fila do financeiro →
  Faturado parcial → Faturado*, calculadas pelas notas emitidas sobre as
  parcelas do envio. O botão de encerrar aparece quando todos os meses
  foram enviados.
- **Mês sem faturamento** (sem item, por exemplo depois de uma errata):
  situação própria, "Sem faturamento". Não tem o que enviar e não segura o
  encerramento nem a liquidação (confirmado pelo Tiago em 14/09/2026).
- **Errata e save travam só o mês enviado**, na tela (tabela do mês sem
  errata e sem save, com aviso na régua) e no servidor
  (`registrarErrata`, `salvarSaveDaErrata`). O botão da errata só some
  quando todos os meses foram enviados.
- **Encerramento:** o job mensal só encerra com todos os meses com
  faturamento enviados (`mesesSemEnvio`) e o saldo a faturar zerado.

  > ⚠️ **Revisto em 16/09/2026 ([decisão 087](087-faturamento-e-encerramento-correm-separados.md)).**
  > O job mensal encerra com mês ainda por enviar e sem nota (resposta b do
  > Tiago): o envio dos meses continua aceito depois do encerramento, e o job
  > fica finalizado quando o último mês é faturado. A barra por mês virou a
  > trilha "Faturamento", com a trilha "Encerramento" abaixo.
- **Abertura do financeiro:** a previsão de recebimento do mensal é uma
  linha por mês com faturamento, no valor do mês (travado). A action relê o
  faturamento de cada mês, confere uma linha por mês e grava `mes` e
  `valor_save` em `jobs_previsao_recebimento`.
- **Fluxo de caixa:** `vw_fluxo_caixa` esconde a previsão de um mês só
  quando aquele mês foi enviado; a receita própria sai de
  `valor - valor_save` da linha. `vw_faturamento_pendente` tira o save do
  envio mensal pelo `valor_save` e expõe `mes_referencia`.
  `vw_saves_por_job` só conta o save de mês já enviado.
- **Esteira e telas do financeiro:**
  - o job mensal com mês ainda não enviado ou não faturado inteiro não
    liquida (`faltaFaturar`), mesmo com as notas pagas: fica em "Faturado"
    (confirmado pelo Tiago em 14/09/2026);
  - a fila do contas a receber mostra o mês de cada linha, e a PO e a
    instrução da nota do botão `i` e da gaveta de faturar são as do mês;
  - a página do job no financeiro lê as notas pelos itens (antes um
    `.maybeSingle()` dava erro com mais de uma nota);
  - a home do GP conta "prontos pra faturar" e "prontos pra encerrar" por
    mês.

## Excel do mensal — exportar e importar (15/09/2026)

**Respostas do Tiago:**

- **Layout da exportação:** uma aba; cada mês é um bloco com os grupos e o
  **fechamento do mês**, até "FATURAMENTO DE OUTUBRO" — o valor que o envio
  daquele mês leva ao financeiro, como na aba SUL da planilha interna. No
  fim, o **RESUMO DO TRIMESTRE** com o faturamento de cada mês e o do
  trimestre.
- **Exportação pelo projeto:** o mensal sai **só com outros mensais** — a
  regra "modelos não se misturam" da 072. Orçamentos de **trimestres
  diferentes** saem e voltam juntos, cada um com os seus meses.
- **Os meses não mudam pela planilha:** bloco de mês que a versão não tem,
  ou mês da versão sem bloco, recusa o orçamento. Criar ou apagar mês
  continua só pelo "Editar meses". Dentro do mês, a regra de sempre.
- **Planilha interna** (blocos "OUTUBRO - …", como a aba SUL) também entra
  pelo "Importar planilha" da versão, casada pelo **nome do mês**; bloco de
  mês fora do trimestre fica de fora, com aviso.

**Como ficou:**

- **Marcas na coluna oculta H:** `mes:2026-10-01` no título do mês — pela
  data, que casa entre versões (o id do mês muda a cada versão) — e
  `resumo:` no título do resumo, onde a leitura termina. `orc:`, `v:`,
  `grp:` e `it:` como na 041.
- **Gerador:** `lib/exportacao/planilha-orcamento-mensal.ts`, montado com as
  peças do nacional, que saíram de `adicionarAbaOrcamento` para funções
  exportadas (`prepararAbaOrcamento`, `escreverTituloDeSecao`,
  `escreverGrupos`, `escreverFechamento`). A exportação nacional foi
  comparada célula a célula antes e depois: idêntica.
- **Rotas:** a da versão e a do projeto geram o mensal; a do projeto recusa
  mensal junto de outro modelo.
- **Importação do projeto** (`parser-projeto.ts`, `diff-projeto.ts`,
  `_selecao/importar-actions.ts`): o parser dá o mês de cada grupo e pula o
  fechamento de cada mês; `planejarSecao` casa grupo pelo nome só dentro do
  mesmo mês e conta grupo que mudou de mês como alteração;
  `conferirMesesDaSecao` recusa meses diferentes dos da vigente; a versão
  nova copia os meses da vigente antes dos grupos.
- **"Importar planilha" da versão** (`parser-oficial.ts`,
  `meses-da-planilha.ts`, `versoes/importar-actions.ts`):
  `parseOficial(buf, { mensal: true })` reconhece o título do mês (marca ou
  nome), acha R$, QT, DIAS e o planejado pelo cabeçalho (a aba SUL põe NOME,
  CONTRATO e UNI antes do R$ e o planejado em K–M), pula o cabeçalho
  repetido e o fechamento de cada mês e, com várias abas de blocos, lê a
  primeira e avisa quais existem. `casarBlocosComMeses` casa os blocos com
  os meses da versão sobrescrita, da vigente (que a versão nova copia) ou,
  sem versão, do período. O preview mostra o grupo com o mês
  ("EQUIPE · Outubro").
- **Telas:** o mensal voltou aos seletores "Exportar" do projeto e da
  agregada ("· Fee ou Always On"; o aviso de mistura oferece "Manter só os de
  Fee e Always On"), o "Exportar" da versão destravou, e o "Importar
  planilha" do mensal fica na régua de meses, ao lado do "Editar meses" —
  a planilha troca todos os meses de uma vez, então não é ação de um mês.

**QT 0 vale** (Tiago, 15/09/2026). Na planilha interna, QT 0 marca o item
listado no mês sem cobrança (o Gerente de Projeto de janeiro na aba SUL). A
importação trocava o 0 por 1 — regra antiga, por causa da check
`itens_quantidade_positiva` — e o orçado do mês saía acima do da planilha
(R$ 57.727,43 contra R$ 42.727,43). Agora a quantidade orçada aceita zero no
banco (`itens_quantidade_nao_negativa`, migration `20260915100001`), no
schema do item e nos dois parsers; só QT negativo vira 1. **O padrão de item
novo continua 1.** D/M segue > 0 e a quantidade da PP não mudou.

**Decisões de tela minhas:** cada mês lista SUB-TOTAL de todos os tipos,
como o nacional (a fórmula do TOTAL depende da faixa contígua); o título da
seção do projeto mostra a soma dos faturamentos dos meses; no resumo do
projeto cada linha nomeia o orçamento ("0-0001/26-09 · Outubro de 2026").

## O que ainda não existe

- Edição do mensal pela visão agregada (hoje só consulta) e filtro de
  trimestres nela.

## Migrations

- `20260914200001_modelo_planilha_mensal.sql` — valor `mensal` no enum.
- `20260914200002_categorias_fee_always_on.sql` — `servico_exclusivo_id`,
  categorias Fee e Always On (nascem inativas), trava da categoria cobre o
  vínculo.
- `20260914200003_meses_da_versao_do_orcamento.sql` — tabela dos meses,
  `mes_id` no grupo, troca do índice de nome.
- `20260914200004_rpcs_dos_meses_do_orcamento.sql` — as quatro RPCs.
- `20260914200005_ativa_fee_always_on_e_trava_servico.sql` — ativa as
  categorias e cria a trava do par serviço × categoria.
- `20260914200006_comentarios_decisao_077.sql` — as quatro de cima foram
  aplicadas citando "Decisão 076"; no mesmo dia outra frente publicou a 076
  no main, e esta regravou os comentários com 077.
- `20260914200007_comentarios_decisao_078.sql` — a 077 também estava em uso
  no mesmo dia (pagamento urgente da PP, já aplicada no banco). O Tiago
  decidiu que ela fica com a 077 e esta passa a ser a 078; os comentários
  do banco foram regravados de novo.
- `20260914200008_envio_faturamento_por_mes.sql` — `mes` e `valor_save` no
  envio para faturamento e na previsão de recebimento, os índices parciais
  no lugar do `unique (job_id)` (autorizado pelo Tiago), a RPC do envio e
  as três views (`vw_faturamento_pendente`, `vw_fluxo_caixa`,
  `vw_saves_por_job`). Entrega 3.
- `20260915100001_quantidade_orcada_aceita_zero.sql` — troca
  `itens_quantidade_positiva` (> 0) por `itens_quantidade_nao_negativa`
  (>= 0) em `versoes_orcamento_itens`. Alarga a regra: nada é regravado.
