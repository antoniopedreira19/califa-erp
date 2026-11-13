import Link from "next/link";
import {
  Sparkles,
  Clock,
  AlertTriangle,
  AlertOctagon,
  Palmtree,
  CalendarCheck,
  ChevronRight,
  FileText,
  CheckCircle2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import type {
  ColaboradorFeriasLancamento,
  ColaboradorFeriasPeriodo,
} from "@/lib/types";

type Props = {
  tenantId: string;
};

const DIAS_SEMANA = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];
const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export async function AbaPainel({ tenantId }: Props) {
  const session = await requireSession();
  const supabase = createClient();

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const hojeISO = hoje.toISOString().slice(0, 10);

  const semana = new Date(hoje);
  semana.setDate(hoje.getDate() + 7);
  const semanaISO = semana.toISOString().slice(0, 10);

  const seteDiasAtras = new Date(hoje);
  seteDiasAtras.setDate(hoje.getDate() - 7);
  const seteDiasAtrasISO = seteDiasAtras.toISOString().slice(0, 10);

  const [
    totalAtivosRes,
    vencidasRes,
    emAlertaRes,
    emFeriasHojeRes,
    saindoSemanaRes,
    voltandoSemanaRes,
    vencendoRes,
    novidadesCriadasRes,
    novidadesAprovadasRes,
  ] = await Promise.all([
    supabase
      .from("colaboradores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "ativo")
      .neq("tipo_contratacao", "socio"),
    supabase
      .from("colaboradores_ferias_periodos")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "vencido"),
    supabase
      .from("colaboradores_ferias_periodos")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "em_alerta"),
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select(
        "id, dias, data_inicio, data_fim, colaborador:colaboradores!colaborador_id(id, nome)",
      )
      .eq("tenant_id", tenantId)
      .in("status", ["aprovado", "concluido"])
      .lte("data_inicio", hojeISO)
      .gte("data_fim", hojeISO)
      .order("data_inicio", { ascending: true }),
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select(
        "id, dias, data_inicio, data_fim, colaborador:colaboradores!colaborador_id(id, nome)",
      )
      .eq("tenant_id", tenantId)
      .in("status", ["aprovado", "concluido"])
      .gt("data_inicio", hojeISO)
      .lte("data_inicio", semanaISO)
      .order("data_inicio", { ascending: true })
      .limit(10),
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select(
        "id, dias, data_inicio, data_fim, colaborador:colaboradores!colaborador_id(id, nome)",
      )
      .eq("tenant_id", tenantId)
      .in("status", ["aprovado", "concluido"])
      .gte("data_fim", hojeISO)
      .lte("data_fim", semanaISO)
      .order("data_fim", { ascending: true })
      .limit(10),
    supabase
      .from("colaboradores_ferias_periodos")
      .select(
        "id, numero, aquisitivo_inicio, aquisitivo_fim, data_limite_gozo, status, colaborador:colaboradores!colaborador_id(id, nome)",
      )
      .eq("tenant_id", tenantId)
      .in("status", ["vencido", "em_alerta"])
      .order("data_limite_gozo", { ascending: true })
      .limit(6),
    // Novidades: solicitações feitas nos últimos 7 dias
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select(
        "id, data_inicio, data_fim, dias, created_at, colaborador:colaboradores!colaborador_id(id, nome)",
      )
      .eq("tenant_id", tenantId)
      .eq("status", "pendente_aprovacao")
      .gte("created_at", seteDiasAtrasISO)
      .order("created_at", { ascending: false })
      .limit(5),
    // Novidades: aprovações nos últimos 7 dias (sem lançamento direto do RH
    // pra evitar poluir com import histórico)
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select(
        "id, data_inicio, data_fim, dias, aprovado_em, colaborador:colaboradores!colaborador_id(id, nome)",
      )
      .eq("tenant_id", tenantId)
      .in("status", ["aprovado", "concluido"])
      .eq("lancado_direto_por_rh", false)
      .gte("aprovado_em", seteDiasAtras.toISOString())
      .order("aprovado_em", { ascending: false })
      .limit(5),
  ]);

  const kpis = {
    vencidas: vencidasRes.count ?? 0,
    emAlerta: emAlertaRes.count ?? 0,
    emFeriasHoje: emFeriasHojeRes.data?.length ?? 0,
    retornosSemana: voltandoSemanaRes.data?.length ?? 0,
  };

  type Lanc = ColaboradorFeriasLancamento & {
    colaborador: { id: string; nome: string } | null;
    created_at?: string;
    aprovado_em?: string;
  };
  type Periodo = ColaboradorFeriasPeriodo & {
    colaborador: { id: string; nome: string } | null;
  };

  const emFerias = (emFeriasHojeRes.data ?? []) as unknown as Lanc[];
  const saindo = (saindoSemanaRes.data ?? []) as unknown as Lanc[];
  const voltando = (voltandoSemanaRes.data ?? []) as unknown as Lanc[];
  const vencendo = (vencendoRes.data ?? []) as unknown as Periodo[];
  const novidadesCriadas = (novidadesCriadasRes.data ?? []) as unknown as Lanc[];
  const novidadesAprovadas = (novidadesAprovadasRes.data ??
    []) as unknown as Lanc[];

  const totalAtivos = totalAtivosRes.count ?? 0;
  const primeiroNome = session.profile.nome.split(" ")[0];
  const agora = new Date();
  const dataFormatada =
    DIAS_SEMANA[agora.getDay()] +
    ", " +
    agora.getDate() +
    " de " +
    MESES[agora.getMonth()];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <HeroNovidades
        nome={primeiroNome}
        dataFormatada={dataFormatada}
        totalAtivos={totalAtivos}
        novidadesCriadas={novidadesCriadas}
        novidadesAprovadas={novidadesAprovadas}
      />

      {/* Cards de ação */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <CardAcao
          href="/rh/ferias?tab=colaboradores&status=vencido"
          icon={AlertOctagon}
          label="Férias vencidas"
          descricao="Precisam gozar urgente"
          value={kpis.vencidas}
          tom="danger"
        />
        <CardAcao
          href="/rh/ferias?tab=colaboradores&status=em_alerta"
          icon={AlertTriangle}
          label="Vencendo em 60d"
          descricao="Concessivo chegando no fim"
          value={kpis.emAlerta}
          tom="warning"
        />
        <CardAcao
          href="/rh/ferias?tab=colaboradores"
          icon={Palmtree}
          label="Em férias hoje"
          descricao="Afastados agora"
          value={kpis.emFeriasHoje}
          tom="info"
        />
        <CardAcao
          href="/rh/ferias?tab=colaboradores"
          icon={CalendarCheck}
          label="Retornam esta semana"
          descricao="Voltam até 7 dias"
          value={kpis.retornosSemana}
          tom="ok"
        />
      </div>

      {/* 2 widgets */}
      <div className="grid gap-4 lg:grid-cols-2">
        <WidgetEstaSemana
          emFerias={emFerias}
          saindo={saindo}
          voltando={voltando}
        />
        <WidgetVencimentos vencendo={vencendo} />
      </div>
    </div>
  );
}

/* --------------------------- HERO + NOVIDADES --------------------------- */

function HeroNovidades({
  nome,
  dataFormatada,
  totalAtivos,
  novidadesCriadas,
  novidadesAprovadas,
}: {
  nome: string;
  dataFormatada: string;
  totalAtivos: number;
  novidadesCriadas: Array<{
    id: string;
    colaborador: { nome: string } | null;
    dias: number;
    data_inicio: string;
    created_at?: string;
  }>;
  novidadesAprovadas: Array<{
    id: string;
    colaborador: { nome: string } | null;
    dias: number;
    data_inicio: string;
    aprovado_em?: string;
  }>;
}) {
  const totalNovidades = novidadesCriadas.length + novidadesAprovadas.length;
  return (
    <div className="relative rounded-2xl bg-california-dark text-white px-6 py-5 md:px-8 md:py-6 shadow-elevated">
      {/* Wrapper do blur decorativo — overflow-hidden fica aqui dentro
          pra não cortar o dropdown absolute do Pill Novidades. */}
      <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
        <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-california-red/30 blur-3xl" />
      </div>
      <div className="relative flex items-start justify-between gap-6 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-white/60">
            <Sparkles className="h-3.5 w-3.5 text-california-red" />
            <span className="capitalize">{dataFormatada}</span>
          </div>
          <h1 className="mt-1.5 text-2xl md:text-[28px] font-bold tracking-tight">
            Olá, {nome}
          </h1>
          <p className="mt-1 text-sm text-white/65 max-w-2xl">
            {totalAtivos}{" "}
            {totalAtivos === 1
              ? "colaborador ativo"
              : "colaboradores ativos"}{" "}
            nesse tenant
          </p>
        </div>

        {/* Pill Novidades */}
        <PillNovidades
          totalNovidades={totalNovidades}
          novidadesCriadas={novidadesCriadas}
          novidadesAprovadas={novidadesAprovadas}
        />
      </div>
    </div>
  );
}

function PillNovidades({
  totalNovidades,
  novidadesCriadas,
  novidadesAprovadas,
}: {
  totalNovidades: number;
  novidadesCriadas: Array<{
    id: string;
    colaborador: { nome: string } | null;
    dias: number;
    data_inicio: string;
    created_at?: string;
  }>;
  novidadesAprovadas: Array<{
    id: string;
    colaborador: { nome: string } | null;
    dias: number;
    data_inicio: string;
    aprovado_em?: string;
  }>;
}) {
  // Não renderiza se não há novidades — evita um dropdown vazio no hero.
  if (totalNovidades === 0) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full bg-white/5 border border-white/10 px-3.5 py-2 text-xs text-white/60">
        <Sparkles className="h-3.5 w-3.5" />
        <span>Sem novidades nesta semana</span>
      </div>
    );
  }
  return (
    <details className="relative shrink-0">
      <summary className="cursor-pointer list-none inline-flex items-center gap-2 rounded-full bg-california-red/90 hover:bg-california-red px-3.5 py-2 text-xs font-medium text-white shadow-soft transition-colors">
        <Sparkles className="h-3.5 w-3.5" />
        <span>Novidades</span>
        <span className="inline-flex items-center justify-center min-w-[20px] rounded-full bg-white/20 px-1.5 text-[11px] font-semibold">
          {totalNovidades}
        </span>
      </summary>
      <div className="absolute right-0 top-full mt-2 z-50 w-[360px] max-h-[400px] overflow-y-auto rounded-xl border border-border bg-background text-foreground shadow-elevated p-3 space-y-3">
        {novidadesCriadas.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <FileText className="h-3 w-3" />
              Solicitações feitas ({novidadesCriadas.length})
            </p>
            <ul className="space-y-1.5">
              {novidadesCriadas.map((l) => (
                <li
                  key={l.id}
                  className="flex items-start gap-2 text-sm rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5"
                >
                  <FileText className="h-3.5 w-3.5 text-amber-700 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">
                      {l.colaborador?.nome ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {l.dias}d · começa{" "}
                      {new Date(
                        l.data_inicio + "T00:00:00",
                      ).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {novidadesAprovadas.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3" />
              Solicitações aprovadas ({novidadesAprovadas.length})
            </p>
            <ul className="space-y-1.5">
              {novidadesAprovadas.map((l) => (
                <li
                  key={l.id}
                  className="flex items-start gap-2 text-sm rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1.5"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">
                      {l.colaborador?.nome ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {l.dias}d · começa{" "}
                      {new Date(
                        l.data_inicio + "T00:00:00",
                      ).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

/* --------------------------- CARD DE AÇÃO ------------------------------- */

type Tom = "danger" | "warning" | "ok" | "info";

const TOM_STYLES: Record<
  Tom,
  { bg: string; number: string; icone: string; border: string }
> = {
  danger: {
    bg: "bg-california-red/5",
    number: "text-california-red",
    icone: "text-california-red",
    border: "border-california-red/20 hover:border-california-red/40",
  },
  warning: {
    bg: "bg-amber-50/60",
    number: "text-amber-700",
    icone: "text-amber-600",
    border: "border-amber-300/40 hover:border-amber-500/60",
  },
  info: {
    bg: "bg-sky-50/50",
    number: "text-sky-700",
    icone: "text-sky-600",
    border: "border-sky-300/40 hover:border-sky-500/60",
  },
  ok: {
    bg: "bg-emerald-50/40",
    number: "text-emerald-700",
    icone: "text-emerald-600",
    border: "border-emerald-300/40 hover:border-emerald-500/60",
  },
};

function CardAcao({
  href,
  icon: Icon,
  label,
  descricao,
  value,
  tom,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  descricao: string;
  value: number;
  tom: Tom;
}) {
  const s = TOM_STYLES[tom];
  return (
    <Link
      href={href}
      prefetch={false}
      className={`block rounded-xl border p-4 transition-colors shadow-soft ${s.bg} ${s.border}`}
    >
      <div className="flex items-start justify-between gap-3">
        <Icon className={`h-5 w-5 ${s.icone}`} />
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className={`mt-3 text-3xl font-bold tracking-tight ${s.number}`}>
        {value}
      </p>
      <p className="mt-1 text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">{descricao}</p>
    </Link>
  );
}

/* --------------------------- WIDGETS ------------------------------------ */

function WidgetEstaSemana({
  emFerias,
  saindo,
  voltando,
}: {
  emFerias: Array<{
    id: string;
    colaborador: { nome: string } | null;
    dias: number;
    data_fim: string;
  }>;
  saindo: Array<{
    id: string;
    colaborador: { nome: string } | null;
    dias: number;
    data_inicio: string;
  }>;
  voltando: Array<{
    id: string;
    colaborador: { nome: string } | null;
    dias: number;
    data_fim: string;
  }>;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-5">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
        <CalendarCheck className="h-4 w-4 text-california-red" />
        Esta semana
      </h3>
      <div className="space-y-5">
        <BlocoSemana
          titulo="Em férias agora"
          itens={emFerias.map((l) => ({
            id: l.id,
            nome: l.colaborador?.nome ?? "—",
            detalhe:
              "até " +
              new Date(l.data_fim + "T00:00:00").toLocaleDateString("pt-BR"),
          }))}
          vazio="Ninguém."
        />
        <BlocoSemana
          titulo="Saindo nos próximos 7 dias"
          itens={saindo.map((l) => ({
            id: l.id,
            nome: l.colaborador?.nome ?? "—",
            detalhe:
              new Date(l.data_inicio + "T00:00:00").toLocaleDateString(
                "pt-BR",
              ) +
              " · " +
              l.dias +
              "d",
          }))}
          vazio="Nenhuma saída programada."
        />
        <BlocoSemana
          titulo="Voltando nos próximos 7 dias"
          itens={voltando.map((l) => ({
            id: l.id,
            nome: l.colaborador?.nome ?? "—",
            detalhe:
              "volta " +
              new Date(l.data_fim + "T00:00:00").toLocaleDateString("pt-BR"),
          }))}
          vazio="Ninguém volta esta semana."
        />
      </div>
    </div>
  );
}

function BlocoSemana({
  titulo,
  itens,
  vazio,
}: {
  titulo: string;
  itens: Array<{ id: string; nome: string; detalhe: string }>;
  vazio: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
        {titulo}
      </p>
      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">{vazio}</p>
      ) : (
        <ul className="space-y-1">
          {itens.map((i) => (
            <li
              key={i.id}
              className="flex items-center justify-between gap-3 text-sm py-0.5"
            >
              <span className="truncate font-medium">{i.nome}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {i.detalhe}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WidgetVencimentos({
  vencendo,
}: {
  vencendo: Array<{
    id: string;
    data_limite_gozo: string;
    status: string;
    aquisitivo_inicio: string;
    aquisitivo_fim: string;
    colaborador: { id: string; nome: string } | null;
  }>;
}) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return (
    <div className="rounded-xl border border-border bg-background p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Clock className="h-4 w-4 text-california-red" />
          Próximos vencimentos
        </h3>
        <Link
          href="/rh/ferias?tab=colaboradores&status=vencido"
          prefetch={false}
          className="text-xs text-california-red hover:underline"
        >
          Ver todos →
        </Link>
      </div>
      {vencendo.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          Nenhum concessivo próximo do vencimento.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {vencendo.map((p) => {
            const limite = new Date(p.data_limite_gozo + "T00:00:00");
            const dif = Math.ceil(
              (limite.getTime() - hoje.getTime()) / 86_400_000,
            );
            const aq =
              p.aquisitivo_inicio.slice(0, 4) +
              "/" +
              p.aquisitivo_fim.slice(0, 4);
            const vencido = p.status === "vencido";
            return (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {p.colaborador?.nome ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Aquisitivo {aq}
                  </p>
                </div>
                <div
                  className={`text-xs text-right shrink-0 ${
                    vencido
                      ? "text-california-red font-semibold"
                      : "text-amber-700"
                  }`}
                >
                  {vencido ? "venceu há " + -dif + "d" : "vence em " + dif + "d"}
                  <br />
                  <span className="opacity-70">
                    {limite.toLocaleDateString("pt-BR")}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
