import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Users, Briefcase, DollarSign } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { tipoContratacaoLabel } from "@/lib/types";
import type {
  Colaborador,
  ColaboradorAlocacao,
  ColaboradorSalario,
  Empresa,
  Nivel,
} from "@/lib/types";
import { CardDados } from "./card-dados";
import { CardAlocacoes } from "./card-alocacoes";
import { CardSalarios } from "./card-salarios";

export const dynamic = "force-dynamic";

export default async function ColaboradorDetalhePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  const supabase = createClient();

  const [colabRes, alocacoesRes, salariosRes, empresasRes, regionaisRes, niveisRes] =
    await Promise.all([
      supabase
        .from("colaboradores")
        .select("*, nivel:niveis(id, codigo, descricao)")
        .eq("id", params.id)
        .eq("tenant_id", session.activeTenant.id)
        .maybeSingle(),
      supabase
        .from("colaboradores_alocacoes")
        .select(
          "*, empresa:empresas(id, nome_fantasia), regional:regionais(id, nome)",
        )
        .eq("colaborador_id", params.id)
        .eq("tenant_id", session.activeTenant.id)
        .order("data_inicio", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("colaboradores_salarios")
        .select("*")
        .eq("colaborador_id", params.id)
        .eq("tenant_id", session.activeTenant.id)
        .order("data_inicio", { ascending: false })
        .order("created_at", { ascending: false }),
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
      supabase
        .from("niveis")
        .select("id, codigo, descricao")
        .eq("tenant_id", session.activeTenant.id)
        .eq("ativo", true),
    ]);

  if (!colabRes.data) {
    notFound();
  }

  const colab = colabRes.data as Colaborador & {
    nivel: Pick<Nivel, "id" | "codigo" | "descricao"> | null;
  };

  const alocacoes = (alocacoesRes.data ?? []) as (ColaboradorAlocacao & {
    empresa: Pick<Empresa, "id" | "nome_fantasia">;
    regional: { id: string; nome: string };
  })[];

  const salarios = (salariosRes.data ?? []) as ColaboradorSalario[];

  const empresas = (empresasRes.data ?? []) as Pick<
    Empresa,
    "id" | "nome_fantasia"
  >[];
  const regionais = (regionaisRes.data ?? []) as {
    id: string;
    nome: string;
    empresa_id: string;
  }[];
  const niveis = ((niveisRes.data ?? []) as Pick<
    Nivel,
    "id" | "codigo" | "descricao"
  >[])
    .slice()
    .sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR"));

  const isAdmin = session.activeRole === "administrador";

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <Link
          href="/rh/colaboradores"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para colaboradores
        </Link>
        <header className="mt-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl font-bold tracking-tight">
                  {colab.nome}
                </h1>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                    colab.status === "ativo"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      colab.status === "ativo"
                        ? "bg-emerald-500"
                        : "bg-muted-foreground"
                    }`}
                  />
                  {colab.status === "ativo" ? "Ativo" : "Inativo"}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {colab.funcao}
                {colab.nivel ? ` · ${colab.nivel.codigo}` : ""} ·{" "}
                {tipoContratacaoLabel(colab.tipo_contratacao)}
              </p>
            </div>
          </div>
        </header>
      </div>

      <div className="grid gap-4">
        <CardDados
          colaborador={colab}
          empresas={empresas}
          regionais={regionais}
          niveis={niveis}
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <CardAlocacoes
            colaboradorId={colab.id}
            alocacoes={alocacoes}
            empresas={empresas}
            regionais={regionais}
          />
          <CardSalarios
            colaboradorId={colab.id}
            salarios={salarios}
            isAdmin={isAdmin}
          />
        </div>
      </div>
    </div>
  );
}
