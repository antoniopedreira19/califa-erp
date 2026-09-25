"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Lock } from "lucide-react";
import { format } from "date-fns";
import { OBSERVACOES_MAX } from "@/lib/validations/abertura-job";
import {
  ORCAMENTO_STATUS_EDITAVEIS,
  orcamentoStatusLabel,
  type CategoriaDominio,
  type CategoriaModeloPlanilha,
  type Orcamento,
  type OrcamentoStatus,
  type Profile,
  type Regional,
} from "@/lib/types";
import { orcamentoSchema } from "@/lib/validations/orcamentos";
import {
  categoriasDoServico,
  servicoTemCategoriaExclusiva,
  type CategoriaParaServico,
} from "@/lib/categorias-do-servico";
import { erroDoPeriodoMensal } from "@/lib/calculos/meses-trimestre";
import { CidadeCombobox, type CidadeOption } from "../cidade-combobox";
import {
  atualizarOrcamento,
  criarOrcamento,
  type ActionResult,
} from "./actions";

/** Os campos do orçamento sem nada de banco — o que o editor de orçamento
 *  do projeto guarda no rascunho até o "Salvar orçamentos". */
export interface DadosOrcamento {
  nome: string;
  categoria_id: string;
  servico_id: string;
  descritivo: string | null;
  regional_id: string;
  cidade_id: string;
  /** Nome da cidade escolhida. Vai junto porque quem consome o rascunho
   *  não tem mais a lista completa para resolver o id — o combobox busca
   *  no servidor e só ele conhece o par. */
  cidade_nome: string;
  gp_responsavel_id: string;
  produtor_id: string;
  data_inicio_prevista: string | null;
  data_fim_prevista: string | null;
}

interface Props {
  projetoId: string;
  orcamento?: Orcamento;
  /** Categorias de escopo `orcamento`, com o modelo de planilha e o
   *  serviço exclusivo (decisão 078): é por eles que o formulário sabe
   *  travar a categoria do Fee e do Always On. */
  categorias: CategoriaParaServico[];
  /** Opções de Serviço — `categorias_dominio` de escopo `projeto`. Lista
   *  diferente das categorias acima; o campo desceu do projeto em
   *  02/09/2026. */
  servicos: Pick<CategoriaDominio, "id" | "nome" | "investimento_interno">[];
  /** Modelo de planilha que o orçamento em edição usa HOJE. Vem de fora
   *  porque a categoria atual pode estar inativa e fora da lista acima —
   *  e é comparando com ele que o formulário pede a confirmação da troca
   *  de planilha. Ausente na criação. */
  modeloPlanilhaAtual?: CategoriaModeloPlanilha;
  /** Nome e código do projeto de origem. O campo aparece travado no
   *  formulário: quem chegou aqui já escolheu o projeto. */
  projetoNome?: string;
  projetoCodigo?: string;
  /** Só as regionais cadastradas no projeto — a peça não sai da praça
   *  que a iniciativa cobre. */
  regionaisDoProjeto: Pick<Regional, "id" | "nome">[];
  /** Primeiras cidades do cadastro, só para o combobox não abrir vazio —
   *  o resto é buscado no servidor a cada digitação. */
  cidadesIniciais: CidadeOption[];
  /** Cidade já gravada no orçamento, com o nome resolvido no servidor.
   *  Sem ela o combobox abriria sem rótulo em edição. */
  cidadeAtual?: CidadeOption | null;
  /** GP responsável sai dos responsáveis do projeto. */
  gpsDoProjeto: Pick<Profile, "id" | "nome">[];
  /** Produtor sai de todos os membros ativos — o time de produção ainda
   *  não está modelado como papel próprio. */
  produtores: Pick<Profile, "id" | "nome">[];
  onSuccess?: () => void;
  onCancel?: () => void;
  /** Presente ⇒ o formulário não grava nada: valida com o mesmo schema e
   *  devolve os campos para quem chamou. É assim que o editor de orçamento
   *  do projeto usa este formulário sem tocar no banco. */
  onRascunho?: (dados: DadosOrcamento) => void;
  /** Rótulo do botão de envio. O padrão serve à tela de sempre. */
  rotuloSubmit?: string;
}

/** Qual confirmação a troca de categoria pede, se pedir. */
type TrocaDePlanilha = "entra_no_mensal" | "sai_do_mensal" | null;

/** O que a confirmação precisa dizer: a troca de planilha, a passagem para
 *  o serviço Interno (decisão 105), ou as duas juntas. */
interface Confirmacao {
  planilha: TrocaDePlanilha;
  entraNoInterno: boolean;
}

export function OrcamentoForm({
  projetoId,
  orcamento,
  categorias,
  servicos,
  modeloPlanilhaAtual,
  projetoNome,
  projetoCodigo,
  regionaisDoProjeto,
  cidadesIniciais,
  cidadeAtual,
  gpsDoProjeto,
  produtores,
  onSuccess,
  onCancel,
  onRascunho,
  rotuloSubmit,
}: Props) {
  const router = useRouter();
  const isEdit = Boolean(orcamento);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [status, setStatus] = React.useState<OrcamentoStatus>(
    orcamento?.status && ORCAMENTO_STATUS_EDITAVEIS.includes(orcamento.status)
      ? orcamento.status
      : "rascunho",
  );
  // Categoria é obrigatória desde 17/08/2026: sem opção "Sem categoria",
  // estado inicial vazio mostra o placeholder e o Zod cobra a escolha.
  const [categoriaId, setCategoriaId] = React.useState(
    orcamento?.categoria_id ?? "",
  );
  const [servicoId, setServicoId] = React.useState(orcamento?.servico_id ?? "");
  const [descritivo, setDescritivo] = React.useState(
    orcamento?.descritivo ?? "",
  );
  const [regionalId, setRegionalId] = React.useState(orcamento?.regional_id ?? "");
  const [cidade, setCidade] = React.useState<CidadeOption | null>(
    cidadeAtual ?? null,
  );
  const [gpId, setGpId] = React.useState(orcamento?.gp_responsavel_id ?? "");
  const [produtorId, setProdutorId] = React.useState(orcamento?.produtor_id ?? "");
  // O período entra em estado só para a conferência do modelo mensal: o
  // DatePicker continua mandando o valor pelo campo escondido de sempre.
  const [inicio, setInicio] = React.useState(orcamento?.data_inicio_prevista ?? "");
  const [fim, setFim] = React.useState(orcamento?.data_fim_prevista ?? "");

  // Confirmação da troca de planilha — o FormData espera aqui até o "Sim".
  const [confirmacao, setConfirmacao] = React.useState<Confirmacao | null>(null);
  const troca = confirmacao?.planilha ?? null;
  const formPendente = React.useRef<FormData | null>(null);

  // O par serviço × categoria que o orçamento JÁ tinha fica como está
  // (decisão do Tiago, 14/09/2026): os orçamentos antigos com serviço Fee e
  // categoria nacional não são forçados a trocar só porque alguém abriu o
  // editor. A trava vale para orçamento novo e para quem muda o serviço.
  const parOriginal =
    isEdit &&
    servicoId === orcamento!.servico_id &&
    categoriaId === orcamento!.categoria_id;

  // O par original só destrava quando é um par antigo (serviço Fee com
  // categoria nacional). Se o orçamento já está na categoria exclusiva do
  // serviço, a edição mostra a mesma trava da criação.
  const servicoEscolhido = servicos.find((s) => s.id === servicoId);
  const categoriaTravada =
    servicoTemCategoriaExclusiva(servicoEscolhido, categorias) &&
    (!parOriginal ||
      categorias.find((c) => c.id === categoriaId)?.servico_exclusivo_id ===
        servicoId);
  const opcoesDeCategoria = React.useMemo(() => {
    const permitidas = categoriasDoServico(servicoEscolhido, categorias);
    if (parOriginal && !permitidas.some((c) => c.id === categoriaId)) {
      const atual = categorias.find((c) => c.id === categoriaId);
      return atual ? [...permitidas, atual] : permitidas;
    }
    return permitidas;
  }, [servicoEscolhido, categorias, parOriginal, categoriaId]);

  const categoriaEscolhida = categorias.find((c) => c.id === categoriaId);
  // Decisão 105: o serviço Interno só aceita custo F · Interno, com o
  // planejado igual ao orçado. Quem passa um orçamento já preenchido para
  // ele confirma a conversão das linhas.
  const ehInterno = servicoEscolhido?.investimento_interno === true;
  const eraInterno =
    isEdit &&
    servicos.find((s) => s.id === orcamento!.servico_id)?.investimento_interno ===
      true;
  const modeloEscolhido: CategoriaModeloPlanilha =
    categoriaEscolhida?.modelo_planilha ??
    (parOriginal ? (modeloPlanilhaAtual ?? "nacional") : "nacional");
  const ehMensal = modeloEscolhido === "mensal";

  function handleServico(novo: string) {
    setServicoId(novo);
    // Voltou ao serviço original: a categoria original volta junto.
    if (isEdit && novo === orcamento!.servico_id) {
      setCategoriaId(orcamento!.categoria_id ?? "");
      return;
    }
    const servicoNovo = servicos.find((s) => s.id === novo);
    const permitidas = categoriasDoServico(servicoNovo, categorias);
    if (servicoTemCategoriaExclusiva(servicoNovo, categorias)) {
      // Serviço com categoria própria: com uma só, ela entra sozinha e o
      // campo trava. (Com mais de uma, o Select mostra só as dele.)
      setCategoriaId(permitidas.length === 1 ? permitidas[0].id : "");
      return;
    }
    if (!permitidas.some((c) => c.id === categoriaId)) setCategoriaId("");
  }

  /** Realce do campo com erro. Os Selects não usam `required`: o Radix
   *  monta um <select> nativo escondido e o navegador barraria o envio
   *  com tooltip em inglês, antes das mensagens do Zod chegarem à tela. */
  const erroClasses = (name: string) =>
    fieldErrors[name]?.length
      ? "border-california-red ring-2 ring-california-red/15"
      : "";

  function enviar(formData: FormData) {
    startTransition(async () => {
      // Criar redireciona no SERVIDOR e o cliente recebe `undefined`; só
      // editar volta um resultado. Testar `res.ok` direto quebra a tela.
      const res: ActionResult | void = isEdit
        ? await atualizarOrcamento(projetoId, orcamento!.id, formData)
        : await criarOrcamento(projetoId, formData);

      if (res && !res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      if (isEdit) {
        router.refresh();
        onSuccess?.();
      }
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const formData = new FormData(e.currentTarget);
    if (isEdit) formData.set("status", status);
    formData.set("categoria_id", categoriaId);
    formData.set("servico_id", servicoId);
    formData.set("regional_id", regionalId);
    formData.set("cidade_id", cidade?.id ?? "");
    formData.set("gp_responsavel_id", gpId);
    formData.set("produtor_id", produtorId);

    // Fee e Always On: o período é obrigatório e cabe num trimestre, porque
    // é dele que os meses nascem (decisão 078). O servidor confere de novo.
    if (ehMensal) {
      const erroPeriodo = erroDoPeriodoMensal(
        formData.get("data_inicio_prevista")?.toString() || null,
        formData.get("data_fim_prevista")?.toString() || null,
      );
      if (erroPeriodo) {
        setError("Verifique os campos destacados.");
        setFieldErrors({ data_fim_prevista: [erroPeriodo] });
        return;
      }
    }

    // Modo rascunho: a mesma validação, sem ida ao servidor. O que sai
    // daqui entra na lista do editor e só vira registro no salvamento.
    if (onRascunho) {
      const parsed = orcamentoSchema.safeParse({
        codigo: "",
        nome: formData.get("nome")?.toString() ?? "",
        status: "rascunho",
        categoria_id: formData.get("categoria_id")?.toString() ?? "",
        servico_id: servicoId,
        descritivo: descritivo,
        regional_id: regionalId,
        cidade_id: cidade?.id ?? "",
        gp_responsavel_id: gpId,
        produtor_id: produtorId,
        data_inicio_prevista:
          formData.get("data_inicio_prevista")?.toString() ?? "",
        data_fim_prevista: formData.get("data_fim_prevista")?.toString() ?? "",
      });
      if (!parsed.success) {
        setError("Verifique os campos destacados.");
        setFieldErrors(parsed.error.flatten().fieldErrors);
        return;
      }
      const { codigo: _semCodigo, status: _semStatus, ...dados } = parsed.data;
      onRascunho({ ...dados, cidade_nome: cidade?.nome ?? "" });
      return;
    }

    // Trocar de/para Fee ou Always On muda a estrutura da planilha — pede
    // confirmação antes de gravar (decisão do Tiago, 14/09/2026). Passar
    // para o Interno converte as linhas (decisão 105) — também pede, e as
    // duas perguntas viram uma só quando acontecem juntas.
    if (isEdit && categoriaEscolhida) {
      const eraMensal = modeloPlanilhaAtual === "mensal";
      const planilha: TrocaDePlanilha =
        eraMensal === ehMensal
          ? null
          : ehMensal
            ? "entra_no_mensal"
            : "sai_do_mensal";
      const entraNoInterno = ehInterno && !eraInterno;
      if (planilha || entraNoInterno) {
        if (planilha) formData.set("confirmar_troca_modelo", "1");
        if (entraNoInterno) formData.set("confirmar_entrada_interno", "1");
        formPendente.current = formData;
        setConfirmacao({ planilha, entraNoInterno });
        return;
      }
    }

    enviar(formData);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nome do Job" name="nome" required errors={fieldErrors}>
          <Input
            name="nome"
            defaultValue={orcamento?.nome ?? ""}
            required
            autoFocus
            placeholder="Ex.: Bebedouros SP"
          />
        </Field>

        {isEdit && (
          <Field label="Código" name="codigo" errors={fieldErrors}>
            <Input
              name="codigo"
              defaultValue={orcamento?.codigo ?? ""}
              placeholder="Auto-gerado"
            />
          </Field>
        )}

        {/* Projeto — pré-preenchido e travado. Quem chegou aqui veio de
            dentro do projeto; repetir a escolha só abriria espaço para
            criar o orçamento no lugar errado. Mesmo cinza dos campos
            travados do envio para abertura. */}
        {!isEdit && projetoNome && (
          <Field label="Projeto" name="projeto_id" errors={fieldErrors}>
            <div className="flex h-10 items-center justify-between gap-2 rounded-md border border-border bg-muted/50 px-3 text-sm font-medium text-muted-foreground">
              <span className="truncate">
                {projetoNome}
                {projetoCodigo ? (
                  <span className="ml-1.5 font-mono text-xs">
                    {projetoCodigo}
                  </span>
                ) : null}
              </span>
              <Lock className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
            </div>
            <p className="text-xs text-muted-foreground">
              Pré-preenchido pelo projeto de origem. Não editável.
            </p>
          </Field>
        )}

        {/* Serviço vem imediatamente antes de Categoria, os dois na mesma
            linha. Desceu do projeto em 02/09/2026: descreve o trabalho
            deste job, não a iniciativa inteira do cliente. A lista é a de
            escopo `projeto`, diferente da Categoria ao lado. */}
        <Field label="Serviço" name="servico_id" required errors={fieldErrors}>
          <Select value={servicoId} onValueChange={handleServico}>
            <SelectTrigger className={erroClasses("servico_id")}>
              <SelectValue placeholder="Selecione um serviço" />
            </SelectTrigger>
            <SelectContent>
              {servicos.map((sv) => (
                <SelectItem key={sv.id} value={sv.id}>
                  {sv.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {ehInterno && (
            <p className="text-xs text-muted-foreground">
              Investimento da California: todo custo é F · Interno, o
              planejado é igual ao orçado e não há faturamento.
            </p>
          )}
        </Field>

        <Field label="Categoria" name="categoria_id" required errors={fieldErrors}>
          {categoriaTravada && opcoesDeCategoria.length === 1 ? (
            // Serviço com categoria própria (Fee, Always On): o campo é o
            // travado cinza do Projeto, e não um Select de uma opção só —
            // aprovado no design em 14/09/2026.
            <>
              <div className="flex h-10 items-center justify-between gap-2 rounded-md border border-border bg-muted/50 px-3 text-sm font-medium text-muted-foreground">
                <span className="truncate">{opcoesDeCategoria[0].nome}</span>
                <Lock className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
              </div>
              <p className="text-xs text-muted-foreground">
                Definida pelo serviço. {servicoEscolhido?.nome ?? "Este serviço"} usa
                a categoria {opcoesDeCategoria[0].nome}
                {opcoesDeCategoria[0].modelo_planilha === "mensal"
                  ? " e a planilha mensal."
                  : "."}
              </p>
            </>
          ) : (
            <Select value={categoriaId} onValueChange={setCategoriaId}>
              <SelectTrigger className={erroClasses("categoria_id")}>
                <SelectValue placeholder="Selecione a categoria" />
              </SelectTrigger>
              <SelectContent>
                {opcoesDeCategoria.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>

        <Field label="Regional" name="regional_id" required errors={fieldErrors}>
          <Select
            value={regionalId}
            onValueChange={setRegionalId}
            disabled={regionaisDoProjeto.length === 0}
          >
            <SelectTrigger className={erroClasses("regional_id")}>
              <SelectValue
                placeholder={
                  regionaisDoProjeto.length === 0
                    ? "Projeto sem regional cadastrada"
                    : "Selecione a regional"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {regionaisDoProjeto.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {regionaisDoProjeto.length === 0 && (
            <p className="text-xs text-muted-foreground">
              As opções vêm das regionais do projeto. Edite o projeto para
              cadastrar ao menos uma.
            </p>
          )}
        </Field>

        <Field label="Cidade" name="cidade_id" required errors={fieldErrors}>
          <CidadeCombobox
            value={cidade}
            onChange={setCidade}
            iniciais={cidadesIniciais}
            erro={Boolean(fieldErrors["cidade_id"]?.length)}
          />
        </Field>

        <Field
          label="GP Responsável"
          name="gp_responsavel_id"
          required
          errors={fieldErrors}
        >
          <Select
            value={gpId}
            onValueChange={setGpId}
            disabled={gpsDoProjeto.length === 0}
          >
            <SelectTrigger className={erroClasses("gp_responsavel_id")}>
              <SelectValue
                placeholder={
                  gpsDoProjeto.length === 0
                    ? "Projeto sem responsável cadastrado"
                    : "Selecione o GP responsável"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {gpsDoProjeto.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {gpsDoProjeto.length === 0 && (
            <p className="text-xs text-muted-foreground">
              As opções vêm dos responsáveis do projeto.
            </p>
          )}
        </Field>

        <Field
          label="Produtor Responsável"
          name="produtor_id"
          required
          errors={fieldErrors}
        >
          <Select value={produtorId} onValueChange={setProdutorId}>
            <SelectTrigger className={erroClasses("produtor_id")}>
              <SelectValue placeholder="Selecione o produtor responsável" />
            </SelectTrigger>
            <SelectContent>
              {produtores.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Início previsto"
          name="data_inicio_prevista"
          required={ehMensal}
          errors={fieldErrors}
        >
          <DatePicker
            name="data_inicio_prevista"
            defaultValue={orcamento?.data_inicio_prevista ?? ""}
            placeholder="Selecione a data"
            onDateChange={(d) => setInicio(d ? format(d, "yyyy-MM-dd") : "")}
          />
        </Field>

        <Field
          label="Fim previsto"
          name="data_fim_prevista"
          required={ehMensal}
          errors={fieldErrors}
        >
          <DatePicker
            name="data_fim_prevista"
            defaultValue={orcamento?.data_fim_prevista ?? ""}
            placeholder="Selecione a data"
            onDateChange={(d) => setFim(d ? format(d, "yyyy-MM-dd") : "")}
          />
        </Field>

        {ehMensal && (
          <p className="-mt-2 text-xs text-muted-foreground md:col-span-2">
            O período define o trimestre do orçamento: início e fim no mesmo
            trimestre, e os meses da planilha nascem dele.
            {inicio && fim && !erroDoPeriodoMensal(inicio, fim)
              ? " Os meses podem ser editados depois, na planilha."
              : ""}
          </p>
        )}

        {/* Descritivo — última linha, largura inteira. Escrito aqui, no
            calor da negociação, ele PRÉ-PREENCHE o Descritivo do envio
            para abertura (`jobs.observacoes`), que hoje só nascia no fim
            da linha, quando quem escreve já perdeu o contexto. Lá segue
            editável: isto é ponto de partida, não valor travado. */}
        <div className="md:col-span-2">
          <Field
            label="Descritivo"
            name="descritivo"
            errors={fieldErrors}
            apoio={
              descritivo.length > 0
                ? `${descritivo.length} / ${OBSERVACOES_MAX}`
                : "Opcional · adianta o descritivo do envio para abertura"
            }
          >
            <Textarea
              name="descritivo"
              value={descritivo}
              onChange={(e) => setDescritivo(e.target.value)}
              maxLength={OBSERVACOES_MAX}
              rows={3}
              className="min-h-[84px] resize-y leading-relaxed"
              placeholder="Contexto para quem abre o job: condições comerciais, dependências, o que combinamos com o cliente..."
            />
          </Field>
        </div>

        {isEdit && (
          <Field label="Status" name="status" errors={fieldErrors}>
            <Select value={status} onValueChange={(v) => setStatus(v as OrcamentoStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORCAMENTO_STATUS_EDITAVEIS.map((s) => (
                  <SelectItem key={s} value={s}>{orcamentoStatusLabel(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
          >
            Cancelar
          </button>
        ) : (
          <Link
            href={isEdit ? `/orcamentos/${projetoId}/${orcamento!.id}` : `/orcamentos/${projetoId}`}
            className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
          >
            Cancelar
          </Link>
        )}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {pending ? (
            <>
              <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Salvando...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {rotuloSubmit ?? (isEdit ? "Salvar alterações" : "Criar orçamento")}
            </>
          )}
        </button>
      </div>

      <ConfirmDialog
        open={confirmacao !== null}
        onOpenChange={(aberto) => {
          if (!aberto) {
            setConfirmacao(null);
            formPendente.current = null;
          }
        }}
        title={
          troca === "sai_do_mensal"
            ? "Tem certeza que quer trocar a planilha?"
            : troca === "entra_no_mensal"
              ? "Tem certeza que quer passar para a planilha mensal?"
              : `Tem certeza que quer passar para o serviço ${servicoEscolhido?.nome ?? "Interno"}?`
        }
        description={
          <>
            {troca === "sai_do_mensal" ? (
              <>
                A categoria {categoriaEscolhida?.nome} não usa a planilha
                mensal. Por causa da mudança no tipo de planilha,{" "}
                <strong>todo o orçamento depois do primeiro mês será apagado</strong>:
                só o primeiro mês permanece, e os grupos e itens dele passam a
                valer para o orçamento inteiro, em todas as versões. Não dá
                para desfazer.
              </>
            ) : troca === "entra_no_mensal" ? (
              <>
                Com a categoria {categoriaEscolhida?.nome}, o orçamento passa a
                ser dividido nos meses do período. Os grupos e itens que já
                existem vão para o primeiro mês, em todas as versões.
              </>
            ) : null}
            {confirmacao?.entraNoInterno && (
              <>
                {troca ? " " : null}
                No serviço {servicoEscolhido?.nome ?? "Interno"}, todo custo é
                F · Interno e o planejado é igual ao orçado.{" "}
                <strong>
                  As linhas que já existem, em todas as versões, passam a ser
                  F · Interno, com o planejado igual ao orçado
                </strong>
                , e o BV em negociação delas é cancelado.
              </>
            )}
          </>
        }
        confirmLabel={
          troca === "sai_do_mensal" ? "Sim, trocar e apagar" : "Sim, trocar"
        }
        variant={troca === "sai_do_mensal" ? "destructive" : "default"}
        pending={pending}
        onConfirm={() => {
          const dados = formPendente.current;
          setConfirmacao(null);
          formPendente.current = null;
          if (dados) enviar(dados);
        }}
      />
    </form>
  );
}

function Field({
  label,
  name,
  required,
  errors,
  apoio,
  children,
}: {
  label: string;
  name: string;
  required?: boolean;
  errors: Record<string, string[]>;
  /** Texto de apoio à direita do rótulo — contador ou "Opcional". */
  apoio?: string;
  children: React.ReactNode;
}) {
  const fieldErrors = errors[name];
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={name}>
          {label}
          {required && <span className="text-california-red ml-1">*</span>}
        </Label>
        {apoio && (
          <span className="text-[11px] text-muted-foreground">{apoio}</span>
        )}
      </div>
      {children}
      {fieldErrors?.map((msg, i) => (
        <p key={i} className="text-xs text-california-red">{msg}</p>
      ))}
    </div>
  );
}
