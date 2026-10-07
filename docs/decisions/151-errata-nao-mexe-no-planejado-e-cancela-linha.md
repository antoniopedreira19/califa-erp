# 151 — A errata não mexe no planejado e cancela a linha em vez de apagá-la

**Data:** 2026-10-07
**Status:** entrega 1 aceita e no ar (07/10/2026). A entrega 2 (o valor do
job dividido entre inicial e atual) está desenhada e aprovada, e vem
depois.
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

## Entrega 2 — desenhada e aprovada, ainda por fazer

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

Precisa de banco: o orçado de cada linha na abertura e as deduções
(impostos) da abertura. `jobs.valor_job_abertura` e
`faturamento_previsto_abertura` já existem.

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
