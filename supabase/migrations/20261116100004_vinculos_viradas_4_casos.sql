-- Subsistema "Vínculos de Colaborador" — Fase 1, Sessão S4.
-- Spec: docs/modulos/rh/70-vinculos-colaborador.md
-- Plano: docs/modulos/rh/72-vinculos-colaborador-plano-de-execucao.md §S4
--
-- Aplica a troca de modalidade CLT → PJ para 4 colaboradores reais do
-- tenant Califa (nomes + datas no handoff da sessão, não aqui por PII).
-- Depois desta migration:
--   - Cada um tem 2 vínculos: CLT encerrado (até véspera da virada) +
--     PJ ativo (desde a virada).
--   - Aquisitivos CLT com lançamentos CLT reais ficam como pago_rescisao
--     (preserva histórico).
--   - Aquisitivos CLT vazios (futuros gerados antes) são deletados.
--   - Aquisitivos PJ novos criados a partir da data da virada.
--   - Cada lançamento fica no aquisitivo cujas datas contêm a data_inicio
--     do lançamento — "lançamento de gozo PJ num aquisitivo PJ,
--     lançamento de gozo CLT num aquisitivo CLT".
--
-- Caso especial (4): no banco a data_admissao dele tinha sido
-- alterada pela migration 20261113100001 para 2024-08-08 como "manobra"
-- para resolver o cálculo de férias. Agora esta migration restaura a
-- admissão original 2020-04-01 e cria os vínculos corretos (CLT curto
-- + gap de 4 anos + PJ atual). Os aquisitivos PJ existentes dele
-- (a partir de 2024-08-08) permanecem válidos.
--
-- Triggers temporariamente desabilitadas pra evitar interferência
-- durante as múltiplas operações:
--   - trg_vinculo_regenera_ferias: senão tenta regenerar ao mexer em
--     vínculo e emite warnings (por causa dos lançamentos ativos).
--   - trg_vinculo_sincroniza_colab: a sincronização de tipo_contratacao
--     é desnecessária aqui — todos já estão com 'pj' no banco e o
--     vínculo ativo final também é pj.
--   - trg_ferias_lancamentos_valida_saldo: alguns colabs vão ficar com
--     overflow (lançamentos importados excedem 30d/ano). Trigger
--     bloquearia update.

begin;

-- ============================================================
-- Guardas
-- ============================================================
do $$
declare v_nome text;
begin
  select nome into v_nome from public.tenants where id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
  if v_nome <> 'Agência California' then raise exception 'Tenant errado: %', v_nome; end if;
end $$;

-- ============================================================
-- Backup defensivo
-- ============================================================
create table if not exists public._backup_20261116_s4_vinculos as
  select * from public.colaborador_vinculos
   where colaborador_id in (
     '979c372b-c322-4f8e-a198-faa2bdcdabd6', -- caso 1
     '7e759263-9821-45df-ad8b-fbede4eb4c4e', -- caso 2
     '2fb560a9-8a9a-433f-acc3-e946fc18db85', -- caso 3
     '6ca2d4cd-11ca-4d1e-aa60-4af180515b2c'  -- caso 4 (especial)
   );

create table if not exists public._backup_20261116_s4_periodos as
  select * from public.colaboradores_ferias_periodos
   where colaborador_id in (
     '979c372b-c322-4f8e-a198-faa2bdcdabd6',
     '7e759263-9821-45df-ad8b-fbede4eb4c4e',
     '2fb560a9-8a9a-433f-acc3-e946fc18db85',
     '6ca2d4cd-11ca-4d1e-aa60-4af180515b2c'
   );

create table if not exists public._backup_20261116_s4_lancamentos as
  select * from public.colaboradores_ferias_lancamentos
   where colaborador_id in (
     '979c372b-c322-4f8e-a198-faa2bdcdabd6',
     '7e759263-9821-45df-ad8b-fbede4eb4c4e',
     '2fb560a9-8a9a-433f-acc3-e946fc18db85',
     '6ca2d4cd-11ca-4d1e-aa60-4af180515b2c'
   );

create table if not exists public._backup_20261116_s4_colaboradores as
  select id, tenant_id, nome, tipo_contratacao, data_admissao
    from public.colaboradores
   where id in (
     '979c372b-c322-4f8e-a198-faa2bdcdabd6',
     '7e759263-9821-45df-ad8b-fbede4eb4c4e',
     '2fb560a9-8a9a-433f-acc3-e946fc18db85',
     '6ca2d4cd-11ca-4d1e-aa60-4af180515b2c'
   );

-- ============================================================
-- Desabilitar triggers que podem atrapalhar
-- ============================================================
alter table public.colaborador_vinculos
  disable trigger trg_vinculo_regenera_ferias;
alter table public.colaborador_vinculos
  disable trigger trg_vinculo_sincroniza_colab;
alter table public.colaboradores_ferias_lancamentos
  disable trigger trg_ferias_lancamentos_valida_saldo;

-- ============================================================
-- Caso 1 (virada 2024-12-19)
-- ============================================================
do $$
declare
  v_colab_id uuid := '979c372b-c322-4f8e-a198-faa2bdcdabd6';
  v_tenant_id uuid := 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
  v_admin_id uuid := '3a933b18-156d-48b3-b100-a8099292b1c2';
  v_virada date := '2024-12-19';
  v_vinculo_clt_id uuid;
  v_vinculo_pj_id uuid;
  v_numero int;
  v_numero_inicio int;  -- primeiro numero dos aquisitivos PJ novos
  v_inicio date;
  v_fim date;
  v_concessivo_fim date;
  v_data_limite date;
  v_hoje date := current_date;
  v_limite date := current_date + interval '2 years';
  v_status public.ferias_periodo_status;
begin
  -- 1) Vínculo CLT: UPDATE do vínculo ativo atual (backfilled PJ) pra
  --    virar CLT encerrado no dia anterior à virada.
  update public.colaborador_vinculos
     set tipo_contratacao = 'clt',
         data_fim = v_virada - 1,
         motivo_encerramento = 'rescisao_clt_para_novo_vinculo',
         observacao = 'Ajuste S4: vínculo CLT anterior à virada CLT→PJ'
   where colaborador_id = v_colab_id
     and data_fim is null
   returning id into v_vinculo_clt_id;

  -- 2) Vínculo PJ: INSERT novo vínculo ativo.
  insert into public.colaborador_vinculos
    (tenant_id, colaborador_id, tipo_contratacao, data_inicio,
     vinculo_anterior_id, created_by,
     observacao)
  values
    (v_tenant_id, v_colab_id, 'pj', v_virada,
     v_vinculo_clt_id, v_admin_id,
     'Vínculo PJ pós-rescisão CLT')
  returning id into v_vinculo_pj_id;

  -- 3) Gerar aquisitivos PJ a partir da data da virada.
  --    Guarda o "numero" inicial — tudo com numero >= v_numero_inicio
  --    é novo (PJ), com numero < v_numero_inicio é antigo (CLT/pré-S4).
  select coalesce(max(numero), 0) + 1 into v_numero
    from public.colaboradores_ferias_periodos
   where colaborador_id = v_colab_id;
  v_numero_inicio := v_numero;

  v_inicio := v_virada;
  while v_inicio <= v_limite loop
    v_fim := v_inicio + interval '1 year' - interval '1 day';
    v_concessivo_fim := v_fim + interval '1 year';
    v_data_limite := (v_fim + interval '11 months')::date;
    v_status := case
      when v_hoje <= v_fim then 'incompleto'::public.ferias_periodo_status
      when v_hoje > v_concessivo_fim::date then 'vencido'::public.ferias_periodo_status
      when (v_data_limite - v_hoje) <= 60 then 'em_alerta'::public.ferias_periodo_status
      else 'apto'::public.ferias_periodo_status
    end;

    insert into public.colaboradores_ferias_periodos (
      tenant_id, colaborador_id, numero,
      aquisitivo_inicio, aquisitivo_fim,
      concessivo_inicio, concessivo_fim,
      data_limite_gozo, dias_direito, status
    ) values (
      v_tenant_id, v_colab_id, v_numero,
      v_inicio, v_fim,
      v_fim + 1, v_concessivo_fim,
      v_data_limite, 30, v_status
    );

    v_inicio := v_fim + 1;
    v_numero := v_numero + 1;
  end loop;

  -- 4) Reassociar lançamentos pelo data_inicio. Prioriza aquisitivos
  --    NOVOS (numero >= v_numero_inicio) em caso de match — pra não
  --    deixar lanç PJ grudado em aquisitivo CLT que vai sumir.
  update public.colaboradores_ferias_lancamentos l
     set periodo_id = (
       select p.id from public.colaboradores_ferias_periodos p
       where p.colaborador_id = l.colaborador_id
         and l.data_inicio between p.aquisitivo_inicio and p.aquisitivo_fim
       order by p.aquisitivo_inicio desc
       limit 1
     )
   where l.colaborador_id = v_colab_id
     and l.data_inicio is not null
     and l.periodo_id is not null;

  -- 5) Marcar aquisitivos CLT (pré-virada) que ainda têm lançamento
  --    como pago_rescisao (preserva histórico).
  update public.colaboradores_ferias_periodos p
     set status = 'pago_rescisao'::public.ferias_periodo_status
   where p.colaborador_id = v_colab_id
     and p.aquisitivo_inicio < v_virada
     and exists (select 1 from public.colaboradores_ferias_lancamentos l where l.periodo_id = p.id);

  -- 6) Deletar aquisitivos ANTIGOS vazios. Antigos = numero <
  --    v_numero_inicio. Cobre CLT pré-virada sem lanç e aquisitivos
  --    pós-virada antigos (duplicados pelos novos que acabei de criar).
  delete from public.colaboradores_ferias_periodos p
   where p.colaborador_id = v_colab_id
     and p.numero < v_numero_inicio
     and not exists (select 1 from public.colaboradores_ferias_lancamentos l where l.periodo_id = p.id);
end $$;

-- ============================================================
-- Caso 2 (virada 2026-05-01)
-- ============================================================
do $$
declare
  v_colab_id uuid := '7e759263-9821-45df-ad8b-fbede4eb4c4e';
  v_tenant_id uuid := 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
  v_admin_id uuid := '3a933b18-156d-48b3-b100-a8099292b1c2';
  v_virada date := '2026-05-01';
  v_vinculo_clt_id uuid;
  v_vinculo_pj_id uuid;
  v_numero int;
  v_numero_inicio int;
  v_inicio date;
  v_fim date;
  v_concessivo_fim date;
  v_data_limite date;
  v_hoje date := current_date;
  v_limite date := current_date + interval '2 years';
  v_status public.ferias_periodo_status;
begin
  update public.colaborador_vinculos
     set tipo_contratacao = 'clt',
         data_fim = v_virada - 1,
         motivo_encerramento = 'rescisao_clt_para_novo_vinculo',
         observacao = 'Ajuste S4: vínculo CLT anterior à virada CLT→PJ'
   where colaborador_id = v_colab_id
     and data_fim is null
   returning id into v_vinculo_clt_id;

  insert into public.colaborador_vinculos
    (tenant_id, colaborador_id, tipo_contratacao, data_inicio,
     vinculo_anterior_id, created_by, observacao)
  values
    (v_tenant_id, v_colab_id, 'pj', v_virada,
     v_vinculo_clt_id, v_admin_id, 'Vínculo PJ pós-rescisão CLT')
  returning id into v_vinculo_pj_id;

  select coalesce(max(numero), 0) + 1 into v_numero
    from public.colaboradores_ferias_periodos
   where colaborador_id = v_colab_id;
  v_numero_inicio := v_numero;

  v_inicio := v_virada;
  while v_inicio <= v_limite loop
    v_fim := v_inicio + interval '1 year' - interval '1 day';
    v_concessivo_fim := v_fim + interval '1 year';
    v_data_limite := (v_fim + interval '11 months')::date;
    v_status := case
      when v_hoje <= v_fim then 'incompleto'::public.ferias_periodo_status
      when v_hoje > v_concessivo_fim::date then 'vencido'::public.ferias_periodo_status
      when (v_data_limite - v_hoje) <= 60 then 'em_alerta'::public.ferias_periodo_status
      else 'apto'::public.ferias_periodo_status
    end;

    insert into public.colaboradores_ferias_periodos (
      tenant_id, colaborador_id, numero,
      aquisitivo_inicio, aquisitivo_fim,
      concessivo_inicio, concessivo_fim,
      data_limite_gozo, dias_direito, status
    ) values (
      v_tenant_id, v_colab_id, v_numero,
      v_inicio, v_fim,
      v_fim + 1, v_concessivo_fim,
      v_data_limite, 30, v_status
    );

    v_inicio := v_fim + 1;
    v_numero := v_numero + 1;
  end loop;

  update public.colaboradores_ferias_lancamentos l
     set periodo_id = (
       select p.id from public.colaboradores_ferias_periodos p
       where p.colaborador_id = l.colaborador_id
         and l.data_inicio between p.aquisitivo_inicio and p.aquisitivo_fim
       order by p.aquisitivo_inicio desc
       limit 1
     )
   where l.colaborador_id = v_colab_id
     and l.data_inicio is not null
     and l.periodo_id is not null;

  update public.colaboradores_ferias_periodos p
     set status = 'pago_rescisao'::public.ferias_periodo_status
   where p.colaborador_id = v_colab_id
     and p.aquisitivo_inicio < v_virada
     and exists (select 1 from public.colaboradores_ferias_lancamentos l where l.periodo_id = p.id);

  delete from public.colaboradores_ferias_periodos p
   where p.colaborador_id = v_colab_id
     and p.numero < v_numero_inicio
     and not exists (select 1 from public.colaboradores_ferias_lancamentos l where l.periodo_id = p.id);
end $$;

-- ============================================================
-- Caso 3 (virada 2024-09-18)
-- ============================================================
do $$
declare
  v_colab_id uuid := '2fb560a9-8a9a-433f-acc3-e946fc18db85';
  v_tenant_id uuid := 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
  v_admin_id uuid := '3a933b18-156d-48b3-b100-a8099292b1c2';
  v_virada date := '2024-09-18';
  v_vinculo_clt_id uuid;
  v_vinculo_pj_id uuid;
  v_numero int;
  v_numero_inicio int;
  v_inicio date;
  v_fim date;
  v_concessivo_fim date;
  v_data_limite date;
  v_hoje date := current_date;
  v_limite date := current_date + interval '2 years';
  v_status public.ferias_periodo_status;
begin
  update public.colaborador_vinculos
     set tipo_contratacao = 'clt',
         data_fim = v_virada - 1,
         motivo_encerramento = 'rescisao_clt_para_novo_vinculo',
         observacao = 'Ajuste S4: vínculo CLT anterior à virada CLT→PJ'
   where colaborador_id = v_colab_id
     and data_fim is null
   returning id into v_vinculo_clt_id;

  insert into public.colaborador_vinculos
    (tenant_id, colaborador_id, tipo_contratacao, data_inicio,
     vinculo_anterior_id, created_by, observacao)
  values
    (v_tenant_id, v_colab_id, 'pj', v_virada,
     v_vinculo_clt_id, v_admin_id, 'Vínculo PJ pós-rescisão CLT')
  returning id into v_vinculo_pj_id;

  select coalesce(max(numero), 0) + 1 into v_numero
    from public.colaboradores_ferias_periodos
   where colaborador_id = v_colab_id;
  v_numero_inicio := v_numero;

  v_inicio := v_virada;
  while v_inicio <= v_limite loop
    v_fim := v_inicio + interval '1 year' - interval '1 day';
    v_concessivo_fim := v_fim + interval '1 year';
    v_data_limite := (v_fim + interval '11 months')::date;
    v_status := case
      when v_hoje <= v_fim then 'incompleto'::public.ferias_periodo_status
      when v_hoje > v_concessivo_fim::date then 'vencido'::public.ferias_periodo_status
      when (v_data_limite - v_hoje) <= 60 then 'em_alerta'::public.ferias_periodo_status
      else 'apto'::public.ferias_periodo_status
    end;

    insert into public.colaboradores_ferias_periodos (
      tenant_id, colaborador_id, numero,
      aquisitivo_inicio, aquisitivo_fim,
      concessivo_inicio, concessivo_fim,
      data_limite_gozo, dias_direito, status
    ) values (
      v_tenant_id, v_colab_id, v_numero,
      v_inicio, v_fim,
      v_fim + 1, v_concessivo_fim,
      v_data_limite, 30, v_status
    );

    v_inicio := v_fim + 1;
    v_numero := v_numero + 1;
  end loop;

  update public.colaboradores_ferias_lancamentos l
     set periodo_id = (
       select p.id from public.colaboradores_ferias_periodos p
       where p.colaborador_id = l.colaborador_id
         and l.data_inicio between p.aquisitivo_inicio and p.aquisitivo_fim
       order by p.aquisitivo_inicio desc
       limit 1
     )
   where l.colaborador_id = v_colab_id
     and l.data_inicio is not null
     and l.periodo_id is not null;

  update public.colaboradores_ferias_periodos p
     set status = 'pago_rescisao'::public.ferias_periodo_status
   where p.colaborador_id = v_colab_id
     and p.aquisitivo_inicio < v_virada
     and exists (select 1 from public.colaboradores_ferias_lancamentos l where l.periodo_id = p.id);

  delete from public.colaboradores_ferias_periodos p
   where p.colaborador_id = v_colab_id
     and p.numero < v_numero_inicio
     and not exists (select 1 from public.colaboradores_ferias_lancamentos l where l.periodo_id = p.id);
end $$;

-- ============================================================
-- Caso 4 (admissão original 2020-04-01, virada 2024-08-08)
-- ============================================================
-- Caso especial: data_admissao atual no banco é 2024-08-08 (foi alterada
-- pela migration 20261113100001 como "manobra"). Restauramos pra
-- 2020-04-01 (admissão original). Os aquisitivos PJ existentes dele
-- (a partir de 2024-08-08) permanecem — não geramos novos.
-- O vínculo CLT fica curto (2020-04-01 → 2020-08-07, 4 meses, sem
-- aquisitivo completo).
do $$
declare
  v_colab_id uuid := '6ca2d4cd-11ca-4d1e-aa60-4af180515b2c';
  v_tenant_id uuid := 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c';
  v_admin_id uuid := '3a933b18-156d-48b3-b100-a8099292b1c2';
  v_admissao_original date := '2020-04-01';
  v_fim_clt date := '2020-08-07';
  v_inicio_pj date := '2024-08-08';
  v_vinculo_clt_id uuid;
  v_vinculo_pj_atual_id uuid;
begin
  -- 1) Primeiro encerra o vínculo PJ atual (backfilled) e muda pra CLT
  --    com datas do contrato CLT original.
  update public.colaborador_vinculos
     set tipo_contratacao = 'clt',
         data_inicio = v_admissao_original,
         data_fim = v_fim_clt,
         motivo_encerramento = 'rescisao_clt_para_novo_vinculo',
         observacao = 'Ajuste S4: vínculo CLT original (admissão 2020-04-01 a 2020-08-07)'
   where colaborador_id = v_colab_id
     and data_fim is null
   returning id into v_vinculo_clt_id;

  -- 2) Criar vínculo PJ ativo começando em 2024-08-08.
  --    Entre 2020-08-08 e 2024-08-07 há gap sem vínculo formal
  --    (o colaborador estava fora do sistema ou informal).
  insert into public.colaborador_vinculos
    (tenant_id, colaborador_id, tipo_contratacao, data_inicio,
     vinculo_anterior_id, created_by, observacao)
  values
    (v_tenant_id, v_colab_id, 'pj', v_inicio_pj,
     v_vinculo_clt_id, v_admin_id,
     'Vínculo PJ atual (admissão como PJ após gap de ~4 anos do CLT original)')
  returning id into v_vinculo_pj_atual_id;

  -- 3) Restaurar data_admissao no colaboradores pra admissão original.
  --    A trigger fn_gerar_ferias_periodos vai disparar (data_admissao
  --    mudou) mas a guarda de "tem lançamento ativo" vai bloquear
  --    regeneração. Aquisitivos existentes ficam.
  update public.colaboradores
     set data_admissao = v_admissao_original
   where id = v_colab_id;

  -- 4) Reassociar lançamentos pelo data_inicio. Os lançamentos do
  --    deste colaborador têm datas 2025-2026 — vão cair nos aquisitivos PJ
  --    apropriados (que já existem).
  update public.colaboradores_ferias_lancamentos l
     set periodo_id = (
       select p.id from public.colaboradores_ferias_periodos p
       where p.colaborador_id = l.colaborador_id
         and l.data_inicio between p.aquisitivo_inicio and p.aquisitivo_fim
       order by p.aquisitivo_inicio desc
       limit 1
     )
   where l.colaborador_id = v_colab_id
     and l.data_inicio is not null
     and l.periodo_id is not null;

  -- 5) Deletar aquisitivos vazios anteriores à virada PJ (não deveria
  --    ter, mas defensivo).
  delete from public.colaboradores_ferias_periodos p
   where p.colaborador_id = v_colab_id
     and p.aquisitivo_inicio < v_inicio_pj
     and not exists (select 1 from public.colaboradores_ferias_lancamentos l where l.periodo_id = p.id);
end $$;

-- ============================================================
-- Reabilitar triggers
-- ============================================================
alter table public.colaborador_vinculos
  enable trigger trg_vinculo_regenera_ferias;
alter table public.colaborador_vinculos
  enable trigger trg_vinculo_sincroniza_colab;
alter table public.colaboradores_ferias_lancamentos
  enable trigger trg_ferias_lancamentos_valida_saldo;

-- ============================================================
-- Forçar recálculo de status dos aquisitivos (trigger em períodos)
-- ============================================================
update public.colaboradores_ferias_periodos
   set updated_at = now()
 where colaborador_id in (
   '979c372b-c322-4f8e-a198-faa2bdcdabd6',
   '7e759263-9821-45df-ad8b-fbede4eb4c4e',
   '2fb560a9-8a9a-433f-acc3-e946fc18db85',
   '6ca2d4cd-11ca-4d1e-aa60-4af180515b2c'
 );

commit;
