# 098 — O agrupamento só nasce com nome, e a planilha vazia já abre pedindo o primeiro

**Data:** 2026-09-21
**Decidido por:** Tiago
**Migration:** nenhuma.

Revê um ponto da [078](078-orcamento-mensal-fee-e-always-on.md) — o estado
vazio do mês ("Nenhum grupo em outubro ainda." com o botão) — e o "Novo grupo"
padrão com que a v1 das demais categorias nascia. O resto da 078 continua
valendo: o mês não é agrupamento, e cada mês tem os seus.

---

## 1. O problema

Criar agrupamento abria um pop-up com um campo só. E as duas famílias de
planilha nasciam de jeitos diferentes:

- **Ativação e afins** — a v1 nascia com um agrupamento gravado, chamado
  "Novo grupo", para a tela abrir pronta. Quem não renomeasse ficava com um
  "Novo grupo" na planilha que vai para o cliente.
- **Fee e Always On** — a v1 nascia sem agrupamento, e cada mês abria
  "fechado": um cartão de aviso com o botão, que abria o mesmo pop-up.

## 2. A regra (Tiago, 21/09/2026)

> *"O pop-up não deverá ser mais usado em nenhum caso de orçamento vazio. […]
> ao criar novos agrupamentos já automaticamente abre o editor, para que ele
> possa ser nomeado. Quanto ao mês, isso não é um agrupamento; meses podem ter
> seus próprios agrupamentos. […] nada poderá ser feito com um agrupamento sem
> nome."*

1. **Não existe mais pop-up para criar agrupamento.** O botão "Novo grupo"
   vira o campo de nome no próprio lugar, com a mesma forma do renomear:
   campo, ✓, ✕, Enter cria, Esc desiste, erro na própria linha.
2. **Planilha sem agrupamento abre pronta**, em qualquer modelo: cabeçalho,
   linha tracejada e total, com o campo do primeiro agrupamento **já em
   edição** e "Nomeie o agrupamento" escrito ao fundo. No modelo mensal isso
   vale mês a mês — cada mês vazio abre pedindo o primeiro agrupamento dele.
3. **O agrupamento só passa a existir quando recebe nome.** Nenhuma versão
   nasce mais com agrupamento gravado: a v1 de Ativação deixou de trazer o
   "Novo grupo". Sem nome não há agrupamento, e sem agrupamento não há onde
   lançar item.

## 3. Por que nada fica gravado antes do nome

A primeira ideia era todo mês nascer com um "Novo grupo" gravado. Ela bate em
duas regras que já existem:

- **"Copiar itens de outro mês" exige destino sem nenhum grupo** — é a função
  `copiar_mes_da_versao` que recusa ("O mês de destino já tem grupos"). Com um
  grupo padrão em cada mês, a cópia pararia de funcionar em todo mês novo.
- **O nome é único** por versão (`uniq_grupo_nome_por_versao`) ou por mês
  (`uniq_grupo_nome_por_mes`), e a coluna não aceita nome vazio
  (`grupos_nome_nao_vazio`). Um padrão gravado travaria o próximo "Novo grupo"
  e não poderia nascer "sem nome".

Deixar o campo aberto na tela, sem gravar nada, entrega o que foi pedido — a
planilha já vem aberta, pedindo o nome — sem mexer em nenhuma das duas. Por
isso não há migration nem backfill: os orçamentos mensais que já existiam com
mês vazio passam a abrir do jeito novo sozinhos.

## 4. O que não muda

- Agrupamentos chamados "Novo grupo" que já estão gravados em orçamentos
  antigos continuam lá; renomear é pelo lápis, como sempre.
- Versão travada (aprovada, com job) e sem agrupamento mostra só o aviso
  "Nenhum agrupamento nesta versão.", sem campo.
- Os editores de rascunho (criação em lote e visão agregada) não mudaram: lá o
  agrupamento já nascia local, como "Novo grupo N", sem pop-up.
- A importação de planilha segue criando os agrupamentos do arquivo.
