// Recettes de branchement, avec l'adresse et le secret déjà insérés.
//
// Un point d'entrée sans recette est un point d'entrée que personne ne branche.
// Ces extraits existent pour qu'on passe de « voici votre URL » à « c'est
// connecté » sans aller chercher de documentation ailleurs.
//
// Dans un fichier à part parce que ce sont des pavés de texte : mélangés au JSX
// du panneau, ils le rendraient illisible.

export type Recipe = {
  key: string;
  label: string;
  /** Une phrase : quand choisir celle-ci. */
  summary: string;
  /** Étapes en clair, affichées au-dessus de l'extrait. */
  steps: string[];
  /** Avertissement encadré, quand il y a un piège connu. */
  warning?: string;
  language: 'javascript' | 'html' | 'bash' | 'text';
  code: string;
};

export function buildRecipes(url: string, secret: string | null): Recipe[] {
  // Tant que le secret n'a pas été révélé, on montre le nom de la variable
  // plutôt qu'une valeur trompeuse.
  const key = secret ?? 'VOTRE_SECRET';

  return [
    {
      key: 'zapier',
      label: 'Zapier / Make',
      summary:
        'La voie recommandée pour un formulaire Facebook : livraison immédiate, aucun sondage.',
      steps: [
        'Déclencheur : « Facebook Lead Ads » → « New Lead » (ou la source de votre choix).',
        'Action : « Webhooks by Zapier » → « POST » (dans Make : « HTTP » → « Make a request »).',
        `URL : ${url}`,
        'Payload Type : JSON.',
        `En-tête : X-Gestia-Secret = ${key}`,
        'Data : glissez les champs du formulaire. Les noms n\'ont pas d\'importance — vous les associerez à l\'étape suivante.',
      ],
      language: 'text',
      code: [
        `POST ${url}`,
        'Content-Type: application/json',
        `X-Gestia-Secret: ${key}`,
        '',
        '{',
        '  "external_id": "{{lead_id}}",',
        '  "full_name":   "{{full_name}}",',
        '  "email":       "{{email}}",',
        '  "phone_number":"{{phone_number}}",',
        '  "city":        "{{city}}"',
        '}',
      ].join('\n'),
    },

    {
      key: 'sheets',
      label: 'Google Sheets',
      summary:
        'Quand vos prospects arrivent déjà dans un tableur — y compris via le connecteur Google Sheets de Meta.',
      steps: [
        'Vérifiez que les en-têtes de colonnes sont bien sur la ligne 1 du tableur (le script attend sagement si la feuille est encore vide).',
        'Dans le tableur : Extensions → Apps Script.',
        'Collez le script ci-dessous, puis Enregistrer.',
        'Déclencheurs (icône réveil) → Ajouter un déclencheur → fonction « envoyerNouveauxProspects » → source « Horaire » → « Minuteur (minutes) » → « Toutes les minutes ».',
        'Autorisez le script à la première exécution.',
        'Plusieurs structures de prospects peuvent cohabiter dans la feuille : une colonne de données sans titre reçoit un en-tête automatique (colonne_M, …), et chaque ligne n\'envoie que ses cellules remplies.',
        'Facultatif — pour pousser d\'autres sources dans la même feuille : Déployer → Nouveau déploiement → « Application web » (exécuter « en tant que moi », accès « Tout le monde »), puis envoyez vos prospects en POST JSON sur l\'URL obtenue avec ?secret=… au bout. Les colonnes manquantes seront créées automatiquement.',
      ],
      warning:
        'Il faut un déclencheur horaire, surtout pas onEdit. Google ne déclenche pas les scripts '
        + 'sur les lignes écrites par une API — et c\'est exactement ainsi que Meta, Zapier et Make '
        + 'remplissent un tableur. Un déclencheur onEdit ne se déclencherait jamais, sans erreur '
        + 'visible nulle part.',
      language: 'javascript',
      code: `const ENDPOINT = '${url}';
const SECRET   = '${key}';
const FEUILLE  = 'Feuille 1';   // nom exact de l'onglet
const TEMOIN   = 'Gestia';      // colonne témoin, ajoutée automatiquement

function envoyerNouveauxProspects() {
  const feuille = SpreadsheetApp.getActive().getSheetByName(FEUILLE);
  const lignes  = feuille.getDataRange().getValues();
  const entetes = lignes.shift().map(function (h) { return String(h).trim(); });

  // Feuille vide ou sans en-têtes : on attend. Écrire quoi que ce soit dans une
  // feuille vierge décalerait les colonnes que Meta ou Zapier s'apprêtent à
  // créer, et tout le tableur partirait de travers.
  if (entetes.filter(String).length < 2) return;

  // Colonne de données sans en-tête — réponse de formulaire ajoutée par le
  // connecteur, ou nouvelle structure de prospect : on la baptise d'après sa
  // lettre pour que ses valeurs voyagent au lieu d'être perdues. Plusieurs
  // structures peuvent ainsi cohabiter dans la même feuille.
  entetes.forEach(function (cle, c) {
    if (cle) return;
    var utilisee = lignes.some(function (l) { return String(l[c]).trim(); });
    if (!utilisee) return;
    var lettre = feuille.getRange(1, c + 1).getA1Notation().replace(/[0-9]+/, '');
    entetes[c] = 'colonne_' + lettre;
    feuille.getRange(1, c + 1).setValue(entetes[c]);
  });

  var temoin = entetes.indexOf(TEMOIN);
  if (temoin === -1) {
    temoin = entetes.length;
    feuille.getRange(1, temoin + 1).setValue(TEMOIN);
  }

  lignes.forEach(function (ligne, i) {
    if (ligne[temoin]) return;            // déjà envoyée

    // Seules les cellules remplies voyagent : une ligne n'envoie que sa propre
    // structure, pas les colonnes vides des autres.
    const prospect = {};
    var vide = true;
    entetes.forEach(function (cle, c) {
      if (!cle || cle === TEMOIN) return;
      if (!String(ligne[c]).trim()) return;
      prospect[cle] = ligne[c];
      vide = false;
    });

    // Ligne vide en fin de feuille : rien à envoyer.
    if (vide) return;

    // Anti-doublon : l'identifiant fourni par la source s'il y en a un, sinon
    // une empreinte du contenu. Jamais le numéro de ligne — il change dès
    // qu'une ligne est insérée, et fabriquerait de faux doublons.
    prospect.external_id = String(prospect.external_id || prospect.id || prospect.ID || '').trim()
      || Utilities.base64Encode(Utilities.computeDigest(
           Utilities.DigestAlgorithm.MD5, JSON.stringify(ligne)));

    const rep = UrlFetchApp.fetch(ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Gestia-Secret': SECRET },
      payload: JSON.stringify(prospect),
      muteHttpExceptions: true,
    });

    // On ne coche le témoin qu'en cas de succès : une panne passagère sera
    // rattrapée à la minute suivante plutôt que perdue.
    if (rep.getResponseCode() === 200) {
      feuille.getRange(i + 2, temoin + 1).setValue(new Date());
    } else {
      console.error('Ligne ' + (i + 2) + ' refusée : ' + rep.getContentText());
    }
  });
}

// Facultatif — reçoit des prospects poussés en HTTP (Zapier, Make, un site…)
// directement dans la feuille. Les colonnes manquantes sont créées à la volée :
// chaque structure de données trouve sa place, et « envoyerNouveauxProspects »
// enverra la ligne à Gestia à la minute suivante.
//
// Pour l'activer : Déployer → Nouveau déploiement → « Application web » →
// exécuter « en tant que moi », accès « Tout le monde », puis POST du JSON
// sur l'URL obtenue, avec ?secret=… au bout.
function doPost(e) {
  const reponse = function (corps) {
    return ContentService.createTextOutput(JSON.stringify(corps))
      .setMimeType(ContentService.MimeType.JSON);
  };
  if ((e.parameter.secret || '') !== SECRET) {
    return reponse({ ok: false, error: 'Secret invalide ou absent.' });
  }

  var prospect = {};
  try {
    if (e.postData && e.postData.type.indexOf('json') !== -1) {
      prospect = JSON.parse(e.postData.contents);
    } else {
      // Formulaire classique : les champs arrivent dans e.parameter.
      Object.keys(e.parameter).forEach(function (cle) {
        if (cle !== 'secret') prospect[cle] = e.parameter[cle];
      });
    }
  } catch (err) {
    return reponse({ ok: false, error: 'JSON illisible.' });
  }

  const cles = Object.keys(prospect).filter(function (k) {
    return String(k).trim() && k !== TEMOIN;
  });
  if (cles.length === 0) return reponse({ ok: false, error: 'Aucun champ reçu.' });

  // Un seul écrivain à la fois : deux envois simultanés créeraient la même
  // colonne en double.
  const verrou = LockService.getScriptLock();
  verrou.waitLock(30 * 1000);
  try {
    const feuille = SpreadsheetApp.getActive().getSheetByName(FEUILLE);
    const entetes = feuille.getLastColumn() > 0
      ? feuille.getRange(1, 1, 1, feuille.getLastColumn()).getValues()[0]
          .map(function (h) { return String(h).trim(); })
      : [];

    cles.forEach(function (cle) {
      if (entetes.indexOf(cle) !== -1) return;
      entetes.push(cle);
      feuille.getRange(1, entetes.length).setValue(cle);
    });

    feuille.appendRow(entetes.map(function (cle) {
      if (!(cle in prospect)) return '';
      const v = prospect[cle];
      return (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;
    }));
  } finally {
    verrou.releaseLock();
  }

  return reponse({ ok: true });
}`,
    },

    {
      key: 'html',
      label: 'Formulaire de site web',
      summary: 'Un formulaire HTML qui poste directement, sans une ligne de JavaScript.',
      steps: [
        'Collez ce formulaire dans votre page.',
        'Les noms des champs (name="…") deviendront les champs à associer à l\'étape suivante.',
      ],
      warning:
        'Le secret est ici dans l\'adresse, donc visible dans le code source de la page. '
        + 'C\'est acceptable — le point d\'entrée est en écriture seule et ne peut alimenter que '
        + 'ce tableau — mais si l\'adresse se met à recevoir n\'importe quoi, faites tourner le '
        + 'secret : elle ne changera pas.',
      language: 'html',
      code: `<form method="POST" action="${url}?secret=${key}">
  <input name="nom"       placeholder="Nom"       required>
  <input name="courriel"  placeholder="Courriel"  type="email">
  <input name="telephone" placeholder="Téléphone">
  <textarea name="message" placeholder="Votre message"></textarea>
  <button type="submit">Envoyer</button>
</form>`,
    },

    {
      key: 'curl',
      label: 'Tester',
      summary: 'Pour vérifier l\'adresse tout de suite, depuis un terminal.',
      steps: [
        'Collez cette commande dans un terminal.',
        'L\'appel apparaîtra dans le panneau d\'écoute, et vous pourrez associer ses champs.',
      ],
      language: 'bash',
      code: `curl -i -X POST '${url}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Gestia-Secret: ${key}' \\
  -d '{
    "external_id": "test-1",
    "full_name": "Jean Tremblay",
    "email": "jean@exemple.com",
    "phone_number": "+15145551234",
    "city": "Laval"
  }'`,
    },
  ];
}
