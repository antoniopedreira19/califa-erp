-- Motivo: adiciona coluna data_limite_gozo em colaboradores_ferias_periodos.
-- Representa a última data em que o colaborador pode COMEÇAR as férias e
-- ainda caberem 30 dias dentro do concessivo — padrão contábil universal.
--
-- Fórmula: data_limite_gozo = aquisitivo_fim + 11 meses
-- Equivalente a: concessivo_fim − 1 mês
--
-- Por que esse é o campo certo:
--   - É o que o mercado contábil padrão usa (visto em programação de férias
--     da GO CRAZY Consultoria enviada pelo RH).
--   - É o que a Mari/Maria olham na prática (planilha "Controle de Férias").
--   - Garante 30 dias de margem antes do vencimento.
--
-- Também ajusta:
--   - fn_gerar_ferias_periodos: preenche o campo nos novos períodos.
--   - fn_recalcular_status_periodo: usa data_limite_gozo (não concessivo_fim)
--     na regra de "em alerta" (60 dias antes).
--
-- NÃO é destrutivo: só adiciona coluna + backfill.

-- 1. Coluna
alter table public.colaboradores_ferias_periodos
  add column if not exists data_limite_gozo date;

comment on column public.colaboradores_ferias_periodos.data_limite_gozo is
  'Última data em que o colaborador pode COMEÇAR a gozar o período e ainda caberem 30 dias dentro do concessivo. Fórmula: aquisitivo_fim + 11 meses. É o campo que RH/contabilidade usam na prática — "data limite" na planilha operacional da California.';

-- 2. Backfill
update public.colaboradores_ferias_periodos
   set data_limite_gozo = (aquisitivo_fim + interval '11 months')::date
 where data_limite_gozo is null;

-- 3. Agora torna not null
alter table public.colaboradores_ferias_periodos
  alter column data_limite_gozo set not null;

-- 4. Reescreve fn_gerar_ferias_periodos pra incluir o campo
create or replace function public.fn_gerar_ferias_periodos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inicio date;
  v_fim date;
  v_concessivo_fim date;
  v_data_limite date;
  v_numero int;
  v_hoje date := current_date;
  v_limite date;
begin
  if new.data_admissao is null then
    return new;
  end if;

  delete from public.colaboradores_ferias_periodos p
   where p.colaborador_id = new.id
     and not exists (
       select 1
         from information_schema.tables
        where table_schema = 'public'
          and table_name = 'colaboradores_ferias_lancamentos'
     );

  v_limite := v_hoje + interval '2 years';
  v_numero := 1;
  v_inicio := new.data_admissao;

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
      new.tenant_id, new.id, v_numero,
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

  return new;
end;
$function$;

-- 5. Reescreve fn_recalcular_status_periodo pra usar data_limite_gozo
create or replace function public.fn_recalcular_status_periodo(p_periodo_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_periodo public.colaboradores_ferias_periodos%rowtype;
  v_dias_usados int;
  v_hoje date := current_date;
begin
  select * into v_periodo
    from public.colaboradores_ferias_periodos
   where id = p_periodo_id;

  if not found then return; end if;

  select coalesce(sum(dias), 0) into v_dias_usados
    from public.colaboradores_ferias_lancamentos
   where periodo_id = p_periodo_id
     and status in ('aprovado', 'concluido');

  update public.colaboradores_ferias_periodos
     set status = case
       when v_hoje <= v_periodo.aquisitivo_fim then 'incompleto'::public.ferias_periodo_status
       when v_dias_usados >= v_periodo.dias_direito then 'regularizado'::public.ferias_periodo_status
       when v_hoje > v_periodo.concessivo_fim then 'vencido'::public.ferias_periodo_status
       when (v_periodo.data_limite_gozo - v_hoje) <= 60 then 'em_alerta'::public.ferias_periodo_status
       else 'apto'::public.ferias_periodo_status
     end
   where id = p_periodo_id;
end;
$$;

-- 6. Atualiza índice parcial pra usar data_limite_gozo
drop index if exists idx_ferias_periodos_concessivo_fim;
create index if not exists idx_ferias_periodos_data_limite
  on public.colaboradores_ferias_periodos (data_limite_gozo)
  where status in ('apto', 'em_alerta');
