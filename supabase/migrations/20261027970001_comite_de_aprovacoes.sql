-- Decisão 223: Comitê de Aprovações (27/10/2026).
--
-- As exceções da decisão 204, que só o administrador aprovava, passam a ir
-- para o Comitê de Aprovações:
--   - aprovar versão com Resultado geral abaixo do mínimo ou com item de
--     planejado acima do orçado (abertura de job);
--   - gerar ou editar PP que leva o realizado do item acima do orçado.
-- Quem esbarra na regra solicita a aprovação com um motivo; basta um membro
-- do Comitê decidir. Aprovada a versão, ela fica aprovada; aprovada a PP, a
-- geração fica liberada para a produção.
--
-- Regras configuráveis por tenant (`comite_config`), com os padrões que
-- reproduzem o comportamento de hoje: resultado mínimo 20% ligado, planejado
-- acima do orçado ligado, realizado acima do orçado ligado, linha vermelha
-- FORA (como desde 20261027950001), tolerância desligada e o administrador
-- aprovando direto na tela.
--
-- Volta ao Comitê só se piorar (pedido do Tiago, 27/10/2026): depois de
-- aprovado, se o financeiro devolver e a versão ou a PP precisar de
-- alteração, a nova aprovação/geração só volta ao Comitê se a situação
-- piorar em relação ao que o Comitê aprovou:
--   - versão: mais itens com planejado acima do orçado, ou Resultado geral
--     menor (comparado ao último pedido aprovado do mesmo orçamento);
--   - PP: valor maior que o aprovado (a PP reemitida herda a aprovação da
--     que ela refaz, por `pedidos_compra_a_emitir.refaz_pp_id`).
--
-- Versão aguardando o Comitê é só leitura (itens, grupos e parâmetros),
-- para que o Comitê decida sobre o que viu.
--
-- Aditiva: tabelas novas e troca do corpo das duas funções da 204. Sem
-- backfill, não altera versão nem PP existente.
begin;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.comite_config (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  resultado_ligado boolean not null default true,
  resultado_minimo numeric(5,2) not null default 20 check (resultado_minimo between 0 and 100),
  planejado_ligado boolean not null default true,
  pp_ligado boolean not null default true,
  linhas_vermelhas boolean not null default false,
  tolerancia_ligada boolean not null default false,
  tolerancia_valor numeric(14,2) not null default 0 check (tolerancia_valor >= 0),
  tolerancia_pct numeric(5,2) not null default 0 check (tolerancia_pct between 0 and 100),
  admin_direto boolean not null default true,
  atualizado_por uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_comite_config_atualizado_por on public.comite_config(atualizado_por);

create table public.comite_membros (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  adicionado_por uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index idx_comite_membros_user on public.comite_membros(user_id);
create index idx_comite_membros_adicionado_por on public.comite_membros(adicionado_por);

create table public.comite_pedidos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tipo text not null check (tipo in ('versao', 'pp')),
  -- Versão: a versão e o orçamento. PP: o job, a linha do realizado e a
  -- PP a emitir (cujo id é o da PP quando ela é gerada).
  orcamento_id uuid references public.orcamentos(id) on delete cascade,
  versao_orcamento_id uuid references public.versoes_orcamento(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  item_realizado_id uuid references public.jobs_itens_realizado(id) on delete cascade,
  pp_a_emitir_id uuid references public.pedidos_compra_a_emitir(id) on delete cascade,
  status text not null default 'pendente'
    check (status in ('pendente', 'aprovado', 'devolvido', 'cancelado')),
  motivo text not null check (length(btrim(motivo)) > 0),
  -- Os números no envio e na decisão (preenchidos pelo banco):
  -- versão {itens_acima, resultado_geral}; PP {valor, orcado, realizado,
  -- excesso, linha_vermelha}.
  snapshot jsonb not null default '{}'::jsonb,
  enviado_por uuid not null references public.profiles(id),
  enviado_em timestamptz not null default now(),
  decidido_por uuid references public.profiles(id),
  decidido_em timestamptz,
  comentario text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_comite_pedido_alvo check (
    (tipo = 'versao' and versao_orcamento_id is not null and orcamento_id is not null
       and pp_a_emitir_id is null)
    or (tipo = 'pp' and pp_a_emitir_id is not null and item_realizado_id is not null
       and job_id is not null and versao_orcamento_id is null)
  ),
  constraint chk_comite_pedido_decisao check (
    (status in ('aprovado', 'devolvido')) = (decidido_por is not null and decidido_em is not null)
  ),
  constraint chk_comite_pedido_devolvido_com_comentario check (
    status <> 'devolvido' or length(btrim(coalesce(comentario, ''))) > 0
  )
);
-- Um pedido pendente por orçamento e por PP a emitir.
create unique index uq_comite_pedido_pendente_orcamento
  on public.comite_pedidos(orcamento_id) where status = 'pendente' and tipo = 'versao';
create unique index uq_comite_pedido_pendente_pp
  on public.comite_pedidos(pp_a_emitir_id) where status = 'pendente' and tipo = 'pp';
create index idx_comite_pedidos_caixa on public.comite_pedidos(tenant_id, status, enviado_em desc);
create index idx_comite_pedidos_versao on public.comite_pedidos(versao_orcamento_id);
create index idx_comite_pedidos_orcamento on public.comite_pedidos(orcamento_id, status);
create index idx_comite_pedidos_job on public.comite_pedidos(job_id);
create index idx_comite_pedidos_item on public.comite_pedidos(item_realizado_id);
create index idx_comite_pedidos_pp on public.comite_pedidos(pp_a_emitir_id, status);
create index idx_comite_pedidos_enviado_por on public.comite_pedidos(enviado_por);
create index idx_comite_pedidos_decidido_por on public.comite_pedidos(decidido_por);

create trigger trg_comite_config_updated_at before update on public.comite_config
for each row execute function public.set_updated_at();
create trigger trg_comite_pedidos_updated_at before update on public.comite_pedidos
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- As regras do tenant; sem linha, os padrões (que reproduzem a 204 de hoje).
create or replace function public.comite_regras(p_tenant_id uuid)
returns public.comite_config
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v public.comite_config;
begin
  select * into v from public.comite_config where tenant_id = p_tenant_id;
  if not found then
    v.tenant_id := p_tenant_id;
    v.resultado_ligado := true;
    v.resultado_minimo := 20;
    v.planejado_ligado := true;
    v.pp_ligado := true;
    v.linhas_vermelhas := false;
    v.tolerancia_ligada := false;
    v.tolerancia_valor := 0;
    v.tolerancia_pct := 0;
    v.admin_direto := true;
  end if;
  return v;
end;
$$;

create or replace function public.is_comite_membro(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.comite_membros m
      join public.tenant_members tm on tm.user_id = m.user_id and tm.tenant_id = m.tenant_id
      join public.profiles p on p.id = m.user_id
     where m.tenant_id = p_tenant_id
       and m.user_id = (select auth.uid())
       and tm.status = 'ativo'
       and tm.role <> 'freelancer'
       and p.ativo = true
  );
$$;

-- Quem decide: membro do Comitê ou administrador.
create or replace function public.pode_decidir_no_comite(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_comite_membro(p_tenant_id) or public.is_tenant_admin(p_tenant_id);
$$;

-- Os números da versão que as regras da abertura olham: quantos itens têm
-- planejado acima do orçado e o Resultado geral do cabeçalho (null quando
-- não há planejado). Mesma conta de `versao_confere_limites_na_aprovacao`
-- desde 20261022850001 (espelho de calcularTotaisVersao /
-- calcularResultadoOperacional / fechamentoDosItens).
create or replace function public.versao_limites(p_versao_id uuid)
returns table(itens_acima integer, resultado_geral numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_versao public.versoes_orcamento;
  v_modelo text;
  v_planejado numeric;
  v_principal numeric;
  v_base_honorarios numeric;
  v_base_imposto numeric;
  v_honorarios numeric;
  v_int_taxes numeric := 0;
  v_imposto numeric;
  v_transacao numeric := 0;
  v_valor_job numeric;
  v_negociado numeric;
  v_veiculo numeric;
begin
  select * into v_versao from public.versoes_orcamento where id = p_versao_id;
  if not found then return; end if;

  select c.modelo_planilha into v_modelo
    from public.orcamentos o
    left join public.categorias_dominio c on c.id = o.categoria_id
   where o.id = v_versao.orcamento_id and o.tenant_id = v_versao.tenant_id;

  select coalesce(count(*) filter (where total_planejado - total_orcado > 0.005), 0)::int,
         coalesce(sum(total_planejado), 0),
         coalesce(sum(total_orcado) filter (where not em_save and tipo_custo <> 'D'), 0),
         coalesce(sum(total_orcado) filter (where not em_save and tipo_custo not in ('C', 'FI')), 0),
         coalesce(sum(total_orcado) filter (where not em_save and tipo_custo in ('B', 'C')), 0),
         coalesce(sum(total_orcado), 0)
    into itens_acima, v_planejado, v_principal, v_base_honorarios, v_base_imposto, v_negociado
    from public.versoes_orcamento_itens
   where versao_orcamento_id = v_versao.id and tenant_id = v_versao.tenant_id;

  if v_modelo = 'midia_off' then
    v_veiculo := v_negociado * coalesce(v_versao.percentual_veiculo, 80) / 100;
    v_honorarios := (case when v_versao.base_honorarios = 'liquido' then v_veiculo else v_negociado end)
                    * coalesce(v_versao.percentual_honorarios, 0) / 100;
    v_imposto := v_honorarios * coalesce(v_versao.percentual_imposto, 0) / 100;
    v_valor_job := v_veiculo + v_honorarios;
    v_planejado := v_veiculo;
  else
    if v_planejado <= 0 then
      resultado_geral := null;
      return next;
      return;
    end if;
    v_honorarios := v_base_honorarios * coalesce(v_versao.percentual_honorarios, 0) / 100;
    if v_modelo = 'internacional' then
      v_int_taxes := (v_base_imposto + v_honorarios) * greatest(0, least(99.99, coalesce(v_versao.percentual_int_taxes, 0)))
             / (100 - greatest(0, least(99.99, coalesce(v_versao.percentual_int_taxes, 0))));
      v_transacao := coalesce(v_versao.int_transaction_costs, 0);
    end if;
    v_imposto := (v_base_imposto + v_honorarios + v_int_taxes) * greatest(0, least(99.99, coalesce(v_versao.percentual_imposto, 0)))
           / (100 - greatest(0, least(99.99, coalesce(v_versao.percentual_imposto, 0))));
    v_valor_job := v_principal + v_honorarios + v_int_taxes + v_imposto + v_transacao;
    v_imposto := v_imposto + v_int_taxes + v_transacao;
  end if;

  resultado_geral := case when v_valor_job > 0
    then (v_valor_job - v_imposto - v_planejado) / v_valor_job * 100
    else null end;
  return next;
end;
$$;

-- A versão esbarra em alguma regra ligada? Devolve os números e os motivos.
-- `coberta`: o último pedido aprovado do orçamento cobre o estado atual
-- (não piorou). `direto`: quem chama aprova sem o Comitê.
create or replace function public.comite_situacao_da_versao(p_versao_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_versao public.versoes_orcamento;
  v_cfg public.comite_config;
  v_itens integer;
  v_resultado numeric;
  v_planejado_pega boolean;
  v_resultado_pega boolean;
  v_aprovado public.comite_pedidos;
  v_coberta boolean := false;
begin
  select * into v_versao from public.versoes_orcamento where id = p_versao_id;
  if not found or not public.is_tenant_member(v_versao.tenant_id) then return null; end if;
  if public.orcamento_de_investimento_interno(v_versao.orcamento_id) then
    return jsonb_build_object('regra', false, 'interno', true);
  end if;

  v_cfg := public.comite_regras(v_versao.tenant_id);
  select l.itens_acima, l.resultado_geral into v_itens, v_resultado
    from public.versao_limites(p_versao_id) l;
  v_planejado_pega := v_cfg.planejado_ligado and coalesce(v_itens, 0) > 0;
  v_resultado_pega := v_cfg.resultado_ligado and v_resultado is not null
                      and v_resultado < v_cfg.resultado_minimo - 0.000000001;

  select * into v_aprovado
    from public.comite_pedidos p
   where p.tipo = 'versao' and p.orcamento_id = v_versao.orcamento_id and p.status = 'aprovado'
   order by p.decidido_em desc
   limit 1;
  if found then
    v_coberta := coalesce(v_itens, 0) <= coalesce((v_aprovado.snapshot->>'itens_acima')::int, 0)
      and (v_resultado is null
           or (v_aprovado.snapshot->>'resultado_geral') is null
           or v_resultado >= (v_aprovado.snapshot->>'resultado_geral')::numeric - 0.000000001);
  end if;

  return jsonb_build_object(
    'regra', v_planejado_pega or v_resultado_pega,
    'planejado', v_planejado_pega,
    'resultado', v_resultado_pega,
    'itens_acima', coalesce(v_itens, 0),
    'resultado_geral', v_resultado,
    'resultado_minimo', v_cfg.resultado_minimo,
    'coberta', v_coberta,
    'direto', v_cfg.admin_direto and public.is_tenant_admin(v_versao.tenant_id)
  );
end;
$$;

-- A PP (ou a que ela refaz, em cadeia) tem pedido aprovado no Comitê com
-- valor maior ou igual ao de agora? (Volta ao Comitê só se ficar mais cara.)
create or replace function public.comite_pp_aprovada(p_tenant_id uuid, p_pp_id uuid, p_valor numeric)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := p_pp_id;
  v_passos integer := 0;
begin
  while v_id is not null and v_passos < 30 loop
    if exists (
      select 1 from public.comite_pedidos p
       where p.tenant_id = p_tenant_id and p.tipo = 'pp' and p.pp_a_emitir_id = v_id
         and p.status = 'aprovado'
         and (p.snapshot->>'valor')::numeric >= p_valor - 0.005
    ) then
      return true;
    end if;
    select a.refaz_pp_id into v_id
      from public.pedidos_compra_a_emitir a
     where a.id = v_id and a.tenant_id = p_tenant_id;
    if not found then v_id := null; end if;
    v_passos := v_passos + 1;
  end loop;
  return false;
end;
$$;

-- O retrato da PP do pedido: valor da PP a emitir, orçado e realizado do
-- item com ela (as outras PPs ativas, menos devoluções de verba aprovadas).
create or replace function public.comite_retrato_da_pp(p_a_emitir_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_a public.pedidos_compra_a_emitir;
  v_orcado numeric;
  v_planejado numeric;
  v_lv boolean;
  v_outras numeric;
  v_devolvido numeric;
  v_realizado numeric;
begin
  select * into v_a from public.pedidos_compra_a_emitir where id = p_a_emitir_id;
  if not found then return '{}'::jsonb; end if;
  select o.total_orcado, o.total_planejado, o.linha_vermelha into v_orcado, v_planejado, v_lv
    from public.jobs_itens_realizado r
    join public.jobs_itens_orcado o
      on o.id = r.job_item_orcado_id
      or (r.job_item_orcado_id is null and o.item_versao_id = r.item_id and o.job_id = r.job_id)
   where r.id = v_a.item_realizado_id and r.tenant_id = v_a.tenant_id and o.tenant_id = v_a.tenant_id;
  select coalesce(sum(p.valor), 0) into v_outras
    from public.pedidos_compra p
   where p.item_realizado_id = v_a.item_realizado_id and p.tenant_id = v_a.tenant_id
     and p.id <> v_a.id and p.status <> 'cancelada'
     and p.id is distinct from v_a.refaz_pp_id;
  select coalesce(sum(pv.valor_devolvido), 0) into v_devolvido
    from public.pp_verba_prestacoes pv
    join public.pedidos_compra p on p.id = pv.pedido_compra_id
   where p.item_realizado_id = v_a.item_realizado_id and p.tenant_id = v_a.tenant_id
     and p.status <> 'cancelada' and pv.status = 'aprovada';
  v_realizado := round(v_outras - v_devolvido + v_a.valor, 2);
  return jsonb_build_object(
    'valor', v_a.valor,
    'orcado', coalesce(v_orcado, 0),
    'planejado', coalesce(v_planejado, 0),
    'ja_em_pps', round(v_outras - v_devolvido, 2),
    'realizado', v_realizado,
    'excesso', round(v_realizado - coalesce(v_orcado, 0), 2),
    'linha_vermelha', coalesce(v_lv, false)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Pedidos: quem cria, quem decide, o que muda
-- ---------------------------------------------------------------------------

create or replace function public.comite_pedido_guarda()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lim record;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pendente' then
      raise exception 'O pedido ao Comitê nasce pendente.';
    end if;
    if (select auth.uid()) is not null then
      new.enviado_por := (select auth.uid());
    end if;
    new.enviado_em := now();
    new.decidido_por := null;
    new.decidido_em := null;
    new.comentario := null;
    if new.tipo = 'versao' then
      select v.orcamento_id into new.orcamento_id
        from public.versoes_orcamento v
       where v.id = new.versao_orcamento_id and v.tenant_id = new.tenant_id;
      if new.orcamento_id is null then
        raise exception 'Versão não encontrada.';
      end if;
      select l.itens_acima, l.resultado_geral into v_lim
        from public.versao_limites(new.versao_orcamento_id) l;
      new.snapshot := jsonb_build_object('itens_acima', v_lim.itens_acima, 'resultado_geral', v_lim.resultado_geral);
    else
      select a.job_id, a.item_realizado_id into new.job_id, new.item_realizado_id
        from public.pedidos_compra_a_emitir a
       where a.id = new.pp_a_emitir_id and a.tenant_id = new.tenant_id and a.excluida_em is null and a.pp_id is null;
      if new.job_id is null then
        raise exception 'PP a emitir não encontrada.';
      end if;
      new.snapshot := public.comite_retrato_da_pp(new.pp_a_emitir_id);
    end if;
    return new;
  end if;

  -- UPDATE: só sai de pendente, e o alvo não muda.
  if old.status <> 'pendente' then
    raise exception 'Este pedido ao Comitê já foi encerrado.' using errcode = '42501';
  end if;
  if new.tenant_id <> old.tenant_id or new.tipo <> old.tipo
     or new.versao_orcamento_id is distinct from old.versao_orcamento_id
     or new.orcamento_id is distinct from old.orcamento_id
     or new.pp_a_emitir_id is distinct from old.pp_a_emitir_id
     or new.job_id is distinct from old.job_id
     or new.item_realizado_id is distinct from old.item_realizado_id
     or new.enviado_por <> old.enviado_por or new.enviado_em <> old.enviado_em
     or new.motivo <> old.motivo then
    raise exception 'O pedido ao Comitê não pode ser alterado.' using errcode = '42501';
  end if;

  if new.status = 'cancelado' then
    -- Cancelar o envio: quem pode editar a versão ou a PP (a mesma regra
    -- da tela, conferida na action); a RLS já restringe ao tenant.
    new.decidido_por := null;
    new.decidido_em := null;
    new.snapshot := old.snapshot;
  elsif new.status in ('aprovado', 'devolvido') then
    if (select auth.uid()) is not null and not public.pode_decidir_no_comite(old.tenant_id) then
      raise exception 'Só um membro do Comitê de Aprovações decide este pedido.' using errcode = '42501';
    end if;
    new.decidido_por := coalesce((select auth.uid()), new.decidido_por);
    new.decidido_em := now();
    -- O retrato que vale é o do momento da decisão (a versão estava
    -- travada; a PP a emitir pode ter sido salva de novo antes).
    if old.tipo = 'versao' then
      select l.itens_acima, l.resultado_geral into v_lim
        from public.versao_limites(old.versao_orcamento_id) l;
      new.snapshot := jsonb_build_object('itens_acima', v_lim.itens_acima, 'resultado_geral', v_lim.resultado_geral);
    else
      new.snapshot := public.comite_retrato_da_pp(old.pp_a_emitir_id);
    end if;
  elsif new.status = 'pendente' then
    new.snapshot := old.snapshot;
  end if;
  return new;
end;
$$;
create trigger trg_comite_pedido_guarda
before insert or update on public.comite_pedidos
for each row execute function public.comite_pedido_guarda();

-- Versão aguardando o Comitê é só leitura.
create or replace function public.comite_trava_versao_pendente()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_versao uuid;
begin
  if (select auth.uid()) is null then return coalesce(new, old); end if;
  if tg_table_name = 'versoes_orcamento' then
    v_versao := new.id;
  elsif tg_op = 'DELETE' then
    v_versao := old.versao_orcamento_id;
  else
    v_versao := new.versao_orcamento_id;
  end if;
  if exists (
    select 1 from public.comite_pedidos p
     where p.versao_orcamento_id = v_versao and p.status = 'pendente'
  ) then
    raise exception 'A versão está aguardando aprovação do Comitê. Cancele o envio para editar.'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger trg_itens_comite_trava_versao_pendente
before insert or update or delete on public.versoes_orcamento_itens
for each row execute function public.comite_trava_versao_pendente();
create trigger trg_grupos_comite_trava_versao_pendente
before insert or update or delete on public.versoes_orcamento_grupos
for each row execute function public.comite_trava_versao_pendente();
create trigger trg_versao_comite_trava_parametros
before update of percentual_imposto, percentual_honorarios, percentual_int_taxes,
  int_transaction_costs, base_honorarios, percentual_veiculo, moeda_estrangeira,
  cambio_compra, cambio_cotacao, cambio_venda, cambio_data
on public.versoes_orcamento
for each row execute function public.comite_trava_versao_pendente();

-- ---------------------------------------------------------------------------
-- As travas da 204, agora com o Comitê
-- ---------------------------------------------------------------------------

create or replace function public.versao_confere_limites_na_aprovacao()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sit jsonb;
begin
  if new.status <> 'aprovada' or old.status = 'aprovada' then return new; end if;
  v_sit := public.comite_situacao_da_versao(new.id);
  if v_sit is null or not coalesce((v_sit->>'regra')::boolean, false) then return new; end if;
  if (v_sit->>'direto')::boolean or (v_sit->>'coberta')::boolean then return new; end if;
  raise exception 'Esta versão precisa da aprovação do Comitê de Aprovações: %. Solicite a aprovação.',
    concat_ws(' e ',
      case when (v_sit->>'planejado')::boolean then 'há item com planejado acima do orçado' end,
      case when (v_sit->>'resultado')::boolean
        then 'o resultado geral está abaixo de '
             || replace(replace(to_char((v_sit->>'resultado_minimo')::numeric, 'FM990.0'), '.0', ''), '.', ',') || '%' end)
    using errcode = '42501';
end;
$$;

create or replace function public.pp_confere_orcado_na_geracao()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_orcado numeric;
  v_realizado numeric;
  v_devolvido numeric;
  v_linha_vermelha boolean;
  v_cfg public.comite_config;
  v_excesso numeric;
begin
  if new.status = 'cancelada' then return new; end if;
  -- Enviar a PP já gerada não reabre a autorização da geração. A edição
  -- dos valores/âncora, inclusive em chamadas diretas, confere novamente.
  if tg_op = 'UPDATE' and new.status <> 'gerada'
     and old.status <> 'cancelada'
     and new.valor is not distinct from old.valor
     and new.item_realizado_id is not distinct from old.item_realizado_id
     and new.tenant_id is not distinct from old.tenant_id then return new; end if;

  -- Todos os autores (inclusive admin) serializam a escrita na mesma
  -- âncora, antes da soma. Duas PPs concorrentes não podem usar o mesmo
  -- saldo. O recálculo existente também atualiza esta linha.
  perform 1 from public.jobs_itens_realizado
   where id = new.item_realizado_id and tenant_id = new.tenant_id for update;
  select o.total_orcado, o.linha_vermelha into v_orcado, v_linha_vermelha
    from public.jobs_itens_realizado r
    join public.jobs_itens_orcado o
      on o.id = r.job_item_orcado_id
      or (r.job_item_orcado_id is null and o.item_versao_id = r.item_id and o.job_id = r.job_id)
   where r.id = new.item_realizado_id and r.tenant_id = new.tenant_id
     and o.tenant_id = new.tenant_id;
  if v_orcado is null then
    raise exception 'Não foi possível conferir o orçado do item da PP.';
  end if;

  v_cfg := public.comite_regras(new.tenant_id);
  if v_cfg.admin_direto and public.is_tenant_admin(new.tenant_id) then return new; end if;
  if not v_cfg.pp_ligado then return new; end if;
  -- Linha vermelha: orçado zero por definição; só vai ao Comitê se a regra
  -- dela estiver ligada.
  if v_linha_vermelha and not v_cfg.linhas_vermelhas then return new; end if;

  select coalesce(sum(p.valor), 0) + new.valor into v_realizado
    from public.pedidos_compra p
   where p.item_realizado_id = new.item_realizado_id and p.tenant_id = new.tenant_id
     and p.id <> new.id and p.status <> 'cancelada';
  select coalesce(sum(pv.valor_devolvido), 0) into v_devolvido
    from public.pp_verba_prestacoes pv
    join public.pedidos_compra p on p.id = pv.pedido_compra_id
   where p.item_realizado_id = new.item_realizado_id and p.tenant_id = new.tenant_id
     and (p.status <> 'cancelada' or p.id = new.id) and pv.status = 'aprovada';
  v_excesso := round(v_realizado - v_devolvido, 2) - v_orcado;
  if v_excesso <= 0.005 then return new; end if;
  if v_cfg.tolerancia_ligada
     and v_excesso <= v_cfg.tolerancia_valor + 0.005
     and v_excesso <= v_orcado * v_cfg.tolerancia_pct / 100 + 0.005 then
    return new;
  end if;
  if public.comite_pp_aprovada(new.tenant_id, new.id, new.valor) then return new; end if;
  raise exception 'Esta PP precisa da aprovação do Comitê de Aprovações: o realizado acumulado do item ultrapassa o orçado. Salve a PP a emitir e solicite a aprovação.' using errcode = '42501';
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------

revoke all on function public.comite_regras(uuid) from public, anon;
revoke all on function public.is_comite_membro(uuid) from public, anon;
revoke all on function public.pode_decidir_no_comite(uuid) from public, anon;
revoke all on function public.versao_limites(uuid) from public, anon, authenticated;
revoke all on function public.comite_situacao_da_versao(uuid) from public, anon;
revoke all on function public.comite_pp_aprovada(uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.comite_retrato_da_pp(uuid) from public, anon, authenticated;
revoke all on function public.comite_pedido_guarda() from public, anon, authenticated;
revoke all on function public.comite_trava_versao_pendente() from public, anon, authenticated;
revoke all on function public.versao_confere_limites_na_aprovacao() from public, anon, authenticated;
revoke all on function public.pp_confere_orcado_na_geracao() from public, anon, authenticated;
grant execute on function public.comite_regras(uuid) to authenticated;
grant execute on function public.is_comite_membro(uuid) to authenticated;
grant execute on function public.pode_decidir_no_comite(uuid) to authenticated;
grant execute on function public.comite_situacao_da_versao(uuid) to authenticated;

alter table public.comite_config enable row level security;
alter table public.comite_membros enable row level security;
alter table public.comite_pedidos enable row level security;

revoke all on public.comite_config, public.comite_membros, public.comite_pedidos from anon;
grant select, insert, update on public.comite_config to authenticated;
grant select, insert, delete on public.comite_membros to authenticated;
grant select, insert, update on public.comite_pedidos to authenticated;

-- Regras: todos do tenant leem (a tela de quem envia precisa delas);
-- membros e administradores alteram.
create policy comite_config_select on public.comite_config for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy comite_config_insert on public.comite_config for insert to authenticated
  with check (public.pode_decidir_no_comite(tenant_id));
create policy comite_config_update on public.comite_config for update to authenticated
  using (public.pode_decidir_no_comite(tenant_id))
  with check (public.pode_decidir_no_comite(tenant_id));

create policy comite_membros_select on public.comite_membros for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy comite_membros_insert on public.comite_membros for insert to authenticated
  with check (public.pode_decidir_no_comite(tenant_id));
create policy comite_membros_delete on public.comite_membros for delete to authenticated
  using (public.pode_decidir_no_comite(tenant_id));

-- Pedidos: o tenant lê (quem enviou acompanha), freelancer não.
create policy comite_pedidos_select on public.comite_pedidos for select to authenticated
  using (public.is_tenant_member(tenant_id) and public.session_role() <> 'freelancer');
create policy comite_pedidos_insert on public.comite_pedidos for insert to authenticated
  with check (public.is_tenant_member(tenant_id) and public.session_role() <> 'freelancer'
              and enviado_por = (select auth.uid()));
create policy comite_pedidos_update on public.comite_pedidos for update to authenticated
  using (public.is_tenant_member(tenant_id) and public.session_role() <> 'freelancer')
  with check (public.is_tenant_member(tenant_id) and public.session_role() <> 'freelancer');

commit;
