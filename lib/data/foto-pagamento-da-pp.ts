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

import type { PixTipoChave, TipoContaBancariaFornecedor } from "@/lib/types";

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

/** Cadastro → foto: o que o envio grava na PP. */
export function tirarFoto(
  cadastro: DadosDePagamento | null | undefined,
): FotoDePagamentoDaPP {
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
  },
  cadastro: DadosDePagamento | null | undefined,
): boolean {
  if (!pp.dados_pagamento_congelados_em || !cadastro) return false;
  if (pp.status && !STATUS_COM_FOTO_CONGELADA.includes(pp.status)) return false;
  const foto = lerFoto(pp as FotoDePagamentoDaPP);
  return (Object.keys(foto) as Array<keyof DadosDePagamento>).some(
    (campo) => (foto[campo] ?? null) !== (cadastro[campo] ?? null),
  );
}
