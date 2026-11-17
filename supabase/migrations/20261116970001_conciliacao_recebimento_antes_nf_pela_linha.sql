-- Decisão 262, parte 3 (D11; pendência D16 da decisão 260): o recebimento antes da NF pela linha do banco.
--
-- No ⋯ da linha de entrada da Conciliação automática, "Recebimento antes da
-- NF": a data, o valor e a conta vêm da linha; a pessoa escolhe o job (ou o
-- BV) e o centro de custo; "Registrar e conciliar" grava o recebimento e
-- concilia a linha com ele, na mesma transação (ou as duas coisas, ou nada).
--
-- - `registrar_recebimento_antes_nf_pela_linha`: chama as funções de sempre
--   (`registrar_recebimento_antes_nf` para a nota do envio ou o BV,
--   `registrar_recebimento_antes_nf_do_job` para o job sem envio; elas
--   conferem o saldo, o papel, a conta, o centro de custo e auditam) e depois
--   `conciliar_linha` como 'avulso': o lançamento nasceu da linha.
--   O internacional (nota do envio de job com câmbio fechado, decisão 229)
--   fica no Recebimento avulso, que pede a cotação, o IOF e a tarifa; a nota
--   do envio em lote não aceita, como na lista de escolha.
-- - Desfazer (escolha do Tiago em 16/11/2026, "Desfaz tudo"): a linha
--   conciliada como 'avulso' devolve o que cancelar (`_cancelamento_da_baixa`);
--   o recebimento que ainda espera a nota passa a voltar como
--   'recebimento_antes_nf', e a tela o cancela com o motivo do desfazer.
--   Depois de a nota sair, o lançamento é a baixa da parcela 1
--   ('titulo_baixa'), e o Desfazer cancela essa baixa, como no avulso.
--   A função passa de IMMUTABLE a STABLE porque agora lê o recebimento; só o
--   `desfazer_conciliacao` a usa, e nenhum índice.
--
-- Aditiva: uma função nova e um caso novo na outra. Em 16/11/2026, nenhum
-- lançamento de recebimento antes da NF estava conciliado com linha do banco
-- (produção sem nenhum recebimento antes da NF; Sandbox com 8, nenhum
-- conciliado): o caso novo não muda nada do que já existe.

create or replace function public.registrar_recebimento_antes_nf_pela_linha(
  p_linha_id uuid,
  p_envio_nota_id uuid,
  p_item_bv_id uuid,
  p_job_id uuid,
  p_tipo_id uuid,
  p_subtipo_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linha  extrato_linhas%rowtype;
  v_nota   jobs_envio_faturamento_notas%rowtype;
  v_rec    uuid;
  v_lanc   uuid;
begin
  -- Tranca a linha, exige o papel da conciliação e recusa a ignorada e a já conciliada.
  v_linha := public._linha_pendente(p_linha_id);
  if v_linha.valor is null or v_linha.valor <= 0 then
    raise exception 'O recebimento antes da NF é de uma linha de entrada do banco.';
  end if;
  if (p_envio_nota_id is not null)::int + (p_item_bv_id is not null)::int + (p_job_id is not null)::int <> 1 then
    raise exception 'Escolha o job ou o BV do recebimento.';
  end if;

  if p_envio_nota_id is not null then
    select * into v_nota from public.jobs_envio_faturamento_notas where id = p_envio_nota_id;
    if not found then
      raise exception 'Esta nota do envio não foi encontrada.';
    end if;
    if v_nota.lote_nota_id is not null then
      raise exception 'A nota do envio em lote ainda não aceita recebimento antes da NF.';
    end if;
    if exists (
      select 1
        from public.jobs j
        join public.orcamentos o on o.id = j.orcamento_id
        join public.categorias_dominio c on c.id = o.categoria_id
        join public.versoes_orcamento v on v.id = j.versao_orcamento_aprovada_id
       where j.id = v_nota.job_id
         and c.modelo_planilha::text = 'internacional'
         and nullif(btrim(coalesce(v.moeda_estrangeira, '')), '') is not null
         and coalesce(v.cambio_compra, 0) > 0
    ) then
      raise exception 'Recebimento internacional: registre pelo Recebimento avulso, que pede a cotação, o IOF e a tarifa do câmbio.';
    end if;
  end if;

  if p_job_id is not null then
    v_rec := public.registrar_recebimento_antes_nf_do_job(
      p_job_id, v_linha.data, v_linha.conta_bancaria_id, v_linha.valor, p_tipo_id, p_subtipo_id);
  else
    v_rec := public.registrar_recebimento_antes_nf(
      p_envio_nota_id, p_item_bv_id, v_linha.data, v_linha.conta_bancaria_id, v_linha.valor, p_tipo_id, p_subtipo_id);
  end if;

  select lancamento_id into v_lanc from public.recebimentos_antes_nf where id = v_rec;
  if v_lanc is null then
    raise exception 'O recebimento não gerou o lançamento da entrada.';
  end if;

  perform public.conciliar_linha(p_linha_id, array[v_lanc], 'avulso', null, null);

  return jsonb_build_object('recebimento_id', v_rec, 'lancamento_id', v_lanc, 'preso_ao_job', p_job_id is not null);
end;
$$;

revoke all on function public.registrar_recebimento_antes_nf_pela_linha(uuid, uuid, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.registrar_recebimento_antes_nf_pela_linha(uuid, uuid, uuid, uuid, uuid, uuid) to authenticated;

-- O que o Desfazer cancela: os casos de antes, e o recebimento antes da NF que ainda espera a nota.
create or replace function public._cancelamento_da_baixa(p_l lancamentos_financeiros)
returns jsonb
language sql
stable
set search_path to 'public'
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
    when 'mutuo_saida' then jsonb_build_object('tipo', 'transferencia', 'id', p_l.transferencia_id)
    when 'mutuo_entrada' then jsonb_build_object('tipo', 'transferencia', 'id', p_l.transferencia_id)
    when 'imposto_baixa' then jsonb_build_object('tipo', 'imposto', 'id', p_l.imposto_a_pagar_id)
    when 'recebimento_antes_nf' then (
      select jsonb_build_object('tipo', 'recebimento_antes_nf', 'id', r.id)
        from public.recebimentos_antes_nf r
       where r.lancamento_id = p_l.id and r.status = 'aguardando'
       limit 1
    )
    else null
  end
$$;
