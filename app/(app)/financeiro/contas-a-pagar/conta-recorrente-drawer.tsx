"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Plus } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
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
import { Combobox } from "@/components/ui/combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { criarContaRecorrente, editarContaRecorrente } from "./actions-recorrentes";
import { RateioRegionalEditor } from "./rateio-regional-editor";
import type {
  ContaAvulsaRecorrente,
  FrequenciaRecorrencia,
  PlanoContaTipo,
  PlanoContaSubtipo,
  RateioLinhaInput,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------------

type EmpresaResumida = { id: string; nome: string };
type FornecedorResumido = { id: string; nome: string };
type ClienteResumido = { id: string; nome: string };
type JobResumido = { id: string; codigo: string; nome: string; cliente_id: string | null; regional_id: string | null };
type RegionalResumida = { id: string; nome: string; ativo: boolean };

// ---------------------------------------------------------------------------
// Utilitário de data
// ---------------------------------------------------------------------------

function formatDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Props discriminated union
// ---------------------------------------------------------------------------

type Props =
  | {
      mode: "criar";
      tenantId: string;
      empresas: EmpresaResumida[];
      tipos: PlanoContaTipo[];
      subtipos: PlanoContaSubtipo[];
      fornecedores: FornecedorResumido[];
      clientes: ClienteResumido[];
      jobs: JobResumido[];
      regionais: RegionalResumida[];
      trigger?: React.ReactNode;
    }
  | {
      mode: "editar";
      tenantId: string;
      recorrente: ContaAvulsaRecorrente;
      empresas: EmpresaResumida[];
      tipos: PlanoContaTipo[];
      subtipos: PlanoContaSubtipo[];
      fornecedores: FornecedorResumido[];
      clientes: ClienteResumido[];
      jobs: JobResumido[];
      regionais: RegionalResumida[];
      rateioInicial?: RateioLinhaInput[];
      open: boolean;
      onOpenChange: (b: boolean) => void;
      trigger?: React.ReactNode;
    };

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function ContaRecorrenteDrawer(props: Props) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  const isEditar = props.mode === "editar";
  const recorrente = isEditar
    ? (props as Extract<Props, { mode: "editar" }>).recorrente
    : undefined;

  // Controle de abertura (suporte a modo controlado e não-controlado)
  const isControlled = isEditar;
  const open = isControlled
    ? (props as Extract<Props, { mode: "editar" }>).open
    : internalOpen;
  const setOpen = isControlled
    ? (props as Extract<Props, { mode: "editar" }>).onOpenChange
    : setInternalOpen;

  // ---------------------------------------------------------------------------
  // Estado dos campos do formulário
  // ---------------------------------------------------------------------------

  const [empresaId, setEmpresaId] = React.useState<string>(
    recorrente?.empresa_id ?? "",
  );
  const [descricao, setDescricao] = React.useState<string>(
    recorrente?.descricao ?? "",
  );
  const [valor, setValor] = React.useState<string>(
    recorrente ? String(Number(recorrente.valor)) : "",
  );
  const [fornecedorId, setFornecedorId] = React.useState<string>(
    recorrente?.fornecedor_id ?? "__none__",
  );
  const [clienteId, setClienteId] = React.useState<string>(
    recorrente?.cliente_id ?? "__none__",
  );
  const [jobId, setJobId] = React.useState<string>(
    recorrente?.job_id ?? "__none__",
  );
  const [tipoId, setTipoId] = React.useState<string>(
    recorrente?.plano_conta_tipo_id ?? "",
  );
  const [subtipoId, setSubtipoId] = React.useState<string>(
    recorrente?.plano_conta_subtipo_id ?? "",
  );

  // Rateio de regional
  const rateioInicialEditar = isEditar
    ? ((props as Extract<Props, { mode: "editar" }>).rateioInicial ?? [])
    : [];
  const [rateio, setRateio] = React.useState<RateioLinhaInput[]>(rateioInicialEditar);

  // Campos de recorrência
  const [frequencia, setFrequencia] = React.useState<FrequenciaRecorrencia>(
    recorrente?.frequencia ?? "mensal",
  );
  const [diaDoMes, setDiaDoMes] = React.useState<number | null>(
    recorrente?.dia_do_mes ?? null,
  );
  const [diaQuinzena1, setDiaQuinzena1] = React.useState<number | null>(
    recorrente?.dia_quinzena_1 ?? null,
  );
  const [diaQuinzena2, setDiaQuinzena2] = React.useState<number | null>(
    recorrente?.dia_quinzena_2 ?? null,
  );
  const [diaDoAnoDia, setDiaDoAnoDia] = React.useState<number | null>(
    recorrente?.dia_do_ano_dia ?? null,
  );
  const [diaDoAnoMes, setDiaDoAnoMes] = React.useState<number | null>(
    recorrente?.dia_do_ano_mes ?? null,
  );
  const [dataFim, setDataFim] = React.useState<string | null>(
    recorrente?.data_fim ?? null,
  );

  // ---------------------------------------------------------------------------
  // Resetar estado ao abrir/fechar
  // ---------------------------------------------------------------------------

  React.useEffect(() => {
    if (open && isEditar && recorrente) {
      setEmpresaId(recorrente.empresa_id);
      setDescricao(recorrente.descricao);
      setValor(String(Number(recorrente.valor)));
      setFornecedorId(recorrente.fornecedor_id ?? "__none__");
      setClienteId(recorrente.cliente_id ?? "__none__");
      setJobId(recorrente.job_id ?? "__none__");
      setTipoId(recorrente.plano_conta_tipo_id);
      setSubtipoId(recorrente.plano_conta_subtipo_id);
      setFrequencia(recorrente.frequencia);
      setDiaDoMes(recorrente.dia_do_mes ?? null);
      setDiaQuinzena1(recorrente.dia_quinzena_1 ?? null);
      setDiaQuinzena2(recorrente.dia_quinzena_2 ?? null);
      setDiaDoAnoDia(recorrente.dia_do_ano_dia ?? null);
      setDiaDoAnoMes(recorrente.dia_do_ano_mes ?? null);
      setDataFim(recorrente.data_fim ?? null);
      setRateio(
        (props as Extract<Props, { mode: "editar" }>).rateioInicial ?? [],
      );
    }
    if (open && !isEditar) {
      setEmpresaId("");
      setDescricao("");
      setValor("");
      setFornecedorId("__none__");
      setClienteId("__none__");
      setJobId("__none__");
      setTipoId("");
      setSubtipoId("");
      setFrequencia("mensal");
      setDiaDoMes(null);
      setDiaQuinzena1(null);
      setDiaQuinzena2(null);
      setDiaDoAnoDia(null);
      setDiaDoAnoMes(null);
      setDataFim(null);
      setRateio([]);
    }
  // props é lido dentro mas o drawer sempre fecha/reabre para editar — não precisa reagir a mudança de props sem re-abrir
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEditar, recorrente]);

  // Subtipo filtrado pelo tipo selecionado
  const subtiposFiltrados = React.useMemo(
    () => props.subtipos.filter((s) => s.tipo_id === tipoId && s.ativo),
    [props.subtipos, tipoId],
  );

  // Ao mudar o tipo, resetar subtipo se não pertence mais ao tipo
  React.useEffect(() => {
    if (subtipoId && !subtiposFiltrados.some((s) => s.id === subtipoId)) {
      setSubtipoId("");
    }
  }, [tipoId, subtiposFiltrados, subtipoId]);

  // Ao mudar frequência, limpar campos das outras frequências
  React.useEffect(() => {
    if (frequencia !== "mensal") setDiaDoMes(null);
    if (frequencia !== "quinzenal") {
      setDiaQuinzena1(null);
      setDiaQuinzena2(null);
    }
    if (frequencia !== "anual") {
      setDiaDoAnoDia(null);
      setDiaDoAnoMes(null);
    }
  }, [frequencia]);

  // ---------------------------------------------------------------------------
  // Handlers fornecedor / cliente / job
  // ---------------------------------------------------------------------------

  const jobSelecionado = React.useMemo(
    () => (jobId !== "__none__" ? props.jobs.find((j) => j.id === jobId) ?? null : null),
    [jobId, props.jobs],
  );
  const clienteTravadoPeloJob = !!jobSelecionado?.cliente_id;

  React.useEffect(() => {
    if (jobSelecionado?.cliente_id) {
      setClienteId(jobSelecionado.cliente_id);
    }
  }, [jobSelecionado]);

  // Rateio derivado: soma e validade
  const somaRateio = rateio.reduce((s, l) => s + l.percentual, 0);
  const rateioValido =
    rateio.length > 0 && Math.abs(somaRateio - 100) < 0.01;
  // Bloqueia salvar se qualquer linha referencia regional inativa (spec 5.9)
  const rateioTemInativa = rateio.some(
    (r) => props.regionais.find((rr) => rr.id === r.regional_id)?.ativo === false,
  );

  function handleFornecedorChange(v: string | null) {
    setFornecedorId(v ?? "__none__");
  }

  function handleClienteChange(v: string | null) {
    if (clienteTravadoPeloJob) return;
    setClienteId(v ?? "__none__");
  }

  // ---------------------------------------------------------------------------
  // Abertura / fechamento
  // ---------------------------------------------------------------------------

  function handleOpenChange(next: boolean) {
    if (!next) {
      setError(null);
      setFieldErrors({});
    }
    setOpen(next);
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    // Validação client-side: quinzenal dia_1 < dia_2
    if (
      frequencia === "quinzenal" &&
      diaQuinzena1 !== null &&
      diaQuinzena2 !== null &&
      diaQuinzena1 >= diaQuinzena2
    ) {
      setFieldErrors({
        dia_quinzena_2: ["Segundo dia deve ser maior que o primeiro."],
      });
      return;
    }

    const input = {
      empresa_id: empresaId,
      descricao: descricao.trim(),
      valor,
      fornecedor_id: fornecedorId === "__none__" ? null : fornecedorId,
      cliente_id: clienteId === "__none__" ? null : clienteId,
      job_id: jobId === "__none__" ? null : jobId,
      plano_conta_tipo_id: tipoId,
      plano_conta_subtipo_id: subtipoId,
      frequencia,
      dia_do_mes: frequencia === "mensal" ? diaDoMes : null,
      dia_quinzena_1: frequencia === "quinzenal" ? diaQuinzena1 : null,
      dia_quinzena_2: frequencia === "quinzenal" ? diaQuinzena2 : null,
      dia_do_ano_dia: frequencia === "anual" ? diaDoAnoDia : null,
      dia_do_ano_mes: frequencia === "anual" ? diaDoAnoMes : null,
      data_fim: dataFim || null,
      rateio,
    };

    startTransition(async () => {
      const res =
        props.mode === "criar"
          ? await criarContaRecorrente(input)
          : await editarContaRecorrente(
              (props as Extract<Props, { mode: "editar" }>).recorrente.id,
              input,
            );

      if (!res.ok) {
        setError(res.message);
        if ("fieldErrors" in res && res.fieldErrors) {
          setFieldErrors(res.fieldErrors as Record<string, string[]>);
        }
        return;
      }
      handleOpenChange(false);
      router.refresh();
    });
  }

  // ---------------------------------------------------------------------------
  // Labels e derivados
  // ---------------------------------------------------------------------------

  const title =
    props.mode === "criar" ? "Nova recorrência" : "Editar recorrência";

  const submitLabel =
    props.mode === "criar"
      ? pending
        ? "Criando..."
        : "Criar recorrência"
      : pending
        ? "Salvando..."
        : "Salvar";

  const submitClass =
    props.mode === "criar"
      ? "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
      : "rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors";

  const tiposAtivos = props.tipos.filter((t) => t.ativo);

  const MESES = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {props.trigger && <DialogTrigger asChild>{props.trigger}</DialogTrigger>}
      {props.mode === "criar" && !props.trigger && (
        <DialogTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Nova recorrência
          </button>
        </DialogTrigger>
      )}

      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {props.mode === "criar"
              ? "Configure uma conta a pagar que se repete automaticamente conforme a frequência escolhida."
              : "Edite os dados da recorrência. Empresa não pode ser alterada após a criação."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Empresa */}
            <div className="space-y-2">
              <Label htmlFor="empresa_id">
                Empresa *
                {isEditar && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
                    (não pode ser alterada)
                  </span>
                )}
              </Label>
              <Select
                value={empresaId}
                onValueChange={setEmpresaId}
                disabled={isEditar}
                required
              >
                <SelectTrigger id="empresa_id">
                  <SelectValue placeholder="Selecione a empresa" />
                </SelectTrigger>
                <SelectContent>
                  {props.empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isEditar && (
                <p className="text-xs text-muted-foreground">
                  Empresa não pode ser alterada. Se estiver errada, exclua e crie outra.
                </p>
              )}
              {fieldErrors.empresa_id?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Descrição */}
            <div className="space-y-2">
              <Label htmlFor="descricao">Descrição *</Label>
              <textarea
                id="descricao"
                rows={3}
                maxLength={500}
                required
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Descreva a recorrência..."
                className="flex w-full rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:border-california-red focus-visible:ring-2 focus-visible:ring-california-red/15 resize-none disabled:cursor-not-allowed disabled:opacity-50"
              />
              <p className="text-xs text-muted-foreground text-right">
                {descricao.length}/500
              </p>
              {fieldErrors.descricao?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Valor */}
            <div className="space-y-2">
              <Label htmlFor="valor">Valor (R$) *</Label>
              <Input
                id="valor"
                type="number"
                step="0.01"
                min="0.01"
                required
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="0,00"
                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              {fieldErrors.valor?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Job — vem antes de Cliente porque escolher job preenche
                cliente automaticamente (herdado do projeto do job). */}
            <div className="space-y-2">
              <Label htmlFor="job_id">Job</Label>
              <Combobox
                id="job_id"
                value={jobId}
                onChange={(v) => setJobId(v ?? "__none__")}
                placeholder="Nenhum (opcional)"
                items={[
                  { value: "__none__", label: "Nenhum" },
                  ...props.jobs.map((j) => ({
                    value: j.id,
                    label: `${j.codigo} — ${j.nome}`,
                  })),
                ]}
              />
              {fieldErrors.job_id?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Fornecedor — destinatário do pagamento */}
            <div className="space-y-2">
              <Label htmlFor="fornecedor_id">Fornecedor</Label>
              <Combobox
                id="fornecedor_id"
                value={fornecedorId}
                onChange={handleFornecedorChange}
                placeholder="Nenhum (opcional)"
                items={[
                  { value: "__none__", label: "Nenhum" },
                  ...props.fornecedores.map((f) => ({
                    value: f.id,
                    label: f.nome,
                  })),
                ]}
              />
              {fieldErrors.fornecedor_id?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Cliente — rastreabilidade de custo. Travado se job escolhido. */}
            <div className="space-y-2">
              <Label htmlFor="cliente_id">Cliente</Label>
              <Combobox
                id="cliente_id"
                value={clienteId}
                onChange={handleClienteChange}
                placeholder="Nenhum (opcional)"
                disabled={clienteTravadoPeloJob}
                items={[
                  { value: "__none__", label: "Nenhum" },
                  ...props.clientes.map((c) => ({
                    value: c.id,
                    label: c.nome,
                  })),
                ]}
              />
              {clienteTravadoPeloJob && (
                <p className="text-xs text-muted-foreground">
                  Cliente herdado do projeto do job. Para alterar, mude ou remova o job.
                </p>
              )}
              {fieldErrors.cliente_id?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Rateio de regional */}
            <RateioRegionalEditor
              linhas={rateio}
              onChange={setRateio}
              regionais={props.regionais}
              jobRegionalId={jobSelecionado?.regional_id ?? null}
              disabled={pending}
            />

            {/* Tipo do plano de contas */}
            <div className="space-y-2">
              <Label htmlFor="plano_conta_tipo_id">Tipo *</Label>
              <Select
                value={tipoId}
                onValueChange={(v) => {
                  setTipoId(v);
                  setSubtipoId("");
                }}
                required
              >
                <SelectTrigger id="plano_conta_tipo_id">
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  {tiposAtivos.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.codigo} — {t.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.plano_conta_tipo_id?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Subtipo do plano de contas */}
            <div className="space-y-2">
              <Label htmlFor="plano_conta_subtipo_id">Subtipo *</Label>
              <Select
                value={subtipoId}
                onValueChange={setSubtipoId}
                disabled={!tipoId || subtiposFiltrados.length === 0}
                required
              >
                <SelectTrigger id="plano_conta_subtipo_id">
                  <SelectValue
                    placeholder={
                      tipoId
                        ? subtiposFiltrados.length === 0
                          ? "Nenhum subtipo disponível"
                          : "Selecione o subtipo"
                        : "Selecione o tipo primeiro"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {subtiposFiltrados.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.plano_conta_subtipo_id?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* ---------------------------------------------------------------- */}
            {/* Recorrência                                                       */}
            {/* ---------------------------------------------------------------- */}

            {/* Frequência */}
            <div className="space-y-3">
              <Label>Frequência *</Label>
              <div className="flex gap-3">
                {(["mensal", "quinzenal", "anual"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFrequencia(f)}
                    className={[
                      "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                      frequencia === f
                        ? "border-california-red bg-california-red/10 text-california-red"
                        : "border-border bg-white text-muted-foreground hover:bg-muted",
                    ].join(" ")}
                  >
                    {f === "mensal" ? "Mensal" : f === "quinzenal" ? "Quinzenal" : "Anual"}
                  </button>
                ))}
              </div>
              {fieldErrors.frequencia?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Mensal: dia do mês */}
            {frequencia === "mensal" && (
              <div className="space-y-2">
                <Label htmlFor="dia_do_mes">Dia do vencimento *</Label>
                <Input
                  id="dia_do_mes"
                  type="number"
                  min={1}
                  max={31}
                  value={diaDoMes ?? ""}
                  onChange={(e) =>
                    setDiaDoMes(e.target.value ? Number(e.target.value) : null)
                  }
                  className="no-spinner [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  placeholder="Ex: 5"
                />
                <p className="text-xs text-muted-foreground">
                  Se o mês não tiver esse dia (ex: 31 em fevereiro), cai no último dia do mês.
                </p>
                {fieldErrors.dia_do_mes?.map((msg, i) => (
                  <p key={i} className="text-xs text-california-red">
                    {msg}
                  </p>
                ))}
              </div>
            )}

            {/* Quinzenal: dois dias */}
            {frequencia === "quinzenal" && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="dia_quinzena_1">Primeiro dia *</Label>
                    <Input
                      id="dia_quinzena_1"
                      type="number"
                      min={1}
                      max={31}
                      value={diaQuinzena1 ?? ""}
                      onChange={(e) =>
                        setDiaQuinzena1(e.target.value ? Number(e.target.value) : null)
                      }
                      className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      placeholder="Ex: 5"
                    />
                    {fieldErrors.dia_quinzena_1?.map((msg, i) => (
                      <p key={i} className="text-xs text-california-red">
                        {msg}
                      </p>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dia_quinzena_2">Segundo dia *</Label>
                    <Input
                      id="dia_quinzena_2"
                      type="number"
                      min={1}
                      max={31}
                      value={diaQuinzena2 ?? ""}
                      onChange={(e) =>
                        setDiaQuinzena2(e.target.value ? Number(e.target.value) : null)
                      }
                      className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      placeholder="Ex: 20"
                    />
                    {fieldErrors.dia_quinzena_2?.map((msg, i) => (
                      <p key={i} className="text-xs text-california-red">
                        {msg}
                      </p>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Segundo dia deve ser maior que o primeiro. Se o mês não tiver o dia, cai no último dia do mês.
                </p>
              </div>
            )}

            {/* Anual: dia e mês */}
            {frequencia === "anual" && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="dia_do_ano_dia">Dia *</Label>
                    <Input
                      id="dia_do_ano_dia"
                      type="number"
                      min={1}
                      max={31}
                      value={diaDoAnoDia ?? ""}
                      onChange={(e) =>
                        setDiaDoAnoDia(e.target.value ? Number(e.target.value) : null)
                      }
                      className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      placeholder="Ex: 15"
                    />
                    {fieldErrors.dia_do_ano_dia?.map((msg, i) => (
                      <p key={i} className="text-xs text-california-red">
                        {msg}
                      </p>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dia_do_ano_mes">Mês *</Label>
                    <Select
                      value={diaDoAnoMes ? String(diaDoAnoMes) : "__none_mes__"}
                      onValueChange={(v) =>
                        setDiaDoAnoMes(v !== "__none_mes__" ? Number(v) : null)
                      }
                    >
                      <SelectTrigger id="dia_do_ano_mes">
                        <SelectValue placeholder="Selecione o mês" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none_mes__">Selecione o mês</SelectItem>
                        {MESES.map((nome, i) => (
                          <SelectItem key={i + 1} value={String(i + 1)}>
                            {nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {fieldErrors.dia_do_ano_mes?.map((msg, i) => (
                      <p key={i} className="text-xs text-california-red">
                        {msg}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Data de fim (opcional) */}
            <div className="space-y-2">
              <Label htmlFor="data_fim">Data de fim (opcional)</Label>
              <DatePicker
                key={isEditar ? `edit-${recorrente?.id ?? "criar"}` : "criar"}
                name="data_fim"
                defaultValue={dataFim ?? undefined}
                placeholder="Sem data de encerramento"
                onDateChange={(d) => setDataFim(d ? formatDateISO(d) : null)}
              />
              <p className="text-xs text-muted-foreground">
                Se preenchida, a recorrência para automaticamente após essa data.
              </p>
              {fieldErrors.data_fim?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Explicação do funcionamento */}
            <p className="text-xs text-muted-foreground bg-muted/40 border border-border rounded-md p-3">
              <strong>Como funciona:</strong> ao salvar, o sistema calcula a próxima data válida a partir de hoje.
              Não gera ocorrências retroativas. Cron diário às 03h gera cada instância pendente no dia do vencimento.
            </p>

            {/* Erro geral */}
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border p-4 space-y-2">
            {rateioTemInativa && (
              <p className="text-xs text-amber-700 text-right">
                Substitua a regional inativa antes de salvar.
              </p>
            )}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={pending || !rateioValido || rateioTemInativa}
                className={submitClass}
              >
                {submitLabel}
              </button>
            </div>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
