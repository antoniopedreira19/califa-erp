import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { FornecedorForm } from "../fornecedor-form";

export default async function NovoFornecedorPage() {
  await requireSession();

  return (
    // O cartão saiu daqui: o formulário traz o próprio, com as seções
    // divididas por filete (desenho de 09/09/2026). A largura acompanha a
    // coluna de explicação de cada seção.
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <Link
          href="/fornecedores"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para fornecedores
        </Link>
        <h1 className="mt-2.5 text-[28px] font-bold leading-tight tracking-tight">
          Novo fornecedor
        </h1>
        <p className="mt-1 max-w-[52ch] text-[13.5px] text-muted-foreground">
          Nome, CPF/CNPJ, contato e uma forma de pagamento são obrigatórios —
          endereço e observações podem ficar para depois.
        </p>
      </div>

      <FornecedorForm />
    </div>
  );
}
