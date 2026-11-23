/**
 * Os documentos do veículo no mês, no job de Mídia Off (decisão 274): AP,
 * PI e a NF do veículo. Usado no navegador e no servidor — só constantes,
 * tipos e as regras do arquivo. Quem lê o banco é `lib/data/midia-do-job.ts`;
 * quem grava, `jobs/[jobId]/realizado/actions-midia-documentos.ts`.
 */

export const BUCKET_DA_MIDIA = "jobs-midia";

/** O mesmo teto do bucket (`file_size_limit`). */
export const LIMITE_DO_DOCUMENTO_MB = 25;
export const LIMITE_DO_DOCUMENTO_BYTES = LIMITE_DO_DOCUMENTO_MB * 1024 * 1024;

export const EXTENSOES_DO_DOCUMENTO = [".pdf", ".png", ".jpg", ".jpeg"] as const;

export type TipoDocumentoMidia = "ap" | "pi" | "nf";

export const NOME_DO_DOCUMENTO: Record<TipoDocumentoMidia, string> = {
  ap: "AP",
  pi: "PI",
  nf: "NF do veículo",
};

/** Um documento anexado, como as telas o leem. */
export interface DocumentoDaMidia {
  id: string;
  fornecedorId: string;
  /** `YYYY-MM-01`. */
  mes: string;
  tipo: TipoDocumentoMidia;
  numero: string;
  /** Só na NF. */
  valor: number | null;
  /** Só na NF, `YYYY-MM-DD`. */
  dataEmissao: string | null;
  nomeArquivo: string;
  path: string;
  criadoEm: string;
  criadoPorNome: string | null;
}

export function extensaoDe(nome: string): string {
  const i = nome.lastIndexOf(".");
  return i >= 0 ? nome.slice(i).toLowerCase() : "";
}

/** O motivo de recusar o arquivo, ou `null` quando ele serve. */
export function recusaDoDocumento(nome: string, tamanho: number): string | null {
  if (!(EXTENSOES_DO_DOCUMENTO as readonly string[]).includes(extensaoDe(nome))) {
    return `${nome}: envie em PDF ou imagem (PNG ou JPG).`;
  }
  if (!(tamanho > 0)) return `${nome}: o arquivo está vazio.`;
  if (tamanho > LIMITE_DO_DOCUMENTO_BYTES) {
    const mb = (tamanho / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    return `${nome}: tem ${mb} MB; o limite é ${LIMITE_DO_DOCUMENTO_MB} MB.`;
  }
  return null;
}

/** O caminho no bucket: `<tenant>/<job>/<uuid>-<nome>`. */
export function caminhoDoDocumento(tenantId: string, jobId: string, uuid: string, nome: string): string {
  const limpo = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+(\.[a-zA-Z0-9]+)$/, "$1")
    .replace(/^-+|-+$/g, "")
    .slice(-120);
  return `${tenantId}/${jobId}/${uuid}-${limpo || "documento"}`;
}

/** O caminho é deste tenant e deste job — sem subpasta a mais nem "..". */
export function documentoDoJob(path: string, tenantId: string, jobId: string): boolean {
  const partes = path.split("/");
  return (
    partes.length === 3 &&
    partes[0] === tenantId &&
    partes[1] === jobId &&
    partes[2] !== "" &&
    !path.includes("..")
  );
}
