'use client';

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Max width of card. */
  width?: number | string;
};

export function Modal({ open, onClose, children, width = 480 }: Props) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open || typeof window === 'undefined') return null;

  const node = (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <div className="absolute inset-0 bg-surface-900/50 backdrop-anim" onClick={onClose} />
      <div
        className="relative bg-white rounded-2xl modal-shadow flex flex-col overflow-hidden modal-anim"
        style={{ width, maxWidth: 'calc(100vw - 32px)', maxHeight: '80vh' }}
      >
        {children}
      </div>
    </div>
  );
  return createPortal(node, document.body);
}
