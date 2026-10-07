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
      .select("competencia_ano, competencia_mes, status")
      .eq("tenant_id", session.activeTenant.id)
      .eq("colaborador_id", colaboradorId)
      .eq("origem", "california"),
    supabase
      .from("colaboradores_nf_anexos")
      .select("id, competencia_ano, competencia_mes, arquivo_nome, uploaded_at")
      .eq("tenant_id", session.activeTenant.id)
      .eq("colaborador_id", colaboradorId),
  ]);

  type Row = {
    competencia_ano: number;
    competencia_mes: number;
    folha_status: string | null;
    nf: { id: string; arquivo_nome: string; uploaded_at: string } | null;
  };
  const porChave = new Map<string, Row>();
  for (const f of folhasRes.data ?? []) {
    const chave = `${f.competencia_ano}-${f.competencia_mes}`;
    porChave.set(chave, {
      competencia_ano: f.competencia_ano,
      competencia_mes: f.competencia_mes,
      folha_status: f.status,
      nf: null,
    });
  }
  for (const n of nfsRes.data ?? []) {
    const chave = `${n.competencia_ano}-${n.competencia_mes}`;
    const atual = porChave.get(chave) ?? {
      competencia_ano: n.competencia_ano,
      competencia_mes: n.competencia_mes,
      folha_status: null,
      nf: null,
    };
    atual.nf = {
      id: n.id,
      arquivo_nome: n.arquivo_nome,
      uploaded_at: n.uploaded_at,
    };
    porChave.set(chave, atual);
  }

  const linhas = Array.from(porChave.values()).sort((a, b) => {
    const chaveA = a.competencia_ano * 100 + a.competencia_mes;
    const chaveB = b.competencia_ano * 100 + b.competencia_mes;
    return chaveB - chaveA;
  });

  return NextResponse.json(linhas);
}
