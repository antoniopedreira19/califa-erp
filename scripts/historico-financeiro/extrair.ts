/**
 * E1 da importação do histórico financeiro (decisão 211): extrai cada aba
 * da planilha "Fin. Conta Califórnia" (Google Sheets exportado em .xlsx)
 * para um CSV fiel, sem interpretar nada além das datas.
 *
 * Uso:
 *   npx tsx scripts/historico-financeiro/extrair.ts <arquivo.xlsx> <pasta-da-versao>
 *
 * Saída, dentro de <pasta-da-versao>/bruto/:
 *   - NN_<aba>.csv — a primeira coluna é a linha da planilha; as outras são
 *     as colunas A, B, C… como a planilha mostrava;
 *   - manifesto.json — o arquivo de origem (SHA-256, data da exportação) e,
 *     por aba, se está oculta, linhas, colunas, fórmulas e erros.
 *
 * A planilha tem dado pessoal (fornecedores, descrições): a pasta da versão
 * fica em `tmp/`, fora do git. Nada daqui vai para o repositório.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { BOM, letrasDaColuna, linhaCsv } from "../../lib/historico-financeiro/csv";
import { abrirXlsx, linhasDaAba } from "../../lib/historico-financeiro/xlsx-em-fluxo";

type AbaNoManifesto = {
  ordem: number;
  nome: string;
  oculta: boolean;
  arquivo: string;
  linhas: number;
  colunas: number;
  formulas: number;
  erros: Record<string, number>;
};

export type Manifesto = {
  origem: { arquivo: string; tamanho: number; sha256: string; exportado_em: string };
  extraido_em: string;
  abas: AbaNoManifesto[];
};

const ERRO_DE_FORMULA = /^#(REF!|N\/A|VALUE!|NAME\?|DIV\/0!|NUM!|NULL!|ERROR!)$/;

function nomeDeArquivo(ordem: number, nome: string): string {
  const seguro = nome
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^0-9A-Za-z]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${String(ordem).padStart(2, "0")}_${seguro}.csv`;
}

async function sha256(caminho: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const pedaco of createReadStream(caminho)) hash.update(pedaco as Buffer);
  return hash.digest("hex");
}

async function main() {
  const [arquivoArg, pastaArg] = process.argv.slice(2);
  if (!arquivoArg || !pastaArg) {
    console.error("Uso: npx tsx scripts/historico-financeiro/extrair.ts <arquivo.xlsx> <pasta-da-versao>");
    process.exit(1);
  }
  const arquivo = resolve(arquivoArg);
  const pastaBruto = join(resolve(pastaArg), "bruto");
  await mkdir(pastaBruto, { recursive: true });

  const xlsx = await abrirXlsx(arquivo);
  const { abas, contexto } = xlsx;

  const manifesto: Manifesto = {
    origem: {
      arquivo: basename(arquivo),
      tamanho: (await stat(arquivo)).size,
      sha256: await sha256(arquivo),
      exportado_em: xlsx.entrada("xl/workbook.xml").modificadoEm,
    },
    extraido_em: new Date().toISOString(),
    abas: [],
  };

  for (const aba of abas) {
    const inicio = Date.now();
    const linhas: string[][] = [];
    let colunas = 0;
    let formulas = 0;
    const erros: Record<string, number> = {};
    for await (const linha of linhasDaAba(arquivo, xlsx.entrada(aba.entrada), contexto)) {
      formulas += linha.formulas;
      if (linha.celulas.size === 0) continue;
      const ultima = Math.max(...linha.celulas.keys());
      colunas = Math.max(colunas, ultima);
      const campos = [String(linha.numero)];
      for (let c = 1; c <= ultima; c++) {
        const valor = linha.celulas.get(c) ?? "";
        if (ERRO_DE_FORMULA.test(valor)) erros[valor] = (erros[valor] ?? 0) + 1;
        campos.push(valor);
      }
      linhas.push(campos);
    }
    const nomeCsv = nomeDeArquivo(aba.ordem, aba.nome);
    const cabecalho = ["linha", ...Array.from({ length: colunas }, (_, i) => letrasDaColuna(i + 1))];
    await writeFile(join(pastaBruto, nomeCsv), BOM + [cabecalho, ...linhas].map(linhaCsv).join(""));
    manifesto.abas.push({ ordem: aba.ordem, nome: aba.nome, oculta: aba.oculta, arquivo: nomeCsv, linhas: linhas.length, colunas, formulas, erros });
    const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
    console.log(`${nomeCsv}: ${linhas.length} linhas, ${colunas} colunas${aba.oculta ? " (oculta)" : ""} — ${segundos} s`);
  }

  await writeFile(join(pastaBruto, "manifesto.json"), JSON.stringify(manifesto, null, 2) + "\n");
  console.log(`\n${manifesto.abas.length} abas extraídas em ${pastaBruto}`);
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
