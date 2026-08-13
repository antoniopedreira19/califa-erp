import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { nomeVersao } from "@/lib/nome-versao";
import {
  calcularTotaisVersao,
  TIPOS_CUSTO,
} from "@/lib/calculos/versao-totais";
import type {
  TipoCusto,
  VersaoOrcamento,
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
} from "@/lib/types";

export const dynamic = "force-dynamic";

// Paleta California pra bater visualmente com o app.
const BLUE_HEADER = "FF4A7CB8"; // azul da linha de header do template
const BLUE_GROUP = "FF9BB8DE"; // azul claro dos grupos e subtotais
const WHITE = "FFFFFFFF";
const BLACK = "FF000000";
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFCCCCCC" } },
  bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
  left: { style: "thin", color: { argb: "FFCCCCCC" } },
  right: { style: "thin", color: { argb: "FFCCCCCC" } },
};

const TIPOS = TIPOS_CUSTO;

export async function GET(
  _req: Request,
  { params }: { params: { projetoId: string; orcId: string; versaoId: string } },
) {
  const session = await requireSession();
  const supabase = createClient();

  // ---------- fetch dados ----------
  const [versaoRes, orcRes, gruposRes, itensRes] = await Promise.all([
    supabase
      .from("versoes_orcamento")
      .select("*")
      .eq("id", params.versaoId)
      .eq("orcamento_id", params.orcId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<VersaoOrcamento>(),
    supabase
      .from("orcamentos")
      .select("id, codigo, nome, projeto:projetos(cliente:clientes(nome_fantasia))")
      .eq("id", params.orcId)
      .eq("projeto_id", params.projetoId)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<{
        id: string;
        codigo: string;
        nome: string;
        projeto: { cliente: { nome_fantasia: string } | null } | null;
      }>(),
    supabase
      .from("versoes_orcamento_grupos")
      .select("*")
      .eq("versao_orcamento_id", params.versaoId)
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true })
      .returns<VersaoOrcamentoGrupo[]>(),
    supabase
      .from("versoes_orcamento_itens")
      .select("*")
      .eq("versao_orcamento_id", params.versaoId)
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true })
      .returns<VersaoOrcamentoItem[]>(),
  ]);

  if (versaoRes.error || !versaoRes.data) {
    return NextResponse.json({ error: "Versão não encontrada" }, { status: 404 });
  }
  if (!orcRes.data) {
    return NextResponse.json({ error: "Orçamento não encontrado" }, { status: 404 });
  }

  const versao = versaoRes.data;
  const orcamento = orcRes.data;
  const grupos = gruposRes.data ?? [];
  const itens = (itensRes.data ?? []).map((it: any) => ({
    ...it,
    valor_unitario_orcado: Number(it.valor_unitario_orcado ?? 0),
    quantidade_orcada: Number(it.quantidade_orcada ?? 1),
    dias_meses_orcado: Number(it.dias_meses_orcado ?? 1),
    total_orcado: Number(it.total_orcado ?? 0),
  })) as VersaoOrcamentoItem[];

  // Nome do cliente via embed projeto → cliente
  const clienteNome = orcamento.projeto?.cliente?.nome_fantasia ?? "—";

  // ---------- monta workbook ----------
  const wb = new ExcelJS.Workbook();
  wb.creator = "California ERP";
  wb.created = new Date();

  const ws = wb.addWorksheet("Orçamento", {
    views: [{ state: "frozen", ySplit: 3 }],
  });

  // Larguras (A..G)
  ws.columns = [
    { header: "", key: "planilha", width: 32 }, // A · nome do grupo
    { header: "", key: "item", width: 52 }, // B · descrição do item
    { header: "", key: "rs", width: 15 }, // C · valor unitário
    { header: "", key: "qt", width: 8 }, // D · qtd
    { header: "", key: "dm", width: 8 }, // E · dias/mês
    { header: "", key: "tt", width: 16 }, // F · total
    { header: "", key: "tipo", width: 6 }, // G · tipo A/B/C/D
  ];

  // -------- Linha 1: cabeçalho de identificação do orçamento --------
  ws.getRow(1).values = [
    `${orcamento.codigo} · ${orcamento.nome}`,
    `Cliente: ${clienteNome}`,
    nomeVersao(orcamento.nome, versao.numero_versao),
    "",
    "",
    "",
    "",
  ];
  ws.mergeCells("A1:B1");
  ws.mergeCells("C1:G1");
  ws.getRow(1).height = 22;
  ws.getRow(1).eachCell((cell) => {
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: BLACK } };
    cell.alignment = { vertical: "middle" };
  });

  // -------- Linha 2: título "ORÇAMENTO" merged em C..F --------
  ws.getRow(2).values = ["", "", "ORÇAMENTO", "", "", "", ""];
  ws.mergeCells("C2:F2");
  ws.getRow(2).height = 20;
  const cellOrc = ws.getCell("C2");
  cellOrc.alignment = { horizontal: "center", vertical: "middle" };
  cellOrc.font = { name: "Calibri", size: 12, bold: true, color: { argb: WHITE } };
  cellOrc.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: BLUE_HEADER },
  };

  // -------- Linha 3: header das colunas --------
  const header = ws.getRow(3);
  header.values = ["PLANILHA", "ITEM", "R$", "QT", "D/M", "TT", ""];
  header.height = 20;
  header.eachCell((cell, col) => {
    cell.font = {
      name: "Calibri",
      size: 11,
      bold: true,
      color: { argb: col >= 3 && col <= 7 ? WHITE : BLACK },
    };
    cell.alignment = { vertical: "middle", horizontal: col === 1 || col === 2 ? "left" : "center" };
    if (col >= 3 && col <= 7) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: BLUE_HEADER },
      };
    }
    cell.border = BORDER;
  });

  // -------- Linhas dos grupos + itens --------
  for (const grupo of grupos) {
    const itensDoGrupo = itens.filter((i) => i.grupo_id === grupo.id);
    const subtotalGrupo = itensDoGrupo.reduce((s, i) => s + i.total_orcado, 0);

    // Linha do grupo
    const gRow = ws.addRow([grupo.nome, "", "", "", "", subtotalGrupo, ""]);
    gRow.height = 20;
    gRow.eachCell((cell, col) => {
      cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: BLACK } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: BLUE_GROUP },
      };
      cell.border = BORDER;
      if (col === 6) {
        cell.numFmt = '"R$" #,##0.00';
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.alignment = { vertical: "middle" };
      }
    });

    for (const it of itensDoGrupo) {
      const row = ws.addRow([
        "",
        it.item,
        it.valor_unitario_orcado,
        it.quantidade_orcada,
        it.dias_meses_orcado,
        it.total_orcado,
        it.tipo_custo,
      ]);
      row.height = 18;
      row.eachCell((cell, col) => {
        cell.font = { name: "Calibri", size: 10, color: { argb: BLACK } };
        cell.border = BORDER;
        cell.alignment = { vertical: "middle" };
        if (col === 3 || col === 6) {
          cell.numFmt = '"R$" #,##0.00';
          cell.alignment = { horizontal: "right", vertical: "middle" };
        } else if (col === 4 || col === 5) {
          cell.alignment = { horizontal: "center", vertical: "middle" };
        } else if (col === 7) {
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.font = { name: "Calibri", size: 10, bold: true };
        }
      });
    }
  }

  // -------- Bloco de totais no final --------
  const honorPct = Number(versao.percentual_honorarios ?? 0);
  const impPct = Number(versao.percentual_imposto ?? 0);
  // A planilha enviada ao cliente segue mostrando só o VALOR DO JOB, no
  // rótulo FATURAMENTO que ela sempre teve: é o total que o cliente se
  // compromete a gastar. A quebra entre o que a California emite nota e o
  // que ele paga direto ao fornecedor é leitura interna (decisão do Tiago
  // em 11/08/2026) e não entra neste arquivo.
  const { subtotaisPorTipo, subtotalGeral, honorarios, imposto, valorJob } =
    calcularTotaisVersao(itens, honorPct, impPct);

  // 1 linha vazia
  ws.addRow([]);

  const summaryRows: Array<{
    label: string;
    value: number;
    tipo?: TipoCusto;
    bold?: boolean;
    faturamento?: boolean;
  }> = [
    ...TIPOS.map((t) => ({
      label: `SUB-TOTAL ${t}`,
      value: subtotaisPorTipo[t],
      tipo: t,
    })),
    { label: "TOTAL", value: subtotalGeral, bold: true },
    { label: "IMPOSTO", value: imposto },
    {
      label: `HONORÁRIOS ${honorPct.toString().replace(".", ",")}%`,
      value: honorarios,
    },
    { label: "FATURAMENTO", value: valorJob, bold: true, faturamento: true },
  ];

  for (const r of summaryRows) {
    const row = ws.addRow(["", "", "", "", r.label, r.value, r.tipo ?? ""]);
    row.height = 20;
    row.eachCell((cell, col) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: BLUE_GROUP },
      };
      cell.border = BORDER;
      cell.font = {
        name: "Calibri",
        size: 11,
        bold: r.bold || r.faturamento || false,
        color: { argb: r.faturamento ? WHITE : BLACK },
      };
      if (r.faturamento) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: BLUE_HEADER },
        };
      }
      if (col === 5) {
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else if (col === 6) {
        cell.alignment = { horizontal: "right", vertical: "middle" };
        cell.numFmt = '"R$" #,##0.00';
      } else if (col === 7) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      } else {
        cell.alignment = { vertical: "middle" };
      }
    });
  }

  // ---------- resposta ----------
  const buffer = await wb.xlsx.writeBuffer();

  const nomeArquivo = `orcamento-${orcamento.codigo}-v${versao.numero_versao}.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nomeArquivo}"`,
      "Cache-Control": "no-store",
    },
  });
}
