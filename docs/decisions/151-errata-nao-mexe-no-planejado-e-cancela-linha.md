# 151 — A errata não mexe no planejado e cancela a linha em vez de apagá-la

**Data:** 2026-10-07
**Status:** entregas 1 e 2 aceitas e no ar (07/10/2026). Fica uma
pergunta aberta sobre a linha que vira save depois da abertura (fim do
arquivo).
**Quem decidiu:** Tiago, em 06 e 07/10/2026, a partir do protótipo
interativo (https://claude.ai/artifact/UvUXt8rKSNsXTEofUxtt7p, v3). Todas as
respostas seguiram a recomendação que acompanhava a pergunta.
**Número:** nasceu como 150 e foi renumerada para 151 antes de publicar:
a frente da Mídia Off já tinha o 150 (Cadastro de Veículos) no worktree
dela, criado antes. Regra de colisão do Tiago: a mais nova move.
**Revê:** [054](054-errata-abre-o-planejado-junto-com-o-orcado.md) (a errata
abria o planejado junto com o orçado) e a remoção de linha da
[030](030-errata-na-planilha-e-a-linha-vermelha.md).

## A ideia em uma frase

O **planejado do job é o da abertura**: a errata corrige o orçado, mas não
mexe no planejado de linha nenhuma, e a linha que sai da conta fica na
planilha, **cancelada**, com o planejado dela ainda contando.

## Entrega 1 — o que mudou na Planilha Interna (no ar)

| Situação na errata | Antes (054) | Agora |
|---|---|---|
| Linha nova ("Novo item") | o planejado abria junto com o orçado | entra com o planejado **zerado** e travado — "Item novo da errata entra com o planejado zerado: o planejado do job é o da abertura." |
| Linha existente com o orçado corrigido | o planejado abria | o planejado **não abre** — "O planejado é o da abertura do job: a errata corrige só o orçado." |
| Linha vermelha | orçado e planejado zerados | igual |
| Serviço Interno | planejado igual ao orçado (105) | igual (resposta do Tiago em 07/10/2026) |
| Tirar uma linha que já existia | "Remover" apagava a linha | "**Cancelar**": a linha fica com o selo "cancelada", o orçado vai a zero e o planejado fica. "Reativar" desfaz dentro da mesma errata |
| Tirar uma linha criada nesta errata | "Remover" | "Remover" (ela ainda não existe no job) |

Por que a linha não é mais apagada (resposta do Tiago em 07/10/2026): apagar
levava junto o custo planejado dela, e o resultado planejado subia sem nada
ter mudado no plano. No TES-1008/26, remover o Item 1 do Agrupamento 3
(orçado R$ 5.000, planejado R$ 4.000) levaria o resultado planejado de
R$ 28.400,00 para R$ 32.400,00.

### A linha cancelada

- Fica na planilha com o selo cinza **cancelada** ao lado do nome, o orçado
  em R$ 0,00 e o planejado da abertura. Na calha aparece "Cancelada" no
  lugar de PP e BV.
- **Não recebe PP nem BV, não gera nem consome save** e não entra em
  errata de novo. A tela não oferece, e as actions recusam
  (`checarGatesRealizado`, `carregarContexto` do BV,
  `registrarErrataDeSave`, `registrarErrata` e o "Editar orçado" do
  financeiro).
- As PPs dela ficam **dadas por concluídas** na hora do cancelamento
  (`jobs_itens_realizado.pps_concluidas_em`). Sem isso ela travaria o
  encerramento e o "Concluir PPs" para sempre (decisão 052).
- As travas para cancelar são as mesmas que a remoção tinha: PP no
  histórico, BV lançado e save.
- A exportação interna escreve "(cancelada)" depois do nome.

### O histórico

- `jobs_erratas_itens.acao` ganhou `cancelada`. As cinco remoções que já
  estavam no histórico continuam "Removida".
- O pop-up de confirmação, o card de Erratas, o fio da Comunicação e a
  revisão da abertura do financeiro contam e mostram "cancelada"
  ("2 alteradas · 1 nova · 1 cancelada"). A remoção antiga só aparece na
  contagem quando houver.
- O subtítulo do card de Erratas perdeu o "planejado": "Alterações de itens
  orçados e tipos de custo após a abertura do job".

### Banco

- Migrations `20261007100001_errata_acao_cancelada` (só o valor novo do
  enum), `20261007100002_errata_cancela_linha` e
  `20261007100003_errata_cancela_linha_renumera_151`. As duas primeiras
  foram aplicadas antes da renumeração e citam "Decisão 150" — inclusive os
  comentários dentro de `registrar_errata_do_job`; a terceira corrige os
  comentários das colunas.
- `jobs_itens_orcado` ganhou `cancelada_em`, `cancelada_por` e
  `cancelada_errata_id` (FK para `jobs_erratas`, `on delete set null`), e a
  checagem `chk_jio_cancelada_zerada`: linha cancelada tem orçado zero.
- `registrar_errata_do_job` aceita `canceladas` (zera o unitário, grava a
  marca e conclui as PPs da linha) e recusa a correção de linha já
  cancelada. `removidas` continua apagando, só para uma aba aberta antes do
  deploy; a action também trata o `remocoes` antigo como cancelamento.

### O servidor decide o planejado

`planejadoDaErrata` (`actions-errata.ts`) ignora o planejado que vem no
payload: linha vermelha ou em save, zero; Interno, igual ao orçado novo;
linha nova, zero com QT e D/M em 1; linha existente, o que ela já tinha.
Um payload montado à mão não grava o que a tela não deixa.

## Entrega 2 — o valor do job dividido (no ar)

Decidido em 07/10/2026 no mesmo protótipo:

1. Quando o valor do job atual difere do da abertura (comparado no
   centavo), o cabeçalho (`ResumoResultado`) se divide: "Valor do job ·
   inicial" na linha do planejado, que é a base do resultado planejado, e
   "Valor do job · atual" na do realizado. **Errata que não muda o valor do
   job** — linha vermelha, só troca de tipo de custo, correções que se
   anulam — **mantém o valor único** (regra do Tiago, 07/10/2026). Mudar
   só o faturamento previsto também não divide.
2. O card de Totais acompanha: na ótica Planejada usa valor, impostos,
   honorários e orçado da abertura.
3. A RENTAB. planejada (grupo, item e rodapé) usa o orçado da abertura de
   cada linha, zero na linha criada por errata; a realizada segue no
   orçado atual. Os agrupamentos passam a somar o mesmo número do card de
   Totais.

### Como ficou

- **Sem migration.** A foto da abertura sai da **versão aprovada**, que a
  errata não altera: `fechamentoDaAbertura` (`lib/calculos/abertura-do-job.ts`)
  roda a mesma `calcularTotaisVersao` que gravou `jobs.valor_job_abertura`
  no envio para abertura. Conferido em 07/10/2026: nos 50 jobs abertos a
  conta reproduz o `valor_job_abertura` gravado ao centavo. Se um dia não
  reproduzir (job devolvido com save mexido direto na cópia antes do
  reenvio), a foto é descartada e a tela fica como era.
- A foto só existe depois da abertura do financeiro
  (`data_abertura_financeiro`). Antes dela não há "inicial" e "atual".
- **Cabeçalho** (`ResumoResultado`, prop `abertura` obrigatória): divide
  quando o valor do job atual difere do da abertura no centavo. As visões
  de projeto mandam `null` — elas somam jobs e não se dividem.
- **Card de Totais** (`PainelResultado`, prop `abertura`): na ótica
  Planejada usa valor, impostos, int. taxes, custos de transação,
  honorários e orçado da abertura, com o rótulo "Valor do Job inicial"; na
  Realizada, "Valor do Job atual". Só no card do job inteiro e no do
  trimestre; o card de um mês do modelo mensal fica como era.
- **RENTAB. planejada** (grupo, item e rodapé): base nova
  `orcadoRentabilidadePlanejada` em `blocosDoItem`, que lê
  `ItemPlanilhaJob.orcado_abertura` (campo obrigatório: o orçado da linha
  na versão, 0 na linha criada por errata, `null` = orçado de hoje nas
  telas sem a foto). A realizada segue em `orcadoRentabilidade`.
- A exportação interna (`montar-interna`) tem conta própria de
  rentabilidade e ficou como era.

### Testado (07/10/2026)

- TES-1002/26: inicial R$ 354.914,88 → planejado R$ 92.600,00 (26,1%);
  atual R$ 364.657,64. A conta à mão bate: versão com R$ 255.000 de
  orçado, honorários 12% (R$ 30.600), imposto R$ 69.314,88; 255.000 −
  193.000 + 30.600 = 92.600. No Totais do trimestre, ótica Planejada,
  "Valor do Job inicial" e o mesmo R$ 92.600,00. Em dezembro, depois da
  errata da entrega 1, o Agrupamento 1 seguiu com RENTAB. planejada
  R$ 8.000,00 · 20,0% (antes da entrega 2 cairia para R$ 5.000,00).
- TES-1008/26: inicial R$ 171.229,03 → planejado R$ 41.600,00; atual
  R$ 181.667,70 → realizado R$ 73.000,00. O mesmo na tela do job no
  financeiro.
- TES-1014/26 (sem errata): valor único no cabeçalho e no Totais.

### Pergunta aberta: a linha que vira save depois da abertura

O rodapé da planilha soma a RENTAB. planejada linha a linha; o card de
Totais fecha sobre a versão inteira. Os dois batem, menos quando uma linha
da abertura saiu da conta por outro caminho que não o cancelamento:

- **Remoção antiga** (antes desta decisão): a linha sumiu da planilha.
  Não acontece mais — agora é cancelamento. Só existe em jobs de teste
  (TES-1001, TES-1006, TES-1008).
- **Linha que vira save depois da abertura** (decisão 099): o planejado
  dela vai a zero pelo trigger e o orçado sai da base. Hoje só em jobs de
  teste (TES-1001, TES-1002, TES-1008), mas pode acontecer em job real.

No TES-1008/26 o card mostra R$ 26.000,00 de rentabilidade planejada e o
rodapé R$ 13.500,00 — a diferença é a linha removida (R$ 10.000) e o Item
8 em save (R$ 2.500). Aguarda o Tiago.

## Testado (07/10/2026)

No TES-1002/26 · Teste Always On (projeto de teste TES-P001/26), mês de
dezembro, pela tela, logado:

- Item 1: orçado de R$ 10.000 para R$ 12.000, o planejado de R$ 8.000 não
  abriu e ficou gravado igual.
- "Item novo · teste 150": orçado R$ 5.000, planejado travado e gravado
  zero (unitário 0, QT 1, D/M 1).
- Item 4 cancelado: unitário 0, planejado R$ 8.000 mantido, marca com autor
  e errata, PPs concluídas; o pendente de "Concluir PPs" do encerramento
  seguiu em 21 (a linha nova entrou, a cancelada saiu).
- Errata seguinte no mesmo job: a cancelada fica com "Cancelada" na calha,
  sem botão, e o orçado não abre.
- Bypass pelo console, nada gravado: corrigir a cancelada, cancelar de
  novo, reservar PP e lançar BV nela — as quatro recusadas com o nome da
  linha.
- A revisão da abertura do financeiro mostra "2 alteradas · 1 nova · 1
  cancelada". O registro dela ficou pendente: o job de teste não tem a data
  dos recolhimentos de impostos (decisão 100), e a data não foi inventada.
