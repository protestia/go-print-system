const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];
const TOKEN_PATH = 'token.json';

// Cargar credenciales
fs.readFile('credentials.json', (err, content) => {
  if (err) return console.log('Error al cargar credentials.json:', err.message);
  authorize(JSON.parse(content));
});

function authorize(credentials) {
  const config = credentials.installed || credentials.web;
  if (!config) {
    return console.error('Estructura invalida en credentials.json');
  }

  const { client_secret, client_id, redirect_uris } = config;
  const redirectUri = redirect_uris ? redirect_uris[0] : 'urn:ietf:wg:oauth:2.0:oob';
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('\n--- AUTORIZACIÓN DE GMAIL ---');
  console.log('1. Abre esta URL en tu navegador:\n', authUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('\n2. Pega aqui el codigo obtenido de Google: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error al obtener el token:', err);
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
      console.log('\n¡Éxito! Token guardado correctamente en token.json');
    });
  });
}