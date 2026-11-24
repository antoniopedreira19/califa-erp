-- Rescisão passa a trafegar por `folhas_pagamento` como as demais
-- modalidades (salário, férias, 13º). Isso resolve:
--   1. Erro de RLS: `contas_avulsas` exige acesso empresa+regional do
--      usuário; RH do califa-erp é sem regional e caía fora. folhas_pagamento
--      usa RLS por tenant + role.
--   2. UX: a linha aparece na aba People de /financeiro/contas-a-pagar
--      no mesmo bloco das outras verbas, não em avulsa solta.
--
-- Mudanças:
--   - coluna `rescisao_id` em `folhas_pagamento` (FK pra rescisoes).
--   - trigger que propagava `contas_avulsas.status='baixada'` sai do ar;
--     entra um novo que escuta `folhas_pagamento.status='paga'` nas linhas
--     tipo='rescisao' pra marcar a rescisão como `paga`.
--   - coluna `conta_avulsa_id` em `rescisoes` fica obsoleta mas não é
--     removida (histórico de backfill / segurança).
--   - view `vw_people_aprovar_financeiro` recebe branch de rescisão
--     (recriada por completo porque Postgres não permite CTE patch).

alter table folhas_pagamento
  add column if not exists rescisao_id uuid references rescisoes(id) on delete set null;

create index if not exists idx_folhas_pagamento_rescisao
  on folhas_pagamento(rescisao_id) where rescisao_id is not null;

-- Remove o trigger antigo (ligava contas_avulsas → rescisoes) e cria o
-- novo que liga folhas_pagamento → rescisoes.
drop trigger if exists trg_conta_avulsa_propaga_rescisao on contas_avulsas;
drop function if exists fn_rescisao_propaga_pagamento();

create or replace function fn_rescisao_propaga_pagamento_folha()
returns trigger language plpgsql as $$
begin
  if new.tipo = 'rescisao'
     and new.status = 'paga'
     and (old.status is distinct from 'paga')
     and new.rescisao_id is not null then
    update rescisoes
       set status = 'paga',
           paga_em = coalesce(new.paga_em, now()),
           paga_por = new.paga_por
     where id = new.rescisao_id
       and status = 'enviada_financeiro';
  end if;
  return new;
end;
$$;

create trigger trg_folha_rescisao_propaga_pagamento
  after update of status on folhas_pagamento
  for each row execute function fn_rescisao_propaga_pagamento_folha();

-- Recria view: adiciona CTE `rescisoes_pend` que lista linhas de
-- folhas_pagamento com tipo='rescisao' e status='enviada', com label
-- "Rescisão · DD/MM/YYYY".
create or replace view vw_people_aprovar_financeiro as
with folha_mensal_ferias as (
  select f.tenant_id,
         f.colaborador_id,
         f.id as linha_id,
         case f.tipo
           when 'salario' then 'folha_mensal'::nf_anexo_escopo
           when 'ferias' then case f.tipo_folha_ferias
             when 'usufruto' then 'ferias_usufruto'::nf_anexo_escopo
             when 'abono' then 'ferias_abono'::nf_anexo_escopo
             else 'ferias_usufruto'::nf_anexo_escopo
           end
           else null::nf_anexo_escopo
         end as escopo_tipo,
         case f.tipo
           when 'salario' then f.id
           when 'ferias' then f.lancamento_ferias_id
           else null::uuid
         end as escopo_id,
         case f.tipo
           when 'salario' then 'Folha mensal · ' || mes_pt_br(f.competencia_mes::integer) || '/' || f.competencia_ano::text
           when 'ferias' then case f.tipo_folha_ferias
             when 'usufruto' then 'Férias · ' || to_char(fl.data_inicio, 'DD/MM') || ' a ' || to_char(fl.data_fim, 'DD/MM')
             when 'abono' then 'Abono de férias · ' || coalesce(
               case fl.tipo
                 when 'abono_combinado' then fl.dias_abono::text
                 else fl.dias::text
               end, '?') || ' dias'
             else 'Férias · ' || to_char(fl.data_inicio, 'DD/MM') || ' a ' || to_char(fl.data_fim, 'DD/MM')
           end
           else null::text
         end as label,
         f.competencia_ano::integer,
         f.competencia_mes::integer,
         f.salario_base::numeric as valor,
         case f.tipo
           when 'salario' then (make_date(f.competencia_ano::integer, f.competencia_mes::integer, 1) + interval '1 mon 2 days')::date
           when 'ferias' then (fl.data_inicio - interval '2 days')::date
           else null::date
         end as prazo_anexo,
         f.tipo_folha_ferias,
         f.origem
    from folhas_pagamento f
    left join colaboradores_ferias_lancamentos fl on fl.id = f.lancamento_ferias_id
   where f.tipo in ('salario','ferias')
     and f.status = 'enviada'
     and (f.competencia_ano * 100 + f.competencia_mes) >= 202610
), decimo_parcelas as (
  select fp.tenant_id,
         fp.colaborador_id,
         fp.id as linha_id,
         case fp.tipo
           when 'decimo_terceiro_1a_parcela' then 'decimo_terceiro_p1'::nf_anexo_escopo
           else 'decimo_terceiro_p2'::nf_anexo_escopo
         end as escopo_tipo,
         dtl.id as escopo_id,
         case fp.tipo
           when 'decimo_terceiro_1a_parcela' then '13º ' || fp.competencia_ano::text || ' — 1ª parcela'
           else '13º ' || fp.competencia_ano::text || ' — 2ª parcela'
         end as label,
         fp.competencia_ano::integer,
         fp.competencia_mes::integer,
         fp.salario_base::numeric as valor,
         coalesce(fp.data_pagamento_prevista,
           case fp.tipo
             when 'decimo_terceiro_1a_parcela' then make_date(fp.competencia_ano::integer, 11, 30)
             else make_date(fp.competencia_ano::integer, 12, 20)
           end) as prazo_anexo,
         null::text as tipo_folha_ferias,
         fp.origem
    from folhas_pagamento fp
    join decimo_terceiro_linhas dtl on dtl.id = fp.decimo_terceiro_linha_id
   where fp.tipo in ('decimo_terceiro_1a_parcela','decimo_terceiro_2a_parcela')
     and fp.status = 'enviada'
     and (fp.competencia_ano * 100 + fp.competencia_mes) >= 202610
), decimo_adiantamento as (
  select fp.tenant_id,
         fp.colaborador_id,
         fp.id as linha_id,
         'decimo_terceiro_adiantamento'::nf_anexo_escopo as escopo_tipo,
         dta.id as escopo_id,
         '13º ' || dta.ano::text || ' — Adiantamento' as label,
         fp.competencia_ano::integer,
         fp.competencia_mes::integer,
         fp.salario_base::numeric as valor,
         coalesce(fp.data_pagamento_prevista, dta.data) as prazo_anexo,
         null::text as tipo_folha_ferias,
         fp.origem
    from folhas_pagamento fp
    join decimo_terceiro_adiantamentos dta on dta.id = fp.decimo_terceiro_adiantamento_id
   where fp.tipo = 'decimo_terceiro_adiantamento'
     and fp.status = 'enviada'
     and (fp.competencia_ano * 100 + fp.competencia_mes) >= 202610
), rescisoes_pend as (
  select fp.tenant_id,
         fp.colaborador_id,
         fp.id as linha_id,
         'rescisao'::nf_anexo_escopo as escopo_tipo,
         r.id as escopo_id,
         'Rescisão · ' || to_char(r.data_rescisao, 'DD/MM/YYYY') as label,
         fp.competencia_ano::integer,
         fp.competencia_mes::integer,
         fp.salario_base::numeric as valor,
         coalesce(fp.data_pagamento_prevista, (r.data_rescisao + interval '10 days')::date) as prazo_anexo,
         null::text as tipo_folha_ferias,
         fp.origem
    from folhas_pagamento fp
    join rescisoes r on r.id = fp.rescisao_id
   where fp.tipo = 'rescisao'
     and fp.status = 'enviada'
), todas_folhas_pend as (
  select * from folha_mensal_ferias
  union all
  select * from decimo_parcelas
  union all
  select * from decimo_adiantamento
  union all
  select * from rescisoes_pend
)
select tf.tenant_id,
       tf.colaborador_id,
       tf.escopo_tipo,
       tf.escopo_id,
       tf.linha_id,
       tf.label,
       tf.competencia_ano,
       tf.competencia_mes,
       tf.valor,
       tf.prazo_anexo,
       n.id is not null as nf_anexada,
       n.id as nf_anexo_id,
       n.arquivo_nome as nf_arquivo_nome,
       n.uploaded_at as nf_uploaded_at,
       c.tipo_contratacao,
       c.funcao,
       tf.origem,
       (select string_agg(a.percentual::text || '%', ' / ' order by a.percentual desc)
          from folhas_pagamento_alocacoes a
         where a.folha_id = tf.linha_id) as alocacao_resumo,
       tf.tipo_folha_ferias
  from todas_folhas_pend tf
  left join colaboradores_nf_anexos n
    on n.tenant_id = tf.tenant_id
   and n.colaborador_id = tf.colaborador_id
   and n.escopo_tipo = tf.escopo_tipo
   and n.escopo_id = tf.escopo_id
  left join colaboradores c on c.id = tf.colaborador_id;
