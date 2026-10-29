// ─── Lien de partage d'un tableau de prospection ─────────────────────────────
//
// Un lien donne, sans compte ni connexion, le tableau tel que le voit l'équipe :
// mêmes colonnes, mêmes cartes, même fiche à droite. Ce qu'on peut y *faire* se
// règle au moment de créer le lien, case par case, et se resserre ensuite sans
// changer l'adresse.
//
// Le serveur applique ces droits sur chaque opération `…ByToken` ; l'écran ne
// fait que cacher ce qui serait refusé. Source unique pour les deux.

export type LeadSharePermissions = {
  /** Déplacer les cartes d'une colonne à l'autre, et dans une colonne. */
  move: boolean;
  /** Modifier les informations d'un prospect, et sa provenance. */
  edit: boolean;
  /** Lire les notes. */
  notes: boolean;
  /** Écrire et supprimer des notes. N'a de sens qu'avec `notes`. */
  writeNotes: boolean;
  /** Ajouter des prospects au tableau. */
  add: boolean;
  /** Supprimer des prospects. */
  delete: boolean;
  /** Ajouter, renommer, réordonner et supprimer les colonnes de ce tableau. */
  statuses: boolean;
  /** Choisir les champs affichés sur les cartes et dans la fiche. */
  cardFields: boolean;
  /** Écrire les modèles de courriel et de SMS du tableau. */
  templates: boolean;
  /** Télécharger les prospects en CSV. */
  export: boolean;
  /** La source d'un tableau alimenté par webhook : adresse, correspondance, journal, alertes, réponse automatique. */
  source: boolean;
  /** Les critères d'un tableau Google Maps, et « Chercher plus ». */
  criteria: boolean;
};

export type LeadSharePermissionKey = keyof LeadSharePermissions;

/** Les deux blocs du formulaire : ce qu'on fait des prospects, ce qu'on règle du tableau. */
export const LEAD_SHARE_PERMISSION_GROUPS = [
  { key: 'prospects', label: 'Prospects' },
  { key: 'board', label: 'Réglages du tableau' },
] as const;

/** Les cases du formulaire de partage, dans l'ordre affiché. */
export const LEAD_SHARE_PERMISSION_OPTIONS: {
  key: LeadSharePermissionKey;
  group: (typeof LEAD_SHARE_PERMISSION_GROUPS)[number]['key'];
  label: string;
  hint: string;
  /** Case qui doit être cochée pour que celle-ci ait un sens. */
  requires?: LeadSharePermissionKey;
}[] = [
  { key: 'move', group: 'prospects', label: 'Déplacer les cartes', hint: "Changer le statut d'un prospect et l'ordre des colonnes." },
  { key: 'edit', group: 'prospects', label: 'Modifier les informations', hint: 'Coordonnées, champs du formulaire et provenance.' },
  { key: 'notes', group: 'prospects', label: 'Voir les notes', hint: "Les notes laissées par l'équipe sur chaque prospect." },
  { key: 'writeNotes', group: 'prospects', label: 'Écrire et supprimer des notes', hint: 'Ajouter des notes et effacer celles qui ne servent plus.', requires: 'notes' },
  { key: 'add', group: 'prospects', label: 'Ajouter des prospects', hint: 'Créer de nouvelles cartes sur ce tableau.' },
  { key: 'delete', group: 'prospects', label: 'Supprimer des prospects', hint: 'Retirer définitivement une carte du tableau.' },
  { key: 'statuses', group: 'board', label: 'Statuts', hint: 'Ajouter, renommer, réordonner et supprimer les colonnes de ce tableau.' },
  { key: 'cardFields', group: 'board', label: 'Cartes', hint: 'Choisir les champs affichés sur les cartes et dans la fiche.' },
  { key: 'templates', group: 'board', label: 'Modèles courriel / SMS', hint: 'Écrire et modifier les modèles de messages de ce tableau.' },
  { key: 'export', group: 'board', label: 'Exporter en CSV', hint: 'Télécharger tous les prospects du tableau.' },
  { key: 'source', group: 'board', label: 'Source de prospects', hint: "Tableaux alimentés par un formulaire : adresse et secret, correspondance des champs, journal, alertes et SMS automatiques." },
  { key: 'criteria', group: 'board', label: 'Critères et « Chercher plus »', hint: 'Tableaux Google Maps : voir les critères et lancer de nouvelles recherches (facturées par Google).' },
];

/** Ce que propose un nouveau lien : l'accès complet, à resserrer au besoin. */
export const FULL_SHARE_PERMISSIONS: LeadSharePermissions = {
  move: true,
  edit: true,
  notes: true,
  writeNotes: true,
  add: true,
  delete: true,
  statuses: true,
  cardFields: true,
  templates: true,
  export: true,
  source: true,
  criteria: true,
};

/** Aucun droit : le tableau et les fiches se consultent, rien ne se change. */
export const READ_ONLY_SHARE_PERMISSIONS: LeadSharePermissions = {
  move: false,
  edit: false,
  notes: false,
  writeNotes: false,
  add: false,
  delete: false,
  statuses: false,
  cardFields: false,
  templates: false,
  export: false,
  source: false,
  criteria: false,
};

/**
 * Ce que permettaient les liens créés avant le réglage des droits.
 *
 * Gardé tel quel plutôt qu'élargi : un lien déjà envoyé ne doit pas gagner un
 * droit (ajouter des prospects, régler le tableau) que personne n'a choisi de
 * lui donner.
 */
export const LEGACY_SHARE_PERMISSIONS: LeadSharePermissions = {
  ...READ_ONLY_SHARE_PERMISSIONS,
  move: true,
  edit: true,
  notes: true,
  writeNotes: true,
  delete: true,
};

/**
 * Lit les droits enregistrés, tolérant l'ancien format.
 *
 * `{}` (la valeur par défaut de la colonne) est un lien d'avant le réglage : il
 * garde ses droits d'origine. Une clé absente d'un objet partiel vaut `false` —
 * en cas de doute, un lien public en fait moins, pas plus.
 */
export function normalizeSharePermissions(raw: unknown): LeadSharePermissions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length === 0) {
    return { ...LEGACY_SHARE_PERMISSIONS };
  }
  return coerceSharePermissions(raw as Record<string, unknown>);
}

/**
 * Des droits choisis, case par case : seul `true` accorde. Un objet sans aucune
 * case cochée est un choix (« lecture seule »), pas un lien d'avant le réglage.
 */
export function coerceSharePermissions(raw: Record<string, unknown>): LeadSharePermissions {
  const perms = { ...READ_ONLY_SHARE_PERMISSIONS };
  for (const key of Object.keys(perms) as LeadSharePermissionKey[]) perms[key] = raw[key] === true;
  if (!perms.notes) perms.writeNotes = false;
  return perms;
}

/** Résumé d'une ligne : « Accès complet », « Lecture seule » ou la liste des droits. */
export function sharePermissionsSummary(perms: LeadSharePermissions): string {
  const on = LEAD_SHARE_PERMISSION_OPTIONS.filter(o => perms[o.key]);
  if (on.length === LEAD_SHARE_PERMISSION_OPTIONS.length) return 'Accès complet';
  if (on.length === 0) return 'Lecture seule';
  return on.map(o => o.label).join(' · ');
}
