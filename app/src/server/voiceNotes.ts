// Notes vocales des prospects : le fichier audio dans MinIO, la ligne dans
// LeadNote. Partagé par l'application et le lien de partage, qui ne diffèrent
// que par la façon de prouver leur droit sur le prospect.

import { HttpError } from 'wasp/server';
import { randomBytes } from 'crypto';
import { putObject, removeObject, getMinioClient, getBucket } from './storage';

export type VoiceNoteInput = {
  /** Le fichier, en base64 sans préfixe `data:`. */
  audio: string;
  /** Le type annoncé par MediaRecorder, paramètres compris (`audio/webm;codecs=opus`). */
  mimeType: string;
  durationSec: number;
  peaks: number[];
};

// 10 minutes à 128 kb/s font ~10 Mo : la marge couvre un débit plus élevé.
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
export const MAX_VOICE_NOTE_SECONDS = 10 * 60;
const MAX_PEAKS = 400;

// Ce que produisent MediaRecorder (Chrome, Safari, Firefox) — et rien d'autre :
// le type finit en en-tête Content-Type d'un lien MinIO ouvert dans le navigateur.
const EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

// Le lien de lecture est signé à chaque lecture des notes ; une semaine est le
// maximum que MinIO accepte, et largement plus que la durée de vie d'une page.
const URL_EXPIRY_SECS = 7 * 24 * 3600;

export async function createVoiceNote(
  entities: any,
  { companyId, identifier, authorName = null }: { companyId: string; identifier: string; authorName?: string | null },
  input: VoiceNoteInput,
) {
  const mime = String(input?.mimeType ?? '').split(';')[0].trim().toLowerCase();
  const ext = EXTENSIONS[mime];
  if (!ext) throw new HttpError(400, 'Format audio non pris en charge');

  const buffer = Buffer.from(String(input.audio ?? ''), 'base64');
  if (buffer.length === 0) throw new HttpError(400, 'Enregistrement vide');
  if (buffer.length > MAX_AUDIO_BYTES) throw new HttpError(400, 'Enregistrement trop volumineux (max 15 Mo)');

  const duration = Number(input.durationSec);
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VOICE_NOTE_SECONDS + 5) {
    throw new HttpError(400, 'Durée invalide');
  }

  const peaks = Array.isArray(input.peaks)
    ? input.peaks
        .slice(0, MAX_PEAKS)
        .map(p => Math.round(Math.min(1, Math.max(0, Math.abs(Number(p) || 0))) * 1000) / 1000)
    : [];

  const key = `companies/${companyId}/lead-voice-notes/${randomBytes(12).toString('hex')}.${ext}`;
  await putObject(key, buffer, mime);

  try {
    const note = await entities.LeadNote.create({
      data: {
        companyId,
        identifier,
        text: '',
        authorName,
        audioKey: key,
        audioMime: mime,
        audioDuration: Math.round(duration * 10) / 10,
        audioPeaks: peaks,
      },
    });
    return (await withAudioUrls([note]))[0];
  } catch (e) {
    await removeObject(key);
    throw e;
  }
}

/** Ajoute à chaque note vocale son lien de lecture signé. */
export async function withAudioUrls<T extends { audioKey?: string | null }>(
  notes: T[],
): Promise<(T & { audioUrl: string | null })[]> {
  const client = getMinioClient();
  const bucket = getBucket();
  return Promise.all(
    notes.map(async n => ({
      ...n,
      audioUrl: n.audioKey
        ? await client.presignedGetObject(bucket, n.audioKey, URL_EXPIRY_SECS).catch(() => null)
        : null,
    })),
  );
}

/** Après la suppression d'une note : son fichier, s'il en a un. */
export async function removeVoiceNoteAudio(note: { audioKey?: string | null }) {
  if (note.audioKey) await removeObject(note.audioKey);
}
