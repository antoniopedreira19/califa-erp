/**
 * O regime tributário do fornecedor pessoa jurídica, no cadastro (módulo
 * fiscal, entrega 1 — 02/10/2026; consulta guardada e arquivo da declaração
 * na decisão 142).
 *
 * Lucro Real ou Presumido (o valor `normal`), Simples Nacional ou MEI: preenchido
 * pela consulta do CNPJ que o cadastro novo já faz na BrasilAPI (os campos
 * de opção pelo Simples e pelo MEI) e editável. É o regime que diz, na
 * aprovação da PP, se há retenção na fonte.
 *
 * A consulta do CNPJ fica guardada inteira, valha ou não o regime gravado:
 * `regime_consulta` (o que ela indicou), `regime_desde` (a data de opção
 * pelo Simples ou pelo MEI que ela trouxe) e `regime_consultado_em` (o dia).
 * É o que deixa o texto embaixo do campo — "Preenchido pela consulta do
 * CNPJ em … · optante do Simples desde …" ou, em âmbar, "Alterado
 * manualmente — a consulta do CNPJ em … indicou …" — valer também ao
 * reabrir o cadastro. A consulta só vale para o CNPJ consultado: trocado o
 * CNPJ, ela não vai ao banco.
 *
 * No Simples, o arquivo da declaração de optante (IN SRF 459, anexo I) vai
 * para o bucket privado `fornecedores`, em `<tenant>/declaracoes/`.
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

/** Sem "Normal" na frente desde 07/10/2026 (Tiago): "regime normal" é
 *  jargão contábil e não diz nada a quem cadastra. O valor gravado continua
 *  `normal`. */
export const ROTULO_DO_REGIME: Record<RegimeTributarioFornecedor, string> = {
  normal: "Lucro Real ou Presumido",
  simples: "Simples Nacional",
  mei: "MEI",
};

/** O que cada regime faz com as retenções e o crédito, na aprovação da PP.
 *  Lucro Real ou Presumido não tem nota desde 07/10/2026 (Tiago): "as
 *  retenções dependem do serviço" não ajudava quem cadastra. */
export const NOTA_DO_REGIME: Partial<Record<RegimeTributarioFornecedor, string>> = {
  simples:
    "Sem retenção de PIS/COFINS/CSLL e IRRF, com a declaração. O ISS pode ser retido com a alíquota informada na nota. A compra dá crédito de PIS/COFINS normalmente.",
  mei: "Sem retenção nenhuma. A compra dá crédito de PIS/COFINS normalmente.",
};

/** O que a consulta do CNPJ disse do regime, e de qual CNPJ. */
export interface ConsultaDoRegime {
  /** Os 14 dígitos do CNPJ consultado. */
  cnpj: string;
  /** O dia da consulta ("AAAA-MM-DD"). */
  em: string;
  regime: RegimeTributarioFornecedor;
  /** A data de opção pelo Simples ou pelo MEI que a consulta trouxe
   *  ("AAAA-MM-DD"); null no regime normal ou quando a Receita não informa. */
  desde: string | null;
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

/** "2019-01-01" (ou "2019-01-01T…") → "2019-01-01"; o resto → null. */
function dataIso(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

/**
 * A consulta inteira pela resposta da BrasilAPI: o regime e, no Simples e no
 * MEI, desde quando (`data_opcao_pelo_simples` / `data_opcao_pelo_mei`).
 * `null` quando a resposta não diz o regime.
 */
export function consultaDaRespostaDoCnpj(
  resposta: unknown,
  cnpj: string,
  em: string,
): ConsultaDoRegime | null {
  const regime = regimeDaConsultaDoCnpj(resposta);
  if (!regime) return null;
  const r = resposta as Record<string, unknown>;
  const desde =
    regime === "mei"
      ? dataIso(r.data_opcao_pelo_mei)
      : regime === "simples"
        ? dataIso(r.data_opcao_pelo_simples)
        : null;
  return { cnpj: onlyDigits(cnpj), em, regime, desde };
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

/** "2019-01-01" → "01/2019". */
function mesAnoBr(data: string): string {
  const [ano, mes] = data.slice(0, 7).split("-");
  return `${mes}/${ano}`;
}

/**
 * O texto embaixo do campo: de onde veio o regime à vista. `null` = nada a
 * dizer (sem regime, ou sem consulta deste CNPJ).
 *
 * - "Preenchido pela consulta do CNPJ em 02/10/2026 · optante do Simples
 *   desde 01/2019" (no MEI, "· MEI desde 03/2021"; sem a data, nada depois
 *   do dia; no normal, "· não optante do Simples");
 * - "Alterado manualmente — a consulta do CNPJ em 02/10/2026 indicou
 *   Simples Nacional." (âmbar) quando o regime à vista não é o indicado.
 */
export function origemDoRegime(
  regime: RegimeTributarioFornecedor | null,
  consulta: ConsultaDoRegime | null,
  cnpj: string,
): { texto: string; alterado: boolean } | null {
  const c = consultaDoCnpj(consulta, cnpj);
  if (!regime || !c) return null;
  if (regime !== c.regime) {
    return {
      texto: `Alterado manualmente — a consulta do CNPJ em ${dataBr(c.em)} indicou ${ROTULO_DO_REGIME[c.regime]}.`,
      alterado: true,
    };
  }
  const detalhe =
    regime === "simples"
      ? c.desde
        ? ` · optante do Simples desde ${mesAnoBr(c.desde)}`
        : ""
      : regime === "mei"
        ? c.desde
          ? ` · MEI desde ${mesAnoBr(c.desde)}`
          : ""
        : " · não optante do Simples";
  return { texto: `Preenchido pela consulta do CNPJ em ${dataBr(c.em)}${detalhe}`, alterado: false };
}

/** As três colunas da consulta do CNPJ, como vão ao banco. */
export interface ConsultaParaGravar {
  regime_consulta: RegimeTributarioFornecedor | null;
  regime_desde: string | null;
  regime_consultado_em: string | null;
}

/**
 * A consulta a gravar: a deste CNPJ, inteira, valha ou não o regime
 * escolhido (é o que mantém o aviso de "alterado manualmente" ao reabrir).
 * A de outro CNPJ — ele foi trocado depois da consulta — não vai.
 */
export function consultaParaGravar(
  consulta: ConsultaDoRegime | null,
  cnpj: string,
): ConsultaParaGravar {
  const c = consultaDoCnpj(consulta, cnpj);
  return {
    regime_consulta: c?.regime ?? null,
    regime_desde: c?.desde ?? null,
    regime_consultado_em: c?.em ?? null,
  };
}

/**
 * A consulta que um cadastro gravado carrega: a edição abre com ela. O
 * cadastro gravado antes da decisão 142 tem só a data — e ela só era
 * gravada quando o regime gravado era o indicado.
 */
export function consultaDoCadastro(
  f:
    | {
        cpf_cnpj: string | null;
        regime_tributario: RegimeTributarioFornecedor | null;
        regime_consulta: RegimeTributarioFornecedor | null;
        regime_desde: string | null;
        regime_consultado_em: string | null;
      }
    | null
    | undefined,
): ConsultaDoRegime | null {
  if (!f?.cpf_cnpj || !f.regime_consultado_em) return null;
  const regime = f.regime_consulta ?? f.regime_tributario;
  if (!regime) return null;
  return {
    cnpj: onlyDigits(f.cpf_cnpj),
    em: f.regime_consultado_em.slice(0, 10),
    regime,
    desde: regime !== "normal" ? dataIso(f.regime_desde) : null,
  };
}

// ---------------------------------------------------------------------------
// O arquivo da declaração de optante do Simples (IN SRF 459, anexo I)
// ---------------------------------------------------------------------------

/** O bucket privado do cadastro de fornecedores (10 MB; PDF, PNG ou JPEG). */
export const BUCKET_DO_FORNECEDOR = "fornecedores";

const PASTA_DAS_DECLARACOES = "declaracoes";
const TAMANHO_MAXIMO_DA_DECLARACAO = 10 * 1024 * 1024;
const TIPOS_DA_DECLARACAO: readonly string[] = ["application/pdf", "image/png", "image/jpeg"];

/** Por que o arquivo não pode ser a declaração; `null` = pode. */
export function recusaDoArquivoDaDeclaracao(
  nome: string,
  tamanho: number,
  tipo: string,
): string | null {
  if (tamanho > TAMANHO_MAXIMO_DA_DECLARACAO) return `“${nome}” passa de 10 MB.`;
  if (!TIPOS_DA_DECLARACAO.includes(tipo)) return `“${nome}”: anexe um PDF, PNG ou JPEG.`;
  return null;
}

/** Sem acento e sem espaço: a chave do Storage recusa alguns caracteres. */
function nomeSeguro(nome: string): string {
  const limpo = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+(\.[a-zA-Z0-9]+)$/, "$1")
    .replace(/^-+|-+$/g, "")
    .slice(-120);
  return limpo || "declaracao";
}

/** `<tenant>/declaracoes/<uuid>-<nome>`. Nasce no servidor, com o tenant da sessão. */
export function caminhoDaDeclaracao(tenantId: string, uuid: string, nome: string): string {
  return `${tenantId}/${PASTA_DAS_DECLARACOES}/${uuid}-${nomeSeguro(nome)}`;
}

/** O caminho é da pasta de declarações do tenant — sem subpasta nem "..". */
export function declaracaoDoTenant(path: string, tenantId: string): boolean {
  const partes = path.split("/");
  return (
    partes.length === 3 &&
    partes[0] === tenantId &&
    partes[1] === PASTA_DAS_DECLARACOES &&
    partes[2] !== "" &&
    !path.includes("..")
  );
}

/** O nome do arquivo, para a tela: o fim do caminho, sem o uuid da frente. */
export function nomeDoArquivoDaDeclaracao(path: string): string {
  const fim = path.split("/").pop() ?? path;
  return fim.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "");
}
