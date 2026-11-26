-- Os três impostos de outubro/2026 que ficaram a pagar na 20261126100001 já
-- foram pagos, segundo a planilha — decisão 277 §11.
--
-- O Tiago (26/11): "esses casos já não foram movimentados na planilha? Se
-- sim, vamos lançar no banco no sistema ... sincronizar os lançamentos e
-- saldos do sistema com a planilha".
--
--   - IOF do mútuo da California, R$ 2.746,13: pago em 23/11 pelo Santander
--     da California. O extrato tem o débito ("TRIB FEDERAL", -2.746,13), já
--     conciliado com a linha da planilha.
--   - PIS (R$ 46.091,59) e COFINS (R$ 212.730,42) da California: a planilha
--     (recarregada em 26/11) traz o pagamento em 24/11 pelo Santander da
--     California. O extrato dessa conta no sistema ainda vai só até 23/11;
--     quando o de 24/11 entrar, a conciliação casa o débito com a linha.
--
-- Como as outras guias de outubro e as 24 da carga do 4T: pagos no
-- histórico (marcar_imposto_pago_no_historico, a função da tela, em nome do
-- Tiago). O DRE e o fluxo contam pela linha da planilha, sem lançamento em
-- dobro.
--
-- Aditiva no sentido do fluxo: só leva três títulos de "a pagar" a "pago",
-- com auditoria. Tudo num bloco.

do $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '3a933b18-156d-48b3-b100-a8099292b1c2', 'role', 'authenticated')::text, true);

  -- IOF do mútuo da California: 23/11
  perform public.marcar_imposto_pago_no_historico('54120e04-7db0-4c69-a751-60c6b4630f40'::uuid, '2026-11-23'::date, '18f505b2-81ad-4076-83d7-6a020b6f79ae'::uuid, null, null);
  -- PIS da California: 24/11
  perform public.marcar_imposto_pago_no_historico('a94e731e-a8fb-4109-875d-ff3276524934'::uuid, '2026-11-24'::date, '18f505b2-81ad-4076-83d7-6a020b6f79ae'::uuid, null, null);
  -- COFINS da California: 24/11
  perform public.marcar_imposto_pago_no_historico('94daecdd-1946-4ff1-b8b3-7d6aa28f4c4a'::uuid, '2026-11-24'::date, '18f505b2-81ad-4076-83d7-6a020b6f79ae'::uuid, null, null);
end;
$$;
