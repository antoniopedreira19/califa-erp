/**
 * O nome do arquivo da PP ao salvar (decisão 241, 06/11/2026).
 *
 * Pedido da produção: "como era no Publi", o número da PP e o fornecedor —
 * `PP-00613 - FORNECEDOR TESTE LTDA.pdf`. Vale em todo lugar que baixa o
 * PDF da PP: a linha da aba PPs, a linha do painel do item, a tela da PP
 * (produção e financeiro) e a conferência dos documentos do envio.
 *
 * Quem vai no nome é quem a PP paga, como as telas já mostram: o
 * fornecedor (razão social), a plataforma do cartão corporativo (decisão
 * 209) ou quem recebe a verba. Sem ninguém, sai só o número.
 */
import {
  nomeDeQuemRecebeAVerba,
  nomeDoCartaoCorporativo,
  tipoDaVerba,
  type TipoVerba,
} from "@/lib/types";

/** Caracteres que o Windows e o macOS não aceitam em nome de arquivo. */
const PROIBIDOS = /[\\/:*?"<>|\u0000-\u001f]+/g;
/** Nome de fornecedor muito longo não faz o arquivo virar um parágrafo. */
const MAXIMO_DO_NOME = 80;

export function nomeDoArquivoDaPP(codigo: string, quem: string | null | undefined): string {
  const limpo = (quem ?? "")
    .replace(PROIBIDOS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAXIMO_DO_NOME)
    .trim()
    // "—" é o vazio das telas, não um nome.
    .replace(/^[-—–.\s]+$/, "");
  return limpo ? `${codigo} - ${limpo}.pdf` : `${codigo}.pdf`;
}

/** Quem a PP paga, para o nome do arquivo: o titular da verba, a
 *  plataforma do cartão ou o fornecedor. */
export function quemVaiNoNomeDoArquivo(pp: {
  verba_producao?: boolean | null;
  tipo_verba?: TipoVerba | null;
  verba_titular_nome?: string | null;
  responsavel?: { nome?: string | null } | null;
  cartao_corporativo?: boolean | null;
  cartao_plataforma?: string | null;
  fornecedor_nome: string | null | undefined;
}): string | null {
  if (tipoDaVerba(pp)) return nomeDeQuemRecebeAVerba(pp);
  if (pp.cartao_corporativo) return nomeDoCartaoCorporativo(pp.cartao_plataforma);
  return pp.fornecedor_nome ?? null;
}
