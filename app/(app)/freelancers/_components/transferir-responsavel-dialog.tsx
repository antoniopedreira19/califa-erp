"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  AlertCircle,
  CheckCircle2,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { transferirResponsavelFreelancer } from "../actions";

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export interface ResponsavelOption {
  id: string;
  nome: string;
}

interface Props {
  freelancerId: string;
  freelancerNome: string;
  responsavelAtualId: string | null;
  responsavelAtualNome: string | null;
  responsaveisDisponiveis: ResponsavelOption[];
}

export function TransferirResponsavelDialog({
  freelancerId,
  freelancerNome,
  responsavelAtualId,
  responsavelAtualNome,
  responsaveisDisponiveis,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [novoId, setNovoId] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const opcoes = responsaveisDisponiveis.filter(
    (g) => g.id !== responsavelAtualId,
  );
  const novoNome = opcoes.find((g) => g.id === novoId)?.nome;

  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [busca, setBusca] = React.useState("");
  const filtrados = React.useMemo(() => {
    const q = norm(busca.trim());
    if (!q) return opcoes;
    return opcoes.filter((o) => norm(o.nome).includes(q));
  }, [opcoes, busca]);

  function reset() {
    setOpen(false);
    setNovoId("");
    setErro(null);
    setDone(false);
  }

  async function handleConfirmar() {
    if (!novoId) {
      setErro("Selecione um responsável.");
      return;
    }
    setErro(null);
    setLoading(true);
    const res = await transferirResponsavelFreelancer(freelancerId, novoId);
    setLoading(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    setDone(true);
    router.refresh();
    setTimeout(() => reset(), 1600);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!loading) {
          if (v) {
            setOpen(true);
          } else {
            reset();
          }
        }
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[11px] font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-all"
        >
          <ArrowLeftRight className="h-3 w-3" />
          Transferir responsável
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transferir responsável</DialogTitle>
          <DialogDescription>
            Muda o dono da relação com {freelancerNome}. Contratos individuais
            seguem com os responsáveis próprios — essa mudança não os afeta.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center text-center gap-3 py-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-600/20">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="font-semibold text-foreground">
                Transferência concluída
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {freelancerNome} agora é de {novoNome}.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-xl bg-muted/40 border border-border/60 px-3 py-2.5 text-xs text-muted-foreground">
              <p>
                <span className="font-semibold text-foreground">
                  {freelancerNome}
                </span>{" "}
                está com{" "}
                <span className="font-semibold text-foreground">
                  {responsavelAtualNome ?? "nenhum responsável"}
                </span>
                .
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="novo-resp">Novo responsável</Label>
              <Popover
                open={pickerOpen}
                onOpenChange={(v) => {
                  if (loading) return;
                  setPickerOpen(v);
                  if (!v) setBusca("");
                }}
                modal
              >
                <PopoverTrigger asChild>
                  <button
                    id="novo-resp"
                    type="button"
                    role="combobox"
                    aria-expanded={pickerOpen}
                    disabled={loading || opcoes.length === 0}
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-white px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-left",
                        !novoNome && "text-muted-foreground",
                      )}
                    >
                      {novoNome ?? "Selecione um responsável"}
                    </span>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="bottom"
                  align="start"
                  sideOffset={4}
                  collisionPadding={16}
                  className="p-0 w-[var(--radix-popover-trigger-width)] flex flex-col overflow-hidden"
                  style={{
                    maxHeight:
                      "min(var(--radix-popover-content-available-height), 320px)",
                  }}
                >
                  <div className="border-b border-border p-2 shrink-0">
                    <Input
                      autoFocus
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      placeholder="Buscar por nome..."
                      className="h-9"
                    />
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto py-1">
                    {filtrados.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-muted-foreground">
                        Nenhum resultado.
                      </p>
                    ) : (
                      filtrados.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => {
                            setNovoId(o.id);
                            setPickerOpen(false);
                            setBusca("");
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent",
                            o.id === novoId && "bg-accent/50",
                          )}
                        >
                          <Check
                            className={cn(
                              "h-4 w-4 shrink-0",
                              o.id === novoId ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <span className="truncate">{o.nome}</span>
                        </button>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              {opcoes.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Nenhum outro responsável ativo disponível.
                </p>
              )}
            </div>

            {erro && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-3 py-2.5 text-sm text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{erro}</span>
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={reset}
                disabled={loading}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleConfirmar}
                disabled={loading || !novoId || opcoes.length === 0}
              >
                {loading ? "Transferindo..." : "Confirmar transferência"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
