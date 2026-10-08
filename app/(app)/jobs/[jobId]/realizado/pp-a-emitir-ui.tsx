"use client";

/**
 * A PP a emitir no painel do item (decisão 153, 07/10/2026): o selo no lugar
 * do código, a faixa da pré-abertura, a revisão antes de gerar e o envio ao
 * financeiro com os documentos do fornecedor (decisão 152). O desenho é o do
 * protótipo aprovado pelo Tiago ("Etapa antes da PP", v17).
 */

import * as React from "react";
import { AlertTriangle, Columns2, Lock, Pencil, Send, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatCurrency } from "@/lib/utils";
import {
  documentoTipoLabel,
  type AnexoDaPPNaLista,
  type PPAEmitir,
} from "@/lib/types";
import {
  enviarPedidoCompraAoFinanceiro,
  prefixoAnexosPedidoCompra,
  signedUrlAnexo,
  type AcimaDoPlanejado,
} from "./actions-pp";
import { ConferenciaDosDocumentos } from "./conferencia-dos-documentos";
import {
  ListaDeAnexos,
  NfDoAnexo,
  ResumoDasNfs,
  ZonaDeAnexos,
  anexoEmEdicao,
  anexoParaEnvio,
  faltaNosAnexosParaEnviar,
  faltasDaNf,
  itensDaLista,
  notaExistenteDe,
  parteDaNf,
  useAnexosEmEdicao,
  useNotasExistentes,
  type TomadorDaNf,
} from "./anexos-da-pp";
import { CorrigirNfDialog } from "./corrigir-nf-da-pp";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// ---------------------------------------------------------------------------
// A pré-abertura: só PP a emitir
// ---------------------------------------------------------------------------

/** Por que o job só aceita PP a emitir (null = gera e envia normalmente). */
export function textoAguardaAbertura(status: string): string | null {
  if (status === "aguardando_abertura") {
    return "O financeiro ainda não abriu este job: por enquanto, só PPs a emitir. Gerar e enviar a PP voltam com a abertura.";
  }
  if (status === "rejeitado_financeiro") {
    return "O financeiro devolveu este job: por enquanto, só PPs a emitir. Gerar e enviar a PP voltam quando a abertura for aprovada.";
  }
  return null;
}

export function FaixaAguardaAbertura({ texto }: { texto: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
      <p className="text-[11.5px] leading-relaxed text-amber-800">{texto}</p>
    </div>
  );
}

/** O selo no lugar do código: a PP só ganha código ao ser gerada. */
export function SeloPPAEmitir({ refaz }: { refaz: string | null }) {
  return (
    <span className="inline-flex flex-none items-center gap-1.5">
      <span className="inline-flex flex-none items-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10.5px] font-bold text-slate-600">
        PP a emitir
      </span>
      {refaz && (
        <span className="inline-flex items-center rounded-md bg-red-50 px-1.5 py-0.5 text-[10.5px] font-bold text-red-700">
          Refaz a <span className="ml-1 font-mono">{refaz}</span>
        </span>
      )}
    </span>
  );
}

const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const fator = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

// ---------------------------------------------------------------------------
// A revisão antes de gerar
// ---------------------------------------------------------------------------

/**
 * "Gerar o Pedido de Produção?" — sempre antes de gerar, venha do
 * formulário ou do painel (Tiago, 06/10/2026). Mostra o que a PP vai ser e
 * o item depois dela; Voltar fica no canto inferior esquerdo, Editar
 * reabre o formulário e Gerar PP gera.
 */
export function RevisaoDialog({
  open,
  onOpenChange,
  aEmitir,
  nomeDoFornecedor,
  nomeDaEmpresa,
  tomadores,
  planejado,
  emitidasAntes,
  moeda,
  pending,
  erro,
  onFecharErro,
  onGerar,
  onEditar,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  aEmitir: PPAEmitir | null;
  nomeDoFornecedor: string;
  nomeDaEmpresa: string;
  tomadores: TomadorDaNf[];
  /** Planejado do item: só o aviso de "acima do planejado" o usa. */
  planejado: number;
  /** "Em PPs emitidas" do item antes desta PP (a PP a emitir não conta). */
  emitidasAntes: number;
  moeda: string;
  pending: boolean;
  erro: string | null;
  onFecharErro: () => void;
  onGerar: () => void;
  /** Reabre o formulário da PP a emitir. */
  onEditar: () => void;
}) {
  if (!aEmitir) return null;
  const d = aEmitir.dados;
  const nfs = aEmitir.anexos.filter((a) => a.documento_tipo === "nota_fiscal");
  const nfCompleta =
    nfs.length > 0 &&
    nfs.every(
      (a) => (a.documento_numero ?? "").trim() && a.nf_data_emissao && (a.nf_valor ?? 0) > 0 && a.nf_tomador_estabelecimento_id,
    );
  const novoTotal = Math.round((emitidasAntes + aEmitir.valor) * 100) / 100;
  const acima = Math.round((novoTotal - planejado) * 100) / 100;
  const parcelas = Math.max(d.parcelas.length, 1);
  const linhas: Array<[string, React.ReactNode]> = [
    ...(aEmitir.refaz
      ? ([
          [
            "Substitui",
            <span key="s">
              <span className="font-mono">{aEmitir.refaz.codigo}</span>, rejeitada e cancelada
            </span>,
          ],
        ] as Array<[string, React.ReactNode]>)
      : []),
    [d.verba_producao ? "Responsável" : "Fornecedor", nomeDoFornecedor],
    ["Serviço", d.servico],
    [
      "Valor",
      <span key="v" className="font-mono">
        {formatCurrency(d.valor_unitario, moeda)} × {fator(d.quantidade)} × {fator(d.dias_meses)} ={" "}
        <b>{formatCurrency(aEmitir.valor, moeda)}</b>
      </span>,
    ],
    ["Empresa emissora", nomeDaEmpresa],
    [
      "Pagamento",
      `${parcelas > 1 ? `${parcelas} parcelas, a 1ª em` : "Parcela única em"} ${dataBr(d.parcelas[0]?.data_vencimento ?? d.prazo_pagamento)}`,
    ],
    [
      "Anexos",
      aEmitir.anexos.length === 0
        ? "Nenhum"
        : aEmitir.anexos
            .map((a) => `${a.documento_tipo ? documentoTipoLabel(a.documento_tipo) : "sem tipo"} · ${a.arquivo_nome_original}`)
            .join("; "),
    ],
    ...(d.verba_producao
      ? []
      : ([
          [
            "Nota fiscal",
            nfCompleta ? (
              <span key="nf" className="flex flex-col gap-0.5">
                {nfs.map((a) => (
                  <span key={a.id}>
                    NF <span className="font-mono">{a.documento_numero}</span> · {dataBr(a.nf_data_emissao ?? "")} ·{" "}
                    <span className="font-mono">{formatCurrency(a.nf_valor ?? 0, moeda)}</span> ·{" "}
                    {tomadores.find((t) => t.id === a.nf_tomador_estabelecimento_id)?.nome ?? "—"}
                    {/* Decisão 152: a NF que cobre outra PP mostra a parte desta. */}
                    {a.nf_valor_na_pp != null && a.nf_valor_na_pp !== a.nf_valor && (
                      <>
                        {" "}· <span className="font-mono">{formatCurrency(a.nf_valor_na_pp, moeda)}</span> nesta PP
                      </>
                    )}
                  </span>
                ))}
              </span>
            ) : (
              <span key="nf" className="text-muted-foreground">
                Ainda sem os dados da nota — são pedidos no envio ao financeiro.
              </span>
            ),
          ],
        ] as Array<[string, React.ReactNode]>)),
  ];
  const linhaDoTotal = (rotulo: string, valor: React.ReactNode, forte?: boolean, cor?: string) => (
    <div className="flex items-baseline justify-between gap-2.5">
      <span className={cn("text-[11.5px]", forte ? "font-semibold text-foreground" : "text-muted-foreground")}>
        {rotulo}
      </span>
      <span className={cn("font-mono", forte ? "text-[13px] font-bold" : "text-[12.5px]", cor)}>{valor}</span>
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <DialogTitle className="text-[17px]">Gerar o Pedido de Produção?</DialogTitle>
          <DialogDescription className="text-[12.5px] leading-relaxed">
            Depois de gerada, a PP não se edita mais. Para mudar algo, só cancelando e gerando outra. Confira:
          </DialogDescription>
        </DialogHeader>
        {erro && (
          <div className="mx-6 mt-4 flex items-start justify-between gap-2 rounded-lg border border-california-red/40 bg-california-red/5 px-3 py-2 text-[12.5px] text-california-red">
            <span>{erro}</span>
            <button type="button" onClick={onFecharErro} aria-label="Fechar aviso">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-3 gap-y-2 px-6 pt-4 text-[12.5px]">
          {linhas.map(([r, v]) => (
            <React.Fragment key={r}>
              <dt className="text-muted-foreground">{r}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </React.Fragment>
          ))}
        </dl>
        {/* O item depois desta PP: o mesmo "Em PPs emitidas" do painel. O
            planejado saiu da conta (Tiago, 07/10/2026); só o aviso de
            "acima do planejado" o usa. */}
        <div className="px-6 pb-4 pt-3">
          <div className="flex flex-col gap-1.5 rounded-[11px] border border-border bg-muted/40 px-3 py-2.5">
            {linhaDoTotal("PPs já emitidas nesse item", formatCurrency(emitidasAntes, moeda))}
            {linhaDoTotal("Esta PP", `+ ${formatCurrency(aEmitir.valor, moeda)}`)}
            <div className="my-0.5 border-t border-border" />
            {linhaDoTotal(
              "Novo total em PPs emitidas",
              formatCurrency(novoTotal, moeda),
              true,
              acima > 0.004 ? "text-california-red" : undefined,
            )}
          </div>
          {acima > 0.004 && (
            <p className="mt-2 flex items-start gap-1.5 text-[11.5px] font-semibold leading-snug text-california-red">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />O item fica {formatCurrency(acima, moeda)} acima
              do planejado.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-6 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Voltar
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onEditar}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-50"
            >
              <Pencil className="h-3.5 w-3.5" />
              Editar
            </button>
            <button
              type="button"
              onClick={onGerar}
              disabled={pending}
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
            >
              {pending ? "Gerando…" : "Gerar PP"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// O envio ao financeiro, com os documentos do fornecedor
// ---------------------------------------------------------------------------

/** A PP gerada, no que o envio precisa. */
export interface PPParaEnviar {
  id: string;
  codigo: string;
  /** O CNPJ da PP (decisão 156): o tomador esperado das notas. */
  estabelecimentoId: string | null;
  valor: number;
  servico: string;
  fornecedorId: string | null;
  verbaProducao: boolean;
  anexos: AnexoDaPPNaLista[];
}

/**
 * A PP gerada não se edita, mas a nota do fornecedor costuma chegar depois
 * dela: o envio é onde os documentos entram. Todo campo é obrigatório aqui
 * — o tipo de cada arquivo, o número dos documentos e os dados de cada NF.
 * Acima do planejado, o "tem certeza?" vem antes de gravar.
 */
export function EnvioDialog({
  pp,
  onOpenChange,
  nomeDoFornecedor,
  nomeDaEmpresa,
  tomadores,
  tomadorEsperado,
  tomadorPorEmpresa,
  nomeDaEmpresaDe,
  moeda,
  onEnviada,
}: {
  pp: PPParaEnviar | null;
  onOpenChange: (o: boolean) => void;
  nomeDoFornecedor: string;
  nomeDaEmpresa: string;
  tomadores: TomadorDaNf[];
  /** O CNPJ tomador da empresa emissora — sugerido e conferido nas notas. */
  tomadorEsperado: string | null;
  /** Para corrigir outra PP com a mesma nota (revisão da decisão 152). */
  tomadorPorEmpresa: Record<string, string>;
  nomeDaEmpresaDe: (empresaId: string) => string;
  moeda: string;
  onEnviada: (codigo: string) => void;
}) {
  const [prefixo, setPrefixo] = React.useState<string | null>(null);
  const { anexos, setAnexos, subir, remover, mudar, mudarNf, aviso, setAviso } = useAnexosEmEdicao(
    prefixo,
    tomadorEsperado,
  );
  const [tentou, setTentou] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [confirmando, setConfirmando] = React.useState<AcimaDoPlanejado | null>(null);
  const [pending, startTransition] = React.useTransition();
  /** A outra PP com a mesma nota, em correção (revisão da decisão 152). */
  const [corrigindo, setCorrigindo] = React.useState<{ id: string; codigo: string } | null>(null);
  const [versaoDasNotas, setVersaoDasNotas] = React.useState(0);
  /** Decisão 156: notas em outro CNPJ que não o da PP — o "tem certeza?". */
  const [tomadorPergunta, setTomadorPergunta] = React.useState<Array<{ numero: string; tomador: string }> | null>(null);
  const [tomadorConfirmado, setTomadorConfirmado] = React.useState(false);
  /** A PP e os documentos lado a lado (decisão 153, entrega 3), aberta num
   *  documento. */
  const [ladoALado, setLadoALado] = React.useState<{ foco: string | null } | null>(null);

  // Cada abertura começa no que a PP tem gravado.
  const ppId = pp?.id ?? null;
  React.useEffect(() => {
    if (!pp) return;
    setTentou(false);
    setErro(null);
    setConfirmando(null);
    setCorrigindo(null);
    setTomadorPergunta(null);
    setTomadorConfirmado(false);
    setLadoALado(null);
    setAviso(null);
    setAnexos(pp.anexos.map((a) => anexoEmEdicao(a, tomadorEsperado)));
    setPrefixo(null);
    let vivo = true;
    prefixoAnexosPedidoCompra(pp.id).then((res) => {
      if (!vivo) return;
      if (res.ok) setPrefixo(res.upload_prefix);
      else setErro(res.message);
    });
    return () => {
      vivo = false;
    };
    // Só quando outra PP abre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ppId]);

  const numerosDasNfs = anexos.filter((a) => a.tipo === "nota_fiscal").map((a) => a.nf.numero);
  const existentes = useNotasExistentes(pp?.fornecedorId ?? null, numerosDasNfs, pp?.id ?? null, versaoDasNotas);

  if (!pp) return null;

  function enviar(confirmado: boolean, tomadorOk: boolean = tomadorConfirmado) {
    if (!pp) return;
    setTentou(true);
    const falta = faltaNosAnexosParaEnviar(anexos, pp.valor, existentes);
    if (falta && !pp.verbaProducao) {
      setErro(falta);
      return;
    }
    // Decisão 156: nota em outro CNPJ não barra — pede o "tem certeza?".
    const emOutroCnpj =
      !pp.verbaProducao && pp.estabelecimentoId
        ? anexos
            .filter((a) => a.status === "ok" && a.tipo === "nota_fiscal" && a.nf.tomador && a.nf.tomador !== pp.estabelecimentoId)
            .map((a) => ({ numero: a.nf.numero.trim(), tomador: a.nf.tomador }))
        : [];
    if (emOutroCnpj.length > 0 && !tomadorOk) {
      setTomadorPergunta(emOutroCnpj);
      return;
    }
    setErro(null);
    const alvo = pp;
    startTransition(async () => {
      const res = await enviarPedidoCompraAoFinanceiro(
        alvo.id,
        confirmado,
        anexos.filter((a) => a.status === "ok").map(anexoParaEnvio),
        tomadorOk,
      );
      if (!res.ok) {
        if (res.tomadorDiferente) {
          setTomadorPergunta(res.tomadorDiferente.notas);
          return;
        }
        if (res.acimaDoPlanejado) {
          setConfirmando(res.acimaDoPlanejado);
          return;
        }
        setConfirmando(null);
        setErro(res.message);
        return;
      }
      setConfirmando(null);
      onEnviada(res.codigo);
    });
  }

  const nfsDaLista = anexos.filter((a) => a.status === "ok" && a.tipo === "nota_fiscal");

  /** Os campos da NF de um arquivo — na lista e, `compacta`, na coluna da
   *  tela lado a lado. */
  function camposDaNf(id: string, compacta: boolean) {
    if (!pp) return null;
    const a = anexos.find((x) => x.id === id);
    if (!a) return null;
    return (
      <NfDoAnexo
        nf={a.nf}
        onMudar={(parte) => mudarNf(id, parte)}
        faltas={tentou ? faltasDaNf(a.nf, pp.valor) : []}
        idBase={`${compacta ? "conferencia" : "envio"}-${id}`}
        tomadores={tomadores}
        tomadorEsperado={tomadorEsperado}
        empresaNome={nomeDaEmpresa}
        existente={notaExistenteDe(existentes, a.nf.numero)}
        valorPP={pp.valor}
        onCorrigirOutraPP={setCorrigindo}
        obrigatorio
        compacta={compacta}
        disabled={pending}
        anexoPath={a.path || null}
        anexoMimetype={a.mime}
        fornecedorAtualNome={nomeDoFornecedor}
      />
    );
  }

  const botaoEnviar = (
    <button
      type="button"
      onClick={() => enviar(confirmando !== null)}
      disabled={pending || (!pp.verbaProducao && prefixo === null)}
      className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
    >
      <Send className="h-3.5 w-3.5" />
      {pending ? "Enviando…" : confirmando ? "Sim, enviar" : "Enviar ao financeiro"}
    </button>
  );
  const textoAcimaDoPlanejado = confirmando ? (
    <>
      Enviar PP acima do planejado? Este item está com {formatCurrency(confirmando.emPPsDepois, moeda)} em PPs,{" "}
      {formatCurrency(confirmando.excedente, moeda)} acima do planejado de {formatCurrency(confirmando.planejado, moeda)}.
      Enviar {pp.codigo} ao financeiro é registrado no seu nome.
    </>
  ) : null;

  return (
    <Dialog open onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-w-[680px] gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <DialogTitle className="text-[17px]">
            Enviar <span className="font-mono">{pp.codigo}</span> ao financeiro
          </DialogTitle>
          <DialogDescription className="text-[12.5px] leading-relaxed">
            {nomeDoFornecedor} · <span className="font-mono">{formatCurrency(pp.valor, moeda)}</span> · {pp.servico}. A
            PP não muda mais; aqui entram os documentos do fornecedor. Todos os campos são obrigatórios para enviar.
          </DialogDescription>
        </DialogHeader>
        <div className="relative max-h-[70vh] space-y-3 overflow-y-auto px-6 py-4">
          {(erro || aviso) && (
            <div className="flex items-start justify-between gap-2 rounded-lg border border-california-red/40 bg-california-red/5 px-3 py-2 text-[12.5px] text-california-red">
              <span>{erro ?? aviso}</span>
              <button
                type="button"
                onClick={() => {
                  setErro(null);
                  setAviso(null);
                }}
                aria-label="Fechar aviso"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {!pp.verbaProducao && (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Anexos</p>
                {/* Decisão 153, entrega 3: a PP e os documentos lado a lado,
                    como no Contas a Pagar. */}
                <button
                  type="button"
                  onClick={() => setLadoALado({ foco: itensDaLista(anexos)[0]?.id ?? null })}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
                >
                  <Columns2 className="h-3.5 w-3.5" />
                  Ver PP e documentos lado a lado
                </button>
              </div>
              <ZonaDeAnexos id={`envio-arquivos-${pp.id}`} pronto={prefixo !== null} onArquivos={subir} />
              <ListaDeAnexos
                itens={itensDaLista(anexos)}
                onTipo={(id, t) => mudar(id, { tipo: t })}
                onNumero={(id, numero) => mudar(id, { numero })}
                onRemover={remover}
                tipoInvalido={(id) => tentou && !anexos.find((a) => a.id === id)?.tipo}
                obrigatorio
                numeroInvalido={(id) => {
                  const a = anexos.find((x) => x.id === id);
                  return tentou && !!a && a.tipo !== "nota_fiscal" && !(a.numero ?? "").trim();
                }}
                disabled={pending}
                onVer={(id) => setLadoALado({ foco: id })}
                renderNf={(id) => camposDaNf(id, false)}
              />
              <ResumoDasNfs valores={nfsDaLista.map((a) => parteDaNf(a.nf))} valorPP={pp.valor} />
            </>
          )}

          {/* "Tem certeza?" acima do planejado — antes de gravar. */}
          {confirmando && (
            <div className="rounded-xl border border-california-red/30 bg-california-red/5 px-4 py-3">
              <p className="flex items-center gap-2 text-[13px] font-bold">
                <AlertTriangle className="h-4 w-4 text-california-red" />
                Enviar PP acima do planejado?
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                Este item está com {formatCurrency(confirmando.emPPsDepois, moeda)} em PPs,{" "}
                {formatCurrency(confirmando.excedente, moeda)} acima do planejado de{" "}
                {formatCurrency(confirmando.planejado, moeda)}. Enviar {pp.codigo} ao financeiro é registrado no seu nome.
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-6 py-3">
          <button
            type="button"
            onClick={() => (confirmando ? setConfirmando(null) : onOpenChange(false))}
            disabled={pending}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Voltar
          </button>
          {botaoEnviar}
        </div>
        {/* Decisão 156: a nota em outro CNPJ que não o da PP — o financeiro
            decide na aprovação. */}
        <ConfirmDialog
          open={tomadorPergunta !== null}
          onOpenChange={(o) => !o && setTomadorPergunta(null)}
          title="Enviar com a nota em outro CNPJ?"
          description={
            <>
              {(tomadorPergunta ?? []).map((n, i) => (
                <React.Fragment key={`${n.numero}-${i}`}>
                  {i > 0 && " "}A NF {n.numero} está no CNPJ{" "}
                  <strong className="text-foreground">{tomadores.find((t) => t.id === n.tomador)?.nome ?? "—"}</strong>.
                </React.Fragment>
              ))}{" "}
              A PP é do CNPJ{" "}
              <strong className="text-foreground">{tomadores.find((t) => t.id === pp.estabelecimentoId)?.nome ?? "—"}</strong>. O
              financeiro decide na aprovação.
            </>
          }
          confirmLabel="Sim, enviar"
          cancelLabel="Voltar"
          variant="destructive"
          pending={pending}
          contentClassName="z-[60]"
          overlayClassName="z-[60]"
          onConfirm={() => {
            setTomadorConfirmado(true);
            setTomadorPergunta(null);
            enviar(confirmando !== null, true);
          }}
        />
        {/* Decisão 153, entrega 3: a PP, os documentos e os dados lado a
            lado. O estado é o deste envio: o que se preenche lá aparece aqui. */}
        {!pp.verbaProducao && (
          <ConferenciaDosDocumentos
            open={ladoALado !== null}
            onOpenChange={(o) => !o && setLadoALado(null)}
            codigo={pp.codigo}
            selo="Gerada"
            descricao="Pedido, documentos e dados — lado a lado"
            ppIdDoPdf={pp.id}
            anexos={anexos}
            focar={ladoALado?.foco ?? null}
            urlDoGravado={signedUrlAnexo}
            prontoParaAnexar={prefixo !== null}
            onArquivos={subir}
            onTipo={(id, t) => mudar(id, { tipo: t })}
            onNumero={(id, numero) => mudar(id, { numero })}
            onRemover={remover}
            renderNf={(id) => camposDaNf(id, true)}
            mostrarFaltas={tentou}
            obrigatorio
            valorPP={pp.valor}
            moeda={moeda}
            aviso={textoAcimaDoPlanejado ?? erro ?? aviso}
            onFecharAviso={() => {
              if (confirmando) setConfirmando(null);
              setErro(null);
              setAviso(null);
            }}
            rodapeEsquerda={
              <>
                {nomeDoFornecedor} ·{" "}
                <strong className="font-semibold text-white">{formatCurrency(pp.valor, moeda)}</strong> · todos os campos
                são obrigatórios para enviar
              </>
            }
            rodape={
              <>
                <button
                  type="button"
                  onClick={() => setLadoALado(null)}
                  className="rounded-lg border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/20"
                >
                  Voltar ao resumo
                </button>
                {botaoEnviar}
              </>
            }
            disabled={pending}
          />
        )}
        {/* A outra PP com a mesma nota, corrigida daqui: a nota volta a ser
            buscada e o que sobra dela para esta PP se atualiza. */}
        <CorrigirNfDialog
          alvo={corrigindo}
          onOpenChange={(o) => !o && setCorrigindo(null)}
          fornecedorNome={nomeDoFornecedor}
          nomeDaEmpresa={nomeDaEmpresaDe}
          tomadores={tomadores}
          tomadorPorEmpresa={tomadorPorEmpresa}
          onCorrigida={() => {
            setCorrigindo(null);
            setErro(null);
            setVersaoDasNotas((v) => v + 1);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
