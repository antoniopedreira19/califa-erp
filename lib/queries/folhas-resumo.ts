/**
 * Query helper para a página /rh/folhas/[competencia].
 * Agrega contadores e totais das origens PJ e CLT, estado do fechamento de
 * benefícios e flag de catálogo incompleto — tudo em paralelo, sem embeds pesados.
 *
 * Referência: docs/superpowers/specs/2026-11-26-folha-pj-clt-fluxos-independentes-design.md
 */

import { createClient } from "@/lib/supabase/server";
import {
  obterFechamentoVigenteDaCompetencia,
  temAvulsaPaga,
} from "@/lib/queries/beneficios";
import type { ResumoCardsFolha, ResumoFolhaOrigem } from "@/lib/types";

// Status possíveis da coluna folhas_pagamento.status (enum folha_linha_status).
type FolhaLinhaStatus =
  | "rascunho"
  | "enviada"
  | "aprovada"
  | "pendente_correcao"
  | "paga";

// Valores reais da coluna folhas_pagamento.origem (enum folha_origem):
// 'california' → PJ gerada pelo sistema; 'contabilidade' → CLT importada do PDF.
type FolhaOrigem = "california" | "contabilidade";

type FolhaLinhaRaw = {
  salario_base: number;
  desconto_beneficios: number;
  status: string;
  origem: string;
};

/** Acumula contadores/totais por origem. */
function origemVazia(): ResumoFolhaOrigem {
  return {
    linhasRascunho: 0,
    linhasPendenteCorrecao: 0,
    linhasEnviadas: 0,
    linhasAprovadas: 0,
    linhasPagas: 0,
    totalLiquido: 0,
    totalDescontoBeneficios: 0,
  };
}

function acumularLinha(acc: ResumoFolhaOrigem, linha: FolhaLinhaRaw): void {
  acc.totalLiquido += Number(linha.salario_base);
  acc.totalDescontoBeneficios += Number(linha.desconto_beneficios);

  const status = linha.status as FolhaLinhaStatus;
  switch (status) {
    case "rascunho":
      acc.linhasRascunho += 1;
      break;
    case "pendente_correcao":
      acc.linhasPendenteCorrecao += 1;
      break;
    case "enviada":
      acc.linhasEnviadas += 1;
      break;
    case "aprovada":
      acc.linhasAprovadas += 1;
      break;
    case "paga":
      acc.linhasPagas += 1;
      break;
    default:
      // Status desconhecido (pode ser valor futuro do enum): não contabiliza
      // em nenhum bucket mas também não propaga erro.
      console.warn("[folhas-resumo] status desconhecido ignorado:", linha.status);
  }
}

export async function obterResumoCardsFolha(args: {
  tenantId: string;
  ano: number;
  mes: number;
}): Promise<ResumoCardsFolha> {
  const { tenantId, ano, mes } = args;
  const supabase = createClient();

  // Todas as queries independentes em paralelo — CLAUDE.md "Promise.all".
  const [linhasResult, fechamento, catalogoResult] = await Promise.all([
    // 1. Linhas de folha — select leve, sem embed.
    supabase
      .from("folhas_pagamento")
      .select("salario_base, desconto_beneficios, status, origem")
      .eq("tenant_id", tenantId)
      .eq("competencia_ano", ano)
      .eq("competencia_mes", mes)
      .eq("tipo", "salario"),

    // 2. Fechamento vigente de benefícios (reaberto_em is null).
    obterFechamentoVigenteDaCompetencia({ tenantId, ano, mes }),

    // 3. Catálogo incompleto — select mínimo com limit 1.
    supabase
      .from("beneficios")
      .select("nome")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .or(
        "fornecedor_id.is.null,empresa_id.is.null,dia_vencimento_fatura.is.null,regional_id.is.null",
      )
      .limit(1)
      .maybeSingle(),
  ]);

  // ── Redução em memória das linhas por origem ──────────────────────────────
  const pjAcc = origemVazia();
  const cltAcc = origemVazia();

  if (linhasResult.error) {
    console.warn("[folhas-resumo] query folhas_pagamento falhou:", linhasResult.error.message);
  }

  for (const linha of (linhasResult.data ?? []) as FolhaLinhaRaw[]) {
    const origem = linha.origem as FolhaOrigem;
    if (origem === "california") {
      acumularLinha(pjAcc, linha);
    } else if (origem === "contabilidade") {
      acumularLinha(cltAcc, linha);
    } else {
      // Origem desconhecida: ignora silenciosamente.
      console.warn("[folhas-resumo] origem desconhecida ignorada:", linha.origem);
    }
  }

  // ── Estado de benefícios ──────────────────────────────────────────────────
  const fechamentoId = fechamento?.id ?? null;
  const aplicado = fechamento !== null;

  // avulsasGeradas: existe ao menos uma conta_avulsa ligada ao fechamento.
  let avulsasGeradas = false;
  let avulsaPaga = false;

  if (fechamentoId) {
    const [avulsasCheck, avulsaPagaCheck] = await Promise.all([
      supabase
        .from("contas_avulsas")
        .select("id")
        .eq("beneficio_fechamento_id", fechamentoId)
        .limit(1)
        .maybeSingle(),
      temAvulsaPaga({ fechamentoId }),
    ]);
    avulsasGeradas = avulsasCheck.data !== null;
    avulsaPaga = avulsaPagaCheck;
  }

  // ── Preview de benefícios (só quando snapshot NÃO aplicado) ───────────────
  let previewDescontoBeneficios: number | null = null;
  let previewQtdVinculos: number | null = null;

  if (!aplicado) {
    // Chama a RPC somente quando não há snapshot — evita trabalho desnecessário.
    const { data: previewLinhas, error: previewError } = await supabase.rpc(
      "fn_beneficios_calcular_fechamento",
      {
        p_tenant_id: tenantId,
        p_ano: ano,
        p_mes: mes,
      },
    );

    if (previewError) {
      // Erro esperado quando catálogo incompleto — não propaga; catalogoIncompleto
      // já sinaliza isso pro usuário.
      console.warn("[folhas-resumo] preview RPC falhou:", previewError.message);
      previewDescontoBeneficios = null;
      previewQtdVinculos = null;
    } else {
      const items = (previewLinhas ?? []) as Array<{
        valor_colaborador: number;
      }>;
      previewDescontoBeneficios = items.reduce(
        (s, l) => s + Number(l.valor_colaborador),
        0,
      );
      previewQtdVinculos = items.length;
    }
  }

  // ── Catálogo incompleto ───────────────────────────────────────────────────
  if (catalogoResult.error) {
    console.warn("[folhas-resumo] query beneficios (catálogo incompleto) falhou:", catalogoResult.error.message);
  }
  const catalogoIncompleto =
    (catalogoResult.data as { nome: string } | null)?.nome ?? null;

  // ── Montagem final ────────────────────────────────────────────────────────
  return {
    pj: {
      ...pjAcc,
      previewDescontoBeneficios,
      previewQtdVinculos,
    },
    clt: cltAcc,
    beneficios: {
      aplicado,
      fechamentoId,
      avulsasGeradas,
      avulsaPaga,
      qtdVinculos: fechamento?.qtd_vinculos ?? 0,
      totalEmpresa: fechamento?.total_empresa ?? 0,
      totalColaborador: fechamento?.total_colaborador ?? 0,
      totalIntegral: fechamento?.valor_integral ?? 0,
    },
    catalogoIncompleto,
  };
}
