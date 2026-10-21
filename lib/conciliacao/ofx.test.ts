/**
 * Testes da leitura do OFX e da impressão digital (decisão 198), com o
 * arquivo de exemplo do protótipo "Conciliação com o banco".
 *
 * Rode com:  node --import tsx --test lib/conciliacao/ofx.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { arquivoEhDaConta, bancoDoArquivoConfere, contaTemNumero, digitais, lerOfx, normalizar, rotuloDoBanco, valorOfx } from "./ofx";

const PROTOTIPO = "../../docs/handoffs/2026-10-21-conciliacao-com-o-banco/prototipo/src/data.js";

async function exemplo(): Promise<string> {
  const dados = (await import(PROTOTIPO)) as { ofxDeExemplo: (horario: string) => string };
  return dados.ofxDeExemplo("091923").replace("__SALDO__", "1029764,73");
}

test("o exemplo do Santander: SGML, vírgula decimal, LEDGERBAL e DTSERVER", async () => {
  const ofx = lerOfx(await exemplo());
  assert.equal(ofx.movimentos.length, 58);
  assert.equal(ofx.bancoId, "033");
  assert.equal(ofx.conta, "0001130000013");
  assert.equal(ofx.geradoEm, "2026-10-20");
  assert.equal(ofx.geradoHora, "09:19");
  assert.equal(ofx.geradoInstante, "2026-10-20T09:19:23-03:00");
  assert.equal(ofx.saldoBanco, 1029764.73);
  assert.equal(ofx.fim, "2026-10-19");
  // Vírgula decimal e sinal.
  assert.ok(ofx.movimentos.every((m) => Number.isFinite(m.valor) && m.valor !== 0));
  assert.ok(ofx.movimentos.some((m) => m.valor < 0) && ofx.movimentos.some((m) => m.valor > 0));
  assert.ok(ofx.movimentos.every((m) => m.data === "2026-10-19"));
});

test("a segunda importação do mesmo dia não acrescenta linhas", async () => {
  const texto = await exemplo();
  const a = digitais(lerOfx(texto).movimentos, "conta-1");
  const b = digitais(lerOfx(texto.replace("091923", "114012")).movimentos, "conta-1");
  assert.equal(new Set(a).size, 58);
  assert.deepEqual(b.filter((d) => !a.includes(d)), []);
});

test("linhas iguais no mesmo dia: a posição entre os iguais as separa", () => {
  const m = { data: "2026-10-19", valor: -3000, historico: "PIX ENVIADO" };
  const d = digitais([m, { ...m }, { ...m, historico: "pix  enviado" }], "c");
  assert.deepEqual(d, ["c|2026-10-19|-300000|PIX ENVIADO|1", "c|2026-10-19|-300000|PIX ENVIADO|2", "c|2026-10-19|-300000|PIX ENVIADO|3"]);
});

test("a digital é da conta: a mesma linha em outra conta é outra", () => {
  const m = [{ data: "2026-10-19", valor: -10, historico: "TAR PACOTE" }];
  assert.notEqual(digitais(m, "a")[0], digitais(m, "b")[0]);
});

test("o valor com vírgula, com ponto e com os dois", () => {
  assert.equal(valorOfx("-1920,00"), -1920);
  assert.equal(valorOfx("-1920.00"), -1920);
  assert.equal(valorOfx("1.234,56"), 1234.56);
  assert.equal(valorOfx("1,234.56"), 1234.56);
  assert.equal(valorOfx(""), 0);
  assert.equal(valorOfx(null), 0);
});

test("OFX em XML 2.x, sem DTSERVER e sem fuso", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><?OFX OFXHEADER="200" VERSION="211"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF>
<BANKACCTFROM><BANKID>341</BANKID><ACCTID>1234567890</ACCTID></BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001</DTSTART><DTEND>20261002</DTEND>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261001120000</DTPOSTED><TRNAMT>-150.25</TRNAMT><FITID>1</FITID><MEMO>Pagamento de título</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261002</DTPOSTED><TRNAMT>300.00</TRNAMT><FITID>2</FITID><NAME>TED RECEBIDA</NAME></STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>1149.75</BALAMT><DTASOF>20261002</DTASOF></LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const ofx = lerOfx(xml);
  assert.equal(ofx.movimentos.length, 2);
  assert.equal(ofx.movimentos[0].valor, -150.25);
  assert.equal(ofx.movimentos[0].historico, "Pagamento de título");
  assert.equal(ofx.movimentos[1].historico, "TED RECEBIDA");
  assert.equal(ofx.geradoEm, null);
  assert.equal(ofx.geradoHora, null);
  assert.equal(ofx.saldoBanco, 1149.75);
  assert.equal(ofx.saldoEm, "2026-10-02");
});

test("o histórico normalizado: sem acento, maiúsculas, espaços juntados", () => {
  assert.equal(normalizar("  Pagamento  de título "), "PAGAMENTO DE TITULO");
});

test("o banco do arquivo confere com o do cadastro", () => {
  assert.equal(bancoDoArquivoConfere("033", "Santander"), true);
  assert.equal(bancoDoArquivoConfere("033", "Bradesco"), false);
  assert.equal(bancoDoArquivoConfere("999", "Banco Teste"), true);
  assert.equal(rotuloDoBanco("033"), "033 · Santander");
  assert.equal(rotuloDoBanco("1"), "001 · Banco do Brasil");
});

test("a conta do arquivo: agência + conta com o dígito, ou o final da conta", () => {
  const conta = { agencia: "0001", numero_conta: "13000001", numero_conta_dv: "3" };
  assert.equal(arquivoEhDaConta("0001130000013", conta), true);
  assert.equal(arquivoEhDaConta("130000013", conta), true);
  assert.equal(arquivoEhDaConta("0001-13000001-3", conta), true);
  assert.equal(arquivoEhDaConta("0001130000099", conta), false);
  assert.equal(arquivoEhDaConta("", conta), false);
  // Sem número no cadastro, nada se reconhece.
  assert.equal(arquivoEhDaConta("0001130000013", { agencia: "0001", numero_conta: null, numero_conta_dv: null }), false);
  assert.equal(contaTemNumero({ numero_conta: "123", numero_conta_dv: null }), false);
  assert.equal(contaTemNumero({ numero_conta: "123", numero_conta_dv: "4" }), true);
});
