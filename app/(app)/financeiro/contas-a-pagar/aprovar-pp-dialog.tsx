"use client";

/**
 * O pop-up que aprova a PP (10/09/2026).
 *
 * Nasceu de um defeito: o "Aprovar" da conferência lado a lado não
 * aprovava. Ele chamava a mesma função do drawer e, sem a data de
 * pagamento, ela escrevia o aviso DENTRO do drawer — que naquele momento
 * estava atrás da tela cheia. O clique funcionava; a resposta é que ficava
 * escondida.
 *
 * Por isso o formulário saiu do drawer e virou este diálogo: a pergunta e
 * a resposta passam a acontecer na mesma camada de onde se clicou, venha o
 * clique do drawer ou da conferência.
 *
 * **Aqui só entra decisão.** Fornecedor, job, serviço e parcelas ficam na
 * tela de trás — repeti-los transformaria este diálogo num segundo drawer,
 * que é exatamente a redundância que ele veio desfazer (Tiago, 10/09/2026).
 * Do pedido ficam o código e o valor, para ninguém aprovar a PP errada.
 *
 * Módulo fiscal (02/10/2026): duas seções novas entre "Como vai ser pago"
 * e o rodapé, no mesmo ritmo dela — a largura do pop-up não muda, e o
 * resto fica como está. Só na PP com NF anexada; recibo, boleto e verba de
 * produção aprovam como antes.
 *
 * - **Retenções na fonte** — decididas aqui, sobre o valor da NF. Ligadas
 *   por padrão no regime normal e no fornecedor sem regime informado
 *   (PIS 0,65%, COFINS 3%, CSLL 1%, IRRF 1,5%, do cadastro de impostos);
 *   desligadas e travadas no Simples e no MEI (IN 459); sem retenção no
 *   cartão, como na baixa. Ligadas, vêm com o aviso âmbar de que só valem
 *   para serviço: nota de mercadoria não tem retenção (07/10/2026).
 * - **Crédito de PIS/COFINS** — automático pela regra, no mês da emissão
 *   da NF. Só o financeiro tira, e com motivo.
 *
 * A NF (número, emissão, valor e CNPJ tomador) é conferida na tela de
 * trás, ao lado da nota — aqui só se usa o resultado. Aprovar grava a NF
 * (`registrar_nf_da_pp`) e só então aprova (`aprovarPPComNotaFiscal`).
 *
 * Decisão 152 (07/10/2026): a PP pode ter várias NFs, e uma NF pode cobrir
 * mais de uma PP. A base das retenções é a soma das partes desta PP; a nota
 * conta UMA vez no fiscal, pelo total, na aprovação que a registra — o ISS
 * retido e o crédito de cada nota aparecem por nota, e a que outra PP já
 * registrou só é lembrada. Aprovar grava as notas
 * (`registrar_notas_fiscais_da_pp`).
 */

import * as React from "react";
import { AlertCircle, CheckCircle2, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Combobox } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { MoneyInput } from "@/components/ui/money-input";
import { cn, formatCurrency } from "@/lib/utils";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import {
  IMPOSTOS_RETIDOS,
  type PagamentoForaDoCadastroDaPP,
  type PlanoContaTipo,
  type PlanoContaSubtipo,
  type RegimeTributarioFornecedor,
} from "@/lib/types";
import { AprovarForaDoCadastro } from "@/components/financeiro/pagamento-fora-do-cadastro";
import {
  arredondar,
  useValorDaBaixa,
  type EstadoDoValorDaBaixa,
  type UltimaRetencao,
} from "@/components/financeiro/valor-da-baixa";
import { parametrosDeRetencao, type CadastroFiscal } from "@/lib/fiscal/cadastro";
import {
  MOTIVOS_SEM_CREDITO,
  retencoesPadrao,
  valoresRetidos,
  type AliquotasRetidas,
} from "@/lib/fiscal/calculos";
import { dataBr, mesDe, nomeDoMes } from "@/lib/fiscal/datas";
import {
  aliquotaEfetiva,
  creditoDaNf,
  faltaNasNotasParaAprovar,
  guiaDoIssRetido,
  nfIncompleta,
  parteDaNota,
  percentual,
  retencoesParaRegistrar,
  rotuloCurtoDoRegime,
  somaDasPartes,
  vencimentoDasGuiasFederais,
  type CreditoDaNf,
  type NfEmConferencia,
  type RegistroDaNota,
} from "@/lib/fiscal/nf-da-pp";
import { aprovarPPComData, aprovarPPComNotaFiscal } from "./actions-titulos";
import { FaixaQuemEnviou } from "./faixa-quem-enviou";
import type { EnvioDaPP } from "@/lib/data/eventos-da-pp";

/** Radix não aceita `value=""` num item; este é o rótulo da ausência de
 *  escolha ("decidir na baixa"), traduzido para "" no estado. */
const DECIDIR = "decidir";

interface PPParaAprovar {
  id: string;
  codigo: string;
  valor: number;
  /** Vencimento negociado pela produção — a referência da decisão. */
  vencimentoOriginal: string | null;
  parcelas: number;
  /** Decisão 127: a PP paga fora do cadastro. Aprovar exige a marcação,
   *  e o servidor e o banco conferem de novo. */
  pagamentoForaDoCadastro: PagamentoForaDoCadastroDaPP | null;
  /** Decisão 136: o último envio — qualquer GP envia, e o financeiro vê
   *  quem mandou. Null só na PP sem envio registrado. */
  envio: EnvioDaPP | null;
  emitidaPorNome: string | null;
  gpResponsavelNome: string | null;
  /** Módulo fiscal: o fornecedor e o regime do cadastro (null = não informado). */
  fornecedorNome: string;
  regimeDoFornecedor: RegimeTributarioFornecedor | null;
  /** Módulo fiscal: as NFs em conferência na coluna "Dados da PP", uma por
   *  anexo do tipo NF (decisão 152). Null na PP sem NF anexada (recibo,
   *  boleto, verba): sem as seções novas. */
  nfs: NfEmConferencia[] | null;
  /** Por anexo: o registro da nota quando OUTRA PP já a registrou (o
   *  crédito e o ISS retido dela já estão na Apuração); null nas demais. */
  registroDeOutraPP: Record<string, RegistroDaNota | null>;
  /** Módulo fiscal: a última PP aprovada com retenção do mesmo fornecedor. */
  ultimaRetencao: UltimaRetencao | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Módulo fiscal: o que as seções novas dizem enquanto a NF não tem data e valor. */
const TEXTO_SEM_NF =
  "Preencha a data de emissão e o valor das notas em “Dados da PP”, olhando a nota ao lado: o valor é a base das retenções e a data, o mês do crédito.";

/**
 * Com "Reter na fonte" ligado — o que só acontece no Lucro Real ou
 * Presumido e no fornecedor sem regime informado, porque no Simples e no
 * MEI a chave fica travada desligada. O sistema não sabe se a nota é de
 * serviço ou de mercadoria; quem olha a nota decide (Tiago, 07/10/2026).
 */
const AVISO_RETENCAO_SO_EM_SERVICO =
  "A retenção na fonte só vale para serviço. Se a nota for de mercadoria (DANFE, NF-e), desligue: compra de mercadoria não tem retenção de PIS/COFINS/CSLL, IR nem ISS.";

/** Módulo fiscal: a pílula do crédito, por estado. */
const PILULA_DO_CREDITO: Record<"sim" | "nao", { texto: string; tom: string }> = {
  sim: { texto: "Gera crédito", tom: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  nao: { texto: "Não gera crédito", tom: "border-border bg-muted text-muted-foreground" },
};

export function AprovarPPDialog({
  open,
  onOpenChange,
  pp,
  cadastro,
  cartoes,
  tipos,
  subtipos,
  onAprovada,
}: {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  pp: PPParaAprovar | null;
  /** Módulo fiscal: o cadastro de impostos (alíquotas padrão, regime do
   *  CNPJ tomador, feriados dos vencimentos). */
  cadastro: CadastroFiscal;
  cartoes: CartaoOption[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  /** O pai fecha o que estiver aberto, avisa e recarrega. */
  onAprovada: (mensagem: string) => void;
}) {
  const [dataPagamento, setDataPagamento] = React.useState("");
  const [formaPagamento, setFormaPagamento] = React.useState("");
  const [cartaoId, setCartaoId] = React.useState("");
  const [tipoId, setTipoId] = React.useState("");
  const [subtipoId, setSubtipoId] = React.useState("");
  const [foraAprovado, setForaAprovado] = React.useState(false);
  const [faltaForaAprovado, setFaltaForaAprovado] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const custoOperacionalId = React.useMemo(
    () => tipos.find((t) => t.codigo === "02")?.id ?? "",
    [tipos],
  );

  const noCartao = formaPagamento === "cartao_credito";
  const hoje = React.useMemo(() => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }, []);

  // Módulo fiscal: as retenções, sobre a soma das partes das notas desta
  // PP conferidas na coluna "Dados da PP" — o mesmo estado da baixa
  // (decisão 125). Decisão 152: a nota pode cobrir outras PPs; o pagamento
  // desta só retém sobre a parte dela.
  const nfs = pp?.nfs && pp.nfs.length > 0 ? pp.nfs : null;
  const base = nfs ? somaDasPartes(nfs) : 0;
  const v = useValorDaBaixa(base, pp?.ultimaRetencao ?? null);
  // Decisão 152 (resposta do Tiago em 07/10/2026): a NF que outra PP já
  // registrou traz o ISS retido daquela aprovação, preenchido e travado —
  // o ISS é da nota, e a parte desta PP retém na mesma alíquota.
  // `undefined` = nenhuma nota registrada (livre); `null` = registrada sem
  // ISS retido (travado em zero).
  const registroComIss = React.useMemo(() => {
    if (!pp || !nfs) return null;
    for (const nf of nfs) {
      const r = pp.registroDeOutraPP[nf.anexo_id];
      if (r) return r;
    }
    return null;
  }, [pp, nfs]);
  const issTravado: number | null | undefined = registroComIss
    ? (registroComIss.iss_aliquota ?? null)
    : undefined;
  const [ajustando, setAjustando] = React.useState(false);
  // Módulo fiscal: a troca manual do crédito, sempre com motivo.
  const [semCredito, setSemCredito] = React.useState(false);
  const [motivoSemCredito, setMotivoSemCredito] = React.useState("");
  const regime = pp?.regimeDoFornecedor ?? null;
  // Simples e MEI não sofrem retenção de PIS/COFINS/CSLL e IRRF (IN 459).
  // Sem regime informado, segue o normal.
  const optanteDoSimples = regime === "simples" || regime === "mei";
  const padraoDoRegime: AliquotasRetidas = React.useMemo(
    () => retencoesPadrao(regime, parametrosDeRetencao(cadastro)),
    [regime, cadastro],
  );

  /** A retenção no padrão do regime: ligada, com as alíquotas do cadastro
   *  de impostos, no regime normal; desligada no Simples e no MEI. */
  function aplicarRetencaoPadrao() {
    v.setRetem(false);
    if (!nfs || optanteDoSimples) return;
    v.setRetem(true);
    for (const { imposto } of IMPOSTOS_RETIDOS) {
      const aliquota = padraoDoRegime[imposto];
      if (aliquota) v.porAliquota(imposto, aliquota);
    }
    travarIss();
  }

  /** O ISS da nota já registrada por outra PP volta ao valor dela. */
  function travarIss() {
    if (issTravado !== undefined) v.porAliquota("ISS", issTravado);
  }

  // Cada abertura começa limpa: o diálogo é a decisão de UMA aprovação, e
  // herdar a data escolhida na PP anterior é como se erra a data.
  React.useEffect(() => {
    if (!open) return;
    setDataPagamento("");
    setFormaPagamento("");
    setCartaoId("");
    setTipoId("");
    setSubtipoId("");
    setForaAprovado(false);
    setFaltaForaAprovado(false);
    setErro(null);
    // Módulo fiscal: as retenções voltam ao padrão do regime, e o crédito
    // ao automático.
    setAjustando(false);
    setSemCredito(false);
    setMotivoSemCredito("");
    aplicarRetencaoPadrao();
    // `v` muda a cada renderização; o que decide é abrir outra vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pp?.id]);

  // Módulo fiscal: no cartão não há retenção — o item entra inteiro na
  // fatura, como na baixa (decisão 125). Saindo do cartão, a retenção volta
  // ao padrão do regime.
  const estavaNoCartao = React.useRef(false);
  React.useEffect(() => {
    if (noCartao === estavaNoCartao.current) return;
    estavaNoCartao.current = noCartao;
    if (noCartao) {
      v.setRetem(false);
      setAjustando(false);
    } else {
      aplicarRetencaoPadrao();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noCartao]);

  if (!pp) return null;

  // ---------------------------------------------------------------------
  // Módulo fiscal: o que a NF conferida decide.
  // ---------------------------------------------------------------------
  const incompleta = nfs ? nfs.some(nfIncompleta) : false;
  const registroDeOutra = (nf: NfEmConferencia) => pp.registroDeOutraPP[nf.anexo_id] ?? null;
  const retencaoTravada = optanteDoSimples || noCartao;
  const motivoSemRetencao = noCartao
    ? "No cartão de crédito não há retenção: o item entra inteiro na fatura, como na baixa."
    : optanteDoSimples
      ? "Optante do Simples: sem retenção de PIS/COFINS/CSLL e IRRF (IN 459)."
      : null;
  const resumo = IMPOSTOS_RETIDOS.filter(({ imposto }) => v.valores[imposto] > 0)
    .map(
      ({ imposto }) =>
        `${imposto} ${percentual(aliquotaEfetiva(imposto, v.aliquotas, v.valores, base))}`,
    )
    .join(" · ");
  // As guias que as retenções geram: CSRF (PIS + COFINS + CSLL) na DARF
  // 5952, IRRF na 1708, e o ISS retido na guia do município. As alíquotas
  // saem dos valores da tela, para a guia bater centavo a centavo com eles.
  const guias = valoresRetidos(
    base,
    Object.fromEntries(
      IMPOSTOS_RETIDOS.map(({ imposto }) => [
        imposto,
        v.retem && base > 0 ? (v.valores[imposto] / base) * 100 : 0,
      ]),
    ) as AliquotasRetidas,
  );
  const darfs = [
    guias.darf5952 > 0 ? { codigo: "5952", valor: guias.darf5952 } : null,
    guias.darf1708 > 0 ? { codigo: "1708", valor: guias.darf1708 } : null,
  ].filter((x): x is { codigo: string; valor: number } => x !== null);
  const mesDoPagamento = dataPagamento ? mesDe(dataPagamento) : null;
  // As DARF saem pelo CNPJ tomador da primeira nota (é por onde a
  // Apuração lança os pagamentos da PP).
  const vencFederal =
    nfs && dataPagamento ? vencimentoDasGuiasFederais(cadastro, nfs[0].tomador, dataPagamento) : null;
  // O ISS retido é da NOTA, pelo total, uma vez (decisão 152): só as notas
  // que esta aprovação registra geram guia; a que outra PP já registrou já
  // está nela. Uma guia por município do tomador e mês da emissão.
  const aliquotaIss = v.retem && base > 0 ? (v.valores.ISS / base) * 100 : 0;
  const guiasIss: Array<{
    chave: string;
    municipio: string;
    uf: string;
    mes: string;
    vencimento: string;
    valor: number;
  }> = [];
  if (nfs && aliquotaIss > 0) {
    for (const nf of nfs) {
      if (registroDeOutra(nf)) continue;
      const g = guiaDoIssRetido(cadastro, nf.tomador, nf.emissao);
      if (!g) continue;
      const chave = `${nf.tomador}|${mesDe(nf.emissao)}`;
      const valor = arredondar((nf.valor * aliquotaIss) / 100);
      const atual = guiasIss.find((x) => x.chave === chave);
      if (atual) atual.valor = arredondar(atual.valor + valor);
      else
        guiasIss.push({
          chave,
          municipio: g.municipio,
          uf: g.uf,
          mes: mesDe(nf.emissao),
          vencimento: g.vencimento.data,
          valor,
        });
    }
  }
  const notasJaRegistradas = nfs ? nfs.filter((nf) => registroDeOutra(nf)) : [];
  // O crédito de cada nota — automático pela regra, pelo total da nota; o
  // financeiro só tira, e com motivo. A nota que outra PP registrou mostra
  // o que ficou registrado lá.
  const creditos: Array<{ nf: NfEmConferencia; registro: RegistroDaNota | null; credito: CreditoDaNf }> | null =
    nfs && !incompleta
      ? nfs.map((nf) => {
          const registro = registroDeOutra(nf);
          return {
            nf,
            registro,
            credito: creditoDaNf({
              nf,
              cadastro,
              semCredito: registro ? registro.credito_retirado : semCredito,
              motivoSemCredito: registro ? (registro.credito_motivo ?? "") : motivoSemCredito,
              hoje: hoje.split("/").reverse().join("-"),
            }),
          };
        })
      : null;
  const creditosNovos = (creditos ?? []).filter((c) => !c.registro);
  const podeTirarCredito = creditosNovos.some((c) => c.credito.automatico.gera);
  const tirouCredito = creditosNovos.some((c) => c.credito.tirado);

  function handleAprovar() {
    if (!pp) return;
    if (!dataPagamento) {
      setErro("Escolha a data de pagamento antes de aprovar.");
      return;
    }
    if (pp.pagamentoForaDoCadastro && !foraAprovado) {
      setFaltaForaAprovado(true);
      setErro("Marque “Aprovar pagamento fora do cadastro” antes de aprovar.");
      return;
    }
    if (nfs) {
      // Módulo fiscal: sem as notas conferidas não há mês de crédito nem
      // base de retenção.
      const falta = faltaNasNotasParaAprovar(nfs);
      if (falta) {
        setErro(falta);
        return;
      }
      // As mesmas travas da retenção na baixa.
      if (v.retem && v.retido <= 0) {
        setErro("Informe ao menos um imposto retido, ou desligue a retenção.");
        return;
      }
      if (v.retem && v.retido >= base) {
        setErro(
          nfs.length > 1
            ? "Os impostos retidos não podem ser maiores que o valor das notas nesta PP."
            : "Os impostos retidos não podem ser maiores que o valor da NF.",
        );
        return;
      }
      // Tirar o crédito pede o motivo.
      if (tirouCredito && !motivoSemCredito) {
        setErro("Escolha o motivo de a nota não gerar crédito de PIS/COFINS.");
        return;
      }
    }
    const aprovacao = {
      pp_id: pp.id,
      data_pagamento: dataPagamento,
      forma_pagamento: formaPagamento || null,
      cartao_credito_id: noCartao ? cartaoId || null : null,
      plano_conta_tipo_id: noCartao ? tipoId || null : null,
      plano_conta_subtipo_id: noCartao ? subtipoId || null : null,
      aprovar_pagamento_fora_do_cadastro: pp.pagamentoForaDoCadastro ? foraAprovado : false,
    };
    // Com NF, as notas são gravadas primeiro e a aprovação só acontece se
    // elas gravarem (`aprovarPPComNotaFiscal`); sem NF, a aprovação de
    // sempre. A nota que outra PP registrou vai com o crédito de lá.
    const notaFiscal = nfs
      ? {
          notas: nfs.map((nf) => {
            const registro = registroDeOutra(nf);
            const tirou = registro
              ? registro.credito_retirado
              : (creditos?.find((c) => c.nf.anexo_id === nf.anexo_id)?.credito.tirado ?? false);
            return {
              anexo_id: nf.anexo_id,
              numero: nf.numero.trim(),
              data_emissao: nf.emissao,
              valor: nf.valor,
              tomador_estabelecimento_id: nf.tomador,
              valor_na_pp: parteDaNota(nf),
              credito_retirado: tirou,
              credito_motivo: tirou ? (registro ? registro.credito_motivo : motivoSemCredito) : null,
            };
          }),
          retencoes: noCartao
            ? []
            : retencoesParaRegistrar(v.retem, v.aliquotas, v.valores, base),
        }
      : null;
    startTransition(async () => {
      const res = notaFiscal
        ? await aprovarPPComNotaFiscal({ ...aprovacao, nf: notaFiscal })
        : await aprovarPPComData(aprovacao);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onAprovada(
        `${pp.codigo} aprovada · ${
          pp.parcelas > 1 ? `${pp.parcelas} títulos criados` : "título criado"
        } para ${formatDate(dataPagamento)}.`,
      );
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `z-[60]` porque este diálogo é aberto TAMBÉM de dentro da
          conferência em tela cheia — ver a escala de camadas no
          `FullscreenContent`. Sem isso ele monta atrás do `<iframe>` do
          documento: visível, e sem receber clique. */}
      <DialogContent className="z-[60] max-w-md" overlayClassName="z-[60]">
        <DialogHeader>
          {/* `pr-8`: o "X" de fechar é absoluto no canto (16px da borda,
              24px de largura) e cobria o valor empurrado para a direita
              (16/09/2026). O recuo tira o valor de baixo dele. */}
          <DialogTitle className="flex flex-wrap items-baseline gap-2 pr-8">
            <span>Aprovar</span>
            <span className="font-mono text-california-red">{pp.codigo}</span>
            <span className="ml-auto font-mono text-sm font-semibold text-muted-foreground">
              {formatCurrency(pp.valor, "BRL")}
            </span>
          </DialogTitle>
          {pp.envio && (
            <FaixaQuemEnviou
              rotulo={pp.envio.reenviada ? "Reenviada por" : "Enviada por"}
              nome={pp.envio.por_nome}
              em={pp.envio.em}
              referencia={`Emitida por ${pp.emitidaPorNome ?? "—"} · GP responsável do job: ${pp.gpResponsavelNome ?? "—"}`}
            />
          )}
          <DialogDescription>
            Vencimento negociado pela produção:{" "}
            <strong className="font-semibold text-foreground">
              {formatDate(pp.vencimentoOriginal)}
            </strong>
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          {/* Decisão 127: uma linha, com a própria chave — o dossiê atrás
              já mostra o resto, e este pop-up não repete a tela. */}
          {pp.pagamentoForaDoCadastro && (
            <AprovarForaDoCadastro
              pagamento={pp.pagamentoForaDoCadastro}
              marcado={foraAprovado}
              onChange={(v) => {
                setForaAprovado(v);
                setFaltaForaAprovado(false);
                setErro(null);
              }}
              emFalta={faltaForaAprovado}
              disabled={pending}
            />
          )}

          <div className="space-y-2">
            <p className="text-sm font-bold">
              Data de pagamento <span className="text-california-red">*</span>
            </p>
            <DatePicker
              id="aprovar-pp-data-pagamento"
              name="aprovar_pp_data_pagamento"
              onDateChange={(d) => {
                setDataPagamento(
                  d
                    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
                    : "",
                );
                setErro(null);
              }}
            />
            <p className="text-[11px] text-muted-foreground text-pretty">
              Vira o vencimento do título em Títulos a Pagar; o original fica
              registrado. Hoje é{" "}
              <strong className="font-semibold text-california-red">{hoje}</strong>.
              {pp.parcelas > 1 && (
                <>
                  {" "}
                  Como esta PP tem {pp.parcelas} parcelas, as demais são deslocadas
                  pelo mesmo número de dias.
                </>
              )}
            </p>
          </div>

          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm font-bold">Como vai ser pago</p>
            {/* Seletor do sistema, e não o nativo do sistema operacional
                (16/09/2026). "Decidir na baixa" é a ausência de escolha, e o
                Radix não aceita item de valor vazio — daí o rótulo DECIDIR. */}
            <Select
              value={formaPagamento === "" ? DECIDIR : formaPagamento}
              disabled={pending}
              onValueChange={(v) => {
                const nova = v === DECIDIR ? "" : v;
                setFormaPagamento(nova);
                setCartaoId("");
                // No cartão o tipo já entra em Custo Operacional; o subtipo
                // continua em branco, que é a escolha real.
                setTipoId(nova === "cartao_credito" ? custoOperacionalId : "");
                setSubtipoId("");
                setErro(null);
              }}
            >
              <SelectTrigger aria-label="Como vai ser pago" className="h-10 w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DECIDIR}>Decidir na baixa, parcela a parcela</SelectItem>
                <SelectItem value="pix">PIX</SelectItem>
                <SelectItem value="transferencia">Transferência</SelectItem>
                <SelectItem value="boleto">Boleto</SelectItem>
                <SelectItem value="cartao_credito">Cartão de Crédito</SelectItem>
              </SelectContent>
            </Select>

            {noCartao && (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-[11.5px] leading-relaxed text-amber-900">
                  O cartão aqui é a intenção: a parcela entra na fatura quando o
                  pagamento for confirmado em Títulos a Pagar, pela{" "}
                  <strong>data informada na baixa</strong>, e o dinheiro sai uma
                  vez só, na baixa da fatura inteira. O centro de custo é
                  escolhido agora para o item já chegar classificado à fatura.
                </p>

                <Select
                  value={cartaoId === "" ? undefined : cartaoId}
                  disabled={pending}
                  onValueChange={setCartaoId}
                >
                  <SelectTrigger aria-label="Cartão" className="h-9 w-full text-xs">
                    <SelectValue placeholder="Escolha o cartão…" />
                  </SelectTrigger>
                  <SelectContent>
                    {cartoes.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">
                        {c.nome} · {c.bandeira.toUpperCase()} · ••••{c.ultimos_4_digitos}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="grid grid-cols-2 gap-2">
                  <Combobox
                    ariaLabel="Tipo do plano de contas"
                    items={tipos.map((t) => ({
                      value: t.id,
                      label: `${t.codigo} · ${t.nome}`,
                    }))}
                    value={tipoId || null}
                    onChange={(v) => {
                      setTipoId(v ?? "");
                      setSubtipoId("");
                    }}
                    disabled={pending}
                    placeholder="Tipo…"
                    buscaPlaceholder="Escreva o código ou o nome"
                    className="h-9 w-full border-border px-3.5 text-xs"
                  />
                  <Combobox
                    ariaLabel="Subtipo do plano de contas"
                    items={subtipos
                      .filter((sub) => sub.tipo_id === tipoId)
                      .map((sub) => ({
                        value: sub.id,
                        label: `${sub.codigo} · ${sub.nome}`,
                      }))}
                    value={subtipoId || null}
                    onChange={(v) => setSubtipoId(v ?? "")}
                    disabled={pending || tipoId === ""}
                    placeholder="Subtipo…"
                    buscaPlaceholder="Escreva o código ou o nome"
                    className="h-9 w-full border-border px-3.5 text-xs"
                  />
                </div>
              </div>
            )}

            {!noCartao && (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">Centro de custo</span>
                  <span className="font-semibold">Custo Operacional</span>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground text-pretty">
                  Padrão de todo custo de job (decisão 068). O subtipo você escolhe na
                  baixa, em Títulos a Pagar.
                </p>
              </div>
            )}
          </div>

          {/* Módulo fiscal: as retenções na fonte, decididas na aprovação
              sobre a soma das partes das notas nesta PP. */}
          {nfs && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-sm font-bold">Retenções na fonte</p>
              {incompleta ? (
                <p className="flex items-start gap-1.5 text-[12px] leading-snug text-amber-800">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                  <span>{TEXTO_SEM_NF}</span>
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 text-xs leading-snug text-muted-foreground">
                      {pp.fornecedorNome} · {rotuloCurtoDoRegime(regime)}
                    </span>
                    <div
                      className={cn(
                        "flex flex-none items-center gap-2",
                        retencaoTravada && "opacity-60",
                      )}
                    >
                      <Chave
                        id="aprovar-pp-reter"
                        ligada={v.retem}
                        desligada={retencaoTravada || pending || (v.retem && (issTravado ?? 0) > 0)}
                        onChange={(x) => {
                          if (x) aplicarRetencaoPadrao();
                          else {
                            v.setRetem(false);
                            setAjustando(false);
                          }
                          setErro(null);
                        }}
                        rotulo="Reter na fonte"
                      />
                      <label
                        htmlFor="aprovar-pp-reter"
                        className={cn(
                          "text-[13px] font-semibold",
                          retencaoTravada ? "cursor-not-allowed" : "cursor-pointer",
                        )}
                      >
                        Reter na fonte
                      </label>
                    </div>
                  </div>

                  {motivoSemRetencao && (
                    <p className="text-[11.5px] leading-snug text-muted-foreground text-pretty">
                      {motivoSemRetencao}
                    </p>
                  )}

                  {v.retem && (
                    <>
                      <p className="flex items-start gap-1.5 text-[12px] leading-snug text-amber-800 text-pretty">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                        <span>{AVISO_RETENCAO_SO_EM_SERVICO}</span>
                      </p>
                      {v.retido > 0 ? (
                        <p className="text-[12px] leading-relaxed tabular-nums">
                          <span>
                            {resumo} ={" "}
                            <b className="font-mono font-semibold">
                              {formatCurrency(v.retido, "BRL")}
                            </b>{" "}
                            ·
                          </span>{" "}
                          <span className="whitespace-nowrap">
                            líquido{" "}
                            <b className="font-mono font-semibold">
                              {formatCurrency(v.liquido, "BRL")}
                            </b>
                          </span>
                        </p>
                      ) : (
                        <p className="text-[12px] text-muted-foreground">
                          Nenhum imposto informado: ajuste as alíquotas ou desligue a retenção.
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] font-semibold">
                        <button
                          type="button"
                          onClick={() => setAjustando((a) => !a)}
                          aria-expanded={ajustando}
                          disabled={pending}
                          className="text-california-red underline-offset-2 hover:underline disabled:opacity-50"
                        >
                          {ajustando ? "Ocultar alíquotas" : "Ajustar alíquotas"}
                        </button>
                        {pp.ultimaRetencao && (
                          <button
                            type="button"
                            onClick={() => {
                              v.repetir();
                              travarIss();
                              setErro(null);
                            }}
                            disabled={pending}
                            className="text-california-red underline-offset-2 hover:underline disabled:opacity-50"
                          >
                            Repetir as da {pp.ultimaRetencao.referencia} (mesmo fornecedor)
                          </button>
                        )}
                      </div>
                      {ajustando && (
                        <GradeDeAliquotas
                          v={v}
                          issTravadoPor={
                            issTravado !== undefined
                              ? `ISS da NF já registrado com a ${registroComIss?.na_pp ?? "outra PP"}`
                              : null
                          }
                        />
                      )}
                      {issTravado !== undefined && (
                        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground text-pretty">
                          <Lock className="mt-0.5 h-3 w-3 flex-none" />
                          <span>
                            {issTravado
                              ? `ISS retido de ${percentual(issTravado)}, o mesmo registrado na aprovação da ${registroComIss?.na_pp ?? "outra PP"}: a NF é a mesma.`
                              : `Sem ISS retido, como na aprovação da ${registroComIss?.na_pp ?? "outra PP"}: a NF é a mesma.`}
                          </span>
                        </p>
                      )}
                      {(darfs.length > 0 || guiasIss.length > 0 || (guias.iss > 0 && notasJaRegistradas.length > 0)) && (
                        <p className="text-[11px] leading-snug text-muted-foreground text-pretty">
                          {darfs.length > 0 && (
                            <>
                              Geram{" "}
                              {darfs.map((d, i) => (
                                <React.Fragment key={d.codigo}>
                                  {i > 0 && " e "}
                                  DARF {d.codigo}{" "}
                                  <b className="font-mono font-semibold">
                                    {formatCurrency(d.valor, "BRL")}
                                  </b>
                                </React.Fragment>
                              ))}
                              , na apuração do mês do pagamento
                              {mesDoPagamento ? ` (${nomeDoMes(mesDoPagamento)})` : ""}
                              {vencFederal && (
                                <>
                                  , com vencimento em{" "}
                                  <b className="font-semibold">{dataBr(vencFederal.data)}</b>
                                </>
                              )}
                              .
                            </>
                          )}
                          {guiasIss.map((g, i) => (
                            <React.Fragment key={g.chave}>
                              {darfs.length > 0 || i > 0 ? " E a" : "Gera a"} guia municipal do
                              ISS retido,{" "}
                              <b className="font-mono font-semibold">
                                {formatCurrency(g.valor, "BRL")}
                              </b>
                              , de {g.municipio}-{g.uf}, na apuração do mês da emissão da NF (
                              {nomeDoMes(g.mes)}), com vencimento em{" "}
                              <b className="font-semibold">{dataBr(g.vencimento)}</b>.
                            </React.Fragment>
                          ))}
                          {guias.iss > 0 && notasJaRegistradas.length > 0 && (
                            <>
                              {" "}
                              O ISS retido da NF{" "}
                              {notasJaRegistradas.map((nf) => nf.numero.trim()).join(", ")} já
                              entrou na apuração com a{" "}
                              {registroDeOutra(notasJaRegistradas[0])?.na_pp ?? "outra PP"}.
                            </>
                          )}
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Módulo fiscal: o crédito de PIS/COFINS de cada NF. Automático
              pela regra (fornecedor PJ com NF), no mês da emissão, pelo
              valor cheio da nota; a parte do 12.08 sai na Apuração, pelo
              rateio proporcional do mês (decisão 146). O financeiro só tira
              o crédito, e com motivo. A nota que outra PP registrou só é
              lembrada: o crédito dela já está na apuração (decisão 152). */}
          {nfs && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-sm font-bold">Crédito de PIS/COFINS</p>
              {!creditos ? (
                <p className="text-[12px] leading-snug text-muted-foreground">
                  Aparece quando a data de emissão e o valor das notas estiverem preenchidos.
                </p>
              ) : (
                <>
                  {creditos.map(({ nf, registro, credito }) => (
                    <p key={nf.anexo_id} className="text-[12.5px] leading-relaxed">
                      <span
                        className={cn(
                          "mr-2 inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 align-[1px] text-[10px] font-bold uppercase tracking-wide",
                          PILULA_DO_CREDITO[credito.final.estado].tom,
                        )}
                      >
                        {PILULA_DO_CREDITO[credito.final.estado].texto}
                      </span>
                      {/* Sem crédito, o valor continua à vista, riscado: quem
                          tira o crédito vê quanto está deixando de tomar. */}
                      <b
                        title={`PIS ${percentual(credito.aliquotaPis)} ${formatCurrency(credito.final.pis, "BRL")} + COFINS ${percentual(credito.aliquotaCofins)} ${formatCurrency(credito.final.cofins, "BRL")}`}
                        className={cn(
                          "font-mono font-semibold",
                          !credito.final.gera &&
                            "text-muted-foreground line-through decoration-muted-foreground/60",
                        )}
                      >
                        {formatCurrency(credito.final.total, "BRL")}
                      </b>{" "}
                      <span className={cn(!credito.final.gera && "text-muted-foreground")}>
                        {nfs.length > 1 && `NF ${nf.numero.trim()} · `}
                        {registro
                          ? `já na apuração, registrada com a ${registro.na_pp ?? "outra PP"}`
                          : credito.final.mes
                            ? `na apuração de ${credito.final.mes} (mês da emissão da NF)`
                            : "na apuração do mês da emissão da NF"}
                      </span>
                    </p>
                  ))}
                  {creditosNovos[0] && (
                    <p className="text-[11.5px] leading-snug text-muted-foreground text-pretty">
                      {creditosNovos[0].credito.final.motivo}
                    </p>
                  )}
                  {podeTirarCredito && (
                    <>
                      <label className="flex w-fit cursor-pointer items-center gap-2 text-[13px] font-semibold">
                        <Checkbox
                          checked={semCredito}
                          disabled={pending}
                          onCheckedChange={(c) => {
                            setSemCredito(c === true);
                            if (c !== true) setMotivoSemCredito("");
                            setErro(null);
                          }}
                          aria-label="Não gera crédito"
                          className="rounded-[4px]"
                        />
                        Não gera crédito
                        <span className="text-[11px] font-normal text-muted-foreground">
                          só o financeiro altera
                        </span>
                      </label>
                      {semCredito && (
                        <div className="space-y-1">
                          <label
                            htmlFor="aprovar-pp-motivo-credito"
                            className="text-xs font-semibold"
                          >
                            Motivo <span className="text-california-red">*</span>
                          </label>
                          <Select
                            value={motivoSemCredito === "" ? undefined : motivoSemCredito}
                            disabled={pending}
                            onValueChange={(x) => {
                              setMotivoSemCredito(x);
                              setErro(null);
                            }}
                          >
                            <SelectTrigger
                              id="aprovar-pp-motivo-credito"
                              aria-label="Motivo"
                              className="h-9 w-full text-xs"
                            >
                              <SelectValue placeholder="Escolha o motivo…" />
                            </SelectTrigger>
                            <SelectContent>
                              {MOTIVOS_SEM_CREDITO.map((m) => (
                                <SelectItem key={m} value={m} className="text-xs">
                                  {m}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2.5 border-t border-border pt-4">
          <span className="text-[11px] text-muted-foreground">
            {pp.parcelas > 1
              ? `Cria ${pp.parcelas} títulos a pagar`
              : "Cria 1 título a pagar"}
          </span>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="ml-auto rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-muted disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleAprovar}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {pending ? "Aprovando..." : "Aprovar"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Módulo fiscal: a chave liga/desliga, com o desenho da chave da baixa
 *  (`components/financeiro/valor-da-baixa.tsx`). */
function Chave({
  id,
  ligada,
  onChange,
  rotulo,
  desligada,
}: {
  id: string;
  ligada: boolean;
  onChange: (x: boolean) => void;
  rotulo: string;
  desligada: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={ligada}
      aria-label={rotulo}
      disabled={desligada}
      onClick={() => onChange(!ligada)}
      className={cn(
        "relative inline-flex h-5 w-9 flex-none items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed",
        ligada ? "bg-california-red" : "bg-muted-foreground/30",
        desligada && !ligada && "bg-[#e5e5e5]",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
          ligada ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

/**
 * Módulo fiscal: a grade compacta do "Ajustar alíquotas" — imposto,
 * alíquota e valor, um calcula o outro (como na baixa, decisão 125), sobre
 * o valor da NF.
 */
function GradeDeAliquotas({
  v,
  issTravadoPor,
}: {
  v: EstadoDoValorDaBaixa;
  /** Decisão 152: a NF já registrada por outra PP trava o ISS (o motivo). */
  issTravadoPor: string | null;
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-2.5">
      <div className="grid grid-cols-[minmax(0,1fr)_88px_128px] gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <span>Imposto</span>
        <span className="text-right">Alíquota</span>
        <span className="text-right">Valor</span>
      </div>
      {IMPOSTOS_RETIDOS.map(({ imposto, dica }) => (
        <div
          key={imposto}
          className="grid grid-cols-[minmax(0,1fr)_88px_128px] items-center gap-2"
        >
          <span className="text-[12.5px] font-semibold" title={dica}>
            {imposto}
          </span>
          <PercentualCompacto
            valor={v.aliquotas[imposto]}
            onChange={(x) => v.porAliquota(imposto, x)}
            rotulo={`Alíquota de ${imposto}`}
            travadoPor={imposto === "ISS" ? issTravadoPor : null}
          />
          <MoneyInput
            value={v.valores[imposto]}
            onValueChange={(x) => v.porValor(imposto, arredondar(x))}
            aria-label={`Valor retido de ${imposto}`}
            disabled={imposto === "ISS" && issTravadoPor !== null}
            title={imposto === "ISS" ? (issTravadoPor ?? undefined) : undefined}
            className="h-8 px-2 text-right text-xs"
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Módulo fiscal: percentual pt-BR controlado ("0,65"), o mesmo
 * comportamento do campo de alíquota da baixa, na altura compacta. O texto
 * é do campo enquanto se digita; só se reescreve quando o número muda por
 * fora (o "Repetir", ou o valor informado à mão recalculando a alíquota).
 */
function PercentualCompacto({
  valor,
  onChange,
  rotulo,
  travadoPor = null,
}: {
  valor: number | null;
  onChange: (x: number | null) => void;
  rotulo: string;
  /** O motivo da trava (vira o `title`); null = editável. */
  travadoPor?: string | null;
}) {
  const paraTexto = (n: number | null) =>
    n === null ? "" : n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  const [texto, setTexto] = React.useState(paraTexto(valor));

  React.useEffect(() => {
    // "0," a meio caminho de "0,65" vale nulo, como o `onChange` mandou:
    // não pode reescrever o que a pessoa ainda está digitando.
    const n = Number(texto.replace(",", "."));
    const digitado = texto.trim() === "" || !Number.isFinite(n) || n <= 0 ? null : n;
    if (digitado !== valor) setTexto(paraTexto(valor));
    // Só o número de fora reescreve o texto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={rotulo}
        value={texto}
        disabled={travadoPor !== null}
        title={travadoPor ?? undefined}
        placeholder="0,00"
        onChange={(e) => {
          const limpo = e.target.value.replace(/[^\d,]/g, "");
          setTexto(limpo);
          if (limpo.trim() === "") {
            onChange(null);
            return;
          }
          const n = Number(limpo.replace(",", "."));
          if (Number.isFinite(n)) onChange(n > 0 ? n : null);
        }}
        className="flex h-8 w-full rounded-lg border border-border bg-white py-1 pl-2 pr-6 text-right font-mono text-xs tabular-nums transition-colors placeholder:text-muted-foreground/60 hover:border-california-red/40 focus-visible:border-california-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-california-red/15 disabled:cursor-not-allowed disabled:bg-muted/50 disabled:hover:border-border"
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
        %
      </span>
    </div>
  );
}
