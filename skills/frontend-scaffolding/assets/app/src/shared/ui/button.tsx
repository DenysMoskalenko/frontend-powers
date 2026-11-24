import { Button as BaseButton } from "@base-ui/react/button";
import { cx } from "./cx";

// Wrapped in cx() so the Tailwind lint rules read them, as they read a className.
const base = cx(
  "inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 font-medium text-sm transition-colors data-disabled:opacity-50",
);

const variants = {
  primary: cx("bg-accent text-accent-fg hover:not-data-disabled:bg-accent/90"),
  secondary: cx("border border-control bg-surface text-fg hover:not-data-disabled:bg-bg"),
} as const;

interface ButtonProps extends Omit<BaseButton.Props, "className"> {
  variant?: keyof typeof variants | undefined;
  /** Layout only (margin, width, placement); looks come from `variant`. */
  className?: string | undefined;
}

export function Button({ variant = "secondary", className, ...props }: ButtonProps) {
  return <BaseButton {...props} className={cx(base, variants[variant], className)} />;
}
