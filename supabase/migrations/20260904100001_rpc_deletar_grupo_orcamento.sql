-- 20260904100001 — remover grupo da versão leva os itens junto, numa transação só
--
-- Contexto: até aqui a lixeira do grupo, na planilha da versão, só apagava
-- grupo VAZIO. Com item dentro ela devolvia "Remova os N itens do grupo antes
-- de excluí-lo" — e apagar item a item, numa planilha importada com dezenas de
-- linhas, é trabalho manual que o sistema podia fazer. Decisão do Tiago
-- (04/09/2026): a lixeira do grupo apaga o grupo E os itens dele, com a
-- confirmação dizendo quantos itens vão junto.
--
-- Por que RPC e não dois deletes seguidos do PostgREST: dois deletes são duas
-- transações. Se o segundo falhar, os itens somem e o grupo fica — um grupo
-- vazio que o usuário nunca pediu, e sem nenhum caminho de volta. Foi
-- exatamente a dor que a 20260821000005 (`deletar_versao_orcamento`) resolveu
-- para a versão inteira; esta é a mesma mecânica, um nível abaixo.
--
-- A ordem é explícita, item -> grupo, porque `versoes_orcamento_itens.grupo_id`
-- referencia o grupo com ON DELETE RESTRICT: apagar o grupo primeiro é barrado
-- na hora. `itens_bv` e `saves_consumos` caem junto por CASCADE a partir do
-- item.
--
-- SECURITY INVOKER (o default, explicitado para não restar dúvida): roda com o
-- papel de quem chamou, então as policies de tenant valem como em qualquer
-- outro caminho. Não é bypass de RLS — é só empacotamento transacional.
--
-- A regra de negócio (versão aprovada não perde grupo) fica na server action
-- `removerGrupo`, que é quem consegue devolver a frase certa para a tela. Aqui
-- só a mecânica. E ainda existe uma trava de banco depois desta: se um job já
-- nasceu desta versão, `jobs_itens_orcado` aponta para os itens com NO ACTION e
-- o delete falha — a action traduz esse erro.
--
-- Mudança ADITIVA: cria função nova, não altera nada existente.

create or replace function public.deletar_grupo_orcamento(p_grupo_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = public
as $$
begin
  delete from versoes_orcamento_itens where grupo_id = p_grupo_id;
  delete from versoes_orcamento_grupos where id = p_grupo_id;
end;
$$;

comment on function public.deletar_grupo_orcamento(uuid) is
  'Apaga os itens do grupo e o grupo numa transação só. Ordem explícita por causa do RESTRICT em versoes_orcamento_itens.grupo_id. SECURITY INVOKER: o RLS de tenant continua valendo. Regras de negócio ficam na server action removerGrupo.';

revoke all on function public.deletar_grupo_orcamento(uuid) from public;
revoke all on function public.deletar_grupo_orcamento(uuid) from anon;
grant execute on function public.deletar_grupo_orcamento(uuid) to authenticated;
