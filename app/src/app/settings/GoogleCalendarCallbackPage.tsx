import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import { handleGoogleCalendarCallback } from 'wasp/client/operations';

/**
 * Handles the Google OAuth2 redirect.
 * Google redirects to /parametres/google-callback?code=...
 * This page exchanges the code for tokens, then redirects to settings.
 */
export default function GoogleCalendarCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMsg, setErrorMsg] = useState('');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error || !code) {
      setStatus('error');
      setErrorMsg(
        error === 'access_denied'
          ? 'Accès refusé — vous avez annulé la connexion à Google Agenda.'
          : 'Aucun code d\'autorisation reçu depuis Google.',
      );
      return;
    }

    handleGoogleCalendarCallback({ code })
      .then(({ email }) => {
        setStatus('success');
        toast.success(
          email ? `Google Agenda connecté (${email})` : 'Google Agenda connecté',
        );
        setTimeout(() => navigate('/parametres?tab=integrations'), 1500);
      })
      .catch((err: any) => {
        setStatus('error');
        setErrorMsg(err?.message || 'Erreur lors de la connexion à Google Agenda.');
      });
  }, [searchParams, navigate]);

  return (
    <div className='min-h-screen flex items-center justify-center bg-canvas'>
      <div className='card p-8 max-w-md w-full text-center space-y-4'>
        {status === 'processing' && (
          <>
            <div className='animate-spin mx-auto h-10 w-10 border-4 border-accent border-t-transparent rounded-full' />
            <p className='text-muted'>Connexion à Google Agenda en cours…</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div className='text-success text-5xl'>✓</div>
            <h2 className='font-semibold text-lg'>Google Agenda connecté !</h2>
            <p className='text-muted text-sm'>Redirection vers les paramètres…</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div className='text-danger text-5xl'>✕</div>
            <h2 className='font-semibold text-lg'>Connexion échouée</h2>
            <p className='text-muted text-sm'>{errorMsg}</p>
            <button
              className='btn-primary w-full'
              onClick={() => navigate('/parametres?tab=integrations')}
            >
              Retour aux paramètres
            </button>
          </>
        )}
      </div>
    </div>
  );
}
