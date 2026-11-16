-- Subsistema "Vínculos de Colaborador" — Fase 1, Sessão S2 (backfill).
-- Spec: docs/modulos/rh/70-vinculos-colaborador.md
-- Plano: docs/modulos/rh/72-vinculos-colaborador-plano-de-execucao.md §S2
--
-- Pra cada colaborador ATIVO do tenant Califa (204 esperados, incluindo
-- sócios), cria 1 vínculo ativo com os valores atuais de tipo_contratacao
-- e data_admissao. Vínculos nasceam como "espelho" do estado atual.
--
-- Nada muda em comportamento ainda:
--   - A trigger fn_gerar_ferias_periodos continua usando data_admissao
--     diretamente (S3 vai trocar pra fn_data_base_ferias).
--   - Com vinculo.data_inicio == colaborador.data_admissao pra todos,
--     fn_data_base_ferias retorna o mesmo valor que já era usado.
--
-- Guarda de tenant: aborta se não for Califa.
-- Backup: snapshot de colaboradores antes (defensivo, mesmo não mexendo
-- nessa tabela diretamente).

begin;

do $$
declare v_nome text;
begin
  select nome into v_nome from public.tenants where id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
  if v_nome is null then raise exception 'Tenant não encontrado'; end if;
  if v_nome <> 'Agência California' then raise exception 'Tenant errado: %', v_nome; end if;
end $$;

-- Backup defensivo (só os campos relevantes)
create table if not exists public._backup_20261116_califa_colaboradores_pre_vinculos as
  select id, tenant_id, nome, tipo_contratacao, data_admissao, status, created_by
    from public.colaboradores
   where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';

-- Backfill: 1 vínculo ativo por colaborador ativo.
-- Usa data_admissao como data_inicio e tipo_contratacao atual.
-- NÃO popula motivo_encerramento (data_fim é null → tem que ser null
-- por causa da chk_motivo_so_encerrado).
insert into public.colaborador_vinculos
  (tenant_id, colaborador_id, tipo_contratacao, data_inicio, created_by)
select
  tenant_id, id, tipo_contratacao, data_admissao, created_by
from public.colaboradores
where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
  and status = 'ativo';

-- Verificação inline: conta tem que bater
do $$
declare
  v_colabs int;
  v_vinculos int;
begin
  select count(*) into v_colabs
    from public.colaboradores
   where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and status = 'ativo';

  select count(*) into v_vinculos
    from public.colaborador_vinculos
   where tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and data_fim is null;

  if v_colabs <> v_vinculos then
    raise exception 'Backfill falhou: % colaboradores vs % vínculos ativos', v_colabs, v_vinculos;
  end if;
end $$;

commit;
