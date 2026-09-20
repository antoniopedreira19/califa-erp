-- =====================================================================
-- Decisão 093, entrega 3 — o fluxo de caixa projeta o cartão pela fatura
-- =====================================================================
-- O cartão escolhido na aprovação da PP (ou no cadastro da avulsa) é
-- intenção; o item só entra na fatura na baixa (entregas 1 e 2). Para a
-- previsão de caixa isso mudava três coisas na `vw_fluxo_caixa`:
--
-- 1) PP e avulsa com intenção de cartão passam a ser projetadas na data
--    em que o DINHEIRO sai — o vencimento da fatura em que a compra cai,
--    calculado por `proxima_fatura_cartao(cartao, data)` (a mesma conta
--    que a recorrência já fazia) — em vez da data do título. Uma compra
--    de 09/11 num cartão que fecha 25 e vence 5 não sai em novembro, sai
--    em 05/12; prever pela data do título antecipava a saída em quase um
--    mês e escondia justamente o efeito do cartão. Nada é gravado: a data
--    do título continua sendo a dele; se a forma mudar na baixa, a
--    previsão muda junto. A base da conta é `data_compra` na avulsa (é o
--    dia em que o cartão passa) e `data_pagamento` na parcela de PP.
--
-- 2) O que já pertence a uma fatura sai dos ramos de PP e avulsa: a
--    parcela e a avulsa legadas, roteadas na aprovação antes da 093
--    (`fatura_cartao_id` preenchido, ainda não pagas), passam a ser
--    contadas dentro da fatura — senão entrariam duas vezes.
--
-- 3) Nasce o ramo `fatura_cartao`: cada fatura ABERTA ou FECHADA vira uma
--    saída prevista, classe `titulo`, no vencimento dela — uma linha por
--    regional, rateada pelos itens (os lançamentos `item`/`ajuste` da
--    fatura mais o legado pendente), como o caixa sente: "Fatura Nubank ·
--    FC-00012 · 12/26". Sem este ramo o valor sumia entre a confirmação e
--    o pagamento: o item já tinha saído de "a pagar" e a fatura ainda não
--    era lançamento no banco. Fatura credora (total ≤ 0) não entra; a
--    paga vira o lançamento da conta que pagou.
--
-- Cada real aparece num estado só: título previsto (pela intenção) →
-- linha da fatura (confirmado) → realizado (baixa da fatura). O
-- lançamento do item na CONTA-ESPELHO do cartão continua na view — o
-- fluxo do job precisa dele —, e é a tela do Fluxo de caixa que o tira
-- do escopo bancário "todas as contas" (não é dinheiro que saiu).
--
-- Padrão da 20260916170003: troca de trechos exatos na definição que
-- está no banco; cada âncora precisa aparecer exatamente uma vez, senão a
-- migration para.
-- =====================================================================

do $patch$
declare
  v text := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);

  -- 1) PP: data pela fatura quando a intenção é cartão
  pp_data_antes text := E'    par.data_pagamento AS data_evento,\n    (par.valor)::numeric(14,2) AS valor,';
  pp_data_depois text := E'    CASE\n'
    || E'        WHEN (((pp.forma_pagamento)::text = ''cartao_credito''::text) AND (pp.cartao_credito_id IS NOT NULL)) THEN proxima_fatura_cartao(pp.cartao_credito_id, par.data_pagamento)\n'
    || E'        ELSE par.data_pagamento\n'
    || E'    END AS data_evento,\n    (par.valor)::numeric(14,2) AS valor,';

  -- 2) PP: a parcela já roteada para uma fatura é contada pela fatura
  pp_where_antes text := E'WHERE ((pp.status = ANY (ARRAY[''aprovada''::pp_status, ''pago''::pp_status])) AND (par.pago_em IS NULL))';
  pp_where_depois text := E'WHERE ((pp.status = ANY (ARRAY[''aprovada''::pp_status, ''pago''::pp_status])) AND (par.pago_em IS NULL) AND (par.fatura_cartao_id IS NULL))';

  -- 1) Avulsa: idem, pela data da compra
  av_data_antes text := E'    COALESCE(a.data_pagamento, a.data_prevista_pagamento) AS data_evento,';
  av_data_depois text := E'    CASE\n'
    || E'        WHEN (((a.forma_pagamento)::text = ''cartao_credito''::text) AND (a.cartao_credito_id IS NOT NULL)) THEN proxima_fatura_cartao(a.cartao_credito_id, COALESCE(a.data_compra, a.data_pagamento, a.data_prevista_pagamento))\n'
    || E'        ELSE COALESCE(a.data_pagamento, a.data_prevista_pagamento)\n'
    || E'    END AS data_evento,';

  -- 2) Avulsa: a que já aponta para uma fatura é contada pela fatura
  av_where_antes text := E'  WHERE (a.status = ''aprovada''::conta_avulsa_status)';
  av_where_depois text := E'  WHERE ((a.status = ''aprovada''::conta_avulsa_status) AND (a.fatura_cartao_id IS NULL))';

  -- 3) O ramo novo, colado no fim da view (mesmas 16 colunas, na ordem)
  ramo_fatura text := E'\nUNION ALL\n'
    || E' SELECT ''previsto''::text AS situacao,\n'
    || E'    ''fatura_cartao''::text AS origem_tipo,\n'
    || E'    fp.fatura_id AS origem_id,\n'
    || E'    fp.tenant_id,\n'
    || E'    fp.empresa_id,\n'
    || E'    NULL::uuid AS conta_bancaria_id,\n'
    || E'    fp.data_vencimento AS data_evento,\n'
    || E'    fp.valor,\n'
    || E'    ''saida''::natureza_lancamento AS natureza,\n'
    || E'    fp.descricao,\n'
    || E'    NULL::uuid AS fornecedor_id,\n'
    || E'    NULL::uuid AS cliente_id,\n'
    || E'    NULL::uuid AS job_id,\n'
    || E'    ''titulo''::text AS classe,\n'
    || E'    fp.regional_id,\n'
    || E'    NULL::text AS origem_lancamento\n'
    || E'   FROM ( SELECT f.id AS fatura_id,\n'
    || E'            f.tenant_id,\n'
    || E'            cc.empresa_id,\n'
    || E'            f.data_vencimento,\n'
    || E'            ((((''Fatura ''::text || cc.nome) || '' · ''::text) || f.codigo) || '' · ''::text) || to_char((f.competencia_fechamento)::timestamp with time zone, ''MM/YY''::text) AS descricao,\n'
    || E'            x.regional_id,\n'
    || E'            (sum(x.valor))::numeric(14,2) AS valor,\n'
    || E'            sum(sum(x.valor)) OVER (PARTITION BY f.id) AS total\n'
    || E'           FROM ((faturas_cartao f\n'
    || E'             JOIN cartoes_credito cc ON ((cc.id = f.cartao_credito_id)))\n'
    || E'             JOIN LATERAL ( SELECT COALESCE(jlj.regional_id, lr.regional_id) AS regional_id,\n'
    || E'                    ((CASE WHEN (l.natureza = ''entrada''::natureza_lancamento) THEN (- l.valor) ELSE l.valor END) * lr.fator * lj.fator) AS valor\n'
    || E'                   FROM (((lancamentos_financeiros l\n'
    || E'                     JOIN lancamento_rateio lr ON ((lr.lancamento_id = l.id)))\n'
    || E'                     JOIN lancamento_job lj ON ((lj.lancamento_id = l.id)))\n'
    || E'                     LEFT JOIN jobs jlj ON ((jlj.id = lj.job_id)))\n'
    || E'                  WHERE ((l.fatura_cartao_id = f.id) AND (l.papel_na_fatura = ANY (ARRAY[''item''::text, ''ajuste''::text])))\n'
    || E'                UNION ALL\n'
    || E'                 SELECT ar.regional_id,\n'
    || E'                    ((CASE WHEN (a.natureza = ''entrada''::natureza_lancamento) THEN (- a.valor) ELSE a.valor END) * ar.fator) AS valor\n'
    || E'                   FROM (contas_avulsas a\n'
    || E'                     JOIN avulsa_rateio ar ON ((ar.conta_avulsa_id = a.id)))\n'
    || E'                  WHERE ((a.fatura_cartao_id = f.id) AND (a.status = ''aprovada''::conta_avulsa_status))\n'
    || E'                UNION ALL\n'
    || E'                 SELECT jb.regional_id,\n'
    || E'                    par.valor\n'
    || E'                   FROM ((pedidos_compra_parcelas par\n'
    || E'                     JOIN pedidos_compra pp ON ((pp.id = par.pedido_compra_id)))\n'
    || E'                     LEFT JOIN jobs jb ON ((jb.id = pp.job_id)))\n'
    || E'                  WHERE ((par.fatura_cartao_id = f.id) AND (par.pago_em IS NULL))) x ON true)\n'
    || E'          WHERE ((f.status)::text = ANY (ARRAY[''aberta''::text, ''fechada''::text]))\n'
    || E'          GROUP BY f.id, f.tenant_id, cc.empresa_id, f.data_vencimento, cc.nome, f.codigo, f.competencia_fechamento, x.regional_id) fp\n'
    || E'  WHERE ((fp.total > 0.004) AND (fp.valor > 0.004))';

  procure text[] := array[pp_data_antes, pp_where_antes, av_data_antes, av_where_antes];
  troque  text[] := array[pp_data_depois, pp_where_depois, av_data_depois, av_where_depois];
  i int;
  n int;
begin
  for i in 1 .. array_length(procure, 1) loop
    n := (length(v) - length(replace(v, procure[i], ''))) / length(procure[i]);
    if n <> 1 then
      raise exception 'vw_fluxo_caixa: a âncora % aparece % vez(es), e precisava aparecer uma. A view mudou; revise a migration.', i, n;
    end if;
    v := replace(v, procure[i], troque[i]);
  end loop;

  v := rtrim(rtrim(v), ';');
  if right(v, 13) <> 'WHERE t.ativo' then
    raise exception 'vw_fluxo_caixa: o fim da view não é o esperado (%). Revise a migration.', right(v, 40);
  end if;

  execute 'create or replace view public.vw_fluxo_caixa as ' || v || ramo_fatura;
end
$patch$;

comment on view public.vw_fluxo_caixa is
  'Fluxo de caixa: realizado (lançamentos) + previsto (títulos, previsões da abertura, recorrências e, desde a decisão 093, a fatura de cartão aberta/fechada no vencimento dela). PP e avulsa com intenção de cartão são projetadas pela fatura (proxima_fatura_cartao), não pela data do título.';
