/**
 * Testes do par serviço × categoria — decisões 078, 105 e 131.
 *
 * Rode com:  node --import tsx --test lib/categorias-do-servico.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  categoriasDoServico,
  erroDoParServicoCategoria,
  servicoTemCategoriaExclusiva,
  type CategoriaParaServico,
} from "./categorias-do-servico";
import { bloqueioAprovacaoVersao } from "./validations/versoes";

const ATIVACAO = { id: "ativacao", investimento_interno: false };
const FEE = { id: "fee", investimento_interno: false };
const MIDIA = { id: "midia", investimento_interno: false };
const INTERNO = { id: "interno", investimento_interno: true };

function cat(
  id: string,
  extra: Partial<CategoriaParaServico> = {},
): CategoriaParaServico {
  return {
    id,
    nome: id,
    modelo_planilha: "nacional",
    servico_exclusivo_id: null,
    aceita_servico_interno: false,
    em_breve: false,
    ...extra,
  };
}

const EVENTO = cat("Evento");
const INTERNACIONAL = cat("Internacional", { modelo_planilha: "internacional" });
const CAT_FEE = cat("Fee", { modelo_planilha: "mensal", servico_exclusivo_id: "fee" });
const ALWAYS_ON = cat("Always On", {
  modelo_planilha: "mensal",
  servico_exclusivo_id: "always-on",
  aceita_servico_interno: true,
});
const MIDIA_ON = cat("Mídia On", { servico_exclusivo_id: "midia" });
const MIDIA_OFF = cat("Mídia Off", { servico_exclusivo_id: "midia", em_breve: true });

const TODAS = [EVENTO, INTERNACIONAL, CAT_FEE, ALWAYS_ON, MIDIA_ON, MIDIA_OFF];
const nomes = (cs: CategoriaParaServico[]) => cs.map((c) => c.nome);

test("Mídia lista só as dele, as duas — a em breve aparece para ser vista", () => {
  assert.deepEqual(nomes(categoriasDoServico(MIDIA, TODAS)), ["Mídia On", "Mídia Off"]);
  assert.equal(servicoTemCategoriaExclusiva(MIDIA, TODAS), true);
});

test("Mídia On e Mídia Off não aparecem em nenhum outro serviço", () => {
  for (const servico of [ATIVACAO, FEE, INTERNO, null]) {
    const lista = nomes(categoriasDoServico(servico, TODAS));
    assert.ok(!lista.includes("Mídia On"), `${servico?.id}: Mídia On`);
    assert.ok(!lista.includes("Mídia Off"), `${servico?.id}: Mídia Off`);
  }
});

test("Mídia com Mídia On passa; com Mídia Off, recusa", () => {
  assert.equal(erroDoParServicoCategoria(MIDIA, MIDIA_ON, TODAS, "Mídia"), null);
  assert.equal(
    erroDoParServicoCategoria(MIDIA, MIDIA_OFF, TODAS, "Mídia"),
    "A categoria Mídia Off ainda não está disponível.",
  );
});

test("Mídia com categoria de outro: a frase cita só a que pode ser escolhida", () => {
  assert.equal(
    erroDoParServicoCategoria(MIDIA, EVENTO, TODAS, "Mídia"),
    "Com o serviço Mídia, a categoria é Mídia On.",
  );
});

test("Ativação e Interno não aceitam Mídia On", () => {
  assert.equal(
    erroDoParServicoCategoria(ATIVACAO, MIDIA_ON, TODAS, "Ativação"),
    "A categoria Mídia On é só para o serviço dela.",
  );
  assert.notEqual(erroDoParServicoCategoria(INTERNO, MIDIA_ON, TODAS, "Interno"), null);
});

test("o que já valia continua valendo (078 e 105)", () => {
  assert.deepEqual(nomes(categoriasDoServico(FEE, TODAS)), ["Fee"]);
  assert.deepEqual(nomes(categoriasDoServico(INTERNO, TODAS)), ["Evento", "Always On"]);
  assert.deepEqual(nomes(categoriasDoServico(ATIVACAO, TODAS)), ["Evento", "Internacional"]);
  assert.equal(erroDoParServicoCategoria(ATIVACAO, EVENTO, TODAS, "Ativação"), null);
});

// Revisão da decisão 149 (07/10/2026): o par fora da regra não aprova.
// Os 4 orçamentos de antes da 078 têm serviço Always On com Conteúdo ou
// Extra; trocando o serviço para Ativação (ou a categoria para Always On)
// a aprovação segue.
test("aprovação: serviço Always On com categoria Extra bloqueia, com a frase do par", () => {
  const ALWAYS_ON_SERVICO = { id: "always-on", investimento_interno: false };
  const EXTRA = cat("Extra");
  const todas = [...TODAS, EXTRA];
  const par = erroDoParServicoCategoria(ALWAYS_ON_SERVICO, EXTRA, todas, "Always On");
  assert.equal(par, "Com o serviço Always On, a categoria é Always On.");
  const base = {
    percentualImposto: 19.53,
    cambioInternacional: null,
    qtdItens: 1,
    qtdItensComValor: 1,
    mesesSemItens: null,
    linhasSemVeiculo: null,
  };
  assert.equal(
    bloqueioAprovacaoVersao({ ...base, parServicoCategoria: par }),
    'Serviço e categoria do orçamento não combinam: com o serviço Always On, a categoria é Always On. Troque a categoria ou o serviço no "Editar" do orçamento antes de aprovar.',
  );
  // Trocado o serviço para Ativação, o par combina e nada bloqueia.
  const trocado = erroDoParServicoCategoria(ATIVACAO, EXTRA, todas, "Ativação");
  assert.equal(trocado, null);
  assert.equal(bloqueioAprovacaoVersao({ ...base, parServicoCategoria: trocado }), null);
});
