-- Backfill de colaboradores.lider_id a partir da planilha oficial de
-- lideranças, fornecida em 21/11/2026.
--
-- Contexto:
--   O módulo de férias vai ganhar aprovação em duas etapas (líder, RH).
--   Antes de implementar o fluxo, foi feito o match entre a planilha de
--   lideranças e o cadastro atual de colaboradores do tenant principal.
--   O match casou 200 de 200 nomes: 138 já estavam com o lider_id
--   correto e 62 vão ser atualizados aqui. Três líderes do topo da
--   pirâmide permanecem com lider_id NULL por decisão da planilha.
--
-- Nota de PII: por regra do CLAUDE.md, o arquivo versionado não
-- carrega nome, email, CPF ou outro dado identificável. Só UUIDs.
--
-- Guard: o UPDATE restringe por tenant_id pra evitar atingir o tenant
-- Sandbox por acidente. Como os UUIDs de colaborador são únicos
-- globalmente, o filtro é defesa em profundidade.

BEGIN;

WITH novos_lideres (colaborador_id, lider_id) AS (
  VALUES
  ('c59999d5-37a2-4955-8b18-6014dfb8475b'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('92060705-ee00-4507-a8a2-2ac68312e846'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
  ('f0edd379-dd62-4797-abbb-a05f4f6d7068'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
  ('6435a9c6-ff93-49f8-9e2c-fae03f0fae21'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
  ('437589d9-d825-4cdc-b0b9-babd771c1ff4'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
  ('2a0e6ca1-ea97-4a69-a46e-0179eadc3520'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
  ('40f16f7f-63d3-486e-bfc7-6bdd89f6331e'::uuid, '8141c4a9-a6a4-4773-b550-69c84750cecc'::uuid),
  ('34e0a583-581a-4045-a945-8f380eddac31'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
  ('dd378f8d-56e6-434a-82fd-880af2bd0870'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('19381aa3-98ea-4892-9f6b-d3b713c68771'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
  ('922e502c-aa6a-4679-a54c-d0cb634c476e'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
  ('782a4ea8-adb0-43d8-9554-d86008e10876'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
  ('47bf2e86-9256-4e28-a9aa-dfa81d08eab6'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
  ('546240c0-8379-48a4-98c2-c253532116b8'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
  ('146b6ae1-bd04-4458-9e24-afb39f517226'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
  ('9ed64aa2-b1d7-465b-8fe1-ac9af7560925'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
  ('5da77d22-a285-4e4d-b552-f7ea4a311ec6'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
  ('fd791bcf-2f6d-4e7a-b41e-afc6be23dbf2'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('489f3415-674e-4a35-a8cc-7d6c62f8c03e'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('9e3b43ed-caed-4b51-89ae-3189857e13d8'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
  ('14c9c9ba-841b-4362-8280-0bdd3c9766de'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
  ('39806e86-d8bf-43f1-b556-e401182adafe'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
  ('ab89560e-8a43-4561-ab1a-ef5c2be1913a'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
  ('77bac4f7-37e5-4e03-ae31-46ca3628fede'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('90de92eb-7eb4-47a8-9966-ed289e0e1664'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('7fa8b57b-c590-42ef-9ab9-2e9ffe11a999'::uuid, '7881a97b-05a7-47e7-b951-6b4e4a3bf9ea'::uuid),
  ('0966f0fb-85aa-495f-8709-c3c2a6028f0c'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
  ('5f1b9c99-b900-494a-b77d-37f00d185bc6'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
  ('cc6309d5-11e2-4559-a0d2-f15ff63e28b4'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
  ('82a9dc81-44d5-421e-a26f-5f4aad94fb7f'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
  ('2fb560a9-8a9a-433f-acc3-e946fc18db85'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
  ('3743c055-ad4f-4ba5-bd51-42f6b0b07f35'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('963d0062-2370-4535-b72a-68fa721cda17'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('590fe7e9-007d-4881-8ab1-59eed7929e73'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
  ('5fab7007-1377-4558-a83b-44a2b6fa0bd3'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
  ('f30ae126-385a-4447-89d3-dfaa92002a8b'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('b7bd8c42-a9e2-498a-bf27-715dd1eed703'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
  ('b5453c2a-637b-4ea4-ad68-0d305a11931d'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('5a602c19-cce9-4597-accd-6c0ff517af10'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
  ('55c7064f-85c2-4740-a7ec-24ada8c8d77c'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('4147af36-c0d6-42be-b8d0-eac26daa452d'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
  ('acf5f0cc-bcb4-44d2-9ecd-4ef4ffed3d11'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('5defd3c6-c57e-42fd-87bc-8072da65e99c'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
  ('dfd96ca7-4a96-4f19-b06b-38dd69f5338b'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('893f6600-773f-4f37-8c55-10a274415a1d'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
  ('8f9f9920-4ed1-497f-86b4-d0da9c561970'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('59c4ae39-51ac-4828-a8ce-e58fff7f6717'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
  ('f6302d1b-904b-47f5-9631-e2b3b3d51de6'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('e9ed1509-a81f-4752-9faf-ec907c75fd84'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('95803b5e-cbdc-43ad-8d77-bce1cb04dc77'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
  ('2624485e-0b2a-4f95-a637-3ee7b8bfcae3'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
  ('d753b521-4bfe-4509-a651-d0d56b1cb435'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('59b9d537-2703-4597-985e-06188bae12a7'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
  ('5a6fc5b5-060b-48bb-9e2b-7286079f72e1'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
  ('6ca2d4cd-11ca-4d1e-aa60-4af180515b2c'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
  ('8a55ae64-399d-4cb7-84fe-9622b690d0e0'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
  ('e2811b81-343a-46a6-9bf1-6e566619da61'::uuid, '23f09335-3ea4-48dc-90f2-49ef511ac3d4'::uuid),
  ('14a8303e-4451-4cae-9b27-d69d2ae4aa9c'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('141f3778-7fc0-4832-abd9-3a72cc6d5de7'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('418f1314-7025-4be1-8d50-cc28738db201'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('e1400da9-97f9-485c-951f-f317a60ce35f'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
  ('d0ba4b62-3028-4f6d-a6b6-c848a3518840'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid)
)
UPDATE public.colaboradores c
   SET lider_id = nl.lider_id
  FROM novos_lideres nl
 WHERE c.id = nl.colaborador_id
   AND c.tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid
   AND (c.lider_id IS DISTINCT FROM nl.lider_id);

-- Trava para a migration falhar se não atualizar exatamente 62 linhas.
-- O backfill só é correto se bater com o cálculo offline.
DO $$
DECLARE
  esperado INT := 62;
  atualizado INT;
BEGIN
  SELECT COUNT(*) INTO atualizado
    FROM public.colaboradores c
    JOIN (
      VALUES
        ('c59999d5-37a2-4955-8b18-6014dfb8475b'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('92060705-ee00-4507-a8a2-2ac68312e846'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
        ('f0edd379-dd62-4797-abbb-a05f4f6d7068'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
        ('6435a9c6-ff93-49f8-9e2c-fae03f0fae21'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
        ('437589d9-d825-4cdc-b0b9-babd771c1ff4'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
        ('2a0e6ca1-ea97-4a69-a46e-0179eadc3520'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
        ('40f16f7f-63d3-486e-bfc7-6bdd89f6331e'::uuid, '8141c4a9-a6a4-4773-b550-69c84750cecc'::uuid),
        ('34e0a583-581a-4045-a945-8f380eddac31'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
        ('dd378f8d-56e6-434a-82fd-880af2bd0870'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('19381aa3-98ea-4892-9f6b-d3b713c68771'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
        ('922e502c-aa6a-4679-a54c-d0cb634c476e'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
        ('782a4ea8-adb0-43d8-9554-d86008e10876'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
        ('47bf2e86-9256-4e28-a9aa-dfa81d08eab6'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
        ('546240c0-8379-48a4-98c2-c253532116b8'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
        ('146b6ae1-bd04-4458-9e24-afb39f517226'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
        ('9ed64aa2-b1d7-465b-8fe1-ac9af7560925'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
        ('5da77d22-a285-4e4d-b552-f7ea4a311ec6'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
        ('fd791bcf-2f6d-4e7a-b41e-afc6be23dbf2'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('489f3415-674e-4a35-a8cc-7d6c62f8c03e'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('9e3b43ed-caed-4b51-89ae-3189857e13d8'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
        ('14c9c9ba-841b-4362-8280-0bdd3c9766de'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
        ('39806e86-d8bf-43f1-b556-e401182adafe'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
        ('ab89560e-8a43-4561-ab1a-ef5c2be1913a'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
        ('77bac4f7-37e5-4e03-ae31-46ca3628fede'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('90de92eb-7eb4-47a8-9966-ed289e0e1664'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('7fa8b57b-c590-42ef-9ab9-2e9ffe11a999'::uuid, '7881a97b-05a7-47e7-b951-6b4e4a3bf9ea'::uuid),
        ('0966f0fb-85aa-495f-8709-c3c2a6028f0c'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
        ('5f1b9c99-b900-494a-b77d-37f00d185bc6'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
        ('cc6309d5-11e2-4559-a0d2-f15ff63e28b4'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
        ('82a9dc81-44d5-421e-a26f-5f4aad94fb7f'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
        ('2fb560a9-8a9a-433f-acc3-e946fc18db85'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
        ('3743c055-ad4f-4ba5-bd51-42f6b0b07f35'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('963d0062-2370-4535-b72a-68fa721cda17'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('590fe7e9-007d-4881-8ab1-59eed7929e73'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
        ('5fab7007-1377-4558-a83b-44a2b6fa0bd3'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
        ('f30ae126-385a-4447-89d3-dfaa92002a8b'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('b7bd8c42-a9e2-498a-bf27-715dd1eed703'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
        ('b5453c2a-637b-4ea4-ad68-0d305a11931d'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('5a602c19-cce9-4597-accd-6c0ff517af10'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
        ('55c7064f-85c2-4740-a7ec-24ada8c8d77c'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('4147af36-c0d6-42be-b8d0-eac26daa452d'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
        ('acf5f0cc-bcb4-44d2-9ecd-4ef4ffed3d11'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('5defd3c6-c57e-42fd-87bc-8072da65e99c'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
        ('dfd96ca7-4a96-4f19-b06b-38dd69f5338b'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('893f6600-773f-4f37-8c55-10a274415a1d'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
        ('8f9f9920-4ed1-497f-86b4-d0da9c561970'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('59c4ae39-51ac-4828-a8ce-e58fff7f6717'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
        ('f6302d1b-904b-47f5-9631-e2b3b3d51de6'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('e9ed1509-a81f-4752-9faf-ec907c75fd84'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('95803b5e-cbdc-43ad-8d77-bce1cb04dc77'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
        ('2624485e-0b2a-4f95-a637-3ee7b8bfcae3'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
        ('d753b521-4bfe-4509-a651-d0d56b1cb435'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('59b9d537-2703-4597-985e-06188bae12a7'::uuid, '13f60134-387d-4f0a-be27-df0564cdc167'::uuid),
        ('5a6fc5b5-060b-48bb-9e2b-7286079f72e1'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
        ('6ca2d4cd-11ca-4d1e-aa60-4af180515b2c'::uuid, '1c664485-99e9-4d89-b411-ff9b9587d0bf'::uuid),
        ('8a55ae64-399d-4cb7-84fe-9622b690d0e0'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid),
        ('e2811b81-343a-46a6-9bf1-6e566619da61'::uuid, '23f09335-3ea4-48dc-90f2-49ef511ac3d4'::uuid),
        ('14a8303e-4451-4cae-9b27-d69d2ae4aa9c'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('141f3778-7fc0-4832-abd9-3a72cc6d5de7'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('418f1314-7025-4be1-8d50-cc28738db201'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('e1400da9-97f9-485c-951f-f317a60ce35f'::uuid, '4540570f-7d22-41a0-85b9-a27c13e9a603'::uuid),
        ('d0ba4b62-3028-4f6d-a6b6-c848a3518840'::uuid, '65c05a05-d023-4b33-8e6c-c958d3ffe4ee'::uuid)
    ) AS esp(colab, lider) ON esp.colab = c.id
   WHERE c.lider_id = esp.lider
     AND c.tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid;

  IF atualizado <> esperado THEN
    RAISE EXCEPTION 'Backfill divergente: esperado % linhas com lider_id correto, encontrado %.', esperado, atualizado;
  END IF;
END$$;

COMMIT;
