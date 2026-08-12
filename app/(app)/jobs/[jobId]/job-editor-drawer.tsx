"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Save, Pencil } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import type { Job, Profile, Regional } from "@/lib/types";
import { atualizarJob } from "@/app/(app)/jobs/actions";

const SEM_REGIONAL = "__none__";

interface Props {
  job: Job;
  regionais: Pick<Regional, "id" | "nome">[];
  responsaveis: Pick<Profile, "id" | "nome">[];
}

export function JobEditorDrawer({ job, regionais, responsaveis }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [regionalId, setRegionalId] = React.useState<string>(
    job.regional_id ?? SEM_REGIONAL,
  );
  const [responsavelId, setResponsavelId] = React.useState<string>(job.responsavel_id);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const formData = new FormData(e.currentTarget);
    formData.set("regional_id", regionalId === SEM_REGIONAL ? "" : regionalId);
    formData.set("responsavel_id", responsavelId);
    startTransition(async () => {
      const res = await atualizarJob(job.id, formData);
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
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
      >
        <Pencil className="h-3.5 w-3.5" />
        Editar
      </button>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>Editar job {job.codigo}</DialogTitle>
          <DialogDescription>Atualize os campos operacionais do job.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="nome">Nome <span className="text-california-red">*</span></Label>
                <Input id="nome" name="nome" required maxLength={200} defaultValue={job.nome} />
                {fieldErrors.nome?.map((m, i) => <p key={i} className="text-xs text-california-red">{m}</p>)}
              </div>
              <div className="space-y-2">
                <Label htmlFor="produto">Produto</Label>
                <Input id="produto" name="produto" maxLength={120} defaultValue={job.produto ?? ""} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="regional_id">Regional</Label>
                <Select value={regionalId} onValueChange={setRegionalId}>
                  <SelectTrigger><SelectValue placeholder="Sem regional" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_REGIONAL}>Sem regional</SelectItem>
                    {regionais.map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cidade">Cidade</Label>
                <Input id="cidade" name="cidade" maxLength={120} defaultValue={job.cidade ?? ""} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="data_inicio_prevista">Data início</Label>
                <DatePicker name="data_inicio_prevista" defaultValue={job.data_inicio_prevista ?? ""} placeholder="Selecione a data" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="data_fim_prevista">Data fim</Label>
                <DatePicker name="data_fim_prevista" defaultValue={job.data_fim_prevista ?? ""} placeholder="Selecione a data" />
                {fieldErrors.data_fim_prevista?.map((m, i) => <p key={i} className="text-xs text-california-red">{m}</p>)}
              </div>
              <div className="space-y-2">
                <Label htmlFor="responsavel_id">Responsável <span className="text-california-red">*</span></Label>
                <Select value={responsavelId} onValueChange={setResponsavelId} required>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {responsaveis.map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
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
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red-hover disabled:opacity-50 transition-colors"
            >
              {pending ? "Salvando..." : (<><Save className="h-4 w-4" />Salvar</>)}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
