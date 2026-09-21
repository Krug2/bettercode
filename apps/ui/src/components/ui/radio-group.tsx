import * as React from "react"
import { cn } from "@/lib/utils"

type RadioGroupContextValue = {
  name?: string
  value?: string
  setValue: (next: string) => void
}

const RadioGroupContext = React.createContext<RadioGroupContextValue | null>(null)

export interface RadioGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  name?: string
}

export function RadioGroup({
  className,
  value,
  defaultValue,
  onValueChange,
  name,
  children,
  ...props
}: RadioGroupProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue)
  const currentValue = value ?? internalValue
  const setValue = React.useCallback(
    (next: string) => {
      if (value === undefined) setInternalValue(next)
      onValueChange?.(next)
    },
    [onValueChange, value],
  )

  return (
    <RadioGroupContext.Provider value={{ name, value: currentValue, setValue }}>
      <div role="radiogroup" className={cn("grid gap-2", className)} {...props}>
        {children}
      </div>
    </RadioGroupContext.Provider>
  )
}

export interface RadioGroupItemProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  value: string
}

export function RadioGroupItem({ className, value, name, checked, ...props }: RadioGroupItemProps) {
  const ctx = React.useContext(RadioGroupContext)
  const effectiveChecked = checked ?? (ctx ? ctx.value === value : false)
  const effectiveName = name ?? ctx?.name

  return (
    <input
      type="radio"
      className={cn("size-4 accent-primary", className)}
      name={effectiveName}
      value={value}
      checked={effectiveChecked}
      onChange={() => ctx?.setValue(value)}
      {...props}
    />
  )
}
