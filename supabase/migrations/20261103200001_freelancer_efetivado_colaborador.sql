-- Efetivação de freelancer como colaborador CLT (ou PJ/estágio).
--
-- Contexto: hoje o único caminho pra encerrar um contrato de freela antes
-- da data é o fluxo de distrato (solicitar → gerar minuta → anexar PDF
-- assinado). Quando o freela é efetivado (vira CLT/PJ/estágio), não existe
-- distrato real pra assinar — mas o contrato precisa ser encerrado e a
-- pessoa precisa aparecer em /rh/colaboradores.
--
-- Esta migration adiciona:
--   1. Coluna `efetivado_colaborador_id` em freelancer_contratos (FK → colaboradores)
--      — rastreia qual colaborador surgiu desse contrato efetivado.
--   2. RPC `efetivar_contrato_freelancer(p_contrato_id, p_data_efetivacao, p_colaborador_id)`
--      que, numa transação:
--        - Preserva data_termino_original (snapshot)
--        - Seta data_termino = data_efetivacao
--        - Marca status_real = false
--        - Zera campos de distrato pendente (minuta/motivo/data_proposta/etc)
--        - Grava efetivado_colaborador_id
--
-- SECURITY INVOKER — respeita RLS. GRANT para authenticated.

alter table public.freelancer_contratos
  add column if not exists efetivado_colaborador_id uuid
    references public.colaboradores(id) on delete set null;

create index if not exists idx_freelancer_contratos_efetivado_colab
  on public.freelancer_contratos (efetivado_colaborador_id)
  where efetivado_colaborador_id is not null;

create or replace function public.efetivar_contrato_freelancer(
  p_contrato_id uuid,
  p_data_efetivacao date,
  p_colaborador_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_contrato public.freelancer_contratos%rowtype;
begin
  if p_data_efetivacao is null then
    raise exception 'Data de efetivação é obrigatória' using errcode = 'P0001';
  end if;
  if p_colaborador_id is null then
    raise exception 'colaborador_id é obrigatório' using errcode = 'P0002';
  end if;

  select * into v_contrato
  from public.freelancer_contratos
  where id = p_contrato_id
  for update;

  if not found then
    raise exception 'Contrato de freelancer não encontrado' using errcode = 'P0003';
  end if;

  if v_contrato.status_real = false then
    raise exception 'Contrato já está encerrado' using errcode = 'P0004';
  end if;

  update public.freelancer_contratos set
    data_termino_original = coalesce(data_termino_original, data_termino),
    data_termino = p_data_efetivacao,
    status_real = false,
    distrato_minuta_url = null,
    distrato_arquivo_url = null,
    distrato_data_proposta = null,
    distrato_motivo = null,
    distrato_solicitado_em = null,
    distrato_solicitado_por = null,
    efetivado_colaborador_id = p_colaborador_id,
    updated_at = now()
  where id = p_contrato_id;
end;
$$;

revoke all on function public.efetivar_contrato_freelancer(uuid, date, uuid) from public, anon;
grant execute on function public.efetivar_contrato_freelancer(uuid, date, uuid) to authenticated;
