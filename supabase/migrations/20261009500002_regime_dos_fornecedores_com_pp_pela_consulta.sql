-- ============================================================================
-- Decisão 165 (09/10/2026): o regime dos fornecedores que já têm PP lançada,
-- pela consulta do CNPJ.
--
-- A aprovação da PP no financeiro lê o regime direto do cadastro (é ele que
-- trava a retenção no Simples e no MEI). Pedido do Tiago: "apenas no caso
-- das PPs já lançadas quero que o regime tributário já seja modificado para
-- o correto, com a consulta, de imediato". Os outros cadastros esperam a
-- revisão pela tela, onde a consulta só sugere.
--
-- Como foi feito: os 40 fornecedores PJ com pelo menos uma PP não cancelada
-- (o "Fornecedor Teste", de CNPJ fictício, ficou de fora) foram consultados
-- em 09/10/2026 — BrasilAPI e, na falha, CNPJ.ws, a mesma ordem de
-- `lib/consulta-cnpj.ts`; a BrasilAPI estava fora e os 40 vieram do
-- CNPJ.ws. Os 9 que já tinham regime bateram todos com a consulta, então
-- nenhum valor gravado muda. Os 31 sem regime recebem o da consulta:
-- 15 Simples, 9 MEI e 7 "nenhum dos dois", gravado como o legado `normal`
-- ("Lucro Real ou Presumido") — a Receita não diz qual dos dois, e para a
-- retenção a regra é a mesma; a revisão pela tela escolhe Real ou Presumido.
-- A consulta vai inteira, como o cadastro grava (decisão 142): o indicado,
-- o dia e, no Simples e no MEI, desde quando.
--
-- Backfill que só preenche o vazio (`regime_tributario is null`): aditivo e
-- idempotente. Só ids e regimes aqui; CNPJ e nome ficam fora do repositório.
-- ============================================================================

update public.fornecedores f
   set regime_tributario    = v.regime,
       regime_consulta      = v.regime,
       regime_consultado_em = date '2026-10-09',
       regime_desde         = v.desde,
       updated_at           = now()
  from (values
  ('9e0ac5ab-0317-43e8-9134-21f76702012a', 'normal', null),
  ('5f095e03-acab-4ba4-95bf-82620d41748f', 'simples', date '2021-01-07'),
  ('81aa7239-d8ea-44cb-9bea-623ca0fc3008', 'normal', null),
  ('af71ab19-28f9-425d-a7e0-325902adb73d', 'mei', date '2026-05-04'),
  ('3d3e727f-3cb7-4b04-a053-41c08f924fc1', 'simples', date '2024-02-20'),
  ('7fa055b8-281f-42f4-8b63-e98417ba6a1b', 'normal', null),
  ('30666bd5-fb6c-4acb-a286-8059cdc8b881', 'normal', null),
  ('9f4f96b3-4260-4d55-a202-2edf54e85e34', 'simples', date '2024-01-01'),
  ('2997cb2e-936c-4e21-882d-dedd2eccb6a4', 'simples', date '2018-07-05'),
  ('8761700e-47a7-4e86-8c2a-432637bf65de', 'simples', date '2026-01-01'),
  ('4d44e9fd-7cd5-47e6-a60c-7eb6f3ca2f1b', 'mei', date '2025-01-01'),
  ('da0c03b8-8d0a-4595-a87a-817b1a0976f4', 'mei', date '2026-04-15'),
  ('4b1c8dc3-c692-42a3-aba6-5d3ab0fcb1bd', 'mei', date '2022-10-05'),
  ('265dbcb9-8476-48ea-ad53-aead255c3f97', 'mei', date '2019-11-15'),
  ('b84609a6-ed6d-44d9-ba5c-26d2a67bf4b6', 'simples', date '2007-07-01'),
  ('7f016207-6bf9-4c7f-8457-b14b2914472f', 'mei', date '2023-06-28'),
  ('cca68369-c0a3-4571-83be-498f05730141', 'normal', null),
  ('2d6a1fef-9ab8-4ac0-ac55-b0ea39f798d3', 'normal', null),
  ('b814884f-27a5-49ea-8836-f49122a5da87', 'mei', date '2026-01-01'),
  ('50fd78f6-cb67-463c-b9a5-7a403c513c76', 'simples', date '2007-07-01'),
  ('c3dda5d1-313b-43a4-bc32-abc89faa24ec', 'simples', date '2019-11-19'),
  ('548be568-536d-4982-a7b7-2ffe45d03ca1', 'simples', date '2007-07-01'),
  ('9fb040e1-a203-4a56-8662-c9b325d51792', 'simples', date '2007-07-01'),
  ('bf3b746a-289c-4a4b-b773-30de32c54466', 'mei', date '2023-02-01'),
  ('9b64c542-cc93-4151-a82f-7274d3fc8cde', 'simples', date '2007-07-01'),
  ('412ef81a-3614-4d03-8418-02b6751c1bc9', 'mei', date '2025-08-07'),
  ('2b7e28eb-ce07-4de4-8d79-b6ca227a6eaa', 'simples', date '2022-07-28'),
  ('5e92dea0-e44c-49d7-b4db-53dcf1da2a18', 'simples', date '2019-05-23'),
  ('18fb02d5-d2f2-436a-94e3-8b328e7f7564', 'simples', date '2020-01-01'),
  ('254c99cb-0adb-48a6-be28-0a775cdb16a3', 'simples', date '2025-08-28'),
  ('5e469cbb-99e2-48c2-965b-56da8d25ae5a', 'normal', null)
  ) as v(id, regime, desde)
 where f.id = v.id::uuid
   and f.tipo_pessoa = 'juridica'
   and f.regime_tributario is null;
