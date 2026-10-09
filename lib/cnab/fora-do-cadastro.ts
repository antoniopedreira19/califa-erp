import type { PagamentoForaDoCadastroDaPP } from "@/lib/types";

/**
 * A PP fora do cadastro na remessa CNAB (decisão 137, que revê a 127).
 *
 * Até 01/10/2026 o gerador recusava a parcela dessa PP ("pague pelo
 * PDF"). Agora ela entra no arquivo, paga pela chave ou pela conta da PP:
 *
 * - **o favorecido continua o fornecedor do cadastro** (nome e CPF/CNPJ):
 *   a chave ou a conta fora do cadastro é da própria empresa — "uma
 *   empresa pode passar uma chave Pix temporária" (decisão 127, §1);
 * - **só o meio da PP vale**: com outro PIX, a conta do cadastro sai dos
 *   dados, e com outra conta, a chave do cadastro sai — o arquivo nunca
 *   cai no meio do cadastro que a PP trocou;
 * - **a forma vem da PP**, e não do seletor PIX/TED do diálogo.
 *
 * Boleto (decisão 161) não chega aqui: `resolverOrigem` recusa a parcela
 * antes ("pague pelo boleto anexado"), porque o gerador não tem segmento J.
 *
 * Função pura, sem banco: `npm run test:cnab-fora` cobre as trocas.
 */

/** Os campos de pagamento que o gerador lê do destinatário. */
export interface MeiosDoDestinatario {
  bancoCodigo: string | null;
  agencia: string | null;
  agenciaDv: string | null;
  conta: string | null;
  contaDv: string | null;
  tipoConta: "corrente" | "poupanca" | "pagamento" | null;
  pixTipo: "cpf" | "cnpj" | "email" | "telefone" | "aleatoria" | null;
  pixChave: string | null;
}

export function aplicarForaDoCadastroNaRemessa<T extends MeiosDoDestinatario>(
  dados: T,
  fora: PagamentoForaDoCadastroDaPP,
): { dados: T; forma: "pix" | "banco" } {
  if (fora.meio === "boleto") {
    // Barrado antes, em `resolverOrigem`: chegar aqui é defeito.
    throw new Error("PP paga por boleto não entra na remessa.");
  }
  if (fora.meio === "pix") {
    return {
      forma: "pix",
      dados: {
        ...dados,
        pixTipo: fora.pix_tipo,
        pixChave: fora.pix_chave,
        bancoCodigo: null,
        agencia: null,
        agenciaDv: null,
        conta: null,
        contaDv: null,
        tipoConta: null,
      },
    };
  }
  return {
    forma: "banco",
    dados: {
      ...dados,
      pixTipo: null,
      pixChave: null,
      bancoCodigo: fora.banco_codigo,
      agencia: fora.agencia,
      agenciaDv: fora.agencia_dv,
      conta: fora.conta,
      contaDv: fora.conta_dv,
      tipoConta: fora.tipo_conta,
    },
  };
}
