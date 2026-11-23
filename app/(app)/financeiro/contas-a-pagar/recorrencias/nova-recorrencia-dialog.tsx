"use client";
// "Nova recorrência" fora da aba (o menu de novo lançamento da Conciliação):
// o mesmo formulário da aba, no mesmo pop-up (decisão 272).
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ANTECEDENCIA } from "./dados";
import { FormularioDaRecorrencia, hojeEmBrasilia, type ListasDoFormulario } from "./formulario";

export function NovaRecorrenciaDialog({
  open,
  onOpenChange,
  listas,
  onCriada,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listas: ListasDoFormulario;
  onCriada: (mensagem: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()} className="flex max-h-[90vh] w-[1180px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0">
        <div className="border-b border-border px-6 py-4 pr-14">
          <DialogTitle className="text-lg">Nova recorrência</DialogTitle>
          <DialogDescription className="mt-1">
            Uma conta que se repete. O título de cada vencimento nasce {ANTECEDENCIA} dias antes, já aprovado, em Títulos a Pagar.
          </DialogDescription>
        </div>
        {open && (
          <FormularioDaRecorrencia
            key="nova"
            modo="criar"
            listas={listas}
            hoje={hojeEmBrasilia()}
            onCancelar={() => onOpenChange(false)}
            onSalvo={(_id, mensagem) => onCriada(mensagem)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
