"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Paperclip, Plus, X } from "lucide-react";
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
import { createClient } from "@/lib/supabase/client";
import { criarContaAvulsa, editarContaAvulsa } from "./actions-avulsas";
import type {
  ContaAvulsa,
  PlanoContaTipo,
  PlanoContaSubtipo,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Constantes de validação de upload
// ---------------------------------------------------------------------------

const ANEXO_TAMANHO_MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ANEXOS_TAMANHO_TOTAL_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

// ---------------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------------

interface AnexoPendente {
  path: string;
  nome: string;
  tamanho: number;
  mimetype: string;
}

type EmpresaResumida = { id: string; nome: string };
type FornecedorResumido = { id: string; nome: string };
type ClienteResumido = { id: string; nome: string };
type JobResumido = { id: string; codigo: string; nome: string };

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
      trigger?: React.ReactNode;
    }
  | {
      mode: "editar";
      tenantId: string;
      conta: ContaAvulsa;
      empresas: EmpresaResumida[];
      tipos: PlanoContaTipo[];
      subtipos: PlanoContaSubtipo[];
      fornecedores: FornecedorResumido[];
      clientes: ClienteResumido[];
      jobs: JobResumido[];
      open: boolean;
      onOpenChange: (b: boolean) => void;
      trigger?: React.ReactNode;
    };

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function ContaAvulsaDrawer(props: Props) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});

  const isEditar = props.mode === "editar";
  const conta = isEditar ? (props as Extract<Props, { mode: "editar" }>).conta : undefined;

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
    conta?.empresa_id ?? "",
  );
  // Contas a pagar são sempre saída. Se um dia entrar recebimento avulso,
  // vira outra aba/módulo — não este drawer.
  const natureza: "saida" = "saida";
  const [descricao, setDescricao] = React.useState<string>(
    conta?.descricao ?? "",
  );
  const [valor, setValor] = React.useState<string>(
    conta ? String(Number(conta.valor)) : "",
  );
  const [dataPrevista, setDataPrevista] = React.useState<string>(
    conta?.data_prevista_pagamento ?? "",
  );
  const [fornecedorId, setFornecedorId] = React.useState<string>(
    conta?.fornecedor_id ?? "__none__",
  );
  const [clienteId, setClienteId] = React.useState<string>(
    conta?.cliente_id ?? "__none__",
  );
  const [jobId, setJobId] = React.useState<string>(
    conta?.job_id ?? "__none__",
  );
  const [tipoId, setTipoId] = React.useState<string>(
    conta?.plano_conta_tipo_id ?? "",
  );
  const [subtipoId, setSubtipoId] = React.useState<string>(
    conta?.plano_conta_subtipo_id ?? "",
  );

  // Anexos (só em modo criar)
  const [anexos, setAnexos] = React.useState<AnexoPendente[]>([]);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------------
  // Resetar estado ao abrir/fechar
  // ---------------------------------------------------------------------------

  React.useEffect(() => {
    if (open && isEditar && conta) {
      setEmpresaId(conta.empresa_id);
      setDescricao(conta.descricao);
      setValor(String(Number(conta.valor)));
      setDataPrevista(conta.data_prevista_pagamento ?? "");
      setFornecedorId(conta.fornecedor_id ?? "__none__");
      setClienteId(conta.cliente_id ?? "__none__");
      setJobId(conta.job_id ?? "__none__");
      setTipoId(conta.plano_conta_tipo_id);
      setSubtipoId(conta.plano_conta_subtipo_id);
    }
    if (open && !isEditar) {
      setEmpresaId("");
      setDescricao("");
      setValor("");
      setDataPrevista("");
      setFornecedorId("__none__");
      setClienteId("__none__");
      setJobId("__none__");
      setTipoId("");
      setSubtipoId("");
      setAnexos([]);
      setUploadError(null);
    }
  }, [open, isEditar, conta]);

  // Subtipo filtrado pelo tipo selecionado
  const subtiposFiltrados = React.useMemo(
    () =>
      props.subtipos.filter((s) => s.tipo_id === tipoId && s.ativo),
    [props.subtipos, tipoId],
  );

  // Ao mudar o tipo, resetar subtipo se não pertence mais ao tipo
  React.useEffect(() => {
    if (subtipoId && !subtiposFiltrados.some((s) => s.id === subtipoId)) {
      setSubtipoId("");
    }
  }, [tipoId, subtiposFiltrados, subtipoId]);

  // ---------------------------------------------------------------------------
  // Handlers fornecedor / cliente (mutuamente exclusivos)
  // ---------------------------------------------------------------------------

  function handleFornecedorChange(v: string) {
    setFornecedorId(v);
    if (v !== "__none__") setClienteId("__none__");
  }

  function handleClienteChange(v: string) {
    setClienteId(v);
    if (v !== "__none__") setFornecedorId("__none__");
  }

  // ---------------------------------------------------------------------------
  // Upload de anexos
  // ---------------------------------------------------------------------------

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setUploadError(null);

    // Accumulator começa com o total já existente e é atualizado dentro do
    // loop, evitando que os arquivos 2, 3... validem contra o estado inicial.
    let totalAcumulado = anexos.reduce((acc, a) => acc + a.tamanho, 0);
    const novos: AnexoPendente[] = [];

    for (const file of files) {
      if (file.size > ANEXO_TAMANHO_MAX_BYTES) {
        setUploadError(
          `"${file.name}" excede o limite de 8 MB por arquivo.`,
        );
        continue;
      }
      if (totalAcumulado + file.size > ANEXOS_TAMANHO_TOTAL_MAX_BYTES) {
        setUploadError("Total de anexos ultrapassa 25 MB. Remova algum antes de adicionar mais.");
        break;
      }

      // Gera path único no bucket
      const uid =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) +
            Math.random().toString(36).slice(2);
      const path = `${props.tenantId}/${uid}-${file.name}`;

      setUploadingFile(file.name);
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from("contas-avulsas")
        .upload(path, file, { upsert: false });
      setUploadingFile(null);

      if (upErr) {
        setUploadError(`Falha ao enviar "${file.name}": ${upErr.message}`);
        continue;
      }

      totalAcumulado += file.size;
      novos.push({ path, nome: file.name, tamanho: file.size, mimetype: file.type });
    }

    if (novos.length > 0) {
      setAnexos((prev) => [...prev, ...novos]);
    }

    // Limpa o input pra permitir re-selecionar o mesmo arquivo
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleRemoverAnexo(idx: number) {
    const anexo = anexos[idx];
    if (!anexo) return;
    const supabase = createClient();
    await supabase.storage.from("contas-avulsas").remove([anexo.path]);
    setAnexos((prev) => prev.filter((_, i) => i !== idx));
  }

  // ---------------------------------------------------------------------------
  // Abertura / fechamento
  // ---------------------------------------------------------------------------

  function handleOpenChange(next: boolean) {
    if (!next) {
      setError(null);
      setFieldErrors({});
      setUploadError(null);
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

    const input = {
      empresa_id: empresaId,
      descricao: descricao.trim(),
      valor,
      natureza,
      data_prevista_pagamento: dataPrevista || null,
      fornecedor_id: fornecedorId === "__none__" ? null : fornecedorId,
      cliente_id: clienteId === "__none__" ? null : clienteId,
      job_id: jobId === "__none__" ? null : jobId,
      plano_conta_tipo_id: tipoId,
      plano_conta_subtipo_id: subtipoId,
      ...(props.mode === "criar" ? { anexos } : {}),
    };

    startTransition(async () => {
      const res =
        props.mode === "criar"
          ? await criarContaAvulsa(input)
          : await editarContaAvulsa(
              (props as Extract<Props, { mode: "editar" }>).conta.id,
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
    props.mode === "criar" ? "Nova conta avulsa" : "Editar conta avulsa";
  const submitLabel =
    props.mode === "criar"
      ? pending
        ? "Criando..."
        : "Criar"
      : pending
        ? "Salvando..."
        : "Salvar";

  const submitClass =
    props.mode === "criar"
      ? "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
      : "rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors";

  const tiposAtivos = props.tipos.filter((t) => t.ativo);

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
            Nova conta avulsa
          </button>
        </DialogTrigger>
      )}

      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {props.mode === "criar"
              ? "Registre uma conta a pagar sem vínculo com pedido de produção."
              : "Edite os dados da conta avulsa. Empresa não pode ser alterada. Anexos não são modificados neste formulário."}
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
                placeholder="Descreva a conta avulsa..."
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

            {/* Data prevista de pagamento */}
            <div className="space-y-2">
              <Label>Data prevista de pagamento</Label>
              <DatePicker
                key={isEditar ? (conta?.id ?? "criar") : "criar"}
                name="data_prevista_pagamento_hidden"
                defaultValue={dataPrevista}
                placeholder="Selecione a data (opcional)"
                onDateChange={(d) => {
                  if (!d) {
                    setDataPrevista("");
                    return;
                  }
                  // Formata YYYY-MM-DD sem usar new Date() direto
                  const y = d.getFullYear();
                  const m = String(d.getMonth() + 1).padStart(2, "0");
                  const day = String(d.getDate()).padStart(2, "0");
                  setDataPrevista(`${y}-${m}-${day}`);
                }}
              />
              {fieldErrors.data_prevista_pagamento?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Fornecedor */}
            <div className="space-y-2">
              <Label htmlFor="fornecedor_id">Fornecedor</Label>
              <Select value={fornecedorId} onValueChange={handleFornecedorChange}>
                <SelectTrigger id="fornecedor_id">
                  <SelectValue placeholder="Nenhum (opcional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {props.fornecedores.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.fornecedor_id?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Cliente */}
            <div className="space-y-2">
              <Label htmlFor="cliente_id">Cliente</Label>
              <Select value={clienteId} onValueChange={handleClienteChange}>
                <SelectTrigger id="cliente_id">
                  <SelectValue placeholder="Nenhum (opcional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {props.clientes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldErrors.cliente_id?.map((msg, i) => (
                <p key={i} className="text-xs text-california-red">
                  {msg}
                </p>
              ))}
            </div>

            {/* Job */}
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

            {/* Anexos — só em modo criar */}
            {props.mode === "criar" && (
              <div className="space-y-3">
                <Label className="block">Anexos</Label>

                {anexos.length > 0 && (
                  <ul className="space-y-1.5">
                    {anexos.map((a, idx) => (
                      <li
                        key={idx}
                        className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
                      >
                        <span className="flex items-center gap-2 truncate">
                          <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{a.nome}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            ({(a.tamanho / 1024 / 1024).toFixed(1)} MB)
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoverAnexo(idx)}
                          className="ml-2 shrink-0 rounded p-1 text-muted-foreground hover:text-california-red hover:bg-accent transition-colors"
                          aria-label={`Remover ${a.nome}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {uploadingFile && (
                  <p className="text-xs text-muted-foreground">
                    Enviando &quot;{uploadingFile}&quot;...
                  </p>
                )}

                {uploadError && (
                  <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{uploadError}</span>
                  </div>
                )}

                <div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                    <Paperclip className="h-4 w-4" />
                    Adicionar arquivo
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="sr-only"
                      onChange={handleFileChange}
                      disabled={!!uploadingFile || pending}
                    />
                  </label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Máx. 8 MB por arquivo · 25 MB total
                  </p>
                </div>
              </div>
            )}

            {/* Erro geral */}
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Footer */}
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
              disabled={pending || !!uploadingFile}
              className={submitClass}
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
