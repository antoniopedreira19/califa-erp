-- Impostos de OUTUBRO/2026 pela planilha (Fin 10, 25/11) — decisão 277 §11.
--
-- O Tiago (25/11): "precisamos registrar os custos tributários de outubro
-- manualmente, lançando 'na mão' para que no futuro possamos fazer as coisas
-- certas e pelo sistema ... agora só precisamos deixar o sistema consistente
-- com a planilha e com a realidade da operação". De novembro em diante vale
-- a divisão automática "TDs (REC)" (277 §10); as 18 guias da carga do 4T
-- não se regravam.
--
-- Cada aprovação chama a MESMA função da tela (aprovar_guia_fiscal), em nome
-- do Tiago, com o pedido montado pelo código do sistema
-- (.claude/prototipos/fiscal/outubro-pela-planilha.mts, fora do git): o valor
-- da planilha, a divisão da planilha (valor por gerencial; dentro dela, as
-- regionais pela receita) e o motivo. A marca "TDs (REC)" que o gatilho põe
-- sai, porque a divisão é a da planilha. As guias pagas com extrato ficam
-- pagas no histórico, como as 24 da carga: o DRE e o fluxo contam pela linha
-- da planilha.
--
--   ISS Salvador · diferença     diferenca  calc   130576.10 guia        0.00 · 0 título(s) · 
--   ISS GoCrazy                  a_aprovar  calc    12984.63 guia    19277.90 · 1 título(s) · pago 2026-11-23 · Agência California/SS 19277.90
--   PIS California               a_aprovar  calc    23339.92 guia    46091.59 · 1 título(s) · Agência California/NO 18693.21 · Agência California/SP 10017.48 · Agência California/RJ 5526.69 · Agência California/NE 825.53 · CCH/Agency 6160.77 · CCH/Doca 4543.91 · Hitlab/Hitlab 214.00 · Ventura/Ventura 110.00
--   PIS cumulativo California    a_aprovar  calc    33029.26 guia        0.00 · 0 título(s) · 
--   COFINS California            a_aprovar  calc   107497.44 guia   212730.42 · 1 título(s) · Agência California/NO 86281.58 · Agência California/SP 46237.32 · Agência California/RJ 25509.37 · Agência California/NE 3810.28 · CCH/Agency 28429.53 · CCH/Doca 20968.34 · Hitlab/Hitlab 988.00 · Ventura/Ventura 506.00
--   COFINS cumulativa California a_aprovar  calc   152442.65 guia        0.00 · 0 título(s) · 
--   pis GoCrazy                  a_aprovar  calc     5940.65 guia        0.00 · 0 título(s) · 
--   pis_cum GoCrazy              a_aprovar  calc      553.79 guia        0.00 · 0 título(s) · 
--   cofins GoCrazy               a_aprovar  calc    27363.03 guia        0.00 · 0 título(s) · 
--   cofins_cum GoCrazy           a_aprovar  calc     2555.99 guia        0.00 · 0 título(s) · 
--   IOF California               a_aprovar  calc     2542.00 guia     2746.13 · 1 título(s) · Agência California/SS 2746.13
--   IOF GoCrazy                  a_aprovar  calc     3813.00 guia     4766.77 · 1 título(s) · pago 2026-11-23 · Agência California/SS 4766.77
--   IRRF GoCrazy (contabilidade)   guia 20318.94 · pago 2026-11-19 · SS 1527.31 · NO 492.89 · Doca 18298.74
--
-- Aditiva: só cria aprovações e títulos; nada existente muda. Tudo num bloco:
-- qualquer erro desfaz o conjunto.

do $$
declare
  v_aprov   uuid;
  v_imposto uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '3a933b18-156d-48b3-b100-a8099292b1c2', 'role', 'authenticated')::text, true);

  -- ISS Salvador · diferença: 0.00
  v_aprov := public.aprovar_guia_fiscal(
    p_tenant_id => 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid, p_chave => 'iss|ebfdae66-8644-4f9f-9079-fcf92ca18102|2026-10', p_tributo => 'ISS',
    p_empresa_contabil_id => '4eae2860-b7c7-4c20-b3f9-6482cf3a7bf7'::uuid, p_estabelecimento_id => 'ebfdae66-8644-4f9f-9079-fcf92ca18102'::uuid,
    p_competencia => '2026-10', p_periodo => 'mensal', p_rotulo_competencia => 'outubro/2026',
    p_titulo => 'ISS próprio', p_codigo_receita => null,
    p_valor_calculado => 130576.1, p_valor_guia => 0, p_justificativa => 'Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).',
    p_diferenca => true, p_compensacoes => '[]'::jsonb, p_cotas => null,
    p_memoria => '[{"grupo":"info","rotulo":"Calculado pelo sistema na aprovação","valor":130576.1},{"grupo":"info","rotulo":"Registrado pela planilha (Fin 10, 25/11)","detalhe":"Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).","valor":0}]'::jsonb, p_rateio => '[{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"29b8e2d0-3fe9-4380-86b0-ede8299c2c32","regional_nome":"SP","valor":94079.21,"pct":72.05},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"57e9291e-9544-4bdf-a22f-a7b10cbfbcdd","regional_nome":"NO","valor":12116.21,"pct":9.28},{"empresa_id":"1703fd52-a36c-4701-816c-a0bcc868351d","empresa_nome":"CCH","regional_id":"be58f1de-d2ff-4cd2-aca6-434e696bfba1","regional_nome":"Agency","valor":10453.29,"pct":8.01},{"empresa_id":"1703fd52-a36c-4701-816c-a0bcc868351d","empresa_nome":"CCH","regional_id":"b8ab4a2a-50dc-40e0-a08a-2a48f8a09f61","regional_nome":"Doca","valor":7709.88,"pct":5.9},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"9648d4bb-e4c2-4283-b8fb-206974005399","regional_nome":"RJ","valor":4023.17,"pct":3.08},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"54c627a6-e2d4-480b-9bd4-2f1acbf0ea91","regional_nome":"NE","valor":1599.87,"pct":1.23},{"empresa_id":"3b0edb30-9cb0-4604-b563-33b42be51bc2","empresa_nome":"Ventura","regional_id":"8c8b2342-073c-4e80-aee3-909d53a01426","regional_nome":"Ventura","valor":337,"pct":0.26},{"empresa_id":"a61067d9-b46b-40b0-8541-4850f13aa47c","empresa_nome":"Hitlab","regional_id":"c074c4ca-00c2-407b-8cf3-991a17c9c297","regional_nome":"Hitlab","valor":257.47,"pct":0.2}]'::jsonb, p_guia_path => null, p_titulos => '[]'::jsonb);
  update public.impostos_a_pagar set rateio_pela_receita = false where aprovacao_id = v_aprov;

  -- ISS GoCrazy: 19277.90, pago em 2026-11-23 (no histórico)
  v_aprov := public.aprovar_guia_fiscal(
    p_tenant_id => 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid, p_chave => 'iss|58591670-bb7c-431c-a210-1a6e91e81277|2026-10', p_tributo => 'ISS',
    p_empresa_contabil_id => '70d7df7d-e06c-4ef6-8311-8f27e1badd21'::uuid, p_estabelecimento_id => '58591670-bb7c-431c-a210-1a6e91e81277'::uuid,
    p_competencia => '2026-10', p_periodo => 'mensal', p_rotulo_competencia => 'outubro/2026',
    p_titulo => 'ISS próprio', p_codigo_receita => null,
    p_valor_calculado => 12984.63, p_valor_guia => 19277.9, p_justificativa => 'Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).',
    p_diferenca => false, p_compensacoes => '[]'::jsonb, p_cotas => null,
    p_memoria => '[{"grupo":"info","rotulo":"Calculado pelo sistema na aprovação","valor":12984.63},{"grupo":"info","rotulo":"Registrado pela planilha (Fin 10, 25/11)","detalhe":"Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).","valor":19277.9}]'::jsonb, p_rateio => '[{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"7767a4aa-6ca1-4bb7-8f45-f993db384bef","regional_nome":"SS","valor":19277.9,"pct":100}]'::jsonb, p_guia_path => null, p_titulos => '[{"cota_numero":null,"cota_total":null,"juros_pct":null,"vencimento":"2026-11-23","principal":19277.9,"juros":0,"valor":19277.9,"descricao":"ISS próprio · outubro/2026 · Santo André-SP","rateio":[{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","regional_id":"7767a4aa-6ca1-4bb7-8f45-f993db384bef","valor":19277.9}]}]'::jsonb);
  update public.impostos_a_pagar set rateio_pela_receita = false where aprovacao_id = v_aprov;
  select id into v_imposto from public.impostos_a_pagar where aprovacao_id = v_aprov;
  perform public.marcar_imposto_pago_no_historico(v_imposto, '2026-11-23'::date, '6ba5ea71-44bd-4f69-9e16-baa229fde531'::uuid, null, null);

  -- PIS California: 46091.59
  v_aprov := public.aprovar_guia_fiscal(
    p_tenant_id => 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid, p_chave => 'pis|4eae2860-b7c7-4c20-b3f9-6482cf3a7bf7|2026-10', p_tributo => 'PIS',
    p_empresa_contabil_id => '4eae2860-b7c7-4c20-b3f9-6482cf3a7bf7'::uuid, p_estabelecimento_id => null::uuid,
    p_competencia => '2026-10', p_periodo => 'mensal', p_rotulo_competencia => 'outubro/2026',
    p_titulo => 'PIS', p_codigo_receita => '6912',
    p_valor_calculado => 23339.92, p_valor_guia => 46091.59, p_justificativa => 'Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).',
    p_diferenca => false, p_compensacoes => '[]'::jsonb, p_cotas => null,
    p_memoria => '[{"grupo":"info","rotulo":"Calculado pelo sistema na aprovação","valor":23339.92},{"grupo":"info","rotulo":"Registrado pela planilha (Fin 10, 25/11)","detalhe":"Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).","valor":46091.59}]'::jsonb, p_rateio => '[{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"57e9291e-9544-4bdf-a22f-a7b10cbfbcdd","regional_nome":"NO","valor":18693.21,"pct":40.56},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"29b8e2d0-3fe9-4380-86b0-ede8299c2c32","regional_nome":"SP","valor":10017.48,"pct":21.73},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"9648d4bb-e4c2-4283-b8fb-206974005399","regional_nome":"RJ","valor":5526.69,"pct":11.99},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"54c627a6-e2d4-480b-9bd4-2f1acbf0ea91","regional_nome":"NE","valor":825.53,"pct":1.79},{"empresa_id":"1703fd52-a36c-4701-816c-a0bcc868351d","empresa_nome":"CCH","regional_id":"be58f1de-d2ff-4cd2-aca6-434e696bfba1","regional_nome":"Agency","valor":6160.77,"pct":13.37},{"empresa_id":"1703fd52-a36c-4701-816c-a0bcc868351d","empresa_nome":"CCH","regional_id":"b8ab4a2a-50dc-40e0-a08a-2a48f8a09f61","regional_nome":"Doca","valor":4543.91,"pct":9.86},{"empresa_id":"a61067d9-b46b-40b0-8541-4850f13aa47c","empresa_nome":"Hitlab","regional_id":"c074c4ca-00c2-407b-8cf3-991a17c9c297","regional_nome":"Hitlab","valor":214,"pct":0.46},{"empresa_id":"3b0edb30-9cb0-4604-b563-33b42be51bc2","empresa_nome":"Ventura","regional_id":"8c8b2342-073c-4e80-aee3-909d53a01426","regional_nome":"Ventura","valor":110,"pct":0.24}]'::jsonb, p_guia_path => null, p_titulos => '[{"cota_numero":null,"cota_total":null,"juros_pct":null,"vencimento":"2026-11-25","principal":46091.59,"juros":0,"valor":46091.59,"descricao":"PIS · outubro/2026 · Federal · California (matriz, soma São Paulo e Fortaleza)","rateio":[{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","regional_id":"57e9291e-9544-4bdf-a22f-a7b10cbfbcdd","valor":18693.21},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","regional_id":"29b8e2d0-3fe9-4380-86b0-ede8299c2c32","valor":10017.48},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","regional_id":"9648d4bb-e4c2-4283-b8fb-206974005399","valor":5526.69},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","regional_id":"54c627a6-e2d4-480b-9bd4-2f1acbf0ea91","valor":825.53},{"empresa_id":"1703fd52-a36c-4701-816c-a0bcc868351d","regional_id":"be58f1de-d2ff-4cd2-aca6-434e696bfba1","valor":6160.77},{"empresa_id":"1703fd52-a36c-4701-816c-a0bcc868351d","regional_id":"b8ab4a2a-50dc-40e0-a08a-2a48f8a09f61","valor":4543.91},{"empresa_id":"a61067d9-b46b-40b0-8541-4850f13aa47c","regional_id":"c074c4ca-00c2-407b-8cf3-991a17c9c297","valor":214},{"empresa_id":"3b0edb30-9cb0-4604-b563-33b42be51bc2","regional_id":"8c8b2342-073c-4e80-aee3-909d53a01426","valor":110}]}]'::jsonb);
  update public.impostos_a_pagar set rateio_pela_receita = false where aprovacao_id = v_aprov;

  -- PIS cumulativo California: 0.00
  v_aprov := public.aprovar_guia_fiscal(
    p_tenant_id => 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid, p_chave => 'pis_cum|4eae2860-b7c7-4c20-b3f9-6482cf3a7bf7|2026-10', p_tributo => 'PIS',
    p_empresa_contabil_id => '4eae2860-b7c7-4c20-b3f9-6482cf3a7bf7'::uuid, p_estabelecimento_id => null::uuid,
    p_competencia => '2026-10', p_periodo => 'mensal', p_rotulo_competencia => 'outubro/2026',
    p_titulo => 'PIS cumulativo', p_codigo_receita => '8109',
    p_valor_calculado => 33029.26, p_valor_guia => 0, p_justificativa => 'Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).',
    p_diferenca => false, p_compensacoes => '[]'::jsonb, p_cotas => null,
    p_memoria => '[{"grupo":"info","rotulo":"Calculado pelo sistema na aprovação","valor":33029.26},{"grupo":"info","rotulo":"Registrado pela planilha (Fin 10, 25/11)","detalhe":"Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).","valor":0}]'::jsonb, p_rateio => '[{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"29b8e2d0-3fe9-4380-86b0-ede8299c2c32","regional_nome":"SP","valor":28702.15,"pct":86.9},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"57e9291e-9544-4bdf-a22f-a7b10cbfbcdd","regional_nome":"NO","valor":3423.78,"pct":10.37},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"54c627a6-e2d4-480b-9bd4-2f1acbf0ea91","regional_nome":"NE","valor":519.96,"pct":1.57},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"9648d4bb-e4c2-4283-b8fb-206974005399","regional_nome":"RJ","valor":273.85,"pct":0.83},{"empresa_id":"3b0edb30-9cb0-4604-b563-33b42be51bc2","empresa_nome":"Ventura","regional_id":"8c8b2342-073c-4e80-aee3-909d53a01426","regional_nome":"Ventura","valor":109.52,"pct":0.33}]'::jsonb, p_guia_path => null, p_titulos => '[]'::jsonb);
  update public.impostos_a_pagar set rateio_pela_receita = false where aprovacao_id = v_aprov;

  -- COFINS California: 212730.42
  v_aprov := public.aprovar_guia_fiscal(
    p_tenant_id => 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid, p_chave => 'cofins|4eae2860-b7c7-4c20-b3f9-6482cf3a7bf7|2026-10', p_tributo => 'COFINS',
    p_empresa_contabil_id => '4eae2860-b7c7-4c20-b3f9-6482cf3a7bf7'::uuid, p_estabelecimento_id => null::uuid,
    p_competencia => '2026-10', p_periodo => 'mensal', p_rotulo_competencia => 'outubro/2026',
    p_titulo => 'COFINS', p_codigo_receita => '5856',
    p_valor_calculado => 107497.44, p_valor_guia => 212730.42, p_justificativa => 'Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).',
    p_diferenca => false, p_compensacoes => '[]'::jsonb, p_cotas => null,
    p_memoria => '[{"grupo":"info","rotulo":"Calculado pelo sistema na aprovação","valor":107497.44},{"grupo":"info","rotulo":"Registrado pela planilha (Fin 10, 25/11)","detalhe":"Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).","valor":212730.42}]'::jsonb, p_rateio => '[{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"57e9291e-9544-4bdf-a22f-a7b10cbfbcdd","regional_nome":"NO","valor":86281.58,"pct":40.56},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"29b8e2d0-3fe9-4380-86b0-ede8299c2c32","regional_nome":"SP","valor":46237.32,"pct":21.74},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"9648d4bb-e4c2-4283-b8fb-206974005399","regional_nome":"RJ","valor":25509.37,"pct":11.99},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"54c627a6-e2d4-480b-9bd4-2f1acbf0ea91","regional_nome":"NE","valor":3810.28,"pct":1.79},{"empresa_id":"1703fd52-a36c-4701-816c-a0bcc868351d","empresa_nome":"CCH","regional_id":"be58f1de-d2ff-4cd2-aca6-434e696bfba1","regional_nome":"Agency","valor":28429.53,"pct":13.36},{"empresa_id":"1703fd52-a36c-4701-816c-a0bcc868351d","empresa_nome":"CCH","regional_id":"b8ab4a2a-50dc-40e0-a08a-2a48f8a09f61","regional_nome":"Doca","valor":20968.34,"pct":9.86},{"empresa_id":"a61067d9-b46b-40b0-8541-4850f13aa47c","empresa_nome":"Hitlab","regional_id":"c074c4ca-00c2-407b-8cf3-991a17c9c297","regional_nome":"Hitlab","valor":988,"pct":0.46},{"empresa_id":"3b0edb30-9cb0-4604-b563-33b42be51bc2","empresa_nome":"Ventura","regional_id":"8c8b2342-073c-4e80-aee3-909d53a01426","regional_nome":"Ventura","valor":506,"pct":0.24}]'::jsonb, p_guia_path => null, p_titulos => '[{"cota_numero":null,"cota_total":null,"juros_pct":null,"vencimento":"2026-11-25","principal":212730.42,"juros":0,"valor":212730.42,"descricao":"COFINS · outubro/2026 · Federal · California (matriz, soma São Paulo e Fortaleza)","rateio":[{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","regional_id":"57e9291e-9544-4bdf-a22f-a7b10cbfbcdd","valor":86281.58},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","regional_id":"29b8e2d0-3fe9-4380-86b0-ede8299c2c32","valor":46237.32},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","regional_id":"9648d4bb-e4c2-4283-b8fb-206974005399","valor":25509.37},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","regional_id":"54c627a6-e2d4-480b-9bd4-2f1acbf0ea91","valor":3810.28},{"empresa_id":"1703fd52-a36c-4701-816c-a0bcc868351d","regional_id":"be58f1de-d2ff-4cd2-aca6-434e696bfba1","valor":28429.53},{"empresa_id":"1703fd52-a36c-4701-816c-a0bcc868351d","regional_id":"b8ab4a2a-50dc-40e0-a08a-2a48f8a09f61","valor":20968.34},{"empresa_id":"a61067d9-b46b-40b0-8541-4850f13aa47c","regional_id":"c074c4ca-00c2-407b-8cf3-991a17c9c297","valor":988},{"empresa_id":"3b0edb30-9cb0-4604-b563-33b42be51bc2","regional_id":"8c8b2342-073c-4e80-aee3-909d53a01426","valor":506}]}]'::jsonb);
  update public.impostos_a_pagar set rateio_pela_receita = false where aprovacao_id = v_aprov;

  -- COFINS cumulativa California: 0.00
  v_aprov := public.aprovar_guia_fiscal(
    p_tenant_id => 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid, p_chave => 'cofins_cum|4eae2860-b7c7-4c20-b3f9-6482cf3a7bf7|2026-10', p_tributo => 'COFINS',
    p_empresa_contabil_id => '4eae2860-b7c7-4c20-b3f9-6482cf3a7bf7'::uuid, p_estabelecimento_id => null::uuid,
    p_competencia => '2026-10', p_periodo => 'mensal', p_rotulo_competencia => 'outubro/2026',
    p_titulo => 'COFINS cumulativa', p_codigo_receita => '2172',
    p_valor_calculado => 152442.65, p_valor_guia => 0, p_justificativa => 'Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).',
    p_diferenca => false, p_compensacoes => '[]'::jsonb, p_cotas => null,
    p_memoria => '[{"grupo":"info","rotulo":"Calculado pelo sistema na aprovação","valor":152442.65},{"grupo":"info","rotulo":"Registrado pela planilha (Fin 10, 25/11)","detalhe":"Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).","valor":0}]'::jsonb, p_rateio => '[{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"29b8e2d0-3fe9-4380-86b0-ede8299c2c32","regional_nome":"SP","valor":132471.39,"pct":86.9},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"57e9291e-9544-4bdf-a22f-a7b10cbfbcdd","regional_nome":"NO","valor":15802.04,"pct":10.37},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"54c627a6-e2d4-480b-9bd4-2f1acbf0ea91","regional_nome":"NE","valor":2399.81,"pct":1.57},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"9648d4bb-e4c2-4283-b8fb-206974005399","regional_nome":"RJ","valor":1263.91,"pct":0.83},{"empresa_id":"3b0edb30-9cb0-4604-b563-33b42be51bc2","empresa_nome":"Ventura","regional_id":"8c8b2342-073c-4e80-aee3-909d53a01426","regional_nome":"Ventura","valor":505.5,"pct":0.33}]'::jsonb, p_guia_path => null, p_titulos => '[]'::jsonb);
  update public.impostos_a_pagar set rateio_pela_receita = false where aprovacao_id = v_aprov;

  -- pis GoCrazy: 0.00
  v_aprov := public.aprovar_guia_fiscal(
    p_tenant_id => 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid, p_chave => 'pis|70d7df7d-e06c-4ef6-8311-8f27e1badd21|2026-10', p_tributo => 'PIS',
    p_empresa_contabil_id => '70d7df7d-e06c-4ef6-8311-8f27e1badd21'::uuid, p_estabelecimento_id => null::uuid,
    p_competencia => '2026-10', p_periodo => 'mensal', p_rotulo_competencia => 'outubro/2026',
    p_titulo => 'PIS', p_codigo_receita => '6912',
    p_valor_calculado => 5940.65, p_valor_guia => 0, p_justificativa => 'Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).',
    p_diferenca => false, p_compensacoes => '[]'::jsonb, p_cotas => null,
    p_memoria => '[{"grupo":"info","rotulo":"Calculado pelo sistema na aprovação","valor":5940.65},{"grupo":"info","rotulo":"Registrado pela planilha (Fin 10, 25/11)","detalhe":"Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).","valor":0}]'::jsonb, p_rateio => '[{"empresa_id":"1703fd52-a36c-4701-816c-a0bcc868351d","empresa_nome":"CCH","regional_id":"b8ab4a2a-50dc-40e0-a08a-2a48f8a09f61","regional_nome":"Doca","valor":5940.65,"pct":100}]'::jsonb, p_guia_path => null, p_titulos => '[]'::jsonb);
  update public.impostos_a_pagar set rateio_pela_receita = false where aprovacao_id = v_aprov;

  -- pis_cum GoCrazy: 0.00
  v_aprov := public.aprovar_guia_fiscal(
    p_tenant_id => 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid, p_chave => 'pis_cum|70d7df7d-e06c-4ef6-8311-8f27e1badd21|2026-10', p_tributo => 'PIS',
    p_empresa_contabil_id => '70d7df7d-e06c-4ef6-8311-8f27e1badd21'::uuid, p_estabelecimento_id => null::uuid,
    p_competencia => '2026-10', p_periodo => 'mensal', p_rotulo_competencia => 'outubro/2026',
    p_titulo => 'PIS cumulativo', p_codigo_receita => '8109',
    p_valor_calculado => 553.79, p_valor_guia => 0, p_justificativa => 'Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).',
    p_diferenca => false, p_compensacoes => '[]'::jsonb, p_cotas => null,
    p_memoria => '[{"grupo":"info","rotulo":"Calculado pelo sistema na aprovação","valor":553.79},{"grupo":"info","rotulo":"Registrado pela planilha (Fin 10, 25/11)","detalhe":"Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).","valor":0}]'::jsonb, p_rateio => '[{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"7767a4aa-6ca1-4bb7-8f45-f993db384bef","regional_nome":"SS","valor":340.21,"pct":61.43},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"57e9291e-9544-4bdf-a22f-a7b10cbfbcdd","regional_nome":"NO","valor":213.58,"pct":38.57}]'::jsonb, p_guia_path => null, p_titulos => '[]'::jsonb);
  update public.impostos_a_pagar set rateio_pela_receita = false where aprovacao_id = v_aprov;

  -- cofins GoCrazy: 0.00
  v_aprov := public.aprovar_guia_fiscal(
    p_tenant_id => 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid, p_chave => 'cofins|70d7df7d-e06c-4ef6-8311-8f27e1badd21|2026-10', p_tributo => 'COFINS',
    p_empresa_contabil_id => '70d7df7d-e06c-4ef6-8311-8f27e1badd21'::uuid, p_estabelecimento_id => null::uuid,
    p_competencia => '2026-10', p_periodo => 'mensal', p_rotulo_competencia => 'outubro/2026',
    p_titulo => 'COFINS', p_codigo_receita => '5856',
    p_valor_calculado => 27363.03, p_valor_guia => 0, p_justificativa => 'Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).',
    p_diferenca => false, p_compensacoes => '[]'::jsonb, p_cotas => null,
    p_memoria => '[{"grupo":"info","rotulo":"Calculado pelo sistema na aprovação","valor":27363.03},{"grupo":"info","rotulo":"Registrado pela planilha (Fin 10, 25/11)","detalhe":"Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).","valor":0}]'::jsonb, p_rateio => '[{"empresa_id":"1703fd52-a36c-4701-816c-a0bcc868351d","empresa_nome":"CCH","regional_id":"b8ab4a2a-50dc-40e0-a08a-2a48f8a09f61","regional_nome":"Doca","valor":27363.03,"pct":100}]'::jsonb, p_guia_path => null, p_titulos => '[]'::jsonb);
  update public.impostos_a_pagar set rateio_pela_receita = false where aprovacao_id = v_aprov;

  -- cofins_cum GoCrazy: 0.00
  v_aprov := public.aprovar_guia_fiscal(
    p_tenant_id => 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid, p_chave => 'cofins_cum|70d7df7d-e06c-4ef6-8311-8f27e1badd21|2026-10', p_tributo => 'COFINS',
    p_empresa_contabil_id => '70d7df7d-e06c-4ef6-8311-8f27e1badd21'::uuid, p_estabelecimento_id => null::uuid,
    p_competencia => '2026-10', p_periodo => 'mensal', p_rotulo_competencia => 'outubro/2026',
    p_titulo => 'COFINS cumulativa', p_codigo_receita => '2172',
    p_valor_calculado => 2555.99, p_valor_guia => 0, p_justificativa => 'Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).',
    p_diferenca => false, p_compensacoes => '[]'::jsonb, p_cotas => null,
    p_memoria => '[{"grupo":"info","rotulo":"Calculado pelo sistema na aprovação","valor":2555.99},{"grupo":"info","rotulo":"Registrado pela planilha (Fin 10, 25/11)","detalhe":"Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).","valor":0}]'::jsonb, p_rateio => '[{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"7767a4aa-6ca1-4bb7-8f45-f993db384bef","regional_nome":"SS","valor":1570.21,"pct":61.43},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"57e9291e-9544-4bdf-a22f-a7b10cbfbcdd","regional_nome":"NO","valor":985.78,"pct":38.57}]'::jsonb, p_guia_path => null, p_titulos => '[]'::jsonb);
  update public.impostos_a_pagar set rateio_pela_receita = false where aprovacao_id = v_aprov;

  -- IOF California: 2746.13
  v_aprov := public.aprovar_guia_fiscal(
    p_tenant_id => 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid, p_chave => 'iof|4eae2860-b7c7-4c20-b3f9-6482cf3a7bf7|2026-10', p_tributo => 'IOF',
    p_empresa_contabil_id => '4eae2860-b7c7-4c20-b3f9-6482cf3a7bf7'::uuid, p_estabelecimento_id => null::uuid,
    p_competencia => '2026-10', p_periodo => 'mensal', p_rotulo_competencia => 'outubro/2026',
    p_titulo => 'IOF do mútuo', p_codigo_receita => '1150',
    p_valor_calculado => 2542, p_valor_guia => 2746.13, p_justificativa => 'Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).',
    p_diferenca => false, p_compensacoes => '[]'::jsonb, p_cotas => null,
    p_memoria => '[{"grupo":"info","rotulo":"Calculado pelo sistema na aprovação","valor":2542},{"grupo":"info","rotulo":"Registrado pela planilha (Fin 10, 25/11)","detalhe":"Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).","valor":2746.13}]'::jsonb, p_rateio => '[{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"7767a4aa-6ca1-4bb7-8f45-f993db384bef","regional_nome":"SS","valor":2746.13,"pct":0}]'::jsonb, p_guia_path => null, p_titulos => '[{"cota_numero":null,"cota_total":null,"juros_pct":null,"vencimento":"2026-11-13","principal":2746.13,"juros":0,"valor":2746.13,"descricao":"IOF do mútuo · outubro/2026 · California","rateio":[{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","regional_id":"7767a4aa-6ca1-4bb7-8f45-f993db384bef","valor":2746.13}]}]'::jsonb);
  update public.impostos_a_pagar set rateio_pela_receita = false where aprovacao_id = v_aprov;

  -- IOF GoCrazy: 4766.77, pago em 2026-11-23 (no histórico)
  v_aprov := public.aprovar_guia_fiscal(
    p_tenant_id => 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid, p_chave => 'iof|70d7df7d-e06c-4ef6-8311-8f27e1badd21|2026-10', p_tributo => 'IOF',
    p_empresa_contabil_id => '70d7df7d-e06c-4ef6-8311-8f27e1badd21'::uuid, p_estabelecimento_id => null::uuid,
    p_competencia => '2026-10', p_periodo => 'mensal', p_rotulo_competencia => 'outubro/2026',
    p_titulo => 'IOF do mútuo', p_codigo_receita => '1150',
    p_valor_calculado => 3813, p_valor_guia => 4766.77, p_justificativa => 'Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).',
    p_diferenca => false, p_compensacoes => '[]'::jsonb, p_cotas => null,
    p_memoria => '[{"grupo":"info","rotulo":"Calculado pelo sistema na aprovação","valor":3813},{"grupo":"info","rotulo":"Registrado pela planilha (Fin 10, 25/11)","detalhe":"Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).","valor":4766.77}]'::jsonb, p_rateio => '[{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","empresa_nome":"Agência California","regional_id":"7767a4aa-6ca1-4bb7-8f45-f993db384bef","regional_nome":"SS","valor":4766.77,"pct":0}]'::jsonb, p_guia_path => null, p_titulos => '[{"cota_numero":null,"cota_total":null,"juros_pct":null,"vencimento":"2026-11-13","principal":4766.77,"juros":0,"valor":4766.77,"descricao":"IOF do mútuo · outubro/2026 · GoCrazy","rateio":[{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","regional_id":"7767a4aa-6ca1-4bb7-8f45-f993db384bef","valor":4766.77}]}]'::jsonb);
  update public.impostos_a_pagar set rateio_pela_receita = false where aprovacao_id = v_aprov;
  select id into v_imposto from public.impostos_a_pagar where aprovacao_id = v_aprov;
  perform public.marcar_imposto_pago_no_historico(v_imposto, '2026-11-23'::date, '6ba5ea71-44bd-4f69-9e16-baa229fde531'::uuid, null, null);

  -- IRRF pago pela GoCrazy em 19/11: aluguel do galpão SSB e as NFs 49, 50, 56, 57 e 58 (R$ 20.318,94)
  v_imposto := public.lancar_guia_da_contabilidade(
    p_tenant_id => 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid, p_tributo => 'IRRF', p_titulo => 'IRRF retido de fornecedores', p_codigo_receita => '1708',
    p_empresa_contabil_id => '70d7df7d-e06c-4ef6-8311-8f27e1badd21'::uuid, p_estabelecimento_id => null, p_competencia => '2026-10',
    p_rotulo_competencia => 'outubro/2026',
    p_descricao => 'Guia da contabilidade: IRRF de outubro pago em 19/11 pela conta da GoCrazy, como na planilha (aluguel do galpão SSB e NFs 49, 50, 56, 57 e 58). Outubro/2026 registrado pela planilha (Fin 10, 25/11), com a divisão da planilha: a base de notas do sistema está incompleta (decisão do Tiago, 25/11).',
    p_vencimento => '2026-11-20'::date, p_valor => 20318.94,
    p_rateio => '[{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","regional_id":"7767a4aa-6ca1-4bb7-8f45-f993db384bef","valor":1527.31},{"empresa_id":"304039bd-509d-4536-aa26-44e7091ee718","regional_id":"57e9291e-9544-4bdf-a22f-a7b10cbfbcdd","valor":492.89},{"empresa_id":"1703fd52-a36c-4701-816c-a0bcc868351d","regional_id":"b8ab4a2a-50dc-40e0-a08a-2a48f8a09f61","valor":18298.74}]'::jsonb, p_guia_path => null);
  perform public.marcar_imposto_pago_no_historico(v_imposto, '2026-11-19'::date, '6ba5ea71-44bd-4f69-9e16-baa229fde531'::uuid, null, null);
end;
$$;
