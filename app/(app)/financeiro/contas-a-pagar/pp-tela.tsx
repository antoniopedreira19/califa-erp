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
 *
 * Módulo fiscal (02/10/2026): o desenho não muda. A tela passa a guardar a
 * NF do fornecedor em conferência — a coluna "Dados da PP" edita, ao lado
 * da nota, e o pop-up de aprovação usa (base das retenções e mês do
 * crédito de PIS/COFINS).
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
  FileText,
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
import {
  PainelDocumento,
  VazioDoPainel as Vazio,
  enderecoParaVisualizar,
} from "@/components/documentos/painel-documento";
import { cn, formatCurrency } from "@/lib/utils";
import { ppStatusLabel, situacaoDaVerba, type PPStatus } from "@/lib/types";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import type { PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import type { FiscalDaAprovacaoPP } from "@/lib/fiscal/aprovacao-da-pp";
import { nfInicial, type NfEmConferencia, type RegistroDaNota } from "@/lib/fiscal/nf-da-pp";
import type { PPRow } from "./pedidos-compra-list";
import { PPDossie, type AbaDossie } from "./pp-dossie";
import { AprovarPPDialog } from "./aprovar-pp-dialog";
import { AprovarPrestacaoDialog } from "./aprovar-prestacao-dialog";
import { ultimaCorrecaoDaNf, ultimoEnvioDaPP, ultimoEnvioDaPrestacao } from "@/lib/data/eventos-da-pp";
import {
  reprovarPrestacaoVerba,
  signedUrlAnexoPrestacao,
} from "./prestacao-verba-actions";
import { SituacaoVerbaChip } from "@/components/financeiro/situacao-verba-chip";
import { rejeitarPedidoCompraFinanceiro, reprovarPPAprovada } from "./actions";
import {
  signedUrlPdf,
  signedUrlAnexo,
} from "@/app/(app)/jobs/[jobId]/realizado/actions-pp";

/** Qual painel está sozinho na tela. `null` = os três juntos. */
type Expandido = "pp" | "anexo" | null;

export function PPTela({
  pp,
  open,
  onOpenChange,
  cartoes,
  tipos,
  subtipos,
  fiscal,
}: {
  pp: PPRow | null;
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  tenantId: string;
  cartoes: CartaoOption[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  /** Módulo fiscal: cadastro de impostos, notas dos jobs e últimas retenções. */
  fiscal: FiscalDaAprovacaoPP;
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
  const [aprovarPrestacaoAberto, setAprovarPrestacaoAberto] = React.useState(false);
  const [askReprovar, setAskReprovar] = React.useState(false);
  // Reprovar a PP APROVADA (decisão 083) — motivo próprio, para não
  // dividir estado com a reprovação da prestação da verba.
  const [askReprovarPP, setAskReprovarPP] = React.useState(false);
  const [motivoPP, setMotivoPP] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  // Módulo fiscal: as NFs do fornecedor em conferência, uma por anexo do
  // tipo NF (decisão 152). Moram aqui, e não no dossiê nem no pop-up,
  // porque os dois as usam: o dossiê edita, ao lado da nota; o pop-up tira
  // delas a base das retenções e o mês do crédito. Enquanto ninguém editou
  // vale o que está na PP (a nota do cadastro, ou o que a produção
  // informou); o `ppId` impede que as notas de uma PP apareçam na outra.
  const [nfsEditadas, setNfsEditadas] = React.useState<{
    ppId: string;
    porAnexo: Record<string, NfEmConferencia>;
  } | null>(null);

  const ppId = pp?.id ?? null;
  // Na verba com prestação, o painel do meio mostra os documentos da
  // prestação: a PP de verba não tem anexo próprio (decisão 081).
  const documentosDaPrestacao =
    pp?.verba_producao && pp.prestacao ? pp.prestacao.documentos : null;
  const ehPrestacao = documentosDaPrestacao != null;
  const listaDocumentos = documentosDaPrestacao ?? pp?.anexos ?? [];
  const anexo = listaDocumentos[anexoAtivo] ?? null;
  const anexoId = anexo?.id ?? null;

  React.useEffect(() => {
    if (!open) return;
    setAnexoAtivo(0);
    setExpandido(null);
    setAba("dados");
    setErro(null);
    setMotivo("");
  }, [open, ppId]);

  // Fechar a tela descarta a NF que não foi aprovada: a próxima abertura
  // volta ao que está na PP. Zera ao FECHAR, e não ao abrir, porque o
  // DatePicker da emissão só lê o valor quando monta — zerado depois de
  // abrir, ele ficaria com a data da abertura anterior.
  React.useEffect(() => {
    if (!open) setNfsEditadas(null);
  }, [open]);

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
      const res = ehPrestacao
        ? await signedUrlAnexoPrestacao(anexoId)
        : await signedUrlAnexo(anexoId);
      if (cancelado) return;
      if (res.ok) setUrlAnexo(res.url);
      else setErro(res.message);
      setCarregandoAnexo(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [open, anexoId, ehPrestacao]);

  if (!pp) return null;

  const emAvaliacao = pp.status === "em_avaliacao";
  const aprovada = pp.status === "aprovada";
  const situacao = situacaoDaVerba(pp);
  const prestacaoEmAvaliacao =
    pp.verba_producao && pp.prestacao?.status === "em_avaliacao";
  const anexoEhImagem =
    anexo != null && /\.(png|jpe?g|webp|gif)$/i.test(anexo.arquivo_nome_original);
  // Módulo fiscal: as NFs desta PP como estão na conferência (null = a PP
  // não tem NF anexada, ou é verba de produção).
  // Decisão 156: a nota é do CNPJ da PP, não da empresa gerencial.
  const tomadorPadrao =
    pp.estabelecimento_id ?? fiscal.tomadorPadraoPorEmpresa[pp.empresa_id] ?? fiscal.tomadorPadraoGeral;
  const editadasDestaPP = nfsEditadas?.ppId === pp.id ? nfsEditadas.porAnexo : {};
  const nfsDaTela: NfEmConferencia[] | null = pp.notas_fiscais
    ? pp.notas_fiscais.notas.map(
        (n) => editadasDestaPP[n.anexo_id] ?? nfInicial(n, tomadorPadrao),
      )
    : null;
  // A nota que outra PP já registrou: o crédito e o ISS retido dela já
  // estão na Apuração. A registrada por esta mesma PP (aprovação que falhou
  // depois de gravar as notas) volta a ser decidida aqui.
  const registroDeOutraPP: Record<string, RegistroDaNota | null> = Object.fromEntries(
    (pp.notas_fiscais?.notas ?? []).map((n) => [
      n.anexo_id,
      n.registrada && n.registrada.na_pp !== pp.codigo ? n.registrada : null,
    ]),
  );
  function editarNota(nf: NfEmConferencia) {
    if (!pp) return;
    const id = pp.id;
    setNfsEditadas((antes) => ({
      ppId: id,
      porAnexo: { ...(antes?.ppId === id ? antes.porAnexo : {}), [nf.anexo_id]: nf },
    }));
  }

  function handleAprovada(mensagem: string) {
    setAprovarAberto(false);
    setToast(mensagem);
    router.refresh();
    setTimeout(() => onOpenChange(false), 1200);
  }

  function handleConfirmarReprovarPP() {
    if (!pp) return;
    startTransition(async () => {
      const res = await reprovarPPAprovada({ pp_id: pp.id, motivo: motivoPP });
      if (!res.ok) {
        setErro(res.message);
        setAskReprovarPP(false);
        return;
      }
      setAskReprovarPP(false);
      setMotivoPP("");
      setToast(`${pp.codigo} reprovada — voltou para a produção corrigir ou cancelar.`);
      router.refresh();
      setTimeout(() => onOpenChange(false), 1200);
    });
  }

  function handleConfirmarReprovar() {
    if (!pp) return;
    startTransition(async () => {
      const res = await reprovarPrestacaoVerba({ pp_id: pp.id, motivo });
      if (!res.ok) {
        setErro(res.message);
        setAskReprovar(false);
        return;
      }
      setAskReprovar(false);
      setMotivo("");
      setToast(`Prestação de ${res.codigo} reprovada — voltou para a produção corrigir.`);
      router.refresh();
      setTimeout(() => onOpenChange(false), 1200);
    });
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
            {situacao && <SituacaoVerbaChip situacao={situacao} />}
            {pp.urgente && (
              <Badge
                title={pp.urgente_justificativa ?? undefined}
                className="border-california-red bg-california-red uppercase tracking-wider text-white"
              >
                Urgente
              </Badge>
            )}
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
              titulo={ehPrestacao ? "Documentos da prestação" : "Documento anexo"}
              legenda={
                anexo?.arquivo_nome_original ??
                (ehPrestacao ? "Sem gasto" : "Nenhum anexo enviado")
              }
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
                listaDocumentos.length > 1 ? (
                  <div className="flex items-center gap-1">
                    {listaDocumentos.map((a, i) => (
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
                <Vazio
                  texto={
                    ehPrestacao
                      ? "Sem gasto: a produção devolve a verba inteira."
                      : "A produção não enviou documento nesta PP."
                  }
                />
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
                    onErro={setErro}
                    notas={pp.notas_fiscais}
                    nfs={nfsDaTela}
                    onNf={editarNota}
                    estabelecimentos={fiscal.cadastro.estabelecimentos}
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

          {aprovada && (
            <div className="flex flex-none flex-wrap items-center gap-2.5 pt-3">
              <span className="mr-auto text-xs text-white/70">
                Aprovada — já é título a pagar. A produção não cancela daqui:
                quem devolve a PP para ela é o financeiro.
              </span>
              <button
                type="button"
                onClick={() => setAskReprovarPP(true)}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/40 bg-white px-3.5 py-2 text-sm font-semibold text-california-red transition-colors hover:bg-california-red/5 disabled:opacity-50"
              >
                <Ban className="h-3.5 w-3.5" />
                Reprovar PP
              </button>
            </div>
          )}

          {prestacaoEmAvaliacao && pp.prestacao && (
            <div className="flex flex-none flex-wrap items-center gap-2.5 pt-3">
              <span className="mr-auto text-xs text-white/70">
                Prestação enviada
                {pp.prestacao.enviada_por_nome ? ` por ${pp.prestacao.enviada_por_nome}` : ""} ·
                gasto{" "}
                <strong className="font-semibold text-white">
                  {formatCurrency(pp.prestacao.valor_gasto, "BRL")}
                </strong>{" "}
                de {formatCurrency(pp.valor, "BRL")}
              </span>
              <button
                type="button"
                onClick={() => setAskReprovar(true)}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/40 bg-white px-3.5 py-2 text-sm font-semibold text-california-red transition-colors hover:bg-california-red/5 disabled:opacity-50"
              >
                <Ban className="h-3.5 w-3.5" />
                Reprovar prestação
              </button>
              <button
                type="button"
                onClick={() => setAprovarPrestacaoAberto(true)}
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
          pagamentoForaDoCadastro: pp.pagamento_fora_do_cadastro,
          envio: ultimoEnvioDaPP(pp.eventos),
          correcaoDaNf: ultimaCorrecaoDaNf(pp.eventos),
          cnpjDaPP: fiscal.cadastro.estabelecimentos.find((e) => e.id === pp.estabelecimento_id) ?? null,
          emitidaPorNome: pp.emitida_por_nome,
          gpResponsavelNome: pp.job_responsavel_nome,
          // Módulo fiscal: o que as retenções e o crédito precisam.
          fornecedorNome: pp.fornecedor_nome,
          regimeDoFornecedor: pp.regime_do_fornecedor?.regime ?? null,
          nfs: nfsDaTela,
          registroDeOutraPP,
          ultimaRetencao: fiscal.ultimasRetencoes[pp.fornecedor_id] ?? null,
        }}
        cadastro={fiscal.cadastro}
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
              A produção vê o motivo e refaz a PP: esta é cancelada e volta como
              PP a emitir, para gerar uma PP nova, com outro código.
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

      <AprovarPrestacaoDialog
        open={aprovarPrestacaoAberto}
        onOpenChange={setAprovarPrestacaoAberto}
        prestacao={
          pp.prestacao
            ? {
                id: pp.id,
                codigo: pp.codigo,
                valor: pp.valor,
                gasto: pp.prestacao.valor_gasto,
                saldo: pp.prestacao.valor_devolvido,
                documentos: pp.prestacao.documentos.length,
                centroDeCusto:
                  tipos.find((t) => t.id === pp.plano_conta_tipo_id)?.nome ??
                  "Custo Operacional",
                // Sem evento (prestação anterior ao histórico), a coluna
                // da prestação ainda diz quem fechou e quando.
                envio: ultimoEnvioDaPrestacao(pp.eventos) ?? {
                  por_nome: pp.prestacao.enviada_por_nome,
                  em: pp.prestacao.enviada_em,
                  reenviada: false,
                },
                responsavelVerbaNome: pp.responsavel_nome,
                gpResponsavelNome: pp.job_responsavel_nome,
              }
            : null
        }
        onAprovada={(mensagem) => {
          setAprovarPrestacaoAberto(false);
          handleAprovada(mensagem);
        }}
      />

      {/* `z-[60]`: aberto de dentro da tela cheia, que está em `z-[55]`. */}
      <ConfirmDialog
        contentClassName="z-[60]"
        overlayClassName="z-[60]"
        open={askReprovar}
        onOpenChange={(o) => {
          setAskReprovar(o);
          if (!o) setMotivo("");
        }}
        title={`Reprovar a prestação de ${pp.codigo}?`}
        description={
          <div className="space-y-3">
            <p>
              A prestação volta para a produção, que vê o motivo, corrige os
              documentos e reenvia. Nenhum estorno é criado.
            </p>
            <div>
              <label htmlFor="pp-tela-motivo-prestacao" className="text-xs font-medium">
                Motivo * (mín. 10 caracteres)
              </label>
              <textarea
                id="pp-tela-motivo-prestacao"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={500}
                rows={3}
                className="mt-1 w-full rounded border border-border p-2 text-sm"
                placeholder="Ex: a NF 889 está ilegível e o recibo não tem data. Reenvie os dois."
              />
            </div>
          </div>
        }
        confirmLabel="Reprovar prestação"
        variant="destructive"
        pending={pending}
        confirmDisabled={motivo.trim().length < 10}
        confirmDisabledReason={
          motivo.trim().length < 10
            ? "Escreva o motivo (mín. 10 caracteres) para liberar a reprovação."
            : undefined
        }
        onConfirm={handleConfirmarReprovar}
      />

      {/* Reprovar a PP já aprovada (decisão 083). */}
      <ConfirmDialog
        contentClassName="z-[60]"
        overlayClassName="z-[60]"
        open={askReprovarPP}
        onOpenChange={(o) => {
          setAskReprovarPP(o);
          if (!o) setMotivoPP("");
        }}
        title={`Reprovar ${pp.codigo}?`}
        description={
          <div className="space-y-3">
            <p>
              A PP sai de Títulos a Pagar e volta para a produção, que vê o
              motivo e refaz a PP (com outro código) ou só a cancela. As datas escolhidas na
              aprovação são desfeitas; o vencimento negociado com o fornecedor
              fica.
            </p>
            <p className="text-xs text-muted-foreground">
              Parcela já paga ou em fatura de cartão fechada impede a
              reprovação — nesses casos, estorne a baixa ou reabra a fatura
              antes.
            </p>
            <div>
              <label htmlFor="pp-tela-motivo-pp" className="text-xs font-medium">
                Motivo * (mín. 10 caracteres)
              </label>
              <textarea
                id="pp-tela-motivo-pp"
                value={motivoPP}
                onChange={(e) => setMotivoPP(e.target.value)}
                maxLength={500}
                rows={3}
                className="mt-1 w-full rounded border border-border p-2 text-sm"
                placeholder="Ex: a produção pediu para segurar — o fornecedor mudou o escopo."
              />
            </div>
          </div>
        }
        confirmLabel="Reprovar PP"
        variant="destructive"
        pending={pending}
        confirmDisabled={motivoPP.trim().length < 10}
        confirmDisabledReason={
          motivoPP.trim().length < 10
            ? "Escreva o motivo (mín. 10 caracteres) para liberar a reprovação."
            : undefined
        }
        onConfirm={handleConfirmarReprovarPP}
      />
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

