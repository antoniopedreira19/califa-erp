import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Palmtree,
  Clock,
  AlertTriangle,
  AlertOctagon,
  Users,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import type { FeriasLancamentoStatus } from "@/lib/types";
import { AbaPainel } from "./aba-painel";
import { AbaSolicitacoes } from "./aba-solicitacoes";
import { AbaQuadro } from "./aba-quadro";
import { AbaCalendario } from "./aba-calendario";
import { AbaNotificacoes } from "./aba-notificacoes";
import { AbaRescisoes } from "./aba-rescisoes";

export const dynamic = "force-dynamic";

type Tab =
  | "painel"
  | "solicitacoes"
  | "quadro"
  | "calendario"
  | "rescisoes"
  | "notificacoes";
const TABS: { key: Tab; label: string }[] = [
  { key: "painel", label: "Painel" },
  { key: "solicitacoes", label: "Solicitações" },
  { key: "quadro", label: "Quadro" },
  { key: "calendario", label: "Calendário" },
  { key: "rescisoes", label: "Rescisões" },
  { key: "notificacoes", label: "Notificações" },
];

export default async function FeriasPage({
  searchParams,
}: {
  searchParams: {
    tab?: string;
    status?: string;
    busca?: string;
    tipo_contr?: string;
    status_periodo?: string;
    mes?: string;
    colab?: string;
    notif_tipo?: string;
    nao_lidas?: string;
  };
}) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const tab: Tab = normalizarTab(searchParams.tab);

  const hojeISO = new Date().toISOString().slice(0, 10);
  const em30 = new Date();
  em30.setDate(em30.getDate() + 60);
  const em60ISO = em30.toISOString().slice(0, 10);

  // KPIs — queries agregadas, não embeds pesados
  const [
    aguardandoRes,
    emAlertaRes,
    vencidasRes,
    emFeriasHojeRes,
  ] = await Promise.all([
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("status", ["pendente_aprovacao", "em_analise"]),
    supabase
      .from("colaboradores_ferias_periodos")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "em_alerta"),
    supabase
      .from("colaboradores_ferias_periodos")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "vencido"),
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "aprovado")
      .lte("data_inicio", hojeISO)
      .gte("data_fim", hojeISO),
  ]);

  const kpis = {
    aguardando: aguardandoRes.count ?? 0,
    emAlerta: emAlertaRes.count ?? 0,
    vencidas: vencidasRes.count ?? 0,
    emFeriasHoje: emFeriasHojeRes.count ?? 0,
  };

  return (
    <div className="space-y-6 max-w-[1480px] mx-auto">
      <BotaoVoltar reserva="/rh" />
      <PageHeader
        eyebrow="RH"
        title="Gestão de Férias"
        description="Painel de solicitações, concessivos vencendo, calendário de ausências e rescisões."
        icon={Palmtree}
      />

      {/* KPIs clicáveis */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          href="/rh/ferias?tab=solicitacoes&status=pendente_aprovacao"
          icon={Clock}
          label="Aguardando aprovação"
          value={kpis.aguardando}
          tom="atencao"
        />
        <KpiCard
          href="/rh/ferias?tab=painel"
          icon={AlertTriangle}
          label="Concessivos em alerta"
          value={kpis.emAlerta}
          tom="aviso"
          hint="≤ 60 dias"
        />
        <KpiCard
          href="/rh/ferias?tab=painel"
          icon={AlertOctagon}
          label="Férias vencidas"
          value={kpis.vencidas}
          tom="urgente"
        />
        <KpiCard
          href="/rh/ferias?tab=painel"
          icon={Users}
          label="Em férias hoje"
          value={kpis.emFeriasHoje}
          tom="neutro"
        />
      </div>

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
      {tab === "solicitacoes" && (
        <AbaSolicitacoes
          tenantId={tenantId}
          statusFiltro={normalizarStatus(searchParams.status)}
        />
      )}
      {tab === "quadro" && (
        <AbaQuadro
          tenantId={tenantId}
          busca={searchParams.busca ?? ""}
          tipoContratacao={searchParams.tipo_contr ?? ""}
          statusPeriodo={searchParams.status_periodo ?? ""}
          colaboradorSelecionadoId={searchParams.colab}
        />
      )}
      {tab === "calendario" && (
        <AbaCalendario
          tenantId={tenantId}
          mesParam={searchParams.mes}
        />
      )}
      {tab === "notificacoes" && (
        <AbaNotificacoes
          tenantId={tenantId}
          userId={session.profile.id}
          tipoFiltro={searchParams.notif_tipo}
          somenteNaoLidas={searchParams.nao_lidas === "1"}
        />
      )}
      {tab === "rescisoes" && (
        <AbaRescisoes
          tenantId={tenantId}
          colaboradorSelecionadoId={searchParams.colab}
        />
      )}
    </div>
  );
}

function normalizarTab(t: string | undefined): Tab {
  const vals: Tab[] = [
    "painel",
    "solicitacoes",
    "quadro",
    "calendario",
    "rescisoes",
    "notificacoes",
  ];
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

function KpiCard({
  href,
  icon: Icon,
  label,
  value,
  tom,
  hint,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tom: "atencao" | "aviso" | "urgente" | "neutro";
  hint?: string;
}) {
  const tomCls: Record<typeof tom, { chip: string; icon: string }> = {
    atencao: {
      chip: "bg-amber-50 border-amber-200",
      icon: "text-amber-700 bg-amber-100",
    },
    aviso: {
      chip: "bg-orange-50 border-orange-200",
      icon: "text-orange-700 bg-orange-100",
    },
    urgente: {
      chip: "bg-red-50 border-red-200",
      icon: "text-red-700 bg-red-100",
    },
    neutro: {
      chip: "bg-card border-border",
      icon: "text-california-red bg-california-red/10",
    },
  };
  const cls = tomCls[tom];
  return (
    <Link
      href={href}
      prefetch={false}
      className={`group block rounded-2xl border ${cls.chip} p-5 shadow-soft transition-all hover:shadow-elevated`}
    >
      <div className="flex items-center justify-between">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${cls.icon}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-4 text-3xl font-bold tracking-tight">{value}</p>
      <p className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {hint && (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      )}
    </Link>
  );
}
