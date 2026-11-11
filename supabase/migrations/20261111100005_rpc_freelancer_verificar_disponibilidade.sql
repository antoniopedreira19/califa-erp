-- RPC: verifica se um freela está disponível pra nova solicitação no
-- período pedido, bypassando a RLS de freelancer_contratos e
-- freelancer_solicitacoes.
--
-- Contexto: a função TS verificarFreelaDisponivel em
-- freelancers/solicitacoes/actions.ts lê direto de freelancer_contratos
-- e freelancer_solicitacoes pra detectar sobreposição de período. A RLS
-- dessas tabelas limita o GP a (admin/rh/financeiro OR responsavel_id =
-- auth.uid()). Quando um GP solicita renovação pra um freela cujo
-- contrato ativo é de outro GP, o SELECT retorna vazio, a função
-- retorna { ok: true } e o server deixa o insert passar — sobreposição
-- real fica invisível.
--
-- A UI (HistoricoContratosFreela via RPC get_historico_contratos_freela
-- SECURITY DEFINER) já trava corretamente: lista todos os contratos e
-- desabilita Prosseguir se detectar ativo. Esta migration fecha o
-- buraco de defense-in-depth: POST direto no endpoint (burlando o form)
-- também vai bater na trava.
--
-- Retorno: TABLE(bloqueado boolean, motivo text). motivo preenchido só
-- quando bloqueado=true. Lógica fiel à original em TS:
--   - Contratos com status_real=true, overlap pelas datas (período
--     aberto vira ±∞)
--   - Solicitações em (pendente,aprovada,cadastrada,finalizada); se
--     finalizada sem contrato_id, ignora (contrato já encerrado)

create or replace function public.freelancer_verificar_disponibilidade(
  p_tenant_id uuid,
  p_freelancer_id uuid,
  p_data_inicio date,
  p_data_termino date
)
returns table(bloqueado boolean, motivo text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_novo_inicio date := coalesce(p_data_inicio, '0001-01-01'::date);
  v_novo_fim date := coalesce(p_data_termino, '9999-12-31'::date);
  v_c record;
  v_s record;
  v_periodo text;
begin
  if not public.is_tenant_member(p_tenant_id) then
    bloqueado := true;
    motivo := 'Sem permissão.';
    return next;
    return;
  end if;

  for v_c in
    select fc.nome_job, fc.data_inicio, fc.data_termino
    from public.freelancer_contratos fc
    where fc.tenant_id = p_tenant_id
      and fc.freelancer_id = p_freelancer_id
      and fc.status_real = true
  loop
    if v_novo_inicio <= coalesce(v_c.data_termino, '9999-12-31'::date)
       and coalesce(v_c.data_inicio, '0001-01-01'::date) <= v_novo_fim then
      v_periodo := case
        when v_c.data_inicio is not null and v_c.data_termino is not null then
          format(' (%s → %s)',
            to_char(v_c.data_inicio, 'DD/MM/YYYY'),
            to_char(v_c.data_termino, 'DD/MM/YYYY'))
        when v_c.data_inicio is not null then
          format(' (desde %s)', to_char(v_c.data_inicio, 'DD/MM/YYYY'))
        else ''
      end;
      bloqueado := true;
      motivo := format(
        'Este freela tem contrato em "%s"%s que se sobrepõe ao período pedido. Finalize/encerre antes de criar nova solicitação.',
        coalesce(v_c.nome_job, '—'),
        v_periodo
      );
      return next;
      return;
    end if;
  end loop;

  for v_s in
    select fs.status::text as status, fs.nome_job, fs.data_inicio,
           fs.data_termino, fs.contrato_id
    from public.freelancer_solicitacoes fs
    where fs.tenant_id = p_tenant_id
      and fs.freelancer_id = p_freelancer_id
      and fs.status in ('pendente', 'aprovada', 'cadastrada', 'finalizada')
  loop
    if v_s.status = 'finalizada' and v_s.contrato_id is null then
      continue;
    end if;
    if v_novo_inicio <= coalesce(v_s.data_termino, '9999-12-31'::date)
       and coalesce(v_s.data_inicio, '0001-01-01'::date) <= v_novo_fim then
      v_periodo := case
        when v_s.data_inicio is not null and v_s.data_termino is not null then
          format(' (%s → %s)',
            to_char(v_s.data_inicio, 'DD/MM/YYYY'),
            to_char(v_s.data_termino, 'DD/MM/YYYY'))
        else ''
      end;
      bloqueado := true;
      motivo := format(
        'Este freela já tem solicitação em "%s"%s, status %s. O período pedido se sobrepõe. Finalize/cancele antes de criar outra.',
        coalesce(v_s.nome_job, '—'),
        v_periodo,
        v_s.status
      );
      return next;
      return;
    end if;
  end loop;

  bloqueado := false;
  motivo := null;
  return next;
end;
$$;

revoke all on function public.freelancer_verificar_disponibilidade(uuid, uuid, date, date)
  from public, anon;
grant execute on function public.freelancer_verificar_disponibilidade(uuid, uuid, date, date)
  to authenticated;
