# /perfil redesign + cleanup das notificações de férias (2026-10-03)

> O `/perfil` deixou de ser uma página de rascunho (notificação de RH no topo + card simples embaixo + banner amarelo) e virou a "rede social" do usuário dentro do sistema — hero com identidade, cards temáticos pra dados pessoais, bancários, acesso, alocação, benefícios e documentos (os 3 últimos ainda placeholders). No mesmo dia, o subsistema de notificações de férias foi apagado inteiro — era desorganizado, misturava escopo pessoal e operacional, e vai renascer como hub central multi-módulo numa feature futura.

## O que muda pro negócio

- Qualquer usuário (admin, RH, GP, produtor, freelancer, colaborador) tem uma **página de identidade dentro do sistema**. Até aqui era uma tela técnica; agora transmite "esse é você aqui dentro".
- Colaborador vê **saldo de férias em aberto** no próprio perfil (sem precisar entrar no `/rh/ferias`, que ele nem acessa) e solicita direto.
- **Edição centralizada**: só admin e RH podem editar dados; o botão "Editar" no hero leva pra `/rh/colaboradores/[id]`. GP, produtor, freelancer e colaborador veem readonly.
- **Benefícios** entrou como placeholder visível na lateral (lista estilo "VR · VA · Convênio · TotalPass" com status "—"), sinalizando a feature futura sem compromisso.
- As notificações do RH **sumiram da UI**. Antes elas invadiam o `/perfil`, o `/rh/ferias/Painel`, as 6 homes. Agora silêncio total até o hub central ser construído — melhor do que ruído de fanout a 8 admins por evento.

## Estado atual (o que existe agora)

### /perfil

- **Hero** (`#171717` sólido): avatar com iniciais sobre fundo California-red, nome em destaque, email, chips com role (ícone escudo), tipo de contratação, função, empresa principal, data de admissão. Botão "Editar" aparece só pra admin/RH e leva pra `/rh/colaboradores/[id]`.
- **Layout 2 colunas** (grid `1fr + 320px`):
  - **Esquerda**: Dados pessoais → Dados bancários → Minhas férias → Nota fiscal do mês (placeholder, só PJ/CLT recibo).
  - **Direita**: Acesso ao sistema → Alocação atual → Benefícios (placeholder) → Documentos (placeholder).
- **Minhas férias** mostra APENAS períodos acionáveis (apto/em_alerta/vencido). Passados regularizados e futuros em curso ficam escondidos — contexto demais pro perfil pessoal. Histórico de lançamentos também foi removido.
- **Branch admin sem colab vinculado** (ex: Antonio Pedreira enquanto não vincula): hero com dados do profile + aviso compacto na coluna principal + card de acesso na lateral. Sem banner amarelo gigante.
- **Casca comum** reutilizável em `card-base.tsx` (CardBase, Campo, EmBreve) pros 9 cards.

### Notificações de férias (REMOVIDO)

- Tabela `colaboradores_ferias_notificacoes` dropada.
- Enum `ferias_notificacao_tipo` dropado.
- 3 funções removidas: `fn_criar_notificacao_ferias`, `fn_destinatarios_ferias`, `fn_rotina_diaria_ferias`.
- Job pg_cron `ferias_rotina_diaria` desagendado.
- Componentes `components/notificacoes-ferias/` deletados (card + linha-notificacao).
- Função `marcarNotificacaoLida` removida de `actions.ts`.
- 4 blocos de `fn_criar_notificacao_ferias` nas actions removidos (aprovar, reprovar, em_analise, lançar direto).
- Imports e usos limpos em 6 homes (`home-admin.tsx`, `home-rh.tsx`, `home-financeiro.tsx`, `home-freelancer.tsx`, `home-gerente-producao.tsx`, `home-produtor.tsx`), `/perfil`, `/rh/ferias/aba-painel.tsx`.
- Tipos `FeriasNotificacaoTipo` e `ColaboradorFeriasNotificacao` removidos de `lib/types.ts`.
- **Preservado**: `fn_calcular_meses_rescisao` (usada pelo `/rh/rescisoes`).

## Decisões que vão importar amanhã

- **Edição readonly pra colaborador/GP/produtor** foi decisão explícita do PO. Admin/RH editam. Reavaliar se um colaborador reclamar que não consegue atualizar telefone sozinho.
- **Botão "Editar" no hero leva pra `/rh/colaboradores/[id]`** em vez de abrir drawer inline — centraliza edição num lugar só. Se futuramente a UX ficar ruim (muito pulo entre páginas), inverter.
- **Hero com cor sólida `#171717`** depois de testar gradient California-red/20 — o degradê ficou confuso visualmente (banda clara no meio). Cor sólida ficou mais limpa.
- **Benefícios na coluna lateral** (não na principal) com formato "lista de nome + status". Decisão de layout: o item individual é compacto demais pra ocupar card grande.
- **Nota fiscal mostrada só pra PJ e CLT recibo**. CLT comum nunca emite NF própria pra pagamento; esconder o placeholder evita confusão.
- **Notificações apagadas sem reposição imediata**. Decisão deliberada pra não arrastar um sistema ruim por mais tempo. O cron de "concessivo em alerta" + "vencido" vai ter que renascer no hub central — enquanto isso, o RH **não recebe alerta automático de nada**. Mitigação: o Quadro em `/rh/ferias` continua mostrando os status corretamente, só não puxa a atenção.
- **Hub central de notificações** documentado em `docs/pendencias/hub-central-notificacoes.md` com modelo proposto (tabela única `notificacoes` com `modulo`, `escopo`, `payload jsonb`), policies RLS que separam pessoal vs operacional (admin/RH só vê operacional, destinatário vê a sua), e "quem recebe o quê" (proposta inicial, não travada). **Não começar a implementação sem alinhamento prévio sobre fanout.**

## O que fica pra próxima sessão

**Objetivo imediato**: spec do `/perfil` em `docs/modulos/perfil/00-visao-geral.md` (fonte-verdade do subsistema — quais cards tem, decisões de design, estados do card de acesso, placeholders futuros).

**Objetivo médio prazo**: planejar o hub central de notificações. Pergunta aberta pro PO: "quem recebe o quê" (ver tabela proposta em `docs/pendencias/hub-central-notificacoes.md`).

**O que já está pronto pra suportar**:
- `/perfil` tem 3 placeholders prontos (`Benefícios`, `Nota fiscal do mês`, `Documentos`) com casca visual pronta. Quando a feature vier, só trocar o conteúdo.
- `CardBase` + `EmBreve` em `card-base.tsx` padronizam a casca — qualquer card novo entra no mesmo padrão.
- Hub de notificações já tem policies desenhadas (RLS considerando escopo), modelo definido, e checklist de implementação no doc de pendência.

## Rastros técnicos

Migration aplicada:

```
20261003000001  drop_ferias_notificacoes       (dropa tabela, enum, 3 funções, job cron)
```

Arquivos novos (`app/(app)/perfil/`):

```
hero-perfil.tsx              (hero #171717 com avatar + chips + botão editar condicional)
card-base.tsx                (CardBase + Campo + EmBreve reutilizáveis)
card-dados-pessoais.tsx      (CPF, RG, nascimento, telefone, emails, bloco PJ, endereço)
card-dados-bancarios.tsx     (banco, ag, conta, tipo, PIX)
card-acesso-usuario.tsx      (role, status, último acesso relativo)
card-alocacao-atual.tsx      (empresas com %, nível, área, líder)
card-beneficios.tsx          (placeholder lista: VR, VA, convênio, TotalPass)
card-nota-fiscal.tsx         (placeholder, só PJ/CLT recibo)
card-documentos.tsx          (placeholder)
```

Doc nova:
- `docs/pendencias/hub-central-notificacoes.md` — modelo, policies, catálogo "quem recebe", checklist.

Commits:

```
c4aca13  chore(rh): remove subsistema de notificações de férias
b482801  feat(perfil): redesign do /perfil como página de identidade do usuário
a94bfd7  feat(perfil): só período em aberto nas férias + benefícios na lateral
776163f  style(perfil): hero com cor sólida #171717 (sem gradient)
```
