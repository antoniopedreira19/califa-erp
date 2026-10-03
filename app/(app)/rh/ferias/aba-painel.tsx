import Link from "next/link";
import {
  ArrowRight,
  Palmtree,
  CalendarCheck,
  Clock,
  AlertTriangle,
  AlertOctagon,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type {
  ColaboradorFeriasLancamento,
  ColaboradorFeriasPeriodo,
  FeriasLancamentoStatus,
  FeriasLancamentoTipo,
} from "@/lib/types";

type Props = {
  tenantId: string;
};

export async function AbaPainel({ tenantId }: Props) {
  const supabase = createClient();

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const hojeISO = hoje.toISOString().slice(0, 10);

  const semana = new Date(hoje);
  semana.setDate(hoje.getDate() + 7);
  const semanaISO = semana.toISOString().slice(0, 10);

  const [
    aguardandoRes,
    emAlertaRes,
    vencidasRes,
    emFeriasHojeRes,
    pendentesRes,
    retornosRes,
    vencendoRes,
    emFeriasRes,
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
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select(
        "id, tipo, dias, data_inicio, data_fim, status, created_at, colaborador:colaboradores!colaborador_id(id, nome, tipo_contratacao)",
      )
      .eq("tenant_id", tenantId)
      .in("status", ["pendente_aprovacao", "em_analise"])
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select(
        "id, dias, data_inicio, data_fim, colaborador:colaboradores!colaborador_id(id, nome)",
      )
      .eq("tenant_id", tenantId)
      .eq("status", "aprovado")
      .gte("data_fim", hojeISO)
      .lte("data_fim", semanaISO)
      .order("data_fim", { ascending: true })
      .limit(10),
    supabase
      .from("colaboradores_ferias_periodos")
      .select(
        "id, numero, aquisitivo_inicio, aquisitivo_fim, concessivo_fim, data_limite_gozo, status, colaborador:colaboradores!colaborador_id(id, nome)",
      )
      .eq("tenant_id", tenantId)
      .in("status", ["em_alerta", "apto"])
      .order("data_limite_gozo", { ascending: true })
      .limit(5),
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select(
        "id, dias, data_inicio, data_fim, colaborador:colaboradores!colaborador_id(id, nome)",
      )
      .eq("tenant_id", tenantId)
      .eq("status", "aprovado")
      .lte("data_inicio", hojeISO)
      .gte("data_fim", hojeISO)
      .limit(10),
  ]);

  const kpis = {
    aguardando: aguardandoRes.count ?? 0,
    emAlerta: emAlertaRes.count ?? 0,
    vencidas: vencidasRes.count ?? 0,
    emFeriasHoje: emFeriasHojeRes.count ?? 0,
  };

  type Lanc = ColaboradorFeriasLancamento & {
    colaborador: { id: string; nome: string; tipo_contratacao?: string } | null;
  };
  type Periodo = ColaboradorFeriasPeriodo & {
    colaborador: { id: string; nome: string } | null;
  };

  const pendentes = (pendentesRes.data ?? []) as unknown as Lanc[];
  const retornos = (retornosRes.data ?? []) as unknown as Lanc[];
  const vencendo = (vencendoRes.data ?? []) as unknown as Periodo[];
  const emFerias = (emFeriasRes.data ?? []) as unknown as Lanc[];

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          href="/rh/ferias?tab=solicitacoes&status=pendente_aprovacao"
          icon={Clock}
          label="Aguardando aprovação"
          value={kpis.aguardando}
          tom="atencao"
        />
        <KpiCard
          href="/rh/ferias?tab=quadro"
          icon={AlertTriangle}
          label="Concessivos em alerta"
          value={kpis.emAlerta}
          tom="aviso"
          hint="≤ 60 dias"
        />
        <KpiCard
          href="/rh/ferias?tab=quadro"
          icon={AlertOctagon}
          label="Férias vencidas"
          value={kpis.vencidas}
          tom="urgente"
        />
        <KpiCard
          icon={Users}
          label="Em férias hoje"
          value={kpis.emFeriasHoje}
          tom="neutro"
        />
      </div>

      {/* Grid de seções */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Solicitações pendentes */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <header className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">Solicitações pendentes</h3>
            <Link
              href="/rh/ferias?tab=solicitacoes"
              prefetch={false}
              className="inline-flex items-center gap-1 text-xs font-semibold text-california-red hover:underline"
            >
              Ver todas <ArrowRight className="h-3 w-3" />
            </Link>
          </header>
          {pendentes.length === 0 ? (
            <EmptyLine texto="Nenhuma solicitação aguardando." />
          ) : (
            <ul className="divide-y divide-border">
              {pendentes.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center justify-between py-3 gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {l.colaborador?.nome ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {tipoLabel(l.tipo)} · {l.dias}{" "}
                      {l.dias === 1 ? "dia" : "dias"} ·{" "}
                      {formatarDataCurta(l.data_inicio)} a{" "}
                      {formatarDataCurta(l.data_fim)}
                    </p>
                  </div>
                  <StatusBadge status={l.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Em férias hoje */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <header className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Palmtree className="h-4 w-4 text-california-red" />
              Em férias hoje
            </h3>
            <span className="text-xs text-muted-foreground">
              {emFerias.length}{" "}
              {emFerias.length === 1 ? "pessoa" : "pessoas"}
            </span>
          </header>
          {emFerias.length === 0 ? (
            <EmptyLine texto="Nenhum colaborador em férias hoje." />
          ) : (
            <ul className="space-y-2">
              {emFerias.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {l.colaborador?.nome ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Volta em {formatarDataCurta(l.data_fim)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Retornos esta semana */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <header className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold flex items-center gap-2">
              <CalendarCheck className="h-4 w-4 text-california-red" />
              Retornos esta semana
            </h3>
            <span className="text-xs text-muted-foreground">
              próximos 7 dias
            </span>
          </header>
          {retornos.length === 0 ? (
            <EmptyLine texto="Ninguém volta de férias esta semana." />
          ) : (
            <ul className="divide-y divide-border">
              {retornos.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center justify-between py-3 gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {l.colaborador?.nome ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Volta em {formatarDataCurta(l.data_fim)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Concessivos vencendo */}
        <section className="rounded-2xl border border-border bg-card p-6 shadow-soft">
          <header className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-california-red" />
              Concessivos vencendo
            </h3>
            <span className="text-xs text-muted-foreground">top 5</span>
          </header>
          {vencendo.length === 0 ? (
            <EmptyLine texto="Nenhum concessivo próximo do vencimento." />
          ) : (
            <ul className="divide-y divide-border">
              {vencendo.map((p) => {
                const fim = new Date(p.data_limite_gozo + "T00:00:00");
                const diasRest = Math.ceil(
                  (fim.getTime() - new Date().getTime()) / 86_400_000,
                );
                const tom =
                  p.status === "em_alerta"
                    ? "text-amber-700"
                    : "text-foreground";
                return (
                  <li
                    key={p.id}
                    className="flex items-center justify-between py-3 gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {p.colaborador?.nome ?? "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Período #{p.numero} · {p.aquisitivo_inicio.slice(0, 4)}/
                        {p.aquisitivo_fim.slice(0, 4)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-medium ${tom}`}>
                        {diasRest > 0
                          ? `${diasRest} dias`
                          : `vencido há ${-diasRest} dias`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatarDataCurta(p.data_limite_gozo)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

    </div>
  );
}

function KpiCard({
  href,
  icon: Icon,
  label,
  value,
  tom,
  hint,
}: {
  href?: string;
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
  const conteudo = (
    <>
      <div className="flex items-center justify-between">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${cls.icon}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-4 text-3xl font-bold tracking-tight">{value}</p>
      <p className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        prefetch={false}
        className={`group block rounded-2xl border ${cls.chip} p-5 shadow-soft transition-all hover:shadow-elevated`}
      >
        {conteudo}
      </Link>
    );
  }
  return (
    <div className={`rounded-2xl border ${cls.chip} p-5 shadow-soft`}>
      {conteudo}
    </div>
  );
}

function EmptyLine({ texto }: { texto: string }) {
  return (
    <p className="text-sm text-muted-foreground text-center py-6">{texto}</p>
  );
}

function formatarDataCurta(d: string): string {
  const parsed = new Date(d + "T00:00:00");
  return parsed.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function tipoLabel(t: FeriasLancamentoTipo): string {
  switch (t) {
    case "usufruto":
      return "Férias";
    case "abono_combinado":
      return "Abono combinado";
    case "abono_avulso":
      return "Abono avulso";
    case "abono_excepcional":
      return "Abono excepcional";
  }
}

function StatusBadge({ status }: { status: FeriasLancamentoStatus }) {
  const map: Record<FeriasLancamentoStatus, { label: string; cls: string }> = {
    pendente_aprovacao: {
      label: "Pendente",
      cls: "bg-amber-100 text-amber-900",
    },
    em_analise: { label: "Em análise", cls: "bg-sky-100 text-sky-800" },
    aprovado: { label: "Aprovado", cls: "bg-emerald-100 text-emerald-800" },
    reprovado: { label: "Reprovado", cls: "bg-red-100 text-red-800" },
    cancelado: { label: "Cancelado", cls: "bg-muted text-muted-foreground" },
    concluido: { label: "Concluído", cls: "bg-slate-200 text-slate-700" },
  };
  const info = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${info.cls}`}
    >
      {info.label}
    </span>
  );
}
