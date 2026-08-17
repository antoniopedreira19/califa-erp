-- =====================================================================
-- Tela 3.3 — Contas a Receber: faturamento agrupado, parcial e avulso
-- =====================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- O protótipo "Contas a Receber - Faturamento Agrupado" pede quatro
-- coisas que o modelo atual não sustenta:
--
--   1. UMA NF COBRINDO VÁRIOS JOBS. Hoje `faturamentos.origem_id` é um
--      uuid só — não há onde escrever "esta nota cobre JOB-A e JOB-B",
--      nem quanto foi de cada um.
--   2. FATURAMENTO PARCIAL com saldo remanescente. O saldo por job já é
--      calculado (`vw_faturamento_pendente`), mas contra o valor TOTAL da
--      nota; com nota agrupada isso passa a mentir.
--   3. O JOB FATURADO EM PARCELAS. A aba Faturamento do protótipo tem uma
--      linha por parcela (JOB-0013 aparece em "2/3" e "3/3", cada uma com
--      seu vencimento). Hoje o envio para faturamento carrega um valor e
--      uma data só.
--   4. PREVISÃO DE RECEBIMENTO DO TÍTULO, editável, preservando a
--      primeira registrada — espelho exato do que a decisão 016 fez do
--      lado do contas a pagar.
--
-- DECISÕES DO TIAGO QUE ESTA MIGRATION MATERIALIZA (17/08/2026)
--
-- • O PARCELAMENTO DO FATURAMENTO É INFORMADO PELA PRODUÇÃO NO ENVIO.
--   Não vem da previsão de recebimento da abertura (`jobs_previsao_
--   recebimento`, decisão 015), que continua sendo outra coisa: quando
--   esperamos o dinheiro entrar, não em quantas notas o job será
--   faturado. Daí a tabela nova `jobs_envio_faturamento_parcelas`.
--
-- • TIPO E SUBTIPO SAEM DO FORMULÁRIO DE FATURAMENTO E PASSAM A SER
--   PEDIDOS NA BAIXA DO TÍTULO A RECEBER. É a mesma leitura da decisão
--   016 §6 ("centro de custo" = plano de contas), agora do lado da
--   entrada: quem define onde a RECEITA cai no DRE é a baixa, que é
--   quando o dinheiro existe de fato. Consequência estrutural: as duas
--   colunas de plano de contas em `faturamentos` deixam de ser
--   obrigatórias.
--
-- • CONTATO DE COBRANÇA (`jobs_contatos`, Tela 1.6) NÃO ENTRA nesta
--   tela. A pendência P1 do plano segue aberta, de propósito.
--
-- O QUE DELIBERADAMENTE FICOU DE FORA
--
-- • NENHUMA COLUNA É REMOVIDA. `faturamentos.serie` continua existindo e
--   populada (ganha default '1'); ela só sai das telas, como o protótipo
--   pede. `plano_conta_tipo_id`/`_subtipo_id` continuam existindo e
--   continuam sendo gravadas no faturamento avulso, onde o protótipo
--   pede "Centro de custo".
-- • NENHUMA "NF PROGRAMADA". O modelo de 1 NF por parcela de recebimento
--   foi avaliado e descartado pelo Tiago (notas de implementação §4).
--   Quem não quer faturar tudo agora usa o faturamento parcial.
-- • `dar_baixa_titulo` e `estornar_baixa_titulo` (as antigas) continuam
--   existindo e funcionando. A UI passa a usar a versão com plano de
--   contas; apagar função é destrutivo e não traz ganho.
--
-- ÚNICO ITEM DO LADO DESTRUTIVO DA LINHA (`CLAUDE.local.md`)
--
-- O CHECK `chk_faturamento_origem` exige `origem_id NOT NULL` quando
-- `origem_tipo` é 'job' ou 'bv'. NF agrupada não tem uma origem só, e
-- preencher com "o primeiro job" faria a nota inteira ser atribuída a ele
-- em qualquer leitura futura (fluxo de caixa, DRE) — erro silencioso e
-- difícil de achar depois. O CHECK é substituído por uma versão que
-- aceita `origem_id` nulo em job/bv; a verdade passa a morar em
-- `faturamento_itens`. A tabela `faturamentos` tem ZERO linhas hoje,
-- então nenhum dado é tocado.
--
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. jobs_envio_faturamento_parcelas — em quantas notas o job será
--    faturado, com valor e vencimento de cada uma
-- ---------------------------------------------------------------------
--
-- Uma linha por parcela do envio. É ela que vira uma LINHA da aba
-- Faturamento; a nota emitida consome (total ou parcialmente) a parcela,
-- e o saldo remanescente continua na aba.
--
-- `job_id` é redundante com `envio_id -> job_id`, e está aqui de
-- propósito: a view da fila e os índices do fluxo de caixa filtram por
-- job sem precisar de mais um join.

create table if not exists public.jobs_envio_faturamento_parcelas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  envio_id uuid not null
    references public.jobs_envio_faturamento(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  -- Posição da parcela (1, 2, 3...). O envio grava tudo de uma vez, então
  -- a numeração nunca fica com buraco.
  ordem smallint not null,
  valor numeric(14, 2) not null,
  -- Vencimento acordado com o cliente para ESTA parcela. A 1ª nasce da
  -- data de faturamento do envio; as seguintes, +30 dias da anterior.
  data_vencimento date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Parcela zerada é dado esquisito: quem recusa com mensagem legível é a
  -- Server Action; aqui o banco só fecha a porta do absurdo.
  constraint chk_envio_parcela_valor_positivo check (valor > 0),
  constraint chk_envio_parcela_ordem_positiva check (ordem >= 1),
  constraint uniq_envio_parcela_ordem unique (envio_id, ordem)
);

create index if not exists idx_envio_parcela_envio
  on public.jobs_envio_faturamento_parcelas(envio_id);
create index if not exists idx_envio_parcela_job
  on public.jobs_envio_faturamento_parcelas(job_id);
create index if not exists idx_envio_parcela_venc
  on public.jobs_envio_faturamento_parcelas(tenant_id, data_vencimento);

drop trigger if exists trg_envio_parcelas_updated_at
  on public.jobs_envio_faturamento_parcelas;
create trigger trg_envio_parcelas_updated_at
  before update on public.jobs_envio_faturamento_parcelas
  for each row execute function public.set_updated_at();

alter table public.jobs_envio_faturamento_parcelas enable row level security;

drop policy if exists envio_parcelas_select on public.jobs_envio_faturamento_parcelas;
create policy envio_parcelas_select on public.jobs_envio_faturamento_parcelas
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists envio_parcelas_insert on public.jobs_envio_faturamento_parcelas;
create policy envio_parcelas_insert on public.jobs_envio_faturamento_parcelas
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

drop policy if exists envio_parcelas_update on public.jobs_envio_faturamento_parcelas;
create policy envio_parcelas_update on public.jobs_envio_faturamento_parcelas
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

-- Sem DELETE, como em `pedidos_compra_parcelas`: envio é único por job e
-- não tem tela de edição. Apagar parcela já faturada corromperia o saldo.
grant select, insert, update
  on public.jobs_envio_faturamento_parcelas to authenticated;

comment on table public.jobs_envio_faturamento_parcelas is
  'Em quantas notas o job será faturado, com valor e vencimento de cada parcela. Informado pela produção no envio para faturamento. Cada linha é uma linha da aba Faturamento; a NF emitida consome a parcela, total ou parcialmente.';
comment on column public.jobs_envio_faturamento_parcelas.data_vencimento is
  'Vencimento acordado com o cliente para esta parcela. Não confundir com a previsão de recebimento do título, que nasce depois, na emissão da NF.';

-- Backfill dos envios que já existem: uma parcela 1/1, com o valor e a
-- data que o envio já carregava. Preenche o que está vazio — nada é
-- sobrescrito, e o `where not exists` deixa a migration idempotente.
insert into public.jobs_envio_faturamento_parcelas
  (tenant_id, envio_id, job_id, ordem, valor, data_vencimento)
select e.tenant_id, e.id, e.job_id, 1, e.valor_faturado, e.data_faturamento
  from public.jobs_envio_faturamento e
 where e.valor_faturado > 0
   and not exists (
     select 1 from public.jobs_envio_faturamento_parcelas p
      where p.envio_id = e.id
   );


-- ---------------------------------------------------------------------
-- 2. faturamento_itens — o que cada NF cobre, e por quanto
-- ---------------------------------------------------------------------
--
-- É a tabela que permite a NF agrupada e o faturamento parcial ao mesmo
-- tempo: cada linha diz "desta nota, R$ X são do job tal, consumindo a
-- parcela tal". Sem ela, `origem_id` teria que caber N jobs.
--
-- `envio_parcela_id` é o que fecha o saldo. Nulo em BV (que não tem
-- parcelamento de envio) e em avulso (que não consome saldo de ninguém).

create table if not exists public.faturamento_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  faturamento_id uuid not null
    references public.faturamentos(id) on delete cascade,
  origem_tipo faturamento_origem not null,
  -- Job, BV, ou nulo no avulso.
  origem_id uuid,
  -- Parcela do envio que este item consome. Só existe em item de job.
  envio_parcela_id uuid
    references public.jobs_envio_faturamento_parcelas(id) on delete restrict,
  valor numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  constraint chk_fat_item_valor_positivo check (valor > 0),
  constraint chk_fat_item_origem check (
    (origem_tipo = 'avulso' and origem_id is null and envio_parcela_id is null)
    or (origem_tipo = 'bv' and origem_id is not null and envio_parcela_id is null)
    or (origem_tipo = 'job' and origem_id is not null)
  )
);

create index if not exists idx_fat_itens_faturamento
  on public.faturamento_itens(faturamento_id);
create index if not exists idx_fat_itens_origem
  on public.faturamento_itens(origem_tipo, origem_id);
create index if not exists idx_fat_itens_parcela
  on public.faturamento_itens(envio_parcela_id);
create index if not exists idx_fat_itens_tenant
  on public.faturamento_itens(tenant_id);

alter table public.faturamento_itens enable row level security;

drop policy if exists faturamento_itens_select on public.faturamento_itens;
create policy faturamento_itens_select on public.faturamento_itens
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists faturamento_itens_insert on public.faturamento_itens;
create policy faturamento_itens_insert on public.faturamento_itens
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

-- Sem UPDATE e sem DELETE: item de nota emitida não se corrige editando.
-- O caminho é cancelar a NF, que já existe.
grant select, insert on public.faturamento_itens to authenticated;

comment on table public.faturamento_itens is
  'O que cada NF cobre e por quanto. Uma linha por job/BV da nota — é o que permite NF agrupada (vários jobs numa nota) e faturamento parcial (valor menor que o saldo da parcela). A verdade do saldo a faturar mora aqui, não em faturamentos.origem_id.';


-- ---------------------------------------------------------------------
-- 3. faturamentos — origem opcional, plano de contas opcional
-- ---------------------------------------------------------------------
--
-- ⚠️ ÚNICO ITEM DESTRUTIVO DESTA MIGRATION (0 linhas na tabela):
-- o CHECK antigo exigia origem_id em job/bv. Ver o cabeçalho.

alter table public.faturamentos
  drop constraint if exists chk_faturamento_origem;

alter table public.faturamentos
  add constraint chk_faturamento_origem check (
    origem_tipo <> 'avulso' or origem_id is null
  );

comment on column public.faturamentos.origem_id is
  'Origem única da nota, quando existe. NULO em NF agrupada (vários jobs) e em avulso — nesses casos a verdade está em faturamento_itens.';

-- Plano de contas deixa de ser obrigatório: em job/BV ninguém informa (o
-- protótipo não pergunta), e a classificação que vai para o DRE nasce na
-- BAIXA do título, que passou a exigi-la. No avulso continua sendo
-- gravado — é o campo "Centro de custo" do formulário.
alter table public.faturamentos
  alter column plano_conta_tipo_id drop not null;
alter table public.faturamentos
  alter column plano_conta_subtipo_id drop not null;

comment on column public.faturamentos.plano_conta_tipo_id is
  'Classificação da nota. Preenchida no faturamento avulso (campo "Centro de custo" do formulário) e nula em job/BV, onde a classificação que vale é a escolhida na baixa do título a receber (decisão do Tiago, 17/08/2026).';

-- Série sai das telas mas continua existindo e populada. Default no banco
-- para que ninguém precise mandá-la do formulário.
alter table public.faturamentos
  alter column serie set default '1';

comment on column public.faturamentos.serie is
  'Série da NF. Removida das telas na Tela 3.3; continua gravada, com default 1.';


-- ---------------------------------------------------------------------
-- 4. titulos_receber — previsão de recebimento, com a primeira congelada
-- ---------------------------------------------------------------------
--
-- Espelho do que a decisão 016 fez no contas a pagar:
--
--   • VENCIMENTO (`data_vencimento`) — o que a nota diz. IMUTÁVEL: nem a
--     tela nem a action escrevem nele depois da emissão.
--   • PREVISÃO DE RECEBIMENTO (`data_previsao_recebimento`) — quando o
--     financeiro acha que o dinheiro entra. Repactuável pelo lápis.
--   • PRIMEIRA PREVISÃO (`data_previsao_recebimento_primeira`) — o que o
--     pop-up mostra para sempre ao lado do vencimento. Congelada por
--     trigger; promessa de tela não é garantia.

alter table public.titulos_receber
  add column if not exists data_previsao_recebimento date;
alter table public.titulos_receber
  add column if not exists data_previsao_recebimento_primeira date;

comment on column public.titulos_receber.data_previsao_recebimento is
  'Quando o financeiro espera receber. Nasce igual ao vencimento na emissão e é repactuável pelo lápis da aba Títulos a Receber. Quando difere do vencimento, a tela destaca em âmbar.';
comment on column public.titulos_receber.data_previsao_recebimento_primeira is
  'Primeira previsão registrada. Congelada pelo trigger trg_congela_previsao_receb — uma vez gravada, nenhum update a sobrescreve.';

-- Preenche o que está vazio (0 linhas hoje; o comando existe para o caso
-- de a migration rodar num banco que já tenha títulos).
update public.titulos_receber
   set data_previsao_recebimento = data_vencimento
 where data_previsao_recebimento is null;
update public.titulos_receber
   set data_previsao_recebimento_primeira = data_previsao_recebimento
 where data_previsao_recebimento_primeira is null;

create index if not exists idx_titulos_receber_previsao
  on public.titulos_receber(tenant_id, data_previsao_recebimento);

create or replace function public.congela_previsao_recebimento_primeira()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.data_previsao_recebimento_primeira is not null then
    new.data_previsao_recebimento_primeira :=
      old.data_previsao_recebimento_primeira;
  end if;
  -- O vencimento da NF é imutável depois de emitida: o pop-up promete
  -- isso ao usuário, e a promessa é cumprida aqui, não no navegador.
  new.data_vencimento := old.data_vencimento;
  return new;
end;
$$;

comment on function public.congela_previsao_recebimento_primeira() is
  'Congela a 1ª previsão de recebimento e o vencimento da NF em titulos_receber. Qualquer update que tente sobrescrevê-los é revertido para o valor original.';

drop trigger if exists trg_congela_previsao_receb on public.titulos_receber;
create trigger trg_congela_previsao_receb
  before update on public.titulos_receber
  for each row execute function public.congela_previsao_recebimento_primeira();


-- ---------------------------------------------------------------------
-- 5. vw_faturamento_pendente — uma linha por PARCELA do envio
-- ---------------------------------------------------------------------
--
-- Muda a granularidade (era uma linha por job) e a fonte do "já
-- faturado" (era `faturamentos.origem_id`, que não sustenta nota
-- agrupada nem parcial; agora é `faturamento_itens`).
--
-- As 12 colunas antigas continuam com o mesmo nome, tipo e ordem — as
-- novas entram no fim, para o `create or replace` aceitar.

create or replace view public.vw_faturamento_pendente as
with parcela_faturada as (
  select fi.envio_parcela_id,
         sum(fi.valor)::numeric(14,2) as valor_faturado
    from public.faturamento_itens fi
    join public.faturamentos f on f.id = fi.faturamento_id
   where f.status = 'emitido'
     and fi.envio_parcela_id is not null
   group by fi.envio_parcela_id
),
parcelas as (
  select par.id,
         par.envio_id,
         par.job_id,
         par.tenant_id,
         par.ordem,
         par.valor,
         par.data_vencimento,
         count(*) over (partition by par.envio_id)::smallint as total,
         coalesce(pf.valor_faturado, 0)::numeric(14,2) as ja_faturado
    from public.jobs_envio_faturamento_parcelas par
    left join parcela_faturada pf on pf.envio_parcela_id = par.id
)
select 'job'::text                                     as origem_tipo,
       j.id                                            as origem_id,
       j.tenant_id,
       j.empresa_id,
       j.codigo,
       j.nome                                          as descricao,
       p.cliente_id,
       null::uuid                                      as fornecedor_id,
       par.valor::numeric                              as valor_previsto,
       par.ja_faturado                                 as valor_ja_faturado,
       (par.valor - par.ja_faturado)::numeric(14,2)    as saldo,
       par.data_vencimento                             as data_prevista,
       -- Colunas novas da Tela 3.3
       par.id                                          as envio_parcela_id,
       par.ordem                                       as parcela_numero,
       par.total                                       as parcela_total,
       -- "Saldo a faturar · total do job": soma de TODAS as parcelas do
       -- job ainda em aberto, que é o que o protótipo mostra na coluna.
       (select sum(x.valor - x.ja_faturado)::numeric(14,2)
          from parcelas x
         where x.envio_id = par.envio_id
           and x.valor - x.ja_faturado > 0)            as saldo_job
  from parcelas par
  join public.jobs j on j.id = par.job_id
  join public.projetos p on p.id = j.projeto_id
 where j.status = 'aberto'
   and par.valor - par.ja_faturado > 0
union all
select 'bv'::text                                      as origem_tipo,
       bv.id                                           as origem_id,
       bv.tenant_id,
       null::uuid                                      as empresa_id,
       null::text                                      as codigo,
       'BV — '::text || v.item                         as descricao,
       null::uuid                                      as cliente_id,
       bv.fornecedor_id,
       bv.valor                                        as valor_previsto,
       0::numeric(14,2)                                as valor_ja_faturado,
       bv.valor                                        as saldo,
       bv.prazo_repasse                                as data_prevista,
       null::uuid                                      as envio_parcela_id,
       1::smallint                                     as parcela_numero,
       1::smallint                                     as parcela_total,
       bv.valor                                        as saldo_job
  from public.itens_bv bv
  join public.versoes_orcamento_itens v on v.id = bv.item_versao_id
 where bv.situacao = 'confirmado'
   and not exists (
     select 1
       from public.faturamento_itens fi
       join public.faturamentos f on f.id = fi.faturamento_id
      where fi.origem_tipo = 'bv'
        and fi.origem_id = bv.id
        and f.status = 'emitido'
   );

comment on view public.vw_faturamento_pendente is
  'Fila da aba Faturamento: uma linha por parcela do envio ainda com saldo, mais os BVs confirmados. O "já faturado" vem de faturamento_itens, que é o que sustenta NF agrupada e faturamento parcial.';


-- ---------------------------------------------------------------------
-- 6. vw_fluxo_caixa — o título entra pela PREVISÃO, não pelo vencimento
-- ---------------------------------------------------------------------
--
-- Consequência direta da coluna nova: repactuar a previsão sem mover o
-- título no fluxo de caixa esvaziaria o sentido do lápis. Continua sendo
-- view que nenhum código da aplicação lê hoje — quem vai ler é a Tela
-- 3.4.

create or replace view public.vw_fluxo_caixa as
select 'previsto'::text as situacao,
       'pp'::text as origem_tipo,
       par.id as origem_id,
       pp.tenant_id,
       pp.empresa_id,
       null::uuid as conta_bancaria_id,
       par.data_pagamento as data_evento,
       par.valor::numeric(14,2) as valor,
       'saida'::natureza_lancamento as natureza,
       'PP ' || pp.codigo || ' ' || par.numero || '/' || tot.total || ' — '
         || substring(pp.servico, 1, 150) as descricao,
       pp.fornecedor_id,
       null::uuid as cliente_id,
       pp.job_id
  from public.pedidos_compra_parcelas par
  join public.pedidos_compra pp on pp.id = par.pedido_compra_id
  join lateral (
    select count(*)::integer as total
      from public.pedidos_compra_parcelas x
     where x.pedido_compra_id = par.pedido_compra_id
  ) tot on true
 where pp.status = any (array['aprovada'::pp_status, 'pago'::pp_status])
   and par.pago_em is null
union all
select 'previsto'::text,
       case when a.recorrente_id is not null then 'recorrente'::text
            else 'avulsa'::text end,
       a.id,
       a.tenant_id,
       a.empresa_id,
       null::uuid,
       coalesce(a.data_pagamento, a.data_prevista_pagamento),
       a.valor,
       a.natureza,
       a.descricao,
       a.fornecedor_id,
       a.cliente_id,
       a.job_id
  from public.contas_avulsas a
 where a.status = 'aprovada'::conta_avulsa_status
union all
select 'previsto'::text,
       'titulo'::text,
       t.id,
       t.tenant_id,
       t.empresa_id,
       null::uuid,
       -- AQUI: a previsão manda; o vencimento é o retrato da nota.
       coalesce(t.data_previsao_recebimento, t.data_vencimento),
       t.valor,
       'entrada'::natureza_lancamento,
       'Título NF ' || f.numero_nf || '/' || t.numero_parcela::text,
       f.fornecedor_id,
       f.cliente_id,
       null::uuid
  from public.titulos_receber t
  join public.faturamentos f on f.id = t.faturamento_id
 where t.status = 'em_aberto'::titulo_receber_status
union all
select 'realizado'::text,
       'lancamento'::text,
       l.id,
       l.tenant_id,
       l.empresa_id,
       l.conta_bancaria_id,
       l.data_movimento,
       l.valor,
       l.natureza,
       l.descricao,
       l.fornecedor_id,
       l.cliente_id,
       l.job_id
  from public.lancamentos_financeiros l;


-- ---------------------------------------------------------------------
-- 7. emitir_faturamento — agora emite a nota COM SEUS ITENS
-- ---------------------------------------------------------------------
--
-- Redefinida no lugar de criar uma v2: a tabela `faturamentos` está
-- vazia, e manter duas RPCs quase iguais é como as regras divergem.
--
-- O payload ganha `itens`. Quando ele não vem (chamada antiga), o item é
-- derivado de origem_tipo/origem_id/valor_total — o comportamento de
-- antes, preservado.
--
-- O PORTÃO DE FATO é aqui: o valor de cada item não pode passar do saldo
-- da parcela que ele consome. O cliente valida para dar mensagem boa; o
-- servidor valida para valer.

create or replace function public.emitir_faturamento(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_tenant_id      uuid := (payload->>'tenant_id')::uuid;
  v_empresa_id     uuid := (payload->>'empresa_id')::uuid;
  v_origem_tipo    faturamento_origem := (payload->>'origem_tipo')::faturamento_origem;
  v_origem_id      uuid := nullif(payload->>'origem_id', '')::uuid;
  v_cliente_id     uuid := nullif(payload->>'cliente_id', '')::uuid;
  v_fornecedor_id  uuid := nullif(payload->>'fornecedor_id', '')::uuid;
  v_valor_total    numeric(14,2) := (payload->>'valor_total')::numeric;
  v_tipo_id        uuid := nullif(payload->>'plano_conta_tipo_id', '')::uuid;
  v_subtipo_id     uuid := nullif(payload->>'plano_conta_subtipo_id', '')::uuid;
  v_emitido_por    uuid := (payload->>'emitido_por')::uuid;
  v_faturamento_id uuid;
  v_parcelas       jsonb := payload->'parcelas';
  v_itens          jsonb := coalesce(payload->'itens', '[]'::jsonb);
  v_soma_parcelas  numeric(14,2) := 0;
  v_soma_itens     numeric(14,2) := 0;
  v_parcela        jsonb;
  v_item           jsonb;
  v_subtipo_tipo   uuid;
  v_par            jobs_envio_faturamento_parcelas%rowtype;
  v_ja             numeric(14,2);
  v_saldo          numeric(14,2);
  v_codigo         text;
begin
  if not public.is_tenant_member(v_tenant_id) then
    raise exception 'Sem acesso a este tenant.';
  end if;

  if jsonb_array_length(v_parcelas) < 1 then
    raise exception 'Faturamento precisa de pelo menos uma parcela.';
  end if;

  -- Plano de contas virou opcional (só o avulso informa). Quando vem,
  -- continua tendo que ser um par coerente.
  if v_tipo_id is not null or v_subtipo_id is not null then
    if v_tipo_id is null or v_subtipo_id is null then
      raise exception 'Informe tipo e subtipo juntos, ou nenhum dos dois.';
    end if;
    select tipo_id into v_subtipo_tipo
      from public.plano_contas_subtipos where id = v_subtipo_id;
    if not found then raise exception 'Subtipo não encontrado.'; end if;
    if v_subtipo_tipo <> v_tipo_id then
      raise exception 'Subtipo não pertence ao tipo escolhido.';
    end if;
  end if;

  -- Compatibilidade: sem `itens`, a nota cobre a origem inteira.
  if jsonb_array_length(v_itens) = 0 then
    if v_origem_tipo = 'avulso' then
      v_itens := jsonb_build_array(jsonb_build_object(
        'origem_tipo', 'avulso', 'origem_id', null,
        'envio_parcela_id', null, 'valor', v_valor_total));
    else
      v_itens := jsonb_build_array(jsonb_build_object(
        'origem_tipo', v_origem_tipo, 'origem_id', v_origem_id,
        'envio_parcela_id', null, 'valor', v_valor_total));
    end if;
  end if;

  for v_parcela in select * from jsonb_array_elements(v_parcelas)
  loop
    v_soma_parcelas := v_soma_parcelas + (v_parcela->>'valor')::numeric;
  end loop;

  if abs(v_soma_parcelas - v_valor_total) > 0.01 then
    raise exception 'Soma das parcelas (R$ %) não bate com valor total (R$ %).',
      v_soma_parcelas, v_valor_total;
  end if;

  for v_item in select * from jsonb_array_elements(v_itens)
  loop
    v_soma_itens := v_soma_itens + (v_item->>'valor')::numeric;
  end loop;

  if abs(v_soma_itens - v_valor_total) > 0.01 then
    raise exception 'Soma dos jobs desta NF (R$ %) não bate com o valor total (R$ %).',
      v_soma_itens, v_valor_total;
  end if;

  -- Saldo por parcela: o item não pode faturar mais do que resta dela.
  for v_item in select * from jsonb_array_elements(v_itens)
  loop
    if nullif(v_item->>'envio_parcela_id', '') is not null then
      select * into v_par
        from public.jobs_envio_faturamento_parcelas
       where id = (v_item->>'envio_parcela_id')::uuid;
      if not found then
        raise exception 'Parcela de faturamento não encontrada.';
      end if;
      if v_par.tenant_id <> v_tenant_id then
        raise exception 'Parcela de faturamento de outro tenant.';
      end if;

      select coalesce(sum(fi.valor), 0)::numeric(14,2) into v_ja
        from public.faturamento_itens fi
        join public.faturamentos f on f.id = fi.faturamento_id
       where fi.envio_parcela_id = v_par.id
         and f.status = 'emitido';

      v_saldo := v_par.valor - v_ja;
      if (v_item->>'valor')::numeric > v_saldo + 0.01 then
        select codigo into v_codigo from public.jobs where id = v_par.job_id;
        raise exception
          '% (parcela %): o valor a faturar (R$ %) não pode ser maior que o saldo a faturar (R$ %).',
          coalesce(v_codigo, 'Job'), v_par.ordem,
          (v_item->>'valor')::numeric, v_saldo;
      end if;
    end if;

    -- BV é indivisível e vai numa nota só: a contraparte é o fornecedor.
    if (v_item->>'origem_tipo') = 'bv' then
      if exists (
        select 1 from public.faturamento_itens fi
          join public.faturamentos f on f.id = fi.faturamento_id
         where fi.origem_tipo = 'bv'
           and fi.origem_id = (v_item->>'origem_id')::uuid
           and f.status = 'emitido'
      ) then
        raise exception 'Este BV já foi faturado.';
      end if;
    end if;
  end loop;

  insert into public.faturamentos (
    tenant_id, empresa_id, origem_tipo, origem_id,
    cliente_id, fornecedor_id,
    numero_nf, serie, data_emissao, valor_total, descricao,
    anexo_nf_path, plano_conta_tipo_id, plano_conta_subtipo_id,
    emitido_por
  ) values (
    v_tenant_id, v_empresa_id, v_origem_tipo, v_origem_id,
    v_cliente_id, v_fornecedor_id,
    payload->>'numero_nf', coalesce(nullif(payload->>'serie', ''), '1'),
    (payload->>'data_emissao')::date, v_valor_total, payload->>'descricao',
    payload->>'anexo_nf_path', v_tipo_id, v_subtipo_id,
    v_emitido_por
  )
  returning id into v_faturamento_id;

  for v_item in select * from jsonb_array_elements(v_itens)
  loop
    insert into public.faturamento_itens (
      tenant_id, faturamento_id, origem_tipo, origem_id,
      envio_parcela_id, valor
    ) values (
      v_tenant_id, v_faturamento_id,
      (v_item->>'origem_tipo')::faturamento_origem,
      nullif(v_item->>'origem_id', '')::uuid,
      nullif(v_item->>'envio_parcela_id', '')::uuid,
      (v_item->>'valor')::numeric
    );
  end loop;

  -- Parcelas de RECEBIMENTO da nota. A previsão nasce igual ao
  -- vencimento; o lápis da aba Títulos a Receber muda só a previsão.
  for v_parcela in select * from jsonb_array_elements(v_parcelas)
  loop
    insert into public.titulos_receber (
      tenant_id, empresa_id, faturamento_id,
      numero_parcela, valor, data_vencimento,
      data_previsao_recebimento, data_previsao_recebimento_primeira
    ) values (
      v_tenant_id, v_empresa_id, v_faturamento_id,
      (v_parcela->>'numero')::smallint,
      (v_parcela->>'valor')::numeric,
      (v_parcela->>'data_vencimento')::date,
      (v_parcela->>'data_vencimento')::date,
      (v_parcela->>'data_vencimento')::date
    );
  end loop;

  return v_faturamento_id;
end;
$function$;

revoke execute on function public.emitir_faturamento(jsonb) from public;
grant  execute on function public.emitir_faturamento(jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- 8. dar_baixa_titulo_com_plano — a baixa classifica a receita
-- ---------------------------------------------------------------------
--
-- Nasce ao lado da `dar_baixa_titulo` antiga (que fica intacta) pela
-- razão da decisão do Tiago: tipo e subtipo saíram do formulário de
-- faturamento e passaram a ser pedidos AQUI. O lançamento deixa de
-- herdar o plano da nota e passa a usar o que o financeiro escolheu.
--
-- INVARIANTE: título recebido SEMPRE tem data de recebimento. `p_pago_em`
-- é not null na assinatura e conferido de novo aqui.

create or replace function public.dar_baixa_titulo_com_plano(
  p_titulo_id uuid,
  p_pago_em date,
  p_conta_bancaria_id uuid,
  p_tipo_id uuid,
  p_subtipo_id uuid,
  p_criado_por uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_titulo        titulos_receber%rowtype;
  v_fat           faturamentos%rowtype;
  v_conta         contas_bancarias%rowtype;
  v_subtipo_tipo  uuid;
  v_lancamento_id uuid;
  v_descricao     text;
  v_todos_pagos   boolean;
  v_bv            record;
begin
  if p_pago_em is null then
    raise exception 'Informe a data do recebimento.';
  end if;

  select * into v_titulo from public.titulos_receber where id = p_titulo_id;
  if not found then raise exception 'Título não encontrado.'; end if;
  if not public.is_tenant_member(v_titulo.tenant_id) then
    raise exception 'Sem acesso a este título.';
  end if;
  if v_titulo.status <> 'em_aberto' then
    raise exception 'Título não está em aberto (status atual: %).', v_titulo.status;
  end if;

  select * into v_fat from public.faturamentos where id = v_titulo.faturamento_id;
  if v_fat.status <> 'emitido' then
    raise exception 'Faturamento não está emitido (status atual: %).', v_fat.status;
  end if;

  -- Centro de custo do recebimento: obrigatório, e o par tem que fechar.
  if p_tipo_id is null or p_subtipo_id is null then
    raise exception 'Selecione o centro de custo do recebimento.';
  end if;
  select tipo_id into v_subtipo_tipo
    from public.plano_contas_subtipos where id = p_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.empresa_id <> v_titulo.empresa_id then
    raise exception 'Conta bancária não pertence à empresa do título.';
  end if;
  if not v_conta.ativo then
    raise exception 'Conta bancária está inativa.';
  end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do recebimento é anterior à data do saldo inicial da conta.';
  end if;

  v_descricao := 'Recebimento NF ' || v_fat.numero_nf || '/' ||
                 v_titulo.numero_parcela::text || ' — ' ||
                 substring(v_fat.descricao, 1, 120);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id,
    titulo_receber_id, origem, criado_por
  ) values (
    v_titulo.tenant_id, v_titulo.empresa_id, p_conta_bancaria_id, p_pago_em,
    v_titulo.valor,
    'entrada', v_descricao, p_tipo_id, p_subtipo_id,
    v_fat.fornecedor_id, v_fat.cliente_id,
    v_titulo.id, 'titulo_baixa', p_criado_por
  )
  returning id into v_lancamento_id;

  update public.titulos_receber
     set status = 'pago',
         pago_em = p_pago_em,
         pago_por = p_criado_por,
         conta_bancaria_recebimento_id = p_conta_bancaria_id,
         lancamento_id = v_lancamento_id
   where id = p_titulo_id;

  -- BV vira 'recebido' quando a nota inteira está quitada. Com NF
  -- agrupada, o BV vem de faturamento_itens — não de origem_id.
  select bool_and(status = 'pago') into v_todos_pagos
    from public.titulos_receber
   where faturamento_id = v_fat.id
     and status <> 'cancelado';

  if v_todos_pagos then
    for v_bv in
      select fi.origem_id from public.faturamento_itens fi
       where fi.faturamento_id = v_fat.id and fi.origem_tipo = 'bv'
    loop
      update public.itens_bv set situacao = 'recebido' where id = v_bv.origem_id;
    end loop;
  end if;

  return v_lancamento_id;
end;
$function$;

revoke execute on function
  public.dar_baixa_titulo_com_plano(uuid, date, uuid, uuid, uuid, uuid) from public;
grant  execute on function
  public.dar_baixa_titulo_com_plano(uuid, date, uuid, uuid, uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 9. cancelar_faturamento — devolve os BVs pelos ITENS da nota
-- ---------------------------------------------------------------------
--
-- Redefinida só por causa da nota agrupada: a versão anterior usava
-- `origem_id`, que agora pode ser nulo. O resto do comportamento é
-- idêntico. O saldo dos jobs volta sozinho — a view recalcula, porque
-- ela filtra por `f.status = 'emitido'`.

create or replace function public.cancelar_faturamento(
  p_faturamento_id uuid,
  p_motivo text,
  p_cancelado_por uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_fat       faturamentos%rowtype;
  v_qtd_pagos integer;
  v_bv        record;
begin
  if p_motivo is null or length(trim(p_motivo)) < 10 then
    raise exception 'Motivo precisa ter pelo menos 10 caracteres.';
  end if;

  select * into v_fat from public.faturamentos where id = p_faturamento_id;
  if not found then raise exception 'Faturamento não encontrado.'; end if;
  if not public.is_tenant_member(v_fat.tenant_id) then
    raise exception 'Sem acesso a este faturamento.';
  end if;
  if v_fat.status <> 'emitido' then
    raise exception 'Faturamento já está cancelado.';
  end if;

  select count(*) into v_qtd_pagos
    from public.titulos_receber
   where faturamento_id = p_faturamento_id
     and status = 'pago';

  if v_qtd_pagos > 0 then
    raise exception 'Existem % títulos já baixados. Estorne as baixas antes de cancelar a NF.', v_qtd_pagos;
  end if;

  update public.titulos_receber
     set status = 'cancelado',
         cancelado_em = now(),
         cancelado_por = p_cancelado_por
   where faturamento_id = p_faturamento_id
     and status = 'em_aberto';

  update public.faturamentos
     set status = 'cancelado',
         cancelado_em = now(),
         cancelado_por = p_cancelado_por,
         motivo_cancelamento = p_motivo
   where id = p_faturamento_id;

  for v_bv in
    select fi.origem_id from public.faturamento_itens fi
     where fi.faturamento_id = p_faturamento_id and fi.origem_tipo = 'bv'
  loop
    update public.itens_bv
       set situacao = 'confirmado'
     where id = v_bv.origem_id and situacao = 'recebido';
  end loop;

  -- Compatibilidade com notas emitidas antes desta migration, que não
  -- têm linha em faturamento_itens.
  if v_fat.origem_tipo = 'bv' and v_fat.origem_id is not null then
    update public.itens_bv
       set situacao = 'confirmado'
     where id = v_fat.origem_id and situacao = 'recebido';
  end if;
end;
$function$;

revoke execute on function public.cancelar_faturamento(uuid, text, uuid) from public;
grant  execute on function public.cancelar_faturamento(uuid, text, uuid) to authenticated;
