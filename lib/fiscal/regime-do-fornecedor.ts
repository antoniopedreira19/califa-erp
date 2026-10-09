/**
 * O regime tributário e o CNAE do fornecedor pessoa jurídica, no cadastro
 * (módulo fiscal, entrega 1 — 02/10/2026; consulta guardada e arquivo da
 * declaração na decisão 142; Real e Presumido separados e CNAE na decisão
 * 165, 09/10/2026).
 *
 * Lucro Real, Lucro Presumido, Simples Nacional ou MEI — obrigatório na
 * pessoa jurídica desde a decisão 166. `normal` é o legado "Lucro Real ou
 * Presumido", gravado até 09/10/2026: não se escolhe mais, e o cadastro que
 * o tem precisa escolher um dos dois. Para as retenções da aprovação da PP,
 * Real, Presumido e o legado são a mesma coisa (`ehRegimeNormal`).
 *
 * A consulta do CNPJ que o cadastro já faz na BrasilAPI (o CNPJ.ws é a
 * reserva desde 09/10/2026, convertido para os mesmos campos em
 * `lib/consulta-cnpj.ts`) diz se é Simples, MEI ou nenhum dos dois — a
 * Receita não diz se é Real ou Presumido —, e traz o CNAE principal e os
 * secundários. Ela preenche o CNAE e, no Simples e no MEI, o regime; o
 * resto quem escolhe é quem cadastra.
 *
 * A consulta fica guardada inteira, valha ou não o regime gravado:
 * `regime_consulta` (o que ela indicou: `normal`, `simples` ou `mei`),
 * `regime_desde` (a data de opção pelo Simples ou pelo MEI) e
 * `regime_consultado_em` (o dia). É o que deixa o texto embaixo do campo —
 * "Preenchido pela consulta do CNPJ em … · optante do Simples desde …" ou,
 * em âmbar, "Alterado manualmente — a consulta do CNPJ em … indicou …" —
 * valer também ao reabrir o cadastro. Os CNAEs da consulta não vão ao
 * banco: só valem na tela em que ela foi feita. A consulta só vale para o
 * CNPJ consultado: trocado o CNPJ, ela não vai ao banco.
 *
 * Decisão 166: sem o regime (ou com o legado) ou sem o CNAE, a PP desse
 * fornecedor não é gerada (`pendenciasDoCadastroFiscal`). E o cadastro que
 * ainda não tem CNAE — todo cadastro anterior a 09/10/2026 — abre com o
 * regime vazio na tela, para alguém revisar: o banco guarda o regime antigo
 * até a revisão, porque a aprovação das PPs já enviadas o lê.
 *
 * No Simples, o arquivo da declaração de optante (IN SRF 459, anexo I) vai
 * para o bucket privado `fornecedores`, em `<tenant>/declaracoes/`.
 *
 * Funções puras. A lista do CNAE mora em `./cnaes` (grande; carregada sob
 * demanda na tela). Testes:
 * node --import tsx --test lib/fiscal/regime-do-fornecedor.test.ts
 */

import type { RegimeTributarioFornecedor } from "@/lib/types";
import { onlyDigits } from "@/lib/utils";
import { dataBr } from "./datas";

/** O que a consulta do CNPJ sabe dizer: Simples, MEI ou nenhum dos dois
 *  (`normal` — a Receita não diz se é Real ou Presumido). */
export type RegimeDaConsulta = "normal" | "simples" | "mei";

/** Os que se escolhem, na ordem da lista do cadastro. O legado `normal`
 *  fica de fora (decisão 166). */
export const REGIMES_DO_FORNECEDOR: readonly RegimeTributarioFornecedor[] = [
  "lucro_real",
  "lucro_presumido",
  "simples",
  "mei",
];

/** Sem "Normal" na frente desde 07/10/2026 (Tiago): "regime normal" é
 *  jargão contábil e não diz nada a quem cadastra. */
export const ROTULO_DO_REGIME: Record<RegimeTributarioFornecedor, string> = {
  lucro_real: "Lucro Real",
  lucro_presumido: "Lucro Presumido",
  simples: "Simples Nacional",
  mei: "MEI",
  normal: "Lucro Real ou Presumido",
};

/** O que cada regime faz com as retenções e o crédito, na aprovação da PP.
 *  Lucro Real ou Presumido não tem nota desde 07/10/2026 (Tiago): "as
 *  retenções dependem do serviço" não ajudava quem cadastra. */
export const NOTA_DO_REGIME: Partial<Record<RegimeTributarioFornecedor, string>> = {
  simples:
    "Sem retenção de PIS/COFINS/CSLL e IRRF, com a declaração. O ISS pode ser retido com a alíquota informada na nota. A compra dá crédito de PIS/COFINS normalmente.",
  mei: "Sem retenção nenhuma. A compra dá crédito de PIS/COFINS normalmente.",
};

/** Lucro Real, Lucro Presumido e o legado: as mesmas regras de retenção. */
export function ehRegimeNormal(r: RegimeTributarioFornecedor | null | undefined): boolean {
  return r === "lucro_real" || r === "lucro_presumido" || r === "normal";
}

// ---------------------------------------------------------------------------
// CNAE: o formato (a lista inteira está em ./cnaes)
// ---------------------------------------------------------------------------

/** Sete dígitos, sem pontuação: como o banco guarda. */
export const CNAE_RE = /^\d{7}$/;

/** "5911102" → "5911-1/02". O que não tem 7 dígitos volta como veio. */
export function formatarCnae(codigo: string): string {
  const d = onlyDigits(codigo);
  return d.length === 7 ? `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5)}` : codigo;
}

/** O código da consulta (número ou texto, com ou sem pontuação) em 7
 *  dígitos. A BrasilAPI manda número, e o CNAE que começa com zero
 *  (agricultura) chega com 6. */
function codigoDoCnae(v: unknown): string | null {
  const d = onlyDigits(typeof v === "number" || typeof v === "string" ? String(v) : "");
  if (d.length === 7) return d;
  if (d.length === 6) return `0${d}`;
  return null;
}

// ---------------------------------------------------------------------------
// O que falta para gerar PP (decisão 166)
// ---------------------------------------------------------------------------

/** O que falta no cadastro da pessoa jurídica para gerar PP ([] = nada).
 *  Pessoa física não tem regime nem CNAE. O legado "Lucro Real ou
 *  Presumido" conta como regime faltando: precisa escolher um dos dois. */
export function pendenciasDoCadastroFiscal(
  f: { tipo_pessoa: string; regime_tributario: string | null; cnae: string | null } | null | undefined,
): string[] {
  if (!f || f.tipo_pessoa !== "juridica") return [];
  const falta: string[] = [];
  if (!f.regime_tributario || f.regime_tributario === "normal") falta.push("o regime tributário");
  if (!f.cnae || !CNAE_RE.test(f.cnae)) falta.push("o CNAE");
  return falta;
}

/** "o regime tributário e o CNAE". */
export function listarPendencias(p: readonly string[]): string {
  return p.length <= 1 ? (p[0] ?? "") : `${p.slice(0, -1).join(", ")} e ${p[p.length - 1]}`;
}

/** O cadastro antigo, que ainda não passou pela revisão da decisão 166: não
 *  tem CNAE. A tela o abre com o regime vazio e marca o que falta. */
export function cadastroSemRevisao(
  f: { tipo_pessoa: string; cnae: string | null } | null | undefined,
): boolean {
  return Boolean(f && f.tipo_pessoa === "juridica" && !f.cnae);
}

// ---------------------------------------------------------------------------
// A consulta do CNPJ
// ---------------------------------------------------------------------------

/** O que a consulta do CNPJ disse do regime e do CNAE, e de qual CNPJ. */
export interface ConsultaDoRegime {
  /** Os 14 dígitos do CNPJ consultado. */
  cnpj: string;
  /** O dia da consulta ("AAAA-MM-DD"). */
  em: string;
  regime: RegimeDaConsulta;
  /** A data de opção pelo Simples ou pelo MEI que a consulta trouxe
   *  ("AAAA-MM-DD"); null no regime normal ou quando a Receita não informa. */
  desde: string | null;
  /** O CNAE principal (7 dígitos). Só na consulta feita na tela; a que o
   *  cadastro gravou não o tem. */
  cnaePrincipal?: string | null;
  /** Os secundários, na ordem da Receita. */
  cnaesSecundarios?: string[];
}

/**
 * O regime pela resposta da BrasilAPI (`/api/cnpj/v1/{cnpj}`): MEI primeiro
 * — todo MEI também é optante do Simples —, depois o Simples; sem opção
 * (falso, ou nulo como na empresa que nunca optou), normal. `null` quando a
 * resposta não traz os campos de opção: aí não se deduz nada.
 */
export function regimeDaConsultaDoCnpj(resposta: unknown): RegimeDaConsulta | null {
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
 * A consulta inteira pela resposta da BrasilAPI: o regime, no Simples e no
 * MEI desde quando (`data_opcao_pelo_simples` / `data_opcao_pelo_mei`), e os
 * CNAEs (`cnae_fiscal` e `cnaes_secundarios`). `null` quando a resposta não
 * diz o regime.
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
  const secundarios = Array.isArray(r.cnaes_secundarios)
    ? (r.cnaes_secundarios as unknown[])
        .map((s) => codigoDoCnae(s && typeof s === "object" ? (s as Record<string, unknown>).codigo : null))
        .filter((c): c is string => c !== null)
    : [];
  return {
    cnpj: onlyDigits(cnpj),
    em,
    regime,
    desde,
    cnaePrincipal: codigoDoCnae(r.cnae_fiscal),
    cnaesSecundarios: secundarios,
  };
}

/** O regime que a consulta preenche: Simples e MEI ela sabe; "nenhum dos
 *  dois" deixa o campo para quem cadastra escolher Real ou Presumido. */
export function regimeQueAConsultaPreenche(
  c: RegimeDaConsulta,
): RegimeTributarioFornecedor | null {
  return c === "normal" ? null : c;
}

/**
 * O regime depois de uma consulta nova: entra no campo vazio e no lugar do
 * que veio de uma consulta anterior (o CNPJ foi corrigido); o que alguém
 * escolheu à mão fica — e o aviso âmbar diz o que a consulta indicou.
 */
export function regimeDepoisDaConsulta(
  atual: RegimeTributarioFornecedor | null,
  consultaAnterior: ConsultaDoRegime | null,
  daConsulta: RegimeDaConsulta,
): RegimeTributarioFornecedor | null {
  const preenche = regimeQueAConsultaPreenche(daConsulta);
  if (atual === null) return preenche;
  if (consultaAnterior && atual === regimeQueAConsultaPreenche(consultaAnterior.regime)) return preenche;
  return atual;
}

/** O CNAE depois de uma consulta nova: a mesma régua do regime — o vazio e
 *  o que veio da consulta anterior dão lugar ao principal. */
export function cnaeDepoisDaConsulta(
  atual: string | null,
  consultaAnterior: ConsultaDoRegime | null,
  consulta: ConsultaDoRegime,
): string | null {
  const principal = consulta.cnaePrincipal ?? null;
  if (atual === null) return principal;
  if (consultaAnterior?.cnaePrincipal && atual === consultaAnterior.cnaePrincipal) return principal ?? atual;
  return atual;
}

/** A consulta só vale para o CNPJ que foi consultado. */
export function consultaDoCnpj(consulta: ConsultaDoRegime | null, cnpj: string): ConsultaDoRegime | null {
  return consulta && consulta.cnpj === onlyDigits(cnpj) ? consulta : null;
}

/** "2019-01-01" → "01/2019". */
function mesAnoBr(data: string): string {
  const [ano, mes] = data.slice(0, 7).split("-");
  return `${mes}/${ano}`;
}

/** O texto embaixo de um campo. `alterado` pinta de âmbar; `pendente`, de
 *  vermelho (decisão 166: o que falta para gerar PP é vermelho). */
export interface TextoDeOrigem {
  texto: string;
  alterado: boolean;
  pendente?: boolean;
}

/**
 * O texto embaixo do regime: de onde veio o regime à vista. `null` = nada a
 * dizer.
 *
 * - "Preenchido pela consulta do CNPJ em 02/10/2026 · optante do Simples
 *   desde 01/2019" (no MEI, "· MEI desde 03/2021"; sem a data, nada depois
 *   do dia); em Real ou Presumido com a consulta dizendo "nenhum dos dois",
 *   "Conferido com a consulta do CNPJ em … · não optante do Simples";
 * - "Alterado manualmente — a consulta do CNPJ em … indicou Simples
 *   Nacional." (âmbar) quando o regime à vista não é o indicado;
 * - vazio (vermelho): "Antes: Simples Nacional. Confira e escolha." no
 *   cadastro em revisão, e "Consulta do CNPJ em …: não é Simples nem MEI.
 *   Escolha Real ou Presumido." quando a consulta não decide.
 */
export function origemDoRegime(
  regime: RegimeTributarioFornecedor | null,
  consulta: ConsultaDoRegime | null,
  cnpj: string,
  /** O regime que o cadastro tinha antes da revisão (decisão 166). */
  antes: RegimeTributarioFornecedor | null = null,
): TextoDeOrigem | null {
  const c = consultaDoCnpj(consulta, cnpj);
  if (!regime) {
    if (c?.regime === "normal") {
      return {
        texto: `Consulta do CNPJ em ${dataBr(c.em)}: não é Simples nem MEI. Escolha Real ou Presumido.`,
        alterado: true,
        pendente: true,
      };
    }
    if (antes) {
      return {
        texto:
          antes === "normal"
            ? "Estava “Lucro Real ou Presumido”: escolha um dos dois."
            : `Antes: ${ROTULO_DO_REGIME[antes]}. Confira e escolha.`,
        alterado: true,
        pendente: true,
      };
    }
    return null;
  }
  if (!c) return null;
  const bate = c.regime === "normal" ? ehRegimeNormal(regime) : regime === c.regime;
  if (!bate) {
    const indicou = c.regime === "normal" ? "não optante do Simples" : ROTULO_DO_REGIME[c.regime];
    return {
      texto: `Alterado manualmente — a consulta do CNPJ em ${dataBr(c.em)} indicou ${indicou}.`,
      alterado: true,
    };
  }
  const detalhe =
    c.regime === "simples"
      ? c.desde
        ? ` · optante do Simples desde ${mesAnoBr(c.desde)}`
        : ""
      : c.regime === "mei"
        ? c.desde
          ? ` · MEI desde ${mesAnoBr(c.desde)}`
          : ""
        : " · não optante do Simples";
  return {
    texto: `${c.regime === "normal" ? "Conferido com a" : "Preenchido pela"} consulta do CNPJ em ${dataBr(c.em)}${detalhe}`,
    alterado: false,
  };
}

/** O texto embaixo do CNAE, quando há uma consulta deste CNPJ na tela. */
export function origemDoCnae(
  cnae: string | null,
  consulta: ConsultaDoRegime | null,
  cnpj: string,
): TextoDeOrigem | null {
  const c = consultaDoCnpj(consulta, cnpj);
  if (!cnae || !c?.cnaePrincipal) return null;
  if (cnae === c.cnaePrincipal) {
    return { texto: `CNAE principal na consulta do CNPJ em ${dataBr(c.em)}`, alterado: false };
  }
  if (c.cnaesSecundarios?.includes(cnae)) {
    return { texto: `CNAE secundário na consulta do CNPJ em ${dataBr(c.em)}`, alterado: false };
  }
  return {
    texto: `Não consta na consulta do CNPJ em ${dataBr(c.em)} (principal: ${formatarCnae(c.cnaePrincipal)}).`,
    alterado: true,
  };
}

/** As três colunas da consulta do CNPJ, como vão ao banco. */
export interface ConsultaParaGravar {
  regime_consulta: RegimeDaConsulta | null;
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
 * A consulta que um cadastro gravado carrega: a edição abre com ela (sem os
 * CNAEs, que não vão ao banco). O cadastro gravado antes da decisão 142 tem
 * só a data — e ela só era gravada quando o regime gravado era o indicado.
 */
export function consultaDoCadastro(
  f:
    | {
        cpf_cnpj: string | null;
        regime_tributario: RegimeTributarioFornecedor | null;
        regime_consulta: RegimeDaConsulta | null;
        regime_desde: string | null;
        regime_consultado_em: string | null;
      }
    | null
    | undefined,
): ConsultaDoRegime | null {
  if (!f?.cpf_cnpj || !f.regime_consultado_em) return null;
  const gravado = f.regime_consulta ?? f.regime_tributario;
  if (!gravado) return null;
  const regime: RegimeDaConsulta = ehRegimeNormal(gravado) ? "normal" : (gravado as RegimeDaConsulta);
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
