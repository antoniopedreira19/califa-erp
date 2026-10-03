"use client";

import * as React from "react";
import { AlertCircle, Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AppRole } from "@/lib/types";
import { alterarRoleColaborador } from "../actions-acesso";

type Props = {
  colaboradorId: string;
  roleAtual: AppRole;
  onFechar: () => void;
  onSucesso: () => void;
};

const ROLES: { value: AppRole; label: string }[] = [
  { value: "colaborador", label: "Colaborador" },
  { value: "produtor", label: "Produtor" },
  { value: "gerente_producao", label: "Gerente de produção" },
  { value: "financeiro", label: "Financeiro" },
  { value: "rh", label: "RH" },
  { value: "freelancer", label: "Freelancer" },
  { value: "administrador", label: "Administrador" },
];

export function ModalAlterarRole({
  colaboradorId,
  roleAtual,
  onFechar,
  onSucesso,
}: Props) {
  const [role, setRole] = React.useState<AppRole>(roleAtual);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    startTransition(async () => {
      const res = await alterarRoleColaborador({
        colaborador_id: colaboradorId,
        nova_role: role,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onSucesso();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-california-red" />
            Alterar papel
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{erro}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="alterar-role">Novo papel</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
              <SelectTrigger id="alterar-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onFechar}
              disabled={pending}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending || role === roleAtual}
              className="rounded-lg bg-california-red px-3 py-1.5 text-sm font-medium text-white hover:bg-california-red/90 transition-colors disabled:opacity-50"
            >
              {pending ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
