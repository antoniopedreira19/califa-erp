"use client";

import * as React from "react";
import type { CategoriaModeloPlanilha } from "@/lib/types";
import type { EnvioDaPlanilha } from "@/lib/importacao/envio";
import { ImportarPlanilhaDialog } from "@/app/(app)/orcamentos/_importacao/importar-planilha-dialog";
import { carregarAbaNoRascunho, lerPlanilhaDoRascunho } from "./actions";
import type { GrupoPayload } from "./tipos";

/** O arquivo enviado e a aba escolhida — o "Salvar orçamentos" relê essa
 *  aba no servidor para registrar a importação. */
export type EnvioComAba = EnvioDaPlanilha & { aba: string };

export interface PlanilhaLida {
  envio: EnvioComAba;
  grupos: GrupoPayload[];
  percentualHonorarios: number | null;
  avisos: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Código previsto do orçamento — deixa claro que a importação vale só
   *  para este orçamento, e não para os outros do rascunho. */
  codigo: string;
  /** Modelo do orçamento que recebe a planilha: a de outro modelo é
   *  recusada (decisão 072). Obrigatório para não cair no nacional. */
  modeloPlanilha: CategoriaModeloPlanilha;
  /** Orçamento de serviço Interno (decisão 105): toda linha com valor entra
   *  como F · Interno, inclusive a de tipo em branco. Obrigatório. */
  interno: boolean;
  onImportado: (planilha: PlanilhaLida) => void;
}

/**
 * Importação de planilha dentro do editor do orçamento do projeto — o
 * mesmo modal da versão (decisão 110), sem gravar: a aba escolhida vira
 * grupos e itens do rascunho, e o arquivo sobe junto no "Salvar
 * orçamentos", que é quando ele vira registro em `orcamento_importacoes`.
 */
export function ImportarPlanilhaModal({
  open,
  onOpenChange,
  codigo,
  modeloPlanilha,
  interno,
  onImportado,
}: Props) {
  return (
    <ImportarPlanilhaDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo="Importar planilha"
      descricao={
        <>
          A importação vale só para{" "}
          <span className="font-mono font-semibold text-foreground">{codigo}</span> — os demais
          orçamentos do rascunho não são afetados.
        </>
      }
      modeloPlanilha={modeloPlanilha}
      interno={interno}
      mostrarHonorarios={false}
      confirmarSubstituicao={null}
      rotuloGravar="Importar"
      textoGravando="Lendo a aba escolhida..."
      ler={(envio) => lerPlanilhaDoRascunho({ envio, modelo_planilha: modeloPlanilha, interno })}
      gravar={async ({ envio, aba }) => {
        const r = await carregarAbaNoRascunho({ envio, aba, modelo_planilha: modeloPlanilha, interno });
        if (!r.ok) return r;
        onImportado({
          envio: { ...envio, aba },
          grupos: r.grupos,
          percentualHonorarios: r.percentual_honorarios,
          avisos: r.avisos,
        });
        return { ok: true };
      }}
    />
  );
}
