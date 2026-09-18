-- Remove os três cadastros de cliente que nasceram de testes meus em
-- 17 e 18/09/2026, autorizados pelo Tiago a serem apagados ("Ok. No
-- futuro criamos outros testes").
--
--   ZZTEST  ZZ Teste Cadastro Rapido   (validação do dialog, decisão 089)
--   ZZGP    ZZ Teste GP Inline         (validação do gate inline, 089 §6)
--   ZZGP2   ZZ Teste GP Inline 2       (idem, com o formulário preenchido)
--
-- Os três estavam inativos e SEM projeto, orçamento, faturamento, conta
-- avulsa, desembolso ou lançamento — conferido antes por consulta.
--
-- Por que precisa de cuidado: o banco foi desenhado para NUNCA apagar
-- cliente. A FK `cliente_produtos_cliente_id_fkey` é RESTRICT, e a marca
-- padrão é protegida por `trg_cliente_produtos_padrao`, que levanta
-- exceção em qualquer DELETE dela. As duas coisas juntas tornam o
-- cadastro indelével pelo caminho normal — e é assim que deve ser para
-- cliente de verdade.
--
-- A trigger é desligada e religada DENTRO desta transação: se qualquer
-- passo falhar, o rollback devolve a proteção. Nenhum outro cliente é
-- tocado — o DELETE é por id, e os ids estão escritos abaixo.

begin;

alter table public.cliente_produtos disable trigger trg_cliente_produtos_padrao;

delete from public.cliente_produtos
where cliente_id in (
  '7ef12038-5c7b-412a-a61e-14633ead5ff6',  -- ZZTEST
  'f64dac7e-b368-45d0-b6c8-f556a00249c6',  -- ZZGP
  '619fe8a8-dc7d-484e-afe0-e29ab4cc79b7'   -- ZZGP2
);

alter table public.cliente_produtos enable trigger trg_cliente_produtos_padrao;

delete from public.clientes
where id in (
  '7ef12038-5c7b-412a-a61e-14633ead5ff6',
  'f64dac7e-b368-45d0-b6c8-f556a00249c6',
  '619fe8a8-dc7d-484e-afe0-e29ab4cc79b7'
);

commit;
