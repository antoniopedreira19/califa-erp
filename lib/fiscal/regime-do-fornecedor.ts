/**
 * O regime tributário do fornecedor pessoa jurídica, no cadastro (módulo
 * fiscal, entrega 1 — 02/10/2026).
 *
 * Normal (Lucro Real ou Presumido), Simples Nacional ou MEI: preenchido
 * pela consulta do CNPJ que o cadastro novo já faz na BrasilAPI (os campos
 * de opção pelo Simples e pelo MEI) e editável. É o regime que diz, na
 * aprovação da PP, se há retenção na fonte.
 *
 * `regime_consultado_em` guarda o dia da consulta do CNPJ que deu o regime
 * gravado — e só enquanto o regime gravado é o que ela indicou. Trocado à
 * mão, a data não vai junto: o cadastro não diz "preenchido pela consulta"
 * de um regime que alguém escolheu. (O banco não guarda o regime que a
 * consulta indicou; o aviso âmbar de "alterado manualmente" vale enquanto o
 * formulário está aberto.)
 *
 * Funções puras. Testes:
 * node --import tsx --test lib/fiscal/regime-do-fornecedor.test.ts
 */

import type { RegimeTributarioFornecedor } from "@/lib/types";
import { onlyDigits } from "@/lib/utils";
import { dataBr } from "./datas";

/** Na ordem da lista do cadastro. */
export const REGIMES_DO_FORNECEDOR: readonly RegimeTributarioFornecedor[] = [
  "normal",
  "simples",
  "mei",
];

export const ROTULO_DO_REGIME: Record<RegimeTributarioFornecedor, string> = {
  normal: "Normal (Lucro Real ou Presumido)",
  simples: "Simples Nacional",
  mei: "MEI",
};

/** O que cada regime faz com as retenções e o crédito, na aprovação da PP. */
export const NOTA_DO_REGIME: Record<RegimeTributarioFornecedor, string> = {
  simples:
    "Sem retenção de PIS/COFINS/CSLL e IRRF, com a declaração. O ISS pode ser retido com a alíquota informada na nota. A compra dá crédito de PIS/COFINS normalmente.",
  mei: "Sem retenção nenhuma. A compra dá crédito de PIS/COFINS normalmente.",
  normal:
    "As retenções dependem do serviço contratado e são informadas na aprovação da PP.",
};

/** O que a consulta do CNPJ disse do regime, e de qual CNPJ. */
export interface ConsultaDoRegime {
  /** Os 14 dígitos do CNPJ consultado. */
  cnpj: string;
  /** O dia da consulta ("AAAA-MM-DD"). */
  em: string;
  regime: RegimeTributarioFornecedor;
}

/**
 * O regime pela resposta da BrasilAPI (`/api/cnpj/v1/{cnpj}`): MEI primeiro
 * — todo MEI também é optante do Simples —, depois o Simples; sem opção
 * (falso, ou nulo como na empresa que nunca optou), normal. `null` quando a
 * resposta não traz os campos de opção: aí não se deduz nada.
 */
export function regimeDaConsultaDoCnpj(resposta: unknown): RegimeTributarioFornecedor | null {
  if (!resposta || typeof resposta !== "object") return null;
  const r = resposta as Record<string, unknown>;
  if (!("opcao_pelo_simples" in r) && !("opcao_pelo_mei" in r)) return null;
  if (r.opcao_pelo_mei === true) return "mei";
  if (r.opcao_pelo_simples === true) return "simples";
  return "normal";
}

/**
 * O regime depois de uma consulta nova: entra no campo vazio e no lugar do
 * que veio de uma consulta anterior (o CNPJ foi corrigido); o que alguém
 * escolheu à mão fica — e o aviso âmbar diz o que a consulta indicou.
 */
export function regimeDepoisDaConsulta(
  atual: RegimeTributarioFornecedor | null,
  consultaAnterior: ConsultaDoRegime | null,
  daConsulta: RegimeTributarioFornecedor,
): RegimeTributarioFornecedor {
  if (atual === null) return daConsulta;
  if (consultaAnterior && atual === consultaAnterior.regime) return daConsulta;
  return atual;
}

/** A consulta só vale para o CNPJ que foi consultado. */
function consultaDoCnpj(consulta: ConsultaDoRegime | null, cnpj: string): ConsultaDoRegime | null {
  return consulta && consulta.cnpj === onlyDigits(cnpj) ? consulta : null;
}

/**
 * O texto embaixo do campo: de onde veio o regime à vista. `null` = nada a
 * dizer (sem regime, ou escolhido sem consulta deste CNPJ).
 */
export function origemDoRegime(
  regime: RegimeTributarioFornecedor | null,
  consulta: ConsultaDoRegime | null,
  cnpj: string,
): { texto: string; alterado: boolean } | null {
  const c = consultaDoCnpj(consulta, cnpj);
  if (!regime || !c) return null;
  if (regime !== c.regime) {
    const indicou = c.regime === "normal" ? "regime normal" : ROTULO_DO_REGIME[c.regime];
    return {
      texto: `Alterado manualmente — a consulta do CNPJ em ${dataBr(c.em)} indicou ${indicou}.`,
      alterado: true,
    };
  }
  return { texto: `Preenchido pela consulta do CNPJ em ${dataBr(c.em)}`, alterado: false };
}

/** O `regime_consultado_em` a gravar: o dia da consulta, só quando o regime
 *  gravado é o que ela indicou para este CNPJ. */
export function regimeConsultadoEmParaGravar(
  regime: RegimeTributarioFornecedor | null,
  consulta: ConsultaDoRegime | null,
  cnpj: string,
): string | null {
  const c = consultaDoCnpj(consulta, cnpj);
  return regime && c && c.regime === regime ? c.em : null;
}

/** A consulta que um cadastro gravado carrega: a edição abre com ela. */
export function consultaDoCadastro(
  f:
    | {
        cpf_cnpj: string | null;
        regime_tributario: RegimeTributarioFornecedor | null;
        regime_consultado_em: string | null;
      }
    | null
    | undefined,
): ConsultaDoRegime | null {
  if (!f?.cpf_cnpj || !f.regime_tributario || !f.regime_consultado_em) return null;
  return {
    cnpj: onlyDigits(f.cpf_cnpj),
    em: f.regime_consultado_em.slice(0, 10),
    regime: f.regime_tributario,
  };
}
