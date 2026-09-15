"use client";

/**
 * Prestar contas da verba — e corrigir a prestação reprovada (decisão 081).
 *
 * A produção faz isto na aba de PPs do job, e só lá (pergunta 1b). Cada
 * documento é NF ou recibo e leva o valor que comprova; o gasto é a soma e
 * nunca passa da verba — o excedente precisa de uma PP nova (5a). O saldo
 * vira estorno de verba só quando o financeiro aprovar.
 *
 * Reprovada, a gaveta abre com os documentos e valores que foram enviados:
 * a pessoa troca o que precisa e reenvia pelo mesmo botão. O documento que
 * sai tem o arquivo apagado pela action, depois que o envio é aceito.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DrawerContent,
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
  type PedidoCompraNaLista,
} from "@/lib/types";
import {
  enviarPrestacaoVerba,
  linkDocumentoPrestacao,
  prefixoUploadPrestacao,
} from "./actions-prestacao";

const BUCKET = "pedidos-compra";

type TipoFiscal = "nota_fiscal" | "recibo";

interface DocumentoLocal {
  chave: string;
  /** Documento que já estava na prestação (correção). Null = arquivo novo. */
  gravadoId: string | null;
  file: File | null;
  nome: string;
  tamanho: number;
  mimetype: string;
  path: string | null;
  status: "ok" | "enviando" | "erro";
  mensagem?: string;
  tipo: TipoFiscal | "";
  numero: string;
  /** Texto cru: a pessoa pode estar no meio da digitação. */
  valor: string;
}

function sanitizeName(nome: string): string {
  return nome.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

/** "1.250,50", "1250,50" e "1250.50" viram 1250.5. */
function lerValor(bruto: string): number {
  const t = bruto.trim();
  if (!t) return 0;
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(normal);
  return Number.isFinite(n) ? n : 0;
}

function valorParaCampo(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatarData(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatarTamanho(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function PrestarContasDrawer({
  open,
  onOpenChange,
  pp,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  pp: PedidoCompraNaLista | null;
  onSuccess: (mensagem: string) => void;
}) {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const [pending, startTransition] = React.useTransition();
  const [prefixo, setPrefixo] = React.useState<string | null>(null);
  const [docs, setDocs] = React.useState<DocumentoLocal[]>([]);
  const [erro, setErro] = React.useState<string | null>(null);
  const [tentouEnviar, setTentouEnviar] = React.useState(false);
  const submittingRef = React.useRef(false);
  const sucessoRef = React.useRef(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const reprovada = pp?.prestacao?.status === "reprovada";

  // Cada abertura começa do que a PP tem: vazia, ou com o que foi enviado
  // e reprovado. Chaveado no id, e não no objeto, para um refresh do pai
  // não zerar o que a pessoa digitou.
  React.useEffect(() => {
    if (!open || !pp) return;
    sucessoRef.current = false;
    setErro(null);
    setTentouEnviar(false);
    setPrefixo(null);
    setDocs(
      pp.prestacao?.status === "reprovada"
        ? pp.prestacao.documentos.map((d) => ({
            chave: d.id,
            gravadoId: d.id,
            file: null,
            nome: d.arquivo_nome_original,
            tamanho: d.arquivo_tamanho_bytes,
            mimetype: d.arquivo_mimetype,
            path: null,
            status: "ok" as const,
            tipo:
              d.documento_tipo === "nota_fiscal" || d.documento_tipo === "recibo"
                ? d.documento_tipo
                : "",
            numero: d.documento_numero ?? "",
            valor: valorParaCampo(d.valor),
          }))
        : [],
    );
    let vivo = true;
    (async () => {
      const res = await prefixoUploadPrestacao(pp.id);
      if (!vivo) return;
      if (res.ok) setPrefixo(res.prefixo);
      else setErro(res.message);
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pp?.id]);

  React.useEffect(() => {
    if (!open && sucessoRef.current) router.refresh();
  }, [open, router]);

  if (!open || !pp) return null;
  const ppAtual = pp;

  const validos = docs.filter((d) => d.status === "ok");
  const gastoCentavos = validos.reduce((s, d) => s + Math.round(lerValor(d.valor) * 100), 0);
  const verbaCentavos = Math.round(Number(ppAtual.valor) * 100);
  const saldoCentavos = verbaCentavos - gastoCentavos;
  const passouDaVerba = saldoCentavos < 0;
  const reais = (centavos: number) => formatCurrency(centavos / 100, "BRL");

  async function adicionarArquivos(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!prefixo) {
      setErro("Aguarde: a preparação ainda não terminou. Tente de novo em 2 segundos.");
      return;
    }
    let soma = docs.reduce((s, d) => s + d.tamanho, 0);
    const novos: DocumentoLocal[] = [];
    for (const file of Array.from(files)) {
      const chave = crypto.randomUUID();
      const base = {
        chave,
        gravadoId: null,
        file,
        nome: file.name,
        tamanho: file.size,
        mimetype: file.type,
        tipo: "" as const,
        numero: "",
        valor: "",
      };
      if (!PP_ANEXO_MIMETYPES_ACEITOS.includes(file.type as PPAnexoMimetype)) {
        novos.push({ ...base, path: null, status: "erro", mensagem: "Formato não aceito — use PDF, JPG, PNG ou WEBP." });
        continue;
      }
      if (file.size > PP_ANEXO_TAMANHO_MAX_BYTES) {
        novos.push({ ...base, path: null, status: "erro", mensagem: "Acima de 8 MB." });
        continue;
      }
      if (soma + file.size > PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES) {
        novos.push({ ...base, path: null, status: "erro", mensagem: "Os documentos passariam de 25 MB juntos." });
        continue;
      }
      soma += file.size;
      novos.push({
        ...base,
        path: `${prefixo}${chave}-${sanitizeName(file.name)}`,
        status: "enviando",
      });
    }
    setDocs((prev) => [...prev, ...novos]);
    if (inputRef.current) inputRef.current.value = "";

    await Promise.all(
      novos
        .filter((n) => n.status === "enviando" && n.path && n.file)
        .map(async (n) => {
          const { error } = await supabase.storage
            .from(BUCKET)
            .upload(n.path as string, n.file as File, {
              contentType: (n.file as File).type,
              upsert: false,
            });
          setDocs((prev) =>
            prev.map((p) =>
              p.chave === n.chave
                ? {
                    ...p,
                    status: error ? "erro" : "ok",
                    mensagem: error ? "O arquivo não subiu. Remova e tente de novo." : undefined,
                  }
                : p,
            ),
          );
        }),
    );
  }

  async function remover(doc: DocumentoLocal) {
    setDocs((prev) => prev.filter((p) => p.chave !== doc.chave));
    // O arquivo novo que já subiu sai na hora; o gravado só sai quando o
    // reenvio for aceito — cancelar a correção não pode apagar prova.
    if (!doc.gravadoId && doc.path && doc.status === "ok") {
      await supabase.storage.from(BUCKET).remove([doc.path]);
    }
  }

  function mudar(chave: string, campos: Partial<DocumentoLocal>) {
    setDocs((prev) => prev.map((p) => (p.chave === chave ? { ...p, ...campos } : p)));
  }

  async function abrirGravado(id: string) {
    const res = await linkDocumentoPrestacao(id);
    if (res.ok) window.open(res.url, "_blank", "noopener,noreferrer");
    else setErro(res.message);
  }

  function enviar() {
    setTentouEnviar(true);
    setErro(null);
    if (docs.some((d) => d.status === "enviando")) {
      setErro("Aguarde os arquivos terminarem de subir.");
      return;
    }
    if (docs.some((d) => d.status === "erro")) {
      setErro("Remova os arquivos que não subiram antes de enviar.");
      return;
    }
    if (validos.length === 0) {
      setErro("Anexe ao menos um documento — NF ou recibo.");
      return;
    }
    if (validos.some((d) => !d.tipo)) {
      setErro("Diga se cada documento é NF ou recibo.");
      return;
    }
    if (validos.some((d) => lerValor(d.valor) <= 0)) {
      setErro("Informe o valor de cada documento.");
      return;
    }
    if (passouDaVerba) {
      setErro(
        `Os documentos somam ${reais(gastoCentavos)}, acima da verba de ${reais(verbaCentavos)}. Retire documentos até fechar dentro da verba — o excedente precisa de uma PP nova.`,
      );
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    startTransition(async () => {
      try {
        const res = await enviarPrestacaoVerba({
          pp_id: ppAtual.id,
          documentos: validos.map((d) => ({
            id: d.gravadoId,
            path: d.gravadoId ? null : d.path,
            nome_original: d.gravadoId ? null : d.nome,
            tamanho_bytes: d.gravadoId ? null : d.tamanho,
            mimetype: d.gravadoId ? null : d.mimetype,
            documento_tipo: d.tipo,
            documento_numero: d.numero.trim() || null,
            valor: lerValor(d.valor),
          })),
        });
        if (!res.ok) {
          setErro(res.message);
          return;
        }
        sucessoRef.current = true;
        onSuccess(
          res.reenvio
            ? `Prestação de ${res.codigo} corrigida e reenviada ao financeiro.`
            : `Prestação de ${res.codigo} enviada ao financeiro.`,
        );
        onOpenChange(false);
      } finally {
        submittingRef.current = false;
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <DialogTitle>
            {reprovada ? "Corrigir prestação" : "Prestar contas"} ·{" "}
            <span className="font-mono">{ppAtual.codigo}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {erro && (
              <div className="flex items-start gap-2 rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2 text-xs text-california-red">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                <span className="flex-1">{erro}</span>
                <button type="button" onClick={() => setErro(null)} aria-label="Fechar aviso">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {reprovada && ppAtual.prestacao?.motivo_reprovacao && (
              <div className="rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-2.5 text-[12px]">
                <p className="font-semibold text-california-red">
                  Reprovada pelo financeiro
                  {ppAtual.prestacao.reprovada_em
                    ? ` · ${formatarData(ppAtual.prestacao.reprovada_em)}`
                    : ""}
                  {ppAtual.prestacao.reprovada_por_nome
                    ? `, ${ppAtual.prestacao.reprovada_por_nome}`
                    : ""}
                </p>
                <p className="mt-0.5 text-foreground/80">“{ppAtual.prestacao.motivo_reprovacao}”</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Os documentos e valores enviados abrem aqui. Troque o que precisa e reenvie.
                </p>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Verba</p>
                <p className="font-mono text-[13px] font-bold">{formatCurrency(Number(ppAtual.valor), "BRL")}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Paga em</p>
                <p className="font-mono text-[13px] font-bold">{formatarData(ppAtual.pago_em)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Responsável</p>
                <p className="truncate text-[13px] font-semibold">{ppAtual.responsavel?.nome ?? "—"}</p>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Documentos do gasto
              </h3>
              {docs.length === 0 && (
                <p className="text-[12px] text-muted-foreground">Nenhum documento ainda.</p>
              )}
              {docs.map((d, i) => {
                const Icone = d.mimetype.startsWith("image/") ? ImageIcon : FileText;
                const marcaTipo = tentouEnviar && d.status === "ok" && !d.tipo;
                const marcaValor = tentouEnviar && d.status === "ok" && lerValor(d.valor) <= 0;
                return (
                  <div
                    key={d.chave}
                    className={cn(
                      "grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.1fr)_112px_28px] items-center gap-2 rounded-lg border bg-white p-2.5",
                      d.status === "erro" ? "border-california-red/40" : "border-border",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Icone className="h-3.5 w-3.5 flex-none text-muted-foreground" />
                        <span className="truncate text-[12px] font-semibold" title={d.nome}>
                          {i + 1} · {d.nome}
                        </span>
                        {d.gravadoId && (
                          <button
                            type="button"
                            onClick={() => abrirGravado(d.gravadoId as string)}
                            title="Abrir o documento enviado"
                            aria-label={`Abrir ${d.nome}`}
                            className="flex-none text-muted-foreground hover:text-california-red"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      <p
                        className={cn(
                          "text-[10.5px]",
                          d.status === "erro" ? "text-california-red" : "text-muted-foreground",
                        )}
                      >
                        {d.status === "enviando"
                          ? "subindo…"
                          : d.status === "erro"
                            ? d.mensagem
                            : formatarTamanho(d.tamanho)}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <select
                        value={d.tipo}
                        onChange={(e) => mudar(d.chave, { tipo: e.target.value as TipoFiscal | "" })}
                        disabled={pending || d.status === "erro"}
                        aria-label={`Tipo do documento ${i + 1}`}
                        className={cn(
                          "h-9 w-[84px] flex-none rounded-lg border bg-white px-2 text-xs outline-none focus:border-california-red",
                          marcaTipo ? "border-california-red" : "border-border",
                        )}
                      >
                        <option value="">Tipo…</option>
                        <option value="nota_fiscal">NF</option>
                        <option value="recibo">Recibo</option>
                      </select>
                      <Input
                        value={d.numero}
                        onChange={(e) => mudar(d.chave, { numero: e.target.value })}
                        disabled={pending || d.status === "erro"}
                        placeholder="Número"
                        aria-label={`Número do documento ${i + 1}`}
                        maxLength={60}
                        className="h-9 min-w-0 text-xs"
                      />
                    </div>
                    <Input
                      value={d.valor}
                      onChange={(e) => mudar(d.chave, { valor: e.target.value })}
                      disabled={pending || d.status === "erro"}
                      placeholder="0,00"
                      inputMode="decimal"
                      aria-label={`Valor do documento ${i + 1}`}
                      className={cn(
                        "no-spinner h-9 text-right font-mono text-xs",
                        marcaValor && "border-california-red",
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => remover(d)}
                      disabled={pending}
                      title="Remover documento"
                      aria-label={`Remover ${d.nome}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-california-red hover:bg-california-red/10 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}

              <label
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border p-3 text-[12px] text-muted-foreground transition-colors hover:border-california-red/40",
                  (pending || !prefixo) && "cursor-not-allowed opacity-60",
                )}
              >
                <Upload className="h-4 w-4" />
                Anexar documentos · PDF, JPG, PNG ou WEBP, até 8 MB cada
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept={PP_ANEXO_MIMETYPES_ACEITOS.join(",")}
                  className="hidden"
                  disabled={pending || !prefixo}
                  onChange={(e) => adicionarArquivos(e.target.files)}
                />
              </label>
              <p className="text-[11px] text-muted-foreground">
                Cada documento — NF ou recibo — leva o número e o valor que ele comprova. O gasto é a
                soma, não se digita à parte.
              </p>
            </div>

            <div className="space-y-1.5 border-t border-border pt-3 text-[12.5px]">
              <div className="flex justify-between font-semibold">
                <span>Gasto comprovado</span>
                <span className={cn("font-mono", passouDaVerba && "text-california-red")}>
                  {reais(gastoCentavos)}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Verba</span>
                <span className="font-mono">{reais(verbaCentavos)}</span>
              </div>
              {passouDaVerba ? (
                <p className="text-[11.5px] text-california-red">
                  O gasto passa da verba em {reais(-saldoCentavos)}. Retire documentos até fechar dentro
                  da verba — o excedente precisa de uma PP nova, que passa pela aprovação.
                </p>
              ) : (
                <>
                  <div className="flex justify-between rounded-lg bg-teal-50 px-3 py-2 font-semibold text-teal-800">
                    <span>Saldo a devolver</span>
                    <span className="font-mono">{reais(saldoCentavos)}</span>
                  </div>
                  {saldoCentavos > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      Depois da aprovação, o saldo vira um estorno de verba de −{reais(saldoCentavos)} em
                      Títulos a Pagar, esperando o dinheiro voltar.
                    </p>
                  )}
                </>
              )}
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
              type="button"
              onClick={enviar}
              disabled={pending || passouDaVerba || docs.some((d) => d.status === "enviando")}
              className="rounded-lg bg-california-red px-4 py-2 text-[13px] font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
            >
              {pending
                ? "Enviando…"
                : reprovada
                  ? "Reenviar prestação ao financeiro"
                  : "Enviar prestação ao financeiro"}
            </button>
          </div>
        </div>
      </DrawerContent>
    </Dialog>
  );
}
