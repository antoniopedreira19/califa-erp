/**
 * O que o financeiro enxerga do colaborador para pagar (decisão 132).
 *
 * A RLS de `colaboradores` é só de administrador e RH. Quem tem o papel
 * financeiro lê pelo RPC `colaboradores_pagamento`, que devolve apenas nome,
 * contratação, documentos e dados de pagamento — e lista vazia para quem não
 * é administrador, RH ou financeiro. Toda tela e action do financeiro que
 * precisa do colaborador (aba Folhas de Pagamento, aprovação da folha,
 * diálogo e geração da remessa) passa por aqui, em vez de ler a tabela.
 */

import type { createClient } from "@/lib/supabase/server";
import type { TipoContratacao } from "@/lib/types";
import { chavePixParaExibir, type PixTipo } from "@/lib/pix";
import { formatCnpj, formatCpf } from "@/lib/utils";

export type TipoContaBancaria = "corrente" | "poupanca" | "pagamento";

export interface ColaboradorPagamento {
  id: string;
  nome: string;
  funcao: string;
  tipo_contratacao: TipoContratacao;
  status: "ativo" | "inativo";
  cpf: string | null;
  cnpj: string | null;
  razao_social: string | null;
  pix_tipo: PixTipo | null;
  pix_chave: string | null;
  banco_codigo: string | null;
  banco_nome: string | null;
  agencia: string | null;
  agencia_dv: string | null;
  conta: string | null;
  conta_dv: string | null;
  tipo_conta: TipoContaBancaria | null;
}

/**
 * Carrega os colaboradores do tenant pelo RPC. Com `ids`, só esses. Erro vira
 * mapa vazio com log: a tela mostra "—" em vez de cair, como já fazia com o
 * embed nulo.
 */
export async function carregarColaboradoresPagamento(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  ids?: string[],
): Promise<Map<string, ColaboradorPagamento>> {
  const mapa = new Map<string, ColaboradorPagamento>();
  if (ids && ids.length === 0) return mapa;
  const { data, error } = await supabase.rpc("colaboradores_pagamento", {
    p_tenant_id: tenantId,
    p_ids: ids ?? null,
  });
  if (error) {
    console.error("[colaboradores_pagamento]", error.message);
    return mapa;
  }
  for (const c of (data ?? []) as ColaboradorPagamento[]) mapa.set(c.id, c);
  return mapa;
}

/** Tem chave PIX gravada (o formato já foi barrado na gravação). */
export function temPix(c: Pick<ColaboradorPagamento, "pix_tipo" | "pix_chave">): boolean {
  return !!(c.pix_tipo && c.pix_chave);
}

/** Conta completa: é o mínimo que a remessa exige para TED ou crédito em conta. */
export function temConta(
  c: Pick<ColaboradorPagamento, "banco_codigo" | "agencia" | "conta" | "conta_dv">,
): boolean {
  return !!(c.banco_codigo && c.agencia && c.conta && c.conta_dv);
}

const ROTULO_PIX: Record<PixTipo, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  telefone: "Telefone",
  aleatoria: "Aleatória",
};

/** "CPF 123.456.789-00", "Telefone 11999999999", "E-mail a@b.com". */
export function descreverPix(
  c: Pick<ColaboradorPagamento, "pix_tipo" | "pix_chave">,
): string {
  if (!c.pix_tipo || !c.pix_chave) return "";
  const chave =
    c.pix_tipo === "cpf"
      ? formatCpf(c.pix_chave)
      : c.pix_tipo === "cnpj"
        ? formatCnpj(c.pix_chave)
        : chavePixParaExibir(c.pix_tipo, c.pix_chave);
  return `${ROTULO_PIX[c.pix_tipo]} ${chave}`;
}

/** "260 · ag. 0001 · cc 12345-6" */
export function descreverConta(
  c: Pick<ColaboradorPagamento, "banco_codigo" | "agencia" | "agencia_dv" | "conta" | "conta_dv">,
): string {
  if (!temConta(c)) return "";
  const ag = c.agencia_dv ? `${c.agencia}-${c.agencia_dv}` : c.agencia;
  return `${c.banco_codigo} · ag. ${ag} · cc ${c.conta}-${c.conta_dv}`;
}

/**
 * Como a remessa vai pagar, na ordem do gerador: PIX quando há chave; senão
 * a conta (TED, ou crédito em conta no próprio Santander).
 */
export function formaDePagamento(
  c: ColaboradorPagamento,
): "pix" | "conta" | null {
  if (temPix(c)) return "pix";
  if (temConta(c)) return "conta";
  return null;
}
