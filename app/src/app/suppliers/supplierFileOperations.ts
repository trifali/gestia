import { HttpError } from 'wasp/server';
import { removeObject } from '../../server/storage';
import { ensureCompany, ensureSupplierOwned, storeDataUrl, supplierKey, urlFor } from './serverUtils';
import { resolvePortalAccess } from './portalOperations';

// Le drive d'un fournisseur est un seul arbre. Le portail n'en voit qu'une
// branche : le dossier `isPortalRoot`, présenté au fournisseur comme sa racine.
// Les opérations du portail traduisent donc « racine » ↔ ce dossier, et refusent
// tout identifiant qui n'en descend pas.

export const PORTAL_FOLDER_NAME = 'Partagé avec le fournisseur';

export async function ensurePortalRoot(supplierId: string, entities: any) {
  const existing = await entities.SupplierFile.findFirst({ where: { supplierId, isPortalRoot: true } });
  if (existing) return existing;
  return entities.SupplierFile.create({
    data: { supplierId, name: PORTAL_FOLDER_NAME, isFolder: true, parentId: null, isPortalRoot: true },
  });
}

async function withUrls(files: any[]) {
  return Promise.all(files.map(async (f) => ({ ...f, url: f.isFolder ? null : await urlFor(f.key) })));
}

/** Tous les identifiants sous `rootIds`, eux compris. */
async function descendantIds(rootIds: string[], entities: any): Promise<Set<string>> {
  const all = new Set<string>(rootIds);
  let frontier = rootIds;
  while (frontier.length) {
    const children = await entities.SupplierFile.findMany({ where: { parentId: { in: frontier } }, select: { id: true } });
    frontier = children.map((c: any) => c.id).filter((id: string) => !all.has(id));
    frontier.forEach((id) => all.add(id));
  }
  return all;
}

async function assertFolderIn(supplierId: string, folderId: string, entities: any) {
  const parent = await entities.SupplierFile.findUnique({ where: { id: folderId } });
  if (!parent || parent.supplierId !== supplierId || !parent.isFolder) throw new HttpError(400, 'Dossier invalide');
}

async function removeTree(ids: string[], entities: any) {
  const all = [...(await descendantIds(ids, entities))];
  const files = await entities.SupplierFile.findMany({
    where: { id: { in: all }, key: { not: null } },
    select: { key: true },
  });
  await entities.SupplierFile.deleteMany({ where: { id: { in: all } } });
  await Promise.all(files.map((f: any) => removeObject(f.key).catch(() => {})));
  return all.length;
}

// ─── Application ──────────────────────────────────────────────────────────────

export const getSupplierFiles = async ({ supplierId }: { supplierId: string }, context: any) => {
  const companyId = ensureCompany(context.user);
  await ensureSupplierOwned(supplierId, companyId, context.entities);
  await ensurePortalRoot(supplierId, context.entities);
  const files = await context.entities.SupplierFile.findMany({
    where: { supplierId },
    orderBy: [{ isFolder: 'desc' }, { name: 'asc' }],
  });
  return withUrls(files);
};

export const createSupplierFolder = async (
  { supplierId, name, parentId }: { supplierId: string; name: string; parentId?: string | null },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  await ensureSupplierOwned(supplierId, companyId, context.entities);
  if (!name?.trim()) throw new HttpError(400, 'Nom requis');
  if (parentId) await assertFolderIn(supplierId, parentId, context.entities);
  return context.entities.SupplierFile.create({
    data: { supplierId, name: name.trim(), isFolder: true, parentId: parentId ?? null },
  });
};

export const uploadSupplierFile = async (
  { supplierId, dataUrl, name, originalName, parentId }: {
    supplierId: string; dataUrl: string; name: string; originalName: string; parentId?: string | null;
  },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  await ensureSupplierOwned(supplierId, companyId, context.entities);
  if (parentId) await assertFolderIn(supplierId, parentId, context.entities);
  const stored = await storeDataUrl(dataUrl, originalName, (fn) => supplierKey(companyId, supplierId, 'files', fn));
  return context.entities.SupplierFile.create({
    data: {
      supplierId,
      name: name.trim() || originalName,
      parentId: parentId ?? null,
      key: stored.key,
      mimeType: stored.mimeType,
      size: stored.size,
    },
  });
};

async function rejectPortalRoot(ids: string[], entities: any, action: string) {
  const root = await entities.SupplierFile.findFirst({ where: { id: { in: ids }, isPortalRoot: true } });
  if (root) throw new HttpError(400, `Le dossier « ${root.name} » est celui du portail : il ne peut pas être ${action}.`);
}

export const deleteSupplierFiles = async ({ supplierId, ids }: { supplierId: string; ids: string[] }, context: any) => {
  const companyId = ensureCompany(context.user);
  await ensureSupplierOwned(supplierId, companyId, context.entities);
  const owned = await context.entities.SupplierFile.findMany({ where: { id: { in: ids }, supplierId }, select: { id: true } });
  const ownedIds = owned.map((f: any) => f.id);
  await rejectPortalRoot(ownedIds, context.entities, 'supprimé');
  return { deleted: await removeTree(ownedIds, context.entities) };
};

export const renameSupplierFile = async ({ id, name }: { id: string; name: string }, context: any) => {
  const companyId = ensureCompany(context.user);
  const file = await context.entities.SupplierFile.findUnique({ where: { id } });
  if (!file) throw new HttpError(404);
  await ensureSupplierOwned(file.supplierId, companyId, context.entities);
  if (file.isPortalRoot) throw new HttpError(400, 'Le dossier du portail ne peut pas être renommé.');
  if (!name?.trim()) throw new HttpError(400, 'Nom requis');
  return context.entities.SupplierFile.update({ where: { id }, data: { name: name.trim() } });
};

export const moveSupplierFiles = async (
  { supplierId, ids, targetParentId }: { supplierId: string; ids: string[]; targetParentId: string | null },
  context: any,
) => {
  const companyId = ensureCompany(context.user);
  await ensureSupplierOwned(supplierId, companyId, context.entities);
  await rejectPortalRoot(ids, context.entities, 'déplacé');
  if (targetParentId) {
    await assertFolderIn(supplierId, targetParentId, context.entities);
    // Un dossier ne peut pas atterrir dans sa propre descendance.
    if ((await descendantIds(ids, context.entities)).has(targetParentId)) {
      throw new HttpError(400, 'Impossible de déplacer un dossier dans lui-même.');
    }
  }
  await context.entities.SupplierFile.updateMany({
    where: { id: { in: ids }, supplierId },
    data: { parentId: targetParentId },
  });
  return { moved: ids.length };
};

// ─── Portail (sans compte) ────────────────────────────────────────────────────

async function portalScope(token: string, entities: any) {
  const { access, supplier } = await resolvePortalAccess(token, entities);
  const root = await ensurePortalRoot(supplier.id, entities);
  return { access, supplier, root };
}

/** La racine vue du portail est `null` ; tout autre dossier doit être sous le dossier partagé. */
async function portalParent(parentId: string | null | undefined, root: any, entities: any): Promise<string> {
  if (!parentId) return root.id;
  const allowed = await descendantIds([root.id], entities);
  if (!allowed.has(parentId)) throw new HttpError(403, 'Dossier hors du portail');
  await assertFolderIn(root.supplierId, parentId, entities);
  return parentId;
}

async function assertAllInPortal(ids: string[], root: any, entities: any) {
  const allowed = await descendantIds([root.id], entities);
  if (ids.some((id) => id === root.id || !allowed.has(id))) throw new HttpError(403, 'Fichier hors du portail');
}

export const getSupplierPortalFiles = async ({ token }: { token: string }, context: any) => {
  const { root } = await portalScope(token, context.entities);
  const allowed = await descendantIds([root.id], context.entities);
  allowed.delete(root.id);
  const files = await context.entities.SupplierFile.findMany({
    where: { id: { in: [...allowed] } },
    orderBy: [{ isFolder: 'desc' }, { name: 'asc' }],
  });
  const mapped = files.map((f: any) => ({ ...f, parentId: f.parentId === root.id ? null : f.parentId }));
  return withUrls(mapped);
};

export const uploadSupplierPortalFile = async (
  { token, dataUrl, name, originalName, parentId }: {
    token: string; dataUrl: string; name: string; originalName: string; parentId?: string | null;
  },
  context: any,
) => {
  const { supplier, root } = await portalScope(token, context.entities);
  const target = await portalParent(parentId, root, context.entities);
  const stored = await storeDataUrl(dataUrl, originalName, (fn) => supplierKey(supplier.companyId, supplier.id, 'files', fn));
  return context.entities.SupplierFile.create({
    data: {
      supplierId: supplier.id,
      name: name.trim() || originalName,
      parentId: target,
      key: stored.key,
      mimeType: stored.mimeType,
      size: stored.size,
    },
  });
};

export const createSupplierPortalFolder = async (
  { token, name, parentId }: { token: string; name: string; parentId?: string | null },
  context: any,
) => {
  const { supplier, root } = await portalScope(token, context.entities);
  if (!name?.trim()) throw new HttpError(400, 'Nom requis');
  const target = await portalParent(parentId, root, context.entities);
  return context.entities.SupplierFile.create({
    data: { supplierId: supplier.id, name: name.trim(), isFolder: true, parentId: target },
  });
};

export const deleteSupplierPortalFiles = async ({ token, ids }: { token: string; ids: string[] }, context: any) => {
  const { root } = await portalScope(token, context.entities);
  await assertAllInPortal(ids, root, context.entities);
  return { deleted: await removeTree(ids, context.entities) };
};

export const renameSupplierPortalFile = async ({ token, id, name }: { token: string; id: string; name: string }, context: any) => {
  const { root } = await portalScope(token, context.entities);
  await assertAllInPortal([id], root, context.entities);
  if (!name?.trim()) throw new HttpError(400, 'Nom requis');
  return context.entities.SupplierFile.update({ where: { id }, data: { name: name.trim() } });
};

export const moveSupplierPortalFiles = async (
  { token, ids, targetParentId }: { token: string; ids: string[]; targetParentId: string | null },
  context: any,
) => {
  const { root } = await portalScope(token, context.entities);
  await assertAllInPortal(ids, root, context.entities);
  const target = await portalParent(targetParentId, root, context.entities);
  if ((await descendantIds(ids, context.entities)).has(target)) {
    throw new HttpError(400, 'Impossible de déplacer un dossier dans lui-même.');
  }
  await context.entities.SupplierFile.updateMany({ where: { id: { in: ids } }, data: { parentId: target } });
  return { moved: ids.length };
};
