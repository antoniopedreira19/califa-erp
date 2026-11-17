-- Motivo: 3 adiantamentos de 13º/2026 foram lançados pela UI (fluxo novo)
-- mas, segundo o Antonio, são pagamentos antigos/legados — feitos antes
-- do ERP entrar em vigor pra California. Devem virar "Pago" (sem folha
-- no financeiro), mesma receita das migrations 20261116900003 e
-- 20261117400001.
--
-- Como fica:
-- - Deleta as 3 folhas vinculadas em 'enviada'.
-- - decimo_terceiro_adiantamentos.folha_pagamento_id (ON DELETE SET NULL)
--   vira NULL → o adiantamento aparece como "Pago" (badge cinza) na
--   lista, fora da tela de anexar NF e fora do contas-a-pagar.
--
-- WHERE restritivo (id + tipo + status + decimo_terceiro_adiantamento_id):
-- se qualquer dessas folhas já tiver avançado no fluxo (aprovada/paga)
-- ou pertencer a outro adiantamento, o DELETE vira no-op. Idempotente.

delete from public.folhas_pagamento
where id in (
    'e70ea989-1aa9-4309-9009-b0a2b6ae29d4',  -- 04/11/2026, 1250
    '3af19e79-fb22-42a3-96c9-d6b5af000ecf',  -- 04/11/2026, 2000
    '6b40c060-2ee0-40c7-9647-a261c03ddea4'   -- 17/06/2026, 1250
  )
  and tipo = 'decimo_terceiro_adiantamento'
  and status in ('enviada', 'pendente_correcao', 'rascunho')
  and decimo_terceiro_adiantamento_id in (
    'b63fa010-1875-4a8e-9b01-d8fd410cea39',
    '3ef35853-02ab-4613-b516-c6f8e8cb28d3',
    '2e9620b1-1eb2-4f88-a411-1dcc3eba2386'
  );
