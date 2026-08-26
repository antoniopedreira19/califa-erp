-- =====================================================================
-- SAVE — a marca na linha e a chave do orçamento de save
--
-- Materializa a decisão docs/decisions/023-save-entre-jobs.md. O cliente
-- fecha um orçamento e não usa todas as linhas: elas são faturadas assim
-- mesmo e o valor vira crédito para um projeto seguinte.
--
-- A conta que isso exige está em lib/calculos/versao-totais.ts e é uma só,
-- rodada sobre DUAS bases por linha:
--
--     base de faturamento  = total_orcado − save_consumido
--     base de valor do job = em_save ? 0 : total_orcado
--
-- Sem nenhuma linha em save as duas bases são iguais e todo número de
-- todo job existente continua idêntico. Por isso as colunas nascem com
-- default e NÃO há backfill: 217 itens de versão e 93 de job entram todos
-- no caso neutro.
--
-- POR QUE COLUNA E NÃO TABELA (o oposto de `itens_bv`): o BV tem ciclo de
-- vida próprio e precisa ser um registro único compartilhado entre a
-- versão e o job. O save é atributo intrínseco da linha, como
-- `tipo_custo` — que também é duplicado nas duas tabelas — e PRECISA
-- poder divergir entre a versão aprovada (o que o cliente aprovou) e a
-- cópia do job (o que a errata moveu).
--
-- `save_consumido` é mantida pelo trigger da migration seguinte, a partir
-- de `saves_consumos`. Ela existe materializada porque uns ~11 caminhos
-- de leitura fazem `.select("tipo_custo, total_orcado")` e passariam a
-- pagar uma agregação por linha — o anti-padrão C de docs/PERFORMANCE.md.
--
-- Aditiva: coluna nova com default, índice, trigger e redefinição de
-- corpo de função. Nada removido, nada sobrescrito.
-- =====================================================================

-- ---------------------------------------------------------------- marca
alter table public.versoes_orcamento_itens
  add column if not exists em_save boolean not null default false;

alter table public.versoes_orcamento_itens
  add column if not exists save_consumido numeric(14,2) not null default 0;

alter table public.jobs_itens_orcado
  add column if not exists em_save boolean not null default false;

alter table public.jobs_itens_orcado
  add column if not exists save_consumido numeric(14,2) not null default 0;

comment on column public.versoes_orcamento_itens.em_save is
  'A linha gera SAVE: o cliente paga nesta nota, o serviço não acontece neste projeto e o valor vira crédito do cliente. Sai da base do VALOR DO JOB e permanece na do FATURAMENTO (decisão 023 §1).';
comment on column public.versoes_orcamento_itens.save_consumido is
  'Quanto desta linha é pago por saldo de save de outro job. Sai da base do FATURAMENTO (já faturado lá) e fica na do VALOR DO JOB (decisão 023 §2). Mantida por trigger a partir de saves_consumos — não escrever à mão.';
comment on column public.jobs_itens_orcado.em_save is
  'Cópia da marca de save no job. Diverge da versão quando a errata marca ou desmarca depois da abertura.';
comment on column public.jobs_itens_orcado.save_consumido is
  'Idem versoes_orcamento_itens.save_consumido, para a cópia do job. Mantida por trigger.';

-- Consumo negativo viraria base de faturamento maior que o orçado. O teto
-- (<= total_orcado) fica no trigger de saves_consumos: `total_orcado` é
-- coluna GENERATED e a validação precisa ver as duas pontas.
alter table public.versoes_orcamento_itens
  drop constraint if exists chk_voi_save_consumido_nao_negativo;
alter table public.versoes_orcamento_itens
  add constraint chk_voi_save_consumido_nao_negativo
  check (save_consumido >= 0);

alter table public.jobs_itens_orcado
  drop constraint if exists chk_jio_save_consumido_nao_negativo;
alter table public.jobs_itens_orcado
  add constraint chk_jio_save_consumido_nao_negativo
  check (save_consumido >= 0);

-- Uma linha não gera e consome save ao mesmo tempo: ela é origem OU
-- destino do crédito, nunca os dois.
alter table public.versoes_orcamento_itens
  drop constraint if exists chk_voi_save_exclusivo;
alter table public.versoes_orcamento_itens
  add constraint chk_voi_save_exclusivo
  check (not (em_save and save_consumido > 0));

alter table public.jobs_itens_orcado
  drop constraint if exists chk_jio_save_exclusivo;
alter table public.jobs_itens_orcado
  add constraint chk_jio_save_exclusivo
  check (not (em_save and save_consumido > 0));

-- Índices parciais: "as linhas em save deste job" é a consulta do saldo, e
-- "as linhas que consomem" alimenta o rastro na planilha.
create index if not exists idx_voi_em_save
  on public.versoes_orcamento_itens(versao_orcamento_id) where em_save;
create index if not exists idx_jio_em_save
  on public.jobs_itens_orcado(job_id) where em_save;
create index if not exists idx_jio_consome_save
  on public.jobs_itens_orcado(job_id) where save_consumido > 0;

-- ------------------------------------------- chave do orçamento de save
alter table public.versoes_orcamento
  add column if not exists save_por_padrao boolean not null default false;

comment on column public.versoes_orcamento.save_por_padrao is
  'Orçamento de save: todo item NOVO nasce marcado. É default de linha nova, não trava — a linha pode ser desmarcada depois, e desligar a chave não desmarca o que já existe (decisão 023 §10).';

-- Só INSERT, de propósito: desmarcar uma linha depois é UPDATE, e o
-- trigger não pode pisar em cima da decisão de quem desmarcou.
--
-- Existe pelo mesmo motivo de planejado_espelha_orcado: são SEIS caminhos
-- de escrita que criam item (célula, linha nova, drawer, importação,
-- editor multi, editor agregado). Perseguir os seis é como a regra se
-- perde; o trigger é o único ponto por onde todos passam.
create or replace function public.item_nasce_em_save()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not new.em_save and exists (
    select 1 from public.versoes_orcamento v
     where v.id = new.versao_orcamento_id
       and v.save_por_padrao
  ) then
    new.em_save := true;
  end if;
  return new;
end;
$$;

comment on function public.item_nasce_em_save() is
  'Orçamento de save: item novo nasce com em_save. Só no INSERT (decisão 023 §10).';

drop trigger if exists trg_item_nasce_em_save on public.versoes_orcamento_itens;
create trigger trg_item_nasce_em_save
before insert on public.versoes_orcamento_itens
for each row execute function public.item_nasce_em_save();

-- ------------------------------- linha em save não tem custo planejado
-- Decisão 023 §9: o serviço não acontece neste projeto, então não há
-- fornecedor a pagar. O planejado zera, e a linha sai da rentabilidade.
--
-- A ORDEM IMPORTA: uma linha `A` em save tem que ZERAR, não espelhar o
-- orçado. Por isso o ramo do save vem primeiro.
create or replace function public.planejado_espelha_orcado()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.em_save then
    new.valor_unitario_planejado := 0;
    new.quantidade_planejada     := 0;
    new.dias_meses_planejado     := 0;
  elsif new.tipo_custo in ('A', 'D') then
    new.valor_unitario_planejado := coalesce(new.valor_unitario_orcado, 0);
    new.quantidade_planejada     := coalesce(new.quantidade_orcada, 0);
    new.dias_meses_planejado     := coalesce(new.dias_meses_orcado, 0);
  end if;
  return new;
end;
$$;

comment on function public.planejado_espelha_orcado() is
  'Linha em save zera o planejado (decisão 023 §9); item A e D espelham o orçado (decisão 022). Trigger porque são seis caminhos de escrita diferentes.';

-- `em_save` entra na lista de colunas que disparam o trigger: marcar uma
-- linha existente precisa zerar o planejado dela na hora.
drop trigger if exists trg_planejado_espelha_orcado on public.versoes_orcamento_itens;
create trigger trg_planejado_espelha_orcado
before insert or update of
  em_save, tipo_custo, valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
  valor_unitario_planejado, quantidade_planejada, dias_meses_planejado
on public.versoes_orcamento_itens
for each row execute function public.planejado_espelha_orcado();

drop trigger if exists trg_planejado_espelha_orcado_job on public.jobs_itens_orcado;
create trigger trg_planejado_espelha_orcado_job
before insert or update of
  em_save, tipo_custo, valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
  valor_unitario_planejado, quantidade_planejada, dias_meses_planejado
on public.jobs_itens_orcado
for each row execute function public.planejado_espelha_orcado();

-- --------------------------------------- linha em save não aceita BV
-- Mesma razão do planejado: sem serviço executado não há fornecedor com
-- quem negociar comissão.
--
-- ATENÇÃO — o corpo abaixo PRESERVA o que a função já fazia no banco, que
-- é mais do que o arquivo 20260813000001 mostra: além do tipo do item da
-- versão, ela cai num fallback que olha `jobs_itens_orcado` (a errata
-- pode ter trocado o tipo depois da abertura) e confere o tenant. As duas
-- coisas continuam aqui; o save é só uma trava a mais, no começo.
create or replace function public.bv_exige_item_com_bv()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tipo public.tipo_custo;
  v_tenant uuid;
  v_aceita boolean;
  v_em_save boolean;
begin
  select tipo_custo, tenant_id, em_save into v_tipo, v_tenant, v_em_save
  from public.versoes_orcamento_itens
  where id = new.item_versao_id;

  if v_tipo is null then
    raise exception 'Item da versão não encontrado.';
  end if;

  -- A marca vale se estiver na versão OU na cópia do job: a errata pode
  -- ter transformado a linha em save depois da abertura.
  if not coalesce(v_em_save, false) then
    select exists (
      select 1
      from public.jobs_itens_orcado o
      where o.item_versao_id = new.item_versao_id
        and o.em_save
    ) into v_em_save;
  end if;

  if v_em_save then
    raise exception 'Linha em save não aceita BV: o serviço não acontece neste projeto, então não há fornecedor com quem negociar comissão.';
  end if;

  v_aceita := v_tipo in ('A', 'AR', 'D');

  if not v_aceita then
    select exists (
      select 1
      from public.jobs_itens_orcado o
      where o.item_versao_id = new.item_versao_id
        and o.tipo_custo in ('A', 'AR', 'D')
    ) into v_aceita;
  end if;

  if not v_aceita then
    raise exception 'BV só pode ser lançado em item de custo tipo A, A · Repasse ou D.';
  end if;

  if new.tenant_id <> v_tenant then
    raise exception 'Tenant do BV difere do tenant do item.';
  end if;

  return new;
end;
$$;

comment on function public.bv_exige_item_com_bv() is
  'BV só em item A, AR ou D, e nunca em linha que gera save (decisões 003, 022 e 023 §9). Confere o tipo na versão e, em fallback, na cópia do job, porque a errata pode ter trocado.';
