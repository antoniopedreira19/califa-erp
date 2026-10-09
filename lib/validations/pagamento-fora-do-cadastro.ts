import { z } from "zod";
import { normalizarChavePix, problemaDaChavePix } from "@/lib/pix";

/**
 * O pagamento fora do cadastro de uma PP (decisão 127, 29/09/2026; desde a
 * decisão 161, de 09/10/2026, chave aleatória ou boleto).
 *
 * A produção escolhe UM meio que o fornecedor mandou na hora de cobrar:
 *   - `pix` — só chave ALEATÓRIA (a temporária que o fornecedor gera). A
 *     régua é a do cadastro de fornecedor (decisões 090 e 101), porque a
 *     chave sai no PDF e no arquivo do banco do mesmo jeito; a CHECK
 *     `pp_fora_do_cadastro_formato` repete a expressão no banco;
 *   - `boleto` — sem dado digitado: o boleto vai nos anexos, com o tipo
 *     Boleto, e o envio ao financeiro o exige.
 *
 * Sem motivo (Tiago, 09/10/2026): o motivo é o meio que o fornecedor
 * escolheu. "Outra conta" saiu da tela; o banco ainda aceita `conta` para o
 * legado, mas nenhuma PP o usou.
 *
 * O schema devolve o dado já normalizado, no formato de sempre (os campos
 * de conta vão nulos): quem grava não precisa lembrar de limpar nada.
 */

export const pagamentoForaDoCadastroSchema = z
  .object({
    meio: z.enum(["pix", "boleto"], {
      errorMap: () => ({ message: "Escolha chave aleatória ou boleto." }),
    }),
    pix_tipo: z.enum(["cpf", "cnpj", "email", "telefone", "aleatoria"]).nullable().optional(),
    pix_chave: z
      .string()
      .nullable()
      .optional()
      .transform((v) => (v ?? "").trim()),
  })
  .superRefine((d, ctx) => {
    if (d.meio !== "pix") return;
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
  })
  .transform((d) => {
    const pix = d.meio === "pix";
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
    };
  });

export type PagamentoForaDoCadastroInput = z.input<typeof pagamentoForaDoCadastroSchema>;
