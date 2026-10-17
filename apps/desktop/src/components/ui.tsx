import type { EntryStatus } from "@atlas/core";
import {
  Boxes,
  Circle,
  CircleQuestionMark,
  LoaderCircle,
  Lock,
  Signpost,
  Split,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

// ── kinds ────────────────────────────────────────────────────

interface KindMeta {
  label: string;
  icon: LucideIcon;
  color: string;
}

const KINDS: Record<string, KindMeta> = {
  decision: { label: "Decision", icon: Signpost, color: "var(--blue)" },
  architecture: { label: "Architecture", icon: Boxes, color: "var(--purple)" },
  constraint: { label: "Constraint", icon: Lock, color: "var(--gray)" },
  open_question: { label: "Open question", icon: CircleQuestionMark, color: "var(--orange)" },
  risk: { label: "Risk", icon: TriangleAlert, color: "var(--red)" },
  pivot: { label: "Pivot", icon: Split, color: "var(--pink)" },
};

export function kindMeta(kind: string): KindMeta {
  return (
    KINDS[kind] ?? {
      label: kind.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      icon: Circle,
      color: "var(--teal)",
    }
  );
}

export function KindGlyph({
  kind,
  size = 22,
  muted = false,
  onAccent = false,
}: {
  kind: string;
  size?: number;
  muted?: boolean;
  /** Drawn on an accent-filled selection, where the tinted colour would vanish. */
  onAccent?: boolean;
}) {
  const { icon: Icon, color, label } = kindMeta(kind);
  const c = onAccent ? "var(--accent-text)" : muted ? "var(--label-3)" : color;
  return (
    <span
      role="img"
      aria-label={label}
      className="inline-flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: `color-mix(in srgb, ${c} ${onAccent ? 22 : 15}%, transparent)`,
        color: c,
      }}
    >
      <Icon size={size * 0.6} strokeWidth={2} />
    </span>
  );
}

// ── pills ────────────────────────────────────────────────────

type Tone = "neutral" | "accent" | "orange" | "green" | "pink";

const TONES: Record<Tone, string> = {
  neutral: "var(--gray)",
  accent: "var(--accent)",
  orange: "var(--orange)",
  green: "var(--green)",
  pink: "var(--pink)",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const c = TONES[tone];
  return (
    <span
      className="t-caption inline-flex h-[18px] items-center rounded-[5px] px-1.5 font-medium whitespace-nowrap"
      style={{ background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c }}
    >
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: EntryStatus }) {
  if (status === "active") return null;
  const tone: Tone = status === "resolved" ? "green" : "neutral";
  return <Pill tone={tone}>{status[0]!.toUpperCase() + status.slice(1)}</Pill>;
}

// ── buttons ──────────────────────────────────────────────────

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "plain" | "destructive";
  size?: "small" | "regular" | "large";
};

export function Button({
  variant = "secondary",
  size = "regular",
  className = "",
  style,
  ...rest
}: ButtonProps) {
  const h = size === "small" ? 22 : size === "large" ? 32 : 26;
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-[6px] px-2.5 font-medium transition-[filter,background] duration-100 disabled:opacity-40 active:brightness-90";
  const styles: Record<string, React.CSSProperties> = {
    primary: {
      background: "var(--accent)",
      color: "var(--accent-text)",
      boxShadow: "0 0.5px 1px rgb(0 0 0 / 0.2)",
    },
    secondary: { background: "var(--control)", boxShadow: "var(--shadow-card)" },
    plain: { background: "transparent", color: "var(--label-2)" },
    destructive: {
      background: "var(--control)",
      color: "var(--red)",
      boxShadow: "var(--shadow-card)",
    },
  };
  return (
    <button
      type="button"
      className={`${base} ${size === "small" ? "t-callout" : "t-body"} ${variant === "plain" ? "hover:bg-[var(--fill)]" : ""} ${className}`}
      style={{ height: h, ...styles[variant], ...style }}
      {...rest}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      className="t-caption inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] px-1 font-medium"
      style={{ color: "var(--label-3)", boxShadow: "inset 0 0 0 0.5px var(--separator-strong)" }}
    >
      {children}
    </kbd>
  );
}

// ── segmented control ───────────────────────────────────────

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex h-[24px] items-center rounded-[7px] p-[2px]"
      style={{ background: "var(--fill-2)" }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className="t-callout h-full rounded-[5px] px-2.5 font-medium transition-colors duration-100"
            style={
              active
                ? {
                    background: "var(--elevated)",
                    boxShadow: "0 0.5px 2px rgb(0 0 0 / 0.18)",
                    color: "var(--label)",
                  }
                : { color: "var(--label-2)" }
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── states ───────────────────────────────────────────────────

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <LoaderCircle
      size={size}
      className="animate-spin"
      style={{ color: "var(--label-3)" }}
      aria-label="Loading"
    />
  );
}

export function EmptyState({
  icon: Icon,
  title,
  message,
  children,
}: {
  icon: LucideIcon;
  title: string;
  message: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-10 text-center">
      <Icon size={36} strokeWidth={1.4} style={{ color: "var(--label-3)" }} aria-hidden />
      <h2 className="t-title2 mt-3">{title}</h2>
      <p className="t-body mt-1.5 max-w-[340px]" style={{ color: "var(--label-2)" }}>
        {message}
      </p>
      {children && <div className="mt-4 flex gap-2">{children}</div>}
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-4 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3">
          <div className="skeleton h-[22px] w-[22px] shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3" style={{ width: `${60 + ((i * 13) % 30)}%` }} />
            <div className="skeleton h-2.5 w-[85%]" />
          </div>
        </div>
      ))}
    </div>
  );
}
