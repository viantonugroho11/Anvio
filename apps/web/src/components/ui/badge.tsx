import { cn } from '@/lib/cn';

const variants: Record<string, string> = {
  default: 'bg-[var(--accent)]/20 text-[var(--accent)]',
  success: 'bg-[var(--green)]/20 text-[var(--green)]',
  warning: 'bg-[var(--yellow)]/20 text-[var(--yellow)]',
  danger: 'bg-[var(--red)]/20 text-[var(--red)]',
  muted: 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]',
};

export function Badge({
  variant = 'default',
  className,
  children,
}: {
  variant?: keyof typeof variants;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        variants[variant] ?? variants.default,
        className,
      )}
    >
      {children}
    </span>
  );
}
