-- ===========================================================================
-- A trava de papel da prestação de contas volta a recusar quem não presta
-- contas (decisão 246, ponto aberto resolvido)
-- ===========================================================================
-- Achado em 06/11/2026, testando o "Cancelar envio" da 246 numa transação
-- desfeita: o "Financeiro Teste" cancelou o envio de uma prestação.
--
-- Em `_verba_para_prestar` (decisão 189), a condição
--     v_pp.responsavel_verba_id = v_uid
-- dá NULL na verba sem responsável — todas desde a decisão 171, que trocou
-- o responsável pelo titular. Com ela, `not (false or NULL or false)` é
-- NULL, e o `if` com NULL não entra: a exceção não saía, e QUALQUER papel
-- ativo do tenant passava pelas quatro funções da produção que a chamam —
-- `salvar_documento_prestacao_verba`, `remover_documento_prestacao_verba`,
-- `enviar_prestacao_verba_salva` e `cancelar_envio_prestacao_verba`.
--
-- A tela já só mostrava os botões para quem presta contas
-- (`carregar-detalhe.ts`: administrador, GP, produtor, freela e o
-- responsável da verba anterior à 171), e a auditoria até 06/11/2026 só tem
-- administrador, GP e produtor nesse caminho — ninguém de fora usou. A
-- correção é o `coalesce(..., false)`; o resto da função fica igual ao que
-- estava no banco (lido pelo MCP em 06/11/2026).
--
-- Autorizada pelo Tiago em 06/11/2026 ("Sim, corrija"). O GRANT não muda
-- (`create or replace` preserva a ACL). No banco, a função tem execução
-- para `authenticated` — como as outras auxiliares da prestação —, apesar do
-- `revoke` da 189; com a trava certa, chamá-la direto só devolve a PP a quem
-- já presta contas dela. `anon` não executa.
-- ===========================================================================

create or replace function public._verba_para_prestar(p_pp_id uuid)
 returns pedidos_compra
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_pp    public.pedidos_compra%rowtype;
  v_papel text;
begin
  select * into v_pp from public.pedidos_compra where id = p_pp_id for update;
  if not found then raise exception 'PP não encontrada.'; end if;

  select tm.role::text into v_papel
    from public.tenant_members tm
    join public.profiles p on p.id = tm.user_id
   where tm.user_id = v_uid
     and tm.tenant_id = v_pp.tenant_id
     and tm.status = 'ativo'
     and p.ativo = true;
  if v_papel is null then raise exception 'Sem acesso a esta PP.'; end if;

  if v_pp.verba_producao is not true and not public._pp_da_auditoria_liberada(v_pp) then
    if v_pp.sem_nf_na_auditoria then
      raise exception 'As NFs deste job ainda não foram liberadas pelo financeiro.';
    end if;
    raise exception 'Esta PP não é de verba.';
  end if;
  if v_pp.tipo_verba = 'reembolso' then
    raise exception 'Reembolso não tem prestação de contas: os comprovantes vão no envio da PP.';
  end if;

  -- Decisão 246: sem o coalesce, a verba sem responsável (NULL) deixava a
  -- condição inteira NULL, e o `if not (NULL)` não recusava ninguém.
  if not (
    v_papel in ('administrador', 'gerente_producao', 'produtor')
    or coalesce(v_pp.responsavel_verba_id = v_uid, false)
    or (
      v_papel = 'freelancer'
      and exists (
        select 1 from public.jobs j
         where j.id = v_pp.job_id
           and public.is_freelancer_do_projeto(j.projeto_id)
      )
    )
  ) then
    raise exception 'Só um administrador, um GP, um produtor ou o freela do job presta contas desta verba.';
  end if;

  return v_pp;
end;
$function$;
