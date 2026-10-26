# 209 — A PP no cartão corporativo

**Data:** 2026-10-23
**Status:** aceita e implementada em 23/10/2026.
**Quem decidiu:** Tiago, no protótipo "PP no cartão" (23/10/2026, versões 1 a
5), e "Aprovado. Pode implementar a PP no cartão corporativo como está no
protótipo." (23/10/2026).
**Migrations:** `20261023900001_pp_no_cartao_corporativo.sql`.

## O pedido

> "Precisaremos incluir uma nova opção de pagamento, além das atuais de
> cadastro do fornecedor, Chave aleatória e boleto, para adicionar uma de
> 'cartão de crédito da empresa'."

A compra que se faz num site ou numa plataforma (Mercado Livre, Amazon, o
site de uma locadora) e que o financeiro paga no cartão de crédito da
empresa. Até aqui a PP sempre pagava um fornecedor do cadastro (decisões 127
e 161) ou um titular de verba (164, 171, 187).

## As respostas do Tiago (23/10/2026)

1. **Quem passa o cartão é o financeiro.**
2. **Parcelas:** as da fatura do cartão, definidas pelo financeiro.
3. **Sem NF no envio.** Depois será preciso um jeito de o financeiro anexar
   a nota (fase futura, fora desta decisão).
4. **Não há campo fornecedor** no cartão corporativo.
5. No lugar dele, **dois campos separados**: a plataforma e o link da
   compra, **lado a lado**, chamados **"Plataforma"** e **"Link da
   compra"**.
6. O prazo de pagamento **segue as janelas** (dias 08 e 20), como as outras
   PPs.
7. Entre as duas formas do protótipo — no Pagamento ou no tipo da PP —,
   **no tipo da PP**: "não faz sentido ser como as outras, sem fornecedor".

## A regra

1. **Um quarto tipo de PP.** Em "Fornecedor & Empresa", ao lado de Normal,
   Verba e Reembolso, a bolinha **Cartão corporativo**. O Pagamento do
   fornecedor (cadastro, chave aleatória, boleto) fica como era.
2. **Sem fornecedor.** No lugar do campo Fornecedor, **Plataforma** e
   **Link da compra**, obrigatórios. O link é um endereço de site, com ou
   sem "https://" (`lib/validations/cartao-corporativo.ts`, a mesma régua na
   tela e no servidor).
3. **Parcelas:** a PP sai com uma parcela só; no lugar dos botões, "Na
   fatura do cartão, pelo financeiro". O prazo segue as janelas.
4. **Anexos opcionais e sem nota fiscal.** A nota exige fornecedor
   (`notas_fiscais_fornecedor`); a PP do cartão com anexo do tipo "Nota
   fiscal" é recusada na geração, no salvar e na edição.
5. **Envio sem nota.** O pop-up do envio não pede documentos (como a
   verba): "No cartão corporativo, a nota não é exigida no envio." O painel
   não mostra o aviso "Ainda sem a nota do fornecedor".
6. **Aprovação só no cartão de crédito.** O pop-up abre com "Cartão de
   Crédito" marcado e travado, e o tipo em Custo Operacional; o financeiro
   escolhe o cartão e o subtipo. O cartão segue sendo a intenção da decisão
   093: a parcela entra na fatura na baixa.
7. **O nome em todo lugar:** "Cartão corporativo — {plataforma}" no lugar
   do fornecedor (painel do item, aba de PPs, lista e títulos do
   financeiro, chat, exportação, pedido de cancelamento do job, orçamento).
   O dossiê mostra a plataforma e o link (abre em aba nova).
8. **PDF:** "Cartão corporativo: {plataforma}" no cabeçalho, o bloco
   "PAGAMENTO NO CARTÃO CORPORATIVO" (plataforma, link e quem paga) no
   lugar dos dados bancários, e sem o bloco e a assinatura do fornecedor.
9. **Remessa CNAB:** a PP do cartão não entra (já não entrava: o título sem
   fornecedor é descartado em `titulos-da-remessa.ts`).

## O banco

- `pedidos_compra` e `pedidos_compra_a_emitir`: `cartao_corporativo`
  (boolean, default false), `cartao_plataforma`, `cartao_link`.
- `pp_cartao_corporativo` / `chk_ppae_cartao_corporativo`: no cartão, PP
  comum, sem fornecedor, sem pagamento fora do cadastro, com plataforma
  (até 200) e link (até 2.000) preenchidos; fora dele, os dois nulos.
- `pp_cartao_corporativo_aprovada`: aprovada ou paga, a forma é cartão de
  crédito. A server action grava a intenção **antes** da RPC
  `aprovar_pp_com_data` (o desenho da marcação da 127) e a desfaz se a RPC
  falhar.
- `chk_pp_verba_coerencia` e `chk_ppae_verba`: o ramo da PP comum passa a
  aceitar "fornecedor **ou** cartão corporativo". Os ramos da verba ficaram
  iguais. A regra só afrouxou: nenhuma linha existente deixou de valer.

Conferido pelo MCP com `rollback`: o banco barra o cartão sem plataforma, o
cartão com fornecedor, a PP comum sem fornecedor, a PP comum com plataforma
e a aprovação sem a forma; e aceita o cartão completo nas duas tabelas.

## Fora desta decisão

- A NF da compra anexada depois, pelo financeiro.
- Trocar a forma na baixa: segue como a 093 (o financeiro confirma a forma
  ali).

## Conferência (23/10/2026)

No `TES-1001/26 · Job de Teste` (projeto `TES-P001/26`), pelos fluxos da
tela: PP a emitir salva, revisão, **PP-00397** gerada (R$ 150,00, "ZZ Loja
Teste"), PDF conferido, envio sem nota, dossiê com plataforma e link,
aprovação com a forma travada no cartão "ZZ Teste Empresa Teste", título em
Títulos a Pagar e a linha na aba de PPs do job.
