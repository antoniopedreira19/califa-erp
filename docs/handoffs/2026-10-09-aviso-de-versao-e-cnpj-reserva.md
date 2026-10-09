# Aviso de versão nova e consulta de CNPJ com reserva (2026-10-09)

> Antes, quem deixava a aba aberta durante um deploy seguia usando a versão antiga, com os defeitos já corrigidos, sem saber; e, quando a BrasilAPI caía, o cadastro de fornecedor perdia o preenchimento automático e o regime. Agora a aba avisa sozinha que há versão nova, e a consulta do CNPJ tem uma segunda fonte.

## O que muda pro negócio

- **"O sistema foi atualizado. Salve o que estiver fazendo e recarregue a página."** aparece no topo de qualquer tela do sistema quando sai uma versão nova, sem a pessoa recarregar. Fica por cima de pop-ups e não fecha nenhum deles; o botão "Recarregar" recarrega. Nunca recarrega sozinho.
- **Consulta do CNPJ no cadastro de fornecedor** (página, pop-up da PP e veículo de mídia): se a BrasilAPI não responder, o sistema pergunta ao CNPJ.ws e preenche do mesmo jeito: razão social, endereço e o regime (MEI/Simples, com a data de opção).

## Estado atual (o que existe agora)

- **Aviso de versão**: `components/aviso-de-versao-nova.tsx`, montado em `app/(app)/layout.tsx` (também no layout do colaborador). A aba confere a cada 5 minutos com a tela à vista e sempre que a pessoa volta para ela. A pergunta vai a `/api/versao` (estática, fora do middleware: não lê sessão nem banco). O valor vem do build, em `next.config.js`: `VERCEL_DEPLOYMENT_ID`, ou o commit, ou `local` (em desenvolvimento não confere).
- **Consulta do CNPJ**: `lib/consulta-cnpj.ts`. Primeiro a BrasilAPI (até 6 s); se falhar, o CNPJ.ws (até 6 s), com a resposta convertida para os campos da BrasilAPI. A tela e o regime (`lib/fiscal/regime-do-fornecedor.ts`) não sabem de onde veio. Testes: `node --import tsx --test lib/consulta-cnpj.test.ts`.

## Decisões que vão importar amanhã

- **Só abas abertas depois deste deploy têm o aviso.** As que já estavam abertas antes dele não têm o código que confere a versão.
- **Por que o `fetch` de `/api/versao` enxerga a versão nova:** a proteção de versão da Vercel prende à publicação antiga só as requisições do framework (arquivos, navegação, server actions), que levam o id da publicação. Um `fetch` escrito à mão vai para a publicação mais nova. Se alguém um dia fixar a sessão com o cookie `__vdpl`, o aviso para de funcionar.
- **Armadilha do clique:** no App Router o React escuta os eventos no `document`, o mesmo lugar onde o Radix escuta o "clique fora" que fecha o diálogo. Por isso `e.stopPropagation()` num handler React não impede o fechamento. O aviso segura o `pointerdown` na captura da `window`. Sem isso, um clique no texto do aviso fechava o pop-up da PP (achado no teste).
- **CNPJ.ws**: é a "API Gratuita" deles, sem cadastro nem chave, com 3 consultas por minuto por IP. A 4ª volta 429 e a pessoa preenche à mão. A chamada sai do navegador, porque do servidor o limite seria dividido com o tráfego da Vercel. A BrasilAPI e o CNPJ.ws leem a mesma base aberta da Receita, atualizada uma vez por mês.
- **O "Empresas contábeis" (Admin) continua só na BrasilAPI** (`empresa-contabil-drawer.tsx`). Ficou fora desta entrega.

## O que fica pra próxima sessão

- Nada pendente. Se a BrasilAPI voltar a falhar com frequência, dá para inverter a ordem (CNPJ.ws primeiro) em `consultarCnpj`.

## Rastros técnicos (opcional, no rodapé)

Testado em build de produção local, simulando um deploy (build "A", aba aberta com o pop-up "Novo fornecedor" da PP do TES-1025/26, troca do servidor pelo build "B"). O aviso apareceu ao voltar para a aba, o clique no texto não fechou nenhum dos 3 diálogos nem apagou o que estava digitado, e "Recarregar" levou a aba para a B. A consulta do CNPJ, com a BrasilAPI dando 500, preencheu pelo CNPJ.ws em 7,2 s, com o regime "MEI desde 07/2024". Nada foi gravado.
