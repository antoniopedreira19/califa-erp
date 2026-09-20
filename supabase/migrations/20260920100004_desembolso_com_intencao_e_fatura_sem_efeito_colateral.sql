-- =====================================================================
-- Decisão 093, §12 — desembolso com intenção de pagamento, e a leitura da
-- fatura sem efeito colateral
-- =====================================================================
-- Duas coisas que o teste geral de 20/09/2026 deixou à mostra:
--
-- 1) O DESEMBOLSO não tinha intenção de pagamento. PP e avulsa registram
--    forma e cartão antes da baixa (a PP na aprovação, a avulsa no
--    cadastro), e é por isso que a previsão de caixa deles cai no
--    vencimento da fatura; o desembolso aprovado ficava na data do título
--    até alguém baixá-lo no cartão. Ganha as duas colunas — a aprovação
--    passa a gravá-las, como a PP — e a `vw_fluxo_caixa` passa a projetá-lo
--    pela fatura quando a intenção é cartão. Nada de fatura é gravado na
--    aprovação: isso continua sendo da baixa (regra da 093).
--
-- 2) `fatura_aberta_do_cartao(cartao, data)` INSERIA a fatura quando ela não
--    existia — uma função com nome de leitura escrevendo no banco. Um
--    `select fatura_aberta_do_cartao(...)` de conferência criou a FC-00004
--    vazia. A leitura vira leitura de verdade (`stable`, devolve NULL quando
--    não há fatura aberta para aquela competência) e quem precisa CRIAR
--    chama `garantir_fatura_aberta_do_cartao`, com o corpo antigo. Só dois
--    lugares criam: `cartao_lancar_item` (a baixa) e o legado
--    `rotear_pp_para_cartao`. A fatura vazia é apagada fora da migration,
--    com o aval do Tiago (linha do banco).
--
-- Aditiva: colunas novas, função nova, `create or replace` das existentes,
-- troca de trecho na view (padrão da 20260916170003).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Desembolso: a intenção de pagamento
-- ---------------------------------------------------------------------
alter table public.desembolsos
  add column if not exists forma_pagamento forma_pagamento null,
  add column if not exists cartao_credito_id uuid null references public.cartoes_credito(id) on delete restrict;

create index if not exists desembolsos_cartao_credito_id_idx
  on public.desembolsos (cartao_credito_id)
  where cartao_credito_id is not null;

comment on column public.desembolsos.forma_pagamento is
  'Intenção de pagamento registrada na aprovação (decisão 093 §12). Cartão aqui NÃO amarra a fatura — isso é da baixa; serve para pré-preencher a baixa e para a previsão de caixa cair no vencimento da fatura.';
comment on column public.desembolsos.cartao_credito_id is
  'Cartão da intenção (ver forma_pagamento). A fatura só nasce na baixa.';

-- ---------------------------------------------------------------------
-- 2) Fatura: leitura sem efeito colateral
-- ---------------------------------------------------------------------
-- O corpo antigo, agora com o nome que diz o que faz.
create or replace function public.garantir_fatura_aberta_do_cartao(p_cartao_id uuid, p_data date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cartao      cartoes_credito%rowtype;
  v_fecha       int;
  v_competencia date;
  v_vencimento  date;
  v_fatura_id   uuid;
  v_status      fatura_cartao_status;
  v_ultimo_dia  int;
  v_ano         int;
  v_mes         int;
  v_data        date;
  v_voltas      int := 0;
begin
  select * into v_cartao from cartoes_credito where id = p_cartao_id;
  if not found then raise exception 'Cartão não encontrado: %', p_cartao_id; end if;

  v_fecha := coalesce(v_cartao.dia_fechamento_fatura, v_cartao.dia_vencimento_fatura);
  v_data := p_data;

  loop
    v_voltas := v_voltas + 1;
    if v_voltas > 24 then
      raise exception
        'Não achei fatura aberta para o cartão % em dois anos de competências. Alguma fatura futura foi fechada adiantada?',
        v_cartao.nome;
    end if;

    v_ano := extract(year  from v_data);
    v_mes := extract(month from v_data);
    if extract(day from v_data)::int > v_fecha then
      v_mes := v_mes + 1;
    end if;
    v_ano := v_ano + ((v_mes - 1) / 12);
    v_mes := ((v_mes - 1) % 12) + 1;

    v_ultimo_dia := extract(day from
      (date_trunc('month', make_date(v_ano, v_mes, 1)) + interval '1 month - 1 day')::date);
    v_competencia := make_date(v_ano, v_mes, least(v_fecha, v_ultimo_dia));

    v_vencimento := public.proxima_fatura_cartao(p_cartao_id, v_data);

    select id, status into v_fatura_id, v_status
      from faturas_cartao
     where cartao_credito_id = p_cartao_id
       and competencia_fechamento = v_competencia;

    if not found then
      insert into faturas_cartao (
        tenant_id, cartao_credito_id, codigo,
        competencia_fechamento, data_vencimento, status, created_by
      ) values (
        v_cartao.tenant_id, p_cartao_id,
        public.gerar_codigo_fatura_cartao(v_cartao.tenant_id),
        v_competencia, v_vencimento, 'aberta', auth.uid()
      )
      returning id into v_fatura_id;

      return v_fatura_id;
    end if;

    if v_status = 'aberta' then
      return v_fatura_id;
    end if;

    v_data := v_competencia + 1;
  end loop;
end;
$$;

revoke all on function public.garantir_fatura_aberta_do_cartao(uuid, date) from public, anon;
grant execute on function public.garantir_fatura_aberta_do_cartao(uuid, date) to authenticated;

comment on function public.garantir_fatura_aberta_do_cartao(uuid, date) is
  'A fatura ABERTA em que uma compra do cartão na data cai — criando-a se ainda não existe, e rolando para a competência seguinte quando a daquela data já fechou. É a função de ESCRITA; para só consultar, fatura_aberta_do_cartao.';

-- A leitura: o mesmo cálculo, sem inserir. NULL quando a fatura daquela
-- competência (ou a próxima aberta) ainda não existe.
create or replace function public.fatura_aberta_do_cartao(p_cartao_id uuid, p_data date)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cartao      cartoes_credito%rowtype;
  v_fecha       int;
  v_competencia date;
  v_fatura_id   uuid;
  v_status      fatura_cartao_status;
  v_ultimo_dia  int;
  v_ano         int;
  v_mes         int;
  v_data        date;
  v_voltas      int := 0;
begin
  select * into v_cartao from cartoes_credito where id = p_cartao_id;
  if not found then raise exception 'Cartão não encontrado: %', p_cartao_id; end if;

  v_fecha := coalesce(v_cartao.dia_fechamento_fatura, v_cartao.dia_vencimento_fatura);
  v_data := p_data;

  loop
    v_voltas := v_voltas + 1;
    if v_voltas > 24 then
      return null;
    end if;

    v_ano := extract(year  from v_data);
    v_mes := extract(month from v_data);
    if extract(day from v_data)::int > v_fecha then
      v_mes := v_mes + 1;
    end if;
    v_ano := v_ano + ((v_mes - 1) / 12);
    v_mes := ((v_mes - 1) % 12) + 1;

    v_ultimo_dia := extract(day from
      (date_trunc('month', make_date(v_ano, v_mes, 1)) + interval '1 month - 1 day')::date);
    v_competencia := make_date(v_ano, v_mes, least(v_fecha, v_ultimo_dia));

    select id, status into v_fatura_id, v_status
      from faturas_cartao
     where cartao_credito_id = p_cartao_id
       and competencia_fechamento = v_competencia;

    -- Não existe: é aqui que a versão antiga inseria. A leitura para.
    if not found then
      return null;
    end if;

    if v_status = 'aberta' then
      return v_fatura_id;
    end if;

    v_data := v_competencia + 1;
  end loop;
end;
$$;

comment on function public.fatura_aberta_do_cartao(uuid, date) is
  'Só LEITURA (stable): a fatura aberta em que uma compra do cartão na data cairia, ou NULL se ela ainda não existe. Não cria nada — quem cria é garantir_fatura_aberta_do_cartao (migration 20260920100004).';

-- Quem CRIA passa a chamar a função de escrita. Troca de trecho exato no
-- corpo que está no banco, com a âncora conferida.
do $patch$
declare
  v text;
  n int;
begin
  -- 2a) cartao_lancar_item (a baixa no cartão)
  v := pg_get_functiondef('public.cartao_lancar_item'::regproc);
  n := (length(v) - length(replace(v, 'public.fatura_aberta_do_cartao(p_cartao_id, p_data)', ''))) / length('public.fatura_aberta_do_cartao(p_cartao_id, p_data)');
  if n <> 1 then
    raise exception 'cartao_lancar_item: esperava 1 chamada a fatura_aberta_do_cartao, achei %.', n;
  end if;
  v := replace(v, 'public.fatura_aberta_do_cartao(p_cartao_id, p_data)', 'public.garantir_fatura_aberta_do_cartao(p_cartao_id, p_data)');
  execute v;

  -- 2b) rotear_pp_para_cartao (legado, anterior à 093)
  v := pg_get_functiondef('public.rotear_pp_para_cartao'::regproc);
  n := (length(v) - length(replace(v, 'public.fatura_aberta_do_cartao(', ''))) / length('public.fatura_aberta_do_cartao(');
  if n <> 1 then
    raise exception 'rotear_pp_para_cartao: esperava 1 chamada a fatura_aberta_do_cartao, achei %.', n;
  end if;
  v := replace(v, 'public.fatura_aberta_do_cartao(', 'public.garantir_fatura_aberta_do_cartao(');
  execute v;
end
$patch$;

-- ---------------------------------------------------------------------
-- 3) Fluxo de caixa: desembolso com intenção de cartão cai na fatura
-- ---------------------------------------------------------------------
do $patch$
declare
  v text := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);
  des_antes text := E'    par.data_pagamento AS data_evento,\n    ((par.valor * dr.fator))::numeric(14,2) AS valor,';
  des_depois text := E'    CASE\n'
    || E'        WHEN (((d.forma_pagamento)::text = ''cartao_credito''::text) AND (d.cartao_credito_id IS NOT NULL)) THEN proxima_fatura_cartao(d.cartao_credito_id, par.data_pagamento)\n'
    || E'        ELSE par.data_pagamento\n'
    || E'    END AS data_evento,\n    ((par.valor * dr.fator))::numeric(14,2) AS valor,';
  n int;
begin
  n := (length(v) - length(replace(v, des_antes, ''))) / length(des_antes);
  if n <> 1 then
    raise exception 'vw_fluxo_caixa: a âncora do desembolso aparece % vez(es), e precisava aparecer uma. A view mudou; revise a migration.', n;
  end if;
  v := replace(v, des_antes, des_depois);
  v := rtrim(rtrim(v), ';');
  execute 'create or replace view public.vw_fluxo_caixa as ' || v;
end
$patch$;
