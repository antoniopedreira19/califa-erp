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
import { formatDataAsHoraBr, formatDiaBr } from "@/lib/formatar-data-hora";
import { BlocoDocumentosLancamento } from "./bloco-documentos-lancamento";
import { BotoesRhLancamento } from "./botoes-rh-lancamento";
import { hintAprovado } from "@/lib/ferias/hint-aprovado";
import type {
  FolhaMin,
  NfMin,
} from "@/lib/ferias/lancamento-enviavel";

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
    folhasFeriasRes,
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
          "id, periodo_id, tipo, dias, dias_abono, data_inicio, data_fim, status, observacao, lancado_direto_por_rh, valor_total, aprovado_por, aprovado_em, aprovado_pelo_lider_por, aprovado_pelo_lider_em, aprovacao_lider_override, motivo_override_lider, created_at",
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
      // Folhas de pagamento de férias deste colaborador. Usado pra decidir
      // se um lançamento 'aprovado' é retroativo (sem folha = pagamento
      // feito fora do sistema, não espera NF) — nesse caso vai pro
      // histórico em vez de "Em andamento". Também alimenta o bloco
      // de documentos por folha (NF vs recibo contábil).
      supabase
        .from("folhas_pagamento")
        .select(
          "id, lancamento_ferias_id, origem, tipo_folha_ferias, status, anexo_url, salario_base, data_pagamento_prevista",
        )
        .eq("tenant_id", tenantId)
        .eq("colaborador_id", params.id)
        .eq("tipo", "ferias")
        .not("lancamento_ferias_id", "is", null),
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

  // Nomes dos aprovadores (RH e líder) pros rastros na timeline do card.
  const aprovadoresIds = Array.from(
    new Set(
      lancamentos
        .flatMap((l) => [l.aprovado_por, l.aprovado_pelo_lider_por])
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const { data: aprovadoresRes } = aprovadoresIds.length
    ? await supabase
        .from("profiles")
        .select("id, nome")
        .in("id", aprovadoresIds)
    : { data: [] as Array<{ id: string; nome: string }> };
  const nomesAprovadores = new Map<string, string>();
  for (const p of aprovadoresRes ?? []) {
    nomesAprovadores.set(p.id, p.nome);
  }
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

  // Agrupa NFs por (lançamento, escopo_tipo) — um lançamento abono_combinado
  // tem 2 NFs (usufruto + abono) com mesmo escopo_id. Guardar só por escopo_id
  // sobrescreve uma pela outra.
  type NfComMeta = {
    id: string;
    escopo_tipo: "ferias_usufruto" | "ferias_abono";
    arquivo_nome: string | null;
    uploaded_at: string | null;
  };
  const nfsPorLancPorEscopo = new Map<string, NfComMeta[]>();
  for (const n of (nfsRes.data ?? []) as Array<{
    id: string;
    escopo_id: string | null;
    escopo_tipo: "ferias_usufruto" | "ferias_abono";
    arquivo_nome: string;
    uploaded_at: string;
  }>) {
    if (!n.escopo_id) continue;
    const atual = nfsPorLancPorEscopo.get(n.escopo_id) ?? [];
    atual.push({
      id: n.id,
      escopo_tipo: n.escopo_tipo,
      arquivo_nome: n.arquivo_nome,
      uploaded_at: n.uploaded_at,
    });
    nfsPorLancPorEscopo.set(n.escopo_id, atual);
  }

  // Agrupa folhas por lançamento pro bloco de documentos (NF x recibo).
  type FolhaFull = FolhaMin & {
    lancamento_ferias_id: string | null;
    salario_base: string | number | null;
    data_pagamento_prevista: string | null;
  };
  const folhasPorLanc = new Map<string, FolhaFull[]>();
  for (const f of (folhasFeriasRes.data ?? []) as Array<{
    id: string;
    lancamento_ferias_id: string | null;
    origem: "california" | "contabilidade";
    tipo_folha_ferias: "usufruto" | "abono" | null;
    status: string;
    anexo_url: string | null;
    salario_base: string | number | null;
    data_pagamento_prevista: string | null;
  }>) {
    if (!f.lancamento_ferias_id) continue;
    const atual = folhasPorLanc.get(f.lancamento_ferias_id) ?? [];
    atual.push({
      id: f.id,
      lancamento_ferias_id: f.lancamento_ferias_id,
      origem: f.origem,
      tipo_folha_ferias: f.tipo_folha_ferias,
      status: f.status,
      anexo_url: f.anexo_url,
      salario_base: f.salario_base,
      data_pagamento_prevista: f.data_pagamento_prevista,
    });
    folhasPorLanc.set(f.lancamento_ferias_id, atual);
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
  //
  // Exceção retroativo: 'aprovado' SEM folha de pagamento vinculada =
  // lançamento retroativo (pagamento feito fora do sistema). Nunca gerou
  // folha, logo não espera NF nem fluxo financeiro — cai direto no
  // histórico, sem alerta de NF.
  const lancsComFolha = new Set<string>(
    ((folhasFeriasRes.data ?? []) as Array<{
      lancamento_ferias_id: string | null;
    }>)
      .map((r) => r.lancamento_ferias_id)
      .filter((v): v is string => Boolean(v)),
  );
  const hojeISO = new Date().toISOString().slice(0, 10);
  const STATUS_EM_ANDAMENTO_FLUXO = new Set<FeriasLancamentoStatus>([
    "pendente_aprovacao",
    "aprovado",
    "nf_anexada",
    "enviado_financeiro",
  ]);
  const idsEmAndamento = new Set<string>();
  for (const l of lancamentos) {
    // Abono puro é venda de dias trabalhados, não ausência — assim que
    // concluído vai direto pro histórico, independente de data_fim
    // (que é sintética pra determinar competência da folha). Ver
    // commit b33c77ac — a mesma lógica já foi aplicada nos KPIs e flags.
    const abonoPuro =
      l.tipo === "abono_avulso" || l.tipo === "abono_excepcional";
    if (STATUS_EM_ANDAMENTO_FLUXO.has(l.status)) {
      if (l.status === "aprovado" && !lancsComFolha.has(l.id)) continue;
      idsEmAndamento.add(l.id);
    } else if (
      l.status === "concluido" &&
      !abonoPuro &&
      l.data_fim >= hojeISO
    )
      idsEmAndamento.add(l.id);
  }
  const lancsEmAndamento = lancamentos.filter((l) => idsEmAndamento.has(l.id));
  const lancsFinalizados = lancamentos.filter((l) => !idsEmAndamento.has(l.id));

  // Lista de aquisitivos pra mostrar no colapsável "Períodos disponíveis".
  // Os regularizados e não habilitados ficam de fora — não têm saldo útil.
  // Aquisitivos futuros (data de início > hoje) também não aparecem — o
  // colaborador ainda não tem direito ao que não começou.
  const periodosDisponiveis = periodos
    .filter(
      (p) =>
        (p.status === "apto" ||
          p.status === "em_alerta" ||
          p.status === "vencido" ||
          p.status === "incompleto") &&
        p.aquisitivo_inicio <= hojeISO,
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

  // Saldo mostrado no hero = saldo do mesmo aquisitivo destacado no card
  // "próximo período disponível" (prioriza vencido > alerta > apto). Somar
  // todos os aquisitivos abertos gera número inflado (ex.: 13+30+30=73) que
  // não reflete o que o colaborador vai efetivamente gozar agora. Os demais
  // períodos aparecem detalhados no colapsável logo abaixo.
  const saldoHero = proximoPeriodo?.saldo ?? 0;

  const salarioNum = salario?.valor != null ? Number(salario.valor) : null;
  const regionalLabel = alocacao?.usa_rateio_empresa
    ? "Rateio da empresa"
    : (alocacao?.regional?.nome ?? null);

  const botaoLancar = (
    <BotaoLancarDiretoCliente
      colaboradorId={c.id}
      tipoContratacao={c.tipo_contratacao}
      periodos={periodos
        .filter((p) => p.aquisitivo_inicio <= hojeISO)
        .map((p) => ({
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
        saldoDias={saldoHero}
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
                nomesAprovadores={nomesAprovadores}
                folhasDoLanc={folhasPorLanc.get(l.id) ?? []}
                nfsDoLanc={nfsPorLancPorEscopo.get(l.id) ?? []}
                role={session.activeRole}
                aquisitivosDisponiveis={periodosDisponiveis.map((p) => ({
                  id: p.id,
                  rotulo: `${p.aquisitivo_inicio.slice(0, 4)}/${p.aquisitivo_fim.slice(0, 4)}`,
                  saldo: p.saldo,
                }))}
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
            periodo_id: l.periodo_id,
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
          periodos={periodos.map((p) => ({
            id: p.id,
            numero: p.numero,
            aquisitivo_inicio: p.aquisitivo_inicio,
            aquisitivo_fim: p.aquisitivo_fim,
            dias_direito: p.dias_direito,
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
  nomesAprovadores,
  folhasDoLanc,
  nfsDoLanc,
  role,
  aquisitivosDisponiveis,
}: {
  lancamento: ColaboradorFeriasLancamento;
  nomesAprovadores: Map<string, string>;
  folhasDoLanc: Array<
    FolhaMin & {
      lancamento_ferias_id: string | null;
      salario_base: string | number | null;
      data_pagamento_prevista: string | null;
    }
  >;
  nfsDoLanc: Array<{
    id: string;
    escopo_tipo: "ferias_usufruto" | "ferias_abono";
    arquivo_nome: string | null;
    uploaded_at: string | null;
  }>;
  role: string;
  aquisitivosDisponiveis: Array<{ id: string; rotulo: string; saldo: number }>;
}) {
  const inicio = new Date(l.data_inicio + "T00:00:00").toLocaleDateString(
    "pt-BR",
  );
  const fim = new Date(l.data_fim + "T00:00:00").toLocaleDateString("pt-BR");
  // Abono puro (avulso/excepcional) é venda de dias, não ausência — as datas
  // data_inicio/data_fim do lançamento são sintéticas e induzem a erro.
  // Mostra "Solicitado em" com created_at no lugar do período.
  const abonoPuro = l.tipo === "abono_avulso" || l.tipo === "abono_excepcional";
  const solicitadoEm = formatDiaBr(l.created_at);

  const statusInfo: Record<
    FeriasLancamentoStatus,
    { label: string; cls: string; hint: string }
  > = {
    aguardando_gestor: {
      label: "Aguardando líder",
      cls: "bg-amber-100 text-amber-900 border-amber-300",
      hint: "Líder precisa aprovar antes do RH.",
    },
    pendente_aprovacao: {
      label: "Pendente aprovação",
      cls: "bg-amber-100 text-amber-900 border-amber-300",
      hint: "RH precisa aprovar.",
    },
    aprovado: {
      label: "Aprovado",
      cls: "bg-emerald-100 text-emerald-800 border-emerald-300",
      hint: hintAprovado(
        l.id,
        folhasDoLanc,
        nfsDoLanc.map((n) => ({ escopo_tipo: n.escopo_tipo, escopo_id: l.id })),
      ),
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
      label: "Cancelada",
      cls: "bg-muted text-muted-foreground border-border",
      hint: "",
    },
    cancelado: {
      label: "Cancelada",
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
            {abonoPuro ? "Solicitado em" : "Período"}
          </p>
          <p className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            {abonoPuro ? solicitadoEm : `${inicio} → ${fim}`}
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

      {/* Bloco de documentos por folha (NF do colaborador + recibo contábil do RH) */}
      {folhasDoLanc.length > 0 && (
        <BlocoDocumentosLancamento
          lancamentoId={l.id}
          statusLancamento={l.status}
          folhas={folhasDoLanc.map((f) => ({
            id: f.id,
            origem: f.origem,
            tipo_folha_ferias: f.tipo_folha_ferias,
            status: f.status,
            anexo_url: f.anexo_url,
            salario_base: f.salario_base,
            data_pagamento_prevista: f.data_pagamento_prevista,
          }))}
          nfsPorEscopo={nfsDoLanc}
          role={role}
        />
      )}

      <TimelineAprovacoes lancamento={l} nomesAprovadores={nomesAprovadores} />

      {si.hint && !(l.status === "aprovado" && folhasDoLanc.length > 0) && (
        <p className="mt-2 text-xs text-muted-foreground">{si.hint}</p>
      )}

      {(role === "rh" || role === "administrador") && (
        <BotoesRhLancamento
          lancamentoId={l.id}
          status={l.status}
          dataInicio={l.data_inicio}
          dataFim={l.data_fim}
          periodoId={l.periodo_id}
          tipoLancamento={l.tipo}
          aquisitivos={aquisitivosDisponiveis}
        />
      )}
    </div>
  );
}

/** Rastro de aprovação em duas etapas (líder, depois RH) + override.
 *  Mostra até 2 linhas:
 *    - Etapa 1: "Aprovado pelo líder [nome] em …" ou "RH aprovou no lugar
 *      do líder em …" (quando `aprovacao_lider_override`).
 *    - Etapa 2: "Aprovado pelo RH em …" sempre que `aprovado_por` existe.
 *  Quando nenhum dos dois existe, não renderiza nada (lançamento ainda
 *  nas etapas iniciais, ou importado/legado sem rastro). */
function TimelineAprovacoes({
  lancamento: l,
  nomesAprovadores,
}: {
  lancamento: ColaboradorFeriasLancamento;
  nomesAprovadores: Map<string, string>;
}) {
  // timeZone = America/Sao_Paulo. Server roda em UTC (Vercel); sem isso, um
  // override feito 19:45 em Brasília aparecia como 22:45.
  const fmt = (iso: string) => formatDataAsHoraBr(iso);

  const temLider = Boolean(l.aprovado_pelo_lider_por && l.aprovado_pelo_lider_em);
  const temOverride = l.aprovacao_lider_override;
  const temRh = Boolean(l.aprovado_por && l.aprovado_em);
  if (!temLider && !temOverride && !temRh) return null;

  const nomeLider =
    (l.aprovado_pelo_lider_por && nomesAprovadores.get(l.aprovado_pelo_lider_por)) ||
    "líder";
  const nomeRh =
    (l.aprovado_por && nomesAprovadores.get(l.aprovado_por)) || "RH";

  return (
    <div className="mt-3 space-y-1 border-t border-border/70 pt-3 text-xs text-muted-foreground">
      {temOverride ? (
        <>
          <p>
            <strong>RH aprovou no lugar do líder</strong>
            {l.aprovado_em ? <> em {fmt(l.aprovado_em)}</> : null}.
          </p>
          {l.motivo_override_lider ? (
            <p className="pl-2 italic">Motivo: {l.motivo_override_lider}</p>
          ) : null}
        </>
      ) : temLider ? (
        <p>
          Aprovado pelo líder <strong>{nomeLider}</strong>
          {l.aprovado_pelo_lider_em ? (
            <> em {fmt(l.aprovado_pelo_lider_em)}</>
          ) : null}
          .
        </p>
      ) : null}
      {temRh && !temOverride ? (
        <p>
          Aprovado pelo RH (<strong>{nomeRh}</strong>)
          {l.aprovado_em ? <> em {fmt(l.aprovado_em)}</> : null}.
        </p>
      ) : null}
    </div>
  );
}
