"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Paperclip, Plus, X } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { criarDesembolso } from "./actions";
import type { RateioLinhaInput } from "@/lib/types";
import {
  FormaPagamentoField,
  type CartaoOption,
  type FormaPagamentoValue,
} from "@/components/financeiro/forma-pagamento-field";
import { RateioRegionalEditor } from "@/app/(app)/financeiro/contas-a-pagar/rateio-regional-editor";
import {
  parcelasParaFatura,
  formatarISO,
} from "@/lib/cartoes/proxima-fatura";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const ANEXO_TAMANHO_MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ANEXOS_TAMANHO_TOTAL_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

// ---------------------------------------------------------------------------
// Tipos locais
// ---------------------------------------------------------------------------

interface ParcelaLocal {
  numero: number;
  data_vencimento: string;
  valor: string;
}

interface AnexoPendente {
  path: string;
  nome: string;
  tamanho: number;
  mimetype: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  cartoes: CartaoOption[];
  empresas: Array<{ id: string; nome: string }>;
  fornecedores: Array<{ id: string; nome: string }>;
  clientes: Array<{ id: string; nome: string }>;
  jobs: Array<{ id: string; codigo: string; nome: string }>;
  regionais: Array<{ id: string; nome: string; ativo: boolean }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseNumero(bruto: string): number {
  const s = bruto.trim();
  if (s === "") return 0;
  const normalizado = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : 0;
}

function dividirEmParcelas(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor((total * 100) / n) / 100;
  const resto = Math.round((total - base * n) * 100) / 100;
  return Array.from({ length: n }, (_, i) =>
    i === n - 1 ? base + resto : base,
  );
}

function proximoVencimento(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const mesAlvo = m + 1; // ja 1-indexed; +1 mês
  const anoAlvo = mesAlvo > 12 ? y + 1 : y;
  const mesReal = mesAlvo > 12 ? 1 : mesAlvo;
  const ultimoDia = new Date(anoAlvo, mesReal, 0).getDate();
  const dia = Math.min(d, ultimoDia);
  return `${anoAlvo}-${String(mesReal).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function dateToISO(date: Date | null): string {
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function defaultDataPrevista(): string {
  const d = new Date();
  d.setDate(d.getDate() + 15);
  return dateToISO(d);
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function DesembolsoDrawer({
  open,
  onOpenChange,
  tenantId,
  cartoes,
  empresas,
  fornecedores,
  clientes,
  jobs,
  regionais,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [successMsg, setSuccessMsg] = React.useState<string | null>(null);

  // Chave para forçar remontagem dos DatePickers ao reabrir
  const [drawerKey, setDrawerKey] = React.useState(0);

  // Campos do formulário
  const [empresaId, setEmpresaId] = React.useState("");
  const [descricao, setDescricao] = React.useState("");
  const [formaPagamento, setFormaPagamento] = React.useState<FormaPagamentoValue>({
    forma_pagamento: null,
    cartao_credito_id: null,
  });
  const [fornecedorId, setFornecedorId] = React.useState<string>("__none__");
  const [clienteId, setClienteId] = React.useState<string>("__none__");
  const [jobId, setJobId] = React.useState<string>("__none__");
  const [valor, setValor] = React.useState("");
  const [parcelas, setParcelas] = React.useState<ParcelaLocal[]>([]);
  const [numParcelas, setNumParcelas] = React.useState("1");
  const [rateio, setRateio] = React.useState<RateioLinhaInput[]>([]);
  const [dataPrevista, setDataPrevista] = React.useState(defaultDataPrevista());
  const [anexos, setAnexos] = React.useState<AnexoPendente[]>([]);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Reset ao abrir
  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setSuccessMsg(null);
    setEmpresaId("");
    setDescricao("");
    setFormaPagamento({ forma_pagamento: null, cartao_credito_id: null });
    setFornecedorId("__none__");
    setClienteId("__none__");
    setJobId("__none__");
    setValor("");
    setParcelas([]);
    setNumParcelas("1");
    setRateio([]);
    setDataPrevista(defaultDataPrevista());
    setAnexos([]);
    setUploadError(null);
    setDrawerKey((k) => k + 1);
  }, [open]);

  // ---------------------------------------------------------------------------
  // Derivados
  // ---------------------------------------------------------------------------

  const isCartao =
    formaPagamento.forma_pagamento === "cartao_credito" &&
    !!formaPagamento.cartao_credito_id;

  const valorNum = parseNumero(valor);
  const numParcelasNum = Math.max(1, Math.min(36, Math.floor(Number(numParcelas) || 1)));

  const somaRateio = rateio.reduce((s, l) => s + l.percentual, 0);
  const rateioValido = rateio.length > 0 && Math.abs(somaRateio - 100) < 0.01;
  const rateioTemInativa = rateio.some(
    (r) => regionais.find((rr) => rr.id === r.regional_id)?.ativo === false,
  );

  // Soma parcelas editadas
  const somaParcelas = parcelas.reduce((s, p) => s + parseNumero(p.valor), 0);
  const parcelasOk =
    numParcelasNum === 1 ||
    (parcelas.length === numParcelasNum && Math.abs(somaParcelas - valorNum) <= 0.01);

  // ---------------------------------------------------------------------------
  // Lógica de parcelas
  // ---------------------------------------------------------------------------

  function montarParcelasEscada(
    n: number,
    primeiraData: string,
    total: number,
    atuais: ParcelaLocal[],
  ): ParcelaLocal[] {
    const valores = dividirEmParcelas(total, n);
    const datas: string[] = [];
    let corrente = primeiraData;
    for (let i = 0; i < n; i++) {
      datas.push(i === 0 ? primeiraData : (atuais[i]?.data_vencimento ?? corrente));
      corrente = proximoVencimento(datas[i]);
    }
    return datas.map((data, i) => ({
      numero: i + 1,
      data_vencimento: data,
      valor: valores[i].toFixed(2),
    }));
  }

  function montarParcelasCartao(
    cartao: CartaoOption,
    n: number,
    total: number,
  ): ParcelaLocal[] {
    const datas = parcelasParaFatura(cartao.dia_vencimento_fatura, new Date(), n);
    const valores = dividirEmParcelas(total, n);
    return datas.map((d, i) => ({
      numero: i + 1,
      data_vencimento: formatarISO(d),
      valor: valores[i].toFixed(2),
    }));
  }

  function handleNumParcelasChange(bruto: string) {
    setNumParcelas(bruto);
    const n = Math.max(1, Math.min(36, Math.floor(Number(bruto) || 1)));
    if (n <= 1) {
      setParcelas([]);
      return;
    }
    if (
      formaPagamento.forma_pagamento === "cartao_credito" &&
      formaPagamento.cartao_credito_id
    ) {
      const cartao = cartoes.find(
        (c) => c.id === formaPagamento.cartao_credito_id,
      );
      if (cartao) {
        setParcelas(montarParcelasCartao(cartao, n, valorNum));
        return;
      }
    }
    setParcelas(montarParcelasEscada(n, dataPrevista, valorNum, parcelas));
  }

  function handleDataPrevistaChange(date: Date | null) {
    const iso = dateToISO(date);
    setDataPrevista(iso);
    if (parcelas.length > 1) {
      setParcelas(montarParcelasEscada(parcelas.length, iso, valorNum, []));
    }
  }

  // ---------------------------------------------------------------------------
  // Handler FormaPagamentoField
  // ---------------------------------------------------------------------------

  function handleFormaPagamentoChange(
    v: FormaPagamentoValue,
    opts?: { dataPagamentoSugerida?: string },
  ) {
    setFormaPagamento(v);

    if (v.forma_pagamento !== "cartao_credito" || !v.cartao_credito_id) return;

    const cartao = cartoes.find((c) => c.id === v.cartao_credito_id);
    if (!cartao) return;

    const n = numParcelasNum;
    if (n > 1) {
      // Recalcula datas das parcelas com a fatura do cartão
      setParcelas(montarParcelasCartao(cartao, n, valorNum));
    } else if (opts?.dataPagamentoSugerida) {
      setDataPrevista(opts.dataPagamentoSugerida);
      setDrawerKey((k) => k + 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Upload de anexos
  // ---------------------------------------------------------------------------

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setUploadError(null);

    let totalAcumulado = anexos.reduce((acc, a) => acc + a.tamanho, 0);
    const novos: AnexoPendente[] = [];

    for (const file of files) {
      if (file.size > ANEXO_TAMANHO_MAX_BYTES) {
        setUploadError(`"${file.name}" excede o limite de 8 MB por arquivo.`);
        continue;
      }
      if (totalAcumulado + file.size > ANEXOS_TAMANHO_TOTAL_MAX_BYTES) {
        setUploadError(
          "Total de anexos ultrapassa 25 MB. Remova algum antes de adicionar mais.",
        );
        break;
      }

      const uid =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      const path = `${tenantId}/${uid}-${file.name}`;

      setUploadingFile(file.name);
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from("desembolsos")
        .upload(path, file, { upsert: false });
      setUploadingFile(null);

      if (upErr) {
        setUploadError(`Falha ao enviar "${file.name}": ${upErr.message}`);
        continue;
      }

      totalAcumulado += file.size;
      novos.push({
        path,
        nome: file.name,
        tamanho: file.size,
        mimetype: file.type,
      });
    }

    if (novos.length > 0) {
      setAnexos((prev) => [...prev, ...novos]);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleRemoverAnexo(idx: number) {
    const anexo = anexos[idx];
    if (!anexo) return;
    const supabase = createClient();
    await supabase.storage.from("desembolsos").remove([anexo.path]);
    setAnexos((prev) => prev.filter((_, i) => i !== idx));
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  function parcelasParaEnvio(): Array<{
    numero: number;
    data_vencimento: string;
    valor: string;
  }> {
    if (numParcelasNum <= 1) {
      return [{ numero: 1, data_vencimento: dataPrevista, valor: valor }];
    }
    return parcelas.map((p) => ({
      numero: p.numero,
      data_vencimento: p.data_vencimento,
      valor: p.valor,
    }));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!empresaId) {
      setError("Selecione a empresa.");
      return;
    }
    if (!formaPagamento.forma_pagamento) {
      setError("Selecione a forma de pagamento.");
      return;
    }
    if (!rateioValido) {
      setError("O rateio de regional deve somar exatamente 100%.");
      return;
    }
    if (rateioTemInativa) {
      setError("Substitua a regional inativa antes de salvar.");
      return;
    }
    if (numParcelasNum > 1 && !parcelasOk) {
      setError("A soma das parcelas deve bater com o valor total.");
      return;
    }

    const input = {
      empresa_id: empresaId,
      descricao: descricao.trim(),
      valor,
      forma_pagamento: formaPagamento.forma_pagamento,
      cartao_credito_id: formaPagamento.cartao_credito_id,
      fornecedor_id: fornecedorId === "__none__" ? null : fornecedorId,
      cliente_id: clienteId === "__none__" ? null : clienteId,
      job_id: jobId === "__none__" ? null : jobId,
      data_prevista_pagamento: isCartao ? null : dataPrevista || null,
      rateio,
      parcelas: parcelasParaEnvio(),
      anexos,
    };

    startTransition(async () => {
      const res = await criarDesembolso(input);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setSuccessMsg("Desembolso lançado com sucesso! Aguarde a aprovação do financeiro.");
      router.refresh();
      // Fecha após breve pausa para o usuário ver a mensagem
      setTimeout(() => onOpenChange(false), 1800);
    });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>Novo desembolso</DialogTitle>
          <DialogDescription>
            Registre uma despesa para aprovação do financeiro. Após aprovada, vira título a pagar.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col flex-1 overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* ── 1. Empresa ───────────────────────────────────────── */}
            <div className="space-y-2">
              <Label htmlFor="empresa_id">Empresa *</Label>
              <Select
                value={empresaId}
                onValueChange={setEmpresaId}
                required
              >
                <SelectTrigger id="empresa_id">
                  <SelectValue placeholder="Selecione a empresa" />
                </SelectTrigger>
                <SelectContent>
                  {empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* ── 2. Descrição ─────────────────────────────────────── */}
            <div className="space-y-2">
              <Label htmlFor="descricao">Descrição *</Label>
              <Textarea
                id="descricao"
                rows={3}
                maxLength={500}
                required
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Descreva o desembolso..."
              />
              <p className="text-xs text-muted-foreground text-right">
                {descricao.length}/500
              </p>
            </div>

            {/* ── 3. Forma de pagamento ────────────────────────────── */}
            <FormaPagamentoField
              cartoes={cartoes}
              value={formaPagamento}
              onChange={handleFormaPagamentoChange}
              disabled={pending}
              obrigatorio
            />

            {/* ── 4. Fornecedor / Cliente / Job ────────────────────── */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Fornecedor</Label>
                <Combobox
                  value={fornecedorId}
                  onChange={(v) => setFornecedorId(v ?? "__none__")}
                  placeholder="Nenhum (opcional)"
                  items={[
                    { value: "__none__", label: "Nenhum" },
                    ...fornecedores.map((f) => ({ value: f.id, label: f.nome })),
                  ]}
                />
              </div>
              <div className="space-y-2">
                <Label>Cliente</Label>
                <Combobox
                  value={clienteId}
                  onChange={(v) => setClienteId(v ?? "__none__")}
                  placeholder="Nenhum (opcional)"
                  items={[
                    { value: "__none__", label: "Nenhum" },
                    ...clientes.map((c) => ({ value: c.id, label: c.nome })),
                  ]}
                />
              </div>
              <div className="space-y-2">
                <Label>Job</Label>
                <Combobox
                  value={jobId}
                  onChange={(v) => setJobId(v ?? "__none__")}
                  placeholder="Nenhum (opcional)"
                  items={[
                    { value: "__none__", label: "Nenhum" },
                    ...jobs.map((j) => ({
                      value: j.id,
                      label: `${j.codigo} — ${j.nome}`,
                    })),
                  ]}
                />
              </div>
            </div>

            {/* ── 5. Valor ─────────────────────────────────────────── */}
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
            </div>

            {/* ── 6. Parcelas ──────────────────────────────────────── */}
            <div className="space-y-3">
              <Label htmlFor="num_parcelas">Quantidade de parcelas</Label>
              <Input
                id="num_parcelas"
                type="number"
                min="1"
                max="36"
                step="1"
                value={numParcelas}
                onChange={(e) => handleNumParcelasChange(e.target.value)}
                className="w-24 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />

              {parcelas.length > 1 && (
                <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                  <p className="text-[11px] text-muted-foreground">
                    {isCartao
                      ? "Datas auto-preenchidas pela fatura do cartão. Valores divididos igualmente — ambos editáveis."
                      : "Vencimentos sugeridos de mês em mês e valores divididos igualmente — ambos editáveis."}
                  </p>
                  {parcelas.map((p, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[28px_1fr_1fr] items-center gap-2"
                    >
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {i + 1}/{parcelas.length}
                      </span>
                      <DatePicker
                        key={`parcela-${drawerKey}-${i}`}
                        name={`parcela_${i}_vencimento`}
                        defaultValue={p.data_vencimento}
                        disabled={i === 0 && !isCartao}
                        onDateChange={(date) =>
                          setParcelas((prev) =>
                            prev.map((q, j) =>
                              j === i
                                ? { ...q, data_vencimento: dateToISO(date) }
                                : q,
                            ),
                          )
                        }
                      />
                      <Input
                        value={p.valor}
                        onChange={(e) =>
                          setParcelas((prev) =>
                            prev.map((q, j) =>
                              j === i ? { ...q, valor: e.target.value } : q,
                            ),
                          )
                        }
                        className="no-spinner text-right font-mono"
                        inputMode="decimal"
                      />
                    </div>
                  ))}

                  {/* Soma das parcelas */}
                  <div className="flex items-center justify-between border-t border-border pt-2 text-[11px]">
                    <span className="text-muted-foreground">Soma das parcelas</span>
                    <span
                      className={
                        parcelasOk
                          ? "font-mono font-semibold text-emerald-700"
                          : "font-mono font-semibold text-california-red"
                      }
                    >
                      {somaParcelas.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}{" "}
                      /{" "}
                      {valorNum.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* ── 7. Rateio regional ───────────────────────────────── */}
            <RateioRegionalEditor
              linhas={rateio}
              onChange={setRateio}
              regionais={regionais}
              disabled={pending}
            />

            {/* ── 8. Data prevista ─────────────────────────────────── */}
            <div className="space-y-2">
              <Label>Data prevista de pagamento</Label>
              {isCartao ? (
                <p className="text-sm text-muted-foreground rounded-lg border border-border bg-muted/30 px-3 py-2">
                  Auto: definida pela fatura do cartão (não editável para cartão).
                </p>
              ) : (
                <DatePicker
                  key={`data-prevista-${drawerKey}`}
                  name="data_prevista_pagamento"
                  defaultValue={dataPrevista}
                  placeholder="Selecione a data (opcional)"
                  onDateChange={handleDataPrevistaChange}
                />
              )}
            </div>

            {/* ── 9. Anexos ────────────────────────────────────────── */}
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
                  <Plus className="h-4 w-4" />
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

            {/* Mensagem de sucesso */}
            {successMsg && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
              >
                <span>{successMsg}</span>
              </div>
            )}

            {/* Erro geral */}
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border p-4">
            {rateioTemInativa && (
              <p className="mb-2 text-xs text-amber-700 text-right">
                Substitua a regional inativa antes de salvar.
              </p>
            )}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={pending}
                className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={
                  pending ||
                  !!uploadingFile ||
                  !rateioValido ||
                  rateioTemInativa
                }
                className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors"
              >
                {pending ? "Salvando..." : "Lançar desembolso"}
              </button>
            </div>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
