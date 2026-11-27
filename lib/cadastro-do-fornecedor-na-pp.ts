/**
 * O que falta no cadastro do fornecedor para a PP sair (decisão 255,
 * 12/11/2026; amplia a trava da 166).
 *
 * A 166 travava a PP só pelo regime tributário e pelo CNAE, e só na pessoa
 * jurídica. A pessoa física passava sem nada, e a PJ passava sem e-mail,
 * telefone e conta — o cadastro rápido e o formulário exigem os três, mas
 * o cadastro antigo e a carga da planilha de fornecedores (12/11/2026) não
 * os têm. Agora, para a PP sair:
 *
 *   * e-mail e telefone, em qualquer PP, de pessoa física ou jurídica;
 *   * conta bancária ou PIX, SÓ quando o pagamento escolhido é "Cadastro do
 *     fornecedor" — chave aleatória, boleto e guia são o meio que vem com a
 *     própria PP e não precisam da conta (confirmado pelo Tiago);
 *   * regime e CNAE, como antes, só na pessoa jurídica.
 *
 * A mensagem e o lápis são os da 166: "Cadastro incompleto: falta …".
 *
 * Função pura. Testes: node --import tsx --test lib/cadastro-do-fornecedor-na-pp.test.ts
 */

import { listarPendencias, pendenciasDoCadastroFiscal } from "@/lib/fiscal/regime-do-fornecedor";

/** As colunas do cadastro que a trava lê. Decisão 283 (27/11/2026) acrescentou
 *  `cpf_cnpj` para a dica contextual da mensagem "cadastro incompleto"
 *  sugerir "escolha CNPJ como tipo da chave PIX" quando a PJ já tem documento
 *  válido. */
export const COLUNAS_DA_TRAVA_DA_PP =
  "nome, tipo_pessoa, regime_tributario, cnae, email, telefone, cpf_cnpj, banco_codigo, pix_tipo, pix_chave, sem_dados_pagamento";

export interface CadastroParaPP {
  tipo_pessoa: string;
  regime_tributario: string | null;
  cnae: string | null;
  email?: string | null;
  telefone?: string | null;
  cpf_cnpj?: string | null;
  banco_codigo?: string | null;
  pix_tipo?: string | null;
  pix_chave?: string | null;
  sem_dados_pagamento?: boolean | null;
}

const preenchido = (v: string | null | undefined) => Boolean(v && v.trim());

/** O cadastro tem conta (o banco garante a conta inteira quando há banco)
 *  ou PIX completo. */
export function temContaOuPix(f: CadastroParaPP): boolean {
  return preenchido(f.banco_codigo) || (preenchido(f.pix_tipo) && preenchido(f.pix_chave));
}

/**
 * O que falta, na ordem em que o formulário pede ([] = nada).
 *
 * `pagaPeloCadastro`: o pagamento da PP é o "Cadastro do fornecedor". O
 * cadastro marcado "Sem conta nem PIX" (decisão 161) não entra aqui: ele
 * nem deixa escolher o cadastro, e a PP já pede chave, boleto ou guia.
 */
export function pendenciasDoCadastroNaPP(
  f: CadastroParaPP | null | undefined,
  { pagaPeloCadastro }: { pagaPeloCadastro: boolean },
): string[] {
  if (!f) return [];
  const falta: string[] = [];
  if (!preenchido(f.email)) falta.push("o e-mail");
  if (!preenchido(f.telefone)) falta.push("o telefone");
  if (pagaPeloCadastro && f.sem_dados_pagamento !== true && !temContaOuPix(f)) {
    falta.push("a conta ou o PIX");
  }
  falta.push(...pendenciasDoCadastroFiscal(f));
  return falta;
}

/** Decisão 283 (27/11/2026): a PJ com CNPJ válido no cadastro e sem conta
 *  nem PIX ganha a dica "o CNPJ também é a chave PIX" na mensagem de
 *  "cadastro incompleto", porque esse foi o atalho que o form passou a
 *  oferecer e evita que a produção marque "Sem conta nem PIX" como
 *  bypass. Só rodada quando a lista de pendências contém "a conta ou o PIX". */
export function dicaCnpjEhPix(
  f: CadastroParaPP | null | undefined,
  pendencias: readonly string[],
): string | null {
  if (!f || f.tipo_pessoa !== "juridica") return null;
  if (!pendencias.includes("a conta ou o PIX")) return null;
  const digitos = String(f.cpf_cnpj ?? "").replace(/\D/g, "");
  if (digitos.length !== 14) return null;
  return "Se o fornecedor recebe por PIX no CNPJ, escolha “CNPJ” no tipo da chave — o sistema já preenche a chave com os dígitos.";
}

/** Monta a mensagem de "cadastro incompleto" do servidor, com a dica do
 *  CNPJ-vira-PIX quando ela se aplica. Centralizada para as duas chamadas
 *  (`gerarPPDaPPAEmitir` e o `finalizarPedidoCompraImpl`). */
export function mensagemCadastroIncompleto(
  f: (CadastroParaPP & { nome?: string | null }) | null | undefined,
  pendencias: readonly string[],
  ondeEditar: "lapis_edicao" | "lapis_fornecedor" | "peca_ao_financeiro",
): string {
  const nomeReal = f?.nome ?? "fornecedor";
  const cabecalho = `O cadastro de ${nomeReal} está incompleto: falta ${listarPendencias(pendencias)}.`;
  const ondeEditarMsg =
    ondeEditar === "lapis_edicao"
      ? "Clique em Editar e no lápis ao lado do fornecedor para completar."
      : ondeEditar === "lapis_fornecedor"
        ? "Clique no lápis ao lado do fornecedor para completar."
        : "Peça ao financeiro para completar o cadastro.";
  const dica = dicaCnpjEhPix(f, pendencias);
  return [cabecalho, ondeEditarMsg, dica].filter(Boolean).join(" ");
}
