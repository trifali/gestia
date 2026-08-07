// Provenance d'un prospect — d'où il vient, indépendamment du tableau où il vit.
//
// Vit ici plutôt que dans `leads.shared.tsx` parce que le serveur doit valider la
// provenance qu'un appel entrant prétend avoir : un webhook qui envoie
// `source: "facebook"` doit être accepté, `source: "n'importe quoi"` ne doit pas
// atterrir tel quel sur une carte. `leads.shared.tsx` importe le Kanban Syncfusion
// au niveau module, ce qu'on ne veut évidemment pas tirer dans le serveur.

export const LEAD_SOURCES = [
  { key: 'google_maps', label: 'Google Maps' },
  { key: 'manual', label: 'Ajout manuel' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'referral', label: 'Référence' },
  { key: 'website', label: 'Site web' },
  { key: 'other', label: 'Autre' },
] as const;

export type LeadSourceKey = (typeof LEAD_SOURCES)[number]['key'];

export function leadSourceLabel(source: string | null | undefined): string {
  return LEAD_SOURCES.find(s => s.key === source)?.label ?? source ?? 'Inconnue';
}

/**
 * Ramène une provenance quelconque à une clé connue.
 *
 * Une provenance inconnue devient `other` plutôt que d'être recopiée telle
 * quelle : la valeur vient d'un émetteur externe, et une carte étiquetée avec une
 * chaîne arbitraire ne serait filtrable par rien.
 */
export function normalizeLeadSource(source: unknown, fallback: LeadSourceKey = 'other'): LeadSourceKey {
  const key = typeof source === 'string' ? source.trim().toLowerCase() : '';
  return (LEAD_SOURCES.find(s => s.key === key)?.key as LeadSourceKey | undefined) ?? fallback;
}
