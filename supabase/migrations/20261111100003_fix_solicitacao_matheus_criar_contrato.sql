-- Fix pontual: cria contrato pra solicitação aprovada do Matheus que ficou
-- sem contrato por causa do bug do trigger security-invoker.
--
-- Contexto: solicitação 5e32e7c6-57b9-4f50-b8fe-0f7f428c8e7d (ANI-1011/26,
-- ÂNIMA EDUCAÇÃO | 4º TRI, Analista de BI, diárias, 01→13/10/2026, 12 dias)
-- foi criada e aprovada pela Marisa em 11/11/26, mas ficou com
-- freelancer_id=null (bug do trigger — 20261111100001 corrigiu) e,
-- consequentemente, sem contrato (aprovarSolicitacao em actions.ts só
-- dispara criar_contrato_de_renovacao quando há freelancer_id).
-- O backfill da 20261111100002 já setou freelancer_id. Falta gerar o
-- contrato e finalizar a solicitação.
--
-- Esta migration replica EXATAMENTE a lógica da RPC criar_contrato_de_renovacao
-- pros dados reais da solicitação:
--   - nome_job vem de jobs.id = 4c089968... ("ÂNIMA EDUCAÇÃO | 4º TRI")
--   - origem_sistema = 'califa_erp' (job vinculado)
--   - responsável migra pro solicitante (Teila) — Lufa era antes
--   - diária com período < 15 dias → dispensa minuta → status='finalizada'
--   - created_by/updated_by do contrato = aprovador (Marisa), seguindo
--     o padrão do auth.uid() que a RPC usaria
--
-- NÃO é idempotente (cria contrato novo a cada execução). Mas a migration
-- tem guard-rails no WHERE: só executa se contrato_id ainda é NULL. Se já
-- foi aplicada, o UPDATE da solicitação vira no-op e o INSERT do contrato
-- também é skippado via EXISTS check.

do $$
declare
  v_sol_id uuid := '5e32e7c6-57b9-4f50-b8fe-0f7f428c8e7d';
  v_tenant_id uuid := 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
  v_freela_id uuid := '26bd02e9-6f87-4042-8460-471c7e6ac2f6';
  v_job_id uuid := '4c089968-4cd4-4f4d-9814-23ec3bd13195';
  v_solicitante_id uuid := 'eaac995c-01d5-4195-9da2-baeb6cb59df4'; -- Teila
  v_aprovador_id uuid := '04a5b4df-cf0f-40a2-b67c-ea223bc06275'; -- Marisa
  v_contrato_id uuid;
  v_ja_tem boolean;
begin
  -- Guard: se já tem contrato, não faz nada
  select contrato_id is not null into v_ja_tem
  from public.freelancer_solicitacoes
  where id = v_sol_id;

  if v_ja_tem then
    raise notice 'Solicitacao ja tem contrato — migration skip';
    return;
  end if;

  -- 1. Migra responsável do freela pro solicitante (Teila)
  update public.freelancers
     set responsavel_id = v_solicitante_id,
         updated_by = v_aprovador_id,
         updated_at = now()
   where id = v_freela_id
     and tenant_id = v_tenant_id;

  -- 2. Cria o contrato
  insert into public.freelancer_contratos (
    tenant_id, freelancer_id, job_id, job_interno_id, responsavel_id,
    nome_job, cargo, tipo, valor,
    data_inicio, data_termino, cidade, observacoes,
    origem_sistema, created_by, updated_by
  )
  select
    tenant_id, freelancer_id, job_id, null::uuid, v_solicitante_id,
    'ÂNIMA EDUCAÇÃO | 4º TRI', cargo, tipo, valor,
    data_inicio, data_termino, cidade, observacoes,
    'califa_erp', v_aprovador_id, v_aprovador_id
  from public.freelancer_solicitacoes
  where id = v_sol_id
  returning id into v_contrato_id;

  -- 3. Marca a solicitação: contrato vinculado + status=finalizada (dispensa
  -- de minuta, porque é diária com < 15 dias)
  update public.freelancer_solicitacoes
     set contrato_id = v_contrato_id,
         status = 'finalizada'::freelancer_solicitacao_status,
         updated_at = now()
   where id = v_sol_id;

  raise notice 'Contrato criado: %', v_contrato_id;
end;
$$;
