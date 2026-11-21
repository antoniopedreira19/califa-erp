-- Backfill operacional: as 6 solicitacoes de ferias que estavam em
-- `pendente_aprovacao` ANTES do fluxo lider->RH subir vao pro status
-- `aguardando_gestor` pra entrar no fluxo novo.
--
-- Contexto: o PR 2 mudou o `solicitarFerias` pra decidir o status
-- inicial pelo `lider_id`, mas essa decisao so vale pra solicitacoes
-- novas. As 6 pendentes criadas entre 17-20/11 tem lider definido —
-- decisao do Daniel em 21/11 de passar elas pelo lider antes do RH.
--
-- IDs especificados em vez de WHERE status='pendente_aprovacao' solto
-- pra garantir que so as 6 linhas identificadas sao afetadas, mesmo
-- se outra solicitacao entrar entre a leitura e o UPDATE.
--
-- Spec: docs/superpowers/specs/2026-11-21-ferias-aprovacao-lider-e-pagina-equipe-design.md
BEGIN;

UPDATE public.colaboradores_ferias_lancamentos
   SET status = 'aguardando_gestor'
 WHERE id IN (
   '9c84d6f6-6727-4eff-b4ff-aff1cde901a3',
   'b4b0451a-c1c7-4753-9bc4-5656f3aa82ad',
   'c1ab9d20-e59f-4070-a2f6-727b9b059585',
   'ed6136bc-0959-40cb-ac4f-e6f6384edd2a',
   '44193ce6-3f7e-4009-8c1b-12b1f21ddb53',
   'ac83eeaa-4a83-4802-9f12-56f38302b675'
 )
   AND status = 'pendente_aprovacao'
   AND tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid;

-- Trava: 6 esperado, nem mais nem menos.
DO $$
DECLARE
  atualizado INT;
BEGIN
  SELECT COUNT(*) INTO atualizado
    FROM public.colaboradores_ferias_lancamentos
   WHERE id IN (
     '9c84d6f6-6727-4eff-b4ff-aff1cde901a3',
     'b4b0451a-c1c7-4753-9bc4-5656f3aa82ad',
     'c1ab9d20-e59f-4070-a2f6-727b9b059585',
     'ed6136bc-0959-40cb-ac4f-e6f6384edd2a',
     '44193ce6-3f7e-4009-8c1b-12b1f21ddb53',
     'ac83eeaa-4a83-4802-9f12-56f38302b675'
   )
     AND status = 'aguardando_gestor';

  IF atualizado <> 6 THEN
    RAISE EXCEPTION 'Backfill divergente: esperado 6 linhas em aguardando_gestor, encontrado %.', atualizado;
  END IF;
END$$;

COMMIT;
