"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FolderOpen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NOMES_MES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/** Opções: mês atual + 2 anteriores + 1 posterior. */
function competenciasOpcoes(): {
  chave: string;
  ano: number;
  mes: number;
  nome: string;
}[] {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth() + 1; // 1..12
  const range = [-2, -1, 0, 1];
  return range.map((delta) => {
    let a = ano;
    let m = mes + delta;
    if (m < 1) {
      m += 12;
      a -= 1;
    } else if (m > 12) {
      m -= 12;
      a += 1;
    }
    return {
      chave: `${a}-${String(m).padStart(2, "0")}`,
      ano: a,
      mes: m,
      nome: `${NOMES_MES[m - 1]} de ${a}`,
    };
  });
}

/**
 * Abre uma competência de folha. "Abrir" é só navegação — não grava nada
 * no banco. Dentro da página da competência, o operador decide o que
 * colocar na gaveta: gerar PJ e/ou importar CLT da contabilidade, em
 * qualquer ordem. Quando os dois lados existem, o botão "Enviar ao
 * financeiro" promove tudo em bloco.
 */
export function NovaFolhaModal() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const opcoes = React.useMemo(competenciasOpcoes, []);
  const defaultChave =
    opcoes.find((o) => o.mes === new Date().getMonth() + 1)?.chave ??
    opcoes[0]!.chave;
  const [chave, setChave] = React.useState<string>(defaultChave);

  const selecionada = opcoes.find((o) => o.chave === chave) ?? opcoes[0]!;

  function handleAbrir() {
    router.push(`/rh/folhas/${selecionada.chave}`);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
        >
          <FolderOpen className="h-4 w-4" />
          Abrir folha
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Abrir folha de uma competência</DialogTitle>
          <DialogDescription>
            Escolha o mês/ano. Dentro da competência, você gera o PJ e/ou
            importa a CLT da contabilidade — na ordem que preferir. Quando as
            duas estiverem prontas, envia tudo ao financeiro.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Competência</Label>
            <Select value={chave} onValueChange={setChave}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {opcoes.map((o) => (
                  <SelectItem key={o.chave} value={o.chave}>
                    {o.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleAbrir}
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 transition-colors"
            >
              Abrir {selecionada.nome}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
