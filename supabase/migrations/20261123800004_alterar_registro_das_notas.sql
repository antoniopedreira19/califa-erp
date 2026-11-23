-- Decisão 271, ponto 6 (23/11/2026): o financeiro corrige o registro da NF
-- tomada na própria tabela da seção Notas Fiscais ("Editar registro").
--
-- O QUE FAZ
--   1. `notas_fiscais_fornecedor_alteracoes`: o registro de cada alteração —
--      quem, quando, de → para, o motivo e os documentos que acompanharam
--      (PP, desembolso, prestação da verba). A tela mostra em "Alterações do
--      registro" no painel da nota e no histórico do desembolso.
--   2. `alterar_registro_das_notas(p_alteracoes, p_motivo)`: só o
--      administrador e o financeiro; só nota ainda não registrada. Corrige
--      número, emissão, valor e CNPJ tomador (6a: o emitente não se corrige
--      aqui); as cópias nos anexos da PP, do desembolso e da prestação
--      acompanham (a parte de cada documento — na prestação, o `valor` do
--      documento — não muda); cada PP da nota ganha o evento "NF corrigida" com o
--      motivo; o saldo é conferido (`_conferir_partes_da_nota`).
--      - 6b: o número novo já é de outra nota do mesmo emitente → junta as
--        duas (os documentos passam para a que já existe). A registrada só
--        aceita a junção com os mesmos dados dela.
--      - Concorrência: cada item traz o que a tela viu ao abrir a edição
--        (`antes`); se a nota mudou desde então, nada é gravado.
--      Devolve as PPs da nota, para a tela seguir o CNPJ tomador na PP e
--      refazer o PDF (revisão da 156, no servidor da aplicação).
--
-- Mudança ADITIVA: tabela e função novas. Nenhum dado existente muda.

create table if not exists public.notas_fiscais_fornecedor_alteracoes (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete restrict,
  -- Nula se a nota um dia for apagada; na junção, passa para a nota que ficou.
  nota_fiscal_id uuid references public.notas_fiscais_fornecedor(id) on delete set null,
  fornecedor_id  uuid references public.fornecedores(id) on delete restrict,
  antes          jsonb not null,
  depois         jsonb not null,
  -- 6b: a nota que já existia com o número novo, à qual esta foi juntada.
  juntada_com    uuid,
  documentos     jsonb not null default '[]'::jsonb,
  motivo         text not null,
  alterada_por   uuid not null references public.profiles(id),
  alterada_em    timestamptz not null default now(),
  constraint chk_nff_alteracoes_motivo check (char_length(btrim(motivo)) >= 10),
  constraint chk_nff_alteracoes_documentos check (jsonb_typeof(documentos) = 'array')
);

comment on table public.notas_fiscais_fornecedor_alteracoes is
  'Decisão 271, ponto 6: cada alteração do registro de uma NF tomada feita pelo financeiro na seção Notas Fiscais — de → para, motivo e os documentos que acompanharam. Escrita só pela RPC alterar_registro_das_notas.';

create index if not exists idx_nff_alteracoes_nota on public.notas_fiscais_fornecedor_alteracoes (nota_fiscal_id, alterada_em desc);
create index if not exists idx_nff_alteracoes_tenant on public.notas_fiscais_fornecedor_alteracoes (tenant_id, alterada_em desc);
create index if not exists idx_nff_alteracoes_documentos on public.notas_fiscais_fornecedor_alteracoes using gin (documentos jsonb_path_ops);

alter table public.notas_fiscais_fornecedor_alteracoes enable row level security;

drop policy if exists nff_alteracoes_select on public.notas_fiscais_fornecedor_alteracoes;
create policy nff_alteracoes_select on public.notas_fiscais_fornecedor_alteracoes
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and (select public.session_role()) <> 'freelancer'::app_role
  );

revoke all on public.notas_fiscais_fornecedor_alteracoes from public, anon;
grant select on public.notas_fiscais_fornecedor_alteracoes to authenticated;

create or replace function public.alterar_registro_das_notas(p_alteracoes jsonb, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_tenant  uuid;
  v_item    jsonb;
  v_nota    public.notas_fiscais_fornecedor%rowtype;
  v_alvo    public.notas_fiscais_fornecedor%rowtype;
  v_final   public.notas_fiscais_fornecedor%rowtype;
  v_numero  text;
  v_emissao date;
  v_valor   numeric;
  v_tomador uuid;
  v_antes   jsonb;
  v_depois  jsonb;
  v_docs    jsonb;
  v_mud     text[];
  v_texto   text;
  v_quem    text;
  v_finais  uuid[] := '{}';
  v_pps     uuid[] := '{}';
  v_des     uuid[] := '{}';
  v_tomador_mudou boolean := false;
  v_id      uuid;
  r         record;
begin
  if v_uid is null then
    raise exception 'Sessão inválida.';
  end if;
  if p_motivo is null or char_length(btrim(p_motivo)) < 10 then
    raise exception 'Escreva o motivo da alteração (pelo menos 10 caracteres).';
  end if;
  if p_alteracoes is null or jsonb_typeof(p_alteracoes) <> 'array' or jsonb_array_length(p_alteracoes) = 0 then
    raise exception 'Nenhuma nota foi alterada.';
  end if;
  if jsonb_array_length(p_alteracoes) > 200 then
    raise exception 'Altere no máximo 200 notas de uma vez.';
  end if;

  for v_item in select value from jsonb_array_elements(p_alteracoes) loop
    select * into v_nota from public.notas_fiscais_fornecedor
     where id = nullif(v_item->>'nota_id', '')::uuid
     for update;
    if v_nota.id is null or v_nota.tenant_id not in (select public.current_tenant_ids()) then
      raise exception 'Nota não encontrada. Recarregue a tela.';
    end if;
    if v_tenant is null then
      v_tenant := v_nota.tenant_id;
      if not (public.is_tenant_admin(v_tenant) or public.is_tenant_financeiro(v_tenant)) then
        raise exception 'Só o financeiro e o administrador alteram o registro das notas.' using errcode = '42501';
      end if;
    elsif v_tenant <> v_nota.tenant_id then
      raise exception 'Nota não encontrada. Recarregue a tela.';
    end if;

    if v_nota.registrada_em is not null then
      raise exception 'A NF % já foi registrada. Para corrigir, reverta a aprovação do documento: a nota volta a Em avaliação.',
        v_nota.numero;
    end if;

    -- Duas pessoas ao mesmo tempo: a nota tem de estar como a tela viu.
    if (v_item->'antes'->>'numero') is distinct from v_nota.numero
       or nullif(v_item->'antes'->>'data_emissao', '')::date is distinct from v_nota.data_emissao
       or nullif(v_item->'antes'->>'valor', '')::numeric is distinct from v_nota.valor
       or nullif(v_item->'antes'->>'tomador_estabelecimento_id', '')::uuid is distinct from v_nota.tomador_estabelecimento_id then
      select p.nome into v_quem
        from public.notas_fiscais_fornecedor_alteracoes a
        left join public.profiles p on p.id = a.alterada_por
       where a.nota_fiscal_id = v_nota.id
       order by a.alterada_em desc
       limit 1;
      raise exception 'A NF % foi alterada por % depois que você abriu a edição. Recarregue a tela e confira antes de salvar.',
        v_nota.numero, coalesce(v_quem, 'outra pessoa');
    end if;

    v_numero  := nullif(btrim(v_item->>'numero'), '');
    v_emissao := nullif(v_item->>'data_emissao', '')::date;
    v_valor   := round(nullif(v_item->>'valor', '')::numeric, 2);
    v_tomador := nullif(v_item->>'tomador_estabelecimento_id', '')::uuid;

    if public.chave_do_numero_da_nf(v_numero) is null then
      raise exception 'Informe o número da NF % (antes %).', coalesce(v_numero, ''), v_nota.numero;
    end if;
    if v_emissao is null then
      raise exception 'Informe a data de emissão da NF %.', v_numero;
    end if;
    if v_emissao > (now() at time zone 'America/Sao_Paulo')::date then
      raise exception 'A data de emissão da NF % está no futuro.', v_numero;
    end if;
    if v_valor is null or v_valor <= 0 then
      raise exception 'Informe o valor da NF %.', v_numero;
    end if;
    -- O CNPJ novo precisa estar ativo; o que a nota já tinha continua valendo.
    if v_tomador is distinct from v_nota.tomador_estabelecimento_id and not exists (
      select 1 from public.fiscal_estabelecimentos e
       where e.id = v_tomador and e.tenant_id = v_tenant and e.ativo
    ) then
      raise exception 'Escolha um CNPJ tomador ativo para a NF %.', v_numero;
    end if;

    if v_numero = v_nota.numero and v_emissao = v_nota.data_emissao and v_valor = v_nota.valor
       and v_tomador is not distinct from v_nota.tomador_estabelecimento_id then
      continue;
    end if;

    v_antes := jsonb_build_object(
      'numero', v_nota.numero, 'data_emissao', v_nota.data_emissao, 'valor', v_nota.valor,
      'tomador_estabelecimento_id', v_nota.tomador_estabelecimento_id,
      'tomador', (select e.nome from public.fiscal_estabelecimentos e where e.id = v_nota.tomador_estabelecimento_id));

    -- Os documentos que acompanham (antes de uma possível junção).
    select coalesce(jsonb_agg(x.d order by x.d->>'codigo'), '[]'::jsonb) into v_docs
      from (
        select jsonb_build_object('tipo', 'pp', 'id', p.id, 'codigo', p.codigo) as d
          from public.pedidos_compra_anexos a
          join public.pedidos_compra p on p.id = a.pedido_compra_id
         where a.nota_fiscal_id = v_nota.id and p.status <> 'cancelada'
         group by p.id, p.codigo
        union all
        select jsonb_build_object('tipo', 'desembolso', 'id', d.id, 'codigo', d.codigo)
          from public.desembolsos_anexos a
          join public.desembolsos d on d.id = a.desembolso_id
         where a.nota_fiscal_id = v_nota.id and d.status <> 'cancelada'
         group by d.id, d.codigo
        union all
        select jsonb_build_object('tipo', 'prestacao', 'id', pr.id, 'codigo', pc.codigo || ' · prestação', 'pp_id', pc.id)
          from public.pp_verba_prestacoes_anexos a
          join public.pp_verba_prestacoes pr on pr.id = a.prestacao_id
          join public.pedidos_compra pc on pc.id = pr.pedido_compra_id
         where a.nota_fiscal_id = v_nota.id
         group by pr.id, pc.id, pc.codigo
      ) x;

    -- 6b: o número novo já é de outra nota do mesmo emitente → junta.
    select * into v_alvo from public.notas_fiscais_fornecedor
     where tenant_id = v_tenant and fornecedor_id = v_nota.fornecedor_id
       and numero_chave = public.chave_do_numero_da_nf(v_numero)
       and id <> v_nota.id
     for update;

    if v_alvo.id is not null then
      if v_alvo.registrada_em is not null
         and (v_alvo.data_emissao <> v_emissao or abs(v_alvo.valor - v_valor) > 0.005
              or v_alvo.tomador_estabelecimento_id is distinct from v_tomador) then
        raise exception 'A NF % deste emitente já existe e foi registrada com emissão % e valor %. Para juntar as duas, use os mesmos dados dela.',
          v_alvo.numero, to_char(v_alvo.data_emissao, 'DD/MM/YYYY'), public._reais(v_alvo.valor);
      end if;
      update public.pedidos_compra_anexos set nota_fiscal_id = v_alvo.id where nota_fiscal_id = v_nota.id;
      update public.desembolsos_anexos set nota_fiscal_id = v_alvo.id where nota_fiscal_id = v_nota.id;
      update public.pp_verba_prestacoes_anexos set nota_fiscal_id = v_alvo.id where nota_fiscal_id = v_nota.id;
      update public.notas_fiscais_fornecedor_alteracoes set nota_fiscal_id = v_alvo.id where nota_fiscal_id = v_nota.id;
      delete from public.notas_fiscais_fornecedor where id = v_nota.id;
      if v_alvo.registrada_em is null then
        update public.notas_fiscais_fornecedor
           set numero = v_numero, data_emissao = v_emissao, valor = v_valor, tomador_estabelecimento_id = v_tomador
         where id = v_alvo.id;
      end if;
      select * into v_final from public.notas_fiscais_fornecedor where id = v_alvo.id;
    else
      update public.notas_fiscais_fornecedor
         set numero = v_numero, data_emissao = v_emissao, valor = v_valor, tomador_estabelecimento_id = v_tomador
       where id = v_nota.id;
      select * into v_final from public.notas_fiscais_fornecedor where id = v_nota.id;
    end if;

    if v_final.id = any(v_finais) then
      raise exception 'A NF % aparece duas vezes nesta alteração.', v_final.numero;
    end if;
    v_finais := v_finais || v_final.id;
    if v_final.tomador_estabelecimento_id is distinct from v_nota.tomador_estabelecimento_id then
      v_tomador_mudou := true;
    end if;

    v_depois := jsonb_build_object(
      'numero', v_final.numero, 'data_emissao', v_final.data_emissao, 'valor', v_final.valor,
      'tomador_estabelecimento_id', v_final.tomador_estabelecimento_id,
      'tomador', (select e.nome from public.fiscal_estabelecimentos e where e.id = v_final.tomador_estabelecimento_id));

    insert into public.notas_fiscais_fornecedor_alteracoes
      (tenant_id, nota_fiscal_id, fornecedor_id, antes, depois, juntada_com, documentos, motivo, alterada_por)
    values
      (v_tenant, v_final.id, v_nota.fornecedor_id, v_antes, v_depois, v_alvo.id, v_docs, btrim(p_motivo), v_uid);

    -- As cópias nos documentos acompanham.
    update public.pedidos_compra_anexos
       set documento_numero = v_final.numero, nf_data_emissao = v_final.data_emissao,
           nf_valor = v_final.valor, nf_tomador_estabelecimento_id = v_final.tomador_estabelecimento_id
     where nota_fiscal_id = v_final.id;
    update public.desembolsos_anexos
       set documento_numero = v_final.numero, nf_data_emissao = v_final.data_emissao,
           nf_valor = v_final.valor, nf_tomador_estabelecimento_id = v_final.tomador_estabelecimento_id
     where nota_fiscal_id = v_final.id;
    -- Na prestação, `valor` é o que o documento cobre nela (como a parte da
    -- PP): não acompanha o valor da nota; o saldo é conferido no fim.
    update public.pp_verba_prestacoes_anexos
       set documento_numero = v_final.numero, documento_data = v_final.data_emissao,
           tomador_estabelecimento_id = v_final.tomador_estabelecimento_id
     where nota_fiscal_id = v_final.id
       and (documento_numero is distinct from v_final.numero or documento_data is distinct from v_final.data_emissao
            or tomador_estabelecimento_id is distinct from v_final.tomador_estabelecimento_id);

    -- O que mudou, para o evento das PPs.
    v_mud := '{}';
    if v_antes->>'numero' <> v_final.numero then
      v_mud := v_mud || format('número de %s para %s', v_antes->>'numero', v_final.numero);
    end if;
    if (v_antes->>'data_emissao')::date is distinct from v_final.data_emissao then
      v_mud := v_mud || format('emissão de %s para %s',
        to_char((v_antes->>'data_emissao')::date, 'DD/MM/YYYY'), to_char(v_final.data_emissao, 'DD/MM/YYYY'));
    end if;
    if (v_antes->>'valor')::numeric is distinct from v_final.valor then
      v_mud := v_mud || format('valor de %s para %s', public._reais((v_antes->>'valor')::numeric), public._reais(v_final.valor));
    end if;
    if (v_antes->>'tomador_estabelecimento_id')::uuid is distinct from v_final.tomador_estabelecimento_id then
      v_mud := v_mud || format('CNPJ tomador de %s para %s', coalesce(v_antes->>'tomador', '—'), coalesce(v_depois->>'tomador', '—'));
    end if;
    if v_alvo.id is not null then
      v_mud := v_mud || 'juntada à nota que já existia com esse número'::text;
    end if;
    v_texto := 'NF ' || v_final.numero || ': ' || array_to_string(v_mud, '; ')
               || ' (no controle de notas). Motivo: ' || btrim(p_motivo);

    for r in
      select distinct p.id, false as da_prestacao
        from public.pedidos_compra_anexos a
        join public.pedidos_compra p on p.id = a.pedido_compra_id
       where a.nota_fiscal_id = v_final.id and p.status <> 'cancelada'
      union
      select distinct pc.id, true
        from public.pp_verba_prestacoes_anexos a
        join public.pp_verba_prestacoes pr on pr.id = a.prestacao_id
        join public.pedidos_compra pc on pc.id = pr.pedido_compra_id
       where a.nota_fiscal_id = v_final.id
    loop
      insert into public.pedidos_compra_eventos (tenant_id, pedido_compra_id, evento, por, motivo)
      values (v_tenant, r.id, 'nf_corrigida', v_uid, case when r.da_prestacao then 'Prestação da verba · ' else '' end || v_texto);
      if not r.da_prestacao then
        update public.pedidos_compra set nf_corrigida_em = now(), nf_corrigida_por = v_uid where id = r.id;
        if not r.id = any(v_pps) then
          v_pps := v_pps || r.id;
        end if;
      end if;
    end loop;

    for r in
      select distinct a.desembolso_id as id
        from public.desembolsos_anexos a
        join public.desembolsos d on d.id = a.desembolso_id
       where a.nota_fiscal_id = v_final.id and d.status <> 'cancelada'
    loop
      if not r.id = any(v_des) then
        v_des := v_des || r.id;
      end if;
    end loop;
  end loop;

  foreach v_id in array v_finais loop
    perform public._conferir_partes_da_nota(v_id);
  end loop;

  return jsonb_build_object(
    'notas', to_jsonb(v_finais),
    'pps', to_jsonb(v_pps),
    'desembolsos', to_jsonb(v_des),
    'tomador_mudou', v_tomador_mudou);
end;
$function$;

comment on function public.alterar_registro_das_notas(jsonb, text) is
  'Decisão 271, ponto 6: o financeiro corrige número, emissão, valor e CNPJ tomador das NFs tomadas ainda não registradas; os documentos acompanham, o número que já existe junta as duas notas, e cada alteração fica em notas_fiscais_fornecedor_alteracoes.';

revoke all on function public.alterar_registro_das_notas(jsonb, text) from public, anon;
grant execute on function public.alterar_registro_das_notas(jsonb, text) to authenticated;
