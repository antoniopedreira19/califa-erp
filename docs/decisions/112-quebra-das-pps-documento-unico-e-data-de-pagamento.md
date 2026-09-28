# 112 — A quebra das PPs no painel do item, um documento só por PP e a data de pagamento na aba de PPs

**Data:** 2026-09-28
**Decidido por:** Tiago, sobre protótipo navegável (versão C do painel)
**Migration:** nenhuma.

---

## 1. O problema

Quatro pedidos do Tiago, com prints do JOB-0044 · Teste 1 (projeto
TES-0002/26):

1. **O painel "Destrinchar realizado" não mostrava a quebra das PPs.** Com
   mais de uma PP no item, a planilha deixa R$ Unit., QT e D/M do
   REALIZADO em "—" (regra de 01/09/2026, migration
   `20260901180001_decomposicao_do_realizado_so_com_uma_pp.sql`): a soma
   de três compras diferentes produziria um unitário que nunca foi
   contratado. A quebra deveria estar no painel do item, e não estava:
   cada PP mostrava só o valor total.
2. **Na ficha da PP enviada, a linha do tempo ficava presa** entre o
   formulário e o rodapé, sempre à vista. Numa PP paga ela ocupa quatro
   passos, e a área do formulário que rola encolhia até o título
   "Serviço".
3. **O PDF de PP parcelada não mostrava as parcelas.** Desde 17/08/2026
   (entrega 34 do `HANDOFF_JOBS`) a emissão gerava um documento por
   parcela, cada um com o valor dele e o total. O "Ver PDF" do painel e da
   ficha abre o documento da PP, que era o da 1ª parcela: quem abria via
   só a primeira. E o financeiro aprova a PP inteira, com todas as
   parcelas seguindo juntas para Títulos a Pagar — um papel por parcela
   não corresponde a nada no fluxo.
4. **A coluna "Prazo" da aba "Pedidos de Produção"** (os dias entre a
   emissão e o vencimento) não respondia à pergunta de quem abre a aba:
   quando o fornecedor recebe.

## 2. A regra

### 2.1 Painel "Destrinchar realizado" (versão C)

- **Cada PP em duas linhas.** Em cima: código, fornecedor e a situação
  (Em avaliação, Aprovada, Pago, Rejeitado ou a situação da verba). Na PP
  ainda no job, o lugar da situação é do botão **Enviar ao financeiro** —
  a situação já está no título do bloco "Aguardando envio". Embaixo:
  **R$ Unit., QT, D/M e Total** da PP, com os botões na mesma linha.
- **Colunas de largura fixa**, para os valores de uma PP ficarem embaixo
  dos da outra quando o item tem muitas PPs.
- **Terceira linha só quando há aviso:** a NF que falta para enviar, ou
  "Preste contas na aba de PPs" na verba.
- **Fundo branco, sem a cor do bloco REALIZADO.** Pedido do Tiago: a cor
  de bloco é da planilha, não do painel.
- **Os dois cartões do topo ganharam a linha de baixo:** a conta do
  planejado ("R$ 8.000,00 × 1 × 1") e quantas PPs o item tem.
- **O painel foi de 430 para 500 px**, para o trio e os três botões
  caberem na mesma linha.
- Descartadas no protótipo: a versão A (três linhas por PP, com uma tira
  do trio) e a B (tabela de 860 px com as cores da planilha).

### 2.2 Ficha da PP enviada

A linha do tempo passa a ser **a última seção do formulário**, depois dos
anexos, e rola com ele. O conteúdo dela não muda. Era o que a nota de
09/09/2026 da decisão [039](039-pp-nasce-gerada-e-o-envio-ao-financeiro-e-uma-acao.md)
descrevia ("com a linha do tempo no fim"); o código a tinha deixado fixa
acima do rodapé.

### 2.3 PDF da PP: um documento só

- **Uma PP, um documento**, com todas as parcelas. O nome é o histórico da
  PP de parcela única (`pp-PP-00092.pdf`), que agora vale também para a
  parcelada.
- **PP parcelada:** o quadro do serviço troca "Prazo de Pagto" e
  "Parcela: N/T" por **"Parcelas: N"**; entra a tabela **PARCELAS DO
  PEDIDO** (parcela, prazo de pagamento e valor, nenhuma em destaque) e,
  embaixo, **"Valor total do pedido"** na faixa cinza.
- **PP de parcela única:** sai como antes — Prazo de Pagto, "Parcela:
  1/1" e "Valor".
- **Toda parcela aponta para o documento da PP** (`pedidos_compra_parcelas.pdf_path`
  = `pedidos_compra.pdf_path`). O financeiro já abria o documento da PP
  (`pedidos_compra.pdf_path`), então lá nada muda.
- **PPs de 17/08 a 28/09 (resposta D4):** os documentos por parcela que
  já foram emitidos ficam como estão — o fornecedor já os recebeu. O
  documento único os substitui só quando a PP é **editada** (gerada) ou
  **reenviada** (rejeitada); nesses dois momentos os arquivos por parcela
  saem do bucket, como já acontecia com o documento que sobrava quando o
  número de parcelas mudava. Até lá, cada linha de parcela na aba de PPs
  continua abrindo o seu documento (`signedUrlPdfParcela`).

### 2.4 Aba "Pedidos de Produção": Dt. Pagamento

A coluna **"Prazo" sai e entra "Dt. Pagamento"**, uma linha por parcela,
como a tabela já era:

| Parcela | Mostra |
|---|---|
| Paga | a data em que foi paga (`pedidos_compra_parcelas.pago_em`), com "paga" embaixo |
| PP aprovada, parcela ainda não paga | a data que o financeiro programou (`data_pagamento`), com "programada" embaixo |
| Gerada, em avaliação, rejeitada ou cancelada | "—" |

- **Repactuação (resposta D5):** a data programada é a de hoje. Se o
  financeiro mudou a data pelo lápis de Títulos a Pagar, a coluna mostra a
  nova, que é a que vai ser paga.
- **Só PP aprovada ou paga mostra data programada.** A PP aprovada que o
  financeiro reprovou depois pode guardar a data da aprovação desfeita, e
  ela não vai ser paga nessa data.
- A linha sem parcela (PP anterior ao parcelamento) lê os campos da
  própria PP (`pago_em`, `prazo_pagamento_financeiro`).
- A coluna tem a largura do Vencimento (8,5%); Origem e Serviço cederam 1
  ponto cada, e Status meio.

## 3. Onde está no código

- `app/(app)/jobs/[jobId]/realizado/painel-pps-item.tsx` — `CartaoPP` e
  `ValorDoTrio`; `PPDoItem` ganhou `valorUnitario`, `quantidade` e
  `diasMeses` **obrigatórios** (campo opcional num tipo de linha montado
  por `.map` some em silêncio); props da conta do planejado.
- `app/(app)/jobs/[jobId]/realizado/job-item-realizado-table.tsx` — passa
  o trio de cada PP e o do planejado, que a planilha já tinha. Nenhuma
  consulta nova.
- `app/(app)/jobs/[jobId]/pps/ver-pp-drawer.tsx` — linha do tempo dentro
  da área que rola.
- `lib/pdf/pedido-compra.ts` — `parcelas` no lugar de `parcela`; tabela
  PARCELAS DO PEDIDO e valor total em destaque.
- `app/(app)/jobs/[jobId]/realizado/actions-pp.ts` —
  `renderizarDocumentoDaPP` e `caminhoPdfDaPP` no lugar das versões por
  parcela; emissão, edição da gerada e reenvio sobem um documento só e
  gravam o mesmo caminho em todas as parcelas numa atualização só; edição
  e reenvio apagam os documentos por parcela que sobraram.
- `app/(app)/jobs/[jobId]/pps/job-pps-section.tsx` — `DtPagamento` no
  lugar de `prazoEmDias`. As parcelas já chegavam com `data_pagamento` e
  `pago_em` (`carregar-detalhe.ts`): nenhuma consulta nova.

## 4. Verificação

28/09/2026, no dev server do checkout principal, logado como
administrador:

- **Painel:** JOB-0044 · Item 3 · Agrupamento 1 (PP-00088 gerada sem NF +
  PP-00087 em avaliação): 500 px, as colunas das duas PPs alinhadas, a
  conta do planejado e "2 PPs" nos cartões, o aviso de NF na terceira
  linha. "Ver formulário" abre a ficha.
- **Ficha:** PP-00087 com a linha do tempo no fim do formulário, dentro
  da área que rola (887 px de altura em 1838 × 1040, sem a faixa fixa
  que antes tirava dela a altura da linha do tempo).
- **PDF, emissão real:** PP-00092 gerada no JOB-0040 (TES-0001/26) com
  duas parcelas (R$ 2.500,00 + R$ 1.500,00): um arquivo só no bucket, as
  duas parcelas apontando para ele, e o documento com a tabela e o valor
  total de R$ 4.000,00. **Edição da gerada:** passada a três parcelas, o
  mesmo arquivo foi regravado com as três. A PP-00092 foi cancelada pela
  tela no fim.
- **PP antiga:** as duas linhas da PP-00091 (JOB-0044) continuam abrindo
  `pp-PP-00091-parcela-1de2.pdf` e `…-2de2.pdf`.
- **Dt. Pagamento:** PP-00083 mostra "24/09/2026 · paga"; a PP-00040
  (JOB-0031, aprovada, uma parcela paga) mostra "08/09/2026 · paga" e
  "08/10/2026 · programada".
- **Não exercitado ao vivo:** o reenvio de PP rejeitada. Ele segue o
  mesmo desenho da edição (um documento, o mesmo caminho em todas as
  parcelas, os documentos por parcela antigos apagados) e foi conferido
  só pelo código.

`tsc --noEmit`, `next lint` e `next build` limpos; console e log do
servidor sem erros.
