"use server";

// Decisão 264 (17/11/2026): o pedido de desembolso com comprovante.
//
// - Quem pede envia o pedido com o comprovante (obrigatório) e, rejeitado,
//   corrige e reenvia com o mesmo código. O salvar é uma função só no banco
//   (`salvar_pedido_de_desembolso`): grava tudo, liga a NF ao cadastro único
//   de notas e confere o saldo dela na mesma transação.
// - O financeiro aprova (`aprovar_pedido_de_desembolso`: confere o saldo de
//   novo, marca a data, a forma e o cartão e registra a nota), rejeita ou
//   cancela. Um gatilho no banco deixa a decisão só com o financeiro.
// - Os arquivos vão para o bucket `pedidos-compra`, em `<tenant>/desembolsos/…`.

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { carregarFeriadosNacionais } from "@/lib/data/feriados-nacionais";
import {
  ehJanelaDePagamento,
  ehQuarta,
  hojeEmSaoPauloIso,
  isoParaBr,
  parcelaForaDaRegra,
  primeiraDataPossivelDoPrazo,
  primeiraJanelaComEnvioAberto,
  tipoDoPrazo,
} from "@/lib/calculos/janelas-pagamento";
import {
  salvarPedidoDeDesembolsoSchema,
  aprovarDesembolsoSchema,
  rejeitarDesembolsoSchema,
  cancelarDesembolsoSchema,
} from "@/lib/validations/desembolso";

type Result = { ok: true; id?: string } | { ok: false; message: string };

const BUCKET = "pedidos-compra";

function revalidarDesembolsos() {
  revalidatePath("/financeiro/desembolsos");
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/fluxo-caixa");
}

/** A mensagem do banco sem o prefixo técnico (o texto da exceção já é para quem usa). */
function mensagemDoBanco(msg: string): string {
  return msg.replace(/^ERROR:\s*/i, "").trim();
}

async function checarGateFinanceiro(
  entidadeTipo: string,
  entidadeId: string | null,
  acaoTentada: string,
): Promise<
  | { ok: true; session: Awaited<ReturnType<typeof requireSession>>; supabase: ReturnType<typeof createClient> }
  | { ok: false; message: string }
> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo,
      entidadeId,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return { ok: false, message: "Apenas admin ou financeiro pode executar esta ação." };
  }
  return { ok: true, session, supabase: createClient() };
}

/**
 * A data de pagamento segue a regra da PP (decisões 077, 157 e 172): janelas
 * 08 e 20 com o envio até 15 dias antes; com pagamento urgente, também a
 * quarta de exceções até a sexta anterior. A data gravada que não mudou
 * passa (o reenvio do rejeitado não precisa trocar a data que já valia).
 * Da 2ª parcela em diante: janela, pulando a logo depois da anterior.
 */
function erroDaDataDePagamento(
  datas: string[],
  gravadas: string[],
  feriados: string[],
  urgente: boolean,
): string | null {
  const hoje = hojeEmSaoPauloIso();
  const primeira = datas[0];
  if (!primeira) return "Escolha a data de pagamento.";
  if (primeira !== gravadas[0] && tipoDoPrazo(primeira, hoje, feriados, urgente) === null) {
    if (!urgente && ehQuarta(primeira) && !ehJanelaDePagamento(primeira)) {
      return `A quarta de exceções só vale para pagamento urgente. A primeira data possível hoje é ${isoParaBr(primeiraJanelaComEnvioAberto(hoje, feriados))}.`;
    }
    return `O financeiro recebe o pedido até 15 dias antes da janela (a quarta, até a sexta anterior). A primeira data possível hoje é ${isoParaBr(primeiraDataPossivelDoPrazo(hoje, feriados, urgente))}.`;
  }
  const mudouAlguma = datas.some((d, i) => d !== gravadas[i]);
  const fora = mudouAlguma ? parcelaForaDaRegra(datas) : null;
  if (fora) return `A ${fora}ª parcela está fora das janelas de pagamento.`;
  return null;
}

/** A pasta dos arquivos de um pedido novo ou em correção, no bucket da PP. */
export async function prefixoAnexosDesembolso(): Promise<{ ok: true; prefixo: string } | { ok: false; message: string }> {
  const session = await requireSession();
  return { ok: true, prefixo: `${session.activeTenant.id}/desembolsos/${crypto.randomUUID()}/` };
}

/** Envia o pedido novo ao financeiro, ou reenvia o rejeitado corrigido. */
export async function salvarPedidoDeDesembolso(
  input: unknown,
): Promise<{ ok: true; id: string; codigo: string } | { ok: false; message: string }> {
  const parsed = salvarPedidoDeDesembolsoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  const d = parsed.data;
  const session = await requireSession();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  let gravadas: string[] = [];
  let statusAnterior: string | null = null;
  if (d.id) {
    const { data: atual } = await supabase
      .from("desembolsos")
      .select("id, status, criado_por, parcelas:desembolsos_parcelas(numero, data_vencimento)")
      .eq("id", d.id)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ id: string; status: string; criado_por: string; parcelas: Array<{ numero: number; data_vencimento: string }> | null }>();
    if (!atual) return { ok: false, message: "Pedido não encontrado." };
    if (atual.criado_por !== session.profile.id) return { ok: false, message: "Só quem pediu corrige e reenvia o pedido." };
    statusAnterior = atual.status;
    gravadas = (atual.parcelas ?? []).sort((a, b) => a.numero - b.numero).map((p) => p.data_vencimento.slice(0, 10));
  }

  const feriados = await carregarFeriadosNacionais(supabase, tenantId);
  const parcelas = d.parcelas.slice().sort((a, b) => a.numero - b.numero);
  const erroData = erroDaDataDePagamento(
    parcelas.map((p) => p.data_vencimento),
    gravadas,
    feriados,
    d.urgente,
  );
  if (erroData) return { ok: false, message: erroData };
  const prefixoDoTenant = `${tenantId}/desembolsos/`;
  if (d.anexos.some((a) => !a.id && !a.path.startsWith(prefixoDoTenant))) {
    return { ok: false, message: "Caminho do anexo inválido." };
  }

  const reembolso = d.favorecido_tipo === "reembolso";
  const { data, error } = await supabase.rpc("salvar_pedido_de_desembolso", {
    p_tenant: tenantId,
    p: {
      id: d.id,
      empresa_id: d.empresa_id,
      descricao: d.descricao,
      favorecido_tipo: d.favorecido_tipo,
      fornecedor_id: reembolso ? null : d.fornecedor_id,
      valor: d.valor,
      urgente: d.urgente,
      urgente_justificativa: d.urgente ? d.urgente_justificativa : null,
      parcelas,
      rateio: d.rateio,
      anexos: d.anexos.map((a) => ({
        id: a.id,
        path: a.path,
        nome: a.nome,
        tamanho: a.tamanho,
        mimetype: a.mimetype,
        documento_tipo: a.documento_tipo,
        documento_numero: a.documento_numero,
        nf_data_emissao: a.nf_data_emissao,
        nf_valor: a.nf_valor,
        // No reembolso, a NF da compra não entra no cadastro de notas (ainda
        // em aberto com o Tiago: quem é o emitente). Sem CNPJ e sem parte.
        nf_tomador_estabelecimento_id: reembolso ? null : a.nf_tomador_estabelecimento_id,
        nf_valor_no_pedido: reembolso ? null : a.nf_valor_no_pedido,
      })),
    },
  });
  if (error) return { ok: false, message: mensagemDoBanco(error.message) };
  const linha = ((data ?? []) as Array<{ id: string; codigo: string }>)[0];
  if (!linha) return { ok: false, message: "Não foi possível gravar o pedido." };

  const reenvio = statusAnterior === "rejeitada";
  await logAuditEvent({
    acao: d.id ? (reenvio ? "desembolso.reenviado" : "desembolso.corrigido") : "desembolso.enviado",
    tenantId,
    entidadeTipo: "desembolso",
    entidadeId: linha.id,
    metadata: {
      codigo: linha.codigo,
      valor: d.valor,
      favorecido_tipo: d.favorecido_tipo,
      qtd_parcelas: parcelas.length,
      qtd_anexos: d.anexos.length,
      urgente: d.urgente,
    },
  });

  revalidarDesembolsos();
  return { ok: true, id: linha.id, codigo: linha.codigo };
}

export async function aprovarDesembolsoComData(input: unknown): Promise<Result> {
  const parsed = aprovarDesembolsoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };

  const gate = await checarGateFinanceiro("desembolso", parsed.data.desembolso_id, "desembolso.aprovada");
  if (!gate.ok) return gate;

  const { data: desembolso } = await gate.supabase
    .from("desembolsos")
    .select("id, codigo, valor, status")
    .eq("id", parsed.data.desembolso_id)
    .eq("tenant_id", gate.session.activeTenant.id)
    .maybeSingle();
  if (!desembolso) return { ok: false, message: "Desembolso não encontrado." };
  if (desembolso.status !== "em_avaliacao") {
    return { ok: false, message: "Só desembolso em avaliação pode ser aprovado." };
  }

  const forma = parsed.data.forma_pagamento ?? null;
  const cartao = forma === "cartao_credito" ? parsed.data.cartao_credito_id ?? null : null;
  const { error } = await gate.supabase.rpc("aprovar_pedido_de_desembolso", {
    p_desembolso_id: parsed.data.desembolso_id,
    p_data_pagamento: parsed.data.data_pagamento,
    p_forma_pagamento: forma,
    p_cartao_credito_id: cartao,
  });
  if (error) return { ok: false, message: mensagemDoBanco(error.message) };

  await logAuditEvent({
    acao: "desembolso.aprovada",
    tenantId: gate.session.activeTenant.id,
    entidadeTipo: "desembolso",
    entidadeId: desembolso.id,
    metadata: {
      codigo: desembolso.codigo,
      valor: Number(desembolso.valor),
      data_pagamento: parsed.data.data_pagamento,
      forma_pagamento: forma,
      cartao_credito_id: cartao,
    },
  });

  revalidarDesembolsos();
  return { ok: true };
}

export async function rejeitarDesembolso(input: unknown): Promise<Result> {
  const parsed = rejeitarDesembolsoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };

  const gate = await checarGateFinanceiro("desembolso", parsed.data.desembolso_id, "desembolso.rejeitada");
  if (!gate.ok) return gate;

  const { data: desembolso } = await gate.supabase
    .from("desembolsos")
    .select("id, codigo, status")
    .eq("id", parsed.data.desembolso_id)
    .eq("tenant_id", gate.session.activeTenant.id)
    .maybeSingle();
  if (!desembolso) return { ok: false, message: "Desembolso não encontrado." };
  if (desembolso.status !== "em_avaliacao") {
    return { ok: false, message: "Só desembolso em avaliação pode ser rejeitado." };
  }

  const { error } = await gate.supabase
    .from("desembolsos")
    .update({
      status: "rejeitada",
      motivo_rejeicao: parsed.data.motivo,
      rejeitada_por: gate.session.profile.id,
      rejeitada_em: new Date().toISOString(),
    })
    .eq("id", parsed.data.desembolso_id)
    .eq("tenant_id", gate.session.activeTenant.id);
  if (error) return { ok: false, message: `Falha ao rejeitar: ${mensagemDoBanco(error.message)}` };

  await logAuditEvent({
    acao: "desembolso.rejeitada",
    tenantId: gate.session.activeTenant.id,
    entidadeTipo: "desembolso",
    entidadeId: desembolso.id,
    metadata: { codigo: desembolso.codigo, motivo: parsed.data.motivo },
  });

  revalidarDesembolsos();
  return { ok: true };
}

/**
 * Cancela o pedido. Quem pediu cancela o próprio enquanto o financeiro não
 * decidiu (em avaliação ou rejeitado); o financeiro cancela também o
 * aprovado, antes de qualquer baixa.
 */
export async function cancelarDesembolso(input: unknown): Promise<Result> {
  const parsed = cancelarDesembolsoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  const session = await requireSession();
  const supabase = createClient();
  const financeiro = session.activeRole === "administrador" || session.activeRole === "financeiro";

  const { data: desembolso } = await supabase
    .from("desembolsos")
    .select("id, codigo, status, criado_por")
    .eq("id", parsed.data.desembolso_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!desembolso) return { ok: false, message: "Desembolso não encontrado." };

  const doProprio = desembolso.criado_por === session.profile.id;
  const podeQuemPediu = doProprio && ["em_avaliacao", "rejeitada"].includes(desembolso.status);
  const podeFinanceiro = financeiro && ["em_avaliacao", "aprovada", "rejeitada"].includes(desembolso.status);
  if (!podeQuemPediu && !podeFinanceiro) {
    if (!doProprio && !financeiro) {
      await logAuditEvent({
        acao: "acao_negada",
        tenantId: session.activeTenant.id,
        entidadeTipo: "desembolso",
        entidadeId: desembolso.id,
        metadata: { acao_tentada: "desembolso.cancelada", motivo: "nao_e_quem_pediu" },
      });
    }
    return {
      ok: false,
      message: doProprio
        ? "O financeiro já decidiu este pedido: ele não pode mais ser cancelado por aqui."
        : "Só quem pediu ou o financeiro cancela o pedido.",
    };
  }

  // Aprovado: nenhuma parcela pode ter baixa.
  if (desembolso.status === "aprovada") {
    const { count } = await supabase
      .from("desembolsos_parcelas")
      .select("id", { count: "exact", head: true })
      .eq("desembolso_id", desembolso.id)
      .not("pago_em", "is", null);
    if ((count ?? 0) > 0) {
      return { ok: false, message: "Desembolso já tem parcelas pagas — não pode ser cancelado." };
    }
  }

  const { error } = await supabase
    .from("desembolsos")
    .update({
      status: "cancelada",
      motivo_cancelamento: parsed.data.motivo,
      cancelada_por: session.profile.id,
      cancelada_em: new Date().toISOString(),
    })
    .eq("id", parsed.data.desembolso_id)
    .eq("tenant_id", session.activeTenant.id);
  if (error) return { ok: false, message: `Falha ao cancelar: ${mensagemDoBanco(error.message)}` };

  await logAuditEvent({
    acao: "desembolso.cancelada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "desembolso",
    entidadeId: desembolso.id,
    metadata: {
      codigo: desembolso.codigo,
      motivo: parsed.data.motivo,
      status_anterior: desembolso.status,
      por_quem_pediu: doProprio,
    },
  });

  revalidarDesembolsos();
  return { ok: true };
}

/** O endereço temporário de um anexo do pedido (a RLS só mostra o anexo a quem vê o pedido). */
export async function signedUrlAnexoDesembolso(
  anexoId: string,
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: anexo } = await supabase
    .from("desembolsos_anexos")
    .select("arquivo_path, tenant_id")
    .eq("id", anexoId)
    .maybeSingle();

  if (!anexo || anexo.tenant_id !== session.activeTenant.id) {
    return { ok: false, message: "Anexo não encontrado." };
  }

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(anexo.arquivo_path, 600);
  if (error || !data) return { ok: false, message: "Não foi possível abrir o anexo." };
  return { ok: true, url: data.signedUrl };
}
