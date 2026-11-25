/**
 * O rateio da guia por empresa gerencial (decisão 277, 23/11/2026).
 *
 * DESDE 25/11 (decisão 277 §10, "TDs (REC)"): o imposto sobre a receita (ISS,
 * PIS, COFINS, IRPJ e CSLL) divide pela receita de cada regional no período,
 * sem valor digitado por gerencial (`pelaBase`, `rateioAutomatico`). A divisão
 * por gerencial abaixo ficou só para o IOF do mútuo na Guia da contabilidade.
 *
 * Regra do Tiago: o valor de cada empresa gerencial é o da contabilidade
 * (na planilha, a soma das linhas daquela gerencial); dentro dela, as
 * regionais dividem pela receita da competência — o rateio do sistema, que
 * já é pela participação no faturamento. Exceções:
 *  1. o CNPJ com regional padrão (hoje, a GoCrazy → SS) leva a parte da
 *     gerencial dele inteira para essa regional;
 *  2. a gerencial com uma regional só (a Hitlab) vai inteira para ela;
 *  3. sem receita da gerencial na competência, a regional é escolhida;
 *  4. o IOF do mútuo não divide pela receita: vai para a regional padrão do
 *     CNPJ que emprestou ou fica sem regional — como o cálculo do sistema
 *     (`iof-mutuo.ts`) e a planilha fazem.
 */
import type { RateioDaGuia } from "./apuracao";
import { r2 } from "./datas";

export interface RegionalDaEmpresa {
  id: string;
  nome: string;
}

export interface EmpresaDoRateio {
  id: string;
  nome: string;
  regionais: RegionalDaEmpresa[];
}

export interface RegrasDoRateio {
  empresas: EmpresaDoRateio[];
  /** A regional padrão do CNPJ da guia, quando ele tem (a GoCrazy → SS). */
  regionalDoCnpj: { empresa_id: string; regional_id: string } | null;
  /** As regionais dividem pela receita. Falso no IOF do mútuo: sem regional (fora a do CNPJ). */
  pelaReceita: boolean;
}

/** O valor de uma empresa gerencial; `regional_id` só quando ela não tem receita na competência. */
export interface ParteDaGerencial {
  empresa_id: string;
  valor: number;
  regional_id: string | null;
}

export type ComoDividiu = "regional_do_cnpj" | "regional_unica" | "receita" | "escolhida" | "sem_regional" | "sem_regional_iof";

export interface DivisaoDaGerencial {
  como: ComoDividiu;
  partes: RateioDaGuia[];
}

const TEXTO: Record<ComoDividiu, string> = {
  regional_do_cnpj: "a regional do CNPJ",
  regional_unica: "a única regional da empresa",
  receita: "pela receita da competência",
  escolhida: "sem receita no período: regional escolhida",
  sem_regional: "sem receita no período: escolha a regional",
  sem_regional_iof: "sem regional, como no cálculo do IOF do mútuo",
};
export const textoDaDivisao = (c: ComoDividiu) => TEXTO[c];

/** Reparte `total` pelos pesos, com o último fechando no centavo. */
function repartir<T>(itens: T[], peso: (x: T) => number, total: number): Array<{ item: T; valor: number; pct: number }> {
  const soma = itens.reduce((s, x) => s + peso(x), 0);
  if (soma <= 0) return [];
  let acc = 0;
  return itens.map((x, i) => {
    const valor = i === itens.length - 1 ? r2(total - acc) : r2((total * peso(x)) / soma);
    acc = r2(acc + valor);
    return { item: x, valor, pct: r2((peso(x) / soma) * 100) };
  });
}

/** As regionais de uma empresa gerencial, pela regra. */
export function dividirGerencial(parte: ParteDaGerencial, base: RateioDaGuia[], regras: RegrasDoRateio): DivisaoDaGerencial {
  const empresa = regras.empresas.find((e) => e.id === parte.empresa_id);
  const nomeEmpresa = empresa?.nome ?? base.find((b) => b.empresa_id === parte.empresa_id)?.empresa_nome ?? "—";
  const uma = (como: ComoDividiu, reg: RegionalDaEmpresa | undefined): DivisaoDaGerencial =>
    reg
      ? {
          como,
          partes: [{ empresa_id: parte.empresa_id, empresa_nome: nomeEmpresa, regional_id: reg.id, regional_nome: reg.nome, valor: r2(parte.valor), pct: 100 }],
        }
      : { como: "sem_regional", partes: [] };

  if (regras.regionalDoCnpj && regras.regionalDoCnpj.empresa_id === parte.empresa_id) {
    return uma("regional_do_cnpj", empresa?.regionais.find((r) => r.id === regras.regionalDoCnpj!.regional_id));
  }
  if (!regras.pelaReceita) {
    return {
      como: "sem_regional_iof",
      partes: [{ empresa_id: parte.empresa_id, empresa_nome: nomeEmpresa, regional_id: null, regional_nome: null, valor: r2(parte.valor), pct: 100 }],
    };
  }
  if (empresa && empresa.regionais.length === 1) return uma("regional_unica", empresa.regionais[0]);

  // Pela receita: as regionais desta empresa no rateio do sistema (a parte sem regional fica de fora).
  const daEmpresa = new Map<string, { id: string; nome: string; peso: number }>();
  for (const b of base) {
    if (b.empresa_id !== parte.empresa_id || !b.regional_id) continue;
    const peso = b.valor > 0 ? b.valor : b.pct;
    const atual = daEmpresa.get(b.regional_id);
    if (atual) atual.peso += peso;
    else daEmpresa.set(b.regional_id, { id: b.regional_id, nome: b.regional_nome ?? "—", peso });
  }
  const lista = [...daEmpresa.values()].filter((x) => x.peso > 0).sort((a, b) => b.peso - a.peso);
  if (lista.length) {
    return {
      como: "receita",
      partes: repartir(lista, (x) => x.peso, parte.valor).map(({ item, valor, pct }) => ({
        empresa_id: parte.empresa_id,
        empresa_nome: nomeEmpresa,
        regional_id: item.id,
        regional_nome: item.nome,
        valor,
        pct,
      })),
    };
  }
  if (parte.regional_id) return uma("escolhida", empresa?.regionais.find((r) => r.id === parte.regional_id));
  return { como: "sem_regional", partes: [] };
}

export type ResultadoDoRateio = { ok: true; rateio: RateioDaGuia[] } | { ok: false; message: string };

/** O rateio final da guia (empresa × regional), conferido: fecha com o total e cada gerencial tem regional. */
export function rateioPorGerencial(partes: ParteDaGerencial[], base: RateioDaGuia[], regras: RegrasDoRateio, total: number): ResultadoDoRateio {
  if (!partes.length) return { ok: false, message: "Informe ao menos uma empresa gerencial no rateio." };
  const ids = new Set<string>();
  for (const p of partes) {
    if (!(p.valor > 0)) return { ok: false, message: "Cada empresa gerencial do rateio precisa de valor." };
    if (ids.has(p.empresa_id)) return { ok: false, message: "A mesma empresa gerencial aparece duas vezes no rateio." };
    ids.add(p.empresa_id);
    if (!regras.empresas.some((e) => e.id === p.empresa_id)) return { ok: false, message: "Empresa gerencial do rateio não encontrada." };
  }
  const soma = r2(partes.reduce((s, p) => s + p.valor, 0));
  if (Math.abs(soma - r2(total)) >= 0.01) {
    return { ok: false, message: `O rateio por empresa gerencial (R$ ${soma.toFixed(2).replace(".", ",")}) não fecha com a guia.` };
  }
  const rateio: RateioDaGuia[] = [];
  for (const p of partes) {
    const d = dividirGerencial(p, base, regras);
    if (!d.partes.length) {
      const nome = regras.empresas.find((e) => e.id === p.empresa_id)?.nome ?? "a empresa";
      return { ok: false, message: `${nome} não tem receita no período: escolha a regional.` };
    }
    rateio.push(...d.partes);
  }
  // O % de cada parte sobre a guia inteira (o rateio da guia guarda assim).
  return { ok: true, rateio: rateio.map((x) => ({ ...x, pct: total > 0 ? r2((x.valor / total) * 100) : 0 })) };
}

// ---------------------------------------------------------------------------
// Decisão 277 §10 (25/11/2026): "TDs (REC)"
// ---------------------------------------------------------------------------

/**
 * Os impostos sobre a receita: dividem entre as regionais pela receita de
 * cada uma no período da guia, sem valor digitado — "TDs (REC)". O Tiago:
 * "O rateio regional deve ser feito de acordo com a participação na receita
 * de cada regional. Não deve ser um rateio arbitrário".
 */
export const TRIBUTOS_PELA_RECEITA: ReadonlySet<string> = new Set(["ISS", "PIS", "COFINS", "IRPJ", "CSLL"]);
export const pelaReceita = (tributo: string) => TRIBUTOS_PELA_RECEITA.has(tributo);

/**
 * A base levada a `total`, pelo peso de cada parte (valor ou %), com o último
 * fechando no centavo. Só a receita de cada regional participa: a parte sem
 * regional (nota sem job, ou sem regional no histórico) fica fora, e a parte
 * que arredondaria a R$ 0,00 também (o rateio do imposto não aceita parte zerada).
 */
export function pelaBase(base: RateioDaGuia[], total: number): RateioDaGuia[] {
  const peso = (b: RateioDaGuia) => (b.valor > 0 ? b.valor : b.pct > 0 ? b.pct : 0);
  let itens = base.filter((b) => b.regional_id && peso(b) > 0);
  for (;;) {
    const partes = repartir(itens, peso, total);
    const zeradas = partes.filter((p) => p.valor <= 0);
    if (!zeradas.length || zeradas.length === partes.length) {
      return partes.filter((p) => p.valor > 0).map(({ item, valor, pct }) => ({ ...item, valor, pct }));
    }
    itens = partes.filter((p) => p.valor > 0).map((p) => p.item);
  }
}

/**
 * O rateio da Guia da contabilidade, sem valor digitado: o IOF do mútuo vai
 * para a empresa gerencial do CNPJ (na regional padrão dele, ou sem
 * regional); os outros impostos dividem pela receita do período de cada
 * regional (a base).
 */
export function rateioAutomatico(e: {
  tributo: string;
  base: RateioDaGuia[];
  regras: RegrasDoRateio;
  gerencialDoCnpj: string | null;
  total: number;
}): ResultadoDoRateio {
  if (!(e.total > 0)) return { ok: false, message: "Informe o valor da guia." };
  if (e.tributo === "IOF") {
    if (!e.gerencialDoCnpj) return { ok: false, message: "O CNPJ não tem empresa gerencial para receber o IOF." };
    return rateioPorGerencial([{ empresa_id: e.gerencialDoCnpj, valor: r2(e.total), regional_id: null }], e.base, e.regras, e.total);
  }
  const rateio = pelaBase(e.base, e.total);
  if (!rateio.length) {
    return { ok: false, message: "Sem receita do CNPJ no período: não há como dividir pela receita de cada regional." };
  }
  return { ok: true, rateio };
}
