"use client";

/**
 * "Novo lançamento" da aba Títulos da conciliação (decisão 195): num menu
 * só, o que hoje está espalhado por Contas a Pagar, Contas a Receber e
 * Impostos a Pagar, em três seções — "A pagar", "A receber" e "Entre
 * contas". Cada item abre o MESMO formulário de criação da tela de origem,
 * com as travas dele; o título criado aparece na planilha.
 *
 * Os cadastros que os formulários pedem são lidos quando o menu abre
 * (`carregarDadosDoNovoLancamento`), e não com a página.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight,
  Banknote,
  ChevronDown,
  HandCoins,
  Loader2,
  PiggyBank,
  Plus,
  Receipt,
  Repeat,
  Scale,
  type LucideIcon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ContaAvulsaDrawer } from "../contas-a-pagar/conta-avulsa-drawer";
import { ContaRecorrenteDrawer } from "../contas-a-pagar/conta-recorrente-drawer";
import { RecebimentoAvulsoDialog, type TipoDoRecebimentoAvulso } from "../contas-a-receber/recebimento-avulso-dialog";
import { AvulsoDialog } from "../fiscal/impostos/dialogos";
import { carregarDadosDoNovoLancamento, type DadosDoNovoLancamento } from "./actions-novo-lancamento";

type Formulario =
  | "pagamento_avulso"
  | "recorrencia"
  | "imposto_avulso"
  | "recebimento_avulso"
  | "antes_da_nf"
  | "rendimento"
  | "transferencia";

const ITENS: Array<
  | { secao: string }
  | { chave: Formulario; rotulo: string; ajuda: string; icone: LucideIcon; cor?: string }
> = [
  { secao: "A pagar" },
  {
    chave: "pagamento_avulso",
    rotulo: "Pagamento avulso",
    ajuda: "Conta a pagar sem PP: material, serviço, taxa",
    icone: Receipt,
    cor: "text-california-red",
  },
  {
    chave: "recorrencia",
    rotulo: "Recorrência a pagar",
    ajuda: "Aluguel, internet, contabilidade: vira título 30 dias antes",
    icone: Repeat,
  },
  { chave: "imposto_avulso", rotulo: "Imposto avulso", ajuda: "Guia que não passou pela apuração", icone: Scale },
  { secao: "A receber" },
  {
    chave: "recebimento_avulso",
    rotulo: "Recebimento avulso",
    ajuda: "Entrou dinheiro sem nota fiscal",
    icone: Banknote,
    cor: "text-emerald-700",
  },
  {
    chave: "antes_da_nf",
    rotulo: "Recebimento antes da NF",
    ajuda: "O cliente pagou antes de a nota sair: na aba Faturamento",
    icone: HandCoins,
    cor: "text-emerald-700",
  },
  {
    chave: "rendimento",
    rotulo: "Rendimento de aplicação",
    ajuda: "Rendimento líquido do mês",
    icone: PiggyBank,
    cor: "text-emerald-700",
  },
  { secao: "Entre contas" },
  {
    chave: "transferencia",
    rotulo: "Transferência entre contas",
    ajuda: "Dinheiro que só muda de conta: fica fora do DRE",
    icone: ArrowLeftRight,
    cor: "text-sky-700",
  },
];

const TIPO_DO_RECEBIMENTO: Partial<Record<Formulario, TipoDoRecebimentoAvulso>> = {
  recebimento_avulso: "recebimento_avulso",
  rendimento: "rendimento",
  transferencia: "transferencia",
};

export function MenuNovoLancamento({
  onCriado,
}: {
  /** O aviso da criação, e — no "Criar e dar baixa" — o título novo, para a
   *  aba abrir a baixa dele quando ele chegar do servidor. */
  onCriado: (mensagem: string, paraBaixar: { lado: "pagar" | "receber" | "imposto"; id: string } | null) => void;
}) {
  const router = useRouter();
  const [menuAberto, setMenuAberto] = React.useState(false);
  const [dados, setDados] = React.useState<DadosDoNovoLancamento | null>(null);
  const [carregando, setCarregando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const [formulario, setFormulario] = React.useState<Formulario | null>(null);

  function abrirMenu(aberto: boolean) {
    setMenuAberto(aberto);
    if (!aberto || dados || carregando) return;
    setCarregando(true);
    setErro(null);
    carregarDadosDoNovoLancamento()
      .then((r) => (r.ok ? setDados(r.dados) : setErro(r.message)))
      .catch(() => setErro("Não foi possível abrir os formulários. Tente de novo."))
      .finally(() => setCarregando(false));
  }

  function escolher(f: Formulario) {
    setMenuAberto(false);
    if (f === "antes_da_nf") {
      // O recebimento antes da NF nasce de um job na aba Faturamento de
      // Contas a Receber, onde estão o envio e o cliente.
      router.push("/financeiro/contas-a-receber");
      return;
    }
    setFormulario(f);
  }

  const fechar = () => setFormulario(null);

  return (
    <>
      <Popover open={menuAberto} onOpenChange={abrirMenu}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-california-red-hover"
          >
            <Plus className="h-4 w-4" />
            Novo lançamento
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", menuAberto && "rotate-180")} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[330px] p-1.5">
          {erro && <p className="px-3 py-2 text-xs text-california-red">{erro}</p>}
          {ITENS.map((item) =>
            "secao" in item ? (
              <p
                key={item.secao}
                className="px-3 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground first:pt-1.5"
              >
                {item.secao}
              </p>
            ) : (
              <button
                key={item.chave}
                type="button"
                disabled={item.chave !== "antes_da_nf" && !dados}
                onClick={() => escolher(item.chave)}
                className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-60"
              >
                {carregando && item.chave !== "antes_da_nf" ? (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <item.icone className={cn("mt-0.5 h-4 w-4 shrink-0", item.cor ?? "text-muted-foreground")} />
                )}
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{item.rotulo}</span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">{item.ajuda}</span>
                </span>
              </button>
            ),
          )}
        </PopoverContent>
      </Popover>

      {dados && (
        <>
          <ContaAvulsaDrawer
            mode="criar"
            open={formulario === "pagamento_avulso"}
            onOpenChange={(o) => !o && fechar()}
            tenantId={dados.tenantId}
            empresas={dados.empresas}
            tipos={dados.tipos}
            subtipos={dados.subtipos}
            fornecedores={dados.fornecedores}
            clientes={dados.clientes}
            regionais={dados.regionais}
            cartoes={dados.cartoes}
            onCriadaParaBaixa={(id) => onCriado("Lançamento criado.", { lado: "pagar", id })}
          />
          <ContaRecorrenteDrawer
            mode="criar"
            open={formulario === "recorrencia"}
            onOpenChange={(o) => !o && fechar()}
            tenantId={dados.tenantId}
            empresas={dados.empresas}
            tipos={dados.tipos}
            subtipos={dados.subtipos}
            fornecedores={dados.fornecedores}
            clientes={dados.clientes}
            regionais={dados.regionais}
            cartoes={dados.cartoes}
          />
          {formulario === "imposto_avulso" && (
            <AvulsoDialog
              dados={dados.impostos}
              onClose={fechar}
              onCriado={(id, comBaixa, mensagem) => {
                fechar();
                onCriado(mensagem, comBaixa ? { lado: "imposto", id } : null);
                router.refresh();
              }}
            />
          )}
          <RecebimentoAvulsoDialog
            open={formulario !== null && TIPO_DO_RECEBIMENTO[formulario] !== undefined}
            onOpenChange={(o) => !o && fechar()}
            tipoInicial={formulario ? TIPO_DO_RECEBIMENTO[formulario] : undefined}
            empresas={dados.empresas}
            regionais={dados.regionais}
            clientes={dados.clientes}
            fornecedores={dados.fornecedores}
            tipos={dados.tipos}
            subtipos={dados.subtipos}
            contas={dados.contas}
            rendimentosLancados={dados.rendimentosLancados}
            onCriado={(id, abrirBaixa, mensagem) => {
              fechar();
              onCriado(mensagem, abrirBaixa ? { lado: "receber", id } : null);
              router.refresh();
            }}
          />
        </>
      )}
    </>
  );
}
