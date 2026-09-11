"use client";

/**
 * A tela da PP no financeiro (10/09/2026).
 *
 * Substitui o par drawer + "Visualizar documentos". Clicar na linha abre
 * direto aqui, para QUALQUER status: o pedido em PDF, o documento que a
 * produção anexou, e o dossiê da PP na coluna da direita. A decisão
 * acontece onde estão as provas — antes, o financeiro decidia numa tela e
 * conferia em outra.
 *
 * Desenho fechado com o Tiago depois de três rodadas. O que ele derrubou
 * pelo caminho, e que não deve voltar:
 *
 * • **drawer + pop-up** — o pop-up repetia fornecedor, valor e vencimento,
 *   e virava um segundo drawer. A redundância mudava de lugar em vez de
 *   acabar. Com uma tela só, não há o que duplicar.
 * • **obrigar a passar pela conferência** — obriga a ABRIR a tela, não a
 *   LER o documento. Trava que não trava, e atrapalha todo dia.
 *
 * ⚠️ Camada e cliques: esta tela é montada pelo `FullscreenContent`, que
 * passa pelo portal do Radix. `<div class="fixed">` solta aqui vira
 * decoração — o modal põe `pointer-events: none` no `<body>` e devolve
 * `auto` só ao layer dele. E o `z` é explícito: 55 aqui, 60 nos diálogos
 * que esta tela abre. Ver `components/ui/dialog.tsx`.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ppStatusLabel, type PPStatus } from "@/lib/types";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import type { PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import type { PPRow } from "./pedidos-compra-list";
import { PPDossie, type AbaDossie } from "./pp-dossie";
import { AprovarPPDialog } from "./aprovar-pp-dialog";
import { PrestarContasDialog } from "./prestar-contas-dialog";
import { rejeitarPedidoCompraFinanceiro } from "./actions";
import {
  signedUrlPdf,
  signedUrlAnexo,
} from "@/app/(app)/jobs/[jobId]/realizado/actions-pp";

/** Qual painel está sozinho na tela. `null` = os três juntos. */
type Expandido = "pp" | "anexo" | null;

/**
 * Abre o documento SEM a coluna de miniaturas, que come um terço de um
 * painel que já é um terço da tela. Quem quiser as miniaturas as traz de
 * volta pelo ☰ do próprio visualizador.
 *
 * ⚠️ Só vale no carregamento: trocar o `#` de um `<iframe>` que já abriu
 * não reabre o visualizador. Para conferir, recarregue a página — testar
 * mudando o `src` de um PDF aberto faz o parâmetro parecer ignorado.
 */
function enderecoParaVisualizar(url: string): string {
  return url.includes("#") ? url : `${url}#navpanes=0&pagemode=none`;
}

/**
 * Baixa com o nome que a produção enviou. `<a download>` é ignorado em
 * arquivo de outro domínio — e URL assinada do Storage sempre é —, então
 * o link abriria o PDF por cima da tela. Servir um `blob:` local devolve
 * o atributo, e com ele o nome original.
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
  setTimeout(() => URL.revokeObjectURL(enderecoLocal), 60_000);
}

export function PPTela({
  pp,
  open,
  onOpenChange,
  tenantId,
  cartoes,
  tipos,
  subtipos,
}: {
  pp: PPRow | null;
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  tenantId: string;
  cartoes: CartaoOption[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
}) {
  const router = useRouter();
  const [urlPdf, setUrlPdf] = React.useState<string | null>(null);
  const [urlAnexo, setUrlAnexo] = React.useState<string | null>(null);
  const [anexoAtivo, setAnexoAtivo] = React.useState(0);
  const [expandido, setExpandido] = React.useState<Expandido>(null);
  const [dossieAberto, setDossieAberto] = React.useState(true);
  const [aba, setAba] = React.useState<AbaDossie>("dados");
  const [erro, setErro] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [carregandoPdf, setCarregandoPdf] = React.useState(false);
  const [carregandoAnexo, setCarregandoAnexo] = React.useState(false);
  const [aprovarAberto, setAprovarAberto] = React.useState(false);
  const [askRejeitar, setAskRejeitar] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [prestarOpen, setPrestarOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const ppId = pp?.id ?? null;
  const anexo = pp?.anexos[anexoAtivo] ?? null;
  const anexoId = anexo?.id ?? null;

  React.useEffect(() => {
    if (!open) return;
    setAnexoAtivo(0);
    setExpandido(null);
    setAba("dados");
    setErro(null);
    setMotivo("");
  }, [open, ppId]);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // O PDF da PP é o lado FIXO: depende só da PP. Effect próprio para que
  // trocar de anexo não recarregue o pedido, perdendo rolagem e zoom
  // justamente do documento contra o qual se compara.
  React.useEffect(() => {
    if (!open || !ppId) return;
    let cancelado = false;
    setCarregandoPdf(true);
    (async () => {
      const res = await signedUrlPdf(ppId);
      if (cancelado) return;
      if (res.ok) setUrlPdf(res.url);
      else setErro(res.message);
      setCarregandoPdf(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [open, ppId]);

  // O anexo é o lado que TROCA. Depende do id, não do objeto: a lista
  // chega como prop, e um array novo a cada render refaria a URL à toa.
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

  if (!pp) return null;

  const emAvaliacao = pp.status === "em_avaliacao";
  const anexoEhImagem =
    anexo != null && /\.(png|jpe?g|webp|gif)$/i.test(anexo.arquivo_nome_original);

  function handleAprovada(mensagem: string) {
    setAprovarAberto(false);
    setToast(mensagem);
    router.refresh();
    setTimeout(() => onOpenChange(false), 1200);
  }

  function handleConfirmarRejeitar() {
    if (!pp) return;
    startTransition(async () => {
      const res = await rejeitarPedidoCompraFinanceiro(pp.id, motivo);
      if (!res.ok) {
        setErro(res.message);
        setAskRejeitar(false);
        return;
      }
      setAskRejeitar(false);
      setToast(`${pp.codigo} rejeitada. O GP foi liberado pra corrigir.`);
      router.refresh();
      setTimeout(() => onOpenChange(false), 1200);
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <FullscreenContent
          className="bg-[#181818]/[0.82] p-5"
          aria-describedby="pp-tela-descricao"
        >
          <div className="flex flex-none flex-wrap items-center gap-3 pb-3">
            <DialogTitle asChild>
              <span className="font-mono text-[15px] font-bold text-white">
                {pp.codigo}
              </span>
            </DialogTitle>
            <Badge className="border-white/25 bg-white/10 text-white">
              {ppStatusLabel(pp.status as PPStatus)}
            </Badge>
            <DialogDescription asChild>
              <span id="pp-tela-descricao" className="text-xs text-white/60">
                Pedido, documento anexo e dados — lado a lado
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

          {erro && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-california-red/50 bg-california-red/15 p-3 text-sm text-white">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{erro}</span>
              <button type="button" onClick={() => setErro(null)} aria-label="Fechar aviso">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Os painéis ficam SEMPRE montados: expandir esconde por CSS e
              não desmonta o `<iframe>`. Desmontar jogaria fora página,
              zoom e rolagem de quem só quis ampliar um instante. */}
          <div
            className={cn(
              "grid min-h-0 flex-1 gap-3",
              expandido
                ? "grid-cols-1"
                : dossieAberto
                  ? "grid-cols-1 lg:grid-cols-[1fr_1fr_310px]"
                  : "grid-cols-1 lg:grid-cols-[1fr_1fr_34px]",
            )}
          >
            <PainelDocumento
              icone={<FileText className="h-4 w-4 text-california-red" />}
              titulo="Pedido de Produção"
              legenda={`${pp.codigo}.pdf`}
              oculto={expandido === "anexo"}
              url={urlPdf}
              nomeArquivo={`${pp.codigo}.pdf`}
              expandido={expandido === "pp"}
              onExpandir={() =>
                setExpandido((a) => (a === "pp" ? null : "pp"))
              }
              onErro={setErro}
            >
              {urlPdf ? (
                <iframe
                  src={enderecoParaVisualizar(urlPdf)}
                  title={`PDF da PP ${pp.codigo}`}
                  className="h-full w-full border-0"
                />
              ) : (
                <Vazio texto={carregandoPdf ? "Carregando o PDF..." : "PDF indisponível."} />
              )}
            </PainelDocumento>

            <PainelDocumento
              icone={<Paperclip className="h-4 w-4 text-violet-700" />}
              titulo="Documento anexo"
              legenda={anexo?.arquivo_nome_original ?? "Nenhum anexo enviado"}
              oculto={expandido === "pp"}
              url={urlAnexo}
              nomeArquivo={anexo?.arquivo_nome_original ?? ""}
              expandido={expandido === "anexo"}
              onExpandir={() =>
                setExpandido((a) => (a === "anexo" ? null : "anexo"))
              }
              onErro={setErro}
              extra={
                /* Numerados na ordem em que a produção anexou. Só aparecem
                   quando há o que escolher: com um anexo só, o nome dele na
                   legenda já diz tudo (Tiago, 10/09/2026). */
                pp.anexos.length > 1 ? (
                  <div className="flex items-center gap-1">
                    {pp.anexos.map((a, i) => (
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
                <Vazio texto="A produção não enviou documento nesta PP." />
              ) : urlAnexo ? (
                anexoEhImagem ? (
                  <div className="flex h-full w-full items-center justify-center overflow-auto bg-muted/40 p-3">
                    {/* URL assinada: `next/image` exigiria domínio configurado
                        e não agregaria nada. */}
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
            </PainelDocumento>

            {/* O dossiê some junto quando um documento é expandido: ali a
                tela inteira é do documento. */}
            {!expandido &&
              (dossieAberto ? (
                <div className="relative hidden min-h-0 lg:flex lg:flex-col">
                  <button
                    type="button"
                    onClick={() => setDossieAberto(false)}
                    title="Recolher os dados"
                    aria-label="Recolher os dados"
                    className="absolute -left-3 top-3 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-white text-muted-foreground shadow transition-colors hover:text-california-red"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <PPDossie
                    pp={pp}
                    aba={aba}
                    onAba={setAba}
                    anexoAtivo={anexoAtivo}
                    onAnexo={setAnexoAtivo}
                    onPrestarContas={() => setPrestarOpen(true)}
                    onErro={setErro}
                  />
                </div>
              ) : (
                <Calha onAbrir={() => setDossieAberto(true)} />
              ))}
          </div>

          {emAvaliacao && (
            <div className="flex flex-none flex-wrap items-center gap-2.5 pt-3">
              <span className="mr-auto text-xs text-white/70">
                Vencimento negociado pela produção:{" "}
                <strong className="font-semibold text-white">
                  {(pp.parcelas[0]?.data_vencimento ?? pp.prazo_pagamento)
                    ?.slice(0, 10)
                    .split("-")
                    .reverse()
                    .join("/") ?? "—"}
                </strong>
              </span>
              <button
                type="button"
                onClick={() => setAskRejeitar(true)}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/40 bg-white px-3.5 py-2 text-sm font-semibold text-california-red transition-colors hover:bg-california-red/5 disabled:opacity-50"
              >
                <Ban className="h-3.5 w-3.5" />
                Rejeitar
              </button>
              <button
                type="button"
                onClick={() => setAprovarAberto(true)}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Seguir para a aprovação
              </button>
            </div>
          )}

          {toast && (
            <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-elevated">
              <CheckCircle className="h-4 w-4" />
              {toast}
            </div>
          )}
        </FullscreenContent>
      </Dialog>

      <AprovarPPDialog
        open={aprovarAberto}
        onOpenChange={setAprovarAberto}
        pp={{
          id: pp.id,
          codigo: pp.codigo,
          valor: pp.valor,
          vencimentoOriginal: pp.parcelas[0]?.data_vencimento ?? pp.prazo_pagamento,
          parcelas: Math.max(pp.parcelas.length, 1),
        }}
        cartoes={cartoes}
        tipos={tipos}
        subtipos={subtipos}
        onAprovada={handleAprovada}
      />

      {/* `z-[60]`: aberto de dentro da tela cheia, que está em `z-[55]`. */}
      <ConfirmDialog
        contentClassName="z-[60]"
        overlayClassName="z-[60]"
        open={askRejeitar}
        onOpenChange={(o) => {
          setAskRejeitar(o);
          if (!o) setMotivo("");
        }}
        title={`Rejeitar ${pp.codigo}?`}
        description={
          <div className="space-y-2">
            <p>
              A PP volta pro gerente do job, que vê o motivo, corrige e reenvia para
              avaliação. O item continua reservado — não vira uma PP nova.
            </p>
            <div>
              <label htmlFor="pp-tela-motivo" className="text-xs font-medium">
                Motivo * (mín. 10 caracteres)
              </label>
              <textarea
                id="pp-tela-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={500}
                rows={3}
                className="mt-1 w-full rounded border border-border p-2 text-sm"
                placeholder="Ex: valor 3,6% acima do planejado. Renegociar com o fornecedor ou anexar aprovação do cliente antes de reenviar."
              />
            </div>
          </div>
        }
        confirmLabel="Rejeitar"
        variant="destructive"
        pending={pending}
        confirmDisabled={motivo.trim().length < 10}
        confirmDisabledReason={
          motivo.trim().length < 10
            ? "Escreva o motivo (mín. 10 caracteres) para liberar a rejeição."
            : undefined
        }
        onConfirm={handleConfirmarRejeitar}
      />

      {pp.verba_producao && (
        <PrestarContasDialog
          open={prestarOpen}
          onOpenChange={setPrestarOpen}
          pp={{ id: pp.id, codigo: pp.codigo, valor: pp.valor, servico: pp.servico }}
          tenantId={tenantId}
          onSuccess={() => {
            setPrestarOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/** A coluna do dossiê recolhida: 34px que guardam o rótulo e o caminho de volta. */
function Calha({ onAbrir }: { onAbrir: () => void }) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      title="Mostrar os dados da PP"
      aria-label="Mostrar os dados da PP"
      className="hidden min-h-0 flex-col items-center gap-3 rounded-2xl bg-white py-3 text-muted-foreground transition-colors hover:text-california-red lg:flex"
    >
      <ChevronLeft className="h-4 w-4 flex-none" />
      <span
        className="text-[10px] font-bold uppercase tracking-wider"
        style={{ writingMode: "vertical-rl" }}
      >
        Dados da PP
      </span>
    </button>
  );
}

function PainelDocumento({
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
  oculto: boolean;
  url: string | null;
  nomeArquivo: string;
  expandido: boolean;
  onExpandir: () => void;
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
      <div className="flex flex-none items-center gap-2 border-b border-border px-3 py-2">
        {icone}
        <span className="text-xs font-bold">{titulo}</span>
        {extra}
        <span className="ml-auto min-w-0 truncate text-[11px] text-muted-foreground">
          {legenda}
        </span>

        {/* Zoom, impressão e busca são do visualizador do navegador, dentro
            do `<iframe>`. O que ele não dá é sair do lado a lado, salvar com
            o nome certo e abrir numa aba inteira — vai aqui. */}
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
