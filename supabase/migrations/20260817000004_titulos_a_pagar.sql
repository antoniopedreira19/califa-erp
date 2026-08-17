-- =====================================================================
-- Tela 3.2 — Contas a Pagar: aba "Títulos a Pagar" unificada
-- =====================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- A decisão 014 §7 adiou de propósito a baixa por parcela: "a 2.2 entrega
-- as parcelas e as leituras; a baixa por parcela entra na Tela 3.2, que
-- reestrutura Contas a Pagar em 'Títulos a Pagar' e vai refazer essa
-- máquina de todo jeito". É esta migration.
--
-- O QUE MUDA, EM UMA FRASE
--
-- O que se paga deixa de ser o Pedido de Produção inteiro e passa a ser a
-- PARCELA. A aprovação da PP pelo financeiro passa a definir uma data de
-- pagamento; a baixa passa a ser de uma parcela por vez; e o que vence
-- ganha duas datas distintas que antes eram uma só:
--
--   • VENCIMENTO ORIGINAL — o prazo que a produção negociou com o
--     fornecedor. É `pedidos_compra_parcelas.data_vencimento`, que já
--     existe e NÃO é tocado por ninguém depois de emitida a PP.
--   • DATA DE PAGAMENTO — quando o financeiro vai efetivamente pagar.
--     Nasce na aprovação, é repactuável, e é a coluna nova
--     `data_pagamento`.
--
-- E porque repactuação sem histórico é rasura, guardamos também a
-- PRIMEIRA data de pagamento definida (`data_pagamento_primeira`), que um
-- trigger congela: uma vez gravada, nenhum update a sobrescreve. O pop-up
-- de edição da data exibe as duas para sempre.
--
-- A REGRA DA PP PARCELADA (decisão do Tiago, 17/08/2026)
--
-- O formulário de aprovação tem UM campo de data, e a PP tem N parcelas.
-- A data escolhida DESLOCA TODAS AS PARCELAS PELO MESMO DELTA. Aprovar
-- em 01/09 uma PP cuja 1ª parcela vencia 25/08 (+7 dias) joga a 2ª de
-- 25/09 para 01/10 e a 3ª de 25/10 para 01/11 — o espaçamento que a
-- produção negociou é preservado, só o ponto de partida muda. Depois
-- disso cada parcela é repactuável individualmente, pelo lápis da aba
-- Títulos a Pagar.
--
-- CENTRO DE CUSTO (decisão do Tiago, 17/08/2026)
--
-- O protótipo pede "centro de custo do pagamento" obrigatório na baixa.
-- Isso é o par Tipo + Subtipo do plano de contas que a baixa JÁ exige
-- hoje (`lancamentos_financeiros.plano_conta_tipo_id/subtipo_id`, ambos
-- NOT NULL) — a própria legenda do protótipo diz "define onde o custo
-- entra no DRE". Nenhuma estrutura nova nasce por causa desse campo.
--
-- O QUE DELIBERADAMENTE FICOU DE FORA
--
-- • Nenhuma tabela-espelho de "títulos a pagar". A lista unificada nasce
--   de consulta sobre o que já existe: parcelas de PP aprovada +
--   `contas_avulsas` (que é onde a recorrência já materializa suas
--   ocorrências, via `gerar_ocorrencias_recorrentes`).
-- • `pedidos_compra.prazo_pagamento_financeiro` NÃO é removida. Vira
--   redundante (passa a espelhar a data da 1ª parcela) e ganha comentário
--   dizendo isso. Remover coluna é destrutivo e não é necessário aqui.
-- • `dar_baixa_pp` e `estornar_baixa_pp` (baixa da PP inteira) continuam
--   existindo e funcionando. A UI para de usá-las; apagar função é
--   destrutivo e não traz ganho.
--
-- Aditiva do começo ao fim: 5 colunas, 1 FK, 3 índices, 3 funções novas,
-- 1 trigger, 2 funções redefinidas e 2 views redefinidas. Nenhum DROP,
-- nenhuma linha apagada, e o único backfill preenche o que estava vazio.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Parcelas de PP: a data de pagamento e o seu histórico
-- ---------------------------------------------------------------------

alter table public.pedidos_compra_parcelas
  add column if not exists data_pagamento date,
  add column if not exists data_pagamento_primeira date;

comment on column public.pedidos_compra_parcelas.data_vencimento is
  'Vencimento ORIGINAL da parcela — o prazo negociado pela produção com o '
  'fornecedor, impresso no PDF. Congelado na emissão: repactuação do '
  'financeiro mexe em data_pagamento, nunca aqui.';

comment on column public.pedidos_compra_parcelas.data_pagamento is
  'Data em que o financeiro vai pagar ESTA parcela. Nasce na aprovação da '
  'PP (aprovar_pp_com_data) e é repactuável pelo lápis da aba Títulos a '
  'Pagar. Diferente de data_vencimento = título repactuado (exibido em '
  'vermelho na tela).';

comment on column public.pedidos_compra_parcelas.data_pagamento_primeira is
  'A PRIMEIRA data de pagamento já definida para esta parcela. Gravada '
  'junto com data_pagamento na aprovação e congelada por trigger — '
  'repactuar não a altera. É o histórico mínimo que o pop-up de edição '
  'exibe ao lado do vencimento original.';

-- A lista de títulos filtra "a pagar" e ordena por data de pagamento.
create index if not exists idx_pp_parcelas_a_pagar
  on public.pedidos_compra_parcelas (tenant_id, data_pagamento)
  where pago_em is null;


-- ---------------------------------------------------------------------
-- 2. Contas avulsas: as mesmas duas datas
-- ---------------------------------------------------------------------
--
-- Aqui `data_prevista_pagamento` (que já existe) passa a ser lida como o
-- vencimento ORIGINAL: é a data que quem lançou informou na criação. O
-- que a repactuação move é a `data_pagamento` nova.

alter table public.contas_avulsas
  add column if not exists data_pagamento date,
  add column if not exists data_pagamento_primeira date;

comment on column public.contas_avulsas.data_prevista_pagamento is
  'Vencimento ORIGINAL — a data informada na criação do lançamento (ou a '
  'data da ocorrência, quando gerada por recorrência). Exibida na coluna '
  '"Venc. original" da aba Títulos a Pagar.';

comment on column public.contas_avulsas.data_pagamento is
  'Data de pagamento vigente, repactuável pelo lápis da aba Títulos a '
  'Pagar. Nasce igual a data_prevista_pagamento.';

comment on column public.contas_avulsas.data_pagamento_primeira is
  'A primeira data de pagamento definida. Congelada por trigger, como na '
  'parcela de PP.';

-- Backfill que só PREENCHE o que está vazio (aditivo). Hoje a tabela tem
-- 0 linhas; o comando existe para o caso de a migration rodar num banco
-- que já tenha avulsas.
update public.contas_avulsas
   set data_pagamento          = coalesce(data_pagamento, data_prevista_pagamento),
       data_pagamento_primeira = coalesce(data_pagamento_primeira, data_prevista_pagamento)
 where data_prevista_pagamento is not null
   and (data_pagamento is null or data_pagamento_primeira is null);

create index if not exists idx_contas_avulsas_a_pagar
  on public.contas_avulsas (tenant_id, data_pagamento)
  where status = 'aprovada';


-- ---------------------------------------------------------------------
-- 3. Trigger que congela a primeira data de pagamento
-- ---------------------------------------------------------------------
--
-- Uma função só serve às duas tabelas: os nomes de coluna são iguais.
-- Regra: se já havia valor, ele permanece; se não havia, aceita o novo.
-- Sem isso, a promessa "ambas ficam registradas para sempre" que o
-- pop-up faz ao usuário dependeria só do frontend.

create or replace function public.congela_data_pagamento_primeira()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.data_pagamento_primeira is not null then
    new.data_pagamento_primeira := old.data_pagamento_primeira;
  end if;
  return new;
end;
$$;

comment on function public.congela_data_pagamento_primeira() is
  'Impede que data_pagamento_primeira seja sobrescrita depois de gravada. '
  'Usada por pedidos_compra_parcelas e contas_avulsas.';

drop trigger if exists trg_congela_primeira_data on public.pedidos_compra_parcelas;
create trigger trg_congela_primeira_data
  before update on public.pedidos_compra_parcelas
  for each row execute function public.congela_data_pagamento_primeira();

drop trigger if exists trg_congela_primeira_data on public.contas_avulsas;
create trigger trg_congela_primeira_data
  before update on public.contas_avulsas
  for each row execute function public.congela_data_pagamento_primeira();


-- ---------------------------------------------------------------------
-- 4. O lançamento financeiro aponta para a PARCELA que pagou
-- ---------------------------------------------------------------------
--
-- `pedido_compra_id` continua sendo preenchido (os CHECKs
-- chk_origem_tem_referencia / chk_origem_contraparte_tem_id dependem
-- dele). A coluna nova diz QUAL parcela daquela PP o lançamento quitou —
-- sem ela, PP de 3 parcelas gera 3 lançamentos indistinguíveis.

alter table public.lancamentos_financeiros
  add column if not exists pedido_compra_parcela_id uuid
    references public.pedidos_compra_parcelas(id) on delete restrict;

comment on column public.lancamentos_financeiros.pedido_compra_parcela_id is
  'Parcela de PP que este lançamento quitou. Nulo em lançamento que não '
  'veio de baixa de parcela (avulsa, título a receber, manual, e as baixas '
  'de PP inteira anteriores à Tela 3.2).';

create index if not exists idx_lancamentos_pp_parcela
  on public.lancamentos_financeiros (pedido_compra_parcela_id);


-- ---------------------------------------------------------------------
-- 5. aprovar_pp_com_data — aprovação define a data de pagamento
-- ---------------------------------------------------------------------
--
-- Substitui, na UI, o par "salvar prazo financeiro" + "aprovar". A data
-- é obrigatória: sem ela não existe título a pagar com vencimento.
-- Desloca TODAS as parcelas pelo mesmo delta (ver cabeçalho).
--
-- `aprovar_pp` (sem data) continua existindo e não é tocada.

create or replace function public.aprovar_pp_com_data(
  p_pp_id          uuid,
  p_data_pagamento date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pp             pedidos_compra%rowtype;
  v_user_id        uuid := auth.uid();
  v_venc_primeira  date;
  v_delta          integer;
begin
  select * into v_pp from public.pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;

  if not public.is_tenant_member(v_pp.tenant_id) then
    raise exception 'Sem acesso a esta PP.';
  end if;

  if v_pp.status <> 'em_avaliacao' then
    raise exception 'PP precisa estar em avaliação (status atual: %).', v_pp.status;
  end if;

  if p_data_pagamento is null then
    raise exception 'Escolha a data de pagamento antes de aprovar.';
  end if;

  -- Âncora do deslocamento: o vencimento da 1ª parcela.
  select data_vencimento into v_venc_primeira
    from public.pedidos_compra_parcelas
   where pedido_compra_id = p_pp_id
   order by numero
   limit 1;

  if v_venc_primeira is null then
    raise exception 'PP sem parcelas — não é possível aprovar.';
  end if;

  v_delta := p_data_pagamento - v_venc_primeira;

  update public.pedidos_compra_parcelas
     set data_pagamento          = data_vencimento + v_delta,
         data_pagamento_primeira = coalesce(data_pagamento_primeira,
                                            data_vencimento + v_delta)
   where pedido_compra_id = p_pp_id;

  update public.pedidos_compra
     set status                     = 'aprovada',
         aprovada_em                = now(),
         aprovada_por               = v_user_id,
         -- Espelho legado: a data da 1ª parcela. Ver comentário da coluna.
         prazo_pagamento_financeiro = p_data_pagamento
   where id = p_pp_id;
end;
$$;

comment on function public.aprovar_pp_com_data(uuid, date) is
  'Aprova a PP e define a data de pagamento das parcelas, deslocando '
  'todas pelo mesmo delta em relação ao vencimento da 1ª. Tela 3.2.';

-- `grant ... to authenticated` não basta: toda função nasce com EXECUTE
-- para PUBLIC, e PUBLIC inclui `anon` (visitante SEM login). O advisor
-- `anon_security_definer_function_executable` acusa exatamente isso. As
-- guardas internas (is_tenant_member / auth.uid()) já barrariam o anon,
-- mas função nova não precisa herdar a porta aberta.
revoke execute on function public.aprovar_pp_com_data(uuid, date) from public;
grant  execute on function public.aprovar_pp_com_data(uuid, date) to authenticated;

comment on column public.pedidos_compra.prazo_pagamento_financeiro is
  'LEGADO desde a Tela 3.2 (17/08/2026): espelha a data de pagamento da 1ª '
  'parcela. A verdade por parcela vive em '
  'pedidos_compra_parcelas.data_pagamento. Mantida porque outras leituras '
  'antigas podem depender dela.';


-- ---------------------------------------------------------------------
-- 6. dar_baixa_pp_parcela — a baixa passa a ser por parcela
-- ---------------------------------------------------------------------
--
-- Mesmas validações de dar_baixa_pp (conta da empresa, conta ativa, data
-- >= saldo inicial, subtipo pertence ao tipo), com três diferenças:
--   • o valor do lançamento é o da PARCELA, não o da PP;
--   • a parcela é marcada paga, não a PP;
--   • a PP só vira 'pago' quando a ÚLTIMA parcela em aberto é baixada.

create or replace function public.dar_baixa_pp_parcela(
  p_parcela_id             uuid,
  p_pago_em                date,
  p_conta_bancaria_id      uuid,
  p_plano_conta_tipo_id    uuid,
  p_plano_conta_subtipo_id uuid,
  p_criado_por             uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcela        pedidos_compra_parcelas%rowtype;
  v_pp             pedidos_compra%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_total          integer;
  v_em_aberto      integer;
  v_subtipo_tipo   uuid;
  v_lancamento_id  uuid;
  v_descricao      text;
begin
  select * into v_parcela from public.pedidos_compra_parcelas where id = p_parcela_id;
  if not found then raise exception 'Parcela não encontrada.'; end if;

  if not public.is_tenant_member(v_parcela.tenant_id) then
    raise exception 'Sem acesso a esta parcela.';
  end if;

  if v_parcela.pago_em is not null then
    raise exception 'Esta parcela já está paga.';
  end if;

  select * into v_pp from public.pedidos_compra where id = v_parcela.pedido_compra_id;
  if not found then raise exception 'PP não encontrada.'; end if;

  if v_pp.status <> 'aprovada' then
    raise exception 'A PP precisa estar aprovada antes da baixa (status atual: %).', v_pp.status;
  end if;

  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.empresa_id <> v_pp.empresa_id then
    raise exception 'Conta bancária não pertence à empresa da PP.';
  end if;
  if not v_conta.ativo then
    raise exception 'Conta bancária está inativa.';
  end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
  end if;

  select tipo_id into v_subtipo_tipo
    from public.plano_contas_subtipos
   where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  select count(*)::int into v_total
    from public.pedidos_compra_parcelas
   where pedido_compra_id = v_pp.id;

  update public.pedidos_compra_parcelas
     set pago_em  = p_pago_em,
         pago_por = p_criado_por
   where id = p_parcela_id;

  v_descricao := 'PP ' || v_pp.codigo
                 || ' ' || v_parcela.numero || '/' || v_total
                 || ' — ' || substring(v_pp.servico, 1, 140);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, job_id, pedido_compra_id, pedido_compra_parcela_id,
    origem, criado_por
  ) values (
    v_pp.tenant_id, v_pp.empresa_id, p_conta_bancaria_id, p_pago_em, v_parcela.valor,
    'saida', v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    v_pp.fornecedor_id, v_pp.job_id, v_pp.id, v_parcela.id,
    'pp_baixa', p_criado_por
  )
  returning id into v_lancamento_id;

  -- A PP inteira só está paga quando não sobra parcela em aberto.
  select count(*)::int into v_em_aberto
    from public.pedidos_compra_parcelas
   where pedido_compra_id = v_pp.id and pago_em is null;

  if v_em_aberto = 0 then
    update public.pedidos_compra
       set status   = 'pago',
           pago_em  = p_pago_em,
           pago_por = p_criado_por
     where id = v_pp.id;
  end if;

  return v_lancamento_id;
end;
$$;

comment on function public.dar_baixa_pp_parcela(uuid, date, uuid, uuid, uuid, uuid) is
  'Baixa UMA parcela de PP aprovada, gera o lançamento com o valor da '
  'parcela e promove a PP a paga quando a última parcela é quitada. '
  'Tela 3.2.';

revoke execute on function public.dar_baixa_pp_parcela(uuid, date, uuid, uuid, uuid, uuid) from public;
grant  execute on function public.dar_baixa_pp_parcela(uuid, date, uuid, uuid, uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 7. dar_baixa_avulsa_com_plano — baixa de avulsa escolhendo o plano
-- ---------------------------------------------------------------------
--
-- A `dar_baixa_avulsa` existente herda tipo/subtipo da própria avulsa e
-- não aceita escolha. A aba unificada usa UM modal de baixa para todas as
-- origens, e nele o plano de contas é obrigatório e editável (vem
-- pré-preenchido com o da avulsa). O valor escolhido vai para o
-- LANÇAMENTO — a classificação da avulsa, feita na criação, não é
-- reescrita: são coisas diferentes, e por isso lancamentos_financeiros
-- tem colunas próprias de plano de contas.
--
-- A função antiga continua servindo a rota de detalhe da avulsa.

create or replace function public.dar_baixa_avulsa_com_plano(
  p_conta_avulsa_id        uuid,
  p_pago_em                date,
  p_conta_bancaria_id      uuid,
  p_plano_conta_tipo_id    uuid,
  p_plano_conta_subtipo_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_uid     uuid;
  v_avulsa         contas_avulsas%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_subtipo_tipo   uuid;
  v_descricao      text;
  v_lancamento_id  uuid;
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then raise exception 'Sessão inválida.'; end if;

  select * into v_avulsa from public.contas_avulsas where id = p_conta_avulsa_id;
  if not found then raise exception 'Conta avulsa não encontrada.'; end if;

  if not public.is_tenant_member(v_avulsa.tenant_id) then
    raise exception 'Sem permissão nesta conta avulsa.';
  end if;

  if v_avulsa.status <> 'aprovada' then
    raise exception 'Só avulsa aprovada pode ser baixada (status atual: %).', v_avulsa.status;
  end if;

  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.empresa_id <> v_avulsa.empresa_id then
    raise exception 'Conta bancária não pertence à empresa da conta avulsa.';
  end if;
  if not v_conta.ativo then
    raise exception 'Conta bancária está inativa.';
  end if;
  if p_pago_em < v_conta.saldo_inicial_data then
    raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
  end if;

  select tipo_id into v_subtipo_tipo
    from public.plano_contas_subtipos
   where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  update public.contas_avulsas
     set status                  = 'baixada',
         pago_em                 = p_pago_em,
         pago_por                = v_caller_uid,
         conta_bancaria_baixa_id = p_conta_bancaria_id
   where id = p_conta_avulsa_id;

  v_descricao := 'Avulsa · ' || substring(v_avulsa.descricao, 1, 180);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id, conta_avulsa_id,
    origem, criado_por
  ) values (
    v_avulsa.tenant_id, v_avulsa.empresa_id, p_conta_bancaria_id, p_pago_em, v_avulsa.valor,
    v_avulsa.natureza, v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    v_avulsa.fornecedor_id, v_avulsa.cliente_id, v_avulsa.job_id, v_avulsa.id,
    'avulsa_baixa', v_caller_uid
  )
  returning id into v_lancamento_id;

  return v_lancamento_id;
end;
$$;

comment on function public.dar_baixa_avulsa_com_plano(uuid, date, uuid, uuid, uuid) is
  'Baixa de conta avulsa com plano de contas escolhido no ato (o "centro '
  'de custo" do modal unificado da Tela 3.2). Grava a escolha no '
  'lançamento; a classificação da própria avulsa não é reescrita.';

revoke execute on function public.dar_baixa_avulsa_com_plano(uuid, date, uuid, uuid, uuid) from public;
grant  execute on function public.dar_baixa_avulsa_com_plano(uuid, date, uuid, uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 8. Ocorrência de recorrência nasce com as duas datas preenchidas
-- ---------------------------------------------------------------------
--
-- Redefinição de gerar_ocorrencias_recorrentes: idêntica à anterior, mais
-- data_pagamento e data_pagamento_primeira no INSERT. Sem isso, ocorrência
-- gerada depois desta migration entraria na aba Títulos sem data de
-- pagamento.

create or replace function public.gerar_ocorrencias_recorrentes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template  contas_avulsas_recorrentes%rowtype;
  v_geradas   integer := 0;
  v_nova_id   uuid;
  v_prox_data date;
begin
  for v_template in
    select *
      from public.contas_avulsas_recorrentes
     where ativo = true
       and proxima_data <= current_date
       and (data_fim is null or proxima_data <= data_fim)
     order by tenant_id, proxima_data
  loop
    insert into public.contas_avulsas (
      tenant_id, empresa_id, descricao, valor, natureza,
      data_prevista_pagamento, data_pagamento, data_pagamento_primeira, status,
      aprovada_em, aprovada_por,
      fornecedor_id, cliente_id, job_id,
      plano_conta_tipo_id, plano_conta_subtipo_id,
      recorrente_id, criado_por
    ) values (
      v_template.tenant_id, v_template.empresa_id, v_template.descricao,
      v_template.valor, 'saida',
      v_template.proxima_data, v_template.proxima_data, v_template.proxima_data, 'aprovada',
      now(), v_template.criado_por,
      v_template.fornecedor_id, v_template.cliente_id, v_template.job_id,
      v_template.plano_conta_tipo_id, v_template.plano_conta_subtipo_id,
      v_template.id, v_template.criado_por
    )
    returning id into v_nova_id;

    v_geradas := v_geradas + 1;

    insert into public.contas_avulsas_regionais (
      tenant_id, conta_avulsa_id, regional_id, percentual
    )
    select
      v_template.tenant_id, v_nova_id, r.regional_id, r.percentual
      from public.contas_avulsas_recorrentes_regionais r
     where r.recorrente_id = v_template.id;

    v_prox_data := public.calcular_proxima_data_recorrencia(v_template);

    if v_template.data_fim is not null and v_prox_data > v_template.data_fim then
      update public.contas_avulsas_recorrentes
         set ativo = false, proxima_data = v_prox_data
       where id = v_template.id;
    else
      update public.contas_avulsas_recorrentes
         set proxima_data = v_prox_data
       where id = v_template.id;
    end if;

    insert into public.audit_events (
      tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
    ) values (
      v_template.tenant_id, 'conta_recorrente', v_template.id::text,
      'conta_recorrente.ocorrencia_gerada', null,
      jsonb_build_object(
        'avulsa_id', v_nova_id,
        'data_movimento', v_template.proxima_data,
        'valor', v_template.valor,
        'nasceu_aprovada', true
      )
    );
  end loop;

  return v_geradas;
end;
$$;


-- ---------------------------------------------------------------------
-- 9. Views: previsão de saída passa a ser por parcela
-- ---------------------------------------------------------------------
--
-- Antes, PP aprovada era UMA linha com o valor cheio e a data de
-- `prazo_pagamento_financeiro`. Com parcelas, isso mente duas vezes:
-- concentra num dia só o que sai em três, e continua contando o que já
-- foi pago. Agora cada parcela EM ABERTO é uma linha, com o seu valor e a
-- sua data de pagamento.
--
-- `origem_id` do ramo de PP passa a ser o id da PARCELA. As colunas, os
-- tipos e a ordem não mudam — por isso `create or replace` basta. Nenhum
-- código da aplicação lê estas views hoje (conferido por grep); elas
-- servem à Tela 3.4, ainda por implementar.
--
-- O cast `par.valor::numeric(14,2)` é obrigatório: `pedidos_compra.valor`
-- é numeric(14,2) e `pedidos_compra_parcelas.valor` nasceu numeric sem
-- precisão (migration 20260817000002). `create or replace view` recusa
-- mudar o tipo de uma coluna existente, e mexer no tipo da coluna já
-- populada seria destrutivo — então o acerto mora aqui.

create or replace view public.vw_a_pagar as
  select
    'pp'::text                                      as origem_tipo,
    par.id                                          as origem_id,
    pp.tenant_id,
    pp.empresa_id,
    par.data_pagamento                              as data_prevista,
    par.valor::numeric(14,2)                        as valor,
    'saida'::natureza_lancamento                    as natureza,
    'PP ' || pp.codigo || ' ' || par.numero || '/' || tot.total
      || ' — ' || substring(pp.servico, 1, 150)     as descricao,
    pp.fornecedor_id,
    null::uuid                                      as cliente_id,
    pp.job_id,
    pp.aprovada_em,
    pp.aprovada_por
  from public.pedidos_compra_parcelas par
  join public.pedidos_compra pp on pp.id = par.pedido_compra_id
  join lateral (
    select count(*)::int as total
      from public.pedidos_compra_parcelas x
     where x.pedido_compra_id = par.pedido_compra_id
  ) tot on true
  where pp.status in ('aprovada', 'pago')
    and par.pago_em is null

  union all

  select
    case when a.recorrente_id is not null then 'recorrente'::text
         else 'avulsa'::text end                    as origem_tipo,
    a.id                                            as origem_id,
    a.tenant_id,
    a.empresa_id,
    coalesce(a.data_pagamento, a.data_prevista_pagamento) as data_prevista,
    a.valor,
    a.natureza,
    a.descricao,
    a.fornecedor_id,
    a.cliente_id,
    a.job_id,
    a.aprovada_em,
    a.aprovada_por
  from public.contas_avulsas a
  where a.status = 'aprovada';


create or replace view public.vw_fluxo_caixa as
  select
    'previsto'::text                                as situacao,
    'pp'::text                                      as origem_tipo,
    par.id                                          as origem_id,
    pp.tenant_id,
    pp.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    par.data_pagamento                              as data_evento,
    par.valor::numeric(14,2)                        as valor,
    'saida'::natureza_lancamento                    as natureza,
    'PP ' || pp.codigo || ' ' || par.numero || '/' || tot.total
      || ' — ' || substring(pp.servico, 1, 150)     as descricao,
    pp.fornecedor_id,
    null::uuid                                      as cliente_id,
    pp.job_id
  from public.pedidos_compra_parcelas par
  join public.pedidos_compra pp on pp.id = par.pedido_compra_id
  join lateral (
    select count(*)::int as total
      from public.pedidos_compra_parcelas x
     where x.pedido_compra_id = par.pedido_compra_id
  ) tot on true
  where pp.status in ('aprovada', 'pago')
    and par.pago_em is null

  union all

  select
    'previsto'::text                                as situacao,
    case when a.recorrente_id is not null then 'recorrente'::text
         else 'avulsa'::text end                    as origem_tipo,
    a.id                                            as origem_id,
    a.tenant_id,
    a.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    coalesce(a.data_pagamento, a.data_prevista_pagamento) as data_evento,
    a.valor,
    a.natureza,
    a.descricao,
    a.fornecedor_id,
    a.cliente_id,
    a.job_id
  from public.contas_avulsas a
  where a.status = 'aprovada'

  union all

  select
    'previsto'::text                                as situacao,
    'titulo'::text                                  as origem_tipo,
    t.id                                            as origem_id,
    t.tenant_id,
    t.empresa_id,
    null::uuid                                      as conta_bancaria_id,
    t.data_vencimento                               as data_evento,
    t.valor,
    'entrada'::natureza_lancamento                  as natureza,
    'Título NF ' || f.numero_nf || '/' || t.numero_parcela::text as descricao,
    f.fornecedor_id,
    f.cliente_id,
    null::uuid                                      as job_id
  from public.titulos_receber t
  join public.faturamentos f on f.id = t.faturamento_id
  where t.status = 'em_aberto'

  union all

  select
    'realizado'::text                               as situacao,
    'lancamento'::text                              as origem_tipo,
    l.id                                            as origem_id,
    l.tenant_id,
    l.empresa_id,
    l.conta_bancaria_id,
    l.data_movimento                                as data_evento,
    l.valor,
    l.natureza,
    l.descricao,
    l.fornecedor_id,
    l.cliente_id,
    l.job_id
  from public.lancamentos_financeiros l;
