-- =====================================================================
-- Tela 3.4 — Fluxo de Caixa: as previsões da abertura entram na view
-- =====================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- A `vw_fluxo_caixa` de hoje enxerga TÍTULO e MOVIMENTO, nunca PREVISÃO.
-- O "previsto" dela é PP aprovada, conta avulsa aprovada e título a
-- receber em aberto — tudo documento que já existe. As duas previsões
-- que nascem na abertura do job (`jobs_previsao_custo`, decisão 004, e
-- `jobs_previsao_recebimento`, decisão 015) ficam de fora.
--
-- O efeito é o buraco registrado na seção 14 do HANDOFF_FINANCEIRO: o
-- caixa só enxerga o desembolso depois da PP existir, e a entrada só
-- depois da NF sair. Some exatamente o horizonte entre abrir o job e
-- emitir os documentos — que é o horizonte que a Tela 3.4 existe para
-- mostrar.
--
-- Esta migration fecha isso: a view passa a ter TRÊS classes de linha, e
-- é essa coluna nova (`classe`) que a matriz período × natureza usa para
-- separar as três sub-linhas de cada natureza.
--
--   movimento  — dinheiro que já entrou/saiu da conta (realizado)
--   titulo     — documento em aberto (PP, avulsa, título a receber)
--   previsao   — curva da abertura do job, ainda sem documento
--
-- DECISÕES DO TIAGO QUE ESTA MIGRATION MATERIALIZA (17/08/2026)
--
-- • O ENVIO PARA FATURAMENTO SOBRESCREVE A PREVISÃO DA ABERTURA. Job SEM
--   envio projeta pela `jobs_previsao_recebimento`; job COM envio projeta
--   pelas `jobs_envio_faturamento_parcelas`, que são a previsão mais
--   real — a produção já disse em quantas notas e para quando. A
--   previsão da abertura sai inteira nesse momento, e as duas nunca se
--   somam (ambas fecham contra `jobs.faturamento_previsto`).
--   Sobrescrever é SÓ LEITURA: nada é apagado nem reescrito em
--   `jobs_previsao_recebimento`, que continua sendo o registro do que se
--   previa na abertura — é o que permite comparar previsto × realizado
--   depois. Era a lacuna que as decisões 015 e 017 deixaram por escrito.
--
-- • PARCELA FATURADA EM PARTE MANTÉM O SALDO PREVISTO, NA DATA DELA.
--   Parcela de R$ 50 mil com NF parcial de R$ 30 mil: R$ 30 mil viram
--   título (e aparecem na classe `titulo`), R$ 20 mil continuam em
--   `previsao`, no vencimento da parcela. É o mesmo saldo remanescente
--   que a aba Faturamento já mostra.
--
-- • PREVISÃO DE RECEBIMENTO VENCIDA E SEM NF É LIDA EM HOJE + 1. Rola
--   todo dia, como a curva de desembolso rola por janela de pagamento
--   (decisão 004 §3) — e, como o cálculo é feito na leitura, rolar "para
--   o dia seguinte" todo dia é o mesmo que pousar sempre em amanhã.
--   Sem isso, previsão velha ficaria parada numa coluna rotulada
--   REALIZADO, misturada com o que de fato entrou na conta.
--
-- • RATEIO DE REGIONAL ENTRA PROPORCIONAL. Avulsa de R$ 10 mil rateada
--   60% NE / 40% SP entra com R$ 6 mil quando o filtro é NE. Daí a view
--   passar a emitir UMA LINHA POR REGIONAL nas origens que têm rateio —
--   ver "o que muda para quem já lê a view", no fim.
--
-- O ABATIMENTO DA SAÍDA JÁ TINHA REGRA ESCRITA (decisão 004) e é a que
-- está implementada aqui, sem invenção: resíduo = curva da abertura −
-- planejado dos itens que já têm PP, consumido da data mais próxima para
-- a mais distante com piso em zero, e o que venceu sem virar PP rola
-- para a próxima janela de pagamento (dia 08 ou 20, ajustada para o dia
-- útil seguinte). A curva gravada nunca é tocada: o resíduo é calculado
-- na leitura, como a própria decisão 004 manda — assim cancelar uma PP
-- desfaz o abatimento sozinho.
--
-- LADO DESTRUTIVO: NENHUM. Nada é removido, renomeado ou reescrito.
-- Duas funções de data, uma função de saldo e a view redefinida com
-- `create or replace` — as 13 colunas existentes ficam no mesmo nome,
-- tipo e posição, e `classe` e `regional_id` entram no fim. Nenhuma
-- linha de dado é tocada em tabela nenhuma.
--
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Janelas de pagamento, em SQL
-- ---------------------------------------------------------------------
--
-- Espelho fiel de `ajustarParaDiaUtil` e `proximaJanelaDePagamento` de
-- `app/(app)/financeiro/abertura-de-job/curva.ts`. Existem duas cópias da
-- mesma regra porque são dois momentos diferentes: o TypeScript SUGERE E
-- TRAVA a data quando o financeiro abre o job; o SQL ROLA a data quando
-- a previsão venceu sem virar PP. Quem manda continua sendo a decisão
-- 004, e as duas cópias precisam concordar.
--
-- Feriado continua NÃO tratado, aqui e lá: não existe calendário de
-- feriados no sistema. Quando existir, entra nos dois lugares.

create or replace function public.fc_ajusta_dia_util(d date)
returns date
language sql
immutable
set search_path = ''
as $$
  -- isodow: 1 = segunda ... 6 = sábado, 7 = domingo
  select case extract(isodow from d)::int
           when 6 then d + 2   -- sábado  -> segunda
           when 7 then d + 1   -- domingo -> segunda
           else d
         end;
$$;

comment on function public.fc_ajusta_dia_util(date) is
  'Sábado/domingo empurram para a segunda-feira seguinte. Feriado não é '
  'tratado — não existe calendário de feriados no sistema (decisão 004).';

create or replace function public.fc_proxima_janela_pagamento(d date)
returns date
language sql
immutable
set search_path = ''
as $$
  -- As duas janelas do mês de `d` e as duas do mês seguinte cobrem
  -- qualquer ponto de partida, inclusive um dia 21+ e um dia 08 que caiu
  -- em fim de semana e escorregou.
  select min(j)
  from (values
    (public.fc_ajusta_dia_util((date_trunc('month', d)::date) + 7)),
    (public.fc_ajusta_dia_util((date_trunc('month', d)::date) + 19)),
    (public.fc_ajusta_dia_util(((date_trunc('month', d) + interval '1 month')::date) + 7)),
    (public.fc_ajusta_dia_util(((date_trunc('month', d) + interval '1 month')::date) + 19))
  ) as c(j)
  where j >= d;
$$;

comment on function public.fc_proxima_janela_pagamento(date) is
  'Primeira janela de pagamento (dia 08 ou 20, ajustada para dia útil) '
  'cuja data é >= a data dada. Decisão 004. Espelha '
  'proximaJanelaDePagamento() de abertura-de-job/curva.ts.';

revoke execute on function public.fc_ajusta_dia_util(date) from public;
revoke execute on function public.fc_proxima_janela_pagamento(date) from public;
grant execute on function public.fc_ajusta_dia_util(date) to authenticated;
grant execute on function public.fc_proxima_janela_pagamento(date) to authenticated;


-- ---------------------------------------------------------------------
-- 2. Saldo bancário por conta, numa data de referência
-- ---------------------------------------------------------------------
--
-- O protótipo RECONSTRÓI o saldo de abertura (saldo de hoje menos o
-- realizado da janela exibida). Na implementação real isso é lido do
-- razão, que é a fonte: saldo inicial cadastrado da conta + todos os
-- lançamentos até a data pedida.
--
-- A tela chama esta função duas vezes: na data anterior à primeira
-- coluna da matriz (para semear a linha "Saldo projetado") e em
-- `current_date` (para o indicador "Saldo hoje").
--
-- O QUE É O SALDO INICIAL (Tiago, 17/08/2026): a âncora de conciliação
-- da conta. Serve para o sistema bater com o extrato real sem precisar
-- do histórico inteiro desde que a conta existe — cadastra-se o saldo
-- de uma data e o razão passa a correr dali para frente. Por isso os
-- dois campos travam assim que a conta ganha o primeiro lançamento.
--
-- CONVENÇÃO ADOTADA: `saldo_inicial` é o saldo NA ABERTURA do dia
-- `saldo_inicial_data` — ou seja, lançamento DAQUELE dia soma por cima.
-- Não havia convenção escrita e não há lançamento nenhum no banco hoje,
-- então o efeito prático é nulo; inverter (saldo = fechamento do próprio
-- dia) é trocar `>=` por `>` na linha do `data_movimento`, e nada mais.

create or replace function public.fc_saldos_por_conta(p_data date)
returns table (conta_bancaria_id uuid, saldo numeric(14,2))
language sql
stable
set search_path = ''
as $$
  select c.id,
         (c.saldo_inicial + coalesce(sum(
            case when l.natureza = 'entrada' then l.valor else -l.valor end
          ), 0))::numeric(14,2)
  from public.contas_bancarias c
  left join public.lancamentos_financeiros l
         on l.conta_bancaria_id = c.id
        and l.data_movimento >= c.saldo_inicial_data
        and l.data_movimento <= p_data
  where c.ativo
  group by c.id, c.saldo_inicial;
$$;

comment on function public.fc_saldos_por_conta(date) is
  'Saldo de cada conta bancária ativa na data de referência: saldo '
  'inicial cadastrado + lançamentos até a data. Roda como o chamador '
  '(RLS de lancamentos_financeiros vale).';

revoke execute on function public.fc_saldos_por_conta(date) from public;
grant execute on function public.fc_saldos_por_conta(date) to authenticated;


-- ---------------------------------------------------------------------
-- 3. vw_fluxo_caixa — as três classes
-- ---------------------------------------------------------------------
--
-- SEM `security_invoker`, DE PROPÓSITO — decisão do Tiago (17/08/2026).
--
-- A view é do `postgres` e, sem essa opção, roda com os poderes do dono:
-- IGNORA a RLS das tabelas de baixo. Quem tem login lê o financeiro de
-- qualquer tenant se driblar o filtro `tenant_id` da página. Vale para
-- as três views do schema, não é novidade desta migration, e o problema
-- não piora aqui — mas passa a cobrir mais tabelas, porque a view lê
-- mais tabelas.
--
-- Ligar `security_invoker = true` fecha isso numa linha, e conferi que
-- não quebraria nada: as 17 tabelas de origem têm RLS ligada e policy de
-- SELECT `is_tenant_member(tenant_id)` para `authenticated`. Fica para a
-- fase de cadastro de usuários e acessos, que o Tiago colocou depois de
-- todas as telas estarem definidas — registrado como pendência no plano
-- de alterações.

create or replace view public.vw_fluxo_caixa as
with

-- ---- rateio de regional -------------------------------------------------
-- Conta avulsa é a única origem que se divide entre regionais. As demais
-- herdam a regional do job (ou, sem job, a da empresa). Uma linha por
-- regional, com o fator que multiplica o valor.
avulsa_rateio as (
  select r.conta_avulsa_id,
         r.regional_id,
         (r.percentual / 100.0)::numeric as fator
  from public.contas_avulsas_regionais r
  union all
  select a.id,
         coalesce(j.regional_id, e.regional_id),
         1.0::numeric
  from public.contas_avulsas a
  left join public.jobs j     on j.id = a.job_id
  left join public.empresas e on e.id = a.empresa_id
  where not exists (
    select 1 from public.contas_avulsas_regionais r
    where r.conta_avulsa_id = a.id
  )
),

-- Lançamento herda o rateio da avulsa que ele baixou; sem avulsa, a
-- regional do job, e sem job a da empresa.
lancamento_rateio as (
  select l.id as lancamento_id, ar.regional_id, ar.fator
  from public.lancamentos_financeiros l
  join avulsa_rateio ar on ar.conta_avulsa_id = l.conta_avulsa_id
  union all
  select l.id,
         coalesce(j.regional_id, e.regional_id),
         1.0::numeric
  from public.lancamentos_financeiros l
  left join public.jobs j     on j.id = l.job_id
  left join public.empresas e on e.id = l.empresa_id
  where l.conta_avulsa_id is null
),

-- Uma NF pode cobrir vários jobs (decisão 017 §1), e o título é parcela
-- DA NOTA, não do job. A regional do título sai da composição da nota:
-- cada job entra na proporção do que representa nela. Linhas de BV e de
-- faturamento avulso não têm job — caem na regional da empresa.
fat_composicao as (
  select fi.faturamento_id,
         case when fi.origem_tipo = 'job' then fi.origem_id end as job_id,
         sum(fi.valor) as valor
  from public.faturamento_itens fi
  group by 1, 2
),
fat_total as (
  select faturamento_id, sum(valor) as total
  from fat_composicao
  group by 1
),

-- ---- saída: resíduo da curva de desembolso (decisão 004) -----------------
-- Item que já ganhou PP sai da previsão pelo PLANEJADO INTEIRO, mesmo que
-- a PP tenha saído por menos (regra 1). PP cancelada ou rejeitada não
-- abate — é isso que faz cancelar PP devolver a previsão sozinho.
itens_com_pp as (
  select distinct pc.item_realizado_id
  from public.pedidos_compra pc
  where pc.status not in ('cancelada', 'rejeitada')
),
abatimento_curva as (
  select ir.job_id,
         sum(coalesce(voi.total_planejado, 0))::numeric(14,2) as valor
  from public.jobs_itens_realizado ir
  join public.versoes_orcamento_itens voi on voi.id = ir.item_id
  where ir.id in (select item_realizado_id from itens_com_pp)
    -- só calha PP: item A/D é pago pelo cliente direto ao fornecedor e
    -- nunca gerou previsão, então também não pode abatê-la.
    and voi.tipo_custo::text in ('AR', 'B', 'C', 'F', 'FI')
  group by ir.job_id
),
curva as (
  select p.id, p.tenant_id, p.job_id, p.ordem, p.data_prevista, p.valor,
         sum(p.valor) over (
           partition by p.job_id
           order by p.data_prevista, p.ordem, p.id
           rows between unbounded preceding and current row
         ) as acumulado,
         count(*) over (partition by p.job_id) as total_parcelas
  from public.jobs_previsao_custo p
),
residuo_curva as (
  -- Consumo cronológico, mais próxima primeiro (regra 2): o que sobra
  -- nesta parcela é o acumulado até ela menos o abatimento, limitado ao
  -- valor da própria parcela e com piso em zero.
  select c.id, c.tenant_id, c.job_id, c.ordem, c.total_parcelas,
         c.data_prevista,
         greatest(
           0,
           least(c.valor, c.acumulado - coalesce(a.valor, 0))
         )::numeric(14,2) as valor
  from curva c
  left join abatimento_curva a on a.job_id = c.job_id
),

-- ---- entrada: previsão da abertura, ou do envio ------------------------
jobs_com_envio as (
  select distinct e.job_id from public.jobs_envio_faturamento e
),
-- O total de parcelas sai daqui, e não de um window no SELECT final: lá
-- ele contaria depois do WHERE e uma parcela zerada faria "1/3" virar
-- "1/2".
previsao_recebimento as (
  select p.id, p.tenant_id, p.job_id, p.ordem, p.data_prevista,
         p.valor::numeric(14,2) as valor,
         count(*) over (partition by p.job_id) as total_parcelas
  from public.jobs_previsao_recebimento p
),
envio_saldo as (
  select pa.id, pa.tenant_id, pa.job_id, pa.ordem, pa.data_vencimento,
         (pa.valor - coalesce((
            select sum(fi.valor)
            from public.faturamento_itens fi
            join public.faturamentos f on f.id = fi.faturamento_id
            where fi.envio_parcela_id = pa.id
              and f.status <> 'cancelado'
          ), 0))::numeric(14,2) as valor,
         count(*) over (partition by pa.envio_id) as total_parcelas
  from public.jobs_envio_faturamento_parcelas pa
)

-- =====================================================================
-- 3.1 REALIZADO — o que já passou pela conta
-- =====================================================================
select 'realizado'::text                       as situacao,
       'lancamento'::text                      as origem_tipo,
       l.id                                    as origem_id,
       l.tenant_id,
       l.empresa_id,
       l.conta_bancaria_id,
       l.data_movimento                        as data_evento,
       (l.valor * lr.fator)::numeric(14,2)     as valor,
       l.natureza,
       l.descricao,
       l.fornecedor_id,
       l.cliente_id,
       l.job_id,
       'movimento'::text                       as classe,
       lr.regional_id
from public.lancamentos_financeiros l
join lancamento_rateio lr on lr.lancamento_id = l.id

union all

-- =====================================================================
-- 3.2 TÍTULO — documento em aberto
-- =====================================================================

-- PP aprovada, parcela ainda não paga
select 'previsto'::text,
       'pp'::text,
       par.id,
       pp.tenant_id,
       pp.empresa_id,
       null::uuid,
       par.data_pagamento,
       par.valor::numeric(14,2),
       'saida'::public.natureza_lancamento,
       'PP ' || pp.codigo || ' ' || par.numero || '/' || tot.total
         || ' — ' || substring(pp.servico, 1, 150),
       pp.fornecedor_id,
       null::uuid,
       pp.job_id,
       'titulo'::text,
       jb.regional_id
from public.pedidos_compra_parcelas par
join public.pedidos_compra pp on pp.id = par.pedido_compra_id
join public.jobs jb           on jb.id = pp.job_id
join lateral (
  select count(*)::integer as total
  from public.pedidos_compra_parcelas x
  where x.pedido_compra_id = par.pedido_compra_id
) tot on true
where pp.status in ('aprovada', 'pago')
  and par.pago_em is null

union all

-- Conta avulsa aprovada (e recorrência gerada), rateada por regional
select 'previsto'::text,
       case when a.recorrente_id is not null then 'recorrente' else 'avulsa' end,
       a.id,
       a.tenant_id,
       a.empresa_id,
       null::uuid,
       coalesce(a.data_pagamento, a.data_prevista_pagamento),
       (a.valor * ar.fator)::numeric(14,2),
       a.natureza,
       a.descricao,
       a.fornecedor_id,
       a.cliente_id,
       a.job_id,
       'titulo'::text,
       ar.regional_id
from public.contas_avulsas a
join avulsa_rateio ar on ar.conta_avulsa_id = a.id
where a.status = 'aprovada'

union all

-- Título a receber em aberto. Lê a PREVISÃO de recebimento, não o
-- vencimento (decisão 017 §5) — repactuar tem que mover o caixa.
select 'previsto'::text,
       'titulo'::text,
       t.id,
       t.tenant_id,
       t.empresa_id,
       null::uuid,
       coalesce(t.data_previsao_recebimento, t.data_vencimento),
       (t.valor * coalesce(c.valor / nullif(ft.total, 0), 1))::numeric(14,2),
       'entrada'::public.natureza_lancamento,
       'Título NF ' || f.numero_nf || '/' || t.numero_parcela::text,
       f.fornecedor_id,
       f.cliente_id,
       c.job_id,
       'titulo'::text,
       coalesce(j.regional_id, e.regional_id)
from public.titulos_receber t
join public.faturamentos f      on f.id = t.faturamento_id
left join fat_composicao c      on c.faturamento_id = t.faturamento_id
left join fat_total ft          on ft.faturamento_id = t.faturamento_id
left join public.jobs j         on j.id = c.job_id
left join public.empresas e     on e.id = t.empresa_id
where t.status = 'em_aberto'

union all

-- =====================================================================
-- 3.3 PREVISÃO — a curva da abertura, ainda sem documento
-- =====================================================================

-- Saída: resíduo da curva de desembolso. Vencido sem virar PP rola para
-- a próxima janela de pagamento (decisão 004 §3).
select 'previsto'::text,
       'previsao_custo'::text,
       r.id,
       r.tenant_id,
       j.empresa_id,
       null::uuid,
       case when r.data_prevista < current_date
            then public.fc_proxima_janela_pagamento(current_date)
            else r.data_prevista
       end,
       r.valor,
       'saida'::public.natureza_lancamento,
       'Curva ' || j.codigo || ' · desembolso '
         || r.ordem || '/' || r.total_parcelas,
       null::uuid,
       pj.cliente_id,
       r.job_id,
       'previsao'::text,
       j.regional_id
from residuo_curva r
join public.jobs j          on j.id = r.job_id
left join public.projetos pj on pj.id = j.projeto_id
where r.valor > 0
  and j.status in ('aberto', 'em_producao')

union all

-- Entrada, job SEM envio para faturamento: previsão da abertura.
-- Vencida sem NF é lida em hoje + 1.
select 'previsto'::text,
       'previsao_recebimento'::text,
       p.id,
       p.tenant_id,
       j.empresa_id,
       null::uuid,
       case when p.data_prevista < current_date
            then current_date + 1
            else p.data_prevista
       end,
       p.valor,
       'entrada'::public.natureza_lancamento,
       'Previsão de recebimento · ' || j.codigo || ' '
         || p.ordem || '/' || p.total_parcelas,
       null::uuid,
       pj.cliente_id,
       p.job_id,
       'previsao'::text,
       j.regional_id
from previsao_recebimento p
join public.jobs j           on j.id = p.job_id
left join public.projetos pj on pj.id = j.projeto_id
where p.valor > 0
  and j.status in ('aberto', 'em_producao')
  and not exists (select 1 from jobs_com_envio ce where ce.job_id = p.job_id)

union all

-- Entrada, job COM envio: as parcelas que a produção informou, menos o
-- que já virou título. Sobrescreve a previsão da abertura — é a previsão
-- mais real, e continua previsão até a NF sair.
select 'previsto'::text,
       'envio_parcela'::text,
       s.id,
       s.tenant_id,
       j.empresa_id,
       null::uuid,
       case when s.data_vencimento < current_date
            then current_date + 1
            else s.data_vencimento
       end,
       s.valor,
       'entrada'::public.natureza_lancamento,
       'Faturamento previsto · ' || j.codigo || ' parcela '
         || s.ordem || '/' || s.total_parcelas,
       null::uuid,
       pj.cliente_id,
       s.job_id,
       'previsao'::text,
       j.regional_id
from envio_saldo s
join public.jobs j           on j.id = s.job_id
left join public.projetos pj on pj.id = j.projeto_id
where s.valor > 0
  and j.status in ('aberto', 'em_producao');


comment on view public.vw_fluxo_caixa is
  'Fluxo de caixa unificado em três classes: movimento (já passou pela '
  'conta), titulo (documento em aberto) e previsao (curva da abertura do '
  'job, ainda sem documento). Decisões 004, 015 e 017. Uma linha por '
  'REGIONAL nas origens com rateio.';

grant select on public.vw_fluxo_caixa to authenticated;


-- =====================================================================
-- O QUE MUDA PARA QUEM JÁ LÊ A VIEW
-- =====================================================================
--
-- Consumidor único hoje: `app/(app)/financeiro/fluxo-caixa/page.tsx`,
-- reescrito no mesmo commit desta migration. Conferido por grep antes de
-- escrever — nenhuma outra tela, action ou função de banco lê a view.
--
--   1. LINHAS NOVAS. As classes `previsao_custo`, `previsao_recebimento`
--      e `envio_parcela` não existiam. Quem somasse a view inteira sem
--      olhar `classe` passa a somar previsão junto com título.
--   2. UMA LINHA POR REGIONAL. Conta avulsa rateada entre N regionais
--      agora produz N linhas, cada uma com sua fatia; o mesmo vale para
--      o lançamento que a baixou e para o título de NF agrupada. A SOMA
--      continua correta; a CONTAGEM de linhas não é mais contagem de
--      documentos. Hoje há 0 rateios cadastrados.
--   3. CENTAVO NO RATEIO. Fatia de rateio arredonda a 2 casas, então a
--      soma das partes pode ficar um centavo longe do total do
--      documento. Aceito num fluxo de caixa; se um dia doer, o ajuste é
--      jogar a sobra na última fatia, como `dividirEmParcelas` faz.
--   4. TÍTULO VENCIDO NÃO ROLA. Só previsão rola. Título a receber ou a
--      pagar vencido e não baixado fica na data dele, numa coluna de
--      passado — é inadimplência real, e escondê-la seria mentir. Foi
--      decisão de manter o comportamento que a view já tinha.
--
-- CONFERÊNCIA (rodar depois de aplicar)
--
--   select classe, situacao, natureza, count(*), sum(valor)
--   from public.vw_fluxo_caixa group by 1,2,3 order by 1,2,3;
--
--   -- resíduo do JOB-0010: curva menos o planejado dos itens com PP
--   select j.codigo, v.descricao, v.data_evento, v.valor
--   from public.vw_fluxo_caixa v join public.jobs j on j.id = v.job_id
--   where v.classe = 'previsao' order by j.codigo, v.data_evento;
--
--   -- as 15 colunas, com classe e regional_id no fim
--   select ordinal_position, column_name, data_type
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'vw_fluxo_caixa'
--   order by ordinal_position;
