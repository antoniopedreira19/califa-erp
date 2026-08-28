/**
 * Confere `vw_job_rentabilidade` (view SQL, Task 1) contra o cálculo oficial
 * em TypeScript que a tela do job usa.
 *
 * A view soma bases direto em SQL; a tela roda `calcularTotaisVersao` e
 * `somarBlocosDosItens` em JS. Divergência aqui significa que a migration da
 * view não bate com a fórmula — e o relatório mostraria número diferente do
 * job.
 *
 * Não importamos `carregar-detalhe.ts` porque ela depende de sessão Next
 * (`requireSession`, `createClient` do server). Aqui a gente recomputa a
 * partir dos módulos PUROS de cálculo, batendo direto com o que aquela
 * função faz:
 *   - `calcularTotaisVersao(itens, %hon, %imp)` -> faturamento_previsto e
 *     imposto_previsto (o `imposto` do LADO JOB, mesma escolha da tela).
 *   - `somarBlocosDosItens(itens.map(blocosDoItem))` sobre a cópia do job
 *     (`jobs_itens_orcado` + `jobs_itens_realizado` + `itens_bv`) -> o
 *     `realizado.bruto` bate com `custo_realizado` e `realizado.deducaoBv`
 *     bate com `bv_realizado`.
 *   - `SUM(jobs_envio_faturamento.valor_faturado)` bate com
 *     `faturamento_realizado`.
 *
 * Rodar com: npx tsx scripts/conferir-view-rentabilidade.ts
 * Envs esperadas: SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL) e
 * SUPABASE_SERVICE_ROLE_KEY. Se `.env.local` existir, é lido daqui.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { calcularTotaisVersao, type ItemParaTotais } from "../lib/calculos/versao-totais";
import {
  blocosDoItem,
  somarBlocosDosItens,
  type ItemParaBv,
  type BvParaConta,
} from "../lib/calculos/bv-planilha";
import type { TipoCusto, BvSituacao } from "../lib/types";

// ---------------------------------------------------------------- envs
// Lê `.env.local` do root pra evitar depender de dotenv/next runtime.
function carregarDotenv(): void {
  const caminho = resolve(process.cwd(), ".env.local");
  if (!existsSync(caminho)) return;
  const conteudo = readFileSync(caminho, "utf8");
  for (const linhaRaw of conteudo.split(/\r?\n/)) {
    const linha = linhaRaw.trim();
    if (!linha || linha.startsWith("#")) continue;
    const eq = linha.indexOf("=");
    if (eq < 0) continue;
    const chave = linha.slice(0, eq).trim();
    let valor = linha.slice(eq + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    if (!(chave in process.env)) process.env[chave] = valor;
  }
}
carregarDotenv();

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error(
    "Faltam SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY no env.",
  );
  process.exit(1);
}
console.log("envs carregados.");

const supabase = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let falhas = 0;
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function conferir(rotulo: string, view: number, oficial: number, tol = 0.05) {
  const ok = Math.abs(view - oficial) <= tol;
  if (!ok) falhas += 1;
  const delta = view - oficial;
  console.log(
    `  ${ok ? "ok  " : "FALHA"} ${rotulo.padEnd(24)} view=${brl(view).padStart(13)}  oficial=${brl(oficial).padStart(13)}` +
      (ok ? "" : `   delta ${brl(delta)}`),
  );
}

const LIMITE = 20;

interface JobItemOrcadoRow {
  id: string;
  tipo_custo: TipoCusto;
  total_orcado: number | string | null;
  total_planejado: number | string | null;
  em_save: boolean | null;
  save_consumido: number | string | null;
  bv_liquido_planejado: number | string | null;
}
interface JobItemRealizadoRow {
  job_item_orcado_id: string;
  total_realizado: number | string | null;
}
interface ItemBvRow {
  job_item_orcado_id: string | null;
  valor: number | string | null;
  situacao: BvSituacao;
}
interface EnvioFaturamentoRow {
  valor_faturado: number | string | null;
}
interface VersaoRow {
  percentual_honorarios: number | string | null;
  percentual_imposto: number | string | null;
}

async function main() {
// ---------------------------------------------------------- carregar view
const { data: linhasView, error: errView } = await supabase
  .from("vw_job_rentabilidade")
  .select("*")
  .order("data_abertura_financeiro", { ascending: false })
  .limit(LIMITE);

if (errView || !linhasView) {
  console.error("Erro lendo vw_job_rentabilidade:", errView?.message);
  process.exit(1);
}
console.log(`\nLidos ${linhasView.length} jobs da view.`);

// ---------------------------------------------------------- por job
for (const linha of linhasView as any[]) {
  console.log(`\n=== ${linha.job_codigo} · ${linha.job_nome} ===`);

  // Versao aprovada -> %hon e %imp
  const { data: jobRow, error: eJob } = await supabase
    .from("jobs")
    .select("versao_orcamento_aprovada_id")
    .eq("id", linha.job_id)
    .maybeSingle();
  if (eJob || !jobRow?.versao_orcamento_aprovada_id) {
    console.log(`  ! sem versão aprovada — pulando (${eJob?.message ?? ""})`);
    falhas += 1;
    continue;
  }

  const [
    { data: versaoRaw, error: eVer },
    { data: itensRaw, error: eIt },
    { data: realizRaw, error: eRe },
    { data: bvsRaw, error: eBv },
    { data: envioRaw, error: eEn },
  ] = await Promise.all([
    supabase
      .from("versoes_orcamento")
      .select("percentual_honorarios, percentual_imposto")
      .eq("id", jobRow.versao_orcamento_aprovada_id)
      .maybeSingle(),
    supabase
      .from("jobs_itens_orcado")
      .select(
        "id, tipo_custo, total_orcado, total_planejado, em_save, save_consumido, bv_liquido_planejado",
      )
      .eq("job_id", linha.job_id),
    supabase
      .from("jobs_itens_realizado")
      .select("job_item_orcado_id, total_realizado")
      .eq("job_id", linha.job_id),
    supabase
      .from("itens_bv")
      .select(
        "job_item_orcado_id, valor, situacao, copia:jobs_itens_orcado!inner(job_id)",
      )
      .eq("copia.job_id", linha.job_id)
      .neq("situacao", "cancelado"),
    supabase
      .from("jobs_envio_faturamento")
      .select("valor_faturado")
      .eq("job_id", linha.job_id)
      .maybeSingle(),
  ]);

  if (eVer || !versaoRaw) {
    console.log(`  ! erro lendo versão: ${eVer?.message}`);
    falhas += 1;
    continue;
  }
  if (eIt) {
    console.log(`  ! erro lendo itens: ${eIt.message}`);
    falhas += 1;
    continue;
  }
  if (eRe) console.log(`  ! aviso realizado: ${eRe.message}`);
  if (eBv) console.log(`  ! aviso BVs: ${eBv.message}`);
  if (eEn) console.log(`  ! aviso envio: ${eEn.message}`);

  const versao = versaoRaw as VersaoRow;
  const pctHon = Number(versao.percentual_honorarios ?? 0);
  const pctImp = Number(versao.percentual_imposto ?? 0);

  const itens = (itensRaw ?? []) as JobItemOrcadoRow[];
  const realizados = (realizRaw ?? []) as JobItemRealizadoRow[];
  const bvs = (bvsRaw ?? []) as ItemBvRow[];
  const envio = (envioRaw ?? null) as EnvioFaturamentoRow | null;

  // -------- faturamento_previsto e imposto_previsto (via calcularTotaisVersao)
  // A view usa a CÓPIA do job pra imposto previsto (mesma razão que a tela:
  // errata só existe na cópia). E `imposto` do lado JOB.
  const itensTotais: ItemParaTotais[] = itens.map((it) => ({
    tipo_custo: it.tipo_custo,
    total_orcado: Number(it.total_orcado ?? 0),
    em_save: it.em_save === true,
    save_consumido: Number(it.save_consumido ?? 0),
  }));
  const totais = calcularTotaisVersao(itensTotais, pctHon, pctImp);

  // -------- custo_realizado e bv_realizado (via blocosDoItem/somarBlocosDosItens)
  // Mapa item->soma realizada e item->BV.
  const somaRealPorItem = new Map<string, number>();
  for (const r of realizados) {
    if (!r.job_item_orcado_id) continue;
    somaRealPorItem.set(
      r.job_item_orcado_id,
      (somaRealPorItem.get(r.job_item_orcado_id) ?? 0) +
        Number(r.total_realizado ?? 0),
    );
  }
  const bvPorItem = new Map<string, BvParaConta>();
  for (const b of bvs) {
    if (!b.job_item_orcado_id) continue;
    bvPorItem.set(b.job_item_orcado_id, {
      valor: Number(b.valor ?? 0),
      situacao: b.situacao,
    });
  }

  const blocos = itens.map((it) => {
    const itemBv: ItemParaBv = {
      tipo_custo: it.tipo_custo,
      total_orcado: Number(it.total_orcado ?? 0),
      total_planejado: Number(it.total_planejado ?? 0),
      bv_liquido_planejado:
        it.bv_liquido_planejado === null || it.bv_liquido_planejado === undefined
          ? null
          : Number(it.bv_liquido_planejado),
      em_save: it.em_save === true,
    };
    const bv = bvPorItem.get(it.id) ?? null;
    const somaPPs = somaRealPorItem.get(it.id) ?? 0;
    // Job aparece na view com filtro NOT IN (cancelado, aguardando_abertura,
    // rejeitado_financeiro) — sempre aberto no sentido do cálculo.
    return blocosDoItem(itemBv, bv, somaPPs, pctImp, true);
  });
  const soma = somarBlocosDosItens(blocos);

  const custoRealizadoOficial = soma.realizado.bruto;
  const bvRealizadoOficial = soma.realizado.deducaoBv;

  // -------- faturamento_realizado: SUM(valor_faturado) do envio (0-1 linha)
  const fatRealizadoOficial = Number(envio?.valor_faturado ?? 0);

  // -------- confere
  conferir(
    "faturamento_previsto",
    Number(linha.faturamento_previsto ?? 0),
    totais.faturamentoPrevisto,
  );
  conferir(
    "imposto_previsto",
    Number(linha.imposto_previsto ?? 0),
    totais.imposto,
  );
  conferir(
    "custo_realizado",
    Number(linha.custo_realizado ?? 0),
    custoRealizadoOficial,
  );
  conferir(
    "bv_realizado",
    Number(linha.bv_realizado ?? 0),
    bvRealizadoOficial,
  );
  conferir(
    "faturamento_realizado",
    Number(linha.faturamento_realizado ?? 0),
    fatRealizadoOficial,
  );
}

console.log(`\n${falhas === 0 ? "OK" : "FALHOU"}: ${falhas} divergência(s)`);
process.exit(falhas === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
