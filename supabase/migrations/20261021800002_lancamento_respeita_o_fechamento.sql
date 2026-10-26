-- =============================================================================
-- 20261021800002 — O fechamento da conciliação trava o caixa dos lançamentos
-- (task 029, fase 4: M4.2; decisão 203)
-- =============================================================================
-- Com a conciliação de uma conta fechada até um dia (20261021800001), o caixa
-- dela até ali não muda (o Extrato e o DFC). A trava mora num gatilho em
-- `lancamentos_financeiros`, e não em cada função de baixa: 32 funções gravam
-- na tabela (baixas, estornos, transferência, juros, cancelamentos, a
-- conciliação), e a policy `lancamentos_modify` (FOR ALL) deixa o usuário
-- gravar direto pelo PostgREST. O gatilho pega todos os caminhos.
--
-- O que ele recusa, com "Período fechado até dd/mm: reabra a conciliação
-- para mudar esse lançamento." (opção B do Tiago, 21/10/2026):
-- • INSERT com data até o fechamento da conta: a baixa, o estorno, a
--   transferência, os juros, o lançamento pela regra;
-- • DELETE de lançamento com data até lá: o cancelamento da baixa, o desfazer;
-- • UPDATE que troca o que é caixa — a data, o valor, a natureza, a conta, o
--   centro de custo (tipo e subtipo do plano) ou o vínculo com o banco
--   (`extrato_linha_id`) —, olhando a data e a conta de antes E as de
--   depois: tirar um lançamento do período fechado também é mudar o caixa.
--
-- O que ele NÃO recusa (opção B, e não a A, que travava tudo): o UPDATE dos
-- campos descritivos — job, regional, empresa, descrição, fornecedor,
-- cliente, origem, título, fatura. Assim a emissão da NF de um recebimento
-- antes da nota (`emitir_faturamento`/`cancelar_faturamento`, que trocam a
-- origem, o título e a empresa do lançamento) e os ajustes de cadastro de
-- outros módulos continuam funcionando num período fechado.
--
-- A conta de cartão (conta-espelho) não tem extrato importado nem
-- fechamento: o gatilho não age nela.
--
-- Mudança em tabela COMPARTILHADA, confirmada pelo Tiago em 21/10/2026
-- (M4.2, opção B). Nenhuma coluna, constraint ou policy existente muda; só
-- um gatilho novo. Enquanto nenhuma conta tem fechamento ativo, ele não
-- recusa nada.
-- =============================================================================

create or replace function public.lancamento_respeita_o_fechamento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public._exige_periodo_aberto(new.conta_bancaria_id, new.data_movimento);
    return new;
  elsif tg_op = 'DELETE' then
    perform public._exige_periodo_aberto(old.conta_bancaria_id, old.data_movimento);
    return old;
  end if;

  if (new.data_movimento, new.valor, new.natureza, new.conta_bancaria_id,
      new.plano_conta_tipo_id, new.plano_conta_subtipo_id, new.extrato_linha_id)
     is distinct from
     (old.data_movimento, old.valor, old.natureza, old.conta_bancaria_id,
      old.plano_conta_tipo_id, old.plano_conta_subtipo_id, old.extrato_linha_id) then
    perform public._exige_periodo_aberto(old.conta_bancaria_id, old.data_movimento);
    perform public._exige_periodo_aberto(new.conta_bancaria_id, new.data_movimento);
  end if;
  return new;
end;
$$;

revoke all on function public.lancamento_respeita_o_fechamento() from public, anon, authenticated;

comment on function public.lancamento_respeita_o_fechamento() is
  'Decisão 203 (M4.2, opção B): recusa o insert, o delete e a troca de data, valor, natureza, conta, centro de custo ou vínculo com o banco de lançamento com data até o fechamento ativo da conciliação da conta.';

create trigger trg_lancamento_respeita_o_fechamento
  before insert or update or delete on public.lancamentos_financeiros
  for each row execute function public.lancamento_respeita_o_fechamento();
