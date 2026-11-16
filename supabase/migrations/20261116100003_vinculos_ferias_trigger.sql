-- Subsistema "Vínculos de Colaborador" — Fase 1, Sessão S3.
-- Spec: docs/modulos/rh/70-vinculos-colaborador.md
-- Plano: docs/modulos/rh/72-vinculos-colaborador-plano-de-execucao.md §S3
--
-- Troca a base de contagem de aquisitivos de férias de
-- `colaboradores.data_admissao` para `vinculo_ativo.data_inicio` (via
-- helper fn_data_base_ferias criada em S1).
--
-- Também cria 2 triggers em colaborador_vinculos:
--   - fn_vinculo_regenera_ferias: regenera aquisitivos quando vínculo muda.
--   - fn_colab_sincroniza_tipo_do_vinculo_ativo: mantém
--     colaboradores.tipo_contratacao sincronizado com vínculo ativo.
--
-- Comportamento pros 204 colaboradores atuais: **idêntico**.
-- A trigger existente em colaboradores continua disparando quando
-- data_admissao muda, e fn_data_base_ferias retorna exatamente
-- data_admissao (vínculo foi backfilled com valor igual).
--
-- A migration separa a lógica de regeneração em
-- fn_regenerar_ferias_periodos_de_colab (função normal, não trigger)
-- pra ambos triggers (colaboradores + colaborador_vinculos) chamarem
-- a mesma coisa. Evita duplicação e divergência futura.

-- ============================================================
-- 1. Função extraída: regenera aquisitivos de UM colaborador
-- ============================================================
-- Lógica igual à antiga fn_gerar_ferias_periodos (que agora vira
-- apenas um wrapper que decide SE chama essa função), com uma única
-- mudança real: v_inicio vem de fn_data_base_ferias em vez de
-- data_admissao direto.

create or replace function public.fn_regenerar_ferias_periodos_de_colab(
  p_colaborador_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_colab record;
  v_inicio date;
  v_fim date;
  v_concessivo_fim date;
  v_data_limite date;
  v_numero int;
  v_hoje date := current_date;
  v_limite date;
  v_tem_lancamento boolean;
begin
  select id, tenant_id, data_admissao, tipo_contratacao
    into v_colab
    from public.colaboradores
   where id = p_colaborador_id;

  if v_colab.id is null then return; end if;
  if v_colab.data_admissao is null then return; end if;
  if v_colab.tipo_contratacao = 'socio' then return; end if;

  -- Guarda: tem lançamento ativo? Não regenera (loga warning).
  select exists (
    select 1 from public.colaboradores_ferias_lancamentos l
     where l.colaborador_id = p_colaborador_id
       and l.status in ('aprovado','concluido','pendente_aprovacao','em_analise')
  ) into v_tem_lancamento;

  if v_tem_lancamento then
    raise warning
      'fn_regenerar_ferias_periodos_de_colab: colaborador % tem lançamentos ativos, períodos NÃO regenerados.',
      p_colaborador_id;
    return;
  end if;

  -- Apaga os existentes e regenera.
  delete from public.colaboradores_ferias_periodos
   where colaborador_id = p_colaborador_id;

  v_limite := v_hoje + interval '2 years';
  v_numero := 1;
  v_inicio := public.fn_data_base_ferias(p_colaborador_id, v_colab.data_admissao);

  while v_inicio <= v_limite loop
    v_fim := v_inicio + interval '1 year' - interval '1 day';
    v_concessivo_fim := v_fim + interval '1 year';
    v_data_limite := (v_fim + interval '11 months')::date;

    insert into public.colaboradores_ferias_periodos (
      tenant_id, colaborador_id, numero,
      aquisitivo_inicio, aquisitivo_fim,
      concessivo_inicio, concessivo_fim,
      data_limite_gozo,
      dias_direito, status
    ) values (
      v_colab.tenant_id, v_colab.id, v_numero,
      v_inicio, v_fim,
      v_fim + 1, v_concessivo_fim,
      v_data_limite,
      30,
      case
        when v_hoje <= v_fim then 'incompleto'::public.ferias_periodo_status
        when v_hoje > v_concessivo_fim::date then 'vencido'::public.ferias_periodo_status
        when (v_data_limite - v_hoje) <= 60 then 'em_alerta'::public.ferias_periodo_status
        else 'apto'::public.ferias_periodo_status
      end
    )
    on conflict (colaborador_id, numero) do nothing;

    v_inicio := v_fim + 1;
    v_numero := v_numero + 1;
  end loop;
end $$;

-- ============================================================
-- 2. Trigger em colaboradores: wrapper fino que só decide SE regenera
-- ============================================================
-- Antes essa função tinha toda a lógica inline. Agora delega pra
-- fn_regenerar_ferias_periodos_de_colab. Mantém a mesma guarda de
-- "só regenera se data_admissao mudou" pra preservar comportamento
-- em UPDATE de outros campos de colaboradores (nome, foto, etc).

create or replace function public.fn_gerar_ferias_periodos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_admissao_mudou boolean;
begin
  if new.data_admissao is null then return new; end if;
  if new.tipo_contratacao = 'socio' then return new; end if;

  if tg_op = 'UPDATE' then
    v_admissao_mudou :=
      coalesce(old.data_admissao, '0001-01-01'::date)
      is distinct from new.data_admissao;
    if not v_admissao_mudou then
      return new;
    end if;
  end if;

  perform public.fn_regenerar_ferias_periodos_de_colab(new.id);
  return new;
end $$;

-- ============================================================
-- 3. Trigger em colaborador_vinculos: regenera férias quando vínculo muda
-- ============================================================

create or replace function public.fn_vinculo_regenera_ferias()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_colab_id uuid;
begin
  v_colab_id := coalesce(new.colaborador_id, old.colaborador_id);
  perform public.fn_regenerar_ferias_periodos_de_colab(v_colab_id);
  return null;
end $$;

create trigger trg_vinculo_regenera_ferias
  after insert or update or delete on public.colaborador_vinculos
  for each row execute function public.fn_vinculo_regenera_ferias();

-- ============================================================
-- 4. Trigger em colaborador_vinculos: sincroniza tipo_contratacao
-- ============================================================
-- Mantém colaboradores.tipo_contratacao refletindo o vínculo ativo.
-- Garante que TODAS as queries atuais que leem c.tipo_contratacao
-- continuam funcionando sem mudança. Fase 3 vai migrar queries pra
-- ler diretamente do vínculo (e aposentar a coluna).

create or replace function public.fn_colab_sincroniza_tipo_do_vinculo_ativo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tipo public.tipo_contratacao;
  v_colab_id uuid;
begin
  v_colab_id := coalesce(new.colaborador_id, old.colaborador_id);

  select tipo_contratacao into v_tipo
    from public.colaborador_vinculos
   where colaborador_id = v_colab_id
     and data_fim is null
   limit 1;

  if v_tipo is not null then
    update public.colaboradores
       set tipo_contratacao = v_tipo
     where id = v_colab_id
       and tipo_contratacao <> v_tipo;
  end if;

  return null;
end $$;

create trigger trg_vinculo_sincroniza_colab
  after insert or update or delete on public.colaborador_vinculos
  for each row execute function public.fn_colab_sincroniza_tipo_do_vinculo_ativo();

-- ============================================================
-- Nota: fn_colab_sincroniza_tipo_do_vinculo_ativo faz UPDATE em
-- colaboradores. Isso dispara fn_gerar_ferias_periodos. MAS essa
-- trigger só regenera se data_admissao mudou — como a sincronização
-- só mexe em tipo_contratacao, NÃO vai disparar regeneração extra.
-- Loop evitado por construção.
-- ============================================================
