/**
 * Cadastro de impostos (módulo fiscal, 02/10/2026): as contas puras e a
 * validação das edições. Rodar:
 *   node --import tsx --test lib/validations/fiscal-cadastro.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aliquotasPisCofins,
  cidadeDoCadastro,
  diaDoMesValido,
  estabelecimentoSchema,
  formatarCodigoCnae,
  lerDiaDoMes,
  lerPercentual,
  matrizDaEmpresa,
  mensagemDaRaiz,
  nomeSugerido,
  novaVigenciaCnaeSchema,
  novaVigenciaParametrosSchema,
  novoCnaeSchema,
  novoEstabelecimentoSchema,
  novoFeriadoSchema,
  ordemDoNovo,
  percentualParaCampo,
  primeiroDiaDoMesSeguinte,
  problemaDoNovoEstabelecimento,
  raizDoCnpjFormatada,
  vesperaDaVigencia,
  type EmpresaDoNovoCnpj,
} from "./fiscal-cadastro";

const ID = "304039bd-509d-4536-aa26-44e7091ee718";

test("máscara do CNAE vai pondo os separadores", () => {
  assert.equal(formatarCodigoCnae("82"), "82");
  assert.equal(formatarCodigoCnae("823"), "82.3");
  assert.equal(formatarCodigoCnae("8230"), "82.30");
  assert.equal(formatarCodigoCnae("82300"), "82.30-0");
  assert.equal(formatarCodigoCnae("823000"), "82.30-0-0");
  assert.equal(formatarCodigoCnae("8230001"), "82.30-0-01");
  assert.equal(formatarCodigoCnae("82.30-0-01"), "82.30-0-01");
  assert.equal(formatarCodigoCnae("82300019999"), "82.30-0-01");
});

test("percentual com vírgula, ponto, por cento e vazio", () => {
  assert.equal(lerPercentual("2,5"), 2.5);
  assert.equal(lerPercentual("2.5"), 2.5);
  assert.equal(lerPercentual(" 0,65 "), 0.65);
  assert.equal(lerPercentual("5%"), 5);
  assert.equal(lerPercentual(""), null);
  assert.equal(lerPercentual(null), null);
  assert.ok(Number.isNaN(lerPercentual("dois") as number));
  assert.ok(Number.isNaN(lerPercentual("1,2,3") as number));
  assert.equal(percentualParaCampo(1.65), "1,65");
  assert.equal(percentualParaCampo(null), "");
});

test("a linha atual fecha na véspera da vigência nova", () => {
  assert.equal(vesperaDaVigencia("2026-12-01"), "2026-11-30");
  assert.equal(vesperaDaVigencia("2027-01-01"), "2026-12-31");
  assert.equal(vesperaDaVigencia("2028-03-01"), "2028-02-29");
});

test("sugestão de vigência: primeiro dia do mês seguinte", () => {
  assert.equal(primeiroDiaDoMesSeguinte("2026-11-04"), "2026-12-01");
  assert.equal(primeiroDiaDoMesSeguinte("2026-12-15"), "2027-01-01");
  assert.equal(primeiroDiaDoMesSeguinte("2026-10-02"), "2026-11-01");
});

test("PIS e COFINS seguem a opção de crédito", () => {
  const naoCumulativo = { aliquota_pis: 1.65, aliquota_cofins: 7.6, cumulativo: false };
  const cumulativo = { aliquota_pis: 0.65, aliquota_cofins: 3, cumulativo: true };
  // Mantida a opção, ficam as alíquotas da linha.
  assert.deepEqual(aliquotasPisCofins(false, naoCumulativo), { aliquota_pis: 1.65, aliquota_cofins: 7.6 });
  assert.deepEqual(aliquotasPisCofins(true, cumulativo), { aliquota_pis: 0.65, aliquota_cofins: 3 });
  // Trocada, valem as do regime escolhido.
  assert.deepEqual(aliquotasPisCofins(true, naoCumulativo), { aliquota_pis: 0.65, aliquota_cofins: 3 });
  assert.deepEqual(aliquotasPisCofins(false, cumulativo), { aliquota_pis: 1.65, aliquota_cofins: 7.6 });
  // CNAE novo.
  assert.deepEqual(aliquotasPisCofins(false), { aliquota_pis: 1.65, aliquota_cofins: 7.6 });
  assert.deepEqual(aliquotasPisCofins(true, null), { aliquota_pis: 0.65, aliquota_cofins: 3 });
});

const estab = (o: Record<string, unknown>) =>
  estabelecimentoSchema.safeParse({ id: ID, cnpj: "", ativo: false, iss_dia: 10, iss_retido_dia: 10, iss_regra: "prorroga", observacao: "", ...o });

test("CNPJ emissor: máscara sai, dígito verificador confere, ativar pede CNPJ", () => {
  const ok = estab({ cnpj: "19.437.976/0001-54", ativo: true });
  assert.ok(ok.success);
  assert.equal(ok.data.cnpj, "19437976000154");
  assert.equal(ok.data.observacao, null);

  const semCnpj = estab({});
  assert.ok(semCnpj.success);
  assert.equal(semCnpj.data.cnpj, null);

  const dv = estab({ cnpj: "19.437.976/0001-55" });
  assert.ok(!dv.success);
  assert.equal(dv.error.issues[0].message, "CNPJ inválido: confira os dígitos.");

  const curto = estab({ cnpj: "19.437.976/0001" });
  assert.ok(!curto.success);
  assert.equal(curto.error.issues[0].message, "O CNPJ tem 14 dígitos.");

  const ativarSem = estab({ ativo: true });
  assert.ok(!ativarSem.success);
  assert.equal(ativarSem.error.issues[0].message, "Para ativar, informe o CNPJ.");

  const diaRuim = estab({ iss_dia: 32 });
  assert.ok(!diaRuim.success);
  assert.equal(diaRuim.error.issues[0].message, "Dia do ISS: informe um dia de 1 a 31.");

  const obs = estab({ observacao: "  a confirmar  " });
  assert.ok(obs.success);
  assert.equal(obs.data.observacao, "a confirmar");
});

test("Editar alíquotas: ISS com vírgula, vazio vira nulo, texto é recusado", () => {
  const base = { cnae_id: ID, vigencia_inicio: "2026-12-01", cumulativo: false };
  const r1 = novaVigenciaCnaeSchema.safeParse({ ...base, aliquota_iss: "2,5" });
  assert.ok(r1.success);
  assert.equal(r1.data.aliquota_iss, 2.5);
  const r2 = novaVigenciaCnaeSchema.safeParse({ ...base, aliquota_iss: "" });
  assert.ok(r2.success);
  assert.equal(r2.data.aliquota_iss, null);
  const r3 = novaVigenciaCnaeSchema.safeParse({ ...base, aliquota_iss: "dois" });
  assert.ok(!r3.success);
  assert.equal(r3.error.issues[0].message, "ISS: use só números, como 2 ou 2,5.");
  const r4 = novaVigenciaCnaeSchema.safeParse({ ...base, aliquota_iss: "100" });
  assert.ok(!r4.success);
  const r5 = novaVigenciaCnaeSchema.safeParse({ ...base, aliquota_iss: "2", vigencia_inicio: "" });
  assert.ok(!r5.success);
});

test("Novo CNAE: código pela máscara, subitem com vírgula, descrição obrigatória", () => {
  const base = { estabelecimento_id: ID, descricao: "Produção musical", aliquota_iss: "5", cumulativo: false, vigencia_inicio: "2026-11-01" };
  const r1 = novoCnaeSchema.safeParse({ ...base, codigo: "9001902", subitem: "" });
  assert.ok(r1.success);
  assert.equal(r1.data.codigo, "90.01-9-02");
  assert.equal(r1.data.subitem, null);
  const r2 = novoCnaeSchema.safeParse({ ...base, codigo: "82.30-0-01", subitem: "12,08" });
  assert.ok(r2.success);
  assert.equal(r2.data.subitem, "12.08");
  const r3 = novoCnaeSchema.safeParse({ ...base, codigo: "82.30-0" });
  assert.ok(!r3.success);
  assert.equal(r3.error.issues[0].message, "Código do CNAE no formato 00.00-0-00.");
  const r4 = novoCnaeSchema.safeParse({ ...base, codigo: "8230001", subitem: "12" });
  assert.ok(!r4.success);
  const r5 = novoCnaeSchema.safeParse({ ...base, codigo: "8230001", descricao: "  " });
  assert.ok(!r5.success);
});

test("Feriado: nacional sem cidade, local com cidade", () => {
  const n = novoFeriadoSchema.safeParse({ data: "2027-06-24", nome: "São João", municipio: null });
  assert.ok(n.success);
  assert.equal(n.data.municipio, null);
  const l = novoFeriadoSchema.safeParse({ data: "2027-06-24", nome: " São João ", municipio: "Salvador" });
  assert.ok(l.success);
  assert.equal(l.data.nome, "São João");
  assert.equal(l.data.municipio, "Salvador");
  assert.ok(!novoFeriadoSchema.safeParse({ data: "2027-06-24", nome: "", municipio: null }).success);
});

test("dia do vencimento digitado: inteiro de 1 a 31, vazio é nulo", () => {
  assert.equal(lerDiaDoMes("25"), 25);
  assert.equal(lerDiaDoMes(" 7 "), 7);
  assert.equal(lerDiaDoMes(20), 20);
  assert.equal(lerDiaDoMes(""), null);
  assert.equal(lerDiaDoMes(null), null);
  assert.ok(Number.isNaN(lerDiaDoMes("2,5") as number));
  assert.ok(Number.isNaN(lerDiaDoMes("vinte") as number));
  assert.ok(diaDoMesValido(1));
  assert.ok(diaDoMesValido(31));
  assert.ok(!diaDoMesValido(0));
  assert.ok(!diaDoMesValido(32));
  assert.ok(!diaDoMesValido(24.5));
  assert.ok(!diaDoMesValido(Number.NaN));
  assert.ok(!diaDoMesValido(null));
});

test("Parâmetros: os dias dos federais só aceitam dia de 1 a 31; os demais seguem como antes", () => {
  const um = (chave: string, valor: number) =>
    novaVigenciaParametrosSchema.safeParse({ vigencia_inicio: "2026-11-01", valores: [{ chave, valor }] });
  assert.ok(um("pis_cofins_dia", 24).success);
  assert.ok(um("retencoes_dia", 31).success);
  for (const [chave, valor] of [
    ["pis_cofins_dia", 0],
    ["pis_cofins_dia", 32],
    ["retencoes_dia", 19.5],
  ] as const) {
    const r = um(chave, valor);
    assert.ok(!r.success);
    assert.equal(r.error.issues[0].message, "Dia do vencimento: informe um dia de 1 a 31.");
    assert.deepEqual(r.error.issues[0].path, ["valores", 0, "valor"]);
  }
  // Alíquota e valor em reais não são dia: nada muda para eles.
  assert.ok(um("irpj", 15.5).success);
  assert.ok(um("darf_minimo", 0).success);
  // Com mais de um valor, o erro aponta o dia.
  const varios = novaVigenciaParametrosSchema.safeParse({
    vigencia_inicio: "2026-11-01",
    valores: [
      { chave: "csll", valor: 9 },
      { chave: "retencoes_dia", valor: 40 },
    ],
  });
  assert.ok(!varios.success);
  assert.deepEqual(varios.error.issues[0].path, ["valores", 1, "valor"]);
});

// ---------------------------------------------------------------------------
// Novo CNPJ emissor (03/10/2026)
// ---------------------------------------------------------------------------

const EMPRESA = "4eae2860-b7c7-4c20-b3f9-6482cf3a7bf7";

const novoEstab = (o: Record<string, unknown>) =>
  novoEstabelecimentoSchema.safeParse({
    empresa_contabil_id: EMPRESA,
    papel: "filial",
    municipio: "Recife",
    uf: "PE",
    nome: "California · Recife",
    cnpj: "",
    ativo: false,
    iss_dia: "10",
    iss_retido_dia: "10",
    iss_regra: "prorroga",
    observacao: "",
    ...o,
  });

test("Novo CNPJ emissor: campos da edição e os da criação, com máscara e espaços limpos", () => {
  const ok = novoEstab({
    cnpj: "19.437.976/0001-54",
    ativo: true,
    municipio: "  Rio   de Janeiro ",
    nome: " California ·  Rio ",
  });
  assert.ok(ok.success);
  assert.equal(ok.data.cnpj, "19437976000154");
  assert.equal(ok.data.municipio, "Rio de Janeiro");
  assert.equal(ok.data.nome, "California · Rio");
  assert.equal(ok.data.iss_dia, 10);
  assert.equal(ok.data.observacao, null);

  // Sem CNPJ, nasce inativo (como as filiais da carga): "CNPJ a informar".
  const semCnpj = novoEstab({});
  assert.ok(semCnpj.success);
  assert.equal(semCnpj.data.cnpj, null);
  assert.equal(semCnpj.data.ativo, false);
});

test("Novo CNPJ emissor: cada campo obrigatório com a sua mensagem, na ordem da tela", () => {
  const msg = (o: Record<string, unknown>) => {
    const r = novoEstab(o);
    assert.ok(!r.success);
    return r.error.issues[0].message;
  };
  assert.equal(msg({ empresa_contabil_id: "" }), "Escolha a empresa contábil.");
  assert.equal(msg({ empresa_contabil_id: undefined }), "Escolha a empresa contábil.");
  assert.equal(msg({ papel: "" }), "Escolha se o CNPJ é da matriz ou de uma filial.");
  assert.equal(msg({ municipio: "   " }), "Informe o município.");
  assert.equal(msg({ uf: "" }), "Escolha a UF.");
  assert.equal(msg({ uf: "XX" }), "Escolha a UF.");
  assert.equal(msg({ nome: "" }), "Informe o nome do estabelecimento.");
  assert.equal(msg({ nome: "x".repeat(81) }), "Nome: até 80 caracteres.");
  assert.equal(msg({ cnpj: "19.437.976/0001-55" }), "CNPJ inválido: confira os dígitos.");
  assert.equal(msg({ cnpj: "19.437.976/0001" }), "O CNPJ tem 14 dígitos.");
  assert.equal(msg({ cnpj: "11.111.111/1111-11" }), "CNPJ inválido: confira os dígitos.");
  assert.equal(msg({ ativo: true }), "Para ativar, informe o CNPJ.");
  assert.equal(msg({ iss_dia: "" }), "Dia do ISS: informe um dia de 1 a 31.");
  assert.equal(msg({ iss_retido_dia: "32" }), "Dia do ISS retido: informe um dia de 1 a 31.");
  assert.equal(msg({ iss_regra: "" }), "Escolha o que acontece em dia não útil.");
  assert.equal(msg({ observacao: "x".repeat(501) }), "Observação: até 500 caracteres.");
  // Com mais de um campo vazio, vale o primeiro da tela.
  assert.equal(msg({ empresa_contabil_id: "", nome: "", iss_dia: "" }), "Escolha a empresa contábil.");
});

test("município com a grafia do cadastro; nome sugerido; raiz do CNPJ", () => {
  const cidades = ["Salvador", "São Paulo", "Santo André"];
  assert.equal(cidadeDoCadastro("salvador", cidades), "Salvador");
  assert.equal(cidadeDoCadastro("  sao   paulo ", cidades), "São Paulo");
  assert.equal(cidadeDoCadastro("SANTO ANDRE", cidades), "Santo André");
  assert.equal(cidadeDoCadastro(" Recife ", cidades), "Recife");
  assert.equal(cidadeDoCadastro("", cidades), "");

  assert.equal(nomeSugerido("California", "Recife"), "California · Recife");
  assert.equal(nomeSugerido("California", "  "), "");
  assert.equal(nomeSugerido("", "Recife"), "");

  assert.equal(raizDoCnpjFormatada("19437976000154"), "19.437.976");
  assert.equal(raizDoCnpjFormatada(null), "");
  const california = { razao_social: "CALIFÓRNIA FILMES E PUBLICIDADE LTDA", cnpj: "19437976000154" };
  assert.equal(mensagemDaRaiz("19437976000235", california), null);
  assert.equal(
    mensagemDaRaiz("29943648000183", california),
    "Esse CNPJ não é da CALIFÓRNIA FILMES E PUBLICIDADE LTDA: os CNPJs dela começam com 19.437.976.",
  );
  assert.equal(mensagemDaRaiz("29943648000183", { razao_social: "Sem CNPJ", cnpj: null }), null);
});

// O cadastro de hoje (03/10/2026): California com matriz e duas filiais sem
// CNPJ, GoCrazy e Hitlab só com a matriz.
const CADASTRO = [
  { empresa_contabil_id: EMPRESA, nome: "California · Salvador", cnpj: "19437976000154", papel: "matriz", ordem: 1 },
  { empresa_contabil_id: EMPRESA, nome: "California · São Paulo", cnpj: null, papel: "filial", ordem: 2 },
  { empresa_contabil_id: EMPRESA, nome: "California · Fortaleza", cnpj: null, papel: "filial", ordem: 3 },
  { empresa_contabil_id: "gocrazy", nome: "GoCrazy · Santo André", cnpj: "29943648000183", papel: "matriz", ordem: 4 },
  { empresa_contabil_id: "hitlab", nome: "Hitlab · Salvador", cnpj: "04409741000181", papel: "matriz", ordem: 5 },
];

const CALIFORNIA: EmpresaDoNovoCnpj = {
  id: EMPRESA,
  nome: "California",
  razao_social: "CALIFÓRNIA FILMES E PUBLICIDADE LTDA",
  cnpj: "19437976000154",
  ativo: true,
};
const NOVA: EmpresaDoNovoCnpj = { id: "nova", nome: "Exemplo", razao_social: "EXEMPLO SERVIÇOS LTDA", cnpj: "11222333000181", ativo: true };

test("Novo CNPJ emissor: uma matriz por empresa, filial só depois da matriz", () => {
  assert.equal(matrizDaEmpresa(CADASTRO, EMPRESA)?.nome, "California · Salvador");
  assert.equal(matrizDaEmpresa(CADASTRO, "nova"), null);

  const filial = { papel: "filial" as const, nome: "California · Recife", cnpj: null };
  assert.equal(problemaDoNovoEstabelecimento(filial, CALIFORNIA, CADASTRO), null);
  assert.equal(
    problemaDoNovoEstabelecimento({ ...filial, papel: "matriz" }, CALIFORNIA, CADASTRO),
    "A California já tem matriz: California · Salvador. Cadastre este CNPJ como filial.",
  );

  const daNova = { papel: "matriz" as const, nome: "Exemplo · Salvador", cnpj: "11222333000181" };
  assert.equal(problemaDoNovoEstabelecimento(daNova, NOVA, CADASTRO), null);
  assert.equal(
    problemaDoNovoEstabelecimento({ ...daNova, papel: "filial" }, NOVA, CADASTRO),
    "A Exemplo ainda não tem matriz no cadastro. Cadastre a matriz primeiro: os impostos federais se apuram por ela.",
  );
  assert.equal(
    problemaDoNovoEstabelecimento(daNova, { ...NOVA, ativo: false }, CADASTRO),
    "A Exemplo está inativa nas empresas contábeis.",
  );
});

test("Novo CNPJ emissor: nome e CNPJ repetidos, CNPJ de outra empresa", () => {
  const filial = { papel: "filial" as const, nome: "California · Recife", cnpj: null };
  // O nome repete mesmo com outra caixa e sem acento.
  assert.equal(
    problemaDoNovoEstabelecimento({ ...filial, nome: "california · sao paulo" }, CALIFORNIA, CADASTRO),
    "Já existe um CNPJ emissor com o nome California · São Paulo.",
  );
  // CNPJ da filial: a raiz da California e um número que não está no cadastro.
  assert.equal(problemaDoNovoEstabelecimento({ ...filial, cnpj: "19437976000235" }, CALIFORNIA, CADASTRO), null);
  assert.equal(
    problemaDoNovoEstabelecimento({ ...filial, cnpj: "29943648000183" }, CALIFORNIA, CADASTRO),
    "Esse CNPJ não é da CALIFÓRNIA FILMES E PUBLICIDADE LTDA: os CNPJs dela começam com 19.437.976.",
  );
  assert.equal(
    problemaDoNovoEstabelecimento({ ...filial, cnpj: "19437976000154" }, CALIFORNIA, CADASTRO),
    "Esse CNPJ já está no cadastro: California · Salvador.",
  );
});

test("Novo CNPJ emissor entra no fim da lista", () => {
  assert.equal(ordemDoNovo(CADASTRO), 6);
  assert.equal(ordemDoNovo([]), 1);
});
