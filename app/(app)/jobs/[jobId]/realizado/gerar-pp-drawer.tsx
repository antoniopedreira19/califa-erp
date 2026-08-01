"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { X, Upload, FileText, Image as ImageIcon, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DrawerContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { cn, formatCurrency } from "@/lib/utils";
import {
  PP_ANEXO_MIMETYPES_ACEITOS,
  PP_ANEXO_TAMANHO_MAX_BYTES,
  PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES,
  type PPAnexoMimetype,
} from "@/lib/types";
import {
  reservarPedidoCompra,
  finalizarPedidoCompra,
  abortarReserva,
} from "./actions-pp";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemRealizadoId: string | null;
  jobId: string;
  fornecedores: Array<{ id: string; nome: string; razao_social: string | null }>;
  empresas: Array<{ id: string; razao_social: string; principal: boolean }>;
  defaultEmpresaId: string;
  itemDescricao: string;
  valorRealizado: number;
  quantidadeRealizada: number;
}

interface AnexoLocal {
  anexo_id: string;
  file: File;
  path: string;
  status: "uploading" | "ok" | "erro";
  mensagem?: string;
}

const BUCKET = "pedidos-compra";

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

function iconePorMime(mime: string): typeof FileText {
  if (mime.startsWith("image/")) return ImageIcon;
  return FileText;
}

function defaultPrazoPagamento(): string {
  const d = new Date();
  d.setDate(d.getDate() + 15);
  return d.toISOString().slice(0, 10);
}

function dateToIso(date: Date | null): string {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

export function GerarPPDrawer({
  open,
  onOpenChange,
  itemRealizadoId,
  jobId,
  fornecedores,
  empresas,
  defaultEmpresaId,
  itemDescricao,
  valorRealizado,
  quantidadeRealizada,
}: Props) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const [pending, startTransition] = React.useTransition();

  const [ppId, setPpId] = React.useState<string | null>(null);
  const [uploadPrefix, setUploadPrefix] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  const [fornecedorId, setFornecedorId] = React.useState<string>("");
  const [empresaId, setEmpresaId] = React.useState<string>(defaultEmpresaId);
  const [prazoPagamento, setPrazoPagamento] = React.useState<string>(defaultPrazoPagamento());
  const [servico, setServico] = React.useState<string>(itemDescricao);
  const [quantidade, setQuantidade] = React.useState<string>(String(quantidadeRealizada || 1));
  const [especificacoes, setEspecificacoes] = React.useState<string>("");

  const [anexos, setAnexos] = React.useState<AnexoLocal[]>([]);
  const abortedRef = React.useRef(false);

  // Chave para forcar remontagem do DatePicker ao reabrir o drawer
  const [drawerKey, setDrawerKey] = React.useState(0);

  // Reset ao abrir
  React.useEffect(() => {
    if (!open || !itemRealizadoId) return;
    abortedRef.current = false;
    setErro(null);
    setPpId(null);
    setUploadPrefix(null);
    setFornecedorId("");
    setEmpresaId(defaultEmpresaId);
    setPrazoPagamento(defaultPrazoPagamento());
    setServico(itemDescricao);
    setQuantidade(String(quantidadeRealizada || 1));
    setEspecificacoes("");
    setAnexos([]);
    setDrawerKey((k) => k + 1);

    // Reserva pp_id + upload_prefix
    (async () => {
      const res = await reservarPedidoCompra(itemRealizadoId);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setPpId(res.pp_id);
      setUploadPrefix(res.upload_prefix);
    })();
  }, [open, itemRealizadoId, defaultEmpresaId, itemDescricao, quantidadeRealizada]);

  // Cleanup ao fechar sem finalizar
  React.useEffect(() => {
    return () => {
      if (!ppId || abortedRef.current) return;
      // Best-effort — nao aguarda
      abortarReserva(ppId, jobId).catch(() => {});
    };
  }, [ppId, jobId]);

  async function onFileSelect(files: FileList | null) {
    if (!files || !uploadPrefix) return;

    const somaAtual = anexos.reduce((s, a) => s + a.file.size, 0);
    const novos: AnexoLocal[] = [];

    for (const file of Array.from(files)) {
      // Validacao client
      if (!PP_ANEXO_MIMETYPES_ACEITOS.includes(file.type as PPAnexoMimetype)) {
        setErro(`${file.name}: tipo nao aceito (${file.type}).`);
        continue;
      }
      if (file.size > PP_ANEXO_TAMANHO_MAX_BYTES) {
        setErro(`${file.name}: excede 8 MB.`);
        continue;
      }
      if (somaAtual + file.size > PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES) {
        setErro("Total de anexos excederia 25 MB.");
        break;
      }
      const anexo_id = crypto.randomUUID();
      const path = `${uploadPrefix}${anexo_id}-${sanitizeName(file.name)}`;
      novos.push({ anexo_id, file, path, status: "uploading" });
    }

    if (novos.length === 0) return;

    setAnexos((prev) => [...prev, ...novos]);

    // Upload em paralelo
    await Promise.all(
      novos.map(async (a) => {
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(a.path, a.file, {
            contentType: a.file.type,
            upsert: false,
          });
        setAnexos((prev) =>
          prev.map((p) =>
            p.anexo_id === a.anexo_id
              ? {
                  ...p,
                  status: error ? "erro" : "ok",
                  mensagem: error?.message,
                }
              : p,
          ),
        );
      }),
    );
  }

  async function removerAnexo(anexo_id: string) {
    const alvo = anexos.find((a) => a.anexo_id === anexo_id);
    if (!alvo) return;
    setAnexos((prev) => prev.filter((p) => p.anexo_id !== anexo_id));
    if (alvo.status === "ok") {
      await supabase.storage.from(BUCKET).remove([alvo.path]);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!ppId || !itemRealizadoId) return;
    if (!fornecedorId) {
      setErro("Escolha um fornecedor.");
      return;
    }
    if (!empresaId) {
      setErro("Escolha uma empresa emissora.");
      return;
    }
    if (!prazoPagamento) {
      setErro("Prazo de pagamento e obrigatorio.");
      return;
    }
    if (!servico.trim()) {
      setErro("Servico e obrigatorio.");
      return;
    }
    const qtdNum = Number(quantidade.replace(",", "."));
    if (!Number.isFinite(qtdNum) || qtdNum <= 0) {
      setErro("Quantidade deve ser um numero positivo.");
      return;
    }
    if (anexos.length === 0) {
      setErro("Pelo menos um anexo e obrigatorio.");
      return;
    }
    if (anexos.some((a) => a.status !== "ok")) {
      setErro("Aguarde ou remova anexos com falha de upload.");
      return;
    }

    startTransition(async () => {
      const res = await finalizarPedidoCompra(
        ppId,
        {
          fornecedor_id: fornecedorId,
          empresa_id: empresaId,
          prazo_pagamento: prazoPagamento,
          servico: servico.trim(),
          quantidade: qtdNum,
          especificacoes: especificacoes.trim() || null,
        },
        anexos.map((a) => ({
          anexo_id: a.anexo_id,
          path: a.path,
          nome_original: a.file.name,
          tamanho_bytes: a.file.size,
          mimetype: a.file.type as PPAnexoMimetype,
        })),
        itemRealizadoId,
      );

      if (!res.ok) {
        setErro(res.message);
        return;
      }

      abortedRef.current = true;
      onOpenChange(false);
      router.refresh();
    });
  }

  if (!open || !itemRealizadoId) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-2xl">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle>Gerar Pedido de Compra</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 space-y-4 p-6 overflow-y-auto">
            {erro && (
              <div className="flex items-start justify-between gap-2 rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
                <span>{erro}</span>
                <button type="button" onClick={() => setErro(null)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Item</p>
              <p className="font-medium">{itemDescricao}</p>
              <p className="mt-2 text-xs text-muted-foreground">Valor realizado</p>
              <p className="font-mono font-semibold">{formatCurrency(valorRealizado, "BRL")}</p>
            </div>

            {/* Fornecedor & Empresa */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Fornecedor & Empresa
              </h3>

              <div>
                <label className="text-xs font-medium">Fornecedor *</label>
                <Select value={fornecedorId} onValueChange={setFornecedorId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha o fornecedor" />
                  </SelectTrigger>
                  <SelectContent>
                    {fornecedores.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.razao_social ?? f.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium">Empresa emissora *</label>
                <Select value={empresaId} onValueChange={setEmpresaId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolha a empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    {empresas.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.razao_social}
                        {e.principal ? " (principal)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium">Prazo de pagamento *</label>
                <DatePicker
                  key={`prazo-${drawerKey}`}
                  name="prazo_pagamento"
                  defaultValue={prazoPagamento}
                  onDateChange={(date) => setPrazoPagamento(dateToIso(date))}
                />
              </div>
            </div>

            {/* Servico */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Servico
              </h3>

              <div>
                <label className="text-xs font-medium">Descricao do servico *</label>
                <Input
                  value={servico}
                  onChange={(e) => setServico(e.target.value)}
                  maxLength={500}
                />
              </div>

              <div>
                <label className="text-xs font-medium">Quantidade</label>
                <Input
                  value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value)}
                  className="no-spinner"
                  inputMode="decimal"
                />
              </div>

              <div>
                <label className="text-xs font-medium">Especificacoes (opcional)</label>
                <textarea
                  value={especificacoes}
                  onChange={(e) => setEspecificacoes(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  className="w-full rounded border border-border p-2 text-sm"
                />
              </div>
            </div>

            {/* Anexos */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Anexos * (min 1, max 8MB/arquivo, 25MB total)
              </h3>

              <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-border p-3 text-sm hover:border-california-red/40">
                <Upload className="h-4 w-4" />
                <span>Selecionar arquivos (PDF ou imagem)</span>
                <input
                  type="file"
                  multiple
                  accept={PP_ANEXO_MIMETYPES_ACEITOS.join(",")}
                  onChange={(e) => onFileSelect(e.target.files)}
                  className="hidden"
                />
              </label>

              {anexos.length > 0 && (
                <ul className="space-y-1">
                  {anexos.map((a) => {
                    const Icon = iconePorMime(a.file.type);
                    return (
                      <li
                        key={a.anexo_id}
                        className={cn(
                          "flex items-center gap-2 rounded border p-2 text-xs",
                          a.status === "erro"
                            ? "border-california-red/40 bg-california-red/5"
                            : a.status === "ok"
                              ? "border-emerald-200 bg-emerald-50"
                              : "border-border bg-muted/30",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="flex-1 truncate">{a.file.name}</span>
                        <span className="text-muted-foreground">
                          {(a.file.size / 1024).toFixed(0)} KB
                        </span>
                        <span className="text-muted-foreground">
                          {a.status === "uploading"
                            ? "enviando..."
                            : a.status === "ok"
                              ? "ok"
                              : a.mensagem ?? "falha"}
                        </span>
                        <button
                          type="button"
                          onClick={() => removerAnexo(a.anexo_id)}
                          className="text-california-red hover:opacity-70"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending || !ppId}
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
            >
              {pending ? "Gerando..." : "Gerar PP"}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
