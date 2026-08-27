-- =====================================================================
-- Fluxo de caixa do job: dois buracos que faziam dinheiro sumir da tela
-- =====================================================================
--
-- Encontrados exercitando a aba "Fluxo de Caixa do Job" com dado real
-- (JOB-0013 e JOB-0015) em 26/08/2026. Os dois são de LEITURA: nenhuma
-- linha de dado é reescrita por esta migration, e as tabelas de origem
-- continuam intactas.
--
-- ---------------------------------------------------------------------
-- 1. PP EM AVALIAÇÃO ABATIA A CURVA SEM VIRAR TÍTULO
-- ---------------------------------------------------------------------
--
-- A view tinha DOIS filtros de PP que não conversavam:
--
--   itens_com_pp (abate a curva)  status <> cancelada, rejeitada
--   branch da PP (vira título)    status  = aprovada, pago
--
-- Entre criar a PP e aprovar a PP o custo não existia em lugar nenhum:
-- saía da previsão pelo planejado do item e não reaparecia como título.
-- No JOB-0013 isso escondia R$ 40.000,00 — a PP-00008 (R$ 37.500,00,
-- `em_avaliacao`) zerava o item B de planejado R$ 40.000,00, e a tela
-- mostrava R$ 25.000,00 de saída onde havia R$ 65.000,00 previstos.
--
-- DECISÃO DO TIAGO (26/08/2026): **PP aprovada é título.** Nas palavras
-- dele, "as previsões só se transformam em títulos quando os itens que
-- faziam a parte do planejado vão se tornando realizado ao serem
-- aprovados e transformados em um título a pagar, depois de terem se
-- tornado uma PP". Ou seja: quem abate é a APROVAÇÃO, não a existência
-- da PP.
--
-- Os dois filtros passam a ser o mesmo. PP em avaliação volta a rolar
-- como previsão, que é onde o dinheiro ainda está enquanto o financeiro
-- não aprovou. A decisão 004 continua valendo em tudo o mais: abate o
-- planejado INTEIRO do item, na ordem cronológica, com piso em zero.
--
-- ---------------------------------------------------------------------
-- 2. RECEBIMENTO PAGO SUMIA DO JOB
-- ---------------------------------------------------------------------
--
-- `dar_baixa_titulo`, `dar_baixa_titulo_com_plano` e
-- `estornar_baixa_titulo` inserem o lançamento SEM `job_id` — e são as
-- únicas três de oito RPCs de baixa que não gravam o campo. Resultado:
-- ao receber, o título saía do branch 5 (status vira `pago`) e o
-- lançamento não entrava no branch 1 com job. A linha "Já movimentado na
-- conta / recebimentos do cliente" era estruturalmente sempre zero, em
-- job nenhum. No banco: o único `titulo_baixa` que existe são
-- R$ 10.959,11 descritos como "Recebimento NF 900123/1 — Serviços
-- prestados — JOB-0015, JOB-0015", com `job_id` nulo.
--
-- O CONSERTO NÃO É PREENCHER `job_id`. Uma nota pode somar vários jobs, e
-- uma coluna só não representa isso — foi por isso que as RPCs a
-- deixaram vazia. O lançamento já grava `titulo_receber_id`, então o job
-- sai do MESMO caminho que o branch 5 já usa para o título em aberto:
-- título → faturamento → `fat_composicao`, rateado pela participação de
-- cada job na nota. Assim o realizado e o previsto do mesmo recebimento
-- são atribuídos pela mesma régua, e nenhuma RPC precisa mudar — o que
-- também mantém esta migration fora das RPCs que a outra frente acabou
-- de reescrever em 25/08 (migrations 20260825000002 e 20260825000005).
--
-- A soma é preservada: os fatores de um mesmo lançamento somam 1. Nota
-- que tem item fora de job mantém essa parcela sem job, como já fazia.
--
-- ---------------------------------------------------------------------
-- 3. COLUNA NOVA `origem_lancamento`
-- ---------------------------------------------------------------------
--
-- A aba do job passa a mostrar a composição do valor no hover/click de
-- cada célula (decisão do Tiago, 26/08/2026), e para isso precisa
-- distinguir uma baixa de um estorno — hoje as duas chegam como
-- `origem_tipo = 'lancamento'`.
--
-- Isso importa porque o estorno de PP entra como ENTRADA (o dinheiro
-- volta para a conta) e sem rótulo ele se lê como recebimento de
-- cliente. Decisão do Tiago: o estorno CONTINUA somando na mesma linha
-- de movimento — o número do extrato é esse —, e quem separa é a
-- composição no hover, que o nomeia como estorno da PP em questão.
--
-- Coluna nova entra NO FIM, como `classe` e `regional_id` entraram em
-- 20260817000006: as colunas existentes ficam no mesmo nome, tipo e
-- posição.
--
-- LADO DESTRUTIVO: NENHUM. `create or replace` nas duas views, nenhuma
-- tabela tocada, nenhuma RPC tocada.
-- =====================================================================

create or replace view public.vw_fluxo_caixa as
  with avulsa_rateio as (
    select r.conta_avulsa_id,
           r.regional_id,
           (r.percentual / 100.0) as fator
      from contas_avulsas_regionais r
    union all
    select a.id,
           coalesce(j.regional_id, e.regional_id) as regional_id,
           1.0 as fator
      from contas_avulsas a
      left join jobs j on j.id = a.job_id
      left join empresas e on e.id = a.empresa_id
     where not exists (
       select 1 from contas_avulsas_regionais r where r.conta_avulsa_id = a.id
     )
  ),
  lancamento_rateio as (
    select l.id as lancamento_id,
           ar.regional_id,
           ar.fator
      from lancamentos_financeiros l
      join avulsa_rateio ar on ar.conta_avulsa_id = l.conta_avulsa_id
    union all
    select l.id,
           coalesce(j.regional_id, e.regional_id) as regional_id,
           1.0 as fator
      from lancamentos_financeiros l
      left join jobs j on j.id = l.job_id
      left join empresas e on e.id = l.empresa_id
     where l.conta_avulsa_id is null
  ),
  fat_composicao as (
    select fi.faturamento_id,
           case when fi.origem_tipo = 'job' then fi.origem_id else null::uuid end as job_id,
           sum(fi.valor) as valor
      from faturamento_itens fi
     group by fi.faturamento_id,
              case when fi.origem_tipo = 'job' then fi.origem_id else null::uuid end
  ),
  fat_total as (
    select fat_composicao.faturamento_id,
           sum(fat_composicao.valor) as total
      from fat_composicao
     group by fat_composicao.faturamento_id
  ),
  -- ── NOVO (26/08/2026): o job de um lançamento de recebimento ───────
  --
  -- Lançamento de baixa/estorno de título não grava `job_id` (a nota
  -- pode somar vários jobs). Aqui ele é expandido em UMA LINHA POR JOB
  -- da nota, com o mesmo rateio do branch 5. Todo o resto passa direto,
  -- com o job que o próprio lançamento gravou e fator 1.
  --
  -- O LEFT JOIN LATERAL é o que faz as duas coisas de uma vez: quando
  -- não há título (ou o lançamento já tem job), ele não devolve linha
  -- nenhuma e o coalesce cai no `l.job_id`.
  lancamento_job as (
    select l.id as lancamento_id,
           coalesce(rat.job_id, l.job_id) as job_id,
           coalesce(rat.fator, 1.0)       as fator
      from lancamentos_financeiros l
      left join lateral (
        select c.job_id,
               (c.valor / nullif(ft.total, 0::numeric)) as fator
          from titulos_receber t
          join fat_composicao c on c.faturamento_id = t.faturamento_id
          join fat_total     ft on ft.faturamento_id = t.faturamento_id
         where t.id = l.titulo_receber_id
           and l.job_id is null
      ) rat on true
  ),
  itens_com_pp as (
    -- 26/08/2026: era `status <> all (cancelada, rejeitada)`, o que fazia
    -- PP em avaliação abater a curva sem virar título. Agora espelha
    -- exatamente o filtro do branch da PP.
    select distinct pc.item_realizado_id
      from pedidos_compra pc
     where pc.status = any (array['aprovada'::pp_status, 'pago'::pp_status])
  ),
  abatimento_curva as (
    select ir.job_id,
           sum(coalesce(voi.total_planejado, 0::numeric))::numeric(14,2) as valor
      from jobs_itens_realizado ir
      join versoes_orcamento_itens voi on voi.id = ir.item_id
     where ir.id in (select item_realizado_id from itens_com_pp)
       and voi.tipo_custo::text = any (array['AR', 'B', 'C', 'F', 'FI'])
     group by ir.job_id
  ),
  curva as (
    select p.id,
           p.tenant_id,
           p.job_id,
           p.ordem,
           p.data_prevista,
           p.valor,
           sum(p.valor) over (
             partition by p.job_id
             order by p.data_prevista, p.ordem, p.id
             rows between unbounded preceding and current row
           ) as acumulado,
           count(*) over (partition by p.job_id) as total_parcelas
      from jobs_previsao_custo p
  ),
  residuo_curva as (
    select c.id,
           c.tenant_id,
           c.job_id,
           c.ordem,
           c.total_parcelas,
           c.data_prevista,
           greatest(0::numeric, least(c.valor, c.acumulado - coalesce(a.valor, 0::numeric)))::numeric(14,2) as valor
      from curva c
      left join abatimento_curva a on a.job_id = c.job_id
  ),
  jobs_com_envio as (
    select distinct e.job_id from jobs_envio_faturamento e
  ),
  previsao_recebimento as (
    select p.id,
           p.tenant_id,
           p.job_id,
           p.ordem,
           p.data_prevista,
           p.valor,
           count(*) over (partition by p.job_id) as total_parcelas
      from jobs_previsao_recebimento p
  ),
  envio_saldo as (
    select pa.id,
           pa.tenant_id,
           pa.job_id,
           pa.ordem,
           pa.data_vencimento,
           (pa.valor - coalesce((
             select sum(fi.valor)
               from faturamento_itens fi
               join faturamentos f on f.id = fi.faturamento_id
              where fi.envio_parcela_id = pa.id
                and f.status <> 'cancelado'
           ), 0::numeric))::numeric(14,2) as valor,
           count(*) over (partition by pa.envio_id) as total_parcelas
      from jobs_envio_faturamento_parcelas pa
  )

  -- ── branch 1: lançamentos realizados ──────────────────────────────
  select
    'realizado'::text                               as situacao,
    'lancamento'::text                              as origem_tipo,
    l.id                                            as origem_id,
    l.tenant_id,
    l.empresa_id,
    l.conta_bancaria_id,
    l.data_movimento                                as data_evento,
    (l.valor * lr.fator * lj.fator)::numeric(14,2)  as valor,
    l.natureza,
    l.descricao,
    l.fornecedor_id,
    l.cliente_id,
    lj.job_id,
    'movimento'::text                               as classe,
    lr.regional_id,
    l.origem::text                                  as origem_lancamento
  from lancamentos_financeiros l
  join lancamento_rateio lr on lr.lancamento_id = l.id
  join lancamento_job    lj on lj.lancamento_id = l.id

  union all

  -- ── branch 2: pedidos de compra (pp) ──────────────────────────────
  select
    'previsto'::text                                as situacao,
    'pp'::text                                      as origem_tipo,
    par.id                                          as origem_id,
    pp.tenant_id,
    pp.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    par.data_pagamento                              as data_evento,
    par.valor::numeric(14,2)                        as valor,
    'saida'::natureza_lancamento                    as natureza,
    'PP ' || pp.codigo || ' ' || par.numero || '/' || tot.total
      || ' — ' || substring(pp.servico, 1, 150)     as descricao,
    pp.fornecedor_id,
    null::uuid                                      as cliente_id,
    pp.job_id,
    'titulo'::text                                  as classe,
    jb.regional_id,
    null::text                                      as origem_lancamento
  from pedidos_compra_parcelas par
  join pedidos_compra pp on pp.id = par.pedido_compra_id
  join jobs jb on jb.id = pp.job_id
  join lateral (
    select count(*)::int as total
      from pedidos_compra_parcelas x
     where x.pedido_compra_id = par.pedido_compra_id
  ) tot on true
  where pp.status in ('aprovada', 'pago')
    and par.pago_em is null

  union all

  -- ── branch 3: contas avulsas / recorrentes ─────────────────────────
  select
    'previsto'::text                                as situacao,
    case when a.recorrente_id is not null then 'recorrente'::text
         else 'avulsa'::text end                    as origem_tipo,
    a.id                                            as origem_id,
    a.tenant_id,
    a.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    coalesce(a.data_pagamento, a.data_prevista_pagamento) as data_evento,
    (a.valor * ar.fator)::numeric(14,2)             as valor,
    a.natureza,
    a.descricao,
    a.fornecedor_id,
    a.cliente_id,
    a.job_id,
    'titulo'::text                                  as classe,
    ar.regional_id,
    null::text                                      as origem_lancamento
  from contas_avulsas a
  join avulsa_rateio ar on ar.conta_avulsa_id = a.id
  where a.status = 'aprovada'

  union all

  -- ── branch 4: desembolsos (parcelas aprovadas ainda não pagas) ─────
  select
    'previsto'::text                                as situacao,
    'desembolso'::text                              as origem_tipo,
    par.id                                          as origem_id,
    d.tenant_id,
    d.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    par.data_pagamento                              as data_evento,
    par.valor::numeric(14,2)                        as valor,
    'saida'::natureza_lancamento                    as natureza,
    'Desembolso ' || d.codigo || ' ' || par.numero || '/' || tot.total
      || ' — ' || substring(d.descricao, 1, 150)   as descricao,
    d.fornecedor_id,
    d.cliente_id,
    d.job_id,
    'titulo'::text                                  as classe,
    jb.regional_id,
    null::text                                      as origem_lancamento
  from desembolsos_parcelas par
  join desembolsos d on d.id = par.desembolso_id
  left join jobs jb on jb.id = d.job_id
  join lateral (
    select count(*)::int as total
      from desembolsos_parcelas x
     where x.desembolso_id = par.desembolso_id
  ) tot on true
  where d.status in ('aprovada', 'pago')
    and par.pago_em is null

  union all

  -- ── branch 5: títulos a receber ────────────────────────────────────
  select
    'previsto'::text                                as situacao,
    'titulo'::text                                  as origem_tipo,
    t.id                                            as origem_id,
    t.tenant_id,
    t.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    coalesce(t.data_previsao_recebimento, t.data_vencimento) as data_evento,
    (t.valor * coalesce(c.valor / nullif(ft.total, 0::numeric), 1::numeric))::numeric(14,2) as valor,
    'entrada'::natureza_lancamento                  as natureza,
    'Título NF ' || f.numero_nf || '/' || t.numero_parcela::text as descricao,
    f.fornecedor_id,
    f.cliente_id,
    c.job_id,
    'titulo'::text                                  as classe,
    coalesce(j.regional_id, e.regional_id)          as regional_id,
    null::text                                      as origem_lancamento
  from titulos_receber t
  join faturamentos f on f.id = t.faturamento_id
  left join fat_composicao c on c.faturamento_id = t.faturamento_id
  left join fat_total ft on ft.faturamento_id = t.faturamento_id
  left join jobs j on j.id = c.job_id
  left join empresas e on e.id = t.empresa_id
  where t.status = 'em_aberto'

  union all

  -- ── branch 6: previsão de custo (curva) ───────────────────────────
  select
    'previsto'::text                                as situacao,
    'previsao_custo'::text                          as origem_tipo,
    r.id                                            as origem_id,
    r.tenant_id,
    j.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    case when r.data_prevista < current_date
         then fc_proxima_janela_pagamento(current_date)
         else r.data_prevista end                   as data_evento,
    r.valor,
    'saida'::natureza_lancamento                    as natureza,
    'Curva ' || j.codigo || ' · desembolso ' || r.ordem || '/' || r.total_parcelas as descricao,
    null::uuid                                      as fornecedor_id,
    pj.cliente_id,
    r.job_id,
    'previsao'::text                                as classe,
    j.regional_id,
    null::text                                      as origem_lancamento
  from residuo_curva r
  join jobs j on j.id = r.job_id
  left join projetos pj on pj.id = j.projeto_id
  where r.valor > 0::numeric
    and j.status = any (array['aberto'::job_status, 'em_producao'::job_status])

  union all

  -- ── branch 7: previsão de recebimento ────────────────────────────
  select
    'previsto'::text                                as situacao,
    'previsao_recebimento'::text                    as origem_tipo,
    p.id                                            as origem_id,
    p.tenant_id,
    j.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    case when p.data_prevista < current_date
         then current_date + 1
         else p.data_prevista end                   as data_evento,
    p.valor,
    'entrada'::natureza_lancamento                  as natureza,
    'Previsão de recebimento · ' || j.codigo || ' ' || p.ordem || '/' || p.total_parcelas as descricao,
    null::uuid                                      as fornecedor_id,
    pj.cliente_id,
    p.job_id,
    'previsao'::text                                as classe,
    j.regional_id,
    null::text                                      as origem_lancamento
  from previsao_recebimento p
  join jobs j on j.id = p.job_id
  left join projetos pj on pj.id = j.projeto_id
  where p.valor > 0::numeric
    and j.status = any (array['aberto'::job_status, 'em_producao'::job_status])
    and not exists (select 1 from jobs_com_envio ce where ce.job_id = p.job_id)

  union all

  -- ── branch 8: envio de faturamento ───────────────────────────────
  select
    'previsto'::text                                as situacao,
    'envio_parcela'::text                           as origem_tipo,
    s.id                                            as origem_id,
    s.tenant_id,
    j.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    case when s.data_vencimento < current_date
         then current_date + 1
         else s.data_vencimento end                 as data_evento,
    s.valor,
    'entrada'::natureza_lancamento                  as natureza,
    'Faturamento previsto · ' || j.codigo || ' parcela ' || s.ordem || '/' || s.total_parcelas as descricao,
    null::uuid                                      as fornecedor_id,
    pj.cliente_id,
    s.job_id,
    'previsao'::text                                as classe,
    j.regional_id,
    null::text                                      as origem_lancamento
  from envio_saldo s
  join jobs j on j.id = s.job_id
  left join projetos pj on pj.id = j.projeto_id
  where s.valor > 0::numeric
    and j.status = any (array['aberto'::job_status, 'em_producao'::job_status]);

comment on view public.vw_fluxo_caixa is
  'Fluxo de caixa em três classes (movimento, titulo, previsao). Desde '
  '26/08/2026: só PP aprovada abate a curva de desembolso, e o lançamento '
  'de baixa/estorno de título é rateado por job pela composição da nota, '
  'porque as RPCs de recebimento não gravam job_id. A coluna '
  'origem_lancamento traz lancamentos_financeiros.origem para a tela '
  'distinguir baixa de estorno na composição do valor.';


-- ---------------------------------------------------------------------
-- vw_fluxo_caixa_job_totais — recriada só para herdar o conserto
-- ---------------------------------------------------------------------
--
-- A view não muda de forma; ela lê `vw_fluxo_caixa` e por isso já herda
-- os dois consertos. O `create or replace` está aqui para o caso de o
-- Postgres ter cacheado a definição antiga da dependente, e para a
-- exclusão de avulsa/desembolso descrita abaixo.
--
-- REGRA NOVA (Tiago, 26/08/2026): o que não é PP não entra no fluxo do
-- JOB antes da baixa. Conta avulsa e desembolso aprovados aparecem no
-- Fluxo de Caixa geral — são compromisso real da empresa —, mas no
-- recorte por job só entram depois de pagos, como movimento. O motivo é
-- que a curva de desembolso da abertura só é abatida por PP: uma avulsa
-- aprovada somaria como título a pagar sem tirar nada da previsão.
--
-- Hoje isso não muda número nenhum — nenhuma avulsa e nenhum desembolso
-- está vinculado a job (só as 11 PPs, R$ 93.900,00). É régua para
-- frente.
create or replace view public.vw_fluxo_caixa_job_totais as
select
  v.tenant_id,
  v.job_id,
  coalesce(sum(v.valor) filter (where v.natureza = 'entrada'), 0)::numeric(14,2)
    as recebimentos_total,
  coalesce(sum(v.valor) filter (
    where v.natureza = 'entrada' and v.classe = 'movimento'
  ), 0)::numeric(14,2) as recebimentos_realizado,
  coalesce(sum(v.valor) filter (where v.natureza = 'saida'), 0)::numeric(14,2)
    as custos_total,
  coalesce(sum(v.valor) filter (
    where v.natureza = 'saida' and v.classe = 'movimento'
  ), 0)::numeric(14,2) as custos_realizado
from public.vw_fluxo_caixa v
where v.job_id is not null
  and not (
    v.classe = 'titulo'
    and v.origem_tipo in ('avulsa', 'recorrente', 'desembolso')
  )
group by v.tenant_id, v.job_id;

comment on view public.vw_fluxo_caixa_job_totais is
  'Recebimentos e custos totais de cada job: movimento + titulo + previsao '
  'da vw_fluxo_caixa, com o realizado (classe movimento) recortado a parte. '
  'Uma linha por job. Usada pela aba Visualizar Jobs do financeiro. Desde '
  '26/08/2026 avulsa e desembolso em aberto ficam de fora do recorte por '
  'job: só PP abate a curva, então eles só entram depois da baixa.';

grant select on public.vw_fluxo_caixa_job_totais to authenticated;
revoke all on public.vw_fluxo_caixa_job_totais from anon;
