/** Validação pura do input da server action `lerDadosDaNFPorIA`.
 *  Fica em arquivo separado pra ser importável do teste sem arrastar
 *  server-only (`"use server"` + `requireSession` com React cache). */

type Err = { ok: false; message: string };

export function validarInputLeituraNF(input: {
  anexo_path: string;
  mimetype: string;
  tenantId: string;
}): { ok: true } | Err {
  if (input.mimetype !== "application/pdf") {
    return {
      ok: false,
      message: "Só PDF por enquanto. Outros formatos ainda não são suportados.",
    };
  }
  if (!input.anexo_path.startsWith(`${input.tenantId}/`)) {
    return { ok: false, message: "Caminho do anexo inválido." };
  }
  return { ok: true };
}
