# 137 — Pagamento fora do cadastro: visível ao financeiro e pago pela remessa

**Data:** 2026-10-01
**Decidido por:** Tiago
**Status:** aceita — implementada em 01/10/2026
**Protótipo aprovado:** artifact "Fora do cadastro no Contas a Pagar"
(versões 1 a 4, 01/10/2026)

Revê a [127](127-pp-com-pagamento-fora-do-cadastro.md) no ponto da remessa
CNAB e usa o histórico de eventos da PP da
[136](136-qualquer-gp-age-e-o-autor-fica-registrado.md).

---

## 1. O pedido

Ao decidir a linha do tempo do "Ver PP" (136, parte 5), o Tiago tirou dela a
urgência e o pagamento fora do cadastro, mas pediu que os dois fossem
visíveis para o financeiro no Contas a Pagar. A urgência já era. O
pagamento fora do cadastro aparecia só no cartão da tela da PP (sem quem
pediu) e na aprovação. Na conferência apareceu também que a remessa
Santander recusava essa PP (127) sem que o diálogo avisasse.

## 2. As decisões do Tiago

| Pergunta | Resposta |
|---|---|
| Selo na lista de PPs, no cabeçalho da tela da PP e em Títulos a Pagar | **Não.** "Não gostei de como ficou na lista de PPs e em Títulos a Pagar." Ficam como estão. |
| "Pedido por" no cartão da tela da PP | **Sim.** |
| Cartão na baixa | **Sim.** |
| Remessa: mostrar chave e conta | **Sim, em todas as linhas**, e a conta quando o seletor está em TED. Coluna "Dados de pagamento" (o nome "Destino" foi recusado). |
| Remessa: PP fora do cadastro | **Entra no arquivo, paga pela chave ou conta da PP.** Sem o "Pedido por" e sem aviso no cartão. |

## 3. O que mudou

### 3.1 Tela da PP (Contas a Pagar)

O cartão "Fora do cadastro" ganhou a última linha **"Pedido por X · data
hora"**, do último evento `fora_do_cadastro` do histórico da PP (136, parte
3). A ficha "Ver PP" da produção não mostra essa linha.

### 3.2 Dar baixa

Na PP fora do cadastro, logo abaixo do quadro do título, o cartão **"Pagar
fora do cadastro"**: meio, chave ou conta, motivo e "Pedido por". As outras
origens não mudam. A lista de Títulos a Pagar também não.

### 3.3 Exportar remessa Santander

- **Coluna "Dados de pagamento"** em todas as linhas, acompanhando o
  seletor: no PIX, o tipo e a chave; no TED, o banco, a agência e a conta.
  Vem do cadastro do fornecedor ou do colaborador — o mesmo que o gerador
  lê. Inclui as linhas da folha, onde a chave de muitos colaboradores é o
  CPF (o Tiago aprovou sabendo disso).
- **PP fora do cadastro:** a linha pode ser marcada como as outras. A forma
  vem da PP (PIX ou TED fixo, sem o seletor) e a coluna mostra o cartão com
  o meio e a chave ou conta da PP.

### 3.4 Gerador do arquivo (revisão da 127)

Até aqui `resolverOrigem` (`actions-cnab.ts`) recusava a parcela da PP fora
do cadastro com "Pagamento fora do cadastro: pague pelo PDF". Agora ela
entra no arquivo:

- **o favorecido continua o fornecedor do cadastro** (nome e CPF/CNPJ): a
  chave ou a conta fora do cadastro é da própria empresa — "uma empresa
  pode passar uma chave Pix temporária" (127, §1);
- **só o meio da PP vale**: com outro PIX, a conta do cadastro sai dos dados
  e o arquivo paga por PIX na chave da PP; com outra conta, a chave do
  cadastro sai e o arquivo paga por TED (ou crédito em conta, no Santander)
  na conta da PP;
- **a trava continua**: sem a marcação "Aprovar pagamento fora do cadastro"
  a PP nem chega a aprovada (CHECK do banco), e o gerador confere de novo
  ("Pagamento fora do cadastro sem a aprovação do financeiro").

A troca é a função pura `aplicarForaDoCadastroNaRemessa`
(`lib/cnab/fora-do-cadastro.ts`), com teste próprio
(`npm run test:cnab-fora`).

As outras PPs seguem pagando pelo cadastro ao vivo, e não pela foto da 067
— a pendência registrada no §7 da 127 continua.

## 4. Arquivos

- `components/financeiro/pagamento-fora-do-cadastro.tsx` — o cartão aceita
  `pedido`, `rotulo` e `semMotivo`; `ROTULO_PIX` e `ROTULO_CONTA` exportados.
- `app/(app)/financeiro/contas-a-pagar/pp-dossie.tsx` — "Pedido por".
- `components/financeiro/baixa-titulo-dialog.tsx`,
  `titulos-pagar-list.tsx`, `page.tsx` — `fora_do_cadastro` no título e o
  cartão na baixa.
- `remessa-cnab-dialog.tsx`, `page.tsx` — coluna "Dados de pagamento" e a
  PP fora do cadastro com a forma da PP.
- `actions-cnab.ts`, `lib/cnab/fora-do-cadastro.ts` (+ teste) — o gerador.
- `lib/data/eventos-da-pp.ts` (`pedidoForaDoCadastro`),
  `lib/formatar-data-hora.ts` (`formatDataEHoraBr`), `lib/types.ts`
  (`PedidoForaDoCadastro`).

Sem migration na entrega. A `20261001400005` (§6) veio depois, no
cancelamento do arquivo de teste.

## 5. Como foi testado

- PP-00102 de teste (TES-1001/26, Empresa Teste, "Outro PIX" com chave
  aleatória de teste): gerada e enviada pelo "GP Teste Claude" e aprovada
  com a marcação, pelos fluxos da tela.
- Tela da PP: "Pedido por GP Teste Claude · 01/10/2026 16:14"; lista e
  cabeçalho sem mudança.
- Baixa: o cartão "Pagar fora do cadastro" com chave, motivo e "Pedido por"
  (diálogo fechado sem dar baixa).
- Remessa: a coluna nas 66 linhas, nenhuma sem dado; a troca para TED
  mostra banco, agência e conta; a PP-00102 com PIX fixo e o cartão, e pode
  ser marcada (R$ 300,00 no rodapé). Tabela cabe no diálogo a 1024 px.
  Diálogo fechado **sem gerar arquivo**.
- Gerador: `npm run test:cnab-fora` (4 testes: outro PIX, outra conta,
  favorecido do cadastro, cadastro intacto), `test:cnab` (22) e
  `test:foto-pp` (8) passando.
- **Arquivo gerado pela tela** (autorizado pelo Tiago, sem transmitir ao
  banco): `PE000029.TXT`, conta California Santander, só a PP-00102,
  pagamento em 01/10/2026. Hash igual ao de `cnab_remessas.hash_arquivo`.
  Conferido campo a campo: lote PIX (serviço 20, forma 45); segmento A com
  câmara 009, banco, agência e conta zerados, favorecido "Fornecedor Teste",
  R$ 300,00 e o "seu número" da parcela da PP-00102; segmento B com forma
  de iniciação **04 (chave aleatória)**, o CNPJ do fornecedor do cadastro em
  019–032 e, na informação 12, **a chave da PP** — não a chave e-mail do
  cadastro; trailers com 4 registros no lote, 6 no arquivo e a soma certa.
  É o primeiro arquivo com chave aleatória: o Santander ainda não a
  homologou. A remessa 29 ficou registrada como "gerado", e a parcela da
  PP-00102, como "em remessa" — até o cancelamento do §6.

## 6. Cancelamento da PE000029 e a remessa cancelada que travava (01/10/2026)

O arquivo não foi ao banco, e o Tiago autorizou cancelá-lo ("Pode
cancelar"). Migration `20261001400005_cancela_remessa_29_e_cancelada_nao_trava.sql`:

- a PE000029 passa a `cancelado`, identificada pelo hash, com observação e
  um registro `cnab.remessa_cancelada` na auditoria;
- **`_documento_em_remessa` passa a ignorar a remessa cancelada.** Ela é a
  trava de `baixar_parcela_pp` e `baixar_conta_avulsa` (só a baixa do
  valor cheio, sem retenção, interino da D15), e olhava qualquer item de
  remessa, sem ver o status. A devolução da folha já ignorava a cancelada.
- `page.tsx` do Contas a Pagar faz a mesma conta ao marcar `em_remessa`.

Conferido: a remessa 29 cancelada e com uma linha de auditoria, a função
com os mesmos grants, e a baixa da PP-00102 voltou a oferecer a baixa
parcial (diálogo fechado sem baixar).

O título de um arquivo que **foi** ao banco e teve o pagamento recusado
(registros 11 e 43 da PE000028) ainda não tem saída: a devolução segue
travada. Proposta em desenho, a aprovar.
