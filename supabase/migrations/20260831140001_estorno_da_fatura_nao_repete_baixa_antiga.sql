-- Estorno da baixa da fatura: não contra-lança de novo o que já foi
-- estornado.
-- ⚠️ SUPERADA no mesmo dia pela 20260831150002/150003, que trouxeram a
-- fatura para a tríade `fatura_cartao_baixa` / `_estornada` / `_estorno`
-- do enum `origem_lancamento` — o padrão que os outros cinco documentos
-- estornáveis já seguiam. O corte por data abaixo resolveu o bug de
-- dinheiro na hora; o estado na própria linha é o conserto definitivo.
-- Fica no repositório porque chegou a ser aplicada no banco.
--
--
-- `estornar_baixa_fatura_cartao` (migration 20260829110002) percorria TODOS
-- os lançamentos `papel_na_fatura = 'pagamento'` da fatura e contra-lançava
-- cada um, sem olhar se ele já tinha sido desfeito num ciclo anterior.
--
-- Numa fatura que passou por pagar → estornar → pagar isso é dinheiro
-- inventado: o segundo estorno devolveria também o primeiro pagamento, que
-- já estava anulado, e a conta bancária ganharia de volta um valor que
-- ninguém pagou. Encontrado no teste ponta a ponta de 31/08/2026 na
-- FC-00001, que tinha 4 lançamentos de pagamento (2 do ciclo velho + 2 do
-- novo) e o laço pegava os 4.
--
-- ⚠️ O corte é por `created_at`, e não por `estorno_de_lancamento_id`.
-- A coluna existe, mas `chk_estorno_consistente` só a admite quando
-- `origem` é um dos cinco `*_estorno`, e a baixa da fatura grava
-- `origem = 'manual'`. Usá-la aqui exigiria valor novo no enum
-- `origem_lancamento` E substituição do CHECK — mudança que precisa de
-- autorização. O corte por data resolve o mesmo problema sem tocar em
-- constraint: cada estorno desfaz o que entrou depois do estorno anterior,
-- que é exatamente a semântica do ciclo.
--
-- O resto da função é idêntico ao que está no banco.

create or replace function public.estornar_baixa_fatura_cartao(
  p_fatura_id uuid,
  p_motivo text
)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_uid  uuid;
  v_fatura      faturas_cartao%rowtype;
  v_pag         record;
  v_novo        uuid;
  v_ids         uuid[] := '{}';
  v_ultimo_est  timestamptz;
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then raise exception 'Sessão inválida.'; end if;

  if p_motivo is null or length(btrim(p_motivo)) < 3 then
    raise exception 'Diga por que a baixa está sendo estornada.';
  end if;

  select * into v_fatura from faturas_cartao where id = p_fatura_id;
  if not found then raise exception 'Fatura não encontrada.'; end if;

  if not is_tenant_member(v_fatura.tenant_id) then
    raise exception 'Sem permissão nesta fatura.';
  end if;

  if v_fatura.status <> 'paga' then
    raise exception 'Só fatura paga tem baixa para estornar (status atual: %).', v_fatura.status;
  end if;

  select max(created_at) into v_ultimo_est
    from lancamentos_financeiros
   where fatura_cartao_id = p_fatura_id
     and papel_na_fatura  = 'pagamento_estorno';

  -- Contra-lançamento, não delete: aqui o dinheiro saiu de verdade, e o
  -- extrato do banco também vai mostrar as duas pernas.
  for v_pag in
    select l.* from lancamentos_financeiros l
     where l.fatura_cartao_id = p_fatura_id
       and l.papel_na_fatura  = 'pagamento'
       and (v_ultimo_est is null or l.created_at > v_ultimo_est)
     order by l.created_at
  loop
    insert into lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      forma_pagamento, cartao_credito_id, fatura_cartao_id, papel_na_fatura,
      origem, criado_por
    ) values (
      v_pag.tenant_id, v_pag.empresa_id, v_pag.conta_bancaria_id,
      current_date, v_pag.valor,
      case when v_pag.natureza = 'saida' then 'entrada' else 'saida' end::natureza_lancamento,
      'Estorno · ' || substring(v_pag.descricao, 1, 170),
      v_pag.plano_conta_tipo_id, v_pag.plano_conta_subtipo_id,
      null, v_fatura.cartao_credito_id, p_fatura_id, 'pagamento_estorno',
      'manual', v_caller_uid
    )
    returning id into v_novo;

    v_ids := v_ids || v_novo;
  end loop;

  if array_length(v_ids, 1) is null then
    raise exception 'A fatura % está paga mas não tem lançamento de pagamento vigente para estornar.', v_fatura.codigo;
  end if;

  update faturas_cartao set status = 'fechada' where id = p_fatura_id;

  insert into audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_fatura.tenant_id, 'fatura_cartao', p_fatura_id::text,
    'fatura_cartao.baixa_estornada', v_caller_uid,
    jsonb_build_object(
      'codigo', v_fatura.codigo,
      'motivo', btrim(p_motivo),
      'valor', v_fatura.valor_cobrado,
      'lancamentos', to_jsonb(v_ids)
    )
  );

  return v_ids;
end;
$function$;

comment on function public.estornar_baixa_fatura_cartao(uuid, text) is
  'Contra-lança a baixa VIGENTE da fatura — só os pagamentos posteriores ao último estorno — e devolve a fatura para fechada.';
