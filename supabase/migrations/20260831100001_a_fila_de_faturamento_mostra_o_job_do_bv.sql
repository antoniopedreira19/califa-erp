-- ---------------------------------------------------------------------------
-- O BV passa a dizer de qual job ele saiu.
--
-- Na fila de faturamento o BV aparecia sem código: a coluna "Job / descrição"
-- mostrava "BV — <item>" e, embaixo, nada. Quem olhava a fila não tinha como
-- saber a que trabalho aquele BV pertencia sem abrir o orçamento.
--
-- E BV sempre pertence a um job (Tiago, 31/08/2026): ele nasce de um item da
-- versão aprovada, que a abertura copia para `jobs_itens_orcado`. O caminho
-- já existia e estava preenchido em 100% dos BVs — só não era navegado aqui.
--
--   itens_bv.job_item_orcado_id -> jobs_itens_orcado.job_id -> jobs
--
-- Duas mudanças, ambas no ramo do BV:
--
--   `codigo`  deixa de ser NULL e passa a trazer o código do job.
--   `job_id`  é coluna NOVA, no fim da lista (é onde `create or replace view`
--             deixa acrescentar), e vale para os dois ramos: no ramo do job é
--             o próprio job, no do BV é o job de origem.
--
-- `origem_id` NÃO muda: continua sendo o id do BV, porque é ele que o item da
-- nota aponta e é por ele que a view sabe que o BV já foi faturado. Confundir
-- os dois quebraria a emissão.
--
-- LEFT JOIN, e não JOIN: `job_item_orcado_id` aceita nulo, e um BV órfão tem
-- de continuar aparecendo na fila sem código — sumir da fila é pior que
-- aparecer incompleto.
-- ---------------------------------------------------------------------------

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
            GREATEST(0::numeric, LEAST(par.valor, COALESCE(j.faturamento_previsto, 0::numeric) - COALESCE(j.faturamento_save_previsto, 0::numeric) - (sum(par.valor) OVER (PARTITION BY par.envio_id ORDER BY par.ordem, par.id) - par.valor)))::numeric(14,2) AS bruto_proprio
           FROM jobs_envio_faturamento_parcelas par
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
    j.id AS job_id
   FROM parcelas par
     JOIN jobs j ON j.id = par.job_id
     JOIN projetos p ON p.id = j.projeto_id
  WHERE j.status = 'aberto'::job_status AND (par.valor - par.ja_faturado) > 0::numeric
UNION ALL
 SELECT 'bv'::text AS origem_tipo,
    bv.id AS origem_id,
    bv.tenant_id,
    NULL::uuid AS empresa_id,
    jbv.codigo AS codigo,
    'BV — '::text || v.item AS descricao,
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
    jio.job_id AS job_id
   FROM itens_bv bv
     JOIN versoes_orcamento_itens v ON v.id = bv.item_versao_id
     LEFT JOIN jobs_itens_orcado jio ON jio.id = bv.job_item_orcado_id
     LEFT JOIN jobs jbv ON jbv.id = jio.job_id
  WHERE bv.situacao = 'confirmado'::bv_situacao AND NOT (EXISTS ( SELECT 1
           FROM faturamento_itens fi
             JOIN faturamentos f ON f.id = fi.faturamento_id
          WHERE fi.origem_tipo = 'bv'::faturamento_origem AND fi.origem_id = bv.id AND f.status = 'emitido'::faturamento_status));

comment on view public.vw_faturamento_pendente is
  'A fila da aba Faturamento: uma linha por parcela de envio do job, mais uma por BV confirmado ainda nao faturado. `origem_id` e o que o item da nota aponta (job ou BV); `job_id` e sempre o job, e no BV vem de itens_bv.job_item_orcado_id.';

-- A view herda o dono, mas o GRANT e explicito por regra do projeto.
grant select on public.vw_faturamento_pendente to authenticated;
