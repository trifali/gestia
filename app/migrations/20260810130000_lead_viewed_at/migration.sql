-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "viewedAt" TIMESTAMP(3);

-- Les prospects déjà sur les tableaux comptent comme vus.
--
-- Rien n'a jamais enregistré les consultations : laisser la colonne à NULL
-- dirait « jamais ouvert » de fiches ouvertes dix fois, et allumerait la pastille
-- sur tous les tableaux existants d'un coup — un signal qui désigne tout ne
-- désigne rien. L'indicateur ne veut donc dire quelque chose qu'à partir d'ici.
UPDATE "Lead" SET "viewedAt" = "createdAt";
