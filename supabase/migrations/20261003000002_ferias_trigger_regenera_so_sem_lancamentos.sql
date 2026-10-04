-- =============================================================
-- Férias: trigger de geração de períodos protegida contra
-- regeneração indevida (2026-10-03)
--
-- Bug anterior:
--   A trigger fn_gerar_ferias_periodos tentava deletar os períodos
--   obsoletos com um NOT EXISTS que consultava information_schema
--   (verificando se a tabela colaboradores_ferias_lancamentos EXISTE
--   no schema). Como ela existe, o NOT EXISTS era sempre false e o
--   DELETE nunca rodava. Resultado: alterar data_admissao de um
--   colaborador deixava os períodos antigos no banco e só inseria
--   números que ainda não existiam. O ON CONFLICT silencioso
--   mascarava tudo.
--
--   Caso real: Antonio Pedreira (TESTE) tinha data_admissao mudada
--   de 2026-09-28 → 2025-01-01, mas os 3 primeiros períodos ficaram
--   começando em 2026-09-28 e um quarto período isolado em
--   2028-01-01. Nenhum batia com a admissão atual.
--
-- Comportamento novo:
--   1. INSERT: sempre gera os períodos a partir da data_admissao.
--   2. UPDATE sem mudança de data_admissao / tipo_contratacao:
--      no-op (não desperdiça trabalho).
--   3. UPDATE que muda data_admissao:
--      a. Se o colaborador JÁ TEM lançamentos de férias
--         (aprovado/concluído/pendente/em análise): NÃO regenera.
--         Loga aviso. A alteração da admissão fica persistida mas
--         os períodos NÃO são reajustados automaticamente. Fica a
--         cargo do dev fazer o ajuste manual.
--      b. Se o colaborador NÃO TEM lançamentos: deleta todos os
--         períodos existentes e regenera do zero com a admissão
--         nova.
--
-- Sócios continuam excluídos (migration 20261002000012).
--
-- Essa migration não roda backfill — a correção dos períodos do
-- Antonio é feita por UPDATE explícito depois da migration (ver
-- script no commit).
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
  v_tem_lancamento boolean;
  v_admissao_mudou boolean;
begin
  if new.data_admissao is null then
    return new;
  end if;

  -- Sócios não têm direito a férias — pula a geração.
  if new.tipo_contratacao = 'socio' then
    return new;
  end if;

  -- Em UPDATE sem mudança de data_admissao, não refaz nada.
  -- (TG_OP é 'UPDATE' quando vem de UPDATE, 'INSERT' quando vem de INSERT.)
  if tg_op = 'UPDATE' then
    v_admissao_mudou :=
      coalesce(old.data_admissao, '0001-01-01'::date)
      is distinct from new.data_admissao;
    if not v_admissao_mudou then
      return new;
    end if;
  end if;

  -- Checa se já há lançamentos linkados a algum período desse colaborador.
  -- Só olha status que indicam uso real (aprovado, concluído, pendente,
  -- em análise) — reprovado/cancelado não travam porque não comprometem
  -- saldo nem histórico operacional.
  select exists (
    select 1
      from public.colaboradores_ferias_lancamentos l
     where l.colaborador_id = new.id
       and l.status in (
         'aprovado',
         'concluido',
         'pendente_aprovacao',
         'em_analise'
       )
  ) into v_tem_lancamento;

  -- Se há lançamentos E a admissão mudou, NÃO regenera.
  -- Mantém os períodos atuais pra não quebrar os lançamentos. Loga
  -- aviso pra o dev perceber e tratar manualmente se precisar.
  if v_tem_lancamento and tg_op = 'UPDATE' then
    raise warning
      'fn_gerar_ferias_periodos: data_admissao de % mudou mas há % lançamentos ativos. Períodos NÃO regenerados — ajustar manualmente se necessário.',
      new.id,
      (select count(*) from public.colaboradores_ferias_lancamentos
        where colaborador_id = new.id
          and status in ('aprovado','concluido','pendente_aprovacao','em_analise'));
    return new;
  end if;

  -- Sem lançamentos: pode limpar tudo e regenerar do zero.
  delete from public.colaboradores_ferias_periodos
   where colaborador_id = new.id;

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
