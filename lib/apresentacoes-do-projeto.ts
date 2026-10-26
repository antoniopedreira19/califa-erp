/**
 * As apresentações do projeto (decisão 213): os arquivos que foram
 * mostrados ao cliente, anexados no formulário do projeto e abertos no
 * card PROJETO da aba "Informações do Job".
 *
 * Este módulo é usado no navegador e no servidor: só constantes, tipos e
 * as regras de arquivo. Quem lê o banco é `lib/data/apresentacoes-do-projeto.ts`.
 */

export const BUCKET_DAS_APRESENTACOES = "projetos-apresentacoes";

/** O mesmo teto do bucket (`file_size_limit`). */
export const LIMITE_DA_APRESENTACAO_MB = 50;
export const LIMITE_DA_APRESENTACAO_BYTES = LIMITE_DA_APRESENTACAO_MB * 1024 * 1024;

/** O bucket não tem lista de tipos: o Keynote chega com tipos diferentes
 *  conforme o navegador. Quem confere é a extensão. */
export const EXTENSOES_DA_APRESENTACAO = [".pdf", ".ppt", ".pptx", ".key"] as const;

/** Um arquivo no campo e no card: o caminho no bucket, o nome e o tamanho. */
export interface ApresentacaoDoProjeto {
  path: string;
  nome: string;
  tamanho: number;
  tipo: string | null;
}

export function extensaoDe(nome: string): string {
  const i = nome.lastIndexOf(".");
  return i >= 0 ? nome.slice(i).toLowerCase() : "";
}

/** O motivo de recusar o arquivo, ou `null` quando ele serve. */
export function recusaDaApresentacao(nome: string, tamanho: number): string | null {
  if (!(EXTENSOES_DA_APRESENTACAO as readonly string[]).includes(extensaoDe(nome))) {
    return `${nome}: envie em PDF, PowerPoint ou Keynote.`;
  }
  if (tamanho <= 0) return `${nome}: o arquivo está vazio.`;
  if (tamanho > LIMITE_DA_APRESENTACAO_BYTES) {
    return `${nome}: tem ${tamanhoLegivel(tamanho)}; o limite é ${LIMITE_DA_APRESENTACAO_MB} MB.`;
  }
  return null;
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("pt-BR")} KB`;
}

/** O caminho no bucket: `<tenant>/<uuid>-<nome>`. Sem a pasta do projeto
 *  porque o arquivo sobe antes de o projeto novo existir. */
export function caminhoDaApresentacao(tenantId: string, uuid: string, nome: string): string {
  const limpo = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+(\.[a-zA-Z0-9]+)$/, "$1")
    .replace(/^-+|-+$/g, "")
    .slice(-120);
  return `${tenantId}/${uuid}-${limpo || "apresentacao"}`;
}

/** O caminho é do tenant — sem subpasta nem "..". */
export function apresentacaoDoTenant(path: string, tenantId: string): boolean {
  const partes = path.split("/");
  return partes.length === 2 && partes[0] === tenantId && partes[1] !== "" && !path.includes("..");
}

/**
 * Lê a lista que o formulário manda (campo `apresentacoes`, JSON). Linha
 * malformada sai; o servidor ainda confere o caminho de cada uma.
 */
export function lerApresentacoesDoForm(valor: FormDataEntryValue | null): ApresentacaoDoProjeto[] | null {
  if (valor === null) return null;
  try {
    const bruto = JSON.parse(valor.toString());
    if (!Array.isArray(bruto)) return [];
    return bruto
      .filter(
        (a) =>
          a &&
          typeof a.path === "string" &&
          typeof a.nome === "string" &&
          typeof a.tamanho === "number",
      )
      .map((a) => ({
        path: a.path,
        nome: a.nome.slice(0, 255),
        tamanho: a.tamanho,
        tipo: typeof a.tipo === "string" ? a.tipo : null,
      }));
  } catch {
    return [];
  }
}
