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
