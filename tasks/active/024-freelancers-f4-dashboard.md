# Task 024 — Freelancers (Fase 4, Task 1): Dashboard rico do módulo

## Objetivo

Transformar `/freelancers` (hoje placeholder) no painel central do módulo. Portado do `/dashboard` do AgCaliforniaRH, adaptado ao califa-erp.

Blocos:
1. **Hero escuro** com saudação, data/hora e CTA ("Nova solicitação").
2. **4 cards de análise rápida** (Na ativa / Em dia / Irregular / Encerrados) — clicáveis, levam pra `/freelancers/lista?card=`.
3. **5 cards de ações previstas** (Contratar / Renovar / Manter / Substituir / Encerrar) com contagem e barra de progresso.
4. **Solicitações pendentes** (admin/rh/financeiro) ou **Minhas solicitações** (demais) — card com lista top 5.
5. **Novos contratos por janela** (7 / 15 / 30 / 60 dias) — grid com links pra filtro.
6. **Performance por responsável** (admin/rh/financeiro) — tabela com score por responsável.

## Fora de escopo

- Modal com lista filtrada ao clicar no card (fica em click = navegação).
- Pool de notificações dismissed — Fase 4 Task 027.
- Botão "Buscar freelancer por CPF" direto no hero — a lista já faz busca por CPF.

## Decisões travadas

- **Hero** fica no padrão do AgCaliforniaRH: `bg-california-dark` com texto branco. Mas mais sucinto no califa-erp pra não brigar com o resto da identidade.
- **Click nos cards de análise** navega pra `/freelancers/lista?card=<categoria>` (não abre modal).
- **"Ações previstas"** usa cores por categoria: contratar=sky, renovar=emerald, manter=violet, substituir=amber, encerrar=california-red.
- **Progress bar das ações**: % relativo ao total de freelancers que tem ação definida (soma dos 5).
- **"Novos contratos por janela"**: filtra por `data_inicio >= hoje - N dias` (contratos iniciados nos últimos N dias). Vai como `?inicio_apos=YYYY-MM-DD`.
- Já que a lista hoje não aceita `?inicio_apos`, essa task **adiciona** o suporte ao filtro na lista.
- **Performance por responsável** mostra tabela com: Responsável · Total · Regulares · Em alerta · Score (%). Linha clica pra filtro `/freelancers/lista?responsavel=<id>` (também novo filtro).

## Contexto do ponto de partida

### Já pronto

- Página stub `app/(app)/freelancers/page.tsx` (Task 012).
- View `freelancers_com_status` com `status_calculado` + `responsavel_id`/`responsavel_nome` (Task 016).
- Tabelas `freelancer_solicitacoes` com status (Task 020).
- Rota de lista aceita filtros via query string (Task 013/019).

### Novo que precisa nascer

- 2 filtros novos em `/freelancers/lista`:
  - `?inicio_apos=YYYY-MM-DD` (data_inicio >= X)
  - `?responsavel=<uuid>` (responsavel_id = X)
- Hero component.
- Cards de ações previstas.
- Card de solicitações (pendentes vs minhas).
- Grid de novos contratos.
- Tabela de performance.

## Escopo

### 1. Arquivos novos

```
app/(app)/freelancers/_components/
├── hero-dashboard.tsx           # Hero escuro
├── cards-acoes-previstas.tsx    # 5 cards com progress
├── card-solicitacoes.tsx        # Pendentes/Minhas
├── grid-novos-contratos.tsx     # Janelas 7/15/30/60d
└── tabela-performance.tsx       # Performance por responsável
```

### 2. Arquivos modificados

- `app/(app)/freelancers/page.tsx` — vira o dashboard real.
- `app/(app)/freelancers/lista/page.tsx` — aceita `inicio_apos` e `responsavel` como filtros.

## Critérios de pronto

- [ ] Dashboard renderiza para admin/rh/financeiro com todos os blocos.
- [ ] GP/produtor veem versão reduzida (sem "Performance por responsável"; "Minhas solicitações" em vez de "Pendentes").
- [ ] Cards de análise clicam pra lista filtrada.
- [ ] Cards de ações previstas clicam pra lista com `?acao=`.
- [ ] Grid de novos contratos clica pra lista com `?inicio_apos=`.
- [ ] Tabela de performance clica pra lista com `?responsavel=`.
- [ ] `npm run typecheck` e `npm run lint` passam.
