"use client";

/**
 * O campo "Pagamento" do formulário da PP (decisão 127; decisão 161, de
 * 09/10/2026).
 *
 * Um seletor só — Cadastro do fornecedor / Chave aleatória / Boleto. As
 * duas últimas são os meios que o fornecedor sem pagamento fixo manda na
 * hora de cobrar: a chave PIX aleatória temporária, que entra aqui, ou o
 * boleto, que vai nos anexos com o tipo Boleto (o envio ao financeiro o
 * exige, junto da nota). "Outra conta" e o motivo saíram: o motivo é o meio
 * que o fornecedor escolheu.
 *
 * Fornecedor marcado "Sem conta nem PIX" no cadastro: "Cadastro do
 * fornecedor" fica riscado e a PP só sai com chave aleatória ou boleto — o
 * servidor confere de novo na geração.
 *
 * Trocar o meio só vale nesta PP: o cadastro do fornecedor não muda, e o
 * PDF sai igual ao de sempre, só com a chave escolhida ou "Boleto".
 */

import * as React from "react";
import { Barcode, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { problemaDaChavePix } from "@/lib/pix";
import type { PagamentoForaDoCadastroInput } from "@/lib/validations/pagamento-fora-do-cadastro";
import type { PagamentoForaDoCadastroDaPP } from "@/lib/types";
import { resumoDoPagamentoDoFornecedor } from "./actions-pp";

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

export interface PagamentoDaPPEstado {
  /** Null = o fornecedor não tem conta nem PIX e ainda não se escolheu. */
  escolha: "cadastro" | "aleatoria" | "boleto" | null;
  pix_chave: string;
  /** O cadastro do fornecedor é "Sem conta nem PIX" (lido com o resumo). */
  semCadastro: boolean;
}

export const PAGAMENTO_PELO_CADASTRO: PagamentoDaPPEstado = {
  escolha: "cadastro",
  pix_chave: "",
  semCadastro: false,
};

/** A PP gravada → o formulário de edição, preenchido. */
export function estadoDoPagamento(
  p: PagamentoForaDoCadastroDaPP | null | undefined,
): PagamentoDaPPEstado {
  if (!p) return PAGAMENTO_PELO_CADASTRO;
  if (p.meio === "boleto") return { escolha: "boleto", pix_chave: "", semCadastro: false };
  // Só a chave aleatória continua; uma PP a emitir antiga com outro meio
  // volta para a escolha, e quem salvar decide de novo.
  if (p.meio === "pix" && p.pix_tipo === "aleatoria") {
    return { escolha: "aleatoria", pix_chave: p.pix_chave ?? "", semCadastro: false };
  }
  return PAGAMENTO_PELO_CADASTRO;
}

/** O que vai para a server action. Null = paga pelo cadastro. */
export function pagamentoParaEnvio(e: PagamentoDaPPEstado): PagamentoForaDoCadastroInput | null {
  if (e.escolha === "cadastro" || e.escolha === null) return null;
  if (e.escolha === "boleto") return { meio: "boleto" };
  return { meio: "pix", pix_tipo: "aleatoria", pix_chave: e.pix_chave.trim() };
}

/** O primeiro problema, com a mesma régua do servidor. Null = pode gerar. */
export function problemaDoPagamento(e: PagamentoDaPPEstado): string | null {
  if (e.escolha === null || (e.escolha === "cadastro" && e.semCadastro)) {
    return "Este fornecedor não tem conta nem PIX no cadastro: escolha chave aleatória ou boleto.";
  }
  if (e.escolha === "aleatoria") {
    if (!e.pix_chave.trim()) return "Cole a chave aleatória que o fornecedor mandou.";
    return problemaDaChavePix("aleatoria", e.pix_chave);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

const CAIXA =
  "flex h-11 w-full rounded-lg border bg-white px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 hover:border-california-red/40 focus-visible:outline-none focus-visible:border-california-red focus-visible:ring-2 focus-visible:ring-california-red/15 disabled:cursor-not-allowed disabled:opacity-50 transition-colors";

const OPCOES: Array<{
  valor: Exclude<PagamentoDaPPEstado["escolha"], null>;
  rotulo: string;
  Icone?: typeof Zap;
}> = [
  { valor: "cadastro", rotulo: "Cadastro do fornecedor" },
  { valor: "aleatoria", rotulo: "Chave aleatória", Icone: Zap },
  { valor: "boleto", rotulo: "Boleto", Icone: Barcode },
];

export function PagamentoDaPPField({
  fornecedorId,
  valor,
  onChange,
  destacarFalta,
  disabled,
}: {
  fornecedorId: string;
  valor: PagamentoDaPPEstado;
  onChange: (v: PagamentoDaPPEstado) => void;
  /** O envio foi tentado com o pagamento incompleto: bordas em vermelho. */
  destacarFalta: boolean;
  disabled?: boolean;
}) {
  const set = (parcial: Partial<PagamentoDaPPEstado>) => onChange({ ...valor, ...parcial });

  // O cadastro numa linha, e se ele é "Sem conta nem PIX", lidos sob demanda
  // para o fornecedor escolhido: o dado bancário de todos os fornecedores
  // não precisa vir com a página.
  const [resumo, setResumo] = React.useState<{
    id: string;
    texto: string | null;
    semCadastro: boolean;
  } | null>(null);
  React.useEffect(() => {
    if (!fornecedorId) return;
    let ativo = true;
    resumoDoPagamentoDoFornecedor(fornecedorId).then((r) => {
      if (!ativo) return;
      setResumo({
        id: fornecedorId,
        texto: r.ok ? r.resumo : null,
        semCadastro: r.ok ? r.semDadosPagamento : false,
      });
    });
    return () => {
      ativo = false;
    };
  }, [fornecedorId]);
  const resumoAtual = resumo?.id === fornecedorId ? resumo : undefined;

  // Sem conta nem PIX: o "Cadastro do fornecedor" sai da escolha e a PP
  // espera chave aleatória ou boleto. Vale também quando o formulário volta
  // ao "cadastro" com o mesmo fornecedor escolhido de novo na lista.
  React.useEffect(() => {
    if (!resumoAtual) return;
    if (
      resumoAtual.semCadastro !== valor.semCadastro ||
      (resumoAtual.semCadastro && valor.escolha === "cadastro")
    ) {
      onChange({
        ...valor,
        semCadastro: resumoAtual.semCadastro,
        escolha: resumoAtual.semCadastro && valor.escolha === "cadastro" ? null : valor.escolha,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumoAtual, valor.semCadastro, valor.escolha]);

  // O erro da chave espera a pessoa sair do campo: enquanto ela cola ou
  // digita, a chave está incompleta e não errada.
  const [saiuDaChave, setSaiuDaChave] = React.useState(false);
  const problemaChave =
    valor.escolha === "aleatoria" && valor.pix_chave && (saiuDaChave || destacarFalta)
      ? problemaDaChavePix("aleatoria", valor.pix_chave)
      : null;
  const semCadastro = valor.semCadastro;
  const faltaEscolha = destacarFalta && valor.escolha === null;

  return (
    <div>
      <label className="block text-xs font-medium">Pagamento *</label>
      <div className="mt-1 space-y-2.5">
        <div
          role="radiogroup"
          aria-label="Para onde vai o pagamento desta PP"
          className={cn(
            "flex w-full rounded-lg border bg-white p-0.5",
            faltaEscolha ? "border-california-red" : "border-border",
          )}
        >
          {OPCOES.map((o) => {
            const ativo = o.valor === valor.escolha;
            const riscado = o.valor === "cadastro" && semCadastro;
            return (
              <button
                key={o.valor}
                type="button"
                role="radio"
                aria-checked={ativo}
                disabled={disabled || riscado}
                title={riscado ? "O cadastro deste fornecedor não tem conta nem PIX." : undefined}
                onClick={() => {
                  setSaiuDaChave(false);
                  set({ escolha: o.valor });
                }}
                className={cn(
                  "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold transition-colors disabled:opacity-50",
                  ativo ? "bg-[#282828] text-white" : "text-muted-foreground hover:text-foreground",
                  riscado &&
                    "cursor-not-allowed line-through decoration-muted-foreground/50 hover:text-muted-foreground",
                )}
              >
                {o.Icone && <o.Icone className="h-3.5 w-3.5 flex-none" />}
                {o.rotulo}
              </button>
            );
          })}
        </div>

        {valor.escolha === "cadastro" && !semCadastro && (
          <p className="text-[12px] text-muted-foreground">
            {resumoAtual === undefined
              ? "Lendo o cadastro…"
              : (resumoAtual.texto ?? "O cadastro deste fornecedor não tem conta nem chave PIX.")}
          </p>
        )}

        {semCadastro && (valor.escolha === null || valor.escolha === "cadastro") && (
          <p className={cn("text-[12px]", faltaEscolha ? "text-california-red" : "text-muted-foreground")}>
            Sem conta nem PIX no cadastro: escolha chave aleatória ou boleto.
          </p>
        )}

        {valor.escolha === "aleatoria" && (
          <div>
            <input
              aria-label="Chave aleatória desta PP"
              value={valor.pix_chave}
              onChange={(e) => set({ pix_chave: e.target.value })}
              onBlur={() => setSaiuDaChave(true)}
              disabled={disabled}
              placeholder="Cole a chave aleatória que o fornecedor mandou"
              spellCheck={false}
              className={cn(
                CAIXA,
                "font-mono",
                problemaChave || (destacarFalta && !valor.pix_chave)
                  ? "border-california-red"
                  : "border-border",
              )}
            />
            {problemaChave && (
              <p className="mt-1 text-[11.5px] text-california-red">{problemaChave}</p>
            )}
          </div>
        )}

        {valor.escolha === "boleto" && (
          <p className="text-[12px] text-muted-foreground">
            Anexe o boleto abaixo, com o tipo{" "}
            <strong className="font-semibold text-foreground">Boleto</strong>.
          </p>
        )}
      </div>
    </div>
  );
}
