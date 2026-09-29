"use client";

/**
 * O campo "Pagamento" do formulário da PP (decisão 127, 29/09/2026).
 *
 * Um seletor só — Cadastro do fornecedor / Outro PIX / Outra conta —, a
 * variante A aprovada pelo Tiago. No caso comum ele ocupa duas linhas: o
 * seletor e o cadastro em uma linha. "Outro" abre os campos do meio e o
 * motivo, sem texto de apoio permanente: o que o campo pede está no
 * placeholder, e o erro só aparece quando existe (o texto a mais cansava a
 * produção, que preenche PP o dia todo).
 *
 * Trocar o meio só vale nesta PP: o cadastro do fornecedor não muda, e o
 * PDF sai igual ao de sempre, só com a chave ou a conta escolhida.
 */

import * as React from "react";
import { Landmark, Zap } from "lucide-react";
import { cn, onlyDigits } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { MaskedInput } from "@/components/ui/masked-input";
import { BANCOS_FEBRABAN } from "@/lib/dados/bancos-febraban";
import { PIX_TIPOS, chavePixParaExibir, problemaDaChavePix } from "@/lib/pix";
import {
  pagamentoForaDoCadastroSchema,
  type PagamentoForaDoCadastroInput,
} from "@/lib/validations/pagamento-fora-do-cadastro";
import type {
  PagamentoForaDoCadastroDaPP,
  PixTipoChave,
  TipoContaBancariaFornecedor,
} from "@/lib/types";
import { resumoDoPagamentoDoFornecedor } from "./actions-pp";

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

export interface PagamentoDaPPEstado {
  escolha: "cadastro" | "pix" | "conta";
  pix_tipo: PixTipoChave | "";
  pix_chave: string;
  banco_codigo: string | null;
  agencia: string;
  agencia_dv: string;
  conta: string;
  conta_dv: string;
  tipo_conta: TipoContaBancariaFornecedor | "";
  motivo: string;
}

export const PAGAMENTO_PELO_CADASTRO: PagamentoDaPPEstado = {
  escolha: "cadastro",
  pix_tipo: "",
  pix_chave: "",
  banco_codigo: null,
  agencia: "",
  agencia_dv: "",
  conta: "",
  conta_dv: "",
  tipo_conta: "",
  motivo: "",
};

/** A PP gravada → o formulário de edição, preenchido. */
export function estadoDoPagamento(
  p: PagamentoForaDoCadastroDaPP | null | undefined,
): PagamentoDaPPEstado {
  if (!p) return PAGAMENTO_PELO_CADASTRO;
  return {
    escolha: p.meio,
    pix_tipo: p.pix_tipo ?? "",
    // O telefone é gravado com +55; a máscara do campo é de número
    // brasileiro, sem o país.
    pix_chave: chavePixParaExibir(p.pix_tipo, p.pix_chave),
    banco_codigo: p.banco_codigo,
    agencia: p.agencia ?? "",
    agencia_dv: p.agencia_dv ?? "",
    conta: p.conta ?? "",
    conta_dv: p.conta_dv ?? "",
    tipo_conta: p.tipo_conta ?? "",
    motivo: p.motivo,
  };
}

/** O que vai para a server action. Null = paga pelo cadastro. */
export function pagamentoParaEnvio(e: PagamentoDaPPEstado): PagamentoForaDoCadastroInput | null {
  if (e.escolha === "cadastro") return null;
  return {
    meio: e.escolha,
    motivo: e.motivo,
    pix_tipo: e.escolha === "pix" && e.pix_tipo ? e.pix_tipo : null,
    pix_chave: e.escolha === "pix" ? e.pix_chave : null,
    banco_codigo: e.escolha === "conta" ? e.banco_codigo : null,
    agencia: e.escolha === "conta" ? e.agencia : null,
    agencia_dv: e.escolha === "conta" ? e.agencia_dv : null,
    conta: e.escolha === "conta" ? e.conta : null,
    conta_dv: e.escolha === "conta" ? e.conta_dv : null,
    tipo_conta: e.escolha === "conta" && e.tipo_conta ? e.tipo_conta : null,
  };
}

/** O primeiro problema, com a mesma régua do servidor. Null = pode gerar. */
export function problemaDoPagamento(e: PagamentoDaPPEstado): string | null {
  const envio = pagamentoParaEnvio(e);
  if (!envio) return null;
  const r = pagamentoForaDoCadastroSchema.safeParse(envio);
  return r.success ? null : (r.error.issues[0]?.message ?? "Confira o pagamento desta PP.");
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

const CAIXA =
  "flex h-11 w-full rounded-lg border bg-white px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 hover:border-california-red/40 focus-visible:outline-none focus-visible:border-california-red focus-visible:ring-2 focus-visible:ring-california-red/15 disabled:cursor-not-allowed disabled:opacity-50 transition-colors";

const CAIXA_COM_PREFIXO =
  "flex h-11 items-center overflow-hidden rounded-lg border bg-white transition-colors focus-within:border-california-red focus-within:ring-2 focus-within:ring-california-red/15 hover:border-california-red/40";

const BANCO_ITEMS = BANCOS_FEBRABAN.map((b) => ({
  value: b.codigo,
  label: `${b.codigo} - ${b.nome}`,
}));

const PLACEHOLDER_CHAVE: Record<PixTipoChave, string> = {
  cnpj: "00.000.000/0000-00",
  cpf: "000.000.000-00",
  email: "chave@fornecedor.com.br",
  telefone: "(11) 99999-9999",
  aleatoria: "Cole a chave aleatória",
};

const OPCOES: Array<{ valor: PagamentoDaPPEstado["escolha"]; rotulo: string; Icone?: typeof Zap }> = [
  { valor: "cadastro", rotulo: "Cadastro do fornecedor" },
  { valor: "pix", rotulo: "Outro PIX", Icone: Zap },
  { valor: "conta", rotulo: "Outra conta", Icone: Landmark },
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

  // O cadastro numa linha, lido sob demanda para o fornecedor escolhido: o
  // dado bancário de todos os fornecedores não precisa vir com a página.
  const [resumo, setResumo] = React.useState<{ id: string; texto: string | null } | null>(null);
  React.useEffect(() => {
    if (!fornecedorId) return;
    let ativo = true;
    resumoDoPagamentoDoFornecedor(fornecedorId).then((r) => {
      if (ativo) setResumo({ id: fornecedorId, texto: r.ok ? r.resumo : null });
    });
    return () => {
      ativo = false;
    };
  }, [fornecedorId]);
  const resumoAtual = resumo?.id === fornecedorId ? resumo.texto : undefined;

  // O erro da chave espera a pessoa sair do campo: enquanto ela cola ou
  // digita, a chave está incompleta e não errada.
  const [saiuDaChave, setSaiuDaChave] = React.useState(false);
  const pixTipo = valor.pix_tipo;
  const problemaChave =
    valor.escolha === "pix" && pixTipo && valor.pix_chave && (saiuDaChave || destacarFalta)
      ? problemaDaChavePix(pixTipo, valor.pix_chave)
      : null;
  const borda = (falta: boolean) => (falta ? "border-california-red" : "border-border");
  const motivoCurto = valor.motivo.trim().length < 10;

  return (
    <div>
      <label className="block text-xs font-medium">Pagamento *</label>
      <div className="mt-1 space-y-2.5">
        <div
          role="radiogroup"
          aria-label="Para onde vai o pagamento desta PP"
          className="flex w-full rounded-lg border border-border bg-white p-0.5"
        >
          {OPCOES.map((o) => {
            const ativo = o.valor === valor.escolha;
            return (
              <button
                key={o.valor}
                type="button"
                role="radio"
                aria-checked={ativo}
                disabled={disabled}
                onClick={() => {
                  setSaiuDaChave(false);
                  set({ escolha: o.valor });
                }}
                className={cn(
                  "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold transition-colors disabled:opacity-50",
                  ativo ? "bg-[#282828] text-white" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {o.Icone && <o.Icone className="h-3.5 w-3.5 flex-none" />}
                {o.rotulo}
              </button>
            );
          })}
        </div>

        {valor.escolha === "cadastro" && (
          <p className="text-[12px] text-muted-foreground">
            {resumoAtual === undefined
              ? "Lendo o cadastro…"
              : (resumoAtual ?? "O cadastro deste fornecedor não tem conta nem chave PIX.")}
          </p>
        )}

        {valor.escolha === "pix" && (
          <div>
            <div className="grid grid-cols-[170px_1fr] gap-2.5">
              <Select
                value={pixTipo || undefined}
                disabled={disabled}
                onValueChange={(v) => {
                  setSaiuDaChave(false);
                  set({ pix_tipo: v as PixTipoChave, pix_chave: "" });
                }}
              >
                <SelectTrigger
                  aria-label="Tipo de chave PIX desta PP"
                  className={cn(destacarFalta && !pixTipo && "border-california-red")}
                >
                  <SelectValue placeholder="Tipo de chave" />
                </SelectTrigger>
                <SelectContent>
                  {PIX_TIPOS.map((t) => (
                    <SelectItem key={t.valor} value={t.valor}>
                      {t.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!pixTipo ? (
                <input
                  disabled
                  aria-label="Chave PIX desta PP"
                  placeholder="Chave PIX"
                  className={cn(CAIXA, "border-border")}
                />
              ) : pixTipo === "cpf" || pixTipo === "cnpj" || pixTipo === "telefone" ? (
                <MaskedInput
                  key={pixTipo}
                  mask={pixTipo}
                  aria-label="Chave PIX desta PP"
                  defaultValue={valor.pix_chave}
                  onDigitsChange={(d) => set({ pix_chave: d })}
                  onBlur={() => setSaiuDaChave(true)}
                  disabled={disabled}
                  placeholder={PLACEHOLDER_CHAVE[pixTipo]}
                  className={cn(
                    (problemaChave || (destacarFalta && !valor.pix_chave)) && "border-california-red",
                  )}
                />
              ) : (
                <input
                  key={pixTipo}
                  aria-label="Chave PIX desta PP"
                  type={pixTipo === "email" ? "email" : "text"}
                  defaultValue={valor.pix_chave}
                  onChange={(e) => set({ pix_chave: e.target.value })}
                  onBlur={() => setSaiuDaChave(true)}
                  disabled={disabled}
                  placeholder={PLACEHOLDER_CHAVE[pixTipo]}
                  spellCheck={false}
                  className={cn(
                    CAIXA,
                    borda(!!problemaChave || (destacarFalta && !valor.pix_chave)),
                    pixTipo === "aleatoria" && "font-mono",
                  )}
                />
              )}
            </div>
            {problemaChave && (
              <p className="mt-1 text-[11.5px] text-california-red">{problemaChave}</p>
            )}
          </div>
        )}

        {valor.escolha === "conta" && (
          <div className="space-y-2.5">
            <Combobox
              items={BANCO_ITEMS}
              value={valor.banco_codigo}
              onChange={(v) => set({ banco_codigo: v })}
              placeholder="Banco"
              buscaPlaceholder="Escreva o nome ou o código"
              ariaLabel="Banco da conta desta PP"
              disabled={disabled}
              className={cn("h-11 px-3.5", borda(destacarFalta && !valor.banco_codigo))}
            />
            <div className="grid grid-cols-[1fr_1.3fr_1fr] gap-2.5">
              <div className={cn(CAIXA_COM_PREFIXO, borda(destacarFalta && !/^[0-9]{3,5}$/.test(valor.agencia)))}>
                <span className="pl-3.5 text-[12px] text-muted-foreground">Ag.</span>
                <input
                  inputMode="numeric"
                  maxLength={5}
                  value={valor.agencia}
                  disabled={disabled}
                  onChange={(e) => set({ agencia: onlyDigits(e.target.value) })}
                  aria-label="Agência"
                  className="h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-sm tabular-nums outline-none"
                />
                <span className="text-sm text-muted-foreground/40">/</span>
                <input
                  maxLength={1}
                  value={valor.agencia_dv}
                  disabled={disabled}
                  onChange={(e) => set({ agencia_dv: e.target.value.toUpperCase() })}
                  aria-label="Dígito da agência"
                  className="h-full w-8 border-0 bg-transparent px-1 text-center text-sm outline-none"
                />
              </div>
              <div
                className={cn(
                  CAIXA_COM_PREFIXO,
                  borda(destacarFalta && (!/^[0-9]{4,12}$/.test(valor.conta) || !valor.conta_dv)),
                )}
              >
                <span className="pl-3.5 text-[12px] text-muted-foreground">Conta</span>
                <input
                  inputMode="numeric"
                  maxLength={12}
                  value={valor.conta}
                  disabled={disabled}
                  onChange={(e) => set({ conta: onlyDigits(e.target.value) })}
                  aria-label="Conta"
                  className="h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-sm tabular-nums outline-none"
                />
                <span className="text-sm text-muted-foreground/40">/</span>
                <input
                  maxLength={1}
                  value={valor.conta_dv}
                  disabled={disabled}
                  onChange={(e) => set({ conta_dv: e.target.value.toUpperCase() })}
                  aria-label="Dígito da conta"
                  className="h-full w-8 border-0 bg-transparent px-1 text-center text-sm outline-none"
                />
              </div>
              <Select
                value={valor.tipo_conta || undefined}
                disabled={disabled}
                onValueChange={(v) => set({ tipo_conta: v as TipoContaBancariaFornecedor })}
              >
                <SelectTrigger
                  aria-label="Tipo de conta desta PP"
                  className={cn(destacarFalta && !valor.tipo_conta && "border-california-red")}
                >
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="corrente">Corrente</SelectItem>
                  <SelectItem value="poupanca">Poupança</SelectItem>
                  <SelectItem value="pagamento">Pagamento</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {valor.escolha !== "cadastro" && (
          <div className={cn(CAIXA_COM_PREFIXO, borda(destacarFalta && motivoCurto))}>
            <span className="pl-3.5 text-[12px] text-muted-foreground">Motivo</span>
            <input
              value={valor.motivo}
              disabled={disabled}
              onChange={(e) => set({ motivo: e.target.value })}
              maxLength={300}
              aria-label="Motivo do pagamento fora do cadastro"
              placeholder="ex.: chave temporária do fornecedor"
              className="h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground/60"
            />
          </div>
        )}
      </div>
    </div>
  );
}
