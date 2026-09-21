-- =====================================================================
-- RPC alocar_sequencial_cnab: aloca próximo sequencial de arquivo
-- =====================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- Fase 5.2 do módulo pgto-remessa. O sequencial de arquivo é unique
-- por conta bancária (uniq_cnab_remessas_sequencial) — duas gerações
-- simultâneas de arquivo precisam receber números diferentes. Deixar
-- o cliente calcular "próximo = atual + 1" e depois inserir é
-- vulnerável a race: dois clientes leem 13, ambos calculam 14, um
-- deles ganha o insert e o outro estoura constraint.
--
-- Solução: função PL/pgSQL que dentro de uma transação implícita
-- UPDATE+RETURNING pega o valor atual e incrementa em uma única
-- operação. Postgres garante que UPDATE em uma linha bloqueia demais
-- transações na mesma linha até commit — dois clientes concorrentes
-- serializam naturalmente.
--
-- Comportamento:
--   • Se conta nunca teve sequencial (null), começa em 11 (fora da
--     faixa de teste 1-10 do banco, Nota G010 do manual).
--   • Retorna o número que o cliente DEVE usar (antes de incrementar).
--   • Deixa a coluna com o próximo (que o próximo cliente vai pegar).
--
-- SECURITY DEFINER pra permitir escrita em contas_bancarias mesmo
-- quando quem chama tem permissão só de leitura na tabela (a
-- validação de gate está na server action que chama a RPC).
-- =====================================================================

create or replace function public.alocar_sequencial_cnab(
  p_conta_bancaria_id uuid,
  p_tenant_id uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sequencial integer;
begin
  update public.contas_bancarias
  set sequencial_arquivo = coalesce(sequencial_arquivo, 11) + 1
  where id = p_conta_bancaria_id
    and tenant_id = p_tenant_id
  returning sequencial_arquivo - 1 into v_sequencial;

  if v_sequencial is null then
    raise exception 'Conta bancária % não encontrada no tenant %',
      p_conta_bancaria_id, p_tenant_id;
  end if;

  return v_sequencial;
end;
$$;

comment on function public.alocar_sequencial_cnab(uuid, uuid) is
  'Aloca próximo sequencial de arquivo CNAB pra uma conta bancária. '
  'Incrementa atomicamente. Retorna o número a ser usado no arquivo '
  'que está sendo gerado. Módulo pgto-remessa (fase 5.2).';

revoke all on function public.alocar_sequencial_cnab(uuid, uuid) from public;
grant execute on function public.alocar_sequencial_cnab(uuid, uuid) to authenticated;
