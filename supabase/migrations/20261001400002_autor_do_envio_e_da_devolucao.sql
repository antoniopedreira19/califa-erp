-- Decisão 136, parte 2 (01/10/2026): quem fez cada envio do job fica
-- registrado e aparece para o financeiro.
--
-- 1. `jobs.enviado_abertura_por` / `enviado_abertura_em`: o ÚLTIMO envio
--    para abertura — o primeiro ou o reenvio depois da devolução. O primeiro
--    envio continua em `created_by` / `created_at`. Até aqui o reenvio só
--    ficava na auditoria, que o financeiro não lê, e a tela mostrava o
--    primeiro envio como se fosse o último.
-- 2. `jobs.devolvido_em`: quando o financeiro devolveu (o "Reprovar" da
--    conferência). A produção vê "Devolvido pelo Financeiro em …", sem o
--    nome de quem devolveu (pedido do Tiago); o autor segue na auditoria.
-- 3. `itens_bv.confirmado_por` / `confirmado_em`: quem confirmou o BV e o
--    mandou ao contas a receber. Até aqui só na auditoria.
-- 4. `vw_faturamento_pendente` ganha, no fim, `autor_nome` e `autor_em`:
--    quem enviou o job para faturamento (linha de job) ou confirmou o BV
--    (linha de BV), e quando. O autor do envio já era o usuário logado
--    (gatilho `envio_faturamento_autor`), só não aparecia. O resto da view
--    é a de
--    `20260929500002_nota_emitida_guarda_cnpj_e_agrupa_por_cnpj.sql`.
--
-- Os preenchimentos só ocupam colunas novas (vazias). Os valores antigos
-- saem da auditoria quando ela tem o evento; sem evento, do que a linha já
-- guardava (`created_by`/`created_at`).

-- 1 e 2. jobs ---------------------------------------------------------------
alter table public.jobs
  add column if not exists enviado_abertura_por uuid references public.profiles(id),
  add column if not exists enviado_abertura_em timestamptz,
  add column if not exists devolvido_em timestamptz;

comment on column public.jobs.enviado_abertura_por is
  'Quem fez o último envio para abertura (o primeiro ou o reenvio depois da devolução). O primeiro envio é created_by. Decisão 136.';
comment on column public.jobs.enviado_abertura_em is
  'Quando foi o último envio para abertura. O primeiro é created_at. Decisão 136.';
comment on column public.jobs.devolvido_em is
  'Quando o financeiro devolveu o job (Reprovar da conferência). Não é apagado no reenvio, para a conferência mostrar a devolução. Decisão 136.';

create index if not exists idx_jobs_enviado_abertura_por on public.jobs (enviado_abertura_por);

-- O preenchimento não deve mexer na data de atualização dos jobs.
alter table public.jobs disable trigger trg_jobs_updated_at;

update public.jobs j
   set enviado_abertura_por = coalesce(r.actor_user_id, j.created_by),
       enviado_abertura_em  = coalesce(r.created_at, j.created_at)
  from public.jobs j2
  left join lateral (
    select a.actor_user_id, a.created_at
      from public.audit_events a
     where a.acao = 'job.reenviado_para_aprovacao'
       and a.entidade_id = j2.id::text
     order by a.created_at desc
     limit 1
  ) r on true
 where j2.id = j.id
   and j.enviado_abertura_em is null;

update public.jobs j
   set devolvido_em = r.created_at
  from (
    select a.entidade_id, max(a.created_at) as created_at
      from public.audit_events a
     where a.acao = 'job.abertura_rejeitada'
     group by a.entidade_id
  ) r
 where r.entidade_id = j.id::text
   and j.devolvido_em is null;

alter table public.jobs enable trigger trg_jobs_updated_at;

-- 3. itens_bv ---------------------------------------------------------------
alter table public.itens_bv
  add column if not exists confirmado_por uuid references public.profiles(id),
  add column if not exists confirmado_em timestamptz;

comment on column public.itens_bv.confirmado_por is
  'Quem confirmou o BV e o mandou ao contas a receber. Decisão 136.';
comment on column public.itens_bv.confirmado_em is
  'Quando o BV foi confirmado. Decisão 136.';

alter table public.itens_bv disable trigger trg_itens_bv_updated_at;

update public.itens_bv b
   set confirmado_por = r.actor_user_id,
       confirmado_em  = r.created_at
  from (
    select distinct on (a.entidade_id) a.entidade_id, a.actor_user_id, a.created_at
      from public.audit_events a
     where a.acao = 'item_bv.confirmado'
     order by a.entidade_id, a.created_at desc
  ) r
 where r.entidade_id = b.id::text
   and b.confirmado_em is null;

alter table public.itens_bv enable trigger trg_itens_bv_updated_at;

-- 4. fila de faturamento com o autor ------------------------------------------
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
            e.mes,
            par.nota_id,
            n.ordem AS nota_ordem,
            (SELECT count(*) FROM jobs_envio_faturamento_notas n2 WHERE n2.envio_id = par.envio_id)::smallint AS nota_total,
            n.cnpj AS nota_cnpj,
            n.cnae_sugerido AS nota_cnae_sugerido,
            n.descritivo AS nota_descritivo
           FROM jobs_envio_faturamento_parcelas par
             JOIN jobs_envio_faturamento e ON e.id = par.envio_id
             JOIN jobs j ON j.id = par.job_id
             JOIN jobs_envio_faturamento_notas n ON n.id = par.nota_id
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
    par.mes AS mes_referencia,
    par.nota_id AS envio_nota_id,
    par.nota_ordem,
    par.nota_total,
    par.nota_cnpj AS cnpj_tomador,
    par.nota_cnae_sugerido AS cnae_sugerido,
    par.nota_descritivo AS descritivo_nota,
    pe.nome AS autor_nome,
    ef.enviado_em AS autor_em
   FROM parcelas par
     JOIN jobs j ON j.id = par.job_id
     JOIN projetos p ON p.id = j.projeto_id
     JOIN jobs_envio_faturamento ef ON ef.id = par.envio_id
     LEFT JOIN profiles pe ON pe.id = ef.enviado_por
  WHERE (j.status = ANY (ARRAY['aberto'::job_status, 'encerrado'::job_status, 'finalizado'::job_status])) AND (par.valor - par.ja_faturado) > 0::numeric
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
    NULL::date AS mes_referencia,
    NULL::uuid AS envio_nota_id,
    NULL::smallint AS nota_ordem,
    NULL::smallint AS nota_total,
    NULL::text AS cnpj_tomador,
    NULL::text AS cnae_sugerido,
    NULL::text AS descritivo_nota,
    pb.nome AS autor_nome,
    bv.confirmado_em AS autor_em
   FROM itens_bv bv
     LEFT JOIN versoes_orcamento_itens v ON v.id = bv.item_versao_id
     LEFT JOIN jobs_itens_orcado jio ON jio.id = bv.job_item_orcado_id
     LEFT JOIN jobs jbv ON jbv.id = jio.job_id
     LEFT JOIN profiles pb ON pb.id = bv.confirmado_por
  WHERE bv.situacao = 'confirmado'::bv_situacao AND NOT (EXISTS ( SELECT 1
           FROM faturamento_itens fi
             JOIN faturamentos f ON f.id = fi.faturamento_id
          WHERE fi.origem_tipo = 'bv'::faturamento_origem AND fi.origem_id = bv.id AND f.status = 'emitido'::faturamento_status));

comment on column public.vw_faturamento_pendente.autor_nome is
  'Linha de job: quem enviou para faturamento. Linha de BV: quem confirmou o BV. Decisão 136.';
comment on column public.vw_faturamento_pendente.autor_em is
  'Quando o job foi enviado para faturamento, ou o BV confirmado. Decisão 136.';
