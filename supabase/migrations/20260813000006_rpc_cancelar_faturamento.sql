-- =====================================================================
-- RPC transacional pra cancelar NF emitida.
-- Bloqueia se qualquer titulo ja foi baixado (obriga estornar antes).
-- Ver spec: docs/superpowers/specs/2026-08-13-contas-a-receber-faturamento-design.md
-- =====================================================================

create or replace function public.cancelar_faturamento(
  p_faturamento_id uuid,
  p_motivo         text,
  p_cancelado_por  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fat           faturamentos%rowtype;
  v_qtd_pagos     integer;
begin
  if p_motivo is null or length(trim(p_motivo)) < 10 then
    raise exception 'Motivo precisa ter pelo menos 10 caracteres.';
  end if;

  select * into v_fat from public.faturamentos where id = p_faturamento_id;
  if not found then raise exception 'Faturamento não encontrado.'; end if;
  if not public.is_tenant_member(v_fat.tenant_id) then
    raise exception 'Sem acesso a este faturamento.';
  end if;
  if v_fat.status <> 'emitido' then
    raise exception 'Faturamento já está cancelado.';
  end if;

  -- Bloqueia se algum titulo ja foi pago
  select count(*) into v_qtd_pagos
    from public.titulos_receber
   where faturamento_id = p_faturamento_id
     and status = 'pago';

  if v_qtd_pagos > 0 then
    raise exception 'Existem % títulos já baixados. Estorne as baixas antes de cancelar a NF.', v_qtd_pagos;
  end if;

  -- Cancela titulos em aberto
  update public.titulos_receber
     set status = 'cancelado',
         cancelado_em = now(),
         cancelado_por = p_cancelado_por
   where faturamento_id = p_faturamento_id
     and status = 'em_aberto';

  -- Cancela o faturamento
  update public.faturamentos
     set status = 'cancelado',
         cancelado_em = now(),
         cancelado_por = p_cancelado_por,
         motivo_cancelamento = p_motivo
   where id = p_faturamento_id;

  -- Se origem='bv', volta BV pra 'confirmado' (fica na fila de novo)
  if v_fat.origem_tipo = 'bv' then
    update public.itens_bv
       set situacao = 'confirmado'
     where id = v_fat.origem_id
       and situacao in ('recebido', 'confirmado'); -- confirmado é no-op mas explícito
  end if;

  -- Se origem='job': nada a fazer aqui — a fila derivada recalcula sozinha
  --   (saldo = previsto - sum(faturamentos ativos))
end;
$$;

grant execute on function public.cancelar_faturamento(uuid, text, uuid) to authenticated;
