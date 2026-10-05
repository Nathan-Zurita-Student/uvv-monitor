# Bot do Telegram no Google Apps Script

O Web App do Apps Script é o webhook do bot: recebe cada toque em botão (`callback_query`) e cada
comando, atualiza a planilha e edita a própria mensagem na hora. Ele também envia os lembretes
pedidos no Telegram. A coleta continua no GitHub Actions.

## Arquivos

- `Code.gs`: funções de entrada (`doPost`, `processReminders`, `setupWebhook`, `webhookInfo`,
  `sendPanel`, `refreshCache`) e o atendimento dos botões de link de mensagens antigas (`doGet`).
- `Bot.gs`: gerado por `npm run build:gas` a partir de `src/bot` e `src/gas`. Não edite à mão.
- `appsscript.json`: fuso horário, runtime V8, escopos (planilha e requisições externas) e Web App.

## Primeira publicação

1. Execute `npm run sheets:setup` (ou o monitor) para criar as abas na planilha.
2. Em [script.google.com](https://script.google.com), crie um projeto com `Code.gs`, `Bot.gs` e
   `appsscript.json` desta pasta.
3. Em **Configurações do projeto → Propriedades do script**, crie:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `GOOGLE_SHEET_ID`
   - `TELEGRAM_WEBHOOK_SECRET`: sequência aleatória longa, com pelo menos 32 caracteres.
   - `WEB_APP_URL`: a URL `/exec` do App da Web (passo 4). No editor, o Apps Script só conhece
     a URL de teste `/dev`, que exige login e não serve para o Telegram.
4. **Implantar → Nova implantação → App da Web**: executar como você, acesso: qualquer pessoa.
   Copie a URL `/exec` para a propriedade `WEB_APP_URL`.
5. Execute `setupWebhook` no editor. O resultado mostra a URL `/exec` com `secret=***`.
6. Em **Acionadores**, adicione `processReminders` baseado em tempo, a cada 5 minutos.
7. O monitor do GitHub Actions detecta o webhook sozinho (`getWebhookInfo`) e deixa de ler o
   Telegram por `getUpdates`; `TELEGRAM_WEBHOOK_ENABLED=true` só força esse comportamento.
8. Execute `sendPanel` para receber o painel e testar os botões.

## Atualização

Depois de mudar o código do bot:

1. `npm run build:gas` (o `npm run check` falha se `Bot.gs` estiver desatualizado). O arquivo é
   minificado por completo para ficar menor ao colar no editor.
2. Cole `Code.gs` e `Bot.gs` no editor e salve.
3. **Implantar → Gerenciar implantações → ✏️ Editar → Versão: Nova versão → Implantar**. Editar a
   implantação existente mantém a mesma URL `/exec`.

## Como o webhook responde

O `doPost` responde com `HtmlService`, que devolve HTTP 200 direto. O `ContentService` responde com
redirecionamento, e o Telegram trataria isso como falha e reenviaria o update. Mesmo assim, cada
`update_id` é registrado no cache por 6 horas, então uma entrega repetida não executa a ação de
novo. As ações também são idempotentes: tocar duas vezes em "Concluir" não muda nada.

### Velocidade

Abrir e ler a planilha leva 2 segundos ou mais, então o bot guarda uma cópia comprimida das abas
no `CacheService` (atividades separadas do estado do usuário):

1. O toque é respondido antes de qualquer leitura (o botão para de carregar na hora).
2. A mensagem é redesenhada a partir da cópia, em cerca de 0,1 s.
3. Só depois a ação é gravada na planilha, e a cópia é atualizada junto.

A cópia é refeita da planilha quando some do cache, quando um toque cita uma atividade ou um
lote que ela não tem (coleta nova), ao fim de cada coleta (o monitor chama o webhook com
`{"uvv":"refresh"}`) e pelo `processReminders` se tiver mais de 30 minutos. `refreshCache` faz
isso à mão e mostra um resumo.

Use `webhookInfo` para conferir a situação (`pending_update_count`, `last_error_message`).
`deleteWebhook` volta ao modo de reserva, em que o GitHub Actions lê os cliques por `getUpdates`.

Nunca coloque os valores das propriedades no repositório.

## Conversa com GPT

O webhook atende mensagens livres com `gpt-5.4-mini`, usando as atividades da planilha e as
últimas três trocas da conversa (expiram após 48 horas). O Gemini continua nas análises automáticas
do monitor. Exemplos:

- “O que eu preciso fazer essa semana?”
- “Marca na minha agenda dia nove deste mês, às 14h, como urgente, para revisar capítulos 1 e 2.”
- “Me lembra de resolver essa atividade amanhã às 9h.”
- “Já terminei a atividade UVV-ABC123, marca como concluída.”

Quando faltar assunto, data ou horário, o bot pergunta. Lembretes solicitados para a agenda viram
eventos pessoais no Google Calendar (30 minutos por padrão), com descrição do que fazer e destaque
vermelho quando urgentes. Todo lembrete também envia uma mensagem no Telegram pelo acionador
`processReminders` (até 5 minutos após o horário). Uma entrega repetida do mesmo update não cria
outro evento. O bot confirma apenas depois de gravar o evento e o lembrete.

Depois de publicar a nova versão de `Bot.gs` e `Code.gs`, execute no GitHub Actions o workflow
**Configurar conversa do Telegram**. Ele sincroniza a autorização Google já existente e, se
cadastrada, a chave `OPENAI_API_KEY`, pelo webhook autenticado. Não imprime os valores. Não exige
novos escopos no Apps Script. Se a chave ainda não existir, cadastre o secret `OPENAI_API_KEY` no
GitHub e rode esse workflow novamente, ou adicione a propriedade diretamente no Apps Script.

Propriedades opcionais no Apps Script:

| Propriedade                   | Padrão | Efeito                                  |
| ----------------------------- | ------ | --------------------------------------- |
| `GPT_CHAT_ENABLED`            | `true` | `false` pausa só a conversa GPT         |
| `GPT_CHAT_MONTHLY_BUDGET_USD` | `2.5`  | Teto mensal de gasto do bot, em dólares |
| `GPT_CHAT_MAX_CALLS_PER_DAY`  | `30`   | Máximo de pedidos ao GPT por dia local  |

`/gastos` mostra o consumo estimado/medido do bot, sem consultar o saldo da OpenAI. O bot reserva
um teto conservador antes de cada chamada e ajusta pelo consumo retornado; falhas sem informação
de consumo mantêm a reserva. Ao atingir um limite, comandos, botões e lembretes continuam ativos.
`/esquecer` apaga a memória da conversa; `/cancelar` também encerra a escolha de horário pendente.
Esses comandos não consomem tokens nem apagam lembretes já criados.

Execute `conversationInfo` no editor para conferir chave presente, modelo e orçamento sem expor
credenciais ou gastar créditos. As abas `personal_reminders` e `conversation_operations` são
criadas automaticamente. O GPT propõe apenas responder, criar lembrete ou mudar status; não recebe
acesso para apagar eventos, mudar prazos oficiais ou enviar mensagens a terceiros. Mensagens de
outros chats são recusadas antes de consultar a IA. A conversa imediata requer o webhook: o modo
de reserva `getUpdates` continua atendendo os comandos tradicionais.
