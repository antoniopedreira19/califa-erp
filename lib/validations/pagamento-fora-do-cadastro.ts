import { z } from "zod";
import { onlyDigits } from "@/lib/utils";
import { normalizarChavePix, problemaDaChavePix } from "@/lib/pix";
import { getBancoByCodigo } from "@/lib/dados/bancos-febraban";

/**
 * O pagamento fora do cadastro de uma PP (decisão 127, 29/09/2026).
 *
 * A produção troca UM meio — outro PIX ou outra conta — e diz por quê. As
 * réguas são as do cadastro de fornecedor (decisões 090 e 101), porque o
 * dado sai no PDF e no arquivo do banco do mesmo jeito; a CHECK
 * `pp_fora_do_cadastro_formato` repete as expressões no banco.
 *
 * O schema devolve o dado já normalizado e com o outro meio zerado: quem
 * grava não precisa lembrar de limpar nada.
 */

export const MOTIVO_FORA_DO_CADASTRO_MIN = 10;

const texto = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v ?? "").trim());

export const pagamentoForaDoCadastroSchema = z
  .object({
    meio: z.enum(["pix", "conta"], {
      errorMap: () => ({ message: "Escolha outro PIX ou outra conta." }),
    }),
    motivo: z
      .string({ required_error: "Informe o motivo do pagamento fora do cadastro." })
      .trim()
      .min(
        MOTIVO_FORA_DO_CADASTRO_MIN,
        `Informe o motivo do pagamento fora do cadastro (mín. ${MOTIVO_FORA_DO_CADASTRO_MIN} caracteres).`,
      )
      .max(300, "Motivo longo demais (máx. 300 caracteres)."),
    pix_tipo: z.enum(["cpf", "cnpj", "email", "telefone", "aleatoria"]).nullable().optional(),
    pix_chave: texto,
    banco_codigo: texto,
    agencia: texto,
    agencia_dv: texto,
    conta: texto,
    conta_dv: texto,
    tipo_conta: z.enum(["corrente", "poupanca", "pagamento"]).nullable().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.meio === "pix") {
      if (!d.pix_tipo) {
        ctx.addIssue({ code: "custom", path: ["pix_tipo"], message: "Escolha o tipo da chave PIX desta PP." });
        return;
      }
      const problema = problemaDaChavePix(d.pix_tipo, d.pix_chave);
      if (problema) {
        ctx.addIssue({ code: "custom", path: ["pix_chave"], message: `Chave PIX desta PP: ${problema}` });
      }
      return;
    }
    if (!d.banco_codigo || !getBancoByCodigo(d.banco_codigo)) {
      ctx.addIssue({ code: "custom", path: ["banco_codigo"], message: "Escolha o banco da conta desta PP." });
    }
    if (!/^[0-9]{3,5}$/.test(onlyDigits(d.agencia))) {
      ctx.addIssue({ code: "custom", path: ["agencia"], message: "Agência desta PP: 3 a 5 dígitos." });
    }
    if (d.agencia_dv && !/^[0-9X]$/i.test(d.agencia_dv)) {
      ctx.addIssue({ code: "custom", path: ["agencia_dv"], message: "Dígito da agência desta PP inválido." });
    }
    if (!/^[0-9]{4,12}$/.test(onlyDigits(d.conta))) {
      ctx.addIssue({ code: "custom", path: ["conta"], message: "Conta desta PP: 4 a 12 dígitos." });
    }
    if (!/^[0-9X]$/i.test(d.conta_dv)) {
      ctx.addIssue({ code: "custom", path: ["conta_dv"], message: "Informe o dígito da conta desta PP." });
    }
    if (!d.tipo_conta) {
      ctx.addIssue({ code: "custom", path: ["tipo_conta"], message: "Escolha o tipo da conta desta PP." });
    }
  })
  .transform((d) => {
    const pix = d.meio === "pix";
    return {
      meio: d.meio,
      motivo: d.motivo,
      pix_tipo: pix ? (d.pix_tipo ?? null) : null,
      pix_chave: pix ? (normalizarChavePix(d.pix_tipo, d.pix_chave) ?? null) : null,
      banco_codigo: pix ? null : d.banco_codigo,
      agencia: pix ? null : onlyDigits(d.agencia),
      agencia_dv: pix ? null : d.agencia_dv ? d.agencia_dv.toUpperCase() : null,
      conta: pix ? null : onlyDigits(d.conta),
      conta_dv: pix ? null : d.conta_dv.toUpperCase(),
      tipo_conta: pix ? null : (d.tipo_conta ?? null),
    };
  });

export type PagamentoForaDoCadastroInput = z.input<typeof pagamentoForaDoCadastroSchema>;
