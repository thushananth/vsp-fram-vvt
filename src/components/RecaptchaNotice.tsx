/**
 * reCAPTCHA's required attribution. Its floating badge is hidden (globals.css)
 * because, pinned to the bottom-right corner, it sat over the tablet's bottom
 * bar and the basket. Google allows that as long as this notice is shown in
 * the user flow, so it lives on the sign-in screen, which every user sees.
 */
export default function RecaptchaNotice() {
  return (
    <div className="relative mt-6 flex max-w-sm items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, Google's own logo */}
      <img
        src="https://www.gstatic.com/recaptcha/api2/logo_48.png"
        alt="reCAPTCHA"
        width={32}
        height={32}
        className="h-8 w-8 shrink-0"
      />
      <p className="text-[11px] font-medium leading-snug text-white/55">
        Protected by reCAPTCHA. The Google{" "}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="underline">
          Privacy Policy
        </a>{" "}
        and{" "}
        <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="underline">
          Terms of Service
        </a>{" "}
        apply.
      </p>
    </div>
  );
}
