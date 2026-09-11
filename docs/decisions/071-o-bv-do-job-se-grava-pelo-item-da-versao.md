# 071 — O BV do job se grava pelo item da versão, e a linha de errata não tem BV

**Data:** 2026-09-11
**Status:** aceita
**Contexto:** Planilha Interna do job (`/jobs/[jobId]` e
`/financeiro/jobs/[jobId]`), formulário de BV compartilhado
(`app/(app)/_bv/`) e planilha da versão do orçamento. Fecha o defeito que
a [022](022-bv-liquido-e-realizado-por-pp.md) §"depois da aprovação o BV
passa a ser tratado na planilha do job" prometia e que nunca funcionou.

## A regra

> **O BV é endereçado pelo item da VERSÃO (`versoes_orcamento_itens.id`),
> venha a tela do orçamento ou do job.**
> ~~**Linha nascida de errata não tem item de versão — e por isso não tem
> BV.**~~

> ⚠️ **11/09/2026 — a segunda frase foi substituída pela
> [073](073-o-bv-nao-depende-da-versao-aprovada.md), no mesmo dia.** A
> pergunta que esta decisão deixou aberta foi respondida: o BV **não**
> depende da versão aprovada, e a linha nascida de errata aceita BV
> sempre que o tipo de custo permitir (`A`, `AR`, `D`). O endereço passou
> a ser a cópia do job nesse caso. A primeira frase continua valendo — e a
> chave agora vai **marcada** com o espaço a que pertence.

## O problema

Abrir o BV de um item na planilha do job, preencher e clicar em **Salvar**
devolvia sempre **"Item não encontrado."**. **Confirmar** também, porque
ele grava antes de confirmar. A leitura funcionava: a lista de BVs
aparecia certa no diálogo. Só a escrita falhava. Pela tela do orçamento
funcionava normalmente.

O resultado prático, medido em 11/09/2026 sobre os 7 BVs ativos:

| | |
|---|---|
| BVs ativos | 7 |
| BVs **confirmados** | **0** |
| BVs sem nenhum caminho de edição | 2 |

Zero confirmados não é coincidência. `confirmarBv` só é alcançável a
partir do job, e a partir do job ele estava quebrado: **a esteira BV →
contas a receber nunca rodou ponta a ponta**.

## A causa

`BvDialog` mandava `item.id` para as Server Actions, que tratam esse
argumento como `item_versao_id`. Isso era verdade nas duas telas até
**27/08/2026**, quando `56ba52e` — *"a planilha do job passa a se chavear
por si mesma"* — trocou a chave da planilha do job de
`versoes_orcamento_itens.id` para `jobs_itens_orcado.id`, a cópia, que é a
única que existe em toda linha depois que a errata passou a criar linha.

Aquele commit migrou o **lado da leitura**: `itens_bv` ganhou
`job_item_orcado_id`, com backfill 1:1, e a planilha do job passou a ler o
BV por ali. O **lado da escrita** ficou onde estava, esperando o id da
versão. A partir daquele dia a tela do job passou a mandar o id da cópia
para uma action que procura em `versoes_orcamento_itens` — e não acha.

Daí os dois sintomas casarem: a leitura já falava a chave nova, a escrita
ainda falava a antiga.

O que escondeu isso por duas semanas foi a assimetria: ninguém desconfia
de uma tela cujo conteúdo aparece certo. E `tsc`, `lint` e `build` não
tinham como pegar — os dois ids são `string`, e o campo que os
diferenciava (`item_versao_id`) existia no tipo desde 27/08, apenas não
era usado. Mais um caso da armadilha registrada no `CLAUDE.md`: **o
verificador não checa o que o id SIGNIFICA.**

## A decisão

**1. A chave de gravação vira prop explícita do `BvDialog`.**

`item.id` deixa de ser a chave. Entra `chaveDoItem`, **obrigatória**, e
cada tela diz qual é a sua:

| Tela | `chaveDoItem` |
|---|---|
| orçamento | `item.id` — ali a linha JÁ é o item da versão |
| job | `item.item_versao_id` — **não** o `item.id`, que é a cópia |
| rascunho (com `adaptador`) | a chave local da linha |

Obrigatória, e não opcional, de propósito: campo opcional desliga a
checagem pelo outro lado, que é a segunda metade da mesma armadilha do
`CLAUDE.md`.

**2. Linha de errata não oferece BV.**

`item_versao_id` nulo significa linha que a errata criou: ela não existe
no orçamento aprovado, e é lá que o BV mora. A calha deixa de desenhar o
botão. Nada se perde: o botão existia, mas não gravava.

**3. A action explica em vez de dizer "Item não encontrado."**

Quando o id não é de item de versão, `carregarContexto` consulta
`jobs_itens_orcado` antes de responder, e separa os dois motivos:

- a linha existe e é de errata → *"Linha criada por errata não tem item no
  orçamento aprovado — o BV não pode ser lançado nela."*
- a linha existe e tem item de versão, mas veio o id da cópia → *"A tela
  está desatualizada — recarregue a página e lance o BV de novo."*

"Item não encontrado." fica só para o id que não é de lugar nenhum. A
mensagem antiga mandava investigar o lugar errado — foi ela que fez o
diagnóstico custar o que custou.

## Por que endereçar pela versão, e não pela cópia

A rota alternativa seria o BV passar a se endereçar por
`job_item_orcado_id`, que cobriria também a linha de errata. Não foi feita
agora porque o dado não pede:

- **nenhum dos 7 BVs ativos está em linha de errata.** Todos os 7 têm
  `item_versao_id` preenchido, então a chave da versão resolve **100% do
  dado de hoje**;
- o BV também nasce no orçamento, **antes de o job existir** — 3 dos 7
  estão nesse estado, sem cópia nenhuma. Endereçar só pela cópia exigiria
  duas rotas de qualquer forma;
- é a mesma conclusão a que a [069](069-a-regional-do-job-e-a-fonte.md)
  chegou ao ligar o BV ao job: resolver pelas duas rotas seria inventar
  regra que o dado não pede.

**Fica uma ponta solta, e ela é de negócio, não de código.** Existem hoje
**2 linhas de errata de tipo com BV** — JOB-0029, "Item 2" (`A`) e
"Item 3" (`AR`) —, e elas passam a não oferecer BV. Hoje ofereciam um
botão que não gravava, então nada regride. Mas *se* a regra for que
serviço acrescentado por errata também pode ter comissão negociada, o
endereçamento por `job_item_orcado_id` volta à mesa. **Pergunta aberta
para o Tiago; não decidida aqui.**

## O que mudou

| Arquivo | Mudança |
|---|---|
| `app/(app)/_bv/bv-dialog.tsx` | prop `chaveDoItem` obrigatória; é ela que vai para `acoes.salvar`, não `item.id` |
| `app/(app)/jobs/[jobId]/realizado/job-item-realizado-table.tsx` | passa `item_versao_id`; a calha não oferece BV em linha de errata |
| `app/(app)/orcamentos/.../versoes/[versaoId]/itens-table.tsx` | passa `bvAberto.id`, agora explícito |
| `app/(app)/_bv/actions.ts` | `porQueNaoAchou()` — a recusa passa a dizer o motivo |

Sem migration: o banco já tinha as duas chaves em `itens_bv` desde
27/08/2026. O defeito era só de fronteira de prop.

## Conferido no navegador (2026-09-11)

Logado, em **JOB-0033** (`0-0001/26 · Projeto Teste`, item "Item 1", tipo
`A`), com cada passo conferido no banco:

| Caminho | Resultado |
|---|---|
| **Salvar** | R$ 4.000,00 → **R$ 4.500,00** em `itens_bv`; auditoria `item_bv.editado`, `origem: job` |
| **Lançar BV novo** | nasce com **as duas chaves** preenchidas (`item_versao_id` *e* `job_item_orcado_id`); auditoria `item_bv.lancado` |
| **Remover** | o BV novo vai a `cancelado` e **o outro BV da linha fica intacto** (062); auditoria `item_bv.cancelado` |
| **Confirmar** sem alíquota | recusa com *"Informe a alíquota do imposto antes de enviar o BV ao contas a receber."* |
| **Confirmar** com alíquota | `situacao = confirmado`, `percentual_imposto = 19,53`; pop-up mostra o líquido de R$ 3.621,15, que confere |
| **Fila de faturamento** | o BV aparece em `vw_faturamento_pendente` como `BV — Item 1`, R$ 4.500,00, **com `job_id` resolvido** |
| **BV confirmado** | volta a abrir travado — campos desabilitados, só "Fechar" e "Novo BV" |

**É a primeira vez que a esteira BV → contas a receber roda ponta a
ponta.** Antes desta correção havia 7 BVs ativos e **zero** confirmados.

Também conferido, contra regressão:

- **JOB-0029** (as 2 linhas de errata, `A` e `AR`): **zero** botões de BV,
  e a calha de PP do `AR` intacta;
- **orçamento** (`/orcamentos/[projetoId]/[orcId]`, versão em rascunho):
  lançar e remover BV seguem funcionando, com `job_item_orcado_id` nulo
  como esperado antes de o job existir;
- `/jobs/[jobId]`, `/financeiro/jobs/[jobId]` e
  `/financeiro/abertura-de-job/[jobId]/planilha` renderizam com **zero
  erros de console** e zero erro de servidor.

O dado de teste criado no caminho foi desfeito: o BV de R$ 2.222,00 do
orçamento está `cancelado` e o item voltou ao tipo `B`.

## O que continua valendo

Tudo da [062](062-bv-so-no-realizado-multiplo-e-com-aliquota-propria.md):
vários BVs por item, alíquota própria por BV, ciclo por BV, alíquota
exigida só no Confirmar. E o que a
[022](022-bv-liquido-e-realizado-por-pp.md) prometia — *depois da
aprovação, o BV se trata na planilha do job* — passa a ser verdade pela
primeira vez.
