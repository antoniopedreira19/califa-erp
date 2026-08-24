"use client";

import * as React from "react";
import type {
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
  Categoria,
  ItemBv,
} from "@/lib/types";
import { ItensTable, type GrupoDaPlanilha } from "./itens-table";
import { AcoesDoGrupo, NomeDoGrupo } from "./grupo-linha";
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
  /** Gatilho de "Novo grupo" — desce até a linha tracejada no pé da
   *  tabela, que é onde o grupo novo vai nascer. Vem da página porque é
   *  ela que sabe se a versão aceita grupo novo. */
  novoGrupo?: React.ReactNode;
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
  novoGrupo,
}: Props) {
  // A máquina de estado mora em `_planilha/recolher-grupos`: a planilha do
  // job, a da conferência do financeiro e os blocos da visão agregada
  // usam a MESMA, e quatro cópias divergiriam na primeira correção.
  const ids = React.useMemo(() => secoes.map((s) => s.grupo.id), [secoes]);
  const recolher = useGruposRecolhiveis(ids);

  const grupos = React.useMemo<GrupoDaPlanilha[]>(
    () =>
      secoes.map((s) => ({
        id: s.grupo.id,
        nome: s.grupo.nome,
        itens: s.itens,
      })),
    [secoes],
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <BotaoRecolherTodos
          algumAberto={recolher.algumAberto}
          onAlternarTodos={recolher.alternarTodos}
        />
        <ChaveBrutoLiquido visao={visao} onChange={onMudarVisao} />
      </div>

      {/* Um card para a planilha inteira — antes era um por grupo.
          Sem `overflow-hidden`: a calha de ações precisa escapar do frame,
          e são os filhos que arredondam os cantos. */}
      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <ItensTable
          grupos={grupos}
          moeda={moeda}
          percentualImposto={percentualImposto}
          visao={visao}
          readOnly={readOnly}
          categorias={categorias}
          estaAberto={recolher.estaAberto}
          onAlternarGrupo={recolher.alternar}
          nomeDoGrupo={(grupo) => (
            <NomeDoGrupo grupo={grupo} readOnly={readOnly} />
          )}
          acoesDoGrupo={
            readOnly ? undefined : (grupo) => <AcoesDoGrupo grupo={grupo} />
          }
          novoGrupo={novoGrupo}
          bvsPorItem={bvsPorItem}
          fornecedores={fornecedores}
          versaoLabel={versaoLabel}
        />
      </div>
    </div>
  );
}
