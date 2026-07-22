import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { FornecedorForm } from "../fornecedor-form";

export default async function NovoFornecedorPage() {
  await requireSession();

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
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Novo fornecedor</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cadastre o prestador para poder incluí-lo nos itens das versões de
          orçamento.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <FornecedorForm />
      </div>
    </div>
  );
}
