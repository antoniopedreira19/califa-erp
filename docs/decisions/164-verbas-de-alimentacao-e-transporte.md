# 164 — Verba de Alimentação e Verba de Transporte, com titular do RH, freela ou terceiro

**Data:** 2026-10-09
**Status:** aceita e implementada (09/10/2026).
**Quem decidiu:** Tiago, em 09/10/2026, sobre o protótipo "Verbas de Alimentação e de Transporte" (3 rodadas).
**Completa:** a [081](081-a-producao-presta-contas-da-verba-e-o-financeiro-aprova.md) (a prestação de contas e o estorno valem igual para os três tipos) e a [136](136-qualquer-gp-age-e-o-autor-fica-registrado.md) (quem presta contas).
**Migrations:** `20261009400001_verbas_alimentacao_e_transporte.sql` e `20261009400002_freelas_nome_social_na_busca.sql`. A carga dos freelas foi aplicada pelo MCP e não está no repositório (tem CPF, e o repositório é público).

## O que aconteceu

A produção adianta dinheiro para alimentação e transporte de quem está no
job, e isso não cabia na verba de produção: ela é paga a um GP ou produtor
com acesso ao sistema, e quem come ou se desloca é, quase sempre, um
colaborador do RH ou um freela. O Tiago pediu dois tipos novos de PP que
funcionem como a verba de produção, com o titular escolhido entre os
colaboradores do RH, os freelas (pela planilha que ele mandou, até o RH ter
os freelas) ou, fora do padrão, um terceiro com cadastro de fornecedor.

Números de 09/10/2026: 211 colaboradores ativos no RH, dos quais 1 tem
acesso ao sistema; 218 freelas na planilha, 69 trabalhando, 14 já no RH
(nenhum dos 14 trabalhando). A planilha não tem conta nem PIX.

## A regra

1. **O switch da PP passa a se chamar "Verba".** Ligado, ao lado, escolhe
   Produção, Alimentação ou Transporte; ligar cai em Produção, como antes.
   A verba de produção não muda: responsável é um usuário (GP ou produtor).
2. **Titular da verba** (alimentação e transporte): uma lista só, com os
   colaboradores ativos do RH e os freelas trabalhando, agrupados ("Colaboradores
   (RH)" e "Freelas"), com função e contratação ou cidade embaixo do nome.
   A busca olha o nome, a função e o nome social do freela. Quem está nos
   dois aparece uma vez, como colaborador. O campo se chama "Titular da
   verba" (o desenho aprovado) — "Responsável" segue só na produção.
3. **Terceiro (fornecedor)**: uma caixa no canto do rótulo, desmarcada por
   padrão. Marcada, o campo vira o Fornecedor de sempre (busca, "+" e
   lápis) e **mantém o pagamento do fornecedor** (cadastro, chave
   aleatória ou boleto, decisão 161). A verba do terceiro é paga como uma PP
   de fornecedor — pode ir na remessa —, e a prestação e o estorno são os da
   verba.
4. **Sem pagamento para a pessoa.** O formulário e a PP não registram meio
   de pagamento do colaborador ou do freela: o financeiro decide na
   aprovação ("Como vai ser pago"), na maioria das vezes no cartão da
   empresa, o resto caso a caso — como já era a verba de produção.
5. **Prestação de contas igual à verba de produção** (081): sem anexo na
   geração, notas na prestação, saldo vira estorno. Na alimentação e no
   transporte, **presta contas o administrador, o GP, o produtor ou o freela
   do job** (o freelancer que vê o job é do projeto), porque o titular pode
   não ter acesso ao sistema. A verba de produção segue com o responsável,
   qualquer GP ou o administrador. A função `enviar_prestacao_verba` confere.
6. **O nome do titular fica na PP** (`verba_titular_nome`), conferido no
   servidor contra a mesma lista do formulário: a ficha do RH só abre para
   administrador e RH, e a PP é lida por todo o job e pelo financeiro. É
   esse nome que as telas, o PDF, o chat de PPs e a planilha interna
   mostram.
7. **As telas dizem o tipo**: "Verba de Alimentação — Fulano" nas listas do
   financeiro e no chat; "Verba de alimentação · Fulano" na aba de PPs; a
   linha "Verba" na revisão da PP a emitir; "Verba" e o tipo na ficha "Ver
   PP"; "Titular da verba" no lugar de "Responsável" na ficha, no dossiê do
   financeiro, na prestação e na aprovação da prestação. Os textos do
   encerramento passaram a dizer "verba" (valem para os três tipos). Em
   Títulos a Pagar, a parcela da verba paga a uma pessoa mostra "Verba —
   Fulano", como o estorno já mostrava, em vez de "—".
8. **O PDF**: a verba paga a uma pessoa sai no desenho da verba, com
   "Titular da verba", a natureza "Verba de Alimentação — adiantamento sob
   responsabilidade de quem está nomeado acima, com prestação de contas ao
   final" e "Assinatura do Titular da Verba". A verba do terceiro sai no
   desenho do fornecedor (com os dados bancários) e ganha a linha
   "Natureza". A verba de produção sai igual.

## No banco

- `pedidos_compra` e `pedidos_compra_a_emitir`: `tipo_verba` (producao |
  alimentacao | transporte), `verba_titular_tipo` (colaborador | freela |
  fornecedor), `verba_colaborador_id` (FK para o RH, ON DELETE SET NULL),
  `verba_freela_id`, `verba_titular_nome`. As verbas que já existiam
  receberam `tipo_verba = 'producao'` (10 PPs e 3 PPs a emitir).
- As CHECKs de coerência aceitam os tipos novos; a regra da produção é a
  mesma de antes, e vale com `tipo_verba` nulo para a versão do app que
  estava no ar até o deploy.
- O pagamento fora do cadastro vale para toda PP com fornecedor (antes:
  toda PP que não fosse verba).
- `freelas`: a lista provisória (nome, nome social, função, cidade, CPF só
  para não repetir quem está no RH). Leem administrador, financeiro e RH; a
  produção vê pela função `pessoas_para_verba`, que devolve só nome,
  função, contratação ou cidade e o nome social (para a busca), e só para
  quem gera PP. Carga de 09/10/2026: 69 freelas (68 com CPF), nenhum
  repetido com o RH.

## Fora daqui

- **Quando o RH tiver freelas** (frente do Antonio), a lista passa a vir de
  lá e a tabela `freelas` sai. Até lá, freela novo entra por carga (sem
  tela de cadastro).
- **Nome social**: a lista mostra o nome completo, como o RH; o nome social
  da planilha (muitas vezes um apelido) só entra na busca. O Tiago decidiu
  em 09/10/2026 manter o nome completo por enquanto; o caso volta quando o
  RH tiver os freelas.
- Plano de contas próprio para alimentação e transporte: o centro de custo
  segue o de toda PP (escolhido pelo financeiro na aprovação).
