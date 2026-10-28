-- =====================================================================
-- Conciliar em conjunto: várias linhas do banco com várias baixas
-- (decisão 211; Tiago, 28/10/2026)
-- =====================================================================
--
-- O caso: em 14/10 a Santander Hitlab pagou 5 PPs do mesmo fornecedor em 4
-- PIX que não batem um a um, mas fecham ao centavo em dois conjuntos (2 PIX
-- = 2 PPs; 2 PIX = 3 PPs). A conciliação ligava uma linha do banco a uma ou
-- mais baixas, sempre com a soma da linha; aqui a soma só bate no conjunto.
-- O Tiago escolheu ligar por conjunto, sem mexer nas PPs nem nas baixas.
--
--   * `conciliada_como` ganha 'conjunto' (o CHECK é o mesmo, com um valor a
--     mais).
--   * `conciliar_em_conjunto(p_linha_ids, p_lancamento_ids)`: as linhas
--     pendentes e as baixas sem linha, da mesma conta, cuja soma bate ao
--     centavo. Cada linha do banco precisa de ao menos uma baixa (a baixa e
--     os juros dela, e as partes da mesma guia, contam como uma): é o que
--     mantém "conciliada" = "tem lançamento ligado" em todo o resto
--     (fechamento, resumo, saldo). Cada baixa se liga a uma das linhas — a
--     de valor mais perto, a maior primeiro — e muda para a data dela, como
--     em `conciliar_linha`. As linhas ficam com o mesmo `grupo`; o
--     `desfazer_conciliacao` que já existe solta o conjunto inteiro.
--   * `lancamento_desliga_a_linha`: cancelar uma baixa do conjunto solta
--     todas as linhas dele, e não só a da baixa.
--   * GRANT só para authenticated.
-- =====================================================================

alter table public.extrato_linhas drop constraint if exists chk_extrato_linha_conciliada_como;
alter table public.extrato_linhas add constraint chk_extrato_linha_conciliada_como check (
  conciliada_como is null
  or conciliada_como = any (array['ligacao', 'baixa', 'avulso', 'regra', 'par', 'correcao', 'historico', 'conjunto'])
);

create or replace function public.conciliar_em_conjunto(p_linha_ids uuid[], p_lancamento_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid      uuid;
  v_primeira extrato_linhas%rowtype;
  v_l        extrato_linhas%rowtype;
  v_linhas   uuid[] := '{}';
  v_datas_l  date[] := '{}';
  v_resta    numeric[] := '{}';
  v_ids      uuid[];
  v_n        integer;
  v_soma_l   numeric := 0;
  v_soma_b   numeric;
  v_grupo    uuid := gen_random_uuid();
  v_desfazer jsonb[] := '{}';
  v_alvo     integer;
  v_melhor   numeric;
  v_i        integer;
  v_k        integer := 0;
  u          record;
  r          record;
  v_id       uuid;
begin
  if coalesce(cardinality(p_linha_ids), 0) = 0 or coalesce(cardinality(p_lancamento_ids), 0) = 0 then
    raise exception 'Escolha as linhas do banco e as baixas do conjunto.';
  end if;

  -- As linhas: pendentes, da mesma conta. A maior primeiro.
  for v_id in
    select l.id from public.extrato_linhas l
     where l.id = any (p_linha_ids)
     order by abs(l.valor) desc, l.data, l.ordem
  loop
    v_l := public._linha_pendente(v_id);
    if v_primeira.id is null then
      v_primeira := v_l;
      v_uid := public._exige_financeiro_conciliacao(v_l.tenant_id);
    elsif v_l.tenant_id <> v_primeira.tenant_id or v_l.conta_bancaria_id <> v_primeira.conta_bancaria_id then
      raise exception 'As linhas do banco precisam ser da mesma conta.';
    end if;
    v_linhas := v_linhas || v_l.id;
    v_datas_l := v_datas_l || v_l.data;
    v_resta := v_resta || v_l.valor;
    v_desfazer := v_desfazer || '[]'::jsonb;
    v_soma_l := v_soma_l + v_l.valor;
  end loop;
  if cardinality(v_linhas) <> (select count(distinct x) from unnest(p_linha_ids) x) then
    raise exception 'Alguma linha do banco não existe mais: recarregue a página.';
  end if;

  -- As baixas, com os juros delas e as partes da mesma guia (como em
  -- `conciliar_linha`).
  select array_agg(distinct f.id) into v_ids
    from public.lancamentos_financeiros f
   where f.id = any (p_lancamento_ids)
      or (f.origem = 'juros_baixa' and f.juros_de_lancamento_id = any (p_lancamento_ids))
      or (f.origem = 'imposto_baixa' and exists (
            select 1 from public.lancamentos_financeiros g
             where g.id = any (p_lancamento_ids) and g.origem = 'imposto_baixa'
               and g.imposto_a_pagar_id = f.imposto_a_pagar_id
               and g.conta_bancaria_id = f.conta_bancaria_id
               and g.data_movimento = f.data_movimento));
  if exists (select unnest(p_lancamento_ids) except select unnest(coalesce(v_ids, '{}'::uuid[]))) then
    raise exception 'Alguma baixa escolhida não existe mais: recarregue a página.';
  end if;

  perform 1 from public.lancamentos_financeiros where id = any (v_ids) for update;

  select count(*)::int, coalesce(sum(case when natureza = 'entrada' then valor else -valor end), 0)
    into v_n, v_soma_b
    from public.lancamentos_financeiros
   where id = any (v_ids)
     and tenant_id = v_primeira.tenant_id
     and conta_bancaria_id = v_primeira.conta_bancaria_id
     and extrato_linha_id is null;
  if v_n <> coalesce(cardinality(v_ids), 0) then
    raise exception 'Alguma baixa não é desta conta ou já está conciliada com outra linha.';
  end if;
  if abs(v_soma_b - v_soma_l) >= 0.005 then
    raise exception 'A soma das baixas (%) não bate com a das linhas do banco (%).',
      public._moeda_br(v_soma_b), public._moeda_br(v_soma_l);
  end if;

  -- As unidades: a baixa com os juros dela; as partes da mesma guia juntas.
  select count(distinct case
           when f.origem = 'juros_baixa' then f.juros_de_lancamento_id::text
           when f.origem = 'imposto_baixa' then 'guia:' || f.imposto_a_pagar_id || ':' || f.data_movimento
           else f.id::text
         end)::int
    into v_n
    from public.lancamentos_financeiros f
   where f.id = any (v_ids);
  if v_n < cardinality(v_linhas) then
    raise exception 'Cada linha do banco precisa de ao menos uma baixa do conjunto: são % linhas e % baixas.',
      cardinality(v_linhas), v_n;
  end if;

  -- Cada baixa vai para uma linha: primeiro uma para cada linha (a maior com
  -- a maior), depois para a linha com mais valor ainda por cobrir.
  for u in
    select chave, sum(assinado) as valor, array_agg(id) as ids
      from (
        select f.id,
               case when f.natureza = 'entrada' then f.valor else -f.valor end as assinado,
               case
                 when f.origem = 'juros_baixa' then f.juros_de_lancamento_id::text
                 when f.origem = 'imposto_baixa' then 'guia:' || f.imposto_a_pagar_id || ':' || f.data_movimento
                 else f.id::text
               end as chave
          from public.lancamentos_financeiros f
         where f.id = any (v_ids)
      ) s
     group by chave
     order by abs(sum(assinado)) desc, chave
  loop
    v_k := v_k + 1;
    if v_k <= cardinality(v_linhas) then
      v_alvo := v_k;
    else
      v_alvo := 1;
      v_melhor := null;
      for v_i in 1 .. cardinality(v_linhas) loop
        if v_melhor is null or sign(u.valor) * v_resta[v_i] > v_melhor then
          v_melhor := sign(u.valor) * v_resta[v_i];
          v_alvo := v_i;
        end if;
      end loop;
    end if;
    v_resta[v_alvo] := v_resta[v_alvo] - u.valor;

    for r in
      select id, data_movimento from public.lancamentos_financeiros
       where id = any (u.ids) and origem <> 'juros_baixa' and data_movimento <> v_datas_l[v_alvo]
    loop
      perform public._mudar_data_do_lancamento(r.id, v_datas_l[v_alvo]);
      v_desfazer[v_alvo] := v_desfazer[v_alvo] || jsonb_build_object('id', r.id, 'de', r.data_movimento);
    end loop;
    update public.lancamentos_financeiros set extrato_linha_id = v_linhas[v_alvo] where id = any (u.ids);
  end loop;

  for v_i in 1 .. cardinality(v_linhas) loop
    update public.extrato_linhas
       set conciliada_como = 'conjunto',
           conciliada_em = now(),
           conciliada_por = v_uid,
           desfazer = jsonb_build_object('datas', v_desfazer[v_i]),
           grupo = v_grupo,
           resolvida_sozinha = null
     where id = v_linhas[v_i];
  end loop;

  perform public._auditar_extrato(v_primeira, 'extrato.conciliado_em_conjunto', v_uid,
    jsonb_build_object('linhas', to_jsonb(v_linhas), 'lancamentos', to_jsonb(v_ids),
                       'soma', v_soma_l, 'grupo', v_grupo));

  return jsonb_build_object('grupo', v_grupo, 'linhas', to_jsonb(v_linhas), 'lancamentos', to_jsonb(v_ids));
end;
$function$;

revoke all on function public.conciliar_em_conjunto(uuid[], uuid[]) from public, anon;
grant execute on function public.conciliar_em_conjunto(uuid[], uuid[]) to authenticated;

-- Cancelar uma baixa do conjunto solta o conjunto inteiro: sem ela, a soma
-- das outras não bate mais com as linhas do banco.
create or replace function public.lancamento_desliga_a_linha()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_linha extrato_linhas%rowtype;
begin
  select * into v_linha from public.extrato_linhas where id = old.extrato_linha_id;
  if v_linha.conciliada_como = 'conjunto' and v_linha.grupo is not null then
    update public.lancamentos_financeiros
       set extrato_linha_id = null
     where extrato_linha_id in (select id from public.extrato_linhas where grupo = v_linha.grupo)
       and id <> old.id;
    update public.extrato_linhas
       set sem_auto = true,
           resolvida_sozinha = null,
           conciliada_como = null,
           conciliada_em = null,
           conciliada_por = null,
           desfazer = null,
           grupo = null
     where grupo = v_linha.grupo;
    return old;
  end if;

  update public.lancamentos_financeiros
     set extrato_linha_id = null
   where extrato_linha_id = old.extrato_linha_id
     and id <> old.id;
  update public.extrato_linhas
     set sem_auto = true,
         resolvida_sozinha = null,
         conciliada_como = null,
         conciliada_em = null,
         conciliada_por = null,
         desfazer = null,
         grupo = null
   where id = old.extrato_linha_id;
  return old;
end;
$function$;
