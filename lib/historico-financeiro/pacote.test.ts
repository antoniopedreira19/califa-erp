/**
 * Testes do pacote de carga do histórico financeiro (decisão 211, A1): o
 * contrato entre o script que empacota e a tela que carrega, e a montagem das
 * linhas a partir do padronizado. Os valores são fictícios.
 *
 * Rode com:  node --import tsx --test lib/historico-financeiro/pacote.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { linhaDeJob, linhaDeMovimento, linhasDeSaldo, linhasDoRateio, type FonteDoRateio, type LinhaLida } from "./empacotar";
import {
  COLUNAS_DO_PACOTE,
  FORMATO_DO_PACOTE,
  TABELAS_DO_PACOTE,
  colunasConferem,
  lerPacote,
  linhaComoObjeto,
  partesDaTabela,
  somaEmTexto,
  type Pacote,
  type TabelaDoPacote,
} from "./pacote";

const MOVIMENTO: LinhaLida = {
  conta: "Conta Exemplo",
  data: "2023-01-10",
  valor: "150.25",
  natureza: "saida",
  credito_planilha: "",
  debito_planilha: "150.25",
  classe: "dre",
  empresa: "Agência California",
  sigla_planilha: "",
  grupo: "CF",
  cod: "Alu",
  competencia_trimestre: "1",
  competencia_ano: "2023",
  plano_tipo: "04",
  plano_subtipo: "04.003",
  regional: "",
  regional_todas: "sim",
  regional_planilha: "TD",
  job_id: "",
  job_nome: "",
  job_achado_em: "",
  tipo_planilha: "CF 1T 2023",
  descricao: "Aluguel",
  fornecedor: "FORNECEDOR 001 EXEMPLO",
  parcela: "",
  documento: "",
  observacao: "",
  contrapartida: "",
  coluna_jobs: "",
  coluna_evento: "",
  coluna_reg: "TD",
  coluna_reg_cmh: "",
  dre_extra: "",
  ano_comp: "",
  aba: "Conta Exemplo",
  linha: "12",
  digital: "0123456789abcdef",
};

function pacoteCom(movimentos: unknown[][]): Pacote {
  const vazio = (t: TabelaDoPacote) => ({ colunas: COLUNAS_DO_PACOTE[t].map((c) => c.nome), linhas: [] as never[] });
  return {
    formato: FORMATO_DO_PACOTE,
    carga: { nome: "Teste", de: "2023-01-01", ate: "2023-01-31" },
    planilha: { versao: "2026-10-25", arquivo: "origem.xlsx", sha256: "a".repeat(64), exportado_em: null },
    esperado: {
      movimentos: { linhas: movimentos.length, soma: "-150.25" },
      notas: { linhas: 0, soma: "0.00" },
      jobs: { linhas: 0 },
      rateio: { linhas: 0 },
      saldos: { linhas: 0 },
    },
    tabelas: {
      movimentos: { ...vazio("movimentos"), linhas: movimentos as Pacote["tabelas"]["movimentos"]["linhas"] },
      notas: vazio("notas"),
      jobs: vazio("jobs"),
      rateio: vazio("rateio"),
      saldos: vazio("saldos"),
    },
  };
}

test("movimento: sinal pela natureza, subtipo sem o tipo na frente e TD como todas", () => {
  const linha = linhaDeMovimento(MOVIMENTO);
  const r = linhaComoObjeto("movimentos", linha);
  assert.ok(r.ok);
  assert.equal(r.linha.valor, -150.25);
  assert.equal(r.linha.plano_subtipo, "003");
  assert.equal(r.linha.regional_todas, true);
  assert.equal(r.linha.regional, null);
  assert.equal(r.linha.linha, 12);
  assert.equal(linhaDeMovimento({ ...MOVIMENTO, natureza: "entrada" })[2], 150.25);
});

test("job: a regional TD vira todas, sem regional", () => {
  const job: LinhaLida = {
    id: "evento:JOB EXEMPLO 1T 2026",
    nome: "Job Exemplo 1T 2026",
    empresa: "CCH",
    aba: "Res. Jobs CMH 2026",
    linha: "5",
    ano: "2026",
    trimestre: "1T",
    projeto: "",
    cliente_sistema: "EXE",
    cliente: "Cliente Exemplo",
    marca_sistema: "",
    marca: "",
    servico_sistema: "Fee",
    servico: "FEE",
    gp: "",
    data_inicio: "2026-01-05",
    regional: "",
    regional_por: "todas (rateio)",
    regional_planilha: "TD",
    marcador: "",
    status: "FECHADO",
    codigo_antigo: "",
    job_sistema: "",
    fora_do_resultado: "",
    outras_abas: "",
  };
  const r = linhaComoObjeto("jobs", linhaDeJob(job));
  assert.ok(r.ok);
  assert.equal(r.linha.regional_todas, true);
  assert.equal(r.linha.chave, "evento:JOB EXEMPLO 1T 2026");
  assert.equal(r.linha.cliente_sigla, "EXE");
});

test("linha que não serve: campo a menos ou formato errado", () => {
  const linha = linhaDeMovimento(MOVIMENTO);
  const curta = linhaComoObjeto("movimentos", linha.slice(1));
  assert.equal(curta.ok, false);
  const dataErrada = [...linha];
  dataErrada[1] = "10/01/2023";
  const r = linhaComoObjeto("movimentos", dataErrada);
  assert.ok(!r.ok);
  assert.match(r.message, /"data"/);
});

test("colunas do pacote: os mesmos nomes, na mesma ordem", () => {
  const nomes = COLUNAS_DO_PACOTE.rateio.map((c) => c.nome);
  assert.equal(colunasConferem("rateio", nomes), true);
  assert.equal(colunasConferem("rateio", [...nomes].reverse()), false);
  assert.equal(colunasConferem("rateio", nomes.slice(1)), false);
});

test("lerPacote: confere o formato, as colunas e as linhas declaradas", () => {
  const pacote = pacoteCom([linhaDeMovimento(MOVIMENTO)]);
  const ok = lerPacote(JSON.stringify(pacote));
  assert.ok(ok.ok);
  assert.equal(ok.pacote.tabelas.movimentos.linhas.length, 1);

  assert.equal(lerPacote("{não é json").ok, false);
  assert.equal(lerPacote(JSON.stringify({ ...pacote, formato: "outro" })).ok, false);
  const aMais = lerPacote(JSON.stringify({ ...pacote, esperado: { ...pacote.esperado, movimentos: { linhas: 2, soma: "0.00" } } }));
  assert.ok(!aMais.ok);
  assert.match(aMais.message, /diz 2 linhas de movimentos e traz 1/);
  for (const t of TABELAS_DO_PACOTE) assert.ok(pacote.tabelas[t].colunas.length > 0);
});

test("partes: até o limite de linhas e de bytes, sem parte vazia", () => {
  const linhas = Array.from({ length: 10 }, (_, k) => ["x".repeat(98), k]);
  assert.deepEqual(partesDaTabela(linhas, 1_000_000, 4).map((p) => p.length), [4, 4, 2]);
  // Cada linha tem pouco mais de 100 bytes: cabem duas em 250.
  assert.deepEqual(partesDaTabela(linhas, 250, 100).map((p) => p.length), [2, 2, 2, 2, 2]);
  // Uma linha maior que o limite vai sozinha numa parte.
  assert.deepEqual(partesDaTabela([["y".repeat(500)]], 100, 10).map((p) => p.length), [1]);
  assert.deepEqual(partesDaTabela([], 100, 10), []);
});

test("soma em texto, em centavos", () => {
  assert.equal(somaEmTexto([0.1, 0.2]), "0.30");
  assert.equal(somaEmTexto([-150.25, 100, null]), "-50.25");
  assert.equal(somaEmTexto([]), "0.00");
  assert.equal(somaEmTexto([-0.05]), "-0.05");
});

test("rateio: fração vira percentual; regional da CMH pelo nome do cadastro; célula vazia fica de fora", () => {
  const aba = new Map<number, string[]>([
    [4, ["4", "", "", "", "", "AGE", "DOC", "URB", ""]],
    [143, ["143", "", "", "", "", "0.25", "0.5", "0.25", "1"]],
  ]);
  const fonte: FonteDoRateio = { ano: 2023, empresa: "CCH", aba: "Gerencial 23 CMH", linha: 143, cabecalho: 4, colunas: "EFGH" };
  const { linhas, soma } = linhasDoRateio(fonte, aba);
  assert.equal(soma, 100);
  assert.deepEqual(
    linhas.map((l) => [l[4], l[5]]),
    [
      ["Agency", 25],
      ["Doca", 50],
      ["Urbia", 25],
    ],
  );
  assert.equal(linhas[0][6], "Gerencial 23 CMH, linha 143");

  const california = new Map<number, string[]>([
    [4, ["4", "", "", "", "", "NE", "NO", "SP", "SS", "RJ"]],
    [147, ["147", "", "", "", "", "0.265", "0.2", "0.3", "", "0.235"]],
  ]);
  const linha147: FonteDoRateio = {
    ano: 2024,
    trimestre: 4,
    grupos: ["IMOB", "PL"],
    empresa: "Agência California",
    aba: "Gerencial 24",
    linha: 147,
    cabecalho: 4,
    colunas: "EFGHI",
  };
  const r = linhasDoRateio(linha147, california);
  // SS vazio fica de fora; cada regional sai uma vez por grupo, com o trimestre.
  assert.equal(r.linhas.length, 8);
  assert.deepEqual(r.linhas[0], [2024, 4, "Agência California", "IMOB", "NE", 26.5, "Gerencial 24, linha 147"]);
  assert.equal(r.soma, 100);
});

test("saldos: abertura com o último saldo antes do período e os meses do período", () => {
  const meses: LinhaLida[] = [
    { mes: "2022-10", saldo_planilha_fim_do_mes: "1000.00", saldo_encadeado: "1000.00", movimento_padronizado: "50.00" },
    { mes: "2023-01", saldo_planilha_fim_do_mes: "900.00", saldo_encadeado: "900.00", movimento_padronizado: "-100.00" },
    { mes: "2023-03", saldo_planilha_fim_do_mes: "", saldo_encadeado: "950.00", movimento_padronizado: "50.00" },
    { mes: "2023-05", saldo_planilha_fim_do_mes: "999.00", saldo_encadeado: "999.00", movimento_padronizado: "49.00" },
  ];
  const linhas = linhasDeSaldo("Conta Exemplo", meses, "2023-01-01", "2023-03-31");
  assert.deepEqual(linhas, [
    ["Conta Exemplo", "2022-12-01", 1000, null, true],
    ["Conta Exemplo", "2023-01-01", 900, -100, false],
    ["Conta Exemplo", "2023-03-01", null, 50, false],
  ]);
  // Conta que começa depois: sem linha de abertura.
  assert.deepEqual(linhasDeSaldo("Conta Nova", meses.slice(1), "2023-01-01", "2023-01-31"), [
    ["Conta Nova", "2023-01-01", 900, -100, false],
  ]);
});
