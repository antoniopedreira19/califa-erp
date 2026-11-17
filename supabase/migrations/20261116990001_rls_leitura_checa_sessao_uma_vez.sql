-- Regras de leitura (RLS): a checagem de sessão roda uma vez por consulta, e não uma vez por linha.
--
-- Diagnóstico (16/11/2026, sistema lento à tarde):
--   * A máquina não estava cheia: a RPC leve get_session_context ficou em ~20 ms
--     (mediana) até nos piores 15 minutos do dia.
--   * As lentas eram leituras grandes: jobs_itens_orcado e jobs_itens_realizado
--     do tenant inteiro (7–8 s por página de 1.000 no pico), pedidos_compra e as
--     views de fluxo de caixa e rentabilidade (~3 s).
--   * Causa: as policies de SELECT chamavam is_tenant_member(tenant_id),
--     is_tenant_admin/rh/financeiro(tenant_id) e session_role() SEM o (select ...).
--     Funções SECURITY DEFINER não são "inlinadas" pelo Postgres, então rodavam
--     uma vez POR LINHA, cada uma lendo tenant_members + profiles. tenant_members
--     (106 linhas) teve 317 milhões de leituras de índice desde julho.
--   * O advisor da Supabase (auth_rls_initplan) não acusa: ele só procura
--     auth.uid() direto, não funções próprias.
--
-- A troca, mecânica e só nas policies de leitura (FOR SELECT):
--   is_tenant_member(X)        -> X IN (SELECT current_tenant_ids())
--   is_tenant_admin(X)         -> X IN (SELECT current_tenant_ids_com_papel('administrador'))
--   is_tenant_rh(X)            -> X IN (SELECT current_tenant_ids_com_papel('rh'))
--   is_tenant_financeiro(X)    -> X IN (SELECT current_tenant_ids_com_papel('financeiro'))
--   session_role()             -> (SELECT session_role())
-- O subselect sem referência à linha vira InitPlan/hashed SubPlan: roda uma vez
-- por consulta. Teste em produção, página de 1.000 linhas do orçado:
-- 196 ms e 19.176 buffers -> 10 ms e 619 buffers.
--
-- Quem vê o quê NÃO muda:
--   * current_tenant_ids() já existia e filtra exatamente o mesmo que
--     is_tenant_member (vínculo ativo + perfil ativo); current_tenant_ids_com_papel
--     é o corpo de is_tenant_admin/rh/financeiro devolvendo o conjunto.
--   * Nenhuma policy negava essas funções (NOT f(...)), então o NULL de
--     "X IN (...)" com X nulo filtra igual ao false de antes.
--   * Equivalência conferida antes de aplicar: para 14 usuários (um por papel e
--     situação em cada tenant), cada policy foi avaliada linha a linha com o texto
--     antigo e o novo; zero linhas divergentes.
--   * ALTER POLICY troca só o USING: nome, comando, papéis e permissividade ficam.
--   * As policies de escrita (INSERT/UPDATE/DELETE), as de Storage e as funções
--     com argumento por linha (can_access_empresa_regional, e_colega_de_tenant,
--     is_colaborador_proprio, is_freelancer_do_projeto) ficam como estão.
--
-- lock_timeout: ALTER POLICY trava a tabela por um instante; se alguma estiver
-- ocupada, a migration falha inteira em vez de enfileirar as leituras de todos.

set local lock_timeout = '5s';


create function public.current_tenant_ids_com_papel(p_papel public.app_role)
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select tm.tenant_id
  from public.tenant_members tm
  join public.profiles p on p.id = tm.user_id
  where tm.user_id = (select auth.uid())
    and tm.status = 'ativo'
    and tm.role = p_papel
    and p.ativo = true;
$function$;

revoke all on function public.current_tenant_ids_com_papel(public.app_role) from public, anon;
grant execute on function public.current_tenant_ids_com_papel(public.app_role) to authenticated, service_role;


alter policy "audit_events_select_admin" on public."audit_events"
  using (((tenant_id IS NOT NULL) AND (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "baixa_correcoes_select" on public."baixa_correcoes"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "faixas_select" on public."beneficio_faixas_preco"
  using ((EXISTS ( SELECT 1
   FROM public.beneficios b
  WHERE ((b.id = beneficio_faixas_preco.beneficio_id) AND ((b.tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (b.tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel)) OR (EXISTS ( SELECT 1
           FROM public.colaborador_beneficio cb
          WHERE ((cb.beneficio_id = b.id) AND public.is_colaborador_proprio(cb.colaborador_id)))))))));

alter policy "sel_fechamento_linha_admin_rh" on public."beneficio_fechamento_linha"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "sel_fechamento_mensal_admin_rh" on public."beneficio_fechamento_mensal"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "beneficios_select" on public."beneficios"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel)) OR (EXISTS ( SELECT 1
   FROM public.colaborador_beneficio cb
  WHERE ((cb.beneficio_id = beneficios.id) AND public.is_colaborador_proprio(cb.colaborador_id))))));

alter policy "categorias_select" on public."categorias"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "categorias_dominio_select" on public."categorias_dominio"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "cidades_select" on public."cidades"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "cliente_portais_select" on public."cliente_portais"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "cliente_produtos_select" on public."cliente_produtos"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "clientes_select" on public."clientes"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "cnab_remessas_select" on public."cnab_remessas"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "cnab_itens_select" on public."cnab_remessas_itens"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "codigos_de_job_usados_select" on public."codigos_de_job_usados"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "codigos_de_orcamento_usados_select" on public."codigos_de_orcamento_usados"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "codigos_de_projeto_financeiro_usados_select" on public."codigos_de_projeto_financeiro_usados"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "codigos_de_projeto_usados_select" on public."codigos_de_projeto_usados"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "vinculo_select" on public."colaborador_beneficio"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel)) OR public.is_colaborador_proprio(colaborador_id)));

alter policy "cbd_select" on public."colaborador_beneficio_dependente"
  using ((EXISTS ( SELECT 1
   FROM public.colaborador_beneficio cb
  WHERE ((cb.id = colaborador_beneficio_dependente.colaborador_beneficio_id) AND ((cb.tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (cb.tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel)) OR public.is_colaborador_proprio(cb.colaborador_id))))));

alter policy "vinculos_select" on public."colaborador_vinculos"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel)) OR (EXISTS ( SELECT 1
   FROM public.colaboradores c
  WHERE ((c.id = colaborador_vinculos.colaborador_id) AND (c.user_id = ( SELECT auth.uid() AS uid)))))));

alter policy "colaboradores_select" on public."colaboradores"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "alocacoes_select" on public."colaboradores_alocacoes"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "alocacoes_itens_select" on public."colaboradores_alocacoes_itens"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "alocacoes_item_regionais_select" on public."colaboradores_alocacoes_itens_regionais"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "colaboradores_documentos_select" on public."colaboradores_documentos"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel)) OR public.colaborador_eh_do_usuario_logado(colaborador_id)));

alter policy "ferias_lancamentos_financeiro_select" on public."colaboradores_ferias_lancamentos"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)) AND (status = 'aprovado'::public.ferias_lancamento_status)));

alter policy "ferias_lancamentos_select" on public."colaboradores_ferias_lancamentos"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel)) OR public.is_colaborador_proprio(colaborador_id)));

alter policy "ferias_periodos_select" on public."colaboradores_ferias_periodos"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel)) OR public.is_colaborador_proprio(colaborador_id)));

alter policy "nf_anexos_select" on public."colaboradores_nf_anexos"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)) OR (colaborador_id IN ( SELECT colaboradores.id
   FROM public.colaboradores
  WHERE ((colaboradores.user_id = ( SELECT auth.uid() AS uid)) AND (colaboradores.tenant_id = colaboradores_nf_anexos.tenant_id))))));

alter policy "salarios_select" on public."colaboradores_salarios"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "comite_config_select" on public."comite_config"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "comite_membros_select" on public."comite_membros"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "comite_pedidos_select" on public."comite_pedidos"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND (( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role)));

alter policy "conciliacao_acertos_select" on public."conciliacao_acertos"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "conciliacao_centros_select" on public."conciliacao_centros"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "conciliacao_fechamentos_select" on public."conciliacao_fechamentos"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "avulsa_anexos_select" on public."contas_avulsas_anexos"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "avulsa_hist_select" on public."contas_avulsas_historico"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "rec_rateio_select" on public."contas_avulsas_recorrentes_regionais"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "avulsa_rateio_select" on public."contas_avulsas_regionais"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "contratacoes_select" on public."contratacoes"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "decimo_terceiro_adiantamentos_rh_admin_all_select" on public."decimo_terceiro_adiantamentos"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "decimo_terceiro_folhas_rh_admin_all_select" on public."decimo_terceiro_folhas"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "decimo_terceiro_linhas_financeiro_select" on public."decimo_terceiro_linhas"
  using ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)));

alter policy "decimo_terceiro_linhas_rh_admin_all_select" on public."decimo_terceiro_linhas"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "dependentes_select" on public."dependentes"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel)) OR public.is_colaborador_proprio(colaborador_id)));

alter policy "desembolsos_anexos_select" on public."desembolsos_anexos"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "desembolsos_parcelas_select" on public."desembolsos_parcelas"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "desembolsos_regionais_select" on public."desembolsos_regionais"
  using ((EXISTS ( SELECT 1
   FROM public.desembolsos d
  WHERE ((d.id = desembolsos_regionais.desembolso_id) AND (d.tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids))))));

alter policy "empresa_members_select_owner" on public."empresa_members"
  using (((user_id = ( SELECT auth.uid() AS uid)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "empresas_select" on public."empresas"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "rateios select" on public."empresas_rateios_regionais"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "empresas_socio_de_custos_select" on public."empresas_socio_de_custos"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "envios_lote_select" on public."envios_faturamento_lote"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "envios_lote_notas_select" on public."envios_faturamento_lote_notas"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "extrato_importacoes_select" on public."extrato_importacoes"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "extrato_linhas_select" on public."extrato_linhas"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "extrato_regras_select" on public."extrato_regras"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "faturamento_itens_select" on public."faturamento_itens"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "faturas_cartao_select" on public."faturas_cartao"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "fiscal_aprovacoes_select" on public."fiscal_aprovacoes"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "fiscal_receitas_anteriores_modify_select" on public."fiscal_receitas_anteriores"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "folha_importacoes_select" on public."folha_importacoes"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "folhas_select" on public."folhas_pagamento"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "folha_aloc_select" on public."folhas_pagamento_alocacoes"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "fornecedores_select" on public."fornecedores"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "freelancer_cargos_select" on public."freelancer_cargos"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "fch_select" on public."freelancer_contrato_historico"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "freelancer_contratos_select" on public."freelancer_contratos"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "freelancer_jobs_internos_select" on public."freelancer_jobs_internos"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "freelancer_solicitacoes_select" on public."freelancer_solicitacoes"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)) OR (solicitante_id = ( SELECT auth.uid() AS uid)))));

alter policy "freelancers_select" on public."freelancers"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "freelas_select" on public."freelas"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "historico_cargas_select" on public."historico_cargas"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "historico_jobs_select" on public."historico_jobs"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "historico_movimentos_select" on public."historico_movimentos"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "historico_notas_select" on public."historico_notas"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "historico_previsoes_datas_select" on public."historico_previsoes_datas"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "historico_rateio_regional_select" on public."historico_rateio_regional"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "historico_saldos_select" on public."historico_saldos"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "impostos_a_pagar_select" on public."impostos_a_pagar"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "impostos_a_pagar_correcoes_select" on public."impostos_a_pagar_correcoes"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "impostos_a_pagar_rateio_select" on public."impostos_a_pagar_rateio"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "itens_bv_select" on public."itens_bv"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "jobs_select" on public."jobs"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND public.can_access_empresa_regional(( SELECT auth.uid() AS uid), empresa_id, regional_id) AND
CASE ( SELECT public.session_role() AS session_role)
    WHEN 'freelancer'::public.app_role THEN public.is_freelancer_do_projeto(projeto_id)
    ELSE true
END));

alter policy "jobs_aberturas_select" on public."jobs_aberturas"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "jobs_alteracoes_financeiro_select" on public."jobs_alteracoes_financeiro"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE ((j.id = jobs_alteracoes_financeiro.job_id) AND public.is_freelancer_do_projeto(j.projeto_id)))))));

alter policy "jobs_alteracoes_financeiro_itens_select" on public."jobs_alteracoes_financeiro_itens"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM (public.jobs_alteracoes_financeiro a
     JOIN public.jobs j ON ((j.id = a.job_id)))
  WHERE ((a.id = jobs_alteracoes_financeiro_itens.alteracao_id) AND public.is_freelancer_do_projeto(j.projeto_id)))))));

alter policy "jobs_cancelamentos_select" on public."jobs_cancelamentos"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "jobs_chat_leituras_select" on public."jobs_chat_leituras"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE ((j.id = jobs_chat_leituras.job_id) AND public.is_freelancer_do_projeto(j.projeto_id)))))));

alter policy "jobs_competencias_select" on public."jobs_competencias"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "jobs_contatos_select" on public."jobs_contatos"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "jobs_custos_do_socio_select" on public."jobs_custos_do_socio"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE ((j.id = jobs_custos_do_socio.job_id) AND public.is_freelancer_do_projeto(j.projeto_id)))))));

alter policy "envio_faturamento_select" on public."jobs_envio_faturamento"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "envio_anexos_select" on public."jobs_envio_faturamento_anexos"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "envio_notas_select" on public."jobs_envio_faturamento_notas"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "envio_parcelas_select" on public."jobs_envio_faturamento_parcelas"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "jobs_erratas_select" on public."jobs_erratas"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE ((j.id = jobs_erratas.job_id) AND public.is_freelancer_do_projeto(j.projeto_id)))))));

alter policy "jobs_erratas_itens_select" on public."jobs_erratas_itens"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM (public.jobs_erratas e
     JOIN public.jobs j ON ((j.id = e.job_id)))
  WHERE ((e.id = jobs_erratas_itens.errata_id) AND public.is_freelancer_do_projeto(j.projeto_id)))))));

alter policy "jobs_erratas_prontas_select" on public."jobs_erratas_prontas"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND (( SELECT public.session_role() AS session_role) = ANY (ARRAY['administrador'::public.app_role, 'gerente_producao'::public.app_role, 'produtor'::public.app_role]))));

alter policy "jobs_grupos_select" on public."jobs_grupos"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE ((j.id = jobs_grupos.job_id) AND public.is_freelancer_do_projeto(j.projeto_id)))))));

alter policy "jobs_itens_orcado_select" on public."jobs_itens_orcado"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE ((j.id = jobs_itens_orcado.job_id) AND public.is_freelancer_do_projeto(j.projeto_id)))))));

alter policy "jobs_realizado_select" on public."jobs_itens_realizado"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE ((j.id = jobs_itens_realizado.job_id) AND public.is_freelancer_do_projeto(j.projeto_id)))))));

alter policy "jobs_mensagens_select" on public."jobs_mensagens"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE ((j.id = jobs_mensagens.job_id) AND public.is_freelancer_do_projeto(j.projeto_id)))))));

alter policy "jobs_pagamentos_atrasados_select" on public."jobs_pagamentos_atrasados"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE ((j.id = jobs_pagamentos_atrasados.job_id) AND public.is_freelancer_do_projeto(j.projeto_id)))))));

alter policy "jobs_parametros_select" on public."jobs_parametros"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE ((j.id = jobs_parametros.job_id) AND public.is_freelancer_do_projeto(j.projeto_id)))))));

alter policy "jobs_previsao_custo_select" on public."jobs_previsao_custo"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "jobs_previsao_impostos_select" on public."jobs_previsao_impostos"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "jobs_previsao_recebimento_select" on public."jobs_previsao_recebimento"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "jobs_trocas_de_responsavel_select" on public."jobs_trocas_de_responsavel"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND (EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE (j.id = jobs_trocas_de_responsavel.job_id)))));

alter policy "lancamentos_select" on public."lancamentos_financeiros"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND (public.can_access_empresa_regional(( SELECT auth.uid() AS uid), empresa_id, regional_id) OR ((empresa_id IS NULL) AND (transferencia_id IS NOT NULL) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))) OR ((empresa_id IS NULL) AND (origem = 'devolucao_bancaria'::public.origem_lancamento) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))))));

alter policy "mutuos_iof_select" on public."mutuos_iof"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "mutuos_iof_historico_select" on public."mutuos_iof_historico"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "mutuos_saldo_abertura_select" on public."mutuos_saldo_abertura"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "nf_extracao_cache_select" on public."nf_extracao_cache"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "niveis_select" on public."niveis"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "notas_fiscais_fornecedor_select" on public."notas_fiscais_fornecedor"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND (( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role)));

alter policy "notificacoes_dismissed_select" on public."notificacoes_dismissed"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "importacoes_select" on public."orcamento_importacoes"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "orcamentos_select" on public."orcamentos"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND public.can_access_empresa_regional(( SELECT auth.uid() AS uid), empresa_id, regional_id) AND
CASE ( SELECT public.session_role() AS session_role)
    WHEN 'freelancer'::public.app_role THEN public.is_freelancer_do_projeto(projeto_id)
    ELSE true
END));

alter policy "pp_select" on public."pedidos_compra"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND public.can_access_empresa_regional(( SELECT auth.uid() AS uid), empresa_id, NULL::uuid) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE ((j.id = pedidos_compra.job_id) AND public.is_freelancer_do_projeto(j.projeto_id)))))));

alter policy "ppae_select" on public."pedidos_compra_a_emitir"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND public.can_access_empresa_regional(( SELECT auth.uid() AS uid), empresa_id, NULL::uuid) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE ((j.id = pedidos_compra_a_emitir.job_id) AND public.is_freelancer_do_projeto(j.projeto_id)))))));

alter policy "pp_anexos_select" on public."pedidos_compra_anexos"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM (public.pedidos_compra pp
     JOIN public.jobs j ON ((j.id = pp.job_id)))
  WHERE ((pp.id = pedidos_compra_anexos.pedido_compra_id) AND public.is_freelancer_do_projeto(j.projeto_id)))))));

alter policy "pp_parcelas_select" on public."pedidos_compra_parcelas"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM (public.pedidos_compra pp
     JOIN public.jobs j ON ((j.id = pp.job_id)))
  WHERE ((pp.id = pedidos_compra_parcelas.pedido_compra_id) AND public.is_freelancer_do_projeto(j.projeto_id)))))));

alter policy "subtipos_select" on public."plano_contas_subtipos"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "tipos_select" on public."plano_contas_tipos"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "pp_verba_prestacoes_select" on public."pp_verba_prestacoes"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "pp_verba_prestacoes_anexos_select" on public."pp_verba_prestacoes_anexos"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "projeto_apresentacoes_select" on public."projeto_apresentacoes"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "projeto_marcas_select" on public."projeto_marcas"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "projeto_regionais_select" on public."projeto_regionais"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "projeto_responsaveis_select" on public."projeto_responsaveis"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "projetos_select" on public."projetos"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND public.can_access_empresa_regional(( SELECT auth.uid() AS uid), empresa_id, regional_id) AND
CASE ( SELECT public.session_role() AS session_role)
    WHEN 'freelancer'::public.app_role THEN public.is_freelancer_do_projeto(id)
    ELSE true
END));

alter policy "projetos_financeiro_select" on public."projetos_financeiro"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "recebimentos_antes_nf_select" on public."recebimentos_antes_nf"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "regionais_select" on public."regionais"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "saves_aprovacoes_select" on public."saves_aprovacoes"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND (EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE (j.id = saves_aprovacoes.job_id)))));

alter policy "saves_consumos_select" on public."saves_consumos"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.jobs j
  WHERE ((j.id = saves_consumos.job_origem_id) AND public.is_freelancer_do_projeto(j.projeto_id)))) OR (EXISTS ( SELECT 1
   FROM (public.jobs_itens_orcado io
     JOIN public.jobs j ON ((j.id = io.job_id)))
  WHERE ((io.id = saves_consumos.job_item_orcado_id) AND public.is_freelancer_do_projeto(j.projeto_id)))))));

alter policy "tenant_members_select" on public."tenant_members"
  using (((user_id = ( SELECT auth.uid() AS uid)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "tenant_members_select_rh_financeiro" on public."tenant_members"
  using (((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('rh'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel))));

alter policy "tenants_select" on public."tenants"
  using ((id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "transferencias_select" on public."transferencias_contas"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((tenant_id IN ( SELECT public.current_tenant_ids_com_papel('administrador'::public.app_role) AS current_tenant_ids_com_papel)) OR (tenant_id IN ( SELECT public.current_tenant_ids_com_papel('financeiro'::public.app_role) AS current_tenant_ids_com_papel)))));

alter policy "veiculos_midia_select" on public."veiculos_midia"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "versoes_select" on public."versoes_orcamento"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.orcamentos o
  WHERE ((o.id = versoes_orcamento.orcamento_id) AND public.is_freelancer_do_projeto(o.projeto_id)))))));

alter policy "grupos_select" on public."versoes_orcamento_grupos"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));

alter policy "itens_select" on public."versoes_orcamento_itens"
  using (((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)) AND ((( SELECT public.session_role() AS session_role) <> 'freelancer'::public.app_role) OR (EXISTS ( SELECT 1
   FROM (public.versoes_orcamento v
     JOIN public.orcamentos o ON ((o.id = v.orcamento_id)))
  WHERE ((v.id = versoes_orcamento_itens.versao_orcamento_id) AND public.is_freelancer_do_projeto(o.projeto_id)))))));

alter policy "versoes_orcamento_meses_select" on public."versoes_orcamento_meses"
  using ((tenant_id IN ( SELECT public.current_tenant_ids() AS current_tenant_ids)));
