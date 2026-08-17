-- =====================================================================
-- Parcelas do Pedido de Produção + PPs parciais por item (Tela 2.2).
--
-- POR QUE EXISTE (parcelas): uma PP podia ter um único vencimento, o
-- `pedidos_compra.prazo_pagamento`. Fornecedor que parcela em 3 vezes
-- obrigava a emitir 3 PPs, cada uma com seu documento e seu ciclo — o
-- que quebra a leitura do item (3 PPs para 1 contratação) e some com a
-- informação de que aquilo é UM pedido pago em partes. Agora cada
-- parcela é uma linha, com vencimento e valor próprios, e a soma delas
-- fecha exatamente com o valor da PP (regra validada na server action).
--
-- POR QUE TABELA E NÃO COLUNAS: o número de parcelas é aberto. Colunas
-- `vencimento_2`, `vencimento_3` não escalam, e a Tela 3.2 vai listar
-- CADA parcela como um título a pagar próprio — linha de tabela é o
-- formato que aquela leitura pede.
--
-- `pdf_path` na parcela atende a Tela 2.3: a emissão passa a arquivar um
-- PDF por parcela (mesma PP, "Parcela: 2/3", vencimento e valor da
-- parcela em destaque). Nas PPs que já existem, o `pdf_path` da parcela
-- backfillada aponta para o PDF antigo — ele É o documento da 1/1, e
-- snapshot emitido não se regera.
--
-- `pago_em` / `pago_por` nascem aqui, mas quem passa a usá-los é a Tela
-- 3.2 (baixa por parcela na aba "Títulos a Pagar"). Decisão do Tiago em
-- 17/08/2026: a 2.2 entrega as parcelas e as listas; a baixa continua
-- por PP (RPC `dar_baixa_pp`, views `vw_a_pagar` / `vw_fluxo_caixa`) até
-- a 3.2 reestruturar Contas a Pagar — para não escrever a mesma máquina
-- financeira duas vezes.
--
-- POR QUE O ÍNDICE ÚNICO SAI: `uniq_pp_ativa_por_item_realizado`
-- materializava "1 PP ativa por item". A regra nova (Tiago, 17/08/2026):
-- **sem limite de PPs por item e sem limite por fornecedor** — o que
-- trava é o SALDO. Um item de 800 un pode ser dividido entre quantos
-- fornecedores e quantos pedidos forem necessários, desde que a soma não
-- passe do realizado. Por isso o índice sai sem substituto, e a regra que
-- ele guardava é substituída pelo trigger abaixo, que trava o que
-- interessa de verdade.
--
-- PP REJEITADA CONTINUA OCUPANDO O SALDO (decisão do Tiago): ela vai ser
-- corrigida e reenviada pelo GP, então o dinheiro segue reservado. Só o
-- CANCELAMENTO devolve saldo ao item. É por isso que o trigger e a
-- soma da tela usam `status <> 'cancelada'`, e não uma lista de status
-- "ativos".
--
-- FICOU DE FORA, deliberadamente:
--   - GRANT de DELETE em `pedidos_compra_parcelas`. Nenhum fluxo apaga
--     parcela: ela só desaparece pelo cascade, quando a emissão falha no
--     meio e a linha da PP é removida (cascade não checa privilégio).
--   - Trava no caminho inverso: baixar o REALIZADO do item para menos que
--     a soma das PPs já emitidas continua possível. O design diz "acima
--     disso é preciso alterar o realizado", tratando o realizado como
--     mestre; bloquear a edição dele é decisão que não foi tomada.
--   - `prazo_pagamento_financeiro` por parcela e histórico de
--     repactuação: são da Tela 3.2.
-- =====================================================================

create table if not exists public.pedidos_compra_parcelas (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete restrict,
  -- Cascade: a emissão apaga a linha da PP quando o PDF ou os anexos
  -- falham, e a parcela não pode sobreviver ao pedido que a criou.
  pedido_compra_id uuid not null references public.pedidos_compra(id) on delete cascade,
  numero           int  not null,
  data_vencimento  date not null,
  valor            numeric not null,
  -- Nulo só na janela entre o insert da parcela e o upload do PDF dela.
  pdf_path         text,
  -- Baixa por parcela. Preenchidos pela Tela 3.2; no backfill herdam o
  -- que a PP já tinha, para não perder a baixa de PP legada.
  pago_em          date,
  pago_por         uuid references public.profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id),

  constraint chk_pp_parcela_numero check (numero >= 1),
  constraint chk_pp_parcela_valor check (valor > 0),
  -- Duas parcelas "2/3" na mesma PP seriam ambíguas no PDF e na lista.
  constraint uniq_pp_parcela_numero unique (pedido_compra_id, numero)
);

-- FK filtrada em toda leitura da PP, sempre ordenada por número
-- (regra de docs/PERFORMANCE.md: índice na FK que se filtra).
create index if not exists idx_pp_parcelas_pedido
  on public.pedidos_compra_parcelas(pedido_compra_id, numero);
create index if not exists idx_pp_parcelas_tenant
  on public.pedidos_compra_parcelas(tenant_id);
-- Fila do financeiro: vencimentos em aberto, por data. Parcial porque a
-- parcela paga sai da fila e não precisa estar no índice.
create index if not exists idx_pp_parcelas_a_pagar
  on public.pedidos_compra_parcelas(tenant_id, data_vencimento)
  where pago_em is null;

drop trigger if exists trg_pp_parcelas_updated_at on public.pedidos_compra_parcelas;
create trigger trg_pp_parcelas_updated_at
before update on public.pedidos_compra_parcelas
for each row execute function public.set_updated_at();

-- RLS + GRANT (RLS != GRANT: sem o grant, `authenticated` toma
-- "permission denied" mesmo com a policy correta).
alter table public.pedidos_compra_parcelas enable row level security;

drop policy if exists pp_parcelas_select on public.pedidos_compra_parcelas;
create policy pp_parcelas_select on public.pedidos_compra_parcelas
  for select to authenticated using (public.is_tenant_member(tenant_id));

drop policy if exists pp_parcelas_insert on public.pedidos_compra_parcelas;
create policy pp_parcelas_insert on public.pedidos_compra_parcelas
  for insert to authenticated with check (public.is_tenant_member(tenant_id));

drop policy if exists pp_parcelas_update on public.pedidos_compra_parcelas;
create policy pp_parcelas_update on public.pedidos_compra_parcelas
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update on public.pedidos_compra_parcelas to authenticated;
-- Nada para `anon`, em nenhuma hipótese.

comment on table public.pedidos_compra_parcelas is
  'Parcelas do Pedido de Produção: um vencimento e um documento (pdf_path) por parcela. A soma fecha com pedidos_compra.valor.';

-- ---------------------------------------------------------------------
-- Backfill: toda PP existente vira 1 parcela 1/1, com o que ela já tinha.
-- Preenche o que está vazio (aditivo) e é idempotente pelo `not exists`.
-- ---------------------------------------------------------------------
insert into public.pedidos_compra_parcelas
  (tenant_id, pedido_compra_id, numero, data_vencimento, valor, pdf_path, pago_em, pago_por, created_by)
select
  pp.tenant_id,
  pp.id,
  1,
  pp.prazo_pagamento,
  pp.valor,
  nullif(pp.pdf_path, ''),
  pp.pago_em,
  pp.pago_por,
  pp.emitida_por
from public.pedidos_compra pp
where not exists (
  select 1 from public.pedidos_compra_parcelas p where p.pedido_compra_id = pp.id
);

-- ---------------------------------------------------------------------
-- A regra de saldo passa a viver no banco, e o índice de "1 PP por item"
-- sai. Autorizado pelo Tiago em 17/08/2026 (mudança destrutiva).
--
-- Conferido antes de aplicar: nenhuma PP existente viola a regra — as 8
-- têm valor exatamente igual ao realizado do item, então a soma por item
-- nunca passa.
-- ---------------------------------------------------------------------
drop index if exists public.uniq_pp_ativa_por_item_realizado;

create or replace function public.pp_valida_saldo_do_item()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_total_realizado numeric;
  v_soma_outras     numeric;
  v_maximo          numeric;
begin
  -- Cancelar devolve saldo: nunca pode ser barrado por saldo.
  if new.status = 'cancelada' then
    return new;
  end if;

  select coalesce(total_realizado, 0) into v_total_realizado
    from public.jobs_itens_realizado
   where id = new.item_realizado_id;

  if not found then
    raise exception 'Item realizado da PP não foi encontrado.';
  end if;

  select coalesce(sum(valor), 0) into v_soma_outras
    from public.pedidos_compra
   where item_realizado_id = new.item_realizado_id
     and status <> 'cancelada'
     and id <> new.id;

  v_maximo := v_total_realizado - v_soma_outras;

  -- Meio centavo de tolerância: o valor da PP é quantidade × R$ unitário
  -- do realizado, e o arredondamento da última fatia pode sobrar um
  -- centavo que não deve travar a emissão legítima.
  if new.valor - v_maximo > 0.005 then
    raise exception
      'A soma das PPs deste item passaria do realizado. Realizado: %, já em PPs: %, máximo aceito para esta PP: %.',
      to_char(v_total_realizado, 'FM999999999990.00'),
      to_char(v_soma_outras, 'FM999999999990.00'),
      to_char(greatest(v_maximo, 0), 'FM999999999990.00');
  end if;

  return new;
end;
$$;

comment on function public.pp_valida_saldo_do_item() is
  'Trava de saldo das PPs de um item: soma das não canceladas <= total_realizado. Substitui o índice uniq_pp_ativa_por_item_realizado, derrubado em 17/08/2026.';

-- `update of` restrito ao que mexe na conta: mudança de status para
-- aprovada/paga não recalcula nada além do necessário.
drop trigger if exists trg_pp_valida_saldo_do_item on public.pedidos_compra;
create trigger trg_pp_valida_saldo_do_item
before insert or update of valor, item_realizado_id, status on public.pedidos_compra
for each row execute function public.pp_valida_saldo_do_item();
