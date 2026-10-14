"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MESES = [
  { v: 1, l: "Janeiro" },
  { v: 2, l: "Fevereiro" },
  { v: 3, l: "Março" },
  { v: 4, l: "Abril" },
  { v: 5, l: "Maio" },
  { v: 6, l: "Junho" },
  { v: 7, l: "Julho" },
  { v: 8, l: "Agosto" },
  { v: 9, l: "Setembro" },
  { v: 10, l: "Outubro" },
  { v: 11, l: "Novembro" },
  { v: 12, l: "Dezembro" },
];

/**
 * Seletor controlado de competência (mês + ano) para formulários.
 *
 * Serve pra qualquer data que semanticamente é "a partir de qual mês X vale".
 * Internamente opera com valores em ISO "YYYY-MM-DD" apontando pro dia 1 do
 * mês escolhido — o caller passa e recebe nesse formato pra encaixar direto
 * em colunas `date` do Postgres.
 *
 * Diferente do `SeletorCompetenciaInline` da página de /rh/beneficios (que
 * navega via URL): este é controlado via value/onChange, pra formulários.
 */
export function SeletorCompetenciaForm({
  value,
  onChange,
  anoMin,
  anoMax,
  disabled,
  hint,
}: {
  /** ISO "YYYY-MM-DD". O dia é ignorado — sempre interpretado como 01. */
  value: string;
  onChange: (iso: string) => void;
  /** Default: ano atual - 2 */
  anoMin?: number;
  /** Default: ano atual + 1 */
  anoMax?: number;
  disabled?: boolean;
  /** Linha pequena abaixo dos selects com contexto, ex: "Fatura de X já vem com este dep". */
  hint?: string;
}) {
  const anoAtual = new Date().getFullYear();
  const min = anoMin ?? anoAtual - 2;
  const max = anoMax ?? anoAtual + 1;
  const anos: number[] = [];
  for (let a = min; a <= max; a++) anos.push(a);

  // Parse value
  const [anoStr, mesStr] = (value || "").split("-");
  const ano = Number(anoStr) || anoAtual;
  const mes = Number(mesStr) || new Date().getMonth() + 1;

  function atualizar(novoAno: number, novoMes: number) {
    const iso = `${novoAno}-${String(novoMes).padStart(2, "0")}-01`;
    onChange(iso);
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Select
          value={String(mes)}
          onValueChange={(v) => atualizar(ano, Number(v))}
          disabled={disabled}
        >
          <SelectTrigger className="h-10 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MESES.map((m) => (
              <SelectItem key={m.v} value={String(m.v)}>
                {m.l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(ano)}
          onValueChange={(v) => atualizar(Number(v), mes)}
          disabled={disabled}
        >
          <SelectTrigger className="h-10 w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {anos.map((a) => (
              <SelectItem key={a} value={String(a)}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Default comum: próximo mês do calendário.
 * Retorna ISO "YYYY-MM-01" da próxima competência.
 */
export function proximaCompetenciaIso(): string {
  const hoje = new Date();
  const d = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

const MESES_LABEL = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * Rótulo humano da competência pra usar em hints: "novembro/2026".
 */
export function competenciaLabel(iso: string): string {
  const [a, m] = iso.split("-").map(Number);
  if (!a || !m || m < 1 || m > 12) return iso;
  return `${MESES_LABEL[m - 1]}/${a}`;
}
