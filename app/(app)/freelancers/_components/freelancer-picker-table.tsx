"use client";

import * as React from "react";
import { Search, X, Lock } from "lucide-react";
import { cn, initials, nomeCurto } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type StatusVinculo = "ativo" | "inativo" | "sem_contrato";

export interface FreelancerLookup {
  id: string;
  nome_social: string;
  nome_completo: string | null;
  cargo_contrato: string | null;
  nome_job: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  status_vinculo: StatusVinculo;
}

const ALL = "__all__";

const VINCULO_BADGE: Record<
  StatusVinculo,
  { label: string; dot: string; bg: string; text: string }
> = {
  ativo: {
    label: "Ativo",
    dot: "bg-emerald-500",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
  },
  inativo: {
    label: "Inativo",
    dot: "bg-zinc-400",
    bg: "bg-zinc-100",
    text: "text-zinc-600",
  },
  sem_contrato: {
    label: "Sem contrato",
    dot: "bg-sky-500",
    bg: "bg-sky-50",
    text: "text-sky-700",
  },
};

function normalize(v: string): string {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

interface Props {
  freelancers: FreelancerLookup[];
  /** Id do usuário atual (pra marcar linha dele como clicável mesmo em "ativo"). */
  currentUserId: string;
  /** Admin/RH/financeiro ignora o bloqueio de "ativo com outro responsável". */
  isAprovador: boolean;
  onSelect: (freelancerId: string) => void;
}

export function FreelancerPickerTable({
  freelancers,
  currentUserId,
  isAprovador,
  onSelect,
}: Props) {
  const [busca, setBusca] = React.useState("");
  const [cargo, setCargo] = React.useState<string>(ALL);
  const [job, setJob] = React.useState<string>(ALL);
  const [vinculo, setVinculo] = React.useState<string>(ALL);

  const cargos = React.useMemo(() => {
    const set = new Set<string>();
    for (const f of freelancers) if (f.cargo_contrato) set.add(f.cargo_contrato);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [freelancers]);

  const jobs = React.useMemo(() => {
    const set = new Set<string>();
    for (const f of freelancers) if (f.nome_job) set.add(f.nome_job);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [freelancers]);

  const filtered = React.useMemo(() => {
    const buscaNorm = normalize(busca.trim());
    return freelancers.filter((f) => {
      if (cargo !== ALL && f.cargo_contrato !== cargo) return false;
      if (job !== ALL && f.nome_job !== job) return false;
      if (vinculo !== ALL && f.status_vinculo !== vinculo) return false;
      if (buscaNorm) {
        const alvo = `${f.nome_social ?? ""} ${f.nome_completo ?? ""}`;
        if (!normalize(alvo).includes(buscaNorm)) return false;
      }
      return true;
    });
  }, [freelancers, busca, cargo, job, vinculo]);

  function limparFiltros() {
    setBusca("");
    setCargo(ALL);
    setJob(ALL);
    setVinculo(ALL);
  }

  const temFiltro =
    busca !== "" || cargo !== ALL || job !== ALL || vinculo !== ALL;

  function isBloqueado(f: FreelancerLookup): boolean {
    if (isAprovador) return false;
    // GP/produtor não pode "roubar" freela ativo de outro responsável.
    return (
      f.status_vinculo === "ativo" &&
      f.responsavel_id !== null &&
      f.responsavel_id !== currentUserId
    );
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="px-5 pt-4 pb-3 border-b border-border bg-muted/30 space-y-3 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por nome..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm text-foreground rounded-lg border border-border bg-white focus:outline-none focus:ring-2 focus:ring-california-red/30 focus:border-california-red/50"
            autoFocus
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={cargo} onValueChange={setCargo}>
            <SelectTrigger className="h-9 w-auto min-w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={ALL}>Todos os cargos</SelectItem>
              {cargos.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={job} onValueChange={setJob}>
            <SelectTrigger className="h-9 w-auto min-w-[220px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={ALL}>Todos os jobs</SelectItem>
              {jobs.map((j) => (
                <SelectItem key={j} value={j}>
                  {j}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={vinculo} onValueChange={setVinculo}>
            <SelectTrigger className="h-9 w-auto min-w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={ALL}>Todos os vínculos</SelectItem>
              {(Object.keys(VINCULO_BADGE) as StatusVinculo[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {VINCULO_BADGE[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {temFiltro && (
            <button
              type="button"
              onClick={limparFiltros}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
              Limpar
            </button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length} de {freelancers.length}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhum freelancer encontrado com esses filtros.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white border-b border-border z-10">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-2.5">Nome</th>
                <th className="px-3 py-2.5">Cargo</th>
                <th className="px-3 py-2.5">Job</th>
                <th className="px-3 py-2.5">Responsável</th>
                <th className="px-5 py-2.5">Vínculo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((f) => {
                const badge = VINCULO_BADGE[f.status_vinculo];
                const bloqueado = isBloqueado(f);
                const titleBloqueio = bloqueado
                  ? `Ativo com ${nomeCurto(f.responsavel_nome)} — finalize o atual primeiro`
                  : undefined;
                return (
                  <tr
                    key={f.id}
                    onClick={bloqueado ? undefined : () => onSelect(f.id)}
                    title={titleBloqueio}
                    aria-disabled={bloqueado}
                    className={cn(
                      "transition-colors",
                      bloqueado
                        ? "cursor-not-allowed opacity-60"
                        : "cursor-pointer hover:bg-california-red/[0.03]",
                    )}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-8 w-8 shrink-0 rounded-full bg-california-red/10 text-california-red flex items-center justify-center text-[11px] font-bold">
                          {initials(f.nome_social)}
                        </div>
                        <div className="min-w-0 flex items-center gap-1.5">
                          <div className="font-medium text-foreground truncate">
                            {f.nome_social}
                          </div>
                          {bloqueado && (
                            <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-foreground/80">
                      {f.cargo_contrato ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-foreground/80">
                      {f.nome_job ?? "—"}
                    </td>
                    <td className="px-3 py-3 text-foreground/80">
                      {nomeCurto(f.responsavel_nome)}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                          badge.bg,
                          badge.text,
                        )}
                      >
                        <span
                          className={cn("h-1.5 w-1.5 rounded-full", badge.dot)}
                        />
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
