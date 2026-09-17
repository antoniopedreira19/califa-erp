import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Empresa, Nivel } from "@/lib/types";
import { ColaboradorFormNovo } from "../colaborador-form-novo";

export const dynamic = "force-dynamic";

export default async function NovoColaboradorPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  const supabase = createClient();

  const [empresasRes, regionaisRes, niveisRes] = await Promise.all([
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

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <Link
          href="/rh/colaboradores"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para colaboradores
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          Novo colaborador
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cadastra dados fixos + primeira alocação (100% em empresa/regional) +
          salário inicial. Rateio, mudanças de alocação e mudanças salariais
          são feitas depois na página do colaborador.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <ColaboradorFormNovo
          empresas={empresas}
          regionais={regionais}
          niveis={niveis}
        />
      </div>
    </div>
  );
}
