import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { ClienteForm } from "../cliente-form";

export default async function NovoClientePage() {
  await requireSession();

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <Link
          href="/clientes"
          prefetch={false}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para clientes
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Novo cliente</h1>
        <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
          Cadastre a empresa e as marcas dela de uma vez — o cliente já nasce
          pronto para abrir projeto.
        </p>
      </div>

      {/* Sem cartão em volta: o formulário traz o próprio (09/09/2026). */}
      <ClienteForm />
    </div>
  );
}
