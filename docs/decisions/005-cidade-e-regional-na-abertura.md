# 005 — Cidade e Regional são editáveis na abertura do job

## Status

Vigente. Decidida em 12/08/2026, na revisão do modal "Enviar job para
abertura". Substitui parcialmente a regra de 06/08/2026 que tinha travado
esses dois campos (ver `HANDOFF_ORCAMENTO.md`, seção 12.6).

## A regra em uma frase

**Cidade e Regional abrem o modal pré-preenchidas com o que está no
orçamento, podem ser trocadas ali, e o valor escolhido é gravado no job E
de volta no orçamento — como já acontecia com nome e datas.**

## O que muda em relação a 06/08/2026

Naquela entrega, cinco campos viraram herdados e o servidor passou a relê-los
do banco, ignorando o formulário: produto, cidade, regional, GP e produtor.

Continuam herdados e travados **três**: produto (vem do projeto), GP e
produtor (vêm do orçamento). Cidade e regional voltaram a ser campos de
formulário — passam pelo `aberturaJobSchema` e vão no `FormData`.

Motivo: quem abre o job é o último a olhar esses dois dados antes de eles
entrarem no financeiro, e mandar o usuário sair do fluxo para editar o
orçamento só para corrigir uma cidade custava mais do que o trava valia.

## O que o servidor confere

Campo editável no HTML não é garantia — o payload não é obrigado a
respeitar a lista que a tela mostrou. Antes de gravar, `enviarJobParaAbertura`:

1. exige `cidade_id` e `regional_id` em formato uuid (Zod);
2. confirma que a cidade existe no cadastro do tenant;
3. confirma que a regional está em `projeto_regionais` do projeto do
   orçamento — a mesma regra do formulário do orçamento, que lá é feita
   por `assertRegionalEGpDoProjeto`.

Qualquer uma que falhe devolve `fieldErrors` no campo certo, e nada é
gravado.

## Por que grava de volta no orçamento

Para orçamento e job nunca divergirem nesses campos. O modal avisa isso na
descrição, e o `UPDATE` em `orcamentos` acontece na mesma action, junto com
nome e datas.

## Opções que a tela oferece

- **Regional:** só as regionais do projeto (`projeto_regionais`), em ordem
  alfabética. Projeto sem regional cadastrada desabilita o select e o texto
  de apoio manda editar o projeto.
- **Cidade:** combobox com busca no servidor (`buscarCidades`, `ilike` +
  limit 30), o mesmo componente que tinha ficado órfão em 06/08. O cadastro
  foi desenhado para receber a lista completa do IBGE — nunca carregar tudo
  no cliente.

## O que esta decisão NÃO cobre

- Produto, GP e produtor: seguem herdados, relidos do banco na gravação.
- Editar cidade/regional depois do job aberto: o modal em modo somente
  leitura continua só exibindo o que ficou congelado no job.
