-- Task 025 — Freelancers (Fase 4, Task 2): RPC pra aplicar distrato
--
-- Chamada pelo endpoint enviar-assinado do distrato depois de salvar o PDF
-- no bucket. Faz numa transação:
--   1. Preserva data_termino_original (snapshot) se ainda não existe.
--   2. Atualiza data_termino = distrato_data_proposta.
--   3. Marca status_real = false.
--
-- SECURITY INVOKER — respeita RLS do caller. Grant pra authenticated.

create or replace function public.aplicar_distrato_de_contrato(
  p_contrato_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_contrato public.freelancer_contratos%rowtype;
begin
  select * into v_contrato
  from public.freelancer_contratos
  where id = p_contrato_id
  for update;

  if not found then
    raise exception 'Contrato não encontrado' using errcode = 'P0001';
  end if;

  if v_contrato.distrato_data_proposta is null then
    raise exception 'Distrato não tem data proposta' using errcode = 'P0002';
  end if;

  if v_contrato.distrato_arquivo_url is null then
    raise exception 'Distrato precisa ter arquivo assinado antes de aplicar'
      using errcode = 'P0003';
  end if;

  update public.freelancer_contratos set
    data_termino_original = coalesce(data_termino_original, data_termino),
    data_termino = distrato_data_proposta,
    status_real = false,
    updated_at = now()
  where id = p_contrato_id;
end;
$$;

revoke all on function public.aplicar_distrato_de_contrato(uuid) from public, anon;
grant execute on function public.aplicar_distrato_de_contrato(uuid) to authenticated;
