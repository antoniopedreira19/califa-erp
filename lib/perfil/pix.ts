/**
 * Normalização da chave Pix antes de persistir.
 *
 * O CHECK `colaboradores_pix_formato` exige formato E.164 pra telefone
 * (`^\+55[1-9]{2}9[0-9]{8}$`), só dígitos pra CPF/CNPJ, e UUID pra chave
 * aleatória. O usuário costuma digitar com máscara ("(71) 99909-6641",
 * "190.000.123-45") ou sem o DDI ("71999096641"). Este helper traduz pro
 * formato aceito antes do action ir ao banco.
 *
 * Email e chave aleatória só passam por trim — não dá pra "consertar" um
 * UUID mal-formado nem adivinhar o email.
 */

export type PixTipo = "cpf" | "cnpj" | "email" | "telefone" | "aleatoria";

export function normalizarChavePix(
  tipo: PixTipo | null | undefined,
  chave: string | null | undefined,
): string | null {
  if (chave == null) return null;
  const bruta = chave.trim();
  if (bruta === "") return null;

  switch (tipo) {
    case "cpf":
    case "cnpj":
      return bruta.replace(/\D/g, "") || null;

    case "telefone": {
      // Remove tudo que não for dígito ou '+'.
      let s = bruta.replace(/[^\d+]/g, "");
      if (s.startsWith("+")) return s;
      // Sem '+': se já veio com 55 na frente e tem 13 dígitos, só adiciona '+'.
      if (s.length === 13 && s.startsWith("55")) return "+" + s;
      // 11 dígitos = DDD(2) + 9 + 8 → é celular sem DDI; prefixa +55.
      if (s.length === 11) return "+55" + s;
      // Qualquer outro tamanho: devolve como o usuário mandou (com '+') pra
      // deixar o CHECK rejeitar com a mensagem original — assim um erro de
      // digitação não vira uma chave "normalizada" errada.
      return s || null;
    }

    case "email":
      return bruta.toLowerCase() || null;

    case "aleatoria":
      return bruta.toLowerCase() || null;

    default:
      return bruta;
  }
}
