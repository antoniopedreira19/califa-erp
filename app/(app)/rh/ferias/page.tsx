import { redirect } from "next/navigation";
import Link from "next/link";
import { Palmtree } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import type { FeriasLancamentoStatus } from "@/lib/types";
import { AbaPainel } from "./aba-painel";
import { AbaSolicitacoes } from "./aba-solicitacoes";
import { AbaQuadro } from "./aba-quadro";

export const dynamic = "force-dynamic";

type Tab = "painel" | "quadro" | "solicitacoes";

const TABS: { key: Tab; label: string }[] = [
  { key: "painel", label: "Painel" },
  { key: "quadro", label: "Quadro" },
  { key: "solicitacoes", label: "Solicitações" },
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
  const tab: Tab = normalizarTab(searchParams.tab);

  return (
    <div className="space-y-6 max-w-[1480px] mx-auto">
      <BotaoVoltar reserva="/rh" />
      <PageHeader
        eyebrow="RH"
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

      {tab === "painel" && (
        <AbaPainel tenantId={tenantId} userId={session.profile.id} />
      )}
      {tab === "quadro" && <AbaQuadro tenantId={tenantId} />}
      {tab === "solicitacoes" && (
        <AbaSolicitacoes
          tenantId={tenantId}
          statusFiltro={normalizarStatus(searchParams.status)}
        />
      )}
    </div>
  );
}

function normalizarTab(t: string | undefined): Tab {
  const vals: Tab[] = ["painel", "quadro", "solicitacoes"];
  return (vals as string[]).includes(t ?? "") ? (t as Tab) : "painel";
}

function normalizarStatus(s: string | undefined): FeriasLancamentoStatus | "todos" {
  const valores: FeriasLancamentoStatus[] = [
    "pendente_aprovacao",
    "em_analise",
    "aprovado",
    "reprovado",
    "cancelado",
    "concluido",
  ];
  if (s && (valores as string[]).includes(s)) {
    return s as FeriasLancamentoStatus;
  }
  return "pendente_aprovacao";
}
