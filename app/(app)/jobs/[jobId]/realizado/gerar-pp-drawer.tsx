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
import { format } from "date-fns";
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
  onSuccess?: (codigo: string) => void;
}

interface AnexoLocal {
  anexo_id: string;
  file: File;
  path: string;
  status: "selecionado" | "uploading" | "ok" | "erro" | "rejeitado";
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
  return format(d, "yyyy-MM-dd");
}

function dateToIso(date: Date | null): string {
  return date ? format(date, "yyyy-MM-dd") : "";
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
  onSuccess,
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
  // Lock sincrono contra double-submit: `pending` do useTransition ativa
  // 1 render depois, então dois cliques rápidos passam pelo disabled=pending.
  // Ref é setado ANTES do await → segundo click no mesmo tick é bloqueado.
  const submittingRef = React.useRef(false);

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
      // TEMPORÁRIO — remover após diagnóstico
      console.log("[pp.drawer.reservar.chamando]", { itemRealizadoId });
      const res = await reservarPedidoCompra(itemRealizadoId);
      // TEMPORÁRIO — remover após diagnóstico
      console.log("[pp.drawer.reservar.retornou]", res);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setPpId(res.pp_id);
      setUploadPrefix(res.upload_prefix);
    })();
  }, [open, itemRealizadoId, defaultEmpresaId, itemDescricao, quantidadeRealizada]);

  // DESABILITADO — o cleanup automatico estava disparando entre upload e
  // finalizar (quando ppId mudava por qualquer re-render), apagando os
  // anexos que o user acabou de subir. Arquivos orfaos ficam no bucket ate
  // cancelamento explicito. Aceitavel no MVP; job de limpeza noturno futuro.
  //
  // React.useEffect(() => {
  //   return () => {
  //     if (!ppId || abortedRef.current) return;
  //     abortarReserva(ppId, jobId).catch(() => {});
  //   };
  // }, [ppId, jobId]);

  async function onFileSelect(files: FileList | null) {
    // TEMPORÁRIO — remover após diagnóstico
    console.log("[pp.drawer.onFileSelect.entrou]", {
      filesCount: files?.length ?? 0,
      uploadPrefix,
      ppId,
    });

    if (!files || files.length === 0) {
      console.log("[pp.drawer.onFileSelect.saiu]", { motivo: "sem arquivos" });
      return;
    }

    if (!uploadPrefix) {
      setErro(
        "Aguarde: a preparação da PP ainda não terminou. Tente novamente em 2 segundos.",
      );
      console.log("[pp.drawer.onFileSelect.saiu]", {
        motivo: "uploadPrefix null",
      });
      return;
    }

    const somaAtual = anexos.reduce((s, a) => s + a.file.size, 0);
    let somaAcumulada = somaAtual;
    // Cada arquivo vira uma linha imediatamente — mesmo rejeitados.
    // User sempre vê feedback do que aconteceu com cada arquivo escolhido.
    const novos: AnexoLocal[] = [];

    for (const file of Array.from(files)) {
      const anexo_id = crypto.randomUUID();
      const base = { anexo_id, file, path: "" };

      // TEMPORÁRIO — remover após diagnóstico
      console.log("[pp.drawer.file]", {
        name: file.name,
        type: file.type,
        size: file.size,
        aceitoMime: PP_ANEXO_MIMETYPES_ACEITOS.includes(
          file.type as PPAnexoMimetype,
        ),
      });

      if (!PP_ANEXO_MIMETYPES_ACEITOS.includes(file.type as PPAnexoMimetype)) {
        novos.push({
          ...base,
          status: "rejeitado",
          mensagem: `Tipo não aceito (${file.type || "sem mimetype"}).`,
        });
        continue;
      }
      if (file.size > PP_ANEXO_TAMANHO_MAX_BYTES) {
        novos.push({
          ...base,
          status: "rejeitado",
          mensagem: `Excede 8 MB (${(file.size / 1024 / 1024).toFixed(1)} MB).`,
        });
        continue;
      }
      if (somaAcumulada + file.size > PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES) {
        novos.push({
          ...base,
          status: "rejeitado",
          mensagem: "Total de anexos excederia 25 MB.",
        });
        continue;
      }
      somaAcumulada += file.size;
      const path = `${uploadPrefix}${anexo_id}-${sanitizeName(file.name)}`;
      novos.push({ ...base, path, status: "selecionado" });
    }

    // Mostra TODOS (aceitos + rejeitados) na lista imediatamente
    setAnexos((prev) => [...prev, ...novos]);

    const aceitos = novos.filter((n) => n.status === "selecionado");
    if (aceitos.length === 0) {
      console.log("[pp.drawer.onFileSelect.saiu]", {
        motivo: "todos rejeitados",
      });
      return;
    }

    // Marca aceitos como "uploading" e sobe
    setAnexos((prev) =>
      prev.map((p) =>
        aceitos.some((a) => a.anexo_id === p.anexo_id)
          ? { ...p, status: "uploading" }
          : p,
      ),
    );

    await Promise.all(
      aceitos.map(async (a) => {
        // TEMPORÁRIO — remover após diagnóstico
        console.log("[pp.drawer.upload.iniciando]", { path: a.path });
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(a.path, a.file, {
            contentType: a.file.type,
            upsert: false,
          });
        // TEMPORÁRIO — remover após diagnóstico
        console.log("[pp.drawer.upload.resposta]", {
          path: a.path,
          error: error?.message ?? null,
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
    // Só remove do bucket se o upload chegou lá — "selecionado" e "rejeitado"
    // ainda não subiram nada; "uploading" tá em voo e pode não ter finalizado.
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
      setErro("Prazo de pagamento é obrigatório.");
      return;
    }
    if (!servico.trim()) {
      setErro("Serviço é obrigatório.");
      return;
    }
    const qtdNum = Number(quantidade.replace(",", "."));
    if (!Number.isFinite(qtdNum) || qtdNum <= 0) {
      setErro("Quantidade deve ser um número positivo.");
      return;
    }
    const anexosOk = anexos.filter((a) => a.status === "ok");
    if (anexosOk.length === 0) {
      setErro("Pelo menos um anexo com upload concluído é obrigatório.");
      return;
    }
    if (anexos.some((a) => a.status === "uploading" || a.status === "selecionado")) {
      setErro("Aguarde os uploads terminarem antes de gerar a PP.");
      return;
    }

    // Lock síncrono contra double-submit (pending do useTransition ativa 1
    // render depois — clique duplo rápido passa pelo disabled=pending).
    if (submittingRef.current) return;
    submittingRef.current = true;

    startTransition(async () => {
      try {
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
          anexosOk.map((a) => ({
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

        // Sucesso: fecha drawer + toast + refresh imediato
        // router.refresh() PRECISA ficar fora do startTransition atual pra
        // ser priorizado corretamente pelo React scheduler — dentro dele o
        // re-render dos server components fica low-priority e demora.
        abortedRef.current = true;
        onSuccess?.(res.codigo);
        onOpenChange(false);
      } finally {
        submittingRef.current = false;
      }
    });
  }

  // Detecta sucesso e dispara refresh FORA do startTransition principal
  // (via ref pra evitar dep instável no useEffect).
  React.useEffect(() => {
    if (!open) {
      // Se drawer fechou por sucesso (abortedRef=true), refresh a página
      // pra pegar a nova PP e os ícones Ver/Cancelar aparecerem na trilha.
      if (abortedRef.current) {
        router.refresh();
      }
    }
  }, [open, router]);

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
                Serviço
              </h3>

              <div>
                <label className="text-xs font-medium">Descrição do serviço *</label>
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
                <label className="text-xs font-medium">Especificações (opcional)</label>
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

              {uploadPrefix ? (
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
              ) : (
                <div className="flex items-center gap-2 rounded border border-dashed border-border bg-muted/40 p-3 text-sm text-muted-foreground cursor-not-allowed">
                  <Upload className="h-4 w-4" />
                  <span>Preparando... aguarde um instante</span>
                </div>
              )}

              {anexos.length > 0 && (
                <ul className="space-y-1">
                  {anexos.map((a) => {
                    const Icon = iconePorMime(a.file.type);
                    const cor =
                      a.status === "erro" || a.status === "rejeitado"
                        ? "border-california-red/40 bg-california-red/5"
                        : a.status === "ok"
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-border bg-muted/30";
                    const label =
                      a.status === "selecionado"
                        ? "aguardando..."
                        : a.status === "uploading"
                          ? "enviando..."
                          : a.status === "ok"
                            ? "ok"
                            : a.status === "rejeitado"
                              ? `rejeitado: ${a.mensagem ?? "motivo desconhecido"}`
                              : (a.mensagem ?? "falha");
                    return (
                      <li
                        key={a.anexo_id}
                        className={cn(
                          "flex items-center gap-2 rounded border p-2 text-xs",
                          cor,
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="flex-1 truncate">{a.file.name}</span>
                        <span className="text-muted-foreground">
                          {(a.file.size / 1024).toFixed(0)} KB
                        </span>
                        <span
                          className={cn(
                            "text-xs",
                            a.status === "erro" || a.status === "rejeitado"
                              ? "text-california-red"
                              : "text-muted-foreground",
                          )}
                        >
                          {label}
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
              disabled={pending || !ppId || anexos.some((a) => a.status === "uploading")}
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
