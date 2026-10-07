"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
// NOTE: `require` em vez de `import` para evitar o debug-mode do pdf-parse
// que roda ao carregar o módulo (tenta ler um PDF de teste e crasha o build).
// Padrão idêntico ao uso de pdfmake no projeto.
const pdfParse = require("pdf-parse") as (
  buffer: Buffer,
) => Promise<{ text: string }>;

import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { createClient } from "@/lib/supabase/server";
import {
  parseFolhaContabilidadeTexto,
  type SecaoPdf,
} from "@/lib/pdf/parse-folha-contabilidade";
import type {
  FolhaImportacaoWarning,
  FolhaImportacaoTotalizadores,
  TipoContratacao,
} from "@/lib/types";

type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; message: string };

type Acao = "criar" | "atualizar" | "ignorar";

const SECAO_PARA_TIPOS: Record<SecaoPdf, TipoContratacao[]> = {
  empregados: ["clt", "clt_recibo"],
  estagiarios: ["estagio"],
  contribuintes: ["socio"],
};

const SECAO_LABEL: Record<SecaoPdf, string> = {
  empregados: "Empregados",
  estagiarios: "Estagiários",
  contribuintes: "Contribuintes",
};

export interface ResumoImportacaoLinha {
  cpf: string;
  nome: string;
  secao: SecaoPdf;
  colaborador_id: string | null;
  tipo_contratacao: TipoContratacao | null;
  acao: Acao;
  motivo_ignorar?: string;
  /** Valor em centavos. */
  valor: number;
}

export interface ResumoImportacao {
  /** NULL em dryRun. */
  importacao_id: string | null;
  linhas_total: number;
  linhas_criadas: number;
  linhas_atualizadas: number;
  linhas_ignoradas: number;
  warnings: FolhaImportacaoWarning[];
  totalizadores_pdf: FolhaImportacaoTotalizadores;
  preview: ResumoImportacaoLinha[];
}

function centavosParaBrlString(c: number): string {
  return (c / 100).toFixed(2);
}

function somaDaSecao(
  linhas: ReadonlyArray<{ secao: SecaoPdf; valor: number }>,
  secao: SecaoPdf,
): number {
  return linhas.filter((l) => l.secao === secao).reduce((a, l) => a + l.valor, 0);
}

/**
 * Importa a folha CLT a partir do PDF "Relação Geral dos Líquidos" entregue
 * pela contabilidade. Idempotente por (competência, hash do PDF). Grava linhas
 * em folhas_pagamento com origem='contabilidade' e status='rascunho'.
 *
 * Spec: docs/superpowers/specs/2026-10-06-folha-dois-fluxos-design.md (D3)
 */
export async function importarFolhaContabilidade(input: {
  ano: number;
  mes: number;
  arquivoBuffer: ArrayBuffer;
  arquivoNome: string;
  dryRun?: boolean;
}): Promise<ActionResult<ResumoImportacao>> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.folhas.editar_rh");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const buffer = Buffer.from(input.arquivoBuffer);
  const arquivo_hash = createHash("sha256").update(buffer).digest("hex");

  // Idempotência: mesmo (competência, hash) → aborta e aponta para a importação anterior.
  if (!input.dryRun) {
    const { data: anterior } = await supabase
      .from("folha_importacoes")
      .select("id, uploaded_at")
      .eq("tenant_id", tenantId)
      .eq("competencia_ano", input.ano)
      .eq("competencia_mes", input.mes)
      .eq("arquivo_hash", arquivo_hash)
      .maybeSingle();
    if (anterior) {
      return {
        ok: false,
        message: `Esse PDF já foi importado em ${anterior.uploaded_at}. Importação id=${anterior.id}.`,
      };
    }
  }

  // Extrai texto e parseia.
  let parsed;
  try {
    const pdfData = await pdfParse(buffer);
    parsed = parseFolhaContabilidadeTexto(pdfData.text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Falha ao ler o PDF: ${msg}` };
  }

  if (
    parsed.competencia_ano !== input.ano ||
    parsed.competencia_mes !== input.mes
  ) {
    return {
      ok: false,
      message: `A competência do PDF (${String(parsed.competencia_mes).padStart(2, "0")}/${parsed.competencia_ano}) difere da selecionada (${String(input.mes).padStart(2, "0")}/${input.ano}).`,
    };
  }

  const warnings: FolhaImportacaoWarning[] = [];
  const preview: ResumoImportacaoLinha[] = [];

  // Match por CPF contra o cadastro.
  const cpfs = parsed.linhas.map((l) => l.cpf);
  const { data: colabs } = await supabase
    .from("colaboradores")
    .select("id, nome, cpf_cnpj, tipo_contratacao")
    .eq("tenant_id", tenantId)
    .in("cpf_cnpj", cpfs);

  const porCpf = new Map(
    (colabs ?? []).map((c) => [
      String(c.cpf_cnpj ?? "").replace(/\D/g, ""),
      c as { id: string; nome: string; cpf_cnpj: string; tipo_contratacao: TipoContratacao },
    ]),
  );

  // Linhas já gravadas nesta competência com origem='contabilidade' (pra decidir criar/atualizar/ignorar).
  const { data: existentes } = await supabase
    .from("folhas_pagamento")
    .select("id, colaborador_id, status")
    .eq("tenant_id", tenantId)
    .eq("competencia_ano", input.ano)
    .eq("competencia_mes", input.mes)
    .eq("origem", "contabilidade");
  const porColabId = new Map(
    (existentes ?? []).map((f) => [
      f.colaborador_id as string,
      { id: f.id as string, status: f.status as string },
    ]),
  );

  for (const linha of parsed.linhas) {
    const colab = porCpf.get(linha.cpf);
    if (!colab) {
      warnings.push({
        tipo: "colaborador_nao_encontrado",
        mensagem: `${linha.nome} (CPF ${linha.cpf}) na seção ${SECAO_LABEL[linha.secao]} não está cadastrado.`,
        cpf: linha.cpf,
        nome: linha.nome,
        secao: linha.secao,
      });
      preview.push({
        cpf: linha.cpf,
        nome: linha.nome,
        secao: linha.secao,
        colaborador_id: null,
        tipo_contratacao: null,
        acao: "ignorar",
        motivo_ignorar: "colaborador não cadastrado",
        valor: linha.valor,
      });
      continue;
    }

    const tiposEsperados = SECAO_PARA_TIPOS[linha.secao];
    if (!tiposEsperados.includes(colab.tipo_contratacao)) {
      warnings.push({
        tipo: "secao_errada",
        mensagem: `${colab.nome} está cadastrado como ${colab.tipo_contratacao} mas apareceu na seção ${SECAO_LABEL[linha.secao]} do PDF.`,
        cpf: linha.cpf,
        nome: colab.nome,
        secao: linha.secao,
      });
      preview.push({
        cpf: linha.cpf,
        nome: colab.nome,
        secao: linha.secao,
        colaborador_id: colab.id,
        tipo_contratacao: colab.tipo_contratacao,
        acao: "ignorar",
        motivo_ignorar: `cadastrado como ${colab.tipo_contratacao}, veio em ${SECAO_LABEL[linha.secao]}`,
        valor: linha.valor,
      });
      continue;
    }

    const existente = porColabId.get(colab.id);
    if (!existente) {
      preview.push({
        cpf: linha.cpf,
        nome: colab.nome,
        secao: linha.secao,
        colaborador_id: colab.id,
        tipo_contratacao: colab.tipo_contratacao,
        acao: "criar",
        valor: linha.valor,
      });
      continue;
    }
    if (existente.status === "rascunho") {
      preview.push({
        cpf: linha.cpf,
        nome: colab.nome,
        secao: linha.secao,
        colaborador_id: colab.id,
        tipo_contratacao: colab.tipo_contratacao,
        acao: "atualizar",
        valor: linha.valor,
      });
      continue;
    }

    warnings.push({
      tipo: "linha_ja_promovida",
      mensagem: `${colab.nome} já está em "${existente.status}" nesta competência — não foi sobrescrito.`,
      cpf: linha.cpf,
      nome: colab.nome,
      secao: linha.secao,
    });
    preview.push({
      cpf: linha.cpf,
      nome: colab.nome,
      secao: linha.secao,
      colaborador_id: colab.id,
      tipo_contratacao: colab.tipo_contratacao,
      acao: "ignorar",
      motivo_ignorar: `linha já ${existente.status}`,
      valor: linha.valor,
    });
  }

  // Divergência de soma vs totalizador (warning, não bloqueia).
  const somaAImportar = preview
    .filter((p) => p.acao !== "ignorar")
    .reduce((acc, p) => acc + p.valor, 0);
  const totalPdf = parsed.totalizadores.total_empresa;
  if (Math.abs(somaAImportar - totalPdf) > 1) {
    warnings.push({
      tipo: "soma_divergente",
      mensagem: `Soma a importar (R$ ${centavosParaBrlString(somaAImportar)}) difere do total do PDF (R$ ${centavosParaBrlString(totalPdf)}).`,
    });
  }

  const totalizadores_pdf: FolhaImportacaoTotalizadores = {
    empregados: {
      linhas: parsed.totalizadores.empregados,
      total: centavosParaBrlString(somaDaSecao(parsed.linhas, "empregados")),
    },
    estagiarios: {
      linhas: parsed.totalizadores.estagiarios,
      total: centavosParaBrlString(somaDaSecao(parsed.linhas, "estagiarios")),
    },
    contribuintes: {
      linhas: parsed.totalizadores.contribuintes,
      total: centavosParaBrlString(somaDaSecao(parsed.linhas, "contribuintes")),
    },
    total_empresa: centavosParaBrlString(totalPdf),
  };

  const criarPreview = preview.filter((p) => p.acao === "criar");
  const atualizarPreview = preview.filter((p) => p.acao === "atualizar");
  const ignorarCount = preview.filter((p) => p.acao === "ignorar").length;

  if (input.dryRun) {
    return {
      ok: true,
      importacao_id: null,
      linhas_total: parsed.linhas.length,
      linhas_criadas: criarPreview.length,
      linhas_atualizadas: atualizarPreview.length,
      linhas_ignoradas: ignorarCount,
      warnings,
      totalizadores_pdf,
      preview,
    };
  }

  // Modo real: cria/atualiza linhas em folhas_pagamento.
  const dataPagamentoPorCpf = new Map(
    parsed.linhas.map((l) => [l.cpf, l.data_pagamento]),
  );

  for (const p of criarPreview) {
    const salarioBaseStr = centavosParaBrlString(p.valor);
    const { data: nova, error } = await supabase
      .from("folhas_pagamento")
      .insert({
        tenant_id: tenantId,
        colaborador_id: p.colaborador_id!,
        competencia_ano: input.ano,
        competencia_mes: input.mes,
        salario_base: salarioBaseStr,
        status: "rascunho",
        origem: "contabilidade",
        data_pagamento_prevista: dataPagamentoPorCpf.get(p.cpf) ?? null,
        created_by: session.profile.id,
      })
      .select("id")
      .single();

    if (error || !nova) {
      warnings.push({
        tipo: "valor_invalido",
        mensagem: `Falha ao inserir linha de ${p.nome}: ${error?.message ?? "erro desconhecido"}.`,
        cpf: p.cpf,
        nome: p.nome,
      });
      continue;
    }

    // Snapshot das alocações vigentes (Camada 1).
    const { data: alocVigente } = await supabase
      .from("colaboradores_alocacoes")
      .select("empresa_id, regional_id, usa_rateio_empresa")
      .eq("colaborador_id", p.colaborador_id!)
      .eq("tenant_id", tenantId)
      .is("data_fim", null)
      .maybeSingle();

    if (!alocVigente) continue;

    if (alocVigente.usa_rateio_empresa) {
      const { data: rateio } = await supabase
        .from("empresas_rateios_regionais")
        .select("regional_id, percentual")
        .eq("tenant_id", tenantId)
        .eq("empresa_id", alocVigente.empresa_id)
        .eq("ano_vigencia", input.ano);
      if (rateio && rateio.length > 0) {
        await supabase.from("folhas_pagamento_alocacoes").insert(
          rateio.map((r) => ({
            tenant_id: tenantId,
            folha_id: nova.id,
            empresa_id: alocVigente.empresa_id,
            regional_id: r.regional_id,
            percentual: String(r.percentual),
          })),
        );
      }
    } else if (alocVigente.regional_id) {
      await supabase.from("folhas_pagamento_alocacoes").insert({
        tenant_id: tenantId,
        folha_id: nova.id,
        empresa_id: alocVigente.empresa_id,
        regional_id: alocVigente.regional_id,
        percentual: "100.00",
      });
    }
  }

  for (const p of atualizarPreview) {
    const salarioBaseStr = centavosParaBrlString(p.valor);
    await supabase
      .from("folhas_pagamento")
      .update({
        salario_base: salarioBaseStr,
        data_pagamento_prevista: dataPagamentoPorCpf.get(p.cpf) ?? null,
      })
      .eq("tenant_id", tenantId)
      .eq("competencia_ano", input.ano)
      .eq("competencia_mes", input.mes)
      .eq("colaborador_id", p.colaborador_id!)
      .eq("origem", "contabilidade")
      .eq("status", "rascunho");
  }

  // Grava o registro de auditoria da importação.
  const { data: importacao } = await supabase
    .from("folha_importacoes")
    .insert({
      tenant_id: tenantId,
      competencia_ano: input.ano,
      competencia_mes: input.mes,
      arquivo_nome: input.arquivoNome,
      arquivo_hash,
      linhas_total: parsed.linhas.length,
      linhas_criadas: criarPreview.length,
      linhas_atualizadas: atualizarPreview.length,
      linhas_ignoradas: ignorarCount,
      warnings: warnings as unknown as Record<string, unknown>[],
      totalizadores_pdf: totalizadores_pdf as unknown as Record<string, unknown>,
      uploaded_by: session.profile.id,
    })
    .select("id")
    .single();

  await logAuditEvent({
    acao: "folha.importada",
    tenantId,
    entidadeTipo: "folha_importacao",
    entidadeId: importacao?.id ?? undefined,
    metadata: {
      ano: input.ano,
      mes: input.mes,
      arquivo_hash,
      arquivo_nome: input.arquivoNome,
      linhas_criadas: criarPreview.length,
      linhas_atualizadas: atualizarPreview.length,
      linhas_ignoradas: ignorarCount,
    },
  });

  revalidatePath("/rh/folhas");
  revalidatePath(
    `/rh/folhas/${input.ano}-${String(input.mes).padStart(2, "0")}`,
  );

  return {
    ok: true,
    importacao_id: importacao?.id ?? null,
    linhas_total: parsed.linhas.length,
    linhas_criadas: criarPreview.length,
    linhas_atualizadas: atualizarPreview.length,
    linhas_ignoradas: ignorarCount,
    warnings,
    totalizadores_pdf,
    preview,
  };
}

/**
 * Envia todas as linhas rascunho de uma competência (das duas origens) para
 * o financeiro, mudando status rascunho → enviada em bloco. Requer que ambos
 * os fluxos (PJ gerado + CLT importado) tenham ao menos 1 linha na competência.
 *
 * Spec: docs/superpowers/specs/2026-10-06-folha-dois-fluxos-design.md (D4)
 */
export async function enviarCompetencia(input: {
  ano: number;
  mes: number;
}): Promise<ActionResult<{ linhas_enviadas: number }>> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "rh.folhas.editar_rh");
  if (!gate.ok) return gate;

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // Confirma que os dois fluxos têm alguma linha nessa competência.
  const [{ count: linhasPj }, { count: linhasClt }] = await Promise.all([
    supabase
      .from("folhas_pagamento")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("competencia_ano", input.ano)
      .eq("competencia_mes", input.mes)
      .eq("origem", "california"),
    supabase
      .from("folhas_pagamento")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("competencia_ano", input.ano)
      .eq("competencia_mes", input.mes)
      .eq("origem", "contabilidade"),
  ]);

  if (!linhasPj) {
    return {
      ok: false,
      message: "Fluxo PJ ainda não foi gerado nessa competência.",
    };
  }
  if (!linhasClt) {
    return {
      ok: false,
      message: "Fluxo CLT ainda não foi importado nessa competência.",
    };
  }

  const nowIso = new Date().toISOString();
  const { data: afetadas, error } = await supabase
    .from("folhas_pagamento")
    .update({
      status: "enviada",
      enviada_em: nowIso,
      enviada_por: session.profile.id,
    })
    .eq("tenant_id", tenantId)
    .eq("competencia_ano", input.ano)
    .eq("competencia_mes", input.mes)
    .eq("status", "rascunho")
    .select("id");

  if (error) {
    return { ok: false, message: `Falha ao enviar competência: ${error.message}` };
  }

  await logAuditEvent({
    acao: "folha_competencia.enviada",
    tenantId,
    entidadeTipo: "folha_competencia",
    entidadeId: `${input.ano}-${String(input.mes).padStart(2, "0")}`,
    metadata: {
      ano: input.ano,
      mes: input.mes,
      linhas_enviadas: afetadas?.length ?? 0,
    },
  });

  revalidatePath("/rh/folhas");
  revalidatePath(
    `/rh/folhas/${input.ano}-${String(input.mes).padStart(2, "0")}`,
  );
  revalidatePath("/financeiro/contas-a-pagar");

  return { ok: true, linhas_enviadas: afetadas?.length ?? 0 };
}
