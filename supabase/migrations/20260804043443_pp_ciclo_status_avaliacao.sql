-- =====================================================================
-- PP — ciclo de avaliação do financeiro
-- 'emitida' vira 'em_avaliacao'; entram 'pago' e 'rejeitada'.
-- Ver design: "Jobs - Fluxo.dc.html", aba Pedidos de Produção.
-- =====================================================================

-- 1. Rename migra as rows existentes junto: toda PP emitida hoje está,
-- de fato, aguardando avaliação do financeiro. O design não tem estado
-- "Emitida" — a PP nasce em avaliação.
alter type pp_status rename value 'emitida' to 'em_avaliacao';

-- 2. Novos estados. Não podem ser USADOS nesta mesma transação (regra do
-- Postgres pra ADD VALUE); aqui só declaramos.
alter type pp_status add value if not exists 'pago';
alter type pp_status add value if not exists 'rejeitada';

-- 3. Default acompanha o rename.
alter table public.pedidos_compra
  alter column status set default 'em_avaliacao'::pp_status;

-- 4. Pagamento: flag simples aplicada pelo financeiro, com a data real do
-- pagamento (pode ser retroativa). Contas a pagar de verdade continua
-- pendente de `lancamentos_financeiros` numa fase futura, e vai reusar
-- este status como ponto de partida.
alter table public.pedidos_compra
  add column if not exists pago_em date,
  add column if not exists pago_por uuid references public.profiles(id);

-- 5. Rejeição pelo financeiro, com motivo obrigatório na action. Colunas
-- próprias em vez de reusar as de cancelamento: rejeitar e cancelar são
-- eventos diferentes e uma PP pode passar pelos dois.
alter table public.pedidos_compra
  add column if not exists rejeitada_por uuid references public.profiles(id),
  add column if not exists rejeitada_em timestamptz,
  add column if not exists motivo_rejeicao text;

-- Nota: o unique parcial `uniq_pp_ativa_por_item_realizado` continua
-- válido — o predicado é `status <> 'cancelada'` e 'cancelada' não mudou.
-- Logo em_avaliacao, rejeitada e pago seguem bloqueando nova PP no item,
-- e só o cancelamento libera. É o comportamento certo: PP rejeitada se
-- corrige e reenvia, não se duplica.
