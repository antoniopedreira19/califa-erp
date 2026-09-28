import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Proposta — California",
  description: "Sua proposta de contratação com a California.",
};

/**
 * Layout standalone da página pública de proposta. Sem sidebar, sem
 * header do ERP — o candidato não é usuário do sistema.
 */
export default function PropostaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-white">
        <div className="mx-auto max-w-3xl px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-california-red p-2 text-white font-bold">
              CA
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-california-red">
                Agência California
              </p>
              <p className="text-sm text-muted-foreground">
                Proposta de contratação
              </p>
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
      <footer className="mt-16 border-t border-border py-6 text-center text-xs text-muted-foreground">
        <p>
          Agência California — Rua Vale Cabral, 43, Pituba, Salvador/BA · CEP 41810-020
        </p>
        <p>Dúvidas? Entre em contato com o RH.</p>
      </footer>
    </div>
  );
}
