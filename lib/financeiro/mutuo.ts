/**
 * Mútuo entre empresas (decisão 230): as contas que não dependem de banco nem
 * de tela. O saldo é um por par de partes: a abertura de 30/09 mais os mútuos
 * feitos, nos dois sentidos. Parte é um CNPJ do grupo (`ec:<id>`) ou uma empresa
 * de fora do sistema (`f:<id>`).
 */

export const parteDoCnpj = (id: string) => `ec:${id}`;
export const parteDeFora = (id: string) => `f:${id}`;
export const ehParteDeFora = (parte: string) => parte.startsWith("f:");

export interface ParteDoMutuo {
  chave: string;
  nome: string;
  deFora: boolean;
}

export interface ContaDoMutuo {
  id: string;
  nome: string;
  banco: string;
  parte: string;
}

export interface PernaDoMutuo {
  lado: "saida" | "entrada";
  contaId: string;
  conciliada: boolean;
}

export interface MutuoDaLista {
  id: string;
  codigo: string;
  origemId: string | null;
  destinoId: string | null;
  fornecedorId: string | null;
  valor: number;
  /** A data do movimento; antes da baixa, a prevista. */
  data: string;
  descricao: string | null;
  status: "a_transferir" | "transferida";
  juros: number | null;
  trimestre: number;
  ano: number;
  pernas: PernaDoMutuo[];
}

export interface AberturaDoPar {
  id: string;
  credor: string;
  devedor: string;
  valor: number;
  dataReferencia: string;
  trimestre: number;
  ano: number;
  nota: string | null;
  juros: number | null;
  /** As saídas que formam o saldo da empresa de fora. */
  saidas: Array<{ data: string; valor: number }>;
  /** O IOF pago até a data de corte, pela planilha. */
  iofPago: number;
}

export interface IofDoMutuo {
  pagador: string;
  /** A outra parte do mútuo. Vazia, o IOF não soma em nenhum par. */
  com: string | null;
  valor: number;
}

export interface GuiaAbertaDoIof {
  parte: string;
  competencia: string;
  valor: number;
}

export interface DadosDoMutuo {
  hoje: string;
  contas: ContaDoMutuo[];
  partes: ParteDoMutuo[];
  mutuos: MutuoDaLista[];
  aberturas: AberturaDoPar[];
  iofs: IofDoMutuo[];
  /** As guias de IOF ainda não pagas: avisam antes de lançar pela linha do banco. */
  guiasAbertas: GuiaAbertaDoIof[];
}

export interface SaldoDoPar {
  chave: string;
  a: string;
  b: string;
  /** Positivo: `a` deve a `b`. */
  saldo: number;
  abertura: number;
  aberturaId: string | null;
  notaDaAbertura: string | null;
  dataDaAbertura: string | null;
  movimentos: MutuoDaLista[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function nomeDaParte(d: Pick<DadosDoMutuo, "partes">, parte: string): string {
  return d.partes.find((p) => p.chave === parte)?.nome ?? "—";
}

/** A parte de um lado do mútuo: a da conta ou a empresa de fora. */
export function parteDoLado(d: Pick<DadosDoMutuo, "contas">, contaId: string | null, fornecedorId: string | null): string {
  if (contaId) return d.contas.find((c) => c.id === contaId)?.parte ?? "";
  return fornecedorId ? parteDeFora(fornecedorId) : "";
}

export const umaPernaSo = (m: Pick<MutuoDaLista, "fornecedorId">) => m.fornecedorId !== null;

function ordenarPar(d: Pick<DadosDoMutuo, "partes">, x: string, y: string): [string, string] {
  const [fx, fy] = [ehParteDeFora(x), ehParteDeFora(y)];
  if (fx !== fy) return fx ? [x, y] : [y, x];
  return nomeDaParte(d, x).localeCompare(nomeDaParte(d, y)) <= 0 ? [x, y] : [y, x];
}

export function saldosDosPares(d: DadosDoMutuo): SaldoDoPar[] {
  const pares = new Map<string, [string, string]>();
  const anotar = (x: string, y: string) => {
    if (!x || !y) return;
    const par = ordenarPar(d, x, y);
    pares.set(par.join("|"), par);
  };
  for (const ab of d.aberturas) anotar(ab.credor, ab.devedor);
  for (const m of d.mutuos) anotar(parteDoLado(d, m.origemId, m.fornecedorId), parteDoLado(d, m.destinoId, m.fornecedorId));

  return [...pares.entries()]
    .map(([chave, [a, b]]) => {
      const movimentos = d.mutuos
        .filter((m) => {
          const lados = [parteDoLado(d, m.origemId, m.fornecedorId), parteDoLado(d, m.destinoId, m.fornecedorId)];
          return lados.includes(a) && lados.includes(b);
        })
        .sort((x, y) => x.data.localeCompare(y.data) || x.codigo.localeCompare(y.codigo));
      const ab = d.aberturas.find((x) => [x.credor, x.devedor].includes(a) && [x.credor, x.devedor].includes(b));
      const abertura = ab ? (ab.devedor === a ? ab.valor : -ab.valor) : 0;
      const saldo = movimentos
        .filter((m) => m.status === "transferida")
        .reduce((s, m) => s + (parteDoLado(d, m.destinoId, m.fornecedorId) === a ? m.valor : -m.valor), abertura);
      return {
        chave,
        a,
        b,
        saldo: r2(saldo),
        abertura,
        aberturaId: ab?.id ?? null,
        notaDaAbertura: ab?.nota ?? null,
        dataDaAbertura: ab?.dataReferencia ?? null,
        movimentos,
      };
    })
    .sort((x, y) => {
      const [fx, fy] = [ehParteDeFora(x.a), ehParteDeFora(y.a)];
      if (fx !== fy) return fx ? 1 : -1;
      return (nomeDaParte(d, x.a) + nomeDaParte(d, x.b)).localeCompare(nomeDaParte(d, y.a) + nomeDaParte(d, y.b));
    });
}

export const parDeFora = (p: Pick<SaldoDoPar, "a">) => ehParteDeFora(p.a);

/** "California deve à GoCrazy" para o saldo do par. */
export function quemDeve(d: Pick<DadosDoMutuo, "partes">, p: Pick<SaldoDoPar, "a" | "b">, saldo: number): string {
  if (Math.abs(saldo) < 0.005) return "Sem saldo";
  const [dev, cre] = saldo > 0 ? [p.a, p.b] : [p.b, p.a];
  return `${nomeDaParte(d, dev)} deve à ${nomeDaParte(d, cre)}`;
}

/** O saldo do par depois de um mútuo novo, para a prévia do formulário. */
export function saldoDepois(
  d: DadosDoMutuo,
  n: { origem: string; destino: string; valor: number; ignorar?: string },
): { texto: string; valor: number } {
  const [a, b] = ordenarPar(d, n.origem, n.destino);
  const par = saldosDosPares(d).find((p) => p.chave === `${a}|${b}`);
  const antigo = n.ignorar ? d.mutuos.find((m) => m.id === n.ignorar) : undefined;
  let saldo = par?.saldo ?? 0;
  if (antigo?.status === "transferida") {
    saldo += parteDoLado(d, antigo.destinoId, antigo.fornecedorId) === a ? -antigo.valor : antigo.valor;
  }
  saldo = r2(saldo + (n.destino === a ? n.valor : -n.valor));
  return { texto: quemDeve(d, { a, b }, saldo), valor: Math.abs(saldo) };
}

export const trimestreDaData = (iso: string) => Math.ceil(Number(iso.slice(5, 7)) / 3);

/**
 * O trimestre que o formulário sugere: o da abertura do par, que a devolução
 * herda; sem abertura, o da data. Quem lança troca à mão num empréstimo novo.
 */
export function trimestrePadrao(
  d: Pick<DadosDoMutuo, "aberturas">,
  origem: string,
  destino: string,
  data: string,
): { trimestre: number; ano: number; herdado: boolean } {
  const ab = d.aberturas.find((x) => [x.credor, x.devedor].includes(origem) && [x.credor, x.devedor].includes(destino));
  if (ab) return { trimestre: ab.trimestre, ano: ab.ano, herdado: true };
  return { trimestre: trimestreDaData(data), ano: Number(data.slice(0, 4)), herdado: false };
}

const DIA = 86_400_000;

/** Juros compostos até hoje. Só informam: nada é lançado. */
export function jurosCompostos(valor: number, jurosAoMes: number | null, desde: string, hoje: string): number {
  if (!jurosAoMes || valor <= 0) return 0;
  const dias = Math.max(0, Math.round((Date.parse(hoje) - Date.parse(desde)) / DIA));
  return r2(valor * ((1 + jurosAoMes / 100) ** (dias / 30) - 1));
}

/** Os juros até hoje do saldo de abertura, desde cada saída. */
export function jurosDaAbertura(ab: Pick<AberturaDoPar, "juros" | "saidas">, hoje: string): number {
  return r2(ab.saidas.reduce((s, x) => s + jurosCompostos(x.valor, ab.juros, x.data, hoje), 0));
}

export function jurosDoMutuo(m: MutuoDaLista, hoje: string): number {
  return m.status === "transferida" ? jurosCompostos(m.valor, m.juros, m.data, hoje) : 0;
}

/** O IOF pago num par: o da abertura mais o lançado com o par informado. */
export function iofDoPar(d: Pick<DadosDoMutuo, "iofs" | "aberturas">, a: string, b: string): number {
  const par = [a, b];
  const antes = d.aberturas.filter((x) => par.includes(x.credor) && par.includes(x.devedor)).reduce((s, x) => s + x.iofPago, 0);
  return r2(antes + d.iofs.filter((i) => i.com !== null && par.includes(i.com) && par.includes(i.pagador)).reduce((s, i) => s + i.valor, 0));
}

/** A previsão que uma linha do banco realiza: o mesmo mútuo, a transferir. */
export function previstoDe(
  d: Pick<DadosDoMutuo, "mutuos">,
  n: { origemId: string | null; destinoId: string | null; fornecedorId: string | null; valor: number },
): MutuoDaLista | undefined {
  return d.mutuos.find(
    (m) =>
      m.status === "a_transferir" &&
      m.origemId === n.origemId &&
      m.destinoId === n.destinoId &&
      m.fornecedorId === n.fornecedorId &&
      Math.abs(m.valor - n.valor) < 0.005,
  );
}

// ---- A linha do banco -----------------------------------------------------

export interface LinhaDeOutraConta {
  id: string;
  contaId: string;
  contaNome: string;
  data: string;
  valor: number;
  parte: string;
}

export interface ContextoDoMutuoNaConta {
  /** A parte da conta aberta. */
  parte: string;
  /** Linhas pendentes de contas de outro CNPJ, de valor oposto ao destas. */
  pendentes: LinhaDeOutraConta[];
  /** CNPJ em dígitos → parte: reconhece quem mandou o PIX. */
  cnpjs: Record<string, ParteDoMutuo>;
  /** A outra parte → quem deve no par: diz se a linha é uma devolução. */
  devedores: Record<string, string>;
}

export interface MutuoDaLinha {
  /** A linha do outro lado, quando o extrato dela está no sistema. */
  par: LinhaDeOutraConta | null;
  parte: ParteDoMutuo;
  /** Quem paga é quem deve: a linha devolve, como a planilha a chama. */
  devolucao: boolean;
}

/** O PIX traz o CNPJ de quem mandou em 14 dígitos, com ou sem pontuação. */
export function cnpjNoHistorico(historico: string): string | null {
  const m = historico.replace(/[.\-/]/g, "").match(/(?<!\d)\d{14}(?!\d)/);
  return m ? m[0] : null;
}

/**
 * O passo depois de tudo o que o motor já faz, só na linha sem correspondência:
 * a linha oposta, mesmo valor, até 1 dia, numa conta de OUTRO CNPJ. Sem ela, o
 * crédito ainda se reconhece pelo CNPJ no histórico do PIX. O débito não traz o
 * destino: sem o par, fica onde está.
 */
export function mutuoDaLinha(
  ctx: ContextoDoMutuoNaConta,
  partes: ParteDoMutuo[],
  linha: { data: string; valor: number; historico: string },
  semLinha: Array<{ data: string; valor: number; origem: string }>,
): MutuoDaLinha | null {
  // Já existe mútuo sem linha aqui (o corrigido para outro valor): oferecer
  // outro lançaria o mesmo dinheiro duas vezes.
  const jaTem = semLinha.some(
    (l) =>
      (l.origem === "mutuo_saida" || l.origem === "mutuo_entrada") &&
      Math.sign(l.valor) === Math.sign(linha.valor) &&
      Math.abs(Date.parse(l.data) - Date.parse(linha.data)) <= 3 * DIA,
  );
  if (jaTem) return null;
  const par = ctx.pendentes.find(
    (l) =>
      Math.abs(l.valor + linha.valor) < 0.005 &&
      Math.abs(Date.parse(l.data) - Date.parse(linha.data)) <= DIA &&
      l.parte !== ctx.parte,
  );
  const devolve = (parte: ParteDoMutuo) => ctx.devedores[parte.chave] === (linha.valor < 0 ? ctx.parte : parte.chave);
  if (par) {
    const parte = partes.find((p) => p.chave === par.parte);
    return parte ? { par, parte, devolucao: devolve(parte) } : null;
  }
  if (linha.valor > 0) {
    const cnpj = cnpjNoHistorico(linha.historico);
    const parte = cnpj ? ctx.cnpjs[cnpj] : undefined;
    if (parte && parte.chave !== ctx.parte) return { par: null, parte, devolucao: devolve(parte) };
  }
  return null;
}
