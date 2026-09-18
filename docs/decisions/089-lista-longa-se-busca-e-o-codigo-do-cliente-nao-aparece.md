# 089 — Lista longa se busca, e o código do cliente não aparece nela

**Data:** 2026-09-17
**Decidido por:** Tiago
**Migrations:** nenhuma — é regra de tela.

---

## 1. O problema

O campo **Cliente** do formulário de projeto era um `Select`: 157 clientes
ativos, em ordem alfabética, e a única forma de achar um era rolar. O campo
de **GP** ao lado, que é `MultiSelect`, já tinha busca — e o de
**fornecedor** da PP, que é `Combobox`, também, desde a
[067](067-o-campo-de-fornecedor-busca-limpa-e-edita.md).

A varredura de 17/09/2026 mostrou que o problema não era só ali: os mesmos
`Select` sem busca estavam no filtro de cliente da lista de projetos, no
cliente do faturamento avulso, nos pares Tipo/Subtipo do plano de contas
(62 subtipos ativos), no responsável da PP de verba e do job (25 pessoas) e
na UF (27 fixas).

## 2. A regra

> **Campo de escolha única cuja lista pode passar de ~15 itens usa
> `Combobox`, não `Select`.** A conta é pelo que a lista pode ter em
> produção, não pelo que ela tem hoje.

- **O gatilho continua parecendo um Select (2a).** Onde o Combobox entra no
  lugar de um, ele leva `COMBOBOX_COMO_SELECT` (`h-11 border-border
  px-3.5`) — o Combobox nasceu na PP com `h-10`, e sem isso o campo fica
  mais baixo que os vizinhos numa barra de filtros.
- **A busca ignora acento e maiúscula (2b)**, e casa em qualquer posição do
  texto: "amb" acha AMBEV e CASAS PERNAMBUCANAS.
- **Lista pequena e fechada continua `Select` (2c)** — empresa (4),
  regionais da empresa, marcas do cliente (máx. 5), forma de pagamento,
  status. Busca em lista de 4 itens é um passo a mais, não a menos.
- **A célula de seleção da planilha não muda (2d).** Ela está amarrada à
  navegação por teclado da [046](046-navegacao-por-teclado-nas-planilhas.md),
  e as listas dela são curtas.

## 3. O código do cliente não aparece na lista

> **Na lista do campo Cliente aparece só o nome fantasia. O código curto
> entra na BUSCA, sem ser renderizado.**

O campo de fornecedor mostra o documento embaixo do nome, e a primeira
versão deste campo copiou o padrão com o código curto. O Tiago vetou:
**um cliente pode ter mais de um CNPJ**, e portanto mais de um cadastro e
mais de um código — uma linha exibindo um deles dá a entender que aquele é
"o" código do cliente.

A busca por código continua: quem digita `PNB` acha CASAS PERNAMBUCANAS. É
o campo `busca` do `ComboboxItem` (`components/ui/combobox.tsx`), que
filtra sem aparecer — diferente de `descricao`, que é a segunda linha
visível do fornecedor.

## 4. O "+" ao lado da Marca

O campo **Marca** do projeto é obrigatório e só lista as marcas do cliente
escolhido. Ao lado dele passa a existir um **"+"** que abre a ficha do
cliente na seção Marcas (`/clientes/<id>#marcas`).

Ele aparece assim que há cliente escolhido, e não só quando a lista está
vazia, porque a lista vazia é a regra e não a exceção: **150 dos 157
clientes ativos não têm marca nenhuma** (conferido em 17/09/2026). A marca
padrão `PRD-01` só nasce junto do cliente desde 09/09/2026 — os cadastrados
antes ficaram sem, e o backfill não foi feito.

⚠️ O "+" navega para fora do formulário, e o que estava digitado no projeto
se perde. É o mesmo que o link "Cadastrar agora" já fazia. O cadastro
rápido de cliente e de marca dentro do próprio formulário está desenhado e
aguarda decisão — quando entrar, ele substitui esse salto.

✅ **17/09/2026, entregue — o cadastro rápido de cliente.** O "+" não leva
mais para fora do formulário. O campo virou `CampoCliente`
(`app/(app)/clientes/campo-cliente.tsx`), gêmeo do `CampoFornecedor` da
PP, e o que ele abre é o `NovoClienteDialog`, com o MESMO `ClienteForm` da
página no modo `dialog` — nada de um segundo formulário para divergir na
primeira correção:

- **campo vazio → "+" cadastra**; **cliente escolhido → lápis edita**; o ✕
  do campo devolve o "+". A busca sem resultado oferece *Cadastrar "…"
  como cliente*, e o nome digitado já chega preenchido.
- **O "+" ao lado de Marca abre o mesmo dialog na seção Marcas**, com uma
  linha nova em branco e o foco nela.
- **Criar devolve o cliente escolhido no campo, com a marca já na lista**
  — `criarCliente` ganhou `semRedirect` e devolve o id; o campo relê o
  cadastro (`carregarCliente`) e entrega as marcas ativas a quem o usa. Sem
  `router.refresh()`: ele zeraria o formulário do projeto no meio do
  preenchimento (a mesma armadilha que a PP encontrou em 04/09/2026).
- **Na edição, marca e portal já gravados INATIVAM, não somem** (pedido do
  Tiago ao aprovar o desenho). É o comportamento que o formulário completo
  já tinha, e veio junto por ser o mesmo componente: o ✕ vira "Reativar", e
  a linha continua no banco para os jobs que a usam.

Conferido no navegador, com gravação real: cliente criado pelo dialog
nasceu com a PRD-01 do trigger e ficou escolhido; marca acrescentada pelo
"+" apareceu no campo Marca sem recarregar; e inativar deixou
`ativo = false` no banco, sumindo só da lista de escolha.

## 4b. Todo cliente tem marca padrão — agora garantido pelo banco

⚠️ **17/09/2026.** O número dos 150 clientes sem marca levou à segunda
decisão do dia: *"isso nunca deveria acontecer, porque todo cliente deve
ser cadastrado com uma marca padrão"*. Duas migrations:

- `20260917160001_marca_padrao_para_clientes_antigos.sql` — backfill.
  Criou a PRD-01 (nome = nome fantasia) para os 150 clientes que estavam
  sem nenhuma. Depois dela: 157 clientes, 157 marcas padrão, zero sem.
- `20260917160002_marca_padrao_nasce_com_o_cliente.sql` — o trigger
  `trg_clientes_marca_padrao`, que cria a PRD-01 na MESMA transação do
  INSERT do cliente.

Antes disso, quem criava a marca padrão era só a server action, em dois
INSERTs sem transação: o segundo falhando deixava cliente sem marca, e
qualquer caminho fora daquele formulário nascia torto. Regra crítica não
mora só no frontend (CLAUDE.md). A action continua criando as marcas
extras (PRD-02+) e agora **encontra** a padrão em vez de criá-la — com um
insert de reserva, que os índices únicos já existentes impedem de
duplicar.

## 5. O que ficou de fora

- **`BaixaLoteCartaoDialog`** (`app/(app)/financeiro/contas-a-pagar/baixa-lote-cartao-dialog.tsx`)
  recebeu a mesma troca, mas **nenhuma tela o importa** — é componente
  órfão. Fica registrado para remoção.
  ⚠️ **17/09/2026:** removido, junto com a action `darBaixaLoteCartao`
  (`actions-cartao.ts`), que só ele chamava. A troca para Combobox foi junto
  e não faz falta — a baixa da fatura de cartão sai hoje por "Fechar fatura"
  mais o `baixa-titulo-dialog`.
- **Editar PP de verba**: o campo Responsável só aparece em PP de verba, e
  o botão Editar só em PP rejeitada. Não existe PP de verba rejeitada no
  banco, então esse caminho não foi exercitado na tela — o bloco é o mesmo
  do "Gerar PP", que foi.

## 6. Quem vê o "+" e quem vê o lápis

⚠️ **18/09/2026.** O campo com botão ao lado — `CampoCliente` no projeto,
o campo Fornecedor da PP — passou a esconder o botão de quem não pode
usá-lo. O que existia antes era só a trava do servidor: o GP preenchia o
cadastro inteiro e lia **"Você não tem permissão para essa ação"** no
fim.

> **Criar e editar são DUAS permissões, e o gate segue o papel do botão,
> não o botão.**

| campo | "+" (criar) | lápis (editar) | atalho "Cadastrar «…»" |
|---|---|---|---|
| Fornecedor da PP | `cadastros.fornecedores.inline` — Admin, GP, Produtor | `cadastros.fornecedores.editar` — só Admin | segue o "+" |
| Cliente do projeto | `cadastros.clientes.editar` — só Admin | idem | segue o "+" |

**A armadilha, e ela quase passou:** a primeira versão desta mudança usou
`cadastros.fornecedores.editar` para os dois papéis do botão, e com isso
tirava do GP e do produtor o cadastro rápido da PP — que é a
[048](048-fornecedor-nasce-de-dentro-da-pp.md) inteira, feita
para eles. A permissão certa já existia (`…inline`, criada justamente
para esse fluxo) e o gate da action já era ela. **Antes de esconder um
botão por permissão, leia qual permissão a action daquele botão checa** —
não a do módulo, a daquela action.

Quando o botão some, o texto de apoio embaixo do campo muda junto, para
a pessoa saber o caminho em vez de procurar o botão: *"Escreva para
buscar na lista. Cadastro de fornecedor é com o administrador."*

**Fica em aberto, para o Tiago decidir:** não existe
`cadastros.clientes.inline`. O GP e o produtor criam orçamento
(`orcamentos.criar`) mas não cadastram cliente, então, com cliente novo,
o projeto para até um administrador cadastrar. Espelhar o fornecedor — um
gate `inline` para Admin, GP e Produtor — resolveria; é decisão de
negócio, não de tela.

Conferido no navegador em 18/09/2026, entrando como **GP Teste Claude**
(`gerente_producao`) e como administrador, nas duas telas. Para o GP ver
a planilha do job foi preciso passar o JOB-0033 (projeto de teste
`0-0001/26`) para ele — `quemPodeMexer` exige ser o responsável —, e o
responsável foi devolvido ao Tiago no fim.
