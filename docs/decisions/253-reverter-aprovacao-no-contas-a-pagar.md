# 253 — Reverter a aprovação no Contas a Pagar: PP, desembolso e folha

**Data:** 2026-11-11
**Status:** aceita e implementada em 11/11/2026.
**Quem decidiu:** Tiago, em 10/11/2026 (as regras), e em 11/11/2026, escolhendo no protótipo do módulo financeiro o lugar do botão (opção E): "Opção E. Pode implementar."
**Revê:** a [083](083-a-pp-aprovada-que-nao-segue-volta-para-a-producao.md) no "Reprovar PP" da PP aprovada, que vira uma das duas saídas do "Reverter aprovação"; e a [132](132-folha-paga-pela-remessa-com-o-liquido.md) no "Devolver para a aprovação" da folha, que passa a ter as duas saídas também.
**Migration:** `20261111500001`.

## O problema

O financeiro aprovava uma PP, um desembolso ou uma linha da folha e não tinha um caminho único de volta. A PP aprovada só podia ser **reprovada** (voltar rejeitada para a produção), o desembolso só podia ser **cancelado** e a folha só voltava para "Aguardando aprovação", pelo ⓘ do título. Não havia como devolver a PP ou o desembolso para "Em avaliação" para corrigir a aprovação (a data, a forma de pagamento, o centro de custo) sem envolver quem enviou.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | O que se reverte | PP, desembolso e linha da folha aprovados, **antes da baixa**: título pago ou com baixa parcial não se reverte (primeiro se cancela a baixa, como hoje). A remessa **não trava** a PP e o desembolso: hoje não há registro de remessa gerada e descartada por erro |
| D2 | Para onde volta | Escolhido na hora, no pop-up: **Voltar para avaliação** (aprovar de novo ou rejeitar) ou **Rejeitar** (volta para quem enviou, com o motivo). Motivo obrigatório (mínimo 10 caracteres) nas duas |
| D3 | Quem | Administrador e financeiro, conferidos no banco. Na folha, a permissão de aprovar a folha (`rh.folhas.aprovar_financeiro`), como já era |
| D4 | Comitê | A PP rejeitada segue a regra de hoje: o reenvio só volta ao Comitê se piorar além do que o Comitê já aprovou |
| D5 | Onde fica | Em **Títulos a Pagar**, o ↺ logo abaixo do lápis da data, na altura do "venceu há…" (opção E do protótipo), só nas linhas que podem ser revertidas; também no ⓘ da linha. Na **tela da PP aprovada**, o botão "Reverter aprovação" no rodapé, no lugar do "Reprovar PP". Em **Pedidos de Desembolsos**, "Reverter aprovação" ao lado de "Cancelar" no desembolso aprovado |

## Como fica

- **PP, "Voltar para avaliação":** a PP volta para `em_avaliacao`; as datas de pagamento das parcelas, a fatura do cartão (aberta), a forma de pagamento, o cartão, o tipo e o subtipo, o prazo, a foto dos anexos e a marcação "aprovar pagamento fora do cadastro" são desfeitos, para a próxima aprovação escolher de novo. O histórico da PP ganha "Aprovação desfeita" com o motivo.
- **PP, "Rejeitar":** é a reprovação de PP aprovada que já existia (`reprovar_pp_aprovada`): a PP volta para a produção como rejeitada ("Reprovada depois de aprovada" no histórico), que cancela ou refaz.
- **Desembolso:** volta para `em_avaliacao` ou fica `rejeitada` com o motivo; as datas de pagamento das parcelas e a forma de pagamento são desfeitas.
- **Folha:** o título sai de Títulos a Pagar (como no "Devolver" de antes); "Voltar para avaliação" deixa a linha em "Aguardando aprovação" e "Rejeitar" a devolve ao RH como pendente de correção, com o motivo. A folha mantém a trava da remessa que já tinha: ali a reversão apaga o título, e o item da remessa ficaria apontando para nada.
- **Auditoria:** `pedido_compra.aprovacao_revertida`, `desembolso.aprovacao_revertida` e `folha.linha.aprovacao_desfeita`, com o destino e o motivo.

## No código

- Banco: `reverter_aprovacao_pp(p_pp_id, p_destino, p_motivo)` e `reverter_aprovacao_desembolso(p_desembolso_id, p_destino, p_motivo)`, `security definer`, EXECUTE só para `authenticated`.
- Action única: `reverterAprovacao` em `app/(app)/financeiro/contas-a-pagar/actions-reverter.ts`; a folha passa por `devolverFolhaParaAprovacao`, que ganhou o `destino`. Pop-up: `reverter-aprovacao-dialog.tsx`.
- `PlanilhaDeTitulos` ganhou `sobOLapis`, o ícone embaixo do lápis da data.
- A action `reprovarPPAprovada` saiu (a RPC fica, chamada pela nova).

## Fora desta decisão

- O ↺ só está em Contas a Pagar. A aba Títulos da Conciliação e a tela da conta avulsa continuam com o "Devolver para a aprovação" da folha.
- Risco aceito (D1): a PP ou o desembolso revertido com o título num arquivo de remessa já gerado. Se o arquivo for ao banco, o retorno encontra a parcela de um pedido que não está mais aprovado.
