import type { ImportacaoWarning } from "@/lib/types";
import {
  mesesDoTrimestre,
  nomeDoMes,
  rotuloMes,
  trimestreDe,
} from "@/lib/calculos/meses-trimestre";
import type { ParseGrupo, ParseMes, ParseResultado } from "./parser-oficial";
import type { OpcaoDosMeses } from "./tipos-da-importacao";

/**
 * Os blocos de mês de uma planilha contra os meses da versão — orçamento
 * de Fee ou Always On (decisão 078).
 *
 * Regra do Tiago (15/09/2026): **os meses não mudam pela planilha**. Mês que
 * a versão não tem, ou mês da versão sem bloco na planilha, recusa; criar ou
 * apagar mês continua só pelo "Editar meses". Dentro de cada mês vale a
 * regra de sempre (linha nova, alterada, apagada).
 *
 * A planilha interna da agência tem os doze meses do ano: bloco de mês fora
 * do trimestre do orçamento é **ignorado com aviso**.
 *
 * Decisão 158 (08/10/2026), na importação da VERSÃO:
 *  - mês da planilha que o orçamento não tem, mesmo dentro do trimestre,
 *    também fica de fora com aviso — entram só os meses do orçamento. Mês
 *    do orçamento sem bloco na planilha continua recusando;
 *  - a aba sem nenhum título de mês é lida como UM mês, e quem importa
 *    escolhe se os itens se repetem em todos os meses ou entram só no
 *    primeiro (`mesesDaAbaParaGravar`).
 * A importação do PROJETO (`conferirMesesDaSecao`) segue exata: ela lê a
 * exportação do ERP, que sai sempre com os meses da versão.
 *
 * Funções puras: quem chama traz a leitura e os meses (`YYYY-MM-01`).
 */

function frase(datas: string[]): string {
  const nomes = [...datas].sort().map((d) => rotuloMes(d).toLowerCase());
  if (nomes.length <= 1) return nomes.join("");
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

function mensagemDosMeses(aMais: string[], faltando: string[], fim: string): string {
  const partes = [
    aMais.length > 0
      ? `a planilha traz ${frase(aMais)}, que o orçamento não tem`
      : "",
    faltando.length > 0 ? `falta ${frase(faltando)}` : "",
  ].filter(Boolean);
  return `Os meses da planilha não são os do orçamento: ${partes.join("; ")}. Os meses só mudam pelo "Editar meses", na tela do orçamento — ${fim}`;
}

/**
 * Importação do PROJETO (a exportação do ERP): os blocos da seção têm que ser
 * exatamente os meses da vigente. Devolve o motivo da recusa, ou `null`.
 */
export function conferirMesesDaSecao(
  lidos: { mes: string | null; rotulo: string }[],
  daVersao: string[],
): string | null {
  const semData = lidos.find((m) => m.mes === null);
  if (semData) {
    return `O bloco "${semData.rotulo}" não diz de que mês é — a coluna oculta da planilha foi apagada? Nada entra neste orçamento.`;
  }
  const datas = lidos.map((m) => m.mes as string);
  const repetido = datas.find((d, i) => datas.indexOf(d) !== i);
  if (repetido) {
    return `${rotuloMes(repetido)} aparece em mais de um bloco da planilha — nada entra neste orçamento.`;
  }
  const aMais = datas.filter((d) => !daVersao.includes(d));
  const faltando = daVersao.filter((d) => !datas.includes(d));
  if (aMais.length === 0 && faltando.length === 0) return null;
  return mensagemDosMeses(aMais, faltando, "nada entra neste orçamento.");
}

export type CasamentoDosMeses =
  | { ok: true; grupos: ParseGrupo[]; avisos: ImportacaoWarning[] }
  | { ok: false; message: string };

/**
 * Importação da VERSÃO ("Importar planilha"): casa cada bloco lido com um mês
 * da versão e devolve só os grupos dos meses da versão, com o `mes` (ISO)
 * preenchido. O bloco sem ano (planilha interna) casa pelo número do mês
 * dentro do trimestre da versão.
 */
export function casarBlocosComMeses(
  grupos: ParseGrupo[],
  blocos: ParseMes[],
  daVersao: string[],
): CasamentoDosMeses {
  if (blocos.length === 0) {
    return {
      ok: false,
      message:
        'A planilha não tem blocos de mês ("OUTUBRO DE 2026" ou "OUTUBRO - …"). O orçamento de Fee ou Always On precisa de um bloco por mês. Nada foi importado.',
    };
  }
  if (daVersao.length === 0) {
    return {
      ok: false,
      message:
        'A versão não tem meses. Crie os meses em "Editar meses" antes de importar. Nada foi importado.',
    };
  }

  const doTrimestre = mesesDoTrimestre(trimestreDe([...daVersao].sort()[0]));
  const dataDe = (numero: number | null, mes: string | null): string | null =>
    mes ??
    (numero !== null
      ? (doTrimestre.find((d) => Number(d.slice(5, 7)) === numero) ?? null)
      : null);

  const avisos: ImportacaoWarning[] = [];
  const aceitos = new Set<string>();
  const repetidos: string[] = [];

  for (const bloco of blocos) {
    const data = dataDe(bloco.numero, bloco.mes);
    if (!data || !doTrimestre.includes(data)) {
      avisos.push({
        linha: bloco.linha_xlsx,
        motivo: `O bloco "${bloco.rotulo}" ficou de fora: o mês não é do trimestre do orçamento.`,
        severidade: "ignorada",
      });
      continue;
    }
    // Decisão 158: o mês do trimestre que o orçamento não tem fica de fora,
    // como o de outro trimestre — antes recusava a planilha inteira.
    if (!daVersao.includes(data)) {
      avisos.push({
        linha: bloco.linha_xlsx,
        motivo: `O bloco "${bloco.rotulo}" ficou de fora: o orçamento não tem ${nomeDoMes(data)}.`,
        severidade: "ignorada",
      });
      continue;
    }
    if (aceitos.has(data)) {
      repetidos.push(data);
      continue;
    }
    aceitos.add(data);
  }

  if (repetidos.length > 0) {
    return {
      ok: false,
      message: `${rotuloMes(repetidos[0])} aparece em mais de um bloco da planilha. Nada foi importado.`,
    };
  }
  const faltando = daVersao.filter((d) => !aceitos.has(d));
  if (faltando.length > 0) {
    return {
      ok: false,
      message: mensagemDosMeses([], faltando, "nada foi importado."),
    };
  }

  // Grupo sem bloco nenhum (antes do primeiro título de mês). O de um bloco
  // fora do trimestre já saiu com o aviso do bloco.
  const semMes = grupos.filter((g) => g.mes_numero === null && g.mes === null);
  if (semMes.length > 0) {
    avisos.push({
      linha: 0,
      motivo: `${semMes.length === 1 ? "Um grupo apareceu" : `${semMes.length} grupos apareceram`} antes do primeiro bloco de mês e ${semMes.length === 1 ? "ficou" : "ficaram"} de fora (${semMes.map((g) => g.nome).join(", ")}).`,
      severidade: "ignorada",
    });
  }

  const dosMeses = grupos
    .map((g) => ({ ...g, mes: dataDe(g.mes_numero, g.mes) }))
    .filter((g): g is ParseGrupo & { mes: string } => g.mes !== null && aceitos.has(g.mes))
    .map((g, idx) => ({ ...g, ordem: idx + 1 }));

  return { ok: true, grupos: dosMeses, avisos };
}

// ---------- aba sem título de mês (decisão 158) ----------

/**
 * A aba tem itens no layout nacional e nenhum título de mês nem marca
 * `mes:` — a planilha de UM mês que o GP monta para o Always On. Planilha
 * internacional continua recusada pelo modelo.
 */
export function abaSemBlocoDeMes(lida: ParseResultado): boolean {
  return (
    lida.modelo === "nacional" &&
    lida.meses.length === 0 &&
    lida.grupos.length > 0 &&
    lida.grupos.every((g) => g.mes === null && g.mes_numero === null)
  );
}

/**
 * A aba lida como se tivesse um bloco para cada mês pedido: os grupos se
 * repetem, mês a mês, com o mês preenchido. Daí em diante é o caminho de
 * sempre (`casarBlocosComMeses`), que confere e numera.
 */
export function comBlocosSinteticos(lida: ParseResultado, meses: string[]): ParseResultado {
  const ordenados = [...meses].sort();
  let ordem = 0;
  return {
    ...lida,
    modelo: "mensal",
    meses: ordenados.map((mes) => ({
      numero: Number(mes.slice(5, 7)),
      ano: Number(mes.slice(0, 4)),
      mes,
      rotulo: rotuloMes(mes),
      linha_xlsx: 0,
    })),
    grupos: ordenados.flatMap((mes) =>
      lida.grupos.map((g) => ({
        ...g,
        mes,
        mes_numero: Number(mes.slice(5, 7)),
        ordem: ++ordem,
        itens: g.itens.map((it) => ({ ...it })),
      })),
    ),
    linhas_importadas: lida.linhas_importadas * ordenados.length,
  };
}

/** Os meses que recebem a aba sem título de mês, pela opção escolhida. */
export function mesesDaOpcao(daVersao: string[], opcao: OpcaoDosMeses): string[] {
  const ordenados = [...daVersao].sort();
  return opcao === "primeiro" ? ordenados.slice(0, 1) : ordenados;
}

/**
 * A leitura de uma aba do mensal pronta para gravar na versão: a aba sem
 * título de mês passa pela opção escolhida, e todas passam pelo casamento
 * com os meses da versão. A contagem segue os meses aceitos: item de bloco
 * que ficou de fora não entra, e a confirmação não promete mais do que grava.
 */
export function mesesDaAbaParaGravar(
  parsed: ParseResultado,
  daVersao: string[],
  opcao: OpcaoDosMeses | null,
): { ok: true; parsed: ParseResultado } | { ok: false; message: string } {
  let lida = parsed;
  let meses = daVersao;
  if (abaSemBlocoDeMes(parsed) && daVersao.length > 0) {
    if (daVersao.length > 1 && opcao === null) {
      return {
        ok: false,
        message:
          "A aba não tem título de mês. Escolha se os itens se repetem em todos os meses do orçamento ou entram só no primeiro. Nada foi importado.",
      };
    }
    meses = mesesDaOpcao(daVersao, opcao ?? "todos");
    lida = comBlocosSinteticos(parsed, meses);
  }
  const casados = casarBlocosComMeses(lida.grupos, lida.meses, meses);
  if (!casados.ok) return { ok: false, message: casados.message };
  const aceitos = casados.grupos.reduce((s, g) => s + g.itens.length, 0);
  return {
    ok: true,
    parsed: {
      ...lida,
      grupos: casados.grupos,
      warnings: [...lida.warnings, ...casados.avisos],
      linhas_importadas: aceitos,
      linhas_ignoradas: lida.linhas_ignoradas + lida.linhas_importadas - aceitos,
    },
  };
}
