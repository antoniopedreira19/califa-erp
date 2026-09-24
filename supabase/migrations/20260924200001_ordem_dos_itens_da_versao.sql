-- =====================================================================
-- Ordem dos itens da planilha da versão, gravada numa transação só
--
-- Decisão 104 (24/09/2026): o item da planilha interna do orçamento muda
-- de lugar arrastando pela alça (ou com Alt + ↑ ↓) e pode trocar de
-- agrupamento. Vale na tela da versão e na visão agregada do projeto.
--
-- A ordem já existia: é `versoes_orcamento_itens.ordem`, GLOBAL na versão
-- — a tela ordena os grupos pela ordem deles e, dentro de cada grupo, os
-- itens pela ordem do item. Mover um item desloca os que estão entre a
-- posição antiga e a nova, então uma mudança de lugar reescreve a ordem
-- de várias linhas. Pelo PostgREST seriam N updates, N transações, e um
-- erro no meio deixaria a planilha com a ordem pela metade.
--
-- Esta função recebe a ordem nova já calculada no TypeScript
-- (`numerarItens`, lib/calculos/ordem-itens.ts, com testes) e só grava:
-- confere que todo item e todo grupo do pedido são desta versão e
-- atualiza as linhas que mudaram, num UPDATE só.
--
-- SECURITY INVOKER: as policies de tenant valem como em qualquer outro
-- caminho. Regras que devolvem frase de tela (versão aprovada ou
-- cancelada, permissão `orcamentos.editar`) ficam nas server actions,
-- como nas RPCs dos meses (20260914200004).
--
-- Aditivo: só uma função nova. Nenhuma coluna, nenhum dado existente
-- muda por esta migration.
-- =====================================================================

create or replace function public.aplicar_ordem_itens_versao(
  p_versao_id uuid,
  -- [{ "id": uuid, "grupo_id": uuid, "ordem": int }, ...]
  p_itens jsonb
)
returns integer
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_total integer;
  v_distintos integer;
  v_invalidos integer;
  v_alterados integer;
begin
  if not exists (select 1 from versoes_orcamento where id = p_versao_id) then
    raise exception 'Versão não encontrada.' using errcode = 'no_data_found';
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'Lista de itens inválida.' using errcode = 'invalid_parameter_value';
  end if;

  select count(*), count(distinct x.id)
    into v_total, v_distintos
    from jsonb_to_recordset(p_itens) as x(id uuid, grupo_id uuid, ordem integer);

  if v_total <> v_distintos then
    raise exception 'O mesmo item veio duas vezes.' using errcode = 'invalid_parameter_value';
  end if;

  -- Item e grupo têm que ser DESTA versão: sem isso a função moveria um
  -- item para o grupo de outro orçamento.
  select count(*)
    into v_invalidos
    from jsonb_to_recordset(p_itens) as x(id uuid, grupo_id uuid, ordem integer)
    left join versoes_orcamento_itens i
           on i.id = x.id and i.versao_orcamento_id = p_versao_id
    left join versoes_orcamento_grupos g
           on g.id = x.grupo_id and g.versao_orcamento_id = p_versao_id
   where i.id is null
      or g.id is null
      or x.ordem is null
      or x.ordem < 1;

  if v_invalidos > 0 then
    raise exception 'Item ou agrupamento fora desta versão.' using errcode = 'check_violation';
  end if;

  update versoes_orcamento_itens i
     set ordem = x.ordem,
         grupo_id = x.grupo_id
    from jsonb_to_recordset(p_itens) as x(id uuid, grupo_id uuid, ordem integer)
   where i.id = x.id
     and i.versao_orcamento_id = p_versao_id
     and (i.ordem <> x.ordem or i.grupo_id <> x.grupo_id);

  get diagnostics v_alterados = row_count;
  return v_alterados;
end;
$$;

comment on function public.aplicar_ordem_itens_versao(uuid, jsonb) is
  'Grava ordem e grupo de itens da versão num UPDATE só, depois de conferir que todos são da versão. Devolve quantas linhas mudaram. Decisão 104.';

revoke all on function public.aplicar_ordem_itens_versao(uuid, jsonb) from public, anon;
grant execute on function public.aplicar_ordem_itens_versao(uuid, jsonb) to authenticated;
