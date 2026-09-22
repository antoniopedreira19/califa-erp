-- =============================================================================
-- Aprovação de save em vigor (decisão 099, parte 3)
-- =============================================================================
--
-- Liga as travas que 20260922140001 criou desligadas: em job aberto, a marca
-- de save, o consumo, a errata e a remoção de linha com save passam a ser
-- recusados quando chegam direto pela API, fora das RPCs de save.
--
-- Aplicar JUNTO do deploy do código da feature, nunca antes: o fluxo antigo
-- (registrarErrataDeSave) grava a errata antes de mudar a linha, e a recusa
-- deixaria errata fantasma no histórico do job.
-- =============================================================================

create or replace function public.save_aprovacao_em_vigor()
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select true;
$$;
