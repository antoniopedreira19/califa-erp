"use client";

/**
 * Os documentos de um título lado a lado (decisão 195, ⓘ variante A): à
 * ESQUERDA sempre o documento interno (a PP, o pedido de desembolso, a NF
 * que a agência emitiu), à DIREITA sempre o de pagamento (a NF do
 * fornecedor, o orçamento, o boleto, a guia). Um lado com mais de um
 * documento troca pelos números. Só um lado com documento ocupa a tela.
 * Ampliar mostra um lado só, escondendo o outro por CSS — desmontar o
 * `<iframe>` perderia a página, o zoom e a rolagem (docs/09, documento
 * embutido).
 *
 * Abre por cima do pop-up do ⓘ, numa camada em tela cheia do Radix (regra
 * de layer): Fechar ou Esc saem.
 */

import * as React from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { Dialog, DialogDescription, DialogTitle, FullscreenContent } from "@/components/ui/dialog";
import { PainelDocumento, VisualizadorDeArquivo } from "@/components/documentos/painel-documento";
import { cn } from "@/lib/utils";

export interface DocumentoDoTitulo {
  /** "origem" é o interno; "pagamento" é o de pagamento. */
  grupo: "origem" | "pagamento";
  tipo: string;
  arquivo: string;
  /** URL assinada; nula quando o arquivo não abriu. */
  url: string | null;
  imagem: boolean;
}

export function VisualizadorDeDocumentos({
  aberto,
  onFechar,
  referencia,
  titulo,
  documentos,
  inicial,
}: {
  aberto: boolean;
  onFechar: () => void;
  referencia: string;
  titulo: string;
  documentos: DocumentoDoTitulo[];
  /** O documento clicado no ⓘ; `null` abre o primeiro de cada lado. */
  inicial: number | null;
}) {
  const lados = (
    [
      { chave: "origem" as const, rotulo: "Interno", docs: documentos.filter((d) => d.grupo === "origem") },
      { chave: "pagamento" as const, rotulo: "Pagamento", docs: documentos.filter((d) => d.grupo === "pagamento") },
    ]
  ).filter((l) => l.docs.length > 0);
  const pedido = inicial !== null ? documentos[inicial] ?? null : null;
  const [ativo, setAtivo] = React.useState<Record<string, number>>({});
  const [so, setSo] = React.useState<"origem" | "pagamento" | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  // Cada abertura começa do documento clicado.
  React.useEffect(() => {
    if (!aberto) return;
    setAtivo(
      Object.fromEntries(
        lados.map((l) => [l.chave, pedido && pedido.grupo === l.chave ? Math.max(0, l.docs.indexOf(pedido)) : 0]),
      ),
    );
    setSo(null);
    setErro(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, inicial]);

  return (
    <Dialog open={aberto} onOpenChange={(a) => !a && onFechar()}>
      <FullscreenContent className="bg-[#181818]/[0.82] p-5">
        <div className="flex flex-none flex-wrap items-center gap-3 pb-3">
          <DialogTitle className="font-mono text-[15px] font-bold text-white">{referencia}</DialogTitle>
          <DialogDescription className="max-w-[420px] truncate text-xs text-white/70">{titulo}</DialogDescription>
          <span className="text-xs text-white/50">
            {lados.length > 1
              ? "· documento interno e de pagamento, lado a lado"
              : `· ${documentos.length} ${documentos.length === 1 ? "documento" : "documentos"}`}
          </span>
          {erro && <span className="text-xs font-semibold text-red-300">{erro}</span>}
          <button
            type="button"
            onClick={onFechar}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
          >
            <X className="h-3 w-3" />
            Fechar
          </button>
        </div>
        <div
          className="grid min-h-0 flex-1 gap-3"
          style={{ gridTemplateColumns: `repeat(${so ? 1 : lados.length}, minmax(0, 1fr))` }}
        >
          {lados.map((lado) => {
            const i = ativo[lado.chave] ?? 0;
            const d = lado.docs[i] ?? lado.docs[0];
            return (
              <PainelDocumento
                key={lado.chave}
                icone={
                  lado.chave === "origem" ? (
                    <FileText className="h-4 w-4 text-california-red" />
                  ) : (
                    <Paperclip className="h-4 w-4 text-violet-700" />
                  )
                }
                titulo={d.tipo}
                legenda={d.arquivo}
                extra={
                  <>
                    <span
                      className={cn(
                        "rounded px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide",
                        lado.chave === "origem" ? "bg-california-red/10 text-california-red" : "bg-violet-100 text-violet-700",
                      )}
                    >
                      {lado.rotulo}
                    </span>
                    {lado.docs.length > 1 && (
                      <span className="flex items-center gap-1">
                        {lado.docs.map((x, j) => (
                          <button
                            key={`${x.arquivo}-${j}`}
                            type="button"
                            onClick={() => setAtivo((a) => ({ ...a, [lado.chave]: j }))}
                            aria-pressed={j === i}
                            title={`${x.tipo} · ${x.arquivo}`}
                            className={
                              j === i
                                ? "rounded-md bg-california-red px-2 py-0.5 text-[11px] font-semibold text-white"
                                : "rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                            }
                          >
                            {j + 1}
                          </button>
                        ))}
                      </span>
                    )}
                  </>
                }
                oculto={so !== null && so !== lado.chave}
                url={d.url}
                nomeArquivo={d.arquivo}
                expandido={so === lado.chave}
                onExpandir={() => setSo((s) => (s ? null : lado.chave))}
                onErro={setErro}
              >
                {d.url ? (
                  <VisualizadorDeArquivo key={d.url} url={d.url} nome={d.arquivo} imagem={d.imagem} />
                ) : (
                  <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
                    Não foi possível abrir este arquivo.
                  </div>
                )}
              </PainelDocumento>
            );
          })}
        </div>
      </FullscreenContent>
    </Dialog>
  );
}
