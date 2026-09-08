# 059 — A revisão da abertura nasce editável, e cada registro deixa uma foto

**Data:** 2026-09-08
**Status:** aceita
**Migration:** `20260908150001_jobs_aberturas_fotos.sql`
**Contexto:** a aba "Abertura do Job" em `/financeiro/jobs/[jobId]` e o
mural de abertura (`/financeiro/abertura-de-job`). Pedido do Tiago em
08/09/2026. Completa a [021](021-projeto-do-financeiro-e-edicao-da-abertura.md)
(edição do registro) e a [040](040-errata-nao-toca-linha-com-pp-e-trava-o-envio-de-pp.md)
(errata devolve o job ao mural).

## O que estava errado

Uma errata devolvia o job ao mural com o botão "Prosseguir para
abertura", e o botão levava a uma tela **de leitura**: para reconferir
previsão, curva e competência a pessoa tinha de achar "Editar registro".
A ideia inteira da revisão é revisar o que a abertura anterior disse à
luz do que a errata mudou — e a abertura anterior não estava em lugar
nenhum: a edição sobrescrevia `jobs` e regravava as previsões, e o
"antes" só sobrevivia no de/para da auditoria.

E havia um bug de número: a tela lia o custo previsto de
`jobs.custo_previsto_total`, gravado na abertura. Job aberto só com custo
A ("nenhum item de calha PP", curva vazia) recebia uma linha B pela
errata e a revisão continuava mostrando R$ 0,00 — sem como incluir o
desembolso novo. O servidor, por sua vez, relia a planilha e cobrava uma
curva que a tela não deixava montar (JOB-0008, 08/09/2026).

## A regra

1. **O botão do resumo da errata chama-se "Revisar abertura".**
2. **A revisão nasce editável.** É o mesmo formulário da abertura, com
   tudo destravado, e termina em **"Registrar revisão de abertura"** —
   mesmo que nada mude. O clique passa pela mesma confirmação da
   abertura, com a data e o usuário da abertura como estão (eles não
   mudam, [021](021-projeto-do-financeiro-e-edicao-da-abertura.md)).
3. **Registrar a revisão devolve para a fila**, como abrir um job
   devolve. Quem revisa costuma ter mais de um job no mural.
4. **Cada registro confirmado deixa uma foto** em `jobs_aberturas`: a
   abertura (nº 1) e cada revisão de errata ou edição livre depois dela.
   A foto é imutável — sem policy nem grant de update/delete.
5. **A aba "Abertura do Job" lista as fotos**, cada uma com o seu
   "Visualizar": a abertura original e cada revisão, em leitura, com
   registro, rateio, parcelas de recebimento e cronograma de
   desembolsos. Na revisão, a faixa do topo mostra a errata e a abertura
   anterior em uma linha, com "Ver abertura anterior".
6. **O custo previsto da tela é o da planilha de hoje**
   (`planilha_desembolso`: planejado dos tipos que geram PP), a mesma
   conta da fila e da action. `custo_previsto_total` continua sendo
   gravado — é o que a foto guarda.

## As três respostas do Tiago

| Pergunta | Resposta |
|---|---|
| Os jobs já abertos não têm foto. O que fazer? | **Reconstituir do estado atual.** A migration grava a foto nº 1 de cada job aberto com o registro como está hoje, marcada `reconstituida`. Se o job já tinha sido editado, essa foto é do último estado, não do dia da abertura — o que houve antes fica na auditoria. |
| "Editar registro" (edição livre, decisão 021) continua? | **Continua, e entra no histórico**, rotulada "edição do registro". |
| Parcelas já consumidas (PP emitida, nota emitida) continuam travadas na revisão? | ~~**Sim.** A revisão redistribui só o saldo.~~ ⚠️ **Revisto no mesmo dia:** o primeiro job real a passar pela revisão (JOB-0029) mostrou que a trava criava um beco sem saída. Ela caiu inteira — ver [061](061-as-previsoes-se-redistribuem-inteiras.md). |

## Como a lista se lê

A lista abre **recolhida na versão mais recente** — é ela que o
formulário abaixo reflete. "Ver as N versões anteriores" expande, da
mais nova para a mais antiga, e cada uma tem o seu "Visualizar"
(decisão do Tiago, 08/09/2026, olhando a lista completa pela primeira
vez: quatro linhas no topo de todo job era ruído).

## Como a foto se lê

`Abertura` → `Revisão 1 · errata "…"` → `Revisão 2 · edição do registro`.
O número é sequencial dentro do job; o rótulo diz de onde veio. A foto
guarda ids (projeto, contas, categoria, serviço) e resolve os nomes na
leitura: se a conta foi renomeada, a foto mostra o nome de hoje — o que
importa é qual conta era.

Os totais da foto reconstituída vêm dos valores congelados na abertura
(`valor_job_abertura`, `faturamento_previsto_abertura`) quando existem —
são eles que dizem sobre que base a abertura foi feita.

## Onde a regra mora

| | Arquivo |
|---|---|
| A tabela e o backfill | `supabase/migrations/20260908150001_jobs_aberturas_fotos.sql` |
| Gravar e listar fotos | `app/(app)/financeiro/abertura-de-job/fotos.ts` |
| A foto na abertura e na edição/revisão | `abertura-de-job/actions.ts` (`abrirJobNoFinanceiro`, `editarRegistroDaAbertura` — que agora devolve `revisao: true` e audita como `job.abertura_revisada`) |
| O modo `revisao` do formulário | `abertura-de-job/[jobId]/abertura-form.tsx` |
| Histórico, faixa da revisão e a foto em leitura | `abertura-de-job/[jobId]/historico-abertura.tsx` |
| O custo previsto da planilha de hoje | `financeiro/jobs/[jobId]/page.tsx` |
| "Revisar abertura" | `abertura-de-job/resumo-errata-dialog.tsx` |
| Tipos | `lib/types.ts` — `FotoDaAbertura`, `rotuloDaFoto` |

## Fora desta decisão

- **Comparar duas fotos lado a lado** (o que mudou entre a abertura e a
  revisão). Hoje cada foto abre sozinha; o de/para continua na auditoria.
- **Foto na reprovação** — reprovar não confirma registro nenhum.
- **A pendência da 021** (`pp-drawer-financeiro.tsx` apontando para
  `/jobs/[id]`) continua como estava.
