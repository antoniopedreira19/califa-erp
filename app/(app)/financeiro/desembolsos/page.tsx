// Decisão 264: o módulo Desembolsos mostra só os pedidos de quem está
// usando, para todo papel. O financeiro confere os de todos em Contas a
// Pagar › Desembolsos.
import { Wallet } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { carregarContextoDoFormulario, carregarPedidosDeDesembolso } from "./dados";
import { MeusDesembolsos } from "./meus-desembolsos";

export const dynamic = "force-dynamic";

export default async function DesembolsosPage({ searchParams }: { searchParams?: { abrir?: string } }) {
  const session = await requireSession();
  const supabase = createClient();
  const [linhas, contexto] = await Promise.all([
    carregarPedidosDeDesembolso(supabase, session.activeTenant.id, { criadoPor: session.profile.id }),
    carregarContextoDoFormulario(supabase, session.activeTenant.id),
  ]);

  return (
    // Tela principal sem largura própria (decisão 085): a largura vem do layout.
    <div className="space-y-8">
      <PageHeader
        eyebrow="FINANCEIRO"
        title="Desembolsos"
        description="Os seus pedidos de desembolso. Anexe o comprovante e envie: o financeiro confere e, aprovado, o pedido vira título a pagar."
        icon={Wallet}
      />
      <MeusDesembolsos linhas={linhas} contexto={contexto} abrirInicial={searchParams?.abrir ?? null} />
    </div>
  );
}
