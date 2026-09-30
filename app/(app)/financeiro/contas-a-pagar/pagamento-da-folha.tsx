"use client";

/**
 * Pagamento do colaborador dentro do painel de aprovação da folha
 * (decisão 132): mostra a chave PIX e a conta que a remessa vai usar e
 * deixa o financeiro informar ou corrigir na hora. O que for salvo aqui
 * grava no cadastro do colaborador — é de lá que a remessa lê.
 */

import * as React from "react";
import { AlertCircle, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { chavePixParaExibir } from "@/lib/pix";
import { getBancoByCodigo } from "@/lib/dados/bancos-febraban";
import {
  descreverConta,
  descreverPix,
  temConta,
  temPix,
  type ColaboradorPagamento,
} from "@/lib/financeiro/colaboradores-pagamento";
import type { PagamentoDaFolhaInput } from "./actions-folhas";

const NENHUM = "__nenhum__";

export function pagamentoInicial(c: ColaboradorPagamento): PagamentoDaFolhaInput {
  return {
    banco_codigo: c.banco_codigo ?? "",
    banco_nome: c.banco_nome ?? "",
    agencia: c.agencia ?? "",
    agencia_dv: c.agencia_dv ?? "",
    conta: c.conta ?? "",
    conta_dv: c.conta_dv ?? "",
    tipo_conta: c.tipo_conta ?? "",
    pix_tipo: c.pix_tipo ?? "",
    pix_chave: c.pix_tipo && c.pix_chave ? chavePixParaExibir(c.pix_tipo, c.pix_chave) : "",
  };
}

/** Nome do banco pelo código, quando a pessoa não digitou. */
export function completarNomeDoBanco(p: PagamentoDaFolhaInput): PagamentoDaFolhaInput {
  const codigo = p.banco_codigo.replace(/\D/g, "");
  if (!codigo || p.banco_nome.trim()) return p;
  return { ...p, banco_nome: getBancoByCodigo(codigo.padStart(3, "0"))?.nome ?? "" };
}

function Erros({ erros, campos }: { erros: Record<string, string[]>; campos: string[] }) {
  const msgs = campos.flatMap((c) => erros[c] ?? []);
  if (msgs.length === 0) return null;
  return (
    <>
      {msgs.map((m, i) => (
        <p key={i} className="text-xs text-california-red">
          {m}
        </p>
      ))}
    </>
  );
}

export function PagamentoDaFolha({
  colaborador,
  podeEditar,
  editando,
  onEditandoChange,
  valores,
  onValoresChange,
  fieldErrors,
  salvando,
  onSalvar,
}: {
  colaborador: ColaboradorPagamento;
  podeEditar: boolean;
  editando: boolean;
  onEditandoChange: (v: boolean) => void;
  valores: PagamentoDaFolhaInput;
  onValoresChange: (v: PagamentoDaFolhaInput) => void;
  fieldErrors: Record<string, string[]>;
  salvando: boolean;
  onSalvar: () => void;
}) {
  const pix = temPix(colaborador);
  const conta = temConta(colaborador);
  const nomeBanco = valores.banco_codigo
    ? getBancoByCodigo(valores.banco_codigo.replace(/\D/g, "").padStart(3, "0"))?.nome
    : null;

  function set<K extends keyof PagamentoDaFolhaInput>(campo: K, v: string) {
    onValoresChange({ ...valores, [campo]: v });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Pagamento</p>
        {podeEditar && !editando && (
          <button
            type="button"
            onClick={() => onEditandoChange(true)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-california-red hover:bg-california-red/5"
          >
            <Pencil className="h-3 w-3" />
            {pix || conta ? "Alterar" : "Informar"}
          </button>
        )}
      </div>

      {!editando && (
        <div className="rounded-lg border border-border p-3 text-sm">
          {pix && (
            <p>
              <span className="text-muted-foreground">PIX · </span>
              {descreverPix(colaborador)}
            </p>
          )}
          {conta && (
            <p>
              <span className="text-muted-foreground">Conta · </span>
              {descreverConta(colaborador)}
            </p>
          )}
          {!pix && !conta && (
            <p className="flex items-start gap-1.5 text-california-red">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Sem chave PIX nem conta: o título não entra na remessa.
            </p>
          )}
        </div>
      )}

      {editando && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="grid gap-2 md:grid-cols-[150px_1fr]">
            <Select
              value={valores.pix_tipo || NENHUM}
              onValueChange={(v) => set("pix_tipo", v === NENHUM ? "" : v)}
            >
              <SelectTrigger aria-label="Tipo da chave PIX">
                <SelectValue placeholder="Tipo da chave" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NENHUM}>Sem chave PIX</SelectItem>
                <SelectItem value="cpf">CPF</SelectItem>
                <SelectItem value="cnpj">CNPJ</SelectItem>
                <SelectItem value="email">E-mail</SelectItem>
                <SelectItem value="telefone">Telefone</SelectItem>
                <SelectItem value="aleatoria">Aleatória</SelectItem>
              </SelectContent>
            </Select>
            <Input
              aria-label="Chave PIX"
              placeholder="Chave PIX"
              maxLength={200}
              value={valores.pix_chave}
              disabled={!valores.pix_tipo}
              onChange={(e) => set("pix_chave", e.target.value)}
            />
          </div>
          <Erros erros={fieldErrors} campos={["pix_tipo", "pix_chave"]} />

          <div className="grid grid-cols-[90px_1fr] gap-2">
            <Input
              aria-label="Código do banco"
              placeholder="Banco"
              inputMode="numeric"
              maxLength={3}
              value={valores.banco_codigo}
              onChange={(e) => set("banco_codigo", e.target.value)}
            />
            <Select
              value={valores.tipo_conta || NENHUM}
              onValueChange={(v) => set("tipo_conta", v === NENHUM ? "" : v)}
            >
              <SelectTrigger aria-label="Tipo de conta">
                <SelectValue placeholder="Tipo de conta" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NENHUM}>Sem conta</SelectItem>
                <SelectItem value="corrente">Conta corrente</SelectItem>
                <SelectItem value="poupanca">Conta poupança</SelectItem>
                <SelectItem value="pagamento">Conta de pagamento</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex gap-1">
              <Input
                aria-label="Agência"
                placeholder="Agência"
                inputMode="numeric"
                maxLength={5}
                value={valores.agencia}
                onChange={(e) => set("agencia", e.target.value)}
              />
              <Input
                aria-label="Dígito da agência"
                placeholder="DV"
                maxLength={1}
                className="w-12 shrink-0 text-center"
                value={valores.agencia_dv}
                onChange={(e) => set("agencia_dv", e.target.value)}
              />
            </div>
            <div className="flex gap-1">
              <Input
                aria-label="Conta"
                placeholder="Conta"
                inputMode="numeric"
                maxLength={12}
                value={valores.conta}
                onChange={(e) => set("conta", e.target.value)}
              />
              <Input
                aria-label="Dígito da conta"
                placeholder="DV"
                maxLength={1}
                className="w-12 shrink-0 text-center"
                value={valores.conta_dv}
                onChange={(e) => set("conta_dv", e.target.value)}
              />
            </div>
          </div>
          {nomeBanco && <p className="text-xs text-muted-foreground">{nomeBanco}</p>}
          <Erros
            erros={fieldErrors}
            campos={["banco_codigo", "agencia", "agencia_dv", "conta", "conta_dv", "tipo_conta"]}
          />

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onEditandoChange(false)}
              disabled={salvando}
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onSalvar}
              disabled={salvando}
              className="rounded-md border border-california-red/30 px-3 py-1.5 text-xs font-semibold text-california-red hover:bg-california-red/5 disabled:opacity-50"
            >
              {salvando ? "Salvando..." : "Salvar pagamento"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
