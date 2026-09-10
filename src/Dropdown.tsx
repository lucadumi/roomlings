import { Children, Fragment, isValidElement, useEffect, useId, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { Feedback } from './Feedback.tsx'
import './dropdown.css'

type Option = { value: string; label: string; disabled: boolean }

function textContent(children: ReactNode): string {
  return Children.toArray(children).map((child) => {
    if (typeof child === 'string' || typeof child === 'number') return String(child)
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) return textContent(child.props.children)
    throw new Error('Dropdown option labels must be plain text.')
  }).join('')
}

function optionsFrom(children: ReactNode): Option[] {
  const options = Children.toArray(children).flatMap((child): Option[] => {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) return optionsFrom(child.props.children)
    if (!isValidElement<ComponentProps<'option'>>(child) || child.type !== 'option') {
      throw new Error('Dropdown children must be options.')
    }
    const label = textContent(child.props.children)
    const value = child.props.value ?? label
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Dropdown values must be single values.')
    return [{ value: String(value), label, disabled: child.props.disabled ?? false }]
  })
  if (new Set(options.map((option) => option.value)).size !== options.length) throw new Error('Dropdown option values must be unique.')
  return options
}

export function Dropdown({ label, value, onValueChange, disabled = false, required = false, children }: {
  label: string
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  required?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const errorId = useId()
  const options = optionsFrom(children)
  const selected = options.find((option) => option.value === value)
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  return <>
    {/* Prefix values so empty choices such as Whole home remain real options. */}
    <Select.Root value={`option:${value}`} open={open && !disabled} onOpenChange={(next) => { setOpen(next); if (next) setError('') }}
      disabled={disabled} required={required} onValueChange={(next) => {
        const option = options.find((option) => `option:${option.value}` === next)
        if (!option || option.disabled) {
          setError('Option unavailable. Choose another.')
          return
        }
        setError('')
        onValueChange(option.value)
      }}>
      <Select.Trigger className="dropdown-trigger" aria-label={label} aria-required={required || undefined}
        aria-invalid={!!error || undefined} aria-describedby={error ? errorId : undefined} data-value={value}>
        <span className="dropdown-value"><Select.Value>{selected?.label ?? 'Choose an option'}</Select.Value></span>
        <Select.Icon asChild><ChevronDown size={16} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="dropdown-content" position="popper" sideOffset={6} collisionPadding={12} aria-label={label}
          onKeyDownCapture={(event) => {
            if (event.key === 'Escape') {
              // Close this menu without dismissing the surrounding form.
              event.preventDefault()
              event.stopPropagation()
              setOpen(false)
            }
          }}>
          <Select.Viewport className="dropdown-viewport">
            {options.map((option) => <Select.Item key={option.value} value={`option:${option.value}`} textValue={option.label}
              disabled={option.disabled} data-option-value={option.value} className="dropdown-option">
              <Select.ItemText>{option.label}</Select.ItemText>
              <Select.ItemIndicator className="dropdown-check"><Check size={15} /></Select.ItemIndicator>
            </Select.Item>)}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
    {error && <Feedback inline id={errorId}>{error}</Feedback>}
  </>
}
