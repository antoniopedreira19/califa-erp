-- =============================================================
-- Férias: exclui sócios do subsistema (2026-10-02)
--
-- Decisão de negócio: sócio (tipo_contratacao = 'socio') não é empregado
-- nem prestador com direito a férias — é titular da empresa. Nunca entra
-- em folha de férias, nunca lança gozos, nunca gera passivo.
--
-- Antes dessa migration, a trigger fn_gerar_ferias_periodos gerava
-- períodos pra todos os colaboradores com data_admissao preenchida, o que
-- deixou 63 períodos de 3 sócios (Bruno Duarte Leite, Fabio Duarte Leite,
-- Rafael Ferreira de Almeida, admitidos em 2003-12-19) poluindo o Quadro
-- com status "vencido" — ruído sem ação possível.
--
-- Mudanças:
--   1. fn_gerar_ferias_periodos: retorna cedo se tipo_contratacao='socio'
--   2. DELETE dos períodos existentes de sócios (nenhum tem lançamento
--      associado — conferido antes de aplicar; mudança destrutiva segura)
-- =============================================================

create or replace function public.fn_gerar_ferias_periodos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
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

  -- Sócios não têm direito a férias — pula a geração.
  if new.tipo_contratacao = 'socio' then
    return new;
  end if;

  -- Limpa períodos ainda não-utilizados e regenera
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
$$;

-- Backfill: remove períodos existentes de sócios.
-- Mudança destrutiva confirmada em 2026-10-02: 63 períodos, 0 lançamentos
-- associados, 3 colaboradores afetados (todos sócios desde 2003).
delete from public.colaboradores_ferias_periodos
 where colaborador_id in (
   select id from public.colaboradores where tipo_contratacao = 'socio'
 );
