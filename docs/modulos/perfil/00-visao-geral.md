# /perfil — Visão geral do subsistema

> **Status**: Em produção desde 2026-10-03. Spec viva — qualquer decisão nova sobre a página entra aqui, não em commit nem em chat.

## 1. Contexto

`/perfil` é a **página de identidade do usuário dentro do sistema**. Não é uma tela técnica ("meus dados" fria); é a "rede social" dele: o lugar onde ele vê quem é no sistema, o que tem, o que pode fazer. É acessível **por qualquer role logada** — admin, RH, GP, produtor, financeiro, freelancer e colaborador.

O /perfil **substitui a planilha de "cadastro do colaborador"** da perspectiva do próprio colaborador (RH mantém o editor completo em `/rh/colaboradores/[id]`).

## 2. Objetivo

Dar a cada usuário logado uma página única pra:

1. Ver seus **dados pessoais**, de contratação e bancários.
2. Ver seu **status de acesso** ao sistema (role, última entrada).
3. Ver sua **alocação atual** (empresa, regional, nível, líder).
4. Ver suas **férias em aberto** e solicitar — autoserviço.
5. (Futuro) Ver **benefícios** ativos.
6. (Futuro) **Anexar NF do mês** vinculada à folha (só PJ/CLT recibo).
7. (Futuro) Baixar **documentos pessoais**: contrato, aditivos, holerites.

Fora do escopo:
- Edição direta de dados pelo próprio usuário (hoje). O botão "Editar" leva pra `/rh/colaboradores/[id]` e só é visível pra admin/RH.
- Visão de colegas, times, hierarquia. É página individual.
- Histórico administrativo completo (ex: todo o histórico de lançamentos de férias). Esse contexto fica no `/rh/ferias`.

## 3. Público-alvo

**Primário**: colaboradores (CLT, PJ, CLT recibo, estágio). Role `colaborador` tipicamente só acessa `/perfil` e nada mais.

**Secundário**: admin, RH, GP, produtor, financeiro, freelancer, sócio. Veem seu próprio perfil quando logados.

**Edge case**: admin ou RH **sem colaborador vinculado** (ex: Antonio Pedreira enquanto não cadastra o próprio registro de colaborador). Página renderiza versão enxuta — hero com dados do profile + aviso compacto + card de acesso.

## 4. Decisões travadas

### 4.1. Edição readonly pra 5 das 7 roles

**Editam**: `administrador`, `rh`.
**Readonly**: `colaborador`, `gerente_producao`, `produtor`, `freelancer`, `financeiro`, `sócio`.

Botão "Editar" no hero só aparece pra admin/RH e leva pra `/rh/colaboradores/[id]` (NÃO abre drawer inline). Decisão: centralizar edição em um lugar só, evitar manter 2 fluxos.

Reavaliar se um colaborador reclamar que não consegue atualizar telefone sozinho — nesse caso, adicionar drawer de edição parcial no /perfil (telefone, email pessoal, PIX, contato de emergência).

### 4.2. Layout 2 colunas (1fr + 320px)

- **Esquerda** (fluida): o que o usuário **é/tem** — dados pessoais, bancários, férias, NF.
- **Direita** (320px fixo em desktop): **metadados** — acesso, alocação, benefícios, documentos.

Mobile: colapsa pra 1 coluna, direita vai pra baixo.

### 4.3. Benefícios na lateral, não no corpo

Decisão de 2026-10-03: o card de benefícios é lista compacta (nome + status), ocupa pouco espaço vertical. Fica entre Alocação e Documentos na lateral.

### 4.4. Minhas férias só mostra período em aberto

Decisão de 2026-10-03: no /perfil, o card de férias omite períodos regularizados (passados concluídos) e incompletos (futuros em curso). Mostra apenas apto/em_alerta/vencido com saldo. Contexto completo está no modal do `/rh/ferias`.

### 4.5. Hero com cor sólida `#171717`

Testou-se gradient California-red/20 inicialmente — ficou confuso (banda clara no meio). Cor sólida fica mais limpa e combina com o perfil "elegante" da identidade. Avatar e chips têm California-red como accent.

### 4.6. Nota fiscal só pra PJ e CLT recibo

Decisão de 2026-10-03: o card de NF do mês renderiza condicional. CLT comum nunca emite NF própria pra pagamento; esconder o placeholder evita confusão.

### 4.7. Sócio não vê card de férias

Decisão de 2026-10-02 (migration `20261002000012`): sócio não tem direito a férias. Card `CardMinhasFerias` esconde quando `tipo_contratacao === 'socio'`.

## 5. Estrutura visual

```
┌─────────────────────────────────────────────────────────────┐
│  [AV] Nome                                        [Editar] │   HERO
│       email@...                                             │   #171717
│       🛡 Role · 🏢 Empresa · 👔 Função · 📅 desde dd/mm/aa  │   altura
│                                                             │   ~160px
└─────────────────────────────────────────────────────────────┘

┌──────── 1fr ─────────────────────────┐  ┌──── 320px ────┐
│ DADOS PESSOAIS                       │  │ ACESSO AO     │
│  CPF · RG · Nascimento · Telefone    │  │ SISTEMA       │
│  Emails · [bloco PJ] · [bloco end.]  │  └───────────────┘
├──────────────────────────────────────┤  ┌───────────────┐
│ DADOS BANCÁRIOS                      │  │ ALOCAÇÃO      │
│  Banco · Ag · Conta · Tipo · PIX     │  │ ATUAL         │
├──────────────────────────────────────┤  └───────────────┘
│ MINHAS FÉRIAS                        │  ┌───────────────┐
│  Hero: saldo + prazo + status        │  │ BENEFÍCIOS    │
│  Períodos EM ABERTO (apto/alerta)    │  │ (placeholder) │
├──────────────────────────────────────┤  └───────────────┘
│ NOTA FISCAL DO MÊS (placeholder)     │  ┌───────────────┐
│  (só PJ/CLT recibo)                  │  │ DOCUMENTOS    │
└──────────────────────────────────────┘  │ (placeholder) │
                                           └───────────────┘
```

## 6. Componentes

Organização em `app/(app)/perfil/`:

| Arquivo | Papel |
|---|---|
| `page.tsx` | Server component orquestrador. Carrega colab, acesso, alocações. 2 branches (com colab / sem colab). |
| `hero-perfil.tsx` | Hero #171717, avatar, chips, botão editar condicional. |
| `card-base.tsx` | Casca comum: `CardBase` + `Campo` + `EmBreve`. |
| `card-dados-pessoais.tsx` | CPF, RG, nascimento, telefone, emails. Blocos PJ (CNPJ + razão social) e Endereço aparecem condicionalmente. |
| `card-dados-bancarios.tsx` | Banco, agência, conta, tipo, chave PIX. Mostra "não cadastrado" se vazio. |
| `card-minhas-ferias.tsx` | Hero com saldo + status + prazo. Lista de períodos acionáveis. Botão "Solicitar férias" integrado. |
| `card-acesso-usuario.tsx` | Role, status membership, último acesso em formato relativo ("há 3h", "ontem"). |
| `card-alocacao-atual.tsx` | Empresas vigentes com %, nível, área, líder direto. |
| `card-beneficios.tsx` | Placeholder — lista VR/VA/Convênio/TotalPass com status "—". |
| `card-nota-fiscal.tsx` | Placeholder — só renderiza pra PJ e CLT recibo. |
| `card-documentos.tsx` | Placeholder. |
| `solicitar-ferias-drawer.tsx` | Drawer de solicitação, consumido pelo card de férias. |
| `linha-historico-lancamento.tsx` | **Legado** — era usado no /perfil antes de 2026-10-03. Hoje órfão. **Pode ser removido se tiver certeza que ninguém mais importa.** |
| `actions.ts` | Server actions (solicitar/cancelar férias). |

## 7. Dados que a página carrega

Por request RSC:

```ts
// 1. Colaborador do profile logado (nullable)
select colaboradores.* , nivel(id, codigo, descricao), lider(id, nome)
where user_id = session.profile.id and tenant_id = session.activeTenant.id

// 2. Acesso ao sistema (sempre, inclusive sem colab)
lib/auth/acesso-colaborador.ts → carregarAcessoColaborador(session.profile.id)
  → service.auth.admin.getUserById → invited_at, last_sign_in_at, email_confirmed_at

// 3. Só se tem colab:
//   - periodos (menos pra sócio)
//   - lancamentos (menos pra sócio)
//   - alocacoes vigentes (data_fim is null) + empresas + regionais
//   - tenant_members(role, status) via service client
```

Performance: 3-4 queries em paralelo via `Promise.all`. Nada de embed pesado.

## 8. Estado atual × estado futuro

### Hoje tem

- 6 cards com dados reais (hero, pessoais, bancários, férias, acesso, alocação).
- Edição por admin/RH via link pra `/rh/colaboradores/[id]`.
- Solicitação de férias funcionando (fluxo: pendente → RH aprova → aprovado).
- Caso edge admin sem colab tratado.

### Futuro planejado

- **Edição parcial pelo próprio usuário** (telefone, email pessoal, PIX) — se o PO pedir.
- **Benefícios reais**: subsistema de benefícios, nome do benefício + status + saldo mensal (quando aplicável).
- **Nota fiscal do mês**: upload de NF vinculada à folha vigente, só PJ/CLT recibo.
- **Documentos**: contrato, aditivos, holerites, recibos — baixar PDF do bucket privado.
- **Avatar com foto**: hoje é só iniciais sobre fundo California-red. Upload de foto fica pra depois.
- **Notificações pessoais**: quando o hub central de notificações nascer (ver `docs/pendencias/hub-central-notificacoes.md`), um painel compacto de notificações pessoais pode entrar no /perfil (sem o lixo operacional do RH que existia antes).

## 9. Pontos de atenção pra quem for mexer

- **`CardBase` padroniza header + body**. Qualquer card novo deve usar — não reinventar casca.
- **`EmBreve` é o padrão de placeholder** — badge âmbar + texto curto. Mantenha coeso.
- **Hero exige dados do profile OU do colab** — se não tem colab, cai pro profile. Não quebrar essa fallback.
- **O botão "Editar" leva pra `/rh/colaboradores/[id]`**. Se um dia virar drawer inline, lembrar: `editarColaborador` em `app/(app)/rh/colaboradores/actions.ts` já tem gate de role. Reusar.
- **Email readonly no editor** (`editar-dados-drawer.tsx`) quando `user_id` setado — motivo documentado em `docs/modulos/rh/35-vinculo-colaborador-usuario.md` §4.10.

## 10. Histórico de decisões

| Data | Decisão | Doc/handoff |
|---|---|---|
| 2026-10-03 | Redesign completo com hero + 9 cards + layout 2 colunas | [handoff](../../handoffs/2026-10-03-perfil-redesign-e-cleanup-notificacoes.md) |
| 2026-10-03 | Hero cor sólida `#171717` (descartado gradient) | [handoff](../../handoffs/2026-10-03-perfil-redesign-e-cleanup-notificacoes.md) |
| 2026-10-03 | Minhas férias só mostra períodos em aberto, sem histórico | [handoff](../../handoffs/2026-10-03-perfil-redesign-e-cleanup-notificacoes.md) |
| 2026-10-03 | Benefícios na lateral com formato lista nome+status | [handoff](../../handoffs/2026-10-03-perfil-redesign-e-cleanup-notificacoes.md) |
| 2026-10-03 | Edição centralizada em `/rh/colaboradores/[id]` (não inline) | [handoff](../../handoffs/2026-10-03-perfil-redesign-e-cleanup-notificacoes.md) |
| 2026-10-03 | Readonly pras 5 roles não-admin/RH | PO alinhou no chat da sessão |
| 2026-10-03 | Notificações removidas do /perfil (operacionais poluíam) | [handoff](../../handoffs/2026-10-03-perfil-redesign-e-cleanup-notificacoes.md) + [pendência](../../pendencias/hub-central-notificacoes.md) |
| 2026-10-02 | Sócio esconde card de minhas férias | [handoff](../../handoffs/2026-10-02-rh-ferias-usavel.md) |
