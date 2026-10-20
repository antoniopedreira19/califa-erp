-- RPC pro dialog "Revisar histórico" quando um freela já existe no sistema.
--
-- Chamada quando o GP digita um CPF já cadastrado (ou vem pelo picker). O
-- dialog precisa listar TODOS os contratos anteriores do freela — mas a RLS
-- de freelancer_contratos limita GP/produtor aos próprios registros, então
-- a função usa SECURITY DEFINER pra passar essa barreira.
--
-- Sanitização: NÃO retorna `valor`, `observacoes`, `cidade`, nem campos de
-- distrato. Só o que a tela precisa pra decidir "pode seguir com nova
-- solicitação ou já tem contrato ativo que bloqueia".
--
-- Multi-tenant seguro: função só retorna contratos cujo tenant_id bate com um
-- tenant do qual o caller é membro.

begin;

create or replace function public.get_historico_contratos_freela(
  p_freelancer_id uuid
)
returns table (
  id              uuid,
  nome_job        text,
  cargo           text,
  data_inicio     date,
  data_termino    date,
  status_real     boolean,
  arquivo_url     text,
  minuta_url      text,
  responsavel_id  uuid,
  responsavel_nome text,
  created_at      timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.nome_job,
    c.cargo,
    c.data_inicio,
    c.data_termino,
    c.status_real,
    c.arquivo_url,
    c.minuta_url,
    c.responsavel_id,
    p.nome as responsavel_nome,
    c.created_at
  from public.freelancer_contratos c
  left join public.profiles p on p.id = c.responsavel_id
  where c.freelancer_id = p_freelancer_id
    and is_tenant_member(c.tenant_id)
  order by
    c.data_inicio desc nulls last,
    c.created_at desc;
$$;

revoke all on function public.get_historico_contratos_freela(uuid) from public, anon;
grant execute on function public.get_historico_contratos_freela(uuid) to authenticated;

commit;
