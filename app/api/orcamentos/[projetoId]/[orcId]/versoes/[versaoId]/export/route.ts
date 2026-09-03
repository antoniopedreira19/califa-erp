import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { nomeVersao } from "@/lib/nome-versao";
import { adicionarAbaOrcamento } from "@/lib/exportacao/planilha-orcamento";
import type {
  VersaoOrcamento,
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Exportação de UMA versão — a planilha que vai para o cliente.
 *
 * O desenho da aba mora em `lib/exportacao/planilha-orcamento.ts` desde
 * 03/09/2026, compartilhado com a exportação de vários orçamentos do
 * projeto (`app/api/orcamentos/[projetoId]/export`). Esta rota só busca a
 * versão e monta o workbook com uma aba.
 */
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

  adicionarAbaOrcamento(wb, "Orçamento", {
    codigo: orcamento.codigo,
    nome: orcamento.nome,
    clienteNome,
    tituloVersao: nomeVersao(orcamento.nome, versao.numero_versao),
    percentualHonorarios: Number(versao.percentual_honorarios ?? 0),
    percentualImposto: Number(versao.percentual_imposto ?? 0),
    grupos: grupos.map((grupo) => ({
      nome: grupo.nome,
      itens: itens.filter((i) => i.grupo_id === grupo.id),
    })),
  });

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
