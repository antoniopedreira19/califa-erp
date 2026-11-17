-- Motivo: mais 1 adiantamento de 13º/2026 que foi lançado pela UI
-- (fluxo novo) mas é pagamento antigo — feito antes do ERP entrar em
-- vigor pra California. Deve virar "Pago" (sem folha no financeiro),
-- mesma receita das migrations 20261116900003, 20261117400001,
-- 20261117500004 e 20261117500005.
--
-- Como fica:
-- - Deleta a folha vinculada em 'enviada'.
-- - decimo_terceiro_adiantamentos.folha_pagamento_id (ON DELETE SET NULL)
--   vira NULL → o adiantamento aparece como "Pago" (badge cinza) na
--   lista, fora da tela de anexar NF e fora do contas-a-pagar.
--
-- WHERE restritivo (id + tipo + status + decimo_terceiro_adiantamento_id).
-- Idempotente.

delete from public.folhas_pagamento
where id = '94461ca7-8ddf-4289-88cb-48761fdaa297'  -- 09/11/2026, 4250
  and tipo = 'decimo_terceiro_adiantamento'
  and status in ('enviada', 'pendente_correcao', 'rascunho')
  and decimo_terceiro_adiantamento_id = 'c18abec8-0c64-4ed8-aff1-399141aff34c';
