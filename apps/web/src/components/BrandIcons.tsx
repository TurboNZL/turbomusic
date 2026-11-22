/**
 * The YouTube Music and Spotify marks, for the places that are about one of them (importing from it, "not on it").
 * Drawn here so no image file is needed; they keep their own colours on every theme, which is what makes them recognisable.
 */
export function YouTubeMusicIcon({ size = 16, className }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="11" fill="#FF0000" /><circle cx="12" cy="12" r="7.2" fill="none" stroke="#fff" strokeWidth="1.5" /><path d="M10 8.6v6.8L15.6 12z" fill="#fff" />
  </svg>;
}
export function SpotifyIcon({ size = 16, className }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="11" fill="#1DB954" />
    <g fill="none" stroke="#000" strokeLinecap="round"><path d="M6 9.2c4.2-1.2 8.6-.8 12.2 1.2" strokeWidth="1.9" /><path d="M6.7 12.6c3.5-1 7.1-.7 10 1" strokeWidth="1.6" /><path d="M7.4 15.7c2.8-.8 5.4-.5 7.7.9" strokeWidth="1.3" /></g>
  </svg>;
}
