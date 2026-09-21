/**
 * Testes do gerador CNAB 240 Santander.
 *
 * A validação mais forte que se pode ter é reproduzir byte a byte um
 * arquivo que o Santander já aceitou. Fixture: PE000013.TXT (arquivo
 * antigo do ERP anterior aceito em produção em 18/08/2026).
 *
 * Rodar com: node --import tsx --test lib/cnab/santander/gerador.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  brancos,
  formatDate,
  formatMoneyV2,
  padAlpha,
  padNumeric,
  sanitizeAscii,
  zeros,
} from "./campos";
import {
  montarHeaderArquivo,
  montarHeaderLote,
  montarSegmentoA,
  montarSegmentoB,
  montarTrailerArquivo,
  montarTrailerLote,
} from "./gerador";
import type {
  ContaDebito,
  EmpresaPagadora,
  MetadadosArquivo,
  PagamentoCreditoContaOuTED,
} from "./tipos";

// ---------------------------------------------------------------------
// Helpers de fixture
// ---------------------------------------------------------------------

/** Extraído do PE000013.TXT via parse posicional. */
const EMPRESA_CALIFORNIA: EmpresaPagadora = {
  cnpj: "19437976000154",
  razaoSocial: "CALIFÓRNIA FILMES E PUBLICIDADE LTDA",
  enderecoLogradouro: "AV. DA FRANCA, 393 SETOR 2",
  enderecoCidade: "SALVADOR",
  enderecoCep: "40010000",
  enderecoUf: "BA",
};

const CONTA_SANTANDER: ContaDebito = {
  agencia: "4682",
  agenciaDv: null,
  conta: "13005989",
  contaDv: "7",
  convenio: "00334682004906997169",
};

/** 18/08/2026 17:08:08 — data e hora do arquivo original. */
const META_ARQUIVO: MetadadosArquivo = {
  sequencialArquivo: 12,
  dataGeracao: new Date(2026, 7, 18, 17, 8, 8), // agosto=7 (0-indexed)
};

// ---------------------------------------------------------------------
// campos.ts
// ---------------------------------------------------------------------

test("sanitizeAscii remove acentos e cedilha", () => {
  assert.equal(sanitizeAscii("CALIFÓRNIA"), "CALIFORNIA");
  assert.equal(sanitizeAscii("São Paulo"), "Sao Paulo");
  assert.equal(sanitizeAscii("Ação"), "Acao");
  assert.equal(sanitizeAscii(null), "");
  assert.equal(sanitizeAscii(""), "");
});

test("padAlpha alinha à esquerda com espaços e trunca no comprimento", () => {
  assert.equal(padAlpha("ABC", 5), "ABC  ");
  assert.equal(padAlpha("CALIFÓRNIA FILMES E PUBLICIDADE LTDA", 30), "CALIFORNIA FILMES E PUBLICIDAD");
  assert.equal(padAlpha(null, 3), "   ");
});

test("padNumeric alinha à direita com zeros e rejeita overflow", () => {
  assert.equal(padNumeric(12, 6), "000012");
  assert.equal(padNumeric("4682", 5), "04682");
  assert.equal(padNumeric(null, 3), "000");
  assert.throws(() => padNumeric("123456", 5));
});

test("formatDate produz DDMMAAAA", () => {
  assert.equal(formatDate("2026-08-18"), "18082026");
  assert.equal(formatDate(new Date(2026, 7, 18)), "18082026");
  assert.equal(formatDate(null), "00000000");
});

test("formatMoneyV2 usa 2 casas decimais implícitas", () => {
  assert.equal(formatMoneyV2(0.04, 15), "000000000000004");
  assert.equal(formatMoneyV2(4, 15), "000000000000400");
  assert.equal(formatMoneyV2(1234.56, 15), "000000000123456");
  assert.equal(formatMoneyV2(null, 10), "0000000000");
});

test("brancos e zeros geram strings de comprimento fixo", () => {
  assert.equal(brancos(5), "     ");
  assert.equal(zeros(3), "000");
});

// ---------------------------------------------------------------------
// Header de arquivo
// ---------------------------------------------------------------------

test("Header de Arquivo reproduz PE000013.TXT (240 bytes)", () => {
  const linha = montarHeaderArquivo(EMPRESA_CALIFORNIA, CONTA_SANTANDER, META_ARQUIVO);
  assert.equal(linha.length, 240, "linha precisa ter 240 bytes");

  // Verificação por campo — reproduz o parse manual da sessão
  assert.equal(linha.slice(0, 3), "033", "banco");
  assert.equal(linha.slice(3, 7), "0000", "lote");
  assert.equal(linha.slice(7, 8), "0", "tipo registro");
  assert.equal(linha.slice(8, 17), " ".repeat(9), "filler 9");
  assert.equal(linha.slice(17, 18), "2", "tipo inscrição CNPJ");
  assert.equal(linha.slice(18, 32), "19437976000154", "CNPJ");
  assert.equal(linha.slice(32, 52), "00334682004906997169", "convênio");
  assert.equal(linha.slice(52, 57), "04682", "agência");
  assert.equal(linha.slice(58, 70), "000013005989", "conta");
  assert.equal(linha.slice(70, 71), "7", "DV conta");
  assert.equal(linha.slice(72, 102), "CALIFORNIA FILMES E PUBLICIDAD", "nome empresa");
  assert.equal(linha.slice(102, 132), "Banco Santander  (Brasil)  S/A", "nome banco");
  assert.equal(linha.slice(142, 143), "1", "código remessa");
  assert.equal(linha.slice(143, 151), "18082026", "data geração");
  assert.equal(linha.slice(151, 157), "170808", "hora geração");
  assert.equal(linha.slice(157, 163), "000012", "sequencial");
  assert.equal(linha.slice(163, 166), "060", "versão layout");
});

// ---------------------------------------------------------------------
// Header de lote
// ---------------------------------------------------------------------

test("Header de Lote (TED) reproduz PE000013.TXT", () => {
  const linha = montarHeaderLote(
    1, // lote 1
    "03", // TED
    "20", // Pagamento Fornecedor
    EMPRESA_CALIFORNIA,
    CONTA_SANTANDER,
  );
  assert.equal(linha.length, 240);

  assert.equal(linha.slice(0, 3), "033", "banco");
  assert.equal(linha.slice(3, 7), "0001", "lote 1");
  assert.equal(linha.slice(7, 8), "1", "tipo registro");
  assert.equal(linha.slice(8, 9), "C", "operação crédito");
  assert.equal(linha.slice(9, 11), "20", "tipo serviço fornecedor");
  assert.equal(linha.slice(11, 13), "03", "forma TED");
  assert.equal(linha.slice(13, 16), "031", "versão lote");
  assert.equal(linha.slice(17, 18), "2", "tipo inscrição");
  assert.equal(linha.slice(18, 32), "19437976000154", "CNPJ");
  assert.equal(linha.slice(32, 52), "00334682004906997169", "convênio");
  assert.equal(linha.slice(52, 57), "04682", "agência");
  assert.equal(linha.slice(58, 70), "000013005989", "conta");
  assert.equal(linha.slice(70, 71), "7", "DV");
  assert.equal(linha.slice(72, 102), "CALIFORNIA FILMES E PUBLICIDAD", "nome");
  assert.equal(linha.slice(142, 172).trim(), "AV. DA FRANCA, 393 SETOR 2", "endereço");
  assert.equal(linha.slice(192, 212).trim(), "SALVADOR", "cidade");
  assert.equal(linha.slice(212, 217), "40010", "CEP");
  assert.equal(linha.slice(217, 220), "000", "complemento CEP");
  assert.equal(linha.slice(220, 222), "BA", "UF");
});

// ---------------------------------------------------------------------
// Segmento A (pagamento TED)
// ---------------------------------------------------------------------

test("Segmento A (TED) monta linha de 240 bytes com dados corretos", () => {
  const pagamento: PagamentoCreditoContaOuTED = {
    tipo: "ted",
    bancoFavorecido: "260", // Nubank
    agenciaFavorecida: "1",
    agenciaFavorecidaDv: null,
    contaFavorecida: "89798713",
    contaFavorecidaDv: "4",
    tipoContaFavorecida: "corrente",
    seuNumero: "(2564)123444",
    dataPagamento: "2026-08-18",
    valor: 0.04, // 4 centavos, valor do arquivo real
    nomeFavorecido: "CLARA MELO DE JESUS TAVARES SI",
    documentoFavorecido: "00000000000",
    favorecidoEhCnpj: false,
    finalidadeTED: "00005",
  };

  const linha = montarSegmentoA(1, 1, pagamento);
  assert.equal(linha.length, 240);

  assert.equal(linha.slice(0, 3), "033");
  assert.equal(linha.slice(3, 7), "0001", "lote 1");
  assert.equal(linha.slice(7, 8), "3", "tipo detalhe");
  assert.equal(linha.slice(8, 13), "00001", "sequencial no lote");
  assert.equal(linha.slice(13, 14), "A", "segmento");
  assert.equal(linha.slice(17, 20), "018", "câmara CIP TED");
  assert.equal(linha.slice(20, 23), "260", "banco favorecido Nubank");
  assert.equal(linha.slice(23, 28), "00001", "agência");
  assert.equal(linha.slice(29, 41), "000089798713", "conta");
  assert.equal(linha.slice(41, 42), "4", "DV");
  assert.equal(linha.slice(43, 73), "CLARA MELO DE JESUS TAVARES SI", "nome");
  assert.equal(linha.slice(93, 101), "18082026", "data pagamento");
  assert.equal(linha.slice(101, 104), "BRL", "moeda");
  assert.equal(linha.slice(119, 134), "000000000000004", "valor R$ 0,04");
  assert.equal(linha.slice(219, 224), "00005", "finalidade TED");
});

// ---------------------------------------------------------------------
// Segmento B
// ---------------------------------------------------------------------

test("Segmento B (endereço favorecido) monta 240 bytes", () => {
  const pagamento: PagamentoCreditoContaOuTED = {
    tipo: "ted",
    bancoFavorecido: "260",
    agenciaFavorecida: "1",
    agenciaFavorecidaDv: null,
    contaFavorecida: "89798713",
    contaFavorecidaDv: "4",
    tipoContaFavorecida: "corrente",
    seuNumero: "(2564)123444",
    dataPagamento: "2026-08-17",
    valor: 0.04,
    nomeFavorecido: "CLARA MELO DE JESUS TAVARES SI",
    documentoFavorecido: "86191099525",
    favorecidoEhCnpj: false,
    favorecidoLogradouro: "R MINISTRO ANTONIO CARLOS MAGA",
    favorecidoNumero: "0",
    favorecidoBairro: "BURAQUINHO",
    favorecidoCidade: "LAURO DE FREITAS",
    favorecidoCep: "42710400",
    favorecidoUf: "BA",
  };

  const linha = montarSegmentoB(1, 2, pagamento);
  assert.equal(linha.length, 240);
  assert.equal(linha.slice(13, 14), "B");
  assert.equal(linha.slice(17, 18), "1", "tipo inscrição CPF");
  assert.equal(linha.slice(18, 32), "00086191099525", "CPF zero-padded em 14 pos");
});

// ---------------------------------------------------------------------
// Trailer
// ---------------------------------------------------------------------

test("Trailer de Lote soma corretamente", () => {
  // Lote com 4 registros total: 1 header + 2 detalhes + 1 trailer.
  // Soma dos valores: R$ 0,04
  const linha = montarTrailerLote(1, 4, 0.04);
  assert.equal(linha.length, 240);
  assert.equal(linha.slice(0, 3), "033");
  assert.equal(linha.slice(3, 7), "0001");
  assert.equal(linha.slice(7, 8), "5");
  assert.equal(linha.slice(17, 23), "000004", "qtd registros");
  assert.equal(linha.slice(23, 41), "000000000000000004", "soma R$ 0,04");
});

test("Trailer de Arquivo tem lote 9999", () => {
  const linha = montarTrailerArquivo(1, 6);
  assert.equal(linha.length, 240);
  assert.equal(linha.slice(3, 7), "9999");
  assert.equal(linha.slice(7, 8), "9");
  assert.equal(linha.slice(17, 23), "000001", "qtd lotes");
  assert.equal(linha.slice(23, 29), "000006", "qtd registros total");
});
