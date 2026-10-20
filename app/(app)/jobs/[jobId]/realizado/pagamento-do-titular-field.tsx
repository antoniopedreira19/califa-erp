"use client";

/**
 * O pagamento do titular da verba (decisão 193, 19/10/2026).
 *
 * Quem paga pelo cadastro não vê campo nenhum, só uma linha embaixo do
 * "Titular da verba": o colaborador com conta ou PIX na ficha do RH (decisão
 * 171) e o freela com PIX completo no cadastro de freelas. Os dois têm a
 * conta copiada para a PP pelo banco (gatilho `pp_foto_do_colaborador`), e o
 * dado nunca passa pela tela.
 *
 * Quem não tem — o freela sem PIX completo no cadastro e o colaborador sem
 * conta nem PIX na ficha — ganha o campo "Pagamento", obrigatório: PIX (tipo
 * e chave) ou conta bancária (banco, agência, conta e tipo). O desenho é o
 * do "Outro PIX / Outra conta" da decisão 127. O servidor confere de novo
 * (`pagamentoDoTitularSchema`).
 */

import * as React from "react";
import { Landmark, Zap } from "lucide-react";
import { cn, onlyDigits } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { MaskedInput } from "@/components/ui/masked-input";
import { BANCOS_FEBRABAN, getBancoByCodigo } from "@/lib/dados/bancos-febraban";
import { PIX_TIPOS, chavePixParaExibir, problemaDaChavePix } from "@/lib/pix";
import { chavePixLegivel, nomeCurtoDoBanco } from "@/lib/data/foto-pagamento-da-pp";
import type {
  PagamentoDoTitular,
  PixTipoChave,
  TipoContaBancariaFornecedor,
  TitularDaVerbaTipo,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Estado

export interface PagamentoDoTitularEstado {
  escolha: "pix" | "conta";
  pix_tipo: PixTipoChave | "";
  pix_chave: string;
  banco_codigo: string | null;
  agencia: string;
  agencia_dv: string;
  conta: string;
  conta_dv: string;
  tipo_conta: TipoContaBancariaFornecedor | "";
}

export const PAGAMENTO_DO_TITULAR_VAZIO: PagamentoDoTitularEstado = {
  escolha: "pix",
  pix_tipo: "",
  pix_chave: "",
  banco_codigo: null,
  agencia: "",
  agencia_dv: "",
  conta: "",
  conta_dv: "",
  tipo_conta: "",
};

function vazio(e: PagamentoDoTitularEstado): boolean {
  return e.escolha === "pix"
    ? !e.pix_tipo && !e.pix_chave.trim()
    : !e.banco_codigo && !e.agencia && !e.agencia_dv && !e.conta && !e.conta_dv && !e.tipo_conta;
}

/** O pagamento gravado (PP a emitir ou PP gerada) → o formulário. */
export function estadoDoPagamentoDoTitular(p: PagamentoDoTitular | null | undefined): PagamentoDoTitularEstado {
  if (!p) return PAGAMENTO_DO_TITULAR_VAZIO;
  return {
    escolha: p.meio,
    pix_tipo: p.pix_tipo ?? "",
    pix_chave: chavePixParaExibir(p.pix_tipo, p.pix_chave),
    banco_codigo: p.banco_codigo,
    agencia: p.agencia ?? "",
    agencia_dv: p.agencia_dv ?? "",
    conta: p.conta ?? "",
    conta_dv: p.conta_dv ?? "",
    tipo_conta: p.tipo_conta ?? "",
  };
}

/** O que vai para a action (o servidor normaliza). Null = nada digitado. */
export function pagamentoDoTitularParaEnvio(e: PagamentoDoTitularEstado): PagamentoDoTitular | null {
  if (vazio(e)) return null;
  if (e.escolha === "pix") {
    return {
      meio: "pix",
      pix_tipo: e.pix_tipo || null,
      pix_chave: e.pix_chave.trim() || null,
      banco_codigo: null,
      banco_nome: null,
      agencia: null,
      agencia_dv: null,
      conta: null,
      conta_dv: null,
      tipo_conta: null,
    };
  }
  return {
    meio: "conta",
    pix_tipo: null,
    pix_chave: null,
    banco_codigo: e.banco_codigo,
    banco_nome: e.banco_codigo ? (getBancoByCodigo(e.banco_codigo)?.nome ?? null) : null,
    agencia: e.agencia || null,
    agencia_dv: e.agencia_dv || null,
    conta: e.conta || null,
    conta_dv: e.conta_dv || null,
    tipo_conta: e.tipo_conta || null,
  };
}

/** O primeiro problema, com a régua do servidor. Null = pode seguir. */
export function problemaDoPagamentoDoTitular(e: PagamentoDoTitularEstado, reembolso: boolean): string | null {
  if (vazio(e)) {
    return reembolso ? "Informe o PIX ou a conta do titular do reembolso." : "Informe o PIX ou a conta do titular da verba.";
  }
  if (e.escolha === "pix") {
    if (!e.pix_tipo) return "Escolha o tipo da chave PIX do titular.";
    if (!e.pix_chave.trim()) return "Escreva a chave PIX do titular.";
    return problemaDaChavePix(e.pix_tipo, e.pix_chave);
  }
  if (!e.banco_codigo) return "Escolha o banco da conta do titular.";
  if (!/^[0-9]{3,5}$/.test(e.agencia)) return "A agência do titular tem de 3 a 5 números.";
  if (!/^[0-9]{4,12}$/.test(e.conta)) return "A conta do titular tem de 4 a 12 números.";
  if (!e.conta_dv) return "Falta o dígito da conta do titular.";
  if (!e.tipo_conta) return "Escolha o tipo da conta do titular.";
  return null;
}

const ROTULO_CONTA: Record<TipoContaBancariaFornecedor, string> = {
  corrente: "Corrente",
  poupanca: "Poupança",
  pagamento: "Pagamento",
};
const ROTULO_PIX: Record<PixTipoChave, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  telefone: "Telefone",
  aleatoria: "Aleatória",
};

/** "PIX · CPF · 111.444.777-35" ou "ITAÚ UNIBANCO · Ag. 0457 · Corrente 22334-7". */
export function resumoDoPagamentoDoTitular(p: PagamentoDoTitular): string {
  if (p.meio === "pix") {
    return `PIX · ${p.pix_tipo ? ROTULO_PIX[p.pix_tipo] : ""} · ${chavePixLegivel(p.pix_tipo, p.pix_chave)}`;
  }
  const banco = p.banco_codigo ? nomeCurtoDoBanco(p.banco_codigo, p.banco_nome) : "Conta";
  const ag = `Ag. ${p.agencia ?? ""}${p.agencia_dv ? `-${p.agencia_dv}` : ""}`;
  const conta = `${p.tipo_conta ? ROTULO_CONTA[p.tipo_conta] : "Conta"} ${p.conta ?? ""}-${p.conta_dv ?? ""}`;
  return `${banco} · ${ag} · ${conta}`;
}

/** De onde sai o pagamento de quem paga pelo cadastro — a linha embaixo do
 *  titular e o "Dados bancários" da revisão. */
export function textoDoPagamentoPeloCadastro(origem: TitularDaVerbaTipo | null | undefined): string {
  return origem === "freela" ? "PIX do cadastro de freelas" : "Conta e PIX da ficha do RH";
}

// ---------------------------------------------------------------------------
// A linha de quem paga pelo cadastro

export function PagamentoPeloCadastro({ origem }: { origem: TitularDaVerbaTipo | null }) {
  return (
    <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
      {origem === "freela"
        ? "Pagamento pelo PIX do cadastro de freelas."
        : "Pagamento pela conta e pelo PIX da ficha do RH."}
    </p>
  );
}

// ---------------------------------------------------------------------------
// O campo

const CAIXA =
  "flex h-11 w-full rounded-lg border bg-white px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 hover:border-california-red/40 focus-visible:outline-none focus-visible:border-california-red focus-visible:ring-2 focus-visible:ring-california-red/15 disabled:cursor-not-allowed disabled:opacity-50 transition-colors";

const CAIXA_COM_PREFIXO =
  "flex h-11 items-center overflow-hidden rounded-lg border bg-white transition-colors focus-within:border-california-red focus-within:ring-2 focus-within:ring-california-red/15 hover:border-california-red/40";

const BANCO_ITEMS = BANCOS_FEBRABAN.map((b) => ({ value: b.codigo, label: `${b.codigo} - ${b.nome}` }));

const PLACEHOLDER_CHAVE: Record<PixTipoChave, string> = {
  cnpj: "00.000.000/0000-00",
  cpf: "000.000.000-00",
  email: "chave@exemplo.com.br",
  telefone: "(11) 99999-9999",
  aleatoria: "Cole a chave aleatória",
};

const OPCOES: Array<{ valor: PagamentoDoTitularEstado["escolha"]; rotulo: string; Icone: typeof Zap }> = [
  { valor: "pix", rotulo: "PIX", Icone: Zap },
  { valor: "conta", rotulo: "Conta bancária", Icone: Landmark },
];

export function PagamentoDoTitularField({
  origem,
  valor,
  onChange,
  destacarFalta,
  disabled,
}: {
  /** O freela sem PIX completo no cadastro ou o colaborador sem conta no RH. */
  origem: TitularDaVerbaTipo | null;
  valor: PagamentoDoTitularEstado;
  onChange: (v: PagamentoDoTitularEstado) => void;
  /** O envio foi tentado com o campo em falta: pinta de vermelho. */
  destacarFalta: boolean;
  disabled?: boolean;
}) {
  const set = (parcial: Partial<PagamentoDoTitularEstado>) => onChange({ ...valor, ...parcial });
  const [saiuDaChave, setSaiuDaChave] = React.useState(false);
  const pixTipo = valor.pix_tipo;
  const problemaChave =
    valor.escolha === "pix" && pixTipo && valor.pix_chave && (saiuDaChave || destacarFalta)
      ? problemaDaChavePix(pixTipo, valor.pix_chave)
      : null;
  const nadaDigitado = vazio(valor);
  const borda = (falta: boolean) => (destacarFalta && falta ? "border-california-red" : "border-border");

  return (
    <div>
      <label className="block text-xs font-medium">Pagamento *</label>
      <div className="mt-1 space-y-2.5">
        <div
          role="radiogroup"
          aria-label="Como o titular recebe"
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
                <o.Icone className="h-3.5 w-3.5 flex-none" />
                {o.rotulo}
              </button>
            );
          })}
        </div>

        <p className={cn("text-[12px]", destacarFalta && nadaDigitado ? "text-california-red" : "text-muted-foreground")}>
          {origem === "freela"
            ? "O cadastro de freelas não tem um PIX completo desta pessoa."
            : "Sem conta nem PIX na ficha do RH."}
        </p>

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
                  aria-label="Tipo de chave PIX do titular"
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
                  aria-label="Chave PIX do titular"
                  placeholder="Chave PIX"
                  className={cn(CAIXA, "border-border")}
                />
              ) : pixTipo === "cpf" || pixTipo === "cnpj" || pixTipo === "telefone" ? (
                <MaskedInput
                  key={pixTipo}
                  mask={pixTipo}
                  aria-label="Chave PIX do titular"
                  defaultValue={valor.pix_chave}
                  onDigitsChange={(d) => set({ pix_chave: d })}
                  onBlur={() => setSaiuDaChave(true)}
                  disabled={disabled}
                  placeholder={PLACEHOLDER_CHAVE[pixTipo]}
                  className={cn((problemaChave || (destacarFalta && !valor.pix_chave)) && "border-california-red")}
                />
              ) : (
                <input
                  key={pixTipo}
                  aria-label="Chave PIX do titular"
                  type={pixTipo === "email" ? "email" : "text"}
                  defaultValue={valor.pix_chave}
                  onChange={(e) => set({ pix_chave: e.target.value })}
                  onBlur={() => setSaiuDaChave(true)}
                  disabled={disabled}
                  placeholder={PLACEHOLDER_CHAVE[pixTipo]}
                  spellCheck={false}
                  className={cn(
                    CAIXA,
                    problemaChave || (destacarFalta && !valor.pix_chave) ? "border-california-red" : "border-border",
                    pixTipo === "aleatoria" && "font-mono",
                  )}
                />
              )}
            </div>
            {problemaChave && <p className="mt-1 text-[11.5px] text-california-red">{problemaChave}</p>}
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
              ariaLabel="Banco da conta do titular"
              disabled={disabled}
              className={cn("h-11 px-3.5", borda(!valor.banco_codigo))}
            />
            <div className="grid grid-cols-[1fr_1.3fr_1fr] gap-2.5">
              <div className={cn(CAIXA_COM_PREFIXO, borda(!/^[0-9]{3,5}$/.test(valor.agencia)))}>
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
              <div className={cn(CAIXA_COM_PREFIXO, borda(!/^[0-9]{4,12}$/.test(valor.conta) || !valor.conta_dv))}>
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
                  aria-label="Tipo de conta do titular"
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
      </div>
    </div>
  );
}
