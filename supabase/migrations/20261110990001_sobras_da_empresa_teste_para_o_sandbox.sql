-- ============================================================================
-- SOBRAS DA EMPRESA TESTE: DO TENANT DA PRODUÇÃO PARA O SANDBOX
-- ============================================================================
-- A mudança da "Empresa Teste" para o tenant california-sandbox (migrations
-- 20261109970002 a 970005) levou empresa, clientes, projetos, jobs e PPs, mas
-- deixou no tenant da produção o lado financeiro e fiscal que nasceu deles. Em
-- 10/11/2026 isso aparecia na produção: 9 entradas de teste no Fluxo de Caixa
-- sem filtro de empresa (títulos de NFs TESTE-…), e 17 anexos de PP a emitir
-- com link quebrado (o arquivo já estava na pasta do Sandbox).
--
-- O Tiago autorizou, em 10/11/2026, MOVER as sobras para o Sandbox (e não
-- apagar), como a migration 970002 pretendia. Muda só o tenant_id (e o
-- prefixo dos caminhos de arquivo); nenhum valor de negócio muda:
--   faturamentos 16, faturamento_itens 20, faturamentos_regionais 3,
--   titulos_receber 19, projetos_financeiro 4 + códigos 10, códigos de
--   orçamento 12, conta "Conta Teste" 1 + extrato (4 importações, 18 linhas,
--   2 regras, 1 correção de baixa), fiscal dos CNPJs de teste (2
--   estabelecimentos, 25 CNAEs, 2 regimes, 1 aprovação, 1 imposto + 1 rateio,
--   3 CNPJ da PP por regional), 5 NFs de fornecedor (PPs do TES-1014/26),
--   1 lote de envio + 2 notas, 1 save avulso + 1 consumo, 17 anexos de PP a
--   emitir, 2 anexos de PO.
-- Apaga só os 88 empresa_members da produção que apontam para a Empresa Teste
-- (vínculo com empresa de outro tenant não dá acesso a nada).
--
-- FICA na produção, de propósito:
--   - o cartão "ZZ Teste Empresa Teste", a conta ligada a ele e as faturas
--     FC-00004/FC-00005: as PPs reais PP-00044, PP-00210, PP-00824 e
--     PP-00950 apontam para esse cartão; qual é o cartão certo delas é
--     decisão do Tiago, à parte;
--   - RH na Empresa Teste (alocação, contratações, folha, 13º): frente do
--     Antonio;
--   - as contas "Teste" e "Conta Teste Presumido" (sem empresa gerencial,
--     com os CNPJs de teste): achadas no ensaio, fora da lista aprovada;
--   - audit_events.
--
-- Os arquivos que estavam na pasta da produção (16 PDFs de NF, 1 PO, 1 guia)
-- foram movidos pela API do Storage antes desta migration; aqui só o caminho
-- gravado muda de prefixo.
--
-- Travas: cada conjunto é conferido contra a contagem levantada em
-- 10/11/2026; qualquer diferença aborta tudo. Os gatilhos ficam LIGADOS (o
-- usuário do MCP não pode desligá-los, e assim o ensaio é igual ao que se
-- aplica); nenhuma coluna de FK muda.
-- ============================================================================

do $$
declare
  v_p     uuid;
  v_s     uuid;
  v_pre_p text;
  v_pre_s text;
  v_emp   uuid[];
  v_cli   uuid[];
  v_ec    uuid[];
  v_fat   uuid[];
  v_tit   uuid[];
  v_pf    uuid[];
  v_conta uuid[];
  v_linha uuid[];
  v_estab uuid[];
  v_imp   uuid[];
  v_lote  uuid[];
  v_save  uuid[];
  v_n     int;
begin
  select id into v_p from public.tenants where slug = 'agencia-california';
  select id into v_s from public.tenants where slug = 'california-sandbox';
  if v_p is null or v_s is null then
    raise exception 'Tenants agencia-california / california-sandbox não encontrados.';
  end if;
  v_pre_p := v_p::text || '/';
  v_pre_s := v_s::text || '/';

  v_emp := array(select id from public.empresas where tenant_id = v_s);
  v_cli := array(select id from public.clientes where tenant_id = v_s);
  v_ec  := array(select id from public.empresas_contabeis where tenant_id = v_s);

  -- ---- conjuntos (todos no tenant da produção) ----
  v_fat := array(select id from public.faturamentos
                  where tenant_id = v_p and (empresa_id = any(v_emp) or cliente_id = any(v_cli)));
  if cardinality(v_fat) <> 16 then raise exception 'faturamentos: % (esperado 16)', cardinality(v_fat); end if;

  v_tit := array(select id from public.titulos_receber
                  where tenant_id = v_p and (empresa_id = any(v_emp) or faturamento_id = any(v_fat)));
  if cardinality(v_tit) <> 19 then raise exception 'titulos_receber: % (esperado 19)', cardinality(v_tit); end if;

  v_pf := array(select id from public.projetos_financeiro where tenant_id = v_p and cliente_id = any(v_cli));
  if cardinality(v_pf) <> 4 then raise exception 'projetos_financeiro: % (esperado 4)', cardinality(v_pf); end if;

  -- Só a conta sem cartão: a "ZZ Teste Empresa Teste" fica (ver o topo).
  v_conta := array(select id from public.contas_bancarias
                    where tenant_id = v_p and empresa_id = any(v_emp) and cartao_credito_id is null);
  if cardinality(v_conta) <> 1 then raise exception 'contas_bancarias: % (esperado 1)', cardinality(v_conta); end if;
  v_linha := array(select id from public.extrato_linhas where tenant_id = v_p and conta_bancaria_id = any(v_conta));
  if cardinality(v_linha) <> 18 then raise exception 'extrato_linhas: % (esperado 18)', cardinality(v_linha); end if;

  v_estab := array(select id from public.fiscal_estabelecimentos where tenant_id = v_p and empresa_contabil_id = any(v_ec));
  if cardinality(v_estab) <> 2 then raise exception 'fiscal_estabelecimentos: % (esperado 2)', cardinality(v_estab); end if;
  v_imp := array(select id from public.impostos_a_pagar where tenant_id = v_p and empresa_contabil_id = any(v_ec));
  if cardinality(v_imp) <> 1 then raise exception 'impostos_a_pagar: % (esperado 1)', cardinality(v_imp); end if;

  v_lote := array(select id from public.envios_faturamento_lote where tenant_id = v_p and empresa_id = any(v_emp));
  if cardinality(v_lote) <> 1 then raise exception 'envios_faturamento_lote: % (esperado 1)', cardinality(v_lote); end if;
  v_save := array(select id from public.saves_avulsos where tenant_id = v_p and empresa_id = any(v_emp));
  if cardinality(v_save) <> 1 then raise exception 'saves_avulsos: % (esperado 1)', cardinality(v_save); end if;

  -- ---- faturamento ----
  update public.faturamentos
     set tenant_id = v_s,
         anexo_nf_path = case when anexo_nf_path like v_pre_p || '%'
                              then v_pre_s || substring(anexo_nf_path from length(v_pre_p) + 1)
                              else anexo_nf_path end
   where id = any(v_fat);
  get diagnostics v_n = row_count; if v_n <> 16 then raise exception 'faturamentos: % (esperado 16)', v_n; end if;

  update public.faturamento_itens set tenant_id = v_s where tenant_id = v_p and faturamento_id = any(v_fat);
  get diagnostics v_n = row_count; if v_n <> 20 then raise exception 'faturamento_itens: % (esperado 20)', v_n; end if;

  update public.faturamentos_regionais set tenant_id = v_s where tenant_id = v_p and faturamento_id = any(v_fat);
  get diagnostics v_n = row_count; if v_n <> 3 then raise exception 'faturamentos_regionais: % (esperado 3)', v_n; end if;

  update public.titulos_receber set tenant_id = v_s where id = any(v_tit);
  get diagnostics v_n = row_count; if v_n <> 19 then raise exception 'titulos_receber: % (esperado 19)', v_n; end if;

  update public.envios_faturamento_lote set tenant_id = v_s where id = any(v_lote);
  update public.envios_faturamento_lote_notas set tenant_id = v_s where tenant_id = v_p and lote_id = any(v_lote);
  get diagnostics v_n = row_count; if v_n <> 2 then raise exception 'envios_faturamento_lote_notas: % (esperado 2)', v_n; end if;

  update public.saves_avulsos set tenant_id = v_s where id = any(v_save);
  update public.saves_consumos set tenant_id = v_s
   where tenant_id = v_p
     and (save_avulso_id = any(v_save)
          or item_versao_id in (select id from public.versoes_orcamento_itens where tenant_id = v_s));
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'saves_consumos: % (esperado 1)', v_n; end if;

  update public.faturamentos_po_anexos
     set tenant_id = v_s,
         path = case when path like v_pre_p || '%'
                     then v_pre_s || substring(path from length(v_pre_p) + 1) else path end
   where tenant_id = v_p
     and faturamento_po_id in (select id from public.faturamentos_po where tenant_id = v_s);
  get diagnostics v_n = row_count; if v_n <> 2 then raise exception 'faturamentos_po_anexos: % (esperado 2)', v_n; end if;

  -- ---- projetos do financeiro e códigos ----
  update public.projetos_financeiro set tenant_id = v_s where id = any(v_pf);
  update public.codigos_de_projeto_financeiro_usados set tenant_id = v_s
   where tenant_id = v_p and projeto_financeiro_id = any(v_pf);
  get diagnostics v_n = row_count; if v_n <> 10 then raise exception 'codigos_de_projeto_financeiro_usados: % (esperado 10)', v_n; end if;

  update public.codigos_de_orcamento_usados set tenant_id = v_s
   where tenant_id = v_p and projeto_id in (select id from public.projetos where tenant_id = v_s);
  get diagnostics v_n = row_count; if v_n <> 12 then raise exception 'codigos_de_orcamento_usados: % (esperado 12)', v_n; end if;

  -- ---- "Conta Teste" e o extrato dela ----
  update public.contas_bancarias set tenant_id = v_s where id = any(v_conta);
  update public.extrato_importacoes set tenant_id = v_s where tenant_id = v_p and conta_bancaria_id = any(v_conta);
  get diagnostics v_n = row_count; if v_n <> 4 then raise exception 'extrato_importacoes: % (esperado 4)', v_n; end if;
  update public.extrato_linhas set tenant_id = v_s where id = any(v_linha);
  update public.extrato_regras set tenant_id = v_s
   where tenant_id = v_p and (conta_bancaria_id = any(v_conta) or empresa_id = any(v_emp));
  get diagnostics v_n = row_count; if v_n <> 2 then raise exception 'extrato_regras: % (esperado 2)', v_n; end if;
  update public.baixa_correcoes set tenant_id = v_s where tenant_id = v_p and extrato_linha_id = any(v_linha);
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'baixa_correcoes: % (esperado 1)', v_n; end if;

  -- ---- fiscal dos CNPJs de teste ----
  update public.fiscal_estabelecimentos set tenant_id = v_s where id = any(v_estab);
  update public.impostos_a_pagar
     set tenant_id = v_s,
         guia_path = case when guia_path like v_pre_p || '%'
                          then v_pre_s || substring(guia_path from length(v_pre_p) + 1) else guia_path end,
         comprovante_path = case when comprovante_path like v_pre_p || '%'
                                 then v_pre_s || substring(comprovante_path from length(v_pre_p) + 1) else comprovante_path end
   where id = any(v_imp);
  update public.fiscal_cnaes set tenant_id = v_s where tenant_id = v_p and estabelecimento_id = any(v_estab);
  get diagnostics v_n = row_count; if v_n <> 25 then raise exception 'fiscal_cnaes: % (esperado 25)', v_n; end if;
  update public.fiscal_cnpj_da_pp_por_regional set tenant_id = v_s
   where tenant_id = v_p
     and (estabelecimento_id = any(v_estab)
          or regional_id in (select id from public.regionais where tenant_id = v_s));
  get diagnostics v_n = row_count; if v_n <> 3 then raise exception 'fiscal_cnpj_da_pp_por_regional: % (esperado 3)', v_n; end if;
  update public.notas_fiscais_fornecedor set tenant_id = v_s where tenant_id = v_p and tomador_estabelecimento_id = any(v_estab);
  get diagnostics v_n = row_count; if v_n <> 5 then raise exception 'notas_fiscais_fornecedor: % (esperado 5)', v_n; end if;
  update public.fiscal_regimes set tenant_id = v_s where tenant_id = v_p and empresa_contabil_id = any(v_ec);
  get diagnostics v_n = row_count; if v_n <> 2 then raise exception 'fiscal_regimes: % (esperado 2)', v_n; end if;
  update public.fiscal_aprovacoes
     set tenant_id = v_s,
         guia_path = case when guia_path like v_pre_p || '%'
                          then v_pre_s || substring(guia_path from length(v_pre_p) + 1) else guia_path end
   where tenant_id = v_p and empresa_contabil_id = any(v_ec);
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'fiscal_aprovacoes: % (esperado 1)', v_n; end if;
  update public.impostos_a_pagar_rateio set tenant_id = v_s where tenant_id = v_p and imposto_a_pagar_id = any(v_imp);
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'impostos_a_pagar_rateio: % (esperado 1)', v_n; end if;

  -- ---- anexos de PP a emitir (o arquivo já está na pasta do Sandbox) ----
  update public.pedidos_compra_a_emitir_anexos
     set tenant_id = v_s,
         arquivo_path = case when arquivo_path like v_pre_p || '%'
                             then v_pre_s || substring(arquivo_path from length(v_pre_p) + 1) else arquivo_path end
   where tenant_id = v_p
     and a_emitir_id in (select id from public.pedidos_compra_a_emitir where tenant_id = v_s);
  get diagnostics v_n = row_count; if v_n <> 17 then raise exception 'pedidos_compra_a_emitir_anexos: % (esperado 17)', v_n; end if;

  -- ---- vínculos de usuário da produção com a Empresa Teste ----
  delete from public.empresa_members where tenant_id = v_p and empresa_id = any(v_emp);
  get diagnostics v_n = row_count; if v_n <> 88 then raise exception 'empresa_members: % (esperado 88)', v_n; end if;

  raise notice 'Sobras da Empresa Teste movidas para o Sandbox.';
end $$;
