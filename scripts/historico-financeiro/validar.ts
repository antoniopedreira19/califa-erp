/**
 * E3 da importação do histórico financeiro (decisão 211): confere a extração
 * (E1) e a padronização (E2) contra os números que a própria planilha mostra.
 *
 *   - relatórios: cada célula das abas DRE (California, CMH, HIT, Ventura e
 *     Doca) e Gerencial (o resultado por regional) que é soma e subtração de
 *     SUMIFS é refeita sobre o bruto e sobre o padronizado e comparada com o
 *     valor da planilha. Quando só o padronizado difere, a diferença é
 *     conferida contra as linhas que a padronização deixou de fora (conta fora
 *     do escopo, data inválida, valor que não fecha) e contra o espaço
 *     sobrando no texto, que a planilha não soma;
 *   - saldos: por conta e por mês, o movimento do mês no bruto e no
 *     padronizado, e o saldo da planilha no fim do mês encadeado com o
 *     movimento padronizado;
 *   - faturamento: por aba e por mês de emissão, o total das notas no bruto e
 *     no padronizado.
 *
 * Uso:
 *   npx tsx scripts/historico-financeiro/validar.ts <pasta-da-versao>
 *
 * Saída em <pasta-da-versao>/validacao/: relatorios.csv, saldos.csv,
 * faturamento.csv e resumo.json.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PAPEL_DAS_ABAS, type AbaDeConta, type AbaDeFaturamento } from "../../lib/historico-financeiro/abas";
import { SINONIMOS_DA_CONTA, SINONIMOS_DA_NOTA, colunasPorNome } from "../../lib/historico-financeiro/colunas";
import { BOM, lerCsv, letrasDaColuna, linhaCsv } from "../../lib/historico-financeiro/csv";
import { lerTabelaCsv } from "../../lib/historico-financeiro/depara";
import { Fonte, abasDaFormula, avaliar, colunasDaFormula, lerFormula } from "../../lib/historico-financeiro/formulas";
import { lerData, lerNumero, normalizarTexto } from "../../lib/historico-financeiro/regras";
import { abrirXlsx, linhasDaAba } from "../../lib/historico-financeiro/xlsx-em-fluxo";
import type { Manifesto } from "./extrair";

/** As abas de relatório refeitas: as DREs e as Gerencial (o resultado por regional, que soma pela coluna Reg). */
const ABAS_DE_RELATORIO = [
  "DRE", "DRE CMH", "DRE HIT", "DRE Ventura", "DRE Doca",
  "Gerencial 22", "Gerencial 23", "Gerencial 24", "Gerencial 25", "Gerencial 26", "Gerencial 23 CMH", "Gerencial 24 CMH", "Gerencial 25 CMH",
];
const TOLERANCIA = 0.01;
/** Os campos do padronizado que a validação remonta na coluna de origem. */
const CAMPOS_REMONTADOS = ["data", "credito", "debito", "job", "evento", "tipo", "cod", "documento", "dre_extra", "ano_comp", "reg", "reg_cmh"] as const;
const CAMPO_DO_MOVIMENTO: Record<(typeof CAMPOS_REMONTADOS)[number], string> = {
  data: "data",
  credito: "credito_planilha",
  debito: "debito_planilha",
  job: "coluna_jobs",
  evento: "coluna_evento",
  tipo: "tipo_planilha",
  cod: "cod",
  documento: "documento",
  dre_extra: "dre_extra",
  ano_comp: "ano_comp",
  reg: "coluna_reg",
  reg_cmh: "coluna_reg_cmh",
};

type Linhas = string[][];

const numero = (texto: string | undefined) => {
  const n = lerNumero(texto ?? "");
  return n === null || (texto ?? "").trim() === "" ? null : n;
};
/** Igual ao centavo, ou na 9ª casa relativa: o Google exporta somas de milhões com o último centavo arredondado. */
const igual = (a: number | null, b: number | null) =>
  a !== null && b !== null && Math.abs(a - b) < Math.max(TOLERANCIA, 1e-9 * Math.max(Math.abs(a), Math.abs(b)));
const dinheiro = (n: number | null) => (n === null ? "" : n.toFixed(2));

async function main() {
  const [pastaArg] = process.argv.slice(2);
  if (!pastaArg) {
    console.error("Uso: npx tsx scripts/historico-financeiro/validar.ts <pasta-da-versao>");
    process.exit(1);
  }
  const versao = resolve(pastaArg);
  const pastaBruto = join(versao, "bruto");
  const saida = join(versao, "validacao");
  await mkdir(saida, { recursive: true });
  const manifesto: Manifesto = JSON.parse(await readFile(join(pastaBruto, "manifesto.json"), "utf8"));
  const lerAba = async (nome: string): Promise<Linhas> => {
    const aba = manifesto.abas.find((a) => a.nome === nome);
    if (!aba) throw new Error(`A aba "${nome}" não está no manifesto.`);
    return lerCsv(await readFile(join(pastaBruto, aba.arquivo), "utf8")).slice(1);
  };

  // ------------------------------------------------------------ as três fontes
  const contas = manifesto.abas.filter((a) => PAPEL_DAS_ABAS[a.nome]?.papel === "conta").map((a) => a.nome);
  const bruto = new Map<string, Linhas>();
  for (const nome of contas) bruto.set(nome, await lerAba(nome));

  const movimentos = [
    ...((await lerTabelaCsv(join(versao, "padronizado", "movimentos.csv"))) ?? []),
    ...((await lerTabelaCsv(join(versao, "padronizado", "previsoes.csv"))) ?? []),
  ];
  const padronizado = new Map<string, Linhas>();
  const colunasDoPadronizado = new Map<string, Set<number>>();
  const linhasPadronizadas = new Map<string, Set<string>>();
  const colunasDaConta = new Map<string, Map<string, number>>();
  for (const nome of contas) {
    const colunas = colunasPorNome(bruto.get(nome)![0], SINONIMOS_DA_CONTA);
    colunasDaConta.set(nome, colunas);
    padronizado.set(nome, []);
    linhasPadronizadas.set(nome, new Set());
    // O padronizado tem as colunas remontadas e, por definição, as que estão vazias no bruto
    // (a DRE Doca soma pela coluna P de abas em que ela não tem título nem valor).
    const linhasDaAba = bruto.get(nome)!;
    const comValor = new Set<number>();
    for (const l of linhasDaAba.slice(1)) l.forEach((v, i) => i > 0 && v.trim() && comValor.add(i));
    const disponiveis = new Set(CAMPOS_REMONTADOS.map((c) => colunas.get(c)).filter((c): c is number => c !== undefined));
    // A conta fora (D2) não tem linha no padronizado: nenhuma coluna a remontar.
    const fora = (PAPEL_DAS_ABAS[nome] as AbaDeConta).situacao === "fora";
    const ultima = Math.max(...linhasDaAba.map((l) => l.length), 30);
    for (let i = 1; i <= ultima; i++) if (fora || !comValor.has(i)) disponiveis.add(i);
    colunasDoPadronizado.set(nome, disponiveis);
  }
  for (const m of movimentos) {
    const colunas = colunasDaConta.get(m.aba);
    if (!colunas) continue;
    const linha: string[] = [m.linha];
    for (const campo of CAMPOS_REMONTADOS) {
      const c = colunas.get(campo);
      if (c !== undefined) linha[c] = m[CAMPO_DO_MOVIMENTO[campo]] ?? "";
    }
    padronizado.get(m.aba)!.push(linha);
    linhasPadronizadas.get(m.aba)!.add(m.linha);
  }
  // As linhas do bruto que a padronização deixou de fora explicam parte da diferença entre as fontes;
  // o resto é o espaço sobrando no texto, que a planilha não soma e o padronizado, aparado, soma.
  const aparar = (linhas: Linhas) => linhas.map((l) => l.map((c) => c.trim()));
  const excluidas = new Map<string, Linhas>();
  for (const nome of contas) excluidas.set(nome, bruto.get(nome)!.filter((l) => !linhasPadronizadas.get(nome)!.has(l[0])));

  const fonteBruta = new Fonte(bruto);
  const fontePadronizada = new Fonte(padronizado, colunasDoPadronizado);
  const fonteExcluidas = new Fonte(excluidas);
  const fonteAparada = new Fonte(new Map([...bruto].map(([k, v]) => [k, aparar(v)])));
  const fonteExcluidasAparadas = new Fonte(new Map([...excluidas].map(([k, v]) => [k, aparar(v)])));

  // ------------------------------------------------------------ relatórios
  const xlsx = await abrirXlsx(join(versao, "origem.xlsx"));
  const anoDoTexto = (texto: string) => /(?:19|20)\d\d/.exec(texto)?.[0] ?? "";
  const linhasDre: (string | number)[][] = [];
  const contagemDre: Record<string, Record<string, number>> = {};
  for (const nomeDre of ABAS_DE_RELATORIO) {
    const aba = xlsx.abas.find((a) => a.nome === nomeDre);
    if (!aba) continue;
    const valores = new Map<string, string>();
    const formulas: { ref: string; texto: string }[] = [];
    for await (const l of linhasDaAba(xlsx.caminho, xlsx.entrada(aba.entrada), xlsx.contexto)) {
      for (const [col, v] of l.celulas) valores.set(`${letrasDaColuna(col)}${l.numero}`, v);
      for (const [col, f] of l.textosDasFormulas) if (/SUMIFS/i.test(f)) formulas.push({ ref: `${letrasDaColuna(col)}${l.numero}`, texto: f });
    }
    const celula = (ref: string) => valores.get(ref) ?? "";
    for (const f of formulas) {
      const no = lerFormula(f.texto);
      const abas = no ? abasDaFormula(no, nomeDre) : [];
      const planilha = numero(valores.get(f.ref));
      // O critério vem de célula nas DREs ("REC 1T 2026" em C611) e escrito na fórmula nas
      // Gerencial ("CF 1T 2026" com a regional do cabeçalho); sem ano nele, vale o da aba.
      const criterios = [...f.texto.matchAll(/,\s*\$?([A-Z]{1,3})\$?(\d+)\s*\)/g)].map((m) => celula(`${m[1]}${m[2]}`)).filter(Boolean);
      const literais = [...f.texto.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      const criterio = [...new Set([...literais, ...criterios])].slice(0, 3).join(" · ");
      const anoDaAba = /\b(\d\d)\b/.exec(nomeDre)?.[1];
      const ano = [...criterios, ...literais].map(anoDoTexto).find(Boolean) ?? (anoDaAba ? `20${anoDaAba}` : "");
      const papeisDeFora = abas.map((a) => PAPEL_DAS_ABAS[a]?.papel ?? "desconhecida").filter((p) => p !== "conta");
      let situacao: string;
      let vb: number | null = null;
      let vp: number | null = null;
      let detalhe = "";
      if (!no) {
        situacao = /#REF!/.test(f.texto) ? "fórmula quebrada na planilha (#REF!)" : "não verificável";
      } else if (papeisDeFora.length > 0) {
        // A receita das Gerencial soma as abas de resultado, cujos totais não se importam (regra 9).
        situacao = papeisDeFora.every((p) => p === "resultado") ? "fora da validação: soma as abas de resultado dos jobs" : "fora da validação: soma aba que não é de conta";
      } else {
        vb = avaliar(no, fonteBruta, celula, nomeDre);
        vp = avaliar(no, fontePadronizada, celula, nomeDre);
        const ve = avaliar(no, fonteExcluidas, celula, nomeDre) ?? 0;
        const vpEsperado = (avaliar(no, fonteAparada, celula, nomeDre) ?? 0) - (avaliar(no, fonteExcluidasAparadas, celula, nomeDre) ?? 0);
        const fora = abas.some((a) => (PAPEL_DAS_ABAS[a] as AbaDeConta | undefined)?.situacao === "fora");
        if (vb === null) situacao = /#REF!/.test(f.texto) ? "fórmula quebrada na planilha (#REF!)" : "aba fora da extração";
        else if (planilha === null) situacao = "sem valor na planilha";
        else if (!igual(planilha, vb)) situacao = "difere da planilha";
        else if (vp === null) {
          situacao = "não verificável no padronizado";
          const faltam = colunasDaFormula(no, nomeDre).filter((c) => !fontePadronizada.linhas(c.aba) || !fontePadronizada.temColuna(c.aba, c.coluna));
          detalhe = [...new Set(faltam.map((c) => `${c.aba}!${letrasDaColuna(c.coluna)}`))].join(", ");
        }
        else if (igual(vb, vp)) situacao = "bate";
        else if (igual(vb - vp, ve)) situacao = fora ? "difere no padronizado: conta fora (D2)" : "difere no padronizado: linhas excluídas";
        else if (igual(vpEsperado, vp)) situacao = "difere no padronizado: espaço sobrando no texto";
        else situacao = "difere no padronizado: sem explicação";
      }
      const chave = `${nomeDre} · ${ano || "sem ano"}`;
      contagemDre[chave] ??= {};
      contagemDre[chave][situacao] = (contagemDre[chave][situacao] ?? 0) + 1;
      linhasDre.push([nomeDre, f.ref, criterio, ano, abas.join(" + "), dinheiro(planilha), dinheiro(vb), dinheiro(vp), situacao, detalhe]);
    }
  }

  // ------------------------------------------------------------ saldos
  const linhasSaldo: (string | number)[][] = [];
  const saldoNoFim: Record<string, Record<string, string>> = {};
  let mesesComDiferenca = 0;
  let mesesComSaldoQuebrado = 0;
  for (const nome of contas) {
    const papel = PAPEL_DAS_ABAS[nome] as AbaDeConta;
    if (papel.situacao === "fora") continue;
    const colunas = colunasDaConta.get(nome)!;
    const porMes = new Map<string, { planilha: number; padronizado: number; saldo: number | null }>();
    const mes = (m: string) => {
      let v = porMes.get(m);
      if (!v) porMes.set(m, (v = { planilha: 0, padronizado: 0, saldo: null }));
      return v;
    };
    for (const l of bruto.get(nome)!.slice(1)) {
      const data = lerData(l[colunas.get("data") ?? -1] ?? "");
      if (!data) continue;
      const v = mes(data.slice(0, 7));
      v.planilha += (numero(l[colunas.get("credito") ?? -1]) ?? 0) - (numero(l[colunas.get("debito") ?? -1]) ?? 0);
      const saldo = numero(l[colunas.get("saldo") ?? -1]);
      if (saldo !== null) v.saldo = saldo;
    }
    for (const l of padronizado.get(nome)!) {
      const data = l[colunas.get("data")!];
      mes(data.slice(0, 7)).padronizado += (numero(l[colunas.get("credito")!]) ?? 0) - (numero(l[colunas.get("debito")!]) ?? 0);
    }
    let saldoAnterior: number | null = null;
    for (const m of [...porMes.keys()].sort()) {
      const v = porMes.get(m)!;
      const encadeado = saldoAnterior === null ? null : saldoAnterior + v.padronizado;
      const difMov = v.planilha - v.padronizado;
      const difSaldo = encadeado !== null && v.saldo !== null ? v.saldo - encadeado : null;
      if (m >= "2023-01" && m <= "2026-09") {
        if (Math.abs(difMov) >= TOLERANCIA) mesesComDiferenca++;
        if (difSaldo !== null && Math.abs(difSaldo) >= TOLERANCIA) mesesComSaldoQuebrado++;
      }
      linhasSaldo.push([papel.conta, nome, m, dinheiro(v.planilha), dinheiro(v.padronizado), dinheiro(difMov), dinheiro(v.saldo), dinheiro(encadeado), dinheiro(difSaldo)]);
      if (m === "2025-12" || m === "2026-06" || m === "2026-09") (saldoNoFim[papel.conta] ??= {})[m] = dinheiro(v.saldo);
      if (v.saldo !== null) saldoAnterior = v.saldo;
      else if (saldoAnterior !== null) saldoAnterior += v.padronizado;
    }
  }

  // ------------------------------------------------------------ faturamento
  const notas = (await lerTabelaCsv(join(versao, "padronizado", "notas.csv"))) ?? [];
  const linhasFat: (string | number)[][] = [];
  let mesesFatComDiferenca = 0;
  for (const a of manifesto.abas) {
    const papel = PAPEL_DAS_ABAS[a.nome];
    if (papel?.papel !== "faturamento" || (papel as AbaDeFaturamento).situacao === "fora") continue;
    const linhas = await lerAba(a.nome);
    const iCab = linhas.slice(0, 6).findIndex((l) => l.some((c, i) => i > 0 && i < 4 && normalizarTexto(c) === "NF"));
    if (iCab < 0) continue;
    const colunas = colunasPorNome(linhas[iCab], SINONIMOS_DA_NOTA);
    const porMes = new Map<string, { qtdPlanilha: number; planilha: number; qtdPadronizado: number; padronizado: number; canceladas: number }>();
    const mes = (m: string) => {
      let v = porMes.get(m);
      if (!v) porMes.set(m, (v = { qtdPlanilha: 0, planilha: 0, qtdPadronizado: 0, padronizado: 0, canceladas: 0 }));
      return v;
    };
    for (const l of linhas.slice(iCab + 1)) {
      if (!/^\d+(\.0+)?$/.test((l[colunas.get("nf") ?? -1] ?? "").trim())) continue;
      const emissao = lerData(l[colunas.get("emissao") ?? -1] ?? "");
      const valor = numero(l[colunas.get("valor") ?? -1]);
      if (!emissao || !valor) continue;
      const v = mes(emissao.slice(0, 7));
      v.qtdPlanilha++;
      v.planilha += valor;
    }
    for (const n of notas.filter((n) => n.aba === a.nome && (n.situacao === "emitida" || n.situacao === "cancelada"))) {
      const v = mes(n.emissao.slice(0, 7));
      v.qtdPadronizado++;
      v.padronizado += Number(n.valor);
      if (n.situacao === "cancelada") v.canceladas += Number(n.valor);
    }
    for (const m of [...porMes.keys()].sort()) {
      const v = porMes.get(m)!;
      const dif = v.planilha - v.padronizado;
      if (m >= "2023-01" && m <= "2026-09" && Math.abs(dif) >= 0.05) mesesFatComDiferenca++;
      linhasFat.push([a.nome, m, v.qtdPlanilha, dinheiro(v.planilha), v.qtdPadronizado, dinheiro(v.padronizado), dinheiro(v.canceladas), dinheiro(dif)]);
    }
  }

  // ------------------------------------------------------------ escrita
  const escrever = (arquivo: string, cabecalho: string[], linhas: (string | number)[][]) =>
    writeFile(join(saida, arquivo), BOM + [cabecalho, ...linhas].map(linhaCsv).join(""));
  await escrever("relatorios.csv", ["aba_do_relatorio", "celula", "criterio", "ano", "abas_somadas", "valor_planilha", "valor_bruto", "valor_padronizado", "situacao", "detalhe"], linhasDre);
  await escrever(
    "saldos.csv",
    ["conta", "aba", "mes", "movimento_planilha", "movimento_padronizado", "diferenca_movimento", "saldo_planilha_fim_do_mes", "saldo_encadeado", "diferenca_saldo"],
    linhasSaldo,
  );
  await escrever("faturamento.csv", ["aba", "mes", "notas_planilha", "total_planilha", "notas_padronizado", "total_padronizado", "das_quais_canceladas", "diferenca"], linhasFat);

  const situacoes: Record<string, number> = {};
  const situacoesDaJanela: Record<string, Record<string, number>> = {};
  for (const l of linhasDre) {
    const s = String(l[8]);
    situacoes[s] = (situacoes[s] ?? 0) + 1;
    if (!["2023", "2024", "2025", "2026"].includes(String(l[3]))) continue;
    const tipo = String(l[0]).startsWith("Gerencial") ? "Gerencial" : "DRE";
    situacoesDaJanela[tipo] ??= {};
    situacoesDaJanela[tipo][s] = (situacoesDaJanela[tipo][s] ?? 0) + 1;
  }
  const resumo = {
    versao: manifesto.origem,
    relatorios: { celulas: linhasDre.length, por_situacao: situacoes, de_2023_a_2026: situacoesDaJanela, por_aba_e_ano: contagemDre },
    saldos: { meses_com_movimento_diferente_2023_a_set_2026: mesesComDiferenca, meses_com_saldo_que_nao_encadeia_2023_a_set_2026: mesesComSaldoQuebrado, saldo_da_planilha_no_fim_do_mes: saldoNoFim },
    faturamento: { meses_com_diferenca_2023_a_set_2026: mesesFatComDiferenca },
  };
  await writeFile(join(saida, "resumo.json"), JSON.stringify(resumo, null, 2) + "\n");
  console.log(JSON.stringify({ ...resumo, versao: undefined, relatorios: { ...resumo.relatorios, por_aba_e_ano: undefined } }, null, 2));
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.stack : erro);
  process.exit(1);
});
