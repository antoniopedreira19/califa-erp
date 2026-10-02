/**
 * Baixa em lote (pedido do Tiago em 02/10/2026: "uma maneira de dar baixa
 * em mais do que um item em títulos a pagar e títulos a receber,
 * selecionando vários e dando baixa de vez").
 *
 * O lote NÃO é uma baixa nova. Cada título vira a baixa e o lançamento
 * dele, pela MESMA action da baixa de um por um — `darBaixaTitulo` de
 * Títulos a Pagar, `darBaixaTitulo` e `darBaixaRecebimentoAvulso` de
 * Títulos a Receber —, com as mesmas travas de permissão, as mesmas
 * validações e a mesma auditoria. O que o lote junta é só o que se
 * escolhe uma vez: a data, a conta, a forma de pagamento (quando há título
 * a pagar) e o centro de custo de quem ainda não tem um.
 *
 * Aqui mora só o que é puro — o formato da entrada e a montagem da entrada
 * de cada action —, para ter teste sem banco
 * (`node --import tsx --test lib/financeiro/baixa-em-lote.test.ts`). A
 * Server Action é `app/(app)/financeiro/actions-baixa-em-lote.ts`; as
 * peças de tela, `components/financeiro/baixa-em-lote.tsx`.
 *
 * Retenção na fonte (módulo fiscal, 02/10/2026): a parcela de PP sai com
 * as alíquotas que o financeiro decidiu na APROVAÇÃO da PP — exatamente o
 * que a baixa de um título grava com elas pré-preenchidas. O servidor
 * relê as alíquotas na hora de baixar; a PP de verba e a parcela que já
 * foi para uma remessa CNAB saem pelo valor cheio, sem retenção, como na
 * baixa de um título.
 *
 * O que fica de fora do lote, e por quê:
 * - **Retenção escolhida na hora.** O lote não edita alíquota: o título com
 *   retenção diferente da aprovação (e o recebimento com imposto retido
 *   pelo cliente) se baixa sozinho, imposto a imposto.
 * - **Baixa parcial.** Uma por vez, no pop-up de um título.
 * - **Cartão de crédito.** No cartão a baixa é a entrada do item na fatura
 *   (decisão 093), um de cada vez; o lote paga pela conta bancária.
 */

import { z } from "zod";
import { IMPOSTOS_RETIDOS, type ImpostoRetido, type RetencaoDaBaixa } from "@/lib/types";

// ---------------------------------------------------------------------------
// O alvo de cada título
// ---------------------------------------------------------------------------

/** As origens a pagar que entram no lote (decisão aprovada pelo Tiago em
 *  02/10/2026). Folha, fatura de cartão e devolução de verba têm baixa
 *  própria e ficam de fora. O desembolso também: o centro de custo dele é
 *  escolhido na baixa, um a um, e o lote não tem regra para escolhê-lo
 *  (o protótipo não o tinha; pergunta levada ao Tiago em 02/10/2026). */
export const ORIGENS_PAGAR_NO_LOTE = ["pp", "avulso", "recorrencia"] as const;
export type OrigemPagarNoLote = (typeof ORIGENS_PAGAR_NO_LOTE)[number];

/** As origens a receber que entram no lote: a nota fiscal e o recebimento
 *  avulso. Rendimento (conta de aplicação travada) e transferência entre
 *  contas têm baixa própria. */
export const ORIGENS_RECEBER_NO_LOTE = ["nf", "recebimento_avulso"] as const;
export type OrigemReceberNoLote = (typeof ORIGENS_RECEBER_NO_LOTE)[number];

/**
 * Por onde cada título se baixa: a action da baixa de um por um e o id que
 * ela recebe.
 *
 * - `pagar`: o id da parcela (PP) ou da conta avulsa (avulso
 *   e recorrência) — o mesmo `{ origem, id }` de `darBaixaTitulo`.
 * - `receber` + `nf`: o id do título (`titulos_receber`).
 * - `receber` + `recebimento_avulso`: o id da conta avulsa de entrada.
 */
export type AlvoDaBaixaEmLote =
  | { modulo: "pagar"; origem: OrigemPagarNoLote; id: string }
  | { modulo: "receber"; origem: OrigemReceberNoLote; id: string };

/** O par do plano de contas — o "centro de custo" das telas. */
export interface CentroDeCusto {
  tipoId: string;
  subtipoId: string;
}

// ---------------------------------------------------------------------------
// A entrada da Server Action
// ---------------------------------------------------------------------------

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data do movimento.");

const centroSchema = z.object({
  tipoId: z.string().uuid("Escolha o centro de custo."),
  subtipoId: z.string().uuid("Escolha o subtipo do centro de custo."),
});

const alvoSchema = z.discriminatedUnion("modulo", [
  z.object({
    modulo: z.literal("pagar"),
    origem: z.enum(ORIGENS_PAGAR_NO_LOTE, {
      errorMap: () => ({ message: "Este título não entra na baixa em lote: dê baixa nele sozinho." }),
    }),
    id: z.string().uuid(),
  }),
  z.object({
    modulo: z.literal("receber"),
    origem: z.enum(ORIGENS_RECEBER_NO_LOTE, {
      errorMap: () => ({ message: "Este título não entra na baixa em lote: dê baixa nele sozinho." }),
    }),
    id: z.string().uuid(),
  }),
]);

const itemSchema = z.object({
  /** A chave da seleção, devolvida no resultado para a tela saber quais
   *  títulos já foram baixados. */
  chave: z.string().min(1).max(200),
  /** O nome do título como a tela mostra — vai na mensagem de erro. */
  rotulo: z.string().max(1000),
  alvo: alvoSchema,
  /**
   * O que falta, como a tela mostrou. A baixa é por este valor: se alguém
   * baixou uma parte nesse meio-tempo, o banco recusa ("passa do que
   * falta") em vez de tirar da conta um valor que não foi o confirmado.
   */
  aberto: z.number().positive("Título sem valor em aberto."),
  /** O centro de custo que o título já tem (o par completo). `null`: usa o
   *  do lote. */
  centro: centroSchema.nullable(),
});

/** Os títulos e o que se escolhe uma vez para todos. */
export const baixaEmLoteSchema = z
  .object({
    pago_em: dataIso,
    conta_bancaria_id: z.string().uuid("Escolha a conta bancária."),
    /** Só PIX, transferência e boleto: no cartão a baixa é pela fatura
     *  (decisão 093). Obrigatória quando há título a pagar. */
    forma_pagamento: z.enum(["pix", "transferencia", "boleto"]).nullable(),
    /** O centro de custo dos pagamentos que não têm um. */
    centro_pagar: centroSchema.nullable(),
    /** O centro de custo dos recebimentos que não têm um. */
    centro_receber: centroSchema.nullable(),
    itens: z
      .array(itemSchema)
      .min(1, "Selecione ao menos um título.")
      .max(200, "Selecione no máximo 200 títulos por lote."),
  })
  .superRefine((d, ctx) => {
    const pagar = d.itens.filter((i) => i.alvo.modulo === "pagar");
    const receber = d.itens.filter((i) => i.alvo.modulo === "receber");
    if (pagar.length > 0 && !d.forma_pagamento) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Escolha a forma de pagamento.",
        path: ["forma_pagamento"],
      });
    }
    if (pagar.some((i) => !i.centro) && !d.centro_pagar) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Escolha o subtipo do centro de custo dos pagamentos.",
        path: ["centro_pagar"],
      });
    }
    if (receber.some((i) => !i.centro) && !d.centro_receber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Escolha o subtipo do centro de custo dos recebimentos.",
        path: ["centro_receber"],
      });
    }
    if (new Set(d.itens.map((i) => i.chave)).size !== d.itens.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "O mesmo título aparece duas vezes no lote.",
        path: ["itens"],
      });
    }
  });

export type EntradaDaBaixaEmLote = z.input<typeof baixaEmLoteSchema>;
export type DadosDaBaixaEmLote = z.output<typeof baixaEmLoteSchema>;
export type ItemDaBaixaEmLote = DadosDaBaixaEmLote["itens"][number];

// ---------------------------------------------------------------------------
// A entrada de cada action
// ---------------------------------------------------------------------------

/**
 * Uma baixa do lote, já no formato da action da baixa de um por um. O lote
 * nunca leva cartão nem baixa parcial: `cartao_credito_id` vai nulo e
 * `valor_baixa` é o que falta (líquido + retidos). `retencoes` só existe na
 * parcela de PP com retenção na aprovação; no resto, vai vazio.
 */
export type ChamadaDaBaixa =
  | {
      acao: "pagar";
      chave: string;
      rotulo: string;
      /** `darBaixaTitulo` de `contas-a-pagar/actions-titulos.ts`. */
      entrada: {
        origem: OrigemPagarNoLote;
        id: string;
        pago_em: string;
        conta_bancaria_id: string;
        plano_conta_tipo_id: string;
        plano_conta_subtipo_id: string;
        forma_pagamento: "pix" | "transferencia" | "boleto";
        cartao_credito_id: null;
        valor_baixa: number;
        retencoes: RetencaoDaBaixa[];
      };
    }
  | {
      acao: "receber_nf";
      chave: string;
      rotulo: string;
      /** `darBaixaTitulo` de `contas-a-receber/actions.ts`. */
      entrada: {
        titulo_id: string;
        pago_em: string;
        conta_bancaria_id: string;
        plano_conta_tipo_id: string;
        plano_conta_subtipo_id: string;
        valor_baixa: number;
        retencoes: [];
      };
    }
  | {
      acao: "receber_avulso";
      chave: string;
      rotulo: string;
      /** `darBaixaRecebimentoAvulso` de `contas-a-receber/actions-recebimento-avulso.ts`. */
      entrada: {
        conta_avulsa_id: string;
        pago_em: string;
        conta_bancaria_id: string;
        plano_conta_tipo_id: string;
        plano_conta_subtipo_id: string;
        valor_baixa: number;
        retencoes: [];
      };
    };

const r2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// Retenção na fonte da aprovação da PP
// ---------------------------------------------------------------------------

/** As alíquotas retidas que a aprovação da PP gravou, em % (só as > 0). */
export type AliquotasDaAprovacao = Partial<Record<ImpostoRetido, number>>;

/**
 * A retenção que a baixa de uma parcela de PP aplica, pela mesma regra da
 * baixa de um título: a PP de verba e a parcela que já foi para uma
 * remessa CNAB saem pelo valor cheio, sem retenção (decisão 125, interino
 * da D15); as outras, com as alíquotas da aprovação. `null`: sem retenção.
 */
export function aliquotasDaParcela(p: {
  verba: boolean;
  emRemessa: boolean;
  aliquotas: AliquotasDaAprovacao | null;
}): AliquotasDaAprovacao | null {
  if (p.verba || p.emRemessa || !p.aliquotas) return null;
  const algumas = IMPOSTOS_RETIDOS.some(({ imposto }) => (p.aliquotas?.[imposto] ?? 0) > 0);
  return algumas ? p.aliquotas : null;
}

/**
 * O que a baixa grava com as alíquotas da aprovação sobre a base (o que
 * falta) — o MESMO cálculo de `useValorDaBaixa`
 * (`components/financeiro/valor-da-baixa.tsx`) com as alíquotas
 * pré-preenchidas: cada imposto arredondado em centavos sobre a base, só os
 * com valor, na ordem de `IMPOSTOS_RETIDOS`; o retido é a soma, e o líquido
 * (o que sai da conta), a base menos o retido.
 */
export function retencoesPelaAprovacao(
  base: number,
  aliquotas: AliquotasDaAprovacao | null,
): { retencoes: RetencaoDaBaixa[]; retido: number; liquido: number } {
  const retencoes: RetencaoDaBaixa[] = [];
  if (aliquotas) {
    for (const { imposto } of IMPOSTOS_RETIDOS) {
      const aliquota = aliquotas[imposto];
      if (typeof aliquota !== "number" || !(aliquota > 0)) continue;
      const valor = r2((base * aliquota) / 100);
      if (valor > 0) retencoes.push({ imposto, aliquota, valor });
    }
  }
  const retido = r2(retencoes.reduce((s, r) => s + r.valor, 0));
  return { retencoes, retido, liquido: r2(base - retido) };
}

/**
 * O centro de custo que cada título usa: o que ele já tem; se não tem, o do
 * lote (o dos pagamentos ou o dos recebimentos). `null` só quando falta o
 * do lote — o schema já barra esse caso antes.
 */
export function centroDoItem(
  item: Pick<ItemDaBaixaEmLote, "alvo" | "centro">,
  dados: Pick<DadosDaBaixaEmLote, "centro_pagar" | "centro_receber">,
): CentroDeCusto | null {
  if (item.centro) return item.centro;
  return item.alvo.modulo === "pagar" ? dados.centro_pagar : dados.centro_receber;
}

/**
 * Monta, na ordem dos títulos, a entrada da action de cada baixa. Devolve
 * a mensagem do primeiro problema em vez de montar um lote pela metade.
 *
 * `aliquotasPorParcela`: as alíquotas que valem para cada parcela de PP do
 * lote, lidas no servidor (`aliquotasDaParcela`; `null` = sem retenção).
 * Toda parcela de PP do lote tem de estar nele: a que faltar barra o lote
 * inteiro — sem saber a retenção, a PP sairia pelo bruto.
 */
export function montarChamadas(
  dados: DadosDaBaixaEmLote,
  aliquotasPorParcela: ReadonlyMap<string, AliquotasDaAprovacao | null>,
): { ok: true; chamadas: ChamadaDaBaixa[] } | { ok: false; mensagem: string } {
  const chamadas: ChamadaDaBaixa[] = [];
  for (const item of dados.itens) {
    const centro = centroDoItem(item, dados);
    if (!centro) {
      return {
        ok: false,
        mensagem:
          item.alvo.modulo === "pagar"
            ? "Escolha o subtipo do centro de custo dos pagamentos."
            : "Escolha o subtipo do centro de custo dos recebimentos.",
      };
    }
    const comum = {
      pago_em: dados.pago_em,
      conta_bancaria_id: dados.conta_bancaria_id,
      plano_conta_tipo_id: centro.tipoId,
      plano_conta_subtipo_id: centro.subtipoId,
      valor_baixa: r2(item.aberto),
      retencoes: [] as [],
    };
    if (item.alvo.modulo === "pagar") {
      if (!dados.forma_pagamento) {
        return { ok: false, mensagem: "Escolha a forma de pagamento." };
      }
      let retencoes: RetencaoDaBaixa[] = [];
      if (item.alvo.origem === "pp") {
        if (!aliquotasPorParcela.has(item.alvo.id)) {
          return {
            ok: false,
            mensagem: `Não foi possível conferir as retenções da aprovação de “${item.rotulo}”. Nenhuma baixa foi feita.`,
          };
        }
        retencoes = retencoesPelaAprovacao(
          comum.valor_baixa,
          aliquotasPorParcela.get(item.alvo.id) ?? null,
        ).retencoes;
      }
      chamadas.push({
        acao: "pagar",
        chave: item.chave,
        rotulo: item.rotulo,
        entrada: {
          origem: item.alvo.origem,
          id: item.alvo.id,
          ...comum,
          forma_pagamento: dados.forma_pagamento,
          cartao_credito_id: null,
          retencoes,
        },
      });
    } else if (item.alvo.origem === "nf") {
      chamadas.push({
        acao: "receber_nf",
        chave: item.chave,
        rotulo: item.rotulo,
        entrada: { titulo_id: item.alvo.id, ...comum },
      });
    } else {
      chamadas.push({
        acao: "receber_avulso",
        chave: item.chave,
        rotulo: item.rotulo,
        entrada: { conta_avulsa_id: item.alvo.id, ...comum },
      });
    }
  }
  return { ok: true, chamadas };
}

// ---------------------------------------------------------------------------
// O resultado
// ---------------------------------------------------------------------------

/**
 * O que a Server Action devolve. As baixas são feitas uma a uma, na ordem,
 * e o lote para no primeiro erro: `feitas` diz quais chaves já viraram
 * baixa (e continuam valendo); `falha` diz onde parou e por quê. `chave`
 * nula é erro do lote inteiro (data, conta, forma), antes de qualquer
 * baixa.
 */
export type ResultadoDaBaixaEmLote =
  | { ok: true; feitas: string[] }
  | {
      ok: false;
      feitas: string[];
      falha: { chave: string | null; rotulo: string | null; mensagem: string };
    };
