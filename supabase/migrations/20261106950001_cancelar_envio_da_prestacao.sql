-- ===========================================================================
-- A produção cancela o envio da prestação de contas da verba (decisão 246)
-- Nasceu como 245: antes do push, a 245 já estava no main (prazo de envio
-- das PPs de 20/11). Os comentários dentro das funções e o `comment on`
-- abaixo foram aplicados com "245" e ficam como estão no banco; o comentário
-- da função foi corrigido em 20261106950002.
-- ===========================================================================
-- Pedido da produção em 06/11/2026: a prestação foi enviada ao financeiro
-- "sem querer" (a pessoa achava que ela ficava aberta) e não havia como
-- reabri-la — a prestação em avaliação só voltava para a produção se o
-- financeiro reprovasse. O Tiago aprovou, no protótipo interativo, as duas
-- formas de cancelar (ícone no cartão e na linha da aba PPs; botão dentro da
-- gaveta da prestação). As duas chamam a mesma função.
--
-- 1. `cancelar_envio_prestacao_verba(p_pp_id)`: só com a prestação EM
--    AVALIAÇÃO (o financeiro ainda não decidiu) e só para quem presta contas
--    desta verba — as mesmas portas do envio (`_verba_para_prestar`:
--    administrador, GP, produtor, o freela do job e o responsável da verba
--    anterior à 171). A linha da prestação fica travada (`for update`), então
--    o cancelamento e a aprovação/reprovação do financeiro não se cruzam: a
--    que chegar depois encontra o status novo e é recusada.
--    Só a verba de produção (a PP que foi sem NF na Mídia System, decisão
--    216, fica como está).
--
-- 2. A prestação volta para o estado de antes do envio:
--      primeiro envio ........ rascunho, com os mesmos documentos;
--      reenvio (já tinha sido
--      reprovada) ............ reprovada, com o motivo do financeiro à vista
--                              (o reenvio não apaga `reprovada_em` nem o
--                              motivo, então é ele que diz qual foi o caso);
--      "Não houve gasto" ..... os documentos saíram no envio; sem documento
--                              o rascunho some, como no
--                              `remover_documento_prestacao_verba`.
--    O que o financeiro já tinha corrigido nos documentos fica (a correção
--    grava no próprio documento). `valor_gasto` e `valor_devolvido` ficam
--    como estavam: o próximo envio os recalcula. Nada disso mexe no
--    realizado do item — só a prestação aprovada desconta o saldo.
--
-- 3. O histórico da PP ganha o evento `prestacao_envio_cancelado`
--    ("Envio da prestação cancelado"). A CHECK de `pedidos_compra_eventos`
--    é refeita com TODOS os valores que estão no banco hoje (lidos pelo MCP
--    em 06/11/2026, inclusive `nota_anexada` e `nota_conferida`) mais o
--    novo — mudança aditiva, não toca em linha nenhuma.
--
-- 4. O gatilho `prestacao_verba_registra_evento` registrava toda passagem
--    para "reprovada" como reprovação do financeiro. Agora a volta feita por
--    esta função (marcada na transação por `califa.envio_da_prestacao`)
--    vira "Envio da prestação cancelado", e o resto segue igual. A volta
--    para rascunho, que antes não gerava evento, também passa a gerar —
--    só esta função faz essa transição.
--
-- RLS: a tabela não muda; a função é SECURITY DEFINER e confere papel e
-- tenant como as outras da prestação. Execução só para `authenticated`.
-- ===========================================================================

alter table public.pedidos_compra_eventos
  drop constraint pedidos_compra_eventos_evento_check;
alter table public.pedidos_compra_eventos
  add constraint pedidos_compra_eventos_evento_check check (evento = any (array[
    'emitida', 'urgente', 'urgencia_retirada', 'fora_do_cadastro',
    'enviada', 'envio_desfeito', 'rejeitada', 'reenviada',
    'aprovada', 'aprovacao_desfeita', 'reprovada', 'paga',
    'baixa_desfeita', 'cancelada',
    'prestacao_enviada', 'prestacao_reenviada', 'prestacao_reprovada', 'prestacao_aprovada',
    'nf_corrigida', 'editada', 'emissora_trocada', 'nota_anexada', 'nota_conferida',
    -- Decisão 245.
    'prestacao_envio_cancelado'
  ]::text[]));

create or replace function public.prestacao_verba_registra_evento()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_evento text;
  v_por    uuid;
  v_em     timestamptz;
  v_motivo text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'rascunho' then
      return null;
    end if;
    v_evento := 'prestacao_enviada';
    v_por    := coalesce(new.fechada_por, v_uid);
    v_em     := coalesce(new.fechada_em, now());
  elsif old.status is distinct from new.status then
    -- Decisão 245: a produção cancelou o envio (rascunho ou reprovada).
    if old.status = 'em_avaliacao'
       and new.status in ('rascunho', 'reprovada')
       and coalesce(current_setting('califa.envio_da_prestacao', true), '') = 'cancelado' then
      v_evento := 'prestacao_envio_cancelado';
      v_por    := v_uid;
      v_em     := now();
    elsif new.status = 'em_avaliacao' then
      v_evento := case when old.status = 'rascunho' then 'prestacao_enviada' else 'prestacao_reenviada' end;
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
$function$;

create or replace function public.cancelar_envio_prestacao_verba(p_pp_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_pp    public.pedidos_compra%rowtype;
  v_prest public.pp_verba_prestacoes%rowtype;
  v_volta public.pp_verba_prestacao_status;
begin
  -- Papel, tenant, verba (e não reembolso) e a trava da PP.
  v_pp := public._verba_para_prestar(p_pp_id);
  if v_pp.verba_producao is not true then
    raise exception 'Só a prestação de contas da verba tem o envio cancelado pela produção.';
  end if;

  select * into v_prest
    from public.pp_verba_prestacoes
   where pedido_compra_id = p_pp_id
   for update;
  if not found or v_prest.status = 'rascunho' then
    raise exception 'A prestação desta verba ainda não foi enviada ao financeiro.';
  end if;
  if v_prest.status = 'aprovada' then
    raise exception 'O financeiro já aprovou esta prestação: o envio não se cancela mais.';
  end if;
  if v_prest.status = 'reprovada' then
    raise exception 'O financeiro reprovou esta prestação: ela já voltou para a produção.';
  end if;

  v_volta := case when v_prest.reprovada_em is not null then 'reprovada' else 'rascunho' end;

  -- "Não houve gasto" no primeiro envio: os documentos saíram no envio, e o
  -- rascunho sem documento não existe. O evento vai à mão, porque o gatilho
  -- não roda na exclusão.
  if v_volta = 'rascunho' and not exists (
    select 1 from public.pp_verba_prestacoes_anexos where prestacao_id = v_prest.id
  ) then
    insert into public.pedidos_compra_eventos
      (tenant_id, pedido_compra_id, evento, por, em)
    values (v_pp.tenant_id, v_pp.id, 'prestacao_envio_cancelado', v_uid, now());
    delete from public.pp_verba_prestacoes where id = v_prest.id;
    return 'sem_prestacao';
  end if;

  perform set_config('califa.envio_da_prestacao', 'cancelado', true);
  update public.pp_verba_prestacoes
     set status = v_volta
   where id = v_prest.id;
  perform set_config('califa.envio_da_prestacao', '', true);

  return v_volta::text;
end;
$function$;

comment on function public.cancelar_envio_prestacao_verba(uuid) is
  'Decisão 245: a produção cancela o envio da prestação em avaliação. Volta a rascunho (primeiro envio) ou a reprovada (reenvio), com os mesmos documentos; sem documento, o rascunho some. Devolve rascunho, reprovada ou sem_prestacao.';

revoke all on function public.cancelar_envio_prestacao_verba(uuid) from public, anon;
grant execute on function public.cancelar_envio_prestacao_verba(uuid) to authenticated;
