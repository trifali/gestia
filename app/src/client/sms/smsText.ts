// ─── SMS length helper ────────────────────────────────────────────────────────
//
// Ré-export : le calcul vit désormais dans `shared/smsSegments`, d'où le serveur
// peut l'atteindre aussi. Le compteur de la zone de rédaction et le constructeur
// d'alerte du webhook comptaient chacun de leur côté ; ils ne le peuvent plus.
//
// Ce fichier reste comme point d'entrée client (deux modules l'importent) et
// pour garder les imports courts côté messagerie.

export { smsSegments, toGsm7, type SmsCost } from '../../shared/smsSegments';
