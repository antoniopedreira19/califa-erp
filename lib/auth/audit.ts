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
  // ações reservadas para tasks futuras (registradas aqui para consistência):
  | "cliente.criado"
  | "cliente.editado"
  | "cliente.inativado"
  | "fornecedor.criado"
  | "fornecedor.editado"
  | "fornecedor.inativado"
  | "orcamento.criado"
  | "orcamento.editado"
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
  // SAVE — o crédito entre jobs (docs/decisions/028-save-entre-jobs.md).
  // Registrado porque marcar uma linha ou definir um consumo move
  // faturamento previsto e valor do job, e move dinheiro entre jobs.
  | "save.linha.marcada"
  | "save.linha.desmarcada"
  | "save.consumo.definido"
  | "save.orcamento.ligado"
  | "save.orcamento.desligado"
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
  | "cidade.criada"
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
  | "job.abertura_aprovada"
  | "job.aberto_no_financeiro"
  // Edição do registro da abertura de um job já aberto ("Editar
  // registro"). Separada de `aberto_no_financeiro` de propósito: a
  // abertura acontece uma vez, a edição quantas forem precisas, e o
  // metadata desta traz o de/para de cada campo e das duas previsões.
  // É o único lugar onde essa alteração fica registrada — decisão do
  // Tiago (20/08/2026): auditoria sim, bloco de histórico na tela não.
  | "job.registro_abertura_editado"
  // Projeto criado pela própria tela de abertura, na tabela
  // `projetos_financeiro`. Não é `projeto.criado`: aquele é o projeto da
  // produção, que nasce do orçamento e a produção enxerga.
  | "projeto_financeiro.criado"
  | "job.abertura_rejeitada"
  | "job.reenviado_para_aprovacao"
  | "job.realizado_atualizado"
  | "job.errata_registrada"
  | "job.enviado_para_faturamento"
  | "job.encerrado"
  | "cliente_portal.criado"
  | "cliente_portal.editado"
  | "cliente_portal.removido"
  | "pedido_compra.emitida"
  | "pedido_compra.cancelada"
  | "pedido_compra.prazo_financeiro_atualizado"
  | "pedido_compra.paga"
  | "pedido_compra.rejeitada"
  | "pedido_compra.reenviada"
  | "pedido_compra.aprovada"
  | "pedido_compra.desaprovada"
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
  | "plano_conta_tipo.criado"
  | "plano_conta_tipo.atualizado"
  | "plano_conta_tipo.inativado"
  | "plano_conta_tipo.reativado"
  | "plano_conta_subtipo.criado"
  | "plano_conta_subtipo.atualizado"
  | "plano_conta_subtipo.inativado"
  | "plano_conta_subtipo.reativado"
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
  | "pp_verba_devolucao.baixada"
  | "pp_verba_devolucao.baixa_estornada"
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
