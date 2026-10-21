"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { editarLinhaDecimoTerceiro } from "../actions";
import type { LinhaRow } from "./tabela-linhas";

interface Props {
  linha: LinhaRow;
  onClose: () => void;
}

export function DialogEditarLinha({ linha, onClose }: Props) {
  const router = useRouter();
  const [salarioEditado, setSalarioEditado] = React.useState<string>(
    linha.salario_editado != null ? String(linha.salario_editado) : "",
  );
  const [avosEditado, setAvosEditado] = React.useState<string>(
    linha.avos_editado != null ? String(linha.avos_editado) : "",
  );
  const [obs, setObs] = React.useState<string>(linha.obs ?? "");
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  async function handleSalvar() {
    setErro(null);
    const salNum = salarioEditado.trim() === "" ? null : Number(salarioEditado);
    const avosNum = avosEditado.trim() === "" ? null : Number(avosEditado);

    if (salNum != null && (Number.isNaN(salNum) || salNum < 0)) {
      setErro("Salário editado inválido.");
      return;
    }
    if (
      avosNum != null &&
      (!Number.isInteger(avosNum) || avosNum < 0 || avosNum > 12)
    ) {
      setErro("Avos editados devem ser inteiros entre 0 e 12.");
      return;
    }

    setEnviando(true);
    const res = await editarLinhaDecimoTerceiro(linha.id, {
      salario_editado: salNum,
      avos_editado: avosNum,
      obs: obs.trim() === "" ? null : obs.trim(),
    });
    setEnviando(false);

    if (!res.ok) {
      setErro(res.message);
      return;
    }
    onClose();
    router.refresh();
  }

  function handleRestaurar() {
    setSalarioEditado("");
    setAvosEditado("");
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{linha.nome}</DialogTitle>
          <DialogDescription>
            Override manual do cálculo. Deixe em branco para usar o snapshot.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-muted/50 p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Salário snapshot:</span>
              <span className="tabular-nums">
                {new Intl.NumberFormat("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                }).format(linha.salario)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Avos calculado:</span>
              <span className="tabular-nums">{linha.avos}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="salario-editado">Salário (editar)</Label>
            <Input
              id="salario-editado"
              type="number"
              step="0.01"
              min="0"
              placeholder="Deixe vazio pra usar o snapshot"
              value={salarioEditado}
              onChange={(e) => setSalarioEditado(e.target.value)}
              disabled={enviando}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="avos-editado">Avos (editar)</Label>
            <Input
              id="avos-editado"
              type="number"
              step="1"
              min="0"
              max="12"
              placeholder="Deixe vazio pra usar o calculado"
              value={avosEditado}
              onChange={(e) => setAvosEditado(e.target.value)}
              disabled={enviando}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="obs">Observação</Label>
            <textarea
              id="obs"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              disabled={enviando}
              rows={3}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/30"
            />
          </div>

          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border pt-4">
            <button
              type="button"
              onClick={handleRestaurar}
              disabled={enviando}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" />
              Restaurar snapshot
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={enviando}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSalvar}
                disabled={enviando}
                className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 transition-colors disabled:opacity-50"
              >
                {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
