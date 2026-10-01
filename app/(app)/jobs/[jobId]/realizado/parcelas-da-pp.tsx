"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn, formatCurrency } from "@/lib/utils";
import { dividirEmParcelas, parcelasFecham } from "@/lib/calculos/pps-item";

/**
 * Parcelamento da PP com o percentual de cada parcela (decisão 138).
 *
 * Cada parcela tem o R$ e o % do valor da PP; digitar um refaz o outro. A
 * ÚLTIMA parcela fecha os 100%: ela é travada e é sempre o que falta das
 * anteriores, em % e em R$ (a sobra de centavo cai nela, como na divisão
 * igual). Então a soma não sai de 100% — o único erro possível é as
 * anteriores passarem de 100% e não sobrar nada para a última.
 *
 * O servidor continua recebendo só o R$ de cada parcela. O % é do
 * formulário: ao reabrir a PP ele se refaz do R$ gravado.
 */

export interface ParcelaLocal {
  data_vencimento: string;
  /** Texto cru: o usuário pode estar no meio da digitação. */
  valor: string;
  /** % do valor da PP, também em texto cru. */
  percentual: string;
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
  }));
}

/** A PP gravada reaberta para edição: o % de cada parcela sai do R$. */
export function parcelasDaPPGravada(
  gravadas: Array<{ data_vencimento: string; valor: number }>,
  valorPP: number,
): ParcelaLocal[] {
  if (valorPP <= 0) {
    const percentuais = dividirEmParcelas(100, gravadas.length);
    return gravadas.map((p, i) => ({
      data_vencimento: p.data_vencimento.slice(0, 10),
      valor: texto(Number(p.valor)),
      percentual: texto(percentuais[i]),
    }));
  }
  const parcelas = gravadas.map((p) => ({
    data_vencimento: p.data_vencimento.slice(0, 10),
    valor: texto(Number(p.valor)),
    percentual: texto((Number(p.valor) / valorPP) * 100),
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

/** O prazo mudou: as datas andam e a divisão fica. */
export function trocarDatas(parcelas: ParcelaLocal[], datas: string[]): ParcelaLocal[] {
  return parcelas.map((p, i) => ({ ...p, data_vencimento: datas[i] }));
}

function mudarPercentual(
  parcelas: ParcelaLocal[],
  indice: number,
  bruto: string,
  valorPP: number,
): ParcelaLocal[] {
  return fecharNaUltima(
    parcelas.map((p, i) =>
      i === indice
        ? { ...p, percentual: bruto, valor: texto((valorPP * numero(bruto)) / 100) }
        : p,
    ),
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
            // Sem valor da PP ainda (trio vazio), o % fica como estava.
            percentual: valorPP > 0 ? texto((numero(bruto) / valorPP) * 100) : p.percentual,
          }
        : p,
    ),
    valorPP,
  );
}

/** A trava do "Gerar": a frase do erro, ou null. */
export function problemaDasParcelas(parcelas: ParcelaLocal[]): string | null {
  if (parcelas.length <= 1) return null;
  const anteriores = parcelas.slice(0, -1);
  if (numero(parcelas[parcelas.length - 1].percentual) <= 0) {
    return `As parcelas anteriores já somam ${formatPercentual(soma(anteriores, "percentual"))}. Deixe espaço para a última parcela.`;
  }
  if (anteriores.some((p) => numero(p.percentual) <= 0)) {
    return "Toda parcela precisa de um percentual acima de 0%.";
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
}: {
  parcelas: ParcelaLocal[];
  setParcelas: React.Dispatch<React.SetStateAction<ParcelaLocal[]>>;
  valorPP: number;
  disabled?: boolean;
}) {
  const n = parcelas.length;
  const totalPercentual = soma(parcelas, "percentual");
  const totalValor = soma(parcelas, "valor");
  const problema = problemaDasParcelas(parcelas);
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
        const invalido = numero(p.percentual) <= 0;
        return (
          <div key={i} className="grid grid-cols-[36px_1fr_120px_1fr] items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">
              {i + 1}/{n}
            </span>
            {/* Data travada (decisão 077, pergunta 5a): ela é a janela do
                prazo no mês da parcela, e muda junto com ele. */}
            <div
              title="A data acompanha a janela do prazo de pagamento."
              className="flex h-10 items-center justify-between rounded-lg border border-border bg-muted/40 px-3 font-mono text-[13px]"
            >
              {isoParaBr(p.data_vencimento)}
              <Lock className="h-3.5 w-3.5 text-muted-foreground/70" />
            </div>
            {ultima ? (
              <>
                <CaixaTravada
                  titulo="A última parcela fecha os 100%: é o que falta das anteriores."
                  invalido={invalido}
                >
                  {p.percentual} %
                </CaixaTravada>
                <CaixaTravada
                  titulo="A última parcela fecha o valor da PP: é o que falta das anteriores."
                  invalido={invalido}
                >
                  {texto(numero(p.valor))}
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
                <Input
                  aria-label={`Valor da parcela ${i + 1}`}
                  value={p.valor}
                  disabled={disabled}
                  onChange={(e) =>
                    setParcelas((prev) => mudarValor(prev, i, e.target.value, valorPP))
                  }
                  className="no-spinner text-right font-mono"
                  inputMode="decimal"
                />
              </>
            )}
          </div>
        );
      })}
      <div className="flex items-start justify-between gap-3 border-t border-border pt-2 text-[11px]">
        <div className="flex flex-col items-start gap-0.5 text-muted-foreground">
          <span>Mesma janela, mês a mês · a última parcela fecha os 100%</span>
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
          {formatPercentual(totalPercentual)} · {formatCurrency(totalValor, "BRL")} /{" "}
          {formatCurrency(valorPP, "BRL")}
        </span>
      </div>
      {problema && <p className="text-[11px] font-medium text-california-red">{problema}</p>}
    </div>
  );
}
