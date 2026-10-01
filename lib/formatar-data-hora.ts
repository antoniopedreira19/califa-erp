/**
 * "25/09/2026 às 17:59", no horário de Brasília — para frases como
 * "Enviado por X em …" ou "Devolvido pelo Financeiro em …" (decisão 136).
 * Data absoluta, sem "agora": pode ser formatada no client sem divergir da
 * renderização do servidor.
 */
export function formatDataAsHoraBr(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const fmt = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", ...o }).format(d);
  return `${fmt({ day: "2-digit", month: "2-digit", year: "numeric" })} às ${fmt({ hour: "2-digit", minute: "2-digit" })}`;
}

function partes(iso: string | Date | null | undefined) {
  if (!iso) return null;
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const v = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? "";
  return { dia: v("day"), mes: v("month"), ano: v("year"), hora: v("hour"), minuto: v("minute") };
}

/** "24/09/2026 · 14:24", no horário de Brasília — a data e a hora numa
 *  célula de lista (decisão 136). */
export function formatDataHoraListaBr(iso: string | Date | null | undefined): string {
  const p = partes(iso);
  if (!p) return "—";
  return `${p.dia}/${p.mes}/${p.ano} · ${p.hora}:${p.minuto}`;
}

/** "24/09 14:18", no horário de Brasília — a coluna estreita de um
 *  histórico (decisão 136). `soData` corta a hora: o evento só tem o dia. */
export function formatDiaHoraCurtoBr(
  iso: string | Date | null | undefined,
  soData = false,
): string {
  const p = partes(iso);
  if (!p) return "—";
  return soData ? `${p.dia}/${p.mes}` : `${p.dia}/${p.mes} ${p.hora}:${p.minuto}`;
}

/** "01/10/2026 16:14", no horário de Brasília — a linha "Pedido por …"
 *  do cartão do pagamento fora do cadastro (decisão 137), no formato do
 *  "Marcado por" da urgência. */
export function formatDataEHoraBr(iso: string | Date | null | undefined): string {
  const p = partes(iso);
  if (!p) return "—";
  return `${p.dia}/${p.mes}/${p.ano} ${p.hora}:${p.minuto}`;
}
