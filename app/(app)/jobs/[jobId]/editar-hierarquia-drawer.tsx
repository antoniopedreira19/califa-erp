"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import { atualizarHierarquiaJob } from "@/app/(app)/jobs/actions";

interface Props {
  jobId: string;
  papelAtual: "principal" | "sub_job";
}

export function EditarHierarquiaDrawer({ jobId, papelAtual }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [novoPapel, setNovoPapel] = React.useState<"principal" | "sub_job">(papelAtual);
  const [error, setError] = React.useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (novoPapel === papelAtual) {
      setOpen(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await atualizarHierarquiaJob(jobId, novoPapel);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
      >
        <Layers className="h-3.5 w-3.5" />
        Editar hierarquia
      </button>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>Editar hierarquia do job</DialogTitle>
          <DialogDescription>
            Troque o papel deste job dentro do projeto. Só há um principal por projeto — trocar promove este e rebaixa o atual.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <input
                type="radio"
                checked={novoPapel === "principal"}
                onChange={() => setNovoPapel("principal")}
                className="mt-1"
              />
              <div>
                <div className="font-medium">Principal do projeto</div>
                <div className="text-xs text-muted-foreground mt-0.5">O principal atual (se existir) vira sub-job.</div>
              </div>
            </label>
            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <input
                type="radio"
                checked={novoPapel === "sub_job"}
                onChange={() => setNovoPapel("sub_job")}
                className="mt-1"
              />
              <div>
                <div className="font-medium">Sub-job</div>
                <div className="text-xs text-muted-foreground mt-0.5">Fica abaixo do principal atual do projeto.</div>
              </div>
            </label>
            {error && <p className="text-xs text-california-red">{error}</p>}
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red-hover disabled:opacity-50 transition-colors"
            >
              {pending ? "Salvando..." : "Aplicar"}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
