-- =====================================================================
-- As ações da Conciliação automática (task 029, fase 3, entrega 3B — decisão 200)
-- =====================================================================
--
-- O que cada linha do banco pode receber, pela aba Banco:
--
--   - conciliar_linha: liga a linha aos lançamentos que ela paga (a baixa
--     feita à mão, a baixa que a própria conciliação acabou de dar). A soma
--     tem de bater centavo a centavo; a baixa e os juros dela e as partes de
--     uma guia de imposto vão juntos. As baixas passam à data do banco, em
--     tudo: o lançamento, os juros e o dia em que o documento foi pago
--     (Tiago, 21/10/2026, "Data do banco em tudo"); a data de antes fica
--     guardada para o desfazer;
--   - conciliar_linha_pelos_documentos: o mesmo, achando o lançamento pelo
--     documento que acabou de ser baixado (a parcela, a avulsa, a nota, o
--     imposto…), sem as actions de baixa precisarem devolver o id;
--   - corrigir_baixa_pela_conciliacao: a baixa feita à mão que não bate com
--     o banco passa a ter o valor e a data dele. A diferença vira juros só
--     no boleto; no resto muda o valor pago, e o título volta a ter a
--     diferença em aberto (Tiago, 21/10/2026). Banco maior que a baixa fora
--     do boleto é recusado. A correção cancela a baixa e a refaz pelas RPCs
--     de sempre — o documento fica no estado que elas sabem produzir — e o
--     de → para, com o motivo, fica em `baixa_correcoes` e na auditoria;
--   - lancar_pela_regra: a tarifa e o IOF viram lançamento `manual` com o
--     centro de custo e a empresa da regra (M3.5); criar_regra_do_extrato é
--     o "Lembrar como regra";
--   - registrar_saiu_e_voltou: as duas pernas, origem `devolucao_bancaria`,
--     sem empresa e sem plano, como a transferência (M3.6, opção A);
--   - ignorar_linha e desfazer_conciliacao. O desfazer devolve as baixas
--     nascidas na conciliação para a tela cancelar pelas actions de sempre;
--     a ligação volta a data de antes; a correção volta a baixa de antes; a
--     regra e o "saiu e voltou" apagam os lançamentos que criaram. A linha
--     desfeita não se resolve mais sozinha (`sem_auto`).
--
-- Mudanças em tabela compartilhada (`lancamentos_financeiros`), todas
-- confirmadas pelo Tiago em 21/10/2026:
--   - as três travas ganham o ramo de `devolucao_bancaria` (sem empresa,
--     sem plano, sem documento), sem mudar as regras existentes;
--   - a policy de leitura ganha o ramo "devolução bancária sem empresa,
--     para admin e financeiro", igual ao da perna de transferência — sem
--     ele as duas pernas ficariam invisíveis para todo mundo.
-- =====================================================================

-- -----------------------------------------------------------------------------
-- 1. As travas de lancamentos_financeiros: o ramo da devolução bancária
-- -----------------------------------------------------------------------------

alter table public.lancamentos_financeiros drop constraint chk_lancamento_sem_empresa_so_transferencia;
alter table public.lancamentos_financeiros add constraint chk_lancamento_sem_empresa_so_transferencia check (
  (
    origem = any (array['transferencia_saida'::origem_lancamento, 'transferencia_entrada'::origem_lancamento])
    and empresa_id is null and plano_conta_tipo_id is null and plano_conta_subtipo_id is null
    and transferencia_id is not null
  )
  or (
    origem = 'devolucao_bancaria'::origem_lancamento
    and empresa_id is null and plano_conta_tipo_id is null and plano_conta_subtipo_id is null
    and transferencia_id is null
  )
  or (
    origem <> all (array['transferencia_saida'::origem_lancamento, 'transferencia_entrada'::origem_lancamento,
                         'devolucao_bancaria'::origem_lancamento])
    and empresa_id is not null and plano_conta_tipo_id is not null and plano_conta_subtipo_id is not null
    and transferencia_id is null
  )
) not valid;
alter table public.lancamentos_financeiros validate constraint chk_lancamento_sem_empresa_so_transferencia;

alter table public.lancamentos_financeiros drop constraint chk_origem_contraparte_tem_id;
alter table public.lancamentos_financeiros add constraint chk_origem_contraparte_tem_id check (
  ((origem = any (array['pp_baixa'::origem_lancamento, 'pp_baixa_estornada'::origem_lancamento, 'pp_estorno'::origem_lancamento])) and (pedido_compra_id is not null))
  or ((origem = any (array['avulsa_baixa'::origem_lancamento, 'avulsa_baixa_estornada'::origem_lancamento, 'avulsa_estorno'::origem_lancamento])) and (conta_avulsa_id is not null))
  or ((origem = any (array['titulo_baixa'::origem_lancamento, 'titulo_baixa_estornada'::origem_lancamento, 'titulo_estorno'::origem_lancamento])) and (titulo_receber_id is not null))
  or ((origem = any (array['desembolso_baixa'::origem_lancamento, 'desembolso_baixa_estornada'::origem_lancamento, 'desembolso_estorno'::origem_lancamento])) and (desembolso_id is not null))
  or ((origem = any (array['pp_devolucao_verba'::origem_lancamento, 'pp_devolucao_verba_estornada'::origem_lancamento, 'pp_devolucao_verba_estorno'::origem_lancamento])) and (pp_verba_devolucao_id is not null) and (pedido_compra_id is not null))
  or ((origem = any (array['fatura_cartao_baixa'::origem_lancamento, 'fatura_cartao_baixa_estornada'::origem_lancamento, 'fatura_cartao_estorno'::origem_lancamento])) and (fatura_cartao_id is not null))
  or ((origem = 'manual'::origem_lancamento) and (pedido_compra_id is null) and (conta_avulsa_id is null) and (titulo_receber_id is null) and (desembolso_id is null) and (pp_verba_devolucao_id is null))
  or ((origem = any (array['transferencia_saida'::origem_lancamento, 'transferencia_entrada'::origem_lancamento])) and (transferencia_id is not null))
  or ((origem = 'recebimento_antes_nf'::origem_lancamento) and (job_id is not null))
  or ((origem = 'imposto_baixa'::origem_lancamento) and (imposto_a_pagar_id is not null))
  or ((origem = 'juros_baixa'::origem_lancamento) and (juros_de_lancamento_id is not null))
  or ((origem = 'devolucao_bancaria'::origem_lancamento) and (pedido_compra_id is null) and (conta_avulsa_id is null) and (titulo_receber_id is null) and (desembolso_id is null) and (pp_verba_devolucao_id is null))
) not valid;
alter table public.lancamentos_financeiros validate constraint chk_origem_contraparte_tem_id;

alter table public.lancamentos_financeiros drop constraint chk_origem_tem_referencia;
alter table public.lancamentos_financeiros add constraint chk_origem_tem_referencia check (
  ((origem = any (array['pp_baixa'::origem_lancamento, 'pp_baixa_estornada'::origem_lancamento, 'pp_estorno'::origem_lancamento])) and (pedido_compra_id is not null) and (conta_avulsa_id is null) and (titulo_receber_id is null) and (desembolso_id is null) and (pp_verba_devolucao_id is null))
  or ((origem = any (array['avulsa_baixa'::origem_lancamento, 'avulsa_baixa_estornada'::origem_lancamento, 'avulsa_estorno'::origem_lancamento])) and (conta_avulsa_id is not null) and (pedido_compra_id is null) and (titulo_receber_id is null) and (desembolso_id is null) and (pp_verba_devolucao_id is null))
  or ((origem = any (array['titulo_baixa'::origem_lancamento, 'titulo_baixa_estornada'::origem_lancamento, 'titulo_estorno'::origem_lancamento])) and (titulo_receber_id is not null) and (pedido_compra_id is null) and (conta_avulsa_id is null) and (desembolso_id is null) and (pp_verba_devolucao_id is null))
  or ((origem = any (array['desembolso_baixa'::origem_lancamento, 'desembolso_baixa_estornada'::origem_lancamento, 'desembolso_estorno'::origem_lancamento])) and (desembolso_id is not null) and (pedido_compra_id is null) and (conta_avulsa_id is null) and (titulo_receber_id is null) and (pp_verba_devolucao_id is null))
  or ((origem = any (array['pp_devolucao_verba'::origem_lancamento, 'pp_devolucao_verba_estornada'::origem_lancamento, 'pp_devolucao_verba_estorno'::origem_lancamento])) and (pp_verba_devolucao_id is not null) and (pedido_compra_id is not null) and (conta_avulsa_id is null) and (titulo_receber_id is null) and (desembolso_id is null))
  or ((origem = any (array['fatura_cartao_baixa'::origem_lancamento, 'fatura_cartao_baixa_estornada'::origem_lancamento, 'fatura_cartao_estorno'::origem_lancamento])) and (fatura_cartao_id is not null) and (pedido_compra_id is null) and (conta_avulsa_id is null) and (titulo_receber_id is null) and (desembolso_id is null) and (pp_verba_devolucao_id is null))
  or ((origem = 'manual'::origem_lancamento) and (pedido_compra_id is null) and (conta_avulsa_id is null) and (titulo_receber_id is null) and (desembolso_id is null) and (pp_verba_devolucao_id is null))
  or ((origem = any (array['transferencia_saida'::origem_lancamento, 'transferencia_entrada'::origem_lancamento])) and (pedido_compra_id is null) and (conta_avulsa_id is null) and (titulo_receber_id is null) and (desembolso_id is null) and (pp_verba_devolucao_id is null) and (fatura_cartao_id is null))
  or ((origem = 'recebimento_antes_nf'::origem_lancamento) and (pedido_compra_id is null) and (conta_avulsa_id is null) and (titulo_receber_id is null) and (desembolso_id is null) and (pp_verba_devolucao_id is null) and (fatura_cartao_id is null) and (transferencia_id is null))
  or ((origem = 'imposto_baixa'::origem_lancamento) and (imposto_a_pagar_id is not null) and (pedido_compra_id is null) and (conta_avulsa_id is null) and (titulo_receber_id is null) and (desembolso_id is null) and (pp_verba_devolucao_id is null) and (fatura_cartao_id is null) and (transferencia_id is null))
  or ((origem = 'juros_baixa'::origem_lancamento) and (juros_de_lancamento_id is not null) and (((pedido_compra_id is not null) and (conta_avulsa_id is null)) or ((conta_avulsa_id is not null) and (pedido_compra_id is null))) and (titulo_receber_id is null) and (desembolso_id is null) and (pp_verba_devolucao_id is null) and (fatura_cartao_id is null) and (transferencia_id is null) and (imposto_a_pagar_id is null))
  or ((origem = 'devolucao_bancaria'::origem_lancamento) and (pedido_compra_id is null) and (conta_avulsa_id is null) and (titulo_receber_id is null) and (desembolso_id is null) and (pp_verba_devolucao_id is null) and (fatura_cartao_id is null) and (transferencia_id is null) and (imposto_a_pagar_id is null) and (juros_de_lancamento_id is null))
) not valid;
alter table public.lancamentos_financeiros validate constraint chk_origem_tem_referencia;

-- -----------------------------------------------------------------------------
-- 2. A policy de leitura: o ramo da devolução bancária sem empresa
-- -----------------------------------------------------------------------------
-- Os dois ramos de antes ficam como estavam (o `auth.uid()` vira
-- `(select auth.uid())`, a mesma coisa avaliada uma vez por consulta).

drop policy lancamentos_select on public.lancamentos_financeiros;
create policy lancamentos_select on public.lancamentos_financeiros
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and (
      public.can_access_empresa_regional((select auth.uid()), empresa_id, regional_id)
      or (empresa_id is null and transferencia_id is not null
          and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)))
      or (empresa_id is null and origem = 'devolucao_bancaria'::origem_lancamento
          and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id)))
    )
  );

-- -----------------------------------------------------------------------------
-- 3. Como a linha foi resolvida, para o desfazer
-- -----------------------------------------------------------------------------

alter table public.extrato_linhas
  add column if not exists conciliada_como text,
  add column if not exists conciliada_em timestamptz,
  add column if not exists conciliada_por uuid references public.profiles(id),
  add column if not exists desfazer jsonb,
  add column if not exists grupo uuid;

alter table public.extrato_linhas drop constraint if exists chk_extrato_linha_conciliada_como;
alter table public.extrato_linhas add constraint chk_extrato_linha_conciliada_como
  check (conciliada_como is null or conciliada_como in ('ligacao', 'baixa', 'avulso', 'regra', 'par', 'correcao'));

comment on column public.extrato_linhas.conciliada_como is
  'Como a linha se conciliou: ligacao (a baixa já existia), baixa e avulso (a baixa nasceu na conciliação), regra, par (saiu e voltou), correcao (decisão 200).';
comment on column public.extrato_linhas.desfazer is
  'O que o desfazer precisa: as datas de antes das baixas ligadas, a baixa de antes da correção (decisão 200).';
comment on column public.extrato_linhas.grupo is
  'As linhas que se resolveram juntas (o saiu e voltou, o grupo de linhas iguais): se desfazem juntas.';

create index if not exists idx_extrato_linhas_grupo on public.extrato_linhas (grupo) where grupo is not null;
create index if not exists idx_extrato_linhas_conciliada_por on public.extrato_linhas (conciliada_por) where conciliada_por is not null;

-- A view expõe as colunas novas (o `l.*` se fixa na criação).
drop view if exists public.vw_extrato_linhas;
create view public.vw_extrato_linhas
with (security_invoker = true) as
select
  l.*,
  exists (
    select 1
    from public.lancamentos_financeiros f
    where f.extrato_linha_id = l.id
  ) as conciliada
from public.extrato_linhas l;

comment on view public.vw_extrato_linhas is
  'As linhas do extrato importado com conciliada = tem lançamento ligado (decisão 199).';
revoke all on public.vw_extrato_linhas from public, anon, authenticated;
grant select on public.vw_extrato_linhas to authenticated;

-- Quando um lançamento ligado some, a linha volta a pendente por inteiro.
create or replace function public.lancamento_desliga_a_linha()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.lancamentos_financeiros
     set extrato_linha_id = null
   where extrato_linha_id = old.extrato_linha_id
     and id <> old.id;
  update public.extrato_linhas
     set sem_auto = true,
         resolvida_sozinha = null,
         conciliada_como = null,
         conciliada_em = null,
         conciliada_por = null,
         desfazer = null,
         grupo = null
   where id = old.extrato_linha_id;
  return old;
end;
$$;
revoke all on function public.lancamento_desliga_a_linha() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. O histórico das correções de baixa
-- -----------------------------------------------------------------------------
-- Pelo DOCUMENTO: a correção refaz a baixa, e o lançamento muda de id. O ⓘ
-- do título e o do Extrato leem por ele.

create table if not exists public.baixa_correcoes (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  extrato_linha_id      uuid not null references public.extrato_linhas(id) on delete restrict,
  documento_origem      text not null check (documento_origem in ('pp_baixa', 'avulsa_baixa', 'titulo_baixa')),
  documento_id          uuid not null,
  -- Os lançamentos de antes e de depois (sem FK: a baixa pode ser cancelada
  -- depois, e o histórico fica).
  lancamento_antes_id   uuid not null,
  lancamento_id         uuid not null,
  de                    jsonb not null,
  para                  jsonb not null,
  motivo                text not null check (length(btrim(motivo)) >= 10),
  corrigida_por         uuid not null references public.profiles(id),
  created_at            timestamptz not null default now(),
  desfeita_em           timestamptz,
  desfeita_por          uuid references public.profiles(id),
  constraint chk_baixa_correcao_desfeita check ((desfeita_em is null) = (desfeita_por is null))
);

comment on table public.baixa_correcoes is
  'A baixa feita à mão corrigida pela conciliação com o banco: de → para, o motivo, quem e quando (decisão 200).';

create index if not exists idx_baixa_correcoes_documento on public.baixa_correcoes (tenant_id, documento_origem, documento_id);
create index if not exists idx_baixa_correcoes_lancamento on public.baixa_correcoes (lancamento_id);
create index if not exists idx_baixa_correcoes_linha on public.baixa_correcoes (extrato_linha_id);
create index if not exists idx_baixa_correcoes_corrigida_por on public.baixa_correcoes (corrigida_por);
create index if not exists idx_baixa_correcoes_desfeita_por on public.baixa_correcoes (desfeita_por) where desfeita_por is not null;

alter table public.baixa_correcoes enable row level security;
drop policy if exists baixa_correcoes_select on public.baixa_correcoes;
create policy baixa_correcoes_select on public.baixa_correcoes
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and (public.is_tenant_admin(tenant_id) or public.is_tenant_financeiro(tenant_id))
  );
revoke all on public.baixa_correcoes from public, anon, authenticated;
grant select on public.baixa_correcoes to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Auxiliares
-- -----------------------------------------------------------------------------

/** "R$ 1.234,56", com o sinal. */
create or replace function public._moeda_br(p numeric)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p < 0 then '-' else '' end || 'R$ '
         || translate(to_char(abs(round(p, 2)), 'FM999,999,999,990.00'), ',.', '.,')
$$;
revoke all on function public._moeda_br(numeric) from public, anon, authenticated;

/** O histórico como o motor o compara: sem acento, maiúsculas, espaços juntados. */
create or replace function public._normalizar_historico(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(upper(translate(coalesce(p, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '\s+', ' ', 'g'))
$$;
revoke all on function public._normalizar_historico(text) from public, anon, authenticated;

/**
 * Troca a data de uma baixa, em tudo (decisão 200): o lançamento, os juros
 * dele, a perna da conta-espelho no pagamento da fatura, e o dia em que o
 * documento foi pago — o da última baixa viva dele. Devolve a data de antes.
 */
create or replace function public._mudar_data_do_lancamento(p_lancamento_id uuid, p_data date)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v_l     lancamentos_financeiros%rowtype;
  v_antes date;
begin
  select * into v_l from public.lancamentos_financeiros where id = p_lancamento_id for update;
  if not found then raise exception 'Lançamento não encontrado.'; end if;
  v_antes := v_l.data_movimento;
  if v_antes = p_data then return v_antes; end if;

  update public.lancamentos_financeiros
     set data_movimento = p_data
   where id = v_l.id
      or (origem = 'juros_baixa' and juros_de_lancamento_id = v_l.id)
      or (v_l.origem = 'fatura_cartao_baixa' and origem = 'fatura_cartao_baixa'
          and fatura_cartao_id = v_l.fatura_cartao_id and papel_na_fatura = 'pagamento'
          and data_movimento = v_antes);

  case v_l.origem::text
    when 'pp_baixa' then
      update public.pedidos_compra_parcelas pa
         set pago_em = (select max(l.data_movimento) from public.lancamentos_financeiros l
                         where l.origem = 'pp_baixa' and l.pedido_compra_parcela_id = pa.id)
       where pa.id = v_l.pedido_compra_parcela_id and pa.pago_em is not null and pa.fatura_cartao_id is null;
      update public.pedidos_compra p
         set pago_em = (select max(pa.pago_em) from public.pedidos_compra_parcelas pa where pa.pedido_compra_id = p.id)
       where p.id = v_l.pedido_compra_id and p.status = 'pago' and p.pago_em is not null;
    when 'avulsa_baixa' then
      update public.contas_avulsas a
         set pago_em = (select max(l.data_movimento) from public.lancamentos_financeiros l
                         where l.origem = 'avulsa_baixa' and l.conta_avulsa_id = a.id)
       where a.id = v_l.conta_avulsa_id and a.pago_em is not null;
    when 'titulo_baixa' then
      update public.titulos_receber t
         set pago_em = (select max(l.data_movimento) from public.lancamentos_financeiros l
                         where l.origem = 'titulo_baixa' and l.titulo_receber_id = t.id)
       where t.id = v_l.titulo_receber_id and t.pago_em is not null;
    when 'desembolso_baixa' then
      update public.desembolsos_parcelas set pago_em = p_data
       where id = v_l.desembolso_parcela_id and pago_em = v_antes;
    when 'pp_devolucao_verba' then
      update public.pp_verba_devolucoes set pago_em = p_data
       where id = v_l.pp_verba_devolucao_id and pago_em = v_antes;
    when 'imposto_baixa' then
      update public.impostos_a_pagar set pago_em = p_data
       where id = v_l.imposto_a_pagar_id and pago_em = v_antes;
    when 'recebimento_antes_nf' then
      update public.recebimentos_antes_nf set data = p_data
       where lancamento_id = v_l.id and data = v_antes;
    else
      null;
  end case;
  return v_antes;
end;
$$;
revoke all on function public._mudar_data_do_lancamento(uuid, date) from public, anon, authenticated;

/** O que a tela cancela para desfazer uma baixa nascida na conciliação: o
 *  tipo e o id que `cancelarBaixa` (ou `cancelarBaixaImposto`) recebe. */
create or replace function public._cancelamento_da_baixa(p_l lancamentos_financeiros)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case p_l.origem::text
    when 'pp_baixa' then jsonb_build_object('tipo', 'baixa', 'id', p_l.id)
    when 'avulsa_baixa' then jsonb_build_object('tipo', 'baixa', 'id', p_l.id)
    when 'titulo_baixa' then jsonb_build_object('tipo', 'baixa', 'id', p_l.id)
    when 'desembolso_baixa' then jsonb_build_object('tipo', 'desembolso', 'id', p_l.desembolso_parcela_id)
    when 'pp_devolucao_verba' then jsonb_build_object('tipo', 'pp_devolucao_verba', 'id', p_l.pp_verba_devolucao_id)
    when 'fatura_cartao_baixa' then jsonb_build_object('tipo', 'fatura_cartao', 'id', p_l.fatura_cartao_id)
    when 'transferencia_saida' then jsonb_build_object('tipo', 'transferencia', 'id', p_l.transferencia_id)
    when 'transferencia_entrada' then jsonb_build_object('tipo', 'transferencia', 'id', p_l.transferencia_id)
    when 'imposto_baixa' then jsonb_build_object('tipo', 'imposto', 'id', p_l.imposto_a_pagar_id)
    else null
  end
$$;
revoke all on function public._cancelamento_da_baixa(lancamentos_financeiros) from public, anon, authenticated;

/** A linha pendente, travada: nem ignorada nem conciliada. */
create or replace function public._linha_pendente(p_linha_id uuid)
returns extrato_linhas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linha extrato_linhas%rowtype;
begin
  select * into v_linha from public.extrato_linhas where id = p_linha_id for update;
  if not found then raise exception 'Linha do extrato não encontrada.'; end if;
  perform public._exige_financeiro_conciliacao(v_linha.tenant_id);
  if v_linha.ignorada_em is not null then
    raise exception 'Esta linha do banco está ignorada: desfaça antes.';
  end if;
  if exists (select 1 from public.lancamentos_financeiros where extrato_linha_id = v_linha.id) then
    raise exception 'Esta linha do banco já está conciliada.';
  end if;
  return v_linha;
end;
$$;
revoke all on function public._linha_pendente(uuid) from public, anon, authenticated;

create or replace function public._auditar_extrato(p_linha extrato_linhas, p_acao text, p_uid uuid, p_metadata jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (p_linha.tenant_id, 'extrato_linha', p_linha.id::text, p_acao, p_uid,
          jsonb_build_object('conta_bancaria_id', p_linha.conta_bancaria_id, 'data', p_linha.data,
                             'valor', p_linha.valor, 'historico', p_linha.historico) || coalesce(p_metadata, '{}'::jsonb));
$$;
revoke all on function public._auditar_extrato(extrato_linhas, text, uuid, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Conciliar
-- -----------------------------------------------------------------------------

create or replace function public.conciliar_linha(
  p_linha_id uuid,
  p_lancamento_ids uuid[],
  p_como text default 'ligacao',
  p_grupo uuid default null,
  p_sozinha text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid;
  v_linha  extrato_linhas%rowtype;
  v_ids    uuid[];
  v_n      integer;
  v_soma   numeric;
  v_datas  jsonb := '[]'::jsonb;
  r        record;
begin
  v_linha := public._linha_pendente(p_linha_id);
  v_uid := public._exige_financeiro_conciliacao(v_linha.tenant_id);
  if p_como not in ('ligacao', 'baixa', 'avulso') then
    raise exception 'Conciliação inválida: %.', p_como;
  end if;
  if p_sozinha is not null and p_sozinha not in ('manual', 'titulo', 'remessa') then
    raise exception 'Resolução inválida: %.', p_sozinha;
  end if;
  if coalesce(cardinality(p_lancamento_ids), 0) = 0 then
    raise exception 'Escolha o lançamento que esta linha do banco paga.';
  end if;

  -- A baixa vai com os juros dela; a guia de imposto, com todas as partes.
  select array_agg(distinct l.id) into v_ids
    from public.lancamentos_financeiros l
   where l.id = any (p_lancamento_ids)
      or (l.origem = 'juros_baixa' and l.juros_de_lancamento_id = any (p_lancamento_ids))
      or (l.origem = 'imposto_baixa' and exists (
            select 1 from public.lancamentos_financeiros g
             where g.id = any (p_lancamento_ids) and g.origem = 'imposto_baixa'
               and g.imposto_a_pagar_id = l.imposto_a_pagar_id
               and g.conta_bancaria_id = l.conta_bancaria_id
               and g.data_movimento = l.data_movimento));

  if exists (select unnest(p_lancamento_ids) except select unnest(coalesce(v_ids, '{}'::uuid[]))) then
    raise exception 'Algum lançamento escolhido não existe mais: recarregue a página.';
  end if;

  perform 1 from public.lancamentos_financeiros where id = any (v_ids) for update;

  select count(*)::int,
         coalesce(sum(case when natureza = 'entrada' then valor else -valor end), 0)
    into v_n, v_soma
    from public.lancamentos_financeiros
   where id = any (v_ids)
     and tenant_id = v_linha.tenant_id
     and conta_bancaria_id = v_linha.conta_bancaria_id
     and extrato_linha_id is null;
  if v_n <> coalesce(cardinality(v_ids), 0) then
    raise exception 'Algum lançamento não é desta conta ou já está conciliado com outra linha.';
  end if;
  if abs(v_soma - v_linha.valor) >= 0.005 then
    raise exception 'A soma dos lançamentos (%) não bate com a linha do banco (%).',
      public._moeda_br(v_soma), public._moeda_br(v_linha.valor);
  end if;

  -- A data do banco em tudo (Tiago, 21/10/2026): a de antes fica para o
  -- desfazer. Os juros seguem a baixa.
  for r in
    select id, data_movimento from public.lancamentos_financeiros
     where id = any (v_ids) and origem <> 'juros_baixa' and data_movimento <> v_linha.data
  loop
    perform public._mudar_data_do_lancamento(r.id, v_linha.data);
    v_datas := v_datas || jsonb_build_object('id', r.id, 'de', r.data_movimento);
  end loop;

  update public.lancamentos_financeiros set extrato_linha_id = v_linha.id where id = any (v_ids);
  update public.extrato_linhas
     set conciliada_como = p_como,
         conciliada_em = now(),
         conciliada_por = v_uid,
         desfazer = jsonb_build_object('datas', v_datas),
         grupo = p_grupo,
         resolvida_sozinha = p_sozinha
   where id = v_linha.id;

  perform public._auditar_extrato(v_linha, 'extrato.conciliado', v_uid,
    jsonb_build_object('como', p_como, 'sozinha', p_sozinha, 'lancamentos', to_jsonb(v_ids), 'datas_trocadas', v_datas));

  return jsonb_build_object('lancamentos', to_jsonb(v_ids), 'datas', v_datas);
end;
$$;

comment on function public.conciliar_linha(uuid, uuid[], text, uuid, text) is
  'Liga a linha do banco aos lançamentos que ela paga, com a soma batendo; as baixas passam à data do banco (decisão 200).';

/**
 * Concilia pela baixa que acabou de ser dada: acha, para cada documento, o
 * lançamento dele nesta conta ainda sem linha — o da data da linha primeiro,
 * senão o mais recente —, e concilia. `p_documentos`: [{tipo, id}], tipo em
 * pp (a parcela), avulsa, titulo_receber, desembolso (a parcela),
 * devolucao_verba, fatura, imposto e transferencia.
 */
create or replace function public.conciliar_linha_pelos_documentos(
  p_linha_id uuid,
  p_documentos jsonb,
  p_como text default 'baixa',
  p_grupo uuid default null,
  p_sozinha text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linha  extrato_linhas%rowtype;
  v_ids    uuid[] := '{}';
  v_id     uuid;
  d        jsonb;
  v_tipo   text;
  v_doc    uuid;
begin
  v_linha := public._linha_pendente(p_linha_id);
  if jsonb_typeof(p_documentos) <> 'array' or jsonb_array_length(p_documentos) = 0 then
    raise exception 'Nenhum documento para conciliar.';
  end if;
  for d in select value from jsonb_array_elements(p_documentos) loop
    v_tipo := d->>'tipo';
    v_doc := (d->>'id')::uuid;
    select l.id into v_id
      from public.lancamentos_financeiros l
     where l.tenant_id = v_linha.tenant_id
       and l.conta_bancaria_id = v_linha.conta_bancaria_id
       and l.extrato_linha_id is null
       and case v_tipo
             when 'pp' then l.origem = 'pp_baixa' and l.pedido_compra_parcela_id = v_doc
             when 'avulsa' then l.origem = 'avulsa_baixa' and l.conta_avulsa_id = v_doc
             when 'titulo_receber' then l.origem = 'titulo_baixa' and l.titulo_receber_id = v_doc
             when 'desembolso' then l.origem = 'desembolso_baixa' and l.desembolso_parcela_id = v_doc
             when 'devolucao_verba' then l.origem = 'pp_devolucao_verba' and l.pp_verba_devolucao_id = v_doc
             when 'fatura' then l.origem = 'fatura_cartao_baixa' and l.fatura_cartao_id = v_doc
             when 'imposto' then l.origem = 'imposto_baixa' and l.imposto_a_pagar_id = v_doc
             when 'transferencia' then l.origem in ('transferencia_saida', 'transferencia_entrada') and l.transferencia_id = v_doc
             else false
           end
     order by (l.data_movimento = v_linha.data) desc, l.created_at desc
     limit 1;
    if v_id is null then
      raise exception 'A baixa do documento não foi achada nesta conta: confira a conta escolhida na baixa.';
    end if;
    v_ids := v_ids || v_id;
  end loop;
  return public.conciliar_linha(p_linha_id, v_ids, p_como, p_grupo, p_sozinha);
end;
$$;

comment on function public.conciliar_linha_pelos_documentos(uuid, jsonb, text, uuid, text) is
  'Concilia a linha do banco com a baixa que acabou de ser dada nos documentos (decisão 200).';

-- -----------------------------------------------------------------------------
-- 7. Corrigir a baixa pela linha do banco
-- -----------------------------------------------------------------------------

/** Refaz a baixa pelas RPCs de sempre (as mesmas travas e o mesmo estado do
 *  documento). Devolve o lançamento novo. */
create or replace function public._refazer_baixa(
  p_origem text, p_documento uuid, p_data date, p_conta uuid,
  p_tipo uuid, p_subtipo uuid, p_forma forma_pagamento,
  p_valor_bruto numeric, p_retencoes jsonb, p_juros numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_origem = 'pp_baixa' then
    return public.baixar_parcela_pp(p_documento, p_data, p_conta, p_tipo, p_subtipo, p_forma, null,
                                    p_valor_bruto, p_retencoes, p_juros, null);
  elsif p_origem = 'avulsa_baixa' then
    return public.baixar_conta_avulsa(p_documento, p_data, p_conta, p_tipo, p_subtipo, p_forma, null,
                                      p_valor_bruto, p_retencoes, p_juros, null);
  elsif p_origem = 'titulo_baixa' then
    return public.baixar_titulo_receber(p_documento, p_data, p_conta, p_tipo, p_subtipo, p_valor_bruto, p_retencoes);
  end if;
  raise exception 'Esta baixa não se refaz por aqui (origem %).', p_origem;
end;
$$;
revoke all on function public._refazer_baixa(text, uuid, date, uuid, uuid, uuid, forma_pagamento, numeric, jsonb, numeric)
  from public, anon, authenticated;

create or replace function public.corrigir_baixa_pela_conciliacao(p_lancamento_id uuid, p_linha_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid;
  v_linha      extrato_linhas%rowtype;
  v_l          lancamentos_financeiros%rowtype;
  v_doc        uuid;
  v_juros_ant  numeric;
  v_banco      numeric;
  v_principal  numeric;
  v_juros      numeric;
  v_retidos    jsonb;
  v_retido     numeric;
  v_cabe       boolean;
  v_novo       uuid;
  v_ids        uuid[];
  v_soma       numeric;
  v_de         jsonb;
  v_para       jsonb;
  v_correcao   uuid;
begin
  v_linha := public._linha_pendente(p_linha_id);
  v_uid := public._exige_financeiro_conciliacao(v_linha.tenant_id);
  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Registre o motivo da correção (pelo menos 10 caracteres).';
  end if;

  select * into v_l from public.lancamentos_financeiros where id = p_lancamento_id for update;
  if not found then raise exception 'Baixa não encontrada.'; end if;
  if v_l.tenant_id <> v_linha.tenant_id or v_l.conta_bancaria_id <> v_linha.conta_bancaria_id then
    raise exception 'A baixa não é desta conta.';
  end if;
  if v_l.extrato_linha_id is not null then
    raise exception 'Esta baixa já está conciliada com outra linha do banco.';
  end if;
  if v_l.origem not in ('pp_baixa', 'avulsa_baixa', 'titulo_baixa')
     or (v_l.origem = 'pp_baixa' and (v_l.pedido_compra_parcela_id is null or v_l.fatura_cartao_id is not null)) then
    raise exception 'Esta baixa não se corrige por aqui: cancele-a e baixe de novo pela linha do banco.';
  end if;
  if (v_l.natureza = 'entrada') <> (v_linha.valor > 0) then
    raise exception 'A baixa e a linha do banco estão em sentidos diferentes.';
  end if;

  v_doc := case v_l.origem::text
             when 'pp_baixa' then v_l.pedido_compra_parcela_id
             when 'avulsa_baixa' then v_l.conta_avulsa_id
             else v_l.titulo_receber_id
           end;
  select coalesce(sum(valor), 0) into v_juros_ant
    from public.lancamentos_financeiros where origem = 'juros_baixa' and juros_de_lancamento_id = v_l.id;
  v_banco := round(abs(v_linha.valor), 2);

  -- A diferença vira juros só no boleto; no resto, muda o valor pago
  -- (Tiago, 21/10/2026).
  v_cabe := v_l.forma_pagamento = 'boleto' and v_l.origem in ('pp_baixa', 'avulsa_baixa');
  if v_cabe then
    if v_banco >= v_l.valor then
      v_principal := v_l.valor;
      v_juros := round(v_banco - v_l.valor, 2);
    else
      v_principal := v_banco;
      v_juros := 0;
    end if;
  else
    if v_banco > v_l.valor + 0.004 then
      raise exception 'O banco % % a mais que a baixa e, fora do boleto, a diferença não vira juros: se era outro pagamento, procure o título pela lupa.',
        case when v_linha.valor < 0 then 'debitou' else 'creditou' end, public._moeda_br(v_banco - v_l.valor);
    end if;
    v_principal := v_banco;
    v_juros := 0;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('imposto', r.imposto, 'aliquota', r.aliquota, 'valor', r.valor) order by r.imposto), '[]'::jsonb),
         coalesce(sum(r.valor), 0)
    into v_retidos, v_retido
    from public.baixas_retencoes r where r.lancamento_id = v_l.id;

  v_de := jsonb_build_object(
    'data', v_l.data_movimento, 'principal', v_l.valor, 'juros', v_juros_ant, 'total', v_l.valor + v_juros_ant,
    'retencoes', v_retidos, 'tipo_id', v_l.plano_conta_tipo_id, 'subtipo_id', v_l.plano_conta_subtipo_id,
    'forma', v_l.forma_pagamento);
  v_para := jsonb_build_object(
    'data', v_linha.data, 'principal', v_principal, 'juros', v_juros, 'total', v_principal + v_juros);

  -- Cancela e refaz, com as travas de sempre.
  perform public.cancelar_baixa_lancamento(v_l.id, 'Corrigida pela conciliação com o banco: ' || btrim(p_motivo));
  v_novo := public._refazer_baixa(v_l.origem::text, v_doc, v_linha.data, v_l.conta_bancaria_id,
                                  v_l.plano_conta_tipo_id, v_l.plano_conta_subtipo_id, v_l.forma_pagamento,
                                  v_principal + v_retido, v_retidos, v_juros);

  select array_agg(id), coalesce(sum(case when natureza = 'entrada' then valor else -valor end), 0)
    into v_ids, v_soma
    from public.lancamentos_financeiros
   where id = v_novo or (origem = 'juros_baixa' and juros_de_lancamento_id = v_novo);
  if abs(v_soma - v_linha.valor) >= 0.005 then
    raise exception 'A baixa corrigida (%) não bate com a linha do banco (%).',
      public._moeda_br(v_soma), public._moeda_br(v_linha.valor);
  end if;
  update public.lancamentos_financeiros set extrato_linha_id = v_linha.id where id = any (v_ids);

  insert into public.baixa_correcoes (
    tenant_id, extrato_linha_id, documento_origem, documento_id, lancamento_antes_id, lancamento_id,
    de, para, motivo, corrigida_por
  ) values (
    v_linha.tenant_id, v_linha.id, v_l.origem::text, v_doc, v_l.id, v_novo, v_de, v_para, btrim(p_motivo), v_uid
  ) returning id into v_correcao;

  update public.extrato_linhas
     set conciliada_como = 'correcao', conciliada_em = now(), conciliada_por = v_uid,
         desfazer = jsonb_build_object('correcao_id', v_correcao), grupo = null, resolvida_sozinha = null
   where id = v_linha.id;

  perform public._auditar_extrato(v_linha, 'extrato.baixa_corrigida', v_uid,
    jsonb_build_object('lancamento_antes', v_l.id, 'lancamento', v_novo, 'de', v_de, 'para', v_para, 'motivo', btrim(p_motivo)));

  return jsonb_build_object('lancamento_id', v_novo, 'de', v_de, 'para', v_para);
end;
$$;

comment on function public.corrigir_baixa_pela_conciliacao(uuid, uuid, text) is
  'A baixa feita à mão que não bate com o banco passa ao valor e à data dele; a diferença vira juros só no boleto (decisão 200).';

-- -----------------------------------------------------------------------------
-- 8. As regras do histórico
-- -----------------------------------------------------------------------------

create or replace function public.lancar_pela_regra(p_linha_id uuid, p_regra_id uuid, p_sozinha boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid;
  v_linha  extrato_linhas%rowtype;
  v_regra  extrato_regras%rowtype;
  v_id     uuid;
  v_desc   text;
begin
  v_linha := public._linha_pendente(p_linha_id);
  v_uid := public._exige_financeiro_conciliacao(v_linha.tenant_id);
  select * into v_regra from public.extrato_regras where id = p_regra_id for update;
  if not found or not v_regra.ativa or v_regra.tenant_id <> v_linha.tenant_id
     or (v_regra.conta_bancaria_id is not null and v_regra.conta_bancaria_id <> v_linha.conta_bancaria_id) then
    raise exception 'Regra não encontrada para esta conta.';
  end if;
  if left(public._normalizar_historico(v_linha.historico), length(v_regra.padrao)) <> v_regra.padrao then
    raise exception 'O histórico desta linha não começa por "%".', v_regra.padrao;
  end if;

  v_desc := substring(btrim(v_linha.historico), 1, 240);
  if length(v_desc) < 3 then v_desc := 'Lançamento do extrato do banco'; end if;

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor, natureza, descricao,
    plano_conta_tipo_id, plano_conta_subtipo_id, origem, extrato_linha_id, criado_por
  ) values (
    v_linha.tenant_id, v_regra.empresa_id, v_linha.conta_bancaria_id, v_linha.data, abs(v_linha.valor),
    case when v_linha.valor < 0 then 'saida' else 'entrada' end, v_desc,
    v_regra.plano_conta_tipo_id, v_regra.plano_conta_subtipo_id, 'manual', v_linha.id, v_uid
  ) returning id into v_id;

  update public.extrato_regras set usos = usos + 1 where id = v_regra.id;
  update public.extrato_linhas
     set conciliada_como = 'regra', conciliada_em = now(), conciliada_por = v_uid,
         desfazer = jsonb_build_object('regra_id', v_regra.id), grupo = null,
         resolvida_sozinha = case when p_sozinha then 'regra' else null end
   where id = v_linha.id;

  perform public._auditar_extrato(v_linha, 'extrato.lancado_pela_regra', v_uid,
    jsonb_build_object('regra_id', v_regra.id, 'padrao', v_regra.padrao, 'lancamento', v_id, 'sozinha', p_sozinha));
  return v_id;
end;
$$;

comment on function public.lancar_pela_regra(uuid, uuid, boolean) is
  'A tarifa e o IOF pela regra do histórico: um lançamento manual com o centro e a empresa da regra, já conciliado (decisão 200).';

/** "Lembrar como regra" (decisão 200). */
create or replace function public.criar_regra_do_extrato(
  p_conta_bancaria_id uuid,
  p_padrao text,
  p_tipo_id uuid,
  p_subtipo_id uuid,
  p_empresa_id uuid,
  p_todas_as_contas boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid;
  v_conta   contas_bancarias%rowtype;
  v_padrao  text := public._normalizar_historico(p_padrao);
  v_sub     uuid;
  v_id      uuid;
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  v_uid := public._exige_financeiro_conciliacao(v_conta.tenant_id);
  if length(v_padrao) < 3 then
    raise exception 'O começo do histórico precisa ter pelo menos 3 letras.';
  end if;
  select tipo_id into v_sub from public.plano_contas_subtipos where id = p_subtipo_id and tenant_id = v_conta.tenant_id;
  if v_sub is null or v_sub <> p_tipo_id then
    raise exception 'Escolha o centro de custo e o subtipo da regra.';
  end if;
  if not exists (select 1 from public.empresas where id = p_empresa_id and tenant_id = v_conta.tenant_id) then
    raise exception 'Escolha a empresa da regra.';
  end if;
  if exists (
    select 1 from public.extrato_regras
     where tenant_id = v_conta.tenant_id and ativa and padrao = v_padrao
       and coalesce(conta_bancaria_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(case when p_todas_as_contas then null else v_conta.id end, '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    raise exception 'Já existe uma regra para "%"%.', v_padrao,
      case when p_todas_as_contas then ' em todas as contas' else ' nesta conta' end;
  end if;

  insert into public.extrato_regras (
    tenant_id, conta_bancaria_id, padrao, plano_conta_tipo_id, plano_conta_subtipo_id, empresa_id, criada_por
  ) values (
    v_conta.tenant_id, case when p_todas_as_contas then null else v_conta.id end, v_padrao,
    p_tipo_id, p_subtipo_id, p_empresa_id, v_uid
  ) returning id into v_id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_conta.tenant_id, 'extrato_regra', v_id::text, 'extrato.regra_criada', v_uid,
          jsonb_build_object('conta_bancaria_id', case when p_todas_as_contas then null else v_conta.id end,
                             'padrao', v_padrao, 'tipo_id', p_tipo_id, 'subtipo_id', p_subtipo_id, 'empresa_id', p_empresa_id));
  return v_id;
end;
$$;

comment on function public.criar_regra_do_extrato(uuid, text, uuid, uuid, uuid, boolean) is
  'O "Lembrar como regra" da conciliação com o banco (decisão 200).';

-- -----------------------------------------------------------------------------
-- 9. Saiu e voltou
-- -----------------------------------------------------------------------------

create or replace function public.registrar_saiu_e_voltou(
  p_saida_id uuid,
  p_volta_id uuid,
  p_referencia text default null,
  p_fornecedor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid;
  v_saida  extrato_linhas%rowtype;
  v_volta  extrato_linhas%rowtype;
  v_grupo  uuid := gen_random_uuid();
  v_ref    text := nullif(substring(btrim(coalesce(p_referencia, '')), 1, 160), '');
  v_s      uuid;
  v_v      uuid;
begin
  v_saida := public._linha_pendente(p_saida_id);
  v_volta := public._linha_pendente(p_volta_id);
  v_uid := public._exige_financeiro_conciliacao(v_saida.tenant_id);
  if v_saida.tenant_id <> v_volta.tenant_id or v_saida.conta_bancaria_id <> v_volta.conta_bancaria_id then
    raise exception 'As duas linhas precisam ser da mesma conta.';
  end if;
  if not (v_saida.valor < 0 and v_volta.valor > 0 and abs(v_saida.valor + v_volta.valor) < 0.005
          and v_saida.data = v_volta.data) then
    raise exception 'A saída e a devolução precisam ter o mesmo valor, no mesmo dia.';
  end if;
  if public._normalizar_historico(v_volta.historico) not like '%DEVOLUCAO%' then
    raise exception 'A linha de entrada não é uma devolução do banco.';
  end if;
  if p_fornecedor_id is not null
     and not exists (select 1 from public.fornecedores where id = p_fornecedor_id and tenant_id = v_saida.tenant_id) then
    raise exception 'Fornecedor não encontrado.';
  end if;

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor, natureza, descricao,
    fornecedor_id, origem, extrato_linha_id, criado_por
  ) values (
    v_saida.tenant_id, null, v_saida.conta_bancaria_id, v_saida.data, abs(v_saida.valor), 'saida',
    'PIX que voltou' || coalesce(' · ' || v_ref, ''), p_fornecedor_id, 'devolucao_bancaria', v_saida.id, v_uid
  ) returning id into v_s;
  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor, natureza, descricao,
    fornecedor_id, origem, extrato_linha_id, criado_por
  ) values (
    v_volta.tenant_id, null, v_volta.conta_bancaria_id, v_volta.data, v_volta.valor, 'entrada',
    'Devolução do PIX' || coalesce(' · ' || v_ref, ''), p_fornecedor_id, 'devolucao_bancaria', v_volta.id, v_uid
  ) returning id into v_v;

  update public.extrato_linhas
     set conciliada_como = 'par', conciliada_em = now(), conciliada_por = v_uid,
         desfazer = null, grupo = v_grupo, resolvida_sozinha = null
   where id in (v_saida.id, v_volta.id);

  perform public._auditar_extrato(v_saida, 'extrato.saiu_e_voltou', v_uid,
    jsonb_build_object('devolucao', v_volta.id, 'lancamentos', jsonb_build_array(v_s, v_v), 'referencia', v_ref));
  return jsonb_build_object('saida', v_s, 'volta', v_v, 'grupo', v_grupo);
end;
$$;

comment on function public.registrar_saiu_e_voltou(uuid, uuid, text, uuid) is
  'O pagamento que o banco devolveu no mesmo dia: as duas pernas no extrato, fora do DRE; o título continua a pagar (decisão 200).';

-- -----------------------------------------------------------------------------
-- 10. Ignorar e desfazer
-- -----------------------------------------------------------------------------

create or replace function public.ignorar_linha(p_linha_id uuid, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid;
  v_linha extrato_linhas%rowtype;
begin
  v_linha := public._linha_pendente(p_linha_id);
  v_uid := public._exige_financeiro_conciliacao(v_linha.tenant_id);
  update public.extrato_linhas
     set ignorada_em = now(), ignorada_por = v_uid,
         motivo_ignorada = nullif(substring(btrim(coalesce(p_motivo, '')), 1, 500), '')
   where id = v_linha.id;
  perform public._auditar_extrato(v_linha, 'extrato.linha_ignorada', v_uid, jsonb_build_object('motivo', p_motivo));
end;
$$;

comment on function public.ignorar_linha(uuid, text) is
  'A linha do banco que não entra no extrato do sistema (decisão 200).';

/**
 * Desfaz o que resolveu a linha — e as do mesmo grupo. Devolve as baixas
 * nascidas na conciliação, que a tela cancela pelas actions de sempre (o
 * cancelamento apaga o lançamento, e o gatilho desliga a linha).
 */
create or replace function public.desfazer_conciliacao(p_linha_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid;
  v_linha     extrato_linhas%rowtype;
  r_linha     extrato_linhas%rowtype;
  r_l         lancamentos_financeiros%rowtype;
  d           jsonb;
  v_cancelar  jsonb := '[]'::jsonb;
  v_item      jsonb;
  v_linhas    uuid[] := '{}';
  v_cor       baixa_correcoes%rowtype;
  v_ret       numeric;
begin
  select * into v_linha from public.extrato_linhas where id = p_linha_id for update;
  if not found then raise exception 'Linha do extrato não encontrada.'; end if;
  v_uid := public._exige_financeiro_conciliacao(v_linha.tenant_id);

  for r_linha in
    select * from public.extrato_linhas
     where id = v_linha.id or (v_linha.grupo is not null and grupo = v_linha.grupo)
     order by ordem
     for update
  loop
    v_linhas := v_linhas || r_linha.id;

    if r_linha.ignorada_em is not null then
      update public.extrato_linhas
         set ignorada_em = null, ignorada_por = null, motivo_ignorada = null, sem_auto = true
       where id = r_linha.id;
      continue;
    end if;
    if not exists (select 1 from public.lancamentos_financeiros where extrato_linha_id = r_linha.id) then
      continue;
    end if;

    if r_linha.conciliada_como in ('baixa', 'avulso') then
      -- A baixa nasceu aqui: a tela a cancela.
      for r_l in
        select * from public.lancamentos_financeiros
         where extrato_linha_id = r_linha.id and origem <> 'juros_baixa'
      loop
        v_item := public._cancelamento_da_baixa(r_l);
        if v_item is not null and not v_cancelar @> jsonb_build_array(v_item) then
          v_cancelar := v_cancelar || jsonb_build_array(v_item);
        end if;
      end loop;
      update public.extrato_linhas set sem_auto = true where id = r_linha.id;
    elsif r_linha.conciliada_como in ('regra', 'par') then
      if r_linha.conciliada_como = 'regra' and r_linha.desfazer ? 'regra_id' then
        update public.extrato_regras set usos = greatest(usos - 1, 0) where id = (r_linha.desfazer->>'regra_id')::uuid;
      end if;
      delete from public.lancamentos_financeiros
       where extrato_linha_id = r_linha.id and origem in ('manual', 'devolucao_bancaria');
    elsif r_linha.conciliada_como = 'correcao' then
      select * into v_cor from public.baixa_correcoes where id = (r_linha.desfazer->>'correcao_id')::uuid for update;
      if not found then raise exception 'A correção desta linha não foi achada.'; end if;
      -- Volta a baixa de antes: cancela a corrigida e refaz a de antes.
      perform public.cancelar_baixa_lancamento(v_cor.lancamento_id, 'Correção pela conciliação com o banco desfeita');
      select coalesce(sum((x->>'valor')::numeric), 0) into v_ret from jsonb_array_elements(v_cor.de->'retencoes') x;
      perform public._refazer_baixa(
        v_cor.documento_origem, v_cor.documento_id, (v_cor.de->>'data')::date, r_linha.conta_bancaria_id,
        (v_cor.de->>'tipo_id')::uuid, (v_cor.de->>'subtipo_id')::uuid, (v_cor.de->>'forma')::forma_pagamento,
        (v_cor.de->>'principal')::numeric + v_ret, v_cor.de->'retencoes', (v_cor.de->>'juros')::numeric);
      update public.baixa_correcoes set desfeita_em = now(), desfeita_por = v_uid where id = v_cor.id;
    else
      -- A baixa já existia: só desliga, e as datas voltam.
      update public.lancamentos_financeiros set extrato_linha_id = null where extrato_linha_id = r_linha.id;
      for d in select value from jsonb_array_elements(coalesce(r_linha.desfazer->'datas', '[]'::jsonb)) loop
        if exists (select 1 from public.lancamentos_financeiros where id = (d->>'id')::uuid) then
          perform public._mudar_data_do_lancamento((d->>'id')::uuid, (d->>'de')::date);
        end if;
      end loop;
    end if;

    if r_linha.conciliada_como is distinct from 'baixa' and r_linha.conciliada_como is distinct from 'avulso' then
      update public.extrato_linhas
         set conciliada_como = null, conciliada_em = null, conciliada_por = null, desfazer = null,
             grupo = null, resolvida_sozinha = null, sem_auto = true
       where id = r_linha.id;
    end if;
  end loop;

  perform public._auditar_extrato(v_linha, 'extrato.conciliacao_desfeita', v_uid,
    jsonb_build_object('linhas', to_jsonb(v_linhas), 'como', v_linha.conciliada_como,
                       'ignorada', v_linha.ignorada_em is not null, 'cancelar', v_cancelar));
  return jsonb_build_object('linhas', to_jsonb(v_linhas), 'cancelar', v_cancelar);
end;
$$;

comment on function public.desfazer_conciliacao(uuid) is
  'Desfaz a conciliação da linha (e do grupo): a ligação volta as datas, a correção volta a baixa de antes, a regra e o saiu e voltou apagam o que criaram, e as baixas nascidas aqui voltam para a tela cancelar (decisão 200).';

-- -----------------------------------------------------------------------------
-- 11. Permissões
-- -----------------------------------------------------------------------------

revoke all on function public.conciliar_linha(uuid, uuid[], text, uuid, text) from public, anon;
revoke all on function public.conciliar_linha_pelos_documentos(uuid, jsonb, text, uuid, text) from public, anon;
revoke all on function public.corrigir_baixa_pela_conciliacao(uuid, uuid, text) from public, anon;
revoke all on function public.lancar_pela_regra(uuid, uuid, boolean) from public, anon;
revoke all on function public.criar_regra_do_extrato(uuid, text, uuid, uuid, uuid, boolean) from public, anon;
revoke all on function public.registrar_saiu_e_voltou(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.ignorar_linha(uuid, text) from public, anon;
revoke all on function public.desfazer_conciliacao(uuid) from public, anon;

grant execute on function public.conciliar_linha(uuid, uuid[], text, uuid, text) to authenticated;
grant execute on function public.conciliar_linha_pelos_documentos(uuid, jsonb, text, uuid, text) to authenticated;
grant execute on function public.corrigir_baixa_pela_conciliacao(uuid, uuid, text) to authenticated;
grant execute on function public.lancar_pela_regra(uuid, uuid, boolean) to authenticated;
grant execute on function public.criar_regra_do_extrato(uuid, text, uuid, uuid, uuid, boolean) to authenticated;
grant execute on function public.registrar_saiu_e_voltou(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.ignorar_linha(uuid, text) to authenticated;
grant execute on function public.desfazer_conciliacao(uuid) to authenticated;
