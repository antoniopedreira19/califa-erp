-- =====================================================================
-- Decisão 128 (Tiago, 29/09/2026): no job devolvido pelo financeiro, o
-- "Cancelar aprovação" cancela o job, mas o código dele volta no próximo
-- envio do mesmo orçamento.
--
-- Até aqui o job cancelado queimava o código (decisão 114: "número não
-- volta a ser usado"). Na devolução por erro do orçamento, o GP cancelava,
-- corrigia, aprovava e reenviava — e o mesmo trabalho voltava ao
-- financeiro com outro código.
--
-- 1) `jobs.codigo_reservado`: marca o job cancelado pelo "Cancelar
--    aprovação" da devolução. Enquanto marcado, o código continua NELE —
--    é o que impede o gerador (maior número da sigla + 1) de entregá-lo a
--    outro job no meio do caminho: o AMB-1012/26, devolvido em 28/09, era
--    o maior número da AMBEV.
-- 2) `reaproveitar_codigo_do_job_devolvido`: chamada pelo envio LOGO
--    DEPOIS de criar o job novo (que nasce com um código novo, válido). Numa
--    transação só, o cancelado ganha o sufixo "-C1", "-C2"... e o novo fica
--    com o código antigo. Se falhar, o job novo segue com o código que
--    nasceu, e nada fica pela metade. O sufixo não casa com o padrão
--    `SIGLA-NNNN/AA` do gerador, e o job cancelado antes da abertura não
--    aparece em lista nenhuma (decisão 113).
--
--    Só vale para a mesma sigla: se o cliente do projeto mudou depois do
--    cancelamento (decisão 122 permite, sem aprovação), o código antigo
--    não serve, e o job novo fica com o dele.
--
--    `security invoker`: vale a RLS de quem envia o job para abertura.
--
-- Aditiva: coluna nova com default, índice parcial e função nova. Nenhum
-- dado existente muda.
-- =====================================================================

alter table public.jobs
  add column if not exists codigo_reservado boolean not null default false;

comment on column public.jobs.codigo_reservado is
  'Decisão 128: job cancelado pelo "Cancelar aprovação" da devolução do financeiro. O código fica reservado para o próximo envio do mesmo orçamento, que o reaproveita (reaproveitar_codigo_do_job_devolvido).';

create index if not exists idx_jobs_codigo_reservado
  on public.jobs (orcamento_id)
  where codigo_reservado;

create or replace function public.reaproveitar_codigo_do_job_devolvido(
  p_job_novo uuid,
  p_job_reservado uuid
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_novo     record;
  v_reserva  record;
  v_qtd      integer;
  v_sufixado text;
begin
  select id, tenant_id, orcamento_id, status, codigo
    into v_novo
    from public.jobs
   where id = p_job_novo
   for update;

  select id, tenant_id, orcamento_id, status, codigo, codigo_reservado
    into v_reserva
    from public.jobs
   where id = p_job_reservado
   for update;

  if v_novo.id is null or v_reserva.id is null then
    raise exception 'Job não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_reserva.tenant_id <> v_novo.tenant_id
     or v_reserva.orcamento_id <> v_novo.orcamento_id then
    raise exception 'O código reservado é de outro orçamento.'
      using errcode = 'check_violation';
  end if;
  if v_reserva.status <> 'cancelado' or not v_reserva.codigo_reservado then
    raise exception 'O código do job cancelado não está reservado.'
      using errcode = 'check_violation';
  end if;
  if v_novo.status <> 'aguardando_abertura' then
    raise exception 'O código só se reaproveita no envio para abertura.'
      using errcode = 'check_violation';
  end if;
  -- A sigla é tudo antes do primeiro hífen ("AMB" em "AMB-1012/26").
  if split_part(v_reserva.codigo, '-', 1) <> split_part(v_novo.codigo, '-', 1) then
    raise exception 'O cliente do projeto mudou: o código reservado não vale mais.'
      using errcode = 'check_violation';
  end if;

  select count(*)
    into v_qtd
    from public.jobs
   where tenant_id = v_reserva.tenant_id
     and codigo like v_reserva.codigo || '-C%';
  v_sufixado := v_reserva.codigo || '-C' || (v_qtd + 1);

  -- Nessa ordem: o índice único (tenant_id, codigo) confere linha a linha.
  update public.jobs
     set codigo = v_sufixado,
         codigo_reservado = false
   where id = v_reserva.id;

  update public.jobs
     set codigo = v_reserva.codigo
   where id = v_novo.id;

  return v_reserva.codigo;
end;
$$;

comment on function public.reaproveitar_codigo_do_job_devolvido(uuid, uuid) is
  'Decisão 128: o job novo fica com o código do job cancelado na devolução; o cancelado ganha o sufixo -C1, -C2... Mesma sigla, mesmo orçamento.';

revoke all on function public.reaproveitar_codigo_do_job_devolvido(uuid, uuid) from public, anon;
grant execute on function public.reaproveitar_codigo_do_job_devolvido(uuid, uuid) to authenticated;
