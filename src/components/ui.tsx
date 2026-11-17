import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { useEffect, useId, type ButtonHTMLAttributes, type ReactNode } from 'react'

export function Button({ variant = 'primary', className = '', type = 'button', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-ink text-white hover:bg-black disabled:bg-neutral-300',
    secondary: 'bg-white text-ink border border-line hover:bg-soft disabled:text-neutral-400',
    ghost: 'text-ink hover:bg-soft',
    danger: 'bg-white text-ink border border-ink hover:bg-soft',
  }[variant]
  return (
    <motion.button type={type} whileTap={{ scale: 0.97 }} transition={{ duration: 0.12 }}
      className={`min-h-11 rounded-xl px-4 text-[15px] font-medium transition-colors disabled:cursor-not-allowed ${styles} ${className}`}
      {...(p as object)} />
  )
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      {children(id)}
      {hint && !error && <p className="text-sm text-muted">{hint}</p>}
      {error && <p role="alert" className="text-sm font-medium">⚠ {error}</p>}
    </div>
  )
}

export const inputCls = 'w-full min-h-11 rounded-xl border border-line bg-white px-3 text-[16px] num placeholder:text-neutral-400 focus:border-ink focus:outline-none'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line p-4 ${className}`}>{children}</section>
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex rounded-xl border border-line p-1">
      {options.map(o => (
        <button type="button" key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className="relative flex-1 min-h-10 rounded-lg text-sm font-medium">
          {value === o.value && <motion.span layoutId={`seg-${label}`} className="absolute inset-0 rounded-lg bg-ink" transition={{ duration: 0.2 }} />}
          <span className={`relative ${value === o.value ? 'text-white' : 'text-muted'}`}>{o.label}</span>
        </button>
      ))}
    </div>
  )
}

/** + / − counter. null = not logged (shown as "—"), 0 = observed zero. */
export function Stepper({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <Button variant="secondary" className="w-11 px-0" aria-label={`Decrease ${label}`}
        onClick={() => onChange(value == null || value <= 0 ? 0 : value - 1)}>−</Button>
      <span className="num w-10 text-center text-xl font-semibold" aria-live="polite">{value ?? '—'}</span>
      <Button variant="secondary" className="w-11 px-0" aria-label={`Increase ${label}`}
        onClick={() => onChange((value ?? 0) + 1)}>+</Button>
      {value != null && <button type="button" className="text-sm text-muted underline" onClick={() => onChange(null)}>clear</button>}
    </div>
  )
}

/** Smoothly animates to the committed value; screen readers get only the final value. */
export function AnimatedNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const reduce = useReducedMotion()
  const mv = useMotionValue(value)
  const text = useTransform(mv, v => v.toFixed(decimals))
  useEffect(() => {
    if (reduce) { mv.set(value); return }
    const c = animate(mv, value, { duration: 0.4, ease: 'easeOut' })
    return () => c.stop()
  }, [value, reduce, mv])
  return <><motion.span aria-hidden className="num">{text}</motion.span><span className="sr-only">{value.toFixed(decimals)}</span></>
}

export function EmergencyNotice() {
  return (
    <div role="alert" className="rounded-xl border-2 border-ink p-4">
      <p className="font-semibold">⚠ Contact your vet or an emergency clinic now</p>
      <p className="mt-1 text-sm text-muted">Straining, pain, or little to no urine can be signs of a urinary blockage, which is an emergency. Don't wait for the weekly review.</p>
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line p-6 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  )
}

export function PageFade({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <motion.main initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      className="mx-auto w-full max-w-xl space-y-4 px-4 pb-28 pt-4">
      {children}
    </motion.main>
  )
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-full border border-line px-2 py-0.5 text-xs font-medium">{children}</span>
}
