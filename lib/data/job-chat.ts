import type { SupabaseClient } from "@supabase/supabase-js";
import {
  tipoCustoLabel,
  type ChatLinha,
  type ItemChat,
  type JobErrataComItens,
  type JobMensagem,
  type SaveAprovacaoTipo,
} from "@/lib/types";
import { grupoDoPedido } from "@/lib/data/saves";

/**
 * Monta a thread de Comunicação do job.
 *
 * Só as mensagens de pessoas vêm do banco. Os cards automáticos são
 * derivados de dados que já existem — a abertura do job, as erratas e,
 * desde a decisão 099 (22/09/2026), as recusas de save — então nunca
 * divergem da fonte e aparecem retroativamente, sem backfill.
 */

/**
 * Uma recusa de save do financeiro, para o card da Comunicação (decisão
 * 099). Vem de `saves_aprovacoes`: o pedido recusado guarda a
 * justificativa, e continua guardando depois que o GP arquiva a recusa
 * ("Retirar") — o card fica na thread como a errata fica.
 */
export interface RecusaDeSaveNoChat {
  id: string;
  tipo: SaveAprovacaoTipo;
  itemDescricao: string;
  grupoNome: string | null;
  valor: number;
  /** Edição de um consumo aprovado: o pedido aprovado que ela substituiria.
   *  Recusada, a linha volta àquele consumo — e não ao faturamento. */
  substituiId: string | null;
  justificativa: string;
  decididoEm: string;
  /** `profiles.id` de quem recusou — para a conta de não lidas. */
  decididoPorId: string | null;
  decididoPorNome: string | null;
}

/**
 * As recusas de save de um job, da mais antiga à mais recente.
 *
 * Recusa = pedido decidido com justificativa: o banco apaga a
 * justificativa na aprovação (`saves_aprovacoes_guarda`), e o cancelamento
 * não tem decisão. `saves_aprovacoes` tem quatro FKs para `profiles`: o
 * nome de quem recusou sai numa consulta própria, nunca por embed.
 */
export async function lerRecusasDeSaveDoJob(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<RecusaDeSaveNoChat[]> {
  const { data, error } = await supabase
    .from("saves_aprovacoes")
    .select(
      "id, tipo, item_descricao, grupo_nome, mes_do_pedido, valor, substitui_id, justificativa, decidido_em, decidido_por",
    )
    .eq("tenant_id", tenantId)
    .eq("job_id", jobId)
    .not("justificativa", "is", null)
    .not("decidido_em", "is", null)
    .order("decidido_em", { ascending: true });
  if (error) {
    console.error("[job-chat.recusas-save]", error.message);
    return [];
  }
  const linhas = (data ?? []) as any[];
  const idsPessoas = [
    ...new Set(linhas.map((l) => l.decidido_por as string | null).filter(Boolean)),
  ] as string[];
  const nomes = new Map<string, string | null>();
  if (idsPessoas.length > 0) {
    const { data: pessoas, error: pessoasErr } = await supabase
      .from("profiles")
      .select("id, nome")
      .in("id", idsPessoas);
    if (pessoasErr) console.error("[job-chat.recusas-save.nomes]", pessoasErr.message);
    for (const p of (pessoas ?? []) as any[]) nomes.set(p.id, p.nome ?? null);
  }
  return linhas.map((l) => ({
    id: l.id,
    tipo: l.tipo as SaveAprovacaoTipo,
    itemDescricao: l.item_descricao,
    // No mensal, com o mês na frente (24/09/2026).
    grupoNome: grupoDoPedido(l.grupo_nome ?? null, l.mes_do_pedido ?? null),
    valor: Number(l.valor ?? 0),
    substituiId: l.substitui_id ?? null,
    justificativa: l.justificativa,
    decididoEm: l.decidido_em,
    decididoPorId: l.decidido_por ?? null,
    decididoPorNome: l.decidido_por ? (nomes.get(l.decidido_por) ?? null) : null,
  }));
}

/**
 * Quantas recusas de save contam como não lidas para quem está logado: as
 * de outra pessoa depois da última leitura — a mesma regra da errata, que
 * é o evento que o outro time mais precisa ver.
 */
export function recusasDeSaveNaoLidas(
  recusas: RecusaDeSaveNoChat[],
  profileId: string,
  lidaAte: string | null,
): number {
  return recusas.filter(
    (r) => r.decididoPorId !== profileId && (!lidaAte || r.decididoEm > lidaAte),
  ).length;
}

/**
 * Datas e horas da Comunicação no horário de BRASÍLIA (24/09/2026).
 *
 * Estes rótulos são montados no servidor, e o servidor da Vercel roda em
 * UTC — três horas à frente. Com `getHours()`/`getDate()` puros, uma
 * mensagem das 10:00 aparecia como 13:00, e o que acontecia depois das
 * 21:00 saía com a data do dia seguinte. No servidor local (Mac em
 * Brasília) o erro não aparecia. O fuso vai explícito, como já fazem a
 * fila de abertura e o contas a pagar.
 */
const FUSO_BR = "America/Sao_Paulo";

function partesEmBrasilia(iso: string): {
  dia: string;
  mes: string;
  ano: string;
  hora: string;
  min: string;
} {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO_BR,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const de = (t: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === t)?.value ?? "";
  return {
    dia: de("day"),
    mes: de("month"),
    ano: de("year"),
    hora: de("hour"),
    min: de("minute"),
  };
}

function dataHora(iso: string): string {
  const d = partesEmBrasilia(iso);
  return `${d.dia}/${d.mes}/${d.ano} ${d.hora}:${d.min}`;
}

/** Mensagens humanas usam formato curto, como no design ("10/07 09:14"). */
function dataHoraCurta(iso: string): string {
  const d = partesEmBrasilia(iso);
  return `${d.dia}/${d.mes} ${d.hora}:${d.min}`;
}

/** dd/mm/aaaa. Coluna `date` ("2026-09-23") é corte de string, sem fuso;
 *  timestamp ("2026-09-23T01:30:00+00:00") vira a data de Brasília. */
function dataCurta(iso: string): string {
  if (iso.length <= 10) {
    const [y, m, d] = iso.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }
  const d = partesEmBrasilia(iso);
  return `${d.dia}/${d.mes}/${d.ano}`;
}

function moeda(v: number, moedaCode: string): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: moedaCode });
}

function comSinal(v: number, moedaCode: string): string {
  const s = moeda(Math.abs(v), moedaCode);
  if (v === 0) return s;
  return `${v > 0 ? "+" : "−"}${s}`;
}

function diasEntre(inicio: string | null, fim: string | null): number | null {
  if (!inicio || !fim) return null;
  const a = new Date(inicio.slice(0, 10));
  const b = new Date(fim.slice(0, 10));
  const dias = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  return Number.isFinite(dias) ? dias : null;
}

export interface DadosAberturaChat {
  criadoEm: string;
  /** Quando o financeiro abriu o job. `null` antes da abertura, e nos
   *  jobs anteriores à tela de abertura. Só a errata posterior a esta
   *  data devolve o job ao mural — é o que a nota do card diz. */
  aberturaFinanceiroEm?: string | null;
  orcamentoCodigo: string | null;
  versaoNumero: number | null;
  versaoNome: string | null;
  valorJobAbertura: number | null;
  totalOrcado: number;
  qtdItens: number;
  qtdGrupos: number;
  responsavelNome: string | null;
  dataInicio: string | null;
  dataFim: string | null;
}

export function montarThreadChat(
  abertura: DadosAberturaChat,
  erratas: JobErrataComItens[],
  mensagens: Array<JobMensagem & { autor_nome: string | null }>,
  moedaCode: string,
  /**
   * As recusas de save do job (`lerRecusasDeSaveDoJob`, decisão 099).
   * Obrigatório de propósito: sem elas a thread não mostra o card da
   * recusa, e um padrão `[]` deixaria esquecer em silêncio. Quem monta a
   * thread (`carregar-detalhe.ts`) soma também `recusasDeSaveNaoLidas` no
   * contador de não lidas.
   */
  recusasDeSave: RecusaDeSaveNoChat[],
): ItemChat[] {
  const itens: ItemChat[] = [];

  // ---- Card de abertura ----
  const linhasAbertura: ChatLinha[] = [];
  if (abertura.valorJobAbertura !== null) {
    linhasAbertura.push({
      texto: "Valor de faturamento na abertura",
      valor: moeda(abertura.valorJobAbertura, moedaCode),
      tom: "neutro",
    });
  }
  linhasAbertura.push({
    texto: `Total orçado · ${abertura.qtdItens} ${
      abertura.qtdItens === 1 ? "item" : "itens"
    } em ${abertura.qtdGrupos} ${abertura.qtdGrupos === 1 ? "grupo" : "grupos"}`,
    valor: moeda(abertura.totalOrcado, moedaCode),
    tom: "neutro",
  });
  if (abertura.responsavelNome) {
    linhasAbertura.push({
      texto: "Responsável pela produção",
      valor: abertura.responsavelNome,
      tom: "texto",
    });
  }
  const dias = diasEntre(abertura.dataInicio, abertura.dataFim);
  if (dias !== null && abertura.dataInicio && abertura.dataFim) {
    linhasAbertura.push({
      texto: `Prazo · ${dataCurta(abertura.dataInicio)} a ${dataCurta(abertura.dataFim)}`,
      valor: `${dias} ${dias === 1 ? "dia" : "dias"}`,
      tom: "texto",
    });
  }

  const origem =
    abertura.orcamentoCodigo && abertura.versaoNumero !== null
      ? `Criado a partir do orçamento ${abertura.orcamentoCodigo} · v${abertura.versaoNumero}${
          abertura.versaoNome ? ` ${abertura.versaoNome}` : ""
        }, aprovado pelo cliente.`
      : "Criado a partir da versão aprovada do orçamento.";

  itens.push({
    tipo: "sistema",
    id: "abertura",
    icone: "folder-open",
    cor: "azul",
    titulo: "Job aberto",
    quando: dataHora(abertura.criadoEm),
    resumo: origem,
    valor:
      abertura.valorJobAbertura !== null
        ? moeda(abertura.valorJobAbertura, moedaCode)
        : null,
    valorTom: "neutro",
    linhas: linhasAbertura,
    em: abertura.criadoEm,
  });

  // ---- Um card por errata ----
  for (const e of erratas) {
    const delta = e.valor_job_depois - e.valor_job_antes;
    // Errata que só reclassifica ganha ícone e cor próprios: o valor
    // orçado não mexeu, mas o faturamento sim, e isso confunde quem lê.
    const soTipo =
      e.itens.length > 0 &&
      e.itens.every(
        (i) =>
          i.tipo_custo_de !== i.tipo_custo_para &&
          i.valor_unitario_de === i.valor_unitario_para,
      );

    const linhas: ChatLinha[] = e.itens.map((i) => {
      const mudouTipo = i.tipo_custo_de !== i.tipo_custo_para;
      // Desde 27/08/2026 a errata também cria e remove linha, e cada caso
      // se conta de um jeito: "de → para" não diz nada quando um dos dois
      // lados não existe.
      const texto =
        i.acao === "nova"
          ? `Linha nova${i.linha_vermelha ? " (vermelha)" : ""} · ${i.item_nome} em ${i.grupo_nome}: ${moeda(i.total_para, moedaCode)}`
          : i.acao === "removida"
            ? `Linha removida · ${i.item_nome} (${moeda(i.total_de, moedaCode)})`
            : mudouTipo
              ? `Tipo de custo · ${i.item_nome}: ${tipoCustoLabel(i.tipo_custo_de)} → ${tipoCustoLabel(i.tipo_custo_para)}`
              : `Valor · ${i.item_nome} ${moeda(i.total_de, moedaCode)} → ${moeda(i.total_para, moedaCode)}`;
      return {
        texto,
        valor: comSinal(i.efeito_valor_job, moedaCode),
        tom: i.efeito_valor_job >= 0 ? "positivo" : "negativo",
      };
    });

    if (e.faturamento_previsto_depois !== null) {
      linhas.push({
        texto: "Novo faturamento previsto",
        valor: moeda(e.faturamento_previsto_depois, moedaCode),
        tom: "neutro",
      });
    }

    linhas.push({
      texto: "Novo valor do job",
      valor: moeda(e.valor_job_depois, moedaCode),
      tom: "neutro",
    });

    // O resumo conta o que a errata FEZ; a descrição, por que ela foi
    // feita. Até 27/08/2026 os dois moravam no mesmo `titulo` e o card
    // ficava lendo "Reajuste de palco · 1 item orçado alterado".
    const conta = (a: string) => e.itens.filter((i) => i.acao === a).length;
    const partes: string[] = [];
    const nAlt = conta("alterada");
    const nNovas = conta("nova");
    const nRem = conta("removida");
    if (nAlt) partes.push(`${nAlt} ${nAlt === 1 ? "linha alterada" : "linhas alteradas"}`);
    if (nNovas) partes.push(`${nNovas} ${nNovas === 1 ? "linha nova" : "linhas novas"}`);
    if (nRem) partes.push(`${nRem} ${nRem === 1 ? "linha removida" : "linhas removidas"}`);

    itens.push({
      tipo: "sistema",
      id: `errata-${e.id}`,
      icone: soTipo ? "tags" : "file-pen-line",
      cor: soTipo ? "bege" : delta >= 0 ? "verde" : "vermelho",
      titulo: `Errata registrada · ${dataCurta(e.created_at)}`,
      quando: dataHora(e.created_at),
      resumo:
        partes.length > 0
          ? `${partes.join(" · ")} · orçado ${moeda(e.custo_orcado_depois, moedaCode)}.`
          : `${e.itens.length} ${
              e.itens.length === 1
                ? "item orçado alterado"
                : "itens orçados alterados"
            }.`,
      valor: comSinal(delta, moedaCode),
      valorTom: delta >= 0 ? "positivo" : "negativo",
      linhas,
      descricao: { rotulo: "Descrição da errata", texto: e.titulo, autor: e.autor_nome },
      nota:
        abertura.aberturaFinanceiroEm &&
        e.created_at > abertura.aberturaFinanceiroEm
          ? "Job devolvido ao mural de abertura para revisão de recebimento e custos."
          : null,
      em: e.created_at,
    });
  }

  // ---- Um card por recusa de save (decisão 099) ----
  // O financeiro recusou o pedido: a linha já voltou ao que era antes
  // dele, e a produção precisa ver por quê. A justificativa vai no bloco
  // de descrição, com o nome de quem recusou — como a da errata.
  for (const r of recusasDeSave) {
    const gera = r.tipo === "gera";
    itens.push({
      tipo: "sistema",
      id: `save-recusado-${r.id}`,
      icone: "x-circle",
      cor: "vermelho",
      titulo: `${gera ? "Save recusado" : "Consumo de save recusado"} · ${dataCurta(r.decididoEm)}`,
      quando: dataHora(r.decididoEm),
      resumo: `${[r.grupoNome, r.itemDescricao].filter(Boolean).join(" · ")}.`,
      valor: moeda(r.valor, moedaCode),
      valorTom: "neutro",
      linhas: [
        {
          texto: gera ? "Crédito pedido" : "Consumo pedido",
          valor: moeda(r.valor, moedaCode),
          tom: "neutro",
        },
      ],
      descricao: {
        rotulo: "Justificativa do financeiro",
        texto: r.justificativa,
        autor: r.decididoPorNome,
      },
      // Os textos da situação "recusado" do pop-up de save (especificação
      // da decisão 099, seção 3), sem o "por {nome} em {data}" — o card
      // já diz quem e quando. A edição de um consumo aprovado
      // (`substitui_id`) recusada volta ao consumo aprovado anterior.
      nota: gera
        ? "A linha voltou ao valor do job, sem crédito. Para pedir de novo, retire o save e marque a linha outra vez."
        : r.substituiId
          ? "A linha voltou ao consumo aprovado anterior."
          : "A linha voltou ao faturamento e a reserva foi liberada.",
      em: r.decididoEm,
    });
  }

  // ---- Mensagens de pessoas ----
  for (const m of mensagens) {
    itens.push({
      tipo: "pessoa",
      id: m.id,
      autor: m.autor_nome ?? "—",
      area: m.area,
      quando: dataHoraCurta(m.created_at),
      texto: m.texto,
      em: m.created_at,
    });
  }

  return itens.sort((a, b) => a.em.localeCompare(b.em));
}
