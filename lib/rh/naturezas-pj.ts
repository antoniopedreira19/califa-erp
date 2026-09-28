/**
 * Textos jurídicos por natureza de PJ, usados no contrato de prestação
 * de serviços gerado em `_template/contrato-pj.tsx` (task 007).
 *
 * Cada texto entra no bloco de qualificação do CONTRATADO(A):
 *   "neste ato como representante da [RAZÃO SOCIAL], {texto} {CNPJ}"
 *
 * Concordância mantida no feminino porque casa com o substantivo que
 * vem imediatamente antes ("microempresa", "sociedade", "empresa").
 *
 * Contexto histórico:
 *   - EIRELI foi extinta pela Lei 14.195/2021 (todas as EIRELI viraram
 *     SLU automaticamente). Mantemos aqui porque ainda há muitos CNPJs
 *     em vigor pré-conversão, e a Receita ainda reconhece.
 *   - ME é enquadramento fiscal (LC 123/2006), não tipo societário.
 *     Deixamos como opção por conveniência do RH.
 */

import type { PjNatureza } from "@/lib/types";

/** Rótulo curto pra dropdown/tabela. */
export const NATUREZA_PJ_LABEL: Record<PjNatureza, string> = {
  mei: "MEI",
  me: "ME",
  ltda: "LTDA",
  eireli: "EIRELI",
  slu: "SLU",
};

/** Rótulo longo pra tela de detalhe. */
export const NATUREZA_PJ_LABEL_LONGO: Record<PjNatureza, string> = {
  mei: "Microempreendedor Individual",
  me: "Microempresa",
  ltda: "Sociedade Empresária Limitada",
  eireli: "Empresa Individual de Responsabilidade Limitada",
  slu: "Sociedade Limitada Unipessoal",
};

/**
 * Texto do bloco de qualificação no contrato. Encaixa depois de
 * "neste ato como representante da [RAZÃO SOCIAL]," — o CNPJ vem
 * separado pra permitir formatação com máscara pelo gerador.
 */
export const NATUREZA_PJ_TEXTO_CONTRATO: Record<PjNatureza, string> = {
  mei: "MEI – Microempreendedor Individual inscrita no CNPJ sob o nº",
  me: "microempresa inscrita no CNPJ sob o nº",
  ltda: "sociedade empresária limitada, inscrita no CNPJ sob o nº",
  eireli:
    "EIRELI – Empresa Individual de Responsabilidade Limitada, inscrita no CNPJ sob o nº",
  slu: "sociedade limitada unipessoal, inscrita no CNPJ sob o nº",
};
