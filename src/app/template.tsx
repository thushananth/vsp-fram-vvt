/**
 * Re-mounted on every navigation, so each page arrives with a short settle-in
 * (see .page-enter in globals.css) instead of popping in. Kept to 180ms, opacity
 * only, and never from fully hidden: a fade from nothing reads as slow on a
 * cheap tablet. Turned off for reduced motion.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
