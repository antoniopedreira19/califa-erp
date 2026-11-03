-- =====================================================================
-- Custos fixos como recorrência: a previsão da planilha sai do fluxo
-- (decisão 235, 03/11/2026)
-- =====================================================================
--
-- Os custos fixos da planilha (CF, DA e DM) passam a ser recorrências no
-- Contas a Pagar. A planilha continua carregada como previsão (decisão
-- 232) e prevê os mesmos itens, então sem esta regra o fluxo contaria
-- cada custo duas vezes: o título da recorrência e a linha da planilha.
--
-- Regra do Tiago (03/11/2026): sai do fluxo "pelo item". A recorrência
-- guarda `previsao_chave` = md5 do fornecedor e da descrição da planilha,
-- sem acento, em maiúsculas, só letras e números, separados por "|". A
-- chave é um hash, então nenhum nome entra na coluna nem neste arquivo.
-- A previsão sai quando há recorrência ativa da mesma empresa e do mesmo
-- Tipo do plano com a mesma chave, e a competência da previsão é do
-- trimestre em que a recorrência nasceu ou depois.
--
-- Por que a competência, e não a data: em novembro a planilha ainda tem
-- contas de outubro (competência do 3T) com data de 08/11. São outra
-- fatura do mesmo item e continuam no fluxo. Quando a recorrência acaba
-- (`data_fim`) ou é pausada, a previsão volta.
--
-- Recorrência criada pela tela nasce sem chave e não tira nada: a regra
-- só vale para as que vieram da planilha.
--
-- O ramo `previsao_planilha` é trocado inteiro, como na
-- 20261103100002, que é a versão de hoje dele. Este ramo acrescenta só
-- a última condição.
-- =====================================================================

alter table public.contas_avulsas_recorrentes
  add column if not exists previsao_chave text;

comment on column public.contas_avulsas_recorrentes.previsao_chave is
  'md5 de fornecedor|descrição da planilha (normalizados): a previsão da planilha com a mesma chave sai do fluxo (decisão 235). Nulo na recorrência criada pela tela.';

create index if not exists idx_rec_previsao_chave
  on public.contas_avulsas_recorrentes (tenant_id, previsao_chave)
  where previsao_chave is not null;

do $$
declare
  v_def    text;
  v_pos    integer;
  c_inicio constant text := E'\nUNION ALL\n SELECT ''previsto''::text AS situacao,\n    ''previsao_planilha''::text AS origem_tipo';
  c_ramo   constant text := $ramo$
UNION ALL
 SELECT 'previsto'::text AS situacao,
    'previsao_planilha'::text AS origem_tipo,
    h.id AS origem_id,
    h.tenant_id,
    h.empresa_id,
    h.conta_bancaria_id,
        CASE
            WHEN (h.data >= ( SELECT hoje_em_sao_paulo() AS hoje_em_sao_paulo)) THEN h.data
            WHEN (h.valor < (0)::numeric) THEN fc_proxima_janela_pagamento(( SELECT hoje_em_sao_paulo() AS hoje_em_sao_paulo))
            ELSE (( SELECT hoje_em_sao_paulo() AS hoje_em_sao_paulo) + 1)
        END AS data_evento,
    (abs(h.valor))::numeric(14,2) AS valor,
        CASE
            WHEN (h.valor >= (0)::numeric) THEN 'entrada'::natureza_lancamento
            ELSE 'saida'::natureza_lancamento
        END AS natureza,
    ('Previsão da planilha · '::text || COALESCE(NULLIF(h.job_nome, ''::text), NULLIF(h.descricao, ''::text), h.grupo, 'sem descrição'::text)) AS descricao,
    NULL::uuid AS fornecedor_id,
    NULL::uuid AS cliente_id,
    NULL::uuid AS job_id,
    'previsao'::text AS classe,
    h.regional_id,
    NULL::text AS origem_lancamento
   FROM (historico_movimentos h
     JOIN historico_cargas hc ON (((hc.id = h.carga_id) AND (hc.tipo = 'previsao'::text) AND (hc.situacao = 'ativa'::text))))
  WHERE ((h.extrato_linha_id IS NULL) AND (h.valor <> (0)::numeric)
    AND (NOT (EXISTS ( SELECT 1
           FROM historico_jobs hj
          WHERE ((hj.carga_id = h.carga_id) AND (hj.chave = h.job_chave) AND (hj.job_id IS NOT NULL)))))
    AND (NOT COALESCE(((h.grupo = 'DP'::text) AND (h.valor < (0)::numeric) AND (EXISTS ( SELECT 1
           FROM (folhas_pagamento f
             JOIN folhas_pagamento_alocacoes al ON ((al.folha_id = f.id)))
          WHERE ((f.tenant_id = h.tenant_id) AND (al.empresa_id = h.empresa_id)
            AND (date_trunc('month'::text, (COALESCE(f.data_pagamento_prevista, ((make_date((f.competencia_ano)::integer, (f.competencia_mes)::integer, 1) + '1 mon 2 days'::interval))::date))::timestamp without time zone) = date_trunc('month'::text, (h.data)::timestamp without time zone)))))), false))
    AND (NOT COALESCE(((h.grupo = 'CT'::text) AND (h.valor < (0)::numeric) AND (COALESCE(h.job_chave, ''::text) = ''::text)
          AND (((h.competencia_ano * 10) + h.competencia_trimestre) >= 20264)), false))
    AND (NOT COALESCE(((h.grupo ~~* 'M_TUO%'::text) AND (EXISTS ( SELECT 1
           FROM transferencias_contas t
          WHERE ((t.tenant_id = h.tenant_id) AND (t.tipo = 'mutuo'::text) AND (t.status = 'a_transferir'::text)
            AND (t.data_prevista = h.data) AND (t.valor = abs(h.valor))
            AND (((h.valor > (0)::numeric) AND (t.conta_destino_id = h.conta_bancaria_id))
              OR ((h.valor < (0)::numeric) AND (t.conta_origem_id = h.conta_bancaria_id))))))), false))
    AND (NOT COALESCE(((h.valor < (0)::numeric) AND (EXISTS ( SELECT 1
           FROM contas_avulsas_recorrentes r
          WHERE ((r.tenant_id = h.tenant_id) AND r.ativo AND (r.previsao_chave IS NOT NULL)
            AND (r.empresa_id = h.empresa_id) AND (r.plano_conta_tipo_id = h.plano_conta_tipo_id)
            AND (r.data_fim IS NULL OR h.data <= r.data_fim)
            AND (((h.competencia_ano * 10) + h.competencia_trimestre) >= ((EXTRACT(year FROM r.created_at)::integer * 10) + EXTRACT(quarter FROM r.created_at)::integer))
            AND (r.previsao_chave = md5(((regexp_replace(upper(public.unaccent(COALESCE(h.fornecedor, ''::text))), '[^A-Z0-9]'::text, ''::text, 'g'::text) || '|'::text) || regexp_replace(upper(public.unaccent(COALESCE(h.descricao, ''::text))), '[^A-Z0-9]'::text, ''::text, 'g'::text)))))))), false)))
$ramo$;
begin
  v_def := rtrim(pg_get_viewdef('public.vw_fluxo_caixa'::regclass), E'; \n');
  if (length(v_def) - length(replace(v_def, c_inicio, ''))) / length(c_inicio) <> 1 then
    raise exception 'public.vw_fluxo_caixa: o começo do ramo previsao_planilha não está lá uma vez só';
  end if;
  v_pos := position(c_inicio in v_def);
  if position('UNION ALL' in substr(v_def, v_pos + length(c_inicio))) > 0 then
    raise exception 'public.vw_fluxo_caixa: há outro ramo depois do previsao_planilha';
  end if;
  v_def := left(v_def, v_pos - 1) || c_ramo;
  execute 'create or replace view public.vw_fluxo_caixa as ' || v_def;
end
$$;
