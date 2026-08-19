# 019 — A categoria do job é a do orçamento

**Data:** 2026-08-18
**Status:** aceita
**Contexto:** pop-up de envio do job (`/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]`)
e as duas telas da abertura no financeiro (`/financeiro/abertura-de-job`).

## O problema

`categorias_dominio` tinha três vocabulários — escopo `projeto`, `orcamento`
e `job`. O terceiro (Ativação de marca, Conteúdo · Digital, Evento, Fee
mensal, Trade · PDV) existia num lugar só: o select **"Categoria do job"**
do formulário de abertura no financeiro. Quem abria o job classificava do
zero, sem relação com o que a produção tinha definido no orçamento — e o
job não carregava essa categoria em nenhuma outra tela.

Nas palavras do Tiago: *"O campo atual não existe e não faz sentido."*

## A decisão

**A categoria do job é a categoria do orçamento de origem** —
`categorias_dominio`, escopo `orcamento` (hoje: Ativação, Conteúdo, Extra,
Influencer), obrigatória no orçamento desde 17/08/2026.

| Onde | Comportamento |
|---|---|
| Abertura no financeiro | O select chega **pré-selecionado** com a do orçamento e oferece o mesmo vocabulário |
| Troca pelo financeiro | **Permitida.** Grava em `jobs.categoria_id` e **não** altera o orçamento |
| Pop-up "Enviar job para abertura" (formulário) | Campo travado, "Cadastrada no orçamento." |
| Pop-up "Tem certeza que quer enviar esse job para a abertura?" | Linha no card de resumo |
| Pop-up "Conferir o job antes de abrir" | Linha no card de resumo |
| Painel "Dados da produção" da abertura | Linha fixa, com a do orçamento |

Em todas elas a categoria fica **entre o Produto e Cidade · Regional** —
posição pedida pelo Tiago em 18/08.

A troca pelo financeiro sem eco no orçamento é o mesmo padrão que
`jobs.nome_financeiro` já usa: o financeiro ajusta para o uso dele sem
mexer no que a produção vê.

**Por que a do orçamento e não a do projeto:** o projeto é guarda-chuva de
vários orçamentos, e neste ERP **um orçamento = um job** — a tela do lote
se chama literalmente "Novo orçamento de job". A categoria do projeto
classifica o guarda-chuva; a do orçamento classifica o job.

## Por que a categoria tinha de vir do orçamento, e não do próprio job

`jobs.categoria_id` é **null até o financeiro abrir o job** — quem grava é
a abertura. Nos dois momentos em que a categoria precisa aparecer (o envio
pela produção e a conferência pelo financeiro) o job ainda não tem a dele.
A única categoria que existe ali é a do orçamento. Isso decide a questão:
não havia como exibir uma categoria "do job" nessas telas sem herdá-la.

## Onde a regra mora

| Onde | O quê |
|---|---|
| `app/(app)/financeiro/abertura-de-job/[jobId]/page.tsx` | busca as categorias com `escopo = 'orcamento'` |
| `app/(app)/financeiro/abertura-de-job/[jobId]/abertura-form.tsx` | pré-seleciona a herdada; só aceita id presente na lista |
| `app/(app)/financeiro/abertura-de-job/actions.ts` | recusa categoria fora do escopo `orcamento`, inativa ou de outro tenant |
| `app/(app)/financeiro/abertura-de-job/dados.ts` | `JobNaFila.categoria_id` / `categoria_nome`, lidos do orçamento embedado |
| `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/page.tsx` | `herdados.categoriaNome`, lido do orçamento |

**Sem migration.** `jobs.categoria_id` é FK solta para `categorias_dominio`,
sem CHECK de escopo — quem valida o escopo é a Server Action. A mudança é
inteira de aplicação.

## O que ficou de fora, de propósito

- **As 5 categorias de escopo `job` continuam no banco** e no cadastro
  (Cadastros › Categorias). **12 jobs abertos antes de 18/08/2026 apontam
  para elas** e seguem exibindo o nome gravado — apagá-las é mudança
  destrutiva e não foi feita. Enquanto elas existirem, o escopo `job` é um
  vocabulário órfão: não alimenta mais nenhuma tela.
- **Categoria não entrou em `herdadosIncompletos()`.** Orçamento antigo sem
  categoria (existem alguns) não bloqueia o envio — o pop-up mostra
  "— não informada". Na abertura ela **continua obrigatória**, como já era.
- **Categoria inativada entre o envio e a abertura** deixa o campo vazio, e
  o rodapé pede para escolher. Preferido a pré-selecionar um valor que o
  servidor recusaria no envio.
- **O painel "Dados da produção" mostra a do orçamento, não a do select.**
  Se o financeiro trocar, o painel continua com a que a produção mandou e
  o "Resumo do registro" mostra a escolhida — a mesma divisão que o nome
  do job já fazia.
