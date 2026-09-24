-- =============================================================================
-- Save: quem mexe é o administrador ou qualquer GP (Tiago, 24/09/2026)
-- =============================================================================
--
-- A 20260922140008 amarrou o save do job ao RESPONSÁVEL (GP ou produtor
-- responsável, ou o administrador). O Tiago reviu a regra:
--
--   * gerar, consumir, retirar e cancelar pedido de save é do
--     administrador ou de QUALQUER GP (`gerente_producao`), responsável
--     pelo job ou não;
--   * o produtor não mexe no save;
--   * o que importa para o financeiro é QUEM fez, e isso já vai no pedido
--     (`saves_aprovacoes.enviado_por`), que a aprovação mostra.
--
-- O que muda aqui:
--
-- 1. `save_pode_mexer_no_job` passa a ser "administrador ou GP ativo no
--    tenant do job". O nome fica: as RPCs de save já chamam por ele.
-- 2. As mensagens de recusa de `save_pedir`, `save_retirar`,
--    `save_retirar_nao_enviado` e `save_enviar_pendentes` falavam em
--    "responsável do job". A troca é feita sobre a definição atual de cada
--    função (o mesmo padrão da 20260827010010), e a migration falha se o
--    texto antigo não estiver lá — assim ela nunca troca às cegas.
-- 3. `cancelar_pedido_save` não conferia papel nenhum (qualquer membro que
--    vê o job cancelava). Passa pela mesma regra.
--
-- Nenhum dado muda nesta migration.
-- =============================================================================

create or replace function public.save_pode_mexer_no_job(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
      from public.jobs j
      join public.tenant_members tm
        on tm.tenant_id = j.tenant_id
       and tm.user_id = (select auth.uid())
       and tm.status = 'ativo'
      join public.profiles p on p.id = tm.user_id and p.ativo = true
     where j.id = p_job_id
       and tm.role in ('administrador', 'gerente_producao')
  );
$$;

comment on function public.save_pode_mexer_no_job(uuid) is
  'Decisão 099 (revista em 24/09/2026): gerar, consumir, retirar e cancelar pedido de save é do administrador ou de qualquer GP do tenant do job. O produtor não mexe no save.';

do $troca$
declare
  v_def  text;
  v_novo text;
  v_fn   regprocedure;
  v_de   text;
  v_para text;
begin
  -- As três RPCs que mudam a linha.
  foreach v_fn in array array[
    'public.save_pedir(uuid,public.save_aprovacao_tipo,jsonb,jsonb,jsonb)'::regprocedure,
    'public.save_retirar(uuid,jsonb,jsonb)'::regprocedure,
    'public.save_retirar_nao_enviado(uuid,jsonb,jsonb)'::regprocedure
  ] loop
    v_def := pg_get_functiondef(v_fn);
    v_de := 'Apenas o responsável do job ou o administrador muda o save desta linha.';
    v_para := 'Apenas o administrador ou um GP muda o save desta linha.';
    if position(v_de in v_def) = 0 then
      raise exception 'Texto esperado não encontrado em %', v_fn;
    end if;
    v_novo := replace(v_def, v_de, v_para);
    execute v_novo;
  end loop;

  -- O botão "Enviar N saves para aprovação" do job legado.
  v_fn := 'public.save_enviar_pendentes(uuid,text,jsonb)'::regprocedure;
  v_def := pg_get_functiondef(v_fn);
  v_de := 'Apenas o responsável do job ou o administrador envia os saves deste job para aprovação.';
  v_para := 'Apenas o administrador ou um GP envia os saves deste job para aprovação.';
  if position(v_de in v_def) = 0 then
    raise exception 'Texto esperado não encontrado em %', v_fn;
  end if;
  execute replace(v_def, v_de, v_para);

  -- Cancelar pedido: a mesma regra, logo depois da conferência de acesso.
  v_fn := 'public.cancelar_pedido_save(uuid,jsonb,jsonb,text)'::regprocedure;
  v_def := pg_get_functiondef(v_fn);
  v_de := E'  if a.situacao <> ''aguardando'' then\n    raise exception ''Só um pedido que aguarda aprovação pode ser cancelado.'';';
  if position(v_de in v_def) = 0 then
    raise exception 'Texto esperado não encontrado em %', v_fn;
  end if;
  v_para := E'  if not public.save_pode_mexer_no_job(a.job_id) then\n'
         || E'    raise exception ''Apenas o administrador ou um GP cancela um pedido de save.'';\n'
         || E'  end if;\n'
         || v_de;
  execute replace(v_def, v_de, v_para);
end
$troca$;
