type LogoProps = {
  /** Full logo with icon + wordmark (default) or icon-only */
  variant?: 'full' | 'icon';
  /** Height in px — width scales proportionally */
  height?: number;
  className?: string;
};

/**
 * Gestia brand logo.
 * - variant="full"  → logo.webp  (icon + "Gestia" wordmark)
 * - variant="icon"  → favicon-64.png  (icon mark only)
 */
export default function Logo({ variant = 'full', height = 32, className = '' }: LogoProps) {
  if (variant === 'icon') {
    return (
      <img
        src='/favicon-64.png'
        alt='Gestia'
        height={height}
        width={height}
        className={className}
        style={{ height, width: height, objectFit: 'contain' }}
      />
    );
  }

  // Full logo — let the browser determine width naturally from the intrinsic ratio
  return (
    <img
      src='/logo.webp'
      alt='Gestia'
      height={height}
      className={className}
      style={{ height, width: 'auto' }}
    />
  );
}
