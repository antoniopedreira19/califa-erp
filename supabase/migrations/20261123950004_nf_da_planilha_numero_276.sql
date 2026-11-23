-- A NF presa ao job da planilha passou a ser a decisão 276 (23/11/2026): o 275
-- já era da Mídia Off ("planejado e realizado", no main na mesma manhã). As
-- migrations 20261123950001 e 950002 foram aplicadas com "decisão 275" nos
-- comentários e na auditoria da passagem; aqui só esse texto muda, nas funções
-- desta entrega (pelo nome) e nos comentários da tabela e das colunas. Sem
-- efeito numa base que já recebeu as 950001–950002 com o número novo.
do $$
declare
  v_nome text;
  v_def  text;
begin
  foreach v_nome in array array[
    'public.emitir_faturamento(jsonb)',
    'public.passar_nf_da_planilha_ao_job(uuid,uuid,date,numeric)',
    'public._historico_previsoes_pagas(uuid)'
  ]
  loop
    v_def := pg_get_functiondef(v_nome::regprocedure);
    if v_def ~ '(decisão 275|-- 275:|''decisao'', 275)' then
      execute replace(replace(replace(v_def, 'decisão 275', 'decisão 276'), '-- 275:', '-- 276:'), '''decisao'', 275', '''decisao'', 276');
    end if;
  end loop;
end;
$$;

comment on column public.faturamento_itens.job_planilha_chave is
  'Decisão 276: a chave do job da planilha (historico_jobs.chave, "job:…" ou "evento:…") do item. Na nota avulsa, o job que ainda não existe no sistema; na nota de job, a origem da carga.';
comment on column public.faturamento_itens.job_planilha_nome is
  'Decisão 276: o nome do job na planilha, o que o financeiro usa na abertura (nome financeiro).';
comment on table public.faturamentos_passagens_da_planilha is
  'Decisão 276: a NF presa ao job da planilha que passou para o job aberto no sistema — de qual nome veio, para qual job, quem e quando.';
