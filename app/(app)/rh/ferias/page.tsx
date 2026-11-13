import { redirect } from "next/navigation";
import Link from "next/link";
import { Palmtree } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { AbaPainel } from "./aba-painel";
import { AbaQuadro } from "./aba-quadro";
import { AbaFluxo } from "./aba-fluxo";
import { AbaPendencias } from "./aba-pendencias";

export const dynamic = "force-dynamic";

type Tab = "dashboard" | "solicitacoes" | "colaboradores" | "pendencias";

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

  // Rotas antigas redirecionam pras novas (compat com links salvos).
  if (searchParams.tab === "painel") {
    redirect("/rh/ferias?tab=dashboard");
  }
  if (searchParams.tab === "quadro") {
    redirect("/rh/ferias?tab=colaboradores");
  }
  if (searchParams.tab === "fluxo" || searchParams.tab === "pagamentos") {
    redirect("/rh/ferias?tab=solicitacoes");
  }

  const tab: Tab = normalizarTab(searchParams.tab);

  // Badge da tab Solicitações: pendentes de aprovação + NF anexada
  // (ambos exigem ação do RH — pendente precisa aprovar, nf_anexada
  // precisa clicar "Enviar pro Financeiro"). Puxado no server pra
  // aparecer já na renderização inicial.
  const supabase = createClient();
  const { count: countParaAgir } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .in("status", ["pendente_aprovacao", "nf_anexada"]);

  const tabsConfig: { key: Tab; label: string; badge?: number }[] = [
    { key: "dashboard", label: "Dashboard" },
    {
      key: "solicitacoes",
      label: "Solicitações",
      badge: countParaAgir ?? 0,
    },
    { key: "colaboradores", label: "Colaboradores" },
    { key: "pendencias", label: "Pendências" },
  ];

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
          {tabsConfig.map((t) => {
            const ativo = t.key === tab;
            const temBadge = typeof t.badge === "number" && t.badge > 0;
            return (
              <Link
                key={t.key}
                href={`/rh/ferias?tab=${t.key}`}
                prefetch={false}
                className={`px-1 pb-3 text-sm font-medium transition-colors border-b-2 -mb-px inline-flex items-center gap-1.5 ${
                  ativo
                    ? "border-california-red text-california-red"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>{t.label}</span>
                {temBadge && (
                  <span
                    className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${
                      ativo
                        ? "bg-california-red text-white"
                        : "bg-california-red/10 text-california-red"
                    }`}
                  >
                    {t.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {tab === "dashboard" && <AbaPainel tenantId={tenantId} />}
      {tab === "solicitacoes" && <AbaFluxo tenantId={tenantId} />}
      {tab === "colaboradores" && <AbaQuadro tenantId={tenantId} />}
      {tab === "pendencias" && <AbaPendencias tenantId={tenantId} />}
    </div>
  );
}

function normalizarTab(t: string | undefined): Tab {
  const vals: Tab[] = ["dashboard", "solicitacoes", "colaboradores", "pendencias"];
  return (vals as string[]).includes(t ?? "") ? (t as Tab) : "dashboard";
}
