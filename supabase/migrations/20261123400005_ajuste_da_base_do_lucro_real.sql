-- Decisão 277 §9 (23/11/2026): o ajuste da base do lucro real na aprovação.
--
-- No lucro real, o sistema estima o IRPJ e a CSLL pelo lucro bruto dos jobs
-- (faturamento − ISS/PIS/COFINS − custo das NFs de fornecedor + créditos):
-- não vê folha, aluguel e as outras despesas, e o custo só conta a NF já
-- lançada. No 4T/2026 da California a base ficou em R$ 13,6 mi contra cerca
-- de R$ 2,25 mi na planilha. O Tiago decidiu (23/11):
--   - o ajuste entra NA BASE, uma linha só — "(−) Despesas e ajustes do Lucro
--     Real" — que vale para as duas guias do CNPJ e trimestre (IRPJ e CSLL);
--     o sistema refaz IRPJ 15% + adicional 10% e CSLL 9%;
--   - ele só fica registrado quando a guia é APROVADA com ele: não é um
--     lançamento parcial de imposto durante a apuração.
--
-- Por isso o ajuste mora na aprovação (`fiscal_aprovacoes`), ao lado do
-- calculado e do valor da guia. O cálculo do sistema (lib/fiscal/apuracao.ts)
-- lê o ajuste da aprovação do IRPJ ou da CSLL do trimestre e o aplica nas
-- duas guias; a segunda aprovação do par herda o mesmo ajuste.
--
-- Aditiva: duas colunas novas (nulas = sem ajuste) e a função de aprovar com
-- dois parâmetros a mais, com default nulo — as chamadas de hoje continuam
-- valendo. A assinatura antiga sai na mesma migration para o PostgREST não
-- ter duas candidatas com os mesmos nomes de parâmetro.

alter table public.fiscal_aprovacoes
  add column if not exists ajuste_base numeric(14, 2),
  add column if not exists ajuste_base_motivo text;

comment on column public.fiscal_aprovacoes.ajuste_base is
  'Decisão 277 §9: IRPJ/CSLL do lucro real — o ajuste da base (R$, com sinal: negativo reduz) aprovado com a guia; vale para o par do mesmo CNPJ e trimestre. Nulo = sem ajuste.';
comment on column public.fiscal_aprovacoes.ajuste_base_motivo is
  'Decisão 277 §9: o motivo do ajuste da base (mínimo de 10 caracteres).';

alter table public.fiscal_aprovacoes
  drop constraint if exists chk_fiscal_aprovacao_ajuste_base;
alter table public.fiscal_aprovacoes
  add constraint chk_fiscal_aprovacao_ajuste_base check (
    ajuste_base is null
    or (
      tributo in ('IRPJ', 'CSLL')
      and periodo = 'trimestral'
      and not diferenca
      and ajuste_base <> 0
      and length(btrim(coalesce(ajuste_base_motivo, ''))) >= 10
    )
  );

drop function if exists public.aprovar_guia_fiscal(
  uuid, text, text, uuid, uuid, text, text, text, text, text, numeric, numeric, text, boolean, jsonb, jsonb, jsonb, jsonb, text, jsonb
);

create or replace function public.aprovar_guia_fiscal(
  p_tenant_id uuid,
  p_chave text,
  p_tributo text,
  p_empresa_contabil_id uuid,
  p_estabelecimento_id uuid,
  p_competencia text,
  p_periodo text,
  p_rotulo_competencia text,
  p_titulo text,
  p_codigo_receita text,
  p_valor_calculado numeric,
  p_valor_guia numeric,
  p_justificativa text,
  p_diferenca boolean,
  p_compensacoes jsonb,
  p_cotas jsonb,
  p_memoria jsonb,
  p_rateio jsonb,
  p_guia_path text,
  p_titulos jsonb,
  p_ajuste_base numeric default null,
  p_ajuste_base_motivo text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid         uuid;
  v_id          uuid;
  v_imposto_id  uuid;
  v_t           jsonb;
  v_soma        numeric := 0;
  v_ajuste      numeric := p_ajuste_base;
  v_motivo      text := nullif(btrim(coalesce(p_ajuste_base_motivo, '')), '');
  v_chave_par   text;
  v_par_existe  boolean := false;
  v_par_ajuste  numeric;
  v_par_motivo  text;
begin
  v_uid := public._exige_financeiro_fiscal(p_tenant_id);

  if not exists (select 1 from public.empresas_contabeis ec where ec.id = p_empresa_contabil_id and ec.tenant_id = p_tenant_id) then
    raise exception 'Empresa contábil não encontrada.';
  end if;
  if p_estabelecimento_id is not null and not exists (
    select 1 from public.fiscal_estabelecimentos fe
     where fe.id = p_estabelecimento_id and fe.tenant_id = p_tenant_id
       and fe.empresa_contabil_id = p_empresa_contabil_id
  ) then
    raise exception 'O CNPJ da guia não é desta empresa contábil.';
  end if;
  if coalesce(p_diferenca, false) then
    if not exists (select 1 from public.fiscal_aprovacoes a
                    where a.tenant_id = p_tenant_id and a.chave = p_chave and not a.diferenca) then
      raise exception 'A diferença só se aprova depois da guia aprovada.';
    end if;
  elsif exists (select 1 from public.fiscal_aprovacoes a
                 where a.tenant_id = p_tenant_id and a.chave = p_chave and not a.diferenca) then
    raise exception 'Esta guia já foi aprovada.';
  end if;
  if p_valor_guia is null or p_valor_guia < 0 then
    raise exception 'Informe o valor da guia.';
  end if;
  if abs(coalesce(p_valor_guia, 0) - coalesce(p_valor_calculado, 0)) >= 0.005
     and length(btrim(coalesce(p_justificativa, ''))) < 10 then
    raise exception 'O valor da guia é diferente do calculado: explique em pelo menos 10 caracteres.';
  end if;

  -- Decisão 277 §9: o ajuste da base do lucro real vale para o par (IRPJ e
  -- CSLL do mesmo CNPJ e trimestre). A chave é "irpj|<pj>|<trimestre>".
  if p_tributo in ('IRPJ', 'CSLL') and not coalesce(p_diferenca, false) then
    v_chave_par := case p_tributo when 'IRPJ' then 'csll' else 'irpj' end || substr(p_chave, 5);
    select true, a.ajuste_base, a.ajuste_base_motivo
      into v_par_existe, v_par_ajuste, v_par_motivo
      from public.fiscal_aprovacoes a
     where a.tenant_id = p_tenant_id and a.chave = v_chave_par and not a.diferenca
     limit 1;
    v_par_existe := coalesce(v_par_existe, false);
    if v_par_existe and v_par_ajuste is not null then
      -- A segunda guia do par herda o ajuste da primeira.
      if v_ajuste is not null and abs(v_ajuste - v_par_ajuste) >= 0.005 then
        raise exception 'A outra guia deste trimestre foi aprovada com outro ajuste da base. Atualize a página.';
      end if;
      v_ajuste := v_par_ajuste;
      v_motivo := coalesce(v_motivo, v_par_motivo);
    elsif v_par_existe and v_ajuste is not null then
      raise exception 'A outra guia deste trimestre foi aprovada sem ajuste da base: aqui vale só o valor da guia.';
    end if;
  end if;
  if v_ajuste is not null then
    if p_tributo not in ('IRPJ', 'CSLL') or coalesce(p_diferenca, false) or p_periodo <> 'trimestral' then
      raise exception 'O ajuste da base só vale na aprovação do IRPJ ou da CSLL do trimestre.';
    end if;
    if v_ajuste = 0 then
      v_ajuste := null;
      v_motivo := null;
    elsif length(coalesce(v_motivo, '')) < 10 then
      raise exception 'Explique o ajuste da base em pelo menos 10 caracteres.';
    end if;
  else
    v_motivo := null;
  end if;

  insert into public.fiscal_aprovacoes (
    tenant_id, chave, tributo, empresa_contabil_id, estabelecimento_id,
    competencia, periodo, data, valor_calculado, valor_guia, justificativa,
    diferenca, compensacoes_usadas, cotas, memoria, rateio, guia_path, aprovada_por,
    ajuste_base, ajuste_base_motivo
  ) values (
    p_tenant_id, p_chave, p_tributo, p_empresa_contabil_id, p_estabelecimento_id,
    p_competencia, p_periodo, (now() at time zone 'America/Sao_Paulo')::date,
    round(p_valor_calculado, 2), round(p_valor_guia, 2), nullif(btrim(coalesce(p_justificativa, '')), ''),
    coalesce(p_diferenca, false), coalesce(p_compensacoes, '[]'::jsonb), p_cotas,
    coalesce(p_memoria, '[]'::jsonb), coalesce(p_rateio, '[]'::jsonb), p_guia_path, v_uid,
    round(v_ajuste, 2), v_motivo
  )
  returning id into v_id;

  for v_t in select value from jsonb_array_elements(coalesce(p_titulos, '[]'::jsonb))
  loop
    insert into public.impostos_a_pagar (
      tenant_id, aprovacao_id, origem, tributo, titulo, codigo_receita,
      empresa_contabil_id, estabelecimento_id, competencia, rotulo_competencia,
      cota_numero, cota_total, juros_pct, descricao, vencimento,
      principal, juros, valor, guia_path, criado_por
    ) values (
      p_tenant_id, v_id,
      case when coalesce(p_diferenca, false) then 'diferenca' else 'apuracao' end,
      p_tributo, p_titulo, p_codigo_receita,
      p_empresa_contabil_id, p_estabelecimento_id, p_competencia, p_rotulo_competencia,
      nullif(v_t->>'cota_numero', '')::smallint, nullif(v_t->>'cota_total', '')::smallint,
      nullif(v_t->>'juros_pct', '')::numeric,
      v_t->>'descricao', (v_t->>'vencimento')::date,
      round((v_t->>'principal')::numeric, 2), round(coalesce((v_t->>'juros')::numeric, 0), 2),
      round((v_t->>'valor')::numeric, 2), p_guia_path, v_uid
    )
    returning id into v_imposto_id;

    perform public._imposto_gravar_rateio(
      p_tenant_id, v_imposto_id, round((v_t->>'valor')::numeric, 2), v_t->'rateio'
    );
    v_soma := v_soma + round((v_t->>'principal')::numeric, 2);
  end loop;

  if abs(v_soma - round(p_valor_guia, 2)) >= 0.005 then
    raise exception 'Os títulos (%) não fecham com o valor da guia (%).', v_soma, p_valor_guia;
  end if;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (
    p_tenant_id, 'fiscal_aprovacao', v_id::text,
    case when coalesce(p_diferenca, false) then 'fiscal.diferenca_aprovada' else 'fiscal.guia_aprovada' end,
    v_uid,
    jsonb_build_object(
      'chave', p_chave, 'tributo', p_tributo, 'competencia', p_competencia,
      'valor_calculado', p_valor_calculado, 'valor_guia', p_valor_guia,
      'justificativa', p_justificativa,
      'titulos', jsonb_array_length(coalesce(p_titulos, '[]'::jsonb)),
      'ajuste_base', v_ajuste,
      'ajuste_base_motivo', v_motivo,
      'ajuste_base_herdado', v_par_existe and v_par_ajuste is not null
    )
  );

  return v_id;
end;
$function$;

revoke all on function public.aprovar_guia_fiscal(
  uuid, text, text, uuid, uuid, text, text, text, text, text, numeric, numeric, text, boolean, jsonb, jsonb, jsonb, jsonb, text, jsonb, numeric, text
) from public, anon;
grant execute on function public.aprovar_guia_fiscal(
  uuid, text, text, uuid, uuid, text, text, text, text, text, numeric, numeric, text, boolean, jsonb, jsonb, jsonb, jsonb, text, jsonb, numeric, text
) to authenticated;
