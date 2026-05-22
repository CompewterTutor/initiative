import { CounterValueInput } from "@/components/initiativeTools/counters/CounterValueInput";
import { cn } from "@/lib/utils";

interface CounterProgressBarViewProps {
  count: string;
  min: string;
  max: string;
  step?: string;
  disabled?: boolean;
  textColor?: string;
  onCommit: (value: string) => void;
  ariaLabel?: string;
  className?: string;
  /** Size hint — "xl" enlarges the value for grid cards. */
  size?: "xl" | "lg";
}

const toNum = (value: string): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Stacked layout — the value sits above a full-width progress bar. This
 * keeps the bar legible even in the narrow content area of a row-layout
 * card on phones, where an inline ``[bar] {value} / {max}`` would collapse
 * the bar to a sliver.
 */
export const CounterProgressBarView = ({
  count,
  min,
  max,
  step,
  disabled,
  textColor,
  onCommit,
  ariaLabel,
  className,
  size = "lg",
}: CounterProgressBarViewProps) => {
  const minN = toNum(min);
  const maxN = toNum(max);
  const range = maxN - minN;
  const value = toNum(count);
  const pct = range > 0 ? Math.max(0, Math.min(100, ((value - minN) / range) * 100)) : 0;

  return (
    <div className={cn("flex w-full flex-col items-center gap-1.5", className)}>
      <div
        className="flex items-baseline justify-center gap-1 font-mono tabular-nums"
        style={{ color: textColor }}
      >
        <CounterValueInput
          value={count}
          step={step}
          disabled={disabled}
          onCommit={onCommit}
          textColor={textColor}
          size={size}
          ariaLabel={ariaLabel}
        />
        <span className={size === "xl" ? "text-base opacity-70" : "text-sm opacity-70"}>
          / {max}
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: "rgba(0,0,0,0.18)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: textColor ?? "rgba(255,255,255,0.85)",
          }}
        />
      </div>
    </div>
  );
};
