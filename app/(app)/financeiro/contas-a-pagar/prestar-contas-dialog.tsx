"use client";

/**
 * Dialog de prestação de contas de uma PP de Verba de Produção.
 *
 * Fluxo:
 * 1. Usuário informa o valor efetivamente gasto.
 * 2. Faz upload de ao menos uma nota fiscal / comprovante.
 * 3. Confirma — chama `fecharPrestacaoVerba` que roda o RPC + insere anexos.
 *
 * Padrão de upload idêntico ao de `gerar-pp-drawer.tsx`:
 * - Upload imediato ao selecionar (não espera o submit).
 * - `removerAnexo` remove do Storage se `status === "ok"`.
 * - Arquivos rejeitados / com erro ficam visíveis na lista com feedback.
 */

import * as React from "react";
import { AlertTriangle, FileText, Image as ImageIcon, Trash2, Upload, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn, formatCurrency } from "@/lib/utils";
import {
  PP_ANEXO_MIMETYPES_ACEITOS,
  PP_ANEXO_TAMANHO_MAX_BYTES,
  PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES,
  type PPAnexoMimetype,
} from "@/lib/types";
import { fecharPrestacaoVerba } from "./prestacao-verba-actions";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export interface PPParaPrestacao {
  id: string;
  codigo: string;
  /** Valor original da PP (teto do gasto). */
  valor: number;
  /** Descrição do serviço da PP. */
  servico: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pp: PPParaPrestacao | null;
  onSuccess?: (prestacao_id: string) => void;
}

interface AnexoLocal {
  anexo_id: string;
  file: File;
  path: string;
  status: "selecionado" | "uploading" | "ok" | "erro" | "rejeitado";
  mensagem?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET = "pedidos-compra";

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

function iconePorMime(mime: string): typeof FileText {
  if (mime.startsWith("image/")) return ImageIcon;
  return FileText;
}

/**
 * Aceita "1.234,56" (pt-BR) e "1234.56" (en-US), como no resto do sistema.
 */
function parseNumeroLocal(bruto: string): number {
  const s = bruto.trim();
  if (s === "") return 0;
  const normalizado = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function PrestarContasDialog({ open, onOpenChange, pp, onSuccess }: Props) {
  const supabase = React.useMemo(() => createClient(), []);
  const [pending, startTransition] = React.useTransition();
  const submittingRef = React.useRef(false);

  const [valorGastoStr, setValorGastoStr] = React.useState<string>("");
  const [anexos, setAnexos] = React.useState<AnexoLocal[]>([]);
  const [erro, setErro] = React.useState<string | null>(null);
  // Prefixo do upload — montado a partir do tenant_id da sessão.
  // Como o tenant_id não está disponível direto no client, usamos o UUID
  // da PP como escopo suficiente: `verba-prestacoes/<pp_id>/`.
  // O server action usa o tenant da sessão ao inserir nos anexos.
  const [uploadPrefix, setUploadPrefix] = React.useState<string>("");

  // Reset ao abrir
  React.useEffect(() => {
    if (!open || !pp) return;
    setValorGastoStr("");
    setAnexos([]);
    setErro(null);
    setUploadPrefix(`verba-prestacoes/${pp.id}/`);
  }, [open, pp]);

  // ── Upload ────────────────────────────────────────────────────────────────

  async function onFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return;

    const somaAtual = anexos.reduce((s, a) => s + a.file.size, 0);
    let somaAcumulada = somaAtual;
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

    // Mostra todos (aceitos + rejeitados) imediatamente
    setAnexos((prev) => [...prev, ...novos]);

    const aceitos = novos.filter((n) => n.status === "selecionado");
    if (aceitos.length === 0) return;

    // Marca aceitos como uploading e sobe
    setAnexos((prev) =>
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
        setAnexos((prev) =>
          prev.map((p) =>
            p.anexo_id === a.anexo_id
              ? { ...p, status: error ? "erro" : "ok", mensagem: error?.message }
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

  // ── Cálculo do resumo ─────────────────────────────────────────────────────

  const valorGasto = parseNumeroLocal(valorGastoStr);
  const valorPP = pp?.valor ?? 0;
  const devolucao = Math.max(0, valorPP - valorGasto);

  // ── Validações client ─────────────────────────────────────────────────────

  const temPending = anexos.some(
    (a) => a.status === "uploading" || a.status === "selecionado",
  );
  const anexosOk = anexos.filter((a) => a.status === "ok");
  const podeSalvar =
    !pending &&
    !temPending &&
    valorGasto > 0 &&
    valorGasto <= valorPP &&
    anexosOk.length >= 1;

  // ── Submit ────────────────────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    if (!pp) return;

    if (valorGasto <= 0) {
      setErro("Informe o valor efetivamente gasto.");
      return;
    }
    if (valorGasto > valorPP) {
      setErro(
        `O valor gasto (${formatCurrency(valorGasto, "BRL")}) não pode superar o valor da PP (${formatCurrency(valorPP, "BRL")}).`,
      );
      return;
    }
    if (anexosOk.length === 0) {
      setErro("Anexe ao menos uma nota fiscal com upload concluído.");
      return;
    }
    if (temPending) {
      setErro("Aguarde os uploads terminarem antes de confirmar.");
      return;
    }

    if (submittingRef.current) return;
    submittingRef.current = true;

    startTransition(async () => {
      try {
        const res = await fecharPrestacaoVerba({
          pp_id: pp.id,
          valor_gasto: valorGasto,
          anexos: anexosOk.map((a) => ({
            path: a.path,
            nome_original: a.file.name,
            tamanho_bytes: a.file.size,
            mimetype: a.file.type,
          })),
        });

        if (!res.ok) {
          setErro(res.message);
          return;
        }

        onSuccess?.(res.prestacao_id);
        onOpenChange(false);
      } finally {
        submittingRef.current = false;
      }
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!pp) return null;

  const labelBotao =
    pending
      ? "Fechando..."
      : devolucao > 0
        ? `Fechar prestação e gerar devolução de ${formatCurrency(devolucao, "BRL")}`
        : "Fechar prestação (sem devolução)";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Prestar contas — {pp.codigo}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Erro */}
          {erro && (
            <div className="flex items-start justify-between gap-2 rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
              <span>{erro}</span>
              <button type="button" onClick={() => setErro(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Serviço */}
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Serviço</p>
            <p className="font-medium">{pp.servico}</p>
          </div>

          {/* Valor gasto */}
          <div className="space-y-1">
            <label className="text-xs font-semibold">
              Valor efetivamente gasto (R$){" "}
              <span className="text-california-red">*</span>
            </label>
            <Input
              value={valorGastoStr}
              onChange={(e) => setValorGastoStr(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              className={cn(
                "no-spinner text-right font-mono",
                valorGasto > valorPP && "border-california-red text-california-red",
              )}
            />
            {valorGasto > valorPP && (
              <p className="text-xs text-california-red">
                Valor supera o da PP ({formatCurrency(valorPP, "BRL")}).
              </p>
            )}
          </div>

          {/* Resumo em tempo real */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Valor da PP
              </p>
              <p className="mt-1 font-mono font-semibold">
                {formatCurrency(valorPP, "BRL")}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Gasto
              </p>
              <p
                className={cn(
                  "mt-1 font-mono font-semibold",
                  valorGasto > valorPP && "text-california-red",
                )}
              >
                {valorGasto > 0 ? formatCurrency(valorGasto, "BRL") : "—"}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Devolução
              </p>
              <p
                className={cn(
                  "mt-1 font-mono font-semibold",
                  devolucao > 0 ? "text-emerald-700" : "text-muted-foreground",
                )}
              >
                {valorGasto > 0 && valorGasto <= valorPP
                  ? formatCurrency(devolucao, "BRL")
                  : "—"}
              </p>
            </div>
          </div>

          {/* Uploader de notas fiscais */}
          <div className="space-y-2">
            <p className="text-xs font-semibold">
              Notas fiscais / comprovantes{" "}
              <span className="text-california-red">*</span>{" "}
              <span className="font-normal text-muted-foreground">
                (min 1, max 8 MB/arquivo, 25 MB total)
              </span>
            </p>

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
                      <Icon className="h-4 w-4 shrink-0" />
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

          {/* Warning de imutabilidade */}
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              A prestação de contas <strong>não pode ser reaberta</strong> depois
              de fechada. Confira os valores e os comprovantes antes de confirmar.
            </span>
          </div>

          {/* Rodapé */}
          <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
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
              disabled={!podeSalvar}
              className="max-w-xs truncate rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
              title={labelBotao}
            >
              {labelBotao}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
