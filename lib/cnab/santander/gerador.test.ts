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
  gerarArquivo,
  montarHeaderArquivo,
  montarHeaderLote,
  montarSegmentoA,
  montarSegmentoB,
  montarSegmentoBPixChave,
  montarTrailerArquivo,
  montarTrailerLote,
} from "./gerador";
import type {
  ContaDebito,
  EmpresaPagadora,
  MetadadosArquivo,
  PagamentoCreditoContaOuTED,
  PagamentoPixChave,
} from "./tipos";
import {
  normalizarChavePix,
  PIX_FORMATO,
  problemaDaChavePix,
  type PixTipo,
} from "../../pix";

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
  // O instante com fuso explícito: o header sai no relógio de Brasília,
  // qualquer que seja o fuso da máquina que roda o teste.
  dataGeracao: new Date("2026-08-18T17:08:08-03:00"),
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
  assert.equal(formatDate(new Date("2026-08-18T12:00:00-03:00")), "18082026");
  // 22h em Brasília já é o dia seguinte em UTC — o header fica no dia de cá.
  assert.equal(formatDate(new Date("2026-09-23T22:30:00-03:00")), "23092026");
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
  // 029 e 043 em branco, como no PE000013 aprovado e no layout (pág. 10).
  assert.equal(linha.slice(28, 29), " ", "DV agência em branco");
  assert.equal(linha.slice(42, 43), " ", "DV agência/conta em branco");
});

test("Segmento A: DV da conta com letra vai como 0 (Nota G003)", () => {
  const linha = montarSegmentoA(1, 1, {
    tipo: "ted",
    bancoFavorecido: "001",
    agenciaFavorecida: "1234",
    agenciaFavorecidaDv: "X",
    contaFavorecida: "56789",
    contaFavorecidaDv: "X",
    tipoContaFavorecida: "corrente",
    finalidadeTED: "00005",
    seuNumero: "X1",
    dataPagamento: "2026-09-23",
    valor: 1,
    nomeFavorecido: "FULANO",
    documentoFavorecido: "86191099525",
  });
  assert.equal(linha.slice(28, 29), " ", "DV agência em branco mesmo com X");
  assert.equal(linha.slice(41, 42), "0", "DV X vira 0");
  assert.equal(linha.slice(42, 43), " ");
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

// ---------------------------------------------------------------------
// PIX por chave (forma 45) — o que o Santander cobrou nos e-mails
// ---------------------------------------------------------------------

function pix(
  tipoChave: PagamentoPixChave["tipoChave"],
  chave: string,
  documentoFavorecido: string,
): PagamentoPixChave {
  return {
    tipo: "pix_chave",
    tipoChave,
    chave,
    seuNumero: "TESTE",
    dataPagamento: "2026-09-23",
    valor: 0.05,
    nomeFavorecido: "Antonio",
    documentoFavorecido,
  };
}

test("B PIX, chave CPF do próprio favorecido: 14 posições com zeros e a chave na Informação 12", () => {
  const linha = montarSegmentoBPixChave(1, 2, pix("cpf", "86098531528", "86098531528"));
  assert.equal(linha.length, 240);
  assert.equal(linha.slice(13, 14), "B");
  assert.equal(linha.slice(14, 16), "03", "forma de iniciação CPF/CNPJ");
  assert.equal(linha.slice(16, 17), " ");
  assert.equal(linha.slice(17, 18), "1", "CPF");
  assert.equal(linha.slice(18, 32), "00086098531528", "à direita, zeros à esquerda (G042)");
  assert.equal(linha.slice(127, 226).trimEnd(), "86098531528", "Informação 12 = chave");
  assert.equal(linha.slice(226, 240), " ".repeat(14));
});

test("B PIX, chave CPF de outra pessoa num fornecedor CNPJ: 019-032 é a chave (G035)", () => {
  // O caso de 10/09/2026: CNPJ 48.208.075/0001-99 com chave CPF — o banco
  // recusou porque os dois campos divergiam.
  const linha = montarSegmentoBPixChave(1, 2, pix("cpf", "86048486570", "48208075000199"));
  assert.equal(linha.slice(17, 18), "1", "inscrição da chave, não do cadastro");
  assert.equal(linha.slice(18, 32), "00086048486570");
  assert.equal(linha.slice(127, 226).trimEnd(), "86048486570");
});

test("B PIX, chave CNPJ: tipo 2 e o CNPJ da chave", () => {
  const linha = montarSegmentoBPixChave(1, 2, pix("cnpj", "48208075000199", "86048486570"));
  assert.equal(linha.slice(14, 16), "03");
  assert.equal(linha.slice(17, 18), "2");
  assert.equal(linha.slice(18, 32), "48208075000199");
  assert.equal(linha.slice(127, 226).trimEnd(), "48208075000199");
});

test("B PIX, chaves telefone, e-mail e aleatória: 019-032 é o documento do favorecido", () => {
  const casos: Array<[PagamentoPixChave["tipoChave"], string, string]> = [
    ["telefone", "+5571999998888", "01"],
    ["email", "financeiro@fornecedor.com.br", "02"],
    ["aleatoria", "123e4567-e89b-12d3-a456-426614174000", "04"],
  ];
  for (const [tipo, chave, forma] of casos) {
    const linha = montarSegmentoBPixChave(1, 2, pix(tipo, chave, "48208075000199"));
    assert.equal(linha.length, 240, tipo);
    assert.equal(linha.slice(14, 16), forma, `forma de iniciação ${tipo}`);
    assert.equal(linha.slice(17, 18), "2", tipo);
    assert.equal(linha.slice(18, 32), "48208075000199", tipo);
    assert.equal(linha.slice(127, 226).trimEnd(), chave, `Informação 12 ${tipo}`);
  }
});

test("B PIX recusa documento que não é CPF nem CNPJ", () => {
  assert.throws(() => montarSegmentoBPixChave(1, 2, pix("email", "a@b.com", "123")));
});

test("Arquivo PIX completo: estrutura do PE000014 corrigida", () => {
  const conteudo = gerarArquivo(EMPRESA_CALIFORNIA, CONTA_SANTANDER, {
    sequencialArquivo: 16,
    dataGeracao: new Date("2026-09-23T15:00:00-03:00"),
  }, [
    { formaLancamento: "45", tipoServico: "20", pagamentos: [pix("cpf", "86098531528", "86098531528")] },
  ]);
  assert.ok(conteudo.endsWith("\r\n"));
  const linhas = conteudo.split("\r\n").slice(0, -1);
  assert.equal(linhas.length, 6);
  for (const l of linhas) assert.equal(l.length, 240);
  const [h0, h1, a, b, t5, t9] = linhas;
  assert.equal(h0.slice(143, 151), "23092026");
  assert.equal(h0.slice(151, 157), "150000");
  assert.equal(h0.slice(157, 163), "000016");
  assert.equal(h1.slice(8, 16), "C2045031", "crédito, fornecedor, PIX, versão 031");
  assert.equal(a.slice(13, 20), "A000009", "segmento A, inclusão, câmara PIX");
  assert.equal(a.slice(20, 43), "00000000 000000000000  ", "banco/agência/conta zerados");
  assert.equal(a.slice(93, 104), "23092026BRL");
  assert.equal(a.slice(119, 134), "000000000000005", "R$ 0,05");
  assert.equal(b.slice(13, 32), "B03 100086098531528");
  assert.equal(t5.slice(17, 41), "000004000000000000000005");
  assert.equal(t9.slice(17, 29), "000001000006");
});

// ---------------------------------------------------------------------
// A régua da chave PIX (lib/pix.ts) — o que o cadastro deixa gravar
// ---------------------------------------------------------------------

test("problemaDaChavePix aceita as chaves no formato do banco", () => {
  assert.equal(problemaDaChavePix("cpf", "860.985.315-28"), null);
  assert.equal(problemaDaChavePix("cnpj", "48.208.075/0001-99"), null);
  assert.equal(problemaDaChavePix("telefone", "(71) 99999-8888"), null);
  assert.equal(problemaDaChavePix("telefone", "+55 71 99999-8888"), null);
  assert.equal(problemaDaChavePix("email", "Financeiro@Fornecedor.com.br"), null);
  assert.equal(problemaDaChavePix("aleatoria", "123E4567E89B12D3A456426614174000"), null);
  assert.equal(problemaDaChavePix(null, null), null, "sem PIX é permitido");
});

test("problemaDaChavePix recusa o que o banco não aceita", () => {
  assert.notEqual(problemaDaChavePix("cpf", "86098531529"), null, "DV errado");
  assert.notEqual(problemaDaChavePix("cnpj", "48208075000190"), null, "DV errado");
  assert.notEqual(problemaDaChavePix("telefone", "(71) 3333-4444"), null, "fixo não é chave");
  assert.notEqual(problemaDaChavePix("telefone", "(71) 89999-8888"), null, "celular começa com 9");
  assert.notEqual(problemaDaChavePix("email", "fulano@"), null);
  assert.notEqual(problemaDaChavePix("email", "fulano de tal@x.com"), null);
  assert.notEqual(problemaDaChavePix("email", `${"a".repeat(70)}@exemplo.com`), null, "mais de 77");
  assert.notEqual(problemaDaChavePix("aleatoria", "123e4567-e89b-12d3-a456"), null);
  assert.notEqual(problemaDaChavePix("cpf", null), null, "tipo sem chave");
  assert.notEqual(problemaDaChavePix(null, "86098531528"), null, "chave sem tipo");
});

test("normalizarChavePix + PIX_FORMATO: o canônico bate com a CHECK do banco", () => {
  const casos: Array<[PixTipo, string]> = [
    ["cpf", "860.985.315-28"],
    ["cnpj", "48.208.075/0001-99"],
    ["telefone", "71999998888"],
    ["email", " Fulano@Exemplo.COM "],
    ["aleatoria", "123E4567E89B12D3A456426614174000"],
  ];
  for (const [tipo, bruto] of casos) {
    const canonica = normalizarChavePix(tipo, bruto)!;
    assert.ok(PIX_FORMATO[tipo].test(canonica), `${tipo}: ${canonica}`);
  }
});
