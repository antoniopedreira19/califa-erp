# 236 — O custo pago pelo sócio no realizado do job (Ventura e Robotech)

**Data:** 2026-11-03
**Status:** aceita e implementada em 03/11/2026.
**Quem decidiu:** Tiago, em 03/11/2026. Ele aprovou o protótipo ("Aprovado. Pode implementar") depois de pedir dois ajustes nele: manter a pílula e os ícones da PP como estão, e trocar o pop-up de registro por um drawer igual ao da PP, com o resumo do item no topo.
**Migration:** `20261103900001` (aditiva).

## O problema

A Ventura é uma joint venture. Parte dos itens dos jobs dela a California paga, e parte a Robotech paga. Até aqui o realizado de cada item era só a soma das PPs. O custo que a Robotech pagou não tinha onde entrar: a linha ficava sem realizado e a rentabilidade do job aparecia inflada.

Gerar PP para o custo da Robotech não serve, porque a PP vai ao financeiro e vira título a pagar da California.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | O que é | O custo pago pelo sócio é um segundo jeito de destrinchar o realizado do item, ao lado da PP. Não tem código, não gera título e não passa pelo financeiro |
| D2 | Onde vale | Nos jobs de empresa gerencial marcada com sócio. A marcação fica na tabela `empresas_socio_de_custos` (empresa → nome do sócio), e não no código. Hoje só a Ventura está marcada, com a Robotech. Não há tela para a marcação: ela muda por migration |
| D3 | Realizado | Entra no realizado do item (`recalcular_realizado_do_item` soma PPs e custos do sócio). Por isso entra também no Resultado Op., na rentabilidade e em tudo que lê `total_realizado` |
| D4 | Quebra da linha | R$ Unit. × QT × D/M continua só com UM lançamento no item, agora contando PP e custo do sócio juntos |
| D5 | Campos | Descrição, quem o sócio pagou (texto livre, opcional), R$ Unit. × QT × D/M, data do gasto, comprovante (opcional) e observação (opcional) |
| D6 | Acima do orçado | Só fica vermelho, como a PP no formulário. Não vai ao Comitê. Mas pesa no realizado, então a PP seguinte do item já compara com ele |
| D7 | Quem lança | Quem gera PP (`jobs.emitir_pp`), com o job aberto (`aberto` ou `em_producao`). O custo do sócio não tem "a emitir": na pré-abertura ele não entra |
| D8 | Tela | O painel "Destrinchar realizado" tem a faixa "Pago pela Robotech", a lista "Pagos pela Robotech" (ver comprovante, editar, excluir) e, no rodapé, dois botões: "Nova PP para este item" e "Registrar custo Robotech" (opção A do protótipo). O registro abre num drawer do mesmo tamanho do "Novo Pedido de Produção", com o mesmo resumo do item no topo |
| D9 | Planilha | A pílula da calha fica como sempre ("Gerar PP" / "PPs · N", só PPs na conta, mesmos ícones). Os custos do sócio aparecem no tooltip e nas sublinhas ("Robotech · Pago pela Robotech — descrição") |
| D10 | Errata | A linha com custo do sócio não se cancela: o custo precisa ser excluído antes, como a PP |

## Como funciona

- `jobs_custos_do_socio` guarda o custo, ligado a `jobs_itens_realizado`. O `valor` é calculado pelo banco.
- O gatilho `custo_do_socio_confere` repete as travas da action: a linha é do job, a empresa do job tem sócio, e o job está aberto. Ele também grava o nome do sócio e não deixa o custo trocar de job ou de linha.
- O comprovante sobe para o bucket `pedidos-compra`, na pasta `<tenant>/custos-do-socio/<job>/`. Ele sai do bucket quando o custo é excluído ou o arquivo é trocado.
- Auditoria: `custo_do_socio.registrado`, `custo_do_socio.editado` e `custo_do_socio.excluido`.
- Na tela, a página do job monta o `CustosDoSocioProvider` (`realizado/custo-do-socio.tsx`), e a planilha, a calha e o painel leem dele. O job do financeiro mostra as sublinhas só para leitura.

## Fica de fora

- A aba de Pedidos de Produção, o módulo financeiro e a exportação da planilha interna não mostram o custo do sócio, porque ele não é PP. O total realizado deles já o inclui.
- A visão agregada do projeto mostra o realizado com o custo do sócio, mas sem as sublinhas dele.
- A tela de cadastro da marcação da empresa.

## Conferido em 03/11/2026

No TES-1001/26 (P-0006/26), entrando como GP Teste e com a Empresa Teste marcada por alguns minutos com um sócio de teste (a marcação foi retirada no fim):

- Registrar, com o comprovante: o realizado do item foi a R$ 8.000 (4.000 × 2 × 1), o arquivo ficou na pasta do job e a auditoria foi gravada.
- Editar: o realizado foi a R$ 4.000.
- Excluir: o realizado voltou a zero e o arquivo saiu do bucket.
- O drawer volta ao painel por Cancelar e por Esc. A validação da descrição funciona.
- A pílula continua "Gerar PP", o tooltip conta o custo do sócio, a sublinha aparece e a nota abaixo da planilha cita o sócio.
- Sem a marcação, o painel fica exatamente como era.
- O gatilho recusa custo em job de empresa sem sócio.

O job real da Ventura (CAL-1001/26) não foi aberto, porque o GP Teste não tem acesso à empresa Ventura.
