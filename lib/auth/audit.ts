import { createClient } from "@/lib/supabase/server";

export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "auth.login_negado"
  | "auth.senha_alterada"
  | "usuario.convidado"
  | "usuario.membership_criada"
  | "usuario.membership_atualizada"
  | "usuario.reenvio_convite"
  | "usuario.papel_alterado"
  | "tenant_member.status_alterado"
  // ações reservadas para tasks futuras (registradas aqui para consistência):
  | "cliente.criado"
  | "cliente.editado"
  | "cliente.inativado"
  | "fornecedor.criado"
  | "fornecedor.editado"
  | "fornecedor.inativado"
  | "orcamento.criado"
  | "orcamento.editado"
  | "orcamento.arquivado"
  | "orcamento.reativado"
  // Exclusão do orçamento completamente vazio (decisão 148, entrega 2).
  // Gravada pela função do banco `excluir_orcamento_vazio`, na mesma
  // transação do DELETE; o metadata guarda código, nome e projeto.
  | "orcamento.excluido"
  | "projeto.criado"
  | "projeto.atualizado"
  | "projeto.arquivado"
  | "projeto.reativado"
  | "versao_orcamento.criada"
  | "versao_orcamento.editada"
  | "versao_orcamento.importada"
  // Importação que SUBSTITUI o conteúdo de uma versão existente, apagando
  // grupos, itens e os BVs deles. Separada de `importada` de propósito: a
  // outra só cria, esta destrói antes de criar, e a auditoria precisa
  // distinguir as duas ao reconstituir o que aconteceu com uma versão.
  | "versao_orcamento.sobrescrita_por_importacao"
  | "versao_orcamento.aprovada"
  | "versao_orcamento.aprovacao_cancelada"
  // Apaga a linha de verdade — grupos, itens e BVs vão junto. Substituiu
  // o "cancelar versão" em 21/08/2026: marcar a versão como cancelada e
  // deixá-la navegável não resolvia nada que simplesmente não aprová-la já
  // não resolvesse. Como o registro deixa de existir, o metadata guarda o
  // que ele era.
  | "versao_orcamento.deletada"
  // Remoção de um agrupamento da planilha da versão. Desde 04/09/2026 ela
  // leva os itens do grupo junto, então o metadata guarda quantos foram —
  // é o único rastro de que aquelas linhas existiram.
  | "grupo_orcamento.removido"
  // Modelo mensal — Fee e Always On (decisão 078). Apagar um mês leva
  // grupos e itens junto; o metadata guarda quantos, e o período que o
  // orçamento passou a ter.
  | "versao_orcamento.mes_adicionado"
  | "versao_orcamento.mes_removido"
  | "versao_orcamento.mes_copiado"
  // Troca de categoria que entra ou sai do modelo mensal: muda a estrutura
  // de todas as versões, e saindo apaga os meses depois do primeiro.
  | "orcamento.modelo_planilha_trocado"
  // Mídia Off (decisão 147). Trocar o meio apaga as linhas dele em todos
  // os meses; remover o meio de um mês apaga as linhas do mês. O metadata
  // guarda quantas — é o único rastro delas.
  | "versao_orcamento.midia_meio_editado"
  | "versao_orcamento.midia_meio_removido"
  // O fornecedor marcado como veículo de mídia, com os meios que vende.
  | "veiculo_midia.criado"
  // Decisão 105: o orçamento passou para o serviço Interno e as linhas
  // viraram F · Interno, com o planejado igual ao orçado.
  | "orcamento.virou_interno"
  // SAVE — o crédito entre jobs (docs/decisions/028-save-entre-jobs.md).
  // Registrado porque marcar uma linha ou definir um consumo move
  // faturamento previsto e valor do job, e move dinheiro entre jobs.
  | "save.linha.marcada"
  | "save.linha.desmarcada"
  | "save.consumo.definido"
  | "save.orcamento.ligado"
  | "save.orcamento.desligado"
  // O save do orçamento INTEIRO (decisão 154): substitui a chave de cima,
  // que fica na lista pelos eventos já gravados.
  | "save.orcamento.gerar_tudo"
  | "save.orcamento.consumir_tudo"
  | "save.orcamento.retirar_tudo"
  // Aprovação de save (decisão 099): cada linha que gera ou consome save
  // vira um pedido que o financeiro decide.
  | "save.pedido.enviado"
  | "save.pedido.aprovado"
  | "save.pedido.recusado"
  | "save.pedido.cancelado"
  | "save.pedido.arquivado"
  | "save.retirado"
  | "item_bv.lancado"
  | "item_bv.editado"
  | "item_bv.confirmado"
  | "item_bv.cancelado"
  | "categoria.criada"
  | "categoria.editada"
  | "categoria.inativada"
  | "categoria.reativada"
  | "regional.criada"
  | "regional.editada"
  | "regional.inativada"
  | "regional.reativada"
  | "empresa.criada"
  | "empresa.atualizada"
  | "empresa.principal_alterada"
  | "empresa.desativada"
  | "empresa.reativada"
  | "empresa_member.criado"
  | "empresa_member.atualizado"
  | "empresa_member.removido"
  | "empresa_member.status_alterado"
  | "cidade.criada"
  | "cidade.criada_inline_ibge"
  | "cidade.editada"
  | "cidade.inativada"
  | "cidade.reativada"
  | "cliente_produto.criado"
  | "cliente_produto.editado"
  | "cliente_produto.inativado"
  | "cliente_produto.reativado"
  | "categoria_dominio.criada"
  | "categoria_dominio.editada"
  | "categoria_dominio.inativada"
  | "categoria_dominio.reativada"
  | "job.criado"
  | "job.enviado_para_abertura"
  | "job.atualizado"
  | "job.hierarquia_alterada"
  | "job.status_alterado"
  // O código do job trocou de formato (decisão 114): JOB-NNNN virou
  // [SIGLA]-[SEQ]/[AA]. Gravado pela migration, um evento por job, com o
  // código anterior e o novo no metadata.
  | "job.codigo_trocado"
  // Decisão 114: a troca de código dos projetos e orçamentos (P) e dos
  // projetos do financeiro (F). Só a migration grava estes.
  | "projeto.codigo_trocado"
  | "orcamento.codigo_trocado"
  | "projeto_financeiro.codigo_trocado"
  | "job.abertura_aprovada"
  | "job.aberto_no_financeiro"
  // Edição do registro da abertura de um job já aberto ("Editar
  // registro"). Separada de `aberto_no_financeiro` de propósito: a
  // abertura acontece uma vez, a edição quantas forem precisas, e o
  // metadata desta traz o de/para de cada campo e das duas previsões.
  // É o único lugar onde essa alteração fica registrada — decisão do
  // Tiago (20/08/2026): auditoria sim, bloco de histórico na tela não.
  | "job.registro_abertura_editado"
  // "Registrar revisão de abertura" — a mesma gravação da edição, mas
  // depois de uma errata devolver o job ao mural (decisão 059). Separada
  // porque ela fecha a revisão (`abertura_em_revisao`) e libera o envio de
  // PP e o faturamento; o metadata traz o de/para e a errata.
  | "job.abertura_revisada"
  // Projeto criado pela própria tela de abertura, na tabela
  // `projetos_financeiro`. Não é `projeto.criado`: aquele é o projeto da
  // produção, que nasce do orçamento e a produção enxerga. Desde a decisão
  // 119 (28/09/2026) ele nasce na abertura ou no "Salvar registro", junto
  // com o job — o metadata diz em qual (`na`).
  | "projeto_financeiro.criado"
  // O lápis do campo Projeto: de/para do nome (decisão 119).
  | "projeto_financeiro.renomeado"
  // Projeto que ficou sem job, apagado pelo banco — na limpeza da
  // migration ou pelo gatilho quando o último job troca de projeto. Só o
  // banco grava este (decisão 119).
  | "projeto_financeiro.apagado_sem_job"
  | "job.abertura_rejeitada"
  // Reenvio depois da rejeição: o MESMO job volta a `aguardando_abertura`
  // com os campos do formulário refeitos (decisão 057). Até 08/09/2026 a
  // action só trocava o status, a partir da página do job.
  | "job.reenviado_para_aprovacao"
  // Cancelar o envio pelo orçamento, antes de o financeiro abrir: o job
  // vai a `cancelado` e o orçamento volta a `aprovado` (decisão 057).
  | "job.envio_abertura_cancelado"
  // Decisão 143: as PPs que travavam esse cancelamento (ou o "Cancelar
  // aprovação" do job devolvido), canceladas de dentro do pop-up. Cada PP
  // tem também o seu `pedido_compra.cancelada`.
  | "job.pps_canceladas_no_cancelamento_do_envio"
  // Decisão 128: o envio depois do "Cancelar aprovação" da devolução volta
  // com o código do job cancelado; e o planejado da versão aprovada se
  // corrige com o job devolvido, na versão e na cópia do job.
  | "job.codigo_reaproveitado"
  | "item_versao.planejado_corrigido_na_devolucao"
  | "job.realizado_atualizado"
  | "job.errata_registrada"
  // "Editar orçado" do financeiro (decisão 115): os valores do orçado, sem
  // aprovação, com as previsões e o envio sem nota acompanhando.
  | "job.orcado_alterado_financeiro"
  | "job.enviado_para_faturamento"
  // Decisão 123: a lista de contatos de cobrança trocada no envio.
  | "job.contatos_cobranca_alterados"
  | "job.encerrado"
  | "job.finalizado"
  | "cliente_portal.criado"
  | "cliente_portal.editado"
  | "cliente_portal.removido"
  // O marco "todas as PPs deste item já foram geradas" (decisão 052).
  // Registrado porque ele MOVE DINHEIRO na previsão: marcado, o saldo do
  // planejado sai do Cronograma de desembolsos e o item passa a valer o
  // que as PPs dizem. Reabrir devolve o saldo.
  | "item_realizado.pps_concluidas"
  | "item_realizado.pps_reabertas"
  // O mesmo marco, aplicado à planilha inteira pelo botão "Concluir PPs"
  // da barra. Um evento só, com a lista dos itens no metadata: são N
  // linhas mudando de uma vez, e o que interessa reconstituir é o lote.
  | "item_realizado.pps_concluidas_em_lote"
  | "pedido_compra.emitida"
  // 02/09/2026: gerar deixou de enviar. `gerada` é a criação, `editada` a
  // correção enquanto ainda não foi enviada, `enviada_financeiro` o envio.
  | "pedido_compra.gerada"
  | "pedido_compra.editada"
  | "pedido_compra.enviada_financeiro"
  | "pedido_compra.cancelada"
  | "pedido_compra.prazo_financeiro_atualizado"
  | "pedido_compra.paga"
  | "pedido_compra.rejeitada"
  | "pedido_compra.reenviada"
  | "pedido_compra.aprovada"
  | "pedido_compra.desaprovada"
  | "pedido_compra.reprovada"
  // 07/10/2026 (decisão 153): a PP a emitir, antes de gerar a PP.
  | "pedido_compra.a_emitir.salva"
  | "pedido_compra.a_emitir.editada"
  | "pedido_compra.a_emitir.excluida"
  | "pedido_compra.a_emitir.gerada"
  // Revisão da decisão 152 (07/10/2026): a NF da PP em avaliação corrigida
  // sem aprovar (GP, administrador ou financeiro).
  | "pedido_compra.nf_corrigida"
  // Decisão 157 (07/10/2026): a PP gerada que perdeu o prazo de envio ganha
  // vencimento novo, sem cancelar e refazer.
  | "pedido_compra.vencimento_atualizado"
  // Tela 3.2 — a baixa passou a ser da PARCELA, e a data de pagamento do
  // título virou repactuável.
  | "pedido_compra.parcela_paga"
  // 18/08/2026: o estorno acompanhou a baixa e também virou por parcela.
  // `pedido_compra.baixa_estornada` (mais abaixo) é o registro histórico
  // do estorno da PP inteira, que existiu até aqui.
  | "pedido_compra.parcela_baixa_estornada"
  | "titulo_pagar.data_repactuada"
  | "custo_c.utilizado"
  | "conta_bancaria.criada"
  | "conta_bancaria.atualizada"
  | "conta_bancaria.inativada"
  | "conta_bancaria.reativada"
  | "conta_bancaria.config_cnab_editada"
  | "cnab.remessa_gerada"
  // Arquivo de remessa cancelado antes de ir ao banco (decisão 132)
  | "cnab.remessa_cancelada"
  | "plano_conta_tipo.criado"
  | "plano_conta_tipo.atualizado"
  | "plano_conta_tipo.inativado"
  | "plano_conta_tipo.reativado"
  | "plano_conta_subtipo.criado"
  | "plano_conta_subtipo.atualizado"
  | "plano_conta_subtipo.inativado"
  | "plano_conta_subtipo.reativado"
  // Cadastro de impostos (módulo fiscal, 02/10/2026): CNPJ emissor, CNAE
  // e parâmetro mudam por linha nova com vigência; o feriado removido
  // deixa de existir, então o metadata guarda o que ele era.
  | "fiscal_estabelecimento.atualizado"
  // Decisão 156: o CNPJ que a PP já traz escolhido para a regional.
  | "fiscal_cnpj_da_pp_regional.atualizado"
  // Botão "Novo CNPJ emissor" (03/10/2026): o metadata guarda a linha criada.
  | "fiscal_estabelecimento.criado"
  | "fiscal_cnae.criado"
  | "fiscal_cnae.nova_vigencia"
  | "fiscal_feriado.criado"
  | "fiscal_feriado.removido"
  | "fiscal_parametro.nova_vigencia"
  | "fiscal_receita_anterior.registrada"
  | "lancamento_financeiro.criado"
  | "lancamento_financeiro.estornado"
  | "pedido_compra.baixa_estornada"
  | "conta_avulsa.criada"
  | "conta_avulsa.editada"
  | "conta_avulsa.excluida"
  | "conta_avulsa.baixada"
  | "conta_avulsa.baixa_estornada"
  | "conta_recorrente.criada"
  | "conta_recorrente.editada"
  | "conta_recorrente.pausada"
  | "conta_recorrente.reativada"
  | "conta_recorrente.excluida"
  | "conta_recorrente.ocorrencia_gerada"
  | "conta_avulsa.rateio_alterado"
  | "conta_recorrente.rateio_alterado"
  // Fatura de cartão (28/08/2026): fechar transforma os itens em
  // lançamentos; pagar é a transferência banco -> cartão.
  | "fatura_cartao.fechada"
  | "fatura_cartao.paga"
  | "cartao.estorno_lancado"
  | "fatura_cartao.reaberta"
  | "fatura_cartao.baixa_estornada"
  | "cartao_credito.criado"
  | "cartao_credito.atualizado"
  | "cartao_credito.inativado"
  | "cartao_credito.reativado"
  | "contas_pagar.baixa_lote_cartao"
  | "faturamento.emitido"
  | "faturamento.cancelado"
  | "titulo.baixado"
  | "titulo.baixa_estornada"
  | "titulo.previsao_repactuada"
  | "desembolso.criado"
  | "desembolso.aprovada"
  | "desembolso.rejeitada"
  | "desembolso.cancelada"
  | "desembolso.parcela_paga"
  | "desembolso.parcela_baixa_estornada"
  | "verba_producao.prestacao_fechada"
  | "verba_producao.prestacao_enviada"
  | "verba_producao.prestacao_aprovada"
  | "verba_producao.prestacao_reprovada"
  | "pp_verba_devolucao.baixada"
  | "pp_verba_devolucao.baixa_estornada"
  | "empresa_contabil.criada"
  | "empresa_contabil.atualizada"
  | "empresa_contabil.desativada"
  | "empresa_contabil.reativada"
  // ---- Módulo RH (2026-09-16) ----
  | "nivel.criado"
  | "nivel.editado"
  | "nivel.inativado"
  | "nivel.reativado"
  | "colaborador.criado"
  | "colaborador.editado"
  | "colaborador.editado_pelo_proprio"
  | "colaborador.inativado"
  | "colaborador.reativado"
  | "colaborador.alocacao_aberta"
  | "colaborador.alocacao_fechada"
  | "colaborador.salario_mudou"
  | "colaborador.salario_corrigido"
  | "colaborador.dados_bancarios_editados"
  // Vínculo colaborador ↔ usuário (task 010, 2026-10-03)
  | "colaborador.convite_enviado"
  | "colaborador.vinculado_a_usuario"
  | "colaborador.desvinculado"
  | "colaborador.role_alterada"
  // Folha mensal (subsistema RH, 2026-09-18)
  | "folha.gerada"
  | "folha.linha.editada_rh"
  | "folha.linha.editada_financeiro"
  | "folha.linha.enviada"
  | "folha.linha.aprovada"
  | "folha.linha.reprovada"
  | "folha.linha.paga"
  // Aprovação desfeita: o título sai e a linha volta a aguardar (decisão 132)
  | "folha.linha.aprovacao_desfeita"
  // Fluxo CLT via PDF da contabilidade (folha-dois-fluxos, 2026-10-06)
  | "folha.importada"
  | "folha_competencia.enviada"
  // NF por colaborador PJ (folha-anexo-nf, 2026-10-07)
  | "colaborador.nf_anexada"
  | "colaborador.nf_removida"
  | "colaborador.nf_baixada"
  // Rateio anual por regional (2026-09-23)
  | "rateio.regional.salvo"
  | "rateio.regional.copiado"
  // Contratação (task 007, 2026-09-29)
  | "contratacao.criada"
  | "contratacao.proposta_enviada"
  | "contratacao.link_renovado"
  | "contratacao.aceita"
  | "contratacao.recusada"
  | "contratacao.dados_salvos"
  | "contratacao.contrato_gerado"
  | "contratacao.contrato_anexado"
  | "contratacao.efetivada"
  | "contratacao.desistiu"
  | "contratacao.expirada"
  // Férias — subsistema RH (2026-10-02, S4+S5)
  | "ferias.solicitacao.criada"
  | "ferias.solicitacao.cancelada_pelo_colaborador"
  | "ferias.lancamento.aprovado"
  | "ferias.lancamento.reprovado"
  | "ferias.lancamento.movido_em_analise"
  | "ferias.lancamento.cancelado_pelo_rh"
  | "ferias.lancamento.lancado_direto_pelo_rh"
  | "ferias.recibo.gerado"
  // Benefícios (RH) — Fase 1
  | "beneficio.vinculo.criado"
  | "beneficio.vinculo.modo_alterado"
  | "beneficio.vinculo.encerrado"
  | "beneficio.dependente.criado"
  | "beneficio.dependente.editado"
  | "beneficio.dependente.desativado"
  | "beneficio.dependente.incluido_em_plano"
  | "beneficio.dependente.removido_de_plano"
  | "beneficio.catalogo.criado"
  | "beneficio.catalogo.editado"
  | "beneficio.faixa.criada"
  | "beneficio.faixa.editada"
  | "beneficio.faixa.removida"
  | "acao_negada";

export interface AuditPayload {
  acao: AuditAction;
  tenantId?: string | null;
  entidadeTipo?: string | null;
  entidadeId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Grava um evento em audit_events via RPC log_audit_event.
 * A RPC roda com SECURITY DEFINER — não depende de RLS de INSERT — mas
 * exige usuário autenticado. Falhas de auditoria não devem quebrar o
 * fluxo principal (login etc), então erros são apenas logados.
 */
export async function logAuditEvent(payload: AuditPayload): Promise<void> {
  try {
    const supabase = createClient();
    const { error } = await supabase.rpc("log_audit_event", {
      p_acao: payload.acao,
      p_tenant_id: payload.tenantId ?? null,
      p_entidade_tipo: payload.entidadeTipo ?? null,
      p_entidade_id: payload.entidadeId ?? null,
      p_metadata: (payload.metadata ?? {}) as any,
    });
    if (error && process.env.NODE_ENV !== "production") {
      console.warn("[audit] falha ao gravar evento", payload.acao, error.message);
    }
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[audit] exceção ao gravar evento", err);
    }
  }
}
