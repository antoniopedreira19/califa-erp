-- Decisão 136, parte 3 (01/10/2026): o histórico da PP passa a guardar
-- cada evento, com quem e quando.
--
-- Até aqui o "Histórico" do dossiê era montado das colunas da PP, uma por
-- tipo de evento. Dois furos:
--   - o reenvio da PP rejeitada apaga `rejeitada_por/em/motivo_rejeicao`, e
--     a rejeição sumia do histórico;
--   - o reenvio não tem coluna: a tela mostrava só o primeiro envio, e o
--     financeiro não sabia quem tinha mandado a PP de volta.
-- O mesmo vale para a reprovação de PP aprovada (apaga `aprovada_*`) e para
-- o reenvio da prestação de contas da verba (sobrescreve `fechada_*`).
--
-- `pedidos_compra_eventos` é só de leitura para a aplicação: quem escreve
-- são os gatilhos abaixo, nas mudanças de status da PP e da prestação, na
-- urgência e no pagamento fora do cadastro (quem pediu, que até aqui não
-- era gravado). `enviada_financeiro_em/por` continuam sendo o PRIMEIRO
-- envio — o chat das PPs conta o prazo a partir dele.
--
-- Preenchimento das PPs que já existem: das colunas da PP e, quando a
-- auditoria tem o evento daquela PP, da auditoria (que guarda rejeições e
-- reenvios que as colunas perderam). Muitos eventos da auditoria são de PPs
-- de teste já apagadas e ficam de fora. A baixa sem evento na auditoria só
-- tem a data (`pago_em` é date): vai com `so_data = true` e a tela mostra
-- só o dia.
--
-- Mudança aditiva: tabela nova, gatilhos novos, nada existente muda.

create table if not exists public.pedidos_compra_eventos (
  id               uuid primary key default gen_random_uuid(),
  seq              bigint generated always as identity,
  tenant_id        uuid not null references public.tenants(id) on delete restrict,
  pedido_compra_id uuid not null references public.pedidos_compra(id) on delete cascade,
  evento           text not null check (evento in (
                     'emitida', 'urgente', 'urgencia_retirada', 'fora_do_cadastro',
                     'enviada', 'envio_desfeito', 'rejeitada', 'reenviada',
                     'aprovada', 'aprovacao_desfeita', 'reprovada',
                     'paga', 'baixa_desfeita', 'cancelada',
                     'prestacao_enviada', 'prestacao_reenviada',
                     'prestacao_reprovada', 'prestacao_aprovada'
                   )),
  por              uuid references public.profiles(id),
  em               timestamptz not null default now(),
  so_data          boolean not null default false,
  motivo           text,
  created_at       timestamptz not null default now()
);

comment on table public.pedidos_compra_eventos is
  'Histórico da PP: um registro por evento (emissão, envio, rejeição, reenvio, aprovação, baixa, cancelamento, prestação de contas). Escrito só pelos gatilhos. Decisão 136.';
comment on column public.pedidos_compra_eventos.seq is
  'Desempate da ordem quando dois eventos têm o mesmo instante (emissão e urgência nascem juntas).';
comment on column public.pedidos_compra_eventos.so_data is
  'O evento veio de uma coluna de data, sem hora (baixa anterior ao histórico). A tela mostra só o dia.';
comment on column public.pedidos_compra_eventos.motivo is
  'Justificativa do evento, quando há: rejeição, reprovação, cancelamento, urgência, pagamento fora do cadastro, prestação reprovada.';

create index if not exists idx_pedidos_compra_eventos_pp
  on public.pedidos_compra_eventos (pedido_compra_id, em, seq);
create index if not exists idx_pedidos_compra_eventos_por
  on public.pedidos_compra_eventos (por);
create index if not exists idx_pedidos_compra_eventos_tenant
  on public.pedidos_compra_eventos (tenant_id);

alter table public.pedidos_compra_eventos enable row level security;

-- Quem vê a PP vê o histórico dela: o `exists` passa pela RLS da PP.
drop policy if exists pedidos_compra_eventos_select on public.pedidos_compra_eventos;
create policy pedidos_compra_eventos_select on public.pedidos_compra_eventos
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and exists (
      select 1 from public.pedidos_compra pc where pc.id = pedido_compra_id
    )
  );

revoke all on public.pedidos_compra_eventos from anon, authenticated;
grant select on public.pedidos_compra_eventos to authenticated;

-- Preenchimento -------------------------------------------------------------

with aud as (
  select pc.id as pp_id, pc.tenant_id, a.acao, a.created_at,
         pr.id as por, a.metadata->>'motivo' as motivo
    from public.audit_events a
    join public.pedidos_compra pc on pc.id::text = a.entidade_id
    left join public.profiles pr on pr.id = a.actor_user_id
   where a.entidade_tipo = 'pedido_compra'
)
insert into public.pedidos_compra_eventos
  (tenant_id, pedido_compra_id, evento, por, em, so_data, motivo)
-- Emissão: toda PP.
select pc.tenant_id, pc.id, 'emitida', pc.emitida_por, pc.created_at, false, null
  from public.pedidos_compra pc
union all
-- Urgência marcada.
select pc.tenant_id, pc.id, 'urgente', pc.urgente_por,
       coalesce(pc.urgente_em, pc.created_at), false, pc.urgente_justificativa
  from public.pedidos_compra pc
 where pc.urgente
union all
-- Envio: da auditoria; sem ela, da coluna (o primeiro envio).
select aud.tenant_id, aud.pp_id, 'enviada', aud.por, aud.created_at, false, null
  from aud where aud.acao = 'pedido_compra.enviada_financeiro'
union all
select pc.tenant_id, pc.id, 'enviada', pc.enviada_financeiro_por,
       pc.enviada_financeiro_em, false, null
  from public.pedidos_compra pc
 where pc.enviada_financeiro_em is not null
   and not exists (select 1 from aud where aud.pp_id = pc.id
                    and aud.acao = 'pedido_compra.enviada_financeiro')
union all
-- Eventos que só a auditoria guardou.
select aud.tenant_id, aud.pp_id,
       case aud.acao
         when 'pedido_compra.envio_desfeito' then 'envio_desfeito'
         when 'pedido_compra.reenviada'      then 'reenviada'
         when 'pedido_compra.desaprovada'    then 'aprovacao_desfeita'
         when 'pedido_compra.reprovada'      then 'reprovada'
         when 'pedido_compra.rejeitada'      then 'rejeitada'
       end,
       aud.por, aud.created_at, false,
       case when aud.acao in ('pedido_compra.reprovada', 'pedido_compra.rejeitada',
                              'pedido_compra.desaprovada')
            then aud.motivo end
  from aud
 where aud.acao in ('pedido_compra.envio_desfeito', 'pedido_compra.reenviada',
                    'pedido_compra.desaprovada', 'pedido_compra.reprovada',
                    'pedido_compra.rejeitada')
union all
-- Rejeição atual sem registro na auditoria.
select pc.tenant_id, pc.id, 'rejeitada', pc.rejeitada_por, pc.rejeitada_em,
       false, pc.motivo_rejeicao
  from public.pedidos_compra pc
 where pc.rejeitada_em is not null
   and not exists (select 1 from aud where aud.pp_id = pc.id
                    and aud.acao in ('pedido_compra.rejeitada', 'pedido_compra.reprovada'))
union all
-- Aprovação: da auditoria; sem ela, da coluna.
select aud.tenant_id, aud.pp_id, 'aprovada', aud.por, aud.created_at, false, null
  from aud where aud.acao = 'pedido_compra.aprovada'
union all
select pc.tenant_id, pc.id, 'aprovada', pc.aprovada_por, pc.aprovada_em, false, null
  from public.pedidos_compra pc
 where pc.aprovada_em is not null
   and not exists (select 1 from aud where aud.pp_id = pc.id
                    and aud.acao = 'pedido_compra.aprovada')
union all
-- Baixa: a hora da última baixa registrada na auditoria; sem ela, só o dia.
select pc.tenant_id, pc.id, 'paga', pc.pago_por,
       coalesce(ult.created_at, pc.pago_em::timestamp at time zone 'America/Sao_Paulo'),
       ult.created_at is null, null
  from public.pedidos_compra pc
  left join lateral (
    select max(aud.created_at) as created_at
      from aud
     where aud.pp_id = pc.id
       and aud.acao in ('pedido_compra.paga', 'pedido_compra.parcela_paga')
  ) ult on true
 where pc.status = 'pago' and pc.pago_em is not null
union all
-- Cancelamento.
select pc.tenant_id, pc.id, 'cancelada', pc.cancelada_por,
       coalesce(pc.cancelada_em, pc.updated_at), false, pc.motivo_cancelamento
  from public.pedidos_compra pc
 where pc.status = 'cancelada'
union all
-- Prestação de contas da verba: só o estado atual existe.
select pv.tenant_id, pv.pedido_compra_id,
       case when pv.reprovada_em is not null and pv.fechada_em > pv.reprovada_em
            then 'prestacao_reenviada' else 'prestacao_enviada' end,
       pv.fechada_por, pv.fechada_em, false, null
  from public.pp_verba_prestacoes pv
union all
select pv.tenant_id, pv.pedido_compra_id, 'prestacao_reprovada', pv.reprovada_por,
       pv.reprovada_em, false, pv.motivo_reprovacao
  from public.pp_verba_prestacoes pv
 where pv.reprovada_em is not null
union all
select pv.tenant_id, pv.pedido_compra_id, 'prestacao_aprovada', pv.aprovada_por,
       pv.aprovada_em, false, null
  from public.pp_verba_prestacoes pv
 where pv.aprovada_em is not null;

-- Gatilho da PP ----------------------------------------------------------------

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

  return null;
end;
$$;

comment on function public.pp_registra_evento() is
  'Grava em pedidos_compra_eventos os eventos da PP: emissão, urgência, pagamento fora do cadastro e mudanças de status. Decisão 136.';

drop trigger if exists trg_pp_registra_evento on public.pedidos_compra;
create trigger trg_pp_registra_evento
  after insert or update of status, urgente,
    pagamento_fora_do_cadastro_meio, pagamento_fora_do_cadastro_motivo
  on public.pedidos_compra
  for each row execute function public.pp_registra_evento();

-- Gatilho da prestação de contas ------------------------------------------------

create or replace function public.prestacao_verba_registra_evento()
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
    v_evento := 'prestacao_enviada';
    v_por    := coalesce(new.fechada_por, v_uid);
    v_em     := coalesce(new.fechada_em, now());
  elsif old.status is distinct from new.status then
    if new.status = 'em_avaliacao' then
      v_evento := 'prestacao_reenviada';
      v_por    := coalesce(new.fechada_por, v_uid);
      v_em     := coalesce(new.fechada_em, now());
    elsif new.status = 'reprovada' then
      v_evento := 'prestacao_reprovada';
      v_por    := coalesce(new.reprovada_por, v_uid);
      v_em     := coalesce(new.reprovada_em, now());
      v_motivo := new.motivo_reprovacao;
    elsif new.status = 'aprovada' then
      v_evento := 'prestacao_aprovada';
      v_por    := coalesce(new.aprovada_por, v_uid);
      v_em     := coalesce(new.aprovada_em, now());
    end if;
  end if;

  if v_evento is not null then
    insert into public.pedidos_compra_eventos
      (tenant_id, pedido_compra_id, evento, por, em, motivo)
    values (new.tenant_id, new.pedido_compra_id, v_evento, v_por, v_em, v_motivo);
  end if;

  return null;
end;
$$;

comment on function public.prestacao_verba_registra_evento() is
  'Grava em pedidos_compra_eventos o envio, o reenvio, a reprovação e a aprovação da prestação de contas da verba. Decisão 136.';

drop trigger if exists trg_prestacao_verba_registra_evento on public.pp_verba_prestacoes;
create trigger trg_prestacao_verba_registra_evento
  after insert or update of status on public.pp_verba_prestacoes
  for each row execute function public.prestacao_verba_registra_evento();

-- Funções de gatilho não são chamadas pela API.
revoke all on function public.pp_registra_evento() from public, anon, authenticated;
revoke all on function public.prestacao_verba_registra_evento() from public, anon, authenticated;
