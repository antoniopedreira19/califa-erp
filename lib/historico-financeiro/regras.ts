/**
 * Regras da padronização (E2) do histórico financeiro — decisão 211.
 *
 * Tudo aqui é função pura sobre o texto que a planilha "Fin. Conta
 * Califórnia" mostrava (o CSV bruto da E1). As regras vieram das fórmulas da
 * própria planilha, conferidas contra a aba DRE em 25/10/2026:
 *
 *   - a coluna Tipo junta empresa, grupo da DRE e competência
 *     ("CMH CO 3T 2026"); sem prefixo, a empresa é a California;
 *   - o job de California e Go Crazy fica na coluna Jobs; o de CMH, Hitlab
 *     e Ventura, na coluna Evento (a coluna Jobs delas guarda "CMH 3T 2026",
 *     que a DRE usa como empréstimo entre empresas);
 *   - linha com data depois da exportação é previsão, rolada para frente
 *     quando não acontece;
 *   - Tipo com o nome de uma conta é transferência; "ESTORNO" é estorno.
 *
 * Empresas (D1, aprovada em 25/10/2026): sem prefixo → Agência California
 * (inclusive nas contas da Go Crazy, que é o CNPJ da operação SS); CMH → CCH;
 * HIT → Hitlab; VT → Ventura. FitDance, Community e Infloo ficam só como
 * nome no histórico, sem empresa no sistema.
 */

export const EMPRESA_SEM_PREFIXO = "Agência California";

export const SIGLAS_DE_EMPRESA: Readonly<Record<string, string>> = {
  CMH: "CCH",
  HIT: "Hitlab",
  VT: "Ventura",
  CMT: "Community",
  FIT: "FitDance",
  IFL: "Infloo",
};

/** As empresas da planilha que existem no sistema; as outras são "empresa do histórico" (D1). */
export const EMPRESAS_DO_SISTEMA: ReadonlySet<string> = new Set(["Agência California", "CCH", "Hitlab", "Ventura"]);

/** Empresas cujo job a planilha procura na coluna Evento. As outras usam a coluna Jobs. */
const SIGLAS_COM_JOB_NO_EVENTO: ReadonlySet<string> = new Set(["CMH", "HIT", "VT", "CMT", "IFL"]);

/** Grupo da DRE da planilha → código do tipo no plano de contas do sistema. */
export const TIPO_DO_PLANO_POR_GRUPO: Readonly<Record<string, string>> = {
  REC: "01",
  CO: "02",
  CT: "03",
  CF: "04",
  DP: "05",
  DM: "06",
  DA: "07",
  DC: "08",
  DT: "09",
  RF: "10",
  DJ: "11",
  EMP: "12",
  IMOB: "13",
  PL: "14",
  DL: "15",
};

/**
 * Grupos da planilha que o plano do sistema não tem, com o tipo proposto (a
 * confirmar na revisão da E2): DOC são as obras e os equipamentos da Doca, na
 * CMH, e seguem a lista do Imobilizado; MÚTUO INT é o empréstimo interno; MK
 * é o marketing da CMH.
 */
export const GRUPO_SEM_TIPO_PROPOSTO: Readonly<Record<string, { tipo: string; descricoesDe?: string }>> = {
  DOC: { tipo: "13", descricoesDe: "IMOB" },
  "MÚTUO INT": { tipo: "12" },
  MK: { tipo: "06" },
};

/** Grupos em que a linha deveria apontar um job (receita, custo e imposto do job). */
export const GRUPOS_DE_JOB: ReadonlySet<string> = new Set(["REC", "CO", "CT"]);

/** Nomes de conta que aparecem no Tipo das transferências entre contas. */
const CONTRAPARTIDAS: ReadonlySet<string> = new Set([
  "SANTANDER",
  "BRADESCO",
  "XP CALIFORNIA",
  "XP GO CRAZY",
  "BNB",
  "FUNDO FIXO",
  "PAYPAL",
  "SANTANDER GO CRAZY",
  "BANCO DO BRASIL",
  "CONTA FITDANCE BRADESCO",
  "CONTA FITDANCE SANTANDER",
  "CONTA FITDANCE ITAU",
]);

/**
 * Texto que a planilha põe na coluna do job quando a linha não é de job: os
 * nomes de grupo da DRE ("Despesa Pessoal", "Imobilizado") e a própria
 * empresa, com ou sem período ("Hitlab 2023", "CMH 3T 2024").
 */
const NAO_E_JOB: ReadonlySet<string> = new Set([
  "",
  "N A",
  "NA",
  "IMPOSTO",
  "IMPOSTOS",
  "DIVERSOS",
  "ESTORNO",
  "APORTE",
  "IMOBILIZADO",
  "DESPESA PESSOAL",
  "DESPESA ADMINISTRATIVA",
  "DESPESA COMERCIAL",
  "DESPESA MKT",
  "DESPESA TRABALHISTA",
  "CUSTO FIXO",
  "RECEITA FINANCEIRA",
  "DISTRIBUICAO DE LUCRO",
]);
const EMPRESA_NO_LUGAR_DO_JOB = /^(CALIFORNIA|CALIFA|CMH|HIT|HITLAB|VT|VENTURA|GO CRAZY|FIT|FITDANCE|CMT|COMMUNITY|IFL|INFLOO)( [1-4] ?T)?( (19|20)\d\d)?$/;

/** Maiúsculas, sem acento, sem pontuação e com um espaço entre as palavras. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export type TipoLido =
  | { classe: "dre"; sigla: string | null; grupo: string; trimestre: number | null; ano: number }
  | { classe: "transferencia"; contrapartida: string }
  | { classe: "estorno" }
  | { classe: "aporte" }
  | { classe: "invalido"; motivo: string };

export function lerTipo(texto: string): TipoLido {
  const t = texto.trim().toUpperCase().replace(/\s+/g, " ");
  if (t === "") return { classe: "invalido", motivo: "Tipo vazio" };
  if (t === "ESTORNO") return { classe: "estorno" };
  if (t === "APORTE") return { classe: "aporte" };
  if (CONTRAPARTIDAS.has(normalizarTexto(t))) return { classe: "transferencia", contrapartida: t };
  const m = /^(.*?)\s*(?:([1-4])\s*T)?\s*((?:19|20)\d\d)$/.exec(t);
  if (!m) return { classe: "invalido", motivo: "Tipo sem ano de competência" };
  const palavras = m[1].trim().split(" ").filter(Boolean);
  let sigla: string | null = null;
  if (palavras.length > 1 && palavras[0] in SIGLAS_DE_EMPRESA) sigla = palavras.shift()!;
  const grupo = palavras.join(" ");
  if (grupo === "" || grupo in SIGLAS_DE_EMPRESA) return { classe: "invalido", motivo: "Tipo sem grupo da DRE" };
  if (/\b[1-4]T\b/.test(grupo)) return { classe: "invalido", motivo: "Trimestre fora do lugar no Tipo" };
  return { classe: "dre", sigla, grupo, trimestre: m[2] ? Number(m[2]) : null, ano: Number(m[3]) };
}

export function empresaDaSigla(sigla: string | null): string {
  return sigla ? SIGLAS_DE_EMPRESA[sigla] ?? sigla : EMPRESA_SEM_PREFIXO;
}

/** Em qual coluna a planilha procura o job desta linha. */
export function colunaDoJob(sigla: string | null): "job" | "evento" {
  return sigla !== null && SIGLAS_COM_JOB_NO_EVENTO.has(sigla) ? "evento" : "job";
}

/** O texto da coluna do job é um job de verdade (e não "n/a", "Impostos", "Hitlab 2023"…)? */
export function pareceJob(texto: string): boolean {
  const t = normalizarTexto(texto);
  return !NAO_E_JOB.has(t) && !EMPRESA_NO_LUGAR_DO_JOB.test(t);
}

/**
 * Onde acaba a lista de jobs numa aba de resultado: embaixo dos jobs a
 * planilha tem blocos de resumo (ponto de equilíbrio, resultado por cliente,
 * a DRE do semestre, a conferência com a DRE), que não são job.
 */
export function inicioDoResumo(nome: string): boolean {
  const t = normalizarTexto(nome);
  return (
    t.startsWith("PONTO EQ") ||
    t.startsWith("PONTO DE EQUILIBRIO") ||
    t.startsWith("RESULTADO POR") ||
    t.startsWith("DRE TOTAL") ||
    t === "PLANILHA RESULTADO DE JOB"
  );
}

/**
 * Uma linha da lista de jobs é job quando tem cliente (texto, não número),
 * trimestre na coluna T ou trimestre/ano no nome.
 */
export function linhaEhJob(nome: string, cliente: string, trimestre: string): boolean {
  if (!nome.trim()) return false;
  const clienteValido = cliente.trim() !== "" && lerNumero(cliente) === null && !cliente.startsWith("#");
  return clienteValido || /^[1-4]\s*T$/i.test(trimestre.trim()) || /[1-4]\s*T\s*(19|20)\d\d/i.test(nome);
}

export function lerNumero(texto: string): number | null {
  const t = texto.trim();
  if (t === "") return 0;
  if (!/^-?\d+(\.\d+)?(E[-+]?\d+)?$/i.test(t)) return null;
  return Number(t);
}

export function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

export type ValorLido =
  | { ok: true; natureza: "entrada" | "saida"; valor: number; credito: number; debito: number }
  | { ok: false; motivo: "sem valor" | "valor não numérico" | "crédito e débito na mesma linha" };

/**
 * Crédito e débito da linha → entrada ou saída no caixa. Débito negativo
 * (como a planilha lança alguns estornos) é entrada; crédito negativo é
 * saída. O crédito e o débito originais, com sinal, voltam junto: a DRE da
 * planilha soma a coluna de crédito com sinal (o "abatimento" de uma
 * previsão de recebimento é um crédito negativo), e a validação refaz a
 * mesma conta.
 */
export function lerValor(credito: string, debito: string): ValorLido {
  const c = lerNumero(credito);
  const d = lerNumero(debito);
  if (c === null || d === null) return { ok: false, motivo: "valor não numérico" };
  if (c !== 0 && d !== 0) return { ok: false, motivo: "crédito e débito na mesma linha" };
  const liquido = c - d;
  if (arredondar(liquido) === 0) return { ok: false, motivo: "sem valor" };
  return { ok: true, natureza: liquido > 0 ? "entrada" : "saida", valor: arredondar(Math.abs(liquido)), credito: c, debito: d };
}

/** `AAAA-MM-DD` (com ou sem hora) ou `DD/MM/AAAA` → `AAAA-MM-DD`; ano fora de 2010–2030 é inválido. */
export function lerData(texto: string): string | null {
  const t = texto.trim();
  let iso: string | null = null;
  const m1 = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  const m2 = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m1) iso = `${m1[1]}-${m1[2]}-${m1[3]}`;
  else if (m2) iso = `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  if (!iso) return null;
  const ano = Number(iso.slice(0, 4));
  const data = new Date(`${iso}T00:00:00Z`);
  if (ano < 2010 || ano > 2030 || Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/** "1T 2018" → { trimestre: 1, ano: 2018 }. */
export function lerCompetencia(texto: string): { trimestre: number; ano: number } | null {
  const m = /^([1-4])\s*T\s*((?:19|20)\d\d)$/i.exec(texto.trim());
  return m ? { trimestre: Number(m[1]), ano: Number(m[2]) } : null;
}

const REGIONAIS_DA_CALIFORNIA: ReadonlySet<string> = new Set(["NE", "NO", "SP", "RJ", "SS"]);
const REGIONAIS_DA_CMH: Readonly<Record<string, string>> = { AGE: "Agency", DOC: "Doca", URB: "Urbia" };

/**
 * Regional da linha: a coluna Reg vale para a California e a "CMH Reg" para
 * a CCH; Hitlab e Ventura têm uma regional só. "TD" é rateio entre todas.
 * Os valores antigos da coluna Reg ("ok", "n", "-") não são regional.
 */
export function regionalDaLinha(empresa: string, reg: string, regCmh: string): { regional: string | null; todas: boolean } {
  const r = normalizarTexto(reg);
  const rc = normalizarTexto(regCmh);
  if (empresa === "Hitlab" || empresa === "Ventura") return { regional: empresa, todas: false };
  if (empresa === "CCH") {
    const codigo = REGIONAIS_DA_CMH[rc] ? rc : REGIONAIS_DA_CMH[r] ? r : null;
    if (codigo) return { regional: REGIONAIS_DA_CMH[codigo], todas: false };
    return { regional: null, todas: rc === "TD" || r === "TD" };
  }
  if (empresa === EMPRESA_SEM_PREFIXO) {
    if (REGIONAIS_DA_CALIFORNIA.has(r)) return { regional: r, todas: false };
    return { regional: null, todas: r === "TD" };
  }
  return { regional: null, todas: false };
}

/**
 * Nota de distribuição de lucro (Tiago, 25/10/2026): a Obs. "DL", ou, nas
 * abas da Go Crazy e da Hitlab, a nota sem cliente que traz o nome do sócio
 * no lugar do job. Só vale para nota que não achou job.
 */
export function ehDistribuicaoDeLucro(obs: string, cliente: string, colunaDoJob: string, abaComNotasDeSocio: boolean): boolean {
  if (normalizarTexto(obs) === "DL") return true;
  return abaComNotasDeSocio && cliente.trim() === "" && colunaDoJob.trim() !== "";
}

/** "CANCELADA" no lugar do job marca a nota cancelada. */
export function notaCancelada(colunaDoJob: string): boolean {
  return normalizarTexto(colunaDoJob) === "CANCELADA";
}

/** A regional que mais aparece nos lançamentos de um job; vazia quando não há nenhuma. */
export function regionalMaisFrequente(regionais: readonly string[]): string {
  const contagem = new Map<string, number>();
  for (const r of regionais) if (r) contagem.set(r, (contagem.get(r) ?? 0) + 1);
  let melhor = "";
  for (const [r, n] of contagem) if (n > (contagem.get(melhor) ?? 0)) melhor = r;
  return melhor;
}

/** Código de job do sistema antigo ("AMB-0306/25"). */
export function ehCodigoAntigo(texto: string): boolean {
  return /^[A-Z0-9]{2,4}-\d{4}\/\d{2}$/.test(texto.trim());
}

const SUFIXOS_DE_RAZAO = /\b(LTDA|LIMITADA|S A|SA|EIRELI|ME|EPP|CIA|INC|FILIAL)\b/g;

/** Nome de empresa sem acento, pontuação e sufixo societário, para comparar planilha e cadastro. */
export function chaveDeNome(texto: string): string {
  return normalizarTexto(texto).replace(SUFIXOS_DE_RAZAO, " ").replace(/\s+/g, " ").trim();
}

export type ClienteDoSistema = { sigla: string; fantasia: string; razao: string; marcas: string[] };

export type Proposta = { valor: string; como: "igual" | "pela marca" | "pela sigla" | "parecido" | "ambíguo" | "sem par" };

const semEspaco = (texto: string) => texto.replace(/ /g, "");

/**
 * Cliente da planilha ("Ambev", "Google") → cliente do cadastro. Igual pelo
 * nome (com ou sem espaço: "E RURAL" = "Erural"); senão pela marca ("Youtube"
 * é marca do Google); senão pela sigla do cadastro ("2gb"); senão parecido,
 * se cada palavra da planilha começa uma palavra do nome de um único
 * cliente ("Volks" → "VOLKSWAGEN DO BRASIL").
 */
export function proporCliente(nome: string, clientes: readonly ClienteDoSistema[]): Proposta {
  const chave = chaveDeNome(nome);
  if (!chave) return { valor: "", como: "sem par" };
  const iguais = clientes.filter((c) =>
    [c.fantasia, c.razao].some((n) => chaveDeNome(n) === chave || semEspaco(chaveDeNome(n)) === semEspaco(chave)),
  );
  if (iguais.length === 1) return { valor: iguais[0].sigla, como: "igual" };
  if (iguais.length > 1) return { valor: iguais.map((c) => c.sigla).join(" ou "), como: "ambíguo" };
  const pelaMarca = clientes.filter((c) => c.marcas.some((m) => chaveDeNome(m) === chave));
  if (pelaMarca.length === 1) return { valor: pelaMarca[0].sigla, como: "pela marca" };
  const pelaSigla = clientes.filter((c) => normalizarTexto(c.sigla) === semEspaco(chave));
  if (pelaSigla.length === 1) return { valor: pelaSigla[0].sigla, como: "pela sigla" };
  const palavras = chave.split(" ");
  const parecidos = clientes.filter((c) => {
    const nomes = `${chaveDeNome(c.fantasia)} ${chaveDeNome(c.razao)}`.split(" ");
    const compacto = semEspaco(chaveDeNome(c.fantasia));
    return (
      palavras.every((p) => nomes.includes(p) || (p.length >= 4 && nomes.some((n) => n.startsWith(p)))) ||
      (semEspaco(chave).length >= 5 && compacto.startsWith(semEspaco(chave)))
    );
  });
  if (parecidos.length === 1) return { valor: parecidos[0].sigla, como: "parecido" };
  if (parecidos.length > 1) return { valor: parecidos.map((c) => c.sigla).join(" ou "), como: "ambíguo" };
  return { valor: "", como: "sem par" };
}

/** Marca da planilha ("SKOL") → marca cadastrada no cliente proposto. */
export function proporMarca(marca: string, cliente: ClienteDoSistema | undefined): Proposta {
  const chave = chaveDeNome(marca);
  if (!chave || !cliente) return { valor: "", como: "sem par" };
  const igual = cliente.marcas.find((m) => chaveDeNome(m) === chave);
  if (igual) return { valor: igual, como: "igual" };
  const parecida = cliente.marcas.filter((m) => chaveDeNome(m).includes(chave) || chave.includes(chaveDeNome(m)));
  if (parecida.length === 1) return { valor: parecida[0], como: "parecido" };
  return { valor: "", como: "sem par" };
}

/**
 * Serviço da planilha (coluna SERV.) → serviço do job no sistema (Always On,
 * Ativação, Fee, Interno, Mídia). No sistema, job de conteúdo é serviço
 * Ativação com a categoria Conteúdo: por isso "CONT" e "CLIPE" vão para
 * Ativação, como "Atv/Cont". O texto da planilha fica guardado no histórico.
 */
export function proporServico(servico: string): Proposta {
  const s = normalizarTexto(servico);
  if (s === "") return { valor: "", como: "sem par" };
  if (s === "FEE") return { valor: "Fee", como: "igual" };
  if (s === "AON" || s === "ALWAYS ON") return { valor: "Always On", como: "igual" };
  if (s === "MIDIA") return { valor: "Mídia", como: "igual" };
  if (["ATV CONT", "CONT ATV", "ATV", "CONT", "CLIPE", "CLIPE 1"].includes(s)) return { valor: "Ativação", como: "parecido" };
  return { valor: "", como: "sem par" };
}
