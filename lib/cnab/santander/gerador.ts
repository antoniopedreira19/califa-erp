/**
 * Gerador de arquivo CNAB 240 Santander (layout v11.7, junho/2026).
 *
 * Referência: docs/modulos/pgto-remessa/00-descoberta.md §2.
 * Espelho: PE000013.TXT (arquivo antigo aceito pelo Santander) — o teste
 * unitário `gerador.test.ts` reproduz esse arquivo byte a byte com os
 * mesmos inputs, validando que a implementação bate.
 *
 * Formas de pagamento cobertas no MVP:
 *   • 01 — Crédito em CC Santander (segmentos A + B)
 *   • 03 — TED       (segmentos A + B, finalidade obrigatória)
 *   • 45 — PIX chave (segmentos A + B, forma de iniciação 01-04)
 *   • 45 — PIX por dados bancários (A + B, forma 05)
 *
 * Fora do escopo desta biblioteca:
 *   • Boleto (segmento J + J52) — entra na próxima iteração
 *   • PIX QR Code dinâmico (J + J52-PIX) — fase 2
 *   • Tributo com código de barras (O), OCT (I), DDA (G) — fora do MVP
 */

import {
  assert240,
  brancos,
  formatDate,
  formatMoneyV2,
  formatTime,
  padAlpha,
  padNumeric,
  zeros,
} from "./campos";
import type {
  ContaDebito,
  EmpresaPagadora,
  MetadadosArquivo,
  Pagamento,
  PagamentoCreditoContaOuTED,
  PagamentoPixChave,
  PagamentoPixDadosBancarios,
} from "./tipos";

const BANCO_SANTANDER = "033";
const NOME_BANCO_HEADER = "Banco Santander  (Brasil)  S/A";

// ---------------------------------------------------------------------
// Header de Arquivo (tipo 0) — 1x no arquivo, primeiro registro
// ---------------------------------------------------------------------

export function montarHeaderArquivo(
  empresa: EmpresaPagadora,
  conta: ContaDebito,
  meta: MetadadosArquivo,
): string {
  const linha =
    /* 001-003 */ BANCO_SANTANDER +
    /* 004-007 */ "0000" +
    /* 008     */ "0" +
    /* 009-017 */ brancos(9) +
    /* 018     */ "2" + // 2 = CNPJ
    /* 019-032 */ padNumeric(empresa.cnpj, 14) +
    /* 033-052 */ montarCodigoConvenio(conta) +
    /* 053-057 */ padNumeric(conta.agencia, 5) +
    /* 058     */ (conta.agenciaDv ? conta.agenciaDv[0] : " ") +
    /* 059-070 */ padNumeric(conta.conta, 12) +
    /* 071     */ conta.contaDv[0] +
    /* 072     */ " " +
    /* 073-102 */ padAlpha(empresa.razaoSocial, 30) +
    /* 103-132 */ padAlpha(NOME_BANCO_HEADER, 30) +
    /* 133-142 */ brancos(10) +
    /* 143     */ "1" + // 1 = Remessa
    /* 144-151 */ formatDate(meta.dataGeracao) +
    /* 152-157 */ formatTime(meta.dataGeracao) +
    /* 158-163 */ padNumeric(meta.sequencialArquivo, 6) +
    /* 164-166 */ "060" + // versão layout
    /* 167-171 */ zeros(5) + // densidade — arquivo real usa "00000"
    /* 172-191 */ brancos(20) +
    /* 192-211 */ brancos(20) +
    /* 212-230 */ brancos(19) +
    /* 231-240 */ brancos(10);

  return assert240(linha, "header de arquivo");
}

/** Nota G009: BBBBAAAACCCCCCCCCCCC (20 pos).
 *  BBBB = banco 033 zero-padded pra 4; AAAA = agência (4); C×12 = convênio.
 *  O convênio armazenado no banco JÁ vem nesse formato (20 pos alfanuméricas)
 *  — só copia bruto. Se vier vazio, monta a partir dos campos. */
function montarCodigoConvenio(conta: ContaDebito): string {
  if (conta.convenio && conta.convenio.length === 20) {
    return conta.convenio;
  }
  // Fallback: monta a partir de banco + agência + convênio parcial
  throw new Error(
    `Convênio deve ter 20 posições (recebido: "${conta.convenio}").`,
  );
}

// ---------------------------------------------------------------------
// Header de Lote (tipo 1) — 1 por forma de pagamento
// ---------------------------------------------------------------------

/** Códigos de forma de lançamento (Nota G002 do manual). */
export type FormaLancamento =
  | "01" // Crédito em CC
  | "03" // TED
  | "05" // Poupança
  | "45"; // PIX por chave/dados

/** Tipo de serviço (Nota G015). MVP usa 20 = Pagamento Fornecedor. */
export type TipoServico = "20";

export function montarHeaderLote(
  loteNum: number,
  formaLancamento: FormaLancamento,
  tipoServico: TipoServico,
  empresa: EmpresaPagadora,
  conta: ContaDebito,
  informacaoMensagem?: string,
): string {
  const linha =
    /* 001-003 */ BANCO_SANTANDER +
    /* 004-007 */ padNumeric(loteNum, 4) +
    /* 008     */ "1" +
    /* 009     */ "C" +
    /* 010-011 */ tipoServico +
    /* 012-013 */ formaLancamento +
    /* 014-016 */ "031" + // versão do lote pra segmento A (Nota G031)
    /* 017     */ " " +
    /* 018     */ "2" + // CNPJ
    /* 019-032 */ padNumeric(empresa.cnpj, 14) +
    /* 033-052 */ montarCodigoConvenio(conta) +
    /* 053-057 */ padNumeric(conta.agencia, 5) +
    /* 058     */ (conta.agenciaDv ? conta.agenciaDv[0] : " ") +
    /* 059-070 */ padNumeric(conta.conta, 12) +
    /* 071     */ conta.contaDv[0] +
    /* 072     */ " " +
    /* 073-102 */ padAlpha(empresa.razaoSocial, 30) +
    /* 103-142 */ padAlpha(informacaoMensagem ?? "", 40) +
    /* 143-172 */ padAlpha(empresa.enderecoLogradouro ?? "", 30) +
    /* 173-177 */ zeros(5) + // número — deixamos 0 (o endereço já traz)
    /* 178-192 */ brancos(15) + // complemento
    /* 193-212 */ padAlpha(empresa.enderecoCidade ?? "", 20) +
    /* 213-217 */ padNumeric(splitCep(empresa.enderecoCep).cep5, 5) +
    /* 218-220 */ padNumeric(splitCep(empresa.enderecoCep).cep3, 3) +
    /* 221-222 */ padAlpha(empresa.enderecoUf ?? "", 2) +
    /* 223-230 */ brancos(8) +
    /* 231-240 */ brancos(10);

  return assert240(linha, "header de lote");
}

function splitCep(cep: string | null | undefined): {
  cep5: string;
  cep3: string;
} {
  const digits = (cep ?? "").replace(/\D/g, "");
  if (digits.length === 0) return { cep5: "", cep3: "" };
  const padded = digits.padStart(8, "0");
  return { cep5: padded.slice(0, 5), cep3: padded.slice(5, 8) };
}

// ---------------------------------------------------------------------
// Segmento A (tipo 3) — pagamento em CC, TED ou PIX
// ---------------------------------------------------------------------

/** Câmara de compensação (Nota G014):
 *   000 = CC Santander
 *   009 = PIX
 *   018 = TED CIP
 *   810 = TED STR (usado quando favorecido é Instituição Financeira) */
function camaraDeCompensacao(pagamento: Pagamento): string {
  switch (pagamento.tipo) {
    case "credito_conta":
      return "000";
    case "ted":
      return "018";
    case "pix_chave":
    case "pix_dados":
      return "009";
  }
}

/** Código do tipo de conta favorecida (Nota G013 B): "CC" ou "PP". */
function tipoContaCodigo(
  tipo: "corrente" | "poupanca" | "pagamento",
): string {
  return tipo === "poupanca" ? "PP" : "CC";
}

export function montarSegmentoA(
  loteNum: number,
  sequencialNoLote: number,
  pagamento: Exclude<Pagamento, { tipo: "pix_chave" }>,
): string {
  const camara = camaraDeCompensacao(pagamento);

  // Casos: crédito_conta, ted, pix_dados. pix_chave usa formato ligeiramente
  // diferente no B mas o A é igual, então tratamos separado.
  const p = pagamento as PagamentoCreditoContaOuTED | PagamentoPixDadosBancarios;

  const finalidade =
    p.tipo === "ted" && p.finalidadeTED
      ? padAlpha(p.finalidadeTED, 5)
      : brancos(5);

  const linha =
    /* 001-003 */ BANCO_SANTANDER +
    /* 004-007 */ padNumeric(loteNum, 4) +
    /* 008     */ "3" +
    /* 009-013 */ padNumeric(sequencialNoLote, 5) +
    /* 014     */ "A" +
    /* 015     */ "0" + // tipo movimento: inclusão
    /* 016-017 */ "00" + // instrução: inclusão liberado
    /* 018-020 */ camara +
    /* 021-023 */ padNumeric(p.bancoFavorecido, 3) +
    /* 024-028 */ padNumeric(p.agenciaFavorecida, 5) +
    /* 029     */ (p.agenciaFavorecidaDv ? p.agenciaFavorecidaDv[0] : " ") +
    /* 030-041 */ padNumeric(p.contaFavorecida, 12) +
    /* 042     */ p.contaFavorecidaDv[0] +
    /* 043     */ p.contaFavorecidaDv[0] + // DV agência/conta — Santander usa igual
    /* 044-073 */ padAlpha(p.nomeFavorecido, 30) +
    /* 074-093 */ padAlpha(p.seuNumero, 20) +
    /* 094-101 */ formatDate(p.dataPagamento) +
    /* 102-104 */ "BRL" +
    /* 105-119 */ zeros(15) + // quantidade de moeda
    /* 120-134 */ formatMoneyV2(p.valor, 15) +
    /* 135-154 */ brancos(20) + // nosso número (banco preenche)
    /* 155-162 */ zeros(8) + // data real (só retorno)
    /* 163-177 */ zeros(15) + // valor real (só retorno)
    /* 178-217 */ padAlpha("", 40) + // informação 2 - mensagem
    /* 218-219 */ brancos(2) +
    /* 220-224 */ finalidade +
    /* 225-226 */ padAlpha(tipoContaCodigo(p.tipoContaFavorecida), 2) +
    /* 227-229 */ brancos(3) +
    /* 230     */ "0" + // sem aviso ao favorecido
    /* 231-240 */ brancos(10);

  return assert240(linha, "segmento A");
}

/** Segmento A do PIX chave. A diferença do A normal é que os campos
 *  bancários (agência, conta, banco) vêm zerados/brancos — o destinatário
 *  é resolvido pela chave no segmento B. */
export function montarSegmentoAPixChave(
  loteNum: number,
  sequencialNoLote: number,
  pagamento: PagamentoPixChave,
): string {
  const linha =
    /* 001-003 */ BANCO_SANTANDER +
    /* 004-007 */ padNumeric(loteNum, 4) +
    /* 008     */ "3" +
    /* 009-013 */ padNumeric(sequencialNoLote, 5) +
    /* 014     */ "A" +
    /* 015     */ "0" +
    /* 016-017 */ "00" +
    /* 018-020 */ "009" + // câmara PIX
    /* 021-023 */ zeros(3) + // banco favorecido — zerado
    /* 024-028 */ zeros(5) + // agência — zerada
    /* 029     */ " " +
    /* 030-041 */ zeros(12) + // conta — zerada
    /* 042     */ " " +
    /* 043     */ " " +
    /* 044-073 */ padAlpha(pagamento.nomeFavorecido, 30) +
    /* 074-093 */ padAlpha(pagamento.seuNumero, 20) +
    /* 094-101 */ formatDate(pagamento.dataPagamento) +
    /* 102-104 */ "BRL" +
    /* 105-119 */ zeros(15) +
    /* 120-134 */ formatMoneyV2(pagamento.valor, 15) +
    /* 135-154 */ brancos(20) +
    /* 155-162 */ zeros(8) +
    /* 163-177 */ zeros(15) +
    /* 178-217 */ padAlpha("", 40) +
    /* 218-219 */ brancos(2) +
    /* 220-224 */ brancos(5) + // sem finalidade TED
    /* 225-226 */ "CC" + // default
    /* 227-229 */ brancos(3) +
    /* 230     */ "0" +
    /* 231-240 */ brancos(10);

  return assert240(linha, "segmento A PIX chave");
}

// ---------------------------------------------------------------------
// Segmento B (tipo 3) — endereço do favorecido (CC/TED/PIX dados)
// e forma de iniciação + chave (PIX chave)
// ---------------------------------------------------------------------

export function montarSegmentoB(
  loteNum: number,
  sequencialNoLote: number,
  pagamento: Exclude<Pagamento, { tipo: "pix_chave" }>,
): string {
  const p = pagamento;
  const linha =
    /* 001-003 */ BANCO_SANTANDER +
    /* 004-007 */ padNumeric(loteNum, 4) +
    /* 008     */ "3" +
    /* 009-013 */ padNumeric(sequencialNoLote, 5) +
    /* 014     */ "B" +
    /* 015-017 */ brancos(3) +
    /* 018     */ (p.favorecidoEhCnpj ? "2" : "1") +
    /* 019-032 */ padNumeric(p.documentoFavorecido, 14) +
    /* 033-062 */ padAlpha(p.favorecidoLogradouro ?? "", 30) +
    /* 063-067 */ padNumeric(p.favorecidoNumero ?? "0", 5) +
    /* 068-082 */ brancos(15) + // complemento
    /* 083-097 */ padAlpha(p.favorecidoBairro ?? "", 15) +
    /* 098-117 */ padAlpha(p.favorecidoCidade ?? "", 20) +
    /* 118-125 */ padNumeric((p.favorecidoCep ?? "").replace(/\D/g, ""), 8) +
    /* 126-127 */ padAlpha(p.favorecidoUf ?? "", 2) +
    /* 128-135 */ formatDate(p.dataPagamento) +
    /* 136-150 */ formatMoneyV2(p.valor, 15) +
    /* 151-165 */ zeros(15) + // abatimento
    /* 166-180 */ zeros(15) + // desconto
    /* 181-195 */ zeros(15) + // mora
    /* 196-210 */ zeros(15) + // multa
    /* 211-214 */ zeros(4) + // horário de envio TED (banco preenche)
    /* 215-225 */ brancos(11) +
    /* 226-229 */ zeros(4) + // código histórico
    /* 230     */ "0" +
    /* 231     */ " " +
    /* 232     */ " " + // TED para IF — N por default
    /* 233-240 */ brancos(8); // ISPB

  return assert240(linha, "segmento B");
}

/** Segmento B para PIX por chave. Layout diferente do B normal —
 *  campos 15-16 identificam a forma de iniciação (01-04). */
export function montarSegmentoBPixChave(
  loteNum: number,
  sequencialNoLote: number,
  pagamento: PagamentoPixChave,
): string {
  const formaIniciacao = mapearTipoChave(pagamento.tipoChave);
  const linha =
    /* 001-003 */ BANCO_SANTANDER +
    /* 004-007 */ padNumeric(loteNum, 4) +
    /* 008     */ "3" +
    /* 009-013 */ padNumeric(sequencialNoLote, 5) +
    /* 014     */ "B" +
    /* 015-016 */ formaIniciacao +
    /* 017     */ " " +
    /* 018     */ (pagamento.favorecidoEhCnpj ? "2" : "1") +
    /* 019-032 */ padNumeric(pagamento.documentoFavorecido, 14) +
    /* 033-067 */ padAlpha("", 35) + // informação 10 (TXID — só QR Code)
    /* 068-127 */ padAlpha("", 60) + // informação 11 (livre)
    /* 128-226 */ padAlpha(pagamento.chave, 99) + // informação 12 = chave
    /* 227-232 */ brancos(6) +
    /* 233-240 */ brancos(8); // ISPB

  return assert240(linha, "segmento B PIX chave");
}

/** Mapeia tipo de chave PIX pra código de forma de iniciação (Nota G032). */
function mapearTipoChave(
  tipo: PagamentoPixChave["tipoChave"],
): "01" | "02" | "03" | "04" {
  switch (tipo) {
    case "telefone":
      return "01";
    case "email":
      return "02";
    case "cpf":
    case "cnpj":
      return "03";
    case "aleatoria":
      return "04";
  }
}

// ---------------------------------------------------------------------
// Trailer de Lote (tipo 5)
// ---------------------------------------------------------------------

export function montarTrailerLote(
  loteNum: number,
  qtdRegistrosNoLote: number,
  somaValores: number,
): string {
  const linha =
    /* 001-003 */ BANCO_SANTANDER +
    /* 004-007 */ padNumeric(loteNum, 4) +
    /* 008     */ "5" +
    /* 009-017 */ brancos(9) +
    /* 018-023 */ padNumeric(qtdRegistrosNoLote, 6) +
    /* 024-041 */ formatMoneyV2(somaValores, 18) +
    /* 042-059 */ zeros(18) + // somatória quantidade moeda
    /* 060-065 */ zeros(6) + // número aviso débito
    /* 066-230 */ brancos(165) +
    /* 231-240 */ brancos(10);

  return assert240(linha, "trailer de lote");
}

// ---------------------------------------------------------------------
// Trailer de Arquivo (tipo 9)
// ---------------------------------------------------------------------

export function montarTrailerArquivo(
  qtdLotes: number,
  qtdRegistrosTotal: number,
): string {
  const linha =
    /* 001-003 */ BANCO_SANTANDER +
    /* 004-007 */ "9999" +
    /* 008     */ "9" +
    /* 009-017 */ brancos(9) +
    /* 018-023 */ padNumeric(qtdLotes, 6) +
    /* 024-029 */ padNumeric(qtdRegistrosTotal, 6) +
    /* 030-240 */ brancos(211);

  return assert240(linha, "trailer de arquivo");
}

// ---------------------------------------------------------------------
// Orquestrador — junta tudo
// ---------------------------------------------------------------------

/** Um lote é um grupo de pagamentos com a mesma forma de lançamento. */
export interface LoteInput {
  formaLancamento: FormaLancamento;
  tipoServico: TipoServico;
  pagamentos: Pagamento[];
  /** Mensagem opcional que aparece em todos os pagamentos do lote. */
  informacaoMensagem?: string;
}

/** Gera o arquivo completo. Retorna string com linhas separadas por \r\n
 *  (padrão CNAB — o banco aceita \n também mas \r\n é o formato canônico). */
export function gerarArquivo(
  empresa: EmpresaPagadora,
  conta: ContaDebito,
  meta: MetadadosArquivo,
  lotes: LoteInput[],
): string {
  const linhas: string[] = [];

  // 1. Header de arquivo
  linhas.push(montarHeaderArquivo(empresa, conta, meta));

  // 2. Cada lote
  let loteNum = 1;
  for (const lote of lotes) {
    linhas.push(
      montarHeaderLote(
        loteNum,
        lote.formaLancamento,
        lote.tipoServico,
        empresa,
        conta,
        lote.informacaoMensagem,
      ),
    );

    let seq = 1;
    let soma = 0;
    for (const pgto of lote.pagamentos) {
      const valorNum =
        typeof pgto.valor === "number" ? pgto.valor : Number(pgto.valor);
      soma += valorNum;

      if (pgto.tipo === "pix_chave") {
        linhas.push(montarSegmentoAPixChave(loteNum, seq++, pgto));
        linhas.push(montarSegmentoBPixChave(loteNum, seq++, pgto));
      } else {
        linhas.push(montarSegmentoA(loteNum, seq++, pgto));
        linhas.push(montarSegmentoB(loteNum, seq++, pgto));
      }
    }

    // Trailer do lote: qtd = 1 header + N detalhes + 1 trailer
    const qtd = 1 + (seq - 1) + 1;
    linhas.push(montarTrailerLote(loteNum, qtd, soma));
    loteNum++;
  }

  // 3. Trailer de arquivo
  const qtdLotes = lotes.length;
  const qtdRegistrosTotal =
    1 + // header arquivo
    lotes.reduce((acc, l) => {
      const detalhes = l.pagamentos.reduce(
        (a, p) => a + (p.tipo === "pix_chave" ? 2 : 2),
        0,
      );
      return acc + 1 + detalhes + 1; // header lote + detalhes + trailer lote
    }, 0) +
    1; // trailer arquivo
  linhas.push(montarTrailerArquivo(qtdLotes, qtdRegistrosTotal));

  return linhas.join("\r\n") + "\r\n";
}
