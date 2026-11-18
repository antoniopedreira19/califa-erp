"use client";

/**
 * Decisão 266 — o botão "Criar Job de Pagamentos" da aba Visualizar Jobs e
 * o pop-up que cria o job.
 *
 * O pop-up segue o "Enviar job para abertura" (enviar-job-modal.tsx): mesmo
 * DialogContent, mesma grade de três colunas, mesmos Campo/Travado, mesmo
 * rodapé. As opções (empresas com a prévia do código, regionais e projetos
 * unificados) chegam do servidor quando o pop-up abre.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Loader2, Lock, Plus, Wallet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox, COMBOBOX_COMO_SELECT } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { cn } from "@/lib/utils";
import { OBSERVACOES_MAX } from "@/lib/validations/abertura-job";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import {
  carregarOpcoesDoJobDePagamentos,
  criarJobDePagamentos,
  type OpcoesDoJobDePagamentos,
} from "./actions-job-de-pagamentos";

type Chave = "nome" | "projeto" | "empresa_id" | "regional_id" | "competencia" | "descritivo";

// Na ordem da tela.
const ROTULOS: Array<[Chave, string]> = [
  ["nome", "Nome do Job"],
  ["projeto", "Projeto unificado"],
  ["empresa_id", "Empresa"],
  ["regional_id", "Regional"],
  ["competencia", "Competência"],
  ["descritivo", "Descritivo do Job"],
];

const NOVO = "__novo__";

/** O trimestre de hoje, no fuso de Brasília, como "T-AAAA". */
function competenciaDeHoje(hojeIso: string): string {
  const [ano, mes] = hojeIso.split("-").map(Number);
  return `${Math.floor((mes - 1) / 3) + 1}-${ano}`;
}

/** O trimestre anterior, o de hoje e o seguinte. */
function competencias(hojeIso: string): Array<{ v: string; l: string }> {
  let [t, a] = competenciaDeHoje(hojeIso).split("-").map(Number);
  t -= 1;
  if (t === 0) {
    t = 4;
    a -= 1;
  }
  const out: Array<{ v: string; l: string }> = [];
  for (let i = 0; i < 3; i++) {
    out.push({ v: `${t}-${a}`, l: `${t}T ${a}` });
    t += 1;
    if (t === 5) {
      t = 1;
      a += 1;
    }
  }
  return out;
}

function dataBr(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

interface Dados {
  nome: string;
  competencia: string;
  empresaId: string;
  regionalId: string;
  projetoId: string;
  projetoNovo: string;
  descritivo: string;
}

/** O botão da aba (na linha dos chips), com o pop-up e o aviso de criado. */
export function BotaoCriarJobDePagamentos({
  onCriado,
}: {
  onCriado: (codigo: string) => void;
}) {
  const [aberto, setAberto] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-california-red px-3.5 text-[12.5px] font-semibold text-white transition-all hover:bg-california-red-hover hover:shadow-brand"
      >
        <Plus className="h-3.5 w-3.5" />
        Criar Job de Pagamentos
      </button>
      {aberto && (
        <CriarJobDePagamentosDialog
          open={aberto}
          onOpenChange={setAberto}
          onCriado={onCriado}
        />
      )}
    </>
  );
}

function CriarJobDePagamentosDialog({
  open,
  onOpenChange,
  onCriado,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCriado: (codigo: string) => void;
}) {
  const router = useRouter();
  // Só existe no navegador, depois do clique: sem risco de divergir da
  // renderização do servidor.
  const [hoje] = React.useState(hojeEmSaoPauloIso);
  const [opcoes, setOpcoes] = React.useState<OpcoesDoJobDePagamentos | null>(null);
  const [erroOpcoes, setErroOpcoes] = React.useState<string | null>(null);
  const [dados, setDados] = React.useState<Dados>(() => ({
    nome: "",
    competencia: competenciaDeHoje(hoje),
    empresaId: "",
    regionalId: "",
    projetoId: "",
    projetoNovo: "",
    descritivo: "",
  }));
  const [tentou, setTentou] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [erroGeral, setErroGeral] = React.useState<string | null>(null);
  const onChange = (p: Partial<Dados>) => setDados((d) => ({ ...d, ...p }));

  React.useEffect(() => {
    let vivo = true;
    carregarOpcoesDoJobDePagamentos().then((r) => {
      if (!vivo) return;
      if (r.ok) setOpcoes(r.opcoes);
      else setErroOpcoes(r.message);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const empresas = opcoes?.empresas ?? [];
  const regionais = (opcoes?.regionais ?? []).filter((r) => r.empresa_id === dados.empresaId);
  // Com a empresa escolhida, só os projetos dela (decisão 228); sem ela,
  // todos, agrupados por empresa: escolher um projeto já escolhe a empresa.
  const todosOsProjetos = opcoes?.projetos ?? [];
  const projetos = dados.empresaId
    ? todosOsProjetos.filter((p) => !p.empresaId || p.empresaId === dados.empresaId)
    : todosOsProjetos;
  const empresa = empresas.find((e) => e.id === dados.empresaId) ?? null;
  const codigo = empresa?.codigoPrevisto ?? null;

  const valores: Record<Chave, string> = {
    nome: dados.nome.trim(),
    projeto: dados.projetoId === NOVO ? dados.projetoNovo : dados.projetoId,
    empresa_id: dados.empresaId,
    regional_id: dados.regionalId,
    competencia: dados.competencia,
    descritivo: dados.descritivo.trim(),
  };
  const pendentes = ROTULOS.filter(([k]) => !valores[k]);
  const completo = pendentes.length === 0;
  const erroDe = (k: Chave) => (tentou && !valores[k] ? "Campo obrigatório." : null);
  const borda = (k: Chave) => erroDe(k) && "border-california-red ring-2 ring-california-red/15";

  function trocarProjeto(v: string | null) {
    const p = todosOsProjetos.find((x) => x.id === v);
    const empresaDoProjeto =
      !dados.empresaId && p?.empresaId ? { empresaId: p.empresaId, regionalId: "" } : {};
    onChange({
      projetoId: v ?? "",
      ...(v !== NOVO ? { projetoNovo: "" } : {}),
      ...empresaDoProjeto,
    });
  }

  function trocarEmpresa(id: string) {
    // Trocar a empresa limpa a regional e o projeto (decisão 228).
    onChange({ empresaId: id, regionalId: "", projetoId: "", projetoNovo: "" });
  }

  async function criar() {
    setTentou(true);
    setErroGeral(null);
    if (!completo || salvando) return;
    if (empresa && !empresa.sigla) {
      setErroGeral("A empresa ainda não tem cadastro de cliente. Avise o administrador.");
      return;
    }
    setSalvando(true);
    const [trimestre, ano] = dados.competencia.split("-").map(Number);
    const r = await criarJobDePagamentos({
      nome: dados.nome,
      projeto_financeiro_id: dados.projetoId === NOVO ? null : dados.projetoId,
      projeto_financeiro_novo: dados.projetoId === NOVO ? dados.projetoNovo : null,
      empresa_id: dados.empresaId,
      regional_id: dados.regionalId,
      competencia_trimestre: trimestre,
      competencia_ano: ano,
      descritivo: dados.descritivo,
    });
    setSalvando(false);
    if (!r.ok) {
      setErroGeral(r.message);
      return;
    }
    onOpenChange(false);
    onCriado(r.codigo);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[97vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <div className="shrink-0 border-b border-border">
          <DialogHeader className="flex-row items-start gap-4 px-6 py-5 pr-14">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-california-red/10 text-california-red">
              <Wallet className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-xl">Criar Job de Pagamentos</DialogTitle>
              <DialogDescription>
                O job nasce aberto, sem faturamento e sem responsáveis, e aparece em Jobs para a
                produção lançar os custos.
              </DialogDescription>
            </div>
          </DialogHeader>

          {(erroGeral ?? erroOpcoes) && (
            <div
              role="alert"
              className="mx-6 mb-4 flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-2.5 text-sm text-california-red"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold">O job não foi criado.</p>
                <p>{erroGeral ?? erroOpcoes}</p>
              </div>
            </div>
          )}
        </div>

        <div className="grid min-h-0 flex-1 gap-x-5 gap-y-3 overflow-y-auto px-6 py-4 md:grid-cols-3 md:content-start">
          {/* Linha 1 — o nome e o projeto unificado lado a lado, no topo
              (pedidos do Tiago, 18/11/2026), como na abertura (decisões 119
              e 228). */}
          <Campo rotulo="Nome do Job" obrigatorio erro={erroDe("nome")}>
            <Input
              value={dados.nome}
              onChange={(e) => onChange({ nome: e.target.value })}
              maxLength={200}
              className={cn(borda("nome"))}
              placeholder="Ex.: Pagamentos diversos RJ 4T 2026"
            />
          </Campo>
          <Campo
            rotulo="Projeto unificado"
            obrigatorio
            erro={erroDe("projeto")}
            apoio={
              dados.projetoId === NOVO
                ? "Projeto novo: nasce junto com o job."
                : dados.empresaId
                  ? "Os projetos da empresa. Escreva um nome novo para criar."
                  : "Escolher o projeto já escolhe a empresa. Escreva um nome novo para criar."
            }
          >
            <Combobox
              ariaLabel="Projeto unificado"
              items={[
                ...projetos.map((p) => ({
                  value: p.id,
                  label: p.nome,
                  grupo: dados.empresaId ? undefined : (p.empresaNome ?? "Sem job ainda"),
                })),
                ...(dados.projetoNovo
                  ? [{ value: NOVO, label: dados.projetoNovo, descricao: "Novo" }]
                  : []),
              ]}
              value={dados.projetoId || null}
              onChange={trocarProjeto}
              disabled={!opcoes}
              placeholder={opcoes ? "Selecione ou crie o projeto" : "Carregando…"}
              buscaPlaceholder="Buscar ou escrever um nome novo"
              acaoSemResultado={{
                rotulo: (b) => `Criar projeto “${b.trim()}”`,
                onClick: (b) => onChange({ projetoId: NOVO, projetoNovo: b.trim() }),
              }}
              className={cn(COMBOBOX_COMO_SELECT, borda("projeto"))}
            />
          </Campo>
          <Campo rotulo="Abertura" apoio="Sem fila: o job já nasce aberto.">
            <Travado valor={`Hoje, ${dataBr(hoje)}`} />
          </Campo>

          {/* Linha 2 — identificação, travada. */}
          <Campo rotulo="Código do job" apoio={codigo ? "A sigla vem da empresa." : undefined}>
            <Travado valor={codigo ?? "Escolha a empresa"} mono={Boolean(codigo)} />
          </Campo>
          <Campo rotulo="Serviço" apoio="Sem faturamento.">
            <Travado valor="Pagamentos" />
          </Campo>
          <Campo rotulo="Categoria">
            <Travado valor="Pagamentos" />
          </Campo>

          {/* Linha 3 — a empresa é o cliente do job, dá a sigla do código e
              decide os projetos unificados que aparecem. */}
          <Campo
            rotulo="Empresa"
            obrigatorio
            erro={
              erroDe("empresa_id") ??
              (empresa && !empresa.sigla
                ? "A empresa ainda não tem cadastro de cliente. Avise o administrador."
                : null)
            }
            apoio="É também o cliente do job."
          >
            <Select value={dados.empresaId} onValueChange={trocarEmpresa} disabled={!opcoes}>
              <SelectTrigger className={cn(borda("empresa_id"))}>
                <SelectValue placeholder={opcoes ? "Selecione a empresa" : "Carregando…"} />
              </SelectTrigger>
              <SelectContent>
                {empresas.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Regional" obrigatorio erro={erroDe("regional_id")}>
            <Select
              value={dados.regionalId}
              onValueChange={(v) => onChange({ regionalId: v })}
              disabled={!dados.empresaId}
            >
              <SelectTrigger className={cn(borda("regional_id"))}>
                <SelectValue
                  placeholder={dados.empresaId ? "Selecione a regional" : "Selecione a empresa primeiro"}
                />
              </SelectTrigger>
              <SelectContent>
                {regionais.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Competência" obrigatorio erro={erroDe("competencia")}>
            <Select value={dados.competencia} onValueChange={(v) => onChange({ competencia: v })}>
              <SelectTrigger className={cn(borda("competencia"))}>
                <SelectValue placeholder="Selecione o trimestre" />
              </SelectTrigger>
              <SelectContent>
                {competencias(hoje).map((c) => (
                  <SelectItem key={c.v} value={c.v}>
                    {c.l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>

          {/* Linha 4 — o descritivo, linha inteira (o motivo da abertura).
              Grava em `observacoes`, como o Descritivo do envio para abertura. */}
          <Campo
            rotulo="Descritivo do Job"
            obrigatorio
            className="md:col-span-3"
            erro={erroDe("descritivo")}
            apoio={
              dados.descritivo.length > 0 ? `${dados.descritivo.length} / ${OBSERVACOES_MAX}` : undefined
            }
          >
            <Textarea
              value={dados.descritivo}
              onChange={(e) => onChange({ descritivo: e.target.value })}
              maxLength={OBSERVACOES_MAX}
              rows={2}
              className={cn("min-h-[68px] resize-y leading-relaxed", borda("descritivo"))}
              placeholder="O motivo da abertura: para que serve o job e que custos a produção vai lançar nele..."
            />
          </Campo>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border bg-muted/30 px-6 py-3">
          {tentou && pendentes.length > 0 ? (
            <span role="alert" className="text-xs font-medium text-california-red">
              Falta preencher: {pendentes.map(([, rotulo]) => rotulo).join(", ")}.
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              Campos com <span className="text-california-red">*</span> são obrigatórios.
            </span>
          )}
          <div className="flex shrink-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={criar}
              disabled={salvando}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white transition-all",
                completo && !salvando ? "hover:bg-california-red-hover hover:shadow-brand" : "opacity-50",
              )}
            >
              {salvando ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Criando…
                </>
              ) : (
                <>
                  Criar job
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Rótulo + campo + linha de apoio (o Campo do enviar-job-modal). */
function Campo({
  rotulo,
  obrigatorio,
  erro,
  apoio,
  className,
  children,
}: {
  rotulo: string;
  obrigatorio?: boolean;
  erro?: string | null;
  apoio?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("scroll-mt-4 space-y-1.5", className)}>
      <Label>
        {rotulo}
        {obrigatorio && <span className="ml-1 text-california-red">*</span>}
      </Label>
      {children}
      {erro ? (
        <p className="text-xs text-california-red">{erro}</p>
      ) : apoio ? (
        <p className="text-xs text-muted-foreground">{apoio}</p>
      ) : null}
    </div>
  );
}

/** Campo travado (o Travado do enviar-job-modal). */
function Travado({ valor, mono }: { valor: string; mono?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-11 items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 px-3.5 text-sm font-medium text-muted-foreground",
        mono && "font-mono",
      )}
    >
      <TruncateTooltip as="span" text={valor} className="min-w-0" />
      <Lock className="h-3.5 w-3.5 shrink-0" />
    </div>
  );
}
