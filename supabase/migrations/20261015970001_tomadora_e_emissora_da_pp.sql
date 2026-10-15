-- Revisão da decisão 156 (14 a 16/10/2026) — a tomadora é a emissora.
--
-- POR QUE
-- A empresa emissora da PP (`pedidos_compra.estabelecimento_id`) é quem
-- paga: o CNPJ que está no documento do fornecedor (nota, fatura ou recibo)
-- lança a despesa, retém imposto e deve pagar. A relação por regional
-- (decisão 156, item 3) continua só como pré-seleção na geração. A PP
-- passou a ser documento interno, por enquanto (Tiago, 16/10/2026).
-- Ao anexar um documento com outro CNPJ, a empresa emissora segue o
-- documento sozinha (o código faz a troca e refaz o PDF).
--
-- O QUE ESTA MIGRATION FAZ
--   1. `pedidos_compra_eventos` aceita o evento `emissora_trocada`.
--   2. A troca nas 15 PPs antigas cujo documento está em outro CNPJ —
--      confirmada pelo Tiago em 16/10/2026, depois de ver a lista. Muda só
--      a empresa emissora; os PDFs já gerados ficam. Cada troca só vale se
--      a PP ainda estiver com a empresa de antes (nada que mudou desde o
--      levantamento é sobrescrito) e a migration inteira desfaz se não
--      forem exatamente 15.
--   3. O gatilho `trg_pp_registra_troca_de_emissora`: toda troca da empresa
--      emissora vira um passo da linha do tempo da PP, com "de X para Y" e,
--      quando é o caso, o documento que a definiu.

-- 1. O evento novo ------------------------------------------------------------
alter table public.pedidos_compra_eventos
  drop constraint pedidos_compra_eventos_evento_check;
alter table public.pedidos_compra_eventos
  add constraint pedidos_compra_eventos_evento_check check (evento = any (array[
    'emitida', 'urgente', 'urgencia_retirada', 'fora_do_cadastro', 'enviada',
    'envio_desfeito', 'rejeitada', 'reenviada', 'aprovada', 'aprovacao_desfeita',
    'reprovada', 'paga', 'baixa_desfeita', 'cancelada', 'prestacao_enviada',
    'prestacao_reenviada', 'prestacao_reprovada', 'prestacao_aprovada',
    'nf_corrigida', 'editada', 'emissora_trocada'
  ]::text[]));

-- 2. A troca nas 15 PPs (antes do gatilho, com o motivo da correção) ----------
do $$
declare
  v_california constant uuid := 'ebfdae66-8644-4f9f-9079-fcf92ca18102';
  v_gocrazy    constant uuid := '58591670-bb7c-431c-a210-1a6e91e81277';
  v_hitlab     constant uuid := 'be5aea0a-6ea3-4691-841e-192197c77602';
  v_trocadas   int := 0;
  r            record;
begin
  for r in
    select p.id, p.tenant_id, p.codigo, t.de, t.para, t.documento,
           split_part(ed.nome, ' · ', 1) as de_nome,
           split_part(ep.nome, ' · ', 1) as para_nome
      from (values
        ('PP-00141', v_california, v_gocrazy,    'fatura de locação 1907'),
        ('PP-00145', v_california, v_gocrazy,    'duplicata 42029'),
        ('PP-00043', v_hitlab,     v_california, 'NF 90'),
        ('PP-00049', v_hitlab,     v_gocrazy,    'NF 87'),
        ('PP-00090', v_hitlab,     v_california, 'NF 7408'),
        ('PP-00045', v_hitlab,     v_california, 'relatório de passagens com cliente California'),
        ('PP-00069', v_hitlab,     v_california, 'NF 607, paga pela conta da California'),
        ('PP-00070', v_hitlab,     v_california, 'NF 6176, paga pela conta da California'),
        ('PP-00071', v_hitlab,     v_california, 'NF 260, paga pela conta da California'),
        ('PP-00072', v_hitlab,     v_california, 'NF 85, paga pela conta da California'),
        ('PP-00073', v_hitlab,     v_california, 'NF 35, paga pela conta da California'),
        ('PP-00074', v_hitlab,     v_california, 'NF 115, paga pela conta da California'),
        ('PP-00075', v_hitlab,     v_california, 'NF 261, paga pela conta da California'),
        ('PP-00076', v_hitlab,     v_california, 'NF 6193, paga pela conta da California'),
        ('PP-00077', v_hitlab,     v_california, 'NF 609, paga pela conta da California')
      ) as t(codigo, de, para, documento)
      join public.pedidos_compra p
        on p.codigo = t.codigo and p.estabelecimento_id = t.de
      join public.fiscal_estabelecimentos ed on ed.id = t.de
      join public.fiscal_estabelecimentos ep on ep.id = t.para
  loop
    update public.pedidos_compra
       set estabelecimento_id = r.para
     where id = r.id and estabelecimento_id = r.de;

    insert into public.pedidos_compra_eventos (tenant_id, pedido_compra_id, evento, por, motivo)
    values (r.tenant_id, r.id, 'emissora_trocada', null,
            format('De %s para %s, a empresa do documento (%s). Correção de 16/10/2026, revisão da decisão 156.',
                   r.de_nome, r.para_nome, r.documento));

    insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
    values (r.tenant_id, null, 'pedido_compra.emissora_trocada', 'pedido_compra', r.id::text,
            jsonb_build_object(
              'pp_codigo', r.codigo,
              'de', r.de, 'para', r.para,
              'documento', r.documento,
              'origem', 'migration_20261015970001',
              'decisao', 156,
              'confirmado_por', 'Tiago, 16/10/2026'));

    v_trocadas := v_trocadas + 1;
  end loop;

  if v_trocadas <> 15 then
    raise exception 'Esperava trocar 15 PPs e troquei %: alguma mudou desde o levantamento. Nada foi alterado.', v_trocadas;
  end if;
end;
$$;

-- 3. O gatilho da linha do tempo ------------------------------------------------
create or replace function public.pp_registra_troca_de_emissora()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_de        text;
  v_para      text;
  v_documento text;
begin
  if new.estabelecimento_id is not distinct from old.estabelecimento_id then
    return null;
  end if;

  select split_part(nome, ' · ', 1) into v_de
    from public.fiscal_estabelecimentos where id = old.estabelecimento_id;
  select split_part(nome, ' · ', 1) into v_para
    from public.fiscal_estabelecimentos where id = new.estabelecimento_id;

  -- O documento que definiu a empresa nova, quando há (a troca automática
  -- grava os anexos antes da PP; a edição manual não tem documento).
  select string_agg(
           case a.documento_tipo
             when 'nota_fiscal' then 'NF '
             when 'fatura' then 'fatura '
             else 'recibo '
           end || coalesce(nullif(btrim(a.documento_numero), ''), 's/n'),
           ', ' order by a.created_at)
    into v_documento
    from public.pedidos_compra_anexos a
   where a.pedido_compra_id = new.id
     and a.documento_tipo in ('nota_fiscal', 'fatura', 'recibo')
     and a.nf_tomador_estabelecimento_id = new.estabelecimento_id;

  insert into public.pedidos_compra_eventos (tenant_id, pedido_compra_id, evento, por, motivo)
  values (new.tenant_id, new.id, 'emissora_trocada', auth.uid(),
          format('De %s para %s%s.',
                 coalesce(v_de, 'nenhuma'), coalesce(v_para, 'nenhuma'),
                 case when v_documento is not null
                      then ', o CNPJ do documento (' || v_documento || ')'
                      else '' end));
  return null;
end;
$function$;

revoke all on function public.pp_registra_troca_de_emissora() from public, anon, authenticated;

drop trigger if exists trg_pp_registra_troca_de_emissora on public.pedidos_compra;
create trigger trg_pp_registra_troca_de_emissora
  after update of estabelecimento_id on public.pedidos_compra
  for each row execute function public.pp_registra_troca_de_emissora();

comment on column public.pedidos_compra.estabelecimento_id is
  'A empresa emissora da PP (CNPJ do cadastro de impostos): quem paga. Segue o documento anexado (nota, fatura ou recibo) quando ele informa o CNPJ; sem documento, a pré-seleção pela regional ou a escolha do formulário (revisão da decisão 156, 16/10/2026).';
comment on column public.pedidos_compra_anexos.nf_tomador_estabelecimento_id is
  'Contra qual CNPJ o documento foi emitido: tomador da NF, sacado da fatura ou pagador do recibo (revisão da decisão 156, 16/10/2026). A empresa emissora da PP segue este campo.';
