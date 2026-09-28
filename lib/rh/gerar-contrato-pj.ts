/**
 * Gera o PDF do contrato de prestação de serviços PJ a partir dos
 * dados da contratação. Task 007, subtask 6.
 *
 * Usa @react-pdf/renderer — roda nativamente em Vercel serverless
 * (sem Chromium/binário), sub-segundo pra contrato de 6 páginas.
 *
 * O texto do contrato segue o modelo California 2025 (versão MEI, no
 * repo). A variação por natureza jurídica (MEI/ME/LTDA/EIRELI/SLU)
 * acontece no bloco de qualificação — ver `naturezas-pj.ts`.
 */

import { renderToBuffer } from "@react-pdf/renderer";
import extenso from "extenso";
import type { Contratacao, PjNatureza } from "@/lib/types";
import { NATUREZA_PJ_TEXTO_CONTRATO } from "./naturezas-pj";
import { ContratoPJDocument } from "@/app/(app)/rh/contratacoes/_template/contrato-pj";

export type DadosContratoPJ = {
  nome: string;
  rg: string;
  cpf: string;
  cnpj: string;
  razao_social: string;
  natureza_pj_texto: string;
  cargo: string;
  salario_extenso: string;
  salario_formatado: string;
  data_admissao_formatada: string;
  endereco: string;
  banco_codigo: string;
  agencia: string;
  conta: string;
};

function formatarCpf(v: string): string {
  return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
}

function formatarCnpj(v: string): string {
  return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
}

function formatarCep(v: string | null): string {
  if (!v || v.length !== 8) return v ?? "";
  return `${v.slice(0, 5)}-${v.slice(5)}`;
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

function formatarBRL(valor: string | number): string {
  const n = typeof valor === "string" ? Number(valor) : valor;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(n);
}

function valorPorExtenso(valor: string | number): string {
  const n = typeof valor === "string" ? Number(valor) : valor;
  try {
    return extenso(n.toFixed(2), { mode: "currency" });
  } catch {
    return "";
  }
}

function montarEndereco(c: Contratacao): string {
  const partes = [
    c.logradouro && `${c.logradouro}${c.numero ? `, ${c.numero}` : ""}`,
    c.complemento,
    c.bairro,
    c.cidade && c.uf ? `${c.cidade}/${c.uf}` : c.cidade ?? c.uf,
    c.cep ? `CEP ${formatarCep(c.cep)}` : null,
  ].filter(Boolean);
  return partes.join(" - ");
}

function montarBloco(pj_natureza: PjNatureza | null): string {
  if (!pj_natureza) return "";
  return NATUREZA_PJ_TEXTO_CONTRATO[pj_natureza];
}

function montarBanco(c: Contratacao): {
  banco_codigo: string;
  agencia: string;
  conta: string;
} {
  return {
    banco_codigo:
      (c.banco_codigo ?? "") + (c.banco_nome ? ` — ${c.banco_nome}` : ""),
    agencia:
      (c.agencia ?? "") + (c.agencia_dv ? `-${c.agencia_dv}` : ""),
    conta:
      (c.conta ?? "") + (c.conta_dv ? `-${c.conta_dv}` : ""),
  };
}

/**
 * Recebe uma contratação (com todos os campos coletados) e devolve o
 * PDF como Buffer. Lança se dados essenciais faltam.
 */
export async function gerarContratoPJ(
  contratacao: Contratacao,
): Promise<Buffer> {
  if (!contratacao.cpf || !contratacao.cnpj || !contratacao.rg) {
    throw new Error("Faltam CPF, CNPJ ou RG para gerar o contrato.");
  }
  if (!contratacao.razao_social || !contratacao.pj_natureza) {
    throw new Error("Faltam razão social ou natureza PJ.");
  }

  const banco = montarBanco(contratacao);
  const dados: DadosContratoPJ = {
    nome: contratacao.nome,
    rg: contratacao.rg,
    cpf: formatarCpf(contratacao.cpf),
    cnpj: formatarCnpj(contratacao.cnpj),
    razao_social: contratacao.razao_social,
    natureza_pj_texto: montarBloco(contratacao.pj_natureza),
    cargo: contratacao.cargo,
    salario_extenso: valorPorExtenso(contratacao.salario_proposto),
    salario_formatado: formatarBRL(contratacao.salario_proposto),
    data_admissao_formatada: formatarData(contratacao.data_admissao),
    endereco: montarEndereco(contratacao),
    banco_codigo: banco.banco_codigo,
    agencia: banco.agencia,
    conta: banco.conta,
  };

  const buffer = await renderToBuffer(ContratoPJDocument({ dados }) as any);
  return buffer as unknown as Buffer;
}
