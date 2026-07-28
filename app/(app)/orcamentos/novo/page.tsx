import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import type { Cliente } from "@/lib/types";
import { ProjetoForm } from "../projeto-form";

export const dynamic = "force-dynamic";

export default async function NovoProjetoPage() {
  const session = await requireSession();
  const supabase = createClient();

  const [clientesRes, responsaveis] = await Promise.all([
    supabase
      .from("clientes")
      .select("id, nome_fantasia, codigo_curto")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    listActiveMembers(session.activeTenant.id),
  ]);

  const clientes = (clientesRes.data ?? []) as Pick<
    Cliente,
    "id" | "nome_fantasia" | "codigo_curto"
  >[];

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <Link
          href="/orcamentos"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para projetos
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Novo projeto</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O código do projeto é gerado automaticamente no formato{" "}
          <span className="font-mono">CLI-NNNN/AA</span>.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <ProjetoForm clientes={clientes} responsaveis={responsaveis} />
      </div>
    </div>
  );
}
