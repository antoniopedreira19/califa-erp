-- =====================================================================
-- Registro financeiro dos jobs abertos antes da tela existir
--
-- JOB-0001 a JOB-0007 foram abertos pelo botão antigo, que só trocava o
-- status: ficaram `aberto` sem categoria, competência, custo previsto,
-- carimbo de abertura nem curva. Na lista de Jobs Abertos eles apareceriam
-- com traço em quase tudo, e ficariam fora de qualquer relatório por
-- competência ou de fluxo de caixa.
--
-- São jobs de teste, mas feitos pelas pessoas que vão usar o sistema —
-- o time pediu para preservá-los e preenchê-los com o mesmo padrão dos
-- jobs corretos (decisão do time, 12/08/2026).
--
-- De onde vem cada valor:
--
--   nome_financeiro   = `nome`. Precedente: nos três jobs abertos pela
--                       tela (0008, 0009, 0010) o financeiro não
--                       renomeou — nome_financeiro == nome nos três.
--   categoria_id      = "Evento", escopo job. É o precedente majoritário
--                       (0008 e 0009; o 0010 usou "Trade · PDV"). Os sete
--                       têm nome de teste, sem natureza que indique outra
--                       categoria. Trocar depois é editar um campo.
--   competência       = trimestre e ano de `data_inicio_prevista`, que é
--                       exatamente a regra que o formulário aplica.
--   custo_previsto    = planejado dos itens de calha PP (AR, B, C, F, FI),
--                       a regra de docs/decisions/004.
--   abertura / autor  = data e ator REAIS, lidos de `audit_events`
--                       (`job.abertura_aprovada`). Não foram inventados.
--   curva             = gerada pelas próprias funções de produção
--                       (`abertura-de-job/curva.ts` → `sugerirCurva`),
--                       executadas sobre estes jobs; os valores abaixo são
--                       a saída literal, conferida: todas somam o custo
--                       previsto e caem em janela de pagamento válida.
--
-- Duas consequências registradas, ambas efeito da regra e não desvio:
--
--   * JOB-0004 e JOB-0006 (250.900 e 342.200) teriam 3 parcelas pelo
--     tamanho, mas o período do job tem 3 dias e não contém nenhuma
--     janela — caíram no fallback de parcela única na primeira janela
--     seguinte (10/08). Período de teste irreal, não erro da regra.
--   * A curva do JOB-0002 fica em 08/07/2026, data já passada: é quando o
--     desembolso era previsto. O fluxo de caixa rola saldo vencido para a
--     próxima janela (docs/decisions/004), então isso se resolve na
--     leitura.
--
-- Idempotente: só toca em job `aberto` sem `data_abertura_financeiro`, e
-- só insere curva onde ainda não existe nenhuma.
-- =====================================================================

-- ---------- 1. Registro contábil ----------
update public.jobs j
   set nome_financeiro = coalesce(j.nome_financeiro, j.nome),
       categoria_id = coalesce(
         j.categoria_id,
         (select c.id from public.categorias_dominio c
           where c.tenant_id = j.tenant_id
             and c.escopo = 'job'
             and lower(c.nome) = 'evento'
           limit 1)
       ),
       competencia_trimestre = coalesce(
         j.competencia_trimestre,
         floor((extract(month from j.data_inicio_prevista) - 1) / 3)::int + 1
       ),
       competencia_ano = coalesce(
         j.competencia_ano,
         extract(year from j.data_inicio_prevista)::int
       ),
       custo_previsto_total = coalesce(
         j.custo_previsto_total,
         (select round(coalesce(sum(i.total_planejado) filter (
                   where i.tipo_custo in ('AR','B','C','F','FI')), 0), 2)
            from public.jobs_itens_orcado i
           where i.job_id = j.id)
       ),
       data_abertura_financeiro = coalesce(
         j.data_abertura_financeiro,
         (select a.created_at from public.audit_events a
           where a.entidade_id = j.id::text
             and a.acao = 'job.abertura_aprovada'
           order by a.created_at limit 1)
       ),
       aberto_por = coalesce(
         j.aberto_por,
         (select a.actor_user_id from public.audit_events a
           where a.entidade_id = j.id::text
             and a.acao = 'job.abertura_aprovada'
             and exists (select 1 from auth.users u where u.id = a.actor_user_id)
           order by a.created_at limit 1)
       )
 where j.status = 'aberto'
   and j.data_abertura_financeiro is null
   and j.data_inicio_prevista is not null;

-- ---------- 2. Curva de desembolso ----------
-- Saída literal de `sugerirCurva` (código de produção) para estes jobs.
insert into public.jobs_previsao_custo
       (tenant_id, job_id, ordem, data_prevista, valor, created_by)
select j.tenant_id, j.id, v.ordem, v.data_prevista, v.valor, j.aberto_por
  from (values
    ('JOB-0001', 1::smallint, date '2026-08-10',   2500.00::numeric),
    ('JOB-0002', 1::smallint, date '2026-07-08',  26600.00::numeric),
    ('JOB-0003', 1::smallint, date '2026-08-10',   9000.00::numeric),
    ('JOB-0004', 1::smallint, date '2026-08-10', 250900.00::numeric),
    ('JOB-0005', 1::smallint, date '2026-08-10',   1500.00::numeric),
    ('JOB-0006', 1::smallint, date '2026-08-10', 342200.00::numeric),
    ('JOB-0007', 1::smallint, date '2026-08-10',   1500.00::numeric)
  ) as v(codigo, ordem, data_prevista, valor)
  join public.jobs j on j.codigo = v.codigo
 where j.status = 'aberto'
   and not exists (
     select 1 from public.jobs_previsao_custo pc where pc.job_id = j.id
   );
