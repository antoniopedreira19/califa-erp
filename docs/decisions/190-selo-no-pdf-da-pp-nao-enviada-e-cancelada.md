# 190 — O PDF da PP que não vale para pagamento sai com selo: a gerada, ainda não enviada pelo sistema, e a cancelada

**Data:** 2026-10-19
**Status:** aceita e implementada em 19/10/2026, com o selo aplicado
retroativamente às PPs geradas e canceladas que já existiam.
**Quem decidiu:** Tiago, em 19/10/2026 — opção B do protótipo "PP só pelo
sistema" (https://claude.ai/artifact/Dgu9mV4HYzZrHZQbrCdy5G), com o selo
retroativo e o texto "pelo sistema" que ele pediu em comentário no
protótipo. Escolheu não mexer no processo por enquanto (a opção A, "gerar
e enviar numa ação só", e a Recomendada ficam para depois).
**Revê:** nenhuma regra de processo. Gerar, deixar pronta, enviar, editar
e cancelar continuam como nas decisões 153, 157, 160, 169 e 173; muda só o
documento.
**Migration:** nenhuma.

## O problema

Enquanto o financeiro não migra todo para o sistema, a PP corre por dois
caminhos: o envio pelo ERP e o PDF mandado por e-mail ao contas a pagar —
e quem confere pelo e-mail paga pelo PDF. Em 16/10/2026 o Tiago não achou a
PP-00100 e a PP-00101 (ANI-1001/26-C1) em lugar nenhum: tinham sido geradas
em 01/10, mandadas por e-mail e canceladas em 03/10 sem nunca chegar ao
financeiro pelo sistema. O PDF que circulava era idêntico ao de uma PP
válida.

O levantamento do mesmo dia achou 71 PPs nessa situação ou parecida
(artifact "PPs para conferir",
https://claude.ai/artifact/Es7Ta436k93roMqzZDeynV): canceladas sem envio,
canceladas depois do envio e refeitas em outra PP (risco de pagar duas
vezes), geradas paradas com o vencimento passando, e PDFs refeitos depois de
gerados.

## A regra

1. **A PP gerada — ainda não enviada ao financeiro pelo sistema — sai com o
   selo "não enviada":**
   - faixa vermelha no alto de **toda** página: "NÃO ENVIADA AO FINANCEIRO
     PELO SISTEMA · NÃO PAGUE";
   - marca d'água em diagonal: "NÃO ENVIADA AO FINANCEIRO PELO SISTEMA";
   - embaixo do número da PP: "Não pague: ainda não foi enviada pelo
     sistema".
   "Pelo sistema" porque a PP mandada por e-mail também chegou ao
   financeiro; o que falta é o envio pelo ERP (Tiago, 19/10).
2. **A PP cancelada sai com o selo "cancelada"**: faixa "CANCELADA EM
   dd/mm/aaaa · NÃO PAGUE", marca d'água "CANCELADA" e "Cancelada em
   dd/mm/aaaa · não pague" embaixo do número. A data é o dia de Brasília de
   `pedidos_compra.cancelada_em`.
3. **As demais saem limpas**: em avaliação, aprovada, paga e a rejeitada
   (que já passou pelo financeiro e só sai pelo "Reemitir PP", que a
   cancela).
4. **A prévia da conferência lado a lado (decisão 178) não muda**: continua
   com a marca "PRÉVIA" e "Não vale como PP".
5. **O selo segue o status gravado**, então troca sozinho nas transições:
   - **nasce gerada** → com o selo "não enviada";
   - **editada** (173), **"Atualizar vencimento"** (157) e **troca da
     empresa emissora** (156) refazem o PDF com o selo do status;
   - **enviada ao financeiro** → o PDF é refeito **limpo**, com a mesma data
     de emissão;
   - **cancelada** → o PDF é refeito com o selo "cancelada". Vale para todo
     caminho que cancela PP: painel do item, aba Pedidos de Produção, "Ver
     PP", pedido de cancelamento do job (169), cancelar a aprovação do
     orçamento com PPs que travam (128) e "Reemitir PP" (153). Todos passam
     por `cancelarPedidoCompra` ou pelo `cancelarERefazerPP`.
6. **Se o PDF falhar depois de o status mudar, o status fica** e a falha vai
   para o log (`[pp.selo]`). No envio, o erro deixa o selo "não enviada" na
   PP que já foi — o lado seguro. No cancelamento de uma PP já enviada, o
   erro deixa o PDF limpo; nesse caso refaça o PDF pelo script do
   retroativo (abaixo).

## O retroativo

Em 19/10/2026, depois do deploy, o PDF de **toda** PP gerada ou cancelada
foi refeito pela mesma função do sistema (`refazerPdfDaPP`), com o selo do
status. Antes de sobrescrever, o PDF original foi copiado no próprio bucket
`pedidos-compra`, em `_antes-da-decisao-190/<caminho original>`. Os números
da rodada estão na nota do `HANDOFF_JOBS` de 19/10/2026.

O script não ficou no repositório: ele empacota a `actions-pp.ts` real
exportando a `refazerPdfDaPP` só para a rodada (esbuild, com stubs para
`next/headers`, `next/cache`, `server-only` e o `cache` do React) e roda com
a chave de serviço. Ensaio primeiro (PDFs só no disco), depois gravação.

## O que o selo não cobre

- **As cópias que já saíram antes.** O selo vale para o PDF baixado daqui
  em diante. O que foi mandado por e-mail antes de 19/10 continua limpo —
  é para isso que existe a lista "PPs para conferir".
- **A cópia baixada entre o envio e um cancelamento posterior** sai limpa
  (a PP estava válida quando foi baixada).
- **Quem quiser burlar** consegue recortar ou editar o PDF; o selo é aviso,
  não trava.
- **O fornecedor**: se a produção mandar ao fornecedor o PDF da PP ainda
  gerada, ele vai com "não pague". Se isso confundir, o texto muda, mas a
  regra não.
- **O pagamento em si**: o financeiro que paga pelo e-mail precisa olhar o
  selo. O sistema não sabe o que foi pago por fora.

## Implementação

- `lib/pdf/pedido-compra.ts` — `SeloDaPP`, `textosDoSelo`; o `selo` é
  obrigatório em `renderPedidoCompraPDF`. Com selo, a margem de cima abre
  espaço para a faixa no `header` (toda página), a marca d'água tem
  opacidade 0,32 e o aviso entra embaixo do número.
- `app/(app)/jobs/[jobId]/realizado/actions-pp.ts` — `SELO_NAO_ENVIADA`,
  `seloPeloStatus`, `trocarSeloDaPP`; o `selo` é obrigatório em
  `renderizarDocumentoDaPP`; `refazerPdfDaPP` lê o status e a data do
  cancelamento; `enviarPedidoCompraAoFinanceiro`, `cancelarPedidoCompra` e
  `cancelarERefazerPP` chamam `trocarSeloDaPP` depois de gravar o status.
- Textos dos pop-ups de cancelamento (painel do item, aba de PPs, "Ver PP",
  pedido de cancelamento do job, PPs que travam o cancelamento da
  aprovação) e da linha do tempo da PP: "O PDF ganha o selo de cancelada e
  fica no histórico, com os anexos."
- `scripts/rastros-codigo-anterior/2-refazer-pdfs.ts` e
  `scripts/refazer-pdf-verba-colaborador-171.ts` (já rodados) passam
  `selo: null`, que é o que geravam.

## Conferência

No TES-1001/26, logado como "GP Teste Claude", pelo fluxo da tela: a
verba PP-00263 (R$ 100,00, Fornecedor Teste) nasceu com o selo "não
enviada"; enviada ao financeiro, o PDF gravado ficou limpo; cancelada, ficou
com "CANCELADA EM 19/10/2026 · NÃO PAGUE". Os três PDFs foram baixados do
bucket e conferidos página a página. O texto novo do pop-up de cancelamento
foi conferido na aba de PPs (sem confirmar).
