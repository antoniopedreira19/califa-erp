import { z } from "zod";
import { normalizarChavePix, problemaDaChavePix } from "@/lib/pix";

/**
 * O pagamento fora do cadastro de uma PP (decisão 127, 29/09/2026; desde a
 * decisão 161, de 09/10/2026, chave aleatória ou boleto; desde a 227, de
 * 29/10/2026, também guia; desde 16/11/2026, também link de pagamento).
 *
 * A produção escolhe UM meio que o fornecedor mandou na hora de cobrar:
 *   - `pix` — só chave ALEATÓRIA (a temporária que o fornecedor gera). A
 *     régua é a do cadastro de fornecedor (decisões 090 e 101), porque a
 *     chave sai no PDF e no arquivo do banco do mesmo jeito; a CHECK
 *     `pp_fora_do_cadastro_formato` repete a expressão no banco;
 *   - `boleto` — sem dado digitado: o boleto vai nos anexos, com o tipo
 *     Boleto, e o envio ao financeiro o exige, junto da nota;
 *   - `guia` — taxa, licença ou alvará de órgão público: como o boleto, sem
 *     dado digitado; a guia vai nos anexos, com o tipo Guia, e o envio ao
 *     financeiro a exige, sem NF.
 *   - `link` — URL do link de pagamento que o fornecedor mandou (Mercado
 *     Pago, Stripe, PagSeguro, Asaas…). Sem anexo próprio: a URL sai no PDF
 *     e o financeiro clica/digita; a NF é exigida como no caso do PIX.
 *
 * Sem motivo (Tiago, 09/10/2026): o motivo é o meio que o fornecedor
 * escolheu. "Outra conta" saiu da tela; o banco ainda aceita `conta` para o
 * legado, mas nenhuma PP o usou.
 *
 * O schema devolve o dado já normalizado, no formato de sempre (os campos
 * não relevantes ao meio vão nulos): quem grava não precisa lembrar de
 * limpar nada.
 */

const LINK_MAX = 2048;

function problemaDoLinkDePagamento(link: string): string | null {
  if (link.length > LINK_MAX) return `O link tem mais de ${LINK_MAX} caracteres.`;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return "Cole um link que comece com http:// ou https://.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Cole um link que comece com http:// ou https://.";
  }
  if (!url.hostname) return "O link não tem endereço.";
  return null;
}

export const pagamentoForaDoCadastroSchema = z
  .object({
    meio: z.enum(["pix", "boleto", "guia", "link"], {
      errorMap: () => ({ message: "Escolha chave aleatória, boleto, guia ou link de pagamento." }),
    }),
    pix_tipo: z.enum(["cpf", "cnpj", "email", "telefone", "aleatoria"]).nullable().optional(),
    pix_chave: z
      .string()
      .nullable()
      .optional()
      .transform((v) => (v ?? "").trim()),
    pagamento_link: z
      .string()
      .nullable()
      .optional()
      .transform((v) => (v ?? "").trim()),
  })
  .superRefine((d, ctx) => {
    if (d.meio === "pix") {
      if (d.pix_tipo !== "aleatoria") {
        ctx.addIssue({ code: "custom", path: ["pix_tipo"], message: "A chave desta PP precisa ser aleatória." });
        return;
      }
      if (!d.pix_chave) {
        ctx.addIssue({ code: "custom", path: ["pix_chave"], message: "Cole a chave aleatória que o fornecedor mandou." });
        return;
      }
      const problema = problemaDaChavePix("aleatoria", d.pix_chave);
      if (problema) ctx.addIssue({ code: "custom", path: ["pix_chave"], message: problema });
      return;
    }
    if (d.meio === "link") {
      if (!d.pagamento_link) {
        ctx.addIssue({ code: "custom", path: ["pagamento_link"], message: "Cole o link de pagamento que o fornecedor mandou." });
        return;
      }
      const problema = problemaDoLinkDePagamento(d.pagamento_link);
      if (problema) ctx.addIssue({ code: "custom", path: ["pagamento_link"], message: problema });
    }
  })
  .transform((d) => {
    const pix = d.meio === "pix";
    const link = d.meio === "link";
    return {
      meio: d.meio,
      motivo: null,
      pix_tipo: pix ? ("aleatoria" as const) : null,
      pix_chave: pix ? (normalizarChavePix("aleatoria", d.pix_chave) ?? null) : null,
      banco_codigo: null,
      agencia: null,
      agencia_dv: null,
      conta: null,
      conta_dv: null,
      tipo_conta: null,
      pagamento_link: link ? d.pagamento_link : null,
    };
  });

export type PagamentoForaDoCadastroInput = z.input<typeof pagamentoForaDoCadastroSchema>;
