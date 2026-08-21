-- =====================================================================
-- `A` e `D`: o planejado espelha o orçado — no banco, não só na tela
--
-- A migration 20260821000001 fez o backfill; esta impede a divergência de
-- voltar. Sem ela, bastava um dos SEIS caminhos de escrita gravar um
-- planejado próprio num item `A` para a coluna e a planilha contarem
-- histórias diferentes:
--
--   1. `atualizarCampoItem`      — cada Enter numa célula da versão
--   2. `adicionarItem`           — a linha nova da grade
--   3. `atualizarItem`           — o drawer de edição do item
--   4. `importar-actions`        — importação de planilha (dois pontos)
--   5. `_rascunho/actions`       — "Salvar orçamentos" do editor multi
--   6. `agregado/actions`        — editor agregado do projeto
--
-- Perseguir os seis é como a regra se perde: o sétimo aparece depois. O
-- trigger é o único lugar por onde todos passam.
--
-- Por que `A` e `D`: neles o cliente paga o fornecedor diretamente, então
-- a agência não tem custo próprio a planejar — o custo É o orçado, e o
-- que ela ganha é a comissão (BV), que sai na vista Líquido. `AR` fica de
-- fora de propósito: lá o principal passa pela California e há custo a
-- planejar de verdade.
--
-- Espelha as TRÊS colunas de entrada, não o total: `total_planejado` é
-- coluna GENERATED (unitário × QT × D/M) e se resolve sozinha.
-- =====================================================================

create or replace function public.planejado_espelha_orcado()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.tipo_custo in ('A', 'D') then
    new.valor_unitario_planejado := coalesce(new.valor_unitario_orcado, 0);
    new.quantidade_planejada     := coalesce(new.quantidade_orcada, 0);
    new.dias_meses_planejado     := coalesce(new.dias_meses_orcado, 0);
  end if;
  return new;
end;
$$;

comment on function public.planejado_espelha_orcado() is
  'Em item de custo A e D o planejado não é digitado: ele acompanha o orçado. Trigger porque são seis caminhos de escrita diferentes (21/08/2026, docs/decisions/022).';

-- `before`, para o valor já entrar corrigido e a coluna gerada
-- `total_planejado` calcular em cima do valor certo.
drop trigger if exists trg_planejado_espelha_orcado on public.versoes_orcamento_itens;
create trigger trg_planejado_espelha_orcado
before insert or update of
  tipo_custo, valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
  valor_unitario_planejado, quantidade_planejada, dias_meses_planejado
on public.versoes_orcamento_itens
for each row execute function public.planejado_espelha_orcado();

-- A cópia do job segue a mesma regra: a errata pode mudar o orçado de um
-- item `A` depois da abertura, e o planejado congelado tem que acompanhar
-- essa correção — ele continua sendo "o orçado do job".
drop trigger if exists trg_planejado_espelha_orcado_job on public.jobs_itens_orcado;
create trigger trg_planejado_espelha_orcado_job
before insert or update of
  tipo_custo, valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
  valor_unitario_planejado, quantidade_planejada, dias_meses_planejado
on public.jobs_itens_orcado
for each row execute function public.planejado_espelha_orcado();
