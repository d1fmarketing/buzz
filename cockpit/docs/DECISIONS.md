# Decisões de produto e engenharia

Este registro preserva as escolhas tomadas durante a construção do Buzz
Cockpit. Ele existe para evitar que uma refatoração futura recrie os problemas
que motivaram o frontend novo.

## D-01 — O cockpit é um segundo frontend, não um substituto

**Decisão:** manter `cockpit/` como pacote independente de `desktop/`.

**Motivo:** RJ deve poder usar o Buzz Desktop original a qualquer momento. Os
dois frontends precisam alcançar os mesmos canais, threads, agentes, arquivos e
relay, sem compartilhar código de apresentação nem exigir uma migração.

**Consequência:** o cockpit não altera `/Applications/Buzz.app`, não sobrescreve
configurações do Desktop e pode ser iniciado ou encerrado separadamente.

## D-02 — Reutilizar a infraestrutura existente sem API de LLM

**Decisão:** toda ação passa pelo `buzz` CLI já instalado e autenticado.

**Motivo:** OAuth, assinatura e acesso aos modelos já funcionam nos runtimes do
Buzz. Um segundo backend de agentes ou chamadas diretas a provedores criaria
custo, credenciais e divergência desnecessários.

**Consequência:** o adaptador não contém LLM, não lê chaves de API de OpenAI ou
Anthropic e não decide qual agente responde. Ele apenas traduz ações conhecidas
da interface em comandos permitidos do CLI.

## D-03 — Um projeto corresponde a um workspace de conversa isolado

**Decisão:** cada canal ativo `stream` ou `forum` do Buzz é importado como um
projeto local, identificado pelo UUID estável do canal.

**Motivo:** uma timeline global com tags de projeto não resolve o problema de
orientação. Ao trocar de projeto, RJ quer trocar todo o contexto e ver somente
o histórico daquele projeto.

**Consequência:** `/projects/:projectId` é o único lugar onde a conversa contínua
de um projeto aparece. A antiga rota global `/activity` volta para o seletor de
projetos.

## D-04 — Buzz continua sendo a fonte canônica das conversas

**Decisão:** o histórico recebido, respostas, edições e anexos não são copiados
para um novo banco. O prompt outbound é mantido dentro do dispatch local para
explicar a Chain.

**Motivo:** os dois frontends precisam mostrar a mesma conversa e continuar
funcionando mesmo que o arquivo local do cockpit seja removido.

**Consequência:** o cockpit recarrega o histórico do relay pelo CLI. O JSON
local guarda vínculos de projetos, missões, threads, briefs, prompts outbound,
dispatches, limites e estado visual, não um cache independente das respostas e
eventos recebidos.

## D-05 — Reader filtra; Operator preserva a conversa operacional

**Decisão:** remover ruído operacional apenas na apresentação Reader.

**Motivo:** ledgers, recibos de supersession, readbacks em massa e caminhos
internos poluíam a leitura humana, mas continuam úteis para auditoria e não
podem ser apagados do Buzz.

**Consequência:** `presentMessagesForReader` filtra ou simplifica mensagens para
Reader sem alterar a projeção de conversa usada pelo Operator. Antes dessa
separação, eventos de edição `kind 40003` já são incorporados à mensagem-alvo;
portanto, Operator preserva o conteúdo operacional reconciliado, não um log cru
de cada evento do protocolo.

## D-06 — Não existe inbox global de mensagens normais

**Decisão:** organizar conversa por projeto e reservar Attention para exceções.

**Motivo:** outra inbox reproduziria a perda de contexto do aplicativo original.
O que importa globalmente não é toda fala, mas somente o que bloqueia ou requer
uma decisão.

**Consequência:** o schema de Attention admite timeout, bloqueio, falha de
relay/OAuth, decisão humana ou handoff explícito. O `App` produz hoje decisão,
handoff e bloqueio; os demais produtores ainda precisam ser ligados. Mensagens
normais permanecem na timeline do projeto correspondente.

## D-07 — Estados de transporte e resposta permanecem separados

**Decisão:** `sent`, `relay_accepted`, `working` e `response_received` são etapas
distintas.

**Motivo:** presença online ou aceitação pelo relay não prova que o agente
respondeu nem que executou a tarefa.

**Consequência:** uma resposta só é reconciliada quando existe um evento novo do
agente correto, ligado ao dispatch por reply, root ou thread e posterior ao
envio.

## D-08 — Handoff exige intenção explícita e menção válida

**Decisão:** uma menção narrativa não cria um próximo passo automaticamente.

**Motivo:** agentes podem citar colegas sem delegar trabalho. Transformar toda
menção em dispatch geraria loops falsos.

**Consequência:** o detector exige um marcador textual de handoff e ao menos uma
tag `p` que corresponda a um agente conhecido. A proposta entra na fila e a Isa
prepara o próximo dispatch.

## D-09 — O loop é governado no frontend, não por um supervisor paralelo

**Decisão:** limites e estado da Chain vivem no domínio local do cockpit; o envio
continua usando o CLI normal.

**Motivo:** o Buzz já executa agentes e transporte. O único comportamento novo
necessário é controlar profundidade, orçamento, repetição e handoffs.

**Consequência:** a guarda local bloqueia dispatches fora do orçamento, mas não
inventa outro runtime, fila, protocolo ou banco.

## D-10 — Mudanças de modelo continuam revisadas no Buzz Desktop

**Decisão:** o cockpit cria somente um `agents draft-update` para o agente
selecionado.

**Motivo:** o Desktop existente já é a superfície de revisão e salvamento da
configuração de agentes.

**Consequência:** o adaptador obtém somente a credencial do managed agent
selecionado, envia o draft e deixa a confirmação final para o aplicativo
original.

## D-11 — Mídia é carregada pelo caminho autenticado existente

**Decisão:** imagens e vídeos usam `buzz media get` por uma rota localhost
content-addressed.

**Motivo:** URLs do relay podem exigir a identidade do Buzz e não devem expor
credenciais ao navegador.

**Consequência:** o adaptador valida o nome `sha256.ext`, limita a resposta a
25 MB e confirma o hash do conteúdo antes de devolver os bytes.

## D-12 — Primeiro funcional, direção visual depois

**Decisão:** concluir o fluxo e a legibilidade antes do redesign final com
referências do Mobbin.

**Motivo:** o problema principal era perder conversas, respostas, threads e
mídia. A identidade visual definitiva só deve ser escolhida sobre um produto
funcional e validável.

**Consequência:** a interface atual é uma base operacional completa, mas não é
tratada como direção visual final.
