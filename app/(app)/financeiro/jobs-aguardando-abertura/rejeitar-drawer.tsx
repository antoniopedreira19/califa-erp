"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { XCircle, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { rejeitarAberturaJob } from "@/app/(app)/jobs/actions";

interface Props {
  jobId: string;
  jobCodigo: string;
}

export function RejeitarDrawer({ jobId, jobCodigo }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await rejeitarAberturaJob(jobId, formData);
      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
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
        className="inline-flex items-center gap-1 rounded-md bg-california-red px-2.5 py-1 text-xs font-medium text-white hover:bg-california-red-hover transition-colors"
        title="Rejeitar abertura"
      >
        <XCircle className="h-3.5 w-3.5" />
        Rejeitar
      </button>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>Rejeitar abertura do {jobCodigo}</DialogTitle>
          <DialogDescription>
            Informe o motivo. O GP verá esse texto no card do job.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="motivo">
                Motivo <span className="text-california-red">*</span>
              </Label>
              <textarea
                id="motivo"
                name="motivo"
                required
                minLength={10}
                maxLength={500}
                rows={5}
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/30"
                placeholder="Ex.: Valor total incompatível com o aprovado pelo cliente..."
              />
              {fieldErrors.motivo?.map((m, i) => (
                <p key={i} className="text-xs text-california-red">{m}</p>
              ))}
              <p className="text-xs text-muted-foreground">Mín. 10, máx. 500 caracteres.</p>
            </div>
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
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
              {pending ? "Rejeitando..." : "Rejeitar"}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
