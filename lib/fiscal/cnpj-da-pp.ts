/**
 * O CNPJ da PP (decisão 156, 07/10/2026) — separado da empresa gerencial.
 *
 * A empresa gerencial da PP é a do job (RLS, relatórios, fluxo de caixa). O
 * CNPJ é outra coisa: é quem contrata e paga. Sai no cabeçalho do PDF (diz ao
 * fornecedor contra qual CNPJ emitir a nota), é o tomador esperado da NF e o
 * CNPJ da conta que paga. Os dois não se correspondem: a regional SS da
 * Agência California costuma sair pela GoCrazy, e o CNPJ da California pode
 * arcar com custo da Hitlab gerencial.
 *
 * Revisão de 16/10/2026 — a tomadora é a emissora: a PP é documento interno
 * (por enquanto), e a empresa emissora é quem paga, o CNPJ que está no
 * documento do fornecedor. Com nota, fatura ou recibo que diga o CNPJ, a
 * empresa emissora segue o documento; sem ele, vale a pré-seleção abaixo
 * (ou a escolha do formulário).
 */

import { DOCUMENTO_TIPOS_FISCAIS, type DocumentoTipo } from "@/lib/types";

/** Os documentos que dizem contra qual CNPJ foram emitidos: NF (tomador),
 *  fatura (sacado) e recibo (pagador). */
export function documentoTemCnpj(tipo: DocumentoTipo | null | undefined): boolean {
  return !!tipo && DOCUMENTO_TIPOS_FISCAIS.includes(tipo);
}

export type EmissoraDosDocumentos =
  /** Nenhum documento com CNPJ: vale a escolha do formulário. */
  | { tipo: "nenhum" }
  /** Todos os documentos no mesmo CNPJ: a empresa emissora é ele. */
  | { tipo: "documento"; estabelecimentoId: string }
  /** Documentos em CNPJs diferentes: uma PP é paga por um CNPJ só. */
  | { tipo: "divergente"; estabelecimentos: string[] };

export const DOCUMENTOS_EM_CNPJS_DIFERENTES =
  "Os documentos desta PP estão em CNPJs diferentes. Uma PP é paga por um CNPJ só: corrija o CNPJ do documento ou separe em duas PPs.";

/** A empresa emissora que os documentos da PP definem (revisão da 156). */
export function emissoraDosDocumentos(
  anexos: ReadonlyArray<{ documento_tipo: DocumentoTipo | null; nf_tomador_estabelecimento_id: string | null }>,
): EmissoraDosDocumentos {
  const cnpjs = [
    ...new Set(
      anexos
        .filter((a) => documentoTemCnpj(a.documento_tipo) && a.nf_tomador_estabelecimento_id)
        .map((a) => a.nf_tomador_estabelecimento_id as string),
    ),
  ];
  if (cnpjs.length === 0) return { tipo: "nenhum" };
  if (cnpjs.length === 1) return { tipo: "documento", estabelecimentoId: cnpjs[0] };
  return { tipo: "divergente", estabelecimentos: cnpjs };
}

/** O CNPJ que o formulário já traz escolhido para o job: o da regional
 *  (`fiscal_cnpj_da_pp_por_regional`, SS → GoCrazy); senão, o da empresa
 *  gerencial do job (Hitlab → Hitlab, Agência California → California, via
 *  `tomadoresPadrao`); senão, o da empresa principal. Só vale CNPJ ativo.
 *  Sempre se pode trocar na PP. */
export function cnpjPadraoDaPP(
  job: { regional_id: string | null; empresa_id: string | null },
  regras: {
    porRegional: Readonly<Record<string, string>>;
    porEmpresa: Readonly<Record<string, string>>;
    geral: string | null;
    /** Os ids dos CNPJs ativos (com CNPJ preenchido). */
    ativos: ReadonlySet<string>;
  },
): string | null {
  const candidatos = [
    job.regional_id ? regras.porRegional[job.regional_id] : undefined,
    job.empresa_id ? regras.porEmpresa[job.empresa_id] : undefined,
    regras.geral ?? undefined,
  ];
  for (const id of candidatos) if (id && regras.ativos.has(id)) return id;
  return null;
}

/** O CNPJ do cadastro de impostos com os dados do cabeçalho do PDF. */
export interface CnpjDoDocumento {
  nome: string;
  cnpj: string | null;
  municipio: string | null;
  uf: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  telefone: string | null;
  email: string | null;
  inscricao_estadual: string | null;
  inscricao_municipal: string | null;
}

/** O que o PDF da PP lê como "empresa" (o mesmo formato de `empresas`): a
 *  razão social é a da empresa contábil dona do CNPJ. */
export function empresaDoDocumento(cnpj: CnpjDoDocumento, razaoSocial: string | null) {
  return {
    razao_social: razaoSocial?.trim() || cnpj.nome,
    cnpj: cnpj.cnpj,
    logradouro: cnpj.logradouro,
    numero: cnpj.numero,
    complemento: cnpj.complemento,
    bairro: cnpj.bairro,
    cep: cnpj.cep,
    cidade: cnpj.municipio,
    uf: cnpj.uf,
    telefone: cnpj.telefone,
    email: cnpj.email,
    inscricao_estadual: cnpj.inscricao_estadual,
    inscricao_municipal: cnpj.inscricao_municipal,
    local_pagamento: null,
  };
}
