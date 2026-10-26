import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formata valor monetário em pt-BR. Aceita number, string numérica ou
 * null/undefined (retorna "—"). Padrão moeda BRL; outras moedas via arg.
 */
export function formatCurrency(
  value: number | string | null | undefined,
  currency: string = "BRL",
): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(num)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(num);
}

export function initials(name: string | null | undefined): string {
  if (!name) return "—";
  return name
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Encurta o nome em "primeira palavra + último sobrenome real", ignorando
 * preposições (de/da/do/dos/das/e) e sufixos (filho/filha/junior/jr/neto/
 * neta/sobrinho/sobrinha). Mesma regra do SQL do titular de verba.
 *
 * Exemplos:
 *   "COLABORADOR 001 EXEMPLO DOS SANTOS" → "COLABORADOR SANTOS"
 *   "COLABORADOR 002 DA SILVA FILHO" → "COLABORADOR SILVA"
 *   "COLABORADOR 003 EXEMPLO" → "COLABORADOR EXEMPLO"
 *   "COLABORADOR" → "COLABORADOR"
 */
const NOME_IGNORAR = new Set([
  "DE","DA","DO","DOS","DAS","E",
  "FILHO","FILHA","JUNIOR","JR","NETO","NETA","SOBRINHO","SOBRINHA",
]);

/**
 * Dias até uma data ISO ("YYYY-MM-DD"). Negativo quando já passou,
 * zero quando é hoje. Null quando a data é null/vazia.
 */
export function diasAteVencimento(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const alvo = new Date(iso + "T00:00:00").getTime();
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo - hoje.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Tempo decorrido desde uma data ISO, em pt-BR curto:
 * "hoje", "1 dia", "19 dias", "2 meses", "1 ano", "2 anos e 3 meses"
 */
export function tempoDesde(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const inicio = new Date(iso + "T00:00:00").getTime();
  const diffMs = Date.now() - inicio;
  if (diffMs < 0) return null;
  const dias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (dias === 0) return "hoje";
  if (dias === 1) return "1 dia";
  if (dias < 30) return `${dias} dias`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return meses === 1 ? "1 mês" : `${meses} meses`;
  const anos = Math.floor(meses / 12);
  const mesesRest = meses % 12;
  const anosLabel = anos === 1 ? "1 ano" : `${anos} anos`;
  if (mesesRest === 0) return anosLabel;
  return `${anosLabel} e ${mesesRest} ${mesesRest === 1 ? "mês" : "meses"}`;
}

export function nomeCurto(nome: string | null | undefined): string {
  if (!nome) return "—";
  const partes = nome.trim().split(/\s+/).filter((p) => p.length > 0);
  if (partes.length === 0) return "—";
  const relevantes = partes.filter((p) => !NOME_IGNORAR.has(p.toUpperCase()));
  if (relevantes.length === 0) return partes[0];
  if (relevantes.length === 1) return relevantes[0];
  return `${relevantes[0]} ${relevantes[relevantes.length - 1]}`;
}

// ---------- Documentos ----------

/** Remove todos os não-dígitos. */
export function onlyDigits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

/**
 * Formatação progressiva: aceita entrada parcial e vai colocando os
 * separadores conforme os dígitos chegam. Usado pelo MaskedInput.
 */
export function formatCpf(cpf: string | null | undefined): string {
  const d = onlyDigits(cpf).slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatCnpj(cnpj: string | null | undefined): string {
  const d = onlyDigits(cnpj).slice(0, 14);
  if (d.length === 0) return "";
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12)
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function formatDocumento(doc: string | null | undefined): string {
  const d = onlyDigits(doc);
  if (d.length <= 11) return formatCpf(d);
  return formatCnpj(d);
}

export function formatTelefone(tel: string | null | undefined): string {
  const d = onlyDigits(tel).slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10)
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  // 11 dígitos: celular no formato (XX) XXXXX-XXXX
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function formatCep(cep: string | null | undefined): string {
  const d = onlyDigits(cep).slice(0, 8);
  if (d.length === 0) return "";
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** Validação completa de CPF com dígito verificador. */
export function isValidCpf(cpf: string): boolean {
  const d = onlyDigits(cpf);
  if (d.length !== 11) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(d[i]) * (10 - i);
  let check = (sum * 10) % 11;
  if (check === 10) check = 0;
  if (check !== parseInt(d[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(d[i]) * (11 - i);
  check = (sum * 10) % 11;
  if (check === 10) check = 0;
  return check === parseInt(d[10]);
}

/** Validação completa de CNPJ com dígito verificador. */
export function isValidCnpj(cnpj: string): boolean {
  const d = onlyDigits(cnpj);
  if (d.length !== 14) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  const calc = (base: string, weights: number[]) => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += parseInt(base[i]) * weights[i];
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const dv1 = calc(d, w1);
  const dv2 = calc(d, w2);
  return dv1 === parseInt(d[12]) && dv2 === parseInt(d[13]);
}

// ---------- Datas e nomes ----------

/** Formata data ISO "YYYY-MM-DD" em "dd/MM/yyyy" pt-BR. */
export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const [y, m, d] = date.slice(0, 10).split("-");
  if (!y || !m || !d) return "—";
  return `${d}/${m}/${y}`;
}

/**
 * Primeiro + último nome. Útil em listagens com espaço limitado.
 * Ex: "COLABORADOR 001 EXEMPLO DA SILVA" vira "COLABORADOR SILVA".
 * Entrada de uma palavra só é retornada inalterada.
 */
export function firstAndLastName(name: string | null | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

// ---------- Duração de contrato ----------

function parseYmdDate(s: string): Date {
  const d = new Date(s + "T00:00:00");
  d.setHours(0, 0, 0, 0);
  return d;
}

function mesesEDias(from: Date, to: Date): { meses: number; dias: number } {
  let meses =
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth());
  const ref = new Date(from);
  ref.setMonth(ref.getMonth() + meses);
  if (ref > to) {
    meses--;
    ref.setMonth(ref.getMonth() - 1);
  }
  const dias = Math.max(
    0,
    Math.round((to.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24)),
  );
  return { meses, dias };
}

function formatarDuracao(meses: number, dias: number): string {
  const parts: string[] = [];
  if (meses > 0) parts.push(`${meses} ${meses === 1 ? "mês" : "meses"}`);
  if (dias > 0) parts.push(`${dias} ${dias === 1 ? "dia" : "dias"}`);
  return parts.length ? parts.join(" e ") : "hoje";
}

export interface DuracaoContrato {
  /** Total de dias do contrato (inicio → termino) */
  totalDias: number;
  /** Total em "X meses e Y dias" */
  totalLabel: string;
  /** Dias restantes (positivo = futuro, negativo = vencido) */
  diasRestantes: number;
  /** Label do tempo restante ou "Vencido há X" */
  restanteLabel: string;
  /** % do contrato já decorrido (0-100), 0 quando não começou */
  progresso: number;
  /** Status do contrato */
  status: "ativo" | "vencido" | "futuro" | "sem_data";
}

/**
 * Calcula duração total e tempo restante de um contrato.
 * Retorna null se faltar alguma das datas.
 */
export function calcularDuracaoContrato(
  dataInicio: string | null,
  dataTermino: string | null,
): DuracaoContrato | null {
  if (!dataInicio || !dataTermino) return null;

  try {
    const inicio = parseYmdDate(dataInicio);
    const termino = parseYmdDate(dataTermino);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    if (termino < inicio) return null;

    const totalDias = Math.round(
      (termino.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24),
    );
    const total = mesesEDias(inicio, termino);
    const totalLabel = formatarDuracao(total.meses, total.dias);

    const diasRestantes = Math.ceil(
      (termino.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24),
    );

    let restanteLabel: string;
    let status: DuracaoContrato["status"];

    if (hoje < inicio) {
      const futuro = mesesEDias(hoje, inicio);
      restanteLabel = `Começa em ${formatarDuracao(futuro.meses, futuro.dias)}`;
      status = "futuro";
    } else if (diasRestantes < 0) {
      const venc = mesesEDias(termino, hoje);
      restanteLabel = `Vencido há ${formatarDuracao(venc.meses, venc.dias)}`;
      status = "vencido";
    } else if (diasRestantes === 0) {
      restanteLabel = "Vence hoje";
      status = "ativo";
    } else {
      const rest = mesesEDias(hoje, termino);
      restanteLabel = `Faltam ${formatarDuracao(rest.meses, rest.dias)}`;
      status = "ativo";
    }

    const decorrido =
      (hoje.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24);
    const progresso =
      totalDias > 0
        ? Math.min(100, Math.max(0, Math.round((decorrido / totalDias) * 100)))
        : 0;

    return {
      totalDias,
      totalLabel,
      diasRestantes,
      restanteLabel,
      progresso,
      status,
    };
  } catch {
    return null;
  }
}
