import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { montarPlanilhaModelo } from "@/lib/exportacao/modelo-de-planilha";
import { mesesDoPeriodo } from "@/lib/calculos/meses-trimestre";
import type { CategoriaModeloPlanilha } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * A planilha modelo, vazia, que o modal de importação oferece para baixar
 * (decisão 110). Montada por `montarPlanilhaModelo`.
 *
 * `?modelo=nacional|internacional|mensal`. No mensal, `?orcamento=<id>`
 * põe os meses do período do orçamento — a importação recusa mês que o
 * orçamento não tem; sem ele, vão os três meses seguintes.
 */
export async function GET(req: Request) {
  const session = await requireSession();
  const url = new URL(req.url);
  const pedido = url.searchParams.get("modelo");
  const modelo: Exclude<CategoriaModeloPlanilha, "midia_off"> =
    pedido === "internacional" || pedido === "mensal" ? pedido : "nacional";

  let meses: string[] = [];
  if (modelo === "mensal") {
    const orcamentoId = url.searchParams.get("orcamento");
    if (orcamentoId) {
      const { data: orc } = await createClient()
        .from("orcamentos")
        .select("data_inicio_prevista, data_fim_prevista")
        .eq("id", orcamentoId)
        .eq("tenant_id", session.activeTenant.id)
        .maybeSingle<{ data_inicio_prevista: string | null; data_fim_prevista: string | null }>();
      if (orc?.data_inicio_prevista && orc.data_fim_prevista) {
        meses = mesesDoPeriodo({ inicio: orc.data_inicio_prevista, fim: orc.data_fim_prevista });
      }
    }
    if (meses.length === 0) {
      const hoje = new Date();
      meses = [1, 2, 3].map((k) =>
        new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + k, 1)).toISOString().slice(0, 10),
      );
    }
  }

  const nomeDoModelo =
    modelo === "internacional" ? "internacional" : modelo === "mensal" ? "mensal" : "nacional";
  const buffer = await montarPlanilhaModelo(modelo, meses).xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="modelo-de-orcamento-${nomeDoModelo}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
