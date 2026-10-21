-- =============================================================================
-- Baixa e fatura do cartão só por admin ou financeiro, também no banco
-- (task 029, fase 2, M2.4; decisão 197)
-- =============================================================================
-- Em 21/10/2026, cinco funções que mexem em dinheiro só checavam se quem
-- chama é do tenant (`is_tenant_member`): `dar_baixa_devolucao_verba`,
-- `dar_baixa_fatura_cartao`, `fechar_fatura_cartao`, `reabrir_fatura_cartao` e
-- `rotear_pp_para_cartao` (esta, anterior à decisão 093, o sistema não chama
-- mais). As telas já barram quem não é admin nem financeiro, no servidor; o
-- banco deixava 90 membros ativos (GPs, produtores, freelancers e RH)
-- chamá-las direto. Passam a usar a mesma trava das outras baixas,
-- `_exige_financeiro_para_baixar`. A sexta, `dar_baixa_desembolso_parcela`,
-- ganhou a trava na migration 20261021600002, que a recriou.
--
-- Como: o corpo de cada função é lido do próprio banco e só o bloco
-- `if not is_tenant_member(...) then raise ... end if;` é trocado pela trava;
-- a função tem de ter exatamente um bloco desses, senão a migration para.
-- `create or replace` com a mesma assinatura mantém os GRANTs.
--
-- `garantir_fatura_aberta_do_cartao` não checava nada e cria fatura: sai o
-- EXECUTE de `authenticated`. Nenhuma tela a chama; quem a chama são
-- `cartao_lancar_item`, `rotear_pp_para_cartao` e `_fatura_da_competencia`,
-- todas SECURITY DEFINER (rodam como o dono), então continuam podendo.
--
-- Mudança de permissão confirmada pelo Tiago em 21/10/2026 (M2.4, opção A).
-- =============================================================================

do $$
declare
  v_nome  text;
  v_def   text;
  v_novo  text;
  v_re    text := 'if not (public\.)?is_tenant_member\((\w+)\.tenant_id\) then\s*raise exception ''[^'']*'';\s*end if;';
begin
  foreach v_nome in array array[
    'dar_baixa_devolucao_verba',
    'dar_baixa_fatura_cartao',
    'fechar_fatura_cartao',
    'reabrir_fatura_cartao',
    'rotear_pp_para_cartao'
  ]
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_nome;
    if v_def is null then
      raise exception 'Função % não encontrada.', v_nome;
    end if;
    if (select count(*) from regexp_matches(v_def, v_re, 'g')) <> 1
       or (select count(*) from regexp_matches(v_def, 'is_tenant_member', 'g')) <> 1 then
      raise exception 'A função % não tem exatamente um bloco is_tenant_member: confira antes de trocar.', v_nome;
    end if;
    v_novo := regexp_replace(
      v_def, v_re,
      '-- Só admin ou financeiro (M2.4, decisão 197).' || chr(10)
      || '  perform public._exige_financeiro_para_baixar(\2.tenant_id);'
    );
    execute v_novo;
  end loop;
end;
$$;

revoke execute on function public.garantir_fatura_aberta_do_cartao(uuid, date) from public, anon, authenticated;
