"use client";

/**
 * A aba Títulos da conciliação de uma conta: tudo que aguarda baixa no
 * financeiro — a pagar, a receber, impostos e transferências —, igual para
 * todas as contas, com a conta aberta já escolhida na baixa.
 *
 * Desde a decisão 195 (task 029, fase 1) a aba é a planilha de títulos nas
 * colunas do Extrato (`components/financeiro/planilha-de-titulos`): cada
 * linha é o lançamento que a baixa vai gravar nesta conta, com o saldo
 * previsto corrente, agrupada por dia e com o aviso de quando a conta fica
 * negativa — o desenho "Alternativa" do protótipo aprovado
 * (docs/handoffs/2026-10-21-conciliacao-com-o-banco).
 *
 * "Baixar" abre a baixa REAL de cada lado — `BaixaTituloDialog`,
 * `BaixaRecebimentoDialog`, `BaixaImpostoDialog` e o "Registrar" da
 * transferência —, com o mesmo `alvo` que as listas montam
 * (`alvos-da-baixa.ts`) e as mesmas Server Actions, com as travas delas.
 * As ações que moravam soltas na linha estão no ⓘ.
 */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCheck, FileText, Info, Search, Trash2, Undo2, XCircle, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { BaixaTituloDialog } from "@/components/financeiro/baixa-titulo-dialog";
import {
  BaixaEmLoteDialog,
  BarraDeSelecao,
  CaixaDaLinha,
  CaixaDoCabecalho,
  elegivelDoLote,
  useSelecao,
  type TituloParaLote,
} from "@/components/financeiro/baixa-em-lote";
import { ConferenciaDasBaixas, type TituloConferido } from "@/components/financeiro/conferencia-das-baixas";
import { PlanilhaDeTitulos } from "@/components/financeiro/planilha-de-titulos/planilha";
import { colunasFiltraveis } from "@/components/financeiro/planilha-de-titulos/colunas";
import { BotaoDetalhes, type AcaoDoDetalhe } from "@/components/financeiro/detalhes-do-titulo/botao-detalhes";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BarraDosFiltrosDeColuna, useFiltrosDeColuna } from "@/components/ui/filtro-de-coluna";
import { lerCompetencia, rotuloCurto } from "@/lib/cartoes/competencia";
import {
  comSaldoPrevisto,
  dataEfetiva,
  fimDoMes,
  r2,
  type LinhaComSaldo,
} from "@/lib/financeiro/planilha-de-titulos";
import { BaixaRecebimentoDialog } from "../contas-a-receber/baixa-recebimento-dialog";
import { TransferirDialog } from "../contas-a-receber/transferir-dialog";
import { EditarPrevisaoDialog } from "../contas-a-receber/editar-previsao-dialog";
import { EditarDataPagamentoDialog } from "../contas-a-pagar/editar-data-pagamento-dialog";
import { DevolverFolhaDialog } from "../contas-a-pagar/devolver-folha-dialog";
import {
  darBaixaTitulo as darBaixaTituloAPagar,
  repactuarDataPagamento,
} from "../contas-a-pagar/actions-titulos";
import { darBaixaTitulo as darBaixaTituloAReceber, repactuarPrevisaoRecebimento } from "../contas-a-receber/actions";
import {
  darBaixaRecebimentoAvulso,
  darBaixaTransferencia,
  excluirTituloReceberAvulso,
} from "../contas-a-receber/actions-recebimento-avulso";
import { BaixaImpostoDialog, CancelarImpostoDialog, CENTRO } from "../fiscal/impostos/dialogos";
import type { DadosDaAbaTitulos } from "./titulos-dados";
import { gravarPrevia, type LinhaPrevista } from "./previa-do-extrato";
import { MenuNovoLancamento } from "./menu-novo-lancamento";
import { BotaoRemessaSantander } from "./botao-remessa";
import { alvoDaBaixaAPagar, alvoDaBaixaAReceber, faltaPagar, faltaReceber } from "./alvos-da-baixa";
import {
  casaVencimento,
  montarLinhas,
  prepararContexto,
  type FiltroVencimento,
  type Lado,
  type Linha,
} from "./linhas-da-aba";

// ---------------------------------------------------------------------------
// Datas e dinheiro
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

type FiltroTipo = "todos" | Lado;

const CHIPS_TIPO: Array<{ key: FiltroTipo; label: string }> = [
  { key: "todos", label: "Todos" },
  { key: "pagar", label: "A pagar" },
  { key: "receber", label: "A receber" },
  { key: "imposto", label: "Impostos" },
  { key: "transferencia", label: "Transferências" },
];

// ---------------------------------------------------------------------------
// O componente
// ---------------------------------------------------------------------------

export function AbaTitulos({
  dados,
  contaId,
  nomeDaConta,
  saldoHoje,
  dataDe,
  dataAte,
}: {
  dados: DadosDaAbaTitulos;
  /** A conta aberta na conciliação: vem escolhida na baixa. */
  contaId: string;
  nomeDaConta: string;
  /** O saldo da conta no fim de hoje: o começo do saldo previsto. */
  saldoHoje: number;
  /** O período aberto no Extrato, para o aviso de onde o movimento foi
   *  parar depois da baixa. */
  dataDe: string;
  dataAte: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const [vencimento, setVencimento] = React.useState<FiltroVencimento>("todos");
  const [tipo, setTipo] = React.useState<FiltroTipo>("todos");
  const [busca, setBusca] = React.useState("");
  const [agrupar, setAgrupar] = React.useState(true);
  const [baixando, setBaixando] = React.useState<Linha | null>(null);
  const [editando, setEditando] = React.useState<Linha | null>(null);
  const [conferindo, setConferindo] = React.useState<TituloConferido | null>(null);
  const [cancelandoImposto, setCancelandoImposto] = React.useState<Linha | null>(null);
  const [devolvendoFolha, setDevolvendoFolha] = React.useState<Linha | null>(null);
  const [excluindo, setExcluindo] = React.useState<Linha | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  /** "Criar e dar baixa" pelo "Novo lançamento": a baixa abre quando o
   *  título novo chega do servidor. */
  const [baixarAposCriar, setBaixarAposCriar] = React.useState<{ lado: "pagar" | "receber" | "imposto"; id: string } | null>(
    null,
  );

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const hoje = dados.hoje;
  const fim = fimDoMes(hoje);

  const linhas = React.useMemo(() => {
    const ctx = prepararContexto({
      hoje,
      empresas: dados.empresas,
      tipos: dados.tipos,
      subtipos: dados.subtipos,
      cartoes: dados.cartoes,
      contas: dados.contas,
      centroDoImposto: CENTRO,
      extras: dados.extras,
    });
    return montarLinhas(dados.aPagar, dados.aReceber, dados.impostos, ctx);
  }, [dados, hoje]);

  React.useEffect(() => {
    if (!baixarAposCriar) return;
    const nova = linhas.find((l) =>
      baixarAposCriar.lado === "pagar"
        ? l.lado === "pagar" && l.t.id === baixarAposCriar.id
        : baixarAposCriar.lado === "receber"
          ? l.lado === "receber" && l.t.conta_avulsa_id === baixarAposCriar.id
          : l.lado === "imposto" && l.t.id === baixarAposCriar.id,
    );
    if (!nova) return;
    setBaixarAposCriar(null);
    setErro(null);
    setBaixando(nova);
  }, [linhas, baixarAposCriar]);

  // O saldo previsto sai de TODAS as linhas, antes de qualquer filtro: ele
  // não muda com o filtro, como o Saldo do Extrato.
  const todas = React.useMemo(() => comSaldoPrevisto(linhas, saldoHoje, contaId), [linhas, saldoHoje, contaId]);
  const negativo = todas.find((l) => l.saldo < 0) ?? null;
  const saldoNoFim = todas.length ? todas[todas.length - 1].saldo : saldoHoje;
  const saem = r2(todas.filter((l) => l.efeito < 0 && dataEfetiva(l, hoje) <= fim).reduce((s, l) => s - l.efeito, 0));
  const entram = r2(todas.filter((l) => l.efeito > 0 && dataEfetiva(l, hoje) <= fim).reduce((s, l) => s + l.efeito, 0));

  // As contagens dos tipos seguem a busca e o vencimento, não o tipo: o
  // número é "quantas linhas apareceriam se eu clicasse aqui".
  const base = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return todas.filter((l) => casaVencimento(l.vencimento ?? l.dataPrevista, vencimento, hoje) && (!q || l.busca.includes(q)));
  }, [todas, busca, vencimento, hoje]);
  const contagem: Record<FiltroTipo, number> = {
    todos: base.length,
    pagar: base.filter((l) => l.lado === "pagar").length,
    receber: base.filter((l) => l.lado === "receber").length,
    imposto: base.filter((l) => l.lado === "imposto").length,
    transferencia: base.filter((l) => l.lado === "transferencia").length,
  };
  const doTopo = React.useMemo(() => (tipo === "todos" ? base : base.filter((l) => l.lado === tipo)), [base, tipo]);
  const colunasDoFiltro = React.useMemo(
    () => colunasFiltraveis({ contaId, hoje, rotuloContraparte: "Fornecedor / Cliente", status: false }),
    [contaId, hoje],
  );
  const colunas = useFiltrosDeColuna<LinhaComSaldo<Linha>>(doTopo, colunasDoFiltro, {
    guardarEm: "conciliacao-titulos-planilha",
    contexto: contaId,
  });
  const filtrados = colunas.visiveis;

  // A baixa em lote, como nas listas: uma origem por lote (revisão da
  // decisão 140), e o que some do filtro sai da seleção.
  const elegiveis = filtrados.flatMap((l) => (l.motivoForaDoLote === null && l.lote ? [elegivelDoLote(l.lote)] : []));
  const selecao = useSelecao(elegiveis);
  const [loteAberto, setLoteAberto] = React.useState(false);
  const marcados = filtrados.filter((l) => selecao.marcado(l.chave));
  const selecionados = marcados.map((l) => l.lote).filter((t): t is TituloParaLote => t !== null);
  const efeitoDosMarcados = r2(marcados.reduce((s, l) => s + l.efeito, 0));

  // ---- A baixa de UM título: a baixa real do lado dele ----

  const baixandoPagar = baixando?.lado === "pagar" ? baixando.t : null;
  const baixandoReceber = baixando?.lado === "receber" ? baixando.t : null;
  const baixandoImposto = baixando?.lado === "imposto" ? baixando.t : null;
  const baixandoTransferencia = baixando?.lado === "transferencia" ? baixando.t : null;
  const contasDoImposto = React.useMemo(
    () => dados.contas.map((c) => ({ id: c.id, nome: c.nome, banco: c.banco, empresa_contabil_id: c.empresa_contabil_id })),
    [dados.contas],
  );

  /** Onde o movimento foi parar, para o aviso depois da baixa. */
  function avisoDaBaixa(contaEscolhidaId: string | null, data: string): string {
    if (contaEscolhidaId !== contaId) {
      const outra = dados.contas.find((c) => c.id === contaEscolhidaId);
      return `Baixa registrada na conta ${outra?.nome ?? "escolhida"}, em ${formatDate(data)}: o movimento está no extrato dela.`;
    }
    if (data < dataDe || data > dataAte) {
      return `Baixa registrada em ${formatDate(data)}, fora do período aberto: o movimento está no Extrato desse período.`;
    }
    return `Baixa registrada. O movimento já está no Extrato desta conta, em ${formatDate(data)}.`;
  }

  function fechar() {
    setBaixando(null);
    setErro(null);
  }

  /** "Ver no Extrato antes": os marcados vão para o Extrato como previstos. */
  function verNoExtratoAntes() {
    const previstas: LinhaPrevista[] = marcados.map((l) => ({
      chave: l.chave,
      data: dataEfetiva(l, hoje),
      credito: l.efeito > 0 ? l.efeito : 0,
      debito: l.efeito < 0 ? -l.efeito : 0,
      descricao: l.descricao,
      contraparte: l.contraparte,
      job: l.job?.codigo ?? null,
      centro: l.centro.tipo === "plano" ? l.centro.rotulo : l.centro.tipo === "fora_do_dre" ? "Fora do DRE" : "definir na baixa",
      centroCompleto: l.centro.tipo === "plano" ? l.centro.completo : "",
      empresa: l.empresa,
      rateio: l.rateio,
    }));
    gravarPrevia(contaId, previstas);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("aba");
    params.delete("highlight");
    router.replace(`/financeiro/conciliacao?${params.toString()}`, { scroll: false });
  }

  /** As ações da tela de origem, no ⓘ (decisão 195). */
  function acoesDaLinha(l: Linha): AcaoDoDetalhe[] {
    const acoes: AcaoDoDetalhe[] = [];
    if (l.lado === "pagar" && l.t.baixas.length > 0) {
      const t = l.t;
      acoes.push({ rotulo: "Ver as baixas", icone: Eye, onClick: () => setConferindo({ lado: "pagar", t }) });
    }
    if (l.lado === "receber" && l.t.baixas.length > 0) {
      const t = l.t;
      acoes.push({ rotulo: "Ver as baixas", icone: Eye, onClick: () => setConferindo({ lado: "receber", t }) });
    }
    if (l.lado === "pagar" && l.t.origem === "folha" && l.t.baixas.length === 0) {
      acoes.push({ rotulo: "Devolver para a aprovação", icone: Undo2, onClick: () => setDevolvendoFolha(l) });
    }
    if (l.lado === "imposto") {
      // O valor da guia só muda na Apuração, onde ela é aprovada; aqui, na
      // baixa, só entram multa e juros (decisão 195).
      acoes.push({
        rotulo: "Abrir na Apuração",
        icone: FileText,
        onClick: () => router.push("/financeiro/fiscal"),
      });
      acoes.push({ rotulo: "Cancelar o imposto", icone: XCircle, perigo: true, onClick: () => setCancelandoImposto(l) });
    }
    if ((l.lado === "receber" && l.t.origem !== "nf" && l.t.baixas.length === 0) || l.lado === "transferencia") {
      acoes.push({
        rotulo: l.lado === "transferencia" ? "Excluir a transferência" : "Excluir este título",
        icone: Trash2,
        perigo: true,
        onClick: () => setExcluindo(l),
      });
    }
    return acoes;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5" />
          Tudo que aguarda baixa no financeiro, nas colunas do Extrato: cada linha é o lançamento que a baixa vai gravar
          nesta conta.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <BotaoRemessaSantander />
          <MenuNovoLancamento
            onCriado={(mensagem, paraBaixar) => {
              setToast(mensagem);
              if (paraBaixar) {
                // O título novo só existe depois do `router.refresh()`.
                setVencimento("todos");
                setTipo("todos");
                setBusca("");
                colunas.limpar();
                setBaixarAposCriar(paraBaixar);
              }
            }}
          />
        </div>
      </div>

      {/* O resumo: o que sai e entra no mês e onde o saldo termina. */}
      <div className="grid grid-cols-2 divide-x divide-border rounded-xl border border-border bg-card sm:grid-cols-4">
        {[
          [`Saldo de hoje · ${nomeDaConta}`, saldoHoje, ""],
          [`Saem até ${formatDate(fim).slice(0, 5)}`, saem, "text-california-red"],
          [`Entram até ${formatDate(fim).slice(0, 5)}`, entram, "text-emerald-700"],
          ["Saldo previsto no fim da lista", saldoNoFim, saldoNoFim < 0 ? "text-california-red" : ""],
        ].map(([rotulo, valor, cor]) => (
          <div key={rotulo as string} className="px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{rotulo}</p>
            <p className={cn("mt-0.5 font-mono text-base font-semibold", cor as string)}>{formatBRL(valor as number)}</p>
          </div>
        ))}
      </div>
      {negativo && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Se tudo for pago nesta conta, ela fica negativa em <strong>{formatDate(dataEfetiva(negativo, hoje))}</strong> (
            {formatBRL(negativo.saldo)}). Vale transferir antes ou pagar parte por outra conta.
          </span>
        </div>
      )}

      {/* Linha 1: vencimento e o agrupamento. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Vencimento</span>
        <StatusChip ativo={vencimento === "vencidos"} onClick={() => setVencimento("vencidos")} label="Vencidos" />
        <StatusChip ativo={vencimento === "ate_hoje"} onClick={() => setVencimento("ate_hoje")} label="Até hoje" />
        <StatusChip ativo={vencimento === "proximos_7"} onClick={() => setVencimento("proximos_7")} label="Próximos 7 dias" />
        <StatusChip ativo={vencimento === "todos"} onClick={() => setVencimento("todos")} label="Todos" />
        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-muted-foreground">
          <input
            type="checkbox"
            checked={agrupar}
            onChange={(e) => setAgrupar(e.target.checked)}
            className="h-3.5 w-3.5 accent-california-red"
          />
          Agrupar por dia
        </label>
      </div>

      {/* Linha 2: busca e o tipo, com contagem. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por título, contraparte, empresa ou job..."
            className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm focus:border-california-red focus:outline-none"
          />
        </div>
        {CHIPS_TIPO.map((c) => (
          <Chip key={c.key} ativo={tipo === c.key} onClick={() => setTipo(c.key)} label={c.label} count={contagem[c.key]} />
        ))}
      </div>

      {colunas.ativo && (
        <BarraDosFiltrosDeColuna
          visiveis={colunas.visiveis.length}
          total={colunas.total}
          singular="título"
          plural="títulos"
          onLimpar={colunas.limpar}
        />
      )}

      <PlanilhaDeTitulos<Linha>
        linhas={filtrados}
        contaId={contaId}
        hoje={hoje}
        mostrarSaldo
        // A ordem pelo título de uma coluna desfaz a ordem do dia.
        agruparPorDia={agrupar && !colunas.ordenacao}
        titulo={(chave) => colunas.titulo(chave)}
        cabecalhoDaSelecao={<CaixaDoCabecalho {...selecao.cabecalho} />}
        caixa={(l) => {
          const motivo = l.motivoForaDoLote ?? selecao.foraDaOrigem(l.chave);
          return (
            <span title={motivo ?? undefined}>
              <CaixaDaLinha
                marcado={selecao.marcado(l.chave)}
                onAlternar={() => selecao.alternar(l.chave)}
                disponivel={motivo === null}
                motivo={motivo ?? undefined}
              />
            </span>
          );
        }}
        onBaixar={(l) => {
          setErro(null);
          setBaixando(l);
        }}
        onEditarData={(l) => {
          setErro(null);
          setEditando(l);
        }}
        onVerBaixas={(l) => {
          if (l.lado === "pagar") setConferindo({ lado: "pagar", t: l.t });
          if (l.lado === "receber") setConferindo({ lado: "receber", t: l.t });
        }}
        detalhes={(l) => (
          <BotaoDetalhes
            chave={l.chave}
            titulo={l.descricao}
            recebimento={l.entra}
            job={l.job}
            vencimentoDiferente={l.vencimento && l.vencimento !== l.dataPrevista ? l.vencimento : null}
            retencoes={l.valor.retencoes}
            rateio={l.rateio}
            acoes={acoesDaLinha(l)}
          />
        )}
        saldoHoje={saldoHoje}
        vazio={
          linhas.length === 0
            ? "Nenhum título aguardando baixa."
            : doTopo.length > 0
              ? "Nenhum título com esse filtro."
              : "Nenhum título encontrado com esses filtros."
        }
      />

      {/* A barra da seleção — quantos títulos, o que sai e o que entra, como
          a conta fica e "Dar baixa" —, e o diálogo do lote. */}
      <BarraDeSelecao
        itens={selecionados}
        onLimpar={selecao.limpar}
        onBaixar={() => setLoteAberto(true)}
        totais={{
          saem: r2(marcados.filter((l) => l.efeito < 0).reduce((s, l) => s - l.efeito, 0)),
          entram: r2(marcados.filter((l) => l.efeito > 0).reduce((s, l) => s + l.efeito, 0)),
        }}
        saldoDepois={{ nomeDaConta: "A conta", valor: r2(saldoHoje + efeitoDosMarcados) }}
        onVerNoExtrato={verNoExtratoAntes}
      />
      <BaixaEmLoteDialog
        open={loteAberto}
        onOpenChange={setLoteAberto}
        itens={selecionados}
        contas={dados.contas}
        tipos={dados.tipos}
        subtipos={dados.subtipos}
        // A conta-espelho do cartão, aberta por link direto, não é conta de
        // baixa: aí o lote abre sem conta, como as baixas de um título.
        contaPadrao={dados.contas.some((c) => c.id === contaId) ? contaId : null}
        tenantId={dados.tenantId}
        nomesDasPJs={dados.nomesDasPJs}
        onConcluido={(mensagem) => {
          selecao.limpar();
          setToast(mensagem);
        }}
      />

      {/* A pagar: a baixa real de Contas a Pagar, com a conta aberta. */}
      <BaixaTituloDialog
        open={baixandoPagar !== null}
        onOpenChange={(o) => {
          if (!o) fechar();
        }}
        alvo={baixandoPagar ? alvoDaBaixaAPagar(baixandoPagar, dados.ultimasRetencoesPagar) : null}
        contas={dados.contas}
        tipos={dados.tipos}
        subtipos={dados.subtipos}
        cartoes={dados.cartoes}
        formaPlanejada={baixandoPagar?.forma_pagamento ?? baixandoPagar?.forma_prevista ?? null}
        cartaoPlanejadoId={baixandoPagar?.cartao_credito_id ?? baixandoPagar?.cartao_previsto_id ?? null}
        pending={pending}
        erro={erro}
        contaInicial={contaId}
        onConfirm={(payload) => {
          const alvo = baixandoPagar;
          if (!alvo) return;
          startTransition(async () => {
            const res = await darBaixaTituloAPagar({ origem: alvo.origem, id: alvo.id, ...payload });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            fechar();
            if (payload.forma_pagamento === "cartao_credito") {
              // No cartão nada sai da conta: o item entra numa fatura, e a
              // fatura vem do SERVIDOR (a da data pode já ter fechado).
              const cartao = dados.cartoes.find((c) => c.id === payload.cartao_credito_id) ?? null;
              const competencia = res.fatura ? lerCompetencia(res.fatura.competencia_fechamento.slice(0, 7)) : null;
              setToast(
                res.fatura
                  ? `Confirmado no cartão · ${formatBRL(alvo.valor)} entrou na fatura${competencia ? ` de ${rotuloCurto(competencia)}` : ""}${cartao ? ` do ${cartao.nome}` : ""} (${res.fatura.codigo}). Nada sai da conta bancária agora.`
                  : "Baixa registrada no cartão: o item entra na fatura, e nada sai da conta bancária agora.",
              );
            } else {
              const retido = payload.retencoes.reduce((acc, r) => acc + Math.round(r.valor * 100), 0) / 100;
              const resta = Math.round((faltaPagar(alvo) - payload.valor_baixa) * 100) / 100;
              setToast(
                avisoDaBaixa(payload.conta_bancaria_id, payload.pago_em) +
                  (retido > 0 ? ` ${formatBRL(retido)} retidos, a recolher.` : "") +
                  (resta > 0.004 ? ` Faltam ${formatBRL(resta)}.` : ""),
              );
            }
            router.refresh();
          });
        }}
      />

      {/* A receber: a baixa real de Contas a Receber, com a conta aberta. */}
      <BaixaRecebimentoDialog
        open={baixandoReceber !== null}
        onOpenChange={(o) => {
          if (!o) fechar();
        }}
        alvo={baixandoReceber ? alvoDaBaixaAReceber(baixandoReceber, dados.ultimasRetencoesReceber, hoje) : null}
        contas={dados.contas}
        tipos={dados.tipos}
        subtipos={dados.subtipos}
        pending={pending}
        erro={erro}
        contaInicial={contaId}
        onConfirm={(payload) => {
          const alvo = baixandoReceber;
          if (!alvo) return;
          startTransition(async () => {
            const res =
              alvo.origem === "nf"
                ? await darBaixaTituloAReceber({ titulo_id: alvo.id, ...payload })
                : await darBaixaRecebimentoAvulso({ conta_avulsa_id: alvo.conta_avulsa_id, ...payload });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            fechar();
            const retido = payload.retencoes.reduce((acc, r) => acc + Math.round(r.valor * 100), 0) / 100;
            const resta = Math.round((faltaReceber(alvo) - payload.valor_baixa) * 100) / 100;
            setToast(
              avisoDaBaixa(payload.conta_bancaria_id, payload.pago_em) +
                (retido > 0 ? ` ${formatBRL(retido)} de impostos retidos.` : "") +
                (resta > 0.004 ? ` Faltam ${formatBRL(resta)}.` : ""),
            );
            router.refresh();
          });
        }}
      />

      {/* Imposto: a baixa de Impostos a Pagar, com a conta aberta. */}
      {baixandoImposto && (
        <BaixaImpostoDialog
          imposto={baixandoImposto}
          contas={contasDoImposto}
          nomesDasPJs={dados.nomesDasPJs}
          tenantId={dados.tenantId}
          contaInicial={contaId}
          onClose={fechar}
          onBaixado={({ pago_em, conta_bancaria_id }) => {
            fechar();
            setToast(avisoDaBaixa(conta_bancaria_id, pago_em));
            router.refresh();
          }}
        />
      )}

      {/* Transferência: o "Registrar" de Contas a Receber. */}
      <TransferirDialog
        open={baixandoTransferencia !== null}
        onOpenChange={(o) => {
          if (!o) fechar();
        }}
        alvo={
          baixandoTransferencia
            ? {
                id: baixandoTransferencia.id,
                codigo: baixandoTransferencia.codigo_avulsa ?? "—",
                contas: baixandoTransferencia.contraparte_nome,
                descricao:
                  baixandoTransferencia.fat_descricao === "Transferência entre contas" ? null : baixandoTransferencia.fat_descricao,
                valor: baixandoTransferencia.valor,
                dataPrevista: baixandoTransferencia.data_previsao_recebimento,
              }
            : null
        }
        pending={pending}
        erro={erro}
        onConfirmar={(data) => {
          const alvo = baixandoTransferencia;
          if (!alvo) return;
          startTransition(async () => {
            const res = await darBaixaTransferencia({ transferencia_id: alvo.id, data });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            fechar();
            setToast(`Transferência registrada · ${formatBRL(alvo.valor)} em ${formatDate(data)}, com as duas linhas no extrato.`);
            router.refresh();
          });
        }}
      />

      {/* O lápis da data prevista: a pagar (PP, avulso, recorrência,
          folha) e a nota a receber. */}
      <EditarDataPagamentoDialog
        open={editando?.lado === "pagar"}
        onOpenChange={(o) => {
          if (!o) {
            setEditando(null);
            setErro(null);
          }
        }}
        alvo={
          editando?.lado === "pagar"
            ? {
                titulo: editando.t.descricao,
                origem:
                  editando.t.origem === "pp"
                    ? `${editando.t.origem_label} · ${editando.t.parcela_numero}/${editando.t.parcela_total}`
                    : editando.t.origem_label,
                vencOriginal: editando.t.venc_original,
                primeiraData: editando.t.data_pagamento_primeira,
                dataAtual: editando.t.data_pagamento,
              }
            : null
        }
        pending={pending}
        erro={erro}
        onSalvar={(novaData) => {
          if (editando?.lado !== "pagar") return;
          const alvo = editando.t;
          startTransition(async () => {
            const res = await repactuarDataPagamento({ origem: alvo.origem, id: alvo.id, data_pagamento: novaData });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            setEditando(null);
            setErro(null);
            setToast(`Data prevista de pagamento atualizada para ${formatDate(novaData)}.`);
            router.refresh();
          });
        }}
      />
      <EditarPrevisaoDialog
        open={editando?.lado === "receber"}
        onOpenChange={(o) => {
          if (!o) {
            setEditando(null);
            setErro(null);
          }
        }}
        alvo={
          editando?.lado === "receber"
            ? {
                numeroNf: editando.t.fat_numero_nf,
                parcela: `${editando.t.numero_parcela}/${editando.t.total_parcelas}`,
                cliente: editando.t.contraparte_nome,
                vencimento: editando.t.data_vencimento,
                primeiraPrevisao: editando.t.data_previsao_recebimento_primeira,
                previsaoAtual: editando.t.data_previsao_recebimento,
              }
            : null
        }
        pending={pending}
        erro={erro}
        onSalvar={(novaData) => {
          if (editando?.lado !== "receber") return;
          const alvo = editando.t;
          startTransition(async () => {
            const res = await repactuarPrevisaoRecebimento({ titulo_id: alvo.id, data_previsao_recebimento: novaData });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            setEditando(null);
            setErro(null);
            setToast(`Previsão de recebimento atualizada para ${formatDate(novaData)}.`);
            router.refresh();
          });
        }}
      />

      {/* As ações do ⓘ. */}
      <ConferenciaDasBaixas
        conferindo={conferindo}
        onFechar={() => setConferindo(null)}
        contas={dados.contas.map((c) => ({ id: c.id, nome: c.nome, banco: c.banco }))}
        onDarBaixaNoRestante={(c) => {
          const l = linhas.find((x) => x.lado === c.lado && x.t === c.t) ?? null;
          setBaixando(l);
        }}
        onConcluido={setToast}
      />
      {cancelandoImposto?.lado === "imposto" && (
        <CancelarImpostoDialog
          imposto={cancelandoImposto.t}
          onClose={() => setCancelandoImposto(null)}
          onCancelado={(mensagem) => {
            setCancelandoImposto(null);
            setToast(mensagem);
            router.refresh();
          }}
        />
      )}
      {devolvendoFolha?.lado === "pagar" && (
        <DevolverFolhaDialog
          contaAvulsaId={devolvendoFolha.t.id}
          descricao={devolvendoFolha.t.descricao}
          valor={devolvendoFolha.t.valor}
          open
          onOpenChange={(o) => {
            if (!o) setDevolvendoFolha(null);
          }}
        />
      )}
      <ConfirmDialog
        open={excluindo !== null}
        onOpenChange={(o) => {
          if (!o) {
            setExcluindo(null);
            setErro(null);
          }
        }}
        title={
          excluindo?.lado === "transferencia"
            ? `Excluir a transferência ${excluindo.t.codigo_avulsa ?? ""}?`
            : `Excluir o título ${excluindo?.lado === "receber" ? (excluindo.t.codigo_avulsa ?? "") : ""}?`
        }
        description={
          excluindo && (excluindo.lado === "receber" || excluindo.lado === "transferencia") ? (
            <>
              {excluindo.t.fat_descricao} · {formatBRL(excluindo.t.valor)}. O título sai da lista. Como ainda está em
              aberto, nada sai do extrato. Fica no log de auditoria quem excluiu e quando.
              {erro && <span className="mt-2 block font-medium text-california-red">{erro}</span>}
            </>
          ) : null
        }
        confirmLabel="Excluir"
        variant="destructive"
        pending={pending}
        onConfirm={() => {
          const l = excluindo;
          if (!l || (l.lado !== "receber" && l.lado !== "transferencia") || l.t.origem === "nf") return;
          const alvo = l.t;
          startTransition(async () => {
            const res = await excluirTituloReceberAvulso({
              origem: alvo.origem,
              id: alvo.origem === "transferencia" ? alvo.id : alvo.conta_avulsa_id,
            });
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            setExcluindo(null);
            setErro(null);
            setToast(`${alvo.codigo_avulsa ?? "O título"} excluído.`);
            router.refresh();
          });
        }}
      />

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex max-w-[560px] items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated"
        >
          <CheckCheck className="h-4 w-4 shrink-0 text-emerald-700" />
          <span className="text-sm font-semibold text-emerald-900">{toast}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Fechar aviso" className="text-emerald-700 hover:text-emerald-900">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças pequenas
// ---------------------------------------------------------------------------

/** O chip de status de Títulos a Pagar. */
function StatusChip({ ativo, onClick, label }: { ativo: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        ativo
          ? "border-california-red bg-california-red text-white"
          : "border-border bg-white text-muted-foreground hover:border-california-red/50",
      )}
    >
      {label}
    </button>
  );
}

/** O chip de origem de Títulos a Pagar, com a contagem. */
function Chip({ ativo, onClick, label, count }: { ativo: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        ativo
          ? "border-california-red bg-california-red text-white"
          : "border-border bg-white text-muted-foreground hover:border-california-red/50",
      )}
    >
      {label}
      <span className={cn("tabular-nums", ativo ? "text-white/85" : "text-muted-foreground/70")}>{count}</span>
    </button>
  );
}
