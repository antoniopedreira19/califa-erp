import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import { todasAsLinhas } from "@/lib/supabase/todas-as-linhas";
import type { Fornecedor } from "@/lib/types";
import {
  montarPlanilhaDeFornecedores,
  nomeDoArquivoDeFornecedores,
} from "@/lib/exportacao/planilha-de-fornecedores";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Folga sobre o cadastro de hoje (3.380 em 12/11/2026). */
const LIMITE_DE_IDS = 50_000;

/**
 * POST /api/fornecedores/export  { ids: string[], filtrado: boolean }
 *
 * O "Exportar Excel" da tela de Fornecedores (12/11/2026): `ids` são os
 * fornecedores que a tela mostra, na ordem dela; a rota lê o cadastro
 * inteiro de cada um (a lista só carrega o que mostra) e devolve o .xlsx.
 * Id de outro tenant não acha linha e fica de fora. Só Admin e Financeiro
 * (`cadastros.fornecedores.exportar`): o arquivo leva conta e PIX de todos.
 */
export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  if (!pode(session.activeRole, "cadastros.fornecedores.exportar")) {
    return NextResponse.json({ error: "Sem permissão para exportar os fornecedores." }, { status: 403 });
  }

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }
  const { ids, filtrado } = (corpo ?? {}) as { ids?: unknown; filtrado?: unknown };
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > LIMITE_DE_IDS ||
    !ids.every((id) => typeof id === "string" && UUID.test(id))
  ) {
    return NextResponse.json({ error: "Nenhum fornecedor para exportar." }, { status: 400 });
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const [{ data: cadastro, error }, veiculosRes] = await Promise.all([
    // O cadastro inteiro, página a página (o PostgREST corta em 1.000):
    // poucas leituras, em vez de uma por lote de ids.
    todasAsLinhas((de, ate) =>
      supabase
        .from("fornecedores")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("id")
        .range(de, ate)
        .returns<Fornecedor[]>(),
    ),
    supabase
      .from("veiculos_midia")
      .select("fornecedor_id")
      .eq("tenant_id", tenantId)
      .returns<{ fornecedor_id: string }[]>(),
  ]);
  if (error || veiculosRes.error) {
    console.error("[fornecedores.export]", error?.message ?? veiculosRes.error?.message);
    return NextResponse.json({ error: "Não foi possível ler os fornecedores." }, { status: 500 });
  }

  const porId = new Map((cadastro ?? []).map((f) => [f.id, f]));
  const linhas: Fornecedor[] = [];
  const vistos = new Set<string>();
  for (const id of ids as string[]) {
    const f = porId.get(id);
    if (!f || vistos.has(id)) continue;
    vistos.add(id);
    linhas.push(f);
  }
  if (linhas.length === 0) {
    return NextResponse.json({ error: "Nenhum fornecedor para exportar." }, { status: 400 });
  }

  const veiculoIds = new Set((veiculosRes.data ?? []).map((v) => v.fornecedor_id));
  const buffer = await montarPlanilhaDeFornecedores(linhas, veiculoIds).xlsx.writeBuffer();
  const nome = nomeDoArquivoDeFornecedores(filtrado === true);

  // A planilha leva conta e PIX: quem exportou, quantos e se estava filtrado.
  await logAuditEvent({
    acao: "fornecedores.exportados",
    tenantId,
    entidadeTipo: "fornecedor",
    metadata: {
      quantidade: linhas.length,
      ativos: linhas.filter((f) => f.status === "ativo").length,
      filtrado: filtrado === true,
    },
  });

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // O nome tem espaço e parênteses: vai também codificado (RFC 5987).
      "Content-Disposition": `attachment; filename="fornecedores.xlsx"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      "Cache-Control": "no-store",
    },
  });
}
