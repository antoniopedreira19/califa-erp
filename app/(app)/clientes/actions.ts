"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { onlyDigits } from "@/lib/utils";
import {
  clienteSchema,
  emailsExtrasSchema,
  telefonesExtrasSchema,
  marcasSchema,
  portaisSchema,
  HONORARIOS_PADRAO_FALLBACK,
  type MarcaLinha,
  type PortalLinha,
} from "@/lib/validations/clientes";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/** Resumo do cliente que já usa o CNPJ digitado — o formulário mostra o
 *  aviso e oferece abrir o cadastro existente em vez de criar outro. */
export interface ClienteResumo {
  id: string;
  nome_fantasia: string;
  codigo_curto: string;
  status: "ativo" | "inativo";
}

/**
 * `honorariosVazioVale12`: na edição de um cadastro antigo, campo vazio cai
 * no padrão da agência em vez de barrar o salvamento. Na criação o campo é
 * obrigatório — quem cadastra o cliente decide o percentual dele.
 */
function extractInput(
  formData: FormData,
  { honorariosVazioVale12 = false }: { honorariosVazioVale12?: boolean } = {},
) {
  const honorarios =
    formData.get("percentual_honorarios_padrao")?.toString().trim() ?? "";

  return {
    nome_fantasia: formData.get("nome_fantasia")?.toString() ?? "",
    codigo_curto: formData.get("codigo_curto")?.toString() ?? "",
    razao_social: formData.get("razao_social")?.toString() ?? "",
    cnpj: formData.get("cnpj")?.toString() ?? "",
    email: formData.get("email")?.toString() ?? "",
    telefone: formData.get("telefone")?.toString() ?? "",
    observacoes: formData.get("observacoes")?.toString() ?? "",
    percentual_honorarios_padrao:
      honorarios === "" && honorariosVazioVale12
        ? String(HONORARIOS_PADRAO_FALLBACK)
        : honorarios,
  };
}

/**
 * Marcas, portais e contatos extras viajam como JSON num campo oculto:
 * são listas de tamanho livre, e `FormData` plano não dá conta sem
 * inventar convenção de nome tipo `marcas[0][nome]`.
 *
 * JSON quebrado é tratado como lista vazia — quem grava de verdade é o
 * schema logo abaixo, e um payload corrompido não pode derrubar a action.
 */
function lerLista<T>(formData: FormData, campo: string): T[] {
  const cru = formData.get(campo)?.toString();
  if (!cru) return [];
  try {
    const valor = JSON.parse(cru);
    return Array.isArray(valor) ? (valor as T[]) : [];
  } catch {
    console.error(`[clientes.${campo}] JSON inválido`);
    return [];
  }
}

/** Junta o parse do cliente com o das listas, devolvendo o primeiro erro
 *  no formato que o formulário já sabe exibir. */
function parsePayload(
  formData: FormData,
  opts?: { honorariosVazioVale12?: boolean },
):
  | {
      ok: true;
      cliente: ReturnType<typeof clienteSchema.parse>;
      emailsExtras: string[];
      telefonesExtras: string[];
      marcas: MarcaLinha[];
      portais: PortalLinha[];
    }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> } {
  const cliente = clienteSchema.safeParse(extractInput(formData, opts));
  if (!cliente.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: cliente.error.flatten().fieldErrors,
    };
  }

  const emails = emailsExtrasSchema.safeParse(
    lerLista<string>(formData, "emails_extras"),
  );
  if (!emails.success) {
    return { ok: false, message: emails.error.issues[0].message };
  }

  const telefones = telefonesExtrasSchema.safeParse(
    lerLista<string>(formData, "telefones_extras"),
  );
  if (!telefones.success) {
    return { ok: false, message: telefones.error.issues[0].message };
  }

  const marcas = marcasSchema.safeParse(lerLista(formData, "marcas"));
  if (!marcas.success) {
    return { ok: false, message: marcas.error.issues[0].message };
  }

  const portais = portaisSchema.safeParse(lerLista(formData, "portais"));
  if (!portais.success) {
    return { ok: false, message: portais.error.issues[0].message };
  }

  return {
    ok: true,
    cliente: cliente.data,
    emailsExtras: emails.data,
    telefonesExtras: telefones.data,
    marcas: marcas.data,
    portais: portais.data,
  };
}

function mapDbError(msg: string): string {
  if (msg.includes("uniq_clientes_cnpj_por_tenant")) {
    return "Já existe um cliente com este CNPJ neste tenant.";
  }
  if (msg.includes("clientes_cnpj_only_digits")) {
    return "CNPJ deve conter apenas dígitos.";
  }
  if (msg.includes("uniq_clientes_codigo_curto_por_tenant")) {
    return "Já existe um cliente com este código.";
  }
  if (msg.includes("clientes_emails_extras_sem_vazio")) {
    return "E-mail adicional em branco. Remova a linha vazia.";
  }
  if (msg.includes("clientes_telefones_extras_sem_vazio")) {
    return "Telefone adicional em branco. Remova a linha vazia.";
  }
  return "Não foi possível salvar. Tente novamente.";
}

function mapMarcaDbError(msg: string): string {
  if (msg.includes("uniq_cliente_produto_nome")) {
    return "Há duas marcas com o mesmo nome neste cliente — os nomes precisam ser diferentes, inclusive do nome fantasia.";
  }
  if (msg.includes("uniq_cliente_produto_codigo")) {
    return "Código de marca repetido. Salve de novo.";
  }
  if (msg.includes("produto_padrao_protegido")) {
    return "A marca principal acompanha o nome fantasia e não pode ser alterada aqui.";
  }
  return "Não foi possível salvar as marcas.";
}

function mapPortalDbError(msg: string): string {
  if (msg.includes("uniq_cliente_portal_nome")) {
    return "Há dois portais com o mesmo nome neste cliente.";
  }
  return "Não foi possível salvar os portais de fornecedor.";
}

/**
 * Já existe cliente com este CNPJ neste tenant? A tela pergunta ao sair
 * do campo, antes de a pessoa preencher o resto do cadastro. Inativo
 * também conta: o CNPJ é um só, e o caminho é reativar o cadastro.
 */
export async function buscarClientePorCnpj(
  cnpj: string,
  excludeId?: string,
): Promise<{ existe: true; cliente: ClienteResumo } | { existe: false }> {
  const digits = onlyDigits(cnpj ?? "");
  if (digits.length !== 14) return { existe: false };

  const session = await requireSession();
  const supabase = createClient();

  let query = supabase
    .from("clientes")
    .select("id, nome_fantasia, codigo_curto, status")
    .eq("tenant_id", session.activeTenant.id)
    .eq("cnpj", digits)
    .limit(1);
  if (excludeId) query = query.neq("id", excludeId);

  const { data, error } = await query.maybeSingle();
  if (error || !data) return { existe: false };

  return {
    existe: true,
    cliente: {
      id: data.id,
      nome_fantasia: data.nome_fantasia,
      codigo_curto: data.codigo_curto,
      status: data.status as ClienteResumo["status"],
    },
  };
}

/**
 * O código já é de outro cliente? O código vira o prefixo dos códigos de
 * projeto e de job, então a tela avisa antes de a pessoa terminar o
 * cadastro — o unique index por tenant é quem recusa de verdade.
 */
export async function buscarClientePorCodigo(
  codigo: string,
  excludeId?: string,
): Promise<{ existe: true; cliente: ClienteResumo } | { existe: false }> {
  const limpo = (codigo ?? "").trim();
  if (limpo === "") return { existe: false };

  const session = await requireSession();
  const supabase = createClient();

  // `ilike` sem curinga é igualdade sem diferenciar maiúscula — que é o
  // que o índice único faz. Mas `%` e `_` digitados no campo seriam
  // curinga de verdade e casariam com outro cliente, então escapam.
  const padrao = limpo.replace(/([\\%_])/g, "\\$1");

  let query = supabase
    .from("clientes")
    .select("id, nome_fantasia, codigo_curto, status")
    .eq("tenant_id", session.activeTenant.id)
    .ilike("codigo_curto", padrao)
    .limit(1);
  if (excludeId) query = query.neq("id", excludeId);

  const { data, error } = await query.maybeSingle();
  if (error || !data) return { existe: false };

  return {
    existe: true,
    cliente: {
      id: data.id,
      nome_fantasia: data.nome_fantasia,
      codigo_curto: data.codigo_curto,
      status: data.status as ClienteResumo["status"],
    },
  };
}

/** PRD-02, PRD-03… a partir de quantas marcas o cliente já tem. Sujeito a
 *  corrida — o unique index captura a colisão. */
function codigoMarca(seq: number): string {
  return `PRD-${seq.toString().padStart(2, "0")}`;
}

export async function criarCliente(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "cadastros.clientes.editar");
  if (!gate.ok) return gate;

  const payload = parsePayload(formData);
  if (!payload.ok) return payload;
  const { cliente, emailsExtras, telefonesExtras, marcas, portais } = payload;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("clientes")
    .insert({
      ...cliente,
      emails_extras: emailsExtras,
      telefones_extras: telefonesExtras,
      tenant_id: session.activeTenant.id,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[clientes.criar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  await logAuditEvent({
    acao: "cliente.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente",
    entidadeId: data.id,
    metadata: { nome_fantasia: cliente.nome_fantasia },
  });

  // Todo cliente nasce com o produto padrão: o que representa a marca do
  // cliente — a matriz, quando não há outras marcas no guarda-chuva. Ele
  // é imutável (ver trigger `trg_cliente_produtos_padrao`) e resolve de
  // saída o beco de cliente sem produto, já que Produto é obrigatório no
  // formulário de projeto desde 06/08/2026.
  //
  // Código fixo em PRD-01: cliente recém-criado tem zero produtos, então
  // não vale gastar a query de contagem.
  //
  // Desde 09/09/2026 as marcas extras vêm no mesmo envio do formulário —
  // antes só dava para cadastrá-las depois, na tela de edição.
  const { data: produto, error: errProduto } = await supabase
    .from("cliente_produtos")
    .insert({
      tenant_id: session.activeTenant.id,
      cliente_id: data.id,
      nome: cliente.nome_fantasia,
      codigo: "PRD-01",
      padrao: true,
      created_by: session.profile.id,
    })
    .select("id")
    .single();

  revalidatePath("/clientes");

  // O cliente já está gravado — PostgREST não dá transação para desfazer.
  // Avisamos em vez de redirecionar em silêncio para um cliente que não
  // abre projeto.
  if (errProduto) {
    console.error("[clientes.criar.produto_padrao]", errProduto.message);
    return {
      ok: false,
      message:
        "Cliente criado, mas a marca principal não foi. Cadastre uma marca na tela do cliente antes de abrir projetos.",
    };
  }

  await logAuditEvent({
    acao: "cliente_produto.criado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente_produto",
    entidadeId: produto.id,
    metadata: {
      cliente_id: data.id,
      nome: cliente.nome_fantasia,
      codigo: "PRD-01",
      padrao: true,
      origem: "padrao_na_criacao_do_cliente",
    },
  });

  if (marcas.length > 0) {
    const linhas = marcas.map((m, i) => ({
      tenant_id: session.activeTenant.id,
      cliente_id: data.id,
      nome: m.nome,
      codigo: codigoMarca(i + 2), // PRD-01 é a principal
      ativo: m.ativo,
      created_by: session.profile.id,
    }));

    const { data: criadas, error: errMarcas } = await supabase
      .from("cliente_produtos")
      .insert(linhas)
      .select("id, nome, codigo");

    if (errMarcas) {
      console.error("[clientes.criar.marcas]", errMarcas.message);
      return {
        ok: false,
        message: `Cliente criado, mas as marcas extras não. ${mapMarcaDbError(errMarcas.message)} Cadastre-as na tela do cliente.`,
      };
    }

    for (const m of criadas ?? []) {
      await logAuditEvent({
        acao: "cliente_produto.criado",
        tenantId: session.activeTenant.id,
        entidadeTipo: "cliente_produto",
        entidadeId: m.id,
        metadata: {
          cliente_id: data.id,
          nome: m.nome,
          codigo: m.codigo,
          origem: "cadastro_do_cliente",
        },
      });
    }
  }

  if (portais.length > 0) {
    const { data: criados, error: errPortais } = await supabase
      .from("cliente_portais")
      .insert(
        portais.map((p) => ({
          tenant_id: session.activeTenant.id,
          cliente_id: data.id,
          nome: p.nome,
          url: p.url,
          ativo: p.ativo,
          created_by: session.profile.id,
        })),
      )
      .select("id, nome");

    if (errPortais) {
      console.error("[clientes.criar.portais]", errPortais.message);
      return {
        ok: false,
        message: `Cliente e marcas criados, mas os portais não. ${mapPortalDbError(errPortais.message)} Cadastre-os na tela do cliente.`,
      };
    }

    for (const p of criados ?? []) {
      await logAuditEvent({
        acao: "cliente_portal.criado",
        tenantId: session.activeTenant.id,
        entidadeTipo: "cliente",
        entidadeId: data.id,
        metadata: { portal_id: p.id, nome: p.nome, origem: "cadastro_do_cliente" },
      });
    }
  }

  redirect("/clientes");
}

/**
 * Reconciliação de marcas na edição.
 *
 * Nada é apagado: jobs antigos apontam para a marca. Linha com `id` que
 * volta no envio é atualizada (nome e ativo); linha sem `id` é criada;
 * linha que existia no banco e não voltou é **inativada**, nunca deletada.
 * A marca padrão fica de fora — ela acompanha o nome fantasia.
 */
async function sincronizarMarcas(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  clienteId: string,
  marcas: MarcaLinha[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: existentes, error } = await supabase
    .from("cliente_produtos")
    .select("id, nome, codigo, ativo, padrao")
    .eq("cliente_id", clienteId)
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[clientes.marcas.listar]", error.message);
    return { ok: false, message: "Não foi possível ler as marcas do cliente." };
  }

  const doBanco = (existentes ?? []) as {
    id: string;
    nome: string;
    codigo: string;
    ativo: boolean;
    padrao: boolean;
  }[];
  const comuns = doBanco.filter((m) => !m.padrao);
  const enviadosIds = new Set(marcas.map((m) => m.id).filter(Boolean));

  // Atualiza o que mudou de nome ou de status.
  for (const linha of marcas) {
    if (!linha.id) continue;
    const atual = comuns.find((m) => m.id === linha.id);
    if (!atual) continue;
    if (atual.nome === linha.nome && atual.ativo === linha.ativo) continue;

    const { error: errUp } = await supabase
      .from("cliente_produtos")
      .update({ nome: linha.nome, ativo: linha.ativo })
      .eq("id", linha.id)
      .eq("cliente_id", clienteId)
      .eq("tenant_id", tenantId);

    if (errUp) {
      console.error("[clientes.marcas.atualizar]", errUp.message);
      return { ok: false, message: mapMarcaDbError(errUp.message) };
    }
  }

  // Cria as novas, continuando a numeração PRD-NN.
  const novas = marcas.filter((m) => !m.id);
  if (novas.length > 0) {
    let proximo = doBanco.length + 1;
    const { error: errIns } = await supabase.from("cliente_produtos").insert(
      novas.map((m) => ({
        tenant_id: tenantId,
        cliente_id: clienteId,
        nome: m.nome,
        codigo: codigoMarca(proximo++),
        ativo: m.ativo,
      })),
    );
    if (errIns) {
      console.error("[clientes.marcas.criar]", errIns.message);
      return { ok: false, message: mapMarcaDbError(errIns.message) };
    }
  }

  // Sumiu do envio: inativa, não apaga.
  const removidas = comuns.filter((m) => m.ativo && !enviadosIds.has(m.id));
  for (const m of removidas) {
    const { error: errInat } = await supabase
      .from("cliente_produtos")
      .update({ ativo: false })
      .eq("id", m.id)
      .eq("cliente_id", clienteId)
      .eq("tenant_id", tenantId);
    if (errInat) {
      console.error("[clientes.marcas.inativar]", errInat.message);
      return { ok: false, message: mapMarcaDbError(errInat.message) };
    }
  }

  return { ok: true };
}

/** Mesma regra das marcas: envios de faturamento antigos apontam para o
 *  portal, então o que sai do formulário é inativado, não apagado. */
async function sincronizarPortais(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  clienteId: string,
  portais: PortalLinha[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: existentes, error } = await supabase
    .from("cliente_portais")
    .select("id, nome, url, ativo")
    .eq("cliente_id", clienteId)
    .eq("tenant_id", tenantId);

  if (error) {
    console.error("[clientes.portais.listar]", error.message);
    return { ok: false, message: "Não foi possível ler os portais do cliente." };
  }

  const doBanco = (existentes ?? []) as {
    id: string;
    nome: string;
    url: string;
    ativo: boolean;
  }[];
  const enviadosIds = new Set(portais.map((p) => p.id).filter(Boolean));

  for (const linha of portais) {
    if (!linha.id) continue;
    const atual = doBanco.find((p) => p.id === linha.id);
    if (!atual) continue;
    if (
      atual.nome === linha.nome &&
      atual.url === linha.url &&
      atual.ativo === linha.ativo
    ) {
      continue;
    }

    const { error: errUp } = await supabase
      .from("cliente_portais")
      .update({ nome: linha.nome, url: linha.url, ativo: linha.ativo })
      .eq("id", linha.id)
      .eq("cliente_id", clienteId)
      .eq("tenant_id", tenantId);

    if (errUp) {
      console.error("[clientes.portais.atualizar]", errUp.message);
      return { ok: false, message: mapPortalDbError(errUp.message) };
    }
  }

  const novos = portais.filter((p) => !p.id);
  if (novos.length > 0) {
    const { error: errIns } = await supabase.from("cliente_portais").insert(
      novos.map((p) => ({
        tenant_id: tenantId,
        cliente_id: clienteId,
        nome: p.nome,
        url: p.url,
        ativo: p.ativo,
      })),
    );
    if (errIns) {
      console.error("[clientes.portais.criar]", errIns.message);
      return { ok: false, message: mapPortalDbError(errIns.message) };
    }
  }

  const removidos = doBanco.filter((p) => p.ativo && !enviadosIds.has(p.id));
  for (const p of removidos) {
    const { error: errInat } = await supabase
      .from("cliente_portais")
      .update({ ativo: false })
      .eq("id", p.id)
      .eq("cliente_id", clienteId)
      .eq("tenant_id", tenantId);
    if (errInat) {
      console.error("[clientes.portais.inativar]", errInat.message);
      return { ok: false, message: mapPortalDbError(errInat.message) };
    }
  }

  return { ok: true };
}

export async function atualizarCliente(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "cadastros.clientes.editar");
  if (!gate.ok) return gate;

  const payload = parsePayload(formData, { honorariosVazioVale12: true });
  if (!payload.ok) return payload;
  const { cliente, emailsExtras, telefonesExtras, marcas, portais } = payload;

  const supabase = createClient();

  // Nome anterior, lido antes do update: é ele que identifica o produto
  // homônimo criado por padrão — ver abaixo.
  const { data: anterior } = await supabase
    .from("clientes")
    .select("nome_fantasia, percentual_honorarios_padrao")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      nome_fantasia: string;
      percentual_honorarios_padrao: number;
    }>();

  const { error } = await supabase
    .from("clientes")
    .update({
      ...cliente,
      emails_extras: emailsExtras,
      telefones_extras: telefonesExtras,
    })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[clientes.atualizar]", error.message);
    return { ok: false, message: mapDbError(error.message) };
  }

  // Honorários é condição comercial: mudança entra na auditoria com de/para.
  const honorariosMudou =
    anterior != null &&
    Number(anterior.percentual_honorarios_padrao) !==
      cliente.percentual_honorarios_padrao;

  await logAuditEvent({
    acao: "cliente.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente",
    entidadeId: id,
    metadata: honorariosMudou
      ? {
          campo: "percentual_honorarios_padrao",
          de: Number(anterior!.percentual_honorarios_padrao),
          para: cliente.percentual_honorarios_padrao,
        }
      : undefined,
  });

  // O produto padrão é a marca do cliente, então o nome dele acompanha o
  // nome fantasia — sempre, sem exceção de "foi editado à mão": ninguém
  // consegue editá-lo (trigger `trg_cliente_produtos_padrao`). Só os
  // produtos comuns ficam intactos.
  //
  // Ordem importa: `clientes` já foi gravado acima, então o trigger vê os
  // dois nomes batendo e deixa passar.
  const nomeMudou =
    anterior != null && anterior.nome_fantasia !== cliente.nome_fantasia;

  if (nomeMudou) {
    const { error: errRename } = await supabase
      .from("cliente_produtos")
      .update({ nome: cliente.nome_fantasia })
      .eq("cliente_id", id)
      .eq("tenant_id", session.activeTenant.id)
      .eq("padrao", true);

    // Falha aqui não desfaz a edição do cliente. O caso esperado é
    // colisão com um produto comum que já usa o nome novo.
    if (errRename) {
      console.error("[clientes.atualizar.rename_produto]", errRename.message);
      return {
        ok: false,
        message:
          "Cliente renomeado, mas a marca principal continuou com o nome antigo — provavelmente já existe outra marca com esse nome neste cliente.",
      };
    }
  }

  const resMarcas = await sincronizarMarcas(
    supabase,
    session.activeTenant.id,
    id,
    marcas,
  );
  if (!resMarcas.ok) {
    revalidatePath(`/clientes/${id}`);
    return { ok: false, message: resMarcas.message };
  }

  const resPortais = await sincronizarPortais(
    supabase,
    session.activeTenant.id,
    id,
    portais,
  );
  if (!resPortais.ok) {
    revalidatePath(`/clientes/${id}`);
    return { ok: false, message: resPortais.message };
  }

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${id}`);
  return { ok: true, id };
}

export async function inativarCliente(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "cadastros.clientes.editar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const { error } = await supabase
    .from("clientes")
    .update({ status: "inativo" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[clientes.inativar]", error.message);
    return { ok: false, message: "Não foi possível inativar." };
  }

  await logAuditEvent({
    acao: "cliente.inativado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente",
    entidadeId: id,
  });

  revalidatePath("/clientes");
  return { ok: true, id };
}

export async function reativarCliente(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "cadastros.clientes.editar");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const { error } = await supabase
    .from("clientes")
    .update({ status: "ativo" })
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id);

  if (error) {
    console.error("[clientes.reativar]", error.message);
    return { ok: false, message: "Não foi possível reativar." };
  }

  await logAuditEvent({
    acao: "cliente.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "cliente",
    entidadeId: id,
    metadata: { acao: "reativado" },
  });

  revalidatePath("/clientes");
  return { ok: true, id };
}
