#!/usr/bin/env node
// Simule un SMS entrant Telnyx, pour tester la boîte de réception sans envoyer
// de vrai message.
//
// Le webhook vérifie une signature Ed25519 contre la clé publique *stockée de
// l'entreprise* : on peut donc substituer sa propre paire de clés le temps du
// test.
//
//   1) node scripts/fake-inbound-sms.mjs keygen
//        → écrit une paire dans .sms-test-key.json (git-ignoré) et affiche la
//          clé publique. NOTEZ D'ABORD LA VRAIE CLÉ TELNYX : collez la clé
//          affichée dans Paramètres → Intégrations → SMS → Clé publique, et
//          remettez la vraie à la fin du test.
//
//   2) node scripts/fake-inbound-sms.mjs send +15145550199 "Bonjour" \
//        --to +14385550100 [--url http://localhost:3001] [--id <uuid>]
//        → `--to` est le numéro Telnyx de l'entreprise (celui des paramètres).
//          `--id` rejoue un identifiant Telnyx déjà utilisé pour vérifier
//          l'idempotence : le serveur doit répondre { duplicate: true }.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.join(HERE, '..', '.sms-test-key.json');

function toStandardBase64(base64url) {
  const s = base64url.replace(/-/g, '+').replace(/_/g, '/');
  return s + '='.repeat((4 - (s.length % 4)) % 4);
}

function keygen() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  const publicBase64 = toStandardBase64(jwk.x);
  fs.writeFileSync(
    KEY_FILE,
    JSON.stringify(
      {
        publicBase64,
        privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      },
      null,
      2,
    ),
  );
  console.log('Paire écrite dans', KEY_FILE);
  console.log('\nClé publique à coller dans Paramètres → Intégrations → SMS :\n');
  console.log(publicBase64);
  console.log('\n⚠  Notez la vraie clé Telnyx avant de la remplacer, et remettez-la après le test.');
}

async function send(argv) {
  const [from, text] = argv;
  const flag = name => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? null : argv[i + 1];
  };
  const to = flag('to');
  const url = flag('url') ?? 'http://localhost:3001';
  const id = flag('id') ?? crypto.randomUUID();

  if (!from || !text || !to) {
    console.error('Usage : send <depuis-E164> "<texte>" --to <numero-telnyx-E164> [--url …] [--id …]');
    process.exit(1);
  }
  if (!fs.existsSync(KEY_FILE)) {
    console.error(`Aucune clé de test. Lancez d'abord : node ${path.relative(process.cwd(), process.argv[1])} keygen`);
    process.exit(1);
  }

  const { privatePem } = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  const privateKey = crypto.createPrivateKey(privatePem);

  // Les octets envoyés sont exactement ceux qui sont signés : le middleware du
  // webhook conserve le corps brut, toute re-sérialisation casserait la vérification.
  const body = JSON.stringify({
    data: {
      event_type: 'message.received',
      payload: {
        id,
        from: { phone_number: from },
        to: [{ phone_number: to }],
        text,
      },
    },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .sign(null, Buffer.from(`${timestamp}|${body}`, 'utf8'), privateKey)
    .toString('base64');

  const res = await fetch(`${url}/webhooks/telnyx/sms`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'telnyx-signature-ed25519': signature,
      'telnyx-timestamp': timestamp,
    },
    body,
  });
  console.log(res.status, await res.text());
  console.log('id Telnyx simulé :', id);
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'keygen') keygen();
else if (command === 'send') await send(rest);
else {
  console.error('Commandes : keygen | send');
  process.exit(1);
}
