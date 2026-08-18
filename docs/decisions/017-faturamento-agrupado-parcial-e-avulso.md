# 017 — Faturamento agrupado, parcial e avulso; e a previsão do título

**Data:** 2026-08-17
**Status:** aceita
**Contexto:** `/financeiro/contas-a-receber`. Design de referência:
`Contas a Receber - Faturamento Agrupado.dc.html` (projeto Claude Design
`69342d83`), mais o arquivo `Contas a Receber - Faturamento - notas de
implementacao.md`, do mesmo projeto, que registra o que foi pedido e o
que foi descartado.

## Decisão

### 1. Nota fiscal é cabeçalho + linhas

O modelo escolhido pelo Tiago é o mesmo que o projeto já usa em todo
lugar onde uma coisa cobre várias (`versoes_orcamento` +
`versoes_orcamento_itens`, `pedidos_compra` + `pedidos_compra_parcelas`):

| Camada | Tabela | Responde |
|---|---|---|
| Cabeçalho | `faturamentos` | o que é esta nota (número, emissão, cliente, total, PDF) |
| **Linhas** | **`faturamento_itens`** | **o que ela cobre, e por quanto de cada** |
| Recebimento | `titulos_receber` | como o dinheiro entra (parcelas) |

As três perguntas são independentes: uma NF de R$ 48.300 pode cobrir 2
jobs **e** ser recebida em 3 parcelas, e os dois números não têm relação.
Qualquer modelo que tentasse resolver isso com colunas no cabeçalho
teria que responder uma das duas errado.

Ganhos de graça: **faturamento parcial** vira um item com valor menor que
o saldo, sem mecanismo próprio; e o **saldo a faturar** passa a ser
"valor da parcela − itens que a consumiram", que é o número certo mesmo
com nota agrupada.

*(Descartados: NF "pai" com notas filhas por job, e duplicar a nota uma
por job. As duas quebram o número da NF, que é único e vem da
prefeitura.)*

### 2. `faturamentos.origem_id` fica vazio na nota agrupada

Consequência da decisão 1. O CHECK `chk_faturamento_origem` exigia
`origem_id NOT NULL` em job/BV; foi **substituído** por uma versão que
aceita nulo (continua proibindo avulso com origem preenchida). A tabela
tinha 0 linhas — nenhum dado foi tocado.

A alternativa era gravar "o primeiro job da nota". Recusada: qualquer
leitura futura que perguntasse "quanto o JOB-A faturou?" responderia com
a nota inteira e diria R$ 0,00 para o JOB-B — erro silencioso, e
exatamente nas telas que vêm depois (Fluxo de Caixa, DRE).

**Quem quiser saber o que uma nota cobre lê `faturamento_itens`, não
`origem_id`.**

### 3. O parcelamento do faturamento é informado pela PRODUÇÃO, no envio

Decisão do Tiago. A aba Faturamento tem **uma linha por parcela** —
`jobs_envio_faturamento_parcelas`, tabela nova, preenchida no drawer
"Enviar job para faturamento". Cada parcela é faturada por sua própria
NF, com o seu vencimento.

**Não vem da previsão de recebimento da abertura**
([015](015-previsao-de-recebimento-na-abertura.md)), que responde outra
pergunta: *quando o dinheiro entra*, não *em quantas notas o job sai*.
São duas coisas com nomes parecidos, e confundi-las é o erro fácil aqui.

A soma das parcelas fecha contra `jobs.faturamento_previsto`, relido no
servidor — o navegador diz como repartir, o banco diz quanto.

*(Descartadas: uma linha por job com Parcela sempre `1/1`, que diverge do
protótipo; e derivar as parcelas de `jobs_previsao_recebimento`, que
fecha contra outro número — `faturamento_previsto`, e não
`valor_faturado` — e faria as parcelas não somarem o saldo.)*

### 4. Tipo e Subtipo saem da emissão e passam para a BAIXA

Decisão do Tiago. O protótipo tira "Tipo" e "Subtipo" de todos os
formulários de faturamento e pede um "Centro de custo" obrigatório na
baixa do recebimento — que, pela leitura já firmada na
[016 §6](016-titulos-a-pagar-e-baixa-por-parcela.md), **é** o par Tipo +
Subtipo do plano de contas.

Ou seja: **quem classifica a receita no DRE é a baixa**, que é quando o
dinheiro existe de fato. Consequência estrutural: `faturamentos.
plano_conta_tipo_id` e `_subtipo_id` deixaram de ser obrigatórias.
Continuam existindo e continuam sendo gravadas **no faturamento avulso**,
onde o protótipo pergunta "Centro de custo" na emissão.

**Série da NF** também sai das telas, e **nada é removido do banco**:
`faturamentos.serie` continua populada, agora com default `'1'`.

### 5. Três datas no título a receber, e duas são imutáveis

Espelho da 016 §3 e §4, do lado da entrada:

| Data | Muda? |
|---|---|
| `data_vencimento` | **Não.** É o que a nota diz. |
| `data_previsao_recebimento` | Sim, pelo lápis. É o que o fluxo de caixa lê. |
| `data_previsao_recebimento_primeira` | **Não.** Registro da 1ª previsão. |

As duas imutáveis são congeladas pelo trigger
`congela_previsao_recebimento_primeira` — a promessa do pop-up não
depende da tela. Exercitado no banco com rollback antes de liberar: um
`update` forçando ambas para 1999 gravou a previsão nova e **manteve as
duas intactas**.

Previsão diferente do vencimento aparece em **âmbar** na tabela.

`vw_fluxo_caixa` passou a ler a **previsão** no lugar do vencimento —
sem isso, repactuar não moveria nada no caixa.

### 6. Invariante: título recebido sempre tem data de recebimento

Não existe baixa sem data. Garantido em três camadas: no diálogo, no
schema Zod da action, e dentro de `dar_baixa_titulo_com_plano`, que
recusa `null`.

### 7. BV nunca entra em NF agrupada

A contraparte do BV é o **fornecedor**, não o cliente. O checkbox da
linha fica desabilitado; se um BV chegar à seleção por outro caminho, o
erro é próprio ("BV não entra em NF agrupada"), e a action recusa de novo
no servidor.

Pela mesma razão, **NF agrupada só cobre jobs de um mesmo cliente**: com
mais de um, o formulário **não abre** e o erro aparece na barra de
seleção, nomeando os clientes encontrados.

### 8. Não existe NF programada

O modelo "1 NF por parcela", com as demais programadas para emissão
futura, foi implementado no protótipo e **descartado** pelo Tiago (notas
de implementação §4). Quem não quer faturar tudo agora usa o
**faturamento parcial**; o resto volta como saldo remanescente na aba
Faturamento.

### 9. Estorno e cancelamento de NF saíram da UI

Mesma decisão da [016 §9](016-titulos-a-pagar-e-baixa-por-parcela.md), e
pela mesma razão: o protótipo não os tem em lugar nenhum — título
recebido exibe apenas "Conciliação".

`estornarBaixaTitulo`, `cancelarFaturamento` e
`cancelar-faturamento-modal.tsx` continuam no repositório, funcionando,
**sem porta na tela**. Consequência assumida: desfazer uma NF errada hoje
exige intervenção fora da tela.

## Onde a regra mora

- **Banco (o portão de fato):**
  `supabase/migrations/20260817000005_contas_a_receber_agrupado.sql` —
  as duas tabelas novas, o trigger de congelamento,
  `emitir_faturamento` (que trava o saldo por parcela),
  `dar_baixa_titulo_com_plano`, `cancelar_faturamento` e as duas views.
- **Servidor:** `app/(app)/financeiro/contas-a-receber/actions.ts` e
  `app/(app)/jobs/[jobId]/actions-faturamento.ts`.
- **Telas:** `faturamento-list.tsx`, `faturar-drawer.tsx`,
  `titulos-list.tsx`, `baixa-recebimento-dialog.tsx`,
  `editar-previsao-dialog.tsx`, `enviar-faturamento-drawer.tsx`.

## O que ficou de fora, de propósito

- **Contato de cobrança (`jobs_contatos`) não entra nesta tela.**
  Decisão do Tiago nesta sessão. A pendência P1 do plano de alterações
  segue aberta, com os dois destinos já recomendados
  (`conferencia-dialog.tsx` e `financeiro/jobs/[jobId]`).

  > ⚠️ **17/08/2026, mais tarde no mesmo dia — REVERTIDO pelo Tiago.** Ao
  > fechar a pendência P1 ele pediu o contato de cobrança **também nas
  > duas abas desta tela**: uma linha por contato sob a contraparte, na
  > aba Faturamento, e sob os jobs cobertos, na aba Títulos a Receber.
  > Numa NF agrupada os contatos dos vários jobs aparecem juntos, sem
  > repetir o mesmo e-mail. Ver [012](012-contato-de-cobranca-do-job.md).
- **Filtros de status na aba Títulos a Receber.** O protótipo não os tem;
  a lista mostra tudo, ordenada por vencimento.
- **`dar_baixa_titulo` (sem plano) e `estornar_baixa_titulo`** continuam
  no banco. A UI parou de usar a primeira.
- **O abatimento da previsão de recebimento da abertura pelo título
  emitido** continua sem regra escrita — é a pendência que a
  [015](015-previsao-de-recebimento-na-abertura.md) registrou e que a
  Tela 3.4 (Fluxo de Caixa) vai precisar resolver.
