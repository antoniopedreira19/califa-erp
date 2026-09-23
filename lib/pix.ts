/**
 * A chave PIX no formato que o banco aceita.
 *
 * 18/09/2026. O plano é gerar arquivo de remessa CNAB para pagar
 * fornecedor, e o CNAB carrega a chave exatamente como o DICT a guarda —
 * não como a pessoa digitou. Chave fora do formato não é rejeitada aqui:
 * ela é aceita, gravada torta, e volta como pagamento devolvido lá na
 * frente, quando ninguém mais lembra de onde veio.
 *
 * Por isso a normalização mora AQUI e é usada nos dois lados: a gravação
 * (`app/(app)/fornecedores/actions.ts`) e a tela, que precisa desfazer o
 * canônico para mostrar o campo do jeito que se digita.
 *
 * O canônico, por tipo:
 *
 * | tipo      | grava                         | exemplo                                |
 * |-----------|-------------------------------|----------------------------------------|
 * | cpf       | 11 dígitos                    | `12345678901`                          |
 * | cnpj      | 14 dígitos                    | `12345678000190`                       |
 * | telefone  | E.164 com o país              | `+5511999999999`                       |
 * | email     | minúsculas, sem espaço        | `financeiro@fornecedor.com.br`         |
 * | aleatoria | UUID minúsculo, com hífens    | `123e4567-e89b-12d3-a456-426614174000` |
 */

import { isValidCnpj, isValidCpf, onlyDigits } from "@/lib/utils";

export type PixTipo = "cpf" | "cnpj" | "email" | "telefone" | "aleatoria";

export const PIX_TIPOS: { valor: PixTipo; rotulo: string }[] = [
  { valor: "cnpj", rotulo: "CNPJ" },
  { valor: "cpf", rotulo: "CPF" },
  { valor: "email", rotulo: "E-mail" },
  { valor: "telefone", rotulo: "Telefone" },
  { valor: "aleatoria", rotulo: "Chave aleatória" },
];

/** O que o campo mostra embaixo da caixa, para quem digita saber o alvo. */
export const PIX_AJUDA: Record<PixTipo, string> = {
  cpf: "Só os números do CPF — é assim que o banco recebe.",
  cnpj: "Só os números do CNPJ — é assim que o banco recebe.",
  email: "Gravamos em minúsculas, como o DICT registra.",
  telefone:
    "Celular com DDD (11 dígitos, começando com 9). Gravamos com o país na frente (+55), que é o formato do PIX no arquivo de pagamento.",
  aleatoria:
    "A chave aleatória (EVP) tem 32 caracteres hexadecimais; os hífens entram sozinhos.",
};

/** 32 hex viram `8-4-4-4-12`. Já vindo com hífens, só confere o desenho. */
function formatarEvp(bruto: string): string {
  const hex = bruto.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (hex.length !== 32) return bruto.trim().toLowerCase();
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/**
 * O valor que vai para o banco de dados. Recebe o que a pessoa digitou,
 * com máscara ou sem, e devolve o canônico da tabela acima.
 *
 * Nunca inventa: o que não dá para normalizar volta só aparado, e a
 * validação do schema é quem barra.
 */
export function normalizarChavePix(
  tipo: string | null | undefined,
  chave: string | null | undefined,
): string | null | undefined {
  if (!tipo || !chave) return chave;
  const bruto = String(chave).trim();

  switch (tipo) {
    case "cpf":
    case "cnpj":
      return onlyDigits(bruto);

    case "telefone": {
      // O DDI pode vir digitado ("+55 11 …", "55119…") ou não vir — os
      // 10/11 dígitos finais é que são o telefone.
      const d = onlyDigits(bruto);
      const semDdi = d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
      return semDdi ? `+55${semDdi}` : "";
    }

    case "email":
      return bruto.toLowerCase();

    case "aleatoria":
      return formatarEvp(bruto);

    default:
      return bruto;
  }
}

/**
 * O caminho de volta: o canônico vira o que o campo mostra. Só o telefone
 * muda de verdade (o `+55` sai, porque a máscara é de número brasileiro);
 * CPF e CNPJ a própria máscara formata a partir dos dígitos.
 */
export function chavePixParaExibir(
  tipo: string | null | undefined,
  chave: string | null | undefined,
): string {
  if (!tipo || !chave) return chave ?? "";
  if (tipo !== "telefone") return chave;
  const d = onlyDigits(chave);
  return d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
}

/** Os dígitos do telefone, sem DDI — o que a validação conta. */
export function telefonePixSemDdi(chave: string): string {
  const d = onlyDigits(chave);
  return d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
}

/** A chave aleatória é um EVP: 32 hexadecimais, com ou sem hífens. */
export function evpValido(chave: string): boolean {
  return /^[0-9a-fA-F]{32}$/.test(chave.replace(/-/g, ""));
}

/**
 * O desenho final de cada tipo, depois de normalizado — o que o DICT
 * registra e o que vai, sem retoque, na Informação 12 do segmento B do
 * PIX (Nota G035 do layout Santander). As mesmas expressões estão nas
 * CHECK de `fornecedores` e `colaboradores` (migration 20260923180001):
 * se mudar aqui, muda lá.
 *
 * - telefone: só celular brasileiro — DDD sem zero + 9 dígitos começando
 *   em 9. Telefone fixo não é chave PIX.
 * - email: o padrão do DICT, até 77 caracteres, em minúsculas.
 * - aleatoria: o EVP com hífens, em minúsculas.
 */
export const PIX_FORMATO: Record<PixTipo, RegExp> = {
  cpf: /^\d{11}$/,
  cnpj: /^\d{14}$/,
  telefone: /^\+55[1-9]{2}9\d{8}$/,
  email:
    /^[a-z0-9.!#$&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/,
  aleatoria: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};

const EMAIL_PIX_MAX = 77;

/**
 * O que está errado na chave, ou `null` se ela sai no arquivo de remessa
 * do jeito que o banco aceita. Recebe a chave como a pessoa digitou —
 * normaliza antes de medir, como a gravação faz.
 *
 * É a régua única: o cadastro de fornecedor e o de colaborador recusam
 * com esta mensagem, e a geração da remessa confere de novo antes de
 * montar a linha.
 */
export function problemaDaChavePix(
  tipo: string | null | undefined,
  chave: string | null | undefined,
): string | null {
  if (!tipo && !chave) return null;
  if (!tipo) return "Escolha o tipo da chave PIX.";
  if (!chave || !chave.trim()) return "Informe a chave PIX.";
  if (!(tipo in PIX_FORMATO)) return "Tipo de chave PIX inválido.";

  const canonica = normalizarChavePix(tipo, chave) ?? "";
  const formatoOk = PIX_FORMATO[tipo as PixTipo].test(canonica);

  switch (tipo as PixTipo) {
    case "cpf":
      return formatoOk && isValidCpf(canonica) ? null : "CPF inválido.";
    case "cnpj":
      return formatoOk && isValidCnpj(canonica) ? null : "CNPJ inválido.";
    case "telefone":
      return formatoOk
        ? null
        : "A chave de telefone é um celular: DDD + 9 dígitos, começando com 9.";
    case "email":
      if (canonica.length > EMAIL_PIX_MAX)
        return `E-mail longo demais para chave PIX (máximo ${EMAIL_PIX_MAX} caracteres).`;
      return formatoOk ? null : "E-mail inválido para chave PIX.";
    case "aleatoria":
      return formatoOk
        ? null
        : "Chave aleatória inválida — são 32 caracteres de 0-9 e a-f.";
  }
}
