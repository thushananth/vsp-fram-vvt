/**
 * Loading state for one page's content. The full-screen Splash is for the app
 * starting up; a page waiting on its own data while the menu is already on
 * screen must not cover everything, or moving between pages looks like a restart.
 *
 * The spinner fades in only after a short delay (.skeleton-in), so a wait that
 * the shared cache answers almost at once shows nothing rather than a flash.
 */
export default function PageLoading() {
  return (
    <div role="status" aria-live="polite" className="skeleton-in flex min-h-[50vh] items-center justify-center">
      <span className="h-7 w-7 animate-spin rounded-full border-[3px] border-border border-t-accent" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
