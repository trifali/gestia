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
        'Vérifiez que les en-têtes de colonnes sont bien sur la ligne 1 de chaque onglet (le script attend sagement si un onglet est encore vide).',
        'Dans le tableur : Extensions → Apps Script.',
        'Collez le script ci-dessous, puis Enregistrer.',
        'Déclencheurs (icône réveil) → Ajouter un déclencheur → fonction « envoyerNouveauxProspects » → source « Horaire » → « Minuteur (minutes) » → « Toutes les 5 minutes ».',
        'Autorisez le script à la première exécution.',
        'Tous les onglets du tableur sont lus, et leurs colonnes fusionnées : un même en-tête (« Email », « email ») ne fait qu\'un seul champ dans Gestia, quel que soit son onglet. Chaque prospect porte aussi un champ « onglet » avec le nom de son onglet d\'origine. Pour écarter des onglets, listez-les dans IGNORER.',
        'Plusieurs structures de prospects peuvent cohabiter : une colonne de données sans titre reçoit un en-tête automatique (colonne_M, …), et chaque ligne n\'envoie que ses cellules remplies.',
        'Facultatif — pour pousser d\'autres sources dans la même feuille : Déployer → Nouveau déploiement → « Application web » (exécuter « en tant que moi », accès « Tout le monde »), puis envoyez vos prospects en POST JSON sur l\'URL obtenue avec ?secret=… au bout. Les prospects reçus s\'ajoutent au premier onglet ; les colonnes manquantes seront créées automatiquement.',
      ],
      warning:
        'Il faut un déclencheur horaire, surtout pas onEdit. Google ne déclenche pas les scripts '
        + 'sur les lignes écrites par une API — et c\'est exactement ainsi que Meta, Zapier et Make '
        + 'remplissent un tableur. Un déclencheur onEdit ne se déclencherait jamais, sans erreur '
        + 'visible nulle part.',
      language: 'javascript',
      code: `const ENDPOINT = '${url}';
const SECRET   = '${key}';
const TEMOIN   = 'Gestia';   // colonne témoin, ajoutée automatiquement dans chaque onglet
const IGNORER  = [];         // onglets à laisser de côté, ex. ['Archives', 'Notes']

// Apps Script coupe une exécution à 6 minutes. On s'arrête avant : les lignes
// restantes partiront au passage suivant, cinq minutes plus tard.
const DUREE_MAX = 4 * 60 * 1000;

// « Email », « email » et « EMAIL  » désignent la même colonne d'un onglet à
// l'autre : elles fusionnent sous un seul nom.
function normaliser(h) {
  return String(h).trim().replace(/\\s+/g, ' ').toLowerCase();
}

function envoyerNouveauxProspects() {
  // Un seul passage à la fois : si le précédent tourne encore, il finira son
  // travail. Deux passages simultanés enverraient les mêmes lignes.
  const verrou = LockService.getScriptLock();
  if (!verrou.tryLock(0)) return;

  try {
    const debut   = Date.now();
    const feuilles = SpreadsheetApp.getActive().getSheets().filter(function (f) {
      return IGNORER.indexOf(f.getName()) === -1;
    });

    // Fusion des colonnes : chaque en-tête, quel que soit son onglet, reçoit
    // un nom unique — celui sous lequel il apparaît en premier, dans l'ordre
    // des onglets. Gestia voit ainsi une seule structure, et les champs
    // associés une fois valent pour tous les onglets.
    const noms = {};
    const onglets = feuilles.map(function (feuille) {
      const onglet = preparer(feuille);
      if (onglet) onglet.entetes.forEach(function (cle) {
        const n = normaliser(cle);
        if (n && n !== normaliser(TEMOIN) && !(n in noms)) noms[n] = cle;
      });
      return onglet;
    });

    onglets.forEach(function (onglet) {
      if (onglet) envoyer(onglet, noms, debut);
    });
  } finally {
    verrou.releaseLock();
  }
}

// Lit un onglet et pose ses en-têtes manquants. Rend null tant que l'onglet
// n'a pas de quoi être envoyé.
function preparer(feuille) {
  const lignes  = feuille.getDataRange().getValues();
  const entetes = lignes.shift().map(function (h) { return String(h).trim(); });

  // Onglet vide ou sans en-têtes : on attend. Écrire quoi que ce soit dans une
  // feuille vierge décalerait les colonnes que Meta ou Zapier s'apprêtent à
  // créer, et tout l'onglet partirait de travers.
  if (entetes.filter(String).length < 2) return null;

  // Colonne de données sans en-tête — réponse de formulaire ajoutée par le
  // connecteur, ou nouvelle structure de prospect : on la baptise d'après sa
  // lettre pour que ses valeurs voyagent au lieu d'être perdues.
  entetes.forEach(function (cle, c) {
    if (cle) return;
    var utilisee = lignes.some(function (l) { return String(l[c]).trim(); });
    if (!utilisee) return;
    var lettre = feuille.getRange(1, c + 1).getA1Notation().replace(/[0-9]+/, '');
    entetes[c] = 'colonne_' + lettre;
    feuille.getRange(1, c + 1).setValue(entetes[c]);
  });

  var temoin = entetes.map(normaliser).indexOf(normaliser(TEMOIN));
  if (temoin === -1) {
    temoin = entetes.length;
    feuille.getRange(1, temoin + 1).setValue(TEMOIN);
  }

  return { feuille: feuille, lignes: lignes, entetes: entetes, temoin: temoin };
}

function envoyer(onglet, noms, debut) {
  const feuille = onglet.feuille;
  const temoin  = onglet.temoin;

  onglet.lignes.forEach(function (ligne, i) {
    if (Date.now() - debut > DUREE_MAX) return;   // la suite au prochain passage
    if (ligne[temoin]) return;                    // déjà envoyée

    // Seules les cellules remplies voyagent : une ligne n'envoie que sa propre
    // structure, pas les colonnes vides des autres onglets.
    const prospect = {};
    var vide = true;
    onglet.entetes.forEach(function (cle, c) {
      if (!cle || c === temoin) return;
      if (!String(ligne[c]).trim()) return;
      const nom = noms[normaliser(cle)] || cle;
      // Deux colonnes fusionnées dans le même onglet : la première remplie gagne.
      if (nom in prospect) return;
      prospect[nom] = ligne[c];
      vide = false;
    });

    // Ligne vide en fin d'onglet : rien à envoyer.
    if (vide) return;

    // L'onglet d'origine voyage avec le prospect, pour distinguer les sources
    // dans Gestia — sauf si l'onglet a déjà sa propre colonne « onglet ».
    if (!('onglet' in prospect)) prospect.onglet = feuille.getName();

    // Anti-doublon : l'identifiant fourni par la source s'il y en a un, sinon
    // une empreinte du contenu. Jamais le numéro de ligne — il change dès
    // qu'une ligne est insérée, et fabriquerait de faux doublons. Le même
    // prospect copié dans deux onglets n'arrive donc qu'une fois.
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
    // rattrapée au passage suivant plutôt que perdue.
    if (rep.getResponseCode() === 200) {
      feuille.getRange(i + 2, temoin + 1).setValue(new Date());
    } else {
      console.error(feuille.getName() + ', ligne ' + (i + 2) + ' refusée : ' + rep.getContentText());
    }
  });
}

// Facultatif — reçoit des prospects poussés en HTTP (Zapier, Make, un site…)
// directement dans le premier onglet. Les colonnes manquantes sont créées à la
// volée, et « envoyerNouveauxProspects » enverra la ligne à Gestia au passage
// suivant.
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
    return normaliser(k) && normaliser(k) !== normaliser(TEMOIN);
  });
  if (cles.length === 0) return reponse({ ok: false, error: 'Aucun champ reçu.' });

  // Un seul écrivain à la fois : deux envois simultanés créeraient la même
  // colonne en double.
  const verrou = LockService.getScriptLock();
  verrou.waitLock(30 * 1000);
  try {
    const feuille = SpreadsheetApp.getActive().getSheets()[0];
    const entetes = feuille.getLastColumn() > 0
      ? feuille.getRange(1, 1, 1, feuille.getLastColumn()).getValues()[0]
          .map(function (h) { return String(h).trim(); })
      : [];
    const normes = entetes.map(normaliser);

    // Une clé qui ne diffère d'une colonne existante que par la casse ou les
    // espaces va dans cette colonne, au lieu d'en créer une jumelle.
    const ligne = entetes.map(function () { return ''; });
    cles.forEach(function (cle) {
      var c = normes.indexOf(normaliser(cle));
      if (c === -1) {
        c = entetes.length;
        entetes.push(cle);
        normes.push(normaliser(cle));
        ligne.push('');
        feuille.getRange(1, c + 1).setValue(cle);
      }
      const v = prospect[cle];
      ligne[c] = (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;
    });

    feuille.appendRow(ligne);
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
