// Réception de prospects : un tableau, une adresse permanente, un secret rotatif.
//
//   POST <serverUrl>/webhooks/prospects/<publicId>
//   en-tête  X-Gestia-Secret: <secret>
//
// Alimenté par Zapier/Make (formulaires Facebook), un script Google Sheets, ou
// le formulaire d'un site web. Peu importe l'émetteur : la correspondance
// enregistrée sur le tableau dit comment lire ce qu'il envoie.
//
// Deux choix qui diffèrent du webhook Telnyx voisin, et pourquoi :
//
//   1. Pas de corps brut. Telnyx signe les octets exacts (Ed25519), donc
//      `smsWebhook.ts` doit les conserver. Ici l'authentification est un secret
//      partagé : le corps analysé suffit, et on peut donc accepter aussi de
//      l'urlencodé — ce qui permet à un `<form>` HTML de poster directement,
//      sans une ligne de JavaScript.
//
//   2. Les erreurs sont bruyantes (4xx), pas silencieuses. Telnyx répond 200 à
//      peu près à tout parce qu'un opérateur qui retente en boucle est pire que
//      l'événement perdu. Ici l'émetteur est un outil que l'utilisateur a
//      configuré lui-même : un secret erroné ou une charge utile inexploitable
//      doit apparaître dans le journal d'exécution de son Zapier, pas être
//      avalé poliment.

import crypto from 'crypto';
import express from 'express';
import type { Request, Response } from 'express';
import type { MiddlewareConfigFn } from 'wasp/server';
import {
  applyMapping,
  flattenPaths,
  getByPath,
  isMappingConfigured,
  isUsableLead,
  LEAD_INTAKE_SECRET_HEADER,
  type LeadIntakeMapping,
} from '../../shared/leadIntake';
import { insertLeadOnTop, resolveIntakeStatus } from '../../app/leads/operations';

/**
 * Plafond horaire par tableau. Le point d'entrée est anonyme au sens où
 * n'importe qui détenant l'adresse et le secret peut écrire : il lui faut un
 * plafond. Le journal des événements fait déjà office de compteur, donc cela ne
 * coûte pas de structure supplémentaire.
 */
const MAX_CALLS_PER_HOUR = 300;

/** Nombre de prospects acceptés dans un même appel (un lot de lignes de tableur). */
const MAX_LEADS_PER_CALL = 100;

/**
 * Remplace l'analyse de corps de Wasp sur ces routes : on ajoute l'urlencodé
 * pour qu'un formulaire HTML puisse poster directement, et on abaisse la limite
 * de taille (30 Mo globaux ailleurs, pour les téléversements — une charge utile
 * de prospect qui dépasse 256 ko est une erreur de configuration).
 */
export const leadIntakeMiddleware: MiddlewareConfigFn = (config) => {
  config.set('express.json', express.json({ limit: '256kb' }));
  config.set('express.urlencoded', express.urlencoded({ extended: true, limit: '256kb' }));
  return config;
};

// ─── Authentification ─────────────────────────────────────────────────────────

/** Comparaison à durée constante, tolérante aux longueurs différentes. */
function secretMatches(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual lève si les longueurs diffèrent : on compare des empreintes,
  // de longueur fixe, pour ne pas transformer la longueur en oracle.
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Le secret, dans l'ordre de préférence : en-tête, puis requête, puis corps.
 *
 * L'en-tête est la bonne façon. Les deux replis existent pour le seul cas où
 * l'émetteur ne peut pas en poser — un `<form>` HTML — et l'interface les
 * présente comme tels.
 */
function extractSecret(req: Request): string {
  const header = req.header(LEAD_INTAKE_SECRET_HEADER);
  if (header) return String(header).trim();
  const query = (req.query as any)?.secret;
  if (typeof query === 'string' && query) return query.trim();
  const body = (req.body as any)?.secret;
  if (typeof body === 'string' && body) return body.trim();
  return '';
}

/**
 * Retire le secret du corps avant qu'il n'aille où que ce soit.
 *
 * Le corps est journalisé tel quel et réaffiché dans l'assistant de
 * correspondance : un secret transmis en corps ou en requête y resterait
 * lisible, et la rotation ne servirait à rien puisqu'il aurait déjà fuité dans
 * la base et dans l'interface.
 */
function stripSecret(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const { secret: _dropped, ...rest } = body as Record<string, unknown>;
  return rest;
}

function clientIp(req: Request): string | null {
  const forwarded = req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim().slice(0, 64) || null;
  return (req.ip ?? '').slice(0, 64) || null;
}

// ─── GET : vérification par un humain ─────────────────────────────────────────

/**
 * Ouvrir l'adresse dans un navigateur doit dire quelque chose d'utile plutôt que
 * 404. Ne demande pas le secret et ne révèle rien : le `publicId` seul ne donne
 * accès à aucune donnée, et confirmer « oui, cette adresse est bien celle du
 * tableau Untel » est exactement ce dont on a besoin quand on la recopie.
 */
export const leadIntakePing = async (req: Request, res: Response, context: any) => {
  const publicId = String(req.params.publicId ?? '');
  const webhook = await context.entities.LeadInboundWebhook.findUnique({
    where: { publicId },
    select: { isActive: true, mapping: true, search: { select: { title: true } } },
  });
  if (!webhook) {
    res.status(404).json({ ok: false, error: 'Adresse de réception inconnue.' });
    return;
  }
  res.status(200).json({
    ok: true,
    board: webhook.search?.title ?? null,
    active: webhook.isActive,
    configured: isMappingConfigured(webhook.mapping),
    hint: 'Envoyez un POST à cette adresse avec l\'en-tête X-Gestia-Secret.',
  });
};

// ─── POST : réception ─────────────────────────────────────────────────────────

export const leadIntakeReceive = async (req: Request, res: Response, context: any) => {
  const publicId = String(req.params.publicId ?? '');
  const entities = context.entities;

  const webhook = await entities.LeadInboundWebhook.findUnique({
    where: { publicId },
    select: {
      id: true,
      companyId: true,
      secret: true,
      mapping: true,
      isActive: true,
      searchId: true,
      search: { select: { id: true, companyId: true, title: true } },
    },
  });
  if (!webhook) {
    res.status(404).json({ ok: false, error: 'Adresse de réception inconnue.' });
    return;
  }

  if (!secretMatches(extractSecret(req), webhook.secret)) {
    res.status(401).json({ ok: false, error: 'Secret invalide ou absent.' });
    return;
  }

  // 403 et non 404 : l'émetteur est un outil que l'utilisateur a configuré, et
  // « en pause » se répare autrement que « n'existe pas ».
  if (!webhook.isActive) {
    res.status(403).json({ ok: false, error: 'Cette source est en pause dans Gestia.' });
    return;
  }

  const since = new Date(Date.now() - 60 * 60_000);
  const recent = await entities.LeadInboundEvent.count({
    where: { webhookId: webhook.id, createdAt: { gte: since } },
  });
  if (recent >= MAX_CALLS_PER_HOUR) {
    res.status(429).json({
      ok: false,
      error: `Plafond de ${MAX_CALLS_PER_HOUR} appels par heure atteint pour cette source.`,
    });
    return;
  }

  const body = stripSecret(req.body ?? {});
  const mapping = webhook.mapping as unknown as LeadIntakeMapping;
  const configured = isMappingConfigured(mapping);
  const dedupeKey = configured ? textOrNull(getByPath(body, mapping.dedupePath)) : null;

  // Écrit avant tout traitement : une relivraison casse ici sur la contrainte
  // d'unicité et ne peut donc pas produire un second prospect. C'est la même
  // discipline que `providerId @unique` côté Telnyx.
  let event: { id: string };
  try {
    event = await entities.LeadInboundEvent.create({
      data: {
        webhookId: webhook.id,
        companyId: webhook.companyId,
        dedupeKey,
        status: 'captured',
        payload: body as any,
        sourceIp: clientIp(req),
      },
      select: { id: true },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }
    console.error('[intake] échec d\'écriture du journal', err);
    // 500 : le seul cas où une nouvelle tentative de l'émetteur est utile.
    res.status(500).json({ ok: false, error: 'Erreur interne.' });
    return;
  }

  // Pas encore de correspondance : c'est l'état « test ». On garde l'appel comme
  // échantillon, on ne crée rien, et on renvoie ce qu'on a compris — quelqu'un
  // qui essaie depuis curl ou depuis le journal de Zapier voit immédiatement les
  // champs disponibles.
  if (!configured) {
    res.status(200).json({
      ok: true,
      captured: true,
      fields: flattenPaths(body).map(p => p.path),
      hint: 'Appel enregistré. Configurez la correspondance des champs dans Gestia pour créer des prospects.',
    });
    return;
  }

  try {
    const { leads, warnings } = applyMapping(body, mapping, {
      boardLabel: webhook.search.title,
      receivedAt: new Date(),
    });
    const usable = leads.filter(isUsableLead).slice(0, MAX_LEADS_PER_CALL);

    if (usable.length === 0) {
      const reason =
        'Aucun prospect exploitable : ni nom, ni courriel, ni téléphone n\'ont pu être lus. '
        + 'Vérifiez la correspondance des champs dans Gestia.';
      await entities.LeadInboundEvent.update({
        where: { id: event.id },
        data: { status: 'rejected', errorMsg: reason },
      });
      res.status(422).json({ ok: false, error: reason, warnings, fields: flattenPaths(body).map(p => p.path) });
      return;
    }

    const status = await resolveIntakeStatus(entities, webhook.companyId);
    const created: string[] = [];
    for (const lead of usable) {
      const row = await insertLeadOnTop(entities, {
        searchId: webhook.searchId,
        status,
        data: {
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          website: lead.website,
          address: lead.address,
          category: lead.category,
          notes: lead.notes,
          source: lead.source,
          externalId: lead.externalId ?? dedupeKey,
        },
      });
      created.push(row.id);
    }

    await entities.LeadSearch.update({
      where: { id: webhook.searchId },
      data: { totalFound: { increment: created.length } },
    });
    await entities.LeadInboundWebhook.update({
      where: { id: webhook.id },
      data: { receivedCount: { increment: created.length }, lastReceivedAt: new Date() },
    });
    await entities.LeadInboundEvent.update({
      where: { id: event.id },
      data: { status: 'ok', leadIds: created, errorMsg: warnings.length ? warnings.join(' ') : null },
    });

    res.status(200).json({ ok: true, created: created.length, warnings });
  } catch (err: any) {
    console.error('[intake] échec de traitement', err);
    await entities.LeadInboundEvent.update({
      where: { id: event.id },
      data: { status: 'error', errorMsg: String(err?.message ?? err).slice(0, 500) },
    }).catch(() => undefined);
    res.status(500).json({ ok: false, error: 'Erreur interne lors de la création du prospect.' });
  }
};

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = Array.isArray(value) ? value.join(',') : String(value);
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}
