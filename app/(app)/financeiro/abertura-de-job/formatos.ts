/**
 * Formatação de data para a abertura de job.
 *
 * Tudo aqui é determinístico e recebe o "agora" por parâmetro quando
 * precisa dele: esses rótulos são calculados no server component e
 * descem prontos como string. Calcular "há 2 horas" durante o render de
 * um client component daria divergência de hidratação (o HTML do
 * servidor e o do navegador seriam diferentes).
 */

const FUSO_BR = "America/Sao_Paulo";

/** dd/mm/aaaa a partir de uma coluna `date`. Corte de string, sem fuso. */
export function formatDataBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  if (!ano || !mes || !dia) return "—";
  return `${dia}/${mes}/${ano}`;
}

/** dd/mm/aaaa · hh:mm de um timestamptz, no horário de Brasília. */
export function formatDataHoraBr(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const data = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO_BR,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO_BR,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return `${data} · ${hora}`;
}

/**
 * "há 20 minutos", "há 5 horas", "ontem · 18:42", "05/08/2026 · 14:05".
 * Quem envia o job é a produção, e o financeiro precisa perceber o que
 * está encalhado na fila — por isso o rótulo é relativo enquanto for
 * recente e vira data absoluta depois.
 */
export function formatEnviadoEm(iso: string, agora: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  const minutos = Math.floor((agora.getTime() - d.getTime()) / 60000);
  if (minutos < 1) return "agora mesmo";
  if (minutos < 60) return `há ${minutos} ${minutos === 1 ? "minuto" : "minutos"}`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} ${horas === 1 ? "hora" : "horas"}`;

  const hora = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO_BR,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);

  if (horas < 48) return `ontem · ${hora}`;
  return formatDataHoraBr(d);
}

/** "01/08/2026 → 31/08/2026" ou "—" quando faltar uma das pontas. */
export function formatPeriodo(
  inicio: string | null | undefined,
  fim: string | null | undefined,
): string {
  if (!inicio && !fim) return "—";
  return `${formatDataBr(inicio)} → ${formatDataBr(fim)}`;
}
