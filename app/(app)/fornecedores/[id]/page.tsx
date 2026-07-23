import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Fornecedor } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { FornecedorForm } from "../fornecedor-form";

export const dynamic = "force-dynamic";

export default async function EditarFornecedorPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const { data: fornecedor, error } = await supabase
    .from("fornecedores")
    .select("*")
    .eq("id", params.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<Fornecedor>();

  if (error) console.error("[fornecedores.detail]", error.message);
  if (!fornecedor) notFound();

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <Link
          href="/fornecedores"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para fornecedores
        </Link>
        <div className="mt-3 flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{fornecedor.nome}</h1>
          <Badge variant="outline">
            {fornecedor.tipo_pessoa === "fisica" ? "PF" : "PJ"}
          </Badge>
          {fornecedor.status === "ativo" ? (
            <Badge variant="soft">Ativo</Badge>
          ) : (
            <Badge variant="neutral">Inativo</Badge>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <FornecedorForm fornecedor={fornecedor} />
      </div>
    </div>
  );
}
