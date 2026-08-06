# Estado da implementação

## Identificação

| Item | Estado atual |
| --- | --- |
| Repositório upstream | `block/buzz` |
| Fork | `d1fmarketing/buzz` |
| Branch de trabalho | `codex/companion-v1` |
| Pull request | `d1fmarketing/buzz#1`, Draft |
| Pacote novo | `cockpit/` |
| Buzz Desktop | Preservado; `desktop/` não foi substituído. |
| Execução | Local em `http://127.0.0.1:4317` |
| Persistência | Um JSON local; nenhum banco novo. |
| API de LLM | Nenhuma. |

## Snapshot observado em 6 de agosto de 2026

O health local retornou:

- CLI disponível;
- relay configurado;
- identidade autenticada;
- estado geral `ok: true`.

O autoimport local contém oito projetos reais:

1. Voice Agent;
2. SHELLHOUSE;
3. general;
4. VoxelBase;
5. Methylia;
6. venture-studio-daily;
7. Welcome;
8. welcome-everyone.

O arquivo de estado observado contém zero missões, zero dispatches e zero itens
de Attention reais. Isso confirma que a importação e a leitura estão ativas, mas
também que uma missão completa enviada pelo cockpit ainda não foi registrada no
estado atual.

## Histórico da implementação

### `e899ef95d` — Add local Buzz cockpit frontend

Criou a base completa do pacote:

- servidor localhost e adaptador CLI;
- resolução de relay, identidade e managed agents;
- persistência local segura;
- React/Vite, Shell, rotas e estilos;
- projetos, missões, dispatches, Chain, Attention e roster;
- composer, envio, anexos e model draft;
- normalizadores, guardas e testes iniciais;
- inclusão de `cockpit` no workspace pnpm.

### `d91d11043` — Align cockpit attachments with Buzz media support

Alinhou o composer com a allowlist de mídia usada nesta versão:

- JPEG;
- PNG;
- GIF;
- WebP;
- MP4;
- mensagem de erro para formato não aceito;
- limite de 20 anexos no frontend.

### `214fd2196` — Expand cockpit conversation visibility

Transformou a timeline mínima em uma superfície de conversa próxima ao Buzz:

- Markdown e reply context;
- imagens inline, galerias, lightbox e vídeo;
- proxy autenticado de mídia com hash verificado;
- navegação por participante e mídia;
- múltiplas conversas por missão;
- identificação de threads e menções;
- reconciliação mais forte de respostas;
- testes de conversa e timeline.

### `30a593ad8` — Scope cockpit conversations by project

Corrigiu o modelo central de organização:

- canais reais importados como projetos;
- UUID do canal como identidade durável;
- `/` transformado em seletor de projetos;
- remoção da timeline global `/activity`;
- histórico totalmente separado por projeto;
- paginação retroativa de 200 eventos e polling incremental;
- proteção contra respostas assíncronas de projeto anterior;
- missão idempotente `Conversa contínua` para o composer do projeto;
- Reader com filtro de ruído operacional;
- reconciliação de edições Buzz `kind 40003`;
- testes de importação, conversa contínua e apresentação.

## Entregas funcionais

### Infraestrutura e compatibilidade

**Concluído:**

- pacote browser independente;
- Buzz Desktop original preservado;
- CLI existente reutilizado;
- relay e identidade existentes reutilizados;
- nenhuma chave/API de LLM no frontend;
- nenhum banco, signer genérico ou supervisor paralelo;
- adapter preso a `127.0.0.1` e sem shell arbitrário.

### Projetos e navegação

**Concluído e exercitado com dados reais:**

- importação idempotente de canais ativos;
- oito workspaces reais presentes;
- histórico isolado por projeto;
- troca de rota limpa a timeline anterior;
- rota antiga `/activity` volta ao seletor;
- missão validada contra o projeto da URL.

### Conversa

**Concluído e exercitado com dados reais:**

- paginação completa na página do projeto;
- atualização incremental a cada 12 segundos;
- timeline cronológica;
- filtros por agente, handoff e mídia;
- reply, root, thread e event IDs;
- Markdown;
- imagem, galeria, lightbox, vídeo e arquivo;
- edição incorporada à mensagem original.

**Limite conhecido:** Mission Workspace usa até 500 eventos por thread e não
possui ainda a mesma paginação completa do projeto.

### Reader e Operator

**Concluído e validado visualmente:**

- Reader esconde recibos estritos, readbacks em massa e caminhos internos;
- Operator conserva a conversa operacional que Reader filtra;
- mídia e falas substantivas permanecem no Reader;
- nenhum evento é removido do Buzz.

**Precisão importante:** ambos os modos recebem mensagens já normalizadas e com
edições `40003` incorporadas. Operator não é um log cru de protocolo.

Na validação de SHELLHOUSE durante a implementação, a projeção Operator continha
484 entradas reconciliadas e Reader mostrava 440 entradas úteis, mantendo sete
imagens. Os padrões literais de ledger, `OUTBOX/` e supersession não apareciam no
Reader. Esses números são uma evidência daquela execução e podem mudar conforme
novos eventos chegam ao canal.

Na validação de Welcome, 68 falas foram exibidas a partir de 73 eventos de
mensagem/edição: cinco edições foram corretamente fundidas às mensagens-alvo.

### Composer e mídia

**Implementado na interface:**

- seleção de agente e conversa;
- reply para thread existente ou criação de nova raiz;
- até 20 anexos;
- menção exata ao agente.

**Coberto diretamente por testes de servidor/adaptador:**

- texto por stdin no CLI;
- total de 25 MB no adaptador;
- arquivos temporários removidos após envio;
- proxy de mídia content-addressed e verificação SHA-256.

Não existe ainda teste integrado de `App`/browser cobrindo seleção, reply ou
criação da raiz até o relay.

**Pendente de evidência live completa:** enviar um arquivo pelo cockpit e
confirmar, no Buzz Desktop original, o mesmo evento e anexo.

### Missões, Chain e handoffs

**Implementado:**

- criação e status de missão;
- Conversation e Chain;
- vínculos de thread;
- dispatch persistido antes do envio;
- recibos separados;
- reconciliação por agente e thread;
- detector de handoff explícito;
- fila de próximos agentes;
- dispatch filho e resolução do Attention correspondente.

**Pendente de validação live:** missão real completa com resposta de agente,
handoff e síntese.

### Limites do loop

**Aplicados pelo fluxo atual:**

- missão precisa estar draft/running;
- máximo de dispatches;
- máximo de especialistas;
- máximo de filhos por resposta;
- profundidade de handoff.

**Ainda incompletos:**

- quantidade inicial de especialistas: configurada/exibida, sem guarda;
- ciclo builder ↔ critic: branch de guarda, sem alimentação e sem teste direto;
- retry por dispatch: branch de guarda, sem alimentação e sem teste direto;
- rodadas sem ganho material: branch de guarda com teste direto, mas sem
  alimentação pelo composer.

Até esses contadores entrarem no payload do dispatch, o conjunto de limites não
pode ser considerado operacionalmente completo.

### Agentes e Attention

**Implementado:**

- roster seguro de managed agents;
- presença e atividade separadas;
- modelo configurado;
- associação local com projeto/missão;
- schema de Attention restrito a timeout, bloqueio, decisão, handoff, relay e
  OAuth;
- draft de modelo revisado no Buzz Desktop.

Os produtores atuais do `App` criam `decision`, `handoff` e `blocked`. Timeout,
relay e OAuth ainda não têm produtores automáticos.

**Limite conhecido:** um evento recente do feed também preenche hoje o campo
`lastResponseAt` do roster. Isso pode superestimar a “última resposta”; a Chain
continua usando a verificação estrita de resposta ligada ao dispatch.

## Validação automatizada atual

Comando executado:

```bash
pnpm --filter buzz-cockpit test
```

Resultado: **49 de 49 testes passaram**.

### Node/server — 15

- allowlist e stdin do CLI;
- validação de IDs e limites;
- caminho content-addressed de mídia;
- hash e limite de mídia;
- validação e atomicidade do estado;
- limpeza de anexos temporários;
- redaction de identidade;
- credencial isolada do agent draft;
- projeção segura do roster;
- rotas HTTP, health, envio e mídia.

### Vitest — 34 em cinco arquivos

| Área | Testes |
| --- | ---: |
| Importação de projetos | 4 |
| Handoff e guarda do loop | 8 |
| Missão de conversa contínua | 4 |
| Normalização/apresentação de conversa | 12 |
| Timeline | 6 |

TypeScript e o build Vite também passaram na última verificação completa. O
Biome concluiu sem erro e reportou 12 avisos já conhecidos em `styles.css`: oito
de ordem de especificidade e quatro usos de `!important` dentro da regra de
redução de movimento.

## Validação visual e live já realizada

Durante a implementação:

- o browser carregou SHELLHOUSE, Methylia e Welcome com dados reais;
- a troca SHELLHOUSE → Methylia passou por um estado vazio/loading antes da nova
  timeline, sem mostrar mensagens do projeto anterior;
- Methylia estabilizou com 550 eventos reconciliados e SHELLHOUSE com 484 na
  observação correspondente;
- imagens permaneceram visíveis nos dois projetos;
- Reader removeu ruído sem remover resultados e mídia;
- o console do browser não apresentou erro na validação final daquele ciclo.

Como os canais continuam vivos, contagens são snapshots e não invariantes do
produto.

## Matriz dos testes de aceitação originais

| Critério | Estado | Evidência ou lacuna |
| --- | --- | --- |
| Original e cockpit mostram a mesma conversa | Parcial live | Ambos leem o mesmo relay; falta registrar um envio real do cockpit e conferir nos dois lados. |
| Nenhuma API/provider pago adicional | Concluído | Arquitetura usa apenas CLI, relay e credenciais existentes. |
| Refresh restaura projeto, missão, thread e view | Parcial automatizado | Estado atômico e helpers existem; não há teste integrado de App/browser para restauração da view. |
| Resposta do agente correto atualiza a etapa | Parcial automatizado | A lógica exige autor + reply/root/thread, mas não há teste integrado de `reconcileResponses`; falta missão live. |
| Menção narrativa não cria handoff | Concluído | Detector e testes exigem marcador + tag `p`. |
| Proposta explícita entra na Chain e pode ser encaminhada | Parcial automatizado | Detector de domínio tem testes; fila e encaminhamento pela UI não têm E2E. |
| Todos os limites encerram o loop | Parcial | Cinco guardas ligadas; quatro contadores ainda não chegam do composer. |
| Reabrir não duplica prompts | Parcial automatizado | Importação e missão contínua são testadas; não há ensaio integrado de interrupção/reabertura. |
| Attention não vira inbox | Concluído | Só tipos de exceção definidos entram na fila. |
| Status aparecem em texto | Concluído | Badges e Chain têm labels textuais. |
| Arquivo enviado aparece no Buzz original | Pendente live | Rota e limpeza têm testes; falta envio real cruzado. |
| Buzz instalado não é modificado | Concluído | Alterações ficam no fork e no estado próprio do cockpit. |

## Pendências reais antes de chamar a primeira entrega de completa

1. Executar uma missão real do início ao fim.
2. Confirmar mensagem e anexo enviados pelo cockpit dentro do Buzz Desktop.
3. Observar uma resposta real mudar `relay_accepted` para `response_received`.
4. Observar um handoff explícito e encaminhá-lo pela Isa.
5. Ligar critic cycle, retry, no-novelty e initial specialists ao fluxo do
   composer ou remover a promessa operacional desses campos.
6. Corrigir a semântica de `lastResponseAt` no roster.
7. Adicionar paginação completa à Mission Workspace se threads puderem exceder
   500 eventos.
8. Proteger `loadMissionMessages` com token ou cancelamento: uma leitura lenta da
   missão A ainda pode terminar depois da missão B e sobrescrever a timeline.
9. Resolver os avisos CSS conhecidos do Biome quando houver uma rodada de
   refinamento técnico.
10. Depois da funcionalidade validada, definir a direção visual final com
   referências do Mobbin.

## O que não deve ser feito para fechar essas pendências

- criar API própria de LLM;
- copiar mensagens para um banco novo;
- alterar o protocolo do Buzz;
- substituir o Desktop;
- criar inbox global de todas as falas;
- automatizar handoff baseado apenas em menção;
- promover online/working/accepted a resposta;
- expandir o adaptador para execução arbitrária de shell.
