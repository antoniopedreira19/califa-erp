# 067 — O campo de fornecedor busca, limpa e edita

**Data:** 2026-09-09
**Status:** aceita
**Migration:** nenhuma — só leitura de `fornecedores.cpf_cnpj`, coluna que
já existia
**Design:** `PP - Campo Fornecedor.dc.html` e `Fornecedores - Novo Cadastro
na PP.dc.html`, projeto Claude Design `69342d83`
**Contexto:** o campo de fornecedor do formulário de PP (nova e rejeitada)
e do BV. Continua a [048](048-fornecedor-nasce-de-dentro-da-pp.md), que
criou o "+", e a [065](065-o-cadastro-de-fornecedor-exige-contato-e-solta-o-endereco.md),
que refez o formulário que o "+" abre.

## O problema

O campo era um combo de escolher: 23 fornecedores hoje, uma lista que só
cresce, e nenhuma forma de chegar num deles a não ser rolando. Escolhido
o errado, não havia como desfazer — o campo não zerava. E o "+" ao lado,
que cadastra, ficava inútil depois da primeira escolha, ocupando espaço
para uma ação que ninguém mais ia usar naquele formulário.

## As decisões do Tiago

Perguntadas antes de codar:

| Pergunta | Resposta |
|---|---|
| Onde entra o campo novo agora? | **PP e BV.** As outras seis telas com campo de fornecedor ficam para depois — pendência registrada abaixo. |
| Quem vê o lápis? | **Quem gera a PP.** Sem gate novo no cliente; o servidor continua exigindo `cadastros.fornecedores.editar`. |
| E se alguém editar os dados bancários de um fornecedor que já tem PP no financeiro? | **Congelar na PP + asterisco.** Ver a seção 4. |

## 1. Escrever para buscar

O `Combobox` ganhou uma caixa de busca no topo da lista. Ela filtra sem
acento e sem caixa, e olha **duas** coisas: o nome e o documento. Cada
opção passou a ter duas linhas — nome em cima, CPF/CNPJ em monoespaçada
embaixo — porque a base tem homônimos e o documento é o que desempata.

Para o campo ter o documento, quatro consultas passaram a trazer
`cpf_cnpj` junto do nome. Nenhuma delas ganhou linha ou embed novo: é uma
coluna a mais no `select` que já existia.

**Busca sem resultado não é beco.** Digitou um nome que não está na base,
o rodapé da lista oferece *"Cadastrar «…» como novo fornecedor"* e abre o
cadastro **com o nome já preenchido**.

## 2. O ✕ que zera e o botão que troca de cara

Dentro do campo, à esquerda da seta, um ✕ aparece assim que há alguém
escolhido. Ele limpa a escolha sem abrir a lista — vai como `<span
role="button">` porque o gatilho do combo já é um `<button>`, e botão
dentro de botão é HTML inválido.

Ao lado do campo, o botão único:

- campo **vazio** → **"+"**, que cadastra um fornecedor novo;
- campo **preenchido** → **lápis**, que abre o cadastro do escolhido.

É o mesmo botão trocando de ícone, não dois botões. O ✕ é o que devolve o
"+" — daí ele ser obrigatório para o desenho fechar.

## 3. O dialog de cadastro agora também edita

O `NovoFornecedorDialog` da decisão 048 passou a aceitar um fornecedor
existente e virar edição. É o **mesmo** `FornecedorForm` da página, no
modo `dialog` — não há um segundo formulário de fornecedor com regras
próprias, e as réguas da 065 valem aqui inteiras.

Só o cabeçalho muda: título, nota e o toggle **PJ/PF**, que no desenho
mora ao lado do título em vez de uma linha própria, porque ali o espaço é
do dialog.

A edição **não mexe na escolha**: salvou, o dialog fecha, o fornecedor
continua selecionado e o que já tinha sido digitado na PP ou no BV
continua lá.

Como o dialog abre de mais de uma tela, o texto do cabeçalho é
parametrizado por `contexto` (`"pp"` | `"bv"`) — *"Ao criar, ele já fica
selecionado na PP"* virou *"…no BV"* quando é o BV que está atrás. As
telas da pendência abaixo acrescentam suas chaves.

## 4. Dado de pagamento de PP já enviada: congela e marca

**Isto ainda não está implementado.** A regra foi decidida nesta conversa
e a implementação é a próxima entrega — está aqui para não se perder e
porque ela condiciona o que o lápis pode fazer.

O risco que o lápis cria: o financeiro paga pelo que a PP diz. Se alguém
editar banco, agência, conta ou PIX de um fornecedor **depois** que uma PP
dele já foi para o financeiro, a PP passaria a apontar para uma conta que
não era a combinada.

A saída escolhida pelo Tiago:

- a PP **fotografa** banco, agência, conta e PIX no momento do envio ao
  financeiro, e o financeiro paga **pela foto**;
- o cadastro novo vale para as **próximas** PPs;
- a PP cujo cadastro mudou depois ganha um **asterisco**, avisando que o
  cadastro do fornecedor foi alterado após aquele envio;
- salvar dado de pagamento de um fornecedor com PP no financeiro **avisa
  antes**.

Isso toca `app/(app)/financeiro/**`, que é território de outra frente —
combinar antes de escrever.

## Pendência — as outras seis telas

O campo novo entrou só em PP e BV. Seguem com o combo antigo, sem busca,
sem ✕ e sem lápis:

- contas a pagar avulsa;
- contas a pagar recorrente;
- contas a receber;
- desembolsos (as três telas que escolhem fornecedor).

O `Combobox` já suporta tudo por prop (`buscaPlaceholder`, `limpavel`,
`acaoSemResultado`); o que falta em cada tela é passar `cpf_cnpj` na
consulta e pendurar o botão ao lado.

## Verificação

Conferido no navegador logado, nas quatro superfícies que usam o campo:

- **PP nova** (`gerar-pp-drawer`): busca por `62.074` achou GABRIELA pelo
  documento; "Cadastrar «Grafica Teste Califa»" abriu o dialog com o nome
  preenchido; o lápis carregou o cadastro completo; salvar fechou o dialog,
  manteve o fornecedor escolhido e a descrição digitada sobreviveu ao
  `router.refresh()`.
- **PP rejeitada** (`editar-pp-drawer`): o ✕ zerou o campo, o lápis virou
  "+" e a dica abaixo trocou junto.
- **BV pelo realizado do job** e **BV pelo orçamento**: as duas listas
  vieram com o documento na segunda linha; o cabeçalho do dialog leu "no
  BV".

`npx tsc --noEmit` e `next lint` limpos. Console sem erro de aplicação.
