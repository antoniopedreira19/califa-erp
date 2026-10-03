import { Palmtree } from "lucide-react";
import type {
  ColaboradorFeriasPeriodo,
  ColaboradorFeriasLancamento,
  FeriasPeriodoStatus,
  TipoContratacao,
} from "@/lib/types";
import { SolicitarFeriasDrawer } from "./solicitar-ferias-drawer";

type Props = {
  periodos: ColaboradorFeriasPeriodo[];
  lancamentos: ColaboradorFeriasLancamento[];
  tipoContratacao: TipoContratacao;
};

export function CardMinhasFerias({
  periodos,
  lancamentos,
  tipoContratacao,
}: Props) {
  // Dias ocupados por período (aprovado + concluído + pendente + em análise).
  // Pra UI do colaborador, "saldo" é o que ele PODE pedir — então também
  // desconta solicitações pendentes/em análise, senão pedia duas vezes a mesma coisa.
  const diasOcupadosPorPeriodo = new Map<string, number>();
  for (const l of lancamentos) {
    if (!l.periodo_id) continue;
    if (
      l.status !== "aprovado" &&
      l.status !== "concluido" &&
      l.status !== "pendente_aprovacao" &&
      l.status !== "em_analise"
    )
      continue;
    diasOcupadosPorPeriodo.set(
      l.periodo_id,
      (diasOcupadosPorPeriodo.get(l.periodo_id) ?? 0) + l.dias,
    );
  }

  // "Usados" para a barra de progresso = só aprovado/concluído (pendentes não
  // devem parecer "já tirados" na timeline visual).
  const diasUsadosPorPeriodo = new Map<string, number>();
  for (const l of lancamentos) {
    if (!l.periodo_id) continue;
    if (l.status !== "aprovado" && l.status !== "concluido") continue;
    diasUsadosPorPeriodo.set(
      l.periodo_id,
      (diasUsadosPorPeriodo.get(l.periodo_id) ?? 0) + l.dias,
    );
  }

  // Períodos "ativos pra ação" exibidos no card do /perfil: apto,
  // em_alerta e vencido. Passados regularizados e futuros em curso
  // ficam escondidos — o colaborador só precisa ver o que pode
  // agendar ou o que já estourou prazo.
  const periodosAtivos = periodos.filter(
    (p) =>
      p.status === "apto" ||
      p.status === "em_alerta" ||
      p.status === "vencido",
  );

  // Saldo exibido no hero = dias que o colaborador ainda pode solicitar
  // em períodos aptos ou em alerta.
  const periodosComSaldo = periodos
    .filter((p) => p.status === "apto" || p.status === "em_alerta")
    .map((p) => ({
      ...p,
      saldo: Math.max(
        p.dias_direito - (diasOcupadosPorPeriodo.get(p.id) ?? 0),
        0,
      ),
    }));

  const saldoDisponivel = periodosComSaldo.reduce((a, p) => a + p.saldo, 0);

  // Status principal: pega o pior entre "vencido", "em_alerta", "apto".
  const temVencido = periodos.some((p) => p.status === "vencido");
  const temAlerta = periodos.some((p) => p.status === "em_alerta");
  const temApto = periodos.some((p) => p.status === "apto");

  const statusPrincipal: {
    label: string;
    tom: "ruim" | "atencao" | "bom" | "neutro";
  } = temVencido
    ? { label: "Férias vencidas", tom: "ruim" }
    : temAlerta
      ? { label: "Férias em alerta", tom: "atencao" }
      : temApto
        ? { label: "Apto a tirar férias", tom: "bom" }
        : { label: "Ainda não há direito", tom: "neutro" };

  // Próximo vencimento = o data_limite_gozo mais próximo entre os apto/em_alerta.
  // Usamos data_limite_gozo (= aquisitivo_fim + 11 meses) e não concessivo_fim
  // porque é a data em que o colaborador precisa ter COMEÇADO as férias — é
  // o deadline operacional, não o legal.
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const proximosVencimentos = periodos
    .filter((p) => p.status === "apto" || p.status === "em_alerta")
    .map((p) => new Date(p.data_limite_gozo + "T00:00:00"))
    .sort((a, b) => a.getTime() - b.getTime());
  const proximoVencimento = proximosVencimentos[0];
  const diasAteProximo = proximoVencimento
    ? Math.ceil(
        (proximoVencimento.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24),
      )
    : null;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Palmtree className="h-4 w-4 text-california-red" />
          </div>
          <h2 className="text-lg font-semibold">Minhas férias</h2>
        </div>
        <SolicitarFeriasDrawer
          periodos={periodosComSaldo}
          tipoContratacao={tipoContratacao}
        />
      </div>

      {/* Hero: saldo + status + próximo vencimento */}
      <div className="rounded-xl bg-muted/40 p-5 mb-6">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Saldo disponível
            </p>
            <p className="mt-1 text-4xl font-bold tracking-tight">
              {saldoDisponivel}{" "}
              <span className="text-lg font-medium text-muted-foreground">
                dias
              </span>
            </p>
          </div>
          <div className="text-right">
            <SelogStatus tom={statusPrincipal.tom}>
              {statusPrincipal.label}
            </SelogStatus>
            {proximoVencimento && diasAteProximo !== null && (
              <p className="mt-2 text-xs text-muted-foreground">
                Precisa agendar até:{" "}
                <span className="font-medium text-foreground">
                  {proximoVencimento.toLocaleDateString("pt-BR")}
                </span>{" "}
                <span
                  className={
                    diasAteProximo < 0
                      ? "text-red-700 font-medium"
                      : diasAteProximo <= 60
                        ? "text-amber-700 font-medium"
                        : ""
                  }
                >
                  (
                  {diasAteProximo >= 0
                    ? `em ${diasAteProximo} dias`
                    : `há ${-diasAteProximo} dias`}
                  )
                </span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Períodos ATIVOS pra ação (apto / em_alerta / vencido).
       *  Passados regularizados e futuros em curso são escondidos no
       *  /perfil — o colaborador só precisa ver o que pode agendar
       *  agora. O histórico completo fica no modal de RH, não aqui. */}
      <div>
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {periodosAtivos.length <= 1
            ? "Período em aberto"
            : "Períodos em aberto"}
        </p>
        {periodosAtivos.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground text-center">
            Nenhum período com saldo disponível no momento.
          </p>
        ) : (
          <ul className="space-y-3">
            {periodosAtivos.map((p) => {
              const usados = diasUsadosPorPeriodo.get(p.id) ?? 0;
              const pct = Math.min((usados / p.dias_direito) * 100, 100);
              return (
                <li
                  key={p.id}
                  className="rounded-lg border border-border p-3 bg-background"
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-medium">
                        Período {anoCurto(p.aquisitivo_inicio)}/
                        {anoCurto(p.aquisitivo_fim)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Aquisitivo:{" "}
                        {new Date(
                          p.aquisitivo_inicio + "T00:00:00",
                        ).toLocaleDateString("pt-BR")}{" "}
                        a{" "}
                        {new Date(
                          p.aquisitivo_fim + "T00:00:00",
                        ).toLocaleDateString("pt-BR")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Precisa agendar até:{" "}
                        <span className="font-medium text-foreground">
                          {new Date(
                            p.data_limite_gozo + "T00:00:00",
                          ).toLocaleDateString("pt-BR")}
                        </span>
                      </p>
                    </div>
                    <BadgeStatusPeriodo status={p.status} />
                  </div>
                  <div className="mt-3">
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-california-red transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {usados} de {p.dias_direito} dias usufruídos ·{" "}
                      <span className="font-medium text-foreground">
                        {Math.max(p.dias_direito - usados, 0)} dias pendentes
                      </span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function anoCurto(d: string): string {
  // "2025-07-01" → "2025"
  return d.slice(0, 4);
}

function SelogStatus({
  tom,
  children,
}: {
  tom: "ruim" | "atencao" | "bom" | "neutro";
  children: React.ReactNode;
}) {
  const cores: Record<typeof tom, string> = {
    ruim: "bg-red-100 text-red-800",
    atencao: "bg-amber-100 text-amber-900",
    bom: "bg-emerald-100 text-emerald-800",
    neutro: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${cores[tom]}`}
    >
      {children}
    </span>
  );
}

function BadgeStatusPeriodo({ status }: { status: FeriasPeriodoStatus }) {
  const map: Record<FeriasPeriodoStatus, { label: string; cls: string }> = {
    incompleto: { label: "Em curso", cls: "bg-muted text-muted-foreground" },
    apto: { label: "Apto", cls: "bg-emerald-100 text-emerald-800" },
    em_alerta: { label: "Em alerta", cls: "bg-amber-100 text-amber-900" },
    vencido: { label: "Vencido", cls: "bg-red-100 text-red-800" },
    regularizado: {
      label: "Regularizado",
      cls: "bg-sky-100 text-sky-800",
    },
    nao_habilitado: {
      label: "Não habilitado",
      cls: "bg-muted text-muted-foreground",
    },
    pago_rescisao: {
      label: "Pago em rescisão",
      cls: "bg-slate-200 text-slate-700",
    },
  };
  const info = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${info.cls}`}
    >
      {info.label}
    </span>
  );
}

