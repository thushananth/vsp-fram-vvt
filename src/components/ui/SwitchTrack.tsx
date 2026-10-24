/**
 * The visual half of an on/off switch — the clickable element around it owns
 * role="switch" and aria-checked. The knob is pinned to the left edge: left
 * unset, an absolutely placed knob inside a <button> starts from the centred
 * content and slides off the track. ON/OFF is spelled out so the state reads
 * without having to know which side means what.
 */
export default function SwitchTrack({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative inline-block h-7 w-[52px] shrink-0 rounded-full transition-colors ${
        on ? "bg-accent" : "bg-muted-2"
      }`}
    >
      <span
        className={`absolute left-[7px] top-1/2 -translate-y-1/2 text-[9px] font-extrabold tracking-wide text-white transition-opacity ${
          on ? "opacity-100" : "opacity-0"
        }`}
      >
        ON
      </span>
      <span
        className={`absolute right-[6px] top-1/2 -translate-y-1/2 text-[9px] font-extrabold tracking-wide text-white transition-opacity ${
          on ? "opacity-0" : "opacity-100"
        }`}
      >
        OFF
      </span>
      <span
        className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-6" : "translate-x-0"
        }`}
      />
    </span>
  );
}
