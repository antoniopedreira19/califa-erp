"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { format, addDays } from "date-fns";
import { FileText, Trash2, Plus, AlertTriangle, X } from "lucide-react";
import { Dialog, DrawerContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Empresa emissora *</label>
              <Select value={empresaId} onValueChange={setEmpresaId} disabled={!isAvulso && origemTipo === "job"}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">{tipoContraparte} *</label>
              {origemTipo === "bv" ? (
                <Select value={fornecedorId} onValueChange={setFornecedorId} disabled={!podeEditarContraparte}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {fornecedores.map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={clienteId} onValueChange={setClienteId} disabled={!podeEditarContraparte}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {clientes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Descrição *</label>
            <input
              type="text"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={200}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
            />
          </div>

          <div className="rounded-lg border border-dashed border-border p-3">
            <label className="text-xs font-medium">Anexo NF (PDF) *</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={handleFile}
              disabled={uploading}
              className="mt-1 block w-full text-xs"
            />
            {uploading && <p className="mt-1 text-xs text-muted-foreground">Enviando...</p>}
            {anexoNome && (
              <p className="mt-1 text-xs text-emerald-700">{anexoNome} enviado.</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Nº NF *</label>
              <input
                type="text"
                value={numeroNf}
                onChange={(e) => setNumeroNf(e.target.value)}
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Série *</label>
              <input
                type="text"
                value={serie}
                onChange={(e) => setSerie(e.target.value)}
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Emissão *</label>
              <DatePicker
                name="data_emissao"
                defaultValue={dataEmissao}
                onDateChange={(d) => setDataEmissao(d ? format(d, "yyyy-MM-dd") : "")}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Valor total *</label>
              <input
                type="number"
                step="0.01"
                value={valorTotal}
                onChange={(e) => setValorTotal(e.target.value)}
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Tipo *</label>
              <Select value={tipoId} onValueChange={setTipoId}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {tiposAtivos.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.codigo} · {t.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Subtipo *</label>
              <Select value={subtipoId} onValueChange={setSubtipoId} disabled={!tipoId}>
                <SelectTrigger><SelectValue placeholder={tipoId ? "Selecione..." : "Escolha o tipo"} /></SelectTrigger>
                <SelectContent>
                  {subtiposDoTipo.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Parcelas</label>
              <div className="flex gap-1">
                <button type="button" onClick={() => aplicarParcelamentoPadrao(2)} className="rounded border border-border px-2 py-1 text-[10px]">2×</button>
                <button type="button" onClick={() => aplicarParcelamentoPadrao(3)} className="rounded border border-border px-2 py-1 text-[10px]">3×</button>
                <button type="button" onClick={() => aplicarParcelamentoPadrao(6)} className="rounded border border-border px-2 py-1 text-[10px]">6×</button>
              </div>
            </div>
            {parcelas.map((p, i) => (
              <div key={i} className="grid grid-cols-[40px_1fr_1fr_40px] items-center gap-2">
                <span className="text-xs text-muted-foreground">{p.numero}</span>
                <input
                  type="number"
                  step="0.01"
                  value={p.valor}
                  onChange={(e) => updateParcela(i, "valor", e.target.value)}
                  placeholder="Valor"
                  className="rounded border border-border px-2 py-1 text-sm font-mono"
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
                  className="text-muted-foreground hover:text-california-red disabled:opacity-30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addParcela}
              className="inline-flex items-center gap-1 rounded border border-dashed border-border px-2 py-1 text-xs"
            >
              <Plus className="h-3 w-3" /> Nova parcela
            </button>
            <p className={`text-xs ${somaOk ? "text-emerald-700" : "text-california-red"}`}>
              Soma: {formatCurrency(somaParcelas, "BRL")} / Total: {formatCurrency(valorTotalNum, "BRL")}
            </p>
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
