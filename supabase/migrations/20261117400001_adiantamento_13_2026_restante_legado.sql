-- One-off: marca como "legado" um adiantamento de 13º/2026 que escapou
-- da limpeza em 20261116900003_adiantamentos_13_2026_legado.sql.
--
-- Contexto: aquela migration rodou em 16/11/2026 e limpou 17 das 18 folhas
-- de adiantamento lançadas naquele dia. A 18ª foi criada 20:04 UTC do MESMO
-- DIA, DEPOIS da migration — então passou pelo filtro e ficou com folha
-- vinculada em status 'enviada'. Resultado: a view
-- vw_nf_pendentes_colaborador devolvia essa linha no /perfil, com botão
-- "Anexar NF" para algo que o Califa não vai pagar (adiantamento feito
-- antes do sistema entrar em vigor pra Agência California).
--
-- Solução: mesma receita da migration anterior. Deleta a folha vinculada;
-- decimo_terceiro_adiantamentos.folha_pagamento_id (ON DELETE SET NULL)
-- vira null, adiantamento fica como "Pré-fluxo (legado)" (badge cinza na
-- lista de adiantamentos, fora da tela de anexar NF do colaborador, fora
-- do financeiro).
--
-- Segurança: WHERE combina id + ano do adiantamento + tipo + status, pra
-- não deletar nada que tenha avançado no fluxo (aprovada/paga) nem outra
-- folha por engano. Se por algum motivo a folha já não existir nesse
-- estado, o delete vira no-op.

delete from public.folhas_pagamento
where id = '85ebeb54-f5b8-4d4a-bb1c-6734a636f14d'
  and tipo = 'decimo_terceiro_adiantamento'
  and status in ('enviada', 'pendente_correcao', 'rascunho')
  and decimo_terceiro_adiantamento_id in (
    select id from public.decimo_terceiro_adiantamentos where ano = 2026
  );
