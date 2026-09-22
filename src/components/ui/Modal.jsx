import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// Native modal semantics provide focus containment, Escape, background inertness
// and return focus to the opener. Calendar popovers portal into the open dialog.
export default function Modal({ onClose, className = '', children, ...props }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    const opener = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (opener?.isConnected) opener.focus()
    }
  }, [])
  return createPortal(<dialog ref={ref} className={`modal-shell ${className}`} onCancel={(event) => { event.preventDefault(); onClose() }} {...props}>{children}</dialog>, document.body)
}
