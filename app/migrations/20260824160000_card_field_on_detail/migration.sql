-- AlterTable
ALTER TABLE "LeadCardFieldConfig" ADD COLUMN     "onDetail" BOOLEAN NOT NULL DEFAULT true;

-- La fiche montrait jusqu'ici un jeu figé : téléphone, courriel, site web,
-- adresse et note Google. Le défaut `true` reconduit exactement cela pour les
-- lignes déjà semées, à deux exceptions près — le nom, qui est le titre du
-- panneau, et la provenance, qui y a déjà son propre sélecteur. Les afficher en
-- plus comme des lignes d'information les dédoublerait.
UPDATE "LeadCardFieldConfig" SET "onDetail" = false WHERE "key" IN ('name', 'source');

-- La catégorie n'était pas affichée dans la fiche non plus. On reconduit, plutôt
-- que d'ajouter une ligne que personne n'a demandée à toutes les fiches d'un coup.
UPDATE "LeadCardFieldConfig" SET "onDetail" = false WHERE "key" = 'category';
