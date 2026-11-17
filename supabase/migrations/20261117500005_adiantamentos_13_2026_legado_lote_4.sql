-- Motivo: mais 2 adiantamentos de 13º/2026 que foram lançados pela UI
-- (fluxo novo) mas, segundo o Antonio, são pagamentos antigos — feitos
-- antes do ERP entrar em vigor pra California. Devem virar "Pago" (sem
-- folha no financeiro), mesma receita das migrations 20261116900003,
-- 20261117400001 e 20261117500004.
--
-- Como fica:
-- - Deleta as 2 folhas vinculadas em 'enviada'.
-- - decimo_terceiro_adiantamentos.folha_pagamento_id (ON DELETE SET NULL)
--   vira NULL → o adiantamento aparece como "Pago" (badge cinza) na
--   lista, fora da tela de anexar NF e fora do contas-a-pagar.
--
-- WHERE restritivo (id + tipo + status + decimo_terceiro_adiantamento_id).
-- Idempotente.

delete from public.folhas_pagamento
where id in (
    '9f04fb94-41fa-418c-82bb-cb614fc55701',  -- 30/09/2026, 7500
    'e5f8a119-3f15-4212-8fa6-5114c504a31e'   -- 08/10/2026, 4500
  )
  and tipo = 'decimo_terceiro_adiantamento'
  and status in ('enviada', 'pendente_correcao', 'rascunho')
  and decimo_terceiro_adiantamento_id in (
    '2f85aeea-8c81-4d78-9edd-a038cef29505',
    '57c2b28f-1e49-4a9b-92db-1e772ff55c66'
  );
