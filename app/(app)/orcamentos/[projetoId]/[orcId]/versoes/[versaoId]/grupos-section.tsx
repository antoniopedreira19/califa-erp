"use client";

import * as React from "react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import type {
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
  Categoria,
  ItemBv,
} from "@/lib/types";
import { GrupoCard } from "./grupo-card";
import type { FornecedorOpcao } from "@/app/(app)/_bv/bv-dialog";

/** Map não atravessa a fronteira server → client. A página manda os pares
 *  já montados. */
export interface SecaoGrupo {
  grupo: VersaoOrcamentoGrupo;
  itens: VersaoOrcamentoItem[];
}

interface Props {
  secoes: SecaoGrupo[];
  moeda: string;
  readOnly?: boolean;
  categorias: Categoria[];
  /** BV por id do item — indexado, e não Map, porque Map não atravessa a
   *  fronteira server → client. */
  bvsPorItem: Record<string, ItemBv>;
  fornecedores: FornecedorOpcao[];
  versaoLabel: string;
}

export function GruposSection({
  secoes,
  moeda,
  readOnly,
  categorias,
  bvsPorItem,
  fornecedores,
  versaoLabel,
}: Props) {
  // Guarda quem está FECHADO: grupo novo nasce aberto sem precisar de
  // sincronização quando a lista muda. Sem persistência — recarregar a
  // página volta tudo a aberto, como no handoff.
  const [fechados, setFechados] = React.useState<Set<string>>(new Set());

  function alternarGrupo(id: string) {
    setFechados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Estado misto resolve para "recolher": basta um grupo aberto para o
  // botão oferecer fechar tudo.
  const algumAberto = secoes.some((s) => !fechados.has(s.grupo.id));

  function alternarTodos() {
    setFechados(
      algumAberto ? new Set(secoes.map((s) => s.grupo.id)) : new Set(),
    );
  }

  return (
    <div>
      <div className="mb-3">
        <button
          type="button"
          onClick={alternarTodos}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-california-red hover:border-california-red/40 transition-colors"
        >
          {algumAberto ? (
            <ChevronsDownUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5" />
          )}
          {algumAberto ? "Recolher todos" : "Expandir todos"}
        </button>
      </div>

      <div className="space-y-6">
        {secoes.map((s) => (
          <GrupoCard
            key={s.grupo.id}
            grupo={s.grupo}
            itens={s.itens}
            moeda={moeda}
            readOnly={readOnly}
            categorias={categorias}
            aberto={!fechados.has(s.grupo.id)}
            onAlternar={() => alternarGrupo(s.grupo.id)}
            bvsPorItem={bvsPorItem}
            fornecedores={fornecedores}
            versaoLabel={versaoLabel}
          />
        ))}
      </div>
    </div>
  );
}
