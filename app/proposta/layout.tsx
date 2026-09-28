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
      <main className="mx-auto max-w-5xl px-4 md:px-6 py-8">{children}</main>
    </div>
  );
}
