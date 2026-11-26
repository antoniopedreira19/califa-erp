export type StatusLancamento =
  | "aguardando_gestor"
  | "pendente_aprovacao"
  | "aprovado"
  | "nf_anexada"
  | "enviado_financeiro"
  | "aguardando_financeiro"
  | "reprovado"
  | "cancelado"
  | "concluido";

export type ResultadoCancelamento =
  | { ok: true; deve_apagar_folhas_rascunho: boolean; idempotente: boolean }
  | { ok: false; message: string };

export function decidirCancelamento(
  status: StatusLancamento,
): ResultadoCancelamento {
  switch (status) {
    case "aguardando_gestor":
    case "pendente_aprovacao":
      return { ok: true, deve_apagar_folhas_rascunho: false, idempotente: false };

    case "aprovado":
    case "nf_anexada":
      return { ok: true, deve_apagar_folhas_rascunho: true, idempotente: false };

    case "cancelado":
    case "reprovado":
      return { ok: true, deve_apagar_folhas_rascunho: false, idempotente: true };

    case "enviado_financeiro":
      return {
        ok: false,
        message:
          "Essa solicitação já foi enviada ao financeiro — cancele pelo fluxo financeiro.",
      };

    case "aguardando_financeiro":
      return {
        ok: false,
        message:
          "A solicitação está em processamento pelo financeiro — cancele por lá.",
      };

    case "concluido":
      return {
        ok: false,
        message: "A solicitação já foi concluída e não pode ser cancelada.",
      };
  }
}
