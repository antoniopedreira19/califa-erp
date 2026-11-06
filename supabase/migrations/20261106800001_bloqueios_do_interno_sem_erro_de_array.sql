-- =====================================================================
-- Decisão 240 — conserto de bloqueios_do_job_para_o_interno
-- =====================================================================
-- A versão da 20261105800001 somava cada motivo com `v_motivos || 'texto'`.
-- Com o literal sem tipo, o Postgres lê o texto como um array
-- (text[] || text[]) e a função quebrava no primeiro motivo encontrado
-- ("malformed array literal"). O pop-up dava erro em vez de listar o que
-- impede a troca, e a RPC trocar_job_de_lado_do_interno, que confere os
-- mesmos motivos, recusava com essa mensagem técnica. Achado no teste do
-- TES-1030/26 (job com save), em 06/11/2026.
--
-- O conserto: array_append. Mesma assinatura, mesmas regras, mesmos
-- GRANTs; só a forma de somar o motivo muda.
-- =====================================================================

create or replace function public.bloqueios_do_job_para_o_interno(p_job_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_motivos text[] := array[]::text[];
begin
  select tenant_id into v_tenant from jobs where id = p_job_id;
  if v_tenant is null
     or not (public.is_tenant_admin(v_tenant) or public.is_tenant_financeiro(v_tenant)) then
    return null;
  end if;

  if exists (
    select 1 from jobs_itens_orcado
     where job_id = p_job_id
       and (em_save or coalesce(save_consumido, 0) > 0)
  ) then
    v_motivos := array_append(v_motivos, 'Há linha do job em save (gerando ou consumindo).'::text);
  end if;

  if exists (
    select 1 from saves_aprovacoes
     where job_id = p_job_id and situacao = 'aguardando'
  ) then
    v_motivos := array_append(v_motivos, 'Há pedido de save aguardando o financeiro.'::text);
  end if;

  if exists (
    select 1
      from itens_bv b
      join jobs_itens_orcado i on i.id = b.job_item_orcado_id
     where i.job_id = p_job_id
       and b.situacao in ('confirmado', 'recebido')
  ) then
    v_motivos := array_append(v_motivos, 'Há BV confirmado ou recebido.'::text);
  end if;

  if exists (
    select 1 from jobs_envio_faturamento where job_id = p_job_id
  ) then
    v_motivos := array_append(v_motivos, 'O job já foi enviado para faturamento.'::text);
  end if;

  if exists (
    select 1
      from faturamento_itens fi
      join faturamentos f on f.id = fi.faturamento_id
     where fi.origem_tipo in ('job', 'save')
       and fi.origem_id = p_job_id
       and f.status <> 'cancelado'
  ) then
    v_motivos := array_append(v_motivos, 'Já há nota emitida para o job.'::text);
  end if;

  if exists (
    select 1 from recebimentos_antes_nf
     where job_id = p_job_id and status <> 'cancelado'
  ) then
    v_motivos := array_append(v_motivos, 'Já há recebimento registrado para o job.'::text);
  end if;

  return v_motivos;
end;
$$;

comment on function public.bloqueios_do_job_para_o_interno(uuid) is
  'Decisão 240: os motivos que impedem o job de entrar no serviço Interno pelo "Editar registro" (save, BV confirmado ou recebido, envio para faturamento, nota, recebimento). Vazio quando nada impede; nulo para quem não é administrador ou financeiro.';

revoke all on function public.bloqueios_do_job_para_o_interno(uuid) from public, anon;
grant execute on function public.bloqueios_do_job_para_o_interno(uuid) to authenticated;
