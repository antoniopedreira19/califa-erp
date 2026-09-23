"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { gerarFolha } from "./actions";

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
function competenciasOpcoes(): { chave: string; ano: number; mes: number; nome: string }[] {
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

type Resultado = {
  criadas: number;
  ja_existiam: number;
  pulados_sem_salario: string[];
  pulados_sem_alocacao: string[];
  pulados_sem_rateio: string[];
};

export function NovaFolhaModal() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [resultado, setResultado] = React.useState<Resultado | null>(null);

  const opcoes = React.useMemo(competenciasOpcoes, []);
  const defaultChave = opcoes.find((o) => o.mes === new Date().getMonth() + 1)?.chave ?? opcoes[0]!.chave;
  const [chave, setChave] = React.useState<string>(defaultChave);

  const selecionada = opcoes.find((o) => o.chave === chave) ?? opcoes[0]!;

  function handleOpenChange(next: boolean) {
    if (!next) {
      setError(null);
      setResultado(null);
      setChave(defaultChave);
    }
    setOpen(next);
  }

  function handleGerar() {
    setError(null);
    setResultado(null);
    startTransition(async () => {
      const res = await gerarFolha({
        ano: selecionada.ano,
        mes: selecionada.mes,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setResultado({
        criadas: res.criadas,
        ja_existiam: res.ja_existiam,
        pulados_sem_salario: res.pulados_sem_salario,
        pulados_sem_alocacao: res.pulados_sem_alocacao,
        pulados_sem_rateio: res.pulados_sem_rateio,
      });
      // Sem router.refresh() aqui: se o user for pra "Abrir folha", a
      // navegação já traz dados novos. Se ele fechar, o refresh acontece
      // no Fechar (função handleFechar). Assim evitamos re-SSR da lista
      // enquanto o user ainda está decidindo o próximo passo.
    });
  }

  function handleFechar() {
    handleOpenChange(false);
    // Refresh só quando o user opta por ficar na lista — assim a nova
    // competência aparece imediatamente sem trabalho de SSR desperdiçado.
    if (resultado) router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
        >
          <Plus className="h-4 w-4" />
          Nova folha
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gerar folha de pagamento</DialogTitle>
          <DialogDescription>
            Cria uma linha por colaborador ativo, copiando salário e alocações
            vigentes da data de geração. Idempotente: quem já tem folha nesta
            competência não é sobrescrito.
          </DialogDescription>
        </DialogHeader>

        {resultado ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Folha de <strong>{selecionada.nome}</strong> pronta.
                {resultado.criadas > 0 && (
                  <> {resultado.criadas} linha{resultado.criadas === 1 ? "" : "s"} nova{resultado.criadas === 1 ? "" : "s"}.</>
                )}
                {resultado.ja_existiam > 0 && (
                  <> {resultado.ja_existiam} já existia{resultado.ja_existiam === 1 ? "" : "m"}.</>
                )}
              </span>
            </div>

            {(resultado.pulados_sem_salario.length > 0 ||
              resultado.pulados_sem_alocacao.length > 0 ||
              resultado.pulados_sem_rateio.length > 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <p className="font-semibold mb-1">
                  Alguns colaboradores ficaram de fora:
                </p>
                {resultado.pulados_sem_salario.length > 0 && (
                  <p>
                    <strong>Sem salário vigente:</strong>{" "}
                    {resultado.pulados_sem_salario.join(", ")}
                  </p>
                )}
                {resultado.pulados_sem_alocacao.length > 0 && (
                  <p>
                    <strong>Sem alocação vigente:</strong>{" "}
                    {resultado.pulados_sem_alocacao.join(", ")}
                  </p>
                )}
                {resultado.pulados_sem_rateio.length > 0 && (
                  <p>
                    <strong>
                      Alocação em &quot;Todas as regionais&quot; mas empresa
                      sem rateio configurado para {selecionada.ano}:
                    </strong>{" "}
                    {resultado.pulados_sem_rateio.join(", ")}
                  </p>
                )}
                <p className="mt-1 opacity-70">
                  Complete os dados no cadastro do colaborador (ou configure
                  o rateio anual da empresa) e gere a folha de novo — quem
                  já entrou não é duplicado.
                </p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={handleFechar}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                Fechar
              </button>
              {/* <Link> em vez de router.push: Next pré-busca a rota
                  destino assim que este botão aparece (prefetch=true),
                  então o clique é quase instantâneo. Fechar o modal via
                  onClick antes da navegação evita o "modal preso" que
                  acontecia com router.push síncrono. */}
              <Link
                href={`/rh/folhas/${selecionada.chave}`}
                prefetch={true}
                onClick={() => setOpen(false)}
                className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 transition-colors"
              >
                Abrir folha
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="competencia">Competência</Label>
              <Select value={chave} onValueChange={setChave}>
                <SelectTrigger id="competencia">
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
              <p className="text-xs text-muted-foreground">
                Todo colaborador ativo em qualquer dia deste mês entra como
                rascunho. Você edita valor e alocação antes de enviar pro
                financeiro.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-california-red/20 bg-california-red/5 px-3 py-2 text-xs text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleGerar}
                disabled={pending}
                className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 disabled:opacity-50 transition-colors"
              >
                {pending ? "Gerando..." : "Gerar folha"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
