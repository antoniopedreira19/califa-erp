/**
 * O regime tributário do fornecedor no cadastro (módulo fiscal, entrega 1;
 * consulta guardada e arquivo da declaração na decisão 142; Real e
 * Presumido separados e CNAE na decisão 166).
 * Rodar: node --import tsx --test lib/fiscal/regime-do-fornecedor.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cadastroSemRevisao,
  caminhoDaDeclaracao,
  cnaeDepoisDaConsulta,
  consultaDaRespostaDoCnpj,
  consultaDoCadastro,
  consultaParaGravar,
  declaracaoDoTenant,
  formatarCnae,
  listarPendencias,
  nomeDoArquivoDaDeclaracao,
  origemDoCnae,
  origemDoRegime,
  pendenciasDoCadastroFiscal,
  recusaDoArquivoDaDeclaracao,
  regimeDaConsultaDoCnpj,
  regimeDepoisDaConsulta,
  type ConsultaDoRegime,
} from "./regime-do-fornecedor";
import { cadastroFiscalSchema, fornecedorSchema } from "@/lib/validations/fornecedores";

const CNPJ = "64582932000172";
const OUTRO_CNPJ = "11222333000181";
const HOJE = "2026-10-02";
const SIMPLES: ConsultaDoRegime = { cnpj: CNPJ, em: HOJE, regime: "simples", desde: "2019-01-01" };
const MEI: ConsultaDoRegime = { cnpj: CNPJ, em: HOJE, regime: "mei", desde: "2021-03-15" };
const NORMAL: ConsultaDoRegime = { cnpj: CNPJ, em: HOJE, regime: "normal", desde: null };

// ---------------------------------------------------------------------------
// A consulta do CNPJ (BrasilAPI)
// ---------------------------------------------------------------------------

test("a resposta da BrasilAPI dá o regime: MEI antes do Simples; sem opção, normal", () => {
  assert.equal(regimeDaConsultaDoCnpj({ opcao_pelo_simples: true, opcao_pelo_mei: true }), "mei");
  assert.equal(regimeDaConsultaDoCnpj({ opcao_pelo_simples: true, opcao_pelo_mei: false }), "simples");
  // Excluída do Simples (Banco do Brasil na BrasilAPI: false com datas).
  assert.equal(regimeDaConsultaDoCnpj({ opcao_pelo_simples: false, opcao_pelo_mei: false }), "normal");
  // Nunca optou (Petrobras na BrasilAPI: tudo nulo).
  assert.equal(regimeDaConsultaDoCnpj({ opcao_pelo_simples: null, opcao_pelo_mei: null }), "normal");
});

test("resposta sem os campos de opção não deduz regime", () => {
  assert.equal(regimeDaConsultaDoCnpj({ razao_social: "X" }), null);
  assert.equal(regimeDaConsultaDoCnpj(null), null);
  assert.equal(regimeDaConsultaDoCnpj("texto"), null);
  assert.equal(consultaDaRespostaDoCnpj({ razao_social: "X" }, CNPJ, HOJE), null);
});

/** A consulta como `consultaDaRespostaDoCnpj` a devolve: com os CNAEs. */
const semCnae = (c: ConsultaDoRegime) => ({ ...c, cnaePrincipal: null, cnaesSecundarios: [] });

test("a consulta guarda desde quando: a opção pelo Simples, ou pelo MEI no MEI", () => {
  assert.deepEqual(
    consultaDaRespostaDoCnpj(
      { opcao_pelo_simples: true, data_opcao_pelo_simples: "2019-01-01", opcao_pelo_mei: false, data_opcao_pelo_mei: null },
      "64.582.932/0001-72",
      HOJE,
    ),
    semCnae(SIMPLES),
  );
  // Todo MEI é optante do Simples: o "desde" é o do MEI.
  assert.deepEqual(
    consultaDaRespostaDoCnpj(
      { opcao_pelo_simples: true, data_opcao_pelo_simples: "2018-07-01", opcao_pelo_mei: true, data_opcao_pelo_mei: "2021-03-15" },
      CNPJ,
      HOJE,
    ),
    semCnae(MEI),
  );
  // Excluída do Simples: a data antiga não é "desde" de nada.
  assert.deepEqual(
    consultaDaRespostaDoCnpj(
      { opcao_pelo_simples: false, data_opcao_pelo_simples: "2010-01-01", data_exclusao_do_simples: "2015-12-31", opcao_pelo_mei: false },
      CNPJ,
      HOJE,
    ),
    semCnae(NORMAL),
  );
  // Sem a data, ou com o que não é data: sem "desde".
  assert.equal(
    consultaDaRespostaDoCnpj({ opcao_pelo_simples: true, data_opcao_pelo_simples: null }, CNPJ, HOJE)?.desde,
    null,
  );
  assert.equal(
    consultaDaRespostaDoCnpj({ opcao_pelo_simples: true, data_opcao_pelo_simples: "01/01/2019" }, CNPJ, HOJE)?.desde,
    null,
  );
});

test("a consulta entra no campo vazio e no lugar de outra consulta; o escolhido à mão fica", () => {
  assert.equal(regimeDepoisDaConsulta(null, null, "simples"), "simples");
  // Decisão 166: "nenhum dos dois" não preenche — Real ou Presumido é escolha.
  assert.equal(regimeDepoisDaConsulta(null, null, "normal"), null);
  // O CNPJ foi corrigido: o Simples da consulta anterior sai, e o campo
  // espera a escolha entre Real e Presumido.
  assert.equal(regimeDepoisDaConsulta("simples", SIMPLES, "normal"), null);
  assert.equal(regimeDepoisDaConsulta("simples", SIMPLES, "mei"), "mei");
  // Escolhido à mão (diferente da consulta anterior, ou sem consulta): fica.
  assert.equal(regimeDepoisDaConsulta("mei", SIMPLES, "normal"), "mei");
  assert.equal(regimeDepoisDaConsulta("lucro_real", null, "simples"), "lucro_real");
});

test("decisão 166: o CNAE da consulta entra no vazio e no lugar do que veio da consulta anterior", () => {
  const com = (principal: string): ConsultaDoRegime => ({ ...NORMAL, cnaePrincipal: principal, cnaesSecundarios: [] });
  assert.equal(cnaeDepoisDaConsulta(null, null, com("5911102")), "5911102");
  assert.equal(cnaeDepoisDaConsulta("5911102", com("5911102"), com("7420001")), "7420001");
  // Escolhido à mão: fica.
  assert.equal(cnaeDepoisDaConsulta("7311400", com("5911102"), com("7420001")), "7311400");
  // A consulta sem CNAE não apaga o que está no campo.
  assert.equal(cnaeDepoisDaConsulta("7311400", null, NORMAL), "7311400");
});

// ---------------------------------------------------------------------------
// O texto embaixo do regime
// ---------------------------------------------------------------------------

test("embaixo do campo: preenchido pela consulta, com desde quando", () => {
  assert.deepEqual(origemDoRegime("simples", SIMPLES, CNPJ), {
    texto: "Preenchido pela consulta do CNPJ em 02/10/2026 · optante do Simples desde 01/2019",
    alterado: false,
  });
  assert.deepEqual(origemDoRegime("mei", MEI, CNPJ), {
    texto: "Preenchido pela consulta do CNPJ em 02/10/2026 · MEI desde 03/2021",
    alterado: false,
  });
  // Real ou Presumido: a consulta não preenche, só confere.
  assert.deepEqual(origemDoRegime("lucro_presumido", NORMAL, CNPJ), {
    texto: "Conferido com a consulta do CNPJ em 02/10/2026 · não optante do Simples",
    alterado: false,
  });
  assert.deepEqual(origemDoRegime("lucro_real", NORMAL, CNPJ)?.alterado, false);
  // Sem a data de opção: só o dia da consulta.
  assert.deepEqual(origemDoRegime("simples", { ...SIMPLES, desde: null }, CNPJ), {
    texto: "Preenchido pela consulta do CNPJ em 02/10/2026",
    alterado: false,
  });
  assert.deepEqual(origemDoRegime("mei", { ...MEI, desde: null }, CNPJ), {
    texto: "Preenchido pela consulta do CNPJ em 02/10/2026",
    alterado: false,
  });
});

test("embaixo do campo: âmbar quando trocado à mão, dizendo o que a consulta indicou", () => {
  assert.deepEqual(origemDoRegime("lucro_real", SIMPLES, CNPJ), {
    texto: "Alterado manualmente — a consulta do CNPJ em 02/10/2026 indicou Simples Nacional.",
    alterado: true,
  });
  assert.deepEqual(origemDoRegime("simples", NORMAL, CNPJ), {
    texto: "Alterado manualmente — a consulta do CNPJ em 02/10/2026 indicou não optante do Simples.",
    alterado: true,
  });
  assert.deepEqual(origemDoRegime("lucro_presumido", MEI, "64.582.932/0001-72"), {
    texto: "Alterado manualmente — a consulta do CNPJ em 02/10/2026 indicou MEI.",
    alterado: true,
  });
});

test("decisão 166: regime vazio em vermelho — a consulta não decide, ou o cadastro está em revisão", () => {
  assert.deepEqual(origemDoRegime(null, NORMAL, CNPJ), {
    texto: "Consulta do CNPJ em 02/10/2026: não é Simples nem MEI. Escolha Real ou Presumido.",
    alterado: true,
    pendente: true,
  });
  assert.deepEqual(origemDoRegime(null, null, CNPJ, "mei"), {
    texto: "Antes: MEI. Confira e escolha.",
    alterado: true,
    pendente: true,
  });
  assert.deepEqual(origemDoRegime(null, null, CNPJ, "normal"), {
    texto: "Estava “Lucro Real ou Presumido”: escolha um dos dois.",
    alterado: true,
    pendente: true,
  });
  // Escolhido: o "antes" some.
  assert.equal(origemDoRegime("mei", null, CNPJ, "mei"), null);
});

test("decisão 166: o texto embaixo do CNAE diz se ele veio da consulta", () => {
  const c: ConsultaDoRegime = { ...NORMAL, cnaePrincipal: "5911102", cnaesSecundarios: ["7420004"] };
  assert.deepEqual(origemDoCnae("5911102", c, CNPJ), {
    texto: "CNAE principal na consulta do CNPJ em 02/10/2026",
    alterado: false,
  });
  assert.deepEqual(origemDoCnae("7420004", c, CNPJ)?.texto, "CNAE secundário na consulta do CNPJ em 02/10/2026");
  assert.deepEqual(origemDoCnae("7311400", c, CNPJ), {
    texto: "Não consta na consulta do CNPJ em 02/10/2026 (principal: 5911-1/02).",
    alterado: true,
  });
  assert.equal(origemDoCnae("5911102", c, OUTRO_CNPJ), null);
  assert.equal(origemDoCnae(null, c, CNPJ), null);
  assert.equal(formatarCnae("0111301"), "0111-3/01");
});

test("decisão 166: o que falta para gerar PP — regime (o legado conta como falta) e CNAE, só na PJ", () => {
  const pj = { tipo_pessoa: "juridica", regime_tributario: "simples", cnae: "5911102" };
  assert.deepEqual(pendenciasDoCadastroFiscal(pj), []);
  assert.deepEqual(pendenciasDoCadastroFiscal({ ...pj, regime_tributario: null, cnae: null }), [
    "o regime tributário",
    "o CNAE",
  ]);
  assert.deepEqual(pendenciasDoCadastroFiscal({ ...pj, regime_tributario: "normal" }), ["o regime tributário"]);
  assert.deepEqual(pendenciasDoCadastroFiscal({ ...pj, cnae: "59111" }), ["o CNAE"]);
  assert.deepEqual(pendenciasDoCadastroFiscal({ tipo_pessoa: "fisica", regime_tributario: null, cnae: null }), []);
  assert.equal(listarPendencias(["o regime tributário", "o CNAE"]), "o regime tributário e o CNAE");
  assert.equal(cadastroSemRevisao({ tipo_pessoa: "juridica", cnae: null }), true);
  assert.equal(cadastroSemRevisao({ tipo_pessoa: "juridica", cnae: "5911102" }), false);
  assert.equal(cadastroSemRevisao({ tipo_pessoa: "fisica", cnae: null }), false);
});

test("sem regime, sem consulta, ou com a consulta de outro CNPJ: nada embaixo do campo", () => {
  assert.equal(origemDoRegime(null, SIMPLES, CNPJ), null);
  assert.equal(origemDoRegime("simples", null, CNPJ), null);
  assert.equal(origemDoRegime("simples", SIMPLES, OUTRO_CNPJ), null);
});

// ---------------------------------------------------------------------------
// O que vai ao banco e o que volta ao reabrir
// ---------------------------------------------------------------------------

test("a consulta deste CNPJ vai inteira; a de outro CNPJ não vai", () => {
  assert.deepEqual(consultaParaGravar(SIMPLES, CNPJ), {
    regime_consulta: "simples",
    regime_desde: "2019-01-01",
    regime_consultado_em: HOJE,
  });
  assert.deepEqual(consultaParaGravar(NORMAL, "64.582.932/0001-72"), {
    regime_consulta: "normal",
    regime_desde: null,
    regime_consultado_em: HOJE,
  });
  const nada = { regime_consulta: null, regime_desde: null, regime_consultado_em: null };
  // O CNPJ foi trocado depois da consulta.
  assert.deepEqual(consultaParaGravar(SIMPLES, OUTRO_CNPJ), nada);
  assert.deepEqual(consultaParaGravar(null, CNPJ), nada);
});

const CADASTRO = {
  cpf_cnpj: CNPJ,
  regime_tributario: "simples" as const,
  regime_consulta: "simples" as const,
  regime_desde: "2019-01-01",
  regime_consultado_em: "2026-09-21",
};

test("a edição abre com a consulta gravada", () => {
  assert.deepEqual(consultaDoCadastro(CADASTRO), {
    cnpj: CNPJ,
    em: "2026-09-21",
    regime: "simples",
    desde: "2019-01-01",
  });
  // Trocado à mão: a consulta continua dizendo o que indicou.
  assert.deepEqual(consultaDoCadastro({ ...CADASTRO, regime_tributario: "normal" })?.regime, "simples");
  // No regime normal não há "desde".
  assert.equal(
    consultaDoCadastro({ ...CADASTRO, regime_consulta: "normal", regime_desde: "2019-01-01" })?.desde,
    null,
  );
  // Decisão 166: gravado como Real ou Presumido sem `regime_consulta` (antes
  // da 142), a consulta indicou "nenhum dos dois".
  assert.equal(
    consultaDoCadastro({ ...CADASTRO, regime_tributario: "lucro_real", regime_consulta: null })?.regime,
    "normal",
  );
  assert.equal(consultaDoCadastro({ ...CADASTRO, regime_consultado_em: null }), null);
  assert.equal(consultaDoCadastro({ ...CADASTRO, cpf_cnpj: null }), null);
  assert.equal(consultaDoCadastro(undefined), null);
});

test("cadastro gravado antes da decisão 142 (só a data): a consulta indicou o regime gravado", () => {
  assert.deepEqual(
    consultaDoCadastro({
      cpf_cnpj: CNPJ,
      regime_tributario: "mei",
      regime_consulta: null,
      regime_desde: null,
      regime_consultado_em: "2026-09-21",
    }),
    { cnpj: CNPJ, em: "2026-09-21", regime: "mei", desde: null },
  );
  assert.equal(
    consultaDoCadastro({
      cpf_cnpj: CNPJ,
      regime_tributario: null,
      regime_consulta: null,
      regime_desde: null,
      regime_consultado_em: "2026-09-21",
    }),
    null,
  );
});

// ---------------------------------------------------------------------------
// O servidor (lib/validations/fornecedores.ts)
// ---------------------------------------------------------------------------

const BASE = {
  tipo_pessoa: "juridica",
  nome: "Prime Comunicação",
  razao_social: "Prime Comunicação e Marketing Ltda",
  cpf_cnpj: CNPJ,
  email: "contato@fornecedor.com.br",
  telefone: "11987654321",
  pix_tipo: "cnpj",
  pix_chave: CNPJ,
  cnae: "5911-1/02",
};

test("o regime vai ao banco com a consulta inteira e a declaração do Simples", () => {
  const r = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "simples",
    regime_consulta: "simples",
    regime_desde: "2019-01-01",
    regime_consultado_em: HOJE,
    declaracao_simples_recebida: "true",
  });
  assert.ok(r.success);
  assert.equal(r.data.regime_tributario, "simples");
  assert.equal(r.data.regime_consulta, "simples");
  assert.equal(r.data.regime_desde, "2019-01-01");
  assert.equal(r.data.regime_consultado_em, HOJE);
  assert.equal(r.data.declaracao_simples_recebida, true);
});

test("trocado à mão, a consulta vai junto — o aviso âmbar continua ao reabrir", () => {
  // O que a tela manda quando a consulta disse Simples e o usuário escolheu
  // Lucro Presumido.
  const consulta = consultaParaGravar(SIMPLES, CNPJ);
  const r = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "lucro_presumido",
    regime_consulta: consulta.regime_consulta,
    regime_desde: consulta.regime_desde,
    regime_consultado_em: consulta.regime_consultado_em,
  });
  assert.ok(r.success);
  assert.equal(r.data.regime_tributario, "lucro_presumido");
  assert.equal(r.data.regime_consulta, "simples");
  assert.equal(r.data.regime_desde, "2019-01-01");
  assert.equal(r.data.regime_consultado_em, HOJE);
  // Reaberto: a edição lê as colunas gravadas e repete o aviso.
  const reaberta = consultaDoCadastro({
    cpf_cnpj: r.data.cpf_cnpj,
    regime_tributario: r.data.regime_tributario,
    regime_consulta: r.data.regime_consulta,
    regime_desde: r.data.regime_desde,
    regime_consultado_em: r.data.regime_consultado_em,
  });
  assert.deepEqual(origemDoRegime(r.data.regime_tributario, reaberta, CNPJ), {
    texto: "Alterado manualmente — a consulta do CNPJ em 02/10/2026 indicou Simples Nacional.",
    alterado: true,
  });
});

test("a consulta vai inteira ou não vai: sem o dia, sem regime ou sem o indicado, nada", () => {
  const semDia = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "simples",
    regime_consulta: "simples",
    regime_desde: "2019-01-01",
    regime_consultado_em: "",
  });
  assert.ok(semDia.success);
  assert.equal(semDia.data.regime_consulta, null);
  assert.equal(semDia.data.regime_desde, null);
  assert.equal(semDia.data.regime_consultado_em, null);

  const semIndicado = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "lucro_real",
    regime_consulta: "",
    regime_consultado_em: HOJE,
  });
  assert.ok(semIndicado.success);
  assert.equal(semIndicado.data.regime_consultado_em, null);
});

test("o desde só acompanha a consulta que indicou Simples ou MEI", () => {
  const r = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "simples",
    regime_consulta: "normal",
    regime_desde: "2019-01-01",
    regime_consultado_em: HOJE,
  });
  assert.ok(r.success);
  assert.equal(r.data.regime_consulta, "normal");
  assert.equal(r.data.regime_desde, null);
});

test("a declaração de optante só fica no Simples", () => {
  const r = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "lucro_real",
    regime_consultado_em: "",
    declaracao_simples_recebida: "true",
  });
  assert.ok(r.success);
  assert.equal(r.data.regime_tributario, "lucro_real");
  assert.equal(r.data.regime_consultado_em, null);
  assert.equal(r.data.declaracao_simples_recebida, false);
});

test("pessoa física não tem regime nem consulta", () => {
  const r = fornecedorSchema.safeParse({
    ...BASE,
    tipo_pessoa: "fisica",
    cpf_cnpj: "52998224725",
    pix_tipo: "cpf",
    pix_chave: "52998224725",
    regime_tributario: "mei",
    regime_consulta: "mei",
    regime_desde: "2021-03-15",
    regime_consultado_em: HOJE,
    declaracao_simples_recebida: "true",
  });
  assert.ok(r.success);
  assert.equal(r.data.regime_tributario, null);
  assert.equal(r.data.regime_consulta, null);
  assert.equal(r.data.regime_desde, null);
  assert.equal(r.data.regime_consultado_em, null);
  assert.equal(r.data.declaracao_simples_recebida, false);
  // Decisão 166: e nem CNAE.
  assert.equal(r.data.cnae, null);
});

test("regime fora da lista e data malformada são recusados", () => {
  // Decisão 166: o legado "Lucro Real ou Presumido" não se grava mais.
  for (const fora of ["normal", "presumido"]) {
    const regime = fornecedorSchema.safeParse({ ...BASE, regime_tributario: fora });
    assert.ok(!regime.success);
    assert.ok(regime.error.issues.some((i) => i.path.includes("regime_tributario")));
  }
  const data = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "lucro_real",
    regime_consultado_em: "02/10/2026",
  });
  assert.ok(!data.success);
  assert.ok(data.error.issues.some((i) => i.path.includes("regime_consultado_em")));
  const indicado = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "lucro_real",
    regime_consulta: "presumido",
    regime_consultado_em: HOJE,
  });
  assert.ok(!indicado.success);
  assert.ok(indicado.error.issues.some((i) => i.path.includes("regime_consulta")));
  const desde = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "simples",
    regime_consulta: "simples",
    regime_desde: "01/2019",
    regime_consultado_em: HOJE,
  });
  assert.ok(!desde.success);
  assert.ok(desde.error.issues.some((i) => i.path.includes("regime_desde")));
});

test("decisão 166: na pessoa jurídica, regime e CNAE são obrigatórios, e o CNAE é da lista", () => {
  const semNada = fornecedorSchema.safeParse({ ...BASE, cnae: "" });
  assert.ok(!semNada.success);
  const caminhos = semNada.error.issues.map((i) => i.path.join("."));
  assert.ok(caminhos.includes("regime_tributario"));
  assert.ok(caminhos.includes("cnae"));
  const inventado = fornecedorSchema.safeParse({ ...BASE, regime_tributario: "mei", cnae: "9999999" });
  assert.ok(!inventado.success);
  assert.ok(inventado.error.issues.some((i) => i.path.includes("cnae")));
  const ok = fornecedorSchema.safeParse({ ...BASE, regime_tributario: "mei" });
  assert.ok(ok.success);
  // A pontuação sai: o banco guarda 7 dígitos.
  assert.equal(ok.data.cnae, "5911102");
});

test("decisão 166: completar o cadastro grava só regime, CNAE e a consulta", () => {
  const r = cadastroFiscalSchema.safeParse({
    regime_tributario: "simples",
    cnae: "5911-1/02",
    regime_consulta: "simples",
    regime_desde: "2019-01-01",
    regime_consultado_em: HOJE,
    nome: "não entra",
  });
  assert.ok(r.success);
  assert.deepEqual(r.data, {
    regime_tributario: "simples",
    cnae: "5911102",
    regime_consulta: "simples",
    regime_consultado_em: HOJE,
    regime_desde: "2019-01-01",
  });
  assert.ok(!cadastroFiscalSchema.safeParse({ regime_tributario: "normal", cnae: "5911102" }).success);
  assert.ok(!cadastroFiscalSchema.safeParse({ regime_tributario: "mei", cnae: "" }).success);
});

test("sem os campos do regime (quem não os manda), tudo nulo, sem declaração e sem mexer no arquivo", () => {
  // Pessoa física: a única que passa sem regime (decisão 166).
  const r = fornecedorSchema.safeParse({
    ...BASE,
    tipo_pessoa: "fisica",
    cpf_cnpj: "52998224725",
    pix_tipo: "cpf",
    pix_chave: "52998224725",
  });
  assert.ok(r.success);
  assert.equal(r.data.regime_tributario, null);
  assert.equal(r.data.regime_consulta, null);
  assert.equal(r.data.regime_desde, null);
  assert.equal(r.data.regime_consultado_em, null);
  assert.equal(r.data.declaracao_simples_recebida, false);
  // `undefined` some do update: o arquivo gravado fica onde está.
  assert.equal(r.data.declaracao_simples_path, undefined);
  assert.ok(!("declaracao_simples_path" in JSON.parse(JSON.stringify(r.data))));
});

// ---------------------------------------------------------------------------
// O arquivo da declaração de optante
// ---------------------------------------------------------------------------

const TENANT = "d2a02c10-9c7e-4157-8dd5-84bbf5a7044c";
const OUTRO_TENANT = "0b4b4c84-5a2b-4f8e-9e0f-3f1d2a1b0c9d";
const UUID = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const ARQUIVO = `${TENANT}/declaracoes/${UUID}-declaracao-optante.pdf`;

test("o arquivo vai ao banco; vazio tira; trocar o regime não apaga", () => {
  const comArquivo = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "simples",
    declaracao_simples_path: ARQUIVO,
  });
  assert.ok(comArquivo.success);
  assert.equal(comArquivo.data.declaracao_simples_path, ARQUIVO);

  const tirado = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "simples",
    declaracao_simples_path: "",
  });
  assert.ok(tirado.success);
  assert.equal(tirado.data.declaracao_simples_path, null);

  // Deixou de ser Simples: a caixa cai, o arquivo fica com o cadastro.
  const normal = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "lucro_presumido",
    declaracao_simples_recebida: "true",
    declaracao_simples_path: ARQUIVO,
  });
  assert.ok(normal.success);
  assert.equal(normal.data.declaracao_simples_recebida, false);
  assert.equal(normal.data.declaracao_simples_path, ARQUIVO);
});

test("o caminho do arquivo: pasta de declarações do tenant, nome sem acento nem espaço", () => {
  assert.equal(
    caminhoDaDeclaracao(TENANT, UUID, "Declaração de Optante (2026).pdf"),
    `${TENANT}/declaracoes/${UUID}-Declaracao-de-Optante-2026.pdf`,
  );
  assert.equal(
    caminhoDaDeclaracao(TENANT, UUID, "som & luz.PDF"),
    `${TENANT}/declaracoes/${UUID}-som-luz.PDF`,
  );
  assert.equal(caminhoDaDeclaracao(TENANT, UUID, "ção"), `${TENANT}/declaracoes/${UUID}-cao`);
  assert.equal(caminhoDaDeclaracao(TENANT, UUID, "###"), `${TENANT}/declaracoes/${UUID}-declaracao`);
  assert.equal(nomeDoArquivoDaDeclaracao(ARQUIVO), "declaracao-optante.pdf");
});

test("só vale o caminho da pasta de declarações do tenant da sessão", () => {
  assert.equal(declaracaoDoTenant(ARQUIVO, TENANT), true);
  assert.equal(declaracaoDoTenant(ARQUIVO, OUTRO_TENANT), false);
  assert.equal(declaracaoDoTenant(`${TENANT}/guias/${UUID}-a.pdf`, TENANT), false);
  assert.equal(declaracaoDoTenant(`${TENANT}/declaracoes/x/${UUID}-a.pdf`, TENANT), false);
  assert.equal(declaracaoDoTenant(`${TENANT}/declaracoes/..`, TENANT), false);
  assert.equal(declaracaoDoTenant(`${TENANT}/declaracoes/`, TENANT), false);
});

test("o arquivo: PDF, PNG ou JPEG de até 10 MB", () => {
  assert.equal(recusaDoArquivoDaDeclaracao("d.pdf", 300_000, "application/pdf"), null);
  assert.equal(recusaDoArquivoDaDeclaracao("d.jpg", 10 * 1024 * 1024, "image/jpeg"), null);
  assert.equal(recusaDoArquivoDaDeclaracao("d.png", 1, "image/png"), null);
  assert.equal(
    recusaDoArquivoDaDeclaracao("grande.pdf", 10 * 1024 * 1024 + 1, "application/pdf"),
    "“grande.pdf” passa de 10 MB.",
  );
  assert.equal(
    recusaDoArquivoDaDeclaracao("d.docx", 1000, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "“d.docx”: anexe um PDF, PNG ou JPEG.",
  );
});
