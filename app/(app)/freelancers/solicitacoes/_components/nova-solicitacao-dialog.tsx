"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  Plus,
  Loader2,
  AlertCircle,
  UserPlus,
  X,
  Lock,
  UserX,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MaskedInput } from "@/components/ui/masked-input";
import { MoneyInput } from "@/components/ui/money-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Combobox, COMBOBOX_COMO_SELECT } from "@/components/ui/combobox";
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
  freelancer?: FreelancerPreTravado | null;
  defaultOpen?: boolean;
  iniciarRevisandoHistorico?: boolean;
  onClose?: () => void;
  trigger?: React.ReactNode;
}

type FieldErrors = Record<string, string[]>;
type Modo = "preenchendo" | "revisando_historico";

const TIPO_OPCOES = [
  { value: "mensal", label: "Mensal" },
  { value: "diarias", label: "Diárias" },
];

function isoDate(d: Date | null): string {
  if (!d) return "";
  return format(d, "yyyy-MM-dd");
}

/** Separa um "Nome completo" (que pode vir pré-travado) em primeiro + resto. */
function splitNome(nome: string): { primeiro: string; resto: string } {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return { primeiro: "", resto: "" };
  if (partes.length === 1) return { primeiro: partes[0], resto: "" };
  return { primeiro: partes[0], resto: partes.slice(1).join(" ") };
}

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

  const [modo, setModo] = React.useState<Modo>(
    iniciarRevisandoHistorico && freelancerInicial
      ? "revisando_historico"
      : "preenchendo",
  );
  const [freelaSelecionado, setFreelaSelecionado] =
    React.useState<FreelancerPreTravado | null>(freelancerInicial);

  // Form state
  const nomeInicial = React.useMemo(
    () => splitNome(freelancerInicial?.nome ?? ""),
    [freelancerInicial],
  );
  const [nome, setNome] = React.useState(nomeInicial.primeiro);
  const [sobrenome, setSobrenome] = React.useState(nomeInicial.resto);
  const [cpfFreela, setCpfFreela] = React.useState(
    freelancerInicial?.cpf ?? "",
  );
  const [cargo, setCargo] = React.useState<string | null>(null);
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [valor, setValor] = React.useState<number | null>(null);
  const [tipo, setTipo] = React.useState<TipoFreelancerContrato>("mensal");
  const [dataInicio, setDataInicio] = React.useState("");
  const [dataTermino, setDataTermino] = React.useState("");
  const [observacoes, setObservacoes] = React.useState("");

  const [buscandoCpf, setBuscandoCpf] = React.useState(false);
  const travado = !!freelaSelecionado;

  function reset() {
    const i = splitNome(freelancerInicial?.nome ?? "");
    setNome(i.primeiro);
    setSobrenome(i.resto);
    setCpfFreela(freelancerInicial?.cpf ?? "");
    setJobId(null);
    setCargo(null);
    setTipo("mensal");
    setValor(null);
    setDataInicio("");
    setDataTermino("");
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

  // Debounce CPF: assim que fica válido, consulta backend. Se existe, troca
  // pra modo revisando_historico.
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
        // silencioso
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
    if (iniciarRevisandoHistorico) {
      fechar();
      return;
    }
    // Caminho B: solta o freela e volta ao form.
    setFreelaSelecionado(null);
    setCpfFreela("");
    setNome("");
    setSobrenome("");
    setModo("preenchendo");
  }

  function prosseguirDoHistorico() {
    setModo("preenchendo");
  }

  function trocarFreela() {
    setFreelaSelecionado(null);
    setNome("");
    setSobrenome("");
    setCpfFreela("");
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErroGeral(null);
    setFieldErrors({});

    // Validações client-side
    const cpfDigits = onlyDigits(cpfFreela);
    if (!travado) {
      if (cpfDigits.length !== 11 || !isValidCpf(cpfDigits)) {
        setErroGeral("CPF inválido.");
        return;
      }
      if (!nome.trim() || !sobrenome.trim()) {
        setErroGeral("Preencha nome e sobrenome.");
        return;
      }
    }
    if (!jobId) {
      setErroGeral("Selecione um job.");
      return;
    }
    if (!cargo) {
      setErroGeral("Selecione um cargo.");
      return;
    }
    if (!valor || valor <= 0) {
      setErroGeral("Informe um valor válido.");
      return;
    }
    if (!dataInicio) {
      setErroGeral("Informe a data de início.");
      return;
    }

    const nomeFinal = travado
      ? freelaSelecionado!.nome
      : `${nome.trim()} ${sobrenome.trim()}`.trim();

    const fd = new FormData();
    fd.set("nome_freela", nomeFinal);
    fd.set("cpf_freela", cpfDigits);
    fd.set("job_id", jobId);
    fd.set("cargo", cargo);
    fd.set("tipo", tipo);
    fd.set("valor", String(valor));
    fd.set("data_inicio", dataInicio);
    fd.set("data_termino", dataTermino);
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
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        {modo === "revisando_historico" && freelaSelecionado ? (
          <HistoricoContratosFreela
            freelancer={freelaSelecionado}
            onProsseguir={prosseguirDoHistorico}
            onVoltar={voltarDoHistorico}
            labelProsseguir="Prosseguir pra solicitação"
          />
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-border shrink-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-california-red flex items-center gap-1.5">
                <UserPlus className="h-3.5 w-3.5" />
                Nova solicitação
              </p>
              <h2 className="text-lg font-bold text-foreground mt-0.5">
                Solicitar contratação de freelancer
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {travado
                  ? "Freela já cadastrado — aprovação cria o contrato direto."
                  : "RH/Financeiro aprova antes de o link ser gerado para o freela."}
              </p>
            </div>

            {travado && (
              <div className="mx-6 mt-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 shrink-0">
                <p className="text-[11px] font-semibold text-emerald-900">
                  ✓ Freela cadastrado selecionado
                </p>
                <button
                  type="button"
                  onClick={trocarFreela}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 hover:text-emerald-900"
                >
                  <UserX className="h-3 w-3" />
                  Trocar freela
                </button>
              </div>
            )}

            <div className="p-6 space-y-3">
              {/* CPF obrigatório */}
              <Campo rotulo="CPF *" erro={fieldErrors.cpf_freela}>
                <div className="relative">
                  <MaskedInput
                    mask="cpf"
                    defaultValue={cpfFreela}
                    onDigitsChange={setCpfFreela}
                    disabled={pending || travado}
                    className={cn(travado && "bg-muted/40 pr-8")}
                  />
                  {travado && (
                    <Lock className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  {buscandoCpf && !travado && (
                    <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground animate-spin" />
                  )}
                </div>
              </Campo>

              {/* Nome | Sobrenome */}
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Nome *">
                  <div className="relative">
                    <input
                      value={travado ? freelaSelecionado!.nome : nome}
                      onChange={(e) => setNome(e.target.value)}
                      disabled={pending}
                      readOnly={travado}
                      placeholder="Nome"
                      className={cn(
                        INPUT,
                        travado && "bg-muted/40 cursor-not-allowed pr-8",
                      )}
                    />
                    {travado && (
                      <Lock className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                </Campo>
                <Campo rotulo="Sobrenome *">
                  <div className="relative">
                    <input
                      value={travado ? "" : sobrenome}
                      onChange={(e) => setSobrenome(e.target.value)}
                      disabled={pending}
                      readOnly={travado}
                      placeholder={travado ? "—" : "Sobrenome"}
                      className={cn(
                        INPUT,
                        travado && "bg-muted/40 cursor-not-allowed pr-8",
                      )}
                    />
                    {travado && (
                      <Lock className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                </Campo>
              </div>

              {/* Cargo */}
              <Campo rotulo="Cargo *" erro={fieldErrors.cargo}>
                <CargoPicker
                  cargos={cargos}
                  value={cargo}
                  onChange={setCargo}
                  disabled={pending}
                />
              </Campo>

              {/* Job | Valor | Tipo */}
              <div className="grid grid-cols-[2fr_1fr_1fr] gap-3">
                <Campo rotulo="Job *" erro={fieldErrors.job_id}>
                  <JobPicker
                    jobs={jobs}
                    value={jobId}
                    onChange={setJobId}
                    disabled={pending}
                  />
                </Campo>
                <Campo rotulo="Valor (R$) *" erro={fieldErrors.valor}>
                  <MoneyInput
                    value={valor}
                    onValueChange={setValor}
                    disabled={pending}
                  />
                </Campo>
                <Campo rotulo="Tipo *">
                  <Combobox
                    items={TIPO_OPCOES}
                    value={tipo}
                    onChange={(v) =>
                      setTipo((v ?? "mensal") as TipoFreelancerContrato)
                    }
                    disabled={pending}
                    className={COMBOBOX_COMO_SELECT}
                  />
                </Campo>
              </div>

              {/* Início | Término */}
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Início *" erro={fieldErrors.data_inicio}>
                  <DatePicker
                    name="data_inicio"
                    defaultValue={dataInicio}
                    onDateChange={(d) => setDataInicio(isoDate(d))}
                    required
                    disabled={pending}
                  />
                </Campo>
                <Campo rotulo="Término" erro={fieldErrors.data_termino}>
                  <DatePicker
                    key={dataInicio}
                    name="data_termino"
                    defaultValue={dataTermino}
                    onDateChange={(d) => setDataTermino(isoDate(d))}
                    disabled={pending}
                  />
                </Campo>
              </div>

              {/* Observações */}
              <Campo rotulo="Observações para o RH" erro={fieldErrors.observacoes}>
                <textarea
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                  rows={2}
                  disabled={pending}
                  maxLength={1000}
                  placeholder="Opcional"
                  className={cn(INPUT, "resize-none")}
                />
              </Campo>

              {erroGeral && (
                <div className="rounded-lg border border-california-red/30 bg-california-red/5 p-2.5 flex items-start gap-2">
                  <AlertCircle className="h-3.5 w-3.5 text-california-red shrink-0 mt-0.5" />
                  <p className="text-xs text-california-red font-medium">
                    {erroGeral}
                  </p>
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-border flex items-center justify-end gap-2 bg-muted/10 shrink-0">
              <button
                type="button"
                onClick={fechar}
                disabled={pending}
                className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted/40 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-california-red text-white text-xs font-semibold px-4 py-2 hover:bg-california-red-hover transition-colors disabled:opacity-60"
              >
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Enviar solicitação
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

const INPUT =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-california-red/30 disabled:opacity-60";

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
    <div>
      <label className="block text-[11px] font-semibold text-foreground mb-1">
        {rotulo}
      </label>
      {children}
      {erro && erro.length > 0 && (
        <p className="text-[11px] text-california-red font-medium mt-1">
          {erro[0]}
        </p>
      )}
    </div>
  );
}
