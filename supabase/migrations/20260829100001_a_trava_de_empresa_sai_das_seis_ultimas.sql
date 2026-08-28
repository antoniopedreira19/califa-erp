-- =====================================================================
-- A trava de empresa sai das seis últimas funções de baixa
--
-- Completa a mudança de 28/08/2026. Lá a FK composta
-- `fk_lancamento_conta_empresa` caiu e a trava saiu de `dar_baixa_pp` e
-- `dar_baixa_avulsa_com_plano`. As outras seis ficaram para uma passada
-- própria — e é esta. Enquanto elas existiam o sistema estava incoerente:
-- o cartão e duas funções aceitavam empresas cruzadas, seis não.
--
-- A regra, como o Tiago a enunciou em 29/08/2026:
--
--   "Jobs sempre estarão associados a empresas, e os faturamentos e NFs
--    também, visto que sempre serão emitidas por uma empresa. Porém, as
--    contas em si não são específicas de uma empresa."
--
-- A empresa é do DOCUMENTO. A conta bancária e o cartão são o cano por
-- onde o dinheiro passa. Todas as seis já gravavam a empresa do documento
-- no lançamento — só a trava muda.
--
-- ⚠️ São funções da outra frente, então o patch é CIRÚRGICO: em vez de
-- reescrever os corpos aqui — o que congelaria o código do Antonio dentro
-- desta migration e desfaria calado qualquer coisa que ele mexer depois —,
-- o bloco pega a definição EXATA que está no banco (`pg_get_functiondef`),
-- recorta só o `if` da empresa e recompila o resto idêntico.
--
-- E recorta com barulho: se alguma das seis não tiver a guarda no formato
-- esperado, a migration ABORTA. Migration que não faz nada em silêncio é
-- pior do que migration que quebra.
-- =====================================================================

do $migration$
declare
  v_alvo  text;
  v_def   text;
  v_novo  text;
  v_alvos text[] := array[
    'dar_baixa_avulsa',
    'dar_baixa_pp_parcela',
    'dar_baixa_titulo',
    'dar_baixa_titulo_com_plano',
    'dar_baixa_desembolso_parcela',
    'dar_baixa_devolucao_verba'
  ];
  -- A guarda tem sempre a mesma forma; só muda o nome da variável do
  -- documento (v_avulsa, v_pp, v_titulo, v_desembolso, v_dev).
  v_padrao text :=
    '\n\s*if\s+v_conta\.empresa_id\s*<>\s*[a-z_]+\.empresa_id\s+then\s*\n\s*raise exception ''Conta bancária não pertence à empresa[^'']*'';\s*\n\s*end if;';
begin
  foreach v_alvo in array v_alvos loop
    select pg_get_functiondef(p.oid)
      into v_def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_alvo;

    if v_def is null then
      raise exception 'Função public.% não existe. Alguém a renomeou?', v_alvo;
    end if;

    if v_def !~ v_padrao then
      raise exception
        'A guarda de empresa em public.% não está no formato esperado. Confira o corpo dela à mão antes de repetir esta migration.',
        v_alvo;
    end if;

    -- Deixa um comentário no lugar da trava: quem ler a função daqui a
    -- seis meses precisa saber que a ausência é escolha, não esquecimento.
    v_novo := regexp_replace(
      v_def,
      v_padrao,
      E'\n  -- Sem trava de empresa: a conta paga despesa de mais de uma\n  -- empresa (29/08/2026). Quem diz a empresa é o documento, e o\n  -- lançamento abaixo já a grava de lá.',
      'g'
    );

    execute v_novo;
    raise notice 'Trava de empresa removida de public.%', v_alvo;
  end loop;
end
$migration$;

-- GRANTs: `create or replace` devolve EXECUTE para PUBLIC a cada vez.
revoke execute on function public.dar_baixa_avulsa(uuid, date, uuid) from public;
grant  execute on function public.dar_baixa_avulsa(uuid, date, uuid) to authenticated;

revoke execute on function public.dar_baixa_pp_parcela(uuid, date, uuid, uuid, uuid, uuid, forma_pagamento, uuid) from public;
grant  execute on function public.dar_baixa_pp_parcela(uuid, date, uuid, uuid, uuid, uuid, forma_pagamento, uuid) to authenticated;

revoke execute on function public.dar_baixa_titulo(uuid, date, uuid, uuid) from public;
grant  execute on function public.dar_baixa_titulo(uuid, date, uuid, uuid) to authenticated;

revoke execute on function public.dar_baixa_titulo_com_plano(uuid, date, uuid, uuid, uuid, uuid) from public;
grant  execute on function public.dar_baixa_titulo_com_plano(uuid, date, uuid, uuid, uuid, uuid) to authenticated;

revoke execute on function public.dar_baixa_desembolso_parcela(uuid, date, uuid, uuid, uuid, uuid, forma_pagamento, uuid) from public;
grant  execute on function public.dar_baixa_desembolso_parcela(uuid, date, uuid, uuid, uuid, uuid, forma_pagamento, uuid) to authenticated;

revoke execute on function public.dar_baixa_devolucao_verba(uuid, date, uuid, uuid, uuid, uuid) from public;
grant  execute on function public.dar_baixa_devolucao_verba(uuid, date, uuid, uuid, uuid, uuid) to authenticated;
