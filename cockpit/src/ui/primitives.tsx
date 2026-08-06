import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleDashed,
  LoaderCircle,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { handleInternalLink } from "./router";

export function InternalLink({
  href,
  className,
  children,
  ariaLabel,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
}) {
  const target = new URL(href, window.location.origin);
  if (!target.searchParams.has("mode")) {
    const currentMode = new URLSearchParams(window.location.search).get("mode");
    if (currentMode === "operator")
      target.searchParams.set("mode", currentMode);
  }
  const resolvedHref = `${target.pathname}${target.search}${target.hash}`;
  return (
    <a
      href={resolvedHref}
      className={className}
      aria-label={ariaLabel}
      onClick={handleInternalLink}
    >
      {children}
    </a>
  );
}

export function Avatar({
  name,
  imageUrl,
  tone = "violet",
}: {
  name: string;
  imageUrl?: string;
  tone?: "violet" | "amber" | "mint" | "ink";
}) {
  const [failedImageUrl, setFailedImageUrl] = useState<string>();
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("pt-BR"))
    .join("");

  return (
    <span className={`avatar avatar--${tone}`} aria-hidden="true">
      {imageUrl && failedImageUrl !== imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          onError={() => setFailedImageUrl(imageUrl)}
        />
      ) : (
        letters || "?"
      )}
    </span>
  );
}

export type Tone = "neutral" | "violet" | "amber" | "mint" | "danger";

export function StateBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return <span className={`state-badge state-badge--${tone}`}>{children}</span>;
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="segmented" aria-label={label}>
      {options.map((option) => (
        <button
          className={
            value === option.value
              ? "segmented__item is-active"
              : "segmented__item"
          }
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          key={option.value}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <CircleDashed size={22} strokeWidth={1.6} aria-hidden="true" />
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

export function LoadingScreen() {
  return (
    <main className="system-screen" aria-busy="true" aria-live="polite">
      <LoaderCircle className="spin" size={22} aria-hidden="true" />
      <div>
        <strong>Abrindo o cockpit</strong>
        <p>Lendo a organização local e o estado atual do Buzz.</p>
      </div>
    </main>
  );
}

export function ErrorScreen({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="system-screen system-screen--error" role="alert">
      <AlertTriangle size={22} aria-hidden="true" />
      <div>
        <strong>O cockpit não conseguiu abrir</strong>
        <p>{message}</p>
        <button className="button button--ink" type="button" onClick={onRetry}>
          <RefreshCw size={15} aria-hidden="true" />
          Tentar novamente
        </button>
      </div>
    </main>
  );
}

export function ConnectionState({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={ok ? "connection-state is-ok" : "connection-state is-offline"}
    >
      {ok ? (
        <Check size={13} aria-hidden="true" />
      ) : (
        <WifiOff size={13} aria-hidden="true" />
      )}
      {label}
    </span>
  );
}

export function RowAction({ label = "Abrir" }: { label?: string }) {
  return (
    <span className="row-action">
      {label}
      <ArrowRight size={14} aria-hidden="true" />
    </span>
  );
}
