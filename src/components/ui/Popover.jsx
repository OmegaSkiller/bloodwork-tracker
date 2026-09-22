import { forwardRef } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger

export const PopoverContent = forwardRef(function PopoverContent(
  { className = '', align = 'start', sideOffset = 8, ...props },
  ref,
) {
  return (
    <PopoverPrimitive.Portal container={document.querySelector('dialog[open]') || undefined}>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={12}
        className={`z-[70] rounded-2xl border border-stone-200 bg-white p-2 text-stone-900 shadow-2xl outline-none ${className}`}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
})
