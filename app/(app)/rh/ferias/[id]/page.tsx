import { notFound } from "next/navigation";
import {
  FileText,
  Clock,
  CalendarDays,
  Palmtree,
  Sparkles,
  Plus,
} from "lucide-react";
import type { FeriasLancamentoStatus } from "@/lib/types";
import { PeriodosDisponiveisColapsavel } from "./periodos-disponiveis-colapsavel";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import type {
  ColaboradorFeriasLancamento,
  ColaboradorFeriasPeriodo,
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
  const [
    colabRes,
    periodosRes,
    lancsRes,
    salarioRes,
    alocacaoRes,
    nfsRes,
  ] = await Promise.all([
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
          "id, empresa_id, regional_id, usa_rateio_empresa, data_inicio, empresa:empresas(nome_fantasia), regional:regionais(nome)",
        )
        .eq("colaborador_id", params.id)
        .is("data_fim", null)
        .limit(1)
        .maybeSingle(),
      // NFs anexadas pra lançamentos de férias (usufruto/abono) desse colab.
      // O card de "solicitação em andamento" mostra o nome do arquivo quando
      // o lançamento já está em nf_anexada ou enviado_financeiro.
      supabase
        .from("colaboradores_nf_anexos")
        .select("id, escopo_tipo, escopo_id, arquivo_nome, uploaded_at")
        .eq("colaborador_id", params.id)
        .eq("tenant_id", tenantId)
        .in("escopo_tipo", ["ferias_usufruto", "ferias_abono"]),
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
    empresa: { nome_fantasia: string } | null;
    regional: { nome: string } | null;
    usa_rateio_empresa: boolean | null;
  } | null;

  // Agrupa NFs por lançamento (escopo_id) pra o card olhar em O(1).
  const nfsPorLanc = new Map<
    string,
    { id: string; arquivo_nome: string; uploaded_at: string }
  >();
  for (const n of (nfsRes.data ?? []) as Array<{
    id: string;
    escopo_id: string | null;
    arquivo_nome: string;
    uploaded_at: string;
  }>) {
    if (!n.escopo_id) continue;
    nfsPorLanc.set(n.escopo_id, {
      id: n.id,
      arquivo_nome: n.arquivo_nome,
      uploaded_at: n.uploaded_at,
    });
  }

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

  // Lançamento em andamento = qualquer um ainda em movimento no fluxo OU
  // já concluído mas com o colaborador ainda fora (data_fim >= hoje). Só
  // depois que ele "volta" (passa o data_fim) é que vai pro histórico —
  // o RH precisa saber que a pessoa está em férias HOJE, mesmo que o
  // financeiro já tenha pago.
  const hojeISO = new Date().toISOString().slice(0, 10);
  const STATUS_EM_ANDAMENTO_FLUXO = new Set<FeriasLancamentoStatus>([
    "pendente_aprovacao",
    "aprovado",
    "nf_anexada",
    "enviado_financeiro",
  ]);
  const idsEmAndamento = new Set<string>();
  for (const l of lancamentos) {
    if (STATUS_EM_ANDAMENTO_FLUXO.has(l.status)) idsEmAndamento.add(l.id);
    else if (l.status === "concluido" && l.data_fim >= hojeISO)
      idsEmAndamento.add(l.id);
  }
  const lancsEmAndamento = lancamentos.filter((l) => idsEmAndamento.has(l.id));
  const lancsFinalizados = lancamentos.filter((l) => !idsEmAndamento.has(l.id));

  // Saldo total = soma do saldo dos aquisitivos "não fechados" (apto,
  // em curso, em alerta, vencido). O que já foi regularizado não entra.
  const periodosQueContam = periodos.filter(
    (p) =>
      p.status === "apto" ||
      p.status === "em_alerta" ||
      p.status === "vencido" ||
      p.status === "incompleto",
  );
  const saldoTotal = periodosQueContam.reduce((acc, p) => {
    const ocupados = diasOcupados.get(p.id) ?? 0;
    return acc + Math.max(p.dias_direito - ocupados, 0);
  }, 0);

  // Lista de aquisitivos pra mostrar no colapsável "Períodos disponíveis".
  // Os regularizados e não habilitados ficam de fora — não têm saldo útil.
  const periodosDisponiveis = periodos
    .filter(
      (p) =>
        p.status === "apto" ||
        p.status === "em_alerta" ||
        p.status === "vencido" ||
        p.status === "incompleto",
    )
    .map((p) => {
      const ocupados = diasOcupados.get(p.id) ?? 0;
      return {
        ...p,
        saldo: Math.max(p.dias_direito - ocupados, 0),
        diasUsados: ocupados,
      };
    });

  // Pro CTA de "nada em andamento": próximo período que o colaborador
  // pode tirar (saldo > 0). Prioriza vencido > alerta > apto > em curso.
  const ordemCtaStatus: Record<string, number> = {
    vencido: 1,
    em_alerta: 2,
    apto: 3,
    incompleto: 4,
  };
  const proximoPeriodo =
    periodosDisponiveis
      .filter((p) => p.saldo > 0)
      .sort(
        (a, b) =>
          (ordemCtaStatus[a.status] ?? 9) - (ordemCtaStatus[b.status] ?? 9),
      )[0] ?? null;

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
        empresa={alocacao?.empresa?.nome_fantasia ?? null}
        regional={regionalLabel}
        botaoLancar={botaoLancar}
      />

      {/* EM ANDAMENTO — sempre aberto. Único foco visual do que importa:
          solicitações em movimento OU concluídas com colaborador ainda
          fora. Quando não há nada, vira um CTA apontando pro próximo
          período disponível. */}
      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground mb-3 flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-california-red" />
          Em andamento
        </h2>
        {lancsEmAndamento.length > 0 ? (
          <div className="space-y-3">
            {lancsEmAndamento.map((l) => (
              <CardSolicitacaoAtiva
                key={l.id}
                lancamento={l}
                nf={nfsPorLanc.get(l.id) ?? null}
              />
            ))}
          </div>
        ) : (
          <CardVazioProximoPeriodo
            proximoPeriodo={proximoPeriodo}
            botaoLancar={botaoLancar}
          />
        )}
      </section>

      {/* Períodos disponíveis — colapsado por default */}
      {periodosDisponiveis.length > 0 && (
        <PeriodosDisponiveisColapsavel periodos={periodosDisponiveis} />
      )}

      {/* Histórico — colapsado por default, com busca interna */}
      {lancsFinalizados.length > 0 && (
        <HistoricoColapsavel
          lancamentos={lancsFinalizados.map((l) => ({
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

/* --------------------- CARD VAZIO: PRÓXIMO PERÍODO --------------------- */

function CardVazioProximoPeriodo({
  proximoPeriodo,
  botaoLancar,
}: {
  proximoPeriodo:
    | {
        aquisitivo_inicio: string;
        aquisitivo_fim: string;
        saldo: number;
        dias_direito: number;
        data_limite_gozo: string;
        status: string;
      }
    | null;
  botaoLancar: React.ReactNode;
}) {
  if (!proximoPeriodo) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center">
        <Palmtree className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm font-medium">Nada em andamento</p>
        <p className="text-xs text-muted-foreground mt-1">
          Colaborador sem solicitação ativa nem saldo disponível.
        </p>
      </div>
    );
  }
  const rotulo = `${proximoPeriodo.aquisitivo_inicio.slice(0, 4)}/${proximoPeriodo.aquisitivo_fim.slice(0, 4)}`;
  const limite = new Date(
    proximoPeriodo.data_limite_gozo + "T00:00:00",
  ).toLocaleDateString("pt-BR");
  return (
    <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50/40 p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-700 mb-1">
            Nada em andamento · próximo período disponível
          </p>
          <p className="text-base font-semibold text-foreground">
            Aquisitivo {rotulo} · {proximoPeriodo.saldo} de{" "}
            {proximoPeriodo.dias_direito} dias livres
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Prazo pra gozar até {limite}
          </p>
        </div>
        <div className="shrink-0">{botaoLancar}</div>
      </div>
    </div>
  );
}

/* --------------------- CARD DE SOLICITAÇÃO ATIVA --------------------- */

function CardSolicitacaoAtiva({
  lancamento: l,
  nf,
}: {
  lancamento: ColaboradorFeriasLancamento;
  nf: { id: string; arquivo_nome: string; uploaded_at: string } | null;
}) {
  const inicio = new Date(l.data_inicio + "T00:00:00").toLocaleDateString(
    "pt-BR",
  );
  const fim = new Date(l.data_fim + "T00:00:00").toLocaleDateString("pt-BR");

  const statusInfo: Record<
    FeriasLancamentoStatus,
    { label: string; cls: string; hint: string }
  > = {
    pendente_aprovacao: {
      label: "Pendente aprovação",
      cls: "bg-amber-100 text-amber-900 border-amber-300",
      hint: "RH precisa aprovar.",
    },
    aprovado: {
      label: "Aprovado",
      cls: "bg-emerald-100 text-emerald-800 border-emerald-300",
      hint: "Aguardando colaborador anexar a NF.",
    },
    nf_anexada: {
      label: "NF Anexada",
      cls: "bg-sky-100 text-sky-800 border-sky-300",
      hint: "Clique em Enviar pro Financeiro quando quiser liberar o pagamento.",
    },
    enviado_financeiro: {
      label: "Enviado Financeiro",
      cls: "bg-purple-100 text-purple-800 border-purple-300",
      hint: "Na fila da aba People em Contas a Pagar.",
    },
    aguardando_financeiro: {
      label: "Aguardando Financeiro",
      cls: "bg-purple-100 text-purple-800 border-purple-300",
      hint: "",
    },
    reprovado: {
      label: "Reprovado",
      cls: "bg-red-100 text-red-800 border-red-300",
      hint: "",
    },
    cancelado: {
      label: "Cancelado",
      cls: "bg-muted text-muted-foreground border-border",
      hint: "",
    },
    concluido: {
      label: "Concluído",
      cls: "bg-slate-200 text-slate-700 border-slate-300",
      hint: "",
    },
  };
  const si = statusInfo[l.status];

  const tipoLabel =
    l.tipo === "usufruto"
      ? "Férias (usufruto)"
      : l.tipo === "abono_combinado"
        ? "Férias + abono"
        : l.tipo === "abono_avulso"
          ? "Abono avulso"
          : "Abono excepcional";

  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <Palmtree className="h-4 w-4 text-california-red" />
          <h3 className="text-sm font-semibold">{tipoLabel}</h3>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${si.cls}`}
        >
          {si.label}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm mb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
            Período
          </p>
          <p className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            {inicio} → {fim}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
            Dias
          </p>
          <p>
            <span className="font-semibold">{l.dias}</span>
            {(l.dias_abono ?? 0) > 0 && (
              <span className="text-xs text-muted-foreground">
                {" "}· {l.dias - (l.dias_abono ?? 0)}f + {l.dias_abono}a
              </span>
            )}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
            Valor
          </p>
          <p className="font-mono text-sm">
            {l.valor_total
              ? "R$ " +
                Number(l.valor_total).toLocaleString("pt-BR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
              : "—"}
          </p>
        </div>
      </div>

      {/* Bloco da NF: anexada ou pendente */}
      {nf ? (
        <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50/50 px-3 py-2 text-sm">
          <FileText className="h-4 w-4 text-sky-700 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sky-900 truncate">
              {nf.arquivo_nome}
            </p>
            <p className="text-[11px] text-sky-800/70">
              Anexada em{" "}
              {new Date(nf.uploaded_at).toLocaleDateString("pt-BR")}
            </p>
          </div>
        </div>
      ) : l.status === "aprovado" ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50/50 px-3 py-2 text-sm text-amber-900">
          <Clock className="h-4 w-4 shrink-0" />
          <span>Aguardando o colaborador anexar a NF.</span>
        </div>
      ) : null}

      {si.hint && (
        <p className="mt-2 text-xs text-muted-foreground">{si.hint}</p>
      )}
    </div>
  );
}
