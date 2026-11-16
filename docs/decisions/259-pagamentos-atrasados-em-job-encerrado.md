# 259 — Pagamentos atrasados em job encerrado ou finalizado

**Data:** 2026-11-16
**Status:** aceita e implementada em 16/11/2026.
**Quem decidiu:** Tiago, no protótipo "Pagamento atrasado em job encerrado" (versões 1 a 10), aprovado com "Tudo aprovado, pode implementar".
**Migration:** `20261116600001_pagamentos_atrasados.sql`.

## O problema

Às vezes aparece um pagamento depois que o job foi encerrado: a nota do fornecedor chegou atrasada, um custo ficou de fora. Com o job encerrado ou finalizado, a planilha trava e a produção não gera PP nem cria linha. Não havia caminho no sistema para lançar esse pagamento.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | Quem abre | O **financeiro** libera, na Planilha Interna do job fechado (visão do financeiro): "Liberar pagamentos atrasados". O pop-up pede a **competência dos novos lançamentos** (do trimestre do job ao seguinte ao de hoje; vem marcado o de hoje) e o **motivo** (obrigatório). |
| D2 | O que a produção vê | Só o selo "Pagamentos atrasados liberados · 4T/26", na barra da planilha. Sem notificação. O rodapé do encerramento diz o que está liberado. |
| D3 | PP em qualquer linha | Com a liberação aberta, a calha "Gerar PP" volta em todas as linhas, como no job aberto. No "Destrinchar realizado": selo da liberação no topo, botão "Nova PP de pagamento atrasado" (vermelho, relógio), sem "Marcar: todas as PPs geradas" e sem a confirmação de reabrir o item; o item continua completo. |
| D4 | Linha vermelha | Pelo mesmo "Editar planilha", com a barra própria "Planilha em edição". Só entra linha vermelha nova; as linhas que já existem não mudam e não há errata. |
| D5 | A marca | Toda PP gerada e toda linha vermelha criada com a liberação aberta levam a marca dela (`pagamento_atrasado_id`, posta pelo banco). A marca é sempre vermelha (#b91c1c): relógio no nome da linha, selo "Atrasado · 4T/26" no cartão da PP, relógio depois do código na aba PPs. |
| D6 | "Só realizado" | O selo "só realizado" da linha vermelha aparece só durante a edição, em toda Planilha Interna (não só no job fechado). |
| D7 | Formulário da PP | Faixa vermelha com a competência e o motivo. Sem a opção **Verba** (Reembolso e Cartão corporativo ficam). A pergunta "Esta é a última PP deste item?" some (vale sempre "sim"). Pergunta nova, obrigatória: **"Esta é a última PP atrasada deste job?"** — "Não, ainda faltam PPs" ou "Sim, concluir PPs atrasadas". |
| D8 | AR | O custo AR só recebe pagamento atrasado se o job **ainda não foi faturado**. No job faturado: o "Gerar PP" da linha AR fica travado com a explicação, a linha vermelha nova não oferece AR, o pop-up do financeiro avisa (quando o job tem AR) e o banco recusa. |
| D9 | Concluir pela produção | "Concluir pagamentos atrasados", à direita de "Editar planilha" → "Conclusão enviada ao financeiro · 4T/26" e "Cancelar conclusão". A planilha trava para a produção. A PP com "Sim, concluir PPs atrasadas" leva a conclusão junto quando vai ao financeiro. |
| D10 | Confirmar ou concluir pelo financeiro | O financeiro vê "Conclusão pedida · 4T/26" e "Confirmar conclusão". Também pode concluir sozinho, mesmo sem a produção ("Concluir pagamentos atrasados" → "Concluir e travar a planilha"). Concluída, a planilha volta a travar e o "Liberar" volta a aparecer, para uma liberação nova se precisar. |
| D11 | O que impede concluir | PP gerada sem envio ao financeiro, PP a emitir salva sem gerar, linha vermelha da liberação sem PP. A PP que já foi ao financeiro não impede. O pop-up da conclusão mostra o resumo: PPs e valor, linhas vermelhas, motivo e as pendências. |
| D12 | Contas a Pagar | Na lista de PPs, a tag "Atrasado · 4T/26" embaixo do código, no lugar das tags Verba/Reembolso/Cartão. O cartão corporativo ganhou a tag "Cartão" no mesmo lugar. A busca por coluna acha "Atrasado" e "Cartão". |
| D13 | Tela da PP | Selo "Pagamento atrasado · 4T/2026" no cabeçalho. No painel Dados, o primeiro campo passa a ser "Tipo da PP" (Verba, Reembolso ou Cartão corporativo); a PP normal não leva o campo. Vale para toda PP. |
| D14 | PDF da PP | Linha vermelha "Pagamento atrasado: competência 4T/2026" no cabeçalho do documento. |

## No banco

- **Tabela `jobs_pagamentos_atrasados`:** uma liberação por linha (job, trimestre, ano, motivo, quem liberou, quem pediu a conclusão, quem encerrou, com as datas). Uma só não encerrada por job (índice único parcial). RLS só de leitura para `authenticated` (membro do tenant; o freelancer, só nos projetos dele); escrita só pelas funções.
- **Colunas:** `pedidos_compra.pagamento_atrasado_id` e `conclui_pagamentos_atrasados`; `pedidos_compra_a_emitir.conclui_pagamentos_atrasados`; `jobs_itens_orcado.pagamento_atrasado_id`.
- **Gatilhos:** a PP e a linha vermelha do job fechado recebem a marca da liberação aberta; o banco recusa linha vermelha em job fechado sem liberação, PP de verba de produção e AR no job faturado. A PP com "concluir" leva a conclusão ao ir para "em avaliação", se não houver pendência.
- **Funções:** `liberar_pagamentos_atrasados` e `concluir_pagamentos_atrasados` (administrador e financeiro); `pedir_conclusao_dos_pagamentos_atrasados` e `cancelar_conclusao_dos_pagamentos_atrasados` (administrador, GP e produtor); `pendencias_dos_pagamentos_atrasados`; `job_ja_faturado` (envio de faturamento, nota emitida ou faturamento enviado no job).
- **Auditoria:** `pagamentos_atrasados.liberados`, `.conclusao_pedida` (pelo botão ou pela PP, com `pela_pp`), `.conclusao_cancelada`, `.concluidos` (com `confirmando_a_producao`).

## No código

- **`lib/pagamentos-atrasados.ts`:** o tipo da liberação, o `select` com os nomes (a tabela tem três FKs para `profiles`: todo embed leva o hint da coluna), textos e contas que as telas repetem. Testes em `lib/pagamentos-atrasados.test.ts`.
- **`lib/data/pagamentos-atrasados.ts`:** o que o servidor pergunta (liberação aberta, competência da PP para o PDF) e o que a Planilha Interna recebe.
- **`app/(app)/_pagamentos-atrasados/`:** as actions (liberar, pedir, cancelar, concluir, resumo da conclusão) e os componentes (selos, barra da edição, botões e pop-ups).
- **Actions da PP e da errata:** as travas do job fechado aceitam o job com a liberação aberta (gerar, editar, cancelar e enviar PP; linha vermelha). A trava do faturamento enviado não vale na linha vermelha da liberação (o AR fica com o banco).
- **Planilha Interna, painel do item, formulário da PP, aba PPs, rodapé do encerramento, Contas a Pagar e tela da PP:** como nas decisões acima.

## Para registro

- Testado no Sandbox em 16/11/2026, pelas telas: TES-1009/26 (liberação, linha vermelha, duas PPs, trava das pendências, conclusão pela PP, cancelamento, conclusão pelo botão, confirmação do financeiro) e TES-1038/26 (job faturado: linha vermelha sem AR; o financeiro concluiu sozinho; segunda liberação com a conclusão pela PP).
- As travas do banco (AR no job faturado, job fechado sem liberação, liberação já encerrada) foram conferidas numa transação desfeita.
- Não havia, no Sandbox, job fechado e faturado com linha AR: o "Gerar PP" travado da linha AR foi conferido só no código e no gatilho do banco.
