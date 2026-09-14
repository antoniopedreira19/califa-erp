"use client";

/** A vista "Trimestre" do orçamento mensal: os meses empilhados, cada um
 *  recolhível, com os números do mês no cabeçalho (decisão 078; design
 *  aprovado em 14/09/2026 — era a "alternativa com meses empilhados").
 *
 *  O conteúdo de cada mês é a planilha dele, montada no servidor. Ela vai
 *  ABAIXO do cabeçalho, e não dentro de um card com `overflow-hidden`: a
 *  calha de ações (BV, PP, lixeira) mora fora do frame da tabela e seria
 *  cortada. */

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { ORCADO, PLANEJADO } from "@/app/(app)/_planilha/blocos";
import { BotaoRecolherTodos } from "@/app/(app)/_planilha/recolher-grupos";

export interface MesDoTrimestre {
  id: string;
  titulo: string;
  /** "2 grupos · 19 itens". */
  resumo: string;
  /** "julho" — no link "Abrir julho". */
  nome: string;
  faturamento: number;
  custoPlanejado: number;
  resultadoOperacional: number | null;
  resultadoGeral: number | null;
  href: string;
  conteudo: React.ReactNode;
}

export function TrimestreEmpilhado({
  meses,
  moeda,
}: {
  meses: MesDoTrimestre[];
  moeda: string;
}) {
  // Nasce com o primeiro mês aberto: com os três abertos a página enterra
  // o Totais do trimestre, e com todos fechados ela não mostra planilha.
  const [abertos, setAbertos] = React.useState<Set<string>>(
    () => new Set(meses[0] ? [meses[0].id] : []),
  );
  const algumAberto = abertos.size > 0;

  function alternar(id: string) {
    setAbertos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center">
        <BotaoRecolherTodos
          algumAberto={algumAberto}
          onAlternarTodos={() =>
            setAbertos(algumAberto ? new Set() : new Set(meses.map((m) => m.id)))
          }
        />
      </div>
      {meses.map((m) => {
        const aberto = abertos.has(m.id);
        return (
          <div key={m.id} className="space-y-3">
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-3 shadow-soft">
              <button
                type="button"
                onClick={() => alternar(m.id)}
                aria-expanded={aberto}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <ChevronRight
                  className={cn(
                    "h-4 w-4 flex-none text-muted-foreground transition-transform",
                    aberto && "rotate-90",
                  )}
                />
                <span className="w-[160px] flex-none text-[15px] font-bold tracking-[-0.01em]">
                  {m.titulo}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {m.resumo}
                </span>
              </button>
              <div className="grid flex-none grid-cols-[140px_140px_140px_72px] gap-6">
                <Metrica rotulo="Faturamento" className={ORCADO.texto}>
                  {formatCurrency(m.faturamento, moeda)}
                </Metrica>
                <Metrica rotulo="Custo planejado" className={PLANEJADO.texto}>
                  {formatCurrency(m.custoPlanejado, moeda)}
                </Metrica>
                <Metrica rotulo="Resultado op.">
                  {m.resultadoOperacional === null
                    ? "—"
                    : formatCurrency(m.resultadoOperacional, moeda)}
                </Metrica>
                <Metrica rotulo="Geral">
                  {m.resultadoGeral === null
                    ? "—"
                    : `${m.resultadoGeral.toFixed(1).replace(".", ",")}%`}
                </Metrica>
              </div>
              <Link
                href={m.href}
                prefetch={false}
                className="flex-none whitespace-nowrap rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
              >
                Abrir {m.nome}
              </Link>
            </div>
            {aberto && m.conteudo}
          </div>
        );
      })}
    </div>
  );
}

function Metrica({
  rotulo,
  className,
  children,
}: {
  rotulo: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </span>
      <span
        className={cn(
          "whitespace-nowrap font-mono text-[13px] font-bold leading-4 text-foreground",
          className,
        )}
      >
        {children}
      </span>
    </div>
  );
}
