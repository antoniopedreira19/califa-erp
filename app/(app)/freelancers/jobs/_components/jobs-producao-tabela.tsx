"use client";

import * as React from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";

interface JobProducao {
  id: string;
  codigo: string;
  nome: string;
}

interface Props {
  jobs: JobProducao[];
}

/**
 * Lista de jobs de produção com busca client-side por código e nome.
 * 133 linhas em memória, filtro acentuação-insensível e case-insensível.
 * A tabela em si é dumb — só renderiza o que vier filtrado.
 */
export function JobsProducaoTabela({ jobs }: Props) {
  const [busca, setBusca] = React.useState("");

  const filtrados = React.useMemo(() => {
    const alvo = norm(busca.trim());
    if (!alvo) return jobs;
    return jobs.filter(
      (j) => norm(j.codigo).includes(alvo) || norm(j.nome).includes(alvo),
    );
  }, [jobs, busca]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por código ou nome do job..."
          className="w-full h-10 rounded-lg border border-border bg-white pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:border-california-red focus:ring-california-red/15"
        />
        {busca && (
          <button
            type="button"
            onClick={() => setBusca("")}
            aria-label="Limpar busca"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {filtrados.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum job encontrado para &ldquo;{busca}&rdquo;.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 w-[140px]">Código</th>
                <th className="text-left px-4 py-3">Nome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtrados.map((j) => (
                <tr key={j.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      href={`/jobs/${j.id}`}
                      prefetch={false}
                      className="font-mono text-xs font-semibold text-california-red hover:underline"
                    >
                      {j.codigo}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/jobs/${j.id}`}
                      prefetch={false}
                      className="hover:underline"
                    >
                      {j.nome}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}
