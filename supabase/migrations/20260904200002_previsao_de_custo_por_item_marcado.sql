-- =====================================================================
-- A previsão de custo passa a ser por item, e o marco é quem a encerra
-- Decisão 052 (04/09/2026)
--
-- ANTES
-- -----
-- `abatimento_curva` somava o planejado INTEIRO de todo item que tivesse
-- ao menos uma PP aprovada, e esse total comia o Cronograma de
-- desembolsos da parcela mais próxima para a mais distante. Um item de
-- R$ 20.000 com uma PP de R$ 10.000 aprovada tirava R$ 20.000 da
-- previsão e devolvia R$ 10.000 de título: as outras PPs que ainda iam
-- sair daquele item simplesmente não existiam para o fluxo de caixa.
--
-- AGORA (regra do Tiago, 04/09/2026)
-- ----------------------------------
-- Cada item contribui com o que ainda não virou documento:
--
--   item EM ABERTO  → previsão = planejado − PPs que viraram título
--                     (piso zero: PP igual ou acima do planejado zera a
--                     previsão do item, e o excedente aparece como
--                     título, não como previsão negativa)
--   item MARCADO    → previsão = PPs que existem e ainda NÃO são título
--                     (gerada, em avaliação, rejeitada). O saldo do
--                     planejado morre aqui: a partir do marco o item vale
--                     o que as PPs dizem, não o que se planejou.
--
-- O abatimento é o complemento disso: planejado − previsão do item.
--
-- Exemplo (o caso conversado): item planejado em R$ 20.000, uma PP de
-- R$ 12.000 aprovada e outra de R$ 9.000 apenas gerada.
--   em aberto → abate 12.000, previsão 8.000  (+12.000 de título)
--   marcado   → abate 11.000, previsão 9.000  (+12.000 de título) = 21.000
--
-- PP só GERADA continua não sendo título — isso não muda (decisão 039).
-- O que ela faz agora é segurar previsão no item marcado, para o custo
-- não sumir do fluxo entre gerar e aprovar.
--
-- DE QUEBRA, a fonte do planejado muda de `versoes_orcamento_itens` para
-- `jobs_itens_orcado`, a CÓPIA do job:
--   * é a cópia que a errata altera — pela versão, o abatimento usava um
--     planejado que a planilha já não mostra mais;
--   * linha vermelha (criada por errata) não existe na versão, e ficava
--     fora da conta inteira.
-- O tipo de custo passa a sair da cópia pelo mesmo motivo.
--
-- A troca é feita por patch sobre a definição viva, com as âncoras
-- conferidas antes — mesmo caminho de 27/08/2026, quando a regra do save
-- saiu para `vw_titulo_partes`.
-- =====================================================================

do $patch$
declare
  d text; ini int; fim int;
  v_marca text := 'itens_com_pp AS (';
  v_fecho text := '), curva AS (';
  v_novo text;
begin
  d := pg_get_viewdef('public.vw_fluxo_caixa'::regclass, true);

  if position('pps_do_item AS (' in d) > 0 then
    raise notice 'vw_fluxo_caixa ja usa a previsao por item marcado; nada a fazer.';
    return;
  end if;

  ini := position(v_marca in d);
  if ini = 0 then raise exception 'ANCORA itens_com_pp NAO ENCONTRADA'; end if;
  fim := position(v_fecho in d);
  if fim = 0 or fim < ini then raise exception 'ANCORA curva NAO ENCONTRADA'; end if;

  v_novo :=
    'pps_do_item AS ( '
    || 'SELECT pc.item_realizado_id, '
    || '  COALESCE(sum(pc.valor) FILTER (WHERE pc.status = ANY (ARRAY[''aprovada''::pp_status, ''pago''::pp_status])), 0::numeric) AS em_titulo, '
    || '  COALESCE(sum(pc.valor) FILTER (WHERE pc.status <> ALL (ARRAY[''cancelada''::pp_status, ''aprovada''::pp_status, ''pago''::pp_status])), 0::numeric) AS sem_titulo '
    || 'FROM pedidos_compra pc WHERE pc.item_realizado_id IS NOT NULL '
    || 'GROUP BY pc.item_realizado_id '
    || '), abatimento_curva AS ( '
    || 'SELECT ir.job_id, '
    || '  sum(CASE WHEN ir.pps_concluidas_em IS NOT NULL '
    || '           THEN GREATEST(0::numeric, COALESCE(io.total_planejado, 0::numeric) - COALESCE(p.sem_titulo, 0::numeric)) '
    || '           ELSE LEAST(COALESCE(io.total_planejado, 0::numeric), COALESCE(p.em_titulo, 0::numeric)) '
    || '      END)::numeric(14,2) AS valor '
    || 'FROM jobs_itens_realizado ir '
    || '  JOIN jobs_itens_orcado io ON io.id = ir.job_item_orcado_id '
    || '  LEFT JOIN pps_do_item p ON p.item_realizado_id = ir.id '
    || 'WHERE io.tipo_custo::text = ANY (ARRAY[''AR''::text, ''B''::text, ''C''::text, ''F''::text, ''FI''::text]) '
    || 'GROUP BY ir.job_id ';

  d := substring(d from 1 for ini - 1) || v_novo || substring(d from fim);

  execute 'create or replace view public.vw_fluxo_caixa as ' || d;
end $patch$;

comment on view public.vw_fluxo_caixa is
  'Fluxo de caixa: movimento, titulo e previsao numa view so. A previsao de custo e por item — o item em aberto vale o planejado menos as PPs que viraram titulo; o item marcado como "todas as PPs geradas" vale so as PPs (decisao 052).';
