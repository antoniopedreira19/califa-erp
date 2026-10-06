"use client";

import * as React from "react";
import type { CategoriaModeloPlanilha } from "@/lib/types";
import type { EnvioDaPlanilha } from "@/lib/importacao/envio";
import { ImportarPlanilhaDialog } from "@/app/(app)/orcamentos/_importacao/importar-planilha-dialog";
import { carregarAbaNoRascunho, lerPlanilhaDoRascunho } from "./actions";
import type { GrupoPayload } from "./tipos";

/** O arquivo enviado e a aba escolhida — a importação da versão relê essa
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
  /** Nome do orçamento — deixa claro que a importação vale só para ele, e
   *  não para os outros do rascunho. Era o código previsto até 29/09/2026. */
  nome: string;
  /** Modelo do orçamento que recebe a planilha: a de outro modelo é
   *  recusada (decisão 072). Obrigatório para não cair no nacional. */
  modeloPlanilha: CategoriaModeloPlanilha;
  /** Orçamento de serviço Interno (decisão 105): toda linha com valor entra
   *  como F · Interno, inclusive a de tipo em branco. Obrigatório. */
  interno: boolean;
  /** Grava a planilha (na agregada, na hora — decisão 148). O diálogo
   *  espera: recusada, ele continua aberto com o motivo e o arquivo. */
  onImportado: (
    planilha: PlanilhaLida,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
}

/**
 * Importação de planilha dentro do editor do orçamento do projeto — o
 * mesmo modal da versão (decisão 110). Ele só lê e mostra a prévia; ao
 * confirmar, a agregada grava na hora pela importação da versão
 * (`importarPlanilhaNaAgregada`, decisão 148), que registra em
 * `orcamento_importacoes` e descarta o arquivo (decisão 129).
 */
export function ImportarPlanilhaModal({
  open,
  onOpenChange,
  nome,
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
          <span className="font-semibold text-foreground">{nome}</span> — os demais
          orçamentos do projeto não são afetados.
        </>
      }
      modeloPlanilha={modeloPlanilha}
      interno={interno}
      mostrarHonorarios={false}
      confirmarSubstituicao={null}
      rotuloGravar="Importar"
      textoGravando="Importando a planilha..."
      ler={(envio) => lerPlanilhaDoRascunho({ envio, modelo_planilha: modeloPlanilha, interno })}
      gravar={async ({ envio, aba }) => {
        const r = await carregarAbaNoRascunho({ envio, aba, modelo_planilha: modeloPlanilha, interno });
        if (!r.ok) return r;
        return onImportado({
          envio: { ...envio, aba },
          grupos: r.grupos,
          percentualHonorarios: r.percentual_honorarios,
          avisos: r.avisos,
        });
      }}
    />
  );
}
