/**
 * Os movimentos que as conferências dos relatórios do histórico (decisão 211,
 * A4: `conferir-dre.ts` e `conferir-regional.ts`) leem: do pacote de uma carga
 * — o que foi gravado no banco — ou do padronizado inteiro, com ou sem as
 * previsões, em centavos como o banco guarda.
 *
 * Opções da linha de comando:
 *   --carga cargas/1a-carga.json          o pacote (padrão)
 *   --padronizado [--com-previsoes]       o padronizado, com as linhas de data futura se pedido
 *   --de AAAA-MM-DD --ate AAAA-MM-DD      o período do padronizado
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { lerCsv } from "../../lib/historico-financeiro/csv";
import { lerPacote } from "../../lib/historico-financeiro/pacote";

export type MovimentoParaConferir = {
  aba: string;
  sigla: string;
  grupo: string | null;
  trimestre: number | null;
  ano: number | null;
  credito: number;
  debito: number;
  jobs: string | null;
  /** A regional do lançamento (o nome no sistema, ou o código da planilha em maiúsculas); nula no TD e sem regional. */
  regional: string | null;
  todas: boolean;
};

/**
 * O valor em centavos, como o banco grava (`round(x, 2)`: metade para longe do
 * zero, sobre o decimal escrito). A planilha guarda frações de centavo e as
 * DREs dela somam as frações; o histórico, não (A2).
 */
export function emCentavos(valor: number): number {
  if (valor === 0) return 0;
  const [inteiro, fracao = ""] = Math.abs(valor).toFixed(10).split(".");
  let centavos = Number(inteiro) * 100 + Number(fracao.slice(0, 2));
  if (Number(fracao[2]) >= 5) centavos += 1;
  return (Math.sign(valor) * centavos) / 100;
}

/** O código da coluna Reg da planilha, quando o sistema não tem a regional: aparado e em maiúsculas, como a função do banco devolve. */
function codigoDaPlanilha(texto: string | null | undefined): string | null {
  const t = (texto ?? "").trim().toUpperCase();
  return t === "" ? null : t;
}

/** Os movimentos do pacote de uma carga (o que foi gravado no banco). */
async function doPacote(arquivo: string): Promise<MovimentoParaConferir[]> {
  const lido = lerPacote(await readFile(arquivo, "utf8"));
  if (!lido.ok) throw new Error(lido.message);
  const mov = lido.pacote.tabelas.movimentos;
  const k = (nome: string) => mov.colunas.indexOf(nome);
  const [iAba, iSigla, iGrupo, iTri, iAno, iCred, iDeb, iJobs, iReg, iTodas, iRegPlanilha] = [
    "aba", "sigla_planilha", "grupo", "competencia_trimestre", "competencia_ano", "credito_planilha", "debito_planilha", "coluna_jobs",
    "regional", "regional_todas", "regional_planilha",
  ].map(k);
  return mov.linhas.map((r) => ({
    aba: String(r[iAba]),
    sigla: String(r[iSigla] ?? ""),
    grupo: r[iGrupo] === null ? null : String(r[iGrupo]),
    trimestre: r[iTri] === null ? null : Number(r[iTri]),
    ano: r[iAno] === null ? null : Number(r[iAno]),
    credito: emCentavos(Number(r[iCred] ?? 0)),
    debito: emCentavos(Number(r[iDeb] ?? 0)),
    jobs: r[iJobs] === null ? null : String(r[iJobs]),
    regional: r[iTodas] === true ? null : r[iReg] !== null ? String(r[iReg]) : codigoDaPlanilha(r[iRegPlanilha] as string | null),
    todas: r[iTodas] === true,
  }));
}

/** Os movimentos de um CSV do padronizado, de todas as contas da carga, no período. */
async function doPadronizado(arquivo: string, de: string, ate: string): Promise<MovimentoParaConferir[]> {
  const [cab, ...linhas] = lerCsv(await readFile(arquivo, "utf8"));
  const k = (nome: string) => cab.indexOf(nome);
  const [iAba, iConta, iData, iSigla, iGrupo, iTri, iAno, iCred, iDeb, iJobs, iReg, iTodas, iRegPlanilha] = [
    "aba", "conta", "data", "sigla_planilha", "grupo", "competencia_trimestre", "competencia_ano", "credito_planilha", "debito_planilha",
    "coluna_jobs", "regional", "regional_todas", "regional_planilha",
  ].map(k);
  const num = (t: string) => (t.trim() === "" ? null : Number(t));
  return linhas
    .filter((r) => r[iConta] && r[iData] >= de && r[iData] <= ate)
    .map((r) => ({
      aba: r[iAba],
      sigla: r[iSigla] ?? "",
      grupo: r[iGrupo] ? r[iGrupo] : null,
      trimestre: num(r[iTri]),
      ano: num(r[iAno]),
      credito: emCentavos(num(r[iCred]) ?? 0),
      debito: emCentavos(num(r[iDeb]) ?? 0),
      jobs: r[iJobs] ? r[iJobs] : null,
      regional: r[iTodas] === "sim" ? null : r[iReg] ? r[iReg] : codigoDaPlanilha(r[iRegPlanilha]),
      todas: r[iTodas] === "sim",
    }));
}

/** Os movimentos pedidos pelas opções, e um nome curto da fonte para o arquivo de saída. */
export async function lerMovimentos(
  versao: string,
  opcoes: readonly string[],
): Promise<{ movimentos: MovimentoParaConferir[]; fonte: "carga" | "padronizado" | "padronizado-com-previsoes" }> {
  const opcao = (nome: string) => {
    const i = opcoes.indexOf(nome);
    return i >= 0 ? opcoes[i + 1] : undefined;
  };
  if (!opcoes.includes("--padronizado")) {
    return { movimentos: await doPacote(join(versao, opcao("--carga") ?? "cargas/1a-carga.json")), fonte: "carga" };
  }
  const [de, ate] = [opcao("--de") ?? "0000-00-00", opcao("--ate") ?? "9999-99-99"];
  const comPrevisoes = opcoes.includes("--com-previsoes");
  return {
    movimentos: [
      ...(await doPadronizado(join(versao, "padronizado", "movimentos.csv"), de, ate)),
      // As previsões (linhas com data depois da exportação), que as DREs e as Gerencial da planilha também somam.
      ...(comPrevisoes ? await doPadronizado(join(versao, "padronizado", "previsoes.csv"), de, ate) : []),
    ],
    fonte: comPrevisoes ? "padronizado-com-previsoes" : "padronizado",
  };
}
