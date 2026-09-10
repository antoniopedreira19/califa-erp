"use client";

/**
 * "Visualizar documentos" (Tela 3.2) — o PDF da PP e o anexo enviado pela
 * produção LADO A LADO, para conferência antes de aprovar ou reprovar.
 *
 * Substitui o antigo "Ver PP", que abria só o PDF numa aba nova e obrigava
 * o financeiro a alternar entre janelas para comparar o pedido com a nota.
 *
 * ⚠️ Camada (10/09/2026). Esta tela nasce dentro do drawer da PP, que é um
 * modal do Radix — e modal do Radix apaga o ponteiro do resto do documento
 * (`body { pointer-events: none }`). Enquanto isto aqui era uma `div`
 * solta na página, nada dela recebia clique: nem o "Fechar", nem os
 * botões de anexo, nem o "Aprovar" do rodapé — e o clique atravessava para
 * o overlay do drawer, que descartava a PP inteira. Era isso, e não o
 * visualizador do navegador, que impedia zoom, impressão e download: os
 * controles do PDF ficam DENTRO do `<iframe>`, e o iframe também estava
 * inerte. Por isso a tela é montada pelo `FullscreenContent`, que passa
 * pelo portal do Radix e entra na pilha de layers. Não troque por uma
 * `div fixed`.
 */

import * as React from "react";
import {
  AlertCircle,
  Download,
  ExternalLink,
  FileText,
  Maximize2,
  Minimize2,
  Paperclip,
  X,
} from "lucide-react";
import {
  Dialog,
  FullscreenContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  signedUrlPdf,
  signedUrlAnexo,
} from "@/app/(app)/jobs/[jobId]/realizado/actions-pp";

interface Anexo {
  id: string;
  arquivo_nome_original: string;
  arquivo_tamanho_bytes: number;
}

/** Qual painel está ocupando a tela sozinho. `null` = os dois lado a lado. */
type Expandido = "pp" | "anexo" | null;

/**
 * Baixa o documento com o nome que a produção enviou.
 *
 * Um `<a download href={urlAssinada}>` não serve: `download` é ignorado
 * quando o arquivo mora em outro domínio — e URL assinada do Storage
 * sempre mora. O link abriria o PDF de novo, no lugar da conferência.
 * Buscar o arquivo e servir um `blob:` local devolve o atributo `download`
 * ao jogo, e com ele o nome original em vez do caminho do bucket.
 */
async function baixarArquivo(url: string, nome: string): Promise<void> {
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  const blob = await resposta.blob();
  const enderecoLocal = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = enderecoLocal;
  link.download = nome;
  link.click();

  // Revogar na hora cancela o download que acabou de começar.
  setTimeout(() => URL.revokeObjectURL(enderecoLocal), 60_000);
}

/**
 * Abre o documento SEM a coluna de miniaturas, que come um terço do painel
 * numa tela já dividida em dois. Quem quiser as miniaturas as traz de
 * volta pelo botão ☰ do próprio visualizador (Tiago, 10/09/2026).
 *
 * `navpanes=0` é o que o Chrome entende; `pagemode=none` é o equivalente
 * do Acrobat, honrado por outros visualizadores. Os dois custam nada.
 *
 * ⚠️ **Só vale no carregamento.** Trocar o `#` de um `<iframe>` que já
 * carregou não reabre o visualizador — o documento continua exatamente
 * como estava. Foi assim que eu quase concluí que o Chrome ignorava o
 * parâmetro: o teste mudava o `src` de um PDF já aberto. Para conferir,
 * recarregue a tela inteira.
 */
function enderecoParaVisualizar(url: string): string {
  return url.includes("#") ? url : `${url}#pagemode=none&navpanes=0`;
}

export function DocumentosPPOverlay({
  open,
  onClose,
  ppId,
  ppCodigo,
  anexos,
  anexoInicial = 0,
  rodape,
}: {
  open: boolean;
  onClose: () => void;
  ppId: string;
  ppCodigo: string;
  anexos: Anexo[];
  /** Anexo que abre selecionado — o olho da lista de anexos aponta o dele. */
  anexoInicial?: number;
  /** Ações de aprovação, quando a PP ainda está em avaliação. */
  rodape?: React.ReactNode;
}) {
  const [urlPdf, setUrlPdf] = React.useState<string | null>(null);
  const [urlAnexo, setUrlAnexo] = React.useState<string | null>(null);
  const [anexoAtivo, setAnexoAtivo] = React.useState(anexoInicial);
  const [expandido, setExpandido] = React.useState<Expandido>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [carregandoPdf, setCarregandoPdf] = React.useState(false);
  const [carregandoAnexo, setCarregandoAnexo] = React.useState(false);

  const anexo = anexos[anexoAtivo] ?? null;
  const anexoId = anexo?.id ?? null;

  React.useEffect(() => {
    if (!open) return;
    setAnexoAtivo(anexoInicial);
    setExpandido(null);
    setErro(null);
  }, [open, anexoInicial]);

  // O PDF da PP é o lado FIXO da conferência: depende só da PP, e por
  // isso tem effect próprio. Quando ele dividia o effect com o anexo,
  // trocar de nota recarregava também o pedido — perdendo a rolagem e o
  // zoom justamente do documento contra o qual se está comparando.
  React.useEffect(() => {
    if (!open) return;
    let cancelado = false;
    setCarregandoPdf(true);

    (async () => {
      const pdf = await signedUrlPdf(ppId);
      if (cancelado) return;
      if (pdf.ok) setUrlPdf(pdf.url);
      else setErro(pdf.message);
      setCarregandoPdf(false);
    })();

    return () => {
      cancelado = true;
    };
  }, [open, ppId]);

  // O anexo é o lado que TROCA. Depende do id, e não do objeto: a lista
  // chega como prop e um array novo a cada render refaria a URL assinada
  // sem necessidade.
  React.useEffect(() => {
    if (!open) return;
    if (!anexoId) {
      setUrlAnexo(null);
      return;
    }
    let cancelado = false;
    setCarregandoAnexo(true);
    setUrlAnexo(null);

    (async () => {
      const res = await signedUrlAnexo(anexoId);
      if (cancelado) return;
      if (res.ok) setUrlAnexo(res.url);
      else setErro(res.message);
      setCarregandoAnexo(false);
    })();

    return () => {
      cancelado = true;
    };
  }, [open, anexoId]);

  const anexoEhImagem =
    anexo != null && /\.(png|jpe?g|webp|gif)$/i.test(anexo.arquivo_nome_original);

  function alternarExpandido(qual: Exclude<Expandido, null>) {
    setExpandido((atual) => (atual === qual ? null : qual));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(aberto) => {
        if (!aberto) onClose();
      }}
    >
      <FullscreenContent
        className="bg-[#181818]/[0.72] p-6"
        aria-describedby="conferencia-docs-descricao"
      >
        <div className="flex flex-wrap items-center gap-3 pb-3.5">
          <DialogTitle asChild>
            <span className="font-mono text-[15px] font-bold text-white">
              {ppCodigo}
            </span>
          </DialogTitle>
          <DialogDescription asChild>
            <span id="conferencia-docs-descricao" className="text-xs text-white/70">
              Conferência lado a lado · PP e documento anexo
            </span>
          </DialogDescription>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
          >
            <X className="h-3 w-3" />
            Fechar
          </button>
        </div>

        {erro && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-california-red/50 bg-california-red/15 p-3 text-sm text-white">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        {/* Os dois painéis ficam SEMPRE montados: expandir um esconde o
            outro por CSS, e não desmonta o `<iframe>`. Desmontar jogaria
            fora a página, o zoom e a rolagem de quem só quis ampliar o
            documento ao lado por um instante. */}
        <div
          className={cn(
            "grid min-h-0 flex-1 gap-4",
            expandido ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2",
          )}
        >
          <Painel
            icone={<FileText className="h-4 w-4 text-california-red" />}
            titulo="Pedido de Produção · PDF"
            legenda={`${ppCodigo}.pdf`}
            oculto={expandido === "anexo"}
            url={urlPdf}
            nomeArquivo={`${ppCodigo}.pdf`}
            expandido={expandido === "pp"}
            onExpandir={() => alternarExpandido("pp")}
            onErro={setErro}
          >
            {urlPdf ? (
              <iframe
                src={enderecoParaVisualizar(urlPdf)}
                title={`PDF da PP ${ppCodigo}`}
                className="h-full w-full border-0"
              />
            ) : (
              <Vazio texto={carregandoPdf ? "Carregando o PDF..." : "PDF indisponível."} />
            )}
          </Painel>

          <Painel
            icone={<Paperclip className="h-4 w-4 text-violet-700" />}
            titulo="Documento anexo"
            legenda={anexo?.arquivo_nome_original ?? "Nenhum anexo enviado"}
            oculto={expandido === "pp"}
            url={urlAnexo}
            nomeArquivo={anexo?.arquivo_nome_original ?? ""}
            expandido={expandido === "anexo"}
            onExpandir={() => alternarExpandido("anexo")}
            onErro={setErro}
            extra={
              /* Numerados na ordem em que a produção anexou. Só aparecem
                 quando há o que escolher: com um anexo só, o nome dele na
                 legenda já diz tudo (Tiago, 10/09/2026). */
              anexos.length > 1 ? (
                <div className="flex items-center gap-1">
                  {anexos.map((a, i) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAnexoAtivo(i)}
                      aria-pressed={i === anexoAtivo}
                      title={a.arquivo_nome_original}
                      className={
                        i === anexoAtivo
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
            {!anexo ? (
              <Vazio texto="A produção não enviou anexo nesta PP." />
            ) : urlAnexo ? (
              anexoEhImagem ? (
                <div className="flex h-full w-full items-center justify-center overflow-auto bg-muted/40 p-3">
                  {/* Imagem de storage com URL assinada — `next/image` exigiria
                      domínio configurado e não agrega nada aqui. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={urlAnexo}
                    alt={anexo.arquivo_nome_original}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              ) : (
                <iframe
                  key={anexo.id}
                  src={enderecoParaVisualizar(urlAnexo)}
                  title={anexo.arquivo_nome_original}
                  className="h-full w-full border-0"
                />
              )
            ) : (
              <Vazio
                texto={carregandoAnexo ? "Carregando o anexo..." : "Anexo indisponível."}
              />
            )}
          </Painel>
        </div>

        {rodape && <div className="flex-none pt-3.5">{rodape}</div>}
      </FullscreenContent>
    </Dialog>
  );
}

function Painel({
  icone,
  titulo,
  legenda,
  extra,
  oculto,
  url,
  nomeArquivo,
  expandido,
  onExpandir,
  onErro,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  legenda: string;
  extra?: React.ReactNode;
  /** Escondido porque o OUTRO painel está expandido. */
  oculto: boolean;
  /** URL assinada do documento — habilita baixar e abrir em outra aba. */
  url: string | null;
  nomeArquivo: string;
  expandido: boolean;
  onExpandir: () => void;
  /** Sobe a falha do download para a faixa de erro da conferência. */
  onErro: (mensagem: string) => void;
  children: React.ReactNode;
}) {
  const [baixando, setBaixando] = React.useState(false);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white",
        oculto && "hidden",
      )}
    >
      <div className="flex flex-none items-center gap-2.5 border-b border-border px-4 py-2.5">
        {icone}
        <span className="text-xs font-bold">{titulo}</span>
        {extra}
        <span className="ml-auto min-w-0 truncate text-[11px] text-muted-foreground">
          {legenda}
        </span>

        {/* Zoom, impressão e busca são do visualizador do navegador, dentro
            do `<iframe>`. O que ele não dá é sair do meio-a-meio, salvar o
            arquivo com o nome certo e abrir numa aba inteira — vai aqui. */}
        <div className="flex flex-none items-center gap-0.5 border-l border-border pl-2">
          <button
            type="button"
            onClick={onExpandir}
            title={expandido ? "Voltar ao lado a lado" : "Ver só este documento"}
            aria-label={expandido ? "Voltar ao lado a lado" : "Ver só este documento"}
            aria-pressed={expandido}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-california-red"
          >
            {expandido ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
          {url && (
            <>
              <button
                type="button"
                disabled={baixando}
                onClick={async () => {
                  setBaixando(true);
                  try {
                    await baixarArquivo(url, nomeArquivo);
                  } catch {
                    onErro("Não foi possível baixar o arquivo. Tente de novo.");
                  } finally {
                    setBaixando(false);
                  }
                }}
                title={baixando ? "Baixando..." : "Baixar o arquivo"}
                aria-label="Baixar o arquivo"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-california-red disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                title="Abrir em outra aba"
                aria-label="Abrir em outra aba"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-california-red"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted/40 p-6 text-center">
      <p className="text-xs text-muted-foreground">{texto}</p>
    </div>
  );
}
