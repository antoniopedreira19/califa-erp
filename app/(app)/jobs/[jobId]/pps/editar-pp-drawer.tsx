"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  X,
  Upload,
  FileText,
  Image as ImageIcon,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DrawerContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { cn, formatCurrency } from "@/lib/utils";
import {
  PP_ANEXO_MIMETYPES_ACEITOS,
  PP_ANEXO_TAMANHO_MAX_BYTES,
  PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES,
  type PPAnexoMimetype,
  type PedidoCompraNaLista,
} from "@/lib/types";
import {
  prefixoAnexosPedidoCompra,
  reenviarPedidoCompra,
} from "../realizado/actions-pp";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pp: PedidoCompraNaLista | null;
  fornecedores: Array<{ id: string; nome: string; razao_social: string | null }>;
  empresas: Array<{ id: string; razao_social: string; principal: boolean }>;
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
  return mime.startsWith("image/") ? ImageIcon : FileText;
}

function dateToIso(date: Date | null): string {
  return date ? format(date, "yyyy-MM-dd") : "";
}

function formatarTamanho(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

export function EditarPPDrawer({
  open,
  onOpenChange,
  pp,
  fornecedores,
  empresas,
  onSuccess,
}: Props) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const [pending, startTransition] = React.useTransition();

  const [uploadPrefix, setUploadPrefix] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  const [fornecedorId, setFornecedorId] = React.useState("");
  const [empresaId, setEmpresaId] = React.useState("");
  const [prazoPagamento, setPrazoPagamento] = React.useState("");
  const [servico, setServico] = React.useState("");
  const [quantidade, setQuantidade] = React.useState("");
  const [especificacoes, setEspecificacoes] = React.useState("");

  const [anexosNovos, setAnexosNovos] = React.useState<AnexoLocal[]>([]);
  /** Anexos já gravados que o GP marcou pra remover. Só somem de fato no submit. */
  const [removidos, setRemovidos] = React.useState<Set<string>>(new Set());

  const [drawerKey, setDrawerKey] = React.useState(0);
  const submittingRef = React.useRef(false);
  const sucessoRef = React.useRef(false);

  const ppId = pp?.id ?? null;

  React.useEffect(() => {
    if (!open || !pp) return;
    sucessoRef.current = false;
    setErro(null);
    setUploadPrefix(null);
    setFornecedorId(pp.fornecedor_id ?? "");
    setEmpresaId(pp.empresa_id);
    setPrazoPagamento(pp.prazo_pagamento);
    setServico(pp.servico);
    setQuantidade(String(pp.quantidade));
    setEspecificacoes(pp.especificacoes ?? "");
    setAnexosNovos([]);
    setRemovidos(new Set());
    setDrawerKey((k) => k + 1);

    (async () => {
      const res = await prefixoAnexosPedidoCompra(pp.id);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setUploadPrefix(res.upload_prefix);
    })();
  }, [open, pp]);

  React.useEffect(() => {
    if (!open && sucessoRef.current) router.refresh();
  }, [open, router]);

  const anexosMantidos = (pp?.anexos ?? []).filter((a) => !removidos.has(a.id));

  async function onFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!uploadPrefix) {
      setErro("Aguarde: a preparação ainda não terminou. Tente de novo em 2 segundos.");
      return;
    }

    let soma =
      anexosMantidos.reduce((s, a) => s + a.arquivo_tamanho_bytes, 0) +
      anexosNovos.reduce((s, a) => s + a.file.size, 0);

    const novos: AnexoLocal[] = [];
    for (const file of Array.from(files)) {
      const anexo_id = crypto.randomUUID();
      const base = { anexo_id, file, path: "" };

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
      if (soma + file.size > PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES) {
        novos.push({
          ...base,
          status: "rejeitado",
          mensagem: "Total de anexos excederia 25 MB.",
        });
        continue;
      }
      soma += file.size;
      novos.push({
        ...base,
        path: `${uploadPrefix}${anexo_id}-${sanitizeName(file.name)}`,
        status: "selecionado",
      });
    }

    setAnexosNovos((prev) => [...prev, ...novos]);

    const aceitos = novos.filter((n) => n.status === "selecionado");
    if (aceitos.length === 0) return;

    setAnexosNovos((prev) =>
      prev.map((p) =>
        aceitos.some((a) => a.anexo_id === p.anexo_id)
          ? { ...p, status: "uploading" }
          : p,
      ),
    );

    await Promise.all(
      aceitos.map(async (a) => {
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(a.path, a.file, { contentType: a.file.type, upsert: false });
        setAnexosNovos((prev) =>
          prev.map((p) =>
            p.anexo_id === a.anexo_id
              ? { ...p, status: error ? "erro" : "ok", mensagem: error?.message }
              : p,
          ),
        );
      }),
    );
  }

  async function removerAnexoNovo(anexo_id: string) {
    const alvo = anexosNovos.find((a) => a.anexo_id === anexo_id);
    if (!alvo) return;
    setAnexosNovos((prev) => prev.filter((p) => p.anexo_id !== anexo_id));
    if (alvo.status === "ok") {
      await supabase.storage.from(BUCKET).remove([alvo.path]);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!ppId) return;

    if (!fornecedorId) return setErro("Escolha um fornecedor.");
    if (!empresaId) return setErro("Escolha uma empresa emissora.");
    if (!prazoPagamento) return setErro("Prazo de pagamento é obrigatório.");
    if (!servico.trim()) return setErro("Descrição do serviço é obrigatória.");

    const qtdNum = Number(quantidade.replace(",", "."));
    if (!Number.isFinite(qtdNum) || qtdNum <= 0) {
      return setErro("Quantidade deve ser um número positivo.");
    }

    if (anexosNovos.some((a) => a.status === "uploading" || a.status === "selecionado")) {
      return setErro("Aguarde os uploads terminarem antes de reenviar.");
    }

    const novosOk = anexosNovos.filter((a) => a.status === "ok");
    if (anexosMantidos.length + novosOk.length === 0) {
      return setErro("Pelo menos um anexo é obrigatório.");
    }

    if (submittingRef.current) return;
    submittingRef.current = true;

    startTransition(async () => {
      try {
        const res = await reenviarPedidoCompra(
          ppId,
          {
            // PP editada via este drawer é sempre não-verba: o formulário
            // de edição não suporta troca de modo ainda (Task futura).
            verba_producao: false as const,
            fornecedor_id: fornecedorId,
            responsavel_verba_id: null,
            empresa_id: empresaId,
            prazo_pagamento: prazoPagamento,
            servico: servico.trim(),
            quantidade: qtdNum,
            especificacoes: especificacoes.trim() || null,
          },
          novosOk.map((a) => ({
            anexo_id: a.anexo_id,
            path: a.path,
            nome_original: a.file.name,
            tamanho_bytes: a.file.size,
            mimetype: a.file.type as PPAnexoMimetype,
          })),
          Array.from(removidos),
        );

        if (!res.ok) {
          setErro(res.message);
          return;
        }

        sucessoRef.current = true;
        onSuccess?.(pp?.codigo ?? "");
        onOpenChange(false);
      } finally {
        submittingRef.current = false;
      }
    });
  }

  if (!open || !pp) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <DialogTitle>Editar Pedido de Produção · {pp.codigo}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {erro && (
              <div className="flex items-start justify-between gap-2 rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
                <span>{erro}</span>
                <button type="button" onClick={() => setErro(null)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {pp.motivo_rejeicao && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                <p className="text-[12.5px] leading-relaxed text-red-700">
                  <strong>{pp.codigo} rejeitada pelo financeiro</strong> ·{" "}
                  {pp.motivo_rejeicao}
                </p>
              </div>
            )}

            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Item</p>
              <p className="font-medium">
                {pp.servico}
                {pp.grupo_nome ? ` · ${pp.grupo_nome}` : ""}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">Valor realizado</p>
              <p className="font-mono font-semibold">
                {formatCurrency(pp.valor, "BRL")}
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Fornecedor &amp; Empresa
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

            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Anexos * (mín. 1, máx. 8MB por arquivo, 25MB total)
              </h3>

              {uploadPrefix ? (
                <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-border p-3 text-sm hover:border-california-red/40">
                  <Upload className="h-4 w-4 text-muted-foreground" />
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
                <div className="rounded border border-dashed border-border p-3 text-sm text-muted-foreground">
                  Preparando…
                </div>
              )}

              {anexosMantidos.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 rounded border border-border bg-white px-3 py-2 text-xs"
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1 truncate">{a.arquivo_nome_original}</span>
                  <span className="text-muted-foreground">
                    {formatarTamanho(a.arquivo_tamanho_bytes)}
                  </span>
                  <button
                    type="button"
                    title="Remover anexo"
                    onClick={() =>
                      setRemovidos((prev) => new Set(prev).add(a.id))
                    }
                    className="text-california-red hover:opacity-70"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              {anexosNovos.map((a) => {
                const Icone = iconePorMime(a.file.type);
                return (
                  <div
                    key={a.anexo_id}
                    className={cn(
                      "flex items-center gap-2 rounded border px-3 py-2 text-xs",
                      a.status === "ok"
                        ? "border-emerald-200 bg-emerald-50"
                        : a.status === "erro" || a.status === "rejeitado"
                          ? "border-california-red/40 bg-california-red/5"
                          : "border-border bg-white",
                    )}
                  >
                    <Icone className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate">{a.file.name}</span>
                    <span className="text-muted-foreground">
                      {formatarTamanho(a.file.size)}
                    </span>
                    <span
                      className={cn(
                        "font-semibold",
                        a.status === "ok"
                          ? "text-emerald-700"
                          : a.status === "erro" || a.status === "rejeitado"
                            ? "text-california-red"
                            : "text-muted-foreground",
                      )}
                    >
                      {a.status === "ok"
                        ? "ok"
                        : a.status === "uploading"
                          ? "enviando…"
                          : a.status === "selecionado"
                            ? "aguardando"
                            : (a.mensagem ?? "erro")}
                    </span>
                    <button
                      type="button"
                      title="Remover anexo"
                      onClick={() => removerAnexoNovo(a.anexo_id)}
                      className="text-california-red hover:opacity-70"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="rounded-lg border border-border bg-white px-4 py-2 text-[13px] font-semibold hover:bg-muted disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-california-red px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Reenviando…" : "Salvar e reenviar para avaliação"}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
