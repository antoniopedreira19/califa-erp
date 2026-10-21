-- =============================================================================
-- O extrato importado do banco (task 029, fase 3, entrega 3A: M3.1 a M3.4;
-- decisões 198 e 199)
-- =============================================================================
-- O financeiro importa o OFX da conta; cada movimento vira uma linha do
-- extrato do banco, que a Conciliação automática (aba Banco) põe ao lado do
-- que o sistema tem.
--
-- • `extrato_importacoes` (M3.1): um registro por arquivo importado, com o
--   cabeçalho dele (banco, conta, período, quando o banco gerou o arquivo e o
--   saldo informado). O conteúdo cru do arquivo NÃO é guardado: só as linhas.
-- • `extrato_linhas` (M3.2): um movimento por linha, sem repetir. O FITID do
--   Santander muda a cada download (carrega a hora da exportação), então a
--   linha se reconhece por uma impressão digital (conta, data, valor em
--   centavos, histórico normalizado e posição entre os iguais), montada em
--   `lib/conciliacao/ofx.ts`. Reimportar o mesmo dia não duplica nada.
-- • `lancamentos_financeiros.extrato_linha_id` (M3.3, opção A do Tiago,
--   21/10/2026): o lançamento conciliado aponta para a linha do banco.
--   Várias baixas numa linha (lote, soma de títulos, guia com rateio, a baixa
--   e os juros dela): o vínculo é N:1, e "conciliado" é a coluna preenchida.
--   Só as funções da conciliação gravam a coluna (trava abaixo).
-- • Cancelar uma baixa conciliada (M3.8, opção A): apagar o lançamento já o
--   desliga da linha, porque a ligação mora nele. O gatilho
--   `trg_lancamento_desliga_a_linha` desliga também os OUTROS lançamentos da
--   mesma linha (o resto do lote, da guia) e marca a linha `sem_auto`: ela
--   volta inteira para a aba Banco e não se resolve mais sozinha.
-- • `extrato_regras` (M3.4): o começo do histórico do banco que vira um
--   lançamento ("TAR" → tarifa bancária). Semente, como no protótipo: "TAR" →
--   04 · Custo Fixo · Tarifa bancária e "IOF" → 11 · Despesa com Juros, em cada
--   conta que tem empresa (a tarifa leva a empresa da conta).
-- • `importar_extrato` grava a importação e as linhas novas numa transação
--   só, confere a conta do arquivo (agência e número) e audita.
--
-- Acesso: só admin e financeiro leem (RLS); a escrita é só pelas funções
-- SECURITY DEFINER, com a trava de papel. GRANT de select para
-- `authenticated`, nada para `anon`.
--
-- Mudança ADITIVA: tabelas, coluna nova, índices, gatilhos e funções novos.
-- Os gatilhos em `lancamentos_financeiros` (tabela compartilhada) só olham a
-- coluna nova: nenhuma regra existente muda.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A trava de papel da conciliação
-- -----------------------------------------------------------------------------
create or replace function public._exige_financeiro_conciliacao(p_tenant_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sessão inválida.';
  end if;
  if not (public.is_tenant_admin(p_tenant_id) or public.is_tenant_financeiro(p_tenant_id)) then
    raise exception 'Só admin ou financeiro concilia o extrato do banco.'
      using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

revoke all on function public._exige_financeiro_conciliacao(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. As importações
-- -----------------------------------------------------------------------------
create table public.extrato_importacoes (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete restrict,
  conta_bancaria_id   uuid not null references public.contas_bancarias(id) on delete restrict,
  arquivo_nome        text not null check (length(btrim(arquivo_nome)) between 1 and 255),
  banco_id            text,
  conta_no_arquivo    text,
  periodo_inicio      date,
  periodo_fim         date,
  gerado_em           timestamptz,
  saldo_banco         numeric(14, 2),
  saldo_em            date,
  qtd_movimentos      integer not null check (qtd_movimentos >= 0),
  qtd_novos           integer not null default 0 check (qtd_novos >= 0),
  importado_por       uuid not null references public.profiles(id),
  created_at          timestamptz not null default now()
);

comment on table public.extrato_importacoes is
  'Um registro por arquivo OFX importado na Conciliação (decisão 198): o cabeçalho do arquivo. O conteúdo cru não é guardado; os movimentos ficam em extrato_linhas.';

create index idx_extrato_importacoes_conta on public.extrato_importacoes (tenant_id, conta_bancaria_id, periodo_fim);
create index idx_extrato_importacoes_autor on public.extrato_importacoes (importado_por);

-- -----------------------------------------------------------------------------
-- 3. As linhas do extrato do banco
-- -----------------------------------------------------------------------------
create table public.extrato_linhas (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete restrict,
  conta_bancaria_id   uuid not null references public.contas_bancarias(id) on delete restrict,
  -- A primeira importação que trouxe a linha.
  importacao_id       uuid not null references public.extrato_importacoes(id) on delete restrict,
  digital             text not null check (length(digital) between 10 and 600),
  data                date not null,
  -- Com sinal: o que sai é negativo, como no OFX.
  valor               numeric(14, 2) not null,
  tipo                text,
  historico           text not null default '',
  documento           text,
  fitid               text,
  ordem               integer not null check (ordem >= 0),
  -- A solução da linha.
  ignorada_em         timestamptz,
  ignorada_por        uuid references public.profiles(id),
  motivo_ignorada     text,
  resolvida_sozinha   text check (resolvida_sozinha in ('manual', 'titulo', 'remessa', 'regra')),
  -- A avaliação única da importação: o que já foi avaliado não se resolve
  -- sozinho de novo.
  avaliada_em         timestamptz,
  -- Alguém desfez a solução: a linha não se resolve mais sozinha.
  sem_auto            boolean not null default false,
  created_at          timestamptz not null default now(),
  constraint uq_extrato_linhas_digital unique (tenant_id, conta_bancaria_id, digital),
  constraint chk_extrato_linha_ignorada check ((ignorada_em is null) = (ignorada_por is null))
);

comment on table public.extrato_linhas is
  'Os movimentos dos extratos importados, um por linha, sem repetir (impressão digital). Conciliada é a linha com lançamento ligado (lancamentos_financeiros.extrato_linha_id) ou ignorada (decisões 198 e 199).';

create index idx_extrato_linhas_conta_data on public.extrato_linhas (tenant_id, conta_bancaria_id, data);
create index idx_extrato_linhas_importacao on public.extrato_linhas (importacao_id);
create index idx_extrato_linhas_ignorada_por on public.extrato_linhas (ignorada_por) where ignorada_por is not null;

-- -----------------------------------------------------------------------------
-- 4. As regras do histórico
-- -----------------------------------------------------------------------------
create table public.extrato_regras (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete restrict,
  -- Nula: vale em todas as contas.
  conta_bancaria_id       uuid references public.contas_bancarias(id) on delete restrict,
  -- O começo do histórico, normalizado (maiúsculas, sem acento).
  padrao                  text not null check (length(btrim(padrao)) between 2 and 80),
  plano_conta_tipo_id     uuid not null references public.plano_contas_tipos(id) on delete restrict,
  plano_conta_subtipo_id  uuid not null references public.plano_contas_subtipos(id) on delete restrict,
  empresa_id              uuid not null references public.empresas(id) on delete restrict,
  usos                    integer not null default 0 check (usos >= 0),
  ativa                   boolean not null default true,
  criada_por              uuid references public.profiles(id),
  created_at              timestamptz not null default now()
);

comment on table public.extrato_regras is
  'O começo do histórico do banco que vira um lançamento na Conciliação automática ("TAR" → tarifa bancária). Decisão 199.';

create index idx_extrato_regras_conta on public.extrato_regras (tenant_id, conta_bancaria_id) where ativa;
create index idx_extrato_regras_tipo on public.extrato_regras (plano_conta_tipo_id);
create index idx_extrato_regras_subtipo on public.extrato_regras (plano_conta_subtipo_id);
create index idx_extrato_regras_empresa on public.extrato_regras (empresa_id);
create index idx_extrato_regras_criada_por on public.extrato_regras (criada_por) where criada_por is not null;
create unique index uq_extrato_regras_padrao on public.extrato_regras (tenant_id, coalesce(conta_bancaria_id, '00000000-0000-0000-0000-000000000000'::uuid), padrao) where ativa;

-- A semente do protótipo, nas contas com empresa (a tarifa leva a empresa
-- da conta): "TAR" → 04 · Tarifa bancária; "IOF" → 11 · Despesa com Juros.
insert into public.extrato_regras (tenant_id, conta_bancaria_id, padrao, plano_conta_tipo_id, plano_conta_subtipo_id, empresa_id)
select c.tenant_id, c.id, r.padrao, t.id, s.id, c.empresa_id
  from public.contas_bancarias c
  cross join (values ('TAR', '04', '012'), ('IOF', '11', '999')) as r(padrao, tipo, subtipo)
  join public.plano_contas_tipos t on t.tenant_id = c.tenant_id and t.codigo = r.tipo
  join public.plano_contas_subtipos s on s.tipo_id = t.id and s.codigo = r.subtipo
 where c.empresa_id is not null
   and c.cartao_credito_id is null
   and c.tipo <> 'cartao_credito';

-- -----------------------------------------------------------------------------
-- 5. RLS e GRANTs: só admin e financeiro leem; escrita só pelas funções
-- -----------------------------------------------------------------------------
alter table public.extrato_importacoes enable row level security;
alter table public.extrato_linhas enable row level security;
alter table public.extrato_regras enable row level security;

create policy extrato_importacoes_select on public.extrato_importacoes
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids())
         and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)));

create policy extrato_linhas_select on public.extrato_linhas
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids())
         and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)));

create policy extrato_regras_select on public.extrato_regras
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids())
         and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)));

revoke all on public.extrato_importacoes, public.extrato_linhas, public.extrato_regras from public, anon, authenticated;
grant select on public.extrato_importacoes, public.extrato_linhas, public.extrato_regras to authenticated;

-- -----------------------------------------------------------------------------
-- 6. O lançamento conciliado aponta para a linha do banco (M3.3)
-- -----------------------------------------------------------------------------
alter table public.lancamentos_financeiros
  add column extrato_linha_id uuid references public.extrato_linhas(id) on delete restrict;

comment on column public.lancamentos_financeiros.extrato_linha_id is
  'A linha do extrato do banco com que este lançamento está conciliado (decisão 199). Várias baixas numa linha: lote, soma, guia com rateio, a baixa e os juros dela. Só as funções da conciliação gravam.';

create index idx_lancamentos_extrato_linha on public.lancamentos_financeiros (extrato_linha_id)
  where extrato_linha_id is not null;

-- Só as funções da conciliação (SECURITY DEFINER, que rodam como o dono)
-- ligam ou desligam: o `authenticated` tem UPDATE na tabela por outras telas.
create or replace function public.lancamento_so_a_conciliacao_liga()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (tg_op = 'INSERT' and new.extrato_linha_id is not null
          or tg_op = 'UPDATE' and new.extrato_linha_id is distinct from old.extrato_linha_id) then
    raise exception 'A conciliação com o banco só muda pela aba Banco da Conciliação.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_lancamento_so_a_conciliacao_liga
  before insert or update of extrato_linha_id on public.lancamentos_financeiros
  for each row execute function public.lancamento_so_a_conciliacao_liga();

-- Cancelar uma baixa conciliada (M3.8, opção A): o lançamento apagado leva a
-- ligação junto; os outros da mesma linha se desligam também, e a linha volta
-- inteira para a aba Banco, sem se resolver sozinha de novo.
create or replace function public.lancamento_desliga_a_linha()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.lancamentos_financeiros
     set extrato_linha_id = null
   where extrato_linha_id = old.extrato_linha_id
     and id <> old.id;
  update public.extrato_linhas
     set sem_auto = true,
         resolvida_sozinha = null
   where id = old.extrato_linha_id;
  return old;
end;
$$;

revoke all on function public.lancamento_desliga_a_linha() from public, anon, authenticated;
revoke all on function public.lancamento_so_a_conciliacao_liga() from public, anon, authenticated;

create trigger trg_lancamento_desliga_a_linha
  after delete on public.lancamentos_financeiros
  for each row
  when (old.extrato_linha_id is not null)
  execute function public.lancamento_desliga_a_linha();

-- -----------------------------------------------------------------------------
-- 7. Importar o extrato
-- -----------------------------------------------------------------------------
-- `p_arquivo`: o cabeçalho lido do OFX —
--   {nome, banco_id, conta, inicio, fim, gerado_em, saldo, saldo_em,
--    linhas: [{digital, data, valor, tipo, historico, documento, fitid, ordem}]}
-- A impressão digital é montada no servidor da aplicação
-- (`lib/conciliacao/ofx.ts`), com a conta. As linhas que já existem (mesma
-- digital) ficam de fora.
create or replace function public.importar_extrato(p_conta_bancaria_id uuid, p_arquivo jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid;
  v_conta      contas_bancarias%rowtype;
  v_acct       text := regexp_replace(coalesce(p_arquivo->>'conta', ''), '\D', '', 'g');
  v_cadastro   text;
  v_numero     text;
  v_linhas     jsonb := coalesce(p_arquivo->'linhas', '[]'::jsonb);
  v_total      integer;
  v_novos      integer;
  v_imp_id     uuid;
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  v_uid := public._exige_financeiro_conciliacao(v_conta.tenant_id);

  if v_conta.cartao_credito_id is not null or v_conta.tipo = 'cartao_credito' then
    raise exception 'A fatura do cartão não se importa por aqui: o extrato é de conta bancária.';
  end if;
  if not v_conta.ativo then raise exception 'A conta % está inativa.', v_conta.nome; end if;

  -- A conta vem do arquivo e não se troca: agência e número, com o dígito.
  v_numero := regexp_replace(coalesce(v_conta.numero_conta, '') || coalesce(v_conta.numero_conta_dv, ''), '\D', '', 'g');
  v_cadastro := regexp_replace(coalesce(v_conta.agencia, ''), '\D', '', 'g') || v_numero;
  if length(v_numero) < 4 then
    raise exception 'Cadastre a agência e o número da conta % para importar o extrato dela.', v_conta.nome;
  end if;
  if v_acct = '' or not (v_acct = v_cadastro or right(v_acct, length(v_numero)) = v_numero) then
    raise exception 'Este extrato é de outra conta (final %): abra a conta dele para importar.',
      coalesce(nullif(right(v_acct, 4), ''), '?');
  end if;

  if jsonb_typeof(v_linhas) <> 'array' then raise exception 'Arquivo sem movimentos.'; end if;
  v_total := jsonb_array_length(v_linhas);
  if v_total > 5000 then
    raise exception 'O arquivo tem % movimentos: importe um período menor (até 5.000).', v_total;
  end if;

  insert into public.extrato_importacoes (
    tenant_id, conta_bancaria_id, arquivo_nome, banco_id, conta_no_arquivo,
    periodo_inicio, periodo_fim, gerado_em, saldo_banco, saldo_em, qtd_movimentos, importado_por
  ) values (
    v_conta.tenant_id, v_conta.id, substring(coalesce(nullif(btrim(p_arquivo->>'nome'), ''), 'extrato.ofx'), 1, 255),
    nullif(p_arquivo->>'banco_id', ''), v_acct,
    nullif(p_arquivo->>'inicio', '')::date, nullif(p_arquivo->>'fim', '')::date,
    nullif(p_arquivo->>'gerado_em', '')::timestamptz,
    nullif(p_arquivo->>'saldo', '')::numeric, nullif(p_arquivo->>'saldo_em', '')::date,
    v_total, v_uid
  )
  returning id into v_imp_id;

  with novas as (
    insert into public.extrato_linhas (
      tenant_id, conta_bancaria_id, importacao_id, digital, data, valor,
      tipo, historico, documento, fitid, ordem
    )
    select v_conta.tenant_id, v_conta.id, v_imp_id, l->>'digital', (l->>'data')::date,
           round((l->>'valor')::numeric, 2),
           nullif(l->>'tipo', ''), coalesce(l->>'historico', ''), nullif(l->>'documento', ''),
           nullif(l->>'fitid', ''), coalesce((l->>'ordem')::integer, 0)
      from jsonb_array_elements(v_linhas) l
    on conflict (tenant_id, conta_bancaria_id, digital) do nothing
    returning 1
  )
  select count(*)::int into v_novos from novas;

  update public.extrato_importacoes set qtd_novos = v_novos where id = v_imp_id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_conta.tenant_id, 'extrato_importacao', v_imp_id::text, 'extrato.importado', v_uid,
          jsonb_build_object('conta_bancaria_id', v_conta.id, 'arquivo', p_arquivo->>'nome',
                             'periodo_inicio', p_arquivo->>'inicio', 'periodo_fim', p_arquivo->>'fim',
                             'movimentos', v_total, 'novos', v_novos));

  return jsonb_build_object('importacao_id', v_imp_id, 'movimentos', v_total, 'novos', v_novos);
end;
$$;

comment on function public.importar_extrato(uuid, jsonb) is
  'Importa o extrato OFX lido pela aplicação: grava a importação e as linhas novas (sem repetir pela impressão digital), confere a conta do arquivo e audita (decisão 198).';

revoke all on function public.importar_extrato(uuid, jsonb) from public, anon;
grant execute on function public.importar_extrato(uuid, jsonb) to authenticated;
