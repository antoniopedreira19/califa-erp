/**
 * Do padronizado (E2) ao pacote de carga (A1, decisão 211): as linhas de cada
 * tabela na ordem de `COLUNAS_DO_PACOTE`, o rateio lido das células das abas
 * Gerencial e os saldos da planilha no fim de cada mês. Funções puras; quem
 * lê e escreve os arquivos é `scripts/historico-financeiro/empacotar.ts`.
 */
import { indiceDaColuna } from "./csv";
import { COLUNAS_DO_PACOTE, type TabelaDoPacote, type ValorDoPacote } from "./pacote";
import { REGIONAIS_DA_CALIFORNIA, REGIONAIS_DA_CMH, normalizarTexto } from "./regras";

/** Uma linha de CSV do padronizado ou da validação, pelo nome da coluna. */
export type LinhaLida = Record<string, string>;

const texto = (v: string | undefined): string | null => (v !== undefined && v.trim() !== "" ? v : null);
const numero = (v: string | undefined): number | null => (v !== undefined && v.trim() !== "" ? Number(v) : null);

function emOrdem(tabela: TabelaDoPacote, valores: Record<string, ValorDoPacote>): ValorDoPacote[] {
  return COLUNAS_DO_PACOTE[tabela].map((c) => {
    if (!(c.nome in valores)) throw new Error(`Falta a coluna "${c.nome}" na tabela ${tabela}.`);
    return valores[c.nome];
  });
}

/** O movimento com sinal, como no extrato: o que entra é positivo, o que sai é negativo. */
export function linhaDeMovimento(m: LinhaLida): ValorDoPacote[] {
  const valor = Number(m.valor);
  // O padronizado escreve o subtipo com o tipo na frente ("02.999"); o cadastro guarda só "999".
  const subtipo = texto(m.plano_subtipo)?.split(".").pop() ?? null;
  return emOrdem("movimentos", {
    conta: m.conta,
    data: m.data,
    valor: m.natureza === "entrada" ? valor : -valor,
    credito_planilha: numero(m.credito_planilha),
    debito_planilha: numero(m.debito_planilha),
    classe: m.classe,
    empresa: texto(m.empresa),
    sigla_planilha: texto(m.sigla_planilha),
    grupo: texto(m.grupo),
    cod: texto(m.cod),
    competencia_trimestre: numero(m.competencia_trimestre),
    competencia_ano: numero(m.competencia_ano),
    plano_tipo: texto(m.plano_tipo),
    plano_subtipo: subtipo,
    regional: texto(m.regional),
    regional_todas: m.regional_todas === "sim",
    regional_planilha: texto(m.regional_planilha),
    job_chave: texto(m.job_id),
    job_nome: texto(m.job_nome),
    job_coluna: texto(m.job_achado_em),
    tipo_planilha: texto(m.tipo_planilha),
    descricao: texto(m.descricao),
    fornecedor: texto(m.fornecedor),
    parcela: texto(m.parcela),
    documento: texto(m.documento),
    observacao: texto(m.observacao),
    contrapartida: texto(m.contrapartida),
    coluna_jobs: texto(m.coluna_jobs),
    coluna_evento: texto(m.coluna_evento),
    coluna_reg: texto(m.coluna_reg),
    coluna_reg_cmh: texto(m.coluna_reg_cmh),
    dre_extra: texto(m.dre_extra),
    ano_comp: texto(m.ano_comp),
    aba: m.aba,
    linha: Number(m.linha),
    digital: m.digital,
  });
}

export function linhaDeNota(n: LinhaLida): ValorDoPacote[] {
  return emOrdem("notas", {
    empresa: n.empresa,
    empresa_por: texto(n.empresa_por),
    estabelecimento: n.estabelecimento,
    numero: n.numero,
    situacao: n.situacao,
    classe: n.classe,
    emissao: texto(n.emissao),
    competencia_trimestre: numero(n.competencia_trimestre),
    competencia_ano: numero(n.competencia_ano),
    vencimento: texto(n.vencimento),
    recebimento: texto(n.recebimento),
    valor: numero(n.valor),
    deducao: numero(n.deducao),
    valor_tributavel: numero(n.valor_tributavel),
    iss: numero(n.iss),
    pis: numero(n.pis),
    cofins: numero(n.cofins),
    csll: numero(n.csll),
    ir: numero(n.ir),
    adicional_ir: numero(n.adicional_ir),
    retencoes: numero(n.retencoes),
    total_impostos: numero(n.total_impostos),
    job_chave: texto(n.job_id),
    job_nome: texto(n.job_nome),
    coluna_job: texto(n.coluna_job),
    cliente: texto(n.cliente),
    municipio: texto(n.municipio),
    cnae: texto(n.cnae),
    obs: texto(n.obs),
    observacao: texto(n.observacao),
    aba: n.aba,
    linha: Number(n.linha),
  });
}

/**
 * O job vai para a cauda (A6): até o 3T de 2026, ou de ano anterior, e fora
 * do sistema (sem `job_sistema` no de-para). Os jobs do 4T e os que existem
 * no sistema seguem pelo sistema depois do corte.
 */
export function jobDaCauda(j: LinhaLida): boolean {
  if (j.job_sistema) return false;
  const ano = Number(j.ano);
  const tri = Number((j.trimestre || "").replace(/T$/, ""));
  if (!ano) return false;
  if (ano < 2026) return true;
  return ano === 2026 && tri >= 1 && tri <= 3;
}

/** O empréstimo só entra depois de aparecer no extrato. Até aqui, as devoluções
 *  de 20 e 21/10; as de 25/10 estão na planilha e não no banco (extratos até
 *  26/10). Quando aparecerem, esta data anda. */
const EMPRESTIMO_NO_EXTRATO_ATE = "2026-10-21";

/**
 * O movimento depois do corte que vai para a cauda: o do job da cauda
 * (`jobDaCauda`) e, sem job, o do DRE com competência até o 3T de 2026 ou de
 * ano anterior — a folha de setembro, os impostos, os custos fixos, as contas
 * avulsas e as devoluções de empréstimo pagos em outubro (Tiago, 30/10/2026:
 * "no sistema ficam só os do 4T"). Ficam de fora o mútuo, que espera a função
 * própria, a transferência, o estorno e o que não tem competência.
 */
export function movimentoDaCauda(m: LinhaLida, jobsDaCauda: ReadonlySet<string>): boolean {
  if (m.job_id) return jobsDaCauda.has(m.job_id);
  if (m.classe !== "dre" || m.grupo === "MÚTUO INT") return false;
  if (m.grupo === "EMP" && (!m.data || m.data > EMPRESTIMO_NO_EXTRATO_ATE)) return false;
  const ano = Number(m.competencia_ano);
  const tri = Number(m.competencia_trimestre);
  if (!ano || !tri) return false;
  return ano < 2026 || (ano === 2026 && tri >= 1 && tri <= 3);
}

export function linhaDeJob(j: LinhaLida): ValorDoPacote[] {
  return emOrdem("jobs", {
    chave: j.id,
    nome: j.nome,
    empresa: j.empresa,
    aba: j.aba,
    linha: Number(j.linha),
    ano: Number(j.ano),
    trimestre: texto(j.trimestre),
    projeto: texto(j.projeto),
    cliente_sigla: texto(j.cliente_sistema),
    cliente_planilha: texto(j.cliente),
    marca: texto(j.marca_sistema),
    marca_planilha: texto(j.marca),
    servico: texto(j.servico_sistema),
    servico_planilha: texto(j.servico),
    gp: texto(j.gp),
    data_inicio: texto(j.data_inicio),
    regional: texto(j.regional),
    regional_todas: j.regional_por === "todas (rateio)",
    regional_planilha: texto(j.regional_planilha),
    regional_por: texto(j.regional_por),
    marcador: texto(j.marcador),
    status_planilha: texto(j.status),
    codigo_antigo: texto(j.codigo_antigo),
    job_codigo: texto(j.job_sistema),
    fora_do_resultado: texto(j.fora_do_resultado),
    outras_abas: texto(j.outras_abas),
    rateio_regional: texto(j.rateio_regional),
    imposto_teorico_percentual: numero(j.imposto_teorico_percentual),
    fee_percentual: numero(j.fee_percentual),
  });
}

// ---------------------------------------------------------------- rateio

/**
 * Uma linha de percentuais de uma aba Gerencial: a linha dos valores e a do
 * cabeçalho com as regionais. Trimestre e grupos só quando a planilha usa a
 * linha num trimestre e em grupos certos (a linha 147 da Gerencial 24 vale
 * para o imobilizado e o PL do 4T 2024).
 */
export type FonteDoRateio = {
  ano: number;
  trimestre?: number;
  grupos?: readonly string[];
  empresa: "Agência California" | "CCH";
  aba: string;
  linha: number;
  cabecalho: number;
  colunas: string;
};

/** As linhas de percentual que as abas Gerencial usam, conferidas célula a célula (decisão 211). */
export const FONTES_DO_RATEIO: readonly FonteDoRateio[] = [
  { ano: 2022, empresa: "Agência California", aba: "Gerencial 22", linha: 127, cabecalho: 4, colunas: "EFGHIJ" },
  { ano: 2023, empresa: "Agência California", aba: "Gerencial 23", linha: 131, cabecalho: 4, colunas: "EFGHIJ" },
  { ano: 2023, empresa: "CCH", aba: "Gerencial 23 CMH", linha: 143, cabecalho: 4, colunas: "EFGHIJ" },
  { ano: 2024, empresa: "Agência California", aba: "Gerencial 24", linha: 135, cabecalho: 4, colunas: "EFGHIJ" },
  { ano: 2024, trimestre: 4, grupos: ["IMOB", "PL"], empresa: "Agência California", aba: "Gerencial 24", linha: 147, cabecalho: 4, colunas: "EFGHIJ" },
  { ano: 2024, empresa: "CCH", aba: "Gerencial 24 CMH", linha: 185, cabecalho: 4, colunas: "EFGHIJ" },
  { ano: 2025, empresa: "Agência California", aba: "Gerencial 25", linha: 224, cabecalho: 4, colunas: "EFGHIJ" },
  { ano: 2025, empresa: "CCH", aba: "Gerencial 25 CMH", linha: 245, cabecalho: 4, colunas: "EFGHIJ" },
  { ano: 2026, empresa: "Agência California", aba: "Gerencial 26", linha: 133, cabecalho: 4, colunas: "EFGHIJ" },
  { ano: 2026, empresa: "CCH", aba: "Gerencial 26", linha: 133, cabecalho: 132, colunas: "QR" },
];

/** A regional do cabeçalho no nome do cadastro, ou `null` se a coluna não é de regional. */
function regionalDoCabecalho(empresa: FonteDoRateio["empresa"], celula: string): string | null {
  const codigo = normalizarTexto(celula);
  if (empresa === "CCH") return REGIONAIS_DA_CMH[codigo] ?? null;
  return REGIONAIS_DA_CALIFORNIA.has(codigo) || codigo === "BH" ? codigo : null;
}

/**
 * As linhas do rateio de uma fonte. `linhasDaAba` é a aba do bruto (E1), pela
 * linha da planilha; a célula guarda a fração (0,265), e o pacote, o
 * percentual (26,5). Célula vazia fica de fora: a regional não recebeu rateio
 * naquele ano.
 */
export function linhasDoRateio(fonte: FonteDoRateio, linhasDaAba: ReadonlyMap<number, readonly string[]>): {
  linhas: ValorDoPacote[][];
  soma: number;
} {
  const cabecalho = linhasDaAba.get(fonte.cabecalho) ?? [];
  const valores = linhasDaAba.get(fonte.linha) ?? [];
  const linhas: ValorDoPacote[][] = [];
  let soma = 0;
  for (const letra of fonte.colunas) {
    const k = indiceDaColuna(letra);
    const regional = regionalDoCabecalho(fonte.empresa, cabecalho[k] ?? "");
    const fracao = numero(valores[k]);
    if (regional === null || fracao === null) continue;
    const percentual = Math.round(fracao * 1_000_000) / 10_000;
    soma += percentual;
    for (const grupo of fonte.grupos ?? [null]) {
      linhas.push(
        emOrdem("rateio", {
          ano: fonte.ano,
          trimestre: fonte.trimestre ?? null,
          empresa: fonte.empresa,
          grupo,
          regional,
          percentual,
          origem: `${fonte.aba}, linha ${fonte.linha}`,
        }),
      );
    }
  }
  return { linhas, soma: Math.round(soma * 10_000) / 10_000 };
}

// ---------------------------------------------------------------- saldos

const mesAnterior = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
};

/**
 * Os saldos de uma conta (linhas de `validacao/saldos.csv`, um mês por linha,
 * só os meses com movimento): o de abertura, no mês antes do período, e o de
 * cada mês do período. O de abertura é o último saldo da planilha até aquele
 * mês — sem movimento depois dele, o saldo não mudou. Conta sem nenhum mês
 * antes do período abre em zero e não leva linha de abertura.
 */
export function linhasDeSaldo(conta: string, meses: readonly LinhaLida[], de: string, ate: string): ValorDoPacote[][] {
  const mesDe = de.slice(0, 7);
  const mesAte = ate.slice(0, 7);
  const abertura = mesAnterior(mesDe);
  const ordenados = [...meses].sort((a, b) => a.mes.localeCompare(b.mes));
  const linhas: ValorDoPacote[][] = [];
  const antes = ordenados.filter((m) => m.mes <= abertura);
  const ultimo = antes[antes.length - 1];
  if (ultimo) {
    const saldo = numero(ultimo.saldo_planilha_fim_do_mes) ?? numero(ultimo.saldo_encadeado);
    if (saldo !== null) {
      linhas.push(emOrdem("saldos", { conta, mes: `${abertura}-01`, saldo_planilha: saldo, movimento: null, abertura: true }));
    }
  }
  for (const m of ordenados) {
    if (m.mes < mesDe || m.mes > mesAte) continue;
    linhas.push(
      emOrdem("saldos", {
        conta,
        mes: `${m.mes}-01`,
        saldo_planilha: numero(m.saldo_planilha_fim_do_mes),
        movimento: numero(m.movimento_padronizado) ?? 0,
        abertura: false,
      }),
    );
  }
  return linhas;
}
