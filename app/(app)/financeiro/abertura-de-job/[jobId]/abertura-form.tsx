"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  CornerUpLeft,
  FileText,
  Info,
  Landmark,
  Lock,
  Plus,
  Split,
  Table2,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { formatCurrency, cn } from "@/lib/utils";
import type { JobNaFila } from "../dados";
import { formatDataBr, formatPeriodo } from "../formatos";
import {
  curvaFecha,
  dividirEmParcelas,
  ehJanelaDePagamento,
  emCentavos,
  foraDaCompetencia,
  proximaDataRecebimento,
  proximaDataSugerida,
  somaCurva,
  type CurvaLinha,
} from "../curva";
import { abrirJobNoFinanceiro } from "../actions";
import { ReprovarDialog } from "../reprovar-dialog";

interface CategoriaOption {
  id: string;
  nome: string;
}

/**
 * Na tela, o valor da parcela é texto: quem digita "1.234,5" precisa ver
 * "1.234,5" enquanto digita. A conversão para número só acontece ao
 * somar e ao enviar.
 */
interface LinhaPrevisaoForm {
  id: string;
  data: string;
  valorTexto: string;
}

interface Props {
  job: JobNaFila;
  categorias: CategoriaOption[];
  custoPrevisto: number;
  /** Base das parcelas de recebimento — o que a California prevê receber. */
  faturamentoPrevisto: number;
  /** Quem clicou em "Enviar job para abertura" na tela da versão. */
  enviadoPorNome: string | null;
  curvaInicial: CurvaLinha[];
  recebimentoInicial: CurvaLinha[];
  trimestreSugerido: number;
  anoSugerido: number;
  anos: number[];
  hojeIso: string;
  agoraLabel: string;
}

function parseMoeda(texto: string): number {
  const limpo = texto
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number.parseFloat(limpo);
  return Number.isNaN(n) ? 0 : n;
}

function formatMoedaTexto(n: number): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercentual(n: number): string {
  return `${n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function paraForm(linhas: CurvaLinha[]): LinhaPrevisaoForm[] {
  return linhas.map((l) => ({
    id: l.id,
    data: l.data,
    valorTexto: formatMoedaTexto(l.valor),
  }));
}

export function AberturaForm({
  job,
  categorias,
  custoPrevisto,
  faturamentoPrevisto,
  enviadoPorNome,
  curvaInicial,
  recebimentoInicial,
  trimestreSugerido,
  anoSugerido,
  anos,
  hojeIso,
  agoraLabel,
}: Props) {
  const router = useRouter();

  const [nome, setNome] = React.useState(job.nome);
  const [categoriaId, setCategoriaId] = React.useState("");
  const [trimestre, setTrimestre] = React.useState(trimestreSugerido);
  const [ano, setAno] = React.useState(anoSugerido);
  const [curva, setCurva] = React.useState<LinhaPrevisaoForm[]>(() =>
    paraForm(curvaInicial),
  );
  const [recebimento, setRecebimento] = React.useState<LinhaPrevisaoForm[]>(
    () => paraForm(recebimentoInicial),
  );
  const [confirmarAberto, setConfirmarAberto] = React.useState(false);
  const [reprovarAberto, setReprovarAberto] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // ---------- Previsão de custos (curva de desembolso) ----------
  const linhasCurva = curva.map((l) => ({
    data: l.data,
    valor: parseMoeda(l.valorTexto),
  }));
  const somaDaCurva = somaCurva(linhasCurva);
  const curvaBate = curvaFecha(linhasCurva, custoPrevisto);
  const difCurva = emCentavos(somaDaCurva - custoPrevisto);

  // Custo zero é legítimo: job 100% pago direto pelo cliente ao
  // fornecedor (tipos A/D) abre sem curva de desembolso.
  const semDesembolso = custoPrevisto <= 0;
  const curvaDatasOk = curva.every((l) => l.data.length === 10);
  const curvaValoresOk = linhasCurva.every((l) => l.valor > 0);
  const curvaOk =
    semDesembolso ||
    (curva.length > 0 && curvaDatasOk && curvaValoresOk && curvaBate);

  // ---------- Previsão de recebimento ----------
  const linhasReceb = recebimento.map((l) => ({
    data: l.data,
    valor: parseMoeda(l.valorTexto),
  }));
  const somaDoRecebimento = somaCurva(linhasReceb);
  const recebBate = curvaFecha(linhasReceb, faturamentoPrevisto);
  const difReceb = emCentavos(somaDoRecebimento - faturamentoPrevisto);

  // Espelho do custo zero: job sem faturamento previsto (tudo pago
  // direto pelo cliente ao fornecedor) abre sem previsão de entrada.
  const semRecebimento = faturamentoPrevisto <= 0;
  const recebDatasOk = recebimento.every((l) => l.data.length === 10);
  const recebValoresOk = linhasReceb.every((l) => l.valor > 0);
  const recebOk =
    semRecebimento ||
    (recebimento.length > 0 && recebDatasOk && recebValoresOk && recebBate);

  const nomeOk = nome.trim().length >= 2;
  const podeAbrir = nomeOk && categoriaId !== "" && curvaOk && recebOk;

  const categoriaNome =
    categorias.find((c) => c.id === categoriaId)?.nome ?? "— não informada";
  const competenciaLabel = `${trimestre}T/${ano}`;

  // Margem prevista: o que a California recebe menos o que ela
  // desembolsa. Não entra o que o cliente paga direto ao fornecedor —
  // esse dinheiro nunca passa pelo caixa da agência.
  const margem = emCentavos(faturamentoPrevisto - custoPrevisto);
  const margemPct =
    faturamentoPrevisto > 0 ? (margem / faturamentoPrevisto) * 100 : 0;

  const textoValidacao = !nomeOk
    ? "Informe o nome do job."
    : categoriaId === ""
      ? "Selecione a categoria do job."
      : !semRecebimento && !recebDatasOk
        ? "Preencha a data de todas as parcelas de recebimento."
        : !semRecebimento && !recebValoresOk
          ? "Cada parcela de recebimento precisa de um valor maior que zero."
          : !semRecebimento && !recebBate
            ? "As parcelas de recebimento precisam somar o faturamento previsto."
            : semDesembolso
              ? "Tudo pronto. Este job não tem desembolso previsto pela California — abre sem curva."
              : !curvaDatasOk
                ? "Preencha a data de todas as linhas da curva."
                : !curvaValoresOk
                  ? "Cada data da curva precisa de um valor maior que zero."
                  : !curvaBate
                    ? "A curva precisa somar o custo previsto."
                    : "Tudo pronto: nome, categoria, competência, recebimento e custos preenchidos.";

  function atualizarCurva(id: string, patch: Partial<LinhaPrevisaoForm>) {
    setCurva((atual) =>
      atual.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    );
  }

  function atualizarRecebimento(
    id: string,
    patch: Partial<LinhaPrevisaoForm>,
  ) {
    setRecebimento((atual) =>
      atual.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    );
  }

  function distribuirCurva() {
    const valores = dividirEmParcelas(custoPrevisto, curva.length);
    setCurva((atual) =>
      atual.map((l, i) => ({
        ...l,
        valorTexto: formatMoedaTexto(valores[i] ?? 0),
      })),
    );
  }

  function distribuirRecebimento() {
    const valores = dividirEmParcelas(faturamentoPrevisto, recebimento.length);
    setRecebimento((atual) =>
      atual.map((l, i) => ({
        ...l,
        valorTexto: formatMoedaTexto(valores[i] ?? 0),
      })),
    );
  }

  function adicionarData() {
    setCurva((atual) => [
      ...atual,
      {
        // Date.now() só aqui, como chave de React — nada disso vai ao banco.
        id: `curva-nova-${Date.now()}`,
        data: proximaDataSugerida(
          atual.map((l) => ({ id: l.id, data: l.data, valor: 0 })),
          job.data_inicio_prevista,
          hojeIso,
        ),
        valorTexto: "0,00",
      },
    ]);
  }

  function adicionarParcelaRecebimento() {
    setRecebimento((atual) => [
      ...atual,
      {
        id: `recebimento-novo-${Date.now()}`,
        data: proximaDataRecebimento(
          atual.map((l) => ({ id: l.id, data: l.data, valor: 0 })),
          job.data_prevista_faturamento,
          hojeIso,
        ),
        valorTexto: "0,00",
      },
    ]);
  }

  function removerDaCurva(id: string) {
    if (curva.length <= 1) return;
    setCurva((atual) => atual.filter((l) => l.id !== id));
  }

  function removerDoRecebimento(id: string) {
    if (recebimento.length <= 1) return;
    setRecebimento((atual) => atual.filter((l) => l.id !== id));
  }

  function confirmarAbertura() {
    setErro(null);
    startTransition(async () => {
      const res = await abrirJobNoFinanceiro(job.id, {
        nome_financeiro: nome.trim(),
        categoria_id: categoriaId,
        competencia_trimestre: trimestre,
        competencia_ano: ano,
        curva: semDesembolso
          ? []
          : linhasCurva.map((l) => ({
              data_prevista: l.data,
              valor: l.valor,
            })),
        recebimento: semRecebimento
          ? []
          : linhasReceb.map((l) => ({
              data_prevista: l.data,
              valor: l.valor,
            })),
      });

      if (!res.ok) {
        setErro(res.message);
        setConfirmarAberto(false);
        return;
      }

      setConfirmarAberto(false);
      router.push(`/jobs/${job.id}?from=financeiro`);
      router.refresh();
    });
  }

  const dadosProducao: { rotulo: string; valor: string; mono?: boolean }[] = [
    { rotulo: "Job", valor: job.nome },
    { rotulo: "Código", valor: job.codigo, mono: true },
    {
      rotulo: "Projeto",
      valor:
        [job.projeto_nome, job.projeto_codigo].filter(Boolean).join(" · ") ||
        "—",
    },
    { rotulo: "Cliente", valor: job.cliente_nome ?? "—" },
    { rotulo: "Produto", valor: job.produto ?? "—" },
    {
      rotulo: "Cidade · Regional",
      valor: [job.cidade, job.regional_nome].filter(Boolean).join(" · ") || "—",
    },
    { rotulo: "GP Responsável", valor: job.responsavel_nome ?? "—" },
    { rotulo: "Produtor Responsável", valor: job.produtor_nome ?? "—" },
    {
      rotulo: "Início · fim",
      valor: formatPeriodo(job.data_inicio_prevista, job.data_fim_prevista),
      mono: true,
    },
    {
      rotulo: "Faturamento em",
      valor: formatDataBr(job.data_prevista_faturamento),
      mono: true,
    },
  ];

  const resumoPlanilha =
    job.planilha_itens > 0
      ? `${job.planilha_grupos} ${job.planilha_grupos === 1 ? "agrupamento" : "agrupamentos"} · ${job.planilha_itens} ${job.planilha_itens === 1 ? "item" : "itens"} · orçado ${formatCurrency(job.planilha_orcado)}`
      : "Planilha interna sem itens.";

  return (
    <div className="flex flex-col gap-5 pb-6">
      {/* ---------- Cabeçalho ---------- */}
      <div>
        <Link
          href="/financeiro/abertura-de-job"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para a fila de abertura
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Landmark className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-[26px] font-bold tracking-tight">
            Abrir job no financeiro
          </h1>
          <span className="rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-[12.5px] font-bold">
            {job.codigo}
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Confira os dados da produção ao lado — e a planilha interna do job —
          e complete o registro financeiro: nome, categoria, competência e as
          previsões de recebimento e de custos.
        </p>
      </div>

      {erro && (
        <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ---------- Coluna principal ---------- */}
        <div className="flex min-w-0 flex-col gap-5">
          {/* Registro no financeiro */}
          <section className="rounded-2xl border border-border bg-card shadow-soft">
            <header className="flex items-center gap-2.5 rounded-t-2xl border-b border-border bg-muted/50 px-5 py-3.5">
              <FileText className="h-4 w-4 text-california-red" />
              <h2 className="text-[15px] font-semibold">
                Registro no financeiro
              </h2>
            </header>

            <div className="grid gap-4 p-5 md:grid-cols-2">
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <label
                  htmlFor="nome-financeiro"
                  className="text-[12.5px] font-semibold"
                >
                  Nome do job <span className="text-california-red">*</span>
                </label>
                <input
                  id="nome-financeiro"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  maxLength={200}
                  className="h-[42px] rounded-lg border border-border bg-white px-3.5 text-[13.5px] font-medium outline-none focus:border-california-red/40"
                />
                <span className="text-[11px] text-muted-foreground">
                  Editável. Este nome vale no financeiro — a produção continua
                  vendo o nome que ela cadastrou.
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="categoria-job"
                  className="text-[12.5px] font-semibold"
                >
                  Categoria do job{" "}
                  <span className="text-california-red">*</span>
                </label>
                <Select value={categoriaId} onValueChange={setCategoriaId}>
                  <SelectTrigger id="categoria-job" className="h-[42px]">
                    <SelectValue placeholder="Selecione a categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    {categorias.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {categorias.length === 0 && (
                  <span className="text-[11px] text-california-red">
                    Nenhuma categoria de job cadastrada. Cadastre em Cadastros ›
                    Categorias.
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[12.5px] font-semibold">
                  Competência <span className="text-california-red">*</span>
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex gap-0.5 rounded-lg bg-[#f1f0ec] p-[3px]">
                    {[1, 2, 3, 4].map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTrimestre(t)}
                        aria-pressed={trimestre === t}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                          trimestre === t
                            ? "bg-white text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {t}T
                      </button>
                    ))}
                  </div>
                  <div className="inline-flex gap-0.5 rounded-lg bg-[#f1f0ec] p-[3px]">
                    {anos.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setAno(a)}
                        aria-pressed={ano === a}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                          ano === a
                            ? "bg-white text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Sugerida pelo início do job (
                  {formatDataBr(job.data_inicio_prevista)}). É o que vai para o
                  registro contábil.
                </span>
              </div>

              <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/60 px-4 py-3 md:col-span-2">
                <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold">
                    Data de abertura · registrada automaticamente
                  </p>
                  <p className="text-[11.5px] text-muted-foreground">
                    Gravada no momento da confirmação, junto do usuário
                    responsável — não é editável.
                  </p>
                </div>
                <span className="ml-auto whitespace-nowrap font-mono text-[12.5px] font-semibold">
                  {agoraLabel}
                </span>
              </div>
            </div>
          </section>

          {/* Previsão de recebimento */}
          <section className="rounded-2xl border border-border bg-card shadow-soft">
            <header className="flex flex-wrap items-center gap-2.5 rounded-t-2xl border-b border-border bg-muted/50 px-5 py-3.5">
              <TrendingUp className="h-4 w-4 text-california-red" />
              <h2 className="text-[15px] font-semibold">
                Previsão de recebimento
              </h2>
              <span className="text-xs text-muted-foreground">
                Faturamento previsto do orçamento + parcelas
              </span>
            </header>

            <div className="flex flex-col gap-[18px] p-5">
              <div className="grid gap-3.5 sm:grid-cols-2">
                <div className="rounded-xl border border-border px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
                    Valor total do job
                  </p>
                  <p className="mt-1.5 whitespace-nowrap font-mono text-base font-bold">
                    {formatCurrency(job.valor_total)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Fechamento do orçamento aprovado
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-emerald-700">
                    Faturamento previsto
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <p className="whitespace-nowrap font-mono text-base font-bold">
                      {formatCurrency(faturamentoPrevisto)}
                    </p>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      <Lock className="h-2.5 w-2.5" />
                      Do orçamento
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Total a receber do cliente neste job
                  </p>
                </div>
              </div>

              {/* Faturamento previsto zero: nada a receber pela California
                  (o cliente paga tudo direto ao fornecedor). O aviso
                  substitui a tabela, como na curva de custos. */}
              {semRecebimento ? (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <div>
                    <p className="text-[13px] font-semibold text-amber-800">
                      Nenhum faturamento previsto pela California
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-amber-800/80">
                      Todo o valor deste job é pago diretamente pelo cliente ao
                      fornecedor — a California não emite nota. O job abre sem
                      previsão de recebimento.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-emerald-50/50 px-4 py-2.5">
                    <CalendarCheck className="h-3.5 w-3.5 text-emerald-700" />
                    <p className="text-[12.5px] font-semibold">
                      Parcelas de recebimento
                    </p>
                    <span className="text-[11.5px] text-muted-foreground">
                      Faturamento previsto para{" "}
                      {formatDataBr(job.data_prevista_faturamento)}
                    </span>
                    <button
                      type="button"
                      onClick={distribuirRecebimento}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground"
                    >
                      <Split className="h-3 w-3" />
                      Distribuir igualmente
                    </button>
                  </div>

                  <table className="w-full border-collapse text-[13.5px]">
                    <thead>
                      <tr className="border-b border-border text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                        <th className="w-14 px-4 py-2.5 font-semibold">#</th>
                        <th className="px-4 py-2.5 font-semibold">
                          Data prevista
                        </th>
                        <th className="px-4 py-2.5 text-right font-semibold">
                          Valor
                        </th>
                        <th className="w-28 px-4 py-2.5 text-right font-semibold">
                          % do total
                        </th>
                        <th className="w-14 px-4 py-2.5" aria-label="Remover" />
                      </tr>
                    </thead>
                    <tbody>
                      {recebimento.map((linha, i) => {
                        const valor = parseMoeda(linha.valorTexto);
                        const pct =
                          faturamentoPrevisto > 0
                            ? (valor / faturamentoPrevisto) * 100
                            : 0;

                        return (
                          <tr
                            key={linha.id}
                            className="border-b border-b-[#f4f2f2] last:border-0"
                          >
                            <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                              {String(i + 1).padStart(2, "0")}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="w-[190px]">
                                {/* Recebimento não segue as janelas de
                                    pagamento: quem manda na data de entrada
                                    é o cliente, não o calendário com que a
                                    California paga fornecedor. */}
                                <DatePicker
                                  name={`recebimento-data-${linha.id}`}
                                  defaultValue={linha.data}
                                  className="h-9 text-[13px]"
                                  onDateChange={(d) =>
                                    atualizarRecebimento(linha.id, {
                                      data: d
                                        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
                                        : "",
                                    })
                                  }
                                />
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="ml-auto flex h-9 w-[180px] items-center gap-1.5 rounded-lg border border-border px-3">
                                <span className="text-xs font-semibold text-muted-foreground">
                                  R$
                                </span>
                                <input
                                  aria-label={`Valor da parcela ${i + 1}`}
                                  value={linha.valorTexto}
                                  onChange={(e) =>
                                    atualizarRecebimento(linha.id, {
                                      valorTexto: e.target.value,
                                    })
                                  }
                                  onBlur={() =>
                                    atualizarRecebimento(linha.id, {
                                      valorTexto: formatMoedaTexto(
                                        parseMoeda(linha.valorTexto),
                                      ),
                                    })
                                  }
                                  inputMode="decimal"
                                  className="w-full min-w-0 border-0 bg-transparent text-right font-mono text-[13px] font-semibold outline-none"
                                />
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-[12.5px] text-muted-foreground">
                              {faturamentoPrevisto > 0
                                ? formatPercentual(pct)
                                : "—"}
                            </td>
                            <td className="px-4 py-2.5">
                              <button
                                type="button"
                                onClick={() => removerDoRecebimento(linha.id)}
                                disabled={recebimento.length <= 1}
                                aria-label={`Remover a parcela ${i + 1}`}
                                title={
                                  recebimento.length <= 1
                                    ? "A previsão precisa de pelo menos uma parcela"
                                    : "Remover parcela"
                                }
                                className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border bg-white text-california-red transition-colors hover:bg-california-red/5 disabled:cursor-not-allowed disabled:text-[#d7d7d7] disabled:hover:bg-white"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div className="flex flex-wrap items-center gap-3 border-t border-border bg-muted/40 px-4 py-3">
                    <button
                      type="button"
                      onClick={adicionarParcelaRecebimento}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[#d7d7d7] bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                    >
                      <Plus className="h-3 w-3" />
                      Adicionar parcela
                    </button>
                    <div className="ml-auto flex flex-wrap items-center gap-4">
                      <span className="text-[12.5px] text-muted-foreground">
                        Soma das parcelas{" "}
                        <strong className="font-mono text-foreground">
                          {formatCurrency(somaDoRecebimento)}
                        </strong>
                      </span>
                      <span className="text-[12.5px] text-muted-foreground">
                        Faturamento previsto{" "}
                        <strong className="font-mono text-foreground">
                          {formatCurrency(faturamentoPrevisto)}
                        </strong>
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-semibold",
                          recebBate
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700",
                        )}
                      >
                        {recebBate ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <AlertTriangle className="h-3 w-3" />
                        )}
                        {recebBate
                          ? "Parcelas fecham com o faturamento"
                          : difReceb > 0
                            ? `Sobra de ${formatCurrency(Math.abs(difReceb))}`
                            : `Falta ${formatCurrency(Math.abs(difReceb))}`}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 px-3.5 py-3">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  A previsão de recebimento alimenta o fluxo de caixa de
                  entrada. A primeira parcela vem da data de faturamento do
                  orçamento; divida em quantas precisar — a soma tem que fechar
                  com o faturamento previsto. Quando a nota for emitida, o
                  título a receber abate esta previsão.
                </p>
              </div>
            </div>
          </section>

          {/* Previsão de custos */}
          <section className="rounded-2xl border border-border bg-card shadow-soft">
            <header className="flex flex-wrap items-center gap-2.5 rounded-t-2xl border-b border-border bg-muted/50 px-5 py-3.5">
              <TrendingDown className="h-4 w-4 text-california-red" />
              <h2 className="text-[15px] font-semibold">Previsão de custos</h2>
              <span className="text-xs text-muted-foreground">
                Custo planejado da planilha + curva de desembolso
              </span>
            </header>

            <div className="flex flex-col gap-[18px] p-5">
              <div className="grid gap-3.5 sm:grid-cols-2">
                <div className="rounded-xl border border-border px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
                    Valor total do job
                  </p>
                  <p className="mt-1.5 whitespace-nowrap font-mono text-base font-bold">
                    {formatCurrency(job.valor_total)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Compromisso total do cliente, somando o que ele paga direto
                    ao fornecedor
                  </p>
                </div>
                <div className="rounded-xl border border-california-red/25 bg-california-red/5 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-[#b3323c]">
                    Custo previsto total
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <p className="whitespace-nowrap font-mono text-base font-bold">
                      {formatCurrency(custoPrevisto)}
                    </p>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      <Lock className="h-2.5 w-2.5" />
                      Do planejado
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {semDesembolso
                      ? "Nenhum item de calha PP — a California não desembolsa neste job."
                      : "Planejado dos itens que a California paga (tipos que geram PP)"}
                  </p>
                </div>
              </div>

              {/* Curva de desembolso. Sem item de calha PP não há o que
                  distribuir — o aviso substitui a tabela inteira. */}
              {semDesembolso ? (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <div>
                    <p className="text-[13px] font-semibold text-amber-800">
                      Nenhum desembolso previsto pela California
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-amber-800/80">
                      Os custos deste job são pagos diretamente pelo cliente ao
                      fornecedor (itens de calha BV). O planejado da planilha
                      segue como controle interno, mas não gera previsão de
                      custos — o job abre sem curva de desembolso.
                    </p>
                  </div>
                </div>
              ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-muted/60 px-4 py-2.5">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-[12.5px] font-semibold">
                    Curva de desembolso
                  </p>
                  <span className="text-[11.5px] text-muted-foreground">
                    Janelas de pagamento (dias 08 e 20) entre{" "}
                    {formatDataBr(job.data_inicio_prevista)} e{" "}
                    {formatDataBr(job.data_fim_prevista)}
                  </span>
                  <button
                    type="button"
                    onClick={distribuirCurva}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground"
                  >
                    <Split className="h-3 w-3" />
                    Distribuir igualmente
                  </button>
                </div>

                <table className="w-full border-collapse text-[13.5px]">
                  <thead>
                    <tr className="border-b border-border text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                      <th className="w-14 px-4 py-2.5 font-semibold">#</th>
                      <th className="px-4 py-2.5 font-semibold">
                        Data prevista
                      </th>
                      <th className="px-4 py-2.5 text-right font-semibold">
                        Valor
                      </th>
                      <th className="w-28 px-4 py-2.5 text-right font-semibold">
                        % do total
                      </th>
                      <th className="w-14 px-4 py-2.5" aria-label="Remover" />
                    </tr>
                  </thead>
                  <tbody>
                    {curva.map((linha, i) => {
                      const valor = parseMoeda(linha.valorTexto);
                      const pct =
                        custoPrevisto > 0 ? (valor / custoPrevisto) * 100 : 0;
                      const fora =
                        linha.data.length === 10 &&
                        foraDaCompetencia(linha.data, trimestre, ano);

                      return (
                        <tr
                          key={linha.id}
                          className="border-b border-b-[#f4f2f2] last:border-0"
                        >
                          <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                            {String(i + 1).padStart(2, "0")}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="w-[190px]">
                              <DatePicker
                                name={`curva-data-${linha.id}`}
                                defaultValue={linha.data}
                                className="h-9 text-[13px]"
                                // Pagamento só nas janelas: qualquer outro
                                // dia fica apagado no calendário.
                                dateDisabled={(d) =>
                                  !ehJanelaDePagamento(
                                    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
                                  )
                                }
                                onDateChange={(d) =>
                                  atualizarCurva(linha.id, {
                                    data: d
                                      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
                                      : "",
                                  })
                                }
                              />
                              {fora && (
                                <span className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-medium text-amber-700">
                                  <AlertTriangle className="h-2.5 w-2.5" />
                                  Fora da competência {competenciaLabel}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="ml-auto flex h-9 w-[180px] items-center gap-1.5 rounded-lg border border-border px-3">
                              <span className="text-xs font-semibold text-muted-foreground">
                                R$
                              </span>
                              <input
                                aria-label={`Valor da data ${i + 1}`}
                                value={linha.valorTexto}
                                onChange={(e) =>
                                  atualizarCurva(linha.id, {
                                    valorTexto: e.target.value,
                                  })
                                }
                                onBlur={() =>
                                  atualizarCurva(linha.id, {
                                    valorTexto: formatMoedaTexto(
                                      parseMoeda(linha.valorTexto),
                                    ),
                                  })
                                }
                                inputMode="decimal"
                                className="w-full min-w-0 border-0 bg-transparent text-right font-mono text-[13px] font-semibold outline-none"
                              />
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-[12.5px] text-muted-foreground">
                            {custoPrevisto > 0 ? formatPercentual(pct) : "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            <button
                              type="button"
                              onClick={() => removerDaCurva(linha.id)}
                              disabled={curva.length <= 1}
                              aria-label={`Remover a data ${i + 1}`}
                              title={
                                curva.length <= 1
                                  ? "A curva precisa de pelo menos uma data"
                                  : "Remover data"
                              }
                              className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border bg-white text-california-red transition-colors hover:bg-california-red/5 disabled:cursor-not-allowed disabled:text-[#d7d7d7] disabled:hover:bg-white"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="flex flex-wrap items-center gap-3 border-t border-border bg-muted/40 px-4 py-3">
                  <button
                    type="button"
                    onClick={adicionarData}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[#d7d7d7] bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
                  >
                    <Plus className="h-3 w-3" />
                    Adicionar data
                  </button>
                  <div className="ml-auto flex flex-wrap items-center gap-4">
                    <span className="text-[12.5px] text-muted-foreground">
                      Soma das datas{" "}
                      <strong className="font-mono text-foreground">
                        {formatCurrency(somaDaCurva)}
                      </strong>
                    </span>
                    <span className="text-[12.5px] text-muted-foreground">
                      Custo previsto{" "}
                      <strong className="font-mono text-foreground">
                        {formatCurrency(custoPrevisto)}
                      </strong>
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-semibold",
                        curvaBate
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-amber-200 bg-amber-50 text-amber-700",
                      )}
                    >
                      {curvaBate ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <AlertTriangle className="h-3 w-3" />
                      )}
                      {curvaBate
                        ? "Curva fecha com o total"
                        : difCurva > 0
                          ? `Sobra de ${formatCurrency(Math.abs(difCurva))}`
                          : `Falta ${formatCurrency(Math.abs(difCurva))}`}
                    </span>
                  </div>
                </div>
              </div>
              )}

              <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 px-3.5 py-3">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  A previsão não trava o realizado: ela alimenta o fluxo de
                  caixa do financeiro e vai sendo abatida conforme as PPs do
                  job forem emitidas. As datas seguem as janelas de pagamento
                  (dias 08 e 20, ou o dia útil seguinte); datas fora da
                  competência escolhida ficam sinalizadas.
                </p>
              </div>
            </div>
          </section>
        </div>

        {/* ---------- Coluna lateral ---------- */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card px-5 py-4 shadow-soft">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Dados da produção
            </p>
            {dadosProducao.map((d) => (
              <div
                key={d.rotulo}
                className="flex items-baseline justify-between gap-3"
              >
                <span className="text-[12.5px] text-muted-foreground">
                  {d.rotulo}
                </span>
                <span
                  className={
                    d.mono
                      ? "text-right font-mono text-[12.5px] font-semibold"
                      : "text-right text-[12.5px] font-semibold"
                  }
                >
                  {d.valor}
                </span>
              </div>
            ))}
            {/* Os dois números do fechamento, como no modal do envio:
                faturamento previsto em vermelho, valor total fechando. */}
            <div className="mt-0.5 flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
              <span className="text-[12.5px] font-semibold">
                Faturamento previsto
              </span>
              <span className="font-mono text-[13px] font-bold text-california-red">
                {formatCurrency(job.faturamento_previsto)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] font-semibold">Valor total</span>
              <span className="font-mono text-[15px] font-bold">
                {formatCurrency(job.valor_total)}
              </span>
            </div>
            {/* Item 03 do protótipo: a planilha interna do job em leitura,
                dentro do próprio fluxo de abertura. */}
            <Link
              href={`/financeiro/abertura-de-job/${job.id}/planilha`}
              prefetch={false}
              className="mt-1.5 flex items-center gap-2.5 rounded-xl border border-border bg-muted/50 px-3.5 py-3 text-left transition-colors hover:border-california-red/50 hover:bg-california-red/5"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-california-red">
                <Table2 className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold">
                  Visualizar planilha interna
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {resumoPlanilha}
                </p>
              </div>
              <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </Link>
          </div>

          {/* O que a produção escreveu ao enviar o job. Mesmo dado e mesmo
              rótulo da conferência: coluna `jobs.observacoes`, "Descritivo
              do Job" nas duas pontas desde 17/08/2026. */}
          <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card px-5 py-4 shadow-soft">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Descritivo do Job
            </p>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              {job.observacoes?.trim() || "Sem descritivo do job."}
            </p>
            <div className="mt-0.5 flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
              <span className="text-xs text-muted-foreground">Enviado por</span>
              <span className="text-right text-xs font-semibold">
                {enviadoPorNome ?? "—"}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                Orçamento de origem
              </span>
              <span className="font-mono text-xs font-semibold">
                {job.orcamento_codigo ?? "—"}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card px-5 py-4 shadow-soft">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Resumo do registro
            </p>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Categoria
              </span>
              <span className="text-right text-[12.5px] font-semibold">
                {categoriaNome}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Competência
              </span>
              <span className="font-mono text-[12.5px] font-semibold">
                {competenciaLabel}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Faturamento previsto
              </span>
              <span className="font-mono text-[12.5px] font-semibold text-emerald-700">
                {formatCurrency(faturamentoPrevisto)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Recebimentos
              </span>
              <span className="text-[12.5px] font-semibold">
                {semRecebimento
                  ? "Sem faturamento"
                  : recebimento.length === 1
                    ? "1 recebimento"
                    : `${recebimento.length} recebimentos`}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Custo previsto
              </span>
              <span className="font-mono text-[12.5px] font-semibold">
                {formatCurrency(custoPrevisto)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-muted-foreground">
                Datas previstas
              </span>
              <span className="text-[12.5px] font-semibold">
                {semDesembolso
                  ? "Sem desembolso"
                  : curva.length === 1
                    ? "1 data"
                    : `${curva.length} datas`}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
              <span className="text-[12.5px] text-muted-foreground">
                Margem prevista
              </span>
              <span
                className={cn(
                  "font-mono text-[13px] font-bold",
                  margem >= 0 ? "text-emerald-700" : "text-california-red",
                )}
              >
                {formatCurrency(margem)}
                {faturamentoPrevisto > 0
                  ? ` · ${formatPercentual(margemPct)}`
                  : ""}
              </span>
            </div>
          </div>
        </aside>
      </div>

      {/* ---------- Barra fixa de ação ---------- */}
      <div className="sticky bottom-0 z-10 -mx-5 -mb-6 flex flex-wrap items-center justify-between gap-4 border-t border-border bg-white/95 px-5 py-3.5 backdrop-blur md:-mx-8 md:-mb-8 md:px-8">
        <span
          className={cn(
            "inline-flex items-center gap-2 text-[12.5px] font-medium",
            podeAbrir ? "text-emerald-700" : "text-amber-700",
          )}
        >
          {podeAbrir ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5" />
          )}
          {textoValidacao}
        </span>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setReprovarAberto(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2.5 text-[13.5px] font-semibold text-california-red transition-colors hover:border-california-red hover:bg-california-red/5"
          >
            <CornerUpLeft className="h-4 w-4" />
            Reprovar job
          </button>
          <button
            type="button"
            onClick={() => setConfirmarAberto(true)}
            disabled={!podeAbrir || pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Check className="h-4 w-4" />
            Abrir job no financeiro
          </button>
        </div>
      </div>

      {/* ---------- Confirmação ---------- */}
      <Dialog open={confirmarAberto} onOpenChange={setConfirmarAberto}>
        <DialogContent className="max-h-[88vh] max-w-[470px] overflow-y-auto">
          <DialogHeader>
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <DialogTitle className="pt-4 text-[19px]">
              Abrir {job.codigo} no financeiro?
            </DialogTitle>
            <DialogDescription className="text-[13.5px] leading-relaxed">
              O job passa a existir no financeiro, aceita lançamentos e entra na
              lista de jobs abertos. A data de abertura é registrada agora.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2.5 rounded-xl border border-border px-4 py-4">
            <ResumoLinha rotulo="Nome do job" valor={nome.trim()} />
            <ResumoLinha rotulo="Categoria" valor={categoriaNome} />
            <ResumoLinha rotulo="Competência" valor={competenciaLabel} mono />
            <ResumoLinha rotulo="Data de abertura" valor={agoraLabel} mono />
            <ResumoLinha
              rotulo="Recebimento"
              valor={
                semRecebimento
                  ? "Sem faturamento previsto"
                  : `${recebimento.length}× · ${formatDataBr(recebimento[0]?.data)}${
                      recebimento.length > 1
                        ? ` → ${formatDataBr(recebimento[recebimento.length - 1]?.data)}`
                        : ""
                    }`
              }
            />
            <ResumoLinha
              rotulo="Custo previsto"
              valor={formatCurrency(custoPrevisto)}
              mono
            />
            <ResumoLinha
              rotulo="Curva"
              valor={
                semDesembolso
                  ? "Sem desembolso previsto"
                  : `${curva.length}× · ${formatDataBr(curva[0]?.data)}${
                      curva.length > 1
                        ? ` → ${formatDataBr(curva[curva.length - 1]?.data)}`
                        : ""
                    }`
              }
            />
            <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
              <span className="text-[13px] font-semibold">
                Faturamento previsto
              </span>
              <span className="font-mono text-[13px] font-bold text-california-red">
                {formatCurrency(job.faturamento_previsto)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-semibold">Valor total</span>
              <span className="font-mono text-[15px] font-bold">
                {formatCurrency(job.valor_total)}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setConfirmarAberto(false)}
              className="rounded-lg border border-border bg-white px-4 py-2.5 text-[13.5px] font-semibold transition-colors hover:bg-muted"
            >
              Voltar e revisar
            </button>
            <button
              type="button"
              onClick={confirmarAbertura}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-[18px] py-2.5 text-[13.5px] font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              {pending ? "Abrindo..." : "Sim, abrir job"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <ReprovarDialog
        open={reprovarAberto}
        onOpenChange={setReprovarAberto}
        jobId={job.id}
        jobCodigo={job.codigo}
        gpNome={job.responsavel_nome}
        produtorNome={job.produtor_nome}
        redirecionarPara="/financeiro/abertura-de-job"
      />
    </div>
  );
}

function ResumoLinha({
  rotulo,
  valor,
  mono,
}: {
  rotulo: string;
  valor: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[13px] text-muted-foreground">{rotulo}</span>
      <span
        className={
          mono
            ? "text-right font-mono text-[13px] font-semibold"
            : "text-right text-[13px] font-semibold"
        }
      >
        {valor}
      </span>
    </div>
  );
}
