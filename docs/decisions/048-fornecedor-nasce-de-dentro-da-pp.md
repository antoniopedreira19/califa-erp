# 048 — O fornecedor nasce de dentro da PP, e o formulário de PP volta ao painel

**Data:** 2026-09-04
**Status:** aceita
**Contexto:** formulário "Gerar Pedido de Produção" da Planilha Interna
do job (`/jobs/[jobId]`) e o cadastro de fornecedores. Decisões do Tiago
em 04/09/2026. Completa a 039.

## A mudança em três frases

1. **Ao lado do combo de fornecedor há um "+"** que abre o cadastro
   completo de fornecedor num dialog. Ao criar, o fornecedor já fica
   selecionado e a PP segue — sem sair da tela, sem esperar o refresh.
2. **CPF/CNPJ repetido não cadastra.** A tela confere ao sair do campo e
   o servidor confere de novo antes de gravar; o índice único do banco é
   a garantia final. Quando já existe, a tela diz de quem é o documento e
   oferece **selecionar esse fornecedor** em vez de criar outro.
3. **O formulário de PP não fecha tudo mais.** Gerar PP, Salvar
   alterações e Cancelar devolvem para o painel "Destrinchar realizado",
   de onde o formulário foi aberto — como o design de 02/09 já descrevia
   para o Cancelar.

## 1. Cadastro completo, com três campos a mais obrigatórios

Decisão do Tiago, entre três opções (mínimo · mínimo + pagamento ·
completo): **o formulário completo**, exigindo o que o cadastro de
sempre deixa opcional — **documento, e-mail e telefone**. O bloco de
pagamento (banco OU PIX) e o endereço já eram obrigatórios.

Por quê: o fornecedor que nasce numa PP vai ser pago pelo financeiro dias
depois. Sem documento não há como barrar duplicidade; sem e-mail e
telefone não há como cobrar a nota; sem PIX ou conta não há como pagar.
Economizar campo aqui é criar um cadastro "Dados incompletos" que alguém
teria de caçar depois.

O `FornecedorForm` é o MESMO da página `/fornecedores/novo`, no modo
`dialog` (`fornecedorCompletoSchema`, `criarFornecedorRapido`). A página
de cadastro continua com as regras de sempre — documento, e-mail e
telefone opcionais lá. Se o time quiser as mesmas exigências na página,
é trocar o schema; a decisão de hoje foi sobre o caminho da PP.

## 2. Duplicidade: conferir antes, garantir depois

| Momento | O que acontece |
|---|---|
| Ao sair do campo CPF/CNPJ (com o tamanho certo para o tipo) | `buscarFornecedorPorDocumento` — aviso âmbar "já cadastrado como X" e o botão **Selecionar este fornecedor** |
| Ao clicar em Criar com o aviso na tela | não chama o servidor; repete a mensagem |
| No servidor (`criarFornecedorRapido`) | confere de novo e devolve `duplicado` — cobre a tela desatualizada |
| Dois cadastros ao mesmo tempo | `uniq_fornecedores_documento_por_tenant` recusa o segundo; `mapDbError` traduz |

Inativo também conta como existente: o documento é um só. Nesse caso o
aviso diz que está inativo e não oferece selecionar — PP exige fornecedor
ativo, e o caminho é reativá-lo em Fornecedores.

Vale para CPF e CNPJ, sem distinção (decisão do Tiago em 02/09 sobre
"qualquer anexo" não se aplica aqui; aqui a resposta foi a literal:
CNPJ ou CPF).

## 3. Selecionar sem esperar o refresh

O combo de fornecedores vem do server component. O fornecedor criado no
dialog entra no estado do formulário (`fornecedorNovo`), mesclado à lista
e deduplicado por `id` — o mesmo padrão do projeto novo da abertura de job
(decisão 021). **Não há `router.refresh()` nesse momento**, de propósito:
o refresh no meio do preenchimento re-renderizava a página e zerava o
formulário da PP. A lista mesclada segura o fornecedor até o formulário
fechar; o fechamento já dispara o refresh, e quando a lista real chega
nada duplica. (A `revalidatePath("/fornecedores")` da action continua,
para a página de fornecedores.)

A seleção acontece em dois tempos. O `Select` do Radix espelha o valor num
`<select>` nativo escondido; se o valor novo e a `<option>` nova chegam na
mesma renderização, o nativo ainda não tem a opção, volta para `""` e
dispara `onValueChange("")` — a escolha some em silêncio. Por isso o
drawer guarda `fornecedorPendenteId` e só o promove a `fornecedorId`
quando o fornecedor já está em `fornecedoresVisiveis`.

## 3b. Um bug antigo que apareceu no caminho

O schema tratava `tipo_conta` e `pix_tipo` como `z.enum` direto, e o
`<select>` vazio manda `""` — cadastro sem banco e sem PIX falhava com
"Invalid enum value" em vez de passar pela regra do "pelo menos um".
Os dois ganharam o `nullIfEmpty` dos outros campos opcionais; vale para a
página `/fornecedores/novo` também.

## 4. O formulário volta ao painel

Até aqui "Gerar PP" fechava o formulário e a pessoa voltava para a
planilha; para enviar a PP recém-gerada era preciso reabrir o painel
pelo chip. Agora `onOpenChange(false)` do formulário reabre o painel do
item, para os três caminhos (gerar, salvar edição, cancelar). A PP nova
aparece no bloco "Aguardando envio" assim que o refresh chega.

## 5. Onde a regra mora

| | Arquivo |
|---|---|
| Schema do cadastro rápido | `lib/validations/fornecedores.ts` — `fornecedorCompletoSchema` |
| Actions | `app/(app)/fornecedores/actions.ts` — `criarFornecedorRapido`, `buscarFornecedorPorDocumento`; `criarFornecedor` passou a usar o mesmo `inserirFornecedor` |
| Formulário no modo dialog | `app/(app)/fornecedores/fornecedor-form.tsx` (`modo="dialog"`) e `novo-fornecedor-dialog.tsx` |
| O "+" e a mescla | `app/(app)/jobs/[jobId]/realizado/gerar-pp-drawer.tsx` |
| Voltar ao painel | `app/(app)/jobs/[jobId]/realizado/job-item-realizado-table.tsx` |

## 6. Fora desta decisão

- O "+" no formulário de **correção da PP rejeitada**
  (`pps/editar-pp-drawer.tsx`) e nos combos de fornecedor do financeiro
  (conta avulsa e recorrente). O dialog está pronto para ser reusado ali;
  não foi pedido.
- Exigir documento, e-mail e telefone na página `/fornecedores/novo`.
