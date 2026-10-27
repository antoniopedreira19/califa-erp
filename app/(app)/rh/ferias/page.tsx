import { redirect } from "next/navigation";
import Link from "next/link";
import { Palmtree } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { AbaPainel } from "./aba-painel";
import { AbaQuadro } from "./aba-quadro";
import { AbaFluxo } from "./aba-fluxo";

export const dynamic = "force-dynamic";

type Tab = "painel" | "quadro" | "fluxo";

const TABS: { key: Tab; label: string }[] = [
  { key: "painel", label: "Painel" },
  { key: "quadro", label: "Quadro" },
  { key: "fluxo", label: "Fluxo" },
];

export default async function FeriasPage({
  searchParams,
}: {
  searchParams: {
    tab?: string;
    status?: string;
  };
}) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  const tenantId = session.activeTenant.id;

  // Abas removidas da UI redirecionam para Fluxo
  if (searchParams.tab === "solicitacoes" || searchParams.tab === "pagamentos") {
    redirect("/rh/ferias?tab=fluxo");
  }

  const tab: Tab = normalizarTab(searchParams.tab);

  return (
    <div className="space-y-6 max-w-[1480px] mx-auto">
      <BotaoVoltar reserva="/rh" />
      <PageHeader
        title="Gestão de Férias"
        description="Painel de solicitações, concessivos vencendo e acompanhamento do quadro."
        icon={Palmtree}
      />

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="flex gap-6">
          {TABS.map((t) => {
            const ativo = t.key === tab;
            return (
              <Link
                key={t.key}
                href={`/rh/ferias?tab=${t.key}`}
                prefetch={false}
                className={`px-1 pb-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  ativo
                    ? "border-california-red text-california-red"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {tab === "painel" && <AbaPainel tenantId={tenantId} />}
      {tab === "quadro" && <AbaQuadro tenantId={tenantId} />}
      {tab === "fluxo" && <AbaFluxo tenantId={tenantId} />}
    </div>
  );
}

function normalizarTab(t: string | undefined): Tab {
  const vals: Tab[] = ["painel", "quadro", "fluxo"];
  return (vals as string[]).includes(t ?? "") ? (t as Tab) : "painel";
}
