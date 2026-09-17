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

## 5. O que ficou de fora

- **`BaixaLoteCartaoDialog`** (`app/(app)/financeiro/contas-a-pagar/baixa-lote-cartao-dialog.tsx`)
  recebeu a mesma troca, mas **nenhuma tela o importa** — é componente
  órfão. Fica registrado para remoção.
- **Editar PP de verba**: o campo Responsável só aparece em PP de verba, e
  o botão Editar só em PP rejeitada. Não existe PP de verba rejeitada no
  banco, então esse caminho não foi exercitado na tela — o bloco é o mesmo
  do "Gerar PP", que foi.
