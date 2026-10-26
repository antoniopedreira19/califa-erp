/**
 * O de-para aprovado do histórico financeiro (decisão 211): o valor do
 * sistema para cada texto da planilha (subtipo do plano, cliente, marca,
 * serviço e regional).
 *
 * Mora numa pasta própria, fora do git (`tmp/historico-planilha/depara/`),
 * e vale para todas as versões da planilha: a aprovação guarda o que já foi
 * decidido e só acrescenta o que é novo. Para mudar uma decisão, edita-se o
 * CSV da pasta; valor vazio quer dizer "fica como texto no histórico".
 *
 * Em 25/10/2026 o Tiago aprovou as propostas como estavam: o que veio
 * igual, parecido, pela sigla, pela marca ou geral vale; o ambíguo e o sem
 * par ficam como texto.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { lerCsv } from "./csv";
import { normalizarTexto } from "./regras";

export const chaveDoPlano = (grupo: string, cod: string) => `${grupo}|${normalizarTexto(cod)}`;
export const chaveDoCliente = (cliente: string) => normalizarTexto(cliente);
export const chaveDaMarca = (cliente: string, marca: string) => `${normalizarTexto(cliente)}|${normalizarTexto(marca)}`;
export const chaveDoServico = (servico: string) => normalizarTexto(servico);
export const chaveDaRegional = (empresa: string, regional: string) => `${empresa}|${normalizarTexto(regional)}`;

/** A proposta vale (o "como" dela está aqui) ou o texto fica sem par no sistema. */
const PROPOSTA_QUE_VALE: ReadonlySet<string> = new Set([
  "igual",
  "parecido",
  "pela sigla",
  "pela marca",
  "geral",
  "tipo com um subtipo só",
  "grupo sem tipo: proposto",
]);

export function valorAprovado(proposta: string, como: string): string {
  return PROPOSTA_QUE_VALE.has(como) ? proposta : "";
}

export type ArquivoDoDePara = {
  arquivo: string;
  /** Colunas que identificam o texto da planilha. */
  chaves: string[];
  /** Coluna com o valor do sistema. */
  valor: string;
  chave: (r: Record<string, string>) => string;
};

export const ARQUIVOS_DO_DE_PARA: Readonly<Record<"plano" | "clientes" | "marcas" | "servicos" | "regionais", ArquivoDoDePara>> = {
  plano: { arquivo: "plano.csv", chaves: ["grupo", "cod"], valor: "subtipo_sistema", chave: (r) => chaveDoPlano(r.grupo, r.cod) },
  clientes: { arquivo: "clientes.csv", chaves: ["cliente_na_planilha"], valor: "cliente_sistema", chave: (r) => chaveDoCliente(r.cliente_na_planilha) },
  marcas: {
    arquivo: "marcas.csv",
    chaves: ["cliente_na_planilha", "marca_na_planilha"],
    valor: "marca_sistema",
    chave: (r) => chaveDaMarca(r.cliente_na_planilha, r.marca_na_planilha),
  },
  servicos: { arquivo: "servicos.csv", chaves: ["servico_na_planilha"], valor: "servico_sistema", chave: (r) => chaveDoServico(r.servico_na_planilha) },
  regionais: {
    arquivo: "regionais.csv",
    chaves: ["empresa", "regional_na_planilha"],
    valor: "regional_sistema",
    chave: (r) => chaveDaRegional(r.empresa, r.regional_na_planilha),
  },
};

export type DePara = Record<keyof typeof ARQUIVOS_DO_DE_PARA, Map<string, string>>;

export async function lerTabelaCsv(caminho: string): Promise<Record<string, string>[] | null> {
  let texto: string;
  try {
    texto = await readFile(caminho, "utf8");
  } catch {
    return null;
  }
  const [cabecalho, ...linhas] = lerCsv(texto);
  return linhas.map((l) => Object.fromEntries(cabecalho.map((c, i) => [c, l[i] ?? ""])));
}

/** Lê a pasta do de-para aprovado. Arquivo que falta vira um de-para vazio. */
export async function lerDePara(pasta: string): Promise<DePara> {
  const resultado = {} as DePara;
  for (const [nome, def] of Object.entries(ARQUIVOS_DO_DE_PARA) as [keyof DePara, ArquivoDoDePara][]) {
    const mapa = new Map<string, string>();
    for (const r of (await lerTabelaCsv(join(pasta, def.arquivo))) ?? []) mapa.set(def.chave(r), r[def.valor] ?? "");
    resultado[nome] = mapa;
  }
  return resultado;
}
