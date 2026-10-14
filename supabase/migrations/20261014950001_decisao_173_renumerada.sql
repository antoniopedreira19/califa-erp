-- =============================================================================
-- Decisão 173 — só a numeração: os comentários do banco diziam "Decisão 170"
-- (14/10/2026)
-- =============================================================================
--
-- A migration 20261013950001 (a PP gerada volta a se editar) nasceu como
-- decisão 170 e foi aplicada assim. Antes do push, o main já tinha outra 170
-- (GP só quem pode ser GP), e a 171 e a 172 estavam reservadas: a edição da
-- PP gerada virou a 173. O arquivo da 20261013950001 já diz 173; aqui o banco
-- passa a dizer o mesmo — os comentários das duas colunas, o da função do
-- carimbo e a linha de comentário dentro de `pp_registra_evento` (o corpo é
-- o mesmo de antes, palavra por palavra fora do comentário).
--
-- Sem mudança de comportamento, de grant ou de RLS. O gatilho
-- `trg_pp_registra_evento` não é recriado: `create or replace function`
-- mantém a ligação.
-- =============================================================================

comment on column public.pedidos_compra.editada_em is
  'Decisão 173: quando a PP gerada foi editada pela última vez (formulário, antes do envio ao financeiro). Gravado pelo gatilho trg_pp_carimba_edicao.';
comment on column public.pedidos_compra.editada_por is
  'Decisão 173: quem editou a PP gerada pela última vez. Gravado pelo gatilho com o usuário da sessão.';
comment on function public.pp_carimba_edicao() is
  'Decisão 173: aceita a marca de edição só na PP gerada e grava quem/quando pela sessão.';

-- O corpo é o de antes (decisões 127 e 136), com o ramo da edição no fim.
create or replace function public.pp_registra_evento()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_evento text;
  v_por    uuid;
  v_em     timestamptz;
  v_motivo text;
begin
  if tg_op = 'INSERT' then
    insert into public.pedidos_compra_eventos (tenant_id, pedido_compra_id, evento, por, em)
    values (new.tenant_id, new.id, 'emitida', coalesce(new.emitida_por, v_uid),
            coalesce(new.created_at, now()));
    -- PP que já nasce enviada (fluxo anterior a 02/09/2026).
    if new.status = 'em_avaliacao' then
      insert into public.pedidos_compra_eventos (tenant_id, pedido_compra_id, evento, por, em)
      values (new.tenant_id, new.id, 'enviada',
              coalesce(new.enviada_financeiro_por, new.emitida_por, v_uid),
              coalesce(new.enviada_financeiro_em, new.created_at, now()));
    end if;
  end if;

  -- Urgência.
  if new.urgente is true and (tg_op = 'INSERT' or old.urgente is not true) then
    insert into public.pedidos_compra_eventos
      (tenant_id, pedido_compra_id, evento, por, em, motivo)
    values (new.tenant_id, new.id, 'urgente', coalesce(new.urgente_por, v_uid),
            coalesce(new.urgente_em, now()), new.urgente_justificativa);
  elsif tg_op = 'UPDATE' and old.urgente is true and new.urgente is not true then
    insert into public.pedidos_compra_eventos (tenant_id, pedido_compra_id, evento, por, em)
    values (new.tenant_id, new.id, 'urgencia_retirada', v_uid, now());
  end if;

  -- Pagamento fora do cadastro: quem pediu (decisão 127).
  if new.pagamento_fora_do_cadastro_meio is not null and (
       tg_op = 'INSERT'
       or old.pagamento_fora_do_cadastro_meio is distinct from new.pagamento_fora_do_cadastro_meio
       or old.pagamento_fora_do_cadastro_motivo is distinct from new.pagamento_fora_do_cadastro_motivo
     ) then
    insert into public.pedidos_compra_eventos
      (tenant_id, pedido_compra_id, evento, por, em, motivo)
    values (new.tenant_id, new.id, 'fora_do_cadastro',
            coalesce(v_uid, new.emitida_por), now(), new.pagamento_fora_do_cadastro_motivo);
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    v_por := v_uid;
    v_em  := now();
    if old.status = 'gerada' and new.status = 'em_avaliacao' then
      v_evento := 'enviada';
      v_por    := coalesce(new.enviada_financeiro_por, v_uid);
      v_em     := coalesce(new.enviada_financeiro_em, now());
    elsif old.status = 'rejeitada' and new.status = 'em_avaliacao' then
      v_evento := 'reenviada';
    elsif old.status = 'em_avaliacao' and new.status = 'gerada' then
      v_evento := 'envio_desfeito';
    elsif old.status = 'aprovada' and new.status = 'em_avaliacao' then
      v_evento := 'aprovacao_desfeita';
    elsif new.status = 'rejeitada' then
      v_evento := case when old.status = 'aprovada' then 'reprovada' else 'rejeitada' end;
      v_por    := coalesce(new.rejeitada_por, v_uid);
      v_em     := coalesce(new.rejeitada_em, now());
      v_motivo := new.motivo_rejeicao;
    elsif new.status = 'aprovada' and old.status = 'pago' then
      v_evento := 'baixa_desfeita';
    elsif new.status = 'aprovada' then
      v_evento := 'aprovada';
      v_por    := coalesce(new.aprovada_por, v_uid);
      v_em     := coalesce(new.aprovada_em, now());
    elsif new.status = 'pago' then
      v_evento := 'paga';
      v_por    := coalesce(v_uid, new.pago_por);
    elsif new.status = 'cancelada' then
      v_evento := 'cancelada';
      v_por    := coalesce(new.cancelada_por, v_uid);
      v_em     := coalesce(new.cancelada_em, now());
      v_motivo := new.motivo_cancelamento;
    end if;

    if v_evento is not null then
      insert into public.pedidos_compra_eventos
        (tenant_id, pedido_compra_id, evento, por, em, motivo)
      values (new.tenant_id, new.id, v_evento, v_por, v_em, v_motivo);
    end if;
  end if;

  -- Decisão 173: cada edição da PP gerada vira um passo da linha do tempo.
  if tg_op = 'UPDATE'
     and new.editada_em is not null
     and new.editada_em is distinct from old.editada_em then
    insert into public.pedidos_compra_eventos (tenant_id, pedido_compra_id, evento, por, em)
    values (new.tenant_id, new.id, 'editada', coalesce(new.editada_por, v_uid), new.editada_em);
  end if;

  return null;
end;
$$;
