import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const colaboradorId = req.nextUrl.searchParams.get("colaborador");
  if (!colaboradorId) {
    return NextResponse.json({ error: "colaborador requerido" }, { status: 400 });
  }

  const supabase = createClient();
  const { data: colab } = await supabase
    .from("colaboradores")
    .select("id, user_id")
    .eq("id", colaboradorId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!colab) {
    return NextResponse.json({ error: "colaborador não encontrado" }, { status: 404 });
  }
  const ehDono = colab.user_id === session.profile.id;
  if (!ehDono && !pode(session.activeRole, "rh.nf.ver")) {
    return NextResponse.json({ error: "sem permissão" }, { status: 403 });
  }

  const [folhasRes, nfsRes] = await Promise.all([
    supabase
      .from("folhas_pagamento")
      .select(
        "competencia_ano, competencia_mes, tipo, status, data_pagamento_prevista, data_pagamento, paga_em",
      )
      .eq("tenant_id", session.activeTenant.id)
      .eq("colaborador_id", colaboradorId)
      .eq("origem", "california")
      .neq("status", "cancelada_rescisao")
      .neq("tipo", "rescisao"),
    supabase
      .from("colaboradores_nf_anexos")
      .select(
        "id, competencia_ano, competencia_mes, arquivo_nome, uploaded_at, escopo_tipo",
      )
      .eq("tenant_id", session.activeTenant.id)
      .eq("colaborador_id", colaboradorId)
      .neq("escopo_tipo", "rescisao"),
  ]);

  // Mapeia tipo de folha → grupo visível ao usuário (salario / ferias / 13)
  function grupoDaFolha(tipo: string): "salario" | "ferias" | "13" {
    if (tipo === "salario") return "salario";
    if (tipo === "ferias") return "ferias";
    return "13"; // decimo_terceiro_1a_parcela, 2a_parcela, adiantamento
  }
  function grupoDoAnexo(escopo: string): "salario" | "ferias" | "13" | null {
    if (escopo === "folha_mensal") return "salario";
    if (escopo === "ferias_usufruto" || escopo === "ferias_abono") return "ferias";
    if (escopo.startsWith("decimo_terceiro")) return "13";
    return null;
  }

  type Row = {
    competencia_ano: number;
    competencia_mes: number;
    tipo: "salario" | "ferias" | "13";
    folha_status: string | null;
    data_pagamento: string | null; // paga_em > data_pagamento > data_pagamento_prevista
    nf: { id: string; arquivo_nome: string; uploaded_at: string } | null;
  };
  const porChave = new Map<string, Row>();
  for (const f of folhasRes.data ?? []) {
    const grupo = grupoDaFolha(f.tipo as string);
    const chave = `${f.competencia_ano}-${f.competencia_mes}-${grupo}`;
    const dataEfetiva =
      (f.paga_em ? String(f.paga_em).slice(0, 10) : null) ??
      f.data_pagamento ??
      f.data_pagamento_prevista ??
      null;
    porChave.set(chave, {
      competencia_ano: f.competencia_ano,
      competencia_mes: f.competencia_mes,
      tipo: grupo,
      folha_status: f.status,
      data_pagamento: dataEfetiva,
      nf: null,
    });
  }
  for (const n of nfsRes.data ?? []) {
    const grupo = grupoDoAnexo(n.escopo_tipo as string);
    if (!grupo) continue;
    const chave = `${n.competencia_ano}-${n.competencia_mes}-${grupo}`;
    const atual = porChave.get(chave) ?? {
      competencia_ano: n.competencia_ano,
      competencia_mes: n.competencia_mes,
      tipo: grupo,
      folha_status: null,
      data_pagamento: null,
      nf: null,
    };
    atual.nf = {
      id: n.id,
      arquivo_nome: n.arquivo_nome,
      uploaded_at: n.uploaded_at,
    };
    porChave.set(chave, atual);
  }

  const ordemTipo: Record<Row["tipo"], number> = { salario: 0, ferias: 1, "13": 2 };
  const linhas = Array.from(porChave.values()).sort((a, b) => {
    const chaveA = a.competencia_ano * 100 + a.competencia_mes;
    const chaveB = b.competencia_ano * 100 + b.competencia_mes;
    if (chaveA !== chaveB) return chaveB - chaveA;
    return ordemTipo[a.tipo] - ordemTipo[b.tipo];
  });

  return NextResponse.json(linhas);
}
