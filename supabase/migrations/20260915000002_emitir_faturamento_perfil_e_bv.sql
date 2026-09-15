-- 20260915000002 — `emitir_faturamento` confere o perfil de quem emite e não aceita BV na nota do cliente
--
-- A REGRA (decisão 080; complementa a 017 §7 e a 079)
--
-- 1. Só administrador e financeiro emitem nota. É a regra que a action
--    `emitirFaturamento` já aplicava. A produção não emite: o GP envia o job
--    para faturamento, e o financeiro emite a nota (hoje por fora, anexando
--    o PDF na fila de faturamento) — Tiago, 15/09/2026.
-- 2. BV só sai em nota própria, contra o fornecedor dele: nunca na nota do
--    cliente, nunca junto de outro item, e nunca em nota de outro
--    fornecedor. As duas primeiras partes a action já recusava; a terceira
--    ninguém conferia.
--
-- O DEFEITO (confirmado em 15/09/2026, antes desta migration)
--
-- A RPC é SECURITY DEFINER e só conferia se quem chama é membro do tenant.
-- A trava de perfil e a do BV moravam na action — e qualquer usuário logado
-- chama a RPC direto pela API, pulando tela e action. Simulações como
-- `authenticated`, cada uma com rollback:
--
--   S1  o usuário "GP Teste" (gerente_producao) emitiu nota do JOB-0029 → ACEITA
--   S2  nota do cliente Pevetech com um BV sozinho (JOB-0029, AIRBNB) → ACEITA
--   S3  BV da AIRBNB numa nota de outro fornecedor → ACEITA
--   (e em 15/09, antes: job + BV na mesma nota da Pevetech → ACEITA, e o BV
--    saiu da fila como faturado)
--
-- Em 15/09/2026 o tenant já tinha usuários fora de administrador: 1
-- financeiro, 1 gerente_producao, 1 produtor e 2 freelancers (um deles uma
-- pessoa real).
--
-- A CORREÇÃO
--
-- - Logo depois da checagem de tenant: o usuário da sessão precisa estar
--   ativo no tenant da nota com role `administrador` ou `financeiro`
--   (`tenant_members.role` — a mesma fonte do `activeRole` da sessão; em
--   15/09 `profiles.role` e `tenant_members.role` batiam para todos).
-- - Antes das somas: havendo item de BV, ele precisa ser o único item e o
--   cabeçalho precisa ser de BV; cabeçalho de BV só cobre BV.
-- - No laço dos itens: o BV precisa ser do tenant e do fornecedor da nota.
--
-- Sem número de decisão DENTRO da função, de propósito: a 079 mostrou que o
-- número pode colidir antes de subir, e o comentário aplicado no banco não
-- se corrige com um rebase. O resto da função é a definição viva em
-- 15/09/2026 (20260914000002 + 20260915000001), sem outra alteração.
--
-- DELIBERADAMENTE DE FORA
--
-- - A RPC não exige BV com situação `confirmado` (a fila só mostra os
--   confirmados, mas a chamada direta aceitaria outro estado).
-- - As outras RPCs SECURITY DEFINER do financeiro (baixas, estornos,
--   aprovar PP, cancelar nota, cartão) seguem conferindo só o tenant.
-- - A policy de UPDATE de `itens_bv` deixa qualquer membro do tenant alterar
--   o BV direto pela API, inclusive a situação.
-- - `emitido_por` continua vindo do payload.

create or replace function public.emitir_faturamento(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant_id      uuid := (payload->>'tenant_id')::uuid;
  v_empresa_id     uuid := (payload->>'empresa_id')::uuid;
  v_origem_tipo    faturamento_origem := (payload->>'origem_tipo')::faturamento_origem;
  v_origem_id      uuid := nullif(payload->>'origem_id', '')::uuid;
  v_cliente_id     uuid := nullif(payload->>'cliente_id', '')::uuid;
  v_fornecedor_id  uuid := nullif(payload->>'fornecedor_id', '')::uuid;
  v_valor_total    numeric(14,2) := (payload->>'valor_total')::numeric;
  v_tipo_id        uuid := nullif(payload->>'plano_conta_tipo_id', '')::uuid;
  v_subtipo_id     uuid := nullif(payload->>'plano_conta_subtipo_id', '')::uuid;
  v_emitido_por    uuid := (payload->>'emitido_por')::uuid;
  v_cnae           text := nullif(trim(payload->>'cnae'), '');
  v_faturamento_id uuid;
  v_parcelas       jsonb := payload->'parcelas';
  v_itens          jsonb := coalesce(payload->'itens', '[]'::jsonb);
  v_soma_parcelas  numeric(14,2) := 0;
  v_soma_itens     numeric(14,2) := 0;
  v_parcela        jsonb;
  v_item           jsonb;
  v_subtipo_tipo   uuid;
  v_par            jobs_envio_faturamento_parcelas%rowtype;
  v_ja             numeric(14,2);
  v_saldo          numeric(14,2);
  v_codigo         text;
  v_save_previsto  numeric(14,2);
  v_save_ja        numeric(14,2);
  -- 079: cliente de cada job coberto pela nota
  v_job_conferir   uuid;
  v_cliente_job    uuid;
  v_nome_cliente   text;
  v_nome_nota      text;
  -- fornecedor do BV coberto pela nota
  v_bv_fornecedor  uuid;
  v_nome_fornecedor text;
begin
  if not public.is_tenant_member(v_tenant_id) then
    raise exception 'Sem acesso a este tenant.';
  end if;

  -- Só administrador e financeiro emitem nota: a mesma regra da action
  -- `emitirFaturamento`. Sem isto, qualquer membro do tenant emitia
  -- chamando a RPC direto pela API.
  if not exists (
    select 1
      from public.tenant_members tm
      join public.profiles p on p.id = tm.user_id
     where tm.user_id = (select auth.uid())
       and tm.tenant_id = v_tenant_id
       and tm.status = 'ativo'
       and p.ativo = true
       and tm.role in ('administrador', 'financeiro')
  ) then
    raise exception 'Apenas administrador ou financeiro pode emitir nota fiscal.';
  end if;

  if v_cnae is null then
    raise exception 'Informe o CNAE a ser utilizado na nota.';
  end if;

  if jsonb_array_length(v_parcelas) < 1 then
    raise exception 'Faturamento precisa de pelo menos uma parcela.';
  end if;

  if v_tipo_id is not null or v_subtipo_id is not null then
    if v_tipo_id is null or v_subtipo_id is null then
      raise exception 'Informe tipo e subtipo juntos, ou nenhum dos dois.';
    end if;
    select tipo_id into v_subtipo_tipo
      from public.plano_contas_subtipos where id = v_subtipo_id;
    if not found then raise exception 'Subtipo não encontrado.'; end if;
    if v_subtipo_tipo <> v_tipo_id then
      raise exception 'Subtipo não pertence ao tipo escolhido.';
    end if;
  end if;

  if jsonb_array_length(v_itens) = 0 then
    if v_origem_tipo = 'avulso' then
      v_itens := jsonb_build_array(jsonb_build_object(
        'origem_tipo', 'avulso', 'origem_id', null,
        'envio_parcela_id', null, 'valor', v_valor_total));
    else
      v_itens := jsonb_build_array(jsonb_build_object(
        'origem_tipo', v_origem_tipo, 'origem_id', v_origem_id,
        'envio_parcela_id', null, 'valor', v_valor_total));
    end if;
  end if;

  -- BV só sai em nota própria, contra o fornecedor dele (017 §7): nunca na
  -- nota do cliente e nunca junto de outro item.
  if exists (select 1 from jsonb_array_elements(v_itens) i where i->>'origem_tipo' = 'bv') then
    if jsonb_array_length(v_itens) > 1 then
      raise exception 'BV tem o fornecedor como contraparte e precisa ser faturado individualmente.';
    end if;
    if v_origem_tipo <> 'bv' then
      raise exception 'BV não entra na nota do cliente: ele é faturado numa nota própria, contra o fornecedor.';
    end if;
  elsif v_origem_tipo = 'bv' then
    raise exception 'Nota de BV só cobre o próprio BV.';
  end if;

  for v_parcela in select * from jsonb_array_elements(v_parcelas)
  loop
    v_soma_parcelas := v_soma_parcelas + (v_parcela->>'valor')::numeric;
  end loop;

  if abs(v_soma_parcelas - v_valor_total) > 0.01 then
    raise exception 'Soma das parcelas (R$ %) não bate com valor total (R$ %).',
      v_soma_parcelas, v_valor_total;
  end if;

  for v_item in select * from jsonb_array_elements(v_itens)
  loop
    v_soma_itens := v_soma_itens + (v_item->>'valor')::numeric;
  end loop;

  if abs(v_soma_itens - v_valor_total) > 0.01 then
    raise exception 'Soma dos jobs desta NF (R$ %) não bate com o valor total (R$ %).',
      v_soma_itens, v_valor_total;
  end if;

  for v_item in select * from jsonb_array_elements(v_itens)
  loop
    -- 079: nota só cobre jobs de um mesmo cliente (017 §7). Conferido pelo
    -- job do item e pelo job da parcela — a RPC não exige que sejam o mesmo.
    if (v_item->>'origem_tipo') in ('job', 'save') then
      foreach v_job_conferir in array array_remove(array[
        nullif(v_item->>'origem_id', '')::uuid,
        (select par.job_id
           from public.jobs_envio_faturamento_parcelas par
          where par.id = nullif(v_item->>'envio_parcela_id', '')::uuid)
      ], null)
      loop
        select j.codigo, p.cliente_id, coalesce(c.nome_fantasia, c.razao_social)
          into v_codigo, v_cliente_job, v_nome_cliente
          from public.jobs j
          join public.projetos p on p.id = j.projeto_id
          join public.clientes c on c.id = p.cliente_id
         where j.id = v_job_conferir
           and j.tenant_id = v_tenant_id;
        if not found then
          raise exception 'Job desta nota não encontrado.';
        end if;
        if v_cliente_job is distinct from v_cliente_id then
          select coalesce(nome_fantasia, razao_social) into v_nome_nota
            from public.clientes where id = v_cliente_id;
          raise exception
            'Uma nota fiscal cobre apenas jobs de um mesmo cliente: % é do cliente %, e a nota é do cliente %.',
            coalesce(v_codigo, 'o job'), v_nome_cliente, coalesce(v_nome_nota, '(sem cliente)');
        end if;
      end loop;
    end if;

    if nullif(v_item->>'envio_parcela_id', '') is not null then
      select * into v_par
        from public.jobs_envio_faturamento_parcelas
       where id = (v_item->>'envio_parcela_id')::uuid;
      if not found then
        raise exception 'Parcela de faturamento não encontrada.';
      end if;
      if v_par.tenant_id <> v_tenant_id then
        raise exception 'Parcela de faturamento de outro tenant.';
      end if;

      select coalesce(sum(fi.valor), 0)::numeric(14,2) into v_ja
        from public.faturamento_itens fi
        join public.faturamentos f on f.id = fi.faturamento_id
       where fi.envio_parcela_id = v_par.id
         and f.status = 'emitido';

      v_saldo := v_par.valor - v_ja;
      if (v_item->>'valor')::numeric > v_saldo + 0.01 then
        select codigo into v_codigo from public.jobs where id = v_par.job_id;
        raise exception
          '% (parcela %): o valor a faturar (R$ %) não pode ser maior que o saldo a faturar (R$ %).',
          coalesce(v_codigo, 'Job'), v_par.ordem,
          (v_item->>'valor')::numeric, v_saldo;
      end if;
    end if;

    if (v_item->>'origem_tipo') = 'save' then
      if v_par.job_id is distinct from (v_item->>'origem_id')::uuid then
        raise exception 'O saldo em save só pode ser faturado na nota do job que o gerou.';
      end if;

      select coalesce(faturamento_save_previsto, 0)::numeric(14,2) into v_save_previsto
        from public.jobs where id = (v_item->>'origem_id')::uuid;

      select coalesce(sum(fi.valor), 0)::numeric(14,2) into v_save_ja
        from public.faturamento_itens fi
        join public.faturamentos f on f.id = fi.faturamento_id
       where fi.origem_tipo = 'save'
         and fi.origem_id = (v_item->>'origem_id')::uuid
         and f.status = 'emitido';

      if v_save_ja + (v_item->>'valor')::numeric > v_save_previsto + 0.01 then
        select codigo into v_codigo from public.jobs where id = (v_item->>'origem_id')::uuid;
        raise exception
          '% gerou R$ % de saldo em save e R$ % já saiu em nota: não cabe faturar mais R$ %.',
          coalesce(v_codigo, 'O job'), v_save_previsto, v_save_ja, (v_item->>'valor')::numeric;
      end if;
    end if;

    if (v_item->>'origem_tipo') = 'bv' then
      -- O BV precisa ser do tenant e do fornecedor da nota.
      select b.fornecedor_id, f.nome
        into v_bv_fornecedor, v_nome_fornecedor
        from public.itens_bv b
        left join public.fornecedores f on f.id = b.fornecedor_id
       where b.id = nullif(v_item->>'origem_id', '')::uuid
         and b.tenant_id = v_tenant_id;
      if not found then
        raise exception 'BV desta nota não encontrado.';
      end if;
      if v_bv_fornecedor is distinct from v_fornecedor_id then
        raise exception 'Este BV é do fornecedor %, e a nota é de outro fornecedor.',
          coalesce(v_nome_fornecedor, '(sem fornecedor)');
      end if;

      if exists (
        select 1 from public.faturamento_itens fi
          join public.faturamentos f on f.id = fi.faturamento_id
         where fi.origem_tipo = 'bv'
           and fi.origem_id = (v_item->>'origem_id')::uuid
           and f.status = 'emitido'
      ) then
        raise exception 'Este BV já foi faturado.';
      end if;
    end if;
  end loop;

  insert into public.faturamentos (
    tenant_id, empresa_id, origem_tipo, origem_id,
    cliente_id, fornecedor_id,
    numero_nf, serie, data_emissao, valor_total, descricao, cnae,
    anexo_nf_path, plano_conta_tipo_id, plano_conta_subtipo_id,
    emitido_por
  ) values (
    v_tenant_id, v_empresa_id, v_origem_tipo, v_origem_id,
    v_cliente_id, v_fornecedor_id,
    payload->>'numero_nf', coalesce(nullif(payload->>'serie', ''), '1'),
    (payload->>'data_emissao')::date, v_valor_total, payload->>'descricao', v_cnae,
    payload->>'anexo_nf_path', v_tipo_id, v_subtipo_id,
    v_emitido_por
  )
  returning id into v_faturamento_id;

  for v_item in select * from jsonb_array_elements(v_itens)
  loop
    insert into public.faturamento_itens (
      tenant_id, faturamento_id, origem_tipo, origem_id,
      envio_parcela_id, valor
    ) values (
      v_tenant_id, v_faturamento_id,
      (v_item->>'origem_tipo')::faturamento_origem,
      nullif(v_item->>'origem_id', '')::uuid,
      nullif(v_item->>'envio_parcela_id', '')::uuid,
      (v_item->>'valor')::numeric
    );
  end loop;

  for v_parcela in select * from jsonb_array_elements(v_parcelas)
  loop
    insert into public.titulos_receber (
      tenant_id, empresa_id, faturamento_id,
      numero_parcela, valor, data_vencimento,
      data_previsao_recebimento, data_previsao_recebimento_primeira
    ) values (
      v_tenant_id, v_empresa_id, v_faturamento_id,
      (v_parcela->>'numero')::smallint,
      (v_parcela->>'valor')::numeric,
      (v_parcela->>'data_vencimento')::date,
      (v_parcela->>'data_vencimento')::date,
      (v_parcela->>'data_vencimento')::date
    );
  end loop;

  return v_faturamento_id;
end;
$function$;

revoke execute on function public.emitir_faturamento(jsonb) from public, anon;
grant  execute on function public.emitir_faturamento(jsonb) to authenticated;
