import type { ReactNode } from 'react'
import { useBackToClose } from '../lib/overlay'

type Props = {
  title: string
  children: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/** A small "are you sure?" pop-up in the middle of the screen. The phone's Back button cancels it. */
export default function ConfirmDialog({ title, children, confirmLabel, onConfirm, onCancel }: Props) {
  useBackToClose(true, onCancel)
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog card" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2 className="card-h">{title}</h2>
        <div className="muted">{children}</div>
        <div className="dialog-actions">
          <button className="outline" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" autoFocus onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
