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
        'Dans le tableur : Extensions → Apps Script.',
        'Collez le script ci-dessous, puis Enregistrer.',
        'Déclencheurs (icône réveil) → Ajouter un déclencheur → fonction « envoyerNouveauxProspects » → source « Horaire » → « Minuteur (minutes) » → « Toutes les minutes ».',
        'Autorisez le script à la première exécution.',
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

  var temoin = entetes.indexOf(TEMOIN);
  if (temoin === -1) {
    temoin = entetes.length;
    feuille.getRange(1, temoin + 1).setValue(TEMOIN);
  }

  lignes.forEach(function (ligne, i) {
    if (ligne[temoin]) return;            // déjà envoyée

    const prospect = { external_id: 'ligne-' + (i + 2) };
    entetes.forEach(function (cle, c) {
      if (cle && cle !== TEMOIN) prospect[cle] = ligne[c];
    });

    // Ligne vide en fin de feuille : rien à envoyer.
    if (!prospect.email && !prospect.phone && !prospect.name && !prospect.nom) return;

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

/**
 * Ce que l'utilisateur doit encore faire *en amont* de Gestia. Annoncé dès le
 * départ : découvrir après coup qu'il manquait une étape hors de l'application
 * est la meilleure façon de croire que la fonctionnalité est cassée.
 */
export const UPSTREAM_NOTE =
  'Gestia reçoit les prospects — il ne va pas les chercher chez Facebook. Il vous faut donc une '
  + 'source qui les pousse ici : Zapier ou Make (immédiat, le plus fiable), ou le connecteur '
  + 'Google Sheets de Meta suivi du script ci-contre. Ce dernier a la réputation de s\'interrompre '
  + 'quand son autorisation Google expire ; si vos prospects cessent d\'arriver, c\'est la première '
  + 'chose à vérifier.';
