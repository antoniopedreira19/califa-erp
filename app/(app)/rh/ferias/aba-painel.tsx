import Link from "next/link";
import {
  Sparkles,
  Palmtree,
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  AlertOctagon,
  Hourglass,
  Send,
  Users,
  FileClock,
  ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import {
  PillNovidadesFerias,
  type NovidadeSolicitacao,
  type NovidadeNfAnexada,
  type NovidadeFeriasPagas,
} from "./pill-novidades-ferias";

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

const DIAS_VENCIDA_RECENTE = 365;

/**
 * Dashboard reescrito em 2026-11-14. Antes: 4 cards + 2 widgets grandes
 * repetindo a mesma info. Agora: hero com Novidades + 8 cards clicáveis
 * sem lista nenhuma. Cada card → /rh/ferias?tab=colaboradores&filtro=X
 * com o chip correspondente já ativo. Lista fica só na tela de
 * Colaboradores (fonte-verdade única).
 *
 * Divisão dos 8 cards:
 *   Linha 1 — PRECISA DE AÇÃO:
 *     Vencidas (<1 ano) · Pendentes aprovação · Aguardando envio · Vencendo 30d
 *   Linha 2 — ESTA SEMANA:
 *     Em férias hoje · Saindo 7d · Voltando 7d · Total ativos
 */
export async function AbaPainel({ tenantId }: Props) {
  const session = await requireSession();
  const supabase = createClient();

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const hojeISO = hoje.toISOString().slice(0, 10);

  const em7d = new Date(hoje);
  em7d.setDate(hoje.getDate() + 7);
  const em7dISO = em7d.toISOString().slice(0, 10);

  const em30d = new Date(hoje);
  em30d.setDate(hoje.getDate() + 30);
  const em30dISO = em30d.toISOString().slice(0, 10);

  const limiteVencidaRecente = new Date(hoje);
  limiteVencidaRecente.setDate(hoje.getDate() - DIAS_VENCIDA_RECENTE);
  const limiteVencidaRecenteISO = limiteVencidaRecente.toISOString().slice(0, 10);

  const seteDiasAtras = new Date(hoje);
  seteDiasAtras.setDate(hoje.getDate() - 7);
  const seteDiasAtrasISO = seteDiasAtras.toISOString().slice(0, 10);

  const [
    totalAtivosRes,
    pendentesAprovacaoRes,
    aguardandoNfRes,
    aguardandoFinanceiroRes,
    lancsAtivosRes,
    periodosAtivosRes,
    novidadesSolicitacoesRes,
    novidadesNfsRes,
    novidadesPagasRes,
    dismissedRes,
  ] = await Promise.all([
    supabase
      .from("colaboradores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "ativo")
      .neq("tipo_contratacao", "socio"),
    // Pendentes de aprovação — contagem por colaborador distinto
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select("colaborador_id")
      .eq("tenant_id", tenantId)
      .eq("status", "pendente_aprovacao")
      .eq("lancado_direto_por_rh", false),
    // Aguardando NF do colaborador. Pela trigger fn_sincroniza_status_lanc_por_nf,
    // um lançamento fica em 'aprovado' só enquanto não tem NF — anexar sobe
    // pra 'nf_anexada'. Logo filtro simples basta: status='aprovado'.
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select("colaborador_id")
      .eq("tenant_id", tenantId)
      .eq("status", "aprovado")
      .eq("lancado_direto_por_rh", false),
    // Aguardando RH enviar pro financeiro (nf_anexada)
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select("colaborador_id")
      .eq("tenant_id", tenantId)
      .eq("status", "nf_anexada")
      .eq("lancado_direto_por_rh", false),
    // Lançamentos ativos pra em_ferias / saindo / voltando
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select("colaborador_id, status, data_inicio, data_fim")
      .eq("tenant_id", tenantId)
      .eq("lancado_direto_por_rh", false)
      .in("status", ["aprovado", "nf_anexada", "enviado_financeiro", "concluido"]),
    // Períodos pra vencendo 30d / vencidas recentes
    // Puxamos todos vencidos+em_alerta e reduzimos em memória pra 1 por
    // colaborador (o mais recente — o relevante pro RH acompanhar).
    supabase
      .from("colaboradores_ferias_periodos")
      .select("colaborador_id, aquisitivo_inicio, aquisitivo_fim, data_limite_gozo, status, dias_direito, id")
      .eq("tenant_id", tenantId)
      .in("status", ["vencido", "em_alerta", "apto", "incompleto"]),
    // Novidades 1: solicitações feitas nos últimos 7 dias
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select(
        "id, data_inicio, dias, created_at, colaborador:colaboradores!colaborador_id(id, nome)",
      )
      .eq("tenant_id", tenantId)
      .eq("status", "pendente_aprovacao")
      .gte("created_at", seteDiasAtrasISO)
      .order("created_at", { ascending: false })
      .limit(10),
    // Novidades 2: NFs anexadas pelo colaborador nos últimos 7 dias
    supabase
      .from("colaboradores_nf_anexos")
      .select(
        "id, colaborador_id, escopo_tipo, arquivo_nome, uploaded_at, colaborador:colaboradores!colaborador_id(id, nome)",
      )
      .eq("tenant_id", tenantId)
      .in("escopo_tipo", ["ferias_usufruto", "ferias_abono"])
      .gte("uploaded_at", seteDiasAtras.toISOString())
      .order("uploaded_at", { ascending: false })
      .limit(10),
    // Novidades 3: folhas de férias que o financeiro pagou nos últimos 7 dias
    supabase
      .from("folhas_pagamento")
      .select(
        "id, colaborador_id, tipo_folha_ferias, salario_base, paga_em, colaborador:colaboradores!colaborador_id(id, nome)",
      )
      .eq("tenant_id", tenantId)
      .eq("tipo", "ferias")
      .eq("status", "paga")
      .gte("paga_em", seteDiasAtras.toISOString())
      .order("paga_em", { ascending: false })
      .limit(10),
    supabase
      .from("notificacoes_dismissed")
      .select("notification_id")
      .eq("tenant_id", tenantId)
      .like("notification_id", "ferias:%"),
  ]);

  // Dedup distintos por colaborador para pendente_aprovacao e nf_anexada.
  // Faz sentido contar pessoa (não lançamento): se 1 colab tem 2 pendentes,
  // ele conta 1 vez no card.
  const colabsPendentes = new Set(
    (pendentesAprovacaoRes.data ?? []).map((x) => x.colaborador_id),
  );
  const colabsAguardandoNf = new Set(
    (aguardandoNfRes.data ?? []).map((x) => x.colaborador_id),
  );
  const colabsAguardando = new Set(
    (aguardandoFinanceiroRes.data ?? []).map((x) => x.colaborador_id),
  );

  // Flags por colaborador vindas de lançamentos ativos de férias.
  // Em férias hoje / saindo 7d / voltando 7d
  type LancAtivo = {
    colaborador_id: string;
    data_inicio: string;
    data_fim: string;
    status: string;
  };
  const lancAtivos = (lancsAtivosRes.data ?? []) as LancAtivo[];
  const colabsEmFerias = new Set<string>();
  const colabsSaindo = new Set<string>();
  const colabsVoltando = new Set<string>();
  for (const l of lancAtivos) {
    if (l.data_inicio <= hojeISO && l.data_fim >= hojeISO) {
      colabsEmFerias.add(l.colaborador_id);
    }
    if (l.data_inicio > hojeISO && l.data_inicio <= em7dISO) {
      colabsSaindo.add(l.colaborador_id);
    }
    if (l.data_fim >= hojeISO && l.data_fim <= em7dISO) {
      colabsVoltando.add(l.colaborador_id);
    }
  }

  // Períodos: pra cada colaborador, pega o aquisitivo relevante (mais
  // crítico: vencido > alerta > apto > incompleto). Classifica em
  // "vencida recente" (venceu nos últimos 365 dias) ou "vencendo 30d".
  type Periodo = {
    colaborador_id: string;
    data_limite_gozo: string;
    status: string;
    dias_direito: number;
    id: string;
  };
  const prioridade: Record<string, number> = {
    vencido: 1, em_alerta: 2, apto: 3, incompleto: 4,
  };
  const periodosRaw = (periodosAtivosRes.data ?? []) as Periodo[];
  const relevantePorColab = new Map<string, Periodo>();
  for (const p of periodosRaw) {
    const existente = relevantePorColab.get(p.colaborador_id);
    if (!existente) { relevantePorColab.set(p.colaborador_id, p); continue; }
    const pa = prioridade[p.status] ?? 9;
    const pb = prioridade[existente.status] ?? 9;
    if (pa < pb) relevantePorColab.set(p.colaborador_id, p);
    else if (pa === pb && p.data_limite_gozo < existente.data_limite_gozo) {
      relevantePorColab.set(p.colaborador_id, p);
    }
  }

  const colabsVencendo30d = new Set<string>();
  const colabsVencidasRecentes = new Set<string>();
  for (const [colabId, p] of relevantePorColab) {
    if (p.status === "vencido" && p.data_limite_gozo >= limiteVencidaRecenteISO) {
      colabsVencidasRecentes.add(colabId);
    }
    if (
      (p.status === "em_alerta" || p.status === "apto") &&
      p.data_limite_gozo >= hojeISO &&
      p.data_limite_gozo <= em30dISO
    ) {
      colabsVencendo30d.add(colabId);
    }
  }

  const kpis = {
    emFeriasHoje: colabsEmFerias.size,
    saindo7d: colabsSaindo.size,
    voltando7d: colabsVoltando.size,
    totalAtivos: totalAtivosRes.count ?? 0,
    vencendo30d: colabsVencendo30d.size,
    vencidasRecentes: colabsVencidasRecentes.size,
    pendentesAprovacao: colabsPendentes.size,
    aguardandoNf: colabsAguardandoNf.size,
    aguardandoFinanceiro: colabsAguardando.size,
  };

  // Mapeia as 3 fontes de novidade pros tipos que o Pill espera
  type NovidadeSolicRaw = {
    id: string;
    data_inicio: string;
    dias: number;
    created_at: string;
    colaborador: { id: string; nome: string } | null;
  };
  type NovidadeNfRaw = {
    id: string;
    colaborador_id: string;
    escopo_tipo: "ferias_usufruto" | "ferias_abono";
    arquivo_nome: string;
    uploaded_at: string;
    colaborador: { id: string; nome: string } | null;
  };
  type NovidadePagaRaw = {
    id: string;
    colaborador_id: string;
    tipo_folha_ferias: "usufruto" | "abono" | null;
    salario_base: string | number;
    paga_em: string;
    colaborador: { id: string; nome: string } | null;
  };
  const novidadesSolicitacoes: NovidadeSolicitacao[] = (
    (novidadesSolicitacoesRes.data ?? []) as unknown as NovidadeSolicRaw[]
  ).map((n) => ({
    lancamento_id: n.id,
    colaborador_nome: n.colaborador?.nome ?? "—",
    dias: n.dias,
    data_inicio: n.data_inicio,
    criado_em: n.created_at,
  }));
  const novidadesNfs: NovidadeNfAnexada[] = (
    (novidadesNfsRes.data ?? []) as unknown as NovidadeNfRaw[]
  ).map((n) => ({
    anexo_id: n.id,
    colaborador_id: n.colaborador_id,
    colaborador_nome: n.colaborador?.nome ?? "—",
    tipo: n.escopo_tipo,
    arquivo_nome: n.arquivo_nome,
    anexado_em: n.uploaded_at,
  }));
  const novidadesFeriasPagas: NovidadeFeriasPagas[] = (
    (novidadesPagasRes.data ?? []) as unknown as NovidadePagaRaw[]
  ).map((n) => ({
    folha_id: n.id,
    colaborador_id: n.colaborador_id,
    colaborador_nome: n.colaborador?.nome ?? "—",
    tipo: n.tipo_folha_ferias ?? "usufruto",
    valor: Number(n.salario_base ?? 0),
    pago_em: n.paga_em,
  }));
  const dismissedIds: string[] = (
    (dismissedRes.data ?? []) as Array<{ notification_id: string }>
  ).map((d) => d.notification_id);

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
      <HeroNovidades
        nome={primeiroNome}
        dataFormatada={dataFormatada}
        totalAtivos={kpis.totalAtivos}
        tenantId={tenantId}
        novidadesSolicitacoes={novidadesSolicitacoes}
        novidadesNfs={novidadesNfs}
        novidadesFeriasPagas={novidadesFeriasPagas}
        dismissedIds={dismissedIds}
      />

      {/* PRECISA DE AÇÃO */}
      <section className="space-y-3">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground flex items-center gap-2">
          <span className="inline-block h-4 w-1 rounded-full bg-california-red" />
          Precisa de ação
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <CardAcao
            href="/rh/ferias?tab=colaboradores&filtro=vencida_recente"
            icon={AlertOctagon}
            label="Férias vencidas"
            descricao="Precisam agendar"
            value={kpis.vencidasRecentes}
            tom="danger"
          />
          <CardAcao
            href="/rh/ferias?tab=solicitacoes"
            icon={Hourglass}
            label="Pendentes aprovação"
            descricao="RH precisa aprovar"
            value={kpis.pendentesAprovacao}
            tom="warning"
          />
          <CardAcao
            href="/rh/ferias?tab=colaboradores&filtro=aguardando_nf"
            icon={FileClock}
            label="Aguardando NF"
            descricao="Colaborador precisa anexar"
            value={kpis.aguardandoNf}
            tom="info"
          />
          <CardAcao
            href="/rh/ferias?tab=solicitacoes"
            icon={Send}
            label="Aguardando envio"
            descricao="NF anexada, enviar ao financeiro"
            value={kpis.aguardandoFinanceiro}
            tom="roxo"
          />
          <CardAcao
            href="/rh/ferias?tab=colaboradores&filtro=vencendo_30d"
            icon={AlertTriangle}
            label="Vencendo em 30d"
            descricao="Concessivo chegando no fim"
            value={kpis.vencendo30d}
            tom="warning"
          />
        </div>
      </section>

      {/* ESTA SEMANA */}
      <section className="space-y-3">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground flex items-center gap-2">
          <span className="inline-block h-4 w-1 rounded-full bg-sky-500" />
          Esta semana
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <CardAcao
            href="/rh/ferias?tab=colaboradores&filtro=em_ferias_hoje"
            icon={Palmtree}
            label="Em férias hoje"
            descricao="Afastados agora"
            value={kpis.emFeriasHoje}
            tom="info"
          />
          <CardAcao
            href="/rh/ferias?tab=colaboradores&filtro=saindo_7d"
            icon={ArrowRight}
            label="Saindo em 7 dias"
            descricao="Vão iniciar as férias"
            value={kpis.saindo7d}
            tom="warning"
          />
          <CardAcao
            href="/rh/ferias?tab=colaboradores&filtro=voltando_7d"
            icon={ArrowLeft}
            label="Voltando em 7 dias"
            descricao="Encerram as férias"
            value={kpis.voltando7d}
            tom="ok"
          />
          <CardAcao
            href="/rh/ferias?tab=colaboradores"
            icon={Users}
            label="Total ativos"
            descricao="Colaboradores no quadro"
            value={kpis.totalAtivos}
            tom="neutro"
          />
        </div>
      </section>
    </div>
  );
}

/* --------------------------- HERO + NOVIDADES --------------------------- */

function HeroNovidades({
  nome,
  dataFormatada,
  totalAtivos,
  tenantId,
  novidadesSolicitacoes,
  novidadesNfs,
  novidadesFeriasPagas,
  dismissedIds,
}: {
  nome: string;
  dataFormatada: string;
  totalAtivos: number;
  tenantId: string;
  novidadesSolicitacoes: NovidadeSolicitacao[];
  novidadesNfs: NovidadeNfAnexada[];
  novidadesFeriasPagas: NovidadeFeriasPagas[];
  dismissedIds: string[];
}) {
  return (
    <div className="relative rounded-2xl bg-california-dark text-white px-6 py-5 md:px-8 md:py-6 shadow-elevated">
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
            {totalAtivos === 1 ? "colaborador ativo" : "colaboradores ativos"}{" "}
            nesse tenant
          </p>
        </div>

        <PillNovidadesFerias
          tenantId={tenantId}
          solicitacoes={novidadesSolicitacoes}
          nfsAnexadas={novidadesNfs}
          feriasPagas={novidadesFeriasPagas}
          dismissedIds={dismissedIds}
        />
      </div>
    </div>
  );
}

/* --------------------------- CARD DE AÇÃO ------------------------------- */

type Tom = "danger" | "warning" | "ok" | "info" | "roxo" | "neutro";

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
  roxo: {
    bg: "bg-purple-50/50",
    number: "text-purple-700",
    icone: "text-purple-600",
    border: "border-purple-300/40 hover:border-purple-500/60",
  },
  neutro: {
    bg: "bg-muted/40",
    number: "text-foreground",
    icone: "text-muted-foreground",
    border: "border-border hover:border-muted-foreground/40",
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
