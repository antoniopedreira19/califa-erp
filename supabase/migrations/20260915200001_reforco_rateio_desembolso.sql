-- =====================================================================
-- Reforço no banco: o rateio do desembolso soma 100% e é exigido na aprovação
--
-- Continua a decisão 069 ("sem job -> destrincha em N regionais"). Até
-- aqui só o FORMULÁRIO garantia a divisão do desembolso (mínimo 1
-- regional, soma 100%); o banco aceitava qualquer coisa. Pedido do Tiago
-- em 15/09/2026: reforço no banco.
--
-- ---------------------------------------------------------------------
-- 1. Soma 100% em `desembolsos_regionais`
--
-- Espelho exato das travas que avulsa e recorrente já têm
-- (`enforce_rateio_soma_100_avulsa` / `_recorrente`): constraint trigger
-- ADIADO para o fim da transação, que ACEITA ZERO LINHAS e recusa soma
-- diferente de 100 com tolerância de 0,01 — a mesma do formulário.
--
-- ---------------------------------------------------------------------
-- 2. Desembolso sem rateio não é aprovado
--
-- Por que NA APROVAÇÃO e não na criação: a tela grava o desembolso, as
-- parcelas e a divisão em TRÊS requisições separadas — três transações.
-- Uma trava "pelo menos uma linha" no insert do desembolso dispararia no
-- commit da primeira, antes de a divisão existir, e quebraria toda
-- criação. É o mesmo erro de 08/09 (NOT NULL que mirou o lugar errado).
--
-- A aprovação é outra transação, sempre posterior, e é exatamente o
-- momento em que o desembolso ENTRA no fluxo de caixa (a view só lê
-- desembolso `aprovada` ou `pago`). Travar ali garante a regional de
-- tudo que chega ao DRE, sem tocar na criação.
--
-- A trava olha só a transição `em_avaliacao` -> `aprovada`. O estorno de
-- baixa (`estornar_baixa_desembolso_parcela`) devolve o desembolso de
-- `pago` para `aprovada` e NÃO pode ser barrado aqui.
--
-- SECURITY DEFINER para enxergar a divisão independentemente da RLS de
-- quem aprova; a aprovação real já passa por uma RPC SECURITY DEFINER.
--
-- ---------------------------------------------------------------------
-- O que fica fora, de propósito: avulsa e recorrente
--
-- As duas nascem já aprovadas — não há etapa entre criar e entrar no
-- fluxo — e a edição apaga a divisão numa requisição e grava a nova em
-- outra. Não existe ponto seguro equivalente sem mudar comportamento; a
-- escolha foi levada ao Tiago.
--
-- Verificado com a tabela vazia (0 desembolsos): não há dado a validar
-- nem a quebrar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Soma 100%
-- ---------------------------------------------------------------------
create or replace function public.enforce_rateio_soma_100_desembolso()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_desembolso_id uuid;
  v_soma numeric(7,2);
begin
  if tg_op = 'DELETE' then
    v_desembolso_id := old.desembolso_id;
  else
    v_desembolso_id := new.desembolso_id;
  end if;

  select coalesce(sum(percentual), 0)
    into v_soma
    from public.desembolsos_regionais
   where desembolso_id = v_desembolso_id;

  if v_soma > 0 and abs(v_soma - 100.00) >= 0.01 then
    raise exception 'A divisão entre regionais do desembolso soma % por cento; precisa somar 100.', v_soma
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

create constraint trigger trg_desembolso_rateio_soma
  after insert or update or delete on public.desembolsos_regionais
  deferrable initially deferred
  for each row execute function public.enforce_rateio_soma_100_desembolso();

comment on function public.enforce_rateio_soma_100_desembolso() is
  'Soma 100% do rateio de regional do desembolso, conferida no fim da transação. Aceita zero linhas (a exigência de ao menos uma fica na aprovação). Espelho de enforce_rateio_soma_100_avulsa. Ver 20260915200001.';

-- ---------------------------------------------------------------------
-- 2. Aprovação exige rateio
-- ---------------------------------------------------------------------
create or replace function public.desembolso_aprovado_exige_rateio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'em_avaliacao'
     and new.status = 'aprovada'
     and not exists (
       select 1 from public.desembolsos_regionais r where r.desembolso_id = new.id
     ) then
    raise exception 'Este desembolso não tem rateio de regional. Informe ao menos uma regional antes de aprovar.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger trg_desembolso_aprovado_exige_rateio
  before update of status on public.desembolsos
  for each row execute function public.desembolso_aprovado_exige_rateio();

comment on function public.desembolso_aprovado_exige_rateio() is
  'Barra a transição em_avaliacao -> aprovada de desembolso sem nenhuma linha em desembolsos_regionais. A aprovação é o momento em que o desembolso entra no fluxo de caixa; a criação não é travada porque grava desembolso e rateio em requisições separadas. Decisão 069, reforço de 15/09/2026.';

comment on table public.desembolsos_regionais is
  'O rateio de regional do desembolso. Lido pela vw_fluxo_caixa desde 10/09/2026 (069). Desde 15/09/2026 soma 100% conferida no banco (trg_desembolso_rateio_soma) e ao menos uma linha exigida na aprovação (trg_desembolso_aprovado_exige_rateio).';
