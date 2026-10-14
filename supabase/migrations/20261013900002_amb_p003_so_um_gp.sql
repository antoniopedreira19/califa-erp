-- =====================================================================
-- Correção de dado (13/10/2026, pedida e autorizada pelo Tiago): o projeto
-- AMB-P003/26 fica com um GP Responsável só, o GP novo do AMB-1008/26
-- (migration 20261013900001).
--
-- A outra pessoa que estava como GP Responsável tem o papel Produtor. Ela
-- sai dos GPs e continua na Equipe: a linha muda de `gp` para `equipe`, e
-- ela segue como produtora do orçamento AMB-P003/26-01 e do job, sem
-- mudança. `projetos.responsavel_id` (o "primeiro GP", por compatibilidade)
-- passa para o GP que fica.
--
-- Cada passo confere o valor antigo e para tudo se ele tiver mudado.
-- Auditoria `projeto.gp_corrigido`, com o Tiago como autor. Perfis pelo id:
-- o repositório é público. Já aplicada: rodar de novo para na primeira
-- conferência, sem escrever nada.
-- =====================================================================

do $$
declare
  v_projeto   uuid;
  v_tenant    uuid;
  v_gp        uuid := 'c1079379-8ce2-450d-9243-f06699d9739d';
  v_tiago     uuid := '3a933b18-156d-48b3-b100-a8099292b1c2';
  v_produtora uuid := '53f49793-1466-4936-a3eb-0fa694a6d4dd';
  v_n         int;
begin
  select id, tenant_id into v_projeto, v_tenant from public.projetos where codigo = 'AMB-P003/26';
  if v_projeto is null then
    raise exception 'Correção do AMB-P003/26: projeto não encontrado.';
  end if;

  if not exists (
    select 1 from public.projeto_responsaveis
     where projeto_id = v_projeto and profile_id = v_gp and papel = 'gp'
  ) then
    raise exception 'Correção do AMB-P003/26: o GP que fica não é GP Responsável do projeto.';
  end if;

  update public.projeto_responsaveis set papel = 'equipe'
   where projeto_id = v_projeto and profile_id = v_produtora and papel = 'gp';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'Correção do AMB-P003/26: a produtora não está mais como GP Responsável.';
  end if;

  update public.projetos set responsavel_id = v_gp
   where id = v_projeto and responsavel_id = v_produtora;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'Correção do AMB-P003/26: o responsável do projeto mudou desde a leitura.';
  end if;

  insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
  values (v_tenant, v_tiago, 'projeto.gp_corrigido', 'projeto', v_projeto::text,
          jsonb_build_object('projeto', 'AMB-P003/26',
                             'gp_removido', v_produtora, 'gp_removido_fica_na_equipe', true,
                             'responsavel_anterior', v_produtora, 'responsavel_novo', v_gp,
                             'origem', 'correcao_pelo_mcp', 'migration', '20261013900002'));
end;
$$;
