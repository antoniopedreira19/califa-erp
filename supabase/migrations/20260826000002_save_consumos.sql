-- =====================================================================
-- SAVE — o consumo do saldo, e o saldo em si
--
-- Decisão docs/decisions/023-save-entre-jobs.md, com as regras revistas em
-- 26/08/2026 depois do design `Orcamento - Versao com Save.dc.html`:
--
--  * O consumo sai do SALDO DO JOB de origem, não de uma linha específica.
--    As linhas que geraram o saldo continuam visíveis (é o detalhe do
--    pop-up), mas quem tem saldo é o job.
--  * Uma linha consumidora pode beber de VÁRIOS jobs de origem ao mesmo
--    tempo — daí a tabela ser (origem, linha) e não (linha).
--  * O saldo de um job é conta corrente do CLIENTE: qualquer orçamento ou
--    job dele pode consumir até zerar. Não há mais alocação exclusiva.
--  * Rascunho NÃO segura saldo. Um consumo só abate o disponível quando a
--    versão é aprovada (ou quando já virou job). Até lá é RESERVA: aparece
--    na tela, avisa quem for aprovar, e não impede ninguém.
--
-- POR QUE UMA TABELA COM DUAS PONTAS: o consumo nasce no orçamento
-- (`item_versao_id`) e é COPIADO para o job na abertura
-- (`job_item_orcado_id`), do mesmo jeito que os itens. A versão aprovada
-- fica intocada — é o que o cliente aprovou — e dali em diante mexer no
-- job é Errata. A linha da versão é marcada com `substituido_em` para não
-- ser contada duas vezes.
--
-- Aditiva: tabela nova vazia, views novas, triggers novos.
-- =====================================================================

create table if not exists public.saves_consumos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,

  -- De qual job vem o saldo.
  job_origem_id uuid not null references public.jobs(id) on delete restrict,

  -- A linha que consome. Exatamente UMA das duas é preenchida.
  item_versao_id uuid references public.versoes_orcamento_itens(id) on delete cascade,
  job_item_orcado_id uuid references public.jobs_itens_orcado(id) on delete cascade,

  -- Quanto do PRINCIPAL do saldo esta linha consome. Só o principal:
  -- honorários e imposto não são saldo, migram por rateio (decisão 023 §4).
  valor numeric(14,2) not null,

  -- Preenchido na abertura do job, na linha da VERSÃO, quando o consumo é
  -- copiado para a cópia do job. A partir daí quem conta é a cópia.
  substituido_em timestamptz,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint chk_save_consumo_positivo check (valor > 0),
  constraint chk_save_consumo_uma_ponta check (
    (item_versao_id is not null and job_item_orcado_id is null)
    or (item_versao_id is null and job_item_orcado_id is not null)
  )
);

-- De cada origem, uma vez por linha. Somar duas vezes o mesmo par seria
-- um jeito silencioso de estourar o saldo.
create unique index if not exists uniq_save_consumo_versao
  on public.saves_consumos(job_origem_id, item_versao_id)
  where item_versao_id is not null;
create unique index if not exists uniq_save_consumo_job
  on public.saves_consumos(job_origem_id, job_item_orcado_id)
  where job_item_orcado_id is not null;

create index if not exists idx_save_consumo_tenant on public.saves_consumos(tenant_id);
create index if not exists idx_save_consumo_origem on public.saves_consumos(job_origem_id);
create index if not exists idx_save_consumo_item_versao on public.saves_consumos(item_versao_id);
create index if not exists idx_save_consumo_item_job on public.saves_consumos(job_item_orcado_id);

comment on table public.saves_consumos is
  'Consumo de saldo de save: uma linha por (job de origem, linha consumidora). A linha pode consumir de vários jobs. Nasce no orçamento e é copiada para o job na abertura (decisão 023).';
comment on column public.saves_consumos.substituido_em is
  'Na linha da VERSÃO: momento em que a abertura do job copiou este consumo. Marcado, ele para de contar — quem conta passa a ser a cópia do job.';

alter table public.saves_consumos enable row level security;

drop policy if exists saves_consumos_select on public.saves_consumos;
create policy saves_consumos_select on public.saves_consumos
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists saves_consumos_insert on public.saves_consumos;
create policy saves_consumos_insert on public.saves_consumos
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists saves_consumos_update on public.saves_consumos;
create policy saves_consumos_update on public.saves_consumos
  for update to authenticated using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists saves_consumos_delete on public.saves_consumos;
create policy saves_consumos_delete on public.saves_consumos
  for delete to authenticated using (public.is_tenant_member(tenant_id));

-- DELETE existe (diferente de faturamento_itens, que é imutável): desfazer
-- um consumo é operação normal de planilha, não correção de documento
-- emitido.
grant select, insert, update, delete on public.saves_consumos to authenticated;

-- ================================================== saldo por job (view)
--
-- Saldo gerado  = Σ total_orcado das linhas em save da cópia do job.
-- Consumido     = Σ consumos FIRMES sobre este job.
-- Reservado     = Σ consumos de rascunho (não firmes) — informativo.
-- Disponível    = gerado − consumido. A reserva NÃO abate (26/08/2026).
--
-- Um consumo é FIRME quando já é do job (foi copiado na abertura) ou
-- quando a versão que o criou está aprovada e ainda não virou job.
create or replace view public.vw_saves_consumos_firmes as
select c.*,
       (
         c.job_item_orcado_id is not null
         or (
           c.substituido_em is null
           and exists (
             select 1
               from public.versoes_orcamento_itens i
               join public.versoes_orcamento v on v.id = i.versao_orcamento_id
              where i.id = c.item_versao_id
                and v.status = 'aprovada'
           )
         )
       ) as firme
  from public.saves_consumos c;

create or replace view public.vw_saves_por_job as
select j.id                              as job_id,
       j.tenant_id,
       j.codigo                          as job_codigo,
       j.nome                            as job_nome,
       j.status                          as job_status,
       p.cliente_id,
       coalesce(g.gerado, 0)::numeric(14,2)     as saldo_gerado,
       coalesce(f.consumido, 0)::numeric(14,2)  as consumido,
       coalesce(r.reservado, 0)::numeric(14,2)  as reservado,
       (coalesce(g.gerado, 0) - coalesce(f.consumido, 0))::numeric(14,2)
                                                as disponivel,
       coalesce(g.linhas, 0)                    as linhas_em_save,
       -- As taxas da ORIGEM viajam junto: quem calcula a receita que migra
       -- é o TypeScript, com a mesma REGRAS_TIPO_CUSTO. A matriz de
       -- alavancas fica num lugar só.
       v.percentual_honorarios,
       v.percentual_imposto
  from public.jobs j
  join public.projetos p on p.id = j.projeto_id
  left join public.versoes_orcamento v on v.id = j.versao_orcamento_aprovada_id
  left join lateral (
    select sum(o.total_orcado) as gerado, count(*) as linhas
      from public.jobs_itens_orcado o
     where o.job_id = j.id and o.em_save
  ) g on true
  left join lateral (
    select sum(c.valor) as consumido
      from public.vw_saves_consumos_firmes c
     where c.job_origem_id = j.id and c.firme
  ) f on true
  left join lateral (
    select sum(c.valor) as reservado
      from public.vw_saves_consumos_firmes c
     where c.job_origem_id = j.id and not c.firme
  ) r on true
 where coalesce(g.gerado, 0) > 0;

comment on view public.vw_saves_por_job is
  'Saldo de save por job de origem. NÃO filtra status do job: o saldo é do cliente e sobrevive ao encerramento da origem (decisão 023 §8).';

grant select on public.vw_saves_consumos_firmes to authenticated;
grant select on public.vw_saves_por_job to authenticated;

-- ================================ as linhas que formam o saldo de um job
-- Detalhe do pop-up de consumo: "Saldo do JB-0031 formado por
-- Pós-produção R$ 20.000 · Trilha sonora R$ 6.000 · Estúdio R$ 12.000".
create or replace view public.vw_saves_linhas as
select o.job_id,
       o.tenant_id,
       o.id            as job_item_orcado_id,
       o.item_versao_id,
       o.item          as descricao,
       o.tipo_custo,
       o.total_orcado::numeric(14,2) as valor
  from public.jobs_itens_orcado o
 where o.em_save;

grant select on public.vw_saves_linhas to authenticated;

-- ========================================== manutenção de save_consumido
-- A coluna é materializada para os ~11 caminhos de leitura não pagarem uma
-- agregação por linha (anti-padrão C de docs/PERFORMANCE.md). Quem a
-- mantém é este trigger — nunca a aplicação.
create or replace function public.save_consumido_recalcula()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item_versao uuid;
  v_item_job uuid;
begin
  v_item_versao := coalesce(new.item_versao_id, old.item_versao_id);
  v_item_job    := coalesce(new.job_item_orcado_id, old.job_item_orcado_id);

  if v_item_versao is not null then
    update public.versoes_orcamento_itens i
       set save_consumido = coalesce((
             select sum(c.valor) from public.saves_consumos c
              where c.item_versao_id = v_item_versao
                and c.substituido_em is null
           ), 0)
     where i.id = v_item_versao;
  end if;

  if v_item_job is not null then
    update public.jobs_itens_orcado o
       set save_consumido = coalesce((
             select sum(c.valor) from public.saves_consumos c
              where c.job_item_orcado_id = v_item_job
           ), 0)
     where o.id = v_item_job;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_save_consumido_recalcula on public.saves_consumos;
create trigger trg_save_consumido_recalcula
after insert or update or delete on public.saves_consumos
for each row execute function public.save_consumido_recalcula();

-- ================================================== validação do consumo
-- As invariantes que CHECK não alcança porque cruzam linhas.
create or replace function public.save_consumo_valida()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total_linha numeric(14,2);
  v_em_save boolean;
  v_tenant_linha uuid;
  v_job_da_linha uuid;
  v_ja_consumido numeric(14,2);
  v_saldo numeric(14,2);
  v_firme_no_origem numeric(14,2);
  v_codigo text;
begin
  -- 1. A linha consumidora existe, não é ela própria save, e o tenant bate.
  if new.item_versao_id is not null then
    select i.total_orcado, i.em_save, i.tenant_id
      into v_total_linha, v_em_save, v_tenant_linha
      from public.versoes_orcamento_itens i where i.id = new.item_versao_id;
  else
    select o.total_orcado, o.em_save, o.tenant_id, o.job_id
      into v_total_linha, v_em_save, v_tenant_linha, v_job_da_linha
      from public.jobs_itens_orcado o where o.id = new.job_item_orcado_id;
  end if;

  if v_total_linha is null then
    raise exception 'Linha consumidora não encontrada.';
  end if;
  if v_em_save then
    raise exception 'Uma linha não pode gerar e consumir save ao mesmo tempo.';
  end if;
  if new.tenant_id <> v_tenant_linha then
    raise exception 'Tenant do consumo difere do tenant da linha.';
  end if;

  -- 2. A linha não pode consumir de si mesma.
  if v_job_da_linha is not null and v_job_da_linha = new.job_origem_id then
    raise exception 'Um job não pode consumir o próprio saldo de save.';
  end if;

  -- 3. A soma dos consumos da LINHA (de todas as origens) não passa do
  --    orçado dela. Consumo parcial é permitido — o resto segue faturado
  --    normalmente (decisão 023 §6) —, mas passar do total deixaria a base
  --    de faturamento negativa.
  select coalesce(sum(c.valor), 0) into v_ja_consumido
    from public.saves_consumos c
   where c.id <> new.id
     and ((new.item_versao_id is not null and c.item_versao_id = new.item_versao_id
           and c.substituido_em is null)
       or (new.job_item_orcado_id is not null and c.job_item_orcado_id = new.job_item_orcado_id));

  if v_ja_consumido + new.valor > v_total_linha + 0.005 then
    raise exception 'O consumo de save (R$ %) passa do orçado da linha (R$ %).',
      to_char(v_ja_consumido + new.valor, 'FM999G999G990D00'),
      to_char(v_total_linha, 'FM999G999G990D00');
  end if;

  -- 4. O saldo do job de origem cobre. Só consumos FIRMES contam: rascunho
  --    não segura saldo (26/08/2026).
  select coalesce(sum(o.total_orcado), 0), j.codigo
    into v_saldo, v_codigo
    from public.jobs j
    left join public.jobs_itens_orcado o on o.job_id = j.id and o.em_save
   where j.id = new.job_origem_id
   group by j.codigo;

  if v_codigo is null then
    raise exception 'Job de origem do save não encontrado.';
  end if;

  select coalesce(sum(c.valor), 0) into v_firme_no_origem
    from public.vw_saves_consumos_firmes c
   where c.job_origem_id = new.job_origem_id
     and c.firme
     and c.id <> new.id;

  -- O consumo que está entrando só é conferido contra o saldo quando ele
  -- próprio é firme. Reserva de rascunho passa: ela avisa, não impede.
  if (new.job_item_orcado_id is not null
      or exists (select 1 from public.versoes_orcamento_itens i
                   join public.versoes_orcamento v on v.id = i.versao_orcamento_id
                  where i.id = new.item_versao_id and v.status = 'aprovada'))
     and v_firme_no_origem + new.valor > v_saldo + 0.005 then
    raise exception 'Saldo de save do job % é de R$ %, e já há R$ % consumidos: não cabe mais R$ %.',
      v_codigo,
      to_char(v_saldo, 'FM999G999G990D00'),
      to_char(v_firme_no_origem, 'FM999G999G990D00'),
      to_char(new.valor, 'FM999G999G990D00');
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_save_consumo_valida on public.saves_consumos;
create trigger trg_save_consumo_valida
before insert or update on public.saves_consumos
for each row execute function public.save_consumo_valida();

comment on function public.save_consumo_valida() is
  'Invariantes do consumo de save que cruzam linhas: teto do orçado da linha, saldo do job de origem, linha não é save, não consome de si mesma (decisão 023).';

-- ================================================ security_invoker: SIM
-- Aqui SIM, ao contrário das views antigas do schema.
--
-- A 20260817000006 registrou a decisão de deixar `security_invoker`
-- desligado nas views existentes e resolver isso na fase de cadastro de
-- usuários e acessos — e o próprio comentário de lá diz que ligar fecha o
-- buraco numa linha e não quebraria nada. Aquela decisão foi sobre não
-- fazer a varredura naquele momento; ela não é razão para OBJETO NOVO
-- nascer vazando.
--
-- Sem isto, a view roda com os poderes do dono e ignora a RLS de `jobs`,
-- `jobs_itens_orcado` e `versoes_orcamento` — quem tem login leria o saldo
-- de save de qualquer tenant driblando o filtro da página. As três tabelas
-- de origem têm RLS ligada e policy de SELECT `is_tenant_member(tenant_id)`
-- para `authenticated`, então ligar não tira nada de ninguém.
alter view public.vw_saves_consumos_firmes set (security_invoker = on);
alter view public.vw_saves_por_job set (security_invoker = on);
alter view public.vw_saves_linhas set (security_invoker = on);
