import {
  tipoCustoLabel,
  type ChatLinha,
  type ItemChat,
  type JobErrataComItens,
  type JobMensagem,
} from "@/lib/types";

/**
 * Monta a thread de Comunicação do job.
 *
 * Só as mensagens de pessoas vêm do banco. Os cards automáticos são
 * derivados de dados que já existem — a abertura do job e as erratas —
 * então nunca divergem da fonte e aparecem retroativamente, sem backfill.
 */

function dataHora(iso: string): string {
  const d = new Date(iso);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const hora = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dia}/${mes}/${d.getFullYear()} ${hora}:${min}`;
}

/** Mensagens humanas usam formato curto, como no design ("10/07 09:14"). */
function dataHoraCurta(iso: string): string {
  const d = new Date(iso);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const hora = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dia}/${mes} ${hora}:${min}`;
}

function dataCurta(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
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
  orcamentoCodigo: string | null;
  versaoNumero: number | null;
  versaoNome: string | null;
  faturamentoAbertura: number | null;
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
): ItemChat[] {
  const itens: ItemChat[] = [];

  // ---- Card de abertura ----
  const linhasAbertura: ChatLinha[] = [];
  if (abertura.faturamentoAbertura !== null) {
    linhasAbertura.push({
      texto: "Valor de faturamento na abertura",
      valor: moeda(abertura.faturamentoAbertura, moedaCode),
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
      abertura.faturamentoAbertura !== null
        ? moeda(abertura.faturamentoAbertura, moedaCode)
        : null,
    valorTom: "neutro",
    linhas: linhasAbertura,
    em: abertura.criadoEm,
  });

  // ---- Um card por errata ----
  for (const e of erratas) {
    const delta = e.faturamento_depois - e.faturamento_antes;
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
      const texto = mudouTipo
        ? `Tipo de custo · ${i.item_nome}: ${tipoCustoLabel(i.tipo_custo_de)} → ${tipoCustoLabel(i.tipo_custo_para)}`
        : `Valor · ${i.item_nome} ${moeda(i.total_de, moedaCode)} → ${moeda(i.total_para, moedaCode)}`;
      return {
        texto,
        valor: comSinal(i.efeito_faturamento, moedaCode),
        tom: i.efeito_faturamento >= 0 ? "positivo" : "negativo",
      };
    });

    linhas.push({
      texto: "Novo valor de faturamento",
      valor: moeda(e.faturamento_depois, moedaCode),
      tom: "neutro",
    });

    itens.push({
      tipo: "sistema",
      id: `errata-${e.id}`,
      icone: soTipo ? "tags" : "file-pen-line",
      cor: soTipo ? "bege" : delta >= 0 ? "verde" : "vermelho",
      titulo: `Errata registrada · ${dataCurta(e.created_at)}`,
      quando: dataHora(e.created_at),
      resumo: `${e.titulo} · ${e.itens.length} ${
        e.itens.length === 1 ? "item orçado alterado" : "itens orçados alterados"
      }.`,
      valor: comSinal(delta, moedaCode),
      valorTom: delta >= 0 ? "positivo" : "negativo",
      linhas,
      em: e.created_at,
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
