-- =============================================================================
-- Decisão 173 — a PP gerada volta a se editar, no lugar (13/10/2026)
-- =============================================================================
--
-- Por quê: a decisão 153 (07/10/2026) congelou a PP na geração — para mudar
-- uma PP gerada, só cancelando e gerando outra. Em 13/10/2026 duas produtoras
-- travaram nisso em quatro dias (anexar a NF de uma PP já gerada; mudar o
-- parcelamento), e o Tiago decidiu: a PP que ainda está no job (status
-- "gerada") se edita inteira, no lugar — mesmo código, PDF refeito, a revisão
-- antes de gravar —, e a marca "Pronta para envio" cai, porque os documentos
-- precisam ser conferidos de novo. Enviada ao financeiro, nada muda.
--
-- O que muda no banco:
--   1. Duas colunas na PP: quando e quem editou por último. Gravadas pelo
--      gatilho com o usuário da sessão, não pelo que a tela mandar, e só na
--      PP gerada. Não se apagam: a edição seguinte troca as duas.
--   2. O evento "editada" na linha do tempo da PP (`pedidos_compra_eventos`,
--      escrito só por gatilho desde a decisão 136): uma linha a cada edição.
--
-- Aditiva: colunas novas, nulas, sem backfill; um valor novo na lista de
-- eventos; o gatilho de eventos ganha um ramo e uma coluna na lista do
-- UPDATE OF. Os grants são da tabela (authenticated lê e escreve; anon não
-- tem nada) e a RLS de pedidos_compra vale para as colunas novas. Sem índice
-- no autor: nenhuma tela filtra por ele, como os outros "*_por" da PP.
-- =============================================================================

alter table public.pedidos_compra
  add column if not exists editada_em timestamptz,
  add column if not exists editada_por uuid references public.profiles(id);

comment on column public.pedidos_compra.editada_em is
  'Decisão 173: quando a PP gerada foi editada pela última vez (formulário, antes do envio ao financeiro). Gravado pelo gatilho trg_pp_carimba_edicao.';
comment on column public.pedidos_compra.editada_por is
  'Decisão 173: quem editou a PP gerada pela última vez. Gravado pelo gatilho com o usuário da sessão.';

-- -----------------------------------------------------------------------------
-- 1. O carimbo da edição: só na PP gerada, quem e quando pela sessão.
-- -----------------------------------------------------------------------------
create or replace function public.pp_carimba_edicao()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Só reage quando a marca muda.
  if new.editada_em is not distinct from old.editada_em
     and new.editada_por is not distinct from old.editada_por then
    return new;
  end if;

  if old.status <> 'gerada' then
    raise exception 'Só a PP gerada, ainda no job, se edita.';
  end if;

  -- A marca não se apaga: quem editou fica registrado.
  if new.editada_em is null then
    new.editada_em := old.editada_em;
    new.editada_por := old.editada_por;
    return new;
  end if;

  -- Quem e quando: a sessão, não o que veio da tela.
  if auth.uid() is not null then
    new.editada_por := auth.uid();
    new.editada_em := now();
  end if;
  return new;
end;
$$;

comment on function public.pp_carimba_edicao() is
  'Decisão 173: aceita a marca de edição só na PP gerada e grava quem/quando pela sessão.';

drop trigger if exists trg_pp_carimba_edicao on public.pedidos_compra;
create trigger trg_pp_carimba_edicao
  before update of editada_em, editada_por on public.pedidos_compra
  for each row execute function public.pp_carimba_edicao();

-- -----------------------------------------------------------------------------
-- 2. O evento "editada" na linha do tempo da PP.
-- -----------------------------------------------------------------------------
alter table public.pedidos_compra_eventos
  drop constraint if exists pedidos_compra_eventos_evento_check;
alter table public.pedidos_compra_eventos
  add constraint pedidos_compra_eventos_evento_check check (evento = any (array[
    'emitida', 'urgente', 'urgencia_retirada', 'fora_do_cadastro', 'enviada',
    'envio_desfeito', 'rejeitada', 'reenviada', 'aprovada', 'aprovacao_desfeita',
    'reprovada', 'paga', 'baixa_desfeita', 'cancelada', 'prestacao_enviada',
    'prestacao_reenviada', 'prestacao_reprovada', 'prestacao_aprovada',
    'nf_corrigida', 'editada'
  ]));

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

drop trigger if exists trg_pp_registra_evento on public.pedidos_compra;
create trigger trg_pp_registra_evento
  after insert or update of status, urgente, pagamento_fora_do_cadastro_meio,
    pagamento_fora_do_cadastro_motivo, editada_em
  on public.pedidos_compra
  for each row execute function public.pp_registra_evento();
