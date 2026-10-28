-- Decisão 226 (28/10/2026): a linha vermelha sai da errata.
--
-- Até aqui a linha vermelha só nascia dentro de uma errata
-- (`registrar_errata_do_job`): o job voltava ao mural de abertura, o envio
-- da PP dela ficava travado até a revisão do financeiro (decisão 185) e, para
-- o produtor, ela só entrava quando um GP enviasse a errata pronta (159). O
-- Tiago decidiu que a linha vermelha não é errata: ela não mexe no orçado nem
-- no faturamento (nasce zerada — `chk_jio_linha_vermelha_zerada`), então
-- entra na hora, pelo administrador, pelo GP ou pelo produtor, e a PP dela
-- já pode ser gerada e enviada.
--
-- 1. `jobs_itens_orcado.criada_por`: quem criou a linha fora da errata. A
--    linha da errata tem o autor na errata (`errata_origem_id`); a vermelha
--    de agora não tem errata, e o histórico da planilha (decisão 186) mostra
--    o momento dela com autor e hora (`created_at`).
-- 2. `adicionar_linhas_vermelhas_do_job`: grava as linhas e a âncora de
--    realizado de cada uma, como a errata faz com a linha nova — sem
--    `jobs_erratas`, sem tocar em `abertura_em_revisao` nem nos espelhos do
--    job (valor e faturamento não mudam). A linha entra no fim do
--    agrupamento. As travas de status do job e de envio para faturamento
--    ficam na server action, como na errata.
--
-- Aditiva: coluna nova anulável e função nova. Nada do que existe muda.

alter table public.jobs_itens_orcado
  add column if not exists criada_por uuid;

comment on column public.jobs_itens_orcado.criada_por is
  'Decisão 226: quem criou a linha vermelha fora da errata. Nulo nas linhas da versão aprovada e nas criadas por errata (o autor está em jobs_erratas).';

create or replace function public.adicionar_linhas_vermelhas_do_job(
  p_job_id uuid,
  p_linhas jsonb
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job   record;
  v_uid   uuid := (select auth.uid());
  v_l     jsonb;
  v_gid   uuid;
  v_id    uuid;
  v_ordem integer;
  v_ids   jsonb := '{}'::jsonb;
begin
  if coalesce((select public.session_role())::text, '') not in ('administrador', 'gerente_producao', 'produtor') then
    raise exception 'Só o administrador, o GP ou o produtor cria linha vermelha.';
  end if;

  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then
    raise exception 'Nenhuma linha vermelha informada.';
  end if;

  select j.id, j.tenant_id
    into v_job
    from public.jobs j
   where j.id = p_job_id
   for update;
  if not found then
    raise exception 'Job não encontrado.';
  end if;

  for v_l in select * from jsonb_array_elements(p_linhas)
  loop
    if btrim(coalesce(v_l->>'item', '')) = '' then
      raise exception 'Toda linha vermelha precisa de uma descrição.';
    end if;

    select g.id into v_gid
      from public.jobs_grupos g
     where g.id = nullif(v_l->>'grupo_id', '')::uuid
       and g.job_id = p_job_id
       and g.removido_em is null;
    if not found then
      raise exception 'O agrupamento da linha vermelha não é deste job. Recarregue a página.';
    end if;

    select coalesce(max(o.ordem), 0) + 1 into v_ordem
      from public.jobs_itens_orcado o
     where o.job_id = p_job_id
       and o.job_grupo_id = v_gid;

    insert into public.jobs_itens_orcado (
      tenant_id, job_id, item_versao_id, errata_origem_id, linha_vermelha, criada_por,
      job_grupo_id, grupo_id, ordem, item, tipo_custo,
      valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
      valor_unitario_planejado, quantidade_planejada, dias_meses_planejado
    ) values (
      v_job.tenant_id, p_job_id, null, null, true, v_uid,
      v_gid,
      (select g.grupo_versao_id from public.jobs_grupos g where g.id = v_gid),
      v_ordem, btrim(v_l->>'item'),
      (v_l->>'tipo_custo')::public.tipo_custo,
      0, 1, 1,
      0, 0, 0
    )
    returning id into v_id;

    insert into public.jobs_itens_realizado (
      tenant_id, job_id, item_id, job_item_orcado_id,
      valor_unitario_realizado, quantidade_realizada, dias_meses_realizado,
      created_by
    ) values (
      v_job.tenant_id, p_job_id, null, v_id, 0, 0, 0, v_uid
    );

    v_ids := v_ids || jsonb_build_object(coalesce(v_l->>'chave', v_id::text), v_id);
  end loop;

  return v_ids;
end;
$$;

comment on function public.adicionar_linhas_vermelhas_do_job(uuid, jsonb) is
  'Decisão 226: grava linhas vermelhas no job sem errata (sem mural, sem revisão do financeiro, sem mexer no valor do job). Devolve {chave: id}.';

revoke all on function public.adicionar_linhas_vermelhas_do_job(uuid, jsonb) from public, anon;
grant execute on function public.adicionar_linhas_vermelhas_do_job(uuid, jsonb) to authenticated;
