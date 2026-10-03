import { Landmark } from "lucide-react";
import type { Colaborador } from "@/lib/types";
import { CardBase, Campo } from "./card-base";

type Props = {
  colaborador: Pick<
    Colaborador,
    | "banco_codigo"
    | "banco_nome"
    | "agencia"
    | "agencia_dv"
    | "conta"
    | "conta_dv"
    | "tipo_conta"
    | "pix_tipo"
    | "pix_chave"
  >;
};

const PIX_LABEL: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  telefone: "Telefone",
  aleatoria: "Chave aleatória",
};

const TIPO_CONTA_LABEL: Record<string, string> = {
  corrente: "Conta corrente",
  poupanca: "Conta poupança",
  pagamento: "Conta de pagamento",
};

export function CardDadosBancarios({ colaborador: c }: Props) {
  const temConta =
    !!c.banco_codigo || !!c.agencia || !!c.conta || !!c.tipo_conta;
  const temPix = !!c.pix_tipo && !!c.pix_chave;

  const bancoLinha =
    c.banco_codigo && c.banco_nome
      ? `${c.banco_codigo} — ${c.banco_nome}`
      : (c.banco_codigo ?? c.banco_nome ?? null);

  const agenciaLinha = c.agencia
    ? c.agencia + (c.agencia_dv ? `-${c.agencia_dv}` : "")
    : null;
  const contaLinha = c.conta
    ? c.conta + (c.conta_dv ? `-${c.conta_dv}` : "")
    : null;

  return (
    <CardBase titulo="Dados bancários" icon={Landmark}>
      {!temConta && !temPix ? (
        <p className="text-sm text-muted-foreground">
          Dados bancários não cadastrados. Procure o RH para completar.
        </p>
      ) : (
        <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <Campo rotulo="Banco" valor={bancoLinha} />
          </div>
          <Campo rotulo="Agência" valor={agenciaLinha} mono />
          <Campo rotulo="Conta" valor={contaLinha} mono />
          <Campo
            rotulo="Tipo de conta"
            valor={c.tipo_conta ? TIPO_CONTA_LABEL[c.tipo_conta] : null}
          />
          <Campo
            rotulo="Tipo da chave PIX"
            valor={c.pix_tipo ? PIX_LABEL[c.pix_tipo] : null}
          />
          <div className="md:col-span-2">
            <Campo rotulo="Chave PIX" valor={c.pix_chave} mono />
          </div>
        </div>
      )}
    </CardBase>
  );
}
