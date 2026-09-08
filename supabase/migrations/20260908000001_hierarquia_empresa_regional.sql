-- Motivo: inverter a relação empresa↔regional e materializar regional
-- nos lançamentos que hoje dependem do fallback via empresa.
--
-- Antes: empresa é filha de regional (empresas.regional_id NOT NULL).
--        Contas avulsas, lançamentos financeiros e títulos a receber sem
--        job caem no fallback COALESCE(job.regional_id, empresa.regional_id)
--        dentro da view vw_fluxo_caixa.
-- Agora: regional é filha de empresa (regionais.empresa_id NOT NULL);
--        empresa é filha direta do tenant.
--        Cada empresa tem várias regionais → "regional da empresa" deixa
--        de existir. Passa a ser obrigação da criação escolher a regional
--        (ou o rateio). Migration adiciona regional_id nullable nas 3
--        tabelas, faz backfill preservando o comportamento atual da view,
--        e reescreve vw_fluxo_caixa sem o fallback via empresa.
--
-- Cria empresa CCH (inativa, sem CNPJ real ainda) e as 6 regionais
-- faltantes. Trigger garante que empresa_id e regional_id de
-- jobs/orcamentos/projetos sempre se referem à mesma empresa.
--
-- Ver docs/superpowers/specs/2026-09-08-hierarquia-tenant-empresa-regional-design.md
-- Destrutivo: remove empresas.regional_id (confirmado por Daniel em 2026-09-08).
-- Escopo ampliado A1: adiciona regional_id em contas_avulsas/lancamentos_financeiros/
-- titulos_receber e recria vw_fluxo_caixa (Ruling em ledger 2026-09-08).

-- =====================================================================
-- Bloco 1 — Hierarquia empresa/regional
-- =====================================================================

-- 1.1. Rename só do nome_fantasia da empresa California → Agência California
update public.empresas
   set nome_fantasia = 'Agência California'
 where id = '304039bd-509d-4536-aa26-44e7091ee718';

-- 1.2. Criar CCH + adicionar regionais.empresa_id + criar 6 regionais.
do $mig$
declare v_cch uuid := gen_random_uuid();
begin
  -- Criar CCH (inativa). empresas.regional_id ainda existe e é NOT NULL,
  -- preenche temporariamente com NE — coluna sai no bloco 4.
  insert into public.empresas (
    id, tenant_id, razao_social, nome_fantasia, cnpj,
    logradouro, cidade, uf, cep,
    principal, ativo, regional_id
  ) values (
    v_cch, 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c',
    'CCH (a preencher)', 'CCH', '00000000000000',
    'a preencher', 'a preencher', 'SP', '00000000',
    false, false, '54c627a6-e2d4-480b-9bd4-2f1acbf0ea91'
  );

  -- regionais.empresa_id nullable
  alter table public.regionais
    add column empresa_id uuid references public.empresas(id) on delete restrict;

  -- Backfill: NE e SP viram filhas da Agência California
  update public.regionais
     set empresa_id = '304039bd-509d-4536-aa26-44e7091ee718'
   where empresa_id is null;

  -- 6 regionais faltantes
  insert into public.regionais (id, tenant_id, nome, empresa_id, ativo) values
    (gen_random_uuid(), 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'NO',     '304039bd-509d-4536-aa26-44e7091ee718', true),
    (gen_random_uuid(), 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'RJ',     '304039bd-509d-4536-aa26-44e7091ee718', true),
    (gen_random_uuid(), 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'SS',     '304039bd-509d-4536-aa26-44e7091ee718', true),
    (gen_random_uuid(), 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'Doca',   v_cch, true),
    (gen_random_uuid(), 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'Agency', v_cch, true),
    (gen_random_uuid(), 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', 'Hitlab', 'a61067d9-b46b-40b0-8541-4850f13aa47c', true);
end
$mig$;

-- 1.3. Fechar regionais.empresa_id como NOT NULL
alter table public.regionais alter column empresa_id set not null;

-- 1.4. Unicidade (empresa, nome) e índice na FK
create unique index if not exists idx_regionais_empresa_nome on public.regionais(empresa_id, nome);
create index if not exists idx_regionais_empresa on public.regionais(empresa_id);

-- =====================================================================
-- Bloco 2 — regional_id nas 3 tabelas que dependiam do fallback via empresa
-- =====================================================================

-- 2.1. Colunas nullable + FK + índice
alter table public.contas_avulsas
  add column regional_id uuid references public.regionais(id) on delete restrict;
create index if not exists idx_contas_avulsas_regional on public.contas_avulsas(regional_id);

alter table public.lancamentos_financeiros
  add column regional_id uuid references public.regionais(id) on delete restrict;
create index if not exists idx_lancamentos_financeiros_regional on public.lancamentos_financeiros(regional_id);

alter table public.titulos_receber
  add column regional_id uuid references public.regionais(id) on delete restrict;
create index if not exists idx_titulos_receber_regional on public.titulos_receber(regional_id);

-- 2.2. Backfill contas_avulsas: pega a regional do rateio único (14/14 têm rateio de 1 linha)
update public.contas_avulsas ca
   set regional_id = (
     select r.regional_id
     from public.contas_avulsas_regionais r
     where r.conta_avulsa_id = ca.id
     limit 1
   )
 where ca.regional_id is null;

-- 2.3. Backfill lancamentos_financeiros: job → conta_avulsa (via rateio) → NE (regional histórica da California)
update public.lancamentos_financeiros l
   set regional_id = coalesce(
     (select j.regional_id from public.jobs j where j.id = l.job_id),
     (select r.regional_id from public.contas_avulsas_regionais r where r.conta_avulsa_id = l.conta_avulsa_id limit 1),
     '54c627a6-e2d4-480b-9bd4-2f1acbf0ea91'
   )
 where l.regional_id is null;

-- 2.4. Backfill titulos_receber: NE (todos os 4 títulos existentes são da Agência California)
update public.titulos_receber
   set regional_id = '54c627a6-e2d4-480b-9bd4-2f1acbf0ea91'
 where regional_id is null;

-- =====================================================================
-- Bloco 3 — Views: dropar antes do drop coluna, recriar depois sem fallback
-- =====================================================================

-- 3.1. Dropar as duas views (job_totais depende de vw_fluxo_caixa, drop primeiro)
drop view if exists public.vw_fluxo_caixa_job_totais;
drop view if exists public.vw_fluxo_caixa;

-- =====================================================================
-- Bloco 4 — Drop destrutivo de empresas.regional_id
-- =====================================================================

alter table public.empresas drop column regional_id;

-- =====================================================================
-- Bloco 5 — Recria views sem fallback via empresa.regional_id
-- =====================================================================

-- 5.1. vw_fluxo_caixa — mesma estrutura, 4 substituições:
--   avulsa_rateio (sem rateio manual):    COALESCE(j.regional_id, e.regional_id) → COALESCE(j.regional_id, a.regional_id); LEFT JOIN empresas removido
--   lancamento_rateio (sem conta_avulsa): COALESCE(j.regional_id, e.regional_id) → COALESCE(j.regional_id, l.regional_id); LEFT JOIN empresas removido
--   save_fatias titulos_receber:          COALESCE(sj.regional_id, e.regional_id) → COALESCE(sj.regional_id, t.regional_id); LEFT JOIN empresas removido
--   titulos_receber branch principal:     COALESCE(j.regional_id, e.regional_id) → COALESCE(j.regional_id, t.regional_id); LEFT JOIN empresas removido

create view public.vw_fluxo_caixa as
 WITH avulsa_rateio AS (
         SELECT r.conta_avulsa_id,
            r.regional_id,
            (r.percentual / 100.0) AS fator
           FROM contas_avulsas_regionais r
        UNION ALL
         SELECT a.id,
            COALESCE(j.regional_id, a.regional_id) AS regional_id,
            1.0 AS fator
           FROM (contas_avulsas a
             LEFT JOIN jobs j ON ((j.id = a.job_id)))
          WHERE (NOT (EXISTS ( SELECT 1
                   FROM contas_avulsas_regionais r
                  WHERE (r.conta_avulsa_id = a.id))))
        ), lancamento_rateio AS (
         SELECT l.id AS lancamento_id,
            ar.regional_id,
            ar.fator
           FROM (lancamentos_financeiros l
             JOIN avulsa_rateio ar ON ((ar.conta_avulsa_id = l.conta_avulsa_id)))
        UNION ALL
         SELECT l.id,
            COALESCE(j.regional_id, l.regional_id) AS regional_id,
            1.0 AS fator
           FROM (lancamentos_financeiros l
             LEFT JOIN jobs j ON ((j.id = l.job_id)))
          WHERE (l.conta_avulsa_id IS NULL)
        ), fat_composicao AS (
         SELECT fi.faturamento_id,
                CASE
                    WHEN (fi.origem_tipo = 'job'::faturamento_origem) THEN fi.origem_id
                    ELSE NULL::uuid
                END AS job_id,
            sum(fi.valor) AS valor
           FROM faturamento_itens fi
          WHERE (fi.origem_tipo <> 'save'::faturamento_origem)
          GROUP BY fi.faturamento_id,
                CASE
                    WHEN (fi.origem_tipo = 'job'::faturamento_origem) THEN fi.origem_id
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
        ), previsao_recebimento AS (
         SELECT p.id,
            p.tenant_id,
            p.job_id,
            p.ordem,
            p.data_prevista,
            p.valor,
            count(*) OVER (PARTITION BY p.job_id) AS total_parcelas,
            (GREATEST((0)::numeric, LEAST(p.valor, ((COALESCE(j.faturamento_previsto, (0)::numeric) - COALESCE(j.faturamento_save_previsto, (0)::numeric)) - (sum(p.valor) OVER (PARTITION BY p.job_id ORDER BY p.data_prevista, p.ordem, p.id) - p.valor)))))::numeric(14,2) AS valor_proprio
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
            (GREATEST((0)::numeric, LEAST(pa.valor, ((COALESCE(j.faturamento_previsto, (0)::numeric) - COALESCE(j.faturamento_save_previsto, (0)::numeric)) - (sum(pa.valor) OVER (PARTITION BY pa.envio_id ORDER BY pa.ordem, pa.id) - pa.valor)))))::numeric(14,2) AS bruto_proprio
           FROM (jobs_envio_faturamento_parcelas pa
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
            lr.regional_id,
            (l.origem)::text AS origem_lancamento
           FROM ((lancamentos_financeiros l
             JOIN lancamento_rateio lr ON ((lr.lancamento_id = l.id)))
             JOIN lancamento_job lj ON ((lj.lancamento_id = l.id)))
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
          WHERE ((p.valor > p.valor_proprio) AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status])) AND (NOT (EXISTS ( SELECT 1
                   FROM jobs_com_envio ce
                  WHERE (ce.job_id = p.job_id)))))
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
    lr.regional_id,
    (l.origem)::text AS origem_lancamento
   FROM ((lancamentos_financeiros l
     JOIN lancamento_rateio lr ON ((lr.lancamento_id = l.id)))
     JOIN lancamento_job lj ON ((lj.lancamento_id = l.id)))
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
    par.valor,
    'saida'::natureza_lancamento AS natureza,
    ((((((('Desembolso '::text || d.codigo) || ' '::text) || par.numero) || '/'::text) || tot.total) || ' — '::text) || "substring"(d.descricao, 1, 150)) AS descricao,
    d.fornecedor_id,
    d.cliente_id,
    d.job_id,
    'titulo'::text AS classe,
    jb.regional_id,
    NULL::text AS origem_lancamento
   FROM (((desembolsos_parcelas par
     JOIN desembolsos d ON ((d.id = par.desembolso_id)))
     LEFT JOIN jobs jb ON ((jb.id = d.job_id)))
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
  WHERE ((p.valor_proprio > (0)::numeric) AND (j.status = ANY (ARRAY['aberto'::job_status, 'em_producao'::job_status])) AND (NOT (EXISTS ( SELECT 1
           FROM jobs_com_envio ce
          WHERE (ce.job_id = p.job_id)))))
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

-- 5.2. vw_fluxo_caixa_job_totais — texto idêntico ao atual (não usa regional_id direto)
create view public.vw_fluxo_caixa_job_totais as
 SELECT tenant_id,
    job_id,
    (COALESCE(sum(valor) FILTER (WHERE (natureza = 'entrada'::natureza_lancamento)), (0)::numeric))::numeric(14,2) AS recebimentos_total,
    (COALESCE(sum(valor) FILTER (WHERE ((natureza = 'entrada'::natureza_lancamento) AND (classe = 'movimento'::text))), (0)::numeric))::numeric(14,2) AS recebimentos_realizado,
    (COALESCE(sum(valor) FILTER (WHERE (natureza = 'saida'::natureza_lancamento)), (0)::numeric))::numeric(14,2) AS custos_total,
    (COALESCE(sum(valor) FILTER (WHERE ((natureza = 'saida'::natureza_lancamento) AND (classe = 'movimento'::text))), (0)::numeric))::numeric(14,2) AS custos_realizado
   FROM vw_fluxo_caixa v
  WHERE ((job_id IS NOT NULL) AND (NOT ((classe = 'titulo'::text) AND (origem_tipo = ANY (ARRAY['avulsa'::text, 'recorrente'::text, 'desembolso'::text])))))
  GROUP BY tenant_id, job_id;

-- 5.3. Restaurar grants SELECT para authenticated
grant select on public.vw_fluxo_caixa to authenticated;
grant select on public.vw_fluxo_caixa_job_totais to authenticated;

-- =====================================================================
-- Bloco 6 — Trigger de consistência empresa↔regional
-- =====================================================================

create or replace function public.ck_empresa_bate_regional() returns trigger
language plpgsql
set search_path = public
as $$
declare v_empresa uuid;
begin
  if new.regional_id is null then return new; end if;
  select empresa_id into v_empresa from public.regionais where id = new.regional_id;
  if v_empresa is null then raise exception 'regional_id % nao existe', new.regional_id; end if;
  if new.empresa_id is not null and new.empresa_id <> v_empresa then
    raise exception 'empresa_id % nao bate com regional_id % (esperado %)',
      new.empresa_id, new.regional_id, v_empresa;
  end if;
  if new.empresa_id is null then new.empresa_id := v_empresa; end if;
  return new;
end $$;

create trigger tr_jobs_empresa_bate_regional
  before insert or update of empresa_id, regional_id on public.jobs
  for each row execute function public.ck_empresa_bate_regional();

create trigger tr_orcamentos_empresa_bate_regional
  before insert or update of empresa_id, regional_id on public.orcamentos
  for each row execute function public.ck_empresa_bate_regional();

create trigger tr_projetos_empresa_bate_regional
  before insert or update of empresa_id, regional_id on public.projetos
  for each row execute function public.ck_empresa_bate_regional();

-- =====================================================================
-- Bloco 7 — Dry-run de consistência
-- =====================================================================

update public.jobs       set id=id;
update public.orcamentos set id=id;
update public.projetos   set id=id;
