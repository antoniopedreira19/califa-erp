"use client";

/**
 * A PP a emitir no painel do item (decisão 153, 07/10/2026): o selo no lugar
 * do código, a faixa da pré-abertura, a revisão antes de gerar e o envio ao
 * financeiro com os documentos do fornecedor (decisão 152). O desenho é o do
 * protótipo aprovado pelo Tiago ("Etapa antes da PP", v17).
 */

import * as React from "react";
import { resumoDoPagamentoDoTitular, textoDoPagamentoPeloCadastro } from "./pagamento-do-titular-field";
import { AlertTriangle, ClipboardCheck, Columns2, Lock, Pencil, Send, X } from "lucide-react";
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
  rotuloDaVerba,
  rotuloDeQuemRecebeAVerba,
  ROTULO_CARTAO_CORPORATIVO,
  type AnexoDaPPNaLista,
  type PPAEmitir,
} from "@/lib/types";
import {
  deixarPPProntaParaEnvio,
  enviarPedidoCompraAoFinanceiro,
  prefixoAnexosPedidoCompra,
  signedUrlAnexo,
  type AcimaDoPlanejado,
  type TrocaDeEmissora,
} from "./actions-pp";
import { ConferenciaDosDocumentos } from "./conferencia-dos-documentos";
import {
  CnpjDoDocumento,
  ListaDeAnexos,
  NfDoAnexo,
  ResumoDasNfs,
  ZonaDeAnexos,
  ExigidosNoEnvio,
  anexoEmEdicao,
  anexoParaEnvio,
  comprovanteDoReembolsoParaEnvio,
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
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import { TEXTO_ENVIO_AUDITORIA } from "@/app/(app)/jobs/_midia-system/midia-system";
import { CamposDoComprovante, ResumoDosComprovantes, comprovantesDosAnexos } from "./comprovantes-do-reembolso";
import {
  TIPOS_DE_COMPROVANTE,
  faltaNosComprovantesDoReembolso,
  resumoDosDeslocamentos,
  rotuloDoReembolso,
  type ReembolsoTipo,
} from "@/lib/calculos/reembolso";

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

/** A errata mudou a linha e a revisão da abertura ainda não foi salva
 *  (decisão 185): só as PPs desta linha esperam. */
export const TEXTO_LINHA_ALTERADA_EM_REVISAO =
  "A errata alterou esta linha e a abertura está em revisão no financeiro: o envio das PPs dela volta quando a revisão for salva.";

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
          Reemite a <span className="ml-1 font-mono">{refaz}</span>
        </span>
      )}
    </span>
  );
}

/**
 * O pop-up do "Editar e Reemitir PP" da rejeitada — no painel do item e na aba de
 * PPs. Revisão da 153 (19/10/2026): antes "Cancelar e refazer", que
 * começava por "é cancelada" e fez um produtor achar que perderia o
 * formulário. Agora começa pelo que fica.
 */
export function TextoDoReemitir({ codigo }: { codigo: string }) {
  return (
    <>
      O formulário volta preenchido, com os mesmos dados e anexos, para você ajustar o que o financeiro apontou. Ao
      gerar, sai uma PP nova, com outro código, no lugar da <strong className="text-foreground">{codigo}</strong>,
      que fica no histórico com o motivo da rejeição.
    </>
  );
}

/** O aviso enquanto o formulário abre na PP a emitir que voltou. */
export const TOAST_DO_REEMITIR = (codigo: string) =>
  `Os dados da ${codigo} voltaram no formulário. Ajuste o que o financeiro apontou e gere a PP nova.`;

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
 *
 * Decisão 173 (13/10/2026): a mesma revisão antes de salvar a edição de uma
 * PP gerada (`edicao`). Muda o título, o botão ("Salvar alterações") e a
 * linha "Esta PP", que mostra o valor de antes quando ele muda.
 *
 * Decisão 178 (15/10/2026): a linha "Nota fiscal" só aparece com arquivo
 * marcado NF. Antes ela aparecia em toda PP fora da verba e, com recibo ou
 * fatura, dizia que os dados da nota seriam pedidos no envio —
 * o que o envio não pede. "Anexos" mostra o número de cada documento.
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
  edicao = null,
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
  /** Decisão 173: a revisão da edição de uma PP gerada. Null = gerar. */
  edicao?: { codigo: string; valorAntes: number; prontaCai: boolean } | null;
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
  // Decisão 164: o tipo da verba e o nome de quem recebe. A PP a emitir de
  // antes dela não tem o tipo: é produção. Desde a 171 as três verbas têm
  // titular; só a de produção salva antes dela tem responsável.
  const tipoVerba = d.verba_producao ? (d.tipo_verba ?? aEmitir.tipo_verba ?? "producao") : null;
  // Decisão 187: o reembolso mora no campo da verba.
  const reembolso = tipoVerba === "reembolso";
  const reembolsoTipo: ReembolsoTipo = d.reembolso_tipo ?? "despesas";
  const rotuloDeQuemRecebe = !tipoVerba
    ? "Fornecedor"
    : aEmitir.verba_titular_tipo === "fornecedor"
      ? "Titular da verba (terceiro)"
      : rotuloDeQuemRecebeAVerba(aEmitir);
  // Decisão 193: de onde sai o pagamento do colaborador ou do freela — o
  // digitado, ou o cadastro (o dado do cadastro não vem à tela). A PP a
  // emitir salva antes da 193 não diz: a linha não aparece.
  const titularPessoa =
    tipoVerba !== null && (aEmitir.verba_titular_tipo === "colaborador" || aEmitir.verba_titular_tipo === "freela");
  const dadosBancarios: React.ReactNode = !titularPessoa
    ? null
    : d.pagamento_do_titular
      ? <span className="font-mono text-[12px]">{resumoDoPagamentoDoTitular(d.pagamento_do_titular)}</span>
      : d.titular_paga_pelo_cadastro === true
        ? textoDoPagamentoPeloCadastro(aEmitir.verba_titular_tipo)
        : null;
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
    ...(tipoVerba
      ? ((reembolso
          ? [["Tipo", rotuloDoReembolso(reembolsoTipo)]]
          : [["Verba", rotuloDaVerba(tipoVerba)]]) as Array<[string, React.ReactNode]>)
      : []),
    // Decisão 209: o cartão corporativo não tem fornecedor — a plataforma e
    // o link no lugar dele.
    ...((d.cartao_corporativo
      ? [
          ["Plataforma", d.cartao_corporativo.plataforma],
          ["Link da compra", <span key="link" className="break-all">{d.cartao_corporativo.link}</span>],
        ]
      : [[rotuloDeQuemRecebe, nomeDoFornecedor]]) as Array<[string, React.ReactNode]>),
    ...(dadosBancarios ? ([["Dados bancários", dadosBancarios]] as Array<[string, React.ReactNode]>) : []),
    ["Serviço", d.servico],
    [
      "Valor",
      <span key="v" className="font-mono">
        {formatCurrency(d.valor_unitario, moeda)} × {fator(d.quantidade)} × {fator(d.dias_meses)} ={" "}
        <b>{formatCurrency(aEmitir.valor, moeda)}</b>
      </span>,
    ],
    ...(reembolso && reembolsoTipo === "veiculo_proprio"
      ? ([["Deslocamentos", resumoDosDeslocamentos(d.deslocamentos)]] as Array<[string, React.ReactNode]>)
      : []),
    ["Empresa emissora", nomeDaEmpresa],
    [
      "Pagamento",
      d.cartao_corporativo
        ? `${ROTULO_CARTAO_CORPORATIVO} · até ${dataBr(d.prazo_pagamento)} · parcelas na fatura, pelo financeiro`
        : `${parcelas > 1 ? `${parcelas} parcelas, a 1ª em` : "Parcela única em"} ${dataBr(d.parcelas[0]?.data_vencimento ?? d.prazo_pagamento)}`,
    ],
    [
      reembolso ? "Comprovantes" : "Anexos",
      aEmitir.anexos.length === 0
        ? reembolso
          ? "Nenhum ainda — são obrigatórios no envio ao financeiro"
          : "Nenhum"
        : aEmitir.anexos
            .map((a) => {
              const numero = (a.documento_numero ?? "").trim();
              const tipo = a.documento_tipo ? documentoTipoLabel(a.documento_tipo) : "sem tipo";
              // Decisão 187: o comprovante de despesa mostra a data e o valor.
              if (reembolso && a.documento_tipo && a.nf_valor) {
                return `${tipo}${numero ? ` ${numero}` : ""} · ${dataBr(a.nf_data_emissao ?? "")} · ${formatCurrency(a.nf_valor, moeda)}`;
              }
              if (reembolso && !a.documento_tipo) return a.arquivo_nome_original;
              return `${tipo}${numero ? ` ${numero}` : ""} · ${a.arquivo_nome_original}`;
            })
            .join("; "),
    ],
    ...(d.verba_producao || nfs.length === 0
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
          {edicao ? (
            <>
              <DialogTitle className="text-[17px]">
                Salvar as alterações da <span className="font-mono">{edicao.codigo}</span>?
              </DialogTitle>
              <DialogDescription className="text-[12.5px] leading-relaxed">
                O código continua o mesmo, e o PDF é refeito com os dados novos.
                {edicao.prontaCai && " A marca “Pronta para envio” sai: confira os documentos de novo antes do envio."}{" "}
                Confira:
              </DialogDescription>
            </>
          ) : (
            <>
              <DialogTitle className="text-[17px]">Gerar o Pedido de Produção?</DialogTitle>
              <DialogDescription className="text-[12.5px] leading-relaxed">
                A PP pode ser editada até o envio ao financeiro. Confira:
              </DialogDescription>
            </>
          )}
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
            {linhaDoTotal(
              "Esta PP",
              edicao && Math.abs(edicao.valorAntes - aEmitir.valor) > 0.004
                ? `+ ${formatCurrency(aEmitir.valor, moeda)} (era ${formatCurrency(edicao.valorAntes, moeda)})`
                : `+ ${formatCurrency(aEmitir.valor, moeda)}`,
            )}
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
              {edicao ? (pending ? "Salvando…" : "Salvar alterações") : pending ? "Gerando…" : "Gerar PP"}
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
  /** Decisão 187: na PP de reembolso, o tipo — o envio cobra os
   *  comprovantes (despesas) ou o anexo do deslocamento (veículo próprio).
   *  Null fora do reembolso. Obrigatório: um chamador que o esquecesse
   *  mandaria o reembolso sem comprovante, como a verba. */
  reembolsoTipo: ReembolsoTipo | null;
  anexos: AnexoDaPPNaLista[];
  /** Decisão 161: paga por boleto — o envio exige o boleto e a nota. */
  pagaPorBoleto: boolean;
  /** Decisão 209: o cartão corporativo vai sem nota e sem anexos, como a
   *  verba. Obrigatório: um chamador que o esquecesse cobraria a nota. */
  cartaoCorporativo: boolean;
}

/**
 * A PP gerada não se edita, mas a nota do fornecedor costuma chegar depois
 * dela: o envio é onde os documentos entram. Todo campo é obrigatório aqui
 * — o tipo de cada arquivo, o número dos documentos e os dados de cada NF.
 * Acima do planejado, o "tem certeza?" vem antes de gravar.
 *
 * Dois modos (08/10/2026): o GP ENVIA; o produtor e o freelancer, que não
 * enviam (decisão 136), conferem os mesmos documentos com as mesmas regras e
 * deixam a PP "Pronta para envio" — o GP a envia pela aba Pedidos de
 * Produção, com o pop-up já preenchido. O "tem certeza?" acima do planejado
 * fica para o envio, que é quando o GP decide. Documento em outro CNPJ não
 * pergunta nada: a empresa emissora segue o documento e o aviso só informa
 * (revisão da 156, 16/10/2026).
 */
export function EnvioDialog({
  modo,
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
  envioSemNf,
}: {
  /** "enviar": o GP manda ao financeiro. "preparar": o produtor deixa
   *  pronta para o GP enviar. */
  modo: "enviar" | "preparar";
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
  /** Depois de gravar — enviada ao financeiro ou deixada pronta, conforme o
   *  modo. No envio, `emissora` diz se a PP passou para o CNPJ do documento. */
  onEnviada: (codigo: string, emissora?: TrocaDeEmissora | null) => void;
  /** Decisão 216: o job Mídia System em auditoria — a PP comum pode ir sem
   *  NF (`envioDispensaNf`). */
  envioSemNf: boolean;
}) {
  const preparar = modo === "preparar";
  const [prefixo, setPrefixo] = React.useState<string | null>(null);
  const { anexos, setAnexos, subir, remover, mudar, mudarNf, aviso, setAviso } = useAnexosEmEdicao(
    prefixo,
    tomadorEsperado,
    // Decisão 192: a IA lê o PDF ao anexar só na PP comum — o reembolso
    // tem comprovantes com tipos e campos próprios.
    pp && !pp.verbaProducao && !pp.cartaoCorporativo && !pp.reembolsoTipo ? tomadores : undefined,
  );
  const [tentou, setTentou] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [confirmando, setConfirmando] = React.useState<AcimaDoPlanejado | null>(null);
  const [pending, startTransition] = React.useTransition();
  /** A outra PP com a mesma nota, em correção (revisão da decisão 152). */
  const [corrigindo, setCorrigindo] = React.useState<{ id: string; codigo: string } | null>(null);
  const [versaoDasNotas, setVersaoDasNotas] = React.useState(0);
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
  // Decisão 187: o reembolso leva os comprovantes, com a regra dele.
  const reembolsoTipo = pp.reembolsoTipo;
  const veiculo = reembolsoTipo === "veiculo_proprio";
  // Decisão 209: o cartão corporativo vai sem nota (anexá-la depois é com o
  // financeiro, em fase futura).
  const comAnexos = (!pp.verbaProducao && !pp.cartaoCorporativo) || reembolsoTipo !== null;
  // Decisão 216: com o job Mídia System em auditoria, a PP comum pode ir
  // sem anexo nenhum; o que for anexado segue as regras de sempre.
  const semNfNaAuditoria = envioSemNf && !pp.verbaProducao && !pp.cartaoCorporativo && reembolsoTipo === null;
  function camposDoComprovanteEnvio(id: string) {
    const a = anexos.find((x) => x.id === id);
    if (!a) return null;
    return (
      <CamposDoComprovante
        anexo={a}
        onNumero={(n) => (a.tipo === "nota_fiscal" ? mudarNf(id, { numero: n }) : mudar(id, { numero: n }))}
        onData={(iso) => mudarNf(id, { emissao: iso })}
        onValor={(v) => mudarNf(id, { valor: v })}
        hoje={hojeEmSaoPauloIso()}
        destacarFaltas={tentou}
        disabled={pending}
      />
    );
  }
  const paraEnvio = reembolsoTipo ? comprovanteDoReembolsoParaEnvio : anexoParaEnvio;

  function enviar(confirmado: boolean) {
    if (!pp) return;
    setTentou(true);
    const subindo = anexos.some((a) => a.status === "uploading" || a.status === "selecionado");
    const falta = reembolsoTipo
      ? subindo
        ? "Aguarde os arquivos terminarem de subir."
        : faltaNosComprovantesDoReembolso(comprovantesDosAnexos(anexos), pp.valor, reembolsoTipo)
      : faltaNosAnexosParaEnviar(anexos, pp.valor, existentes, pp.pagaPorBoleto);
    if (falta && comAnexos && !(semNfNaAuditoria && anexos.length === 0)) {
      setErro(falta);
      return;
    }
    if (preparar) {
      setErro(null);
      const alvo = pp;
      startTransition(async () => {
        const res = await deixarPPProntaParaEnvio(
          alvo.id,
          anexos.filter((a) => a.status === "ok").map(paraEnvio),
        );
        if (!res.ok) {
          setErro(res.message);
          return;
        }
        onEnviada(res.codigo);
      });
      return;
    }
    setErro(null);
    const alvo = pp;
    startTransition(async () => {
      const res = await enviarPedidoCompraAoFinanceiro(
        alvo.id,
        confirmado,
        anexos.filter((a) => a.status === "ok").map(paraEnvio),
      );
      if (!res.ok) {
        if (res.acimaDoPlanejado) {
          setConfirmando(res.acimaDoPlanejado);
          return;
        }
        setConfirmando(null);
        setErro(res.message);
        return;
      }
      setConfirmando(null);
      onEnviada(res.codigo, res.emissora);
    });
  }

  /** "Contra qual CNPJ" da fatura e do recibo (revisão da 156). */
  function cnpjDoDocumento(id: string) {
    const a = anexos.find((x) => x.id === id);
    if (!a) return null;
    return (
      <CnpjDoDocumento
        valor={a.nf.tomador}
        onChange={(v) => mudarNf(id, { tomador: v })}
        tomadores={tomadores}
        tomadorEsperado={tomadorEsperado}
        empresaNome={nomeDaEmpresa}
        idBase={`envio-${id}`}
        obrigatorio
        invalido={tentou && !a.nf.tomador}
        disabled={pending}
        lidoPelaIA={a.leitura?.estado === "lido" && a.leitura.campos.includes("tomador")}
      />
    );
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
        leitura={a.leitura}
      />
    );
  }

  const botaoEnviar = (
    <button
      type="button"
      onClick={() => enviar(confirmando !== null)}
      disabled={pending || (comAnexos && prefixo === null)}
      className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50"
    >
      {preparar ? <ClipboardCheck className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
      {preparar
        ? pending
          ? "Gravando…"
          : "Deixar pronta para envio"
        : pending
          ? "Enviando…"
          : confirmando
            ? "Sim, enviar"
            : "Enviar ao financeiro"}
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
          {preparar ? (
            <>
              <DialogTitle className="text-[17px]">
                Deixar <span className="font-mono">{pp.codigo}</span> pronta para envio
              </DialogTitle>
              <DialogDescription className="text-[12.5px] leading-relaxed">
                {nomeDoFornecedor} · <span className="font-mono">{formatCurrency(pp.valor, moeda)}</span> · {pp.servico}.{" "}
                {semNfNaAuditoria
                  ? `${TEXTO_ENVIO_AUDITORIA} O GP envia a PP ao financeiro pela aba Pedidos de Produção.`
                  : pp.cartaoCorporativo
                  ? "No cartão corporativo, a nota não é exigida: o GP envia a PP ao financeiro pela aba Pedidos de Produção."
                  : reembolsoTipo
                  ? "Confira os comprovantes do reembolso: o GP envia a PP ao financeiro pela aba Pedidos de Produção. Todos os campos são obrigatórios."
                  : "Confira os documentos do fornecedor: o GP envia a PP ao financeiro pela aba Pedidos de Produção. Todos os campos são obrigatórios."}
              </DialogDescription>
            </>
          ) : (
            <>
              <DialogTitle className="text-[17px]">
                Enviar <span className="font-mono">{pp.codigo}</span> ao financeiro
              </DialogTitle>
              <DialogDescription className="text-[12.5px] leading-relaxed">
                {nomeDoFornecedor} · <span className="font-mono">{formatCurrency(pp.valor, moeda)}</span> · {pp.servico}.{" "}
                {semNfNaAuditoria
                  ? TEXTO_ENVIO_AUDITORIA
                  : pp.cartaoCorporativo
                  ? "No cartão corporativo, a nota não é exigida no envio."
                  : reembolsoTipo
                  ? "A PP não muda mais; aqui entram os comprovantes do reembolso. Todos os campos são obrigatórios para enviar."
                  : "A PP não muda mais; aqui entram os documentos do fornecedor. Todos os campos são obrigatórios para enviar."}
              </DialogDescription>
            </>
          )}
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
          {comAnexos && (
            <>
              {/* O "Ver PP e documentos lado a lado" virou o "Verificar" do
                  rodapé (pedido do Tiago, 08/10/2026). */}
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {reembolsoTipo
                  ? veiculo
                    ? "Comprovantes do deslocamento"
                    : "Comprovantes da despesa"
                  : semNfNaAuditoria
                    ? "Anexos · opcionais na auditoria"
                    : "Anexos"}
              </p>
              {pp.pagaPorBoleto && <ExigidosNoEnvio anexos={anexos} />}
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
                onVer={reembolsoTipo ? undefined : (id) => setLadoALado({ foco: id })}
                tipos={reembolsoTipo ? TIPOS_DE_COMPROVANTE : undefined}
                semTipo={veiculo}
                renderComprovante={reembolsoTipo && !veiculo ? camposDoComprovanteEnvio : undefined}
                renderNf={(id) => camposDaNf(id, false)}
                renderCnpj={cnpjDoDocumento}
              />
              {reembolsoTipo ? (
                !veiculo && <ResumoDosComprovantes anexos={anexos} valorPP={pp.valor} />
              ) : (
                <ResumoDasNfs valores={nfsDaLista.map((a) => parteDaNf(a.nf))} valorPP={pp.valor} />
              )}
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
        {/* "Voltar" no canto esquerdo e "Verificar" — a PP, os documentos e
            os dados lado a lado (decisão 153, entrega 3) — ao lado do envio
            (pedido do Tiago, 08/10/2026). */}
        <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/30 px-6 py-3">
          <button
            type="button"
            onClick={() => (confirmando ? setConfirmando(null) : onOpenChange(false))}
            disabled={pending}
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Voltar
          </button>
          <div className="flex items-center gap-2">
            {!pp.verbaProducao && !pp.cartaoCorporativo && (
              <button
                type="button"
                onClick={() => setLadoALado({ foco: itensDaLista(anexos)[0]?.id ?? null })}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red disabled:opacity-50"
              >
                <Columns2 className="h-3.5 w-3.5" />
                Verificar
              </button>
            )}
            {botaoEnviar}
          </div>
        </div>
        {/* Decisão 153, entrega 3: a PP, os documentos e os dados lado a
            lado. O estado é o deste envio: o que se preenche lá aparece aqui. */}
        {!pp.verbaProducao && !pp.cartaoCorporativo && (
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
            renderCnpj={cnpjDoDocumento}
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
                são obrigatórios {preparar ? "para deixar pronta" : "para enviar"}
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
