import { notFound } from "next/navigation";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import type {
  ColaboradorFeriasLancamento,
  ColaboradorFeriasPeriodo,
  FeriasPeriodoStatus,
  TipoContratacao,
} from "@/lib/types";
import { HistoricoColapsavel } from "./historico-colapsavel";
import { BotaoLancarDiretoCliente } from "./botao-lancar-direto";
import { HeroColaboradorFerias } from "./hero-colaborador-ferias";

export const dynamic = "force-dynamic";

export default async function ColaboradorFeriasPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    notFound();
  }
  const tenantId = session.activeTenant.id;

  const supabase = createClient();
  const [colabRes, periodosRes, lancsRes, salarioRes, alocacaoRes] =
    await Promise.all([
      supabase
        .from("colaboradores")
        .select(
          "id, nome, tipo_contratacao, funcao, data_admissao, status, email",
        )
        .eq("id", params.id)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      supabase
        .from("colaboradores_ferias_periodos")
        .select(
          "id, numero, aquisitivo_inicio, aquisitivo_fim, concessivo_inicio, concessivo_fim, data_limite_gozo, dias_direito, status",
        )
        .eq("colaborador_id", params.id)
        .eq("tenant_id", tenantId)
        .order("numero"),
      supabase
        .from("colaboradores_ferias_lancamentos")
        .select(
          "id, periodo_id, tipo, dias, dias_abono, data_inicio, data_fim, status, observacao, lancado_direto_por_rh, valor_total",
        )
        .eq("colaborador_id", params.id)
        .eq("tenant_id", tenantId)
        .order("data_inicio", { ascending: false }),
      supabase
        .from("colaboradores_salarios")
        .select("valor, valor_recibo, data_inicio")
        .eq("colaborador_id", params.id)
        .is("data_fim", null)
        .order("data_inicio", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("colaboradores_alocacoes")
        .select(
          "id, empresa_id, regional_id, usa_rateio_empresa, data_inicio, empresa:empresas(nome), regional:regionais(nome)",
        )
        .eq("colaborador_id", params.id)
        .is("data_fim", null)
        .limit(1)
        .maybeSingle(),
    ]);

  if (!colabRes.data) notFound();
  const c = colabRes.data as {
    id: string;
    nome: string;
    tipo_contratacao: TipoContratacao;
    funcao: string | null;
    data_admissao: string | null;
    status: string;
    email: string | null;
  };
  const periodos = (periodosRes.data ?? []) as ColaboradorFeriasPeriodo[];
  const lancamentos = (lancsRes.data ?? []) as ColaboradorFeriasLancamento[];
  const salario = salarioRes.data as {
    valor: string | number | null;
    valor_recibo: string | number | null;
    data_inicio: string | null;
  } | null;
  const alocacao = alocacaoRes.data as {
    empresa: { nome: string } | null;
    regional: { nome: string } | null;
    usa_rateio_empresa: boolean | null;
  } | null;

  // Saldo por período (dias de direito − dias já usados/ocupados)
  const diasOcupados = new Map<string, number>();
  for (const l of lancamentos) {
    if (!l.periodo_id) continue;
    if (
      l.status !== "aprovado" &&
      l.status !== "concluido" &&
      l.status !== "pendente_aprovacao"
    ) {
      continue;
    }
    diasOcupados.set(
      l.periodo_id,
      (diasOcupados.get(l.periodo_id) ?? 0) + l.dias,
    );
  }

  // Períodos ativos (que precisam de ação): apto, em_alerta, vencido
  const periodosAtivos = periodos.filter(
    (p) =>
      p.status === "apto" ||
      p.status === "em_alerta" ||
      p.status === "vencido",
  );

  const saldoTotal = periodosAtivos.reduce((acc, p) => {
    const ocupados = diasOcupados.get(p.id) ?? 0;
    return acc + Math.max(p.dias_direito - ocupados, 0);
  }, 0);

  const salarioNum = salario?.valor != null ? Number(salario.valor) : null;
  const regionalLabel = alocacao?.usa_rateio_empresa
    ? "Rateio da empresa"
    : (alocacao?.regional?.nome ?? null);

  const botaoLancar = (
    <BotaoLancarDiretoCliente
      colaboradorId={c.id}
      tipoContratacao={c.tipo_contratacao}
      periodos={periodos.map((p) => ({
        ...p,
        saldo: Math.max(
          p.dias_direito - (diasOcupados.get(p.id) ?? 0),
          0,
        ),
      }))}
    />
  );

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto">
      <BotaoVoltar reserva="/rh/ferias?tab=colaboradores" />

      <HeroColaboradorFerias
        nome={c.nome}
        tipo_contratacao={c.tipo_contratacao}
        funcao={c.funcao}
        data_admissao={c.data_admissao}
        email={c.email}
        status={c.status}
        saldoDias={saldoTotal}
        salario={salarioNum}
        empresa={alocacao?.empresa?.nome ?? null}
        regional={regionalLabel}
        botaoLancar={botaoLancar}
      />

      {/* Situação atual */}
      {periodosAtivos.length === 0 ? (
        <div className="rounded-xl border border-border bg-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum período de férias disponível no momento.
          </p>
        </div>
      ) : (
        <section className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {periodosAtivos.length === 1
              ? "Situação atual"
              : `Períodos pra tirar (${periodosAtivos.length})`}
          </h2>
          <div className="space-y-3">
            {periodosAtivos.map((p) => {
              const usados = lancamentos
                .filter(
                  (l) =>
                    l.periodo_id === p.id &&
                    (l.status === "aprovado" || l.status === "concluido"),
                )
                .reduce((acc, l) => acc + l.dias, 0);
              const ocupados = diasOcupados.get(p.id) ?? 0;
              return (
                <HeroPeriodo
                  key={p.id}
                  periodo={p}
                  usados={usados}
                  saldo={Math.max(p.dias_direito - ocupados, 0)}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* Histórico colapsável */}
      {lancamentos.length > 0 && (
        <HistoricoColapsavel
          lancamentos={lancamentos.map((l) => ({
            id: l.id,
            tipo: l.tipo,
            dias: l.dias,
            dias_abono: l.dias_abono ?? 0,
            data_inicio: l.data_inicio,
            data_fim: l.data_fim,
            status: l.status,
            observacao: l.observacao,
            lancado_direto_por_rh: l.lancado_direto_por_rh ?? false,
            valor_total: l.valor_total ? Number(l.valor_total) : null,
          }))}
          tipoContratacao={c.tipo_contratacao}
        />
      )}
    </div>
  );
}

/* --------------------- HERO DE PERÍODO --------------------- */

function HeroPeriodo({
  periodo: p,
  usados,
  saldo,
}: {
  periodo: ColaboradorFeriasPeriodo;
  usados: number;
  saldo: number;
}) {
  const pct = Math.min((usados / p.dias_direito) * 100, 100);
  const rotulo = `${p.aquisitivo_inicio.slice(0, 4)}/${p.aquisitivo_fim.slice(0, 4)}`;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const limite = new Date(p.data_limite_gozo + "T00:00:00");
  const dif = Math.ceil((limite.getTime() - hoje.getTime()) / 86_400_000);

  const tom: Record<
    "vencido" | "em_alerta" | "apto",
    {
      borda: string;
      bg: string;
      icone: React.ReactNode;
      textoPrazo: string;
    }
  > = {
    vencido: {
      borda: "border-red-300",
      bg: "bg-red-50/60",
      icone: <AlertOctagon className="h-5 w-5 text-red-700" />,
      textoPrazo: `há ${-dif} dias`,
    },
    em_alerta: {
      borda: "border-amber-300",
      bg: "bg-amber-50/60",
      icone: <AlertTriangle className="h-5 w-5 text-amber-700" />,
      textoPrazo: `em ${dif} dias`,
    },
    apto: {
      borda: "border-emerald-300",
      bg: "bg-emerald-50/40",
      icone: <CheckCircle2 className="h-5 w-5 text-emerald-700" />,
      textoPrazo: `em ${dif} dias`,
    },
  };
  const t = tom[p.status as "vencido" | "em_alerta" | "apto"] ?? tom.apto;

  return (
    <div className={`rounded-xl border-2 ${t.borda} ${t.bg} p-5`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {t.icone}
          <div>
            <p className="text-sm font-semibold">Período aquisitivo {rotulo}</p>
            <p className="text-xs text-muted-foreground">
              De{" "}
              {new Date(p.aquisitivo_inicio + "T00:00:00").toLocaleDateString(
                "pt-BR",
              )}{" "}
              a{" "}
              {new Date(p.aquisitivo_fim + "T00:00:00").toLocaleDateString(
                "pt-BR",
              )}
            </p>
          </div>
        </div>
        <BadgePeriodo status={p.status} />
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Saldo pra tirar
          </p>
          <p className="mt-1 text-3xl font-bold tracking-tight leading-none">
            {saldo}
            <span className="text-sm font-medium text-muted-foreground ml-1">
              dias
            </span>
          </p>
          <div className="mt-3 h-1.5 w-full rounded-full bg-white/80 overflow-hidden">
            <div
              className="h-full bg-california-red"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {usados}/{p.dias_direito} dias já gozados
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Prazo final
          </p>
          <p className="mt-1 text-lg font-semibold">
            {new Date(p.data_limite_gozo + "T00:00:00").toLocaleDateString(
              "pt-BR",
            )}
          </p>
          <p className="text-xs text-muted-foreground">{t.textoPrazo}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Concessivo
          </p>
          <p className="mt-1 text-sm">
            até{" "}
            {new Date(p.concessivo_fim + "T00:00:00").toLocaleDateString(
              "pt-BR",
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

function BadgePeriodo({ status }: { status: FeriasPeriodoStatus }) {
  const map: Record<FeriasPeriodoStatus, { label: string; cls: string }> = {
    incompleto: { label: "Em curso", cls: "bg-muted text-muted-foreground" },
    apto: { label: "Apto", cls: "bg-emerald-100 text-emerald-800" },
    em_alerta: { label: "Em alerta", cls: "bg-amber-100 text-amber-900" },
    vencido: { label: "Vencido", cls: "bg-red-100 text-red-800" },
    regularizado: { label: "Regularizado", cls: "bg-sky-100 text-sky-800" },
    nao_habilitado: {
      label: "N/habilitado",
      cls: "bg-muted text-muted-foreground",
    },
    pago_rescisao: {
      label: "Pago rescis.",
      cls: "bg-slate-200 text-slate-700",
    },
  };
  const info = map[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0 ${info.cls}`}
    >
      {info.label}
    </span>
  );
}

