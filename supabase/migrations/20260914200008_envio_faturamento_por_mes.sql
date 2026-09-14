-- 20260914200008 — Fee e Always On: um envio para faturamento por mês
--
-- Decisão 078, entrega 3. Autorizado pelo Tiago em 14/09/2026 ("Confirmo"),
-- depois de conferir as mudanças abaixo e o motivo de cada uma.
--
-- A REGRA
--
-- Nos jobs do modelo mensal (Fee e Always On) o GP envia CADA MÊS para
-- faturamento quando o cliente valida — mesmos campos do envio de hoje, o
-- valor é o faturamento do mês na planilha, várias parcelas cuja soma fecha
-- com ele. Os outros jobs seguem com o envio único. NÃO existe devolução do
-- envio (Tiago, 14/09/2026): como hoje, o envio é definitivo.
--
-- O QUE MUDA E POR QUÊ
--
-- 1. `jobs_envio_faturamento.mes`: o mês de referência do envio. O
--    `unique (job_id)` vira dois únicos parciais — um envio por job sem mês,
--    um por job + mês. É o que hoje proíbe o segundo envio no mesmo job.
--    Nenhuma linha muda: todo envio existente fica com `mes` nulo.
-- 2. `jobs_envio_faturamento.valor_save`: a parte do envio que é receita de
--    save, calculada no envio sobre os itens do mês. A fila e o fluxo de
--    caixa separam "nota própria" de "save" pelo total do JOB; com três
--    envios, contariam o save do trimestre três vezes. Nos envios sem mês
--    nada muda — segue valendo o total do job.
-- 3. `jobs_previsao_recebimento.mes` e `.valor_save`: a previsão do job
--    mensal passa a ter uma linha por mês. Hoje qualquer envio derruba a
--    previsão do job inteiro; com o mês, o envio de julho derruba só a
--    previsão de julho.
-- 4. RPC `enviar_job_para_faturamento` grava `mes` e `valor_save`.
-- 5. `vw_faturamento_pendente`: o "próprio" da parcela do envio mensal sai
--    do próprio envio; ganha a coluna `mes_referencia` no fim.
-- 6. `vw_fluxo_caixa`: a previsão com mês só sai quando AQUELE mês foi
--    enviado; o "próprio" da previsão e da parcela mensal saem das linhas.
-- 7. `vw_saves_por_job`: o save de um mês só é oferecido depois do envio
--    daquele mês (a regra de 01/09/2026, aplicada por mês).
--
-- As três visões partem da definição viva em 14/09/2026 (conferida no
-- banco): 20260911100001, 20260911110002 e 20260901100001. Fora as trocas
-- marcadas nos comentários de cada uma, o corpo é o mesmo.
--
-- Aditivo, exceto a troca do índice único do envio (autorizada).

-- 1 e 2 ---------------------------------------------------------------
alter table public.jobs_envio_faturamento
  add column if not exists mes date,
  add column if not exists valor_save numeric(14,2);

alter table public.jobs_envio_faturamento
  add constraint chk_envio_mes_primeiro_dia
    check (mes is null or extract(day from mes) = 1),
  add constraint chk_envio_valor_save
    check (valor_save is null or (valor_save >= 0 and valor_save <= valor_faturado));

alter table public.jobs_envio_faturamento
  drop constraint jobs_envio_faturamento_job_id_key;

create unique index uniq_envio_faturamento_job_sem_mes
  on public.jobs_envio_faturamento (job_id) where mes is null;
create unique index uniq_envio_faturamento_job_mes
  on public.jobs_envio_faturamento (job_id, mes) where mes is not null;

comment on column public.jobs_envio_faturamento.mes is
  'Mês de referência do envio nos jobs do modelo mensal (Fee e Always On): primeiro dia do mês. Nulo no envio único dos outros jobs. Um envio por job sem mês, um por job + mês. Decisão 078.';
comment on column public.jobs_envio_faturamento.valor_save is
  'Parte do valor_faturado que é receita de save, calculada no envio sobre os itens do mês. Só nos envios com mês; nos outros a fila e o fluxo de caixa usam jobs.faturamento_save_previsto. Decisão 078.';

-- 3 -------------------------------------------------------------------
alter table public.jobs_previsao_recebimento
  add column if not exists mes date,
  add column if not exists valor_save numeric(14,2);

alter table public.jobs_previsao_recebimento
  add constraint chk_previsao_receb_mes_primeiro_dia
    check (mes is null or extract(day from mes) = 1),
  add constraint chk_previsao_receb_valor_save
    check (valor_save is null or (valor_save >= 0 and valor_save <= valor));

create index if not exists idx_previsao_receb_job_mes
  on public.jobs_previsao_recebimento (job_id, mes) where mes is not null;

comment on column public.jobs_previsao_recebimento.mes is
  'Mês de referência da previsão nos jobs do modelo mensal: uma linha por mês. O envio daquele mês para faturamento a substitui no fluxo de caixa. Nulo nos outros jobs. Decisão 078.';
comment on column public.jobs_previsao_recebimento.valor_save is
  'Parte do valor da previsão mensal que é receita de save do mês. Só nas linhas com mês. Decisão 078.';

-- 4 -------------------------------------------------------------------
create or replace function public.enviar_job_para_faturamento(payload jsonb)
returns uuid
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_tenant_id uuid := (payload->>'tenant_id')::uuid;
  v_job_id    uuid := (payload->>'job_id')::uuid;
  v_envio_id  uuid;
  v_parcelas  integer;
begin
  if jsonb_typeof(payload->'parcelas') is distinct from 'array'
     or jsonb_array_length(payload->'parcelas') = 0 then
    raise exception 'Informe ao menos uma parcela de faturamento.'
      using errcode = 'check_violation';
  end if;

  insert into jobs_envio_faturamento (
    tenant_id, job_id, valor_faturado, numero_po, data_faturamento,
    descricao_nf, portal_id, portal_url, enviado_por, mes, valor_save
  ) values (
    v_tenant_id,
    v_job_id,
    (payload->>'valor_faturado')::numeric,
    nullif(payload->>'numero_po', ''),
    (payload->>'data_faturamento')::date,
    payload->>'descricao_nf',
    nullif(payload->>'portal_id', '')::uuid,
    nullif(payload->>'portal_url', ''),
    nullif(payload->>'enviado_por', '')::uuid,
    nullif(payload->>'mes', '')::date,
    nullif(payload->>'valor_save', '')::numeric
  )
  returning id into v_envio_id;

  insert into jobs_envio_faturamento_parcelas (
    tenant_id, envio_id, job_id, ordem, valor, data_vencimento
  )
  select v_tenant_id, v_envio_id, v_job_id, p.ordem, p.valor, p.data_vencimento
    from jsonb_to_recordset(payload->'parcelas')
      as p(ordem smallint, valor numeric, data_vencimento date);

  get diagnostics v_parcelas = row_count;
  if v_parcelas = 0 then
    raise exception 'O envio para faturamento precisa de ao menos uma parcela.'
      using errcode = 'check_violation';
  end if;

  return v_envio_id;
end;
$$;

comment on function public.enviar_job_para_faturamento(jsonb) is
  'Grava o envio do job para faturamento e as parcelas numa transacao so. mes e valor_save so nos jobs do modelo mensal (um envio por mes). SECURITY INVOKER: RLS e GRANT valem como nos INSERTs diretos. Regras de negocio na server action. Decisoes 075 e 078.';

revoke all on function public.enviar_job_para_faturamento(jsonb) from public;
revoke all on function public.enviar_job_para_faturamento(jsonb) from anon;
grant execute on function public.enviar_job_para_faturamento(jsonb) to authenticated;

-- 5 -------------------------------------------------------------------
-- Trocas sobre a 20260911110002: o CTE `parcelas` junta o envio; o
-- `bruto_proprio` do envio com mês sai de valor_faturado - valor_save;
-- a coluna `mes_referencia` entra no fim das duas pontas do UNION.

create or replace view public.vw_faturamento_pendente as
 WITH parcela_faturada AS (
         SELECT fi.envio_parcela_id,
            sum(fi.valor)::numeric(14,2) AS valor_faturado,
            COALESCE(sum(fi.valor) FILTER (WHERE fi.origem_tipo <> 'save'::faturamento_origem), 0::numeric)::numeric(14,2) AS faturado_proprio,
            COALESCE(sum(fi.valor) FILTER (WHERE fi.origem_tipo = 'save'::faturamento_origem), 0::numeric)::numeric(14,2) AS faturado_save
           FROM faturamento_itens fi
             JOIN faturamentos f ON f.id = fi.faturamento_id
          WHERE f.status = 'emitido'::faturamento_status AND fi.envio_parcela_id IS NOT NULL
          GROUP BY fi.envio_parcela_id
        ), parcelas AS (
         SELECT par.id,
            par.envio_id,
            par.job_id,
            par.tenant_id,
            par.ordem,
            par.valor,
            par.data_vencimento,
            count(*) OVER (PARTITION BY par.envio_id)::smallint AS total,
            COALESCE(pf.valor_faturado, 0::numeric)::numeric(14,2) AS ja_faturado,
            COALESCE(pf.faturado_proprio, 0::numeric)::numeric(14,2) AS faturado_proprio,
            COALESCE(pf.faturado_save, 0::numeric)::numeric(14,2) AS faturado_save,
            GREATEST(0::numeric, LEAST(par.valor,
                CASE
                    WHEN e.mes IS NOT NULL THEN e.valor_faturado - COALESCE(e.valor_save, 0::numeric)
                    ELSE COALESCE(j.faturamento_previsto, 0::numeric) - COALESCE(j.faturamento_save_previsto, 0::numeric)
                END - (sum(par.valor) OVER (PARTITION BY par.envio_id ORDER BY par.ordem, par.id) - par.valor)))::numeric(14,2) AS bruto_proprio,
            e.mes
           FROM jobs_envio_faturamento_parcelas par
             JOIN jobs_envio_faturamento e ON e.id = par.envio_id
             JOIN jobs j ON j.id = par.job_id
             LEFT JOIN parcela_faturada pf ON pf.envio_parcela_id = par.id
        )
 SELECT 'job'::text AS origem_tipo,
    j.id AS origem_id,
    j.tenant_id,
    j.empresa_id,
    j.codigo,
    j.nome AS descricao,
    p.cliente_id,
    NULL::uuid AS fornecedor_id,
    par.valor::numeric AS valor_previsto,
    par.ja_faturado AS valor_ja_faturado,
    (par.valor - par.ja_faturado)::numeric(14,2) AS saldo,
    par.data_vencimento AS data_prevista,
    par.id AS envio_parcela_id,
    par.ordem AS parcela_numero,
    par.total AS parcela_total,
    ( SELECT sum(x.valor - x.ja_faturado)::numeric(14,2) AS sum
           FROM parcelas x
          WHERE x.envio_id = par.envio_id AND (x.valor - x.ja_faturado) > 0::numeric) AS saldo_job,
    LEAST(par.valor, par.bruto_proprio) AS valor_proprio_da_parcela,
    (par.valor - LEAST(par.valor, par.bruto_proprio))::numeric(14,2) AS valor_save_da_parcela,
    GREATEST(0::numeric, LEAST(par.valor, par.bruto_proprio) - par.faturado_proprio)::numeric(14,2) AS saldo_proprio,
    GREATEST(0::numeric, par.valor - LEAST(par.valor, par.bruto_proprio) - par.faturado_save)::numeric(14,2) AS saldo_save,
    j.id AS job_id,
    par.mes AS mes_referencia
   FROM parcelas par
     JOIN jobs j ON j.id = par.job_id
     JOIN projetos p ON p.id = j.projeto_id
  WHERE j.status = 'aberto'::job_status AND (par.valor - par.ja_faturado) > 0::numeric
UNION ALL
 SELECT 'bv'::text AS origem_tipo,
    bv.id AS origem_id,
    bv.tenant_id,
    NULL::uuid AS empresa_id,
    jbv.codigo,
    'BV — '::text || COALESCE(v.item, jio.item) AS descricao,
    NULL::uuid AS cliente_id,
    bv.fornecedor_id,
    bv.valor AS valor_previsto,
    0::numeric(14,2) AS valor_ja_faturado,
    bv.valor AS saldo,
    bv.prazo_repasse AS data_prevista,
    NULL::uuid AS envio_parcela_id,
    1::smallint AS parcela_numero,
    1::smallint AS parcela_total,
    bv.valor AS saldo_job,
    bv.valor AS valor_proprio_da_parcela,
    0::numeric(14,2) AS valor_save_da_parcela,
    bv.valor AS saldo_proprio,
    0::numeric(14,2) AS saldo_save,
    jio.job_id,
    NULL::date AS mes_referencia
   FROM itens_bv bv
     LEFT JOIN versoes_orcamento_itens v ON v.id = bv.item_versao_id
     LEFT JOIN jobs_itens_orcado jio ON jio.id = bv.job_item_orcado_id
     LEFT JOIN jobs jbv ON jbv.id = jio.job_id
  WHERE bv.situacao = 'confirmado'::bv_situacao AND NOT (EXISTS ( SELECT 1
           FROM faturamento_itens fi
             JOIN faturamentos f ON f.id = fi.faturamento_id
          WHERE fi.origem_tipo = 'bv'::faturamento_origem AND fi.origem_id = bv.id AND f.status = 'emitido'::faturamento_status));

comment on view public.vw_faturamento_pendente is
  'Fila do contas a receber: parcelas de job abertas e BVs confirmados ainda nao faturados. O BV entra pela versao OU pela copia do job (decisao 073). Nos jobs do modelo mensal cada envio e um mes (mes_referencia), e a parte propria sai do proprio envio (decisao 078).';
grant select on public.vw_faturamento_pendente to authenticated;
revoke all on public.vw_faturamento_pendente from anon;

-- 6 -------------------------------------------------------------------
-- Trocas sobre a 20260911100001: CTE `meses_com_envio`; `previsao_recebimento`
-- leva o mês e calcula o próprio da linha mensal pela própria linha;
-- `envio_saldo` junta o envio e calcula o próprio do envio mensal por ele;
-- as duas pontas que derrubavam a previsão por "job com envio" passam a
-- olhar o mês quando a previsão tem mês.

create or replace view public.vw_fluxo_caixa as
 WITH avulsa_rateio AS (
         SELECT a.id AS conta_avulsa_id,
            j.regional_id,
            1.0 AS fator
           FROM (contas_avulsas a
             JOIN jobs j ON ((j.id = a.job_id)))
        UNION ALL
         SELECT r.conta_avulsa_id,
            r.regional_id,
            (r.percentual / 100.0) AS fator
           FROM (contas_avulsas_regionais r
             JOIN contas_avulsas a ON ((a.id = r.conta_avulsa_id)))
          WHERE (a.job_id IS NULL)
        UNION ALL
         SELECT a.id,
            a.regional_id,
            1.0 AS fator
           FROM contas_avulsas a
          WHERE ((a.job_id IS NULL) AND (NOT (EXISTS ( SELECT 1
                   FROM contas_avulsas_regionais r
                  WHERE (r.conta_avulsa_id = a.id)))))
        ), desembolso_rateio AS (
         SELECT r.desembolso_id,
            r.regional_id,
            (r.percentual / 100.0) AS fator
           FROM desembolsos_regionais r
        UNION ALL
         SELECT d.id,
            NULL::uuid AS regional_id,
            1.0 AS fator
           FROM desembolsos d
          WHERE (NOT (EXISTS ( SELECT 1
                   FROM desembolsos_regionais r
                  WHERE (r.desembolso_id = d.id))))
        ), lancamento_rateio AS (
         SELECT l.id AS lancamento_id,
            ar.regional_id,
            ar.fator
           FROM (lancamentos_financeiros l
             JOIN avulsa_rateio ar ON ((ar.conta_avulsa_id = l.conta_avulsa_id)))
        UNION ALL
         SELECT l.id,
            dr.regional_id,
            dr.fator
           FROM (lancamentos_financeiros l
             JOIN desembolso_rateio dr ON ((dr.desembolso_id = l.desembolso_id)))
          WHERE (l.conta_avulsa_id IS NULL)
        UNION ALL
         SELECT l.id,
            COALESCE(j.regional_id, l.regional_id) AS regional_id,
            1.0 AS fator
           FROM (lancamentos_financeiros l
             LEFT JOIN jobs j ON ((j.id = l.job_id)))
          WHERE ((l.conta_avulsa_id IS NULL) AND (l.desembolso_id IS NULL))
        ), fat_composicao AS (
         SELECT fi.faturamento_id,
                CASE
                    WHEN (fi.origem_tipo = 'job'::faturamento_origem) THEN fi.origem_id
                    WHEN (fi.origem_tipo = 'bv'::faturamento_origem) THEN bvi.job_id
                    ELSE NULL::uuid
                END AS job_id,
            sum(fi.valor) AS valor
           FROM ((faturamento_itens fi
             LEFT JOIN itens_bv bv ON (((bv.id = fi.origem_id) AND (fi.origem_tipo = 'bv'::faturamento_origem))))
             LEFT JOIN jobs_itens_orcado bvi ON ((bvi.id = bv.job_item_orcado_id)))
          WHERE (fi.origem_tipo <> 'save'::faturamento_origem)
          GROUP BY fi.faturamento_id,
                CASE
                    WHEN (fi.origem_tipo = 'job'::faturamento_origem) THEN fi.origem_id
                    WHEN (fi.origem_tipo = 'bv'::faturamento_origem) THEN bvi.job_id
                    ELSE NULL::uuid
                END
        ), fat_total AS (
         SELECT fat_composicao.faturamento_id,
            sum(fat_composicao.valor) AS total
           FROM fat_composicao
          GROUP BY fat_composicao.faturamento_id
        ), fat_partes AS (
         SELECT fi.faturamento_id,
            sum(fi.valor) FILTER (WHERE (fi.origem_tipo <> 'save'::faturamento_origem)) AS valor_proprio,
            sum(fi.valor) FILTER (WHERE (fi.origem_tipo = 'save'::faturamento_origem)) AS valor_save,
            (array_agg(fi.origem_id) FILTER (WHERE (fi.origem_tipo = 'save'::faturamento_origem)))[1] AS save_job_id
           FROM faturamento_itens fi
          GROUP BY fi.faturamento_id
        ), titulo_partes AS (
         SELECT tp.titulo_id,
            tp.faturamento_id,
            tp.valor,
            tp.valor_proprio,
            tp.save_job_id
           FROM vw_titulo_partes tp
        ), lancamento_job AS (
         SELECT l.id AS lancamento_id,
            COALESCE(rat.job_id, l.job_id) AS job_id,
            COALESCE(rat.fator, 1.0) AS fator,
            rat.save_job_id
           FROM (lancamentos_financeiros l
             LEFT JOIN LATERAL ( SELECT c.job_id,
                    ((tp.valor_proprio / NULLIF(tp.valor, (0)::numeric)) * (c.valor / NULLIF(ft.total, (0)::numeric))) AS fator,
                    NULL::uuid AS save_job_id
                   FROM ((titulo_partes tp
                     JOIN fat_composicao c ON ((c.faturamento_id = tp.faturamento_id)))
                     JOIN fat_total ft ON ((ft.faturamento_id = tp.faturamento_id)))
                  WHERE ((tp.titulo_id = l.titulo_receber_id) AND (l.job_id IS NULL) AND (tp.valor_proprio > (0)::numeric))
                UNION ALL
                 SELECT NULL::uuid AS uuid,
                    ((tp.valor - tp.valor_proprio) / NULLIF(tp.valor, (0)::numeric)),
                    tp.save_job_id
                   FROM titulo_partes tp
                  WHERE ((tp.titulo_id = l.titulo_receber_id) AND (l.job_id IS NULL) AND (tp.valor > tp.valor_proprio))) rat ON (true))
        ), pps_do_item AS (
         SELECT pc.item_realizado_id,
            COALESCE(sum(pc.valor) FILTER (WHERE (pc.status = ANY (ARRAY['aprovada'::pp_status, 'pago'::pp_status]))), (0)::numeric) AS em_titulo,
            COALESCE(sum(pc.valor) FILTER (WHERE (pc.status <> ALL (ARRAY['cancelada'::pp_status, 'aprovada'::pp_status, 'pago'::pp_status]))), (0)::numeric) AS sem_titulo
           FROM pedidos_compra pc
          WHERE (pc.item_realizado_id IS NOT NULL)
          GROUP BY pc.item_realizado_id
        ), abatimento_curva AS (
         SELECT ir.job_id,
            (sum(
                CASE
                    WHEN (ir.pps_concluidas_em IS NOT NULL) THEN GREATEST((0)::numeric, (COALESCE(io.total_planejado, (0)::numeric) - COALESCE(p.sem_titulo, (0)::numeric)))
                    ELSE LEAST(COALESCE(io.total_planejado, (0)::numeric), COALESCE(p.em_titulo, (0)::numeric))
                END))::numeric(14,2) AS valor
           FROM ((jobs_itens_realizado ir
             JOIN jobs_itens_orcado io ON ((io.id = ir.job_item_orcado_id)))
             LEFT JOIN pps_do_item p ON ((p.item_realizado_id = ir.id)))
          WHERE ((io.tipo_custo)::text = ANY (ARRAY['AR'::text, 'B'::text, 'C'::text, 'F'::text, 'FI'::text]))
          GROUP BY ir.job_id
        ), curva AS (
         SELECT p.id,
            p.tenant_id,
            p.job_id,
            p.ordem,
            p.data_prevista,
            p.valor,
            sum(p.valor) OVER (PARTITION BY p.job_id ORDER BY p.data_prevista, p.ordem, p.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acumulado,
            count(*) OVER (PARTITION BY p.job_id) AS total_parcelas
           FROM jobs_previsao_custo p
        ), residuo_curva AS (
         SELECT c.id,
            c.tenant_id,
            c.job_id,
            c.ordem,
            c.total_parcelas,
            c.data_prevista,
            (GREATEST((0)::numeric, LEAST(c.valor, (c.acumulado - COALESCE(a.valor, (0)::numeric)))))::numeric(14,2) AS valor
           FROM (curva c
             LEFT JOIN abatimento_curva a ON ((a.job_id = c.job_id)))
        ), jobs_com_envio AS (
         SELECT DISTINCT e.job_id
           FROM jobs_envio_faturamento e
        ), meses_com_envio AS (
         SELECT DISTINCT e.job_id,
            e.mes
           FROM jobs_envio_faturamento e
          WHERE (e.mes IS NOT NULL)
        ), previsao_recebimento AS (
         SELECT p.id,
            p.tenant_id,
            p.job_id,
            p.ordem,
            p.data_prevista,
            p.valor,
            p.mes,
            count(*) OVER (PARTITION BY p.job_id) AS total_parcelas,
            (
                CASE
                    WHEN (p.mes IS NOT NULL) THEN GREATEST((0)::numeric, (p.valor - COALESCE(p.valor_save, (0)::numeric)))
                    ELSE GREATEST((0)::numeric, LEAST(p.valor, ((COALESCE(j.faturamento_previsto, (0)::numeric) - COALESCE(j.faturamento_save_previsto, (0)::numeric)) - (sum(p.valor) OVER (PARTITION BY p.job_id ORDER BY p.data_prevista, p.ordem, p.id) - p.valor))))
                END)::numeric(14,2) AS valor_proprio
           FROM (jobs_previsao_recebimento p
             JOIN jobs j ON ((j.id = p.job_id)))
        ), envio_saldo AS (
         SELECT pa.id,
            pa.tenant_id,
            pa.job_id,
            pa.ordem,
            pa.data_vencimento,
            ((pa.valor - COALESCE(( SELECT sum(fi.valor) AS sum
                   FROM (faturamento_itens fi
                     JOIN faturamentos f ON ((f.id = fi.faturamento_id)))
                  WHERE ((fi.envio_parcela_id = pa.id) AND (f.status <> 'cancelado'::faturamento_status))), (0)::numeric)))::numeric(14,2) AS valor,
            count(*) OVER (PARTITION BY pa.envio_id) AS total_parcelas,
            (GREATEST((0)::numeric, LEAST(pa.valor, ((
                CASE
                    WHEN (e.mes IS NOT NULL) THEN (e.valor_faturado - COALESCE(e.valor_save, (0)::numeric))
                    ELSE (COALESCE(j.faturamento_previsto, (0)::numeric) - COALESCE(j.faturamento_save_previsto, (0)::numeric))
                END) - (sum(pa.valor) OVER (PARTITION BY pa.envio_id ORDER BY pa.ordem, pa.id) - pa.valor)))))::numeric(14,2) AS bruto_proprio
           FROM ((jobs_envio_faturamento_parcelas pa
             JOIN jobs_envio_faturamento e ON ((e.id = pa.envio_id)))
             JOIN jobs j ON ((j.id = pa.job_id)))
        ), save_fatias AS (
         SELECT lj.save_job_id,
            'realizado'::text AS situacao,
            'movimento'::text AS classe,
            'lancamento_save'::text AS origem_tipo,
            l.id AS origem_id,
            l.tenant_id,
            l.empresa_id,
            l.conta_bancaria_id,
            l.data_movimento AS data_evento,
            (((l.valor * lr.fator) * lj.fator))::numeric(14,2) AS valor,
            l.descricao AS base,
            l.cliente_id,
            l.fornecedor_id,
            COALESCE(jlj.regional_id, lr.regional_id) AS regional_id,
            (l.origem)::text AS origem_lancamento
           FROM (((lancamentos_financeiros l
             JOIN lancamento_rateio lr ON ((lr.lancamento_id = l.id)))
             JOIN lancamento_job lj ON ((lj.lancamento_id = l.id)))
             LEFT JOIN jobs jlj ON ((jlj.id = lj.job_id)))
          WHERE (lj.save_job_id IS NOT NULL)
        UNION ALL
         SELECT tp.save_job_id,
            'previsto'::text AS text,
            'titulo'::text AS text,
            'titulo_save'::text AS text,
            t.id,
            t.tenant_id,
            t.empresa_id,
            NULL::uuid AS uuid,
            COALESCE(t.data_previsao_recebimento, t.data_vencimento) AS "coalesce",
            ((t.valor - tp.valor_proprio))::numeric(14,2) AS "numeric",
            ((('Título NF '::text || f.numero_nf) || '/'::text) || (t.numero_parcela)::text),
            f.cliente_id,
            f.fornecedor_id,
            COALESCE(sj.regional_id, t.regional_id) AS "coalesce",
            NULL::text AS text
           FROM (((titulos_receber t
             JOIN titulo_partes tp ON ((tp.titulo_id = t.id)))
             JOIN faturamentos f ON ((f.id = t.faturamento_id)))
             LEFT JOIN jobs sj ON ((sj.id = tp.save_job_id)))
          WHERE ((t.status = 'em_aberto'::titulo_receber_status) AND (t.valor > tp.valor_proprio))
        UNION ALL
         SELECT p.job_id,
            'previsto'::text AS text,
            'previsao'::text AS text,
            'previsao_recebimento_save'::text AS text,
            p.id,
            p.tenant_id,
            j.empresa_id,
            NULL::uuid AS uuid,
                CASE
                    WHEN (p.data_prevista < CURRENT_DATE) THEN (CURRENT_DATE + 1)
                    ELSE p.data_prevista
                END AS data_prevista,
            ((p.valor - p.valor_proprio))::numeric(14,2) AS "numeric",
            ((((('Previsão de recebimento · '::text || j.codigo) || ' '::text) || p.ordem) || '/'::text) || p.total_parcelas),
            pj.cliente_id,
            NULL::uuid AS uuid,
            j.regional_id,
            NULL::text AS text
           FROM ((previsao_recebimento p
             JOIN jobs j ON ((j.id = p.job_id)))
             LEFT JOIN projetos pj ON ((pj.id = j.projeto_id)))
          WHERE ((p.valor > p.valor_proprio) AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status])) AND (
        CASE
            WHEN (p.mes IS NULL) THEN (NOT (EXISTS ( SELECT 1
               FROM jobs_com_envio ce
              WHERE (ce.job_id = p.job_id))))
            ELSE (NOT (EXISTS ( SELECT 1
               FROM meses_com_envio me
              WHERE ((me.job_id = p.job_id) AND (me.mes = p.mes)))))
        END))
        UNION ALL
         SELECT s.job_id,
            'previsto'::text AS text,
            'previsao'::text AS text,
            'envio_parcela_save'::text AS text,
            s.id,
            s.tenant_id,
            j.empresa_id,
            NULL::uuid AS uuid,
                CASE
                    WHEN (s.data_vencimento < CURRENT_DATE) THEN (CURRENT_DATE + 1)
                    ELSE s.data_vencimento
                END AS data_vencimento,
            ((s.valor - LEAST(s.valor, s.bruto_proprio)))::numeric(14,2) AS "numeric",
            ((((('Faturamento previsto · '::text || j.codigo) || ' parcela '::text) || s.ordem) || '/'::text) || s.total_parcelas),
            pj.cliente_id,
            NULL::uuid AS uuid,
            j.regional_id,
            NULL::text AS text
           FROM ((envio_saldo s
             JOIN jobs j ON ((j.id = s.job_id)))
             LEFT JOIN projetos pj ON ((pj.id = j.projeto_id)))
          WHERE ((s.valor > LEAST(s.valor, s.bruto_proprio)) AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status])))
        ), save_fatias_ord AS (
         SELECT f.save_job_id,
            f.situacao,
            f.classe,
            f.origem_tipo,
            f.origem_id,
            f.tenant_id,
            f.empresa_id,
            f.conta_bancaria_id,
            f.data_evento,
            f.valor,
            f.base,
            f.cliente_id,
            f.fornecedor_id,
            f.regional_id,
            f.origem_lancamento,
            (sum(f.valor) OVER w - f.valor) AS ini,
            sum(f.valor) OVER w AS fim
           FROM save_fatias f
          WHERE (f.valor > (0)::numeric)
          WINDOW w AS (PARTITION BY f.save_job_id ORDER BY f.data_evento, f.origem_tipo, f.origem_id)
        ), save_gerado AS (
         SELECT o.job_id,
            sum(o.total_orcado) AS principal
           FROM jobs_itens_orcado o
          WHERE o.em_save
          GROUP BY o.job_id
        ), save_consumo_ord AS (
         SELECT c.job_origem_id,
            oc.job_id AS job_consumidor,
            c.id,
            (((c.valor / NULLIF(g.principal, (0)::numeric)) * COALESCE(jo.faturamento_save_previsto, (0)::numeric)))::numeric(14,2) AS valor,
            (sum((((c.valor / NULLIF(g.principal, (0)::numeric)) * COALESCE(jo.faturamento_save_previsto, (0)::numeric)))::numeric(14,2)) OVER w2 - (((c.valor / NULLIF(g.principal, (0)::numeric)) * COALESCE(jo.faturamento_save_previsto, (0)::numeric)))::numeric(14,2)) AS ini,
            sum((((c.valor / NULLIF(g.principal, (0)::numeric)) * COALESCE(jo.faturamento_save_previsto, (0)::numeric)))::numeric(14,2)) OVER w2 AS fim
           FROM (((saves_consumos c
             JOIN jobs_itens_orcado oc ON ((oc.id = c.job_item_orcado_id)))
             JOIN jobs jo ON ((jo.id = c.job_origem_id)))
             JOIN save_gerado g ON ((g.job_id = c.job_origem_id)))
          WHERE (c.job_item_orcado_id IS NOT NULL)
          WINDOW w2 AS (PARTITION BY c.job_origem_id ORDER BY c.created_at, c.id)
        ), save_alocado AS (
         SELECT f.origem_id,
            f.origem_tipo,
            f.situacao,
            f.classe,
            f.tenant_id,
            f.empresa_id,
            f.conta_bancaria_id,
            f.data_evento,
            f.base,
            f.cliente_id,
            f.fornecedor_id,
            f.origem_lancamento,
            f.save_job_id,
            c.job_consumidor,
            c.id AS consumo_id,
            ((LEAST(f.fim, c.fim) - GREATEST(f.ini, c.ini)))::numeric(14,2) AS valor,
            jc.regional_id
           FROM ((save_fatias_ord f
             JOIN save_consumo_ord c ON ((c.job_origem_id = f.save_job_id)))
             JOIN jobs jc ON ((jc.id = c.job_consumidor)))
          WHERE ((LEAST(f.fim, c.fim) - GREATEST(f.ini, c.ini)) > 0.004)
        )
 SELECT 'realizado'::text AS situacao,
    'lancamento'::text AS origem_tipo,
    l.id AS origem_id,
    l.tenant_id,
    l.empresa_id,
    l.conta_bancaria_id,
    l.data_movimento AS data_evento,
    (((l.valor * lr.fator) * lj.fator))::numeric(14,2) AS valor,
    l.natureza,
    l.descricao,
    l.fornecedor_id,
    l.cliente_id,
    lj.job_id,
    'movimento'::text AS classe,
    COALESCE(jlj.regional_id, lr.regional_id) AS regional_id,
    (l.origem)::text AS origem_lancamento
   FROM (((lancamentos_financeiros l
     JOIN lancamento_rateio lr ON ((lr.lancamento_id = l.id)))
     JOIN lancamento_job lj ON ((lj.lancamento_id = l.id)))
     LEFT JOIN jobs jlj ON ((jlj.id = lj.job_id)))
  WHERE (lj.save_job_id IS NULL)
UNION ALL
 SELECT 'previsto'::text AS situacao,
    'pp'::text AS origem_tipo,
    par.id AS origem_id,
    pp.tenant_id,
    pp.empresa_id,
    NULL::uuid AS conta_bancaria_id,
    par.data_pagamento AS data_evento,
    (par.valor)::numeric(14,2) AS valor,
    'saida'::natureza_lancamento AS natureza,
    ((((((('PP '::text || pp.codigo) || ' '::text) || par.numero) || '/'::text) || tot.total) || ' — '::text) || "substring"(pp.servico, 1, 150)) AS descricao,
    pp.fornecedor_id,
    NULL::uuid AS cliente_id,
    pp.job_id,
    'titulo'::text AS classe,
    jb.regional_id,
    NULL::text AS origem_lancamento
   FROM (((pedidos_compra_parcelas par
     JOIN pedidos_compra pp ON ((pp.id = par.pedido_compra_id)))
     JOIN jobs jb ON ((jb.id = pp.job_id)))
     JOIN LATERAL ( SELECT (count(*))::integer AS total
           FROM pedidos_compra_parcelas x
          WHERE (x.pedido_compra_id = par.pedido_compra_id)) tot ON (true))
  WHERE ((pp.status = ANY (ARRAY['aprovada'::pp_status, 'pago'::pp_status])) AND (par.pago_em IS NULL))
UNION ALL
 SELECT 'previsto'::text AS situacao,
        CASE
            WHEN (a.recorrente_id IS NOT NULL) THEN 'recorrente'::text
            ELSE 'avulsa'::text
        END AS origem_tipo,
    a.id AS origem_id,
    a.tenant_id,
    a.empresa_id,
    NULL::uuid AS conta_bancaria_id,
    COALESCE(a.data_pagamento, a.data_prevista_pagamento) AS data_evento,
    ((a.valor * ar.fator))::numeric(14,2) AS valor,
    a.natureza,
    a.descricao,
    a.fornecedor_id,
    a.cliente_id,
    a.job_id,
    'titulo'::text AS classe,
    ar.regional_id,
    NULL::text AS origem_lancamento
   FROM (contas_avulsas a
     JOIN avulsa_rateio ar ON ((ar.conta_avulsa_id = a.id)))
  WHERE (a.status = 'aprovada'::conta_avulsa_status)
UNION ALL
 SELECT 'previsto'::text AS situacao,
    'desembolso'::text AS origem_tipo,
    par.id AS origem_id,
    d.tenant_id,
    d.empresa_id,
    NULL::uuid AS conta_bancaria_id,
    par.data_pagamento AS data_evento,
    ((par.valor * dr.fator))::numeric(14,2) AS valor,
    'saida'::natureza_lancamento AS natureza,
    ((((((('Desembolso '::text || d.codigo) || ' '::text) || par.numero) || '/'::text) || tot.total) || ' — '::text) || "substring"(d.descricao, 1, 150)) AS descricao,
    d.fornecedor_id,
    d.cliente_id,
    NULL::uuid AS job_id,
    'titulo'::text AS classe,
    dr.regional_id,
    NULL::text AS origem_lancamento
   FROM (((desembolsos_parcelas par
     JOIN desembolsos d ON ((d.id = par.desembolso_id)))
     JOIN desembolso_rateio dr ON ((dr.desembolso_id = d.id)))
     JOIN LATERAL ( SELECT (count(*))::integer AS total
           FROM desembolsos_parcelas x
          WHERE (x.desembolso_id = par.desembolso_id)) tot ON (true))
  WHERE ((d.status = ANY (ARRAY['aprovada'::desembolso_status, 'pago'::desembolso_status])) AND (par.pago_em IS NULL))
UNION ALL
 SELECT 'previsto'::text AS situacao,
    'titulo'::text AS origem_tipo,
    t.id AS origem_id,
    t.tenant_id,
    t.empresa_id,
    NULL::uuid AS conta_bancaria_id,
    COALESCE(t.data_previsao_recebimento, t.data_vencimento) AS data_evento,
    ((tp.valor_proprio * COALESCE((c.valor / NULLIF(ft.total, (0)::numeric)), (1)::numeric)))::numeric(14,2) AS valor,
    'entrada'::natureza_lancamento AS natureza,
    ((('Título NF '::text || f.numero_nf) || '/'::text) || (t.numero_parcela)::text) AS descricao,
    f.fornecedor_id,
    f.cliente_id,
    c.job_id,
    'titulo'::text AS classe,
    COALESCE(j.regional_id, t.regional_id) AS regional_id,
    NULL::text AS origem_lancamento
   FROM (((((titulos_receber t
     JOIN titulo_partes tp ON ((tp.titulo_id = t.id)))
     JOIN faturamentos f ON ((f.id = t.faturamento_id)))
     LEFT JOIN fat_composicao c ON ((c.faturamento_id = t.faturamento_id)))
     LEFT JOIN fat_total ft ON ((ft.faturamento_id = t.faturamento_id)))
     LEFT JOIN jobs j ON ((j.id = c.job_id)))
  WHERE ((t.status = 'em_aberto'::titulo_receber_status) AND (tp.valor_proprio > (0)::numeric))
UNION ALL
 SELECT 'previsto'::text AS situacao,
    'previsao_custo'::text AS origem_tipo,
    r.id AS origem_id,
    r.tenant_id,
    j.empresa_id,
    NULL::uuid AS conta_bancaria_id,
        CASE
            WHEN (r.data_prevista < CURRENT_DATE) THEN fc_proxima_janela_pagamento(CURRENT_DATE)
            ELSE r.data_prevista
        END AS data_evento,
    r.valor,
    'saida'::natureza_lancamento AS natureza,
    ((((('Cronograma de desembolsos · '::text || j.codigo) || ' '::text) || r.ordem) || '/'::text) || r.total_parcelas) AS descricao,
    NULL::uuid AS fornecedor_id,
    pj.cliente_id,
    r.job_id,
    'previsao'::text AS classe,
    j.regional_id,
    NULL::text AS origem_lancamento
   FROM ((residuo_curva r
     JOIN jobs j ON ((j.id = r.job_id)))
     LEFT JOIN projetos pj ON ((pj.id = j.projeto_id)))
  WHERE ((r.valor > (0)::numeric) AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status])))
UNION ALL
 SELECT 'previsto'::text AS situacao,
    'previsao_recebimento'::text AS origem_tipo,
    p.id AS origem_id,
    p.tenant_id,
    j.empresa_id,
    NULL::uuid AS conta_bancaria_id,
        CASE
            WHEN (p.data_prevista < CURRENT_DATE) THEN (CURRENT_DATE + 1)
            ELSE p.data_prevista
        END AS data_evento,
    p.valor_proprio AS valor,
    'entrada'::natureza_lancamento AS natureza,
    ((((('Previsão de recebimento · '::text || j.codigo) || ' '::text) || p.ordem) || '/'::text) || p.total_parcelas) AS descricao,
    NULL::uuid AS fornecedor_id,
    pj.cliente_id,
    p.job_id,
    'previsao'::text AS classe,
    j.regional_id,
    NULL::text AS origem_lancamento
   FROM ((previsao_recebimento p
     JOIN jobs j ON ((j.id = p.job_id)))
     LEFT JOIN projetos pj ON ((pj.id = j.projeto_id)))
  WHERE ((p.valor_proprio > (0)::numeric) AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status])) AND (
        CASE
            WHEN (p.mes IS NULL) THEN (NOT (EXISTS ( SELECT 1
               FROM jobs_com_envio ce
              WHERE (ce.job_id = p.job_id))))
            ELSE (NOT (EXISTS ( SELECT 1
               FROM meses_com_envio me
              WHERE ((me.job_id = p.job_id) AND (me.mes = p.mes)))))
        END))
UNION ALL
 SELECT 'previsto'::text AS situacao,
    'envio_parcela'::text AS origem_tipo,
    s.id AS origem_id,
    s.tenant_id,
    j.empresa_id,
    NULL::uuid AS conta_bancaria_id,
        CASE
            WHEN (s.data_vencimento < CURRENT_DATE) THEN (CURRENT_DATE + 1)
            ELSE s.data_vencimento
        END AS data_evento,
    LEAST(s.valor, s.bruto_proprio) AS valor,
    'entrada'::natureza_lancamento AS natureza,
    ((((('Faturamento previsto · '::text || j.codigo) || ' parcela '::text) || s.ordem) || '/'::text) || s.total_parcelas) AS descricao,
    NULL::uuid AS fornecedor_id,
    pj.cliente_id,
    s.job_id,
    'previsao'::text AS classe,
    j.regional_id,
    NULL::text AS origem_lancamento
   FROM ((envio_saldo s
     JOIN jobs j ON ((j.id = s.job_id)))
     LEFT JOIN projetos pj ON ((pj.id = j.projeto_id)))
  WHERE ((LEAST(s.valor, s.bruto_proprio) > (0)::numeric) AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status])))
UNION ALL
 SELECT 'previsto'::text AS situacao,
    'pp_devolucao_verba'::text AS origem_tipo,
    d.id AS origem_id,
    d.tenant_id,
    d.empresa_id,
    NULL::uuid AS conta_bancaria_id,
    d.data_pagamento AS data_evento,
    d.valor,
    'entrada'::natureza_lancamento AS natureza,
    ((('Devolução verba '::text || pp.codigo) || ' — '::text) || "substring"(pp.servico, 1, 140)) AS descricao,
    NULL::uuid AS fornecedor_id,
    NULL::uuid AS cliente_id,
    pp.job_id,
    'titulo'::text AS classe,
    jb.regional_id,
    NULL::text AS origem_lancamento
   FROM ((pp_verba_devolucoes d
     JOIN pedidos_compra pp ON ((pp.id = d.pedido_compra_id)))
     LEFT JOIN jobs jb ON ((jb.id = pp.job_id)))
  WHERE (d.pago_em IS NULL)
UNION ALL
 SELECT f.situacao,
    f.origem_tipo,
    f.origem_id,
    f.tenant_id,
    f.empresa_id,
    f.conta_bancaria_id,
    f.data_evento,
    ((f.valor - COALESCE(al.alocado, (0)::numeric)))::numeric(14,2) AS valor,
    'entrada'::natureza_lancamento AS natureza,
    ((f.base || ' · saldo em save de '::text) || COALESCE(sj.codigo, '—'::text)) AS descricao,
    f.fornecedor_id,
    f.cliente_id,
    NULL::uuid AS job_id,
    f.classe,
    f.regional_id,
    f.origem_lancamento
   FROM ((save_fatias_ord f
     LEFT JOIN jobs sj ON ((sj.id = f.save_job_id)))
     LEFT JOIN LATERAL ( SELECT sum(a.valor) AS alocado
           FROM save_alocado a
          WHERE ((a.origem_id = f.origem_id) AND (a.origem_tipo = f.origem_tipo))) al ON (true))
  WHERE ((f.valor - COALESCE(al.alocado, (0)::numeric)) > 0.004)
UNION ALL
 SELECT a.situacao,
    (a.origem_tipo || '_consumido'::text) AS origem_tipo,
    a.origem_id,
    a.tenant_id,
    a.empresa_id,
    a.conta_bancaria_id,
    a.data_evento,
    a.valor,
    'entrada'::natureza_lancamento AS natureza,
    ((((a.base || ' · save de '::text) || COALESCE(so.codigo, '—'::text)) || ' consumido por '::text) || COALESCE(jc.codigo, '—'::text)) AS descricao,
    a.fornecedor_id,
    a.cliente_id,
    a.job_consumidor AS job_id,
    a.classe,
    a.regional_id,
    a.origem_lancamento
   FROM ((save_alocado a
     LEFT JOIN jobs so ON ((so.id = a.save_job_id)))
     LEFT JOIN jobs jc ON ((jc.id = a.job_consumidor)));

grant select on public.vw_fluxo_caixa to authenticated;

-- 7 -------------------------------------------------------------------
create or replace view public.vw_saves_por_job as
select
  j.id                                                             as job_id,
  j.tenant_id,
  j.codigo                                                         as job_codigo,
  j.nome                                                           as job_nome,
  j.status                                                         as job_status,
  p.cliente_id,
  coalesce(g.gerado, 0)::numeric(14,2)                             as saldo_gerado,
  coalesce(f.consumido, 0)::numeric(14,2)                          as consumido,
  coalesce(r.reservado, 0)::numeric(14,2)                          as reservado,
  (coalesce(g.gerado, 0) - coalesce(f.consumido, 0))::numeric(14,2) as disponivel,
  coalesce(g.linhas, 0::bigint)                                    as linhas_em_save,
  v.percentual_honorarios,
  v.percentual_imposto
from public.jobs j
join public.projetos p on p.id = j.projeto_id
left join public.versoes_orcamento v on v.id = j.versao_orcamento_aprovada_id
left join lateral (
  -- Só o save das linhas cujo envio para faturamento já aconteceu: o envio
  -- único do job (grupo sem mês) ou o envio do mês do grupo (modelo mensal,
  -- decisão 078). Antes a condição era "o job tem envio", fora do lateral.
  select sum(o.total_orcado) as gerado, count(*) as linhas
    from public.jobs_itens_orcado o
    left join public.versoes_orcamento_grupos gr on gr.id = o.grupo_id
    left join public.versoes_orcamento_meses vm on vm.id = gr.mes_id
   where o.job_id = j.id
     and o.em_save
     and exists (
       select 1
         from public.jobs_envio_faturamento ef
        where ef.job_id = j.id
          and ef.tenant_id = j.tenant_id
          and (
            (gr.mes_id is null and ef.mes is null)
            or (gr.mes_id is not null and ef.mes = vm.mes)
          )
     )
) g on true
left join lateral (
  select sum(c.valor) as consumido
    from public.vw_saves_consumos_firmes c
   where c.job_origem_id = j.id and c.firme
) f on true
left join lateral (
  select sum(c.valor) as reservado
    from public.vw_saves_consumos_firmes c
   where c.job_origem_id = j.id and not c.firme
) r on true
where coalesce(g.gerado, 0) > 0
  -- Job que o financeiro recusou, ou que foi cancelado, não existe para o
  -- financeiro (mesma régua de `dados-abertos.ts`) e não tem crédito a dar.
  and j.status not in ('rejeitado_financeiro', 'cancelado');

alter view public.vw_saves_por_job set (security_invoker = on);
grant select on public.vw_saves_por_job to authenticated;

comment on view public.vw_saves_por_job is
  'Saldo de save por job, para o seletor de consumo. Só entra job que gerou save, não foi recusado nem cancelado, e cujo envio para faturamento já aconteceu — por mês nos jobs do modelo mensal (decisão 078). Consumo já gravado não é afetado.';
