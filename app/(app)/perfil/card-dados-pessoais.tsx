import { User } from "lucide-react";
import type { Colaborador } from "@/lib/types";
import { CardBase, Campo } from "./card-base";

type Props = {
  colaborador: Pick<
    Colaborador,
    | "cpf"
    | "rg"
    | "cnpj"
    | "razao_social"
    | "email"
    | "email_pessoal"
    | "telefone"
    | "data_nascimento"
    | "cep"
    | "logradouro"
    | "numero"
    | "complemento"
    | "bairro"
    | "cidade"
    | "uf"
  >;
};

function fmtData(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("pt-BR");
}

function fmtCPF(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  if (d.length !== 11) return v;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function fmtCNPJ(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  if (d.length !== 14) return v;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function fmtCEP(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  if (d.length !== 8) return v;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

function fmtTelefone(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  return v;
}

function montarEndereco(c: Props["colaborador"]): string | null {
  const partes: string[] = [];
  if (c.logradouro) {
    const linha1 =
      c.logradouro + (c.numero ? `, ${c.numero}` : "") +
      (c.complemento ? ` — ${c.complemento}` : "");
    partes.push(linha1);
  }
  const linha2Pecas: string[] = [];
  if (c.bairro) linha2Pecas.push(c.bairro);
  if (c.cidade) linha2Pecas.push(c.cidade);
  if (c.uf) linha2Pecas.push(c.uf);
  if (linha2Pecas.length > 0) partes.push(linha2Pecas.join(" · "));
  return partes.length > 0 ? partes.join(" · ") : null;
}

export function CardDadosPessoais({ colaborador: c }: Props) {
  const temPj = !!c.cnpj || !!c.razao_social;
  const temEndereco = !!c.logradouro || !!c.bairro || !!c.cep;
  const endereco = montarEndereco(c);

  return (
    <CardBase titulo="Dados pessoais" icon={User}>
      <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
        <Campo rotulo="CPF" valor={fmtCPF(c.cpf)} mono />
        <Campo rotulo="RG" valor={c.rg} />
        <Campo rotulo="Nascimento" valor={fmtData(c.data_nascimento)} />
        <Campo rotulo="Telefone" valor={fmtTelefone(c.telefone)} />
        <Campo rotulo="E-mail corporativo" valor={c.email} />
        <Campo rotulo="E-mail pessoal" valor={c.email_pessoal} />

        {temPj && (
          <>
            <div className="md:col-span-2 mt-2 border-t border-border pt-5">
              <p className="mb-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pessoa jurídica
              </p>
            </div>
            <Campo rotulo="CNPJ" valor={fmtCNPJ(c.cnpj)} mono />
            <Campo rotulo="Razão social" valor={c.razao_social} />
          </>
        )}

        {temEndereco && (
          <>
            <div className="md:col-span-2 mt-2 border-t border-border pt-5">
              <p className="mb-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Endereço
              </p>
            </div>
            <Campo rotulo="CEP" valor={fmtCEP(c.cep)} mono />
            <div className="md:col-span-2">
              <Campo rotulo="Endereço completo" valor={endereco} />
            </div>
          </>
        )}
      </div>
    </CardBase>
  );
}
