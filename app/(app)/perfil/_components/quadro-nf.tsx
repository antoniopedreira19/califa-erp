"use client";

import * as React from "react";
import { Eye, EyeOff, FileText } from "lucide-react";
import type { NfPendenteQuadro, TipoContratacao } from "@/lib/types";
import { QuadroNfLinha } from "./quadro-nf-linha";

// Wrapper client só para o modal de histórico (precisa de estado).
import { QuadroNfHistorico } from "./quadro-nf-historico";

const TIPOS_COM_NF: TipoContratacao[] = ["pj", "mei", "clt_recibo"];

export function QuadroNf(props: {
  colaboradorId: string;
  tipoContratacao: TipoContratacao;
  linhas: NfPendenteQuadro[];
  alocacaoResumo: string | null;
}) {
  // Valores dos salários/férias/13° ficam ocultos por padrão (mesmo
  // comportamento do CardCustoQuadro no módulo RH). Toggle manual revela
  // enquanto a aba está aberta.
  const [oculto, setOculto] = React.useState(true);

  if (!TIPOS_COM_NF.includes(props.tipoContratacao)) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-soft space-y-4">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <FileText className="h-4 w-4 text-california-red" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Quadro de NFs</h2>
            <p className="text-xs text-muted-foreground">
              Notas fiscais pendentes e já enviadas por competência/evento.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOculto((v) => !v)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label={oculto ? "Mostrar valores" : "Esconder valores"}
            title={oculto ? "Mostrar valores" : "Esconder valores"}
          >
            {oculto ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
          <QuadroNfHistorico colaboradorId={props.colaboradorId} />
        </div>
      </div>

      {/* Lista de linhas */}
      {props.linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          Nenhuma NF pendente no momento.
        </p>
      ) : (
        <div className="space-y-2">
          {props.linhas.map((l) => {
            // Chave única: escopo_tipo + escopo_id (pode ser null para stubs de 13°)
            const key = `${l.escopo_tipo}__${l.escopo_id ?? l.label}`;
            return (
              <QuadroNfLinha
                key={key}
                linha={l}
                alocacaoResumo={props.alocacaoResumo}
                valorOculto={oculto}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
