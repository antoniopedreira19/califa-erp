"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ClipboardList,
  Search,
  X,
  MessageCircle,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Check,
  Loader2,
} from "lucide-react";
import { cn, formatCurrency, formatCpf, nomeCurto } from "@/lib/utils";
import type {
  FreelancerSolicitacao,
  FreelancerSolicitacaoStatus,
} from "@/lib/types";
import {
  ChipStatusSolicitacao,
  STATUS_SOLICITACAO,
} from "./chip-status-solicitacao";
import { PopoverSolicitacao } from "./popover-solicitacao";
import { aprovarSolicitacoesEmLote } from "../actions";
import { useExclusiveDropdown } from "../../_components/use-exclusive-dropdown";

type TipoSolicitacao = "contratacao" | "renovacao";

interface SolicitacaoLinha extends FreelancerSolicitacao {
  /** Nome a exibir: preferência pelo nome_completo do cadastro, fallback pro texto da solicitação. */
  nome_freela_display: string;
  solicitante_nome: string | null;
  solicitante_email: string | null;
  job_codigo: string | null;
  job_nome: string | null;
  tipo_solicitacao: TipoSolicitacao;
}

interface Props {
  solicitacoes: SolicitacaoLinha[];
  contagens: Record<string, number>;
  totalContagem: number;
  solicitantesDisponiveis: Array<{ id: string; nome: string }>;
  cargosDisponiveis: string[];
  jobsDisponiveis: Array<{ id: string; label: string }>;
  tipoFiltroAtual: string;
  activeRole: string;
  userId: string;
  publicOrigin: string;
  naoLidasPorSolicitacao: Record<string, number>;
  actions?: React.ReactNode;
}

const APROVADORES = new Set(["administrador", "rh", "financeiro"]);

// Prioridade dos status pra ordem padrão. Pendente primeiro — é o que exige
// ação do aprovador. Finalizados ficam no final.
const PRIORIDADE_STATUS: Record<FreelancerSolicitacaoStatus, number> = {
  pendente: 0,
  aprovada: 1,
  cadastrada: 2,
  rejeitada: 3,
  cancelada: 4,
};

const TIPO_META: Record<
  TipoSolicitacao,
  { label: string; pill: string }
> = {
  contratacao: {
    label: "Contratação",
    pill: "bg-sky-50 text-sky-700 border-sky-500/30",
  },
  renovacao: {
    label: "Renovação",
    pill: "bg-violet-50 text-violet-700 border-violet-500/30",
  },
};

type SortKey = "valor" | "status" | "created_at";
type SortDir = "asc" | "desc";

export function SolicitacoesTabela({
  solicitacoes,
  contagens,
  totalContagem,
  solicitantesDisponiveis,
  cargosDisponiveis,
  jobsDisponiveis,
  tipoFiltroAtual,
  activeRole,
  userId,
  publicOrigin,
  naoLidasPorSolicitacao,
  actions,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAprovador = APROVADORES.has(activeRole);
  const [busca, setBusca] = React.useState("");
  const [selecionada, setSelecionada] =
    React.useState<SolicitacaoLinha | null>(null);
  const [popoverOpen, setPopoverOpen] = React.useState(false);

  // Bulk approval
  const [selecionadas, setSelecionadas] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [aprovandoLote, setAprovandoLote] = React.useState(false);

  // Sort explícito do usuário (null = ordem padrão por prioridade de status)
  const [sortKey, setSortKey] = React.useState<SortKey | null>(null);
  const [sortDir, setSortDir] = React.useState<SortDir>("asc");


  const statusAtivos = React.useMemo(() => {
    const raw = searchParams.get("status");
    if (!raw) return new Set<string>();
    return new Set(raw.split(",").filter(Boolean));
  }, [searchParams]);

  const solicitantesAtivos = React.useMemo(() => {
    const raw = searchParams.get("solicitante");
    if (!raw) return new Set<string>();
    return new Set(raw.split(",").filter(Boolean));
  }, [searchParams]);

  const jobsAtivos = React.useMemo(() => {
    const raw = searchParams.get("job");
    if (!raw) return new Set<string>();
    return new Set(raw.split(",").filter(Boolean));
  }, [searchParams]);

  const cargoAtual = searchParams.get("cargo") ?? "";
  const tipoAtual = tipoFiltroAtual;
  const temAlgumFiltro =
    busca !== "" ||
    statusAtivos.size > 0 ||
    solicitantesAtivos.size > 0 ||
    jobsAtivos.size > 0 ||
    cargoAtual !== "" ||
    tipoAtual !== "";

  function alterarQueryString(fn: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    fn(params);
    const qs = params.toString();
    router.push(`/freelancers/solicitacoes${qs ? `?${qs}` : ""}`);
  }

  function toggleStatus(v: FreelancerSolicitacaoStatus) {
    const nova = new Set(statusAtivos);
    if (nova.has(v)) nova.delete(v);
    else nova.add(v);
    alterarQueryString((p) => {
      if (nova.size > 0) p.set("status", Array.from(nova).join(","));
      else p.delete("status");
    });
  }

  function toggleSolicitante(id: string) {
    const nova = new Set(solicitantesAtivos);
    if (nova.has(id)) nova.delete(id);
    else nova.add(id);
    alterarQueryString((p) => {
      if (nova.size > 0) p.set("solicitante", Array.from(nova).join(","));
      else p.delete("solicitante");
    });
  }

  function toggleJob(id: string) {
    const nova = new Set(jobsAtivos);
    if (nova.has(id)) nova.delete(id);
    else nova.add(id);
    alterarQueryString((p) => {
      if (nova.size > 0) p.set("job", Array.from(nova).join(","));
      else p.delete("job");
    });
  }

  function setCargo(novo: string) {
    alterarQueryString((p) => {
      if (novo) p.set("cargo", novo);
      else p.delete("cargo");
    });
  }

  function setTipo(novo: string) {
    alterarQueryString((p) => {
      if (novo) p.set("tipo", novo);
      else p.delete("tipo");
    });
  }

  function limparFiltros() {
    setBusca("");
    alterarQueryString((p) => {
      p.delete("status");
      p.delete("solicitante");
      p.delete("cargo");
      p.delete("tipo");
      p.delete("job");
    });
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      if (sortDir === "asc") setSortDir("desc");
      else setSortKey(null);
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function abrir(s: SolicitacaoLinha) {
    setSelecionada(s);
    setPopoverOpen(true);
  }

  // Busca por nome do solicitante — client-side (join não suportado por .or())
  // e filtro de tipo — client-side (calculado após o fetch)
  const filtradas = React.useMemo(() => {
    let base = solicitacoes;
    const buscaNorm = busca.trim().toLowerCase();
    if (buscaNorm) {
      base = base.filter((s) => {
        if ((s.solicitante_nome ?? "").toLowerCase().includes(buscaNorm)) {
          return true;
        }
        // Nome freela, cargo, cpf — já cobertos pelo server-side via `?q=`.
        // Aqui só reforço solicitante_nome pq o server não consegue filtrar
        // via join.
        return (
          (s.nome_freela_display ?? "").toLowerCase().includes(buscaNorm) ||
          (s.nome_freela ?? "").toLowerCase().includes(buscaNorm) ||
          (s.cargo ?? "").toLowerCase().includes(buscaNorm) ||
          (s.cpf_freela ?? "").replace(/\D+/g, "").includes(buscaNorm.replace(/\D+/g, ""))
        );
      });
    }
    if (tipoAtual) {
      base = base.filter((s) => s.tipo_solicitacao === tipoAtual);
    }
    return base;
  }, [solicitacoes, busca, tipoAtual]);

  const ordenadas = React.useMemo(() => {
    const copy = [...filtradas];
    if (sortKey) {
      copy.sort((a, b) => {
        let cmp = 0;
        if (sortKey === "valor") {
          cmp = Number(a.valor) - Number(b.valor);
        } else if (sortKey === "status") {
          cmp =
            PRIORIDADE_STATUS[a.status as FreelancerSolicitacaoStatus] -
            PRIORIDADE_STATUS[b.status as FreelancerSolicitacaoStatus];
        } else if (sortKey === "created_at") {
          cmp = a.created_at.localeCompare(b.created_at);
        }
        if (cmp === 0) cmp = b.created_at.localeCompare(a.created_at);
        return sortDir === "asc" ? cmp : -cmp;
      });
    } else {
      copy.sort((a, b) => {
        const pa = PRIORIDADE_STATUS[a.status as FreelancerSolicitacaoStatus];
        const pb = PRIORIDADE_STATUS[b.status as FreelancerSolicitacaoStatus];
        if (pa !== pb) return pa - pb;
        return b.created_at.localeCompare(a.created_at);
      });
    }
    return copy;
  }, [filtradas, sortKey, sortDir]);

  // Pendentes visíveis — único subset elegível pra bulk
  const pendentesVisiveis = React.useMemo(
    () => ordenadas.filter((s) => s.status === "pendente"),
    [ordenadas],
  );

  // Mantém o Set clean quando o filtro muda
  React.useEffect(() => {
    const pendentesIds = new Set(pendentesVisiveis.map((s) => s.id));
    setSelecionadas((atual) => {
      let mudou = false;
      const novo = new Set<string>();
      atual.forEach((id) => {
        if (pendentesIds.has(id)) novo.add(id);
        else mudou = true;
      });
      return mudou ? novo : atual;
    });
  }, [pendentesVisiveis]);

  const todasSelecionadas =
    pendentesVisiveis.length > 0 &&
    pendentesVisiveis.every((s) => selecionadas.has(s.id));

  function toggleSelecionada(id: string) {
    setSelecionadas((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function toggleTodas() {
    if (todasSelecionadas) setSelecionadas(new Set());
    else setSelecionadas(new Set(pendentesVisiveis.map((s) => s.id)));
  }

  async function aprovarEmLote() {
    if (selecionadas.size === 0) return;
    const ids = Array.from(selecionadas);
    if (
      !confirm(
        `Aprovar ${ids.length} ${ids.length === 1 ? "solicitação" : "solicitações"}?`,
      )
    ) {
      return;
    }
    setAprovandoLote(true);
    try {
      const r = await aprovarSolicitacoesEmLote(ids);
      if (!r.ok) {
        alert(r.message);
        return;
      }
      if (r.data && r.data.falharam > 0) {
        alert(
          `${r.data.aprovadas} aprovadas; ${r.data.falharam} falharam (talvez já não estivessem pendentes).`,
        );
      }
      setSelecionadas(new Set());
      router.refresh();
    } finally {
      setAprovandoLote(false);
    }
  }

  // KPI cards
  const cards: Array<{
    key: string;
    label: string;
    valor: number;
    cor: string;
    dot: string;
  }> = [
    { key: "total", label: "Total", valor: totalContagem, cor: "text-foreground", dot: "bg-muted-foreground/40" },
    { key: "pendente", label: "Pendentes", valor: contagens.pendente ?? 0, cor: "text-amber-700", dot: "bg-amber-500" },
    { key: "aprovada", label: "Aprovadas", valor: contagens.aprovada ?? 0, cor: "text-sky-700", dot: "bg-sky-500" },
    { key: "cadastrada", label: "Cadastradas", valor: contagens.cadastrada ?? 0, cor: "text-emerald-700", dot: "bg-emerald-500" },
    { key: "rejeitada", label: "Rejeitadas", valor: contagens.rejeitada ?? 0, cor: "text-california-red", dot: "bg-california-red" },
    { key: "cancelada", label: "Canceladas", valor: contagens.cancelada ?? 0, cor: "text-muted-foreground", dot: "bg-zinc-400" },
  ];

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <section>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-3">
          Análise rápida
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {cards.map((c) => (
            <div
              key={c.key}
              className="rounded-2xl border border-border bg-white p-4"
            >
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
                {c.label}
              </div>
              <p className={cn("mt-1 text-3xl font-bold tabular-nums", c.cor)}>
                {c.valor}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Busca + filtros em dropdowns + ações */}
      <div className="rounded-xl border border-border bg-white p-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, CPF, cargo, solicitante..."
            className="w-full h-9 rounded-lg border border-border bg-white pl-9 pr-9 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-california-red focus:ring-2 focus:ring-california-red/15"
          />
          {busca && (
            <button
              type="button"
              onClick={() => setBusca("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Limpar busca"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <MultiSelectDropdown
          label="Todos os status"
          icon={<span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />}
          options={STATUS_SOLICITACAO.map((s) => ({
            value: s.value,
            label: s.label,
          }))}
          selected={statusAtivos}
          onToggle={(v) => toggleStatus(v as FreelancerSolicitacaoStatus)}
        />

        <SingleSelectDropdown
          label="Todos os tipos"
          icon={<span className="text-muted-foreground text-xs">⇄</span>}
          options={(["contratacao", "renovacao"] as const).map((t) => ({
            value: t,
            label: TIPO_META[t].label,
          }))}
          selected={tipoAtual}
          onSelect={setTipo}
        />

        {jobsDisponiveis.length > 0 && (
          <MultiSelectDropdown
            label="Todos os jobs"
            icon={<span className="text-muted-foreground text-xs">▣</span>}
            options={jobsDisponiveis.map((j) => ({
              value: j.id,
              label: j.label,
            }))}
            selected={jobsAtivos}
            onToggle={toggleJob}
          />
        )}

        {cargosDisponiveis.length > 0 && (
          <SingleSelectDropdown
            label="Todos os cargos"
            icon={<span className="text-muted-foreground text-xs">◉</span>}
            options={cargosDisponiveis.map((c) => ({ value: c, label: c }))}
            selected={cargoAtual}
            onSelect={setCargo}
          />
        )}

        {isAprovador && solicitantesDisponiveis.length > 0 && (
          <MultiSelectDropdown
            label="Solicitante"
            icon={<span className="text-muted-foreground text-xs">◎</span>}
            options={solicitantesDisponiveis.map((s) => ({
              value: s.id,
              label: nomeCurto(s.nome),
            }))}
            selected={solicitantesAtivos}
            onToggle={toggleSolicitante}
          />
        )}

        {temAlgumFiltro && (
          <button
            type="button"
            onClick={limparFiltros}
            className="inline-flex items-center gap-1 text-xs font-semibold text-california-red hover:underline"
          >
            <X className="h-3 w-3" />
            Limpar
          </button>
        )}

        {actions && (
          <div className="flex items-center gap-2 ml-auto">{actions}</div>
        )}
      </div>

      {/* Tabela */}
      {ordenadas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted/50">
            <ClipboardList className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">
            Nenhuma solicitação encontrada
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ajuste os filtros ou crie uma nova solicitação.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-soft">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/20 border-b border-border">
                <tr>
                  {isAprovador && (
                    <Th className="w-8 text-center">
                      <input
                        type="checkbox"
                        checked={todasSelecionadas}
                        onChange={toggleTodas}
                        disabled={pendentesVisiveis.length === 0}
                        aria-label="Selecionar todas as pendentes"
                        className="h-3.5 w-3.5 rounded border-border accent-california-red cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </Th>
                  )}
                  <Th>Freelancer</Th>
                  <Th>Job</Th>
                  <Th>Cargo</Th>
                  <Th>Tipo</Th>
                  <SortTh
                    sortKey="valor"
                    activeKey={sortKey}
                    direction={sortDir}
                    onToggle={toggleSort}
                    align="right"
                  >
                    Valor
                  </SortTh>
                  <Th>Prazo</Th>
                  <Th>Solicitante</Th>
                  <SortTh
                    sortKey="created_at"
                    activeKey={sortKey}
                    direction={sortDir}
                    onToggle={toggleSort}
                    align="center"
                  >
                    Pedido em
                  </SortTh>
                  <SortTh
                    sortKey="status"
                    activeKey={sortKey}
                    direction={sortDir}
                    onToggle={toggleSort}
                    align="center"
                  >
                    Status
                  </SortTh>
                </tr>
              </thead>
              <tbody>
                {ordenadas.map((s) => (
                  <SolicitacaoRow
                    key={s.id}
                    s={s}
                    naoLidas={naoLidasPorSolicitacao[s.id] ?? 0}
                    isAprovador={isAprovador}
                    selecionado={selecionadas.has(s.id)}
                    onToggleSelecao={() => toggleSelecionada(s.id)}
                    onAbrir={() => abrir(s)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PopoverSolicitacao
        solicitacao={selecionada}
        open={popoverOpen}
        onOpenChange={setPopoverOpen}
        activeRole={activeRole}
        userId={userId}
        publicOrigin={publicOrigin}
        naoLidas={
          selecionada ? (naoLidasPorSolicitacao[selecionada.id] ?? 0) : 0
        }
      />

      {/* Barra flutuante de bulk approval */}
      {isAprovador && selecionadas.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl border border-border bg-white shadow-elevated px-4 py-3 animate-in slide-in-from-bottom-2 duration-200">
          <span className="text-xs font-semibold text-foreground">
            {selecionadas.size}{" "}
            {selecionadas.size === 1 ? "selecionada" : "selecionadas"}
          </span>
          <button
            type="button"
            onClick={() => setSelecionadas(new Set())}
            disabled={aprovandoLote}
            className="inline-flex items-center gap-1 rounded-lg border border-border text-foreground text-xs font-semibold px-3 py-1.5 hover:bg-muted/40 disabled:opacity-60"
          >
            <X className="h-3 w-3" />
            Limpar
          </button>
          <button
            type="button"
            onClick={aprovarEmLote}
            disabled={aprovandoLote}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold px-3 py-1.5 hover:bg-emerald-700 transition-colors disabled:opacity-60"
          >
            {aprovandoLote ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Aprovar {selecionadas.size}
          </button>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "px-3 py-2.5 text-left font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap text-[10px]",
        className,
      )}
    >
      {children}
    </th>
  );
}

function SortTh({
  children,
  sortKey,
  activeKey,
  direction,
  onToggle,
  align = "left",
}: {
  children: React.ReactNode;
  sortKey: SortKey;
  activeKey: SortKey | null;
  direction: SortDir;
  onToggle: (key: SortKey) => void;
  align?: "left" | "right" | "center";
}) {
  const active = activeKey === sortKey;
  return (
    <th
      className={cn(
        "px-3 py-2.5 font-semibold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap text-[10px]",
        align === "right"
          ? "text-right"
          : align === "center"
            ? "text-center"
            : "text-left",
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground transition-colors",
          align === "right" && "flex-row-reverse",
          active && "text-california-red",
        )}
      >
        {children}
        {active ? (
          direction === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

function SolicitacaoRow({
  s,
  naoLidas,
  isAprovador,
  selecionado,
  onToggleSelecao,
  onAbrir,
}: {
  s: SolicitacaoLinha;
  naoLidas: number;
  isAprovador: boolean;
  selecionado: boolean;
  onToggleSelecao: () => void;
  onAbrir: () => void;
}) {
  // Prazo em 3 linhas (igual AgCaliforniaRH): data inicio, seta, data termino.
  // Com data_termino nulo, mostra "A partir de" + inicio em bloco unico.
  const prazoNode =
    s.data_inicio && s.data_termino ? (
      <div className="flex flex-col items-start leading-tight text-foreground tabular-nums">
        <span>{formatarDataLonga(s.data_inicio)}</span>
        <span className="text-muted-foreground">→</span>
        <span>{formatarDataLonga(s.data_termino)}</span>
      </div>
    ) : s.data_inicio ? (
      <span className="text-foreground tabular-nums">
        {formatarDataLonga(s.data_inicio)}
      </span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );

  return (
    <tr
      onClick={onAbrir}
      className="border-b border-border last:border-0 hover:bg-california-red/[0.02] transition-colors group cursor-pointer"
    >
      {isAprovador && (
        <td
          className="px-3 py-2.5 w-8 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          {s.status === "pendente" ? (
            <input
              type="checkbox"
              checked={selecionado}
              onChange={onToggleSelecao}
              aria-label={`Selecionar ${s.nome_freela}`}
              className="h-3.5 w-3.5 rounded border-border accent-california-red cursor-pointer"
            />
          ) : (
            <span className="text-muted-foreground/30">—</span>
          )}
        </td>
      )}
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          {naoLidas > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-california-red px-1.5 py-0.5 text-[9px] font-bold text-white"
              title={`${naoLidas} mensagem(ns) não lida(s)`}
            >
              <MessageCircle className="h-2.5 w-2.5" />
              {naoLidas}
            </span>
          )}
          <p className="font-semibold text-foreground">
            {s.nome_freela_display}
          </p>
        </div>
        {s.cpf_freela && (
          <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
            {formatCpf(s.cpf_freela)}
          </p>
        )}
      </td>
      <td className="px-3 py-2.5">
        <p className="text-foreground">
          {s.job_codigo && (
            <span className="text-muted-foreground tabular-nums mr-1">
              {s.job_codigo}
            </span>
          )}
          {s.job_nome ?? "—"}
        </p>
      </td>
      <td className="px-3 py-2.5 text-foreground">
        {s.cargo || <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2.5">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap",
            TIPO_META[s.tipo_solicitacao].pill,
          )}
        >
          {TIPO_META[s.tipo_solicitacao].label}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
        {formatCurrency(Number(s.valor))}
        <span className="text-[10px] text-muted-foreground"> /{s.tipo}</span>
      </td>
      <td className="px-3 py-2.5 align-top">{prazoNode}</td>
      <td className="px-3 py-2.5 text-foreground truncate max-w-[160px]">
        {nomeCurto(s.solicitante_nome)}
      </td>
      <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">
        {new Date(s.created_at).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "2-digit",
        })}
      </td>
      <td className="px-3 py-2.5 text-center">
        <ChipStatusSolicitacao
          status={s.status as FreelancerSolicitacaoStatus}
        />
      </td>
    </tr>
  );
}

function formatarDataLonga(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function MultiSelectDropdown({
  label,
  icon,
  options,
  selected,
  onToggle,
}: {
  label: string;
  icon?: React.ReactNode;
  options: Array<{ value: string; label: string }>;
  selected: Set<string>;
  onToggle: (v: string) => void;
}) {
  const { open, toggleOpen, containerRef } = useExclusiveDropdown();
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        className="h-9 inline-flex items-center gap-2 rounded-lg px-3 text-sm font-medium border bg-white text-foreground border-border hover:border-california-red/40 transition-all"
      >
        {icon}
        <span>{label}</span>
        {selected.size > 0 && (
          <span className="tabular-nums rounded-full bg-california-red text-white px-1.5 py-0.5 text-[10px] leading-none font-semibold">
            {selected.size}
          </span>
        )}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 min-w-[220px] max-w-[320px] max-h-[320px] overflow-y-auto rounded-xl border border-border bg-white shadow-elevated p-1">
          {options.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground text-center">
              Nenhuma opção
            </p>
          ) : (
            options.map((o) => {
              const checked = selected.has(o.value);
              return (
                <label
                  key={o.value}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 cursor-pointer text-xs"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(o.value)}
                    className="h-3.5 w-3.5 rounded border-border accent-california-red"
                  />
                  <span className="truncate">{o.label}</span>
                </label>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function SingleSelectDropdown({
  label,
  icon,
  options,
  selected,
  onSelect,
}: {
  label: string;
  icon?: React.ReactNode;
  options: Array<{ value: string; label: string }>;
  selected: string;
  onSelect: (v: string) => void;
}) {
  const { open, toggleOpen, close, containerRef } = useExclusiveDropdown();
  const atual = options.find((o) => o.value === selected);
  function pick(v: string) {
    onSelect(v);
    close();
  }
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        className="h-9 inline-flex items-center gap-2 rounded-lg px-3 text-sm font-medium border bg-white text-foreground border-border hover:border-california-red/40 transition-all"
      >
        {icon}
        <span>{atual ? atual.label : label}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 min-w-[220px] max-w-[320px] max-h-[320px] overflow-y-auto rounded-xl border border-border bg-white shadow-elevated p-1">
          <button
            type="button"
            onClick={() => pick("")}
            className={cn(
              "block w-full text-left px-2 py-1.5 rounded-md hover:bg-muted/40 text-xs",
              !selected && "font-semibold text-california-red",
            )}
          >
            {label}
          </button>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => pick(o.value)}
              className={cn(
                "block w-full text-left px-2 py-1.5 rounded-md hover:bg-muted/40 text-xs",
                selected === o.value && "font-semibold text-california-red",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
