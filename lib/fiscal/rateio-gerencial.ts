/**
 * O rateio da guia por empresa gerencial (decisão 277, 23/11/2026).
 *
 * Regra do Tiago: o valor de cada empresa gerencial é o da contabilidade
 * (na planilha, a soma das linhas daquela gerencial); dentro dela, as
 * regionais dividem pela receita da competência — o rateio do sistema, que
 * já é pela participação no faturamento. Exceções:
 *  1. o CNPJ com regional padrão (hoje, a GoCrazy → SS) leva a parte da
 *     gerencial dele inteira para essa regional;
 *  2. a gerencial com uma regional só (a Hitlab) vai inteira para ela;
 *  3. sem receita da gerencial na competência, a regional é escolhida.
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
}

/** O valor de uma empresa gerencial; `regional_id` só quando ela não tem receita na competência. */
export interface ParteDaGerencial {
  empresa_id: string;
  valor: number;
  regional_id: string | null;
}

export type ComoDividiu = "regional_do_cnpj" | "regional_unica" | "receita" | "escolhida" | "sem_regional";

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

/** O valor de cada gerencial sugerido pelo rateio do sistema, levado a `total`. */
export function gerenciaisDaBase(base: RateioDaGuia[], total: number, padrao: string | null): ParteDaGerencial[] {
  const porEmpresa = new Map<string, number>();
  for (const b of base) porEmpresa.set(b.empresa_id, (porEmpresa.get(b.empresa_id) ?? 0) + (b.valor > 0 ? b.valor : b.pct));
  const lista = [...porEmpresa.entries()].filter(([, v]) => v > 0);
  if (!lista.length) return padrao ? [{ empresa_id: padrao, valor: r2(total), regional_id: null }] : [];
  return repartir(lista, ([, v]) => v, total).map(({ item, valor }) => ({ empresa_id: item[0], valor, regional_id: null }));
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
