"use client";

/**
 * Os documentos da PP "lado a lado" na produção (decisão 153, entrega 3) —
 * o desenho aprovado no protótipo "Etapa antes da PP" (11ª rodada), igual à
 * tela da PP no Contas a Pagar (`pp-tela.tsx`):
 *
 *  • à esquerda, o PDF do Pedido de Produção — só no envio: a PP a emitir
 *    ainda não tem PDF, e no formulário a coluna não aparece;
 *  • no meio, o documento à vista, com os números 1, 2, 3… para trocar;
 *  • à direita, "Documentos e dados": anexar, a lista (o mais novo em cima,
 *    com a situação de cada um) e os campos SÓ do documento à vista — o tipo
 *    e, na NF, os dados dela; nos outros, o número.
 *
 * O estado é de quem abre (o envio ou o formulário): esta tela só mostra e
 * repassa as mudanças, e o que se preenche aqui aparece lá ao voltar. O
 * arquivo que acabou de subir aparece pelo próprio arquivo (`blob:`); o já
 * gravado, pela URL assinada que quem abre sabe pedir.
 *
 * Mesma camada e mesmo jeito de sair da tela do Contas a Pagar:
 * `FullscreenContent` (z-55), "Fechar" e ESC — o ESC fecha só esta tela.
 */

import * as React from "react";
import { AlertCircle, ChevronLeft, ChevronRight, FileText, Paperclip, Trash2, X } from "lucide-react";
import { Dialog, DialogDescription, DialogTitle, FullscreenContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import { documentoTipoLabel, type DocumentoTipo } from "@/lib/types";
import {
  PainelDocumento,
  VazioDoPainel,
  VisualizadorDeArquivo,
} from "@/components/documentos/painel-documento";
import { signedUrlPdf } from "./actions-pp";
import {
  ResumoDasNfs,
  TipoObrigatorio,
  ZonaDeAnexos,
  faltasDaNf,
  itensDaLista,
  parteDaNf,
  type AnexoEmEdicao,
} from "./anexos-da-pp";

type ResultadoDaUrl = { ok: true; url: string } | { ok: false; message: string };

export function ConferenciaDosDocumentos({
  open,
  onOpenChange,
  codigo,
  selo,
  descricao,
  ppIdDoPdf,
  anexos,
  focar,
  urlDoGravado,
  prontoParaAnexar,
  onArquivos,
  onTipo,
  onNumero,
  onRemover,
  renderNf,
  mostrarFaltas,
  obrigatorio,
  valorPP,
  moeda,
  aviso,
  onFecharAviso,
  rodapeEsquerda,
  rodape,
  disabled,
}: {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  /** O código da PP, ou "PP a emitir" antes de gerar. */
  codigo: string;
  selo: string;
  descricao: string;
  /** A PP cujo PDF vai à esquerda (null = PP a emitir: sem a coluna). */
  ppIdDoPdf: string | null;
  /** Os anexos de quem abriu, no estado em que estão. */
  anexos: AnexoEmEdicao[];
  /** O documento que abre à vista (o olho de um cartão). */
  focar: string | null;
  /** A URL assinada de um anexo já gravado. */
  urlDoGravado: (anexoId: string) => Promise<ResultadoDaUrl>;
  prontoParaAnexar: boolean;
  onArquivos: (arquivos: File[]) => void;
  onTipo: (id: string, tipo: DocumentoTipo) => void;
  onNumero: (id: string, numero: string) => void;
  onRemover: (id: string) => void;
  /** Os campos da NF do documento à vista, na coluna estreita. */
  renderNf: (id: string) => React.ReactNode;
  mostrarFaltas: boolean;
  obrigatorio: boolean;
  valorPP: number;
  moeda: string;
  /** O aviso de quem abriu (erro do envio, confirmação). */
  aviso?: React.ReactNode;
  onFecharAviso?: () => void;
  rodapeEsquerda?: React.ReactNode;
  rodape: React.ReactNode;
  disabled?: boolean;
}) {
  const [ativoId, setAtivoId] = React.useState<string | null>(null);
  const [expandido, setExpandido] = React.useState<"pp" | "doc" | null>(null);
  const [erroLocal, setErroLocal] = React.useState<string | null>(null);
  const [urlPdf, setUrlPdf] = React.useState<string | null>(null);
  const [carregandoPdf, setCarregandoPdf] = React.useState(false);
  /** As URLs assinadas dos anexos gravados, por id. */
  const [assinadas, setAssinadas] = React.useState<Record<string, string>>({});
  const [carregandoDoc, setCarregandoDoc] = React.useState(false);
  /** As URLs `blob:` dos arquivos que subiram agora, por id. */
  const locais = React.useRef(new Map<string, string>());
  const idsAntes = React.useRef<Set<string>>(new Set());

  // Arquivo recusado ou que falhou ao subir não é documento: fica só na
  // lista de quem abriu, com o motivo.
  const visiveis = React.useMemo(
    () => anexos.filter((a) => a.status !== "rejeitado" && a.status !== "erro"),
    [anexos],
  );
  const itens = React.useMemo(() => itensDaLista(visiveis), [visiveis]);
  const porId = React.useMemo(() => new Map(visiveis.map((a) => [a.id, a])), [visiveis]);

  // Abre no documento pedido.
  React.useEffect(() => {
    if (!open) return;
    setAtivoId(focar ?? itens[0]?.id ?? null);
    setExpandido(null);
    setErroLocal(null);
    idsAntes.current = new Set(itens.map((a) => a.id));
    // Só quando abre, ou quando pede outro documento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focar]);

  // O arquivo novo vira o documento à vista, para ser preenchido logo; o
  // removido dá lugar ao primeiro da lista.
  React.useEffect(() => {
    if (!open) return;
    const novo = itens.find((a) => !idsAntes.current.has(a.id));
    idsAntes.current = new Set(itens.map((a) => a.id));
    if (novo) setAtivoId(novo.id);
    else if (ativoId && !itens.some((a) => a.id === ativoId)) setAtivoId(itens[0]?.id ?? null);
    // Só quando a lista muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens]);

  // O PDF da PP é o lado fixo: depende só da PP.
  React.useEffect(() => {
    if (!open || !ppIdDoPdf) return;
    let cancelado = false;
    setCarregandoPdf(true);
    signedUrlPdf(ppIdDoPdf).then((res) => {
      if (cancelado) return;
      if (res.ok) setUrlPdf(res.url);
      else setErroLocal(res.message);
      setCarregandoPdf(false);
    });
    return () => {
      cancelado = true;
    };
  }, [open, ppIdDoPdf]);

  const indice = Math.max(0, itens.findIndex((a) => a.id === ativoId));
  const ativo = itens[indice] ? (porId.get(itens[indice].id) ?? null) : null;

  // O documento à vista: o arquivo local, ou a URL assinada do gravado.
  const ativoGravadoId = ativo && !ativo.file && ativo.salvo ? ativo.id : null;
  React.useEffect(() => {
    if (!open || !ativoGravadoId || assinadas[ativoGravadoId]) return;
    let cancelado = false;
    setCarregandoDoc(true);
    urlDoGravado(ativoGravadoId).then((res) => {
      if (cancelado) return;
      if (res.ok) setAssinadas((antes) => ({ ...antes, [ativoGravadoId]: res.url }));
      else setErroLocal(res.message);
      setCarregandoDoc(false);
    });
    return () => {
      cancelado = true;
    };
    // `urlDoGravado` é de quem abre e não muda o que pede.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ativoGravadoId]);

  function urlDoLocal(a: AnexoEmEdicao): string | null {
    if (!a.file) return null;
    const ja = locais.current.get(a.id);
    if (ja) return ja;
    const nova = URL.createObjectURL(a.file);
    locais.current.set(a.id, nova);
    return nova;
  }

  // Fechar a tela (ou sair dela) libera os arquivos locais da memória.
  React.useEffect(() => {
    const mapa = locais.current;
    if (open) return;
    for (const url of mapa.values()) URL.revokeObjectURL(url);
    mapa.clear();
  }, [open]);
  React.useEffect(() => {
    const mapa = locais.current;
    return () => {
      for (const url of mapa.values()) URL.revokeObjectURL(url);
      mapa.clear();
    };
  }, []);

  const urlDoAtivo = ativo ? (urlDoLocal(ativo) ?? assinadas[ativo.id] ?? null) : null;
  const temPP = ppIdDoPdf !== null;
  const nfsNaLista = visiveis.filter((a) => a.status === "ok" && a.tipo === "nota_fiscal");

  const situacao = (a: AnexoEmEdicao): { texto: string; ok: boolean } => {
    if (a.status !== "ok") return { texto: "enviando…", ok: false };
    if (!a.tipo) return { texto: "Escolha o tipo", ok: false };
    if (a.tipo === "nota_fiscal") {
      const falta = faltasDaNf(a.nf, valorPP).length > 0;
      return { texto: falta ? "NF · falta preencher" : `NF ${a.nf.numero.trim()}`, ok: !falta };
    }
    const semNumero = !(a.numero ?? "").trim();
    return {
      texto: semNumero
        ? `${documentoTipoLabel(a.tipo)} · falta o número`
        : `${documentoTipoLabel(a.tipo)} ${(a.numero ?? "").trim()}`,
      ok: !semNumero,
    };
  };

  const textoDoAviso = aviso ?? erroLocal;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Véu mais escuro que o do Contas a Pagar (0,82): aqui a tela abre por
          cima do formulário ou do envio, e o texto deles vazava no
          cabeçalho. */}
      <FullscreenContent className="bg-[#181818]/[0.92] p-5" aria-describedby="conferencia-descricao">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-none flex-wrap items-center gap-3 pb-3">
            <DialogTitle asChild>
              <span className="font-mono text-[15px] font-bold text-white">{codigo}</span>
            </DialogTitle>
            <Badge className="border-white/25 bg-white/10 text-white">{selo}</Badge>
            <DialogDescription asChild>
              <span id="conferencia-descricao" className="text-xs text-white/60">
                {descricao}
              </span>
            </DialogDescription>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
            >
              <X className="h-3 w-3" />
              Fechar
            </button>
          </div>

          {textoDoAviso && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-california-red/50 bg-california-red/15 p-3 text-sm text-white">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{textoDoAviso}</span>
              <button
                type="button"
                onClick={() => (aviso ? onFecharAviso?.() : setErroLocal(null))}
                aria-label="Fechar aviso"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Os painéis ficam montados: expandir esconde por CSS e não
              desmonta o `<iframe>` (página, zoom e rolagem ficam). */}
          <div
            className={cn(
              "grid min-h-0 flex-1 gap-3",
              expandido
                ? "grid-cols-1"
                : temPP
                  ? "grid-cols-1 lg:grid-cols-[1fr_1fr_350px]"
                  : "grid-cols-1 lg:grid-cols-[1fr_350px]",
            )}
          >
            {temPP && (
              <PainelDocumento
                icone={<FileText className="h-4 w-4 text-california-red" />}
                titulo="Pedido de Produção"
                legenda={`${codigo}.pdf`}
                oculto={expandido === "doc"}
                url={urlPdf}
                nomeArquivo={`${codigo}.pdf`}
                expandido={expandido === "pp"}
                onExpandir={() => setExpandido((e) => (e === "pp" ? null : "pp"))}
                onErro={setErroLocal}
              >
                {urlPdf ? (
                  <VisualizadorDeArquivo url={urlPdf} nome={`PDF da ${codigo}`} imagem={false} />
                ) : (
                  <VazioDoPainel texto={carregandoPdf ? "Carregando o PDF..." : "PDF indisponível."} />
                )}
              </PainelDocumento>
            )}

            <PainelDocumento
              icone={<Paperclip className="h-4 w-4 text-violet-700" />}
              titulo="Documento anexo"
              legenda={ativo?.nome ?? "Nenhum documento anexado"}
              oculto={expandido === "pp"}
              url={urlDoAtivo}
              nomeArquivo={ativo?.nome ?? ""}
              expandido={expandido === "doc"}
              onExpandir={() => setExpandido((e) => (e === "doc" ? null : "doc"))}
              onErro={setErroLocal}
              extra={
                itens.length > 1 ? (
                  <div className="flex items-center gap-1">
                    {itens.map((a, i) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setAtivoId(a.id)}
                        aria-pressed={i === indice}
                        title={a.nome}
                        className={
                          i === indice
                            ? "rounded-md bg-california-red px-2 py-0.5 text-[11px] font-semibold text-white"
                            : "rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
                        }
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                ) : null
              }
            >
              {!ativo ? (
                <VazioDoPainel texto="Anexe os documentos do fornecedor na coluna da direita." />
              ) : urlDoAtivo ? (
                <VisualizadorDeArquivo
                  key={ativo.id}
                  url={urlDoAtivo}
                  nome={ativo.nome}
                  imagem={ativo.mime.startsWith("image/")}
                />
              ) : (
                <VazioDoPainel texto={carregandoDoc ? "Carregando o documento..." : "Documento indisponível."} />
              )}
            </PainelDocumento>

            {!expandido && (
              <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white">
                <div className="flex flex-none items-center gap-2 border-b border-border px-4 py-2.5">
                  <span className="text-xs font-bold">Documentos e dados</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {itens.length} {itens.length === 1 ? "documento" : "documentos"}
                  </span>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
                  <ZonaDeAnexos
                    id={`conferencia-arquivos-${codigo.replace(/\W+/g, "-")}`}
                    pronto={prontoParaAnexar}
                    compacta
                    onArquivos={onArquivos}
                  />

                  {itens.length > 0 && (
                    <ul className="space-y-1">
                      {itens.map((item, i) => {
                        const a = porId.get(item.id);
                        if (!a) return null;
                        const s = situacao(a);
                        return (
                          <li key={a.id}>
                            <button
                              type="button"
                              onClick={() => setAtivoId(a.id)}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
                                i === indice
                                  ? "border-california-red/50 bg-california-red/5"
                                  : "border-border hover:bg-muted/50",
                              )}
                            >
                              <span className="font-mono text-[11px] font-semibold text-muted-foreground">{i + 1}</span>
                              <span className="min-w-0 flex-1 truncate">{a.nome}</span>
                              <span
                                className={cn(
                                  "flex-none text-[10.5px] font-semibold",
                                  s.ok ? "text-emerald-700" : mostrarFaltas ? "text-california-red" : "text-amber-700",
                                )}
                              >
                                {s.texto}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* `key`: um bloco por documento. O Select do Radix guarda o
                      valor quando o novo vem vazio — sem remontar, o tipo do
                      documento anterior aparecia no seguinte. */}
                  {ativo && (
                    <div key={ativo.id} className="space-y-3 rounded-xl border border-border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Documento à vista · {indice + 1} de {itens.length}
                          </p>
                          <p className="truncate text-[13px] font-semibold" title={ativo.nome}>
                            {ativo.nome}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onRemover(ativo.id)}
                          disabled={disabled || ativo.status === "uploading"}
                          title="Remover este documento"
                          aria-label={`Remover ${ativo.nome}`}
                          className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-california-red disabled:opacity-40"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      {ativo.status === "ok" ? (
                        <>
                          <div>
                            <p className="mb-1 text-xs font-medium">Tipo{obrigatorio ? " *" : ""}</p>
                            <TipoObrigatorio
                              valor={ativo.tipo}
                              descricaoArquivo={ativo.nome}
                              invalido={mostrarFaltas && !ativo.tipo}
                              onChange={(t) => onTipo(ativo.id, t)}
                              disabled={disabled}
                            />
                          </div>
                          {ativo.tipo === "nota_fiscal" && renderNf(ativo.id)}
                          {ativo.tipo && ativo.tipo !== "nota_fiscal" && (
                            <div>
                              <label htmlFor={`conferencia-numero-${ativo.id}`} className="text-xs font-medium">
                                Número do documento{obrigatorio ? " *" : ""}
                              </label>
                              <input
                                id={`conferencia-numero-${ativo.id}`}
                                value={ativo.numero ?? ""}
                                maxLength={60}
                                disabled={disabled}
                                onChange={(e) => onNumero(ativo.id, e.target.value)}
                                className={cn(
                                  "mt-1 flex h-9 w-full rounded-lg border border-border bg-white px-3 font-mono text-sm outline-none focus:border-california-red",
                                  mostrarFaltas &&
                                    obrigatorio &&
                                    !(ativo.numero ?? "").trim() &&
                                    "border-california-red ring-2 ring-california-red/15",
                                )}
                              />
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="text-[11.5px] text-muted-foreground">
                          O arquivo ainda está subindo. O tipo e os dados entram assim que ele chegar.
                        </p>
                      )}
                      {itens.length > 1 && (
                        <div className="flex items-center justify-between border-t border-border pt-2.5">
                          <button
                            type="button"
                            disabled={indice === 0}
                            onClick={() => setAtivoId(itens[indice - 1].id)}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" />
                            Anterior
                          </button>
                          <button
                            type="button"
                            disabled={indice === itens.length - 1}
                            onClick={() => setAtivoId(itens[indice + 1].id)}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                          >
                            Próximo
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <ResumoDasNfs valores={nfsNaLista.map((a) => parteDaNf(a.nf))} valorPP={valorPP} />
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-none flex-wrap items-center gap-2.5 pt-3">
            <span className="mr-auto text-xs text-white/70">
              {rodapeEsquerda ?? (
                <>
                  Valor da PP: <strong className="font-semibold text-white">{formatCurrency(valorPP, moeda)}</strong>
                </>
              )}
            </span>
            {rodape}
          </div>
        </div>
      </FullscreenContent>
    </Dialog>
  );
}
