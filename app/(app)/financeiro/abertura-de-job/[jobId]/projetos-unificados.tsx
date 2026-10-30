"use client";

/**
 * Consultar o que já está em cada projeto unificado antes de escolher
 * (decisão 228, 30/10/2026 — opção A+B do protótipo "Projetos e Jobs"):
 *
 *   A. na lista do campo, o "N jobs ▾" de cada linha abre os jobs ali
 *      mesmo, sem escolher o projeto — escolher continua sendo o clique no
 *      nome;
 *   B. no pé da lista, "Ver todos os projetos unificados e os jobs de cada
 *      um" abre um painel largo com a busca por projeto, cliente ou job.
 *
 * Os dois recebem a lista que o campo já mostra: só a empresa escolhida
 * no job, os do cliente do job em cima.
 */
import * as React from "react";
import { ChevronDown, ChevronRight, FolderKanban, Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { jobStatusBadgeClasses, jobStatusLabel, type JobStatusExibido } from "@/lib/types";
import { cn, formatCurrency } from "@/lib/utils";
import { resumoDosClientes } from "@/lib/resumo-dos-clientes";
import type {
  JobDoProjetoUnificado,
  ProjetoFinanceiroOpcao,
} from "@/lib/data/projetos-financeiro";

type Projeto = ProjetoFinanceiroOpcao & { novo: boolean };

/** Sem acento e sem caixa — o mesmo critério da busca do campo. */
const normalizar = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function SeloStatus({ status }: { status: JobStatusExibido }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-px text-[9.5px] font-semibold uppercase tracking-[0.06em]",
        jobStatusBadgeClasses(status),
      )}
    >
      {jobStatusLabel(status)}
    </span>
  );
}

/** Os jobs de um projeto, compactos — embaixo da linha do campo. */
function JobsCompactos({ jobs }: { jobs: JobDoProjetoUnificado[] }) {
  const total = jobs.reduce((s, j) => s + j.valor, 0);
  return (
    <div className="mx-2.5 mb-1.5 mt-0.5 rounded-lg border border-border bg-[#fafafa] px-2.5 py-1.5">
      {jobs.map((j) => (
        <div
          key={j.id}
          className="flex items-baseline gap-2 border-b border-dashed border-border py-1 text-[11.5px] last:border-0"
        >
          <span className="w-[86px] shrink-0 font-mono text-[10.5px] text-[#8a8a8a]">
            {j.codigo}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={j.nome}>
            {j.nome}
          </span>
          <span
            className="w-[130px] shrink-0 truncate text-muted-foreground"
            title={j.cliente ?? undefined}
          >
            {j.cliente ?? "—"}
          </span>
          <span className="w-[96px] shrink-0 text-right tabular-nums text-muted-foreground">
            {formatCurrency(j.valor, "BRL")}
          </span>
        </div>
      ))}
      <div className="flex justify-between pt-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#8a8a8a]">
        <span>
          {jobs.length} {jobs.length === 1 ? "job" : "jobs"} no projeto
        </span>
        <span className="tabular-nums">{formatCurrency(total, "BRL")}</span>
      </div>
    </div>
  );
}

/**
 * A linha da lista do campo Projeto unificado: nome e clientes (escolhe o
 * projeto) e o "N jobs ▾" à direita (abre os jobs embaixo).
 */
export function LinhaDoProjetoUnificado({
  pr,
  selecionado,
  seloNovo,
  aberta,
  onEscolher,
  onAlternar,
}: {
  pr: Projeto;
  selecionado: boolean;
  seloNovo: React.ReactNode;
  aberta: boolean;
  onEscolher: () => void;
  onAlternar: () => void;
}) {
  const n = pr.jobs.length;
  return (
    <div className={cn("rounded-lg", aberta && "bg-muted/60")}>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onEscolher}
          className={cn(
            "block min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-muted",
            selecionado && "bg-california-red/[0.06] text-california-red",
          )}
        >
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate font-semibold">{pr.nome}</span>
            {pr.novo && seloNovo}
          </span>
          <span
            className="mt-0.5 block truncate text-[11px] text-muted-foreground"
            title={pr.clientes.map((c) => c.nome ?? "—").join(", ")}
          >
            {resumoDosClientes(pr.clientes.map((c) => c.nome))}
          </span>
        </button>
        {!pr.novo && n > 0 && (
          <button
            type="button"
            onClick={onAlternar}
            aria-expanded={aberta}
            title={aberta ? "Esconder os jobs" : "Ver os jobs deste projeto"}
            className="my-1 mr-1 inline-flex shrink-0 items-center gap-1 self-center rounded-md px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-white hover:text-california-red"
          >
            {n} {n === 1 ? "job" : "jobs"}
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", aberta && "rotate-180")}
            />
          </button>
        )}
      </div>
      {aberta && <JobsCompactos jobs={pr.jobs} />}
    </div>
  );
}

/** O pé da lista do campo: abre o painel. */
export function BotaoTodosOsProjetos({ onAbrir }: { onAbrir: () => void }) {
  return (
    <div className="border-t border-border p-1.5">
      <button
        type="button"
        onClick={onAbrir}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-semibold text-california-red transition-colors hover:bg-california-red/[0.06]"
      >
        <FolderKanban className="h-4 w-4" />
        Ver todos os projetos unificados e os jobs de cada um
      </button>
    </div>
  );
}

/**
 * O painel: os projetos unificados da empresa numa tabela, com a busca,
 * os do cliente do job em cima e os jobs de cada projeto ao abrir a linha.
 */
export function TodosOsProjetosDialog({
  open,
  onOpenChange,
  projetos,
  ehDoClienteDoJob,
  clienteDoJobNome,
  empresaNome,
  jobCodigo,
  selecionadoId,
  onEscolher,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projetos: Projeto[];
  ehDoClienteDoJob: (p: Projeto) => boolean;
  clienteDoJobNome: string | null;
  empresaNome: string;
  jobCodigo: string;
  selecionadoId: string;
  onEscolher: (id: string) => void;
}) {
  const [busca, setBusca] = React.useState("");
  const [abertos, setAbertos] = React.useState<Set<string>>(new Set());
  const [soDoCliente, setSoDoCliente] = React.useState(false);

  // Cada abertura recomeça limpa, com o projeto escolhido já aberto.
  React.useEffect(() => {
    if (!open) return;
    setBusca("");
    setSoDoCliente(false);
    setAbertos(new Set(selecionadoId ? [selecionadoId] : []));
  }, [open, selecionadoId]);

  const q = normalizar(busca.trim());
  const casaNoJob = (j: JobDoProjetoUnificado) =>
    !!q && (normalizar(j.nome).includes(q) || normalizar(j.codigo).includes(q));
  const filtrados = projetos.filter((p) => {
    if (soDoCliente && !ehDoClienteDoJob(p)) return false;
    if (!q) return true;
    return (
      normalizar(p.nome).includes(q) ||
      p.clientes.some((c) => normalizar(c.nome ?? "").includes(q)) ||
      p.jobs.some(casaNoJob)
    );
  });
  const grupos = [
    {
      titulo: `Deste cliente${clienteDoJobNome ? ` · ${clienteDoJobNome}` : ""}`,
      itens: filtrados.filter(ehDoClienteDoJob),
    },
    { titulo: "De outros clientes", itens: filtrados.filter((p) => !ehDoClienteDoJob(p)) },
  ].filter((g) => g.itens.length > 0);

  function alternar(id: string) {
    setAbertos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1080px] gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-5">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <FolderKanban className="h-5 w-5 text-california-red" />
            Projetos unificados de {empresaNome}
          </DialogTitle>
          <DialogDescription>
            Consulte o que já está em cada projeto antes de escolher o do {jobCodigo}. Clique
            num projeto para ver os jobs dele; “Escolher” põe o job no projeto e fecha o
            painel. Só aparecem os projetos de {empresaNome}: para ver os de outra empresa,
            troque a empresa do job.
          </DialogDescription>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[320px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a8a8a]" />
              <Input
                autoFocus
                aria-label="Buscar projeto unificado"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por projeto, cliente ou job"
                className="h-9 pl-9 text-[13px]"
              />
              {busca && (
                <button
                  type="button"
                  aria-label="Limpar busca"
                  onClick={() => setBusca("")}
                  className="absolute right-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md bg-muted text-muted-foreground hover:text-california-red"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <div className="inline-flex rounded-lg border border-border bg-white p-0.5 text-[12px] font-semibold">
              {(
                [
                  [false, "Todos os clientes"],
                  [true, "Só deste cliente"],
                ] as const
              ).map(([v, rotulo]) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => setSoDoCliente(v)}
                  className={cn(
                    "rounded-md px-3 py-1.5 transition-colors",
                    soDoCliente === v
                      ? "bg-california-red text-white"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-3 pb-3">
          <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
            <colgroup>
              <col style={{ width: 36 }} />
              <col />
              <col style={{ width: 300 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 118 }} />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="text-left text-[10px] font-bold uppercase tracking-[0.09em] text-[#8a8a8a]">
                <th className="border-b border-border py-2.5" />
                <th className="border-b border-border py-2.5">Projeto</th>
                <th className="border-b border-border py-2.5">Clientes</th>
                <th className="border-b border-border py-2.5 text-right">Jobs</th>
                <th className="border-b border-border py-2.5 text-right">Valor dos jobs</th>
                <th className="border-b border-border py-2.5" />
              </tr>
            </thead>
            {grupos.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    {q
                      ? `Nenhum projeto com “${busca.trim()}”.`
                      : "Nenhum projeto unificado aberto nesta empresa."}
                  </td>
                </tr>
              </tbody>
            ) : (
              grupos.map((g) => (
                <tbody key={g.titulo}>
                  <tr>
                    <td
                      colSpan={6}
                      className="px-2 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.09em] text-[#8a8a8a]"
                    >
                      {g.titulo}
                    </td>
                  </tr>
                  {g.itens.map((p) => {
                    // Com a busca, o projeto que só casou por um job abre
                    // sozinho: o job achado precisa aparecer.
                    const aberto =
                      abertos.has(p.id) ||
                      (p.jobs.some(casaNoJob) && !normalizar(p.nome).includes(q));
                    const total = p.jobs.reduce((s, j) => s + j.valor, 0);
                    const escolhido = p.id === selecionadoId;
                    const temJobs = !p.novo && p.jobs.length > 0;
                    return (
                      <React.Fragment key={p.id}>
                        <tr
                          className={cn(
                            temJobs && "cursor-pointer",
                            escolhido ? "bg-california-red/[0.05]" : "hover:bg-muted/60",
                          )}
                          onClick={() => temJobs && alternar(p.id)}
                        >
                          <td className="border-b border-border py-2.5 pl-2 align-top">
                            {temJobs && (
                              <ChevronRight
                                className={cn(
                                  "h-4 w-4 text-[#8a8a8a] transition-transform",
                                  aberto && "rotate-90 text-california-red",
                                )}
                              />
                            )}
                          </td>
                          <td className="border-b border-border py-2.5 pr-3 align-top">
                            <span
                              className={cn(
                                "block truncate font-semibold",
                                escolhido && "text-california-red",
                              )}
                            >
                              {p.nome}
                            </span>
                            {p.novo && (
                              <span className="text-[11px] text-muted-foreground">
                                Projeto novo · nasce com este job
                              </span>
                            )}
                          </td>
                          <td className="border-b border-border py-2.5 pr-3 align-top text-[12px] text-muted-foreground">
                            <span
                              className="block truncate"
                              title={p.clientes.map((c) => c.nome ?? "—").join(", ")}
                            >
                              {p.clientes.map((c) => c.nome ?? "—").join(", ")}
                            </span>
                          </td>
                          <td className="border-b border-border py-2.5 text-right align-top tabular-nums">
                            {p.jobs.length}
                          </td>
                          <td className="border-b border-border py-2.5 text-right align-top tabular-nums">
                            {formatCurrency(total, "BRL")}
                          </td>
                          <td className="border-b border-border py-1.5 pr-1 text-right align-top">
                            {escolhido ? (
                              <span className="inline-flex h-8 items-center px-2 text-[12px] font-semibold text-california-red">
                                Escolhido
                              </span>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 text-[12px]"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEscolher(p.id);
                                }}
                              >
                                Escolher
                              </Button>
                            )}
                          </td>
                        </tr>
                        {aberto && (
                          <tr>
                            <td />
                            <td colSpan={5} className="border-b border-border pb-3 pr-2 pt-1">
                              <div className="overflow-hidden rounded-lg border border-border">
                                {p.jobs.map((j) => (
                                  <div
                                    key={j.id}
                                    className={cn(
                                      "flex items-center gap-3 border-b border-border px-3 py-2 text-[12.5px] last:border-0",
                                      casaNoJob(j) ? "bg-amber-50" : "bg-[#fafafa]",
                                    )}
                                  >
                                    <span className="w-[96px] shrink-0 font-mono text-[11px] text-[#8a8a8a]">
                                      {j.codigo}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate font-medium" title={j.nome}>
                                      {j.nome}
                                    </span>
                                    <span
                                      className="w-[190px] shrink-0 truncate text-muted-foreground"
                                      title={j.cliente ?? undefined}
                                    >
                                      {j.cliente ?? "—"}
                                    </span>
                                    <span className="w-[64px] shrink-0 text-muted-foreground">
                                      {j.competencia}
                                    </span>
                                    <span className="w-[120px] shrink-0 text-right tabular-nums">
                                      {formatCurrency(j.valor, "BRL")}
                                    </span>
                                    <span className="w-[150px] shrink-0 text-right">
                                      <SeloStatus status={j.status} />
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              ))
            )}
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
