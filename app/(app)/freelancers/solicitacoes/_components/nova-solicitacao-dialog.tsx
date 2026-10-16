"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, AlertCircle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MaskedInput } from "@/components/ui/masked-input";
import { MoneyInput } from "@/components/ui/money-input";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import type {
  FreelancerCargo,
  TipoFreelancerContrato,
} from "@/lib/types";
import { JobPicker, type JobItem } from "../../_components/job-picker";
import { CargoPicker } from "../../_components/cargo-picker";
import { criarSolicitacao } from "../actions";

interface Props {
  jobs: JobItem[];
  cargos: FreelancerCargo[];
}

type FieldErrors = Record<string, string[]>;

export function NovaSolicitacaoDialog({ jobs, cargos }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [erroGeral, setErroGeral] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});

  // Form state
  const [nomeFreela, setNomeFreela] = React.useState("");
  const [cpfFreela, setCpfFreela] = React.useState("");
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [cargo, setCargo] = React.useState<string | null>(null);
  const [tipo, setTipo] = React.useState<TipoFreelancerContrato>("mensal");
  const [valor, setValor] = React.useState<number | null>(null);
  const [dataInicio, setDataInicio] = React.useState("");
  const [dataTermino, setDataTermino] = React.useState("");
  const [cidade, setCidade] = React.useState("");
  const [observacoes, setObservacoes] = React.useState("");

  function reset() {
    setNomeFreela("");
    setCpfFreela("");
    setJobId(null);
    setCargo(null);
    setTipo("mensal");
    setValor(null);
    setDataInicio("");
    setDataTermino("");
    setCidade("");
    setObservacoes("");
    setErroGeral(null);
    setFieldErrors({});
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErroGeral(null);
    setFieldErrors({});

    const fd = new FormData();
    fd.set("nome_freela", nomeFreela);
    fd.set("cpf_freela", cpfFreela);
    fd.set("job_id", jobId ?? "");
    fd.set("cargo", cargo ?? "");
    fd.set("tipo", tipo);
    fd.set("valor", String(valor ?? 0));
    fd.set("data_inicio", dataInicio);
    fd.set("data_termino", dataTermino);
    fd.set("cidade", cidade);
    fd.set("observacoes", observacoes);

    startTransition(async () => {
      const r = await criarSolicitacao(fd);
      if (!r.ok) {
        setErroGeral(r.message);
        if (r.fieldErrors) setFieldErrors(r.fieldErrors);
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nova solicitação
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova solicitação de contratação</DialogTitle>
          <DialogDescription>
            Peça autorização pra contratar um freelancer. O RH vai aprovar ou
            rejeitar; quando aprovado, você copia o link e envia pro freela
            preencher os dados dele.
          </DialogDescription>
        </DialogHeader>

        {erroGeral && (
          <div className="rounded-lg border border-california-red/30 bg-california-red/5 p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-california-red shrink-0 mt-0.5" />
            <p className="text-xs text-california-red font-medium">{erroGeral}</p>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <Campo rotulo="Nome do freela *" erro={fieldErrors.nome_freela}>
            <Input
              value={nomeFreela}
              onChange={(e) => setNomeFreela(e.target.value)}
              placeholder="Como esta pessoa é conhecida"
              disabled={pending}
              required
            />
          </Campo>

          <Campo rotulo="CPF do freela (opcional)" erro={fieldErrors.cpf_freela}>
            <MaskedInput
              mask="cpf"
              defaultValue={cpfFreela}
              onDigitsChange={setCpfFreela}
              disabled={pending}
            />
          </Campo>

          <Campo rotulo="Job *" erro={fieldErrors.job_id}>
            <JobPicker
              jobs={jobs}
              value={jobId}
              onChange={setJobId}
              disabled={pending}
            />
          </Campo>

          <Campo rotulo="Cargo" erro={fieldErrors.cargo}>
            <CargoPicker
              cargos={cargos}
              value={cargo}
              onChange={setCargo}
              disabled={pending}
            />
          </Campo>

          <Campo rotulo="Tipo *" erro={fieldErrors.tipo}>
            <RadioGroup
              value={tipo}
              onValueChange={(v) => setTipo(v as TipoFreelancerContrato)}
              disabled={pending}
              className="grid grid-cols-3 gap-2"
            >
              {(["mensal", "periodo", "diarias"] as const).map((t) => (
                <label
                  key={t}
                  htmlFor={`tipo-${t}`}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs hover:border-california-red/40 has-[:checked]:border-california-red has-[:checked]:bg-california-red/5 transition-all"
                >
                  <RadioGroupItem value={t} id={`tipo-${t}`} />
                  <span className="capitalize font-medium">{t}</span>
                </label>
              ))}
            </RadioGroup>
          </Campo>

          <div className="grid grid-cols-2 gap-4">
            <Campo rotulo="Valor *" erro={fieldErrors.valor}>
              <MoneyInput
                value={valor}
                onValueChange={setValor}
                disabled={pending}
              />
            </Campo>
            <Campo rotulo="Cidade" erro={fieldErrors.cidade}>
              <Input
                value={cidade}
                onChange={(e) => setCidade(e.target.value)}
                disabled={pending}
              />
            </Campo>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Campo rotulo="Data de início" erro={fieldErrors.data_inicio}>
              <Input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                disabled={pending}
              />
            </Campo>
            <Campo rotulo="Data de término" erro={fieldErrors.data_termino}>
              <Input
                type="date"
                value={dataTermino}
                onChange={(e) => setDataTermino(e.target.value)}
                disabled={pending}
              />
            </Campo>
          </div>

          <Campo rotulo="Observações" erro={fieldErrors.observacoes}>
            <Textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={2}
              disabled={pending}
              maxLength={1000}
            />
          </Campo>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground hover:border-california-red/40 transition-all"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-colors"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Enviar solicitação
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Campo({
  rotulo,
  erro,
  children,
}: {
  rotulo: string;
  erro?: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-foreground">{rotulo}</Label>
      {children}
      {erro && erro.length > 0 && (
        <p className="text-xs text-california-red font-medium">{erro[0]}</p>
      )}
    </div>
  );
}
