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
import { cn, onlyDigits, isValidCpf } from "@/lib/utils";
import type {
  FreelancerCargo,
  TipoFreelancerContrato,
} from "@/lib/types";
import { JobPicker, type JobItem } from "../../_components/job-picker";
import { CargoPicker } from "../../_components/cargo-picker";
import { HistoricoContratosFreela } from "../../_components/historico-contratos-freela";
import { criarSolicitacao } from "../actions";

interface FreelancerPreTravado {
  id: string;
  nome: string;
  cpf: string | null;
}

interface Props {
  jobs: JobItem[];
  cargos: FreelancerCargo[];
  /** Quando setado, o form começa com nome/CPF travados (vem do Buscar). */
  freelancer?: FreelancerPreTravado | null;
  /** Começa aberto. Usado quando o picker dispara o dialog. */
  defaultOpen?: boolean;
  /** Começa direto na tela de histórico (caminho A, via picker). */
  iniciarRevisandoHistorico?: boolean;
  /** Chamado quando o dialog fecha. */
  onClose?: () => void;
  /** Trigger customizado — se não passar, usa o botão padrão "Nova solicitação". */
  trigger?: React.ReactNode;
}

type FieldErrors = Record<string, string[]>;
type Modo = "preenchendo" | "revisando_historico";

export function NovaSolicitacaoDialog({
  jobs,
  cargos,
  freelancer: freelancerInicial = null,
  defaultOpen = false,
  iniciarRevisandoHistorico = false,
  onClose,
  trigger,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(defaultOpen);
  const [pending, startTransition] = React.useTransition();
  const [erroGeral, setErroGeral] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});

  // Modo do dialog
  const [modo, setModo] = React.useState<Modo>(
    iniciarRevisandoHistorico && freelancerInicial ? "revisando_historico" : "preenchendo",
  );

  // Freela selecionado (via picker ou via CPF já cadastrado). Trava CPF/nome.
  const [freelaSelecionado, setFreelaSelecionado] =
    React.useState<FreelancerPreTravado | null>(freelancerInicial);

  // Form state
  const [nomeFreela, setNomeFreela] = React.useState(
    freelancerInicial?.nome ?? "",
  );
  const [cpfFreela, setCpfFreela] = React.useState(
    freelancerInicial?.cpf ?? "",
  );
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [cargo, setCargo] = React.useState<string | null>(null);
  const [tipo, setTipo] = React.useState<TipoFreelancerContrato>("mensal");
  const [valor, setValor] = React.useState<number | null>(null);
  const [dataInicio, setDataInicio] = React.useState("");
  const [dataTermino, setDataTermino] = React.useState("");
  const [cidade, setCidade] = React.useState("");
  const [observacoes, setObservacoes] = React.useState("");

  const [buscandoCpf, setBuscandoCpf] = React.useState(false);

  function reset() {
    setNomeFreela(freelancerInicial?.nome ?? "");
    setCpfFreela(freelancerInicial?.cpf ?? "");
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
    setFreelaSelecionado(freelancerInicial);
    setModo(
      iniciarRevisandoHistorico && freelancerInicial
        ? "revisando_historico"
        : "preenchendo",
    );
  }

  function fechar() {
    setOpen(false);
    reset();
    onClose?.();
  }

  // Debounce CPF: assim que o campo fica válido, consulta backend. Se o
  // freela já existe no tenant, troca pra modo revisando_historico. Pulamos
  // quando freelaSelecionado já está preenchido (CPF readonly).
  React.useEffect(() => {
    if (!open) return;
    if (freelaSelecionado) return;
    const digits = onlyDigits(cpfFreela);
    if (digits.length !== 11 || !isValidCpf(digits)) return;

    let cancelado = false;
    setBuscandoCpf(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/freelancers/buscar-por-cpf?cpf=${digits}`,
        );
        if (!r.ok) return;
        const body = (await r.json()) as {
          encontrado: { id: string; nome_social: string } | null;
        };
        if (cancelado) return;
        if (body.encontrado) {
          setFreelaSelecionado({
            id: body.encontrado.id,
            nome: body.encontrado.nome_social,
            cpf: digits,
          });
          setModo("revisando_historico");
        }
      } catch {
        // silencioso: CPF novo segue normal
      } finally {
        if (!cancelado) setBuscandoCpf(false);
      }
    }, 400);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [cpfFreela, open, freelaSelecionado]);

  function voltarDoHistorico() {
    // Veio direto do picker (caminho A) → fechar e devolver ao caller.
    if (iniciarRevisandoHistorico) {
      fechar();
      return;
    }
    // Caminho B: solta o freela e volta ao form (user pode corrigir CPF).
    setFreelaSelecionado(null);
    setCpfFreela("");
    setNomeFreela("");
    setModo("preenchendo");
  }

  function prosseguirDoHistorico() {
    setModo("preenchendo");
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
      fechar();
      router.refresh();
    });
  }

  // Trigger default (botão "Nova solicitação"). Quando o caller passa
  // defaultOpen, não há trigger — o dialog é controlado externamente.
  const dialogTrigger =
    trigger !== undefined
      ? trigger
      : !defaultOpen && (
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover transition-colors"
          >
            <Plus className="h-4 w-4" />
            Nova solicitação
          </button>
        );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          reset();
          onClose?.();
        }
      }}
    >
      {dialogTrigger && <DialogTrigger asChild>{dialogTrigger}</DialogTrigger>}
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        {modo === "revisando_historico" && freelaSelecionado ? (
          <HistoricoContratosFreela
            freelancer={freelaSelecionado}
            onProsseguir={prosseguirDoHistorico}
            onVoltar={voltarDoHistorico}
            labelProsseguir="Prosseguir pra solicitação"
          />
        ) : (
          <div className="p-6">
            <DialogHeader>
              <DialogTitle>Nova solicitação de contratação</DialogTitle>
              <DialogDescription>
                Peça autorização pra contratar um freelancer. O RH vai aprovar
                ou rejeitar; quando aprovado, você copia o link e envia pro
                freela preencher os dados dele.
              </DialogDescription>
            </DialogHeader>

            {erroGeral && (
              <div className="mt-4 rounded-lg border border-california-red/30 bg-california-red/5 p-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-california-red shrink-0 mt-0.5" />
                <p className="text-xs text-california-red font-medium">
                  {erroGeral}
                </p>
              </div>
            )}

            <form onSubmit={onSubmit} className="space-y-4 mt-4">
              <Campo rotulo="Nome do freela *" erro={fieldErrors.nome_freela}>
                <Input
                  value={nomeFreela}
                  onChange={(e) => setNomeFreela(e.target.value)}
                  placeholder="Como esta pessoa é conhecida"
                  disabled={pending || !!freelaSelecionado}
                  required
                />
              </Campo>

              <Campo
                rotulo={
                  freelaSelecionado
                    ? "CPF do freela (travado)"
                    : "CPF do freela (opcional)"
                }
                erro={fieldErrors.cpf_freela}
              >
                <div className="relative">
                  <MaskedInput
                    mask="cpf"
                    defaultValue={cpfFreela}
                    onDigitsChange={setCpfFreela}
                    disabled={pending || !!freelaSelecionado}
                  />
                  {buscandoCpf && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
                {!freelaSelecionado && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Se o CPF já existir no sistema, mostramos o histórico antes.
                  </p>
                )}
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
                  onClick={fechar}
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
          </div>
        )}
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
