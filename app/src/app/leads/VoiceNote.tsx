/**
 * Notes vocales : l'enregistreur du composeur de notes et le lecteur de la
 * timeline. Les deux reposent sur wavesurfer.js — onde en direct pendant
 * l'enregistrement, onde cliquable à la lecture.
 *
 * La forme d'onde et la durée sont calculées ici, une fois, à partir de
 * l'enregistrement local, puis enregistrées avec la note. Le lecteur n'a donc
 * jamais à télécharger le fichier pour s'afficher : il ne le lit qu'au premier
 * appui sur ▶, directement depuis MinIO (qui gère les requêtes partielles dont
 * Safari a besoin pour avancer dans un fichier).
 */

import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RecordPlugin from 'wavesurfer.js/dist/plugins/record.esm.js';
import fixWebmDuration from 'fix-webm-duration';
import { LuLoader, LuMic, LuPause, LuPlay, LuSend, LuSquare, LuTrash2 } from 'react-icons/lu';
import toast from 'react-hot-toast';

/** Ce que l'enregistreur remet à l'appelant, prêt pour `addLeadVoiceNote`. */
export type VoiceNotePayload = {
  audio: string; // base64, sans préfixe data:
  mimeType: string;
  durationSec: number;
  peaks: number[];
};

const MAX_SECONDS = 10 * 60;
const PEAK_COUNT = 160;

// Les couleurs de tailwind.config : l'onde est dessinée sur un canvas, qui ne
// connaît pas les classes.
const ACCENT = '#FF6A3D';
const ACCENT_DARK = '#B8431F';
const WAVE_IDLE = '#D4D4CC';

// AAC dans MP4 d'abord : c'est le seul format que lisent tous les navigateurs,
// iPhone compris — une note enregistrée sur l'ordinateur doit s'écouter dans la
// voiture. Safari et Chrome récent l'enregistrent ; Firefox se rabat sur WebM.
const MIME_CANDIDATES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
];

function pickMimeType(): string | null {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') return null;
  if (!navigator.mediaDevices?.getUserMedia) return null;
  return MIME_CANDIDATES.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
}

export function canRecordVoice(): boolean {
  return pickMimeType() !== null;
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ─── Bouton micro du composeur ────────────────────────────────────────────────

export function MicButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type='button'
      className='btn-secondary self-end px-3'
      onClick={onClick}
      disabled={disabled}
      title='Enregistrer une note vocale'
      aria-label='Enregistrer une note vocale'
    >
      <LuMic size={15} />
    </button>
  );
}

// ─── Enregistreur ─────────────────────────────────────────────────────────────

type Phase = 'starting' | 'recording' | 'review' | 'sending';

/**
 * Démarre dès son affichage : un appui sur le micro, on parle. « Terminer »
 * passe à la réécoute, d'où l'on envoie ou recommence. Démonter le composant
 * coupe le micro, quel que soit l'état.
 */
export function VoiceRecorder({
  onSend,
  onClose,
}: {
  onSend: (payload: VoiceNotePayload) => Promise<unknown>;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const recRef = useRef<RecordPlugin | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const elapsedRef = useRef(0);
  const [phase, setPhase] = useState<Phase>('starting');
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playTime, setPlayTime] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const mimeType = pickMimeType();
    if (mimeType === null || !containerRef.current) {
      toast.error("L'enregistrement audio n'est pas disponible sur ce navigateur");
      onClose();
      return;
    }

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 40,
      waveColor: ACCENT,
      progressColor: ACCENT_DARK,
      cursorWidth: 0,
      barWidth: 3,
      barGap: 2,
      barRadius: 3,
      normalize: true,
      dragToSeek: true,
    });
    const rec = ws.registerPlugin(
      RecordPlugin.create({
        mimeType: mimeType || undefined,
        audioBitsPerSecond: 128000,
        scrollingWaveform: true,
        renderRecordedAudio: true,
      }),
    );
    wsRef.current = ws;
    recRef.current = rec;

    rec.on('record-progress', ms => {
      elapsedRef.current = ms / 1000;
      setElapsed(ms / 1000);
      if (ms / 1000 >= MAX_SECONDS) rec.stopRecording();
    });
    rec.on('record-end', blob => {
      blobRef.current = blob;
      rec.stopMic();
      setReady(false);
      setPhase('review');
    });
    // L'onde en direct émet aussi `ready` à chaque image : seul compte le
    // rechargement de l'enregistrement final, qui donne l'onde et la durée réelles.
    ws.on('ready', () => {
      if (blobRef.current) setReady(true);
    });
    ws.on('play', () => setPlaying(true));
    ws.on('pause', () => setPlaying(false));
    ws.on('finish', () => setPlaying(false));
    ws.on('timeupdate', t => setPlayTime(t));

    rec
      .startRecording({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      })
      .then(() => setPhase('recording'))
      .catch((err: any) => {
        const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
        toast.error(
          denied
            ? "Accès au micro refusé — autorisez-le dans les réglages du navigateur"
            : 'Impossible de démarrer le micro',
        );
        onClose();
      });

    return () => {
      ws.destroy();
      wsRef.current = null;
      recRef.current = null;
    };
  }, []);

  async function send() {
    const ws = wsRef.current;
    const raw = blobRef.current;
    if (!ws || !raw) return;
    setPhase('sending');
    try {
      ws.pause();
      const duration = ws.getDuration() || elapsedRef.current;
      // Chrome et Firefox n'inscrivent pas la durée dans un WebM enregistré :
      // sans elle, le lecteur afficherait ∞ et ne pourrait pas avancer.
      const blob = raw.type.includes('webm')
        ? await fixWebmDuration(raw, duration * 1000, { logger: false })
        : raw;
      const peaks = (ws.exportPeaks({ maxLength: PEAK_COUNT, precision: 1000 })[0] ?? []) as number[];
      await onSend({
        audio: await blobToBase64(blob),
        mimeType: raw.type || 'audio/webm',
        durationSec: duration,
        peaks: Array.from(peaks),
      });
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Erreur lors de l'envoi de la note vocale");
      setPhase('review');
    }
  }

  const recording = phase === 'starting' || phase === 'recording';

  return (
    <div className='rounded-xl border border-line bg-white p-3 shadow-soft'>
      <div className='flex items-center gap-3'>
        {recording ? (
          <span className='flex w-14 shrink-0 items-center gap-1.5 text-[13px] font-medium tabular-nums text-ink'>
            <span className={`h-2 w-2 rounded-full bg-red-500 ${phase === 'recording' ? 'animate-pulse' : 'opacity-40'}`} />
            {formatClock(elapsed)}
          </span>
        ) : (
          <button
            type='button'
            onClick={() => wsRef.current?.playPause()}
            disabled={!ready || phase === 'sending'}
            className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-500 text-white transition-colors hover:bg-accent-600 disabled:opacity-50'
            aria-label={playing ? 'Pause' : 'Réécouter'}
          >
            {playing ? <LuPause size={16} /> : <LuPlay size={16} className='ml-0.5' />}
          </button>
        )}
        <div ref={containerRef} className='min-w-0 flex-1' />
        {!recording && (
          <span className='shrink-0 text-xs tabular-nums text-muted'>
            {formatClock(playing || playTime > 0 ? playTime : wsRef.current?.getDuration() || elapsed)}
          </span>
        )}
      </div>

      <div className='mt-3 flex items-center justify-between gap-2'>
        <button
          type='button'
          className='btn-secondary gap-1.5'
          onClick={onClose}
          disabled={phase === 'sending'}
        >
          <LuTrash2 size={14} />
          Annuler
        </button>
        {recording ? (
          <button
            type='button'
            className='btn-primary gap-1.5'
            onClick={() => recRef.current?.stopRecording()}
            disabled={phase !== 'recording'}
          >
            <LuSquare size={12} className='fill-current' />
            Terminer
          </button>
        ) : (
          <button
            type='button'
            className='btn-primary gap-1.5'
            onClick={send}
            disabled={!ready || phase === 'sending'}
          >
            {phase === 'sending' ? <LuLoader size={14} className='animate-spin' /> : <LuSend size={14} />}
            Envoyer
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Lecteur ──────────────────────────────────────────────────────────────────

// Une seule note joue à la fois : lancer la suivante met la précédente en pause.
let activePlayer: WaveSurfer | null = null;

const RATES = [1, 1.5, 2] as const;

export function VoiceNotePlayer({
  url,
  duration,
  peaks,
}: {
  url: string;
  duration: number;
  peaks?: number[] | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);

  useEffect(() => {
    if (!containerRef.current) return;
    // `preload='none'` : une liste de vingt notes ne télécharge rien tant
    // qu'on n'en écoute pas une.
    const media = new Audio();
    media.preload = 'none';
    const ws = WaveSurfer.create({
      container: containerRef.current,
      media,
      url,
      // Sans onde enregistrée, wavesurfer téléchargerait le fichier pour la
      // calculer — ce que le stockage refuse depuis une autre origine.
      peaks: [peaks?.length ? peaks : new Array(60).fill(0.25)],
      duration,
      height: 32,
      waveColor: WAVE_IDLE,
      progressColor: ACCENT,
      cursorWidth: 0,
      barWidth: 3,
      barGap: 2,
      barRadius: 3,
      normalize: true,
      dragToSeek: true,
    });
    wsRef.current = ws;

    ws.on('play', () => {
      if (activePlayer && activePlayer !== ws) activePlayer.pause();
      activePlayer = ws;
      setPlaying(true);
    });
    ws.on('pause', () => setPlaying(false));
    ws.on('finish', () => {
      setPlaying(false);
      ws.setTime(0);
    });
    ws.on('timeupdate', t => setTime(t));
    media.addEventListener('waiting', () => setLoading(true));
    media.addEventListener('playing', () => setLoading(false));
    media.addEventListener('error', () => {
      setLoading(false);
      setPlaying(false);
    });

    return () => {
      if (activePlayer === ws) activePlayer = null;
      ws.destroy();
      wsRef.current = null;
    };
  }, [url]);

  function togglePlay() {
    const ws = wsRef.current;
    if (!ws) return;
    if (!playing) setLoading(true);
    ws.playPause().catch(() => {
      setLoading(false);
      toast.error('Lecture impossible');
    });
  }

  function cycleRate() {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    wsRef.current?.setPlaybackRate(next, true);
  }

  return (
    <div className='flex items-center gap-2.5'>
      <button
        type='button'
        onClick={togglePlay}
        className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-500 text-white transition-colors hover:bg-accent-600'
        aria-label={playing ? 'Pause' : 'Écouter la note vocale'}
      >
        {loading && playing ? (
          <LuLoader size={15} className='animate-spin' />
        ) : playing ? (
          <LuPause size={15} />
        ) : (
          <LuPlay size={15} className='ml-0.5' />
        )}
      </button>
      <div ref={containerRef} className='min-w-0 flex-1 cursor-pointer' />
      <span className='w-9 shrink-0 text-right text-xs tabular-nums text-muted'>
        {formatClock(playing || time > 0 ? time : duration)}
      </span>
      <button
        type='button'
        onClick={cycleRate}
        className='h-6 shrink-0 rounded-full bg-canvas-200 px-2 text-[11px] font-semibold tabular-nums text-ink-700 transition-colors hover:bg-canvas-300'
        title='Vitesse de lecture'
        aria-label={`Vitesse de lecture : ${rate}×`}
      >
        {rate}×
      </button>
    </div>
  );
}
