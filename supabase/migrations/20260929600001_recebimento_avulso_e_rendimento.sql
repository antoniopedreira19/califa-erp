-- =====================================================================
-- Recebimento avulso e rendimento de aplicação viram títulos a receber
-- (decisão 124, entrega 2 da série "lançamentos e baixas", Tiago,
-- 28 e 29/09/2026)
-- =====================================================================
--
-- O botão "Recebimento avulso" de Títulos a Receber abre três tipos:
-- recebimento avulso, transferência entre contas e rendimento de
-- aplicação. Esta migration cuida dos dois primeiros que são receita; a
-- transferência vem na migration seguinte, porque mexe nas colunas
-- obrigatórias e na regra de acesso dos lançamentos.
--
-- Onde moram: na conta avulsa (`contas_avulsas`), a mesma do "Lançamento
-- avulso" de Títulos a Pagar, com natureza 'entrada'. Aprovado pelo Tiago
-- em 29/09: assim os dois herdam o rateio por regional, o "Criar / Criar e
-- dar baixa", o cancelar e o estorno (decisão 120), a projeção no fluxo de
-- caixa e o código AV na conciliação. A coluna `tipo_entrada` diz que a
-- linha é de Títulos a Receber:
--
--   * 'recebimento_avulso' — entrada sem nota fiscal (reembolso, devolução
--     de fornecedor, juros). Empresa, rateio e centro de custo escolhidos
--     na tela. Tem estorno.
--   * 'rendimento' — rendimento líquido do mês numa conta de aplicação
--     (tipo Investimento). Pede empresa e rateio (D3 b: é a DRE gerencial
--     que precisa deles). Centro de custo fixo: 10 · Receita Financeira ·
--     Rendimento de aplicação. Um por conta e por mês. A baixa só entra na
--     conta de aplicação dele. Não tem estorno (D16): errou, cancela.
--
-- A linha sem `tipo_entrada` continua sendo do contas a pagar, como
-- sempre foi — inclusive o estorno de compra no cartão, que também é
-- natureza 'entrada'.
--
-- O que mais muda:
--
--   * `vw_a_pagar` deixa de trazer as linhas com `tipo_entrada`: ela
--     alimenta os números de "a pagar" da Home, e um recebimento avulso em
--     aberto apareceria ali como conta a pagar vencida.
--   * Subtipo novo "Rendimento de aplicação" no tipo 10, como o protótipo
--     aprovado mostra. O tipo 10 só tinha "Geral (provisório)".
--   * `criar_titulo_receber_avulso(p_dados, p_rateio)` cria o título numa
--     transação só, com as regras dos dois tipos no banco. A baixa é a de
--     sempre, `dar_baixa_avulsa_com_plano`.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Colunas
-- ---------------------------------------------------------------------

alter table public.contas_avulsas
  add column if not exists tipo_entrada text,
  add column if not exists conta_bancaria_prevista_id uuid
    references public.contas_bancarias(id) on delete restrict,
  add column if not exists competencia date;

comment on column public.contas_avulsas.tipo_entrada is
  'Título de Títulos a Receber (decisão 124): recebimento_avulso ou rendimento. Nulo = conta avulsa do contas a pagar.';
comment on column public.contas_avulsas.conta_bancaria_prevista_id is
  'Rendimento: a conta de aplicação onde ele entra. A baixa só pode ser nela.';
comment on column public.contas_avulsas.competencia is
  'Rendimento: o mês do rendimento (sempre o dia 1). Um por conta e por mês.';

alter table public.contas_avulsas
  add constraint chk_avulsa_tipo_entrada_valido
    check (tipo_entrada is null or tipo_entrada in ('recebimento_avulso', 'rendimento')),
  add constraint chk_avulsa_tipo_entrada_e_entrada
    check (tipo_entrada is null or (natureza = 'entrada' and estorno_de_avulsa_id is null and forma_pagamento is null)),
  add constraint chk_avulsa_rendimento_completo
    check (
      tipo_entrada is distinct from 'rendimento'
      or (
        conta_bancaria_prevista_id is not null
        and competencia is not null
        and competencia = date_trunc('month', competencia)::date
      )
    );

create unique index if not exists uniq_rendimento_por_conta_e_mes
  on public.contas_avulsas (conta_bancaria_prevista_id, competencia)
  where tipo_entrada = 'rendimento';

create index if not exists idx_contas_avulsas_conta_prevista
  on public.contas_avulsas (conta_bancaria_prevista_id)
  where conta_bancaria_prevista_id is not null;

create index if not exists idx_contas_avulsas_tipo_entrada
  on public.contas_avulsas (tenant_id, tipo_entrada)
  where tipo_entrada is not null;


-- ---------------------------------------------------------------------
-- Plano de contas: 10 · Receita Financeira · Rendimento de aplicação
-- ---------------------------------------------------------------------

insert into public.plano_contas_subtipos (tenant_id, tipo_id, codigo, nome)
select t.tenant_id, t.id, '001', 'Rendimento de aplicação'
  from public.plano_contas_tipos t
 where t.codigo = '10'
on conflict do nothing;


-- ---------------------------------------------------------------------
-- O rendimento só entra na conta de aplicação dele
-- ---------------------------------------------------------------------

create or replace function public.rendimento_baixa_na_conta_prevista()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.conta_bancaria_baixa_id is not null then
    if new.conta_bancaria_baixa_id <> new.conta_bancaria_prevista_id then
      raise exception 'O rendimento entra na conta de aplicação em que foi lançado. Para outra conta, cancele e lance de novo.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.rendimento_baixa_na_conta_prevista() from public, anon, authenticated;

create trigger trg_rendimento_baixa_na_conta_prevista
  before update of conta_bancaria_baixa_id on public.contas_avulsas
  for each row
  when (new.tipo_entrada = 'rendimento')
  execute function public.rendimento_baixa_na_conta_prevista();


-- ---------------------------------------------------------------------
-- Rendimento não tem estorno (D16)
-- ---------------------------------------------------------------------
-- Gatilho em vez de mexer em `estornar_valor_da_baixa`: vale também para
-- a função antiga `estornar_baixa_avulsa`, que ainda está no banco.

create or replace function public.rendimento_nao_tem_estorno()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if exists (
    select 1 from public.contas_avulsas a
     where a.id = new.conta_avulsa_id
       and a.tipo_entrada = 'rendimento'
  ) then
    raise exception 'Rendimento de aplicação não tem estorno. Se foi lançado errado, cancele a baixa.';
  end if;
  return new;
end;
$$;

revoke all on function public.rendimento_nao_tem_estorno() from public, anon, authenticated;

create trigger trg_rendimento_nao_tem_estorno
  before insert on public.lancamentos_financeiros
  for each row
  when (new.origem = 'avulsa_estorno')
  execute function public.rendimento_nao_tem_estorno();


-- ---------------------------------------------------------------------
-- vw_a_pagar sem os títulos a receber
-- ---------------------------------------------------------------------
-- Definição idêntica à atual, com `a.tipo_entrada IS NULL` no ramo das
-- contas avulsas.

create or replace view public.vw_a_pagar as
 SELECT 'pp'::text AS origem_tipo,
    par.id AS origem_id,
    pp.tenant_id,
    pp.empresa_id,
    par.data_pagamento AS data_prevista,
    par.valor::numeric(14,2) AS valor,
    'saida'::natureza_lancamento AS natureza,
    (((((('PP '::text || pp.codigo) || ' '::text) || par.numero) || '/'::text) || tot.total) || ' — '::text) || "substring"(pp.servico, 1, 150) AS descricao,
    pp.fornecedor_id,
    NULL::uuid AS cliente_id,
    pp.job_id,
    pp.aprovada_em,
    pp.aprovada_por,
    NULL::uuid AS colaborador_id
   FROM pedidos_compra_parcelas par
     JOIN pedidos_compra pp ON pp.id = par.pedido_compra_id
     JOIN LATERAL ( SELECT count(*)::integer AS total
           FROM pedidos_compra_parcelas x
          WHERE x.pedido_compra_id = par.pedido_compra_id) tot ON true
  WHERE (pp.status = ANY (ARRAY['aprovada'::pp_status, 'pago'::pp_status])) AND par.pago_em IS NULL
UNION ALL
 SELECT
        CASE
            WHEN a.folha_id IS NOT NULL THEN 'folha'::text
            WHEN a.recorrente_id IS NOT NULL THEN 'recorrente'::text
            ELSE 'avulsa'::text
        END AS origem_tipo,
    a.id AS origem_id,
    a.tenant_id,
    a.empresa_id,
    COALESCE(a.data_pagamento, a.data_prevista_pagamento) AS data_prevista,
    a.valor,
    a.natureza,
    a.descricao,
    a.fornecedor_id,
    a.cliente_id,
    a.job_id,
    a.aprovada_em,
    a.aprovada_por,
    a.colaborador_id
   FROM contas_avulsas a
  WHERE a.status = 'aprovada'::conta_avulsa_status AND a.tipo_entrada IS NULL
UNION ALL
 SELECT 'desembolso'::text AS origem_tipo,
    par.id AS origem_id,
    d.tenant_id,
    d.empresa_id,
    par.data_pagamento AS data_prevista,
    par.valor,
    'saida'::natureza_lancamento AS natureza,
    (((((('Desembolso '::text || d.codigo) || ' '::text) || par.numero) || '/'::text) || tot.total) || ' — '::text) || "substring"(d.descricao, 1, 150) AS descricao,
    d.fornecedor_id,
    d.cliente_id,
    d.job_id,
    d.aprovada_em,
    d.aprovada_por,
    NULL::uuid AS colaborador_id
   FROM desembolsos_parcelas par
     JOIN desembolsos d ON d.id = par.desembolso_id
     JOIN LATERAL ( SELECT count(*)::integer AS total
           FROM desembolsos_parcelas x
          WHERE x.desembolso_id = par.desembolso_id) tot ON true
  WHERE (d.status = ANY (ARRAY['aprovada'::desembolso_status, 'pago'::desembolso_status])) AND par.pago_em IS NULL
UNION ALL
 SELECT 'pp_devolucao_verba'::text AS origem_tipo,
    d.id AS origem_id,
    d.tenant_id,
    d.empresa_id,
    d.data_pagamento AS data_prevista,
    d.valor,
    'entrada'::natureza_lancamento AS natureza,
    (('Estorno de verba '::text || pp.codigo) || ' — '::text) || "substring"(pp.servico, 1, 140) AS descricao,
    NULL::uuid AS fornecedor_id,
    NULL::uuid AS cliente_id,
    pp.job_id,
    NULL::timestamp with time zone AS aprovada_em,
    NULL::uuid AS aprovada_por,
    NULL::uuid AS colaborador_id
   FROM pp_verba_devolucoes d
     JOIN pedidos_compra pp ON pp.id = d.pedido_compra_id
  WHERE d.pago_em IS NULL;


-- ---------------------------------------------------------------------
-- Criar o título
-- ---------------------------------------------------------------------
-- p_dados (o que a tela manda):
--   tipo_entrada            'recebimento_avulso' | 'rendimento'
--   empresa_id              obrigatório nos dois
--   valor                   > 0
--   data_prevista           data prevista do recebimento (rendimento: a
--                           data do lançamento, que a tela sugere no
--                           último dia do mês)
--   descricao               recebimento avulso (rendimento gera a sua)
--   cliente_id | fornecedor_id   "Recebido de", opcional, só no avulso
--   plano_conta_tipo_id, plano_conta_subtipo_id   só no avulso
--   conta_bancaria_prevista_id, competencia       só no rendimento
-- p_rateio: [{regional_id, percentual}], obrigatório nos dois.
--
-- SECURITY INVOKER de propósito: a gravação passa pela RLS da conta avulsa
-- (empresa e regional de quem grava), como a criação do contas a pagar.

create or replace function public.criar_titulo_receber_avulso(
  p_dados jsonb,
  p_rateio jsonb
)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_uid        uuid := auth.uid();
  v_tipo       text := p_dados->>'tipo_entrada';
  v_empresa    empresas%rowtype;
  v_valor      numeric := round((p_dados->>'valor')::numeric, 2);
  v_data       date := (p_dados->>'data_prevista')::date;
  v_descricao  text := btrim(coalesce(p_dados->>'descricao', ''));
  v_tipo_pc    uuid;
  v_sub_pc     uuid;
  v_conta      contas_bancarias%rowtype;
  v_comp       date;
  v_cliente    uuid;
  v_fornecedor uuid;
  v_codigo     text;
  v_mes        text;
  v_id         uuid;
begin
  if v_uid is null then raise exception 'Sessão inválida.'; end if;

  if v_tipo is null or v_tipo not in ('recebimento_avulso', 'rendimento') then
    raise exception 'Tipo de recebimento inválido.';
  end if;

  select * into v_empresa from public.empresas where id = (p_dados->>'empresa_id')::uuid;
  if not found then raise exception 'Escolha a empresa.'; end if;

  if not (public.is_tenant_admin(v_empresa.tenant_id) or public.is_tenant_financeiro(v_empresa.tenant_id)) then
    raise exception 'Apenas admin ou financeiro pode lançar recebimento avulso.'
      using errcode = '42501';
  end if;

  if v_valor is null or v_valor <= 0 then raise exception 'Informe o valor.'; end if;
  if v_data is null then raise exception 'Informe a data.'; end if;

  if v_tipo = 'rendimento' then
    select * into v_conta from public.contas_bancarias
     where id = (p_dados->>'conta_bancaria_prevista_id')::uuid;
    if not found then raise exception 'Escolha a conta de aplicação.'; end if;
    if v_conta.tenant_id <> v_empresa.tenant_id then
      raise exception 'Conta bancária de outro tenant.';
    end if;
    if v_conta.tipo <> 'investimento' or v_conta.cartao_credito_id is not null then
      raise exception 'Rendimento só entra em conta de aplicação (tipo Investimento).';
    end if;
    if not v_conta.ativo then raise exception 'A conta de aplicação está inativa.'; end if;

    v_comp := date_trunc('month', (p_dados->>'competencia')::date)::date;
    if v_comp is null then raise exception 'Escolha o mês do rendimento.'; end if;

    if exists (
      select 1 from public.contas_avulsas
       where tipo_entrada = 'rendimento'
         and conta_bancaria_prevista_id = v_conta.id
         and competencia = v_comp
    ) then
      raise exception 'Esta conta já tem o rendimento de %. Cancele ou exclua o que existe antes de lançar de novo.',
        to_char(v_comp, 'MM/YYYY');
    end if;

    select t.id, s.id into v_tipo_pc, v_sub_pc
      from public.plano_contas_tipos t
      join public.plano_contas_subtipos s on s.tipo_id = t.id and s.codigo = '001'
     where t.tenant_id = v_empresa.tenant_id and t.codigo = '10';
    if v_sub_pc is null then
      raise exception 'Falta o subtipo "Rendimento de aplicação" no tipo 10 do plano de contas.';
    end if;

    v_mes := (array['janeiro','fevereiro','março','abril','maio','junho','julho',
                    'agosto','setembro','outubro','novembro','dezembro'])[extract(month from v_comp)::int];
    v_descricao := 'Rendimento de ' || v_mes || ' de ' || extract(year from v_comp)::int
                   || ' · ' || v_conta.nome;
  else
    if length(v_descricao) < 3 then raise exception 'Informe a descrição.'; end if;

    v_tipo_pc := (p_dados->>'plano_conta_tipo_id')::uuid;
    v_sub_pc := (p_dados->>'plano_conta_subtipo_id')::uuid;
    if v_tipo_pc is null or v_sub_pc is null then
      raise exception 'Selecione o centro de custo.';
    end if;
    if not exists (
      select 1 from public.plano_contas_subtipos s
       where s.id = v_sub_pc and s.tipo_id = v_tipo_pc and s.ativo
         and s.tenant_id = v_empresa.tenant_id
    ) then
      raise exception 'Subtipo inválido ou não pertence ao tipo escolhido.';
    end if;

    v_cliente := nullif(p_dados->>'cliente_id', '')::uuid;
    v_fornecedor := nullif(p_dados->>'fornecedor_id', '')::uuid;
    if v_cliente is not null and v_fornecedor is not null then
      raise exception '"Recebido de" é um cliente ou um fornecedor, não os dois.';
    end if;
  end if;

  v_codigo := public.gerar_codigo_avulsa(v_empresa.tenant_id);

  v_id := public.criar_conta_avulsa(
    jsonb_build_object(
      'tenant_id', v_empresa.tenant_id,
      'codigo', v_codigo,
      'empresa_id', v_empresa.id,
      'descricao', v_descricao,
      'valor', v_valor,
      'natureza', 'entrada',
      'tipo_entrada', v_tipo,
      'data_prevista_pagamento', v_data,
      'data_pagamento', v_data,
      'data_pagamento_primeira', v_data,
      'cliente_id', v_cliente,
      'fornecedor_id', v_fornecedor,
      'plano_conta_tipo_id', v_tipo_pc,
      'plano_conta_subtipo_id', v_sub_pc,
      'conta_bancaria_prevista_id', case when v_tipo = 'rendimento' then v_conta.id end,
      'competencia', v_comp,
      'criado_por', v_uid,
      'aprovada_em', now(),
      'aprovada_por', v_uid
    ),
    p_rateio
  );

  return v_id;
end;
$$;

revoke all on function public.criar_titulo_receber_avulso(jsonb, jsonb) from public, anon;
grant execute on function public.criar_titulo_receber_avulso(jsonb, jsonb) to authenticated;
