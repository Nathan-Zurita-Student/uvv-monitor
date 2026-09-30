import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { google } from 'googleapis';
import open from 'open';
import { GOOGLE_SCOPES } from '../google/auth.js';
import { loadConfig, requireGoogleClientCredentials } from '../config/env.js';

const port = 53_682;
const redirectUri = `http://127.0.0.1:${String(port)}/oauth2callback`;

async function main(): Promise<void> {
  const credentials = requireGoogleClientCredentials(loadConfig());
  const client = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
    redirectUri,
  );
  const state = randomBytes(24).toString('hex');
  const authorizationUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [...GOOGLE_SCOPES],
    state,
  });

  const codePromise = new Promise<string>((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', redirectUri);
      if (url.pathname !== '/oauth2callback') {
        response.writeHead(404).end('Não encontrado');
        return;
      }
      if (url.searchParams.get('state') !== state) {
        response.writeHead(400).end('State inválido');
        server.close();
        reject(new Error('Resposta OAuth com state inválido.'));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        response.writeHead(400).end('Código OAuth ausente');
        server.close();
        reject(
          new Error(`Google não retornou código: ${url.searchParams.get('error') ?? 'erro'}.`),
        );
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Autorização concluída. Você pode fechar esta aba.');
      server.close();
      resolve(code);
    });
    server.listen(port, '127.0.0.1');
    server.on('error', reject);
  });

  console.log(`Abra esta URL se o navegador não iniciar:\n${authorizationUrl}`);
  await open(authorizationUrl).catch(() => undefined);
  const code = await codePromise;
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      'Google não retornou refresh token. Revogue o acesso anterior e tente novamente.',
    );
  }
  console.log('\nAdicione estes nomes aos GitHub Secrets:');
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log('\nColoque esse valor localmente em GOOGLE_REFRESH_TOKEN no .env.');
  console.log('Nunca salve essa saída no repositório.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Falha na autorização Google.');
  process.exitCode = 1;
});
