// Modèles intégrés d'entente, proposés en premier à la création d'une entente.
//
// Le premier, l'entente de services, est rédigé pour un consultant ou un travailleur
// autonome au Québec : c'est un contrat de service au sens des articles 2098 et suivants du Code civil, et
// tout l'enjeu est d'y affirmer l'autonomie du prestataire.
//
// Les variables ({{supplier.*}}, {{contract.*}}, {{company.*}}) sont résolues à
// la création — voir buildSupplierContractVars dans shared/supplier.

export const SERVICE_AGREEMENT_NAME = 'Entente de services professionnels';

export const SERVICE_AGREEMENT_TEMPLATE = `## Entre les parties

**{{company.name}}**, {{company.address}} (le « Client »)

et

**{{supplier.company}}**, représenté par {{supplier.name}}, {{supplier.address}} (le « Prestataire »)

Fait le {{date}}.

## 1. Objet

Le Client retient les services du Prestataire, qui accepte, pour la réalisation des services décrits à l'article 2, aux conditions de la présente entente.

## 2. Description des services

Le Prestataire fournira les services suivants :

- Décrivez ici les services, mandats ou livrables attendus.
- Précisez au besoin les étapes, les livrables et les échéances.

Toute modification de la portée des services fera l'objet d'un accord écrit entre les parties, y compris par courriel.

## 3. Durée

La présente entente prend effet {{contract.start}} et se termine {{contract.end}}, à moins d'être résiliée plus tôt selon l'article 10. Elle peut être prolongée d'un commun accord écrit.

## 4. Statut du Prestataire

Le Prestataire agit à titre de travailleur autonome. Rien dans la présente entente ne crée de lien d'emploi, de société ou de mandat de représentation entre les parties. Conformément à l'article 2099 du Code civil du Québec, le Prestataire choisit librement les moyens d'exécution des services, ses horaires et ses outils de travail, sans lien de subordination envers le Client.

Le Prestataire est seul responsable de ses impôts, de ses cotisations (RRQ, RQAP, CNESST le cas échéant) et de la perception des taxes applicables.

## 5. Rémunération

En contrepartie des services, le Client versera au Prestataire : **{{contract.rate}}**, plus les taxes applicables (TPS et TVQ) si le Prestataire y est inscrit.

Les dépenses engagées pour l'exécution des services ne sont remboursées que si elles ont été approuvées au préalable par écrit par le Client, sur présentation des pièces justificatives.

## 6. Facturation et paiement

Le Prestataire transmet ses factures au Client par le portail fournisseur mis à sa disposition ou par courriel. Chaque facture indique la période couverte, le détail des services rendus et, s'il y a lieu, ses numéros de TPS et de TVQ.

Le Client paie toute facture conforme dans un délai de {{contract.payment_terms}} suivant sa réception. Une facture contestée de bonne foi est payée pour la partie non contestée, le différend étant réglé entre les parties dans les meilleurs délais.

## 7. Confidentialité

Le Prestataire s'engage à garder strictement confidentielle toute information non publique concernant le Client, ses clients, ses affaires, ses méthodes et ses données, à ne l'utiliser qu'aux fins de la présente entente et à ne la communiquer à aucun tiers sans autorisation écrite. Cette obligation survit à la fin de l'entente.

Le Prestataire protège les renseignements personnels auxquels il a accès conformément à la Loi sur la protection des renseignements personnels dans le secteur privé.

## 8. Propriété intellectuelle

Sur paiement des sommes dues, le Prestataire cède au Client l'ensemble des droits de propriété intellectuelle, y compris les droits d'auteur, sur les livrables réalisés dans le cadre de la présente entente, et renonce à l'exercice de ses droits moraux à leur égard.

Le Prestataire conserve la propriété de ses outils, méthodes et savoir-faire préexistants ; il accorde au Client une licence non exclusive et perpétuelle de les utiliser dans la mesure où ils sont intégrés aux livrables.

## 9. Non-sollicitation

Pendant la durée de l'entente et pour une période de douze (12) mois suivant sa fin, le Prestataire s'engage à ne pas solliciter, pour son propre compte ou celui d'un tiers, les clients du Client qu'il a connus dans le cadre de ses services, pour des services de même nature.

## 10. Résiliation

Chaque partie peut résilier la présente entente en tout temps par un avis écrit de quinze (15) jours à l'autre partie. Conformément aux articles 2125 et 2129 du Code civil du Québec, le Client paie alors au Prestataire les services rendus et les dépenses autorisées jusqu'à la date de résiliation.

En cas de manquement grave de l'une des parties, l'autre peut résilier l'entente sans délai par avis écrit.

À la fin de l'entente, le Prestataire remet au Client tous les documents, données et livrables qui lui appartiennent.

## 11. Responsabilité

Le Prestataire exécute les services avec prudence et diligence, selon les règles de l'art de sa profession. Il est responsable des dommages causés par sa faute dans l'exécution des services.

## 12. Dispositions générales

La présente entente constitue l'accord complet entre les parties et remplace toute entente antérieure portant sur le même objet. Elle ne peut être modifiée que par écrit. Le Prestataire ne peut céder l'entente ni sous-traiter les services sans l'accord écrit du Client.

La présente entente est régie par les lois de la province de Québec. Les tribunaux du district judiciaire du Client sont compétents pour tout litige.

## Signature du Prestataire

La présente entente est émise par {{company.name}}. Le Prestataire l'accepte en la signant, sur papier ou depuis le portail fournisseur.

**{{supplier.company}}**

Nom : {{supplier.name}}

Date : ______________

Signature : ______________________________
`;

// Prospection payée uniquement à la commission. Même cadre juridique (contrat de
// service), mais trois sujets propres à ce genre d'entente : ce qui donne droit à
// une commission, quand elle est acquise (à l'encaissement, pas à la facturation)
// et combien de temps elle survit à l'entente. Le prestataire n'est pas un
// mandataire : il présente, il n'engage pas l'entreprise.

export const COMMISSION_AGREEMENT_NAME = "Entente d'apporteur d'affaires à commission";

export const COMMISSION_AGREEMENT_TEMPLATE = `## Entre les parties

**{{company.name}}**, {{company.address}} (le « Client »)

et

**{{supplier.company}}**, représenté par {{supplier.name}}, {{supplier.address}} (le « Prestataire »)

Fait le {{date}}.

## 1. Objet

Le Client retient les services du Prestataire pour la recherche et la présentation de clients potentiels, en contrepartie d'une rémunération exclusivement à la commission, aux conditions de la présente entente.

## 2. Services

Le Prestataire s'engage à :

- identifier des entreprises ou des personnes susceptibles d'acheter les produits et services du Client ;
- établir un premier contact et vérifier leur intérêt ;
- transmettre au Client les coordonnées et le contexte de chaque client potentiel, et organiser au besoin une première rencontre.

Clientèle ou territoire visé : décrivez ici le secteur, la région ou le type de clients ciblés.

La présente entente n'est pas exclusive : chaque partie demeure libre de travailler avec d'autres personnes.

## 3. Durée

La présente entente prend effet {{contract.start}} et se termine {{contract.end}}, à moins d'être résiliée plus tôt selon l'article 11.

## 4. Statut du Prestataire

Le Prestataire agit à titre de travailleur autonome, sans lien d'emploi ni de subordination envers le Client. Conformément à l'article 2099 du Code civil du Québec, il choisit librement ses méthodes de prospection, ses horaires et ses outils, et assume seul ses frais, ses impôts et ses cotisations.

Le Prestataire n'est pas un mandataire du Client. Il ne peut ni signer de contrat, ni accepter de commande, ni consentir de prix, de rabais ou de délai au nom du Client. Le Client demeure seul juge d'accepter ou de refuser une affaire.

## 5. Commission

{{contract.commission_terms}}

**Client admissible :** une entreprise ou une personne présentée par le Prestataire, qui n'était ni cliente du Client ni en discussion avec lui au moment de la présentation, et dont la présentation a été transmise par écrit (portail fournisseur ou courriel) avant la première rencontre commerciale. Le Client indique dans les cinq (5) jours ouvrables suivants s'il connaissait déjà ce client potentiel ; à défaut, il est réputé admissible.

## 6. Durée du droit à la commission

Le droit à la commission vise les ventes conclues avec un client admissible dans les douze (12) mois suivant sa présentation, y compris lorsqu'elles surviennent après la fin de la présente entente.

## 7. Facturation et paiement

Le Client remet au Prestataire, sur demande, le relevé des ventes et des sommes encaissées auprès des clients admissibles. Le Prestataire facture chaque mois les commissions acquises le mois précédent, par le portail fournisseur ou par courriel, en ajoutant la TPS et la TVQ s'il y est inscrit.

Le Client paie toute facture conforme dans un délai de {{contract.payment_terms}} suivant sa réception.

## 8. Dépenses

Aucune dépense n'est remboursée au Prestataire, à moins d'une autorisation écrite préalable du Client.

## 9. Représentation du Client

Le Prestataire présente le Client et son offre de façon honnête et exacte, n'utilise que l'information et le matériel approuvés par le Client, et ne fait aucune promesse de prix, de délai ou de résultat sans son accord écrit.

Il respecte les lois applicables à la prospection, notamment la Loi canadienne anti-pourriel pour tout message électronique commercial et les règles sur les télécommunications non sollicitées.

## 10. Confidentialité et renseignements personnels

Le Prestataire garde confidentielle toute information non publique sur le Client, ses prix, ses méthodes et ses clients, et ne l'utilise qu'aux fins de la présente entente. Il protège les renseignements personnels des clients potentiels conformément à la Loi sur la protection des renseignements personnels dans le secteur privé. Ces obligations survivent à la fin de l'entente.

## 11. Résiliation

Chaque partie peut résilier la présente entente en tout temps par un avis écrit de quinze (15) jours. Les commissions demeurent payables selon les articles 5 et 6 pour les clients admissibles présentés avant la date de résiliation.

En cas de manquement grave, notamment aux articles 9 et 10, l'autre partie peut résilier l'entente sans délai par avis écrit.

## 12. Dispositions générales

La présente entente constitue l'accord complet entre les parties et ne peut être modifiée que par écrit. Le Prestataire ne peut la céder sans l'accord écrit du Client.

La présente entente est régie par les lois de la province de Québec.

## Signature du Prestataire

La présente entente est émise par {{company.name}}. Le Prestataire l'accepte en la signant, sur papier ou depuis le portail fournisseur.

**{{supplier.company}}**

Nom : {{supplier.name}}

Date : ______________

Signature : ______________________________
`;

/** Les modèles intégrés, dans l'ordre où l'écran « Nouvelle entente » les propose. */
export const BUILTIN_AGREEMENTS: { id: string; name: string; description: string; content: string; rateType?: string }[] = [
  {
    id: 'builtin',
    name: SERVICE_AGREEMENT_NAME,
    description:
      "Consultant ou travailleur autonome payé à l'heure, au jour ou au forfait : statut d'autonome, rémunération, facturation, confidentialité, propriété intellectuelle, non-sollicitation, résiliation (C.c.Q.).",
    content: SERVICE_AGREEMENT_TEMPLATE,
  },
  {
    id: 'builtin:commission',
    name: COMMISSION_AGREEMENT_NAME,
    description:
      "Prospection payée uniquement à la commission — en % des ventes ou en montant fixe par client, avec barème par catégorie : client admissible, commission à l'encaissement, droit de suite de 12 mois, aucun pouvoir d'engager l'entreprise, loi anti-pourriel.",
    content: COMMISSION_AGREEMENT_TEMPLATE,
    rateType: 'commission',
  },
];
