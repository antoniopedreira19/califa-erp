"use client";

import * as React from "react";
import { CheckCheck, ClipboardCheck, Search } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { JobNaFila } from "./dados";
import { formatPeriodo } from "./formatos";
import { ConferenciaDialog } from "./conferencia-dialog";
import { ReprovarDialog } from "./reprovar-dialog";

export interface FilaLinha extends JobNaFila {
  /** "há 2 horas" — calculado no server para não divergir na hidratação. */
  enviado_em_label: string;
}

export function FilaAbertura({ linhas }: { linhas: FilaLinha[] }) {
  const [busca, setBusca] = React.useState("");
  const [conferindoId, setConferindoId] = React.useState<string | null>(null);
  const [reprovandoId, setReprovandoId] = React.useState<string | null>(null);

  const visiveis = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return linhas;
    return linhas.filter((l) =>
      [l.codigo, l.nome, l.projeto_codigo, l.projeto_nome, l.cliente_nome]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [linhas, busca]);

  const total = visiveis.reduce((s, l) => s + (l.valor_total ?? 0), 0);
  const conferindo = linhas.find((l) => l.id === conferindoId) ?? null;
  const reprovando = linhas.find((l) => l.id === reprovandoId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative flex items-center">
          <Search className="absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por código, job, projeto ou cliente"
            className="h-[38px] w-80 rounded-lg border border-border bg-white pl-9 pr-3 text-[13px] outline-none focus:border-california-red/40"
          />
        </div>
        {visiveis.length > 0 && (
          <span className="ml-auto text-[12.5px] text-muted-foreground">
            {visiveis.length === 1 ? "1 job na fila" : `${visiveis.length} jobs na fila`}{" "}
            · {formatCurrency(total)}
          </span>
        )}
      </div>

      {visiveis.length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Código</th>
                <th className="px-4 py-3 font-semibold">Job</th>
                <th className="px-4 py-3 font-semibold">Projeto · Cliente</th>
                <th className="px-4 py-3 font-semibold">GP responsável</th>
                <th className="px-4 py-3 text-right font-semibold">
                  Valor total
                </th>
                <th className="px-4 py-3 font-semibold">Enviado</th>
                <th className="px-4 py-3 text-right font-semibold">Abertura</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => (
                <tr
                  key={l.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setConferindoId(l.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setConferindoId(l.id);
                    }
                  }}
                  className="cursor-pointer border-b border-b-[#f4f2f2] transition-colors last:border-0 hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none"
                >
                  <td className="px-4 py-3.5">
                    <span className="font-mono text-xs font-bold text-[#b3323c]">
                      {l.codigo}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold">{l.nome}</span>
                      <span className="font-mono text-[11.5px] text-muted-foreground">
                        {formatPeriodo(
                          l.data_inicio_prevista,
                          l.data_fim_prevista,
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[13px]">
                        <span className="font-mono text-xs text-muted-foreground">
                          {l.projeto_codigo ?? "—"}
                        </span>{" "}
                        {l.projeto_nome ?? ""}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {[l.cliente_nome, l.produto].filter(Boolean).join(" · ") ||
                          "—"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground">
                    {l.responsavel_nome ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-right font-semibold tabular-nums">
                    {formatCurrency(l.valor_total)}
                  </td>
                  <td className="px-4 py-3.5 text-[12.5px] text-muted-foreground">
                    {l.enviado_em_label}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConferindoId(l.id);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-california-red-hover"
                      >
                        <ClipboardCheck className="h-3.5 w-3.5" />
                        Abrir job
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-dashed border-border bg-card px-8 py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <CheckCheck className="h-5 w-5" />
          </div>
          <p className="text-base font-semibold">
            {linhas.length === 0
              ? "Nenhum job aguardando abertura"
              : "Nada encontrado"}
          </p>
          <p className="max-w-[380px] text-[13.5px] text-muted-foreground">
            {linhas.length === 0
              ? "Assim que a produção enviar um job, ele aparece aqui para conferência e abertura."
              : "Nenhum job corresponde à busca. Ajuste os termos."}
          </p>
        </div>
      )}

      {/* A conferência sai de cena enquanto a reprovação está aberta: dois
          modais empilhados escondem o texto que a pessoa está escrevendo. */}
      {reprovandoId === null && (
        <ConferenciaDialog
          job={conferindo}
          onOpenChange={(aberto) => !aberto && setConferindoId(null)}
          onReprovar={() => setReprovandoId(conferindoId)}
        />
      )}

      {reprovando && (
        <ReprovarDialog
          open
          onOpenChange={(aberto) => {
            if (!aberto) {
              setReprovandoId(null);
              setConferindoId(null);
            }
          }}
          jobId={reprovando.id}
          jobCodigo={reprovando.codigo}
          gpNome={reprovando.responsavel_nome}
          produtorNome={reprovando.produtor_nome}
        />
      )}
    </div>
  );
}
