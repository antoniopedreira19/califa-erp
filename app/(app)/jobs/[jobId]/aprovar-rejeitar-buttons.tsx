"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { XCircle, AlertCircle, Landmark } from "lucide-react";
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
}

/**
 * Aprovação financeira vista de dentro do job.
 *
 * Aprovar NÃO acontece aqui: abrir o job exige categoria, competência e
 * previsão de custos, que só o formulário do financeiro coleta. Um botão
 * de aprovar direto nesta página abriria o job sem nada disso — por isso
 * ele virou um link para lá. Rejeitar continua sendo possível daqui,
 * porque não depende de registro nenhum.
 */
export function AprovarRejeitarButtons({ jobId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [rejeitarOpen, setRejeitarOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  function handleRejeitar(e: React.FormEvent<HTMLFormElement>) {
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
      setRejeitarOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/financeiro/abertura-de-job/${jobId}`}
          prefetch={false}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
        >
          <Landmark className="h-4 w-4" />
          Abrir no financeiro
        </Link>
        <button
          type="button"
          onClick={() => setRejeitarOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red-hover transition-colors"
        >
          <XCircle className="h-4 w-4" />
          Rejeitar
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        A abertura pede categoria, competência e previsão de custos — preenchidas
        na Central Financeira.
      </p>
      {error && <p className="mt-2 text-xs text-california-red">{error}</p>}

      <Dialog open={rejeitarOpen} onOpenChange={setRejeitarOpen}>
        <DrawerContent>
          <DialogHeader className="border-b border-border p-6">
            <DialogTitle>Rejeitar abertura do job</DialogTitle>
            <DialogDescription>
              Informe o motivo. O GP verá esse texto no card do job.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRejeitar} className="flex-1 flex flex-col overflow-hidden">
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
                <p className="text-xs text-muted-foreground">
                  Mín. 10 caracteres, máx. 500.
                </p>
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
                onClick={() => setRejeitarOpen(false)}
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
    </>
  );
}
