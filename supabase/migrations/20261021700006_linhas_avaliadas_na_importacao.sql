-- =============================================================================
-- 20261021700006 — A avaliação única da importação (task 029, fase 3,
-- entrega 3C; decisão 201)
-- =============================================================================
--
-- Na importação, o que é certo se resolve sozinho (especificação 4.7, modo
-- "Baixa sozinho o que é certo"): o título com confiança alta e centro de
-- custo, a remessa que soma centavo a centavo e a regra do histórico. Cada
-- linha do banco é avaliada UMA vez: a que ficou para alguém decidir não
-- volta a se resolver sozinha numa leitura seguinte, e a que alguém desfez
-- tem `sem_auto` (decisão 199).
--
-- A automação roda na aba Conciliação automática, com as mesmas actions da
-- tela (a baixa vai pela baixa em lote de sempre). Esta função é a reserva:
-- grava `avaliada_em` só nas linhas que ainda não tinham e devolve QUAIS
-- gravou. A tela só resolve sozinha as linhas que esta chamada devolveu —
-- duas abas abertas ao mesmo tempo, ou dois usuários, não baixam a mesma
-- linha duas vezes.
--
-- Fica de fora: a baixa feita à mão que bate (passo 1) se liga a qualquer
-- momento, sem reserva (ela pode vir depois da importação); a ligação recusa
-- a linha que já está conciliada.
--
-- Aditiva: uma função nova; nenhuma tabela muda.
-- =============================================================================

create or replace function public.marcar_linhas_avaliadas(p_linha_ids uuid[])
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_ids uuid[];
begin
  if p_linha_ids is null or cardinality(p_linha_ids) = 0 then
    return '{}'::uuid[];
  end if;
  if cardinality(p_linha_ids) > 5000 then
    raise exception 'Linhas demais numa chamada.';
  end if;

  -- O papel em cada tenant das linhas (na prática, um só).
  for v_tenant in
    select distinct tenant_id from public.extrato_linhas where id = any(p_linha_ids)
  loop
    perform public._exige_financeiro_conciliacao(v_tenant);
  end loop;

  with marcadas as (
    update public.extrato_linhas l
       set avaliada_em = now()
     where l.id = any(p_linha_ids)
       and l.avaliada_em is null
       and l.ignorada_em is null
       and not exists (
         select 1 from public.lancamentos_financeiros f where f.extrato_linha_id = l.id
       )
    returning l.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_ids from marcadas;
  return v_ids;
end;
$$;

comment on function public.marcar_linhas_avaliadas(uuid[]) is
  'A avaliação única da importação (decisão 201): grava avaliada_em nas linhas pendentes que ainda não tinham e devolve as que gravou; só essas se resolvem sozinhas.';

revoke all on function public.marcar_linhas_avaliadas(uuid[]) from public, anon, authenticated;
grant execute on function public.marcar_linhas_avaliadas(uuid[]) to authenticated;
