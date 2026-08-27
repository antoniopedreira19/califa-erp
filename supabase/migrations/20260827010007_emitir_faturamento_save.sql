-- =====================================================================
-- SAVE — a nota nao pode faturar mais save do que o job gerou
--
-- `emitir_faturamento` ja sabia faturar o save sem mudanca nenhuma: a
-- trava do saldo da parcela soma TODOS os itens daquela parcela sem olhar
-- `origem_tipo`, e a parcela do envio vale o `faturamento_previsto`
-- inteiro, save incluido. Entao job + save cabem na mesma parcela e o
-- saldo fecha sozinho.
--
-- O que faltava era o teto do proprio save: sem ele daria para emitir uma
-- nota com R$ 100.000 de "saldo em save" num job que gerou R$ 30.000. A
-- trava e a irma da que ja existia para o BV ("Este BV ja foi
-- faturado"), e usa `jobs.faturamento_save_previsto` como teto.
--
-- Tambem confere que o save sai na nota do job que o GEROU: `origem_id`
-- do item tem de bater com o job da parcela do envio.
--
-- POR QUE POR PATCH, e nao reescrevendo a funcao: o corpo de uma funcao
-- plpgsql e guardado literalmente (ao contrario de view, que o Postgres
-- normaliza), entao `pg_get_functiondef` devolve exatamente o que esta
-- rodando. Reescrever 6.500 caracteres a mao para mudar 30 linhas e como
-- se perde uma clausula sem ninguem notar — foi o que quase aconteceu com
-- `bv_exige_item_com_bv` nesta mesma frente, onde o arquivo da migration
-- ja divergia do banco. As ancoras sao conferidas antes, e a migration
-- falha se alguma nao existir ou se a trava ja estiver aplicada.
-- =====================================================================

do $patch$
declare
  d text;
  v_decl_de text := '  v_codigo         text;';
  v_decl_para text;
  v_anchor text := '    if (v_item->>''origem_tipo'') = ''bv'' then';
  v_novo text;
begin
  d := pg_get_functiondef('public.emitir_faturamento(jsonb)'::regprocedure);

  if position(v_decl_de in d) = 0 then
    raise exception 'ANCORA DAS DECLARACOES NAO ENCONTRADA';
  end if;
  if position(v_anchor in d) = 0 then
    raise exception 'ANCORA DO BLOCO BV NAO ENCONTRADA';
  end if;
  if position('origem_tipo'') = ''save''' in d) > 0 then
    raise notice 'A trava do save ja esta aplicada; nada a fazer.';
    return;
  end if;

  v_decl_para := v_decl_de || E'\n  v_save_previsto  numeric(14,2);\n  v_save_ja        numeric(14,2);';
  d := replace(d, v_decl_de, v_decl_para);

  v_novo := $novo$    if (v_item->>'origem_tipo') = 'save' then
      if v_par.job_id is distinct from (v_item->>'origem_id')::uuid then
        raise exception 'O saldo em save só pode ser faturado na nota do job que o gerou.';
      end if;

      select coalesce(faturamento_save_previsto, 0)::numeric(14,2) into v_save_previsto
        from public.jobs where id = (v_item->>'origem_id')::uuid;

      select coalesce(sum(fi.valor), 0)::numeric(14,2) into v_save_ja
        from public.faturamento_itens fi
        join public.faturamentos f on f.id = fi.faturamento_id
       where fi.origem_tipo = 'save'
         and fi.origem_id = (v_item->>'origem_id')::uuid
         and f.status = 'emitido';

      if v_save_ja + (v_item->>'valor')::numeric > v_save_previsto + 0.01 then
        select codigo into v_codigo from public.jobs where id = (v_item->>'origem_id')::uuid;
        raise exception
          '% gerou R$ % de saldo em save e R$ % já saiu em nota: não cabe faturar mais R$ %.',
          coalesce(v_codigo, 'O job'), v_save_previsto, v_save_ja, (v_item->>'valor')::numeric;
      end if;
    end if;

$novo$;

  d := replace(d, v_anchor, v_novo || v_anchor);
  execute d;
end $patch$;
