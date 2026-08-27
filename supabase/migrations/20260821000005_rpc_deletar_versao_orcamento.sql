-- 20260821000005 — deletar versão de orçamento numa transação só
--
-- Contexto: `deletarVersao` (server action) precisa apagar três coisas —
-- itens, grupos e a própria versão. Fazer isso em três chamadas separadas ao
-- PostgREST são três transações: se a terceira falhar, a versão fica no banco
-- SEM os itens e sem os grupos, e ninguém fica sabendo. Aconteceu de verdade
-- na conferência desta entrega, quando o GRANT de DELETE ainda faltava
-- (migration 20260821000004): os dois primeiros deletes passaram e o terceiro
-- deu "permission denied".
--
-- Uma chamada de RPC é UMA transação. Ou some tudo, ou não some nada.
--
-- Por que a ordem é explícita e não confiada ao CASCADE: `versoes_orcamento`
-- tem ON DELETE CASCADE tanto para grupos quanto para itens, mas
-- `versoes_orcamento_itens.grupo_id` referencia o grupo com ON DELETE
-- RESTRICT. RESTRICT é checado na hora (diferente de NO ACTION, que espera o
-- fim do statement), então se o Postgres cascatear os grupos antes dos itens
-- o delete inteiro é barrado. Apagando item → grupo → versão na mão, o
-- resultado não depende da ordem que o Postgres escolher.
--
-- `itens_bv` cai junto por CASCADE a partir do item.
--
-- SECURITY INVOKER (o default, explicitado aqui para não restar dúvida): a
-- função roda com o papel de quem chamou, então as policies de tenant valem
-- como em qualquer outro caminho. Ela NÃO é um bypass de RLS — é só um
-- empacotamento transacional.
--
-- As regras de negócio (versão aprovada não deleta, versão com job não
-- deleta, a última versão não deleta) ficam na server action, que é quem
-- consegue devolver a frase certa para a tela. Aqui só a mecânica.
--
-- Mudança ADITIVA: cria função nova, não altera nada existente.

create or replace function public.deletar_versao_orcamento(p_versao_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = public
as $$
begin
  delete from versoes_orcamento_itens where versao_orcamento_id = p_versao_id;
  delete from versoes_orcamento_grupos where versao_orcamento_id = p_versao_id;
  delete from versoes_orcamento where id = p_versao_id;
end;
$$;

comment on function public.deletar_versao_orcamento(uuid) is
  'Apaga itens, grupos e a versão numa transação só. Ordem explícita por causa do RESTRICT em versoes_orcamento_itens.grupo_id. SECURITY INVOKER: o RLS de tenant continua valendo. Regras de negócio ficam na server action deletarVersao.';

revoke all on function public.deletar_versao_orcamento(uuid) from public;
revoke all on function public.deletar_versao_orcamento(uuid) from anon;
grant execute on function public.deletar_versao_orcamento(uuid) to authenticated;
