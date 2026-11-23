// node --import tsx --test lib/ia/texto-da-nf.test.ts
// Textos sintéticos no formato dos layouts reais, com dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lerPeloTexto } from "./texto-da-nf";
import { leituraParaGravar, type DadosBrutosNotaTomada } from "./ler-nota-tomada";

const DANFSE = `DANFSe v2.0
Documento Auxiliar da NFS-e
Chave de Acesso da NFS-e
29274082200000000000000000000000000000000000000000
Número da NFS-e
28
Competência da NFS-e
19/10/2026
Data e Hora da Emissão da NFS-e
19/10/2026 11:50:50
Número da DPS
11
Série da DPS
70000
Data e Hora da Emissão da DPS
19/10/2026 11:50:50
PRESTADOR / FORNECEDOR
CNPJ / CPF / NIF
11.222.333/0001-81
Nome / Nome Empresarial
FORNECEDOR 001 EXEMPLO
TOMADOR / ADQUIRENTE
CNPJ / CPF / NIF
00.000.000/0001-91
VALOR TOTAL DA NFS-e
Valor da Operação / Serviço
R$ 5.000,00
Valor Líquido da NFS-e
R$ 5.000,00`;

const NOTA_MUNICIPAL = `PREFEITURA MUNICIPAL DO SALVADOR
SECRETARIA MUNICIPAL DA FAZENDA
Número da Nota:
00000078
Data e Hora de Emissão:
22/10/2026 11:12:39
Código de Verificação:
ABCD-1234
NOTA FISCAL DE SERVIÇOS ELETRÔNICA - Nota Salvador
PRESTADOR DE SERVIÇOS
CPF/CNPJ:
11.222.333/0001-81
Nome/Razão Social:
FORNECEDOR 002 EXEMPLO
TOMADOR DE SERVIÇOS / ADQUIRENTE
CPF/CNPJ:
00.000.000/0001-91
VALOR TOTAL DA NOTA = R$5.500,00`;

const DANFE = `RECEBEMOS DE FORNECEDOR 003 EXEMPLO OS PRODUTOS
NF-e
Nº 63
Série 1
FORNECEDOR 003 EXEMPLO
DANFE
CNPJ
11.222.333/0001-81
DESTINATÁRIO/REMETENTE
CALIFORNIA EXEMPLO
CNPJ/CPF
00.000.000/0001-91
DATA DE EMISSÃO
13/10/2026
VALOR TOTAL DA NOTA
1.878,00`;

test("DANFSe v2.0: número da NFS-e (não o da DPS), emissão com hora, valor e CNPJ do prestador", () => {
  assert.deepEqual(lerPeloTexto(DANFSE), { numero: "28", cnpj: "11222333000181", emissao: "2026-10-19", valor: 5000 });
});

test("NFS-e municipal: número da nota, data e hora de emissão, valor total e CNPJ do prestador", () => {
  assert.deepEqual(lerPeloTexto(NOTA_MUNICIPAL), { numero: "00000078", cnpj: "11222333000181", emissao: "2026-10-22", valor: 5500 });
});

test("DANFE: Nº antes da série, data de emissão, valor total e o CNPJ antes do destinatário", () => {
  assert.deepEqual(lerPeloTexto(DANFE), { numero: "63", cnpj: "11222333000181", emissao: "2026-10-13", valor: 1878 });
});

test("DANFSe como o pdf-parse entrega: palavras dos rótulos coladas, data grudada na hora", () => {
  const colado =
    "N°NFS-e / CHAVENFS-e 28/ 2927408 DANFSev2.0 NÚMERODANFS-e 28 COMPETÊNCIADANFS-e 19/10/2026 DATAE HORADAEMISSÃODANFS-e 19/10/202611:50:50 " +
    "NÚMERODADPS 11 SÉRIEDADPS 70000 EMITENTEDANFS-e Prestador SITUAÇÃODANFS-e NFS-e MEI FINALIDADE - PRESTADOR/ FORNECEDOR CNPJ/ CPF/ NIF 11.222.333/0001-81 " +
    "TOMADOR/ ADQUIRENTE CNPJ/ CPF/ NIF 00.000.000/0001-91 VALORTOTALDANFS-e VALORDAOPERAÇÃO/ SERVIÇO R$5.000,00 VALORLÍQUIDODANFS-e R$5.000,00";
  assert.deepEqual(lerPeloTexto(colado), { numero: "28", cnpj: "11222333000181", emissao: "2026-10-19", valor: 5000 });
});

test("CNPJ com dígito verificador errado não vale", () => {
  assert.equal(lerPeloTexto(DANFSE.replace("11.222.333/0001-81", "00.000.000/0001-00")).cnpj, null);
});

test("texto sem os rótulos: nada sai", () => {
  assert.deepEqual(lerPeloTexto("Recibo de pagamento qualquer, sem os campos de uma nota."), {
    numero: null,
    cnpj: null,
    emissao: null,
    valor: null,
  });
});

// A comparação das duas leituras.
const vazia = { aliquota: null, valor: null };
const imagem: DadosBrutosNotaTomada = {
  numero_nf: "28",
  cnpj_emissor: "11222333000181",
  data_emissao: "2016-10-19",
  valor_total: 5000,
  descricao_servico: "Direção de arte",
  cnae: null,
  codigo_servico: "13.05.01",
  municipio_prestacao: "Salvador/BA",
  competencia: "2026-10",
  codigo_verificacao: null,
  retencoes: { iss: vazia, irrf: vazia, pis: vazia, cofins: vazia, csll: vazia, inss: vazia },
  confianca_baixa: false,
};
const nota = { numero: "28", cnpjEmitente: "11222333000181", valor: 5000, emissao: "2026-10-19" };

test("a imagem erra o ano e o texto acerta: vale o texto, sem divergência, e a discordância fica guardada", () => {
  const r = leituraParaGravar(imagem, nota, lerPeloTexto(DANFSE));
  assert.deepEqual(r.leitura.divergencias, []);
  assert.deepEqual(r.leitura.discordancias, ["emissao"]);
  assert.equal(r.leitura.pdf.emissao, "2026-10-19");
  assert.equal(r.leitura.imagem.emissao, "2016-10-19");
  assert.equal(r.leitura.so_imagem, false);
});

test("sem texto: vale a imagem e a nota fica marcada como só pela imagem", () => {
  const r = leituraParaGravar(imagem, nota, null);
  assert.deepEqual(r.leitura.divergencias, ["emissao"]);
  assert.equal(r.leitura.so_imagem, true);
  assert.deepEqual(r.leitura.discordancias, []);
});

test("o texto sem algum campo: a imagem completa", () => {
  const r = leituraParaGravar({ ...imagem, data_emissao: "2026-10-19" }, nota, { numero: "28", cnpj: null, emissao: null, valor: null });
  assert.equal(r.leitura.pdf.emissao, "2026-10-19");
  assert.equal(r.leitura.pdf.cnpj, "11222333000181");
  assert.deepEqual(r.leitura.divergencias, []);
});
