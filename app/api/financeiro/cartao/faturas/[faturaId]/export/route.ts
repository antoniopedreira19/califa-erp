import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { nomeDeArquivoSeguro } from "@/lib/exportacao/planilha-orcamento";
import { carregarExtratoDaFatura } from "@/lib/data/fatura-cartao-extrato";

export const dynamic = "force-dynamic";

/**
 * Exportação da FATURA DE CARTÃO (decisão 093, entrega 2).
 *
 * `GET /api/financeiro/cartao/faturas/[faturaId]/export` — a mesma tabela
 * da aba Cartão, item a item, com as colunas da conciliação. Lê do mesmo
 * `carregarExtratoDaFatura` que a tela usa: o que se vê é o que se leva.
 */
export async function GET(
  _req: Request,
  { params }: { params: { faturaId: string } },
) {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    return NextResponse.json(
      { error: "Você não tem permissão para exportar a fatura." },
      { status: 403 },
    );
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const extrato = await carregarExtratoDaFatura(supabase, tenantId, params.faturaId);
  if (!extrato) {
    return NextResponse.json({ error: "Fatura não encontrada." }, { status: 404 });
  }

  const { data: cartao } = await supabase
    .from("cartoes_credito")
    .select("nome, banco, bandeira, ultimos_4_digitos")
    .eq("tenant_id", tenantId)
    .eq("id", extrato.fatura.cartao_credito_id)
    .maybeSingle<{ nome: string; banco: string; bandeira: string; ultimos_4_digitos: string }>();

  const wb = new ExcelJS.Workbook();
  wb.creator = "Califa ERP";
  const ws = wb.addWorksheet("Fatura");

  const f = extrato.fatura;
  const cabecalho: Array<[string, string]> = [
    ["Cartão", cartao ? `${cartao.nome} · •••• ${cartao.ultimos_4_digitos} · ${cartao.bandeira.toUpperCase()}` : "—"],
    ["Fatura", f.codigo],
    ["Fecha em", dataBR(f.competencia_fechamento)],
    ["Vence em", dataBR(f.data_vencimento)],
    ["Situação", situacao(f.status, extrato.pagamento)],
    ["Total da fatura", moeda(extrato.kpis.total)],
  ];
  if (f.valor_cobrado !== null) {
    cabecalho.push(["Cobrado pelo banco", moeda(f.valor_cobrado)]);
  }
  for (const [rotulo, valor] of cabecalho) {
    const row = ws.addRow([rotulo, valor]);
    row.getCell(1).font = { bold: true };
  }
  ws.addRow([]);

  const colunas = [
    "Data",
    "Crédito",
    "Débito",
    "Acumulado",
    "Descrição",
    "Fornecedor",
    "Job",
    "Centro de custo",
    "Subtipo",
    "Trimestre",
    "Empresa",
    "Origem",
    "Regional",
    "Situação do item",
  ];
  const head = ws.addRow(colunas);
  head.font = { bold: true };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F3F2" } };

  for (const it of extrato.itens) {
    ws.addRow([
      dataBR(it.data_movimento),
      it.credito > 0 ? it.credito : null,
      it.debito > 0 ? it.debito : null,
      it.acumulado,
      it.descricao,
      it.fornecedor_nome ?? "",
      it.job_codigo ?? "",
      `${it.tipo_codigo} · ${it.tipo_nome}`,
      it.subtipo_nome,
      trimestre(it.data_movimento),
      it.empresa_nome ?? "",
      it.origem_codigo ?? "",
      it.regional_nome ?? (it.rateio.length > 1 ? "Rateada" : ""),
      it.papel === "pendente"
        ? "Entra no fechamento"
        : it.papel === "ajuste"
          ? "Ajuste do fechamento"
          : "Confirmado",
    ]);
  }

  const total = ws.addRow([
    "Total da fatura",
    extrato.kpis.estornos,
    extrato.kpis.compras + extrato.kpis.ajustes + extrato.kpis.pendentes,
    extrato.kpis.total,
  ]);
  total.font = { bold: true };

  for (const col of [2, 3, 4]) {
    ws.getColumn(col).numFmt = '#,##0.00;[Red]-#,##0.00';
    ws.getColumn(col).width = 14;
  }
  ws.getColumn(1).width = 14;
  ws.getColumn(5).width = 44;
  ws.getColumn(6).width = 30;
  ws.getColumn(7).width = 12;
  ws.getColumn(8).width = 28;
  ws.getColumn(9).width = 22;
  ws.getColumn(10).width = 10;
  ws.getColumn(11).width = 22;
  ws.getColumn(12).width = 12;
  ws.getColumn(13).width = 14;
  ws.getColumn(14).width = 22;

  const buffer = await wb.xlsx.writeBuffer();
  const nomeArquivo = nomeDeArquivoSeguro(
    `Fatura ${f.codigo} - ${cartao?.nome ?? "cartao"} - ${f.competencia_fechamento.slice(0, 7)}.xlsx`,
  );
  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nomeArquivo}"`,
    },
  });
}

function dataBR(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

function moeda(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function trimestre(iso: string): string {
  const m = parseInt(iso.slice(5, 7), 10);
  return m <= 3 ? "T1" : m <= 6 ? "T2" : m <= 9 ? "T3" : "T4";
}

function situacao(
  status: "aberta" | "fechada" | "paga",
  pagamento: { data: string; conta_nome: string | null } | null,
): string {
  if (status === "aberta") return "Aberta";
  if (status === "fechada") return "Fechada · aguardando baixa";
  return `Paga em ${pagamento ? dataBR(pagamento.data) : "—"}${
    pagamento?.conta_nome ? ` · ${pagamento.conta_nome}` : ""
  }`;
}
