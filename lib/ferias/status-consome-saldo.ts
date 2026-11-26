import type { FeriasLancamentoStatus } from "@/lib/types";

/**
 * Status de lançamento de férias que reservam/consomem dias do aquisitivo
 * e devem abater do saldo disponível. Vale pro cálculo do saldo do hero,
 * do card de "próximo período" e da seção de histórico.
 *
 * Dentro: fluxo em andamento (reserva otimista) + concluídos.
 * Fora: `cancelado` e `reprovado` (não houve consumo real).
 *
 * Antes de 2026-11-26, o cálculo do saldo no hero (`page.tsx`) considerava
 * só `aprovado`, `concluido` e `pendente_aprovacao` — quando o lançamento
 * passava pra `nf_anexada` ou `enviado_financeiro`, o saldo voltava ao
 * cheio porque o status saía do set. Ver `rh/ferias/[id]/page.tsx`.
 */
export const STATUS_CONSOME_SALDO: ReadonlySet<FeriasLancamentoStatus> =
  new Set<FeriasLancamentoStatus>([
    "aguardando_gestor",
    "pendente_aprovacao",
    "aguardando_financeiro",
    "aprovado",
    "nf_anexada",
    "enviado_financeiro",
    "concluido",
  ]);
