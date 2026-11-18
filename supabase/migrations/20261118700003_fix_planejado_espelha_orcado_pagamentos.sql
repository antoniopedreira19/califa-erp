-- Fix: `planejado_espelha_orcado` quebra em todo INSERT em
-- `versoes_orcamento_itens` (18/11/2026)
--
-- A definição de 20261118700001 (Job de Pagamentos, decisão 266) abriu o
-- ramo novo com UM `if` composto por AND:
--
--   if tg_table_name = 'jobs_itens_orcado'
--      and exists (select 1 from jobs j where j.id = new.job_id ...) then
--
-- A armadilha é a mesma já documentada em `save_marca_autor_e_planejado`
-- (migration 20260925110001): PL/pgSQL PREPARA A EXPRESSÃO INTEIRA antes
-- de avaliar o AND, então tenta resolver `new.job_id` mesmo quando o
-- trigger está disparando em `versoes_orcamento_itens` — tabela que não
-- tem `job_id`. Resultado: TODO INSERT na tabela de itens da versão
-- estoura com 42703 "record 'new' has no field 'job_id'". Isso quebrou
-- "+ Novo item" na planilha da versão e a importação de planilha (os
-- grupos entram, os itens não).
--
-- Correção: quebrar o `if` composto em DOIS `if` aninhados, igual ao
-- pattern usado no outro trigger. O `select` com `new.job_id` só é
-- planejado quando o outer `if tg_table_name = 'jobs_itens_orcado'` é
-- verdadeiro. Fora disso, o resto da função é idêntico à definição de
-- 20261118700001 (que, por sua vez, só acrescentou o ramo novo à de
-- 20260925100001). Nada aditivo: só o conserto.

create or replace function public.planejado_espelha_orcado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_interno boolean;
begin
  -- Dois IFs, e não um com AND: PL/pgSQL prepara a expressão inteira
  -- antes de avaliar o AND, e `new.job_id` não existe em
  -- `versoes_orcamento_itens`.
  if tg_table_name = 'jobs_itens_orcado' then
    if exists (select 1 from jobs j where j.id = new.job_id and j.de_pagamentos) then
      if new.em_save or coalesce(new.save_consumido, 0) > 0 then
        raise exception 'O job de pagamentos não usa save.'
          using errcode = 'check_violation';
      end if;
      new.tipo_custo            := 'FI';
      new.valor_unitario_orcado := 0;
      return new;
    end if;
  end if;

  if tg_table_name = 'versoes_orcamento_itens' then
    select public.orcamento_de_investimento_interno(v.orcamento_id)
      into v_interno
      from versoes_orcamento v
     where v.id = new.versao_orcamento_id;
  else
    select public.orcamento_de_investimento_interno(j.orcamento_id)
      into v_interno
      from jobs j
     where j.id = new.job_id;
  end if;

  if coalesce(v_interno, false) then
    if new.em_save or coalesce(new.save_consumido, 0) > 0 then
      raise exception 'O serviço Interno não usa save: é investimento da California, sem crédito de cliente a gerar ou consumir.'
        using errcode = 'check_violation';
    end if;
    new.tipo_custo               := 'FI';
    new.valor_unitario_planejado := coalesce(new.valor_unitario_orcado, 0);
    new.quantidade_planejada     := coalesce(new.quantidade_orcada, 0);
    new.dias_meses_planejado     := coalesce(new.dias_meses_orcado, 0);
    return new;
  end if;

  -- Linha em save não tem custo neste projeto: o serviço não acontece
  -- aqui, então não há fornecedor a pagar (decisão 028 §9).
  if new.em_save then
    new.valor_unitario_planejado := 0;
    new.quantidade_planejada     := 0;
    new.dias_meses_planejado     := 0;
  end if;
  return new;
end;
$$;
