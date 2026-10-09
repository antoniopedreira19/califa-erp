/**
 * A foto dos dados de pagamento que a PP tira no envio ao financeiro.
 *
 * Por que ela existe (decisão 067, 09/09/2026): o campo de fornecedor da
 * PP ganhou um lápis que abre o cadastro daquele fornecedor. Quem gera a
 * PP passou a poder trocar banco, agência, conta e PIX de alguém que JÁ
 * tem PP esperando pagamento. Se o financeiro pagasse lendo o cadastro ao
 * vivo, a PP passaria a apontar para uma conta que não era a combinada.
 *
 * A regra: **o financeiro paga pela foto**. O cadastro novo vale para as
 * próximas PPs, e a PP cujo cadastro mudou depois ganha um asterisco.
 *
 * Módulo comum, sem `"use server"`: ele é chamado do envio (server
 * action) e lido pelas telas, e em arquivo `"use server"` toda export
 * viraria Server Action.
 */

import type {
  MeioForaDoCadastro,
  PagamentoForaDoCadastroDaPP,
  PixTipoChave,
  TipoContaBancariaFornecedor,
} from "@/lib/types";
import { getBancoByCodigo } from "@/lib/dados/bancos-febraban";

/** Os nove campos de pagamento, do jeito que o cadastro os guarda. */
export interface DadosDePagamento {
  banco_codigo: string | null;
  banco_nome: string | null;
  agencia: string | null;
  agencia_dv: string | null;
  conta: string | null;
  conta_dv: string | null;
  tipo_conta: TipoContaBancariaFornecedor | null;
  pix_tipo: PixTipoChave | null;
  pix_chave: string | null;
}

/** Os mesmos nove campos, do jeito que a PP os guarda. */
export interface FotoDePagamentoDaPP {
  fornecedor_banco_codigo: string | null;
  fornecedor_banco_nome: string | null;
  fornecedor_agencia: string | null;
  fornecedor_agencia_dv: string | null;
  fornecedor_conta: string | null;
  fornecedor_conta_dv: string | null;
  fornecedor_tipo_conta: TipoContaBancariaFornecedor | null;
  fornecedor_pix_tipo: PixTipoChave | null;
  fornecedor_pix_chave: string | null;
}

/** As colunas a pedir num `select` de `fornecedores` para tirar a foto. */
export const COLUNAS_DE_PAGAMENTO =
  "banco_codigo, banco_nome, agencia, agencia_dv, conta, conta_dv, tipo_conta, pix_tipo, pix_chave";

// ---------------------------------------------------------------------------
// Pagamento fora do cadastro (decisão 127, 29/09/2026)
// ---------------------------------------------------------------------------

/**
 * O que a produção escolhe no formulário quando a PP não paga pelo
 * cadastro: UM meio. Desde a decisão 161, chave aleatória (`pix`) ou
 * `boleto`, sem motivo; `conta` e o motivo ficam para as PPs anteriores.
 * Já validado e normalizado por `pagamentoForaDoCadastroSchema`.
 */
export interface PagamentoForaDoCadastro {
  meio: MeioForaDoCadastro;
  motivo: string | null;
  pix_tipo: PixTipoChave | null;
  pix_chave: string | null;
  banco_codigo: string | null;
  agencia: string | null;
  agencia_dv: string | null;
  conta: string | null;
  conta_dv: string | null;
  tipo_conta: TipoContaBancariaFornecedor | null;
}

/** Os campos de cada meio — o que "trocar o meio" troca, e mais nada. No
 *  boleto (decisão 161) nada do cadastro é pagamento: todos ficam de fora
 *  da conta do asterisco. */
const CAMPOS_DO_MEIO: Record<MeioForaDoCadastro, Array<keyof DadosDePagamento>> = {
  pix: ["pix_tipo", "pix_chave"],
  conta: ["banco_codigo", "banco_nome", "agencia", "agencia_dv", "conta", "conta_dv", "tipo_conta"],
  boleto: [
    "banco_codigo", "banco_nome", "agencia", "agencia_dv", "conta", "conta_dv", "tipo_conta",
    "pix_tipo", "pix_chave",
  ],
};

/**
 * O cadastro com só o meio escolhido trocado.
 *
 * Regra do Tiago (29/09/2026): "o documento em si deverá permanecer igual,
 * apenas com a chave escolhida". Por isso o outro meio continua o do
 * cadastro — outro PIX mantém a conta; outra conta mantém a chave — e o
 * PDF sai com o mesmo desenho de sempre.
 */
export function aplicarPagamentoForaDoCadastro(
  cadastro: DadosDePagamento | null | undefined,
  fora: PagamentoForaDoCadastro | null | undefined,
): DadosDePagamento {
  const base: DadosDePagamento = {
    banco_codigo: cadastro?.banco_codigo ?? null,
    banco_nome: cadastro?.banco_nome ?? null,
    agencia: cadastro?.agencia ?? null,
    agencia_dv: cadastro?.agencia_dv ?? null,
    conta: cadastro?.conta ?? null,
    conta_dv: cadastro?.conta_dv ?? null,
    tipo_conta: cadastro?.tipo_conta ?? null,
    pix_tipo: cadastro?.pix_tipo ?? null,
    pix_chave: cadastro?.pix_chave ?? null,
  };
  // Boleto (decisão 161): o documento continua o de sempre, com o cadastro
  // como está; o PDF só troca a linha do PIX por "Boleto".
  if (!fora || fora.meio === "boleto") return base;
  if (fora.meio === "pix") {
    return { ...base, pix_tipo: fora.pix_tipo, pix_chave: fora.pix_chave };
  }
  return {
    ...base,
    banco_codigo: fora.banco_codigo,
    banco_nome: fora.banco_codigo ? (getBancoByCodigo(fora.banco_codigo)?.nome ?? null) : null,
    agencia: fora.agencia,
    agencia_dv: fora.agencia_dv,
    conta: fora.conta,
    conta_dv: fora.conta_dv,
    tipo_conta: fora.tipo_conta,
  };
}

/**
 * As colunas de `pedidos_compra` que dizem se a PP paga fora do cadastro.
 * Toda gravação que re-tira a foto grava estas também — inclusive para
 * zerar, quando a PP volta a pagar pelo cadastro. A marcação da aprovação
 * sempre zera: a PP que foi editada ou reenviada é aprovada de novo.
 */
export function camposDoPagamentoForaDoCadastro(
  fora: PagamentoForaDoCadastro | null | undefined,
) {
  return {
    pagamento_fora_do_cadastro_meio: fora?.meio ?? null,
    pagamento_fora_do_cadastro_motivo: fora?.motivo ?? null,
    pagamento_fora_do_cadastro_aprovado_por: null,
    pagamento_fora_do_cadastro_aprovado_em: null,
  };
}

/**
 * Da PP gravada para a tela: o meio, o motivo (opcional desde a decisão
 * 161) e SÓ os dados do meio trocado — o que o dossiê, a ficha e o
 * formulário de edição mostram. No boleto não há dado nenhum. Null = a PP
 * paga pelo cadastro.
 */
export function lerPagamentoForaDoCadastro(
  pp: Partial<FotoDePagamentoDaPP> & {
    pagamento_fora_do_cadastro_meio?: string | null;
    pagamento_fora_do_cadastro_motivo?: string | null;
  },
): PagamentoForaDoCadastroDaPP | null {
  const meio = pp.pagamento_fora_do_cadastro_meio;
  if (meio !== "pix" && meio !== "conta" && meio !== "boleto") return null;
  const pix = meio === "pix";
  const conta = meio === "conta";
  return {
    meio,
    motivo: pp.pagamento_fora_do_cadastro_motivo?.trim() || null,
    pix_tipo: pix ? (pp.fornecedor_pix_tipo ?? null) : null,
    pix_chave: pix ? (pp.fornecedor_pix_chave ?? null) : null,
    banco_codigo: conta ? (pp.fornecedor_banco_codigo ?? null) : null,
    banco_nome: conta ? (pp.fornecedor_banco_nome ?? null) : null,
    agencia: conta ? (pp.fornecedor_agencia ?? null) : null,
    agencia_dv: conta ? (pp.fornecedor_agencia_dv ?? null) : null,
    conta: conta ? (pp.fornecedor_conta ?? null) : null,
    conta_dv: conta ? (pp.fornecedor_conta_dv ?? null) : null,
    tipo_conta: conta ? (pp.fornecedor_tipo_conta ?? null) : null,
  };
}

/** Cadastro → foto: o que o envio grava na PP. Com `fora`, o meio
 *  escolhido entra no lugar do cadastro (decisão 127). */
export function tirarFoto(
  cadastro: DadosDePagamento | null | undefined,
  fora?: PagamentoForaDoCadastro | null,
): FotoDePagamentoDaPP {
  if (fora) cadastro = aplicarPagamentoForaDoCadastro(cadastro, fora);
  return {
    fornecedor_banco_codigo: cadastro?.banco_codigo ?? null,
    fornecedor_banco_nome: cadastro?.banco_nome ?? null,
    fornecedor_agencia: cadastro?.agencia ?? null,
    fornecedor_agencia_dv: cadastro?.agencia_dv ?? null,
    fornecedor_conta: cadastro?.conta ?? null,
    fornecedor_conta_dv: cadastro?.conta_dv ?? null,
    fornecedor_tipo_conta: cadastro?.tipo_conta ?? null,
    fornecedor_pix_tipo: cadastro?.pix_tipo ?? null,
    fornecedor_pix_chave: cadastro?.pix_chave ?? null,
  };
}

/** Foto → cadastro: o formato que as telas de pagamento já sabem ler.
 *  Exportada porque é por aqui que uma tela do financeiro vai ler a foto
 *  quando ela deixar de pagar só pelo PDF — ver a decisão 067. */
export function lerFoto(foto: FotoDePagamentoDaPP): DadosDePagamento {
  return {
    banco_codigo: foto.fornecedor_banco_codigo,
    banco_nome: foto.fornecedor_banco_nome,
    agencia: foto.fornecedor_agencia,
    agencia_dv: foto.fornecedor_agencia_dv,
    conta: foto.fornecedor_conta,
    conta_dv: foto.fornecedor_conta_dv,
    tipo_conta: foto.fornecedor_tipo_conta,
    pix_tipo: foto.fornecedor_pix_tipo,
    pix_chave: foto.fornecedor_pix_chave,
  };
}

/**
 * Os status em que a foto está de fato CONGELADA.
 *
 * `gerada` e `rejeitada` ficam de fora de propósito: as duas ainda são do
 * produtor, e editar ou reenviar re-monta o PDF e re-tira a foto — marcar
 * essas com asterisco seria avisar de um descompasso que o próximo salvar
 * desfaz sozinho. `cancelada` também: ninguém vai pagar por ela.
 */
const STATUS_COM_FOTO_CONGELADA = ["em_avaliacao", "aprovada", "pago"];

/**
 * O asterisco: o cadastro mudou DEPOIS que esta PP tirou a foto?
 *
 * Compara campo a campo em vez de olhar um `updated_at`, por dois
 * motivos: o `updated_at` do fornecedor sobe quando alguém troca o
 * telefone, que não muda para onde o dinheiro vai; e mudar e voltar atrás
 * deixaria a marca acesa sem nada divergente para mostrar.
 *
 * Sem foto não há o que comparar — a PP ainda paga pelo cadastro atual.
 * E só marca PP com a foto congelada (ver `STATUS_COM_FOTO_CONGELADA`).
 */
export function cadastroMudouDepoisDaFoto(
  pp: Partial<FotoDePagamentoDaPP> & {
    dados_pagamento_congelados_em?: string | null;
    status?: string;
    pagamento_fora_do_cadastro_meio?: string | null;
  },
  cadastro: DadosDePagamento | null | undefined,
): boolean {
  if (!pp.dados_pagamento_congelados_em || !cadastro) return false;
  if (pp.status && !STATUS_COM_FOTO_CONGELADA.includes(pp.status)) return false;
  const foto = lerFoto(pp as FotoDePagamentoDaPP);
  // O meio trocado nesta PP (decisão 127) não veio do cadastro: compará-lo
  // acenderia o asterisco em toda PP fora do cadastro. Só o meio que ainda
  // é do cadastro entra na conta.
  const meio = pp.pagamento_fora_do_cadastro_meio;
  const ignorados =
    meio === "pix" || meio === "conta" || meio === "boleto" ? CAMPOS_DO_MEIO[meio] : [];
  return (Object.keys(foto) as Array<keyof DadosDePagamento>)
    .filter((campo) => !ignorados.includes(campo))
    .some((campo) => (foto[campo] ?? null) !== (cadastro[campo] ?? null));
}

/**
 * O cadastro numa linha, para o formulário da PP mostrar o que vale quando
 * nada é trocado: o PIX quando existe (é o que a remessa usa por padrão),
 * senão a conta. Montado no servidor — o dado bancário não atravessa
 * inteiro para o cliente.
 */
export function resumoDoCadastroDePagamento(cadastro: DadosDePagamento | null): string | null {
  if (!cadastro) return null;
  if (cadastro.pix_tipo && cadastro.pix_chave) {
    return `PIX ${ROTULO_PIX_CURTO[cadastro.pix_tipo]} · ${chavePixLegivel(cadastro.pix_tipo, cadastro.pix_chave)}`;
  }
  if (cadastro.banco_codigo) {
    const conta = `${cadastro.conta ?? ""}${cadastro.conta_dv ? `-${cadastro.conta_dv}` : ""}`;
    const agencia = `${cadastro.agencia ?? ""}${cadastro.agencia_dv ? `-${cadastro.agencia_dv}` : ""}`;
    return `${nomeCurtoDoBanco(cadastro.banco_codigo, cadastro.banco_nome)} · Ag. ${agencia} · CC ${conta}`;
  }
  return null;
}

const ROTULO_PIX_CURTO: Record<PixTipoChave, string> = {
  cnpj: "CNPJ",
  cpf: "CPF",
  email: "e-mail",
  telefone: "telefone",
  aleatoria: "aleatória",
};

/** CPF/CNPJ com máscara, telefone sem o +55; e-mail e EVP como estão. */
export function chavePixLegivel(tipo: PixTipoChave | null, chave: string | null): string {
  if (!tipo || !chave) return "";
  const d = chave.replace(/\D/g, "");
  if (tipo === "cpf" && d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  if (tipo === "cnpj" && d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  if (tipo === "telefone") {
    const t = d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
    return t.length === 11 ? `(${t.slice(0, 2)}) ${t.slice(2, 7)}-${t.slice(7)}` : chave;
  }
  return chave;
}

/** "ITAÚ UNIBANCO S.A." → "ITAÚ UNIBANCO"; "NU PAGAMENTOS S.A. - IP" → "NU PAGAMENTOS". */
export function nomeCurtoDoBanco(codigo: string, nome?: string | null): string {
  const completo = nome ?? getBancoByCodigo(codigo)?.nome ?? codigo;
  return completo
    .split(" - ")[0]
    .replace(/\s*\(.*?\)/g, "")
    .replace(/\s+S\.?\s?A\.?$/i, "")
    .trim();
}
