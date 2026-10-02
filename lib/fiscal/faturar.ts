/**
 * O Faturar com o módulo fiscal (entrega 1 — 02/10/2026): de onde vêm o
 * CNPJ emissor que a nota já traz escolhido, o Nº NF sugerido de cada CNPJ
 * e a marca do CNAE que o GP sugeriu no envio para faturamento.
 *
 * Funções puras. A página de Contas a Receber monta tudo de uma vez
 * (`montarFiscalDoFaturar`, com as notas emitidas que ela já lê) e o
 * formulário só consulta. Testes: node --import tsx --test
 * lib/fiscal/faturar.test.ts
 */
import type { FiscalCnae, FiscalEstabelecimento, RegimeTributarioPJ } from "@/lib/types";
import { formatarCnpj, type CadastroFiscal } from "./cadastro";
import { codigoDoCnae } from "./calculos";
import { dataBr, nomeDoMes } from "./datas";

const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** A última nota emitida (com CNPJ emissor registrado) para um CNPJ de cliente. */
export interface UltimaNotaDoCliente {
  estabelecimento_id: string;
  numero_nf: string;
  data_emissao: string;
}

/** A empresa gerencial que é, ela mesma, a PJ de um CNPJ só (hoje, a Hitlab). */
export interface CnpjDaEmpresaGerencial {
  estabelecimento_id: string;
  /** Nome curto da empresa gerencial, para a frase de ajuda. */
  empresa_nome: string;
}

/** O que o Faturar precisa do módulo fiscal (montado na página). */
export interface FiscalDoFaturar {
  cadastro: CadastroFiscal;
  /** Nome curto de cada PJ (empresa contábil), por id: "DARF da California". */
  nomeDaPJ: Record<string, string>;
  /** Pelo CNPJ do cliente (só dígitos): a última nota emitida para ele. */
  ultimaPorCnpjTomador: Record<string, UltimaNotaDoCliente>;
  /** Pelo CNPJ emissor: o maior Nº NF numérico emitido por ele + 1. */
  proximaNfPorEstab: Record<string, string>;
  /** Pela empresa gerencial: o CNPJ dela, quando ela é a PJ de um CNPJ só. */
  cnpjPorEmpresaGerencial: Record<string, CnpjDaEmpresaGerencial>;
}

/** Uma nota emitida, no que interessa às sugestões. */
export interface NotaParaSugestao {
  numero_nf: string;
  data_emissao: string;
  cnpj_tomador: string | null;
  estabelecimento_id: string | null;
}

/** "002061" → 2061; sem número nenhum, nulo. */
function numeroDaNf(numero: string): number | null {
  const d = soDigitos(numero);
  if (!d) return null;
  const n = Number(d);
  return Number.isFinite(n) ? n : null;
}

/** A mais recente primeiro: data de emissão, e o maior número no empate. */
function maisRecente(a: NotaParaSugestao, b: NotaParaSugestao): number {
  return (
    b.data_emissao.localeCompare(a.data_emissao) ||
    (numeroDaNf(b.numero_nf) ?? 0) - (numeroDaNf(a.numero_nf) ?? 0)
  );
}

/**
 * Monta as sugestões do Faturar a partir das notas EMITIDAS (as canceladas
 * ficam de fora, como no Nº NF sugerido de antes, que era o maior emitido
 * + 1). Só contam as notas que já registram o CNPJ emissor: as anteriores ao
 * módulo fiscal não dizem por qual CNPJ saíram.
 */
export function montarFiscalDoFaturar(args: {
  cadastro: CadastroFiscal;
  pjs: ReadonlyArray<{ id: string; nome_fantasia: string | null; razao_social: string | null }>;
  empresas: ReadonlyArray<{
    id: string;
    cnpj: string | null;
    nome_fantasia: string | null;
    razao_social: string | null;
  }>;
  notas: ReadonlyArray<NotaParaSugestao>;
}): FiscalDoFaturar {
  const { cadastro } = args;

  const nomeDaPJ: Record<string, string> = {};
  for (const p of args.pjs) nomeDaPJ[p.id] = p.nome_fantasia?.trim() || p.razao_social?.trim() || "";

  const comCnpj = args.notas
    .filter((n): n is NotaParaSugestao & { estabelecimento_id: string } => Boolean(n.estabelecimento_id))
    .slice()
    .sort(maisRecente);

  const ultimaPorCnpjTomador: Record<string, UltimaNotaDoCliente> = {};
  const maiorPorEstab = new Map<string, number>();
  for (const n of comCnpj) {
    const cliente = soDigitos(n.cnpj_tomador);
    // Em ordem da mais recente: a primeira de cada cliente é a última dele.
    if (cliente && !ultimaPorCnpjTomador[cliente]) {
      ultimaPorCnpjTomador[cliente] = {
        estabelecimento_id: n.estabelecimento_id,
        numero_nf: n.numero_nf,
        data_emissao: n.data_emissao,
      };
    }
    const numero = numeroDaNf(n.numero_nf);
    if (numero !== null && numero > (maiorPorEstab.get(n.estabelecimento_id) ?? 0)) {
      maiorPorEstab.set(n.estabelecimento_id, numero);
    }
  }
  const proximaNfPorEstab: Record<string, string> = {};
  for (const [estab, maior] of maiorPorEstab) proximaNfPorEstab[estab] = String(maior + 1);

  // A empresa gerencial que tem o CNPJ de um estabelecimento ativo, e cuja
  // PJ não tem outro CNPJ no cadastro: o job dela só pode sair por ele. É a
  // Hitlab ("job da empresa gerencial Hitlab vem com a Hitlab", Tiago,
  // 02/10/2026). A Agência California tem o CNPJ da matriz, mas a PJ tem as
  // filiais — e aí não há padrão: vale o último usado para o cliente.
  const cnpjPorEmpresaGerencial: Record<string, CnpjDaEmpresaGerencial> = {};
  for (const e of args.empresas) {
    const cnpj = soDigitos(e.cnpj);
    if (cnpj.length !== 14) continue;
    const estab = cadastro.estabelecimentos.find((x) => x.ativo && x.cnpj === cnpj);
    if (!estab) continue;
    const daMesmaPJ = cadastro.estabelecimentos.filter((x) => x.empresa_contabil_id === estab.empresa_contabil_id);
    if (daMesmaPJ.length !== 1) continue;
    cnpjPorEmpresaGerencial[e.id] = {
      estabelecimento_id: estab.id,
      empresa_nome: e.nome_fantasia?.trim() || e.razao_social?.trim() || estab.nome,
    };
  }

  return { cadastro, nomeDaPJ, ultimaPorCnpjTomador, proximaNfPorEstab, cnpjPorEmpresaGerencial };
}

export interface SugestaoDoCnpj {
  estabelecimentoId: string | null;
  /** A frase que diz por que veio este CNPJ (nula quando não veio nenhum). */
  ajuda: string | null;
}

/**
 * O CNPJ emissor que o Faturar já traz escolhido (regra aprovada em
 * 02/10/2026, protótipo do módulo fiscal): job da empresa gerencial que é a
 * PJ de um CNPJ só (a Hitlab) vem com esse CNPJ; senão, o último usado para
 * o mesmo CNPJ de cliente; senão, nenhum. Sempre pode trocar.
 */
export function sugestaoDoCnpj(
  fiscal: FiscalDoFaturar,
  linha: { cnpj_tomador: string | null; empresa_id: string; contraparte_nome: string } | null,
): SugestaoDoCnpj {
  if (!linha) return { estabelecimentoId: null, ajuda: null };
  const ativo = (id: string) => fiscal.cadastro.estabelecimentos.find((e) => e.id === id && e.ativo) ?? null;

  const cliente = soDigitos(linha.cnpj_tomador);
  const ultima = cliente ? fiscal.ultimaPorCnpjTomador[cliente] : undefined;
  const estabDaUltima = ultima ? ativo(ultima.estabelecimento_id) : null;
  const textoDaUltima = (u: UltimaNotaDoCliente, e: FiscalEstabelecimento) =>
    `Último usado para ${linha.contraparte_nome}: ${e.nome}, NF ${u.numero_nf} de ${dataBr(u.data_emissao)}. Pode trocar.`;

  const daEmpresa = fiscal.cnpjPorEmpresaGerencial[linha.empresa_id];
  const estabDaEmpresa = daEmpresa ? ativo(daEmpresa.estabelecimento_id) : null;
  if (daEmpresa && estabDaEmpresa) {
    const pj = fiscal.nomeDaPJ[estabDaEmpresa.empresa_contabil_id] || estabDaEmpresa.nome;
    return {
      estabelecimentoId: estabDaEmpresa.id,
      ajuda:
        ultima && estabDaUltima?.id === estabDaEmpresa.id
          ? textoDaUltima(ultima, estabDaEmpresa)
          : `Job da empresa gerencial ${daEmpresa.empresa_nome}: vem o CNPJ da ${pj}. Pode trocar.`,
    };
  }
  if (ultima && estabDaUltima) {
    return { estabelecimentoId: estabDaUltima.id, ajuda: textoDaUltima(ultima, estabDaUltima) };
  }
  return { estabelecimentoId: null, ajuda: null };
}

/**
 * Os CNAEs da lista que batem com o sugerido pelo GP. O envio grava o texto
 * do código ("82.30-0-01 · 12.08", `codigoDoCnae`); a comparação é pelos
 * dígitos, para o texto livre de antes da lista ("7490-1/04") também achar o
 * seu. Sugestão sem subitem ("82.30-0-01") marca os dois subitens.
 */
export function cnaesQueBatemComASugestao(
  lista: ReadonlyArray<Pick<FiscalCnae, "id" | "codigo" | "subitem">>,
  sugerido: string | null,
): Set<string> {
  const alvo = soDigitos(sugerido);
  if (!alvo) return new Set();
  const exatos = lista.filter((c) => soDigitos(codigoDoCnae(c)) === alvo);
  if (exatos.length > 0) return new Set(exatos.map((c) => c.id));
  return new Set(lista.filter((c) => soDigitos(c.codigo) === alvo).map((c) => c.id));
}

/** "California · Salvador · 19.437.976/0001-54". */
export function rotuloDoEstabelecimento(e: Pick<FiscalEstabelecimento, "nome" | "cnpj">): string {
  return `${e.nome} · ${formatarCnpj(e.cnpj)}`;
}

/** "Lucro Real trimestral" / "Lucro Presumido · regime de caixa". */
export function textoDoRegime(regime: RegimeTributarioPJ, regimeCaixa: boolean): string {
  if (regime === "lucro_real") return "Lucro Real trimestral";
  return regimeCaixa ? "Lucro Presumido · regime de caixa" : "Lucro Presumido";
}

function trimestreDaData(data: string): { ano: number; tri: number } {
  const [ano, mes] = data.slice(0, 7).split("-").map(Number);
  return { ano, tri: Math.ceil(mes / 3) };
}

/** "2026-11-11" → "4º trimestre/2026". */
export function textoDoTrimestre(data: string): string {
  const { ano, tri } = trimestreDaData(data);
  return `${tri}º trimestre/${ano}`;
}

/**
 * "2026-11-11" → "janeiro, fevereiro e março de 2027": os meses das cotas
 * de IRPJ e CSLL, no trimestre seguinte ao da nota.
 */
export function mesesDasCotas(data: string): string {
  const { ano, tri } = trimestreDaData(data);
  const anoSeguinte = tri === 4 ? ano + 1 : ano;
  const triSeguinte = tri === 4 ? 1 : tri + 1;
  const meses = [1, 2, 3].map((i) =>
    nomeDoMes(`${anoSeguinte}-${String((triSeguinte - 1) * 3 + i).padStart(2, "0")}`).split("/")[0],
  );
  return `${meses[0]}, ${meses[1]} e ${meses[2]} de ${anoSeguinte}`;
}

/** O dia do PIS e da COFINS (parâmetro `pis_cofins_dia`; 25 sem cadastro). */
export function diaDoPisCofins(cad: CadastroFiscal): number {
  const v = cad.parametros.find((p) => p.chave === "pis_cofins_dia")?.valor;
  return v && v >= 1 && v <= 31 ? v : 25;
}
