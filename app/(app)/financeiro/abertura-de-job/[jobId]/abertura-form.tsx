"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
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
  emCentavos,
  foraDaCompetencia,
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
interface CurvaLinhaForm {
  id: string;
  data: string;
  valorTexto: string;
}

interface Props {
  job: JobNaFila;
  categorias: CategoriaOption[];
  custoPrevisto: number;
  curvaInicial: CurvaLinha[];
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

export function AberturaForm({
  job,
  categorias,
  custoPrevisto,
  curvaInicial,
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
  const [curva, setCurva] = React.useState<CurvaLinhaForm[]>(() =>
    curvaInicial.map((l) => ({
      id: l.id,
      data: l.data,
      valorTexto: formatMoedaTexto(l.valor),
    })),
  );
  const [confirmarAberto, setConfirmarAberto] = React.useState(false);
  const [reprovarAberto, setReprovarAberto] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const linhasNumericas = curva.map((l) => ({
    data: l.data,
    valor: parseMoeda(l.valorTexto),
  }));
  const soma = somaCurva(linhasNumericas);
  const fecha = curvaFecha(linhasNumericas, custoPrevisto);
  const diferenca = emCentavos(soma - custoPrevisto);

  const nomeOk = nome.trim().length >= 2;
  const temCusto = custoPrevisto > 0;
  const todasDatasPreenchidas = curva.every((l) => l.data.length === 10);
  const todosValoresPositivos = linhasNumericas.every((l) => l.valor > 0);
  const podeAbrir =
    nomeOk &&
    categoriaId !== "" &&
    temCusto &&
    curva.length > 0 &&
    todasDatasPreenchidas &&
    todosValoresPositivos &&
    fecha;

  const margem = (job.valor_total ?? 0) - custoPrevisto;
  const margemPct =
    job.valor_total && job.valor_total > 0
      ? (margem / job.valor_total) * 100
      : 0;
  const margemLabel = `${formatCurrency(margem)} · ${formatPercentual(margemPct)}`;
  const categoriaNome =
    categorias.find((c) => c.id === categoriaId)?.nome ?? "— não informada";
  const competenciaLabel = `${trimestre}T/${ano}`;

  const textoValidacao = !temCusto
    ? "Sem custo planejado na planilha interna — verifique o orçamento do job."
    : !nomeOk
      ? "Informe o nome do job."
      : categoriaId === ""
        ? "Selecione a categoria do job."
        : !todasDatasPreenchidas
          ? "Preencha a data de todas as linhas da curva."
          : !todosValoresPositivos
            ? "Cada data da curva precisa de um valor maior que zero."
            : !fecha
              ? "A curva precisa somar o custo previsto."
              : "Tudo pronto: nome, categoria, competência e previsão de custos preenchidos.";

  function atualizarLinha(id: string, patch: Partial<CurvaLinhaForm>) {
    setCurva((atual) =>
      atual.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    );
  }

  function distribuirIgualmente() {
    const valores = dividirEmParcelas(custoPrevisto, curva.length);
    setCurva((atual) =>
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

  function removerLinha(id: string) {
    if (curva.length <= 1) return;
    setCurva((atual) => atual.filter((l) => l.id !== id));
  }

  function confirmarAbertura() {
    setErro(null);
    startTransition(async () => {
      const res = await abrirJobNoFinanceiro(job.id, {
        nome_financeiro: nome.trim(),
        categoria_id: categoriaId,
        competencia_trimestre: trimestre,
        competencia_ano: ano,
        curva: linhasNumericas.map((l) => ({
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
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-emerald-700">
            <Check className="h-3 w-3" />
            Conferido
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Dados da produção já validados. Complete o registro financeiro: nome,
          categoria, competência e a previsão de custos do job.
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
                    Faturamento previsto do orçamento
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
                    {temCusto
                      ? `Custo planejado da planilha interna · ${margemLabel} de margem`
                      : "A planilha interna deste job está sem custo planejado."}
                  </p>
                </div>
              </div>

              {/* Curva de desembolso */}
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-muted/60 px-4 py-2.5">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-[12.5px] font-semibold">
                    Curva de desembolso
                  </p>
                  <span className="text-[11.5px] text-muted-foreground">
                    Distribuída entre{" "}
                    {formatDataBr(job.data_inicio_prevista)} e{" "}
                    {formatDataBr(job.data_fim_prevista)}
                  </span>
                  <button
                    type="button"
                    onClick={distribuirIgualmente}
                    disabled={!temCusto}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:border-[#d7d7d7] hover:text-foreground disabled:opacity-50"
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
                                onDateChange={(d) =>
                                  atualizarLinha(linha.id, {
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
                                  atualizarLinha(linha.id, {
                                    valorTexto: e.target.value,
                                  })
                                }
                                onBlur={() =>
                                  atualizarLinha(linha.id, {
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
                              onClick={() => removerLinha(linha.id)}
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
                        {formatCurrency(soma)}
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
                        fecha
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-amber-200 bg-amber-50 text-amber-700",
                      )}
                    >
                      {fecha ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <AlertTriangle className="h-3 w-3" />
                      )}
                      {fecha
                        ? "Curva fecha com o total"
                        : diferenca > 0
                          ? `Sobra de ${formatCurrency(Math.abs(diferenca))}`
                          : `Falta ${formatCurrency(Math.abs(diferenca))}`}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 px-3.5 py-3">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  A previsão não trava o realizado: ela alimenta o fluxo de
                  caixa do financeiro e o comparativo com o planejado da
                  planilha. Datas fora da competência escolhida ficam
                  sinalizadas.
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
            <div className="mt-0.5 flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
              <span className="text-[12.5px] font-semibold">Valor total</span>
              <span className="font-mono text-[15px] font-bold text-california-red">
                {formatCurrency(job.valor_total)}
              </span>
            </div>
            <Link
              href={`/jobs/${job.id}?from=financeiro&aba=planilha`}
              prefetch={false}
              className="mt-1.5 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-3.5 py-2.5 text-[12.5px] font-semibold transition-colors hover:border-[#d7d7d7] hover:bg-muted/70"
            >
              <Table2 className="h-3.5 w-3.5" />
              Ver planilha interna
            </Link>
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
                {curva.length === 1 ? "1 data" : `${curva.length} datas`}
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
                {margemLabel}
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
        <DialogContent className="max-w-[470px]">
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
              rotulo="Custo previsto"
              valor={formatCurrency(custoPrevisto)}
              mono
            />
            <ResumoLinha
              rotulo="Curva"
              valor={`${curva.length}× · ${formatDataBr(curva[0]?.data)}${
                curva.length > 1
                  ? ` → ${formatDataBr(curva[curva.length - 1]?.data)}`
                  : ""
              }`}
            />
            <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
              <span className="text-[13px] font-semibold">Valor total</span>
              <span className="font-mono text-[15px] font-bold text-california-red">
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
