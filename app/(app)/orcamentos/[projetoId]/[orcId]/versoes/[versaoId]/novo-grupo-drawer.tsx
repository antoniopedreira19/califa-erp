"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, FolderPlus, Plus, Save } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { criarGrupo, type ActionResult } from "../actions";
import { BOTAO_NOVO_GRUPO } from "@/app/(app)/_planilha/blocos";

interface Props {
  versaoId: string;
  disabled?: boolean;
  disabledReason?: string;
  /** Forma do gatilho.
   *
   *  `"tracejada"` é a do handoff "Grupos Unificados": o botão mora numa
   *  linha tracejada DENTRO da tabela, depois do último grupo, mostrando
   *  onde o grupo novo vai nascer. Ali ele não pode ser sólido — seria o
   *  elemento mais pesado da planilha, competindo com os números.
   *
   *  `"solida"` continua para o estado vazio, em que ele é a única ação
   *  da tela e precisa ser o botão primário. */
  variante?: "solida" | "tracejada";
}

const GATILHO_SOLIDO =
  "inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-california-red-hover transition-all disabled:opacity-50 disabled:cursor-not-allowed";

export function NovoGrupoDrawer({
  versaoId,
  disabled,
  disabledReason,
  variante = "solida",
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const res: ActionResult = await criarGrupo(versaoId, formData);
      if (!res.ok) {
        setError(res.message);
        setFieldError(res.fieldErrors?.nome?.[0] ?? null);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          className={
            variante === "tracejada" ? BOTAO_NOVO_GRUPO : GATILHO_SOLIDO
          }
        >
          {variante === "tracejada" ? (
            <FolderPlus className="h-3.5 w-3.5" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Novo grupo
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo grupo</DialogTitle>
          <DialogDescription>
            Grupos organizam os itens da versão (ex.: Equipe, Ativação, Staff...).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nome">Nome do grupo</Label>
            <Input
              id="nome"
              name="nome"
              required
              autoFocus
              placeholder="Ex.: Equipe, Ativação Vending Machine..."
            />
            {fieldError && (
              <p className="text-xs text-california-red">{fieldError}</p>
            )}
          </div>

          {error && !fieldError && (
            <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex items-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {pending ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Criando...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Criar grupo
                </>
              )}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
