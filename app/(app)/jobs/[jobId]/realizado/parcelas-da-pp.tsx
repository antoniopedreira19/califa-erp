"use client";

import * as React from "react";
import { CalendarDays, Lock, RotateCcw } from "lucide-react";
import { format, parse } from "date-fns";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatCurrency } from "@/lib/utils";
import { dividirEmParcelas, parcelasFecham } from "@/lib/calculos/pps-item";
import {
  acomodarDatasDasParcelas,
  ehJanelaDePagamento,
  primeiraDataDaProximaParcela,
} from "@/lib/calculos/janelas-pagamento";

/**
 * Parcelamento da PP com o percentual de cada parcela (decisão 138).
 *
 * Cada parcela tem o R$ e o % do valor da PP; digitar um refaz o outro. A
 * ÚLTIMA parcela fecha os 100%: ela é travada e é sempre o que falta das
 * anteriores, em % e em R$ (a sobra de centavo cai nela, como na divisão
 * igual). Então a soma não sai de 100% — o único erro possível é as
 * anteriores passarem de 100% e não sobrar nada para a última.
 *
 * Sem valor da PP (R$ Unit., QT ou D/M vazio) não há total para dividir:
 * o R$ das parcelas fica travado em "—" e só o % se escolhe. Em 05/10/2026
 * o R$ digitável nesse estado deixava a última parcela negativa (0 − o
 * digitado) sem erro nenhum, e o "não preencheu o valor pelo %" era o
 * mesmo trio vazio.
 *
 * O servidor continua recebendo só o R$ de cada parcela. O % é do
 * formulário: ao reabrir a PP ele se refaz do R$ gravado.
 *
 * Datas (decisão 172, 14/10/2026): a 1ª é o prazo de pagamento; cada
 * seguinte nasce na primeira data possível — pula a janela logo depois da
 * anterior — e pode ser ADIADA à mão no calendário (só janelas, só para
 * depois). A adiada mostra o ↺, que volta para a data padrão.
 */

export interface ParcelaLocal {
  data_vencimento: string;
  /** Texto cru: o usuário pode estar no meio da digitação. */
  valor: string;
  /** % do valor da PP, também em texto cru. */
  percentual: string;
  /** A data foi adiada à mão (decisão 172). Obrigatório: opcional, o `.map`
   *  que monta as parcelas o descartaria em silêncio. */
  ajustada: boolean;
}

const arredondar = (n: number) => Math.round(n * 100) / 100;

/** O formato dos campos: "1666,66", sem separador de milhar. */
function texto(n: number): string {
  return arredondar(n).toFixed(2).replace(".", ",");
}

/** Aceita "1.234,56" e "1234.56", como o resto das grades do sistema. */
function numero(bruto: string): number {
  const s = (bruto ?? "").trim();
  if (s === "") return 0;
  const normalizado = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : 0;
}

function formatPercentual(n: number): string {
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function isoParaBr(iso: string): string {
  return iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—";
}

function soma(parcelas: ParcelaLocal[], campo: "valor" | "percentual"): number {
  return arredondar(parcelas.reduce((s, p) => s + numero(p[campo]), 0));
}

/** A última parcela é o que falta das anteriores, em % e em R$. */
function fecharNaUltima(parcelas: ParcelaLocal[], valorPP: number): ParcelaLocal[] {
  if (parcelas.length === 0) return parcelas;
  const anteriores = parcelas.slice(0, -1);
  return [
    ...anteriores,
    {
      ...parcelas[parcelas.length - 1],
      percentual: texto(100 - soma(anteriores, "percentual")),
      valor: texto(valorPP - soma(anteriores, "valor")),
    },
  ];
}

/** Divisão igual: o R$ pela regra de sempre (sobra na última) e o % pela
 *  mesma regra — 33,33 + 33,33 + 33,34. */
export function montarParcelas(datas: string[], valorPP: number): ParcelaLocal[] {
  const valores = dividirEmParcelas(valorPP, datas.length);
  const percentuais = dividirEmParcelas(100, datas.length);
  return datas.map((data, i) => ({
    data_vencimento: data,
    valor: texto(valores[i]),
    percentual: texto(percentuais[i]),
    ajustada: false,
  }));
}

/**
 * A PP gravada reaberta para edição: o % de cada parcela sai do R$. As
 * datas ficam como foram gravadas; a que está depois da data padrão volta
 * marcada como adiada (decisão 172).
 */
export function parcelasDaPPGravada(
  gravadas: Array<{ data_vencimento: string; valor: number }>,
  valorPP: number,
): ParcelaLocal[] {
  const datas = gravadas.map((p) => p.data_vencimento.slice(0, 10));
  const adiada = (i: number) => i > 0 && datas[i] > primeiraDataDaProximaParcela(datas[i - 1]);
  if (valorPP <= 0) {
    const percentuais = dividirEmParcelas(100, gravadas.length);
    return gravadas.map((p, i) => ({
      data_vencimento: datas[i],
      valor: texto(Number(p.valor)),
      percentual: texto(percentuais[i]),
      ajustada: adiada(i),
    }));
  }
  const parcelas = gravadas.map((p, i) => ({
    data_vencimento: datas[i],
    valor: texto(Number(p.valor)),
    percentual: texto((Number(p.valor) / valorPP) * 100),
    ajustada: adiada(i),
  }));
  return fecharNaUltima(parcelas, valorPP);
}

function ehDivisaoIgual(parcelas: ParcelaLocal[], valorPP: number): boolean {
  const iguais = montarParcelas(
    parcelas.map((p) => p.data_vencimento),
    valorPP,
  );
  return parcelas.every(
    (p, i) =>
      numero(p.valor) === numero(iguais[i].valor) &&
      numero(p.percentual) === numero(iguais[i].percentual),
  );
}

/**
 * O valor da PP mudou (R$ Unit., QT ou D/M). Divisão igual continua
 * igual; divisão personalizada mantém o % de cada parcela. Antes da 138
 * tudo voltava a ser igual, e um 30/70 virava 50/50 sem aviso.
 */
export function redividirParcelas(
  parcelas: ParcelaLocal[],
  valorAntigo: number,
  valorNovo: number,
): ParcelaLocal[] {
  if (parcelas.length === 0) return parcelas;
  if (ehDivisaoIgual(parcelas, valorAntigo)) {
    return montarParcelas(
      parcelas.map((p) => p.data_vencimento),
      valorNovo,
    );
  }
  return fecharNaUltima(
    parcelas.map((p) => ({
      ...p,
      valor: texto((valorNovo * numero(p.percentual)) / 100),
    })),
    valorNovo,
  );
}

/**
 * As datas refeitas a partir do prazo (decisão 172): a padrão anda junto, e
 * a adiada à mão fica enquanto continuar possível. A divisão fica (138).
 */
export function acomodarParcelas(prazoIso: string, parcelas: ParcelaLocal[]): ParcelaLocal[] {
  const datas = acomodarDatasDasParcelas(
    prazoIso,
    parcelas.map((p) => ({ data: p.data_vencimento, ajustada: p.ajustada })),
  );
  return parcelas.map((p, i) => ({
    ...p,
    data_vencimento: datas[i].data,
    ajustada: datas[i].ajustada,
  }));
}

/** Adia a parcela `indice` (ou a devolve à data padrão, com `null`). As
 *  seguintes que ficarem cedo demais andam junto. */
export function mudarDataDaParcela(
  prazoIso: string,
  parcelas: ParcelaLocal[],
  indice: number,
  iso: string | null,
): ParcelaLocal[] {
  return acomodarParcelas(
    prazoIso,
    parcelas.map((p, i) =>
      i === indice ? { ...p, data_vencimento: iso ?? p.data_vencimento, ajustada: iso !== null } : p,
    ),
  );
}

/**
 * O R$ só se refaz quando o NÚMERO do % muda. Texto novo com o mesmo
 * número — a saída do campo, que escreve "33,5" como "33,50", ou o "33,"
 * no meio da digitação — só troca o texto. Antes (achado em 13/10/2026)
 * sair do campo refazia o R$ pelo % arredondado: na divisão igual de
 * R$ 6.000 a parcela de R$ 2.000,00 virava 1.999,80, e um R$ 2.500,00
 * digitado (41,67%) virava 2.500,20, com a última absorvendo a diferença
 * (138 §8).
 */
function mudarPercentual(
  parcelas: ParcelaLocal[],
  indice: number,
  bruto: string,
  valorPP: number,
): ParcelaLocal[] {
  return fecharNaUltima(
    parcelas.map((p, i) => {
      if (i !== indice) return p;
      if (numero(bruto) === numero(p.percentual)) return { ...p, percentual: bruto };
      return { ...p, percentual: bruto, valor: texto((valorPP * numero(bruto)) / 100) };
    }),
    valorPP,
  );
}

function mudarValor(
  parcelas: ParcelaLocal[],
  indice: number,
  bruto: string,
  valorPP: number,
): ParcelaLocal[] {
  return fecharNaUltima(
    parcelas.map((p, i) =>
      i === indice
        ? {
            ...p,
            valor: bruto,
            // O campo de R$ só aparece com valor da PP; a guarda fica
            // contra a divisão por zero.
            percentual: valorPP > 0 ? texto((numero(bruto) / valorPP) * 100) : p.percentual,
          }
        : p,
    ),
    valorPP,
  );
}

/** Parcela que não pode ir: % zerado, ou R$ zerado/negativo quando a PP
 *  já tem valor. O R$ pesa à parte porque o % é arredondado a duas casas
 *  e pode ficar positivo com o R$ já no zero. */
function parcelaInvalida(p: ParcelaLocal, valorPP: number): boolean {
  return numero(p.percentual) <= 0 || (valorPP > 0 && numero(p.valor) <= 0);
}

/** A trava do "Gerar": a frase do erro, ou null. */
export function problemaDasParcelas(
  parcelas: ParcelaLocal[],
  valorPP: number,
): string | null {
  if (parcelas.length <= 1) return null;
  const anteriores = parcelas.slice(0, -1);
  const ultima = parcelas[parcelas.length - 1];
  if (numero(ultima.percentual) <= 0) {
    return `As parcelas anteriores já somam ${formatPercentual(soma(anteriores, "percentual"))}. Deixe espaço para a última parcela.`;
  }
  if (valorPP > 0 && numero(ultima.valor) <= 0) {
    return `As parcelas anteriores já somam ${formatCurrency(soma(anteriores, "valor"), "BRL")} de ${formatCurrency(valorPP, "BRL")}. Deixe espaço para a última parcela.`;
  }
  if (anteriores.some((p) => numero(p.percentual) <= 0)) {
    return "Toda parcela precisa de um percentual acima de 0%.";
  }
  if (anteriores.some((p) => parcelaInvalida(p, valorPP))) {
    return "Toda parcela precisa de um valor acima de R$ 0,00.";
  }
  return null;
}

/** Campo de %: aceita "30" ou "33,5"; ao sair, vira "30,00". */
function CampoPercentual({
  valor,
  rotulo,
  invalido,
  disabled,
  onChange,
}: {
  valor: string;
  rotulo: string;
  invalido: boolean;
  disabled?: boolean;
  onChange: (bruto: string) => void;
}) {
  return (
    <div className="relative">
      <Input
        aria-label={rotulo}
        value={valor}
        disabled={disabled}
        onChange={(e) => {
          const limpo = e.target.value.replace(/\./g, ",").replace(/[^\d,]/g, "");
          const [inteiro, ...resto] = limpo.split(",");
          onChange(
            resto.length
              ? `${inteiro.slice(0, 3)},${resto.join("").slice(0, 2)}`
              : inteiro.slice(0, 3),
          );
        }}
        onBlur={() => onChange(texto(numero(valor)))}
        onFocus={(e) => e.currentTarget.select()}
        className={cn(
          "no-spinner pr-8 text-right font-mono",
          invalido && "border-california-red/60 text-california-red",
        )}
        inputMode="decimal"
      />
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-[13px] text-muted-foreground">
        %
      </span>
    </div>
  );
}

/**
 * A data da 2ª parcela em diante (decisão 172): o calendário só acende
 * janelas a partir da primeira data possível, então só adia. Escolher a
 * própria data padrão desfaz o ajuste.
 */
function DataDaParcela({
  valor,
  minima,
  ajustada,
  numero: n,
  disabled,
  onMudar,
}: {
  valor: string;
  minima: string;
  ajustada: boolean;
  numero: number;
  disabled?: boolean;
  onMudar: (iso: string | null) => void;
}) {
  const [aberto, setAberto] = React.useState(false);
  const data = valor ? parse(valor, "yyyy-MM-dd", new Date()) : undefined;
  return (
    <div className="relative">
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={`Data da parcela ${n}`}
            className={cn(
              "flex h-10 w-full items-center justify-between rounded-lg border bg-white px-3 font-mono text-[13px] transition-colors hover:border-california-red/40 focus-visible:border-california-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-california-red/15 disabled:opacity-50",
              ajustada ? "border-foreground/40" : "border-border",
            )}
          >
            {isoParaBr(valor)}
            <CalendarDays
              className={cn("h-3.5 w-3.5 text-muted-foreground/70", ajustada && !disabled && "mr-6")}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto p-0"
          align="start"
          side="bottom"
          sideOffset={6}
          collisionPadding={16}
        >
          <Calendar
            mode="single"
            selected={data}
            defaultMonth={data}
            fixedWeeks
            initialFocus
            disabled={(d: Date) => {
              const iso = format(d, "yyyy-MM-dd");
              return iso < minima || !ehJanelaDePagamento(iso);
            }}
            onSelect={(d?: Date) => {
              if (!d) return;
              const iso = format(d, "yyyy-MM-dd");
              onMudar(iso === minima ? null : iso);
              setAberto(false);
            }}
            footer={
              <p className="mt-2 px-1 text-[11px] text-muted-foreground">
                Janelas a partir de {isoParaBr(minima)}
              </p>
            }
          />
        </PopoverContent>
      </Popover>
      {ajustada && !disabled && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Voltar a parcela ${n} para ${isoParaBr(minima)}`}
              onClick={() => onMudar(null)}
              className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-california-red"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Voltar para {isoParaBr(minima)}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/** Caixa travada da última parcela, no desenho da data da parcela. */
function CaixaTravada({
  children,
  titulo,
  invalido,
}: {
  children: React.ReactNode;
  titulo: string;
  invalido: boolean;
}) {
  return (
    <div
      title={titulo}
      className={cn(
        "flex h-10 items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 font-mono text-[13px]",
        invalido && "border-california-red/50 text-california-red",
      )}
    >
      <Lock className="h-3.5 w-3.5 flex-none text-muted-foreground/70" />
      <span>{children}</span>
    </div>
  );
}

export function ParcelasDaPPField({
  parcelas,
  setParcelas,
  valorPP,
  disabled,
  onMudarData,
}: {
  parcelas: ParcelaLocal[];
  setParcelas: React.Dispatch<React.SetStateAction<ParcelaLocal[]>>;
  valorPP: number;
  disabled?: boolean;
  /** Adiar a data da parcela `indice` (a 2ª em diante); `null` volta para a
   *  data padrão (decisão 172). */
  onMudarData: (indice: number, iso: string | null) => void;
}) {
  const n = parcelas.length;
  const totalPercentual = soma(parcelas, "percentual");
  const totalValor = soma(parcelas, "valor");
  const problema = problemaDasParcelas(parcelas, valorPP);
  // Trio vazio: sem total para dividir, o R$ das parcelas espera.
  const semValor = valorPP <= 0;
  const tituloSemValor =
    "O valor de cada parcela sai do % assim que R$ Unit., QT e D/M estiverem preenchidos.";
  // O total fica vermelho só quando a SOMA não fecha; parcela zerada ou
  // negativa com a soma em 100% já está marcada na própria linha.
  const somaFecha =
    Math.abs(totalPercentual - 100) < 0.005 &&
    parcelasFecham(
      parcelas.map((p) => numero(p.valor)),
      valorPP,
    );
  const igual = ehDivisaoIgual(parcelas, valorPP);

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
      <div className="grid grid-cols-[36px_1fr_120px_1fr] gap-2 px-0.5 text-[11px] font-medium text-muted-foreground">
        <span />
        <span>Vencimento</span>
        <span className="text-right">% do total</span>
        <span className="text-right">Valor (R$)</span>
      </div>
      {parcelas.map((p, i) => {
        const ultima = i === n - 1;
        const invalido = parcelaInvalida(p, valorPP);
        return (
          <div key={i} className="grid grid-cols-[36px_1fr_120px_1fr] items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">
              {i + 1}/{n}
            </span>
            {/* A 1ª parcela é o prazo de pagamento, que se escolhe acima. Da
                2ª em diante a data se adia à mão (decisão 172). */}
            {i === 0 || !parcelas[i - 1].data_vencimento ? (
              <div
                title={
                  i === 0
                    ? "A 1ª parcela é o prazo de pagamento."
                    : "Escolha o prazo de pagamento primeiro."
                }
                className="flex h-10 items-center justify-between rounded-lg border border-border bg-muted/40 px-3 font-mono text-[13px]"
              >
                {isoParaBr(p.data_vencimento)}
                <Lock className="h-3.5 w-3.5 text-muted-foreground/70" />
              </div>
            ) : (
              <DataDaParcela
                valor={p.data_vencimento}
                minima={primeiraDataDaProximaParcela(parcelas[i - 1].data_vencimento)}
                ajustada={p.ajustada}
                numero={i + 1}
                disabled={disabled}
                onMudar={(iso) => onMudarData(i, iso)}
              />
            )}
            {ultima ? (
              <>
                <CaixaTravada
                  titulo="A última parcela fecha os 100%: é o que falta das anteriores."
                  invalido={invalido}
                >
                  {p.percentual} %
                </CaixaTravada>
                <CaixaTravada
                  titulo={
                    semValor
                      ? tituloSemValor
                      : "A última parcela fecha o valor da PP: é o que falta das anteriores."
                  }
                  invalido={invalido}
                >
                  {semValor ? "—" : texto(numero(p.valor))}
                </CaixaTravada>
              </>
            ) : (
              <>
                <CampoPercentual
                  rotulo={`Percentual da parcela ${i + 1}`}
                  valor={p.percentual}
                  invalido={invalido}
                  disabled={disabled}
                  onChange={(bruto) =>
                    setParcelas((prev) => mudarPercentual(prev, i, bruto, valorPP))
                  }
                />
                {semValor ? (
                  <CaixaTravada titulo={tituloSemValor} invalido={false}>
                    —
                  </CaixaTravada>
                ) : (
                  <Input
                    aria-label={`Valor da parcela ${i + 1}`}
                    value={p.valor}
                    disabled={disabled}
                    onChange={(e) =>
                      setParcelas((prev) => mudarValor(prev, i, e.target.value, valorPP))
                    }
                    className={cn(
                      "no-spinner text-right font-mono",
                      invalido && "border-california-red/60 text-california-red",
                    )}
                    inputMode="decimal"
                  />
                )}
              </>
            )}
          </div>
        );
      })}
      <div className="flex items-start justify-between gap-3 border-t border-border pt-2 text-[11px]">
        <div className="flex flex-col items-start gap-0.5 text-muted-foreground">
          <span>Cada parcela pula ao menos uma janela · a última fecha os 100%</span>
          {!igual && (
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                setParcelas((prev) =>
                  montarParcelas(
                    prev.map((q) => q.data_vencimento),
                    valorPP,
                  ),
                )
              }
              className="font-medium text-california-red hover:underline disabled:opacity-50"
            >
              Dividir igualmente
            </button>
          )}
        </div>
        <span
          className={cn(
            "whitespace-nowrap font-mono font-semibold",
            !somaFecha && "text-california-red",
          )}
        >
          {formatPercentual(totalPercentual)}
          {!semValor && (
            <>
              {" "}
              · {formatCurrency(totalValor, "BRL")} / {formatCurrency(valorPP, "BRL")}
            </>
          )}
        </span>
      </div>
      {semValor && (
        <p className="text-[11px] text-muted-foreground">
          Preencha R$ Unit., QT e D/M para ver o valor de cada parcela. O % já pode ser
          escolhido.
        </p>
      )}
      {problema && <p className="text-[11px] font-medium text-california-red">{problema}</p>}
    </div>
  );
}
