/**
 * O regime tributário do fornecedor no cadastro (módulo fiscal, entrega 1;
 * consulta guardada e arquivo da declaração na decisão 142).
 * Rodar: node --import tsx --test lib/fiscal/regime-do-fornecedor.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  caminhoDaDeclaracao,
  consultaDaRespostaDoCnpj,
  consultaDoCadastro,
  consultaParaGravar,
  declaracaoDoTenant,
  nomeDoArquivoDaDeclaracao,
  origemDoRegime,
  recusaDoArquivoDaDeclaracao,
  regimeDaConsultaDoCnpj,
  regimeDepoisDaConsulta,
  type ConsultaDoRegime,
} from "./regime-do-fornecedor";
import { fornecedorSchema } from "@/lib/validations/fornecedores";

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

test("a consulta guarda desde quando: a opção pelo Simples, ou pelo MEI no MEI", () => {
  assert.deepEqual(
    consultaDaRespostaDoCnpj(
      { opcao_pelo_simples: true, data_opcao_pelo_simples: "2019-01-01", opcao_pelo_mei: false, data_opcao_pelo_mei: null },
      "64.582.932/0001-72",
      HOJE,
    ),
    SIMPLES,
  );
  // Todo MEI é optante do Simples: o "desde" é o do MEI.
  assert.deepEqual(
    consultaDaRespostaDoCnpj(
      { opcao_pelo_simples: true, data_opcao_pelo_simples: "2018-07-01", opcao_pelo_mei: true, data_opcao_pelo_mei: "2021-03-15" },
      CNPJ,
      HOJE,
    ),
    MEI,
  );
  // Excluída do Simples: a data antiga não é "desde" de nada.
  assert.deepEqual(
    consultaDaRespostaDoCnpj(
      { opcao_pelo_simples: false, data_opcao_pelo_simples: "2010-01-01", data_exclusao_do_simples: "2015-12-31", opcao_pelo_mei: false },
      CNPJ,
      HOJE,
    ),
    NORMAL,
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
  // O CNPJ foi corrigido: o regime da consulta anterior dá lugar ao novo.
  assert.equal(regimeDepoisDaConsulta("simples", SIMPLES, "normal"), "normal");
  // Escolhido à mão (diferente da consulta anterior, ou sem consulta): fica.
  assert.equal(regimeDepoisDaConsulta("mei", SIMPLES, "normal"), "mei");
  assert.equal(regimeDepoisDaConsulta("normal", null, "simples"), "normal");
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
  assert.deepEqual(origemDoRegime("normal", NORMAL, CNPJ), {
    texto: "Preenchido pela consulta do CNPJ em 02/10/2026 · não optante do Simples",
    alterado: false,
  });
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
  assert.deepEqual(origemDoRegime("normal", SIMPLES, CNPJ), {
    texto: "Alterado manualmente — a consulta do CNPJ em 02/10/2026 indicou Simples Nacional.",
    alterado: true,
  });
  assert.deepEqual(origemDoRegime("simples", NORMAL, CNPJ), {
    texto: "Alterado manualmente — a consulta do CNPJ em 02/10/2026 indicou Lucro Real ou Presumido.",
    alterado: true,
  });
  assert.deepEqual(origemDoRegime("normal", MEI, "64.582.932/0001-72"), {
    texto: "Alterado manualmente — a consulta do CNPJ em 02/10/2026 indicou MEI.",
    alterado: true,
  });
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
  // O que a tela manda quando a consulta disse Simples e o usuário escolheu normal.
  const consulta = consultaParaGravar(SIMPLES, CNPJ);
  const r = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "normal",
    regime_consulta: consulta.regime_consulta,
    regime_desde: consulta.regime_desde,
    regime_consultado_em: consulta.regime_consultado_em,
  });
  assert.ok(r.success);
  assert.equal(r.data.regime_tributario, "normal");
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

  const semRegime = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "",
    regime_consulta: "simples",
    regime_desde: "2019-01-01",
    regime_consultado_em: HOJE,
    declaracao_simples_recebida: "false",
  });
  assert.ok(semRegime.success);
  assert.equal(semRegime.data.regime_tributario, null);
  assert.equal(semRegime.data.regime_consulta, null);
  assert.equal(semRegime.data.regime_consultado_em, null);
  assert.equal(semRegime.data.declaracao_simples_recebida, false);

  const semIndicado = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "normal",
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
    regime_tributario: "normal",
    regime_consultado_em: "",
    declaracao_simples_recebida: "true",
  });
  assert.ok(r.success);
  assert.equal(r.data.regime_tributario, "normal");
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
});

test("regime fora da lista e data malformada são recusados", () => {
  const regime = fornecedorSchema.safeParse({ ...BASE, regime_tributario: "lucro_real" });
  assert.ok(!regime.success);
  assert.ok(regime.error.issues.some((i) => i.path.includes("regime_tributario")));
  const data = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "normal",
    regime_consultado_em: "02/10/2026",
  });
  assert.ok(!data.success);
  assert.ok(data.error.issues.some((i) => i.path.includes("regime_consultado_em")));
  const indicado = fornecedorSchema.safeParse({
    ...BASE,
    regime_tributario: "normal",
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

test("sem os campos do regime (quem não os manda), tudo nulo, sem declaração e sem mexer no arquivo", () => {
  const r = fornecedorSchema.safeParse(BASE);
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
    regime_tributario: "normal",
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
