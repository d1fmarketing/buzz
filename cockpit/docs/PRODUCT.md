# Produto e experiência

## Objetivo

O Buzz Cockpit é um frontend local para acompanhar e operar os mesmos agentes do
Buzz com uma organização centrada em projetos. Ele resolve três problemas do
aplicativo original para este fluxo de trabalho:

1. conversas de projetos diferentes não devem competir na mesma inbox;
2. falas, threads, respostas e mídia precisam permanecer legíveis em sequência;
3. o trabalho entre agentes precisa mostrar uma Chain sem confundir transporte,
   presença e resposta real.

O cockpit não substitui o Buzz Desktop. Ele oferece uma segunda visualização e
um segundo composer para a mesma infraestrutura.

## Modelo mental

### Projeto

Um projeto importado representa um canal ativo do Buzz. Projetos novos recebem o
ID determinístico `buzz-channel:<channel-uuid>`. Migrações e vínculos legados
podem preservar outro ID local; `buzzChannelId` é a identidade canônica do
vínculo.

Ao abrir um projeto, o cockpit carrega somente o canal vinculado àquele projeto.
Ao trocar de projeto, a timeline anterior é descartada antes da nova carga. Não
existe uma timeline global com etiquetas de projeto.

### Missão

Uma missão reúne objetivo, brief, especialistas, conversas vinculadas,
dispatches, limites e estado da Chain. Ela pertence obrigatoriamente a um único
projeto.

O composer da página de projeto usa uma missão local idempotente chamada
`Conversa contínua`, com ID `project-conversation:<channel-uuid>`. Ela é criada
somente no primeiro dispatch do projeto e reutilizada depois.

### Conversa e thread

O canal é o contêiner do projeto; uma thread é uma conversa específica dentro
dele. Uma missão pode vincular mais de uma thread, inclusive de canais ou DMs
explicitamente selecionados pelo Operator.

### Dispatch

Um dispatch registra uma solicitação da Isa para um agente e a sequência de
recibos observados. Esse registro é local; a mensagem real continua no Buzz.

## Navegação

| Rota | Finalidade |
| --- | --- |
| `/` | Escolher projeto e ver o resumo dos workspaces importados. |
| `/projects/:projectId` | Abrir a conversa contínua e o histórico isolado do projeto. |
| `/projects/:projectId/missions/:missionId` | Operar uma missão em Conversation ou Chain. |
| `/agents` | Ver nome, presença, atividade, modelo e contexto local atual. |
| `/attention` | Ver somente exceções que exigem ação ou decisão. |
| `/activity` | Rota legada; redireciona para `/`. |

Os parâmetros de visualização são:

- `?mode=operator`: habilita Operator; sem esse parâmetro, o padrão é Reader;
- `?view=chain`: mostra a Chain na missão; sem ele, o padrão é Conversation.

Uma rota de missão só é válida quando a missão realmente pertence ao projeto da
URL. Caso contrário, o cockpit volta para um caminho seguro.

## Página do projeto

A página do projeto é o equivalente organizado à conversa do canal no Buzz.
Ela contém:

- nome e contexto do projeto;
- timeline cronológica do canal;
- total de falas, participantes e mídia;
- seletor de thread;
- filtros por agente, handoff e mídia;
- composer do Operator;
- acesso às missões pertencentes ao projeto.

### Histórico completo do projeto

O histórico do canal é lido em páginas de 200 eventos, recuando pelo cursor
`before` até a última página. Cada página é pintada progressivamente, para que o
usuário não precise esperar todo o canal terminar de carregar.

Depois da carga inicial, o projeto consulta novidades a cada 12 segundos usando
`since`. Mensagens são deduplicadas pelo event ID e ordenadas por timestamp e ID.
Um contador de requisição impede que uma resposta atrasada de outro projeto
reapareça depois de uma troca de rota.

Essa paginação completa é específica da página do projeto. Na Mission Workspace,
cada thread usa o limite atual de até 500 eventos do comando `messages thread`;
o fallback de canal não implementa ainda paginação adicional.

## Timeline de conversa

A timeline transforma eventos normalizados do Buzz em blocos de conversa com:

- nome, avatar e papel do autor;
- horário e identidade da mensagem;
- Markdown e GitHub Flavored Markdown;
- contexto da resposta;
- menções e referências de thread/evento;
- imagens, vídeos e arquivos anexos;
- status textual, nunca apenas cor.

### Edições

Eventos Buzz `kind 40003` são edições completas. O cockpit encontra a
mensagem-alvo pela tag `e`, escolhe a edição mais recente e substitui conteúdo,
anexos `imeta` e emojis compatíveis. A edição não aparece como uma segunda fala.

Isso acontece antes da separação Reader/Operator. Portanto, Operator mostra a
conversa operacional completa depois da reconciliação de edições, não o log cru
contendo os eventos `40003` independentes.

### Mídia

O frontend exibe:

- imagens inline e em galeria;
- lightbox para navegação em tela cheia;
- vídeo MP4 nativo;
- cartões para outros anexos reconhecidos na conversa.

O composer aceita, nesta versão, JPEG, PNG, GIF, WebP e MP4, com até 20 arquivos
por envio. Essa é a allowlist do cockpit, não uma declaração sobre todos os
formatos que futuras versões do CLI possam suportar.

## Reader e Operator

### Reader

Reader é a camada para RJ ler o que o time realmente discutiu. Ele mantém
resultados, argumentos, decisões, bloqueios e mídia, mas reduz ruído de
orquestração estrita.

Atualmente, a apresentação pode ocultar:

- ledgers operacionais da Orla;
- recibos exclusivos de reconciliação ou supersession;
- readbacks em massa como `285/285 eventos`;
- gates técnicos de provenance/readback;
- mensagens de tracking sem contribuição substantiva.

Também troca referências como `OUTBOX/...` e `PLANS/...` por linguagem humana e
simplifica termos de supersession. Mensagens próprias e mensagens com anexos não
são removidas por esse filtro.

O filtro calcula internamente quantos itens foram ocultados, mas a interface
ainda não renderiza esse contador. Nada é apagado do Buzz.

### Operator

Operator é a camada da Isa para agir. Ela mantém as entradas operacionais que
Reader esconde e habilita:

- composer;
- criação e controle de missões;
- vínculo manual de threads;
- preparação de handoffs;
- drafts de mudança de modelo;
- event IDs e recibos necessários para auditoria.

Operator ainda usa a mesma normalização da timeline e a reconciliação de edições
descrita acima; não é um inspector bruto do protocolo Nostr.

## Mission Workspace

A missão oferece duas projeções da mesma atividade.

### Conversation

Reúne as mensagens das conversas vinculadas e permite filtrar todas as falas,
um participante específico ou somente mídia. O painel lateral mostra
especialistas, limites e threads ligadas à missão.

### Chain

Ordena os recibos dos dispatches em uma linha cronológica. Cada item mostra ator,
destino, branch, resumo e horário. A Chain não transforma um estado em outro:

```text
Isa → agente: planejado
Isa → relay: enviado
relay: aceitou
agente: trabalhando
agente: respondeu
agente: propôs próximo especialista
Isa: realizou handoff
Isa: incorporou na síntese
missão: concluída ou bloqueada
```

## Loop dos agentes

### Fluxo implementado

1. A Isa escolhe agente, conversa de destino, prompt e arquivos.
2. O cockpit valida missão e destino contra o contexto atual e exige que o
   agente exista no roster conhecido. Membership e autorização do canal
   continuam sendo validados pelo Buzz.
3. A guarda local verifica os limites que recebe do composer.
4. O dispatch é persistido como `planned` antes do envio.
5. O prompt recebe a convenção operacional curta do loop.
6. O adaptador envia a mensagem, menção e arquivos pelo CLI.
7. `sent` e `relay_accepted` são registrados separadamente.
8. O polling procura uma nova resposta assinada pelo agente escolhido e ligada
   ao dispatch por reply, root ou thread.
9. A resposta vira `response_received` somente depois desse evento real.
10. Um handoff explícito entra na fila para revisão e encaminhamento pela Isa.

### Convenção anexada ao prompt

O agente é instruído a:

- executar o trabalho da própria profissão;
- publicar resultado, evidência ou bloqueio;
- sugerir no máximo os próximos especialistas permitidos, com menção e motivo;
- mencionar a Isa no resultado final;
- não produzir ACK ou handoff sem contribuição;
- respeitar profundidade e dispatches restantes.

### Detecção de handoff

Um handoff só é reconhecido quando existem simultaneamente:

- um marcador como `next specialist`, `próximo especialista`, `handoff:` ou
  `encaminhar para`;
- uma tag `p` de menção;
- correspondência da menção com um agente conhecido.

Uma menção narrativa sem marcador não cria handoff. A proposta não envia nada
sozinha; ela aparece na fila `Próximos agentes propostos` para a Isa preparar o
dispatch filho.

### Limites padrão

| Limite | Valor | Estado atual |
| --- | ---: | --- |
| Especialistas iniciais | 4 | Configurado e exibido; não existe guarda correspondente. |
| Especialistas máximos | 7 | Ligado ao fluxo e coberto por teste. |
| Próximos agentes por resposta | 2 | Ligado ao fluxo e coberto por teste. |
| Profundidade de handoff | 3 | Ligado ao fluxo e coberto por teste. |
| Ciclos builder ↔ critic | 2 | A guarda existe, mas o composer não fornece o contador e não há teste direto. |
| Dispatches por missão | 16 | Ligado ao fluxo e coberto por teste. |
| Repetições por dispatch | 1 | A guarda existe, mas o composer não fornece o contador e não há teste direto. |
| Rodadas sem ganho material | 2 | A guarda tem teste direto, mas o composer não fornece o contador. |

O fluxo atual aplica de fato: missão ativa, total de dispatches, total de
especialistas, filhos por resposta e profundidade. `initialSpecialists` é apenas
configuração; critic e retry têm branches de guarda sem alimentação ou teste
direto; no-novelty tem guarda e teste, mas também não recebe contador do
composer. O conjunto não deve ser descrito como operacionalmente completo.

## Vocabulário de status

| Status | Significado |
| --- | --- |
| `planned` | O dispatch foi preparado e persistido localmente. |
| `sent` | O CLI devolveu um recibo de envio. |
| `relay_accepted` | O relay aceitou o evento e existe event ID. |
| `working` | Existe um sinal operacional de trabalho; não é resposta. |
| `response_received` | Um novo evento do agente correto foi reconciliado. |
| `handoff_proposed` | A resposta trouxe marcador e menção válidos. |
| `handed_off` | A Isa enviou um dispatch filho. |
| `incorporated` | A contribuição entrou na síntese. |
| `completed` | A etapa ou missão foi concluída. |
| `blocked` / `timed_out` | A etapa não pode continuar sem correção ou decisão. |

## Agentes

O roster combina a configuração segura dos managed agents com presença e
atividade observadas. A tela mostra nome, modelo, presença, atividade, último
evento observado e missão/projeto local associado. Função e persona reais não
são projetadas hoje pelo adaptador; o frontend usa o rótulo genérico
`Specialist`.

Existe uma limitação conhecida: a atividade recente vinda do feed é atualmente
copiada também para `lastResponseAt`, mesmo quando o evento não foi uma resposta
vinculada. A Chain continua exigindo uma resposta ligada ao dispatch, mas o
rótulo de última resposta no roster deve ser refinado em uma iteração futura.

## Attention

Attention não é outra inbox. O schema aceita:

- timeout;
- bloqueio;
- decisão aguardando RJ;
- handoff explícito aguardando Isa;
- falha de relay;
- falha de OAuth/identidade.

Os produtores implementados hoje criam apenas `decision`, `handoff` e `blocked`.
Timeout, relay e OAuth estão tipados, mas ainda não são gerados automaticamente
pelo `App`.

Ao encaminhar um handoff ou concluir a missão, os itens correspondentes são
resolvidos. Conversas normais nunca entram nessa fila.

## Fora do escopo desta fase

- substituir ou modificar o Buzz Desktop;
- criar API própria de LLM ou cobrança adicional;
- criar banco ou protocolo paralelo;
- executar comandos arbitrários do shell;
- manter o loop rodando quando Codex/cockpit está fechado;
- definir a direção visual final antes da etapa de referências Mobbin;
- afirmar que o Council Gauntlet está validado antes de uma missão real completa.
