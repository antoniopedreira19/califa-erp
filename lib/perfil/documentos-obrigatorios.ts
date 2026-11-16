import type {
  ColaboradorDocumentoTipo,
  TipoContratacao,
} from "@/lib/types";

/**
 * Documentos que o colaborador precisa anexar antes de completar o
 * perfil pela primeira vez. A régua é a mesma usada pela RPC
 * `completar_meu_perfil_colaborador` no banco (sincronizar quando mudar).
 *
 * Sócio não aparece aqui — ele nem vê o wizard de boas-vindas.
 */
export function documentosObrigatorios(
  tipo: TipoContratacao,
): ColaboradorDocumentoTipo[] {
  // `rg_cnh` cobre identificação pessoal — RG, CNH ou CPF, qualquer um
  // basta (decisão 16/11/2026). O tipo `cpf` do enum continua
  // disponível pra quem quiser anexar separadamente, só não é obrigatório.
  switch (tipo) {
    case "pj":
      return ["cnpj", "rg_cnh"];
    case "mei":
      return ["cnpj", "ccmei", "rg_cnh"];
    case "clt":
    case "clt_recibo":
      return [
        "rg_cnh",
        "comprovante_residencia",
        "pis",
        "ctps",
        "titulo_eleitor",
      ];
    case "estagio":
      return ["rg_cnh", "comprovante_residencia", "ctps"];
    case "socio":
      return [];
  }
}

/** Tipos aceitos no upload do bucket de documentos do colaborador. */
export const MIME_TYPES_ACEITOS: readonly string[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
] as const;

/** Tamanho máximo por arquivo. 10 MB combinado com o PO. */
export const TAMANHO_MAX_BYTES = 10 * 1024 * 1024;
