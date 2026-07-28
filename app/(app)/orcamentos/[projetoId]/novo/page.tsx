import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { OrcamentoForm } from "../orcamento-form";

export const dynamic = "force-dynamic";

export default async function NovoOrcamentoPage({
  params,
}: {
  params: { projetoId: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const { data: projeto } = await supabase
    .from("projetos")
    .select("id, codigo, nome")
    .eq("id", params.projetoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!projeto) notFound();

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <Link
          href={`/orcamentos/${params.projetoId}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para {projeto.codigo} · {projeto.nome}
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Novo orçamento</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O código será gerado no formato{" "}
          <span className="font-mono">{projeto.codigo}-NN</span>.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <OrcamentoForm projetoId={params.projetoId} />
      </div>
    </div>
  );
}
