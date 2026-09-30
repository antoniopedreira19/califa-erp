"use client";

/**
 * "Devolver para a aprovação" (decisão 132): tira o título de folha de
 * Títulos a Pagar e reabre a linha em "Aguardando aprovação", na aba
 * Folhas de Pagamento, para corrigir valor, alocação ou pagamento e aprovar
 * de novo. Substitui editar ou excluir o título, que deixariam a folha
 * dizendo um valor e o título outro.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Undo2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useVoltar } from "@/components/voltar/botao-voltar";
import { devolverFolhaParaAprovacao } from "./actions-folhas";

export function DevolverFolhaDialog({
  contaAvulsaId,
  descricao,
  valor,
  open,
  onOpenChange,
  aoDevolver,
}: {
  contaAvulsaId: string;
  descricao: string;
  valor: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sem ele, a tela recarrega. A página do título passa o Voltar: o título
   *  deixou de existir, e recarregar a página dele dá 404. */
  aoDevolver?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setMotivo("");
      setErro(null);
    }
  }, [open]);

  function confirmar(e: React.FormEvent) {
    e.preventDefault();
    // O diálogo vive dentro de outras árvores (linha da tabela, página do
    // título): o submit não pode subir até elas.
    e.stopPropagation();
    setErro(null);
    if (motivo.trim().length < 3) {
      setErro("Escreva o motivo (mínimo 3 caracteres).");
      return;
    }
    startTransition(async () => {
      const res = await devolverFolhaParaAprovacao({
        contaAvulsaId,
        motivo: motivo.trim(),
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onOpenChange(false);
      if (aoDevolver) aoDevolver();
      else router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Devolver para a aprovação</DialogTitle>
          <DialogDescription>
            {descricao} ·{" "}
            {valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.
            O título sai de Títulos a Pagar e a linha volta para
            &ldquo;Aguardando aprovação&rdquo; em Folhas de Pagamento, onde
            dá para corrigir e aprovar de novo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={confirmar} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="motivo_devolucao">Motivo</Label>
            <Input
              id="motivo_devolucao"
              autoFocus
              maxLength={500}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: valor digitado errado"
            />
          </div>
          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-california-red/20 bg-california-red/5 px-3 py-2 text-xs text-california-red">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erro}</span>
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 disabled:opacity-50"
            >
              <Undo2 className="h-4 w-4" />
              {pending ? "Devolvendo..." : "Devolver"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Botão com o diálogo, para a página do título. */
export function DevolverFolhaButton({
  contaAvulsaId,
  descricao,
  valor,
}: {
  contaAvulsaId: string;
  descricao: string;
  valor: number;
}) {
  const [open, setOpen] = React.useState(false);
  // Como o Excluir desta página (decisão 108): volta para onde a pessoa
  // estava, porque o título some.
  const { irVoltar } = useVoltar("/financeiro/contas-a-pagar");
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
      >
        <Undo2 className="h-4 w-4" />
        Devolver para a aprovação
      </button>
      <DevolverFolhaDialog
        contaAvulsaId={contaAvulsaId}
        descricao={descricao}
        valor={valor}
        open={open}
        onOpenChange={setOpen}
        aoDevolver={irVoltar}
      />
    </>
  );
}
