/**
 * As contas da conciliação dia a dia (decisão 253), sem tela e sem banco:
 * a ordem do extrato, o saldo do banco depois de cada linha e os dias da
 * conta com o que falta em cada um.
 */

/** A ordem do extrato: o dia e, dentro dele, a ordem em que o banco mandou. */
export const naOrdemDoExtrato = (
  a: { data: string; ordem: number; id: string },
  b: { data: string; ordem: number; id: string },
) => a.data.localeCompare(b.data) || a.ordem - b.ordem || a.id.localeCompare(b.id);

/** O saldo do banco no fim de um dia, como o servidor o confere no fechamento. */
export interface SaldoBase {
  ate: string;
  saldo: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * O saldo do banco depois de cada linha. Parte do saldo do fim do dia `ate`
 * (o da última linha até esse dia) e anda linha a linha: para trás,
 * descontando o que veio depois; para a frente, somando. As ignoradas
 * contam, porque também mexeram no saldo do banco.
 *
 * Vale para as linhas que a tela tem: todas as dos dias em aberto. Com um
 * buraco entre uma linha e o dia `ate` (linha que a tela não leu), o saldo
 * dela sairia errado; por isso a leitura da aba traz os dias abertos inteiros.
 */
export function saldosDoExtrato(
  linhas: Array<{ id: string; data: string; ordem: number; valor: number }>,
  base: SaldoBase | null,
): Map<string, number> {
  const saldos = new Map<string, number>();
  if (!base) return saldos;
  const ord = [...linhas].sort(naOrdemDoExtrato);
  let ultimaAteABase = -1;
  ord.forEach((l, i) => {
    if (l.data <= base.ate) ultimaAteABase = i;
  });
  let s = base.saldo;
  for (let j = ultimaAteABase; j >= 0; j--) {
    saldos.set(ord[j].id, r2(s));
    s -= ord[j].valor;
  }
  s = base.saldo;
  for (let j = ultimaAteABase + 1; j < ord.length; j++) {
    s += ord[j].valor;
    saldos.set(ord[j].id, r2(s));
  }
  return saldos;
}

/** Um dia da conta na barra de dias. */
export interface DiaDaConta {
  data: string;
  /** As linhas do banco do dia. */
  linhas: number;
  /** O que ainda pede ação: linha do banco sem conciliar e baixa sem linha. */
  pendentes: number;
  /** `andamento`: o extrato foi gerado no próprio dia e ainda pode crescer. */
  estado: "fechado" | "pronto" | "pendente" | "andamento";
}

/**
 * Os dias da conta, do mais antigo ao mais novo. Cada entrada é uma linha do
 * banco (resolvida ou não) ou uma baixa do sistema sem linha no banco.
 */
export function diasDaConta(
  entradas: Array<{ data: string; linha: boolean; pendente: boolean }>,
  fechadaAte: string | null,
  /** O último dia completo do extrato (o que o fechamento aceita); nulo, sem extrato completo. */
  completoAte: string | null,
): DiaDaConta[] {
  const por = new Map<string, { linhas: number; pendentes: number }>();
  for (const e of entradas) {
    const d = por.get(e.data) ?? { linhas: 0, pendentes: 0 };
    if (e.linha) d.linhas++;
    if (e.pendente) d.pendentes++;
    por.set(e.data, d);
  }
  return [...por.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([data, d]) => ({
      data,
      linhas: d.linhas,
      pendentes: d.pendentes,
      estado:
        fechadaAte && data <= fechadaAte ? "fechado" : !completoAte || data > completoAte ? "andamento" : d.pendentes === 0 ? "pronto" : "pendente",
    }));
}

/** Por que o dia ainda não fecha; nulo, pode fechar. */
export function motivoDeNaoFechar(dias: DiaDaConta[], data: string): string | null {
  const dia = dias.find((d) => d.data === data);
  if (!dia || dia.estado === "fechado") return null;
  if (dia.estado === "andamento") return "O extrato deste dia ainda não está completo: o arquivo foi gerado no próprio dia.";
  const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const anteriores = dias.filter((d) => d.data < data && d.estado !== "fechado" && d.pendentes > 0);
  if (anteriores.length) return `Resolva antes ${anteriores.map((d) => ddmm(d.data)).join(", ")}: a conta fecha um dia depois do outro.`;
  if (dia.pendentes > 0) return `${dia.pendentes === 1 ? "Falta 1 item" : `Faltam ${dia.pendentes} itens`} para fechar este dia.`;
  return null;
}
