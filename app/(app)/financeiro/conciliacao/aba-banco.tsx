"use client";

/**
 * A aba Conciliação automática de uma conta (task 029, fase 3): o extrato
 * importado do banco, linha a linha, com o que o sistema tem para cada uma
 * — a versão Alternativa do protótipo aprovado
 * (docs/handoffs/2026-10-21-conciliacao-com-o-banco, `banco.jsx`,
 * `AbaBancoRecomendada` com as colunas de `TabelaDoBanco`).
 *
 * - Importar (decisão 198): o OFX é lido aqui (`lerOfx`) e sobe só com as
 *   linhas; a Server Action confere tudo de novo e grava sem repetir.
 * - O motor (decisão 199) roda aqui, sobre as linhas pendentes, os títulos
 *   em aberto da aba Títulos, as baixas da conta ainda sem linha, as
 *   remessas e as regras do histórico (`motor-da-conta.ts`).
 * - Nada se concilia sozinho (decisão 244, revê a 201): o que é certo fica
 *   em Prontos para conciliar, e o "Conciliar os N" da divisão concilia tudo
 *   de uma vez, linha por linha, pelas mesmas actions dos botões.
 * - As ações (decisão 200): "Baixar e conciliar" vai pela baixa em lote de
 *   sempre, com a data e a conta da linha e a forma pelo histórico;
 *   "Conferir" e a lupa abrem a baixa REAL de cada lado (a mesma da aba
 *   Títulos) já com os dados do banco, e a linha se liga à baixa depois
 *   dela; corrigir, lançar pela regra, "saiu e voltou", ignorar e desfazer
 *   são as RPCs da conciliação. "Lançar avulso" abre o formulário de
 *   criação de sempre, preenchido com a linha.
 * - O fechamento (decisão 205): "Fechar a conciliação até dd/mm", que só
 *   liga com as três condições do banco, e "Reabrir o período". Com a
 *   conciliação fechada, desfazer, corrigir e cancelar com data até lá
 *   avisam antes de chamar (o banco recusa de qualquer jeito).
 * - A tela (decisão 234): a fila dividida (fila-dividida.tsx) no lugar das
 *   seções separadas, o "Importar extrato do banco (OFX)" no topo (saiu do
 *   Extrato, que não mostra mais o banco) e o "Agrupar lançamentos" no lugar
 *   do "Conciliar em conjunto".
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCheck, FileUp, Upload, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { decodificarOfx, lerOfx } from "@/lib/conciliacao/ofx";
import { formaDaBaixaPeloHistorico, RETENCOES_COMUNS, retencaoQueExplica, type TituloDoMotor } from "@/lib/conciliacao/motor";
import type { ImpostoRetido } from "@/lib/types";
import { BaixaTituloDialog, type LinhaDoBancoNaBaixa } from "@/components/financeiro/baixa-titulo-dialog";
import { BaixaImpostoDialog, CENTRO } from "../fiscal/impostos/dialogos";
import { cancelarBaixaImposto } from "../fiscal/impostos/actions";
import { BaixaRecebimentoDialog } from "../contas-a-receber/baixa-recebimento-dialog";
import { TransferirDialog } from "../contas-a-receber/transferir-dialog";
import { RecebimentoAvulsoDialog } from "../contas-a-receber/recebimento-avulso-dialog";
import { ContaAvulsaDrawer } from "../contas-a-pagar/conta-avulsa-drawer";
import { darBaixaTitulo as darBaixaTituloAPagar } from "../contas-a-pagar/actions-titulos";
import { darBaixaTitulo as darBaixaTituloAReceber } from "../contas-a-receber/actions";
import { darBaixaRecebimentoAvulso, darBaixaTransferencia } from "../contas-a-receber/actions-recebimento-avulso";
import { mutuoDaLinha, pixDeEmpresaDeFora } from "@/lib/financeiro/mutuo";
import { DialogoDoIof, DialogoDoMutuoNaLinha } from "./mutuo-na-linha";
import { cancelarBaixa, type TipoDeBaixa } from "../actions-baixa-registrada";
import { carregarDadosDoNovoLancamento, type DadosDoNovoLancamento } from "./actions-novo-lancamento";
import type { DadosDaAbaTitulos } from "./titulos-dados";
import type { DadosDaAbaBanco, LancamentoSemLinha } from "./banco-dados";
import { alvoDaBaixaAPagar, alvoDaBaixaAReceber } from "./alvos-da-baixa";
import { montarLinhas, prepararContexto, type Linha } from "./linhas-da-aba";
import {
  conciliarConta,
  documentoDaLinha,
  itemDoLote,
  parcialPeloBanco,
  secoesDoBanco,
  type ResultadoDaLinha,
  type SecoesDoBanco,
} from "./motor-da-conta";
import {
  baixarEConciliar,
  baixarPelaLinha,
  cancelarBaixasDesfeitas,
  conciliarEmConjunto,
  conciliarLinha,
  conciliarPeloHistorico,
  conciliarPelosDocumentos,
  corrigirBaixa,
  criarRegraDeTransferencia,
  criarRegraDoExtrato,
  desfazerConciliacao,
  ignorarLinha,
  importarExtrato,
  lancarPelaRegra,
  ligarItensALinha,
  registrarSaiuEVoltou,
  type ResultadoDaImportacao,
} from "./actions-conciliacao";
import type { AcoesDoBanco, ContextoDasCelulas } from "./banco-tabela";
import { CancelarBaixaDialog, CorrigirBaixaDialog, ProcurarTituloDialog, RegraDialog } from "./banco-dialogos";
import { AgruparLancamentosDialog, type SelecaoDoAgrupamento } from "./agrupar-lancamentos";
import { FilaDividida } from "./fila-dividida";
import { BotoesDoFechamento } from "./fechamento";
import { mensagemDoPeriodoFechado, noPeriodoFechado, type FechamentoDaConta } from "@/lib/conciliacao/fechamento";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** O maior arquivo que se lê aqui: um mês de um extrato movimentado cabe
 *  com folga. */
const MAX_BYTES = 5 * 1024 * 1024;

/** Quantos títulos uma chamada baixa: a remessa da folha vai em partes, para
 *  nenhuma chamada passar do tempo da função. */
const BAIXAS_POR_CHAMADA = 20;

type Resultado = { ok: true; mensagem?: string } | { ok: false; message: string };

interface Aviso {
  tom: "ok" | "erro";
  texto: string;
  /** "Lembrar como regra" depois do avulso. */
  acao?: { rotulo: string; onClick: () => void };
}

/** A baixa real aberta por uma linha do banco. */
interface Baixando {
  r: ResultadoDaLinha;
  l: Linha;
  t: TituloDoMotor;
  /** `avulso`: o título nasceu na conciliação ("Lançar avulso"). */
  como: "baixa" | "avulso";
  /** A retenção que a lupa achou para este título (o motor dá a dele). */
  retencao: Partial<Record<ImpostoRetido, number>> | null;
}

// ---------------------------------------------------------------------------
// O componente
// ---------------------------------------------------------------------------

/** Tira de "Sem correspondência" a linha que é um mútuo (decisão 230): o passo
 *  depois de tudo o que o motor já faz. */
function comMutuos(secoes: SecoesDoBanco, banco: DadosDaAbaBanco): SecoesDoBanco {
  const mutuo: ResultadoDaLinha[] = [];
  const empresaDeFora: ResultadoDaLinha[] = [];
  const sem: ResultadoDaLinha[] = [];
  for (const r of secoes.sem) {
    const m = mutuoDaLinha(banco.mutuo, banco.mutuo.partes, { data: r.mov.data, valor: r.mov.valor, historico: r.mov.linha.historico }, banco.lancamentos);
    if (m && pixDeEmpresaDeFora(m)) empresaDeFora.push({ ...r, mutuo: m });
    else if (m) mutuo.push({ ...r, mutuo: m });
    else sem.push(r);
  }
  return { ...secoes, mutuo, empresaDeFora, sem };
}

export function AbaBanco({
  banco,
  dados,
  contaId,
  fechamento,
  contasDeDestino,
}: {
  banco: DadosDaAbaBanco;
  /** As contas do mesmo CNPJ, para a regra de transferência (decisão 211, A5). */
  contasDeDestino: Array<{ id: string; nome: string }>;
  /** A leitura da aba Títulos: os títulos em aberto que o motor procura. */
  dados: DadosDaAbaTitulos;
  contaId: string;
  /** O fechamento da conciliação da conta, com as condições (decisão 205). */
  fechamento: FechamentoDaConta;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [importando, setImportando] = React.useState(false);
  const [recusado, setRecusado] = React.useState<{ arquivo: string; r: Exclude<ResultadoDaImportacao, { ok: true }> } | null>(null);
  const [erroImportacao, setErroImportacao] = React.useState<string | null>(null);
  const [aviso, setAviso] = React.useState<Aviso | null>(null);
  // Os diálogos.
  const [baixando, setBaixando] = React.useState<Baixando | null>(null);
  const [erroDoDialogo, setErroDoDialogo] = React.useState<string | null>(null);
  const [corrigindo, setCorrigindo] = React.useState<ResultadoDaLinha | null>(null);
  const [procurando, setProcurando] = React.useState<{ r: ResultadoDaLinha; marcados: string[] } | null>(null);
  const [cancelando, setCancelando] = React.useState<LancamentoSemLinha | null>(null);
  const [agrupando, setAgrupando] = React.useState<SelecaoDoAgrupamento | null>(null);
  const [regraDe, setRegraDe] = React.useState<{ historico: string; l: Linha | null } | null>(null);
  // O "Lançar avulso": os cadastros dos formulários, lidos na primeira vez.
  const [dadosNovo, setDadosNovo] = React.useState<DadosDoNovoLancamento | null>(null);
  const [mutuoDaLinhaAberto, setMutuoDaLinha] = React.useState<ResultadoDaLinha | null>(null);
  const [iofDaLinha, setIofDaLinha] = React.useState<ResultadoDaLinha | null>(null);
  const [avulso, setAvulso] = React.useState<{ r: ResultadoDaLinha; lado: "pagar" | "receber"; notas?: boolean } | null>(null);
  const [baixarAposCriar, setBaixarAposCriar] = React.useState<{ r: ResultadoDaLinha; lado: "pagar" | "receber"; id: string } | null>(null);

  React.useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), aviso.acao ? 15000 : 7000);
    return () => clearTimeout(t);
  }, [aviso]);

  // As linhas da planilha de títulos, montadas como a aba Títulos as monta.
  const linhasDaPlanilha = React.useMemo(() => {
    const ctx = prepararContexto({
      hoje: dados.hoje,
      empresas: dados.empresas,
      tipos: dados.tipos,
      subtipos: dados.subtipos,
      cartoes: dados.cartoes,
      contas: dados.contas,
      centroDoImposto: CENTRO,
      extras: dados.extras,
    });
    return montarLinhas(dados.aPagar, dados.aReceber, dados.impostos, ctx);
  }, [dados]);
  const linhaPorChave = React.useMemo(() => new Map(linhasDaPlanilha.map((l) => [l.chave, l])), [linhasDaPlanilha]);

  // Se o motor falhar com um dado que ele não espera, a aba mostra as linhas
  // do banco sem cruzar, com o aviso — e não uma tela em branco.
  const { conciliacao, falhaDoMotor } = React.useMemo(() => {
    try {
      return { conciliacao: conciliarConta(banco, linhasDaPlanilha, contaId, dados.documentoDaParte, dados.hoje), falhaDoMotor: false };
    } catch (e) {
      console.error("[conciliacao.motor]", e);
      return { conciliacao: conciliarConta(banco, [], contaId, {}, dados.hoje), falhaDoMotor: true };
    }
  }, [banco, linhasDaPlanilha, contaId, dados.documentoDaParte, dados.hoje]);
  const secoes = React.useMemo(() => comMutuos(secoesDoBanco(conciliacao.resultados), banco), [conciliacao, banco]);
  const regraPorId = React.useMemo(() => new Map(banco.regras.map((g) => [g.id, g])), [banco.regras]);
  const titulosDoMotor = React.useMemo(() => [...conciliacao.titulos.values()], [conciliacao]);

  // O título criado pelo "Lançar avulso" chega do servidor: abre a baixa
  // dele com a linha do banco.
  React.useEffect(() => {
    if (!baixarAposCriar) return;
    const l = linhasDaPlanilha.find((x) =>
      baixarAposCriar.lado === "pagar"
        ? x.lado === "pagar" && x.t.id === baixarAposCriar.id
        : x.lado === "receber" && x.t.conta_avulsa_id === baixarAposCriar.id,
    );
    const t = l ? conciliacao.titulos.get(l.chave) : undefined;
    if (!l || !t) return;
    setBaixarAposCriar(null);
    setErroDoDialogo(null);
    setBaixando({ r: baixarAposCriar.r, l, t, como: "avulso", retencao: null });
  }, [linhasDaPlanilha, conciliacao, baixarAposCriar]);

  // ---- Executar uma ação e avisar ----

  function avisar(r: Resultado, depois?: () => void) {
    if (!r.ok) {
      setAviso({ tom: "erro", texto: r.message });
      return;
    }
    if (r.mensagem) setAviso({ tom: "ok", texto: r.mensagem });
    depois?.();
  }

  /** Na trava do fechamento, o que tem data até lá não muda (protótipo:
   *  `bloqueado`). O banco recusa de qualquer jeito; aqui avisa antes. */
  function bloqueado(...datas: Array<string | null | undefined>): boolean {
    const ate = fechamento.ativo?.ate ?? null;
    if (ate && datas.some((d) => noPeriodoFechado(d, ate))) {
      setAviso({ tom: "erro", texto: mensagemDoPeriodoFechado(ate) });
      return true;
    }
    return false;
  }

  /** O formulário de avulso com a linha; `notas` já abre nas notas de sócio. */
  function abrirAvulso(r: ResultadoDaLinha, notas = false) {
    const lado = r.mov.valor < 0 ? "pagar" : "receber";
    if (dadosNovo) {
      setAvulso({ r, lado, notas });
      return;
    }
    setAviso(null);
    startTransition(async () => {
      try {
        const res = await carregarDadosDoNovoLancamento();
        if (!res.ok) {
          setAviso({ tom: "erro", texto: res.message });
          return;
        }
        setDadosNovo(res.dados);
        setAvulso({ r, lado, notas });
      } catch {
        setAviso({ tom: "erro", texto: "Não foi possível abrir o formulário. Tente de novo." });
      }
    });
  }

  function executar(acao: () => Promise<Resultado>, depois?: () => void) {
    setAviso(null);
    startTransition(async () => {
      try {
        avisar(await acao(), depois);
      } catch {
        setAviso({ tom: "erro", texto: "Não foi possível concluir agora. Tente de novo." });
      }
      router.refresh();
    });
  }

  /** Várias linhas, uma depois da outra; para na primeira que falhar. */
  function emSerie(rs: ResultadoDaLinha[], umaLinha: (r: ResultadoDaLinha) => Promise<Resultado> | null, rotulo: (n: number) => string) {
    setAviso(null);
    startTransition(async () => {
      let feitas = 0;
      let puladas = 0;
      for (const r of rs) {
        const p = umaLinha(r);
        if (!p) {
          puladas++;
          continue;
        }
        const res = await p;
        if (!res.ok) {
          setAviso({ tom: "erro", texto: feitas ? `${res.message} ${rotulo(feitas)} antes disso.` : res.message });
          router.refresh();
          return;
        }
        // O PIX que voltou concilia as duas linhas numa ação só: a conta é de
        // linhas do banco, a mesma do "Conciliar os N".
        feitas += r.estado === "par" && r.par ? 2 : 1;
      }
      setAviso({
        tom: feitas ? "ok" : "erro",
        texto: `${rotulo(feitas)}.${puladas ? ` ${puladas === 1 ? "1 linha ficou" : `${puladas} linhas ficaram`} para conferir uma a uma.` : ""}`,
      });
      router.refresh();
    });
  }

  // ---- O que cada título leva à baixa ----

  const linhaDe = (t: TituloDoMotor) => linhaPorChave.get(t.id);

  /** A baixa de um clique (pela baixa em lote): os itens dos títulos, ou
   *  `null` quando algum não vai pelo lote. */
  function itensDe(ts: TituloDoMotor[]) {
    if (ts.length === 0) return null;
    const itens = ts.map((t) => {
      const l = linhaDe(t);
      return l ? itemDoLote(l) : null;
    });
    return itens.every((i) => i !== null) ? (itens as NonNullable<(typeof itens)[number]>[]) : null;
  }

  function abrirBaixa(r: ResultadoDaLinha, t: TituloDoMotor, retencao: Baixando["retencao"] = null) {
    const l = linhaDe(t);
    if (!l) {
      setAviso({ tom: "erro", texto: "O título não está mais em aberto: recarregue a página." });
      return;
    }
    setErroDoDialogo(null);
    setBaixando({
      r,
      l,
      t,
      como: "baixa",
      retencao: retencao ?? ((r.retencaoAliquotas ?? null) as Baixando["retencao"]),
    });
  }

  function fecharBaixa() {
    setBaixando(null);
    setErroDoDialogo(null);
  }

  /** Depois da baixa real: liga a linha do banco a ela. */
  async function ligarDepoisDaBaixa(b: Baixando) {
    const doc = documentoDaLinha(b.l);
    fecharBaixa();
    if (!doc) {
      setAviso({ tom: "erro", texto: "Baixa feita, mas a linha do banco ficou sem conciliar: ela aparece como já baixada no sistema na próxima leitura." });
      router.refresh();
      return;
    }
    const lig = await conciliarPelosDocumentos(b.r.mov.id, [doc], null, b.como);
    if (!lig.ok) {
      setAviso({ tom: "erro", texto: lig.message });
    } else if (b.como === "avulso") {
      const historico = b.r.mov.historico;
      const l = b.l;
      setAviso({
        tom: "ok",
        texto: "Avulso criado, baixado e conciliado com a linha do banco.",
        acao: { rotulo: "Lembrar como regra", onClick: () => setRegraDe({ historico, l }) },
      });
    } else {
      setAviso({ tom: "ok", texto: "Baixa feita com os dados do banco e conciliada com a linha." });
    }
    router.refresh();
  }

  const linhaDoBancoNaBaixa = (b: Baixando): LinhaDoBancoNaBaixa => ({
    data: b.r.mov.data,
    valor: r2(Math.abs(b.r.mov.valor)),
    forma: formaDaBaixaPeloHistorico(b.r.mov.historico),
    arquivo: banco.ultima?.arquivo ?? "extrato do banco",
    parcial: b.retencao ? null : parcialPeloBanco(b.r, b.t),
    retencao: b.retencao,
  });

  /** "Baixar e conciliar": numa chamada só, ou, na remessa grande (a da
   *  folha), em partes de 20, com a ligação da linha no fim. */
  async function baixarNaLinha(entrada: Parameters<typeof baixarEConciliar>[0]): Promise<Resultado> {
    if (entrada.itens.length <= BAIXAS_POR_CHAMADA) return baixarEConciliar(entrada);
    let feitas = 0;
    for (let i = 0; i < entrada.itens.length; i += BAIXAS_POR_CHAMADA) {
      const parte = entrada.itens.slice(i, i + BAIXAS_POR_CHAMADA);
      const res = await baixarPelaLinha({ linhaId: entrada.linhaId, itens: parte });
      if (!res.ok) {
        return {
          ok: false,
          message: feitas
            ? `${res.message} Antes disso, ${feitas} títulos da remessa foram baixados; a linha do banco ficou sem conciliar.`
            : res.message,
        };
      }
      feitas += parte.length;
    }
    const liga = await ligarItensALinha(entrada);
    if (!liga.ok) return liga;
    return { ok: true, mensagem: `${feitas} baixas feitas com os dados do banco e conciliadas numa linha só.` };
  }

  /** Desfazer: a linha e as primeiras baixas numa chamada; o resto das
   *  baixas da remessa grande, em partes. */
  async function desfazerNaLinha(linhaId: string): Promise<Resultado> {
    const res = await desfazerConciliacao(linhaId);
    if (!res.ok || !res.restantes?.length) return res;
    const total = BAIXAS_POR_CHAMADA + res.restantes.length;
    for (let i = 0; i < res.restantes.length; i += BAIXAS_POR_CHAMADA) {
      const parte = await cancelarBaixasDesfeitas(res.restantes.slice(i, i + BAIXAS_POR_CHAMADA));
      if (!parte.ok) return parte;
    }
    return { ok: true, mensagem: `Desfeito: as ${total} baixas foram canceladas e os títulos voltaram a aberto.` };
  }

  // ---- As ações ----

  const acoes: AcoesDoBanco = {
    ocupado: pending,
    ligar: (r) => {
      const l = r.lancamento ? conciliacao.lancamentos.get(r.lancamento.id) : undefined;
      if (!l) return;
      executar(async () => {
        const res = await conciliarLinha(r.mov.id, l.ids);
        return res.ok ? { ok: true, mensagem: "Conciliado: a baixa já lançada no sistema ficou ligada à linha do banco, com a data dele." } : res;
      });
    },
    baixarEConciliar: (r) => {
      if (!r.titulo) return;
      const itens = itensDe([r.titulo]);
      if (!itens) return abrirBaixa(r, r.titulo);
      executar(() => baixarNaLinha({ linhaId: r.mov.id, itens }));
    },
    conferir: (r) => {
      if (r.titulo) abrirBaixa(r, r.titulo);
    },
    conciliarCombinacao: (r) => {
      const itens = itensDe(r.titulos ?? []);
      if (!itens) return setProcurando({ r, marcados: (r.titulos ?? []).map((t) => t.id) });
      executar(() => baixarNaLinha({ linhaId: r.mov.id, itens }));
    },
    conferirCombinacao: (r) => setProcurando({ r, marcados: (r.titulos ?? []).map((t) => t.id) }),
    conciliarLote: (r) => {
      const itens = itensDe(r.lote?.titulos ?? []);
      if (!itens) {
        setAviso({
          tom: "erro",
          texto: "Algum título da remessa não tem centro de custo completo: baixe-os pela aba Títulos e concilie a linha depois.",
        });
        return;
      }
      executar(() => baixarNaLinha({ linhaId: r.mov.id, itens }));
    },
    conciliarGrupo: (linhas, escolhidos) => {
      // As linhas do grupo se desfazem juntas.
      const grupo = linhas.length > 1 ? crypto.randomUUID() : null;
      const tituloDa = new Map(linhas.map((r, i) => [r.mov.id, escolhidos[i]]));
      emSerie(
        linhas,
        (r) => {
          const t = tituloDa.get(r.mov.id);
          const itens = t ? itensDe([t]) : null;
          return itens ? baixarNaLinha({ linhaId: r.mov.id, itens, grupo }) : null;
        },
        (n) => (n === 1 ? "1 linha baixada e conciliada" : `${n} linhas baixadas e conciliadas`),
      );
    },
    conferirTitulo: (r, t) => abrirBaixa(r, t),
    conciliarPar: (r) => {
      if (!r.par) return;
      const l = r.titulo ? linhaDe(r.titulo) : undefined;
      const referencia = r.titulo ? `${r.titulo.ref} · ${r.titulo.contraparte}` : null;
      const fornecedorId = l?.lado === "pagar" ? l.t.parte_id : null;
      const [saida, volta] = r.mov.valor < 0 ? [r, r.par] : [r.par, r];
      executar(() => registrarSaiuEVoltou(saida.mov.id, volta.mov.id, referencia, fornecedorId));
    },
    lancarRegra: (rs) => {
      const itens = rs.flatMap((r) => (r.regra?.id ? [{ linhaId: r.mov.id, regraId: r.regra.id as string }] : []));
      if (itens.length) executar(() => lancarPelaRegra(itens));
    },
    criarRegra: (r) => setRegraDe({ historico: r.mov.historico, l: null }),
    conciliarHistorico: (rs) =>
      emSerie(
        rs,
        (r) => (r.historicos?.length ? conciliarPeloHistorico(r.mov.id, r.historicos.map((h) => h.id)) : null),
        (n) => (n === 1 ? "1 linha do banco conciliada pelo histórico" : `${n} linhas do banco conciliadas pelo histórico`),
      ),
    lancarAvulso: (r) => abrirAvulso(r),
    lancarNotas: (r) => abrirAvulso(r, true),
    lancarMutuo: (r) => setMutuoDaLinha(r),
    lancarIof: (r) => setIofDaLinha(r),
    procurar: (r) => setProcurando({ r, marcados: [] }),
    ignorar: (r) => executar(() => ignorarLinha(r.mov.id, null)),
    desfazer: (r) => {
      if (bloqueado(r.mov.data)) return;
      executar(() => desfazerNaLinha(r.mov.id));
    },
    corrigirBaixa: (r) => {
      if (bloqueado(r.mov.data, r.lancamento?.data)) return;
      setErroDoDialogo(null);
      setCorrigindo(r);
    },
    cancelarBaixa: (l) => {
      if (bloqueado(l.data)) return;
      setErroDoDialogo(null);
      setCancelando(l);
    },
    agrupar: (sel) => {
      if (bloqueado(sel.ref.data)) return;
      setErroDoDialogo(null);
      setAgrupando(sel);
    },
    conciliarAgrupamento: (linhaIds, lancamentoIds, datas) => {
      if (bloqueado(...datas)) return;
      executar(() => conciliarEmConjunto(linhaIds, lancamentoIds));
    },
  };

  // Uma linha de cada vez, cada uma pela ação dela: é o "Conciliar os N" de
  // Prontos para conciliar (decisão 243), que junta título exato, soma do
  // fornecedor, baixa já lançada, remessa, tarifa pela regra, planilha e o
  // PIX que voltou (pela linha da devolução, que concilia as duas).
  const conciliarVarios = (rs: ResultadoDaLinha[]) =>
    emSerie(
      rs,
      (r) => {
        if (r.estado === "ja_lancado" && r.lancamento) {
          const l = conciliacao.lancamentos.get(r.lancamento.id);
          return l ? conciliarLinha(r.mov.id, l.ids) : null;
        }
        if (r.estado === "regra") return r.regra?.id ? lancarPelaRegra([{ linhaId: r.mov.id, regraId: r.regra.id as string }]) : null;
        if (r.estado === "historico") return r.historicos?.length ? conciliarPeloHistorico(r.mov.id, r.historicos.map((h) => h.id)) : null;
        if (r.estado === "par") {
          if (!r.par) return null;
          const l = r.titulo ? linhaDe(r.titulo) : undefined;
          const referencia = r.titulo ? `${r.titulo.ref} · ${r.titulo.contraparte}` : null;
          const fornecedorId = l?.lado === "pagar" ? l.t.parte_id : null;
          const [saida, volta] = r.mov.valor < 0 ? [r, r.par] : [r.par, r];
          return registrarSaiuEVoltou(saida.mov.id, volta.mov.id, referencia, fornecedorId);
        }
        const ts = r.estado === "soma" ? r.lote?.titulos ?? [] : r.estado === "combinacao" ? r.titulos ?? [] : r.titulo ? [r.titulo] : [];
        const itens = itensDe(ts);
        return itens ? baixarNaLinha({ linhaId: r.mov.id, itens }) : null;
      },
      (n) => (n === 1 ? "1 linha do banco conciliada" : `${n} linhas do banco conciliadas`),
    );

  // ---- Nada se concilia sozinho (decisão 244, revê a 201) ----
  // O que é certo fica em Prontos para conciliar, e quem concilia é alguém:
  // a linha, ou o "Conciliar os N" da divisão (`conciliarVarios`, em série).

  // ---- Importar ----

  async function importar(arquivo: File) {
    setErroImportacao(null);
    setRecusado(null);
    if (arquivo.size > MAX_BYTES) {
      setErroImportacao("O arquivo tem mais de 5 MB: exporte um período menor do internet banking.");
      return;
    }
    let ofx: ReturnType<typeof lerOfx>;
    try {
      ofx = lerOfx(decodificarOfx(await arquivo.arrayBuffer()));
    } catch {
      setErroImportacao("Não foi possível ler o arquivo: ele não parece um OFX.");
      return;
    }
    if (!ofx.movimentos.length) {
      setErroImportacao(ofx.bancoId || ofx.conta ? "O arquivo não tem movimentos." : "Não foi possível ler o arquivo: ele não parece um OFX.");
      return;
    }
    setImportando(true);
    try {
      const r = await importarExtrato(contaId, {
        nome: arquivo.name,
        bancoId: ofx.bancoId,
        conta: ofx.conta,
        inicio: ofx.inicio,
        fim: ofx.fim,
        geradoInstante: ofx.geradoInstante,
        saldoBanco: ofx.saldoBanco,
        saldoEm: ofx.saldoEm,
        movimentos: ofx.movimentos,
      });
      if (r.ok) {
        setAviso({
          tom: "ok",
          texto:
            r.novos === 0
              ? `${arquivo.name}: nenhum movimento novo (os ${r.movimentos} já tinham sido importados).`
              : `${arquivo.name}: ${r.movimentos} ${r.movimentos === 1 ? "movimento" : "movimentos"} · ${r.novos} ${r.novos === 1 ? "novo" : "novos"}.`,
        });
        router.refresh();
      } else if (r.motivo === "erro") {
        setErroImportacao(r.message);
      } else {
        setRecusado({ arquivo: arquivo.name, r });
      }
    } catch {
      setErroImportacao("Não foi possível importar agora. Tente de novo.");
    } finally {
      setImportando(false);
    }
  }

  const ultima = banco.ultima;
  const zona = (compacta: boolean) => (
    <ZonaDeArquivo compacta={compacta} contaNome={banco.conta.nome} onArquivo={importar} importando={importando} />
  );

  const avisos = (
    <>
      {!banco.conta.temNumero && (
        <Nota tom="ambar" icone={AlertTriangle}>
          Para importar, a <strong>{banco.conta.nome}</strong> precisa de agência e número no cadastro: é por eles que o
          sistema reconhece o arquivo.{" "}
          <Link href="/financeiro/cadastros/contas-bancarias" prefetch={false} className="font-semibold underline">
            Cadastros do Financeiro › Contas bancárias
          </Link>
        </Nota>
      )}
      {erroImportacao && (
        <Nota tom="vermelho" icone={AlertTriangle}>
          {erroImportacao}
        </Nota>
      )}
      {falhaDoMotor && (
        <Nota tom="vermelho" icone={AlertTriangle}>
          Não foi possível cruzar o extrato com os títulos agora: as linhas aparecem sem o que o sistema tem para cada uma.
          Recarregue a página; se continuar, avise o suporte.
        </Nota>
      )}
      {recusado && <ArquivoRecusado arquivo={recusado.arquivo} r={recusado.r} onDescartar={() => setRecusado(null)} />}
    </>
  );

  const avisoNaTela = aviso && (
    <div
      role="status"
      className={cn(
        "fixed bottom-6 right-6 z-50 flex max-w-[600px] items-center gap-3 rounded-xl border px-4 py-3 shadow-elevated",
        aviso.tom === "ok" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50",
      )}
    >
      {aviso.tom === "ok" ? (
        <CheckCheck className="h-4 w-4 shrink-0 text-emerald-700" />
      ) : (
        <AlertTriangle className="h-4 w-4 shrink-0 text-california-red" />
      )}
      <span className={cn("text-sm font-semibold", aviso.tom === "ok" ? "text-emerald-900" : "text-red-900")}>{aviso.texto}</span>
      {aviso.acao && (
        <button
          type="button"
          onClick={() => {
            aviso.acao?.onClick();
            setAviso(null);
          }}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-700 hover:bg-violet-50"
        >
          <Wand2 className="h-3.5 w-3.5" />
          {aviso.acao.rotulo}
        </button>
      )}
      <button
        type="button"
        onClick={() => setAviso(null)}
        aria-label="Fechar aviso"
        className={aviso.tom === "ok" ? "text-emerald-700 hover:text-emerald-900" : "text-california-red hover:text-red-900"}
      >
        ×
      </button>
    </div>
  );

  if (!ultima) {
    return (
      <div className="space-y-4">
        {avisos}
        {zona(false)}
        {avisoNaTela}
      </div>
    );
  }

  const contexto: ContextoDasCelulas = { linhaPorChave, regraPorId, lancamentos: conciliacao.lancamentos };

  return (
    <div className="space-y-4">
      <FilaDividida
        banco={banco}
        conciliacao={conciliacao}
        secoes={secoes}
        contexto={contexto}
        acoes={acoes}
        conciliarVarios={conciliarVarios}
        importar={<BotaoImportarExtrato onArquivo={importar} importando={importando} />}
        fechamento={
          <BotoesDoFechamento
            contaId={contaId}
            contaNome={banco.conta.nome}
            bancoNome={banco.conta.banco}
            fechamento={fechamento}
            ocupado={pending}
          />
        }
        fechadaAte={fechamento.ativo?.ate ?? null}
        pending={pending}
        avisos={{ erroImportacao, falhaDoMotor, recusado, descartarRecusado: () => setRecusado(null) }}
      />

      <Dialogos
        dados={dados}
        contaId={contaId}
        pending={pending}
        startTransition={startTransition}
        baixando={baixando}
        linhaDoBanco={baixando ? linhaDoBancoNaBaixa(baixando) : null}
        erroDoDialogo={erroDoDialogo}
        setErroDoDialogo={setErroDoDialogo}
        fecharBaixa={fecharBaixa}
        ligarDepoisDaBaixa={ligarDepoisDaBaixa}
      />

      {corrigindo?.lancamento && conciliacao.lancamentos.get(corrigindo.lancamento.id) && (
        <CorrigirBaixaDialog
          r={corrigindo}
          lancamento={conciliacao.lancamentos.get(corrigindo.lancamento.id) as LancamentoSemLinha}
          pending={pending}
          erro={erroDoDialogo}
          onFechar={() => setCorrigindo(null)}
          onConfirmar={(motivo) => {
            const r = corrigindo;
            const lanc = r.lancamento;
            if (!lanc) return;
            startTransition(async () => {
              const res = await corrigirBaixa(lanc.id, r.mov.id, motivo);
              if (!res.ok) {
                setErroDoDialogo(res.message);
                return;
              }
              setCorrigindo(null);
              avisar(res);
              router.refresh();
            });
          }}
        />
      )}

      {procurando && (
        <ProcurarTituloDialog
          r={procurando.r}
          titulos={titulosDoMotor}
          linhaPorChave={linhaPorChave}
          marcadosIniciais={procurando.marcados}
          onFechar={() => setProcurando(null)}
          onEscolher={(escolhidos) => {
            const r = procurando.r;
            setProcurando(null);
            if (escolhidos.length === 1) {
              const t = escolhidos[0];
              const ret = retencaoQueExplica(t, r2(Math.abs(r.mov.valor)));
              const aliquotas = ret ? RETENCOES_COMUNS.find((c) => c.nome === ret.nome)?.aliquotas ?? null : null;
              abrirBaixa(r, t, aliquotas as Baixando["retencao"]);
              return;
            }
            const itens = itensDe(escolhidos);
            if (!itens) {
              setAviso({
                tom: "erro",
                texto: "Algum dos títulos não vai pela baixa de vários de uma vez: baixe um por um e concilie a linha depois.",
              });
              return;
            }
            executar(() => baixarNaLinha({ linhaId: r.mov.id, itens }));
          }}
        />
      )}

      {cancelando && (
        <CancelarBaixaDialog
          lancamento={cancelando}
          pending={pending}
          erro={erroDoDialogo}
          onFechar={() => setCancelando(null)}
          onConfirmar={(motivo) => {
            const c = cancelando.cancelamento;
            if (!c) return;
            startTransition(async () => {
              const res =
                c.tipo === "imposto"
                  ? await cancelarBaixaImposto({ imposto_id: c.id, motivo })
                  : await cancelarBaixa({ tipo: c.tipo as TipoDeBaixa, id: c.id, motivo });
              if (!res.ok) {
                setErroDoDialogo(res.message);
                return;
              }
              setCancelando(null);
              setAviso({ tom: "ok", texto: "Baixa cancelada: o título voltou a aberto." });
              router.refresh();
            });
          }}
        />
      )}

      {agrupando && (
        <AgruparLancamentosDialog
          selecao={agrupando}
          linhas={banco.linhas.filter((l) => !l.conciliada && !l.ignorada)}
          baixas={conciliacao.naoApareceu}
          pending={pending}
          erro={erroDoDialogo}
          onFechar={() => setAgrupando(null)}
          onConfirmar={(linhaIds, lancamentoIds) =>
            startTransition(async () => {
              const res = await conciliarEmConjunto(linhaIds, lancamentoIds);
              if (!res.ok) {
                setErroDoDialogo(res.message);
                return;
              }
              setAgrupando(null);
              avisar(res);
              router.refresh();
            })
          }
        />
      )}

      {regraDe && (
        <RegraDialog
          historico={regraDe.historico}
          tipos={dados.tipos}
          subtipos={dados.subtipos}
          empresas={dados.empresas}
          regionais={banco.regionais}
          contasDeDestino={contasDeDestino}
          inicial={centroDoAvulso(regraDe.l)}
          pending={pending}
          erro={erroDoDialogo}
          onFechar={() => setRegraDe(null)}
          onConfirmar={(regra) =>
            startTransition(async () => {
              const res =
                regra.modo === "transferencia"
                  ? await criarRegraDeTransferencia({ contaId, padrao: regra.padrao, contaDestinoId: regra.contaDestinoId })
                  : await criarRegraDoExtrato({
                      contaId,
                      padrao: regra.padrao,
                      tipoId: regra.tipoId,
                      subtipoId: regra.subtipoId,
                      empresaId: regra.empresaId,
                      regionalId: regra.regionalId,
                      todasAsContas: regra.todasAsContas,
                    });
              if (!res.ok) {
                setErroDoDialogo(res.message);
                return;
              }
              setRegraDe(null);
              avisar(res);
              router.refresh();
            })
          }
        />
      )}

      {mutuoDaLinhaAberto && (
        <DialogoDoMutuoNaLinha
          r={mutuoDaLinhaAberto}
          m={mutuoDaLinhaAberto.mutuo ?? null}
          conta={banco.conta}
          onFechar={() => setMutuoDaLinha(null)}
          onFeito={(texto) => {
            setMutuoDaLinha(null);
            setAviso({ tom: "ok", texto });
            router.refresh();
          }}
        />
      )}
      {iofDaLinha && (
        <DialogoDoIof
          r={iofDaLinha}
          conta={banco.conta}
          onFechar={() => setIofDaLinha(null)}
          onFeito={(texto) => {
            setIofDaLinha(null);
            setAviso({ tom: "ok", texto });
            router.refresh();
          }}
        />
      )}
      {dadosNovo && (
        <>
          <ContaAvulsaDrawer
            mode="criar"
            open={avulso?.lado === "pagar"}
            onOpenChange={(o) => !o && setAvulso(null)}
            tenantId={dadosNovo.tenantId}
            empresas={dadosNovo.empresas}
            tipos={dadosNovo.tipos}
            subtipos={dadosNovo.subtipos}
            fornecedores={dadosNovo.fornecedores}
            clientes={dadosNovo.clientes}
            regionais={dadosNovo.regionais}
            cartoes={dadosNovo.cartoes}
            inicial={avulso ? inicialDoAvulso(avulso.r) : undefined}
            onCriadaParaBaixa={(id) => {
              const a = avulso;
              setAvulso(null);
              if (a) setBaixarAposCriar({ r: a.r, lado: "pagar", id });
              router.refresh();
            }}
          />
          <RecebimentoAvulsoDialog
            open={avulso?.lado === "receber"}
            onOpenChange={(o) => !o && setAvulso(null)}
            empresas={dadosNovo.empresas}
            regionais={dadosNovo.regionais}
            clientes={dadosNovo.clientes}
            fornecedores={dadosNovo.fornecedores}
            tipos={dadosNovo.tipos}
            subtipos={dadosNovo.subtipos}
            contas={dadosNovo.contas}
            rendimentosLancados={dadosNovo.rendimentosLancados}
            inicial={
              avulso
                ? {
                    ...inicialDoAvulso(avulso.r),
                    // O PIX de empresa de fora já diz quem pagou: a chave da parte é
                    // o mesmo `f:<id>` do "Recebido de".
                    notasDeSocio: avulso.notas ? { empresaId: banco.conta.empresaId, recebidoDe: avulso.r.mutuo?.parte.chave ?? null } : undefined,
                  }
                : undefined
            }
            onCriado={(id, abrirBaixa, mensagem) => {
              const a = avulso;
              setAvulso(null);
              if (a && abrirBaixa) setBaixarAposCriar({ r: a.r, lado: "receber", id });
              else setAviso({ tom: "ok", texto: mensagem });
              router.refresh();
            }}
          />
        </>
      )}

      {avisoNaTela}
    </div>
  );
}

/** O avulso que a linha do banco pede: o histórico, o valor e a data dela. */
function inicialDoAvulso(r: ResultadoDaLinha) {
  const hist = r.mov.historico.replace(/\s{2,}.*$/, "").trim();
  return {
    descricao: hist.charAt(0) + hist.slice(1).toLowerCase(),
    valor: r2(Math.abs(r.mov.valor)),
    data: r.mov.data,
  };
}

/** O centro e a empresa do avulso criado, para a regra começar com eles. */
function centroDoAvulso(l: Linha | null) {
  if (!l || (l.lado !== "pagar" && l.lado !== "receber")) return { tipoId: null, subtipoId: null, empresaId: null };
  return { tipoId: l.t.plano_conta_tipo_id, subtipoId: l.t.plano_conta_subtipo_id, empresaId: l.t.empresa_id };
}

// ---------------------------------------------------------------------------
// As baixas reais, abertas pela linha do banco
// ---------------------------------------------------------------------------

/**
 * A baixa de cada lado — a mesma da aba Títulos (`BaixaTituloDialog`,
 * `BaixaRecebimentoDialog`, `BaixaImpostoDialog` e o "Registrar" da
 * transferência), com a conta da aba, a data e o valor do banco. Depois de
 * baixar, a linha se liga à baixa (`ligarDepoisDaBaixa`).
 */
function Dialogos({
  dados,
  contaId,
  pending,
  startTransition,
  baixando,
  linhaDoBanco,
  erroDoDialogo,
  setErroDoDialogo,
  fecharBaixa,
  ligarDepoisDaBaixa,
}: {
  dados: DadosDaAbaTitulos;
  contaId: string;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
  baixando: Baixando | null;
  linhaDoBanco: LinhaDoBancoNaBaixa | null;
  erroDoDialogo: string | null;
  setErroDoDialogo: (e: string | null) => void;
  fecharBaixa: () => void;
  ligarDepoisDaBaixa: (b: Baixando) => Promise<void>;
}) {
  const b = baixando;
  const pagar = b?.l.lado === "pagar" ? b.l.t : null;
  const receber = b?.l.lado === "receber" ? b.l.t : null;
  const imposto = b?.l.lado === "imposto" ? b.l.t : null;
  const transferencia = b?.l.lado === "transferencia" ? b.l.t : null;
  const contasDoImposto = React.useMemo(
    () => dados.contas.map((c) => ({ id: c.id, nome: c.nome, banco: c.banco, empresa_contabil_id: c.empresa_contabil_id })),
    [dados.contas],
  );

  return (
    <>
      <BaixaTituloDialog
        open={pagar !== null}
        onOpenChange={(o) => !o && fecharBaixa()}
        alvo={pagar ? alvoDaBaixaAPagar(pagar, dados.ultimasRetencoesPagar) : null}
        contas={dados.contas}
        tipos={dados.tipos}
        subtipos={dados.subtipos}
        cartoes={dados.cartoes}
        faturas={dados.faturasNaBaixa}
        cartaoPlanejadoId={pagar?.cartao_credito_id ?? pagar?.cartao_previsto_id ?? null}
        pending={pending}
        erro={erroDoDialogo}
        contaInicial={contaId}
        linhaDoBanco={pagar ? linhaDoBanco : null}
        onConfirm={(payload) => {
          if (!b || !pagar) return;
          startTransition(async () => {
            const res = await darBaixaTituloAPagar({ origem: pagar.origem, id: pagar.id, ...payload });
            if (!res.ok) {
              setErroDoDialogo(res.message);
              return;
            }
            await ligarDepoisDaBaixa(b);
          });
        }}
      />

      <BaixaRecebimentoDialog
        open={receber !== null}
        onOpenChange={(o) => !o && fecharBaixa()}
        alvo={receber ? alvoDaBaixaAReceber(receber, dados.ultimasRetencoesReceber, dados.hoje) : null}
        contas={dados.contas}
        tipos={dados.tipos}
        subtipos={dados.subtipos}
        pending={pending}
        erro={erroDoDialogo}
        contaInicial={contaId}
        linhaDoBanco={
          receber && linhaDoBanco
            ? {
                data: linhaDoBanco.data,
                valor: linhaDoBanco.valor,
                arquivo: linhaDoBanco.arquivo,
                parcial: linhaDoBanco.parcial ?? null,
                retencao: linhaDoBanco.retencao ?? null,
              }
            : null
        }
        onConfirm={(payload) => {
          if (!b || !receber) return;
          startTransition(async () => {
            const res =
              receber.origem === "nf"
                ? await darBaixaTituloAReceber({ titulo_id: receber.id, ...payload })
                : await darBaixaRecebimentoAvulso({ conta_avulsa_id: receber.conta_avulsa_id, ...payload });
            if (!res.ok) {
              setErroDoDialogo(res.message);
              return;
            }
            await ligarDepoisDaBaixa(b);
          });
        }}
      />

      {imposto && b && (
        <BaixaImpostoDialog
          imposto={imposto}
          contas={contasDoImposto}
          nomesDasPJs={dados.nomesDasPJs}
          tenantId={dados.tenantId}
          contaInicial={contaId}
          dataInicial={b.r.mov.data}
          multaInicial={Math.max(0, r2(Math.abs(b.r.mov.valor) - b.t.liquido))}
          onClose={fecharBaixa}
          onBaixado={() => startTransition(() => ligarDepoisDaBaixa(b))}
        />
      )}

      <TransferirDialog
        open={transferencia !== null}
        onOpenChange={(o) => !o && fecharBaixa()}
        alvo={
          transferencia && b
            ? {
                id: transferencia.id,
                codigo: transferencia.codigo_avulsa ?? "—",
                contas: transferencia.contraparte_nome,
                descricao: transferencia.fat_descricao === "Transferência entre contas" ? null : transferencia.fat_descricao,
                valor: transferencia.valor,
                dataPrevista: b.r.mov.data,
              }
            : null
        }
        pending={pending}
        erro={erroDoDialogo}
        onConfirmar={(data) => {
          if (!b || !transferencia) return;
          startTransition(async () => {
            const res = await darBaixaTransferencia({ transferencia_id: transferencia.id, data });
            if (!res.ok) {
              setErroDoDialogo(res.message);
              return;
            }
            await ligarDepoisDaBaixa(b);
          });
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

function Nota({
  children,
  tom = "neutro",
  icone: Icone,
}: {
  children: React.ReactNode;
  tom?: "neutro" | "ambar" | "verde" | "vermelho";
  icone?: React.ComponentType<{ className?: string }>;
}) {
  const t = {
    neutro: "border-dashed border-border bg-muted/30 text-muted-foreground",
    ambar: "border-amber-200 bg-amber-50 text-amber-900",
    verde: "border-emerald-200 bg-emerald-50 text-emerald-900",
    vermelho: "border-red-200 bg-red-50 text-red-900",
  }[tom];
  return (
    <div className={cn("flex gap-2 rounded-lg border px-3 py-2.5 text-xs leading-relaxed", t)}>
      {Icone && <Icone className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ZonaDeArquivo({
  compacta,
  contaNome,
  onArquivo,
  importando,
}: {
  compacta: boolean;
  contaNome: string;
  onArquivo: (f: File) => void;
  importando: boolean;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = React.useState(false);
  const ler = (f: File | undefined) => {
    if (f && !importando) onArquivo(f);
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setArrastando(true);
      }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => {
        e.preventDefault();
        setArrastando(false);
        ler(e.dataTransfer.files?.[0]);
      }}
      className={cn(
        "flex flex-wrap items-center gap-4 rounded-xl border-2 border-dashed px-5 transition-colors",
        compacta ? "py-3" : "py-8",
        arrastando ? "border-california-red bg-california-red/5" : "border-border bg-card",
      )}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-california-red/10 text-california-red">
        <FileUp className="h-5 w-5" />
      </span>
      <div className="min-w-[240px] flex-1">
        <p className="text-sm font-semibold">{compacta ? "Importar outro extrato" : "Arraste aqui o extrato do banco em OFX"}</p>
        <p className="text-xs text-muted-foreground">
          Exportado do internet banking, só da {contaNome}. Linhas repetidas não entram; o que é certo vai para Prontos para conciliar.
        </p>
      </div>
      <input
        ref={ref}
        type="file"
        accept=".ofx,.OFX,application/x-ofx"
        className="hidden"
        onChange={(e) => {
          ler(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={importando}
        onClick={() => ref.current?.click()}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50 disabled:cursor-wait disabled:opacity-60"
      >
        <Upload className="h-4 w-4" />
        {importando ? "Importando…" : "Escolher arquivo"}
      </button>
    </div>
  );
}

/** O arquivo que não é da conta aberta: o de outra conta cadastrada leva à
 *  conciliação dela; o de conta nenhuma é recusado. */
function ArquivoRecusado({
  arquivo,
  r,
  onDescartar,
}: {
  arquivo: string;
  r: Exclude<ResultadoDaImportacao, { ok: true }>;
  onDescartar: () => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950">
      <p className="flex items-start gap-2 font-semibold">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        {r.message}
      </p>
      <p className="text-xs leading-relaxed">
        {r.motivo === "outra_conta"
          ? `O extrato é conciliado na conta dele. Abra a conciliação da ${r.conta.nome} para importar ${arquivo}.`
          : "Nenhuma conta cadastrada tem esse número, ou falta agência e número no cadastro dela. Confira em Cadastros do Financeiro › Contas bancárias e importe de novo."}
      </p>
      <div className="flex flex-wrap gap-2">
        {r.motivo === "outra_conta" ? (
          <Link
            href={`/financeiro/conciliacao?conta=${r.conta.id}&aba=banco`}
            prefetch={false}
            className="inline-flex h-9 items-center rounded-lg border border-border bg-white px-3 text-sm font-semibold text-foreground hover:bg-muted/50"
          >
            Abrir a conciliação da {r.conta.nome}
          </Link>
        ) : (
          <Link
            href="/financeiro/cadastros/contas-bancarias"
            prefetch={false}
            className="inline-flex h-9 items-center rounded-lg border border-border bg-white px-3 text-sm font-semibold text-foreground hover:bg-muted/50"
          >
            Abrir as contas bancárias
          </Link>
        )}
        <button
          type="button"
          onClick={onDescartar}
          className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Descartar o arquivo
        </button>
      </div>
    </div>
  );
}

/** O "Importar extrato do banco (OFX)" do topo da aba, ao lado do arquivo
 *  da última importação (decisão 234: antes ficava no Extrato). */
function BotaoImportarExtrato({ onArquivo, importando }: { onArquivo: (f: File) => void; importando: boolean }) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        ref={ref}
        type="file"
        accept=".ofx,.OFX,application/x-ofx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onArquivo(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={importando}
        onClick={() => ref.current?.click()}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold hover:bg-muted/50 disabled:cursor-wait disabled:opacity-60"
      >
        <Upload className="h-4 w-4" />
        {importando ? "Importando…" : "Importar extrato do banco (OFX)"}
      </button>
    </div>
  );
}
