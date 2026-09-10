import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Check, CircleAlert, Info, X } from 'lucide-react'

export function Feedback({ children, tone = 'error', actions, onDismiss, dismissLabel = 'Dismiss message', className = '', id, inline = false }: {
  children: ReactNode
  tone?: 'error' | 'success' | 'info'
  actions?: ReactNode
  onDismiss?: () => void
  dismissLabel?: string
  className?: string
  id?: string
  inline?: boolean
}) {
  const Icon = tone === 'error' ? CircleAlert : tone === 'success' ? Check : Info
  const Container = inline ? 'span' : 'div'
  return <Container className={`feedback feedback-${tone}${tone === 'error' ? ' form-error' : ''}${className ? ` ${className}` : ''}`} id={id}>
    <Icon className="feedback-icon" size={18} aria-hidden="true" />
    <span className="feedback-body">
      <span className="feedback-text" role={tone === 'error' ? 'alert' : 'status'} aria-atomic="true">{children}</span>
      {actions && <span className="feedback-actions">{actions}</span>}
    </span>
    {onDismiss && <button type="button" className="icon-button feedback-dismiss" onClick={onDismiss} aria-label={dismissLabel}><X size={16} aria-hidden="true" /></button>}
  </Container>
}

export function FeedbackAction({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type="button" className={`button secondary small-button feedback-action${className ? ` ${className}` : ''}`} />
}
