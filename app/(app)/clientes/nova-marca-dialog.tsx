"use client";

/** Uma marca nova para um cliente que já existe — o "+" ao lado do campo
 *  Marca do formulário de projeto (18/09/2026, decisão 089 §6).
 *
 *  Até aqui esse "+" abria a ficha COMPLETA do cliente na seção Marcas.
 *  Duas coisas estavam erradas nisso: a ficha grava por
 *  `atualizarCliente`, que é do administrador — e o GP, que é quem monta
 *  o projeto, ficava de fora —; e entregar o cadastro inteiro para
 *  acrescentar uma linha é mais tela do que o botão promete.
 *
 *  Aqui há um campo só, e a gravação é `adicionarMarcaAoCliente`, que
 *  apenas INSERE. Renomear e inativar marca continuam em `/clientes/<id>`,
 *  com o administrador.
 */

import * as React from "react";
import { Tag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { adicionarMarcaAoCliente } from "./actions";

export function NovaMarcaDialog({
  open,
  onOpenChange,
  clienteId,
  clienteNome,
  /** Quantas marcas o cliente já tem — só para dizer qual código sai. */
  marcasExistentes = 0,
  onCriada,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clienteId: string;
  clienteNome: string;
  marcasExistentes?: number;
  onCriada: (marca: { id: string; nome: string; codigo: string }) => void;
}) {
  const [nome, setNome] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [gravando, setGravando] = React.useState(false);
  const campoRef = React.useRef<HTMLInputElement>(null);

  // Reabrir com o nome anterior seria pior que um campo vazio: quem
  // reabre é porque quer outra marca.
  React.useEffect(() => {
    if (!open) return;
    setNome("");
    setErro(null);
    setGravando(false);
  }, [open]);

  const proximoCodigo = `PRD-${String(marcasExistentes + 1).padStart(2, "0")}`;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Este formulário abre DENTRO do formulário de projeto na árvore
    // React — o portal do Radix sai do DOM, não da árvore. Sem isto, o
    // projeto é submetido junto (decisão 089 §7).
    e.stopPropagation();

    const limpo = nome.trim();
    if (!limpo) {
      setErro("Informe o nome da marca.");
      campoRef.current?.focus();
      return;
    }

    setErro(null);
    setGravando(true);
    adicionarMarcaAoCliente(clienteId, limpo).then((res) => {
      if (!res.ok) {
        setErro(res.message);
        setGravando(false);
        return;
      }
      onCriada(res.marca);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="flex-row items-start gap-4 space-y-0">
          <span className="mt-0.5 hidden flex-none text-california-red sm:block">
            <Tag className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate">
              Nova marca de {clienteNome}
            </DialogTitle>
            <DialogDescription className="mt-1 text-[12.5px] leading-snug">
              Ela já fica escolhida no projeto. O que você digitou continua
              lá.
            </DialogDescription>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="nova-marca-nome"
              className="text-xs font-medium text-foreground"
            >
              Nome da marca <span className="text-california-red">*</span>
            </label>
            <Input
              id="nova-marca-nome"
              ref={campoRef}
              autoFocus
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                if (erro) setErro(null);
              }}
              maxLength={120}
              placeholder="Ex.: Guaraná Antarctica"
              disabled={gravando}
              className={cn(erro && "border-california-red")}
            />
            {erro ? (
              <p className="text-xs leading-snug text-california-red">{erro}</p>
            ) : (
              <p className="text-xs leading-snug text-muted-foreground">
                Vai entrar como {proximoCodigo}. Para renomear ou inativar
                marca, o cadastro do cliente é com o administrador.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={gravando}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={gravando || !nome.trim()}>
              {gravando ? "Criando…" : "Criar marca"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
