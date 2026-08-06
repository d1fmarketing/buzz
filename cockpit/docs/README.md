# Documentação do Buzz Cockpit

Esta pasta registra o produto, a arquitetura, a operação e o estado real da
implementação do novo frontend local para o Buzz. O objetivo é permitir que
qualquer continuação do trabalho parta do que existe no código, sem reconstruir
decisões a partir das conversas.

## Estado resumido

Em 6 de agosto de 2026, o cockpit já funciona como um segundo caminho local para
a mesma infraestrutura do Buzz:

- o Buzz Desktop original permanece instalado e intacto;
- o navegador usa o mesmo CLI, relay, identidade, agentes, canais, threads e
  arquivos do Buzz;
- oito canais ativos do Buzz estão importados como projetos separados;
- cada projeto abre somente o seu próprio histórico e a sua própria timeline;
- Reader oferece a conversa limpa para leitura e Operator mantém eventos e
  controles operacionais;
- imagens, vídeos e arquivos aparecem dentro da conversa;
- missões, Chain, dispatches, handoffs, roster e Attention estão implementados;
- a suíte atual passa com 15 testes Node do servidor/adaptador e 34 testes do
  frontend/domínio.

O fluxo completo de uma missão real, com resposta e handoff de agentes ao vivo,
ainda precisa ser exercitado como validação final. O estado local observado no
momento desta documentação contém oito projetos, mas nenhuma missão ou dispatch
real criado pelo cockpit.

## Mapa da documentação

- [Produto e experiência](./PRODUCT.md): modelo mental, telas, Reader/Operator,
  conversas, mídia, agentes, Attention e loop.
- [Arquitetura técnica](./ARCHITECTURE.md): componentes, dados, API localhost,
  mapeamento para o CLI, persistência e segurança.
- [Operação local](./OPERATIONS.md): como iniciar, verificar, usar, recuperar e
  diagnosticar o cockpit.
- [Estado da implementação](./IMPLEMENTATION-STATUS.md): histórico dos commits,
  funcionalidades entregues, evidências de validação e pendências reais.
- [Decisões de produto e engenharia](./DECISIONS.md): escolhas que não devem ser
  revertidas por acidente nas próximas iterações.

## Caminho de leitura recomendado

Para entender o produto, comece por [Produto e experiência](./PRODUCT.md). Para
continuar o desenvolvimento, leia depois [Arquitetura técnica](./ARCHITECTURE.md)
e [Decisões](./DECISIONS.md). Para rodar ou diagnosticar, use
[Operação local](./OPERATIONS.md). O que está ou não concluído fica concentrado
em [Estado da implementação](./IMPLEMENTATION-STATUS.md).

## Fonte de verdade

Esta documentação descreve o commit atual da branch `codex/companion-v1`. Em
caso de divergência, o código e os testes são a fonte técnica de verdade. Os
eventos recebidos, arquivos e respostas dos agentes continuam canônicos no
Buzz; o arquivo local guarda organização, estado operacional, briefs/objetivos
e o prompt outbound registrado em cada dispatch.
