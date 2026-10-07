# 153 — PP a emitir: a PP é revisada antes de gerar e não se edita depois

**Data:** 2026-10-07
**Status:** entregas 1 e 2 aceitas e no ar (07/10/2026). A entrega 3 (a
conferência lado a lado na produção) está desenhada e aprovada, e vem
depois.
**Quem decidiu:** Tiago, de 06 a 07/10/2026, a partir do protótipo
interativo "Etapa antes da PP" (https://claude.ai/artifact/BkLusveQDiropTy9UBccYe,
v1 a v17, rodadas nos comentários do artifact). "Pronto o protótipo /
design interativo está completo e aprovado. Pode implementar."
**Número:** nasceu como 151 e foi renumerada para 153 antes de publicar (o
`main` já tinha o 150 e o 151). Ver a [152](152-nf-do-fornecedor-com-cadastro-proprio.md),
que nasceu junto.
**Revê:** a [039](039-pp-nasce-gerada-e-o-envio-ao-financeiro-e-uma-acao.md)
(a PP gerada se editava e a rejeitada era corrigida e reenviada), a
[056](056-pp-nasce-na-pre-abertura-e-o-envio-espera.md) (gerar PP na
pré-abertura) e a volta da reprovada da
[083](083-a-pp-aprovada-que-nao-segue-volta-para-a-producao.md).

## A ideia em uma frase

Antes de virar PP, o formulário salvo é uma **PP a emitir**: sem código, fora
do realizado, invisível ao financeiro e editável à vontade. **Gerar** dá o
código e congela a PP; para mudar uma PP gerada, só cancelando e refazendo.

O nome foi escolha do Tiago entre "PP a emitir", "Rascunho", "PP prevista",
"PP a gerar" e "Minuta". Faz par com "Em PPs emitidas".

## O fluxo

```text
PP a emitir  ->  PP gerada  ->  enviada ao financeiro
 (Salvar)        (Gerar PP)      (Enviar, no painel do item)
```

| Momento | O que acontece |
|---|---|
| Formulário | Rodapé **Cancelar · Salvar · Gerar PP**. "Salvar" guarda a PP a emitir. "Gerar PP" salva, fecha o formulário e o painel abre a **revisão**. |
| Revisão | Pop-up **Voltar · Editar · Gerar PP** com fornecedor, serviço, valor, empresa, pagamento, anexos, nota fiscal (com a parte "nesta PP", se a nota cobre outra PP) e a conta "PPs já emitidas nesse item + Esta PP = Novo total". "Depois de gerada, a PP não se edita mais." |
| PP gerada | **Não tem mais "Editar".** Ver PDF e Cancelar continuam. |
| Envio | No painel do item, em pop-up. **Todo campo é obrigatório**: o tipo de cada anexo, os quatro dados de cada NF e o número dos outros documentos. A PP acima do planejado pede a confirmação ali mesmo. |
| Pré-abertura (`aguardando_abertura` e `rejeitado_financeiro`) | **Só PP a emitir.** "Gerar PP" fica apagado com o motivo: "O financeiro ainda não abriu este job: por enquanto, só PPs a emitir. Gerar e enviar a PP voltam com a abertura." |
| PP rejeitada | Mostra o motivo e **"Cancelar e refazer"** (no painel do item e na aba Pedidos de Produção). A PP é cancelada e fica no histórico; volta como PP a emitir com os mesmos dados e anexos, marcada "Refaz a PP-…", e o formulário abre com o motivo no topo. A pergunta "Esta é a última PP deste item?" volta a ser feita. A PP nova diz "Substitui a PP-…, rejeitada e cancelada." |

## O painel do item ("Destrinchar realizado")

- Três números: **Planejado do item**, **Em PPs emitidas** e **Em PPs a
  emitir** ("fora do realizado").
- Seção **"PPs a emitir"** com o selo no lugar do código, "Gerar PP", o
  lápis (editar) e a lixeira (**Excluir**: "Some do item; nada foi gerado
  nem enviado.").

## Os anexos

- Área de arrastar e soltar, cartões brancos, **o mais novo em cima**
  (formulário, envio e conferência).
- O tipo do arquivo **nasce vazio** ("Escolha o tipo"); no formulário os
  anexos são opcionais, no envio são obrigatórios.
- No anexo do tipo NF entram os dados da nota (decisão 152).

## Quem faz o quê

- Salvar, editar, excluir e gerar a PP a emitir: quem gera PP (GP,
  produtor, freelancer e administrador — decisão 136, §7).
- Enviar e "Cancelar e refazer": quem envia PP (GP e administrador). O
  servidor confere nos dois casos.

## Banco

- `pedidos_compra_a_emitir` (os dados do formulário em `dados jsonb`,
  `ultima_pp_do_item`, `refaz_pp_id`, `pp_id`/`gerada_em`, `excluida_em`) e
  `pedidos_compra_a_emitir_anexos`. O id da PP a emitir é o que a PP terá
  ao ser gerada. RLS igual à das PPs; nenhuma tela do financeiro as mostra.
- Policy `pp_anexos_update` em `pedidos_compra_anexos` (o envio completa o
  tipo e a NF de anexo já gravado).
- Auditoria: `pedido_compra.a_emitir.salva`, `.editada`, `.excluida` e
  `.gerada`.
- Migration: `20261007300002_pp_a_emitir.sql`.

## No código

- Novos: `app/(app)/jobs/[jobId]/realizado/pp-a-emitir-ui.tsx` (revisão,
  envio, faixa da pré-abertura), `anexos-da-pp.tsx` (anexos e NF) e
  `actions-notas-da-pp.ts`.
- Saíram: `editarPedidoCompraGerada`, `reenviarPedidoCompra` e
  `pps/editar-pp-drawer.tsx`.
- Os textos que diziam "corrige e reenvia" (rejeição e reprovação no
  financeiro) e "Gerar PP já está liberado" (pré-abertura) foram trocados.

## Testado (07/10/2026, TES-1014/26)

- PP a emitir criada, salva, editada, gerada (PP-00129, PP-00130) e
  excluída.
- NF 9001 de R$ 10.000 dividida entre duas PPs (R$ 6.000 e R$ 4.000); a
  segunda veio travada pela primeira.
- PP-00130 rejeitada → "Cancelar e refazer" no painel → PP-00131 com
  "Substitui a PP-00130", enviada e aprovada sem registrar a nota de novo.
- PP-00131 reprovada → "Cancelar e refazer" pela aba Pedidos de Produção.
- Pré-abertura vista no TES-1012/26 (só a tela, nada gravado).

## Entrega 3 (por fazer)

A conferência lado a lado, igual à do Contas a Pagar (`pp-tela.tsx`): no
envio, "Ver PP e documentos lado a lado" abre o PDF da PP, o documento à
vista e a coluna "Documentos e dados"; no formulário, só o documento e os
dados ("Voltar ao formulário").

## Em aberto

1. **Encerramento do job com PP a emitir pendente.** Hoje ela não trava o
   encerramento (não é PP). Falta decidir se deve travar, ser descartada ou
   só avisar.
2. **O financeiro não vê "Substitui a PP-…"** na tela da PP nova. Só a
   produção vê.
3. **Linha cancelada por errata com PP a emitir** (decisão 151): a errata não
   olha a PP a emitir, e a linha cancelada não abre o painel. A PP a emitir
   que estiver nela fica parada — fora do realizado e do financeiro, mas sem
   como gerar nem excluir.
