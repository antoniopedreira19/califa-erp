import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Receipt } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { pode } from "@/lib/permissoes";
import type {
  Empresa,
  FolhaLinhaStatus,
  Nivel,
} from "@/lib/types";
import { FolhaCompetenciaView, type FolhaLinha } from "./folha-competencia-view";

export const dynamic = "force-dynamic";

const NOMES_MES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function parseCompetencia(chave: string): { ano: number; mes: number } | null {
  const m = chave.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12 || ano < 2020 || ano > 2099) return null;
  return { ano, mes };
}

export default async function FolhaCompetenciaPage({
  params,
}: {
  params: { competencia: string };
}) {
  const session = await requireSession();
  if (!pode(session.activeRole, "rh.folhas.ver")) {
    redirect("/home?reason=sem_permissao_rh");
  }

  const competencia = parseCompetencia(params.competencia);
  if (!competencia) notFound();
  const { ano, mes } = competencia;

  const supabase = createClient();

  const [linhasRes, empresasRes, regionaisRes] = await Promise.all([
    supabase
      .from("folhas_pagamento")
      .select(
        "id, salario_base, status, motivo_pendencia, colaborador:colaboradores(id, nome, funcao, tipo_contratacao, nivel:niveis(codigo)), alocacoes:folhas_pagamento_alocacoes(id, empresa_id, regional_id, percentual, empresa:empresas(nome_fantasia), regional:regionais(nome))",
      )
      .eq("tenant_id", session.activeTenant.id)
      .eq("competencia_ano", ano)
      .eq("competencia_mes", mes)
      .order("created_at", { ascending: true }),
    supabase
      .from("empresas")
      .select("id, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome_fantasia"),
    supabase
      .from("regionais")
      .select("id, nome, empresa_id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
  ]);

  if (linhasRes.error) {
    console.error("[folha.competencia.linhas]", linhasRes.error.message);
  }

  const linhas = ((linhasRes.data ?? []) as any[]).map(
    (l): FolhaLinha => ({
      id: l.id,
      salario_base: String(l.salario_base),
      status: l.status as FolhaLinhaStatus,
      motivo_pendencia: l.motivo_pendencia,
      colaborador: {
        id: l.colaborador?.id ?? "",
        nome: l.colaborador?.nome ?? "—",
        funcao: l.colaborador?.funcao ?? "—",
        tipo_contratacao: l.colaborador?.tipo_contratacao ?? "clt",
        nivel_codigo: l.colaborador?.nivel?.codigo ?? null,
      },
      alocacoes: ((l.alocacoes ?? []) as any[]).map((a) => ({
        id: a.id,
        empresa_id: a.empresa_id,
        regional_id: a.regional_id,
        percentual: String(a.percentual),
        empresa_nome: a.empresa?.nome_fantasia ?? "",
        regional_nome: a.regional?.nome ?? "",
      })),
    }),
  );

  const empresas = (empresasRes.data ?? []) as Pick<Empresa, "id" | "nome_fantasia">[];
  const regionais = (regionaisRes.data ?? []) as {
    id: string;
    nome: string;
    empresa_id: string;
  }[];

  const podeEditar = pode(session.activeRole, "rh.folhas.editar_rh");

  const totalGeral = linhas.reduce((acc, l) => acc + Number(l.salario_base), 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <Link
          href="/rh/folhas"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para folhas
        </Link>
        <header className="mt-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-california-red/10 p-2">
              <Receipt className="h-5 w-5 text-california-red" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">
              Folha de {NOMES_MES[mes - 1]}/{ano}
            </h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {linhas.length} linha{linhas.length === 1 ? "" : "s"} · Total{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {new Intl.NumberFormat("pt-BR", {
                style: "currency",
                currency: "BRL",
              }).format(totalGeral)}
            </span>
          </p>
        </header>
      </div>

      <FolhaCompetenciaView
        linhas={linhas}
        empresas={empresas}
        regionais={regionais}
        podeEditar={podeEditar}
      />
    </div>
  );
}
