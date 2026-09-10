-- ===========================================================================
-- A PP nasce carimbada em Custo Operacional
-- ===========================================================================
-- Pedido do Tiago em 10/09/2026, olhando para a frente: ele vai destrinchar
-- a previsão de fluxo de caixa por centro de custo, e para isso o centro
-- precisa estar NO DADO, não só na tela.
--
-- O que existia: `pedidos_compra.plano_conta_tipo_id` só era preenchido
-- quando a PP ia para o cartão de crédito — nos outros casos ficava nulo, e
-- a tela de Títulos a Pagar mostrava "Custo Operacional" por um `??` no
-- servidor, calculado a cada carregamento. Bom para exibir, inútil para
-- somar: nenhuma consulta ao banco enxerga um default que só existe no
-- TypeScript.
--
-- O que passa a valer: **toda PP é custo de job** — `job_id` é NOT NULL,
-- não existe PP fora de job — então toda PP entra em Custo Operacional
-- (código '02') quando nasce sem tipo. O SUBTIPO continua vazio de
-- propósito: quem escolhe é o financeiro na baixa, em Títulos a Pagar
-- (decisão do Tiago, 10/09/2026). O único subtipo que o tipo 02 tem hoje é
-- um "Geral (provisório)", e carimbar o histórico inteiro com um provisório
-- daria trabalho de desfazer quando os subtipos de verdade existirem.
--
-- Por que TRIGGER e não uma linha na action que cria a PP: já existe mais de
-- um caminho de criação (gerar e reenviar), e o carimbo tem que valer para
-- os que ainda vão existir. Aqui ele é uma regra da tabela.
--
-- A PP do cartão não muda: lá o financeiro escolhe tipo e subtipo na
-- aprovação, e o `rotear_pp_para_cartao` sobrescreve o que este trigger
-- pôs. O trigger só age quando o campo chega nulo.

-- ---------------------------------------------------------------------------
-- 1. A função
-- ---------------------------------------------------------------------------
create or replace function public.pp_default_custo_operacional()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.plano_conta_tipo_id is null then
    select t.id
      into new.plano_conta_tipo_id
      from public.plano_contas_tipos t
     where t.tenant_id = new.tenant_id
       and t.codigo = '02'
     limit 1;
  end if;
  return new;
end;
$$;

comment on function public.pp_default_custo_operacional() is
  'Carimba a PP em Custo Operacional (tipo 02) quando ela nasce sem centro de custo. Toda PP é custo de job. O subtipo fica para a baixa.';

-- ---------------------------------------------------------------------------
-- 2. O gatilho
-- ---------------------------------------------------------------------------
drop trigger if exists trg_pp_default_custo_operacional on public.pedidos_compra;

create trigger trg_pp_default_custo_operacional
  before insert on public.pedidos_compra
  for each row
  execute function public.pp_default_custo_operacional();

-- ---------------------------------------------------------------------------
-- 3. Backfill — aditivo: só preenche o que está vazio
-- ---------------------------------------------------------------------------
-- 26 das 27 PPs existentes estão com o campo nulo. Elas JÁ aparecem como
-- Custo Operacional na tela de Títulos a Pagar, pelo default do servidor;
-- este update só torna explícito o que a tela já mostra. Nenhuma linha com
-- valor tem o valor trocado.
update public.pedidos_compra pc
   set plano_conta_tipo_id = t.id
  from public.plano_contas_tipos t
 where t.tenant_id = pc.tenant_id
   and t.codigo = '02'
   and pc.plano_conta_tipo_id is null;
