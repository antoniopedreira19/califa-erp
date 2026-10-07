-- =====================================================================
-- Decisão 148, entrega 2 — correção da 20261007990001 (07/10/2026).
--
-- `excluir_orcamento_vazio` nasceu `security invoker`, e no primeiro teste
-- pela tela o DELETE foi recusado: `authenticated` não tem DELETE em
-- `orcamentos` nem em `orcamento_importacoes` (que vai junto, em cascata).
-- É de propósito — o app nunca apagou orçamento, e ninguém deve poder
-- apagar um direto pela API.
--
-- Em vez de abrir o DELETE para todo usuário, a função passa a rodar como
-- dona (`security definer`) e confere ela mesma o que a RLS de
-- `orcamentos` conferiria (`orcamentos_modify`): o tenant de quem chama e
-- o acesso à empresa e à regional do orçamento. O freelancer, que a RLS
-- trata à parte, já fica de fora pelo papel. A única porta para apagar um
-- orçamento continua sendo esta função, com todas as travas.
--
-- As recusas passam a usar o código padrão do RAISE (P0001): o 42501 é o
-- mesmo do "permission denied" do Postgres, e a action não teria como
-- separar a recusa (em português, para a tela) do erro técnico.
-- =====================================================================

create or replace function public.excluir_orcamento_vazio(p_orcamento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_orc record;
begin
  if v_uid is null then
    raise exception 'Sessão expirada. Entre de novo para excluir.';
  end if;

  -- O mesmo papel de `orcamentos.criar` (lib/permissoes.ts). A action
  -- confere antes; aqui é para quem chamar a função direto.
  if coalesce(public.session_role()::text, '') not in ('administrador', 'gerente_producao', 'produtor') then
    raise exception 'Só quem cria orçamento pode excluir um orçamento vazio.';
  end if;

  select o.id, o.tenant_id, o.projeto_id, o.codigo, o.nome, o.arquivado_em,
         o.empresa_id, o.regional_id,
         p.codigo as projeto_codigo, p.status::text as projeto_status
    into v_orc
    from public.orcamentos o
    join public.projetos p on p.id = o.projeto_id
   where o.id = p_orcamento_id
     for update of o;

  -- O que a RLS de `orcamentos` exigiria. Fora do alcance de quem chama,
  -- o orçamento "não existe" — como numa leitura comum.
  if not found
     or v_orc.tenant_id not in (select public.current_tenant_ids())
     or not public.can_access_empresa_regional(v_uid, v_orc.empresa_id, v_orc.regional_id) then
    raise exception 'Orçamento não encontrado.' using errcode = 'P0002';
  end if;

  if v_orc.arquivado_em is not null or v_orc.projeto_status = 'arquivado' then
    raise exception 'Orçamento arquivado, ou de projeto arquivado, é só leitura. Reative para excluir.';
  end if;

  if not public.orcamento_esta_vazio(p_orcamento_id) then
    raise exception 'Só se exclui orçamento completamente vazio: em rascunho, nunca aprovado, sem job e sem nenhum item em nenhuma versão.';
  end if;

  -- Versões, grupos, meses e o histórico de importação vão junto (FKs em
  -- cascata). O código fica em `codigos_de_orcamento_usados`.
  delete from public.orcamentos where id = p_orcamento_id;

  perform public.log_audit_event(
    'orcamento.excluido',
    v_orc.tenant_id,
    'orcamento',
    p_orcamento_id::text,
    jsonb_build_object(
      'codigo', v_orc.codigo,
      'nome', v_orc.nome,
      'projeto_id', v_orc.projeto_id,
      'projeto', v_orc.projeto_codigo
    )
  );

  return jsonb_build_object(
    'id', p_orcamento_id,
    'codigo', v_orc.codigo,
    'nome', v_orc.nome,
    'projeto_id', v_orc.projeto_id
  );
end;
$$;

revoke all on function public.excluir_orcamento_vazio(uuid) from public, anon;
grant execute on function public.excluir_orcamento_vazio(uuid) to authenticated;
