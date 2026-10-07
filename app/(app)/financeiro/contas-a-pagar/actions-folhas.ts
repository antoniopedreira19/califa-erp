"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { linhaFolhaSchema } from "@/lib/validations/rh-folhas";
import {
  dadosBancariosColaboradorSchema,
  TIPOS_CHAVE_PIX,
  TIPOS_CONTA_BANCARIA,
} from "@/lib/validations/rh-colaboradores";
import { normalizarChavePix } from "@/lib/pix";
import { carregarColaboradoresPagamento } from "@/lib/financeiro/colaboradores-pagamento";
import type { FolhaOrigem, TipoContratacao } from "@/lib/types";

type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/** Último dia do mês (formato ISO YYYY-MM-DD). */
function ultimoDiaDoMes(ano: number, mes: number): string {
  const d = new Date(ano, mes, 0);
  return `${ano}-${String(mes).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Mapeia (tipo de contratação, origem da linha) → código do subtipo de
 *  "Despesa com Pessoal" (categoria 05).
 *
 *  Linhas de origem='california' (fluxo PJ gerado pela California) vão para
 *  05.015 Serviços de Terceiros (PJ) — pj, mei e a parte Recibo do híbrido.
 *
 *  Linhas de origem='contabilidade' (fluxo CLT importado do PDF) vão para
 *  os subtipos específicos: 05.001 Salário (clt / parte CLT do híbrido),
 *  05.005 Estagiário, 05.011 ProLabore (sócio).
 *
 *  Spec D6.
 */
function subtipoCodigoParaContratacao(
  tipo: TipoContratacao,
  origem: FolhaOrigem,
): string {
  if (origem === "california") {
    switch (tipo) {
      case "pj":
      case "mei":
      case "clt_recibo":
        return "015"; // Serviços de Terceiros (PJ) — inclui RPA
      default:
        throw new Error(
          `tipo_contratacao '${tipo}' não é compatível com origem 'california'`,
        );
    }
  }
  // origem === "contabilidade"
  switch (tipo) {
    case "clt":
    case "clt_recibo":
      return "001"; // Salário
    case "estagio":
      return "005"; // Estagiário
    case "socio":
      return "011"; // ProLabore
    default:
      throw new Error(
        `tipo_contratacao '${tipo}' não é compatível com origem 'contabilidade'`,
      );
  }
}

/**
 * Valor em centavos inteiros. Compara-se valor como número, nunca como
 * texto: o banco devolve `12000` e o formulário manda `"12000.00"`, e a
 * comparação de texto via edição onde não houve nenhuma (decisão 132).
 */
function centavos(v: string | number): number {
  return Math.round(Number(v) * 100);
}

/** A mesma alocação, venha do banco (`100`) ou da tela (`"100.00"`). */
function chaveAlocacao(a: {
  empresa_id: string;
  regional_id: string;
  percentual: string | number;
}): string {
  return `${a.empresa_id}|${a.regional_id}|${centavos(a.percentual)}`;
}

function competenciaLabel(ano: number, mes: number): string {
  return `${String(mes).padStart(2, "0")}/${ano}`;
}

function chaveCompetencia(ano: number, mes: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

function revalidarFolha(ano: number, mes: number) {
  revalidatePath("/rh");
  revalidatePath("/rh/folhas");
  revalidatePath(`/rh/folhas/${chaveCompetencia(ano, mes)}`);
  revalidatePath("/financeiro/contas-a-pagar");
}

// ---------------------------------------------------------------------
// Pagamento do colaborador, informado na aprovação (decisão 132)
// ---------------------------------------------------------------------

/** O que a tela manda: os campos do card de dados bancários do RH. */
export type PagamentoDaFolhaInput = {
  banco_codigo: string;
  banco_nome: string;
  agencia: string;
  agencia_dv: string;
  conta: string;
  conta_dv: string;
  tipo_conta: string;
  pix_tipo: string;
  pix_chave: string;
};

type PagamentoValidado = {
  banco_codigo: string | null;
  banco_nome: string | null;
  agencia: string | null;
  agencia_dv: string | null;
  conta: string | null;
  conta_dv: string | null;
  tipo_conta: string | null;
  pix_tipo: string | null;
  pix_chave: string | null;
};

/**
 * A mesma régua do cadastro do RH (`dadosBancariosColaboradorSchema`,
 * decisão 101): chave no formato do banco e conta começada tem de estar
 * completa. O que não sairia certo no arquivo não se grava.
 */
function validarPagamento(
  p: PagamentoDaFolhaInput,
):
  | { ok: true; data: PagamentoValidado }
  | { ok: false; fieldErrors: Record<string, string[]> } {
  const tipoConta = (TIPOS_CONTA_BANCARIA as readonly string[]).includes(p.tipo_conta)
    ? (p.tipo_conta as (typeof TIPOS_CONTA_BANCARIA)[number])
    : undefined;
  const pixTipo = (TIPOS_CHAVE_PIX as readonly string[]).includes(p.pix_tipo)
    ? (p.pix_tipo as (typeof TIPOS_CHAVE_PIX)[number])
    : undefined;
  const parsed = dadosBancariosColaboradorSchema.safeParse({
    banco_codigo: p.banco_codigo ?? "",
    banco_nome: p.banco_nome ?? "",
    agencia: p.agencia ?? "",
    agencia_dv: p.agencia_dv ?? "",
    conta: p.conta ?? "",
    conta_dv: p.conta_dv ?? "",
    tipo_conta: tipoConta,
    pix_tipo: pixTipo,
    pix_chave: p.pix_chave ?? "",
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }
  return {
    ok: true,
    data: {
      ...parsed.data,
      // A chave grava no formato do banco (decisão 090), como no RH.
      pix_chave:
        normalizarChavePix(parsed.data.pix_tipo, parsed.data.pix_chave) ?? null,
    },
  };
}

/** Grava pelo RPC (o financeiro não escreve direto em `colaboradores`). */
async function gravarPagamento(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  colaboradorId: string,
  folhaId: string,
  dados: PagamentoValidado,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc("atualizar_pagamento_colaborador", {
    p_colaborador_id: colaboradorId,
    p_dados: dados,
  });
  if (error) {
    console.error("[folha.pagamento]", error.message);
    return {
      ok: false,
      message: error.message.includes("check constraint")
        ? "Dados de pagamento fora do formato da remessa. Confira a chave e a conta."
        : "Não foi possível gravar os dados de pagamento.",
    };
  }
  await logAuditEvent({
    acao: "colaborador.dados_bancarios_editados",
    tenantId,
    entidadeTipo: "colaborador",
    entidadeId: colaboradorId,
    metadata: {
      origem: "aprovacao_folha",
      folha_id: folhaId,
      tem_banco: dados.banco_codigo !== null,
      tem_pix: dados.pix_chave !== null,
    },
  });
  return { ok: true };
}

/**
 * Grava só o pagamento do colaborador, sem aprovar a linha — para quem
 * quer deixar a chave certa antes de decidir o valor.
 */
export async function salvarPagamentoDaFolha(
  folhaId: string,
  pagamento: PagamentoDaFolhaInput,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.folhas.aprovar_financeiro");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: folha } = await supabase
    .from("folhas_pagamento")
    .select("id, colaborador_id, competencia_ano, competencia_mes")
    .eq("id", folhaId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!folha) return { ok: false, message: "Linha da folha não encontrada." };

  const validado = validarPagamento(pagamento);
  if (!validado.ok) {
    return {
      ok: false,
      message: "Verifique os dados de pagamento.",
      fieldErrors: validado.fieldErrors,
    };
  }

  const gravado = await gravarPagamento(
    supabase,
    tenantId,
    folha.colaborador_id,
    folhaId,
    validado.data,
  );
  if (!gravado.ok) return gravado;

  revalidarFolha(folha.competencia_ano, folha.competencia_mes);
  return { ok: true, id: folhaId };
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
      competencia: chaveCompetencia(folha.competencia_ano, folha.competencia_mes),
      motivo: motivoLimpo,
    },
  });

  revalidarFolha(folha.competencia_ano, folha.competencia_mes);
  return { ok: true, id: folhaId };
}

/**
 * Aprova uma linha de folha. O financeiro pode ajustar, antes de aprovar,
 * o valor a pagar e a alocação (no snapshot da folha) e o pagamento do
 * colaborador. Ao aprovar:
 *
 *   1. Aplica as edições na linha (valor e alocação)
 *   2. Grava o pagamento no cadastro do colaborador, se veio
 *   3. Cria UM título por empresa da alocação — na folha de hoje, um por
 *      pessoa —, com o rateio de regional dentro (decisão 132). Antes era
 *      um título por regional: quem tinha rateio recebia 2 ou 4 PIX.
 *   4. Muda o status para 'aprovada'
 *
 * O salário do cadastro não muda mais aqui (decisão 132, que revoga a D5
 * da decisão 097): o valor da folha é o que se paga no mês — líquido,
 * proporcional, com ISS descontado —, e salário é assunto do RH, na tela
 * do colaborador.
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
  pagamento?: PagamentoDaFolhaInput,
): Promise<ActionResult<{ contas_criadas: number }>> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.folhas.aprovar_financeiro");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // 1) Confirma linha em status=enviada
  const { data: folha, error: folhaError } = await supabase
    .from("folhas_pagamento")
    .select(
      "id, status, salario_base, colaborador_id, competencia_ano, competencia_mes, origem",
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

  // 2) Valida tudo antes de gravar qualquer coisa
  const parsedEdicoes = edicoes ? linhaFolhaSchema.safeParse(edicoes) : null;
  if (parsedEdicoes && !parsedEdicoes.success) {
    return {
      ok: false,
      message: "Edições inválidas.",
      fieldErrors: parsedEdicoes.error.flatten().fieldErrors,
    };
  }
  const pagamentoValidado = pagamento ? validarPagamento(pagamento) : null;
  if (pagamentoValidado && !pagamentoValidado.ok) {
    return {
      ok: false,
      message: "Verifique os dados de pagamento.",
      fieldErrors: pagamentoValidado.fieldErrors,
    };
  }

  const colaboradores = await carregarColaboradoresPagamento(supabase, tenantId, [
    folha.colaborador_id,
  ]);
  const colab = colaboradores.get(folha.colaborador_id);
  if (!colab) {
    return { ok: false, message: "Colaborador não encontrado." };
  }

  // 3) Alocações atuais do snapshot
  const { data: alocAtuaisRaw } = await supabase
    .from("folhas_pagamento_alocacoes")
    .select("empresa_id, regional_id, percentual")
    .eq("folha_id", folhaId);
  const alocAtuais = ((alocAtuaisRaw ?? []) as {
    empresa_id: string;
    regional_id: string;
    percentual: string | number;
  }[]).map((a) => ({
    empresa_id: a.empresa_id,
    regional_id: a.regional_id,
    percentual: (centavos(a.percentual) / 100).toFixed(2),
  }));

  let salarioFinal = (centavos(folha.salario_base) / 100).toFixed(2);
  let alocacoesFinal = alocAtuais;

  // 4) Aplica edições (se houve de verdade — comparação numérica)
  if (parsedEdicoes?.success) {
    const novo = parsedEdicoes.data;
    const valorMudou = centavos(novo.salario_base) !== centavos(folha.salario_base);
    const setAtual = new Set(alocAtuais.map(chaveAlocacao));
    const setNovo = new Set(novo.alocacoes.map(chaveAlocacao));
    const alocMudou =
      setAtual.size !== setNovo.size || [...setAtual].some((k) => !setNovo.has(k));

    if (valorMudou) {
      const { error: upFolhaError } = await supabase
        .from("folhas_pagamento")
        .update({ salario_base: novo.salario_base })
        .eq("id", folhaId);
      if (upFolhaError) {
        console.error("[folha.aprovar.up_folha]", upFolhaError.message);
        return { ok: false, message: "Falha ao aplicar o valor." };
      }
      salarioFinal = novo.salario_base;
    }

    if (alocMudou) {
      const { error: delAlocError } = await supabase
        .from("folhas_pagamento_alocacoes")
        .delete()
        .eq("folha_id", folhaId);
      if (delAlocError) {
        console.error("[folha.aprovar.del_aloc]", delAlocError.message);
        return { ok: false, message: "Falha ao substituir alocações." };
      }
      const { error: insAlocError } = await supabase
        .from("folhas_pagamento_alocacoes")
        .insert(
          novo.alocacoes.map((a) => ({
            tenant_id: tenantId,
            folha_id: folhaId,
            empresa_id: a.empresa_id,
            regional_id: a.regional_id,
            percentual: a.percentual,
          })),
        );
      if (insAlocError) {
        console.error("[folha.aprovar.ins_aloc]", insAlocError.message);
        if (insAlocError.message.includes("Rateio de alocacoes")) {
          return {
            ok: false,
            message: "A soma dos percentuais das alocações precisa dar 100.",
          };
        }
        return { ok: false, message: "Falha ao gravar alocações." };
      }
      alocacoesFinal = novo.alocacoes;
    }

    if (valorMudou || alocMudou) {
      await logAuditEvent({
        acao: "folha.linha.editada_financeiro",
        tenantId,
        entidadeTipo: "folha",
        entidadeId: folhaId,
        metadata: {
          colaborador_id: folha.colaborador_id,
          salario_anterior: (centavos(folha.salario_base) / 100).toFixed(2),
          salario_novo: salarioFinal,
          ...(alocMudou ? { alocacoes_novas: novo.alocacoes } : {}),
        },
      });
    }
  }

  if (alocacoesFinal.length === 0) {
    return { ok: false, message: "A linha está sem alocação." };
  }

  // 5) Pagamento do colaborador, se veio
  if (pagamentoValidado?.ok) {
    const gravado = await gravarPagamento(
      supabase,
      tenantId,
      colab.id,
      folhaId,
      pagamentoValidado.data,
    );
    if (!gravado.ok) return gravado;
  }

  // 5.5) Trava de NF para linhas PJ geradas pela California.
  // Spec: docs/superpowers/specs/2026-10-07-folha-anexo-nf.md (D3)
  const exigeNf =
    folha.origem === "california" &&
    (colab.tipo_contratacao === "pj" ||
      colab.tipo_contratacao === "mei" ||
      colab.tipo_contratacao === "clt_recibo");
  if (exigeNf) {
    const { data: nf } = await supabase
      .from("colaboradores_nf_anexos")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("colaborador_id", folha.colaborador_id)
      .eq("competencia_ano", folha.competencia_ano)
      .eq("competencia_mes", folha.competencia_mes)
      .maybeSingle();
    if (!nf) {
      return {
        ok: false,
        message:
          "Essa linha não pode ser aprovada sem NF anexada. Peça pro colaborador anexar em /perfil, ou use o cadastro dele em /rh/colaboradores.",
      };
    }
  }

  // 6) Plano de contas — depende do tipo do colaborador E da origem da linha.
  //    Fluxo PJ (california): pj/mei/clt_recibo → 05.015 Serviços de Terceiros (PJ).
  //    Fluxo CLT (contabilidade): clt → 05.001, estagio → 05.005, socio → 05.011.
  const codigoSubtipo = subtipoCodigoParaContratacao(
    colab.tipo_contratacao,
    folha.origem,
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
      message: `Subtipo ${codigoSubtipo} de 'Despesa com Pessoal' não está cadastrado no plano de contas. Crie em /financeiro/cadastros/plano-de-contas antes de aprovar.`,
    };
  }

  // 7) Idempotência: se já existem contas_avulsas pra essa folha, não recria
  const { data: contasExistentes } = await supabase
    .from("contas_avulsas")
    .select("id")
    .eq("folha_id", folhaId);
  if ((contasExistentes ?? []).length > 0) {
    return {
      ok: false,
      message:
        "Esta linha já tem título em Títulos a Pagar. Devolva o título para a aprovação antes de aprovar de novo.",
    };
  }

  // 8) Um título por empresa, com o rateio de regional dentro.
  //
  // A conta e o rateio nascem juntos pela RPC do lançamento avulso
  // (decisão 069): o banco recusa conta avulsa sem rateio e exige que o
  // rateio some 100. Os centavos que o arredondamento deixa sobram no
  // último título e na última regional, para o total fechar exato.
  const porEmpresa = new Map<string, { regional_id: string; percentual: number }[]>();
  for (const a of alocacoesFinal) {
    const lista = porEmpresa.get(a.empresa_id) ?? [];
    lista.push({ regional_id: a.regional_id, percentual: Number(a.percentual) });
    porEmpresa.set(a.empresa_id, lista);
  }
  const grupos = [...porEmpresa.entries()];
  const totalCentavos = centavos(salarioFinal);
  const dataPrevistaPagamento = ultimoDiaDoMes(
    folha.competencia_ano,
    folha.competencia_mes,
  );
  const competencia = competenciaLabel(folha.competencia_ano, folha.competencia_mes);
  const { data: empresasRows } = grupos.length > 1
    ? await supabase
        .from("empresas")
        .select("id, nome_fantasia")
        .in("id", grupos.map(([id]) => id))
    : { data: [] as { id: string; nome_fantasia: string | null }[] };
  const nomeEmpresa = new Map(
    ((empresasRows ?? []) as { id: string; nome_fantasia: string | null }[]).map(
      (e) => [e.id, e.nome_fantasia ?? ""],
    ),
  );

  const contasCriadas: string[] = [];
  let restanteCentavos = totalCentavos;
  for (let i = 0; i < grupos.length; i++) {
    const [empresaId, regionais] = grupos[i];
    const ultimoGrupo = i === grupos.length - 1;
    const pctEmpresa = regionais.reduce((acc, r) => acc + r.percentual, 0);
    const valorCentavos = ultimoGrupo
      ? restanteCentavos
      : Math.round((totalCentavos * pctEmpresa) / 100);
    restanteCentavos -= valorCentavos;

    // Rateio dentro da empresa, reescalado para somar 100.
    let restantePct = 10000;
    const rateio = regionais.map((r, j) => {
      const pct =
        j === regionais.length - 1
          ? restantePct
          : Math.round((r.percentual * 10000) / pctEmpresa);
      restantePct -= pct;
      return { regional_id: r.regional_id, percentual: pct / 100 };
    });

    const { data: codigo, error: errCodigo } = await supabase.rpc(
      "gerar_codigo_avulsa",
      { p_tenant_id: tenantId },
    );
    if (errCodigo) {
      console.error("[folha.aprovar.codigo]", errCodigo.message);
    }

    const { data: contaCriadaId, error: insContaError } = await supabase.rpc(
      "criar_conta_avulsa",
      {
        p_dados: {
          tenant_id: tenantId,
          empresa_id: empresaId,
          // Com uma regional só, o título fica com ela, como antes. Com
          // rateio, quem diz as regionais é contas_avulsas_regionais.
          regional_id: rateio.length === 1 ? rateio[0].regional_id : null,
          codigo: (codigo as string | null) ?? null,
          descricao: `Folha ${competencia} · ${colab.nome} · ${subtipoRow.nome}${
            grupos.length > 1 ? ` · ${nomeEmpresa.get(empresaId) ?? ""}` : ""
          }`,
          valor: (valorCentavos / 100).toFixed(2),
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
        },
        p_rateio: rateio,
      },
    );
    if (insContaError || !contaCriadaId) {
      console.error(
        "[folha.aprovar.ins_conta]",
        insContaError?.message ?? "sem retorno",
      );
      if (contasCriadas.length > 0) {
        const service = createServiceClient();
        await service.from("contas_avulsas").delete().in("id", contasCriadas);
      }
      // A RLS de contas_avulsas pede acesso à empresa do título: em 30/09
      // ninguém do financeiro tinha acesso à Ventura.
      if (insContaError?.code === "42501") {
        return {
          ok: false,
          message:
            "Você não tem acesso a uma das empresas desta linha. Peça a um administrador para aprovar ou para liberar o acesso.",
        };
      }
      return { ok: false, message: "Falha ao criar título a pagar." };
    }
    contasCriadas.push(contaCriadaId as string);
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
      competencia: chaveCompetencia(folha.competencia_ano, folha.competencia_mes),
      valor_final: salarioFinal,
      contas_criadas: contasCriadas.length,
      regionais: alocacoesFinal.length,
      pagamento_informado: !!pagamentoValidado?.ok,
    },
  });

  revalidarFolha(folha.competencia_ano, folha.competencia_mes);
  return { ok: true, contas_criadas: contasCriadas.length };
}

/**
 * Devolve uma linha aprovada para "Aguardando aprovação" (decisão 132):
 * apaga o(s) título(s) que a aprovação criou e reabre a linha para o
 * financeiro corrigir o valor, a alocação ou o pagamento e aprovar de novo.
 * É o caminho para erro de digitação como o do AV-00005 — editar o valor
 * direto no título deixaria a folha dizendo uma coisa e o título outra.
 *
 * Só vale enquanto nenhum título tem baixa e nenhum está num arquivo de
 * remessa que não foi cancelado.
 */
export async function devolverFolhaParaAprovacao(input: {
  contaAvulsaId?: string;
  folhaId?: string;
  motivo: string;
}): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.folhas.aprovar_financeiro");
  if (!gate.ok) return gate;

  const motivo = (input.motivo ?? "").trim();
  if (motivo.length < 3) {
    return {
      ok: false,
      message: "Escreva o motivo da devolução (mínimo 3 caracteres).",
    };
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  let folhaId = input.folhaId ?? null;
  if (!folhaId && input.contaAvulsaId) {
    const { data: conta } = await supabase
      .from("contas_avulsas")
      .select("folha_id")
      .eq("id", input.contaAvulsaId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    folhaId = (conta?.folha_id as string | null) ?? null;
  }
  if (!folhaId) {
    return { ok: false, message: "Este título não veio da folha de pagamento." };
  }

  const { data: folha } = await supabase
    .from("folhas_pagamento")
    .select("id, status, colaborador_id, competencia_ano, competencia_mes, salario_base")
    .eq("id", folhaId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!folha) return { ok: false, message: "Linha da folha não encontrada." };
  if (folha.status !== "aprovada") {
    return {
      ok: false,
      message: `Linha em status "${folha.status}" não pode ser devolvida.`,
    };
  }

  const { data: contasRaw } = await supabase
    .from("contas_avulsas")
    .select("id, codigo, valor, status")
    .eq("folha_id", folhaId)
    .eq("tenant_id", tenantId);
  const contas = (contasRaw ?? []) as {
    id: string;
    codigo: string | null;
    valor: string | number;
    status: string;
  }[];
  const ids = contas.map((c) => c.id);

  if (contas.some((c) => c.status !== "aprovada")) {
    return {
      ok: false,
      message: "O título já foi baixado. Cancele a baixa antes de devolver.",
    };
  }
  if (ids.length > 0) {
    const { data: baixas } = await supabase
      .from("lancamentos_financeiros")
      .select("id")
      .in("conta_avulsa_id", ids)
      .limit(1);
    if ((baixas ?? []).length > 0) {
      return {
        ok: false,
        message: "O título já tem baixa. Cancele a baixa antes de devolver.",
      };
    }

    const { data: itensRemessa } = await supabase
      .from("cnab_remessas_itens")
      .select("origem_id, remessa:cnab_remessas!inner(sequencial_arquivo, status)")
      .in("origem_id", ids)
      .neq("remessa.status", "cancelado");
    const naRemessa = ((itensRemessa ?? []) as unknown as {
      remessa: { sequencial_arquivo: number; status: string } | null;
    }[]).find((i) => i.remessa);
    if (naRemessa?.remessa) {
      const arquivo = `PE${String(naRemessa.remessa.sequencial_arquivo).padStart(6, "0")}`;
      return {
        ok: false,
        message: `O título está no arquivo de remessa ${arquivo}. Se o arquivo não foi para o banco, ele precisa ser cancelado antes da devolução.`,
      };
    }

    const { error: delError } = await supabase
      .from("contas_avulsas")
      .delete()
      .in("id", ids)
      .eq("tenant_id", tenantId);
    if (delError) {
      console.error("[folha.devolver.del_contas]", delError.message);
      return { ok: false, message: "Não foi possível tirar o título de Títulos a Pagar." };
    }
  }

  const { error: upError } = await supabase
    .from("folhas_pagamento")
    .update({
      status: "enviada",
      aprovada_em: null,
      aprovada_por: null,
      data_pagamento: null,
    })
    .eq("id", folhaId);
  if (upError) {
    console.error("[folha.devolver.up_folha]", upError.message);
    return { ok: false, message: "Não foi possível devolver a linha para a aprovação." };
  }

  await logAuditEvent({
    acao: "folha.linha.aprovacao_desfeita",
    tenantId,
    entidadeTipo: "folha",
    entidadeId: folhaId,
    metadata: {
      colaborador_id: folha.colaborador_id,
      competencia: chaveCompetencia(folha.competencia_ano, folha.competencia_mes),
      motivo,
      titulos_removidos: contas.map((c) => ({
        codigo: c.codigo,
        valor: (centavos(c.valor) / 100).toFixed(2),
      })),
    },
  });

  revalidarFolha(folha.competencia_ano, folha.competencia_mes);
  return { ok: true, id: folhaId };
}
