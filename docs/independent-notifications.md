# Avisos independentes da coleta

Horários: **12h, 17h e 20h**, sempre em `America/Sao_Paulo`.

## O que muda

O resumo periódico não aguarda Playwright, análise por IA, instalação de dependências nem um
runner do GitHub. O Apps Script lê os dados salvos no Sheets e os status atuais do Telegram.
Até três prioridades são apresentadas com links e botões; tarefas concluídas/ignoradas ficam fora.
Às 20h há um horizonte de três dias, e às quartas/domingos uma revisão de sete dias.

Uma coleta antiga ou parcial **não** é apresentada como informação recém-verificada. O resumo
informa a última coleta finalizada e a situação de Portal/AVA, Gmail e Calendar. Nenhuma novidade
que ainda não foi coletada pode aparecer. Arquivos e novidades continuam sendo entregues pelo
coletor quando ele concluir; a separação não resolve a disponibilidade do Portal ou do GitHub.

## Ativação e teste

1. Publicar `apps-script/Code.gs` como Código.gs e `apps-script/Bot.gs` como Bot.gs no projeto existente.
2. Atualizar a implantação existente para uma nova versão, sem mudar o acesso do webhook.
3. Executar `sendDailyDigestTest` no editor e confirmar mensagem e botões no próprio Telegram.
4. Executar `setupDailyDigests`. Cria um token restrito e mantém o acionador `processReminders`
   a cada cinco minutos como reserva. Os resumos funcionam sem API de IA nem conta de faturamento.
5. No GitHub, variável de repositório `DAILY_DIGEST_EXTERNAL=true`: evita os painéis periódicos
   duplicados enviados pelo Node. Não desabilita novidades nem arquivos.

## Agendador primário gratuito (cron-job.org)

Não compartilhe a senha do Portal, token do Telegram, segredo do webhook, tokens Google ou dados
acadêmicos com o agendador. Ele recebe **somente** a URL pública /exec e `DAILY_DIGEST_TOKEN`.
Esse token só pode disparar o resumo do horário atual para o chat já configurado, sem retornar
dados, criar eventos ou alterar status. Obtenha-o nas propriedades do Apps Script, sem imprimir
em logs, commits ou capturas. Confirme com o usuário antes de transmitir essa credencial.

Configurar uma tarefa POST para a URL /exec **sem** `?secret=`:

```json
{ "uvv": "daily_digest", "token": "VALOR_DA_PROPRIEDADE_DAILY_DIGEST_TOKEN" }
```

Header: `Content-Type: application/json`. Timezone: `America/Sao_Paulo`.
Cron personalizado: `0,1,2,3,4 12,17,20 * * *` (tentativas nos cinco primeiros minutos).
Não publicar os resultados nem cadastrar status page pública. A resposta não traz dados
acadêmicos. O endpoint exige o token separado, mesmo que o segredo normal do webhook seja válido.

O comprovante `digest.sent.AAAA-MM-DD HH:mm` fica nas Script Properties, não no cache efêmero.
Chamadas normais repetidas não duplicam; envio só é marcado após confirmação do Telegram. Uma
interrupção exatamente entre o envio e a gravação ainda pode duplicar: não há transação distribuída
entre Telegram e Apps Script. O ScriptLock serializa chamadas e a retenção é de sete dias.

O limite do cron-job.org é 30 segundos. Se o endpoint exceder esse limite ou falhar, a reserva do
Apps Script tenta de novo durante a janela de uma hora. Validar a duração no teste real.
O retorno `sent` confirma envio; `idle` indica já entregue ou fora da janela; `disabled` indica
desativado; `unauthorized` indica token inválido. Um HTTP 200 isolado não prova que houve envio.

## Coletas e recuperação

O Apps Script tenta iniciar a coleta às 11h40, 16h40 e 19h40. O cron do GitHub é reserva (11h35,
16h35 e 19h35) e pode atrasar. Os slots lógicos continuam 12:00, 17:00 e 20:00. O slot legado
21:00 é aceito para compatibilidade, mas não consta em novos agendamentos.

Nenhum componente garante entrega no segundo exato: Telegram, internet, Apps Script e agendador
podem falhar. Registrar/testar a entrega e explicitar desatualização é parte do contrato.

## Checklist e retorno à versão anterior

- [ ] `npm run check` aprovado e regressões de timeout/mensagens cobertas.
- [ ] Nova implantação publicada, teste de resumo recebido e botões funcionais.
- [ ] `dailyDigestInfo` mostra enabled=true, tokenConfigured=true e horários corretos.
- [ ] Agendador privado ativo; chamada repetida retorna idle e não duplica.
- [ ] Variável do GitHub ativada; coleta nova termina e renova a memória do bot.
- [ ] Não há serviço Google Cloud faturável ativado por esta mudança.

Se o novo resumo falhar, definir `DAILY_DIGEST_ENABLED=false` no Apps Script, desativar o cron
externo e definir `DAILY_DIGEST_EXTERNAL=false` no GitHub. O envio antigo volta na próxima coleta.
Não apagar memória acadêmica, implantação, segredos ou repositório para reverter.
