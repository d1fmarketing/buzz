# Operação local

## Pré-requisitos

- macOS com o Buzz Desktop já instalado e autenticado;
- CLI do Buzz disponível no bundle do aplicativo ou no `PATH`;
- configuração de managed agents existente;
- relay acessível;
- Node/pnpm do workspace do repositório.

O cockpit não exige chave de API de LLM. A identidade e os acessos já usados
pelo Buzz são reutilizados localmente.

## Iniciar em desenvolvimento

Na raiz do repositório:

```bash
pnpm --filter buzz-cockpit dev
```

Abra:

```text
http://127.0.0.1:4317
```

O modo de desenvolvimento executa o mesmo adaptador e usa Vite como middleware.
O processo precisa permanecer em execução enquanto o cockpit estiver aberto.

## Iniciar a versão compilada

```bash
pnpm --filter buzz-cockpit build
pnpm --filter buzz-cockpit preview
```

`preview` serve `cockpit/dist` e mantém as rotas SPA funcionando por fallback
para `index.html`.

## Encerrar

No terminal que está executando o cockpit, use `Ctrl+C`. O servidor trata
`SIGINT` e `SIGTERM` e fecha o middleware Vite quando aplicável.

Encerrar o cockpit não encerra o Buzz Desktop nem remove eventos do relay.

## Verificar a conexão

Abra ou consulte:

```text
http://127.0.0.1:4317/api/health
```

Uma instalação pronta responde com a forma:

```json
{
  "ok": true,
  "cliAvailable": true,
  "relayConfigured": true,
  "authenticated": true
}
```

O endpoint informa somente booleanos e não devolve caminho, URL ou identidade.

## Configuração opcional

| Variável | Uso |
| --- | --- |
| `BUZZ_COCKPIT_PORT` | Porta local; padrão `4317`. |
| `BUZZ_COCKPIT_RELAY_URL` | Sobrescreve o relay descoberto nos managed agents. |
| `BUZZ_CLI_PATH` | Aponta para outro executável existente do Buzz. |
| `BUZZ_COCKPIT_STATE_PATH` | Altera o caminho do JSON local. |
| `BUZZ_COCKPIT_AGENTS_PATH` | Altera o caminho do arquivo de managed agents. |

Exemplo sem credenciais:

```bash
BUZZ_COCKPIT_PORT=4318 pnpm --filter buzz-cockpit dev
```

Evite definir identidade privada manualmente. O caminho normal é usar a
identidade já armazenada pelo Buzz Desktop no Keychain.

## Uso cotidiano

### Ler um projeto

1. Abra `/`.
2. Escolha o projeto.
3. Aguarde a carga progressiva do histórico.
4. Use `Todas as falas`, um agente, `Handoffs` ou `Mídia` para reduzir a
   timeline.
5. Selecione uma thread quando quiser isolar uma conversa.
6. Permaneça em Reader para leitura humana.

Trocar de projeto troca toda a conversa. Não é necessário procurar tags de
projeto dentro de uma inbox global.

### Enviar para um agente

1. Entre no projeto correto.
2. Mude para Operator.
3. Escolha o agente e a conversa de destino.
4. Escreva o brief e, se necessário, anexe JPEG, PNG, GIF, WebP ou MP4.
5. Envie com o botão ou `Command+Enter`.
6. Acompanhe `planned`, `sent` e `relay accepted` sem tratá-los como resposta.
7. Aguarde a fala nova do agente para `response received`.

O primeiro envio da página de projeto cria a missão local `Conversa contínua`.
Isso organiza o loop, mas a mensagem real vai para o canal do Buzz.

### Operar uma missão

1. Crie a missão dentro do projeto.
2. Defina título, objetivo e canal principal.
3. Use Conversation para ler e Chain para acompanhar os recibos.
4. Vincule uma thread existente pelo event ID quando necessário.
5. Quando surgir um próximo especialista explícito, revise a fila de handoff.
6. Prepare o dispatch filho no Operator.
7. Pause, marque `Decisão do RJ` ou conclua conforme o estado real. `blocked` é
   criado automaticamente quando um dispatch falha; não existe botão manual de
   bloqueio nesta versão.

### Mudar o modelo de um agente

1. Abra `/agents` em Operator.
2. Selecione o agente e prepare a alteração de modelo.
3. O cockpit envia `agents draft-update` com a credencial daquele managed agent.
4. Revise e salve a mudança no Buzz Desktop original.

O draft não é confirmação de que o modelo foi alterado.

## Persistência e recuperação

O estado padrão fica em:

```text
~/Library/Application Support/xyz.block.buzz.cockpit/state.json
```

O arquivo guarda organização, briefs, objetivos, prompts outbound e estado da
Chain. Eventos recebidos, respostas e arquivos reais continuam canônicos no
Buzz.

### Se o arquivo desaparecer

Na próxima abertura, os canais ativos são reimportados como projetos. Missões,
vínculos manuais e estado da Chain precisam ser reconstruídos, mas o histórico
do Buzz continua disponível.

### Antes de testar uma recuperação

Encerre o cockpit e faça uma cópia do `state.json`. Prefira renomear ou copiar o
arquivo, nunca apagar diretamente. Depois, inicie novamente e confirme os
projetos antes de remover qualquer backup.

### Estado inválido

Se `/api/state` responder `STATE_INVALID`, preserve o arquivo para diagnóstico.
O adaptador não sobrescreve automaticamente JSON inválido. Corrija a estrutura
ou use uma cópia válida antes de reiniciar o fluxo.

## Diagnóstico

### Browser mostra `ERR_CONNECTION_REFUSED`

O processo local não está escutando na porta. Confirme o terminal de `dev` ou
`preview` e a porta configurada. Isso não indica falha do relay por si só.

### `cliAvailable: false`

O executável não foi encontrado ou não é executável. Confirme a instalação do
Buzz em `/Applications/Buzz.app` ou informe `BUZZ_CLI_PATH` para um CLI existente.

### `relayConfigured: false`

O arquivo de managed agents não contém um `relay_url` válido, ou o caminho está
incorreto. Primeiro confirme o estado no Buzz Desktop; só depois use um override.

### `authenticated: false`

A identidade do Buzz não pôde ser lida. Abra o aplicativo original e confirme a
sessão/Keychain. Não cole identidade privada no browser ou em arquivos de
documentação.

### Projeto esperado não aparece

O autoimport considera somente canais ativos dos tipos `stream` e `forum`.
Canais arquivados e DMs não viram projetos automaticamente. Um conflito de
vínculo é reportado em vez de o cockpit adivinhar o projeto correto.

### Histórico parece incompleto

Na página do projeto, aguarde a paginação terminar e observe se aparece aviso de
truncamento. Em uma missão, lembre que o limite atual é 500 eventos por thread e
o fallback de canal não pagina além de 200.

### Imagem ou vídeo não abre

Possíveis causas:

- blob maior que 25 MB;
- hash do conteúdo diferente do nome content-addressed;
- arquivo ausente no relay;
- sessão/relay indisponível;
- MIME type não reconhecido para renderização inline.

Verifique se o mesmo anexo abre no Buzz Desktop antes de alterar o cockpit.

### Agente aparece online, mas não respondeu

Isso é um estado válido. Presença, atividade, relay accepted e resposta são
evidências diferentes. A resposta da Chain exige um novo evento do agente
correto ligado ao dispatch.

### `last response` do roster parece recente demais

Nesta versão, um evento recente do feed pode preencher esse campo mesmo sem ser
reply. Use a conversa/Chain como fonte de verdade para confirmar resposta até o
roster receber uma separação mais estrita.

## Inspeção read-only útil

Os seguintes endpoints não enviam mensagens nem mudam o Buzz:

```text
GET /api/health
GET /api/state
GET /api/channels
GET /api/agents
GET /api/feed
GET /api/presence?pubkeys=...
GET /api/channels/:id/messages
```

`PUT /api/state`, `POST /api/messages` e `POST /api/agents/draft-update` mudam
estado ou criam ações; use-os apenas por meio da interface normal, salvo um teste
deliberado.

## Verificação do repositório

### Testes

```bash
pnpm --filter buzz-cockpit test
```

Cobertura atual: 15 testes Node do servidor/adaptador e 34 testes Vitest do
domínio, dados e timeline.

### Build

```bash
pnpm --filter buzz-cockpit build
```

Executa TypeScript sem emissão e gera o bundle Vite.

### Verificação completa

```bash
pnpm --filter buzz-cockpit check
```

Executa Biome, testes e build. A folha de estilos ainda produz avisos conhecidos
de especificidade e `!important` ligados à redução de movimento; eles não fazem
o comando falhar, mas estão registrados no estado da implementação.

## Regras de segurança operacional

- não exponha o servidor em `0.0.0.0` sem um novo desenho de autenticação;
- não adicione endpoint que aceite um comando ou array arbitrário do shell;
- não grave identidade, `auth_tag` ou prompt de sistema no browser;
- não trate o draft de modelo como mudança concluída;
- não trate relay accepted, online ou working como resposta;
- não remova o aplicativo Buzz original para operar o cockpit;
- preserve o JSON local antes de qualquer recuperação manual.
