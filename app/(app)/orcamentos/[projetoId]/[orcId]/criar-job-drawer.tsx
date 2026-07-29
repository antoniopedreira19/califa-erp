"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Save, Plus } from "lucide-react";
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
import { criarJob, type ActionResult } from "@/app/(app)/jobs/actions";

const SEM_REGIONAL = "__none__";

interface Props {
  orcamentoId: string;
  clienteNome: string; // read-only display
  jobsAtivosDoProjeto: Pick<Job, "id" | "codigo" | "nome" | "job_pai_id">[];
  regionais: Pick<Regional, "id" | "nome">[];
  responsaveis: Pick<Profile, "id" | "nome">[];
  responsavelDefaultId: string; // default do projeto.responsavel_id
  valorFaturamento: number; // pre-preenchido, derivado da versão aprovada
  disabled?: boolean;
  disabledReason?: string;
}

export function CriarJobDrawer({
  orcamentoId,
  clienteNome,
  jobsAtivosDoProjeto,
  regionais,
  responsaveis,
  responsavelDefaultId,
  valorFaturamento,
  disabled,
  disabledReason,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  const principalAtual = jobsAtivosDoProjeto.find((j) => j.job_pai_id === null) ?? null;
  const jaExisteJobNoProjeto = jobsAtivosDoProjeto.length > 0;

  const [posicao, setPosicao] = React.useState<"principal" | "sub_job">(
    jaExisteJobNoProjeto ? "sub_job" : "principal",
  );
  const [regionalId, setRegionalId] = React.useState<string>(SEM_REGIONAL);
  const [responsavelId, setResponsavelId] = React.useState<string>(responsavelDefaultId);

  function resetForm() {
    setError(null);
    setFieldErrors({});
    setPosicao(jaExisteJobNoProjeto ? "sub_job" : "principal");
    setRegionalId(SEM_REGIONAL);
    setResponsavelId(responsavelDefaultId);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm();
    setOpen(next);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    formData.set(
      "regional_id",
      regionalId === SEM_REGIONAL ? "" : regionalId,
    );
    formData.set("responsavel_id", responsavelId);
    if (jaExisteJobNoProjeto) {
      formData.set("posicao_hierarquia", posicao);
      if (posicao === "sub_job" && principalAtual) {
        formData.set("job_pai_id", principalAtual.id);
      }
    }

    startTransition(async () => {
      const res: ActionResult = await criarJob(orcamentoId, formData);
      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      handleOpenChange(false);
      router.refresh();
    });
  }

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        title={disabledReason}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground cursor-not-allowed"
      >
        <Plus className="h-3.5 w-3.5" />
        Criar job
      </button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        Criar job
      </button>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>Criar job</DialogTitle>
          <DialogDescription>
            O job vira a unidade operacional dessa entrega. Ele é vinculado ao orçamento aprovado e à versão aprovada.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {jaExisteJobNoProjeto && principalAtual && (
              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                <h3 className="text-sm font-semibold">Hierarquia deste job</h3>
                <label className="flex items-start gap-3 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="__posicao"
                    checked={posicao === "sub_job"}
                    onChange={() => setPosicao("sub_job")}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium">
                      Sub-job de{" "}
                      <span className="font-mono">{principalAtual.codigo}</span>
                      {" · "}
                      {principalAtual.nome}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Este job fica embaixo do principal existente do projeto.
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-3 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="__posicao"
                    checked={posicao === "principal"}
                    onChange={() => setPosicao("principal")}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium">Novo principal do projeto</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      O job atual (
                      <span className="font-mono">{principalAtual.codigo}</span>) vira sub-job deste.
                    </div>
                  </div>
                </label>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="nome">
                  Nome do job <span className="text-california-red">*</span>
                </Label>
                <Input
                  id="nome"
                  name="nome"
                  autoFocus
                  required
                  maxLength={200}
                  placeholder="Ex.: Bebedouros SP"
                />
                {fieldErrors.nome?.map((m, i) => (
                  <p key={i} className="text-xs text-california-red">{m}</p>
                ))}
              </div>

              <div className="space-y-2">
                <Label>Cliente</Label>
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  {clienteNome}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="produto">Produto</Label>
                <Input
                  id="produto"
                  name="produto"
                  maxLength={120}
                  placeholder="Ex.: Guaraná Antarctica"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="regional_id">Regional</Label>
                <Select value={regionalId} onValueChange={setRegionalId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sem regional" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_REGIONAL}>Sem regional</SelectItem>
                    {regionais.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cidade">Cidade</Label>
                <Input id="cidade" name="cidade" maxLength={120} placeholder="Ex.: São Paulo" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="data_inicio_prevista">Data de início</Label>
                <DatePicker
                  name="data_inicio_prevista"
                  placeholder="Selecione a data"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="data_fim_prevista">Data de fim</Label>
                <DatePicker
                  name="data_fim_prevista"
                  placeholder="Selecione a data"
                />
                {fieldErrors.data_fim_prevista?.map((m, i) => (
                  <p key={i} className="text-xs text-california-red">{m}</p>
                ))}
              </div>

              <div className="space-y-2">
                <Label htmlFor="responsavel_id">
                  Responsável <span className="text-california-red">*</span>
                </Label>
                <Select value={responsavelId} onValueChange={setResponsavelId} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um responsável" />
                  </SelectTrigger>
                  <SelectContent>
                    {responsaveis.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="valor_total">Valor Total (R$)</Label>
                <Input
                  id="valor_total"
                  name="valor_total"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={valorFaturamento.toFixed(2)}
                  className="no-spinner"
                  placeholder="0,00"
                />
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
              onClick={() => handleOpenChange(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red-hover disabled:opacity-50 transition-colors"
            >
              {pending ? "Criando..." : (
                <>
                  <Save className="h-4 w-4" />
                  Criar job
                </>
              )}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
