-- 05/11/2026: RPCs SECURITY DEFINER pra GP conseguir solicitar e cancelar
-- distrato do próprio contrato.
--
-- Problema: a policy RLS de UPDATE em freelancer_contratos permite só
-- admin/rh/financeiro. Mas a UI expõe o botão "Solicitar distrato" pra GP
-- (gerente_producao) — a intenção de produto é ele mesmo abrir o pedido.
-- Até hoje, o clique parecia funcionar mas o UPDATE era bloqueado pela
-- policy sem erro (supabase-js devolve error=null pra 0 linhas afetadas);
-- o audit era gravado como sucesso e nada mudava no banco. Caso Adriano/
-- Márcia em 05/11/2026 escancarou o bug.
--
-- Fix: duas RPCs SECURITY DEFINER que rodam com privilégio de owner e
-- fazem o UPDATE direto. Elas validam permissão explicitamente:
--   - Admin/RH/Financeiro → pode qualquer contrato do tenant
--   - GP/qualquer tenant_member → só se é o `responsavel_id` do contrato
--
-- Rotas HTTP /distrato/solicitar e /distrato/cancelar passam a chamar
-- essas RPCs em vez do UPDATE direto. A policy RLS fica intacta (continua
-- fechada pra GP), evitando que GP possa mexer no resto do contrato.

begin;

-- ===========================================================================
-- 1. Solicitar distrato
-- ===========================================================================
create or replace function public.solicitar_distrato_contrato(
  p_contrato_id uuid,
  p_data_proposta date,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_contrato public.freelancer_contratos%rowtype;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Usuário não autenticado' using errcode = 'P0001';
  end if;

  select * into v_contrato
  from public.freelancer_contratos
  where id = p_contrato_id
  for update;

  if not found then
    raise exception 'Contrato não encontrado' using errcode = 'P0002';
  end if;

  -- Permissão: admin/rh/financeiro do tenant OU responsável do contrato.
  if not (
    public.is_tenant_admin(v_contrato.tenant_id)
    or public.is_tenant_rh(v_contrato.tenant_id)
    or public.is_tenant_financeiro(v_contrato.tenant_id)
    or v_contrato.responsavel_id = v_user_id
  ) then
    raise exception 'Sem permissão pra solicitar distrato deste contrato'
      using errcode = 'P0003';
  end if;

  -- Validação de dados: data proposta precisa ser anterior ao término atual
  -- (distrato = encerrar antes). Null ou igual/depois do término é inválido.
  if p_data_proposta is null then
    raise exception 'Informe a data proposta' using errcode = 'P0004';
  end if;
  if v_contrato.data_termino is not null and p_data_proposta >= v_contrato.data_termino then
    raise exception 'Data proposta deve ser anterior ao término atual do contrato'
      using errcode = 'P0005';
  end if;

  update public.freelancer_contratos
     set distrato_data_proposta = p_data_proposta,
         distrato_motivo = p_motivo,
         distrato_solicitado_por = v_user_id,
         distrato_solicitado_em = now(),
         -- Zera minuta/assinado anteriores em caso de nova solicitação
         distrato_minuta_url = null,
         distrato_arquivo_url = null,
         updated_by = v_user_id,
         updated_at = now()
   where id = p_contrato_id;
end;
$$;

comment on function public.solicitar_distrato_contrato is
  'SECURITY DEFINER: permite GP (responsável do contrato) solicitar distrato,
   contornando a policy RLS de UPDATE que é exclusiva de admin/rh/financeiro.
   Admin/RH/financeiro também podem chamar.';

grant execute on function public.solicitar_distrato_contrato(uuid, date, text)
  to authenticated;

-- ===========================================================================
-- 2. Cancelar distrato
-- ===========================================================================
create or replace function public.cancelar_distrato_contrato(
  p_contrato_id uuid
)
returns text[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_contrato public.freelancer_contratos%rowtype;
  v_user_id uuid := auth.uid();
  v_paths text[] := '{}';
begin
  if v_user_id is null then
    raise exception 'Usuário não autenticado' using errcode = 'P0001';
  end if;

  select * into v_contrato
  from public.freelancer_contratos
  where id = p_contrato_id
  for update;

  if not found then
    raise exception 'Contrato não encontrado' using errcode = 'P0002';
  end if;

  if not (
    public.is_tenant_admin(v_contrato.tenant_id)
    or public.is_tenant_rh(v_contrato.tenant_id)
    or public.is_tenant_financeiro(v_contrato.tenant_id)
    or v_contrato.responsavel_id = v_user_id
    or v_contrato.distrato_solicitado_por = v_user_id
  ) then
    raise exception 'Sem permissão pra cancelar distrato deste contrato'
      using errcode = 'P0003';
  end if;

  -- Devolve paths dos arquivos pra API apagar do bucket
  if v_contrato.distrato_minuta_url is not null then
    v_paths := array_append(v_paths, v_contrato.distrato_minuta_url);
  end if;
  if v_contrato.distrato_arquivo_url is not null then
    v_paths := array_append(v_paths, v_contrato.distrato_arquivo_url);
  end if;

  update public.freelancer_contratos
     set distrato_data_proposta = null,
         distrato_motivo = null,
         distrato_solicitado_por = null,
         distrato_solicitado_em = null,
         distrato_minuta_url = null,
         distrato_arquivo_url = null,
         updated_by = v_user_id,
         updated_at = now()
   where id = p_contrato_id;

  return v_paths;
end;
$$;

comment on function public.cancelar_distrato_contrato is
  'SECURITY DEFINER: permite GP (responsável do contrato OU quem solicitou o
   distrato) cancelar o pedido. Admin/RH/financeiro também podem. Devolve
   paths dos arquivos de distrato pra API deletar do bucket (best-effort).';

grant execute on function public.cancelar_distrato_contrato(uuid)
  to authenticated;

commit;
