"use client";

import * as React from "react";
import type {
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
  Categoria,
  ItemBv,
} from "@/lib/types";
import { GrupoCard } from "./grupo-card";
import type { FornecedorOpcao } from "@/app/(app)/_bv/bv-dialog";
import type { VisaoBv } from "@/lib/calculos/bv-planilha";
import { ChaveBrutoLiquido } from "@/app/(app)/_planilha/chave-bruto-liquido";
import {
  BotaoRecolherTodos,
  useGruposRecolhiveis,
} from "@/app/(app)/_planilha/recolher-grupos";

/** Map não atravessa a fronteira server → client. A página manda os pares
 *  já montados. */
export interface SecaoGrupo {
  grupo: VersaoOrcamentoGrupo;
  itens: VersaoOrcamentoItem[];
}

interface Props {
  secoes: SecaoGrupo[];
  moeda: string;
  /** Alíquota da versão — vira o BV líquido da vista Líquido. */
  percentualImposto: number;
  /** Bruto ou Líquido (− BV). O estado mora em `PlanilhaVersao`, acima
   *  daqui, porque o card de Totais precisa da MESMA vista. */
  visao: VisaoBv;
  onMudarVisao: (v: VisaoBv) => void;
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
  percentualImposto,
  visao,
  onMudarVisao,
  readOnly,
  categorias,
  bvsPorItem,
  fornecedores,
  versaoLabel,
}: Props) {
  // A máquina de estado mora em `_planilha/recolher-grupos`: a planilha do
  // job, a da conferência do financeiro e os blocos da visão agregada
  // usam a MESMA, e quatro cópias divergiriam na primeira correção.
  const ids = React.useMemo(() => secoes.map((s) => s.grupo.id), [secoes]);
  const recolher = useGruposRecolhiveis(ids);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <BotaoRecolherTodos
          algumAberto={recolher.algumAberto}
          onAlternarTodos={recolher.alternarTodos}
        />
        <ChaveBrutoLiquido visao={visao} onChange={onMudarVisao} />
      </div>

      <div className="space-y-6">
        {secoes.map((s) => (
          <GrupoCard
            key={s.grupo.id}
            grupo={s.grupo}
            itens={s.itens}
            moeda={moeda}
            percentualImposto={percentualImposto}
            visao={visao}
            readOnly={readOnly}
            categorias={categorias}
            aberto={recolher.estaAberto(s.grupo.id)}
            onAlternar={() => recolher.alternar(s.grupo.id)}
            bvsPorItem={bvsPorItem}
            fornecedores={fornecedores}
            versaoLabel={versaoLabel}
          />
        ))}
      </div>
    </div>
  );
}
