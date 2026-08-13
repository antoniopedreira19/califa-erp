"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { format, addDays } from "date-fns";
import { FileText, Trash2, Plus, AlertTriangle, X, Paperclip, CheckCircle2 } from "lucide-react";
import { Dialog, DrawerContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
import type { ContaBancaria, PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import { emitirFaturamento, uploadNfPdf } from "./actions";
import type { FaturamentoPendenteRow } from "./faturamento-list";

type State =
  | { modo: "origem"; row: FaturamentoPendenteRow }
  | { modo: "avulso" };

interface Props {
  state: State;
  onClose: () => void;
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  empresas: Array<{ id: string; nome: string }>;
  clientes: Array<{ id: string; nome: string }>;
  fornecedores: Array<{ id: string; nome: string }>;
}

type Parcela = { numero: number; valor: string; data_vencimento: string };

export function FaturarDrawer({
  state,
  onClose,
  contas,
  tipos,
  subtipos,
  empresas,
  clientes,
  fornecedores,
}: Props) {
  const router = useRouter();
  const isAvulso = state.modo === "avulso";
  const row = state.modo === "origem" ? state.row : null;
  const saldoSugerido = row?.saldo ?? 0;
  const descricaoInicial = row?.descricao ?? "";
  const empresaInicial = row?.empresa_id ?? "";
  const clienteInicial = row?.cliente_id ?? "";
  const fornecedorInicial = row?.fornecedor_id ?? "";
  const origemTipo: "job" | "bv" | "avulso" = row
    ? row.origem_tipo
    : "avulso";

  const [pending, startTransition] = React.useTransition();
  const [uploading, setUploading] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [anexoPath, setAnexoPath] = React.useState<string | null>(null);
  const [anexoNome, setAnexoNome] = React.useState<string | null>(null);

  const [empresaId, setEmpresaId] = React.useState(empresaInicial);
  const [clienteId, setClienteId] = React.useState(clienteInicial);
  const [fornecedorId, setFornecedorId] = React.useState(fornecedorInicial);
  const [descricao, setDescricao] = React.useState(descricaoInicial);
  const [numeroNf, setNumeroNf] = React.useState("");
  const [serie, setSerie] = React.useState("1");
  const [dataEmissao, setDataEmissao] = React.useState(format(new Date(), "yyyy-MM-dd"));
  const [valorTotal, setValorTotal] = React.useState(saldoSugerido > 0 ? saldoSugerido.toFixed(2) : "");
  const [tipoId, setTipoId] = React.useState("");
  const [subtipoId, setSubtipoId] = React.useState("");
  const [parcelas, setParcelas] = React.useState<Parcela[]>([
    {
      numero: 1,
      valor: saldoSugerido > 0 ? saldoSugerido.toFixed(2) : "",
      data_vencimento: format(addDays(new Date(), 30), "yyyy-MM-dd"),
    },
  ]);

  React.useEffect(() => {
    setSubtipoId("");
  }, [tipoId]);

  const subtiposDoTipo = React.useMemo(
    () => (tipoId ? subtipos.filter((s) => s.tipo_id === tipoId && s.ativo) : []),
    [tipoId, subtipos],
  );
  const tiposAtivos = React.useMemo(() => tipos.filter((t) => t.ativo), [tipos]);

  const valorTotalNum = Number(valorTotal) || 0;
  const somaParcelas = parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const somaOk = Math.abs(somaParcelas - valorTotalNum) < 0.01;
  const divergePrevisto = row ? Math.abs(valorTotalNum - saldoSugerido) > 0.01 : false;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErro(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadNfPdf(fd);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setAnexoPath(res.path);
      setAnexoNome(file.name);
    } finally {
      setUploading(false);
    }
  }

  function aplicarParcelamentoPadrao(n: number) {
    if (!valorTotalNum) return;
    const valorPorParcela = valorTotalNum / n;
    const novas: Parcela[] = Array.from({ length: n }, (_, i) => ({
      numero: i + 1,
      valor: valorPorParcela.toFixed(2),
      data_vencimento: format(addDays(new Date(), 30 * (i + 1)), "yyyy-MM-dd"),
    }));
    // Ajusta última parcela pra bater o total exato
    const somaEfetiva = novas.reduce((s, p) => s + Number(p.valor), 0);
    const diff = valorTotalNum - somaEfetiva;
    if (Math.abs(diff) > 0.001) {
      novas[novas.length - 1].valor = (Number(novas[novas.length - 1].valor) + diff).toFixed(2);
    }
    setParcelas(novas);
  }

  function addParcela() {
    setParcelas((p) => [
      ...p,
      {
        numero: p.length + 1,
        valor: "",
        data_vencimento: format(addDays(new Date(), 30 * (p.length + 1)), "yyyy-MM-dd"),
      },
    ]);
  }

  function removerParcela(i: number) {
    setParcelas((p) => p.filter((_, idx) => idx !== i).map((pp, idx) => ({ ...pp, numero: idx + 1 })));
  }

  function updateParcela(i: number, campo: keyof Parcela, valor: string) {
    setParcelas((p) => p.map((pp, idx) => (idx === i ? { ...pp, [campo]: valor } : pp)));
  }

  function handleConfirm() {
    setErro(null);
    if (!anexoPath) {
      setErro("Anexe o PDF da NF antes de emitir.");
      return;
    }
    if (!somaOk) {
      setErro(`Soma das parcelas (${formatCurrency(somaParcelas, "BRL")}) não bate com valor total (${formatCurrency(valorTotalNum, "BRL")}).`);
      return;
    }

    startTransition(async () => {
      const payload = {
        empresa_id: empresaId,
        origem_tipo: origemTipo,
        origem_id: row?.origem_id ?? null,
        cliente_id: origemTipo === "bv" ? null : clienteId || null,
        fornecedor_id: origemTipo === "bv" ? fornecedorId || null : null,
        numero_nf: numeroNf,
        serie,
        data_emissao: dataEmissao,
        valor_total: valorTotalNum,
        descricao,
        anexo_nf_path: anexoPath,
        plano_conta_tipo_id: tipoId,
        plano_conta_subtipo_id: subtipoId,
        parcelas: parcelas.map((p) => ({
          numero: p.numero,
          valor: Number(p.valor),
          data_vencimento: p.data_vencimento,
        })),
      };
      const res = await emitirFaturamento(payload);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  const tipoContraparte = origemTipo === "bv" ? "Fornecedor" : "Cliente";
  const podeEditarContraparte = isAvulso;

  // Suppress unused variable warning — contas available for future use
  void contas;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent className="sm:max-w-2xl">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-california-red" />
            {isAvulso ? "Novo Faturamento avulso" : `Faturar — ${row?.codigo ?? row?.descricao}`}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 p-6">
          {erro && (
            <div className="flex items-start justify-between gap-2 rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
              <span>{erro}</span>
              <button type="button" onClick={() => setErro(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {divergePrevisto && (
            <div className="flex items-start gap-2 rounded border border-yellow-400 bg-yellow-50 p-3 text-sm text-yellow-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Valor total (R$ {valorTotal}) diverge do saldo previsto (R$ {saldoSugerido.toFixed(2)}). Confirme se está correto.
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="empresa">Empresa emissora *</Label>
              <Select value={empresaId} onValueChange={setEmpresaId} disabled={!isAvulso && origemTipo === "job"}>
                <SelectTrigger id="empresa"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="contraparte">{tipoContraparte} *</Label>
              {origemTipo === "bv" ? (
                <Select value={fornecedorId} onValueChange={setFornecedorId} disabled={!podeEditarContraparte}>
                  <SelectTrigger id="contraparte"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {fornecedores.map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={clienteId} onValueChange={setClienteId} disabled={!podeEditarContraparte}>
                  <SelectTrigger id="contraparte"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {clientes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="descricao">Descrição *</Label>
            <Input
              id="descricao"
              type="text"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={200}
              placeholder="Ex: Serviço prestado ao cliente X em setembro"
            />
          </div>

          {/* Anexo NF */}
          <div className="space-y-2">
            <Label>Anexo NF (PDF) *</Label>

            {anexoNome && (
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                <span className="flex items-center gap-2 truncate">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span className="truncate">{anexoNome}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAnexoPath(null);
                    setAnexoNome(null);
                  }}
                  className="ml-2 shrink-0 rounded p-1 text-muted-foreground hover:text-california-red hover:bg-accent transition-colors"
                  aria-label="Remover anexo"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {!anexoNome && (
              <div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                  <Paperclip className="h-4 w-4" />
                  {uploading ? "Enviando..." : "Anexar PDF"}
                  <input
                    type="file"
                    accept="application/pdf"
                    className="sr-only"
                    onChange={handleFile}
                    disabled={uploading}
                  />
                </label>
                <p className="mt-1 text-xs text-muted-foreground">Apenas PDF · máx. 10 MB</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="numero-nf">Nº NF *</Label>
              <Input
                id="numero-nf"
                type="text"
                value={numeroNf}
                onChange={(e) => setNumeroNf(e.target.value)}
                placeholder="Ex: 12345"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="serie">Série *</Label>
              <Input
                id="serie"
                type="text"
                value={serie}
                onChange={(e) => setSerie(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Emissão *</Label>
              <DatePicker
                name="data_emissao"
                defaultValue={dataEmissao}
                onDateChange={(d) => setDataEmissao(d ? format(d, "yyyy-MM-dd") : "")}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="valor-total">Valor total (R$) *</Label>
              <Input
                id="valor-total"
                type="number"
                step="0.01"
                min="0.01"
                value={valorTotal}
                onChange={(e) => setValorTotal(e.target.value)}
                placeholder="0,00"
                className="font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tipo">Tipo *</Label>
              <Select value={tipoId} onValueChange={setTipoId}>
                <SelectTrigger id="tipo"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {tiposAtivos.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.codigo} · {t.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="subtipo">Subtipo *</Label>
              <Select value={subtipoId} onValueChange={setSubtipoId} disabled={!tipoId}>
                <SelectTrigger id="subtipo"><SelectValue placeholder={tipoId ? "Selecione..." : "Escolha o tipo"} /></SelectTrigger>
                <SelectContent>
                  {subtiposDoTipo.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Parcelas */}
          <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
            <div className="flex items-center justify-between">
              <Label className="uppercase tracking-wider text-xs">Parcelas</Label>
              <div className="flex gap-1">
                {[2, 3, 6].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => aplicarParcelamentoPadrao(n)}
                    className="rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-muted-foreground hover:border-california-red/40 hover:text-foreground transition-colors"
                  >
                    {n}×
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {parcelas.map((p, i) => (
                <div key={i} className="grid grid-cols-[32px_1fr_1fr_36px] items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground text-center">{p.numero}</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={p.valor}
                    onChange={(e) => updateParcela(i, "valor", e.target.value)}
                    placeholder="0,00"
                    className="font-mono h-10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <DatePicker
                    name={`venc-${i}`}
                    defaultValue={p.data_vencimento}
                    onDateChange={(d) => updateParcela(i, "data_vencimento", d ? format(d, "yyyy-MM-dd") : "")}
                  />
                  <button
                    type="button"
                    onClick={() => removerParcela(i)}
                    disabled={parcelas.length === 1}
                    className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-california-red hover:bg-accent transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                    aria-label="Remover parcela"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between border-t border-border/60 pt-3">
              <button
                type="button"
                onClick={addParcela}
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-white px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:border-california-red/40 hover:text-foreground transition-colors"
              >
                <Plus className="h-3 w-3" /> Nova parcela
              </button>
              <p className={`text-xs font-medium ${somaOk ? "text-emerald-700" : "text-california-red"}`}>
                Soma {formatCurrency(somaParcelas, "BRL")} / Total {formatCurrency(valorTotalNum, "BRL")}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending || uploading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
          >
            <FileText className="h-4 w-4" />
            {pending ? "Emitindo..." : "Emitir NF"}
          </button>
        </div>
      </DrawerContent>
    </Dialog>
  );
}
