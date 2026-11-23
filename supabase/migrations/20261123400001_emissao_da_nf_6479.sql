-- Correção de dado (23/11/2026, pedido do Tiago: "percebi que ela parece ter
-- registrado o vencimento na emissão. Corrija"): a emissão da NF 6479.
--
-- Por quê: a NF 6479 da California (job AMB-1073/26, R$ 300.000,00) foi
-- lançada pelo Faturar em 19/11/2026 com a data de emissão 01/03/2027, que é
-- a do vencimento do título. A planilha do financeiro (aba Faturamento
-- California) tem a emissão em 18/11/2026. Com a data errada, os impostos da
-- nota iam para a apuração de março/2027 e a receita saía do 4º trimestre.
--
-- O que faz: troca a emissão de 01/03/2027 para 18/11/2026 e registra o
-- evento `faturamento.emissao_corrigida` na auditoria, com o de → para e o
-- motivo. O título (vencimento 01/03/2027) não muda. Só age se a nota ainda
-- estiver com a data errada; rodar de novo não faz nada.
--
-- Não há tela para corrigir a emissão de uma NF emitida (o "Editar registro"
-- da decisão 271 é das notas tomadas). Pendência registrada: confirmação no
-- Faturar quando a emissão cair fora do mês corrente.

do $$
declare
  v_tenant uuid;
  v_id uuid;
begin
  select f.tenant_id, f.id into v_tenant, v_id
    from public.faturamentos f
    join public.tenants t on t.id = f.tenant_id and t.nome = 'Agência California'
   where f.numero_nf = '6479'
     and f.status = 'emitido'
     and f.data_emissao = date '2027-03-01'
     and f.valor_total = 300000;
  if v_id is null then
    raise notice 'NF 6479 já corrigida ou não encontrada com a data errada: nada a fazer.';
    return;
  end if;

  update public.faturamentos
     set data_emissao = date '2026-11-18'
   where id = v_id;

  insert into public.audit_events (tenant_id, actor_user_id, acao, entidade_tipo, entidade_id, metadata)
  values (
    v_tenant,
    '3a933b18-156d-48b3-b100-a8099292b1c2',
    'faturamento.emissao_corrigida',
    'faturamento',
    v_id,
    jsonb_build_object(
      'numero_nf', '6479',
      'de', '2027-03-01',
      'para', '2026-11-18',
      'motivo', 'Vencimento lançado no campo de emissão; emissão conferida na planilha do financeiro (aba Faturamento California).',
      'origem', 'migration 20261123400001'
    )
  );
end $$;
