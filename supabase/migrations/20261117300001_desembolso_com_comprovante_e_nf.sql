-- Decisão 264 (17/11/2026): o pedido de desembolso com comprovante, a NF no
-- cadastro único de notas e a conferência do financeiro no formato da PP.
--
-- O que mudou e por quê (protótipo aprovado pelo Tiago, versão C "sem
-- documento"; regra completa em docs/decisions/264):
--
--  1. Quem recebe: fornecedor ou reembolso a quem pediu (`favorecido_tipo`).
--     Antes o fornecedor era opcional e, sem ele, não ficava claro a quem
--     pagar. Backfill: com fornecedor → 'fornecedor'; sem → 'reembolso'
--     (só preenche o que está vazio).
--  2. O envio e o reenvio (`enviado_em`, `reenviado_em`): o rejeitado volta
--     para quem pediu, que corrige e reenvia com o mesmo código.
--  3. Pagamento urgente com justificativa (como na PP, decisões 077 e 172):
--     libera a quarta de exceções na data de pagamento.
--  4. O comprovante obrigatório e a NF no anexo, como no anexo da PP:
--     número, emissão, valor, CNPJ tomador e a parte da nota neste pedido.
--     No reembolso, data e valor de cada comprovante (como a PP de
--     reembolso, decisão 187). O anexo passa a guardar o tipo do arquivo.
--  5. A NF entra no MESMO cadastro de notas da PP (`notas_fiscais_fornecedor`,
--     decisão 152): reconhecida pelo fornecedor e número, e o saldo dela é
--     somado entre PPs e desembolsos. `_conferir_partes_da_nota` passa a somar
--     os dois; `notas_fiscais_do_fornecedor` lista os dois (o `p_excluir_pp_id`
--     exclui o documento em edição, PP ou desembolso: os ids não colidem).
--  6. Só os próprios pedidos: o módulo Desembolsos mostra a cada pessoa o
--     que ela pediu; administrador e financeiro veem todos (Contas a Pagar).
--     Até aqui a regra existia só na tela; a policy de leitura passa a
--     exigi-la, e a dos anexos também (antes, qualquer membro do tenant lia
--     todos os anexos). As views do financeiro (`vw_a_pagar`,
--     `vw_fluxo_caixa`) não usam security_invoker e não mudam.
--
-- O salvar é uma função só (`salvar_pedido_de_desembolso`): grava o pedido,
-- as parcelas, o rateio e os anexos, liga as NFs ao cadastro e confere o
-- saldo na mesma transação — nada fica pela metade se a nota não couber.
-- A aprovação (`aprovar_pedido_de_desembolso`) confere o saldo de novo, aprova
-- pela função de sempre, grava a forma e o cartão e registra as notas. Um
-- gatilho no status exige o comprovante e deixa a decisão só com o
-- financeiro (quem pediu só reenvia o rejeitado ou cancela o próprio).
--
-- Na produção há um pedido só (DES-00001, em avaliação, sem anexo e sem
-- fornecedor: vira reembolso). Ele não se aprova mais sem comprovante: o
-- financeiro rejeita para quem pediu anexar.
--
-- Os arquivos vão para o bucket `pedidos-compra`, em
-- `<tenant>/desembolsos/<uuid>-nome`: o bucket `desembolsos`, para onde a
-- tela antiga enviava, nunca existiu no Storage (o único pedido da produção,
-- DES-00001, ficou sem anexo por isso). As policies do `pedidos-compra`
-- valem pelo tenant da primeira pasta.

-- ---------------------------------------------------------------------------
-- 1–3. O pedido
-- ---------------------------------------------------------------------------
alter table public.desembolsos
  add column if not exists favorecido_tipo text,
  add column if not exists enviado_em timestamptz,
  add column if not exists reenviado_em timestamptz,
  add column if not exists urgente boolean not null default false,
  add column if not exists urgente_justificativa text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'desembolsos_favorecido_tipo_check') then
    alter table public.desembolsos
      add constraint desembolsos_favorecido_tipo_check
      check (favorecido_tipo is null or favorecido_tipo in ('fornecedor', 'reembolso'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'desembolsos_urgente_justificada') then
    alter table public.desembolsos
      add constraint desembolsos_urgente_justificada
      check (not urgente or length(btrim(coalesce(urgente_justificativa, ''))) >= 10);
  end if;
end $$;

update public.desembolsos
   set favorecido_tipo = case when fornecedor_id is not null then 'fornecedor' else 'reembolso' end
 where favorecido_tipo is null;
update public.desembolsos set enviado_em = created_at where enviado_em is null;

comment on column public.desembolsos.favorecido_tipo is
  'Decisão 264: quem recebe — o fornecedor do pedido, ou reembolso a quem pediu (criado_por).';
comment on column public.desembolsos.enviado_em is
  'Decisão 264: quando o pedido foi ao financeiro (o último envio).';
comment on column public.desembolsos.reenviado_em is
  'Decisão 264: quando quem pediu corrigiu e reenviou o pedido rejeitado.';
comment on column public.desembolsos.urgente is
  'Decisão 264: pagamento urgente (como na PP, decisões 077 e 172), com justificativa.';

-- ---------------------------------------------------------------------------
-- 4. O anexo com a NF (e o comprovante do reembolso)
-- ---------------------------------------------------------------------------
alter table public.desembolsos_anexos
  add column if not exists arquivo_mimetype text,
  add column if not exists nf_data_emissao date,
  add column if not exists nf_valor numeric(14, 2),
  add column if not exists nf_tomador_estabelecimento_id uuid references public.fiscal_estabelecimentos(id),
  add column if not exists nf_valor_no_pedido numeric(14, 2),
  add column if not exists nota_fiscal_id uuid references public.notas_fiscais_fornecedor(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'desembolsos_anexos_valores_positivos') then
    alter table public.desembolsos_anexos
      add constraint desembolsos_anexos_valores_positivos
      check ((nf_valor is null or nf_valor > 0) and (nf_valor_no_pedido is null or nf_valor_no_pedido > 0));
  end if;
end $$;

create index if not exists desembolsos_anexos_nota_fiscal_id_idx on public.desembolsos_anexos(nota_fiscal_id);
create index if not exists desembolsos_anexos_desembolso_id_idx on public.desembolsos_anexos(desembolso_id);

comment on column public.desembolsos_anexos.nf_valor_no_pedido is
  'Decisão 264: a parte da NF neste pedido (como pedidos_compra_anexos.nf_valor_na_pp). Null = a nota inteira.';
comment on column public.desembolsos_anexos.nota_fiscal_id is
  'Decisão 264: a nota do cadastro único (notas_fiscais_fornecedor), ligada no envio do pedido.';

alter table public.notas_fiscais_fornecedor
  add column if not exists registrada_no_desembolso_id uuid references public.desembolsos(id) on delete set null;
create index if not exists notas_fiscais_fornecedor_registrada_no_desembolso_idx
  on public.notas_fiscais_fornecedor(registrada_no_desembolso_id);
comment on column public.notas_fiscais_fornecedor.registrada_no_desembolso_id is
  'Decisão 264: o desembolso cuja aprovação registrou a nota (como registrada_na_pp_id).';

-- ---------------------------------------------------------------------------
-- 5. O saldo da nota soma PPs e desembolsos
-- ---------------------------------------------------------------------------
create or replace function public._conferir_partes_da_nota(p_nota uuid)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_valor  numeric;
  v_numero text;
  v_soma   numeric;
  v_lista  text;
  r        record;
begin
  select valor, numero into v_valor, v_numero from public.notas_fiscais_fornecedor where id = p_nota;

  select coalesce(sum(x.parte), 0), string_agg(x.codigo || ' com ' || public._reais(x.parte), ', ' order by x.codigo)
    into v_soma, v_lista
    from (
      select p.codigo, a.nf_valor_na_pp as parte
        from public.pedidos_compra_anexos a
        join public.pedidos_compra p on p.id = a.pedido_compra_id
       where a.nota_fiscal_id = p_nota and p.status <> 'cancelada'
      union all
      select d.codigo, coalesce(a.nf_valor_no_pedido, a.nf_valor)
        from public.desembolsos_anexos a
        join public.desembolsos d on d.id = a.desembolso_id
       where a.nota_fiscal_id = p_nota and d.status <> 'cancelada'
    ) x;
  if v_soma > v_valor + 0.005 then
    raise exception 'A NF % vale % e os documentos ligados a ela somam % (%). Corrija o valor da NF no documento que estiver errado.',
      v_numero, public._reais(v_valor), public._reais(v_soma), v_lista;
  end if;

  for r in
    select p.codigo, p.valor, sum(a.nf_valor_na_pp) as soma, count(*) as notas
      from public.pedidos_compra p
      join public.pedidos_compra_anexos a
        on a.pedido_compra_id = p.id and a.nota_fiscal_id is not null and a.nf_valor_na_pp is not null
     where p.status <> 'cancelada'
       and p.id in (select x.pedido_compra_id from public.pedidos_compra_anexos x where x.nota_fiscal_id = p_nota)
     group by p.codigo, p.valor
  loop
    if r.soma > r.valor + 0.005 then
      if r.notas = 1 then
        raise exception 'O valor da NF % na % (%) passa do valor da PP (%). Numa PP, a parte da nota vai até o valor da PP.',
          v_numero, r.codigo, public._reais(r.soma), public._reais(r.valor);
      end if;
      raise exception 'As NFs da % somam % nela, mais que o valor da PP (%).',
        r.codigo, public._reais(r.soma), public._reais(r.valor);
    end if;
  end loop;
end;
$function$;

create or replace function public.notas_fiscais_do_fornecedor(p_fornecedor_id uuid, p_numeros text[], p_excluir_pp_id uuid default null)
returns table(numero_chave text, nota_id uuid, numero text, data_emissao date, valor numeric, tomador_estabelecimento_id uuid, registrada boolean, pps jsonb)
language sql
stable security definer
set search_path to 'public'
as $function$
  select n.numero_chave, n.id, n.numero, n.data_emissao, n.valor, n.tomador_estabelecimento_id,
         n.registrada_em is not null,
         coalesce((
           select jsonb_agg(jsonb_build_object('id', u.id, 'codigo', u.codigo, 'valor_na_pp', u.parte, 'status', u.status)
                            order by u.codigo)
             from (
               select p.id, p.codigo, a.nf_valor_na_pp as parte, p.status::text as status
                 from public.pedidos_compra_anexos a
                 join public.pedidos_compra p on p.id = a.pedido_compra_id
                where a.nota_fiscal_id = n.id
                  and p.status <> 'cancelada'
                  and (p_excluir_pp_id is null or p.id <> p_excluir_pp_id)
               union all
               select d.id, d.codigo, coalesce(a.nf_valor_no_pedido, a.nf_valor), d.status::text
                 from public.desembolsos_anexos a
                 join public.desembolsos d on d.id = a.desembolso_id
                where a.nota_fiscal_id = n.id
                  and d.status <> 'cancelada'
                  and (p_excluir_pp_id is null or d.id <> p_excluir_pp_id)
             ) u
         ), '[]'::jsonb)
    from public.notas_fiscais_fornecedor n
   where n.fornecedor_id = p_fornecedor_id
     and n.tenant_id in (select public.current_tenant_ids())
     and n.numero_chave = any (select public.chave_do_numero_da_nf(x) from unnest(p_numeros) x)
$function$;
revoke all on function public.notas_fiscais_do_fornecedor(uuid, text[], uuid) from public, anon;
grant execute on function public.notas_fiscais_do_fornecedor(uuid, text[], uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- O salvar do pedido: novo, corrigir e reenviar, ou anexar o comprovante
-- ---------------------------------------------------------------------------
create or replace function public.salvar_pedido_de_desembolso(p_tenant uuid, p jsonb)
returns table(id uuid, codigo text)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_uid        uuid := auth.uid();
  v_id         uuid := nullif(p->>'id', '')::uuid;
  v_codigo     text;
  v_status     desembolso_status;
  v_criador    uuid;
  v_reembolso  boolean := (p->>'favorecido_tipo') = 'reembolso';
  v_fornecedor uuid := nullif(p->>'fornecedor_id', '')::uuid;
  v_valor      numeric := round((p->>'valor')::numeric, 2);
  v_soma       numeric;
  v_anexo      jsonb;
  v_anexo_id   uuid;
  v_manter     uuid[] := '{}';
  v_nota       uuid;
  v_notas      uuid[] := '{}';
  v_corrige    boolean;
  n            record;
begin
  if v_uid is null then raise exception 'Sessão inválida.'; end if;
  if not public.is_tenant_member(p_tenant) then raise exception 'Sem acesso a este tenant.'; end if;
  if not public.can_access_empresa_regional(v_uid, (p->>'empresa_id')::uuid, null) then
    raise exception 'Sem acesso a esta empresa.';
  end if;
  if length(btrim(coalesce(p->>'descricao', ''))) < 3 then raise exception 'Escreva a descrição do pedido.'; end if;
  if v_valor is null or v_valor <= 0 then raise exception 'Informe o valor do pedido.'; end if;
  if not v_reembolso and v_fornecedor is null then
    raise exception 'Escolha o fornecedor que recebe, ou marque reembolso.';
  end if;
  if coalesce((p->>'urgente')::boolean, false) and length(btrim(coalesce(p->>'urgente_justificativa', ''))) < 10 then
    raise exception 'Escreva a justificativa do pagamento urgente (mín. 10 caracteres).';
  end if;

  -- Parcelas e rateio fecham com o valor.
  select coalesce(sum(round((x->>'valor')::numeric, 2)), 0) into v_soma from jsonb_array_elements(p->'parcelas') x;
  if jsonb_array_length(coalesce(p->'parcelas', '[]')) = 0 or abs(v_soma - v_valor) > 0.005 then
    raise exception 'A soma das parcelas precisa bater com o valor do pedido.';
  end if;
  select coalesce(sum((x->>'percentual')::numeric), 0) into v_soma from jsonb_array_elements(p->'rateio') x;
  if jsonb_array_length(coalesce(p->'rateio', '[]')) = 0 or abs(v_soma - 100) > 0.01 then
    raise exception 'O rateio por regional precisa somar 100%%.';
  end if;

  -- O comprovante é obrigatório, com o tipo de cada arquivo.
  if jsonb_array_length(coalesce(p->'anexos', '[]')) = 0 then
    raise exception 'Anexe o comprovante: sem ele o financeiro não aprova.';
  end if;
  if exists (select 1 from jsonb_array_elements(p->'anexos') x where nullif(x->>'documento_tipo', '') is null) then
    raise exception 'Escolha o tipo de cada arquivo.';
  end if;
  if v_reembolso then
    -- Como a PP de reembolso (decisão 187): número, data e valor de cada um, e a soma bate.
    if exists (select 1 from jsonb_array_elements(p->'anexos') x
                where nullif(btrim(x->>'documento_numero'), '') is null
                   or nullif(x->>'nf_data_emissao', '') is null
                   or coalesce((x->>'nf_valor')::numeric, 0) <= 0) then
      raise exception 'Complete cada comprovante: número, data e valor.';
    end if;
    select coalesce(sum(round((x->>'nf_valor')::numeric, 2)), 0) into v_soma from jsonb_array_elements(p->'anexos') x;
    if abs(v_soma - v_valor) > 0.005 then
      raise exception 'Os comprovantes somam %; o pedido é de %.', public._reais(v_soma), public._reais(v_valor);
    end if;
  else
    if exists (select 1 from jsonb_array_elements(p->'anexos') x
                where x->>'documento_tipo' = 'nota_fiscal'
                  and (nullif(btrim(x->>'documento_numero'), '') is null
                       or nullif(x->>'nf_data_emissao', '') is null
                       or coalesce((x->>'nf_valor')::numeric, 0) <= 0
                       or nullif(x->>'nf_tomador_estabelecimento_id', '') is null)) then
      raise exception 'Complete cada NF: número, emissão, valor e CNPJ tomador.';
    end if;
    select coalesce(sum(round(coalesce((x->>'nf_valor_no_pedido')::numeric, (x->>'nf_valor')::numeric), 2)), 0) into v_soma
      from jsonb_array_elements(p->'anexos') x where x->>'documento_tipo' = 'nota_fiscal';
    if v_soma > v_valor + 0.005 then
      raise exception 'As NFs somam % neste pedido, mais que o valor do pedido (%). Ajuste o valor neste pedido.',
        public._reais(v_soma), public._reais(v_valor);
    end if;
  end if;

  if v_id is null then
    v_codigo := public.gerar_codigo_desembolso(p_tenant);
    insert into public.desembolsos
      (tenant_id, codigo, empresa_id, descricao, valor, status, favorecido_tipo, fornecedor_id,
       data_prevista_pagamento, urgente, urgente_justificativa, criado_por, enviado_em)
    values
      (p_tenant, v_codigo, (p->>'empresa_id')::uuid, btrim(p->>'descricao'), v_valor, 'em_avaliacao',
       case when v_reembolso then 'reembolso' else 'fornecedor' end, case when v_reembolso then null else v_fornecedor end,
       (p->'parcelas'->0->>'data_vencimento')::date,
       coalesce((p->>'urgente')::boolean, false), nullif(btrim(coalesce(p->>'urgente_justificativa', '')), ''),
       v_uid, now())
    returning desembolsos.id into v_id;
  else
    select d.codigo, d.status, d.criado_por into v_codigo, v_status, v_criador
      from public.desembolsos d where d.id = v_id and d.tenant_id = p_tenant for update;
    if v_codigo is null then raise exception 'Pedido não encontrado.'; end if;
    if v_criador <> v_uid then raise exception 'Só quem pediu corrige e reenvia o pedido.'; end if;
    if v_status not in ('rejeitada', 'em_avaliacao') then
      raise exception 'Este pedido já foi decidido pelo financeiro (status: %).', v_status;
    end if;
    update public.desembolsos d
       set empresa_id = (p->>'empresa_id')::uuid,
           descricao = btrim(p->>'descricao'),
           valor = v_valor,
           favorecido_tipo = case when v_reembolso then 'reembolso' else 'fornecedor' end,
           fornecedor_id = case when v_reembolso then null else v_fornecedor end,
           data_prevista_pagamento = (p->'parcelas'->0->>'data_vencimento')::date,
           urgente = coalesce((p->>'urgente')::boolean, false),
           urgente_justificativa = nullif(btrim(coalesce(p->>'urgente_justificativa', '')), ''),
           status = 'em_avaliacao',
           enviado_em = now(),
           reenviado_em = case when v_status = 'rejeitada' then now() else d.reenviado_em end
     where d.id = v_id;
    delete from public.desembolsos_parcelas where desembolso_id = v_id;
    delete from public.desembolsos_regionais where desembolso_id = v_id;
  end if;

  insert into public.desembolsos_parcelas (tenant_id, desembolso_id, numero, data_vencimento, valor)
  select p_tenant, v_id, (x->>'numero')::smallint, (x->>'data_vencimento')::date, round((x->>'valor')::numeric, 2)
    from jsonb_array_elements(p->'parcelas') x;
  insert into public.desembolsos_regionais (desembolso_id, regional_id, percentual)
  select v_id, (x->>'regional_id')::uuid, (x->>'percentual')::numeric
    from jsonb_array_elements(p->'rateio') x;

  -- Os anexos: os que continuam (com id) mudam; os que saíram, saem; os novos entram.
  for v_anexo in select * from jsonb_array_elements(p->'anexos') loop
    v_anexo_id := nullif(v_anexo->>'id', '')::uuid;
    if v_anexo_id is not null then
      update public.desembolsos_anexos a
         set documento_tipo = (v_anexo->>'documento_tipo')::documento_tipo,
             documento_numero = nullif(btrim(v_anexo->>'documento_numero'), ''),
             nf_data_emissao = nullif(v_anexo->>'nf_data_emissao', '')::date,
             nf_valor = round(nullif(v_anexo->>'nf_valor', '')::numeric, 2),
             nf_tomador_estabelecimento_id = nullif(v_anexo->>'nf_tomador_estabelecimento_id', '')::uuid,
             nf_valor_no_pedido = round(nullif(v_anexo->>'nf_valor_no_pedido', '')::numeric, 2),
             nota_fiscal_id = null
       where a.id = v_anexo_id and a.desembolso_id = v_id;
      if not found then raise exception 'Anexo não encontrado neste pedido.'; end if;
    else
      if public.tenant_do_caminho_no_storage(v_anexo->>'path') is distinct from p_tenant then
        raise exception 'Caminho do anexo inválido.';
      end if;
      insert into public.desembolsos_anexos
        (tenant_id, desembolso_id, arquivo_path, arquivo_nome_original, arquivo_tamanho_bytes, arquivo_mimetype,
         criado_por, documento_tipo, documento_numero, nf_data_emissao, nf_valor, nf_tomador_estabelecimento_id, nf_valor_no_pedido)
      values
        (p_tenant, v_id, v_anexo->>'path', v_anexo->>'nome', (v_anexo->>'tamanho')::bigint, v_anexo->>'mimetype',
         v_uid, (v_anexo->>'documento_tipo')::documento_tipo, nullif(btrim(v_anexo->>'documento_numero'), ''),
         nullif(v_anexo->>'nf_data_emissao', '')::date, round(nullif(v_anexo->>'nf_valor', '')::numeric, 2),
         nullif(v_anexo->>'nf_tomador_estabelecimento_id', '')::uuid, round(nullif(v_anexo->>'nf_valor_no_pedido', '')::numeric, 2))
      returning desembolsos_anexos.id into v_anexo_id;
    end if;
    v_manter := v_manter || v_anexo_id;
  end loop;
  delete from public.desembolsos_anexos a where a.desembolso_id = v_id and not (a.id = any (v_manter));

  -- A NF do fornecedor entra no cadastro único: liga à nota que já existe
  -- (os dados vêm de lá) ou cria a nova. Depois, o saldo de cada nota.
  if not v_reembolso then
    for n in
      select a.id, a.documento_numero, a.nf_data_emissao, a.nf_valor, a.nf_tomador_estabelecimento_id
        from public.desembolsos_anexos a
       where a.desembolso_id = v_id and a.documento_tipo = 'nota_fiscal'
    loop
      -- A nota que só este pedido usa e ninguém registrou ainda é de quem
      -- pede: o que ele corrigir no anexo corrige a nota. A que já está em
      -- outro documento (ou registrada) manda nos dados.
      select nf.id into v_nota
        from public.notas_fiscais_fornecedor nf
       where nf.tenant_id = p_tenant and nf.fornecedor_id = v_fornecedor
         and nf.numero_chave = public.chave_do_numero_da_nf(n.documento_numero);
      v_corrige := v_nota is not null
        and (select nf.registrada_em from public.notas_fiscais_fornecedor nf where nf.id = v_nota) is null
        and not exists (select 1 from public.pedidos_compra_anexos pa
                          join public.pedidos_compra pc on pc.id = pa.pedido_compra_id
                         where pa.nota_fiscal_id = v_nota and pc.status <> 'cancelada')
        and not exists (select 1 from public.desembolsos_anexos da
                          join public.desembolsos dd on dd.id = da.desembolso_id
                         where da.nota_fiscal_id = v_nota and dd.id <> v_id and dd.status <> 'cancelada');
      v_nota := public._nota_fiscal_do_anexo(p_tenant, v_fornecedor, n.id, n.documento_numero, n.nf_data_emissao,
                                             n.nf_valor, n.nf_tomador_estabelecimento_id, v_uid, v_corrige);
      update public.desembolsos_anexos a
         set nota_fiscal_id = v_nota,
             nf_data_emissao = nf.data_emissao,
             nf_valor = nf.valor,
             nf_tomador_estabelecimento_id = nf.tomador_estabelecimento_id
        from public.notas_fiscais_fornecedor nf
       where a.id = n.id and nf.id = v_nota;
      v_notas := v_notas || v_nota;
    end loop;
    for v_nota in select distinct unnest(v_notas) loop
      perform public._conferir_partes_da_nota(v_nota);
    end loop;
  end if;

  return query select v_id, v_codigo;
end;
$function$;
revoke all on function public.salvar_pedido_de_desembolso(uuid, jsonb) from public, anon;
grant execute on function public.salvar_pedido_de_desembolso(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- A aprovação: comprovante, saldo da nota e o registro da NF
-- ---------------------------------------------------------------------------
create or replace function public.aprovar_pedido_de_desembolso(
  p_desembolso_id uuid, p_data_pagamento date, p_forma_pagamento forma_pagamento default null, p_cartao_credito_id uuid default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_d    public.desembolsos%rowtype;
  v_nota uuid;
begin
  if v_uid is null then raise exception 'Sessão inválida.'; end if;
  select * into v_d from public.desembolsos where id = p_desembolso_id for update;
  if not found then raise exception 'Desembolso não encontrado.'; end if;
  if not (public.is_tenant_admin(v_d.tenant_id) or public.is_tenant_financeiro(v_d.tenant_id)) then
    raise exception 'Só o financeiro aprova desembolsos.';
  end if;
  if p_forma_pagamento = 'cartao_credito' and p_cartao_credito_id is null then
    raise exception 'Escolha o cartão.';
  end if;
  for v_nota in
    select distinct nota_fiscal_id from public.desembolsos_anexos
     where desembolso_id = p_desembolso_id and nota_fiscal_id is not null
  loop
    perform public._conferir_partes_da_nota(v_nota);
  end loop;

  -- O comprovante é conferido pelo gatilho da aprovação (vale para todo caminho).
  perform public.aprovar_desembolso_com_data(p_desembolso_id, p_data_pagamento);

  -- A intenção de pagamento (decisão 093, §12), como na PP: pré-preenche a baixa.
  update public.desembolsos
     set forma_pagamento = p_forma_pagamento,
         cartao_credito_id = case when p_forma_pagamento = 'cartao_credito' then p_cartao_credito_id end
   where id = p_desembolso_id;

  -- A nota que ninguém registrou ainda é registrada por esta aprovação.
  update public.notas_fiscais_fornecedor nf
     set registrada_em = now(),
         registrada_por = v_uid,
         registrada_no_desembolso_id = p_desembolso_id
   where nf.registrada_em is null
     and nf.id in (select nota_fiscal_id from public.desembolsos_anexos
                    where desembolso_id = p_desembolso_id and nota_fiscal_id is not null);
end;
$function$;
revoke all on function public.aprovar_pedido_de_desembolso(uuid, date, forma_pagamento, uuid) from public, anon;
grant execute on function public.aprovar_pedido_de_desembolso(uuid, date, forma_pagamento, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Quem muda o status: o financeiro decide; quem pediu reenvia ou cancela
-- ---------------------------------------------------------------------------
-- Até aqui qualquer pessoa com acesso à empresa podia mudar o status pela API
-- (a regra estava só na tela). O gatilho vale para todo caminho, inclusive as
-- funções antigas (aprovar_desembolso_com_data, a baixa, a reversão), que
-- rodam com o usuário da sessão.
create or replace function public.desembolso_status_pelo_papel()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if new.status is not distinct from old.status or v_uid is null then
    return new;
  end if;

  -- Sem comprovante não se aprova (decisão 264).
  if old.status = 'em_avaliacao' and new.status = 'aprovada'
     and not exists (select 1 from public.desembolsos_anexos a where a.desembolso_id = new.id) then
    raise exception 'Sem comprovante: rejeite o desembolso para quem pediu anexar.' using errcode = 'P0001';
  end if;

  if public.is_tenant_admin(new.tenant_id) or public.is_tenant_financeiro(new.tenant_id) then
    return new;
  end if;
  if old.criado_por = v_uid
     and ((old.status = 'rejeitada' and new.status = 'em_avaliacao')
          or (old.status in ('em_avaliacao', 'rejeitada') and new.status = 'cancelada')) then
    return new;
  end if;
  raise exception 'Só o financeiro muda o desembolso para "%".', new.status using errcode = 'P0001';
end;
$function$;
revoke all on function public.desembolso_status_pelo_papel() from public, anon, authenticated;

drop trigger if exists trg_desembolso_status_pelo_papel on public.desembolsos;
create trigger trg_desembolso_status_pelo_papel
  before update of status on public.desembolsos
  for each row execute function public.desembolso_status_pelo_papel();

-- ---------------------------------------------------------------------------
-- 6. Só os próprios pedidos (fora do financeiro)
-- ---------------------------------------------------------------------------
drop policy if exists desembolsos_select on public.desembolsos;
create policy desembolsos_select on public.desembolsos
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and public.can_access_empresa_regional((select auth.uid()), empresa_id, null::uuid)
    and (criado_por = (select auth.uid())
         or (select public.session_role()) in ('administrador', 'financeiro'))
  );

drop policy if exists desembolsos_modify_update on public.desembolsos;
create policy desembolsos_modify_update on public.desembolsos
  for update to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and public.can_access_empresa_regional((select auth.uid()), empresa_id, null::uuid)
    and (criado_por = (select auth.uid())
         or (select public.session_role()) in ('administrador', 'financeiro'))
  )
  with check (
    tenant_id in (select public.current_tenant_ids())
    and public.can_access_empresa_regional((select auth.uid()), empresa_id, null::uuid)
  );

-- Os anexos seguem o pedido: só quem vê o pedido vê os arquivos dele.
drop policy if exists desembolsos_anexos_select on public.desembolsos_anexos;
create policy desembolsos_anexos_select on public.desembolsos_anexos
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and desembolso_id in (select d.id from public.desembolsos d)
  );

grant select, insert, update, delete on public.desembolsos, public.desembolsos_anexos to authenticated;
revoke all on public.desembolsos, public.desembolsos_anexos from anon;
