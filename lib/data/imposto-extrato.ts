import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinhaSemSaldo } from "./lancamento-linha";

/**
 * A GUIA DE IMPOSTO NO EXTRATO (módulo fiscal, entrega 2 — protótipo
 * aprovado pelo Tiago em 02/10/2026).
 *
 * A baixa de um imposto (`baixar_imposto`) grava UM lançamento por parte do
 * rateio do título — empresa · regional, no centro do imposto (03 · Custo
 * Tributário · <imposto>, ou 02 · Custo Operacional no repasse das
 * retenções) — e UM de multa e juros (11 · Despesa com Juros), todos com o
 * mesmo `imposto_a_pagar_id`, na mesma conta e na mesma data. No extrato do
 * banco isso é UM débito. A conciliação mostra UMA linha — a soma, com a
 * descrição da guia, o órgão que a recebe e o documento — que se abre em
 * sublinhas pelo mesmo mecanismo do pagamento da fatura do cartão
 * (`fatura-cartao-extrato.ts`, decisão 093).
 *
 * O agrupamento troca as N linhas pela soma, na posição da primeira delas:
 * os créditos e os débitos do período, o saldo final e o saldo de toda linha
 * que não é da guia ficam exatamente os mesmos.
 *
 * Sem dependência de execução (só tipos): o teste roda a montagem pura.
 */

// ---------------------------------------------------------------------------
// O que a linha da guia abre
// ---------------------------------------------------------------------------

/**
 * Uma sublinha do pagamento de uma guia: a parte de uma empresa · regional
 * no rateio do título, ou a multa e os juros.
 */
export type ParteDoImposto = {
  chave: string;
  /** "California · Nordeste", ou "Multa e juros". */
  rotulo: string;
  /** Quanto do imposto cabe a esta empresa · regional (70 = 70%). `null`
   *  na multa e nos juros, que são só deste pagamento. */
  percentual: number | null;
  /** O centro de custo do lançamento, como a baixa gravou: o do imposto,
   *  ou 11 · Despesa com Juros na multa e nos juros. */
  tipo_nome: string;
  subtipo_nome: string | null;
  valor: number;
};

/**
 * O que a linha do pagamento de uma guia abre na conciliação. O total fecha
 * com o débito da linha.
 */
export type DetalheDoImposto = {
  /** "guia DARF 6912", ou "guia municipal" — como o rodapé lê. */
  guia: string;
  /** "PIS · outubro/2026", "IRPJ (com adicional) · 4º trimestre/2026 ·
   *  cota 1/3". Vazio só quando o título não pôde ser lido. */
  competencia: string;
  /** O vencimento do título; `null` só quando ele não pôde ser lido. */
  vencimento: string | null;
  total: number;
  /** Quantas partes (empresa · regional) o rateio tem — o rótulo da linha. */
  regionais: number;
  multaJuros: number;
  /** Mais de uma empresa no rateio: a coluna Empresa diz "Múltiplas", como
   *  a coluna Job diz "Múltiplos". */
  empresas: number;
  partes: ParteDoImposto[];
};

// ---------------------------------------------------------------------------
// A leitura
// ---------------------------------------------------------------------------

/** O título pago, no que a linha da guia precisa dele. */
export type TituloDaGuia = {
  tributo: string;
  /** `apuracao`, `diferenca` (a guia complementar) ou `avulso`. */
  origem: string;
  titulo: string;
  /** Código do DARF; nulo na guia municipal. */
  codigo_receita: string | null;
  rotulo_competencia: string;
  cota_numero: number | null;
  cota_total: number | null;
  vencimento: string;
  multa_juros: number;
  guia_path: string | null;
  estabelecimento: { nome: string; municipio: string } | null;
  empresa_contabil: { razao_social: string; nome_fantasia: string | null } | null;
};

/**
 * O que cada lançamento de `imposto_baixa` traz além da linha comum do
 * extrato: o título que ele paga e a regional da parte. A linha comum só
 * deriva a regional do job e do rateio da origem, e a baixa de imposto não
 * tem nenhum dos dois — a regional está no próprio lançamento.
 */
export type LancamentoDaGuia = {
  imposto_a_pagar_id: string;
  regional_nome: string | null;
  titulo: TituloDaGuia | null;
};

/**
 * Uma leitura só, pelos ids dos lançamentos de `imposto_baixa` do período —
 * à parte da consulta do extrato, de propósito: se ela falhar, as linhas da
 * guia ficam soltas (uma por parte, como antes) e o resto do extrato não é
 * afetado. Embeds pelo nome da coluna: nenhum par de tabelas aqui pode
 * virar ambíguo quando uma FK nova aparecer.
 */
const SELECT_LANCAMENTO_DA_GUIA = `id, imposto_a_pagar_id,
  regional:regionais!regional_id(nome),
  imposto:impostos_a_pagar!imposto_a_pagar_id(
    tributo, origem, titulo, codigo_receita, rotulo_competencia,
    cota_numero, cota_total, vencimento, multa_juros, guia_path,
    estabelecimento:fiscal_estabelecimentos!estabelecimento_id(nome, municipio),
    empresa_contabil:empresas_contabeis!empresa_contabil_id(razao_social, nome_fantasia)
  )`;

type LancamentoDaGuiaRaw = {
  id: string;
  imposto_a_pagar_id: string | null;
  regional: { nome: string } | null;
  imposto:
    | (Omit<TituloDaGuia, "cota_numero" | "cota_total" | "multa_juros"> & {
        cota_numero: number | string | null;
        cota_total: number | string | null;
        multa_juros: number | string | null;
      })
    | null;
};

export async function carregarLancamentosDasGuias(
  supabase: SupabaseClient,
  tenantId: string,
  lancamentoIds: string[],
): Promise<Map<string, LancamentoDaGuia>> {
  const mapa = new Map<string, LancamentoDaGuia>();
  if (lancamentoIds.length === 0) return mapa;

  const { data, error } = await supabase
    .from("lancamentos_financeiros")
    .select(SELECT_LANCAMENTO_DA_GUIA)
    .eq("tenant_id", tenantId)
    .in("id", lancamentoIds);

  // O erro é LIDO, como na consulta do extrato: sem esta leitura as linhas
  // da guia aparecem soltas, e o log é o único lugar que diz por quê.
  if (error) {
    console.error("[conciliacao.guias-de-imposto]", error.message);
    return mapa;
  }

  for (const r of (data ?? []) as unknown as LancamentoDaGuiaRaw[]) {
    if (!r.imposto_a_pagar_id) continue;
    const t = r.imposto;
    mapa.set(r.id, {
      imposto_a_pagar_id: r.imposto_a_pagar_id,
      regional_nome: r.regional?.nome ?? null,
      titulo: t
        ? {
            ...t,
            cota_numero: t.cota_numero === null ? null : Number(t.cota_numero),
            cota_total: t.cota_total === null ? null : Number(t.cota_total),
            multa_juros: Number(t.multa_juros ?? 0),
          }
        : null,
    });
  }
  return mapa;
}

// ---------------------------------------------------------------------------
// Os textos da guia
// ---------------------------------------------------------------------------

/** "DARF 6912", ou "Guia municipal". */
export function guiaDe(t: Pick<TituloDaGuia, "codigo_receita">): string {
  const codigo = t.codigo_receita?.trim();
  return codigo ? `DARF ${codigo}` : "Guia municipal";
}

/** "PIS · outubro/2026", "IRPJ (com adicional) · 4º trimestre/2026 · cota
 *  1/3", "ISS próprio · outubro/2026 · complementar". A cota vem depois da
 *  competência, como na descrição que a baixa grava no lançamento. */
export function competenciaDaGuia(
  t: Pick<TituloDaGuia, "titulo" | "rotulo_competencia" | "cota_numero" | "cota_total" | "origem">,
): string {
  const cota = t.cota_numero && t.cota_total ? ` · cota ${t.cota_numero}/${t.cota_total}` : "";
  const complementar = t.origem === "diferenca" ? " · complementar" : "";
  return `${t.titulo} · ${t.rotulo_competencia}${cota}${complementar}`;
}

/** Quem recebe a guia: a prefeitura do município no ISS (próprio ou
 *  retido), a Receita Federal nos demais. */
export function orgaoDaGuia(t: Pick<TituloDaGuia, "tributo" | "estabelecimento">): string {
  return (t.tributo === "ISS" || t.tributo === "ISS_RET") && t.estabelecimento
    ? `Prefeitura de ${t.estabelecimento.municipio}`
    : "Receita Federal";
}

/** "DARF 6912 · PIS · outubro/2026 · California": a guia, o imposto e a
 *  competência, e o CNPJ que paga — o estabelecimento na guia municipal, a
 *  empresa contábil na federal. */
export function descricaoDaGuia(t: TituloDaGuia): string {
  const local =
    t.estabelecimento?.nome ??
    t.empresa_contabil?.nome_fantasia ??
    t.empresa_contabil?.razao_social ??
    null;
  return [guiaDe(t), competenciaDaGuia(t), local].filter(Boolean).join(" · ");
}

/** O nome do arquivo da guia: sem a pasta do tenant e sem o identificador
 *  que o envio põe na frente do nome (`<uuid>-guia.pdf`). */
export function nomeDoArquivo(path: string): string {
  const base = path.split("/").pop() ?? path;
  const semId = base.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i,
    "",
  );
  return semId || base;
}

// ---------------------------------------------------------------------------
// A montagem (pura)
// ---------------------------------------------------------------------------

/** 11 · Despesa com Juros: onde `baixar_imposto` grava a multa e os juros.
 *  A descrição ("Multa e juros · …") confirma, se o plano mudar um dia. */
const CENTRO_DA_MULTA = "11";

const ehMultaEJuros = (l: LinhaSemSaldo) =>
  l.tipo_codigo === CENTRO_DA_MULTA || l.descricao.startsWith("Multa e juros");

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Saída positiva, entrada negativa — o que a linha tira do saldo. */
const assinado = (l: LinhaSemSaldo) => (l.natureza === "saida" ? l.valor : -l.valor);

export type ExtratoComGuias = {
  linhas: LinhaSemSaldo[];
  /** Por id da linha da guia: o que ela abre. */
  detalhes: Record<string, DetalheDoImposto>;
  /**
   * De cada lançamento de uma guia para o id da linha que o mostra. A baixa
   * devolve o id de UM lançamento dela para o `highlight`, e os lançamentos
   * de uma baixa nascem na mesma transação (mesmo `created_at`): a ordem
   * entre eles no extrato não é garantida, e a linha pode ter o id de outro.
   * `Map`, e não objeto: a chave procurada vem da URL, e `?highlight=
   * constructor` num objeto comum devolveria o que está no protótipo.
   */
  linhaDoLancamento: Map<string, string>;
};

/**
 * Junta os lançamentos de cada guia (`imposto_baixa` com o mesmo
 * `imposto_a_pagar_id`) numa linha, na posição do primeiro deles, com o id
 * dele. Lançamento sem a leitura da guia (`daGuia`) fica como está.
 */
export function agruparGuiasDeImposto(
  linhas: LinhaSemSaldo[],
  daGuia: Map<string, LancamentoDaGuia>,
): ExtratoComGuias {
  const guiaDaLinha = (l: LinhaSemSaldo) =>
    l.origem === "imposto_baixa" ? daGuia.get(l.id) : undefined;

  const porImposto = new Map<string, LinhaSemSaldo[]>();
  for (const l of linhas) {
    const g = guiaDaLinha(l);
    if (!g) continue;
    const lista = porImposto.get(g.imposto_a_pagar_id) ?? [];
    lista.push(l);
    porImposto.set(g.imposto_a_pagar_id, lista);
  }

  const saida: LinhaSemSaldo[] = [];
  const detalhes: Record<string, DetalheDoImposto> = {};
  const linhaDoLancamento = new Map<string, string>();
  for (const l of linhas) {
    const g = guiaDaLinha(l);
    if (!g) {
      saida.push(l);
      continue;
    }
    // Os demais lançamentos da guia já entraram na linha do primeiro.
    if (linhaDoLancamento.has(l.id)) continue;
    const membros = porImposto.get(g.imposto_a_pagar_id) ?? [l];
    const { linha, detalhe } = linhaDaGuia(membros, daGuia);
    saida.push(linha);
    detalhes[linha.id] = detalhe;
    for (const m of membros) linhaDoLancamento.set(m.id, linha.id);
  }
  return { linhas: saida, detalhes, linhaDoLancamento };
}

function linhaDaGuia(
  membros: LinhaSemSaldo[],
  daGuia: Map<string, LancamentoDaGuia>,
): { linha: LinhaSemSaldo; detalhe: DetalheDoImposto } {
  const primeira = membros[0];
  const titulo = membros.map((m) => daGuia.get(m.id)?.titulo).find((t) => t) ?? null;
  const regionalDe = (m: LinhaSemSaldo) => daGuia.get(m.id)?.regional_nome ?? null;
  const soma = (xs: LinhaSemSaldo[]) => r2(xs.reduce((s, m) => s + assinado(m), 0));

  const multas = membros.filter(ehMultaEJuros);
  const doImposto = membros.filter((m) => !ehMultaEJuros(m));
  const total = soma(membros);
  const imposto = soma(doImposto);
  const multaJuros = soma(multas);
  // O centro da linha é o do imposto; a multa e os juros têm o deles.
  const base = doImposto[0] ?? primeira;

  const rotuloDaParte = (m: LinhaSemSaldo) => {
    const empresa = m.empresa_nome ?? "—";
    const regional = regionalDe(m);
    return regional ? `${empresa} · ${regional}` : empresa;
  };
  // Maior parte primeiro (é ela que recebe a multa e os juros); o empate
  // vai pelo nome, para a ordem não depender da ordem do banco.
  const partes: ParteDoImposto[] = [...doImposto]
    .sort(
      (a, b) =>
        assinado(b) - assinado(a) || rotuloDaParte(a).localeCompare(rotuloDaParte(b), "pt-BR"),
    )
    .map((m) => ({
      chave: m.id,
      rotulo: rotuloDaParte(m),
      percentual: imposto !== 0 ? r2((assinado(m) / imposto) * 100) : null,
      tipo_nome: m.tipo_nome,
      subtipo_nome: m.subtipo_nome,
      valor: assinado(m),
    }));
  if (multas.length > 0) {
    partes.push({
      chave: multas[0].id,
      rotulo: "Multa e juros",
      percentual: null,
      tipo_nome: multas[0].tipo_nome,
      subtipo_nome: multas[0].subtipo_nome,
      valor: multaJuros,
    });
  }

  const empresas = [
    ...new Set(membros.map((m) => m.empresa_nome).filter((e): e is string => !!e)),
  ];
  // A coluna Regional e o detalhe (ⓘ) leem por regional: duas empresas na
  // mesma regional somam, em vez de repetir o nome.
  const porRegional = new Map<string, number>();
  for (const m of doImposto) {
    const nome = regionalDe(m) ?? "—";
    porRegional.set(nome, (porRegional.get(nome) ?? 0) + assinado(m));
  }
  const regionais = [...porRegional.entries()];

  const linha: LinhaSemSaldo = {
    ...primeira,
    descricao: titulo ? descricaoDaGuia(titulo) : base.descricao,
    natureza: total < 0 ? "entrada" : "saida",
    valor: Math.abs(total),
    fornecedor_nome: titulo ? orgaoDaGuia(titulo) : base.fornecedor_nome,
    tipo_codigo: base.tipo_codigo,
    tipo_nome: base.tipo_nome,
    subtipo_codigo: base.subtipo_codigo,
    subtipo_nome: base.subtipo_nome,
    empresa_nome: empresas.length === 1 ? empresas[0] : null,
    regional_nome: regionais.length === 1 && regionais[0][0] !== "—" ? regionais[0][0] : null,
    rateio:
      regionais.length > 1
        ? regionais.map(([nome, valor]) => ({
            regional_nome: nome,
            percentual: imposto !== 0 ? r2((valor / imposto) * 100) : 0,
          }))
        : [],
    origem_codigo: titulo ? guiaDe(titulo) : base.origem_codigo,
    documento_label: titulo?.guia_path ? nomeDoArquivo(titulo.guia_path) : null,
    documento_path: titulo?.guia_path ?? null,
    origens: [],
  };

  const codigo = titulo?.codigo_receita?.trim();
  const detalhe: DetalheDoImposto = {
    guia: !titulo ? "guia" : codigo ? `guia DARF ${codigo}` : "guia municipal",
    competencia: titulo ? competenciaDaGuia(titulo) : "",
    vencimento: titulo?.vencimento ?? null,
    total: linha.valor,
    regionais: doImposto.length,
    multaJuros,
    empresas: empresas.length,
    partes,
  };

  return { linha, detalhe };
}
