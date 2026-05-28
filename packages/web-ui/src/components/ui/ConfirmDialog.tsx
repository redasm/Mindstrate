'use client';

import { Modal } from './Modal';
import { Button } from './Button';

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
}: Props) {
  return (
    <Modal open={open} onClose={onClose} width={420}>
      <div className="p-6">
        <h3 className="text-lg font-bold text-surface-900 mb-2">{title}</h3>
        {description && <p className="text-sm text-surface-600 leading-relaxed mb-6">{description}</p>}
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>{cancelLabel}</Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            size="sm"
            onClick={() => { onConfirm(); onClose(); }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
