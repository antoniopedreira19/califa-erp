-- Decisão 265: as três notas avulsas "referente a um job" da produção viram
-- Novo faturamento (decisão 256).
--
-- Racional (Tiago, 17/11/2026): extras de job não existem — o que é extra
-- ganha orçamento próprio. A avulsa "referente a um job" (decisão 184) só
-- guardava `job_referencia_id` e não contava no faturamento do job. O
-- financeiro a usou para faturar o próprio job, com o valor do previsto:
--
--   NF 6468 · AMB-1061/26 · R$ 80.000,00  (previsto R$ 80.000,00)
--   NF 6376 · AMB-1042/26 · R$ 292.000,00 (previsto R$ 292.000,00)
--   NF 6475 · AMB-1058/26 · R$ 535.000,00 (previsto R$ 555.741,02)
--
-- Nenhuma contava no job: os três seguiam sem faturamento para a produção,
-- fora da rentabilidade e com o envio do GP aberto (risco de a nota sair
-- duas vezes). "Converta: elas deveriam ser um novo faturamento e os jobs
-- deveriam ter tido seus faturamentos contados e planilhas travadas"
-- (Tiago, 17/11/2026). Sobrescrita de dado autorizada por ele.
--
-- O que a conversão faz, nota a nota, para ela ficar igual à que o Novo
-- faturamento grava (`emitir_faturamento` com `faturado_pelo_financeiro`):
--   • a nota passa a ser de job (`origem_tipo = 'job'`, `origem_id` = job),
--     sem `job_referencia_id`, sem centro de custo (o da nota de job vem do
--     job) e marcada `faturado_pelo_financeiro`;
--   • o item avulso vira item `job` do job, sem parcela de envio (os três
--     jobs não geram save: `faturamento_save_previsto` = 0);
--   • o rateio de regional sai (a nota de job fica na regional do job; o
--     rateio era 100% nela);
--   • a PO passa a ser do job;
--   • o job é carimbado como faturado (`faturamento_enviado_em`) na hora em
--     que a nota foi lançada, como o Novo faturamento faria. O AMB-1058/26
--     fica com o saldo de R$ 20.741,02 na fila do financeiro (regra da 256).
-- Valor, número, emissão, títulos, CBS/IBS e anexo não mudam.
--
-- Para desfazer: os valores anteriores ficam na auditoria
-- (`faturamento.convertido_em_novo_faturamento`, metadata `antes`).

do $$
declare
  v_tenant uuid;
  v_nota   record;
  v_qtd    int := 0;
begin
  select id into v_tenant from public.tenants where nome = 'Agência California';
  if v_tenant is null then
    raise exception 'Tenant da produção não encontrado.';
  end if;

  for v_nota in
    select f.id, f.numero_nf, f.job_referencia_id as job_id, f.emitido_em,
           f.plano_conta_tipo_id, f.plano_conta_subtipo_id,
           j.codigo, j.empresa_id as job_empresa, j.cliente_id as job_cliente,
           j.faturamento_save_previsto, j.status::text as job_status,
           f.empresa_id, f.cliente_id,
           (select coalesce(jsonb_agg(jsonb_build_object('regional_id', r.regional_id, 'percentual', r.percentual)), '[]'::jsonb)
              from public.faturamentos_regionais r where r.faturamento_id = f.id) as rateio
      from public.faturamentos f
      join public.jobs j on j.id = f.job_referencia_id
     where f.tenant_id = v_tenant
       and f.id in ('f2a73381-518e-43a2-a5fc-58a9b92eca9c',
                    '25440a88-4ef0-421f-873a-4a6ba67966b4',
                    '5d5c8855-8a54-4a4b-a547-1713cba0890a')
       and f.origem_tipo = 'avulso'
       and f.status = 'emitido'
  loop
    -- As travas do Novo faturamento, conferidas aqui também.
    if v_nota.empresa_id is distinct from v_nota.job_empresa
       or v_nota.cliente_id is distinct from v_nota.job_cliente then
      raise exception 'NF %: empresa ou cliente diferente do %.', v_nota.numero_nf, v_nota.codigo;
    end if;
    if coalesce(v_nota.faturamento_save_previsto, 0) > 0 then
      raise exception 'NF %: o % gera save; a conversão não divide a nota.', v_nota.numero_nf, v_nota.codigo;
    end if;
    if v_nota.job_status not in ('aberto', 'em_producao', 'encerrado', 'finalizado') then
      raise exception 'NF %: o % não está aberto nem encerrado.', v_nota.numero_nf, v_nota.codigo;
    end if;
    if exists (select 1 from public.jobs_envio_faturamento e where e.job_id = v_nota.job_id) then
      raise exception 'NF %: o % já tem envio do GP.', v_nota.numero_nf, v_nota.codigo;
    end if;
    if (select count(*) from public.faturamento_itens i where i.faturamento_id = v_nota.id) <> 1 then
      raise exception 'NF %: a nota avulsa devia ter um item só.', v_nota.numero_nf;
    end if;

    update public.faturamentos
       set origem_tipo = 'job',
           origem_id = v_nota.job_id,
           job_referencia_id = null,
           faturado_pelo_financeiro = true,
           plano_conta_tipo_id = null,
           plano_conta_subtipo_id = null
     where id = v_nota.id;

    update public.faturamento_itens
       set origem_tipo = 'job',
           origem_id = v_nota.job_id
     where faturamento_id = v_nota.id
       and origem_tipo = 'avulso';

    delete from public.faturamentos_regionais where faturamento_id = v_nota.id;

    update public.faturamentos_po
       set job_id = v_nota.job_id
     where faturamento_id = v_nota.id
       and job_id is null;

    -- O carimbo, pela mesma regra do Novo faturamento: com a nota contando,
    -- `job_faturamento_todo_enviado` dá verdadeiro.
    if not public.job_faturamento_todo_enviado(
         v_nota.job_id, (select faturamento_previsto from public.jobs where id = v_nota.job_id)) then
      raise exception 'NF %: o % não ficou faturado depois da conversão.', v_nota.numero_nf, v_nota.codigo;
    end if;
    update public.jobs
       set faturamento_enviado_em = coalesce(faturamento_enviado_em, v_nota.emitido_em)
     where id = v_nota.job_id;

    insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
    values (
      v_tenant,
      '3a933b18-156d-48b3-b100-a8099292b1c2',
      'faturamento.convertido_em_novo_faturamento',
      'faturamento',
      v_nota.id::text,
      jsonb_build_object(
        'decisao', 265,
        'numero_nf', v_nota.numero_nf,
        'job_id', v_nota.job_id,
        'job_codigo', v_nota.codigo,
        'antes', jsonb_build_object(
          'origem_tipo', 'avulso',
          'job_referencia_id', v_nota.job_id,
          'plano_conta_tipo_id', v_nota.plano_conta_tipo_id,
          'plano_conta_subtipo_id', v_nota.plano_conta_subtipo_id,
          'rateio', v_nota.rateio,
          'faturamentos_po_job_id', null
        )
      )
    );

    v_qtd := v_qtd + 1;
  end loop;

  if v_qtd <> 3 then
    raise exception 'Esperava converter 3 notas e converteu %.', v_qtd;
  end if;
end;
$$;
