"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { HistoricoContratosFreela } from "./historico-contratos-freela";

/**
 * Dialog só com a tela de histórico, pra admin/RH/financeiro conferir
 * contratos anteriores antes de criar um novo. Prosseguir leva pra
 * /freelancers/contratos/novo com o freela pré-selecionado.
 *
 * Diferente do `NovaSolicitacaoDialog` (usado por GP/produtor), que após
 * o histórico abre o form de solicitação. Aprovador vai direto pra criar
 * contrato.
 *
 * Permite override: se o freela tem contrato ativo, o botão vira
 * "Prosseguir mesmo assim" (amarelo) mas continua habilitado — aditivos
 * legítimos são comuns pra esse papel.
 */
export function HistoricoDialogAprovador({
  freelancer,
  open,
  onOpenChange,
}: {
  freelancer: { id: string; nome: string; cpf: string | null };
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();

  function onProsseguir() {
    onOpenChange(false);
    router.push(`/freelancers/contratos/novo?freelancer=${freelancer.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        <HistoricoContratosFreela
          freelancer={freelancer}
          onProsseguir={onProsseguir}
          onVoltar={() => onOpenChange(false)}
          labelProsseguir="Prosseguir pra novo contrato"
          permiteOverride
        />
      </DialogContent>
    </Dialog>
  );
}
