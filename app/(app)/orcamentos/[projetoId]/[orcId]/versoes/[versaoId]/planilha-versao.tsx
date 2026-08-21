"use client";

/** Os grupos e o card de Totais da versão, sob uma chave só.
 *
 *  A chave Bruto ⇄ Líquido vale para a página inteira, e o Totais precisa
 *  estar sempre no mesmo modo que os grupos acima dele. Como os dois eram
 *  irmãos renderizados direto pela página (server), o estado não tinha
 *  onde morar — este componente é o ancestral comum que faltava.
 *
 *  No orçamento a vista Líquido tem um efeito que a do job não tem: é
 *  aqui que se decide o planejado que vai congelar na aprovação. Ver
 *  `docs/decisions/022`.
 */

import * as React from "react";
import { FolderTree } from "lucide-react";
import type {
  Categoria,
  ItemBv,
  VersaoOrcamentoGrupo,
  VersaoOrcamentoItem,
} from "@/lib/types";
import { VISAO_BV_PADRAO, type VisaoBv } from "@/lib/calculos/bv-planilha";
import type { FornecedorOpcao } from "@/app/(app)/_bv/bv-dialog";
import { GruposSection } from "./grupos-section";
import { TotaisCard } from "./totais-card";

interface Props {
  grupos: VersaoOrcamentoGrupo[];
  itens: VersaoOrcamentoItem[];
  /** Pares já montados: Map não atravessa a fronteira server → client. */
  secoes: Array<{ grupo: VersaoOrcamentoGrupo; itens: VersaoOrcamentoItem[] }>;
  moeda: string;
  readOnly?: boolean;
  categorias: Categoria[];
  bvsPorItem: Record<string, ItemBv>;
  fornecedores: FornecedorOpcao[];
  versaoLabel: string;
  percentualHonorarios: number;
  percentualImposto: number;
}

export function PlanilhaVersao({
  grupos,
  itens,
  secoes,
  moeda,
  readOnly,
  categorias,
  bvsPorItem,
  fornecedores,
  versaoLabel,
  percentualHonorarios,
  percentualImposto,
}: Props) {
  const [visao, setVisao] = React.useState<VisaoBv>(VISAO_BV_PADRAO);

  return (
    <>
      {grupos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-12 text-center">
          <FolderTree className="mx-auto mb-4 h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Nenhum grupo ainda. Crie o primeiro grupo para começar a adicionar
            itens.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Exemplos: Equipe, Ativação, Staff, Logística...
          </p>
        </div>
      ) : (
        <GruposSection
          secoes={secoes}
          moeda={moeda}
          percentualImposto={percentualImposto}
          visao={visao}
          onMudarVisao={setVisao}
          readOnly={readOnly}
          categorias={categorias}
          bvsPorItem={bvsPorItem}
          fornecedores={fornecedores}
          versaoLabel={versaoLabel}
        />
      )}

      <TotaisCard
        grupos={grupos}
        itens={itens}
        bvsPorItem={bvsPorItem}
        visao={visao}
        percentualHonorarios={percentualHonorarios}
        percentualImposto={percentualImposto}
        moeda={moeda}
      />
    </>
  );
}
