-- =====================================================================
-- Task 012 — Remove CHECK que impedia fornecedor+cliente juntos na avulsa
--
-- Nova semântica: cliente é rastreabilidade de custo (a qual cliente
-- esse gasto pertence, pra rateio), fornecedor é o destinatário do
-- pagamento. Os dois podem coexistir. Cliente é auto-preenchido quando
-- job é escolhido (herda do projeto do job) e trava.
-- =====================================================================

alter table public.contas_avulsas
  drop constraint if exists chk_avulsa_contraparte_unica;
