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
 * - As ações (decisão 200): "Baixar e conciliar" vai pela baixa em lote de
 *   sempre, com a data e a conta da linha e a forma pelo histórico;
 *   "Conferir" e a lupa abrem a baixa REAL de cada lado (a mesma da aba
 *   Títulos) já com os dados do banco, e a linha se liga à baixa depois
 *   dela; corrigir, lançar pela regra, "saiu e voltou", ignorar e desfazer
 *   são as RPCs da conciliação. "Lançar avulso" abre o formulário de
 *   criação de sempre, preenchido com a linha.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCheck, FileUp, Info, Link2, Upload, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { decodificarOfx, lerOfx, rotuloDoBanco } from "@/lib/conciliacao/ofx";
import { formaDaBaixaPeloHistorico, RETENCOES_COMUNS, retencaoQueExplica, type TituloDoMotor } from "@/lib/conciliacao/motor";
import { fimDoMes } from "@/lib/financeiro/planilha-de-titulos";
import type { ImpostoRetido } from "@/lib/types";
import { dataBR } from "@/components/financeiro/planilha-de-titulos/planilha";
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
  conciliarLinha,
  conciliarPelosDocumentos,
  corrigirBaixa,
  criarRegraDoExtrato,
  desfazerConciliacao,
  ignorarLinha,
  importarExtrato,
  lancarPelaRegra,
  registrarSaiuEVoltou,
  type ResultadoDaImportacao,
} from "./actions-conciliacao";
import {
  BotaoDaSecao,
  comCentro,
  SemLinhaNoBanco,
  Secao,
  TabelaDoBanco,
  type AcoesDoBanco,
  type ContextoDasCelulas,
  type Cor,
} from "./banco-tabela";
import { CancelarBaixaDialog, CorrigirBaixaDialog, ProcurarTituloDialog, RegraDialog } from "./banco-dialogos";

const moeda = formatBRL;
const r2 = (n: number) => Math.round(n * 100) / 100;
const final4 = (s: string | null | undefined) => (s ? `••••${s.replace(/\D/g, "").slice(-4)}` : "—");

/** O maior arquivo que se lê aqui: um mês de um extrato movimentado cabe
 *  com folga. */
const MAX_BYTES = 5 * 1024 * 1024;

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

export function AbaBanco({
  banco,
  dados,
  contaId,
}: {
  banco: DadosDaAbaBanco;
  /** A leitura da aba Títulos: os títulos em aberto que o motor procura. */
  dados: DadosDaAbaTitulos;
  contaId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [abertas, setAbertas] = React.useState<Partial<Record<keyof SecoesDoBanco, boolean>>>({ conciliados: false });
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
  const [regraDe, setRegraDe] = React.useState<{ historico: string; l: Linha | null } | null>(null);
  // O "Lançar avulso": os cadastros dos formulários, lidos na primeira vez.
  const [dadosNovo, setDadosNovo] = React.useState<DadosDoNovoLancamento | null>(null);
  const [avulso, setAvulso] = React.useState<{ r: ResultadoDaLinha; lado: "pagar" | "receber" } | null>(null);
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
  const secoes = React.useMemo(() => secoesDoBanco(conciliacao.resultados), [conciliacao]);
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
        feitas++;
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
      setAviso({ tom: "erro", texto: "Baixa feita, mas a linha do banco ficou sem conciliar: ela aparece como baixa feita à mão na próxima leitura." });
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

  // ---- As ações ----

  const acoes: AcoesDoBanco = {
    ocupado: pending,
    ligar: (r) => {
      const l = r.lancamento ? conciliacao.lancamentos.get(r.lancamento.id) : undefined;
      if (!l) return;
      executar(async () => {
        const res = await conciliarLinha(r.mov.id, l.ids);
        return res.ok ? { ok: true, mensagem: "Conciliado: a baixa feita à mão ficou ligada à linha do banco, com a data dele." } : res;
      });
    },
    baixarEConciliar: (r) => {
      if (!r.titulo) return;
      const itens = itensDe([r.titulo]);
      if (!itens) return abrirBaixa(r, r.titulo);
      executar(() => baixarEConciliar({ linhaId: r.mov.id, itens }));
    },
    conferir: (r) => {
      if (r.titulo) abrirBaixa(r, r.titulo);
    },
    conciliarCombinacao: (r) => {
      const itens = itensDe(r.titulos ?? []);
      if (!itens) return setProcurando({ r, marcados: (r.titulos ?? []).map((t) => t.id) });
      executar(() => baixarEConciliar({ linhaId: r.mov.id, itens }));
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
      executar(() => baixarEConciliar({ linhaId: r.mov.id, itens }));
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
          return itens ? baixarEConciliar({ linhaId: r.mov.id, itens, grupo }) : null;
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
    lancarAvulso: (r) => {
      const lado = r.mov.valor < 0 ? "pagar" : "receber";
      if (dadosNovo) {
        setAvulso({ r, lado });
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
          setAvulso({ r, lado });
        } catch {
          setAviso({ tom: "erro", texto: "Não foi possível abrir o formulário. Tente de novo." });
        }
      });
    },
    procurar: (r) => setProcurando({ r, marcados: [] }),
    ignorar: (r) => executar(() => ignorarLinha(r.mov.id, null)),
    desfazer: (r) => executar(() => desfazerConciliacao(r.mov.id)),
    corrigirBaixa: (r) => {
      setErroDoDialogo(null);
      setCorrigindo(r);
    },
    cancelarBaixa: (l) => {
      setErroDoDialogo(null);
      setCancelando(l);
    },
    linkDoLancamento: (l) =>
      `/financeiro/conciliacao?conta=${contaId}&de=${l.data.slice(0, 8)}01&ate=${fimDoMes(l.data)}&highlight=${l.ids[0] ?? l.id}`,
  };

  const conciliarVarios = (rs: ResultadoDaLinha[]) =>
    emSerie(
      rs,
      (r) => {
        if (r.estado === "ja_lancado" && r.lancamento) {
          const l = conciliacao.lancamentos.get(r.lancamento.id);
          return l ? conciliarLinha(r.mov.id, l.ids) : null;
        }
        const ts = r.estado === "combinacao" ? r.titulos ?? [] : r.titulo ? [r.titulo] : [];
        const itens = itensDe(ts);
        return itens ? baixarEConciliar({ linhaId: r.mov.id, itens }) : null;
      },
      (n) => (n === 1 ? "1 linha do banco conciliada" : `${n} linhas do banco conciliadas`),
    );

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

  const resultados = conciliacao.resultados;
  const resolvidos = resultados.filter((r) => r.resolvido);
  const saldoBanco = ultima.saldoBanco;
  const saldoSistema = banco.saldoSistemaNoFim;
  const dif = saldoBanco === null || saldoSistema === null ? null : r2(saldoBanco - saldoSistema);
  const pct = resultados.length ? Math.round((resolvidos.length / resultados.length) * 100) : 0;
  const diaEmAndamento = ultima.fim && ultima.geradoDia === ultima.fim ? { dia: ultima.fim, hora: ultima.geradoHora } : null;

  const contexto: ContextoDasCelulas = { linhaPorChave, regraPorId, lancamentos: conciliacao.lancamentos };
  const manuaisPendentes = secoes.manual.filter((r) => !r.resolvido);
  const sugestoesComCentro = secoes.conferir.filter((r) => r.estado === "sugestao" && comCentro(r.titulo));

  const SECOES: Array<[keyof SecoesDoBanco, string, string, Cor, React.ReactNode]> = [
    [
      "divergencia",
      "A baixa feita à mão não bate com o banco",
      "O sistema já tem a baixa, com outro valor. Corrija para o valor do banco; se a baixa era de outro pagamento, procure o título certo.",
      "red",
      null,
    ],
    [
      "manual",
      "Baixas feitas à mão que bateram com o banco",
      "A baixa já estava no sistema, e o banco mostra o mesmo valor até 3 dias depois. Conciliar só liga as duas linhas, com a data do banco: nenhuma baixa nova é criada.",
      "sky",
      manuaisPendentes.length > 1 && (
        <BotaoDaSecao verde disabled={pending} onClick={() => conciliarVarios(manuaisPendentes)}>
          <Link2 className="h-3.5 w-3.5" />
          Conciliar as {manuaisPendentes.length}
        </BotaoDaSecao>
      ),
    ],
    [
      "alta",
      "Prontos: baixar e conciliar",
      "Títulos ainda sem baixa, com valor exato, forma de pagamento e data batendo, ou a soma única de títulos do mesmo fornecedor ou cliente. Um clique dá a baixa com os dados do banco e já concilia.",
      "emerald",
      secoes.alta.length > 0 && (
        <BotaoDaSecao verde disabled={pending} onClick={() => conciliarVarios(secoes.alta)}>
          <CheckCheck className="h-3.5 w-3.5" />
          Baixar e conciliar os {secoes.alta.length}
        </BotaoDaSecao>
      ),
    ],
    [
      "conferir",
      "Conferir antes",
      "Mais títulos que linhas com o mesmo valor, diferença de juros, retenção, ou centro de custo a escolher. Linhas iguais em número igual ao de títulos não chegam aqui: cada linha paga um.",
      "amber",
      sugestoesComCentro.length > 1 && (
        <BotaoDaSecao disabled={pending} onClick={() => conciliarVarios(sugestoesComCentro)}>
          Aceitar as {sugestoesComCentro.length} sugestões como estão
        </BotaoDaSecao>
      ),
    ],
    [
      "soma",
      "Uma linha do banco, vários títulos",
      "A remessa sai do banco como um débito só. Quando mais de uma soma de títulos do mesmo fornecedor ou cliente bate com a linha, escolha qual.",
      "emerald",
      null,
    ],
    [
      "par",
      "Saiu e voltou",
      "O banco devolveu o pagamento no mesmo dia. Baixar o título estaria errado: as duas linhas entram no extrato e ele continua a pagar.",
      "violet",
      null,
    ],
    [
      "regra",
      "Pelas regras do histórico",
      "Tarifas e outros débitos do próprio banco, que nunca têm título. A regra diz o centro de custo.",
      "violet",
      secoes.regra.length > 0 && (
        <BotaoDaSecao disabled={pending} onClick={() => acoes.lancarRegra(secoes.regra)}>
          <Wand2 className="h-3.5 w-3.5" />
          Lançar as {secoes.regra.length}
        </BotaoDaSecao>
      ),
    ],
    [
      "sem",
      "Sem correspondência",
      "Nada no sistema tem esse valor. Lance como avulso (a linha já vem preenchida) ou procure um título.",
      "red",
      null,
    ],
    ["conciliados", "Conciliados", "Ligados a um lançamento do Extrato. Dá para desfazer até fechar a conciliação.", "neutral", null],
  ];

  return (
    <div className="space-y-4">
      {avisos}
      <CabecalhoDoArquivo banco={banco} />
      {diaEmAndamento && (
        <Nota tom="ambar" icone={Info}>
          <strong>{dataBR(diaEmAndamento.dia)} ainda está em andamento:</strong> o arquivo foi gerado às {diaEmAndamento.hora} desse
          dia. As linhas de hoje podem ser conciliadas, mas o dia só entra no fechamento com um extrato gerado depois dele. A
          baixa feita à mão hoje que ainda não está no banco não é divergência.
        </Nota>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <Cartao rotulo={`Saldo no banco · ${dataBR(ultima.saldoEm ?? ultima.fim ?? "")}`} valor={saldoBanco === null ? "—" : moeda(saldoBanco)} />
        <Cartao rotulo={`Saldo do sistema · fim de ${ultima.fim ? dataBR(ultima.fim) : "—"}`} valor={saldoSistema === null ? "—" : moeda(saldoSistema)} />
        <Cartao
          rotulo="Diferença"
          valor={dif === null ? "—" : dif === 0 ? "Bate ✓" : moeda(dif)}
          cor={dif === 0 ? "text-emerald-700" : "text-california-red"}
          ajuda={dif === null ? "O arquivo não informou o saldo." : dif === 0 ? "Banco e sistema contam a mesma história." : "Some quando cada linha do banco tiver o seu lançamento."}
        />
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Conciliados</p>
          <p className="mt-1 font-mono text-lg font-semibold">
            {resolvidos.length} de {resultados.length}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">As seções somem quando ficam vazias.</span>
        {pending && <span className="text-xs font-semibold text-muted-foreground">Trabalhando…</span>}
      </div>
      {SECOES.map(([k, titulo, ajuda, cor, botao]) => {
        const linhas = secoes[k] as ResultadoDaLinha[];
        const doGrupo = k === "conferir" ? secoes.grupos : [];
        const quantas = linhas.length + doGrupo.reduce((s, g) => s + g.linhas.length, 0);
        if (quantas === 0) return null;
        const aberta = abertas[k] !== false;
        return (
          <Secao
            key={k}
            titulo={titulo}
            ajuda={ajuda}
            cor={cor}
            quantas={quantas}
            aberta={aberta}
            onAlternar={() => setAbertas((p) => ({ ...p, [k]: !aberta }))}
            botao={botao}
          >
            <TabelaDoBanco linhas={linhas} grupos={doGrupo} contexto={contexto} acoes={acoes} />
          </Secao>
        );
      })}
      {conciliacao.naoApareceu.length > 0 && <SemLinhaNoBanco lancs={conciliacao.naoApareceu} acoes={acoes} />}
      {zona(true)}

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
            executar(() => baixarEConciliar({ linhaId: r.mov.id, itens }));
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

      {regraDe && (
        <RegraDialog
          historico={regraDe.historico}
          tipos={dados.tipos}
          subtipos={dados.subtipos}
          empresas={dados.empresas}
          inicial={centroDoAvulso(regraDe.l)}
          pending={pending}
          erro={erroDoDialogo}
          onFechar={() => setRegraDe(null)}
          onConfirmar={(regra) =>
            startTransition(async () => {
              const res = await criarRegraDoExtrato({ contaId, ...regra });
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
            inicial={avulso ? inicialDoAvulso(avulso.r) : undefined}
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

function Cartao({ rotulo, valor, cor, ajuda }: { rotulo: string; valor: string; cor?: string; ajuda?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{rotulo}</p>
      <p className={cn("mt-1 font-mono text-lg font-semibold", cor)}>{valor}</p>
      {ajuda && <p className="text-[11px] text-muted-foreground">{ajuda}</p>}
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
          O arquivo que o internet banking do Santander, Itaú ou qualquer banco exporta. O sistema guarda só as linhas do
          extrato, sem repetir as que já vieram; nada muda nos títulos até você conciliar.
          {!compacta && ` A conta vem do próprio arquivo: ele só é aceito se for da ${contaNome}, a conta aberta no topo.`}
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

/**
 * O cabeçalho do extrato: a conta, reconhecida pelo próprio arquivo, e o
 * arquivo da última importação.
 */
function CabecalhoDoArquivo({ banco }: { banco: DadosDaAbaBanco }) {
  const ultima = banco.ultima;
  if (!ultima) return null;
  const repetidos = ultima.movimentos - ultima.novos;
  const c = banco.conta;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-4 py-3 text-xs">
        <span className="text-[11px] uppercase text-muted-foreground">Conta do extrato</span>
        <strong className="text-sm">
          {c.nome} · {c.banco}
          {c.agencia || c.numero ? ` · ${c.agencia ?? "—"} / ${c.numero ?? "—"}` : ""}
        </strong>
        <span className="inline-flex items-center gap-1 text-emerald-700">
          <CheckCheck className="h-3.5 w-3.5" />
          reconhecida pelo arquivo (banco {ultima.bancoId || "—"}, conta {final4(ultima.conta)})
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-border bg-card px-4 py-3 text-xs">
        <span className="font-semibold">{ultima.arquivo}</span>
        <span>
          Banco <strong>{rotuloDoBanco(ultima.bancoId ?? "")}</strong>
        </span>
        <span>
          Conta <strong className="font-mono">{final4(ultima.conta)}</strong>
        </span>
        <span>
          Período{" "}
          <strong>
            {ultima.inicio && ultima.fim
              ? ultima.inicio === ultima.fim
                ? dataBR(ultima.fim)
                : `${dataBR(ultima.inicio)} a ${dataBR(ultima.fim)}`
              : "—"}
          </strong>
        </span>
        <span>
          <strong>{ultima.movimentos}</strong> movimentos · <strong className="text-emerald-700">{ultima.novos} novos</strong>
          {repetidos > 0 && <span className="text-amber-700"> · {repetidos} já importados</span>}
        </span>
        {ultima.saldoBanco !== null && (
          <span>
            Saldo informado pelo banco <strong className="font-mono">{moeda(ultima.saldoBanco)}</strong>
          </span>
        )}
      </div>
      {repetidos > 0 && ultima.novos === 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>Nada novo neste arquivo.</strong> Os {repetidos} movimentos já tinham sido importados. O Santander troca o
            código de cada movimento (FITID) a cada download, então o sistema reconhece o repetido pela data, pelo valor, pelo
            histórico e pela posição entre iguais.
          </span>
        </div>
      )}
    </div>
  );
}
