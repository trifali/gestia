// La colonne de rattrapage du kanban de prospection.
//
// Elle n'existe pas en base : `getLeadStatusConfigs` l'ajoute en fin de liste, et
// supprimer un statut y renvoie les prospects qui le portaient, plutôt que de les
// faire disparaître avec leur colonne.
//
// Vit dans `shared` parce que les deux côtés en dépendent : le serveur pour ne
// jamais y faire atterrir une arrivée automatique, le client pour l'exclure des
// colonnes réordonnables et pour savoir quelle est la *vraie* première colonne.
// Deux définitions qui divergeraient donneraient un bogue silencieux.
export const UNKNOWN_STATUS_KEY = 'unknown';
