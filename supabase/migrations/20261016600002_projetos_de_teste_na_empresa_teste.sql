-- Decisão 181 (16/10/2026): os projetos de teste vão para a Empresa Teste.
--
-- Aprovado pelo Tiago em 16/10/2026 ("Pode executar"), depois do plano com
-- as contagens. É mudança de dado existente: só toca o que nasceu dos
-- projetos TES-P001/26 a TES-P004/26 (e as duas contas bancárias da Empresa
-- Teste). Códigos, clientes, valores, status e auditoria não mudam. A NF 34
-- (PP-00128, AMB-1016/26) é real e fica na GoCrazy.
--
-- O que muda:
-- - gerencial: os 4 projetos, 40 orçamentos e 32 jobs passam de Agência
--   California/NE para Empresa Teste/Teste (o TES-P002/26 tinha NE e NO no
--   projeto: vira Teste e Teste 2); e a empresa das PPs, PPs a emitir,
--   notas, títulos, recebimentos antes da NF e lançamentos deles;
-- - fiscal: o CNPJ de tudo isso passa para a PJ de teste — a emissora e o
--   tomador das PPs e anexos, o tomador das NFs de fornecedor, o CNPJ das
--   notas de saída (as da California vão para a Empresa Teste; as da Hitlab,
--   para a Empresa Teste Presumido, com o CNAE equivalente) e a PJ das duas
--   contas da Empresa Teste e do imposto avulso de teste (cancelado).
--
-- A ordem importa por causa dos gatilhos, que ficam todos ligados:
-- `ck_empresa_bate_regional` exige empresa e regional da mesma empresa, e
-- `enforce_empresa_from_projeto` copia a empresa do projeto para o
-- orçamento e o job. Então: (1) orçamentos e jobs ganham a regional Teste
-- (a empresa volta à do projeto nessa hora); (2) o projeto muda, e
-- `cascade_empresa_para_filhos` leva a Empresa Teste a orçamentos e jobs,
-- agora coerente com a regional. As guardas de escrita olham `auth.uid()`
-- ou `current_user = 'authenticated'` e não barram a migration. A troca da
-- emissora das PPs registra o evento "emissora_trocada" na linha do tempo
-- de cada uma (sem autor), o que documenta a mudança.
--
-- Ensaiada antes numa transação desfeita (do $$ … raise exception).

do $$
declare
  v_tenant uuid;
  v_empresa_ac uuid;
  v_empresa_teste uuid;
  v_reg_ne uuid;
  v_reg_teste uuid;
  v_reg_2 uuid;
  v_pj_california uuid;
  v_pj_hitlab uuid;
  v_pj_real uuid;
  v_pj_presumido uuid;
  v_est_california uuid;
  v_est_hitlab uuid;
  v_est_real uuid;
  v_est_presumido uuid;
  n integer;
begin
  select id, tenant_id into strict v_empresa_teste, v_tenant from public.empresas where nome_fantasia = 'Empresa Teste';
  select id into strict v_empresa_ac from public.empresas where nome_fantasia = 'Agência California';
  select id into strict v_reg_ne from public.regionais where empresa_id = v_empresa_ac and nome = 'NE';
  select id into strict v_reg_teste from public.regionais where empresa_id = v_empresa_teste and nome = 'Teste';
  select id into strict v_reg_2 from public.regionais where empresa_id = v_empresa_teste and nome = 'Teste 2';
  select id into strict v_pj_california from public.empresas_contabeis where tenant_id = v_tenant and cnpj = '19437976000154';
  select id into strict v_pj_hitlab from public.empresas_contabeis where tenant_id = v_tenant and cnpj = '04409741000181';
  select id into strict v_pj_real from public.empresas_contabeis where tenant_id = v_tenant and cnpj = '88888888000191';
  select id into strict v_pj_presumido from public.empresas_contabeis where tenant_id = v_tenant and cnpj = '77777777000191';
  select id into strict v_est_california from public.fiscal_estabelecimentos where tenant_id = v_tenant and cnpj = '19437976000154';
  select id into strict v_est_hitlab from public.fiscal_estabelecimentos where tenant_id = v_tenant and cnpj = '04409741000181';
  select id into strict v_est_real from public.fiscal_estabelecimentos where tenant_id = v_tenant and cnpj = '88888888000191';
  select id into strict v_est_presumido from public.fiscal_estabelecimentos where tenant_id = v_tenant and cnpj = '77777777000191';

  -- O universo: os projetos TES e tudo o que nasceu deles.
  create temp table _tp on commit drop as
    select id from public.projetos where tenant_id = v_tenant and codigo like 'TES-P%';
  select count(*) into n from _tp;
  if n <> 4 then raise exception 'Esperava 4 projetos TES, achei %.', n; end if;
  create temp table _tj on commit drop as
    select id from public.jobs where projeto_id in (select id from _tp);
  create temp table _tpp on commit drop as
    select id from public.pedidos_compra where job_id in (select id from _tj);
  create temp table _tae on commit drop as
    select id from public.pedidos_compra_a_emitir where job_id in (select id from _tj);
  create temp table _tf on commit drop as
    select distinct i.faturamento_id as id
      from public.faturamento_itens i
     where i.origem_id in (select id from _tj)
        or i.origem_id in (select id from public.orcamentos where projeto_id in (select id from _tp));
  create temp table _tnf on commit drop as
    select distinct a.nota_fiscal_id as id
      from public.pedidos_compra_anexos a
     where a.pedido_compra_id in (select id from _tpp) and a.nota_fiscal_id is not null;

  -- A NF de fornecedor de teste não pode servir a PP fora dos projetos TES.
  if exists (
    select 1 from public.pedidos_compra_anexos a
     where a.nota_fiscal_id in (select id from _tnf) and a.pedido_compra_id not in (select id from _tpp)
  ) then
    raise exception 'Uma NF de fornecedor dos projetos TES também está em PP fora deles.';
  end if;

  -- (1) Orçamentos e jobs ganham a regional de teste.
  update public.orcamentos set empresa_id = v_empresa_teste, regional_id = v_reg_teste
   where projeto_id in (select id from _tp);
  update public.jobs set empresa_id = v_empresa_teste, regional_id = v_reg_teste
   where id in (select id from _tj);

  -- (2) O projeto muda; o gatilho leva a Empresa Teste a orçamentos e jobs.
  update public.projetos set empresa_id = v_empresa_teste, regional_id = v_reg_teste
   where id in (select id from _tp);
  update public.projeto_regionais
     set regional_id = case when regional_id = v_reg_ne then v_reg_teste else v_reg_2 end
   where projeto_id in (select id from _tp);

  if exists (select 1 from public.orcamentos where projeto_id in (select id from _tp) and (empresa_id <> v_empresa_teste or regional_id is distinct from v_reg_teste))
     or exists (select 1 from public.jobs where id in (select id from _tj) and (empresa_id <> v_empresa_teste or regional_id <> v_reg_teste)) then
    raise exception 'Orçamento ou job de teste ficou fora da Empresa Teste/Teste.';
  end if;

  -- PPs: a gerencial e o CNPJ (emissora e tomador do documento).
  update public.pedidos_compra
     set empresa_id = v_empresa_teste,
         estabelecimento_id = case when estabelecimento_id is null then null else v_est_real end,
         nf_tomador_estabelecimento_id = case when nf_tomador_estabelecimento_id is null then null else v_est_real end
   where id in (select id from _tpp);
  update public.pedidos_compra_anexos set nf_tomador_estabelecimento_id = v_est_real
   where pedido_compra_id in (select id from _tpp) and nf_tomador_estabelecimento_id is not null;
  update public.pedidos_compra_a_emitir set empresa_id = v_empresa_teste
   where id in (select id from _tae);
  update public.pedidos_compra_a_emitir_anexos set nf_tomador_estabelecimento_id = v_est_real
   where a_emitir_id in (select id from _tae) and nf_tomador_estabelecimento_id is not null;
  update public.notas_fiscais_fornecedor set tomador_estabelecimento_id = v_est_real
   where id in (select id from _tnf);

  -- Notas de saída: o CNPJ de teste equivalente e o CNAE dele.
  update public.faturamentos f
     set empresa_id = v_empresa_teste,
         estabelecimento_id = case f.estabelecimento_id
           when v_est_california then v_est_real
           when v_est_hitlab then v_est_presumido
           else f.estabelecimento_id end,
         fiscal_cnae_id = case when f.fiscal_cnae_id is null then null else (
           select novo.id
             from public.fiscal_cnaes velho
             join public.fiscal_cnaes novo
               on novo.estabelecimento_id = case f.estabelecimento_id when v_est_california then v_est_real when v_est_hitlab then v_est_presumido end
              and novo.codigo = velho.codigo
              and novo.subitem is not distinct from velho.subitem
              and novo.vigencia_inicio = velho.vigencia_inicio
            where velho.id = f.fiscal_cnae_id) end
   where f.id in (select id from _tf);
  if exists (
    select 1 from public.faturamentos f
     where f.id in (select id from _tf)
       and (f.estabelecimento_id in (v_est_california, v_est_hitlab)
            or (f.estabelecimento_id is not null and f.fiscal_cnae_id is not null
                and not exists (select 1 from public.fiscal_cnaes c where c.id = f.fiscal_cnae_id and c.estabelecimento_id = f.estabelecimento_id)))
  ) then
    raise exception 'Nota de teste ficou num CNPJ real ou com CNAE de outro CNPJ.';
  end if;
  update public.titulos_receber set empresa_id = v_empresa_teste
   where faturamento_id in (select id from _tf);
  update public.recebimentos_antes_nf set empresa_id = v_empresa_teste
   where job_id in (select id from _tj);
  update public.lancamentos_financeiros set empresa_id = v_empresa_teste
   where job_id in (select id from _tj) or pedido_compra_id in (select id from _tpp);

  -- As contas da Empresa Teste e o imposto avulso de teste (cancelado em 04/10).
  update public.contas_bancarias set empresa_contabil_id = v_pj_real
   where empresa_id = v_empresa_teste and empresa_contabil_id = v_pj_california;
  update public.impostos_a_pagar i set empresa_contabil_id = v_pj_real,
         estabelecimento_id = case when i.estabelecimento_id = v_est_california then v_est_real else i.estabelecimento_id end
   where i.origem = 'avulso' and i.status = 'cancelado' and i.empresa_contabil_id = v_pj_california
     and exists (select 1 from public.impostos_a_pagar_rateio r where r.imposto_a_pagar_id = i.id and r.empresa_id = v_empresa_teste)
     and not exists (select 1 from public.impostos_a_pagar_rateio r where r.imposto_a_pagar_id = i.id and r.empresa_id <> v_empresa_teste);
end $$;
