"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { linhaFolhaSchema } from "@/lib/validations/rh-folhas";
import type { TipoContratacao } from "@/lib/types";

type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/** Último dia do mês (formato ISO YYYY-MM-DD). */
function ultimoDiaDoMes(ano: number, mes: number): string {
  const d = new Date(ano, mes, 0);
  return `${ano}-${String(mes).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Mapeia tipo de contratação → código do subtipo de "Despesa com Pessoal". */
function subtipoCodigoParaContratacao(tipo: TipoContratacao): string {
  switch (tipo) {
    case "clt":
    case "clt_recibo":
      return "001"; // Salário
    case "estagio":
      return "005"; // Estagiário
    case "pj":
    case "mei":
      return "011"; // ProLabore
  }
}

/**
 * Reprova uma linha de folha. Devolve pro RH com motivo.
 * Status: enviada → pendente_correcao.
 */
export async function reprovarLinhaFolha(
  folhaId: string,
  motivo: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.folhas.aprovar_financeiro");
  if (!gate.ok) return gate;

  const motivoLimpo = (motivo ?? "").trim();
  if (motivoLimpo.length < 3) {
    return {
      ok: false,
      message: "Escreva o motivo da pendência (mínimo 3 caracteres).",
    };
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: folha, error: folhaError } = await supabase
    .from("folhas_pagamento")
    .select("id, status, competencia_ano, competencia_mes, colaborador_id")
    .eq("id", folhaId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (folhaError || !folha) {
    return { ok: false, message: "Linha da folha não encontrada." };
  }
  if (folha.status !== "enviada") {
    return {
      ok: false,
      message: `Linha em status "${folha.status}" não pode ser reprovada agora.`,
    };
  }

  const { error: upError } = await supabase
    .from("folhas_pagamento")
    .update({
      status: "pendente_correcao",
      motivo_pendencia: motivoLimpo,
      reprovada_em: new Date().toISOString(),
      reprovada_por: session.profile.id,
    })
    .eq("id", folhaId);
  if (upError) {
    console.error("[folha.reprovar]", upError.message);
    return { ok: false, message: "Não foi possível reprovar." };
  }

  await logAuditEvent({
    acao: "folha.linha.reprovada",
    tenantId,
    entidadeTipo: "folha",
    entidadeId: folhaId,
    metadata: {
      colaborador_id: folha.colaborador_id,
      competencia: `${folha.competencia_ano}-${String(folha.competencia_mes).padStart(2, "0")}`,
      motivo: motivoLimpo,
    },
  });

  const chave = `${folha.competencia_ano}-${String(folha.competencia_mes).padStart(2, "0")}`;
  revalidatePath("/rh");
  revalidatePath("/rh/folhas");
  revalidatePath(`/rh/folhas/${chave}`);
  revalidatePath("/financeiro/contas-a-pagar");
  return { ok: true, id: folhaId };
}

/**
 * Aprova uma linha de folha. Se `edicoes` for informado, aplica antes
 * de aprovar (financeiro pode ajustar valor e alocação). Ao aprovar:
 *
 *   1. Aplica edições (valor + alocações via swap com constraint trigger)
 *   2. Cria N contas_avulsas rateadas por percentual da alocação
 *   3. Propaga edições pra Camada 1 se houve alteração
 *   4. Muda status para 'aprovada'
 *
 * Ver docs/decisions/097-folha-mensal-em-duas-camadas.md.
 */
export async function aprovarLinhaFolha(
  folhaId: string,
  edicoes?: {
    salario_base: string;
    alocacoes: {
      empresa_id: string;
      regional_id: string;
      percentual: string;
    }[];
  },
): Promise<
  ActionResult<{ contas_criadas: number; propagou_camada_1: boolean }>
> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.folhas.aprovar_financeiro");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // 1) Confirma linha em status=enviada
  const { data: folha, error: folhaError } = await supabase
    .from("folhas_pagamento")
    .select(
      "id, status, salario_base, colaborador_id, competencia_ano, competencia_mes",
    )
    .eq("id", folhaId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (folhaError || !folha) {
    return { ok: false, message: "Linha da folha não encontrada." };
  }
  if (folha.status !== "enviada") {
    return {
      ok: false,
      message: `Linha em status "${folha.status}" não pode ser aprovada agora.`,
    };
  }

  // 2) Aplica edições (se houve)
  let houveEdicao = false;
  let salarioFinal = String(folha.salario_base);
  let alocacoesFinal: {
    empresa_id: string;
    regional_id: string;
    percentual: string;
  }[] = [];

  if (edicoes) {
    const parsed = linhaFolhaSchema.safeParse(edicoes);
    if (!parsed.success) {
      return {
        ok: false,
        message: "Edições inválidas.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      };
    }

    // Detecta mudança de valor
    if (parsed.data.salario_base !== String(folha.salario_base)) {
      houveEdicao = true;
    }

    // Compara alocações existentes com as novas
    const { data: alocAtuais } = await supabase
      .from("folhas_pagamento_alocacoes")
      .select("empresa_id, regional_id, percentual")
      .eq("folha_id", folhaId);

    const setAtual = new Set(
      ((alocAtuais ?? []) as any[]).map(
        (a) => `${a.empresa_id}|${a.regional_id}|${String(a.percentual)}`,
      ),
    );
    const setNovo = new Set(
      parsed.data.alocacoes.map(
        (a) => `${a.empresa_id}|${a.regional_id}|${a.percentual}`,
      ),
    );
    if (
      setAtual.size !== setNovo.size ||
      [...setAtual].some((k) => !setNovo.has(k))
    ) {
      houveEdicao = true;
    }

    salarioFinal = parsed.data.salario_base;
    alocacoesFinal = parsed.data.alocacoes;

    if (houveEdicao) {
      // Aplica edições na folha
      const { error: upFolhaError } = await supabase
        .from("folhas_pagamento")
        .update({ salario_base: parsed.data.salario_base })
        .eq("id", folhaId);
      if (upFolhaError) {
        console.error("[folha.aprovar.up_folha]", upFolhaError.message);
        return { ok: false, message: "Falha ao aplicar edição." };
      }

      // Swap das alocações
      const { error: delAlocError } = await supabase
        .from("folhas_pagamento_alocacoes")
        .delete()
        .eq("folha_id", folhaId);
      if (delAlocError) {
        console.error("[folha.aprovar.del_aloc]", delAlocError.message);
        return { ok: false, message: "Falha ao substituir alocações." };
      }

      const linhasAloc = parsed.data.alocacoes.map((a) => ({
        tenant_id: tenantId,
        folha_id: folhaId,
        empresa_id: a.empresa_id,
        regional_id: a.regional_id,
        percentual: a.percentual,
      }));

      const { error: insAlocError } = await supabase
        .from("folhas_pagamento_alocacoes")
        .insert(linhasAloc);
      if (insAlocError) {
        console.error("[folha.aprovar.ins_aloc]", insAlocError.message);
        if (insAlocError.message.includes("Rateio de alocacoes")) {
          return {
            ok: false,
            message:
              "A soma dos percentuais das alocações precisa dar 100.",
          };
        }
        return { ok: false, message: "Falha ao gravar alocações." };
      }

      await logAuditEvent({
        acao: "folha.linha.editada_financeiro",
        tenantId,
        entidadeTipo: "folha",
        entidadeId: folhaId,
        metadata: {
          colaborador_id: folha.colaborador_id,
          salario_anterior: String(folha.salario_base),
          salario_novo: parsed.data.salario_base,
          alocacoes_novas: parsed.data.alocacoes,
        },
      });
    } else {
      alocacoesFinal = parsed.data.alocacoes;
    }
  }

  // 3) Se não teve edições, carrega as alocações do snapshot
  if (alocacoesFinal.length === 0) {
    const { data } = await supabase
      .from("folhas_pagamento_alocacoes")
      .select("empresa_id, regional_id, percentual")
      .eq("folha_id", folhaId);
    alocacoesFinal = ((data ?? []) as any[]).map((a) => ({
      empresa_id: a.empresa_id,
      regional_id: a.regional_id,
      percentual: String(a.percentual),
    }));
  }

  // 4) Carrega colaborador (nome + tipo_contratacao) pra gerar contas_avulsas.
  // O destinatário do pagamento é o próprio colaborador (contas_avulsas.colaborador_id),
  // não mais um fornecedor sombra — ver ADR 001/002 do módulo pgto-remessa.
  const { data: colab, error: colabError } = await supabase
    .from("colaboradores")
    .select("id, nome, tipo_contratacao")
    .eq("id", folha.colaborador_id)
    .maybeSingle();
  if (colabError || !colab) {
    return { ok: false, message: "Colaborador não encontrado." };
  }

  // 5) Descobre o plano_conta certo
  const codigoSubtipo = subtipoCodigoParaContratacao(
    colab.tipo_contratacao as TipoContratacao,
  );
  const { data: tipoRow } = await supabase
    .from("plano_contas_tipos")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("nome", "Despesa com Pessoal")
    .maybeSingle();
  if (!tipoRow) {
    return {
      ok: false,
      message: "Plano de contas 'Despesa com Pessoal' não configurado.",
    };
  }
  const { data: subtipoRow } = await supabase
    .from("plano_contas_subtipos")
    .select("id, nome")
    .eq("tipo_id", tipoRow.id)
    .eq("codigo", codigoSubtipo)
    .maybeSingle();
  if (!subtipoRow) {
    return {
      ok: false,
      message: `Subtipo ${codigoSubtipo} de Despesa com Pessoal não encontrado.`,
    };
  }

  // 6) Idempotência: se já existem contas_avulsas pra essa folha, não recria
  const { data: contasExistentes } = await supabase
    .from("contas_avulsas")
    .select("id")
    .eq("folha_id", folhaId);
  if ((contasExistentes ?? []).length > 0) {
    return {
      ok: false,
      message:
        "Esta linha já tem contas a pagar geradas. Estorne antes de reaprovar.",
    };
  }

  // 7) Gera contas_avulsas — uma por alocação, valor rateado
  const dataPrevistaPagamento = ultimoDiaDoMes(
    folha.competencia_ano,
    folha.competencia_mes,
  );
  const valorTotal = Number(salarioFinal);
  const contasCriadas: string[] = [];

  for (const aloc of alocacoesFinal) {
    const pct = Number(aloc.percentual);
    // Arredonda para 2 casas
    const valor = (Math.round(valorTotal * pct) / 100).toFixed(2);

    // Gera código sequencial
    const { data: codigo, error: errCodigo } = await supabase.rpc(
      "gerar_codigo_avulsa",
      { p_tenant_id: tenantId },
    );
    if (errCodigo) {
      console.error("[folha.aprovar.codigo]", errCodigo.message);
      return { ok: false, message: "Falha ao gerar código da conta." };
    }

    const competenciaLabel = `${String(folha.competencia_mes).padStart(2, "0")}/${folha.competencia_ano}`;
    const { data: contaCriada, error: insContaError } = await supabase
      .from("contas_avulsas")
      .insert({
        tenant_id: tenantId,
        empresa_id: aloc.empresa_id,
        regional_id: aloc.regional_id,
        codigo,
        descricao: `Folha ${competenciaLabel} · ${colab.nome} · ${subtipoRow.nome}${
          alocacoesFinal.length > 1 ? ` · ${pct.toFixed(2)}%` : ""
        }`,
        valor,
        natureza: "saida",
        status: "aprovada",
        data_prevista_pagamento: dataPrevistaPagamento,
        data_pagamento: dataPrevistaPagamento,
        data_pagamento_primeira: dataPrevistaPagamento,
        plano_conta_tipo_id: tipoRow.id,
        plano_conta_subtipo_id: subtipoRow.id,
        colaborador_id: colab.id,
        folha_id: folhaId,
        parcela_numero: 1,
        parcela_total: 1,
        aprovada_em: new Date().toISOString(),
        aprovada_por: session.profile.id,
        criado_por: session.profile.id,
      })
      .select("id")
      .single();
    if (insContaError || !contaCriada) {
      console.error(
        "[folha.aprovar.ins_conta]",
        insContaError?.message ?? "sem retorno",
      );
      // Rollback: apaga contas já criadas nesta chamada
      if (contasCriadas.length > 0) {
        const service = createServiceClient();
        await service.from("contas_avulsas").delete().in("id", contasCriadas);
      }
      return {
        ok: false,
        message: "Falha ao criar título a pagar.",
      };
    }
    contasCriadas.push(contaCriada.id);
  }

  // 8) Propaga edição pra Camada 1 (D5), se houve edição
  if (houveEdicao) {
    // Fecha salário vigente + abre novo com valor aprovado
    const hoje = new Date().toISOString().slice(0, 10);
    const dataInicioNovo = new Date();
    dataInicioNovo.setDate(dataInicioNovo.getDate() + 1);
    const dataInicioNovoISO = dataInicioNovo.toISOString().slice(0, 10);

    const { data: salVigente } = await supabase
      .from("colaboradores_salarios")
      .select("id")
      .eq("colaborador_id", colab.id)
      .is("data_fim", null)
      .maybeSingle();

    if (salVigente) {
      await supabase
        .from("colaboradores_salarios")
        .update({ data_fim: hoje })
        .eq("id", salVigente.id);
    }

    const competenciaLabel = `${String(folha.competencia_mes).padStart(2, "0")}/${folha.competencia_ano}`;
    await supabase.from("colaboradores_salarios").insert({
      tenant_id: tenantId,
      colaborador_id: colab.id,
      valor: salarioFinal,
      data_inicio: dataInicioNovoISO,
      motivo: `Ajuste em folha ${competenciaLabel}`,
      aprovado_por: session.profile.id,
      created_by: session.profile.id,
    });

    // Swap das alocações vigentes
    await supabase
      .from("colaboradores_alocacoes")
      .update({ data_fim: hoje })
      .eq("colaborador_id", colab.id)
      .is("data_fim", null);

    const novasAlocs = alocacoesFinal.map((a) => ({
      tenant_id: tenantId,
      colaborador_id: colab.id,
      empresa_id: a.empresa_id,
      regional_id: a.regional_id,
      percentual: a.percentual,
      data_inicio: dataInicioNovoISO,
      motivo: `Ajuste em folha ${competenciaLabel}`,
      created_by: session.profile.id,
    }));
    await supabase.from("colaboradores_alocacoes").insert(novasAlocs);
  }

  // 9) Marca folha como aprovada
  const { error: upAprovada } = await supabase
    .from("folhas_pagamento")
    .update({
      status: "aprovada",
      aprovada_em: new Date().toISOString(),
      aprovada_por: session.profile.id,
      data_pagamento: dataPrevistaPagamento,
    })
    .eq("id", folhaId);
  if (upAprovada) {
    console.error("[folha.aprovar.up_status]", upAprovada.message);
    return { ok: false, message: "Falha ao marcar como aprovada." };
  }

  await logAuditEvent({
    acao: "folha.linha.aprovada",
    tenantId,
    entidadeTipo: "folha",
    entidadeId: folhaId,
    metadata: {
      colaborador_id: colab.id,
      competencia: `${folha.competencia_ano}-${String(folha.competencia_mes).padStart(2, "0")}`,
      valor_final: salarioFinal,
      contas_criadas: contasCriadas.length,
      propagou_camada_1: houveEdicao,
    },
  });

  const chave = `${folha.competencia_ano}-${String(folha.competencia_mes).padStart(2, "0")}`;
  revalidatePath("/rh");
  revalidatePath("/rh/folhas");
  revalidatePath(`/rh/folhas/${chave}`);
  revalidatePath("/financeiro/contas-a-pagar");
  return {
    ok: true,
    contas_criadas: contasCriadas.length,
    propagou_camada_1: houveEdicao,
  };
}
