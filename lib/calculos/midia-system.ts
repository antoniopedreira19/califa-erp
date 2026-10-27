import type { PPStatus, PrestacaoDaVerba } from "@/lib/types";

/**
 * Mídia System (decisão 216, 26/10/2026): o job que o cliente manda
 * para uma auditoria meticulosa. Enquanto ela corre, a PP normal pode ir ao
 * financeiro sem NF; quando o financeiro libera as NFs, a PP que foi sem
 * nota presta contas dela na MESMA prestação da verba (decisão 189), e as
 * próximas voltam a exigir a NF no envio.
 *
 * Módulo comum, sem `"use server"`: as telas e as actions leem a mesma
 * regra. O banco confere de novo (`pp_guarda_sem_nf_na_auditoria`,
 * `_pp_da_auditoria_liberada`).
 */

/** O job Mídia System, como as telas da PP precisam. `null` = o job não
 *  é Mídia System. */
export interface MidiaSystemDoJob {
  /** Quando o financeiro liberou as NFs. Nulo = auditoria em andamento. */
  liberadoEm: string | null;
}

/** O job lido do banco vira a forma das telas. */
export function midiaSystemDoJob(job: {
  midia_system?: boolean | null;
  midia_system_liberado_em?: string | null;
}): MidiaSystemDoJob | null {
  return job.midia_system === true ? { liberadoEm: job.midia_system_liberado_em ?? null } : null;
}

/** A auditoria está em andamento: a NF não é exigida no envio. */
export function envioDispensaNf(midia: MidiaSystemDoJob | null): boolean {
  return midia !== null && midia.liberadoEm === null;
}

/**
 * Onde a PP que foi sem NF está:
 * - `sem_nf`: auditoria em andamento, a nota vem depois;
 * - `aguardando`: NFs liberadas, a produção ainda não mandou a nota;
 * - `em_avaliacao`, `reprovada`, `aprovada`: a prestação com o financeiro,
 *   devolvida, ou conferida.
 * Null para a PP que não foi sem NF (ou cancelada, ou rejeitada).
 */
export type SituacaoMidia = "sem_nf" | "aguardando" | "em_avaliacao" | "reprovada" | "aprovada";

export interface PPDaAuditoria {
  sem_nf_na_auditoria: boolean;
  verba_producao: boolean;
  status: PPStatus;
  prestacao: Pick<PrestacaoDaVerba, "status"> | null;
}

export function situacaoMidiaDaPP(pp: PPDaAuditoria, midia: MidiaSystemDoJob | null): SituacaoMidia | null {
  if (!pp.sem_nf_na_auditoria || pp.verba_producao) return null;
  if (pp.status === "cancelada" || pp.status === "rejeitada") return null;
  // A marca só existe em job Mídia System. Sem o job em mãos, a PP ainda é
  // da auditoria: vale "sem NF".
  if (!midia || midia.liberadoEm === null) return "sem_nf";
  const s = pp.prestacao?.status;
  if (!s || s === "rascunho") return "aguardando";
  if (s === "em_avaliacao") return "em_avaliacao";
  if (s === "reprovada") return "reprovada";
  return "aprovada";
}

/** A próxima ação é da produção: mandar a nota, ou corrigir a devolvida.
 *  É o filtro "Aguardando prestação" da aba PPs, junto da verba. */
export function midiaAguardaProducao(s: SituacaoMidia | null): boolean {
  return s === "aguardando" || s === "reprovada";
}

/** A PP que foi sem NF trava o encerramento até a prestação aprovada —
 *  durante a auditoria também (resposta do Tiago, 26/10/2026). */
export function midiaPendenteNoEncerramento(pp: PPDaAuditoria): boolean {
  if (!pp.sem_nf_na_auditoria || pp.verba_producao) return false;
  if (pp.status === "cancelada" || pp.status === "rejeitada") return false;
  return pp.prestacao?.status !== "aprovada";
}

export function rotuloSituacaoMidia(s: SituacaoMidia): string {
  switch (s) {
    case "sem_nf":
      return "Sem NF";
    case "aguardando":
      return "Aguardando prestação";
    case "em_avaliacao":
      return "Prestação em avaliação";
    case "reprovada":
      return "Prestação reprovada";
    case "aprovada":
      return "Prestação aprovada";
  }
}

/** A produção mexe nos documentos da prestação da PP que foi sem NF —
 *  com a PP no financeiro, até mandar a prestação; de novo quando o
 *  financeiro reprova. A liberação das NFs o banco confere
 *  (`_verba_para_prestar`). */
export function producaoEditaNfDaAuditoria(pp: PPDaAuditoria): boolean {
  if (!pp.sem_nf_na_auditoria || pp.verba_producao) return false;
  if (pp.status !== "em_avaliacao" && pp.status !== "aprovada" && pp.status !== "pago") return false;
  return !pp.prestacao || pp.prestacao.status === "rascunho" || pp.prestacao.status === "reprovada";
}
