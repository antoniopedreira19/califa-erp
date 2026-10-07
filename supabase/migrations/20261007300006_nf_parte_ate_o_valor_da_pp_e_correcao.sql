-- Revisão da decisão 152 (07/10/2026) — a parte da NF numa PP vai até o
-- valor da PP, e a produção corrige a NF da PP em avaliação.
--
-- POR QUE
-- A produção usou a NF 19 (R$ 450) em duas PPs: PP-00138 (R$ 250) e
-- PP-00139 (R$ 200). Na primeira, não clicou em "Esta NF também cobre outra
-- PP", e a parte gravada foi a nota inteira: R$ 450 numa PP de R$ 250. A
-- tela só avisava, em amarelo. A segunda PP esbarrou na soma (450 + 200 >
-- 450), com uma mensagem que mandava ajustar a PP errada, e ninguém da
-- produção conseguia corrigir a primeira, já enviada. A parte foi corrigida
-- à mão (autorizada pelo Tiago, auditoria `pedido_compra.nf_parte_corrigida`).
--
-- O QUE MUDA (decidido pelo Tiago em 07/10/2026)
--   1. A soma das partes das NFs numa PP não passa do valor da PP: a PP não
--      usa mais da nota do que ela mesma paga. A mesma NF continua cobrindo
--      várias PPs (R$ 250 + R$ 200 de uma nota de R$ 450). A trava mora em
--      `_conferir_partes_da_nota`, que roda depois do envio
--      (`ligar_notas_fiscais_da_pp`), da aprovação
--      (`registrar_notas_fiscais_da_pp`) e da correção (abaixo).
--   2. As mensagens saem em reais ("R$ 450,00", não "450.00") e dizem quanto
--      cada PP usa da nota.
--   3. `corrigir_notas_fiscais_da_pp`: com a PP em avaliação, o GP (ou o
--      administrador, ou o financeiro) corrige a NF sem precisar aprovar:
--        • a parte desta PP, sempre;
--        • os dados da nota (número, emissão, valor, CNPJ tomador) enquanto
--          o financeiro não a registrou. A correção vale para todas as PPs
--          ligadas a ela. Depois do registro, só o financeiro mexe.
--      A PP marca quem corrigiu e quando (`nf_corrigida_*`), para o
--      financeiro ver.
--   4. `notas_fiscais_do_fornecedor` devolve também o id da PP, para a tela
--      do envio abrir a correção da PP que está com a nota.

-- 1. Valor em reais nas mensagens --------------------------------------------
create or replace function public._reais(p numeric)
returns text
language sql
immutable
parallel safe
as $$
  select 'R$ ' || translate(to_char(round(coalesce(p, 0), 2), 'FM999,999,999,990.00'), ',.', '.,')
$$;
revoke all on function public._reais(numeric) from public, anon, authenticated;
comment on function public._reais(numeric) is
  'Valor em reais para mensagem de erro: 450 → "R$ 450,00" (revisão da decisão 152).';

-- 2. A conferência das partes: a nota e cada PP ligada -----------------------
create or replace function public._conferir_partes_da_nota(p_nota uuid)
returns void
language plpgsql
set search_path to 'public'
as $$
declare
  v_valor  numeric;
  v_numero text;
  v_soma   numeric;
  v_lista  text;
  r        record;
begin
  select valor, numero into v_valor, v_numero from public.notas_fiscais_fornecedor where id = p_nota;

  -- A nota: as partes das PPs não canceladas não passam do valor dela.
  select coalesce(sum(a.nf_valor_na_pp), 0),
         string_agg(p.codigo || ' com ' || public._reais(a.nf_valor_na_pp), ', ' order by p.codigo)
    into v_soma, v_lista
    from public.pedidos_compra_anexos a
    join public.pedidos_compra p on p.id = a.pedido_compra_id
   where a.nota_fiscal_id = p_nota and p.status <> 'cancelada';
  if v_soma > v_valor + 0.005 then
    raise exception 'A NF % vale % e as PPs ligadas a ela somam % (%). Corrija o valor da NF na PP que estiver errada.',
      v_numero, public._reais(v_valor), public._reais(v_soma), v_lista;
  end if;

  -- Cada PP ligada: as partes das notas nela não passam do valor da PP.
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
$$;
revoke all on function public._conferir_partes_da_nota(uuid) from public, anon, authenticated;

-- 3. Quem corrigiu a NF da PP em avaliação -----------------------------------
alter table public.pedidos_compra
  add column if not exists nf_corrigida_em  timestamptz,
  add column if not exists nf_corrigida_por uuid references public.profiles(id);
create index if not exists idx_pp_nf_corrigida_por on public.pedidos_compra (nf_corrigida_por) where nf_corrigida_por is not null;
comment on column public.pedidos_compra.nf_corrigida_em is
  'Última correção da NF com a PP em avaliação, fora da aprovação (revisão da decisão 152). O financeiro vê na conferência.';
comment on column public.pedidos_compra.nf_corrigida_por is
  'Quem fez a última correção da NF com a PP em avaliação (revisão da decisão 152).';

-- 4. A busca da nota devolve também o id da PP -------------------------------
create or replace function public.notas_fiscais_do_fornecedor(
  p_fornecedor_id uuid,
  p_numeros       text[],
  p_excluir_pp_id uuid default null
)
returns table (
  numero_chave               text,
  nota_id                    uuid,
  numero                     text,
  data_emissao               date,
  valor                      numeric,
  tomador_estabelecimento_id uuid,
  registrada                 boolean,
  pps                        jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select n.numero_chave, n.id, n.numero, n.data_emissao, n.valor, n.tomador_estabelecimento_id,
         n.registrada_em is not null,
         coalesce((
           select jsonb_agg(jsonb_build_object('id', p.id, 'codigo', p.codigo, 'valor_na_pp', a.nf_valor_na_pp, 'status', p.status)
                            order by p.codigo)
             from public.pedidos_compra_anexos a
             join public.pedidos_compra p on p.id = a.pedido_compra_id
            where a.nota_fiscal_id = n.id
              and p.status <> 'cancelada'
              and (p_excluir_pp_id is null or p.id <> p_excluir_pp_id)
         ), '[]'::jsonb)
    from public.notas_fiscais_fornecedor n
   where n.fornecedor_id = p_fornecedor_id
     and n.tenant_id in (select public.current_tenant_ids())
     and n.numero_chave = any (select public.chave_do_numero_da_nf(x) from unnest(p_numeros) x)
$$;
revoke all on function public.notas_fiscais_do_fornecedor(uuid, text[], uuid) from public, anon;
grant execute on function public.notas_fiscais_do_fornecedor(uuid, text[], uuid) to authenticated;

-- 5. A correção da NF da PP em avaliação -------------------------------------
-- p_notas: [{anexo_id, numero, data_emissao, valor, tomador_estabelecimento_id,
--            valor_na_pp}], uma por anexo do tipo NF da PP.
create or replace function public.corrigir_notas_fiscais_da_pp(
  p_pp_id uuid,
  p_notas jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid        uuid := auth.uid();
  v_tenant     uuid;
  v_status     text;
  v_verba      boolean;
  v_fornecedor uuid;
  v_item       jsonb;
  v_anexo      uuid;
  v_numero     text;
  v_emissao    date;
  v_valor      numeric;
  v_parte      numeric;
  v_tomador    uuid;
  v_atual      uuid;
  v_alvo       uuid;
  v_nota       uuid;
  v_nota_row   public.notas_fiscais_fornecedor%rowtype;
  v_notas      uuid[] := '{}';
  v_antigas    uuid[] := '{}';
  v_anexos_nf  int;
begin
  if v_uid is null then
    raise exception 'Sessão inválida.';
  end if;

  select tenant_id, status::text, verba_producao, fornecedor_id
    into v_tenant, v_status, v_verba, v_fornecedor
    from public.pedidos_compra where id = p_pp_id for update;
  if v_tenant is null or v_tenant not in (select public.current_tenant_ids()) then
    raise exception 'PP não encontrada.';
  end if;
  -- Quem envia PP (GP e administrador) e o financeiro.
  if not (
    public.is_tenant_admin(v_tenant)
    or public.is_tenant_financeiro(v_tenant)
    or exists (
      select 1 from public.tenant_members tm
       where tm.user_id = v_uid and tm.tenant_id = v_tenant and tm.status = 'ativo'
         and tm.role = 'gerente_producao')
  ) then
    raise exception 'Só o GP, o administrador ou o financeiro corrige a NF da PP.' using errcode = '42501';
  end if;
  if v_status <> 'em_avaliacao' then
    raise exception 'A NF só se corrige com a PP em avaliação no financeiro.';
  end if;
  if v_verba or v_fornecedor is null then
    raise exception 'Verba de produção não tem nota fiscal.';
  end if;

  select count(*) into v_anexos_nf
    from public.pedidos_compra_anexos
   where pedido_compra_id = p_pp_id and documento_tipo = 'nota_fiscal';
  if v_anexos_nf = 0 then
    raise exception 'Esta PP não tem NF anexada.';
  end if;
  if p_notas is null or jsonb_typeof(p_notas) <> 'array'
     or jsonb_array_length(p_notas) <> v_anexos_nf
     or exists (
       select 1 from jsonb_array_elements(p_notas) e
        where not exists (
          select 1 from public.pedidos_compra_anexos a
           where a.id = (e.value->>'anexo_id')::uuid
             and a.pedido_compra_id = p_pp_id
             and a.documento_tipo = 'nota_fiscal'))
     or (select count(distinct e.value->>'anexo_id') from jsonb_array_elements(p_notas) e) <> v_anexos_nf then
    raise exception 'As notas não batem com os anexos de NF da PP. Recarregue a tela.';
  end if;

  for v_item in select value from jsonb_array_elements(p_notas) loop
    v_anexo   := (v_item->>'anexo_id')::uuid;
    v_numero  := nullif(btrim(v_item->>'numero'), '');
    v_emissao := nullif(v_item->>'data_emissao', '')::date;
    v_valor   := nullif(v_item->>'valor', '')::numeric;
    v_parte   := coalesce(nullif(v_item->>'valor_na_pp', '')::numeric, v_valor);
    v_tomador := nullif(v_item->>'tomador_estabelecimento_id', '')::uuid;

    if public.chave_do_numero_da_nf(v_numero) is null then
      raise exception 'Informe o número de cada NF.';
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
    if not exists (
      select 1 from public.fiscal_estabelecimentos e
       where e.id = v_tomador and e.tenant_id = v_tenant and e.ativo
    ) then
      raise exception 'Escolha o CNPJ tomador da NF %.', v_numero;
    end if;

    select nota_fiscal_id into v_atual from public.pedidos_compra_anexos where id = v_anexo;
    select id into v_alvo
      from public.notas_fiscais_fornecedor
     where tenant_id = v_tenant and fornecedor_id = v_fornecedor
       and numero_chave = public.chave_do_numero_da_nf(v_numero)
     for update;

    if v_alvo is null then
      -- Número que o fornecedor ainda não tem. Se a nota atual é só desta
      -- PP e não foi registrada, foi o número dela que estava errado: ela
      -- muda. Senão (outras PPs com ela, ou já registrada), esta PP passa
      -- para uma nota nova e as outras ficam com a de antes.
      if v_atual is not null
         and exists (select 1 from public.notas_fiscais_fornecedor where id = v_atual and registrada_em is null)
         and not exists (
           select 1 from public.pedidos_compra_anexos x
            where x.nota_fiscal_id = v_atual and x.id <> v_anexo) then
        update public.notas_fiscais_fornecedor
           set numero = btrim(v_numero), data_emissao = v_emissao,
               valor = round(v_valor, 2), tomador_estabelecimento_id = v_tomador
         where id = v_atual;
        v_nota := v_atual;
      else
        insert into public.notas_fiscais_fornecedor
          (tenant_id, fornecedor_id, numero, data_emissao, valor, tomador_estabelecimento_id, criada_por)
        values
          (v_tenant, v_fornecedor, btrim(v_numero), v_emissao, round(v_valor, 2), v_tomador, v_uid)
        returning id into v_nota;
      end if;
    else
      v_nota := v_alvo;
      select * into v_nota_row from public.notas_fiscais_fornecedor where id = v_alvo;
      if v_nota_row.registrada_em is null then
        -- Ainda não registrada: a correção vale para todas as PPs com ela.
        update public.notas_fiscais_fornecedor
           set numero = btrim(v_numero), data_emissao = v_emissao,
               valor = round(v_valor, 2), tomador_estabelecimento_id = v_tomador
         where id = v_alvo;
      elsif v_nota_row.data_emissao <> v_emissao
            or abs(v_nota_row.valor - v_valor) > 0.005
            or v_nota_row.tomador_estabelecimento_id <> v_tomador then
        raise exception 'A NF % já foi registrada pelo financeiro: os dados dela só o financeiro corrige. A parte desta PP continua livre.',
          v_nota_row.numero;
      end if;
    end if;

    if v_nota = any(v_notas) then
      raise exception 'A NF % foi anexada duas vezes nesta PP.', v_numero;
    end if;
    v_notas := v_notas || v_nota;
    if v_atual is not null and v_atual <> v_nota then
      v_antigas := v_antigas || v_atual;
    end if;

    select * into v_nota_row from public.notas_fiscais_fornecedor where id = v_nota;
    if v_parte <= 0 or v_parte > v_nota_row.valor + 0.005 then
      raise exception 'O valor da NF % nesta PP precisa ser maior que zero e até o valor da nota.', v_nota_row.numero;
    end if;

    update public.pedidos_compra_anexos
       set nota_fiscal_id = v_nota,
           nf_valor_na_pp = round(v_parte, 2)
     where id = v_anexo;
  end loop;

  -- As cópias dos dados da nota nos anexos ligados a ela (desta e das
  -- outras PPs) acompanham a correção.
  update public.pedidos_compra_anexos a
     set documento_numero = n.numero,
         nf_data_emissao = n.data_emissao,
         nf_valor = n.valor,
         nf_tomador_estabelecimento_id = n.tomador_estabelecimento_id
    from public.notas_fiscais_fornecedor n
   where a.nota_fiscal_id = n.id and n.id = any(v_notas);

  -- A nota que ficou sem PP nenhuma, e nunca foi registrada, sai do cadastro.
  delete from public.notas_fiscais_fornecedor n
   where n.id = any(v_antigas)
     and n.registrada_em is null
     and not exists (select 1 from public.pedidos_compra_anexos x where x.nota_fiscal_id = n.id);

  foreach v_nota in array v_notas loop
    perform public._conferir_partes_da_nota(v_nota);
  end loop;

  update public.pedidos_compra
     set nf_corrigida_em = now(),
         nf_corrigida_por = v_uid
   where id = p_pp_id;
end;
$$;
revoke all on function public.corrigir_notas_fiscais_da_pp(uuid, jsonb) from public, anon;
grant execute on function public.corrigir_notas_fiscais_da_pp(uuid, jsonb) to authenticated;
comment on function public.corrigir_notas_fiscais_da_pp(uuid, jsonb) is
  'Revisão da decisão 152 (07/10/2026): com a PP em avaliação, GP, administrador ou financeiro corrige a NF sem aprovar — a parte desta PP sempre; os dados da nota enquanto ela não foi registrada (valem para todas as PPs com ela).';
