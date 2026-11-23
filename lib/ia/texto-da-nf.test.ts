// node --import tsx --test lib/ia/texto-da-nf.test.ts
// Textos sintéticos no formato dos layouts reais, com dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chaveDeAcesso, lerPeloTexto, normalizarTextoDoPdf } from "./texto-da-nf";
import { leituraParaGravar, type DadosBrutosNotaTomada } from "./ler-nota-tomada";


// A chave de acesso sintética, com o dígito verificador (módulo 11, pesos 2 a 9).
function comDigito(corpo: string): string {
  let soma = 0;
  let peso = 2;
  for (let i = corpo.length - 1; i >= 0; i--) {
    soma += Number(corpo[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return corpo + (resto < 2 ? 0 : 11 - resto);
}
/** NFS-e nacional: município, ambiente, CNPJ (tipo 2), número (13), AAMM, código. */
const chaveNfse = (numero13: string, aamm = "2610") => comDigito(`2927408` + `1` + `2` + `11222333000181` + numero13 + aamm + `123456789`);
/** NF-e: UF, AAMM, CNPJ, modelo 55, série, número (9), tipo de emissão, código. */
const chaveNfe = (numero9: string) => comDigito(`29` + `2610` + `11222333000181` + `55` + `001` + numero9 + `1` + `12345678`);
const emGruposDe4 = (chave: string) => chave.match(/.{1,4}/g)!.join(" ");

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
CHAVE DE ACESSO
${emGruposDe4(chaveNfe("000000063"))}
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

test("DANFE: Nº antes da série, data de emissão, valor total e o CNPJ da chave de acesso", () => {
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

const NOTA_SAO_PAULO = `PREFEITURA DO MUNICÍPIO DE SÃO PAULO
SECRETARIA MUNICIPAL DA FAZENDA
NOTA FISCAL ELETRÔNICA DE SERVIÇOS - NFS-e
Número da Nota
Data e Hora de Emissão
Código de Verificação
20261021u11222333000181
RPS Nº 14 Série 11, emitido em 21/10/2026
00000013
21/10/2026 11:18:29
ABCD-1234
Identificador Nacional: ${chaveNfse("0000000000013")}
PRESTADOR DE SERVIÇOS
CPF/CNPJ:Inscrição Municipal:
11.222.333/0001-810.000.000-0
FORNECEDOR 004 EXEMPLO
TOMADOR DE SERVIÇOS
00.000.000/0001-91----
VALOR TOTAL DO SERVIÇO = R$ 1.200,00`;

test("NFS-e de São Paulo: o número da nota, não o do RPS; a emissão colada no número", () => {
  assert.deepEqual(lerPeloTexto(NOTA_SAO_PAULO), { numero: "00000013", cnpj: "11222333000181", emissao: "2026-10-21", valor: 1200 });
});

test("NFS-e: o \"Valor total: R$\" de cada item da discriminação não é o total da nota", () => {
  const comItens = NOTA_SAO_PAULO.replace(
    "VALOR TOTAL DO SERVIÇO",
    "- 17 quadros em acrílico\nValor unitário: R$ 50,00 Valor total: R$ 850,00\n- 01 peça, emissão: 01/01/2020\nValor total: R$ 350,00\nVALOR TOTAL DO SERVIÇO",
  );
  assert.deepEqual(lerPeloTexto(comItens), { numero: "00000013", cnpj: "11222333000181", emissao: "2026-10-21", valor: 1200 });
});

test("DANFE com os valores colados: o canhoto dá a emissão e o total, não o frete", () => {
  const danfe = `DANFE
Nº.000.000.911
Série1
VALORTOTALDOSPRODUTOS
0,000,000,000,0017.770,00
VALORDOFRETEVALORDOSEGURODESCONTOOUTRASDESPESASVALORTOTALDOIPIVALORTOTALDANOTA
1.500,000,000,00
0,00
0,0019.270,00
RECEBEMOSDEFORNECEDOR005EXEMPLOOSPRODUTOS
AOLADO.EMISSÃO:16/11/2026VALORTOTAL:R$19.270,00DESTINATÁRIO:CALIFORNIAEXEMPLO
${emGruposDe4(chaveNfe("000000911"))}
135264953624704 16/11/2026`;
  assert.deepEqual(lerPeloTexto(danfe), { numero: "000.000.911", cnpj: "11222333000181", emissao: "2026-11-16", valor: 19270 });
  // Sem o canhoto: o total é o último valor da linha do "VALOR TOTAL DA NOTA".
  const semCanhoto = danfe.replace(/AOLADO.*\n/, "");
  assert.equal(lerPeloTexto(semCanhoto).valor, 19270);
});

test("o CNPJ do tomador nunca é o do emitente, mesmo vindo depois do PRESTADOR no texto", () => {
  const dps = `DECLARAÇÃO PROVISÓRIA DE SERVIÇOS - DPS
FORNECEDOR 006 EXEMPLO
PRESTADOR DE SERVIÇOS
00.000.000/0001-91
CALIFORNIA EXEMPLO
TOMADOR DE SERVIÇOS
VALOR TOTAL DA NOTA = R$ 205,00`;
  assert.equal(lerPeloTexto(dps, new Set(["00000000000191"])).cnpj, null);
});

test("DANFSe com a data em traços e com os rótulos juntos antes dos valores", () => {
  const tracos = DANFSE.replace("19/10/2026 11:50:50", "19-10-2026 11:50:50");
  assert.equal(lerPeloTexto(tracos).emissao, "2026-10-19");
  const juntos =
    "NÚMERODANFS-e COMPETÊNCIADANFS-e DATAE HORADAEMISSÃODANFS-e 64 01/10/2026 28/10/2026 15:37:16 NÚMERODADPS SÉRIEDADPS " +
    "PRESTADOR/ FORNECEDOR CNPJ/ CPF/ NIF 11.222.333/0001-81 TOMADOR/ ADQUIRENTE";
  assert.deepEqual(lerPeloTexto(juntos), { numero: "64", cnpj: "11222333000181", emissao: "2026-10-28", valor: null });
});

test("chave de acesso: número e CNPJ, com o dígito verificador conferido", () => {
  assert.deepEqual(chaveDeAcesso(`CHAVE DE ACESSO DA NFS-e\n${chaveNfse("0000000000028")}\nA autenticidade`), { numero: "28", cnpj: "11222333000181" });
  // O município que numera com o ano na frente: "2026000000135" é a nota 135.
  assert.deepEqual(chaveDeAcesso(chaveNfse("2026000000135")), { numero: "135", cnpj: "11222333000181" });
  // NF-e em grupos de 4, com o protocolo na linha de baixo.
  assert.deepEqual(chaveDeAcesso(`${emGruposDe4(chaveNfe("000000063"))}\n135264953624704`), { numero: "63", cnpj: "11222333000181" });
  // Um dígito trocado: não é chave.
  const errada = chaveNfse("0000000000028").replace(/^2927/, "2928");
  assert.equal(chaveDeAcesso(errada), null);
});

test("o texto do PDF sai sem caracteres de controle (o jsonb não aceita o nulo)", () => {
  const sujo = "NOTA\u0000 FISCAL\u0007\n  Número   da Nota:\u001f 00000078\r\n";
  const limpo = normalizarTextoDoPdf(sujo);
  assert.equal(limpo, "NOTA FISCAL\nNúmero da Nota: 00000078");
  assert.doesNotThrow(() => JSON.parse(JSON.stringify({ texto_bruto: limpo })));
  assert.ok(!/[\u0000-\u0008]/.test(limpo));
});

test("sem rótulo de número: vale o da chave", () => {
  const texto = `NOTA FISCAL DE SERVIÇOS ELETRÔNICA - NFS-e\nPRESTADOR DE SERVIÇOS\n11.222.333/0001-81\n${chaveNfse("2026000000135")}`;
  assert.equal(lerPeloTexto(texto).numero, "135");
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
