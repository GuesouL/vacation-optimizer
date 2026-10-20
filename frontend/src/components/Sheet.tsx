"use client";

import { type ReactNode, useEffect, useRef } from "react";

/**
 * A native <dialog> opened with showModal(), which gives us the dimmed backdrop, Esc
 * to close and focus kept inside for free. It slides up from the bottom on phones
 * and sits centered on laptops.
 */
export default function Sheet(props: {
  open: boolean;
  onClose: () => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { open } = props;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={props.onClose}
      // A tap on the backdrop lands on the <dialog> itself, not its content: close.
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
      aria-label={props.label}
      className={`m-0 mt-auto max-h-[85vh] w-full max-w-none rounded-t-2xl bg-app-surface p-0 text-foreground backdrop:bg-black/40 md:m-auto md:max-w-lg md:rounded-2xl ${props.className ?? ""}`}
    >
      <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-app-line md:hidden" aria-hidden="true" />
        <button onClick={props.onClose} className="float-right text-sm text-app-link underline">Close</button>
        {props.children}
      </div>
    </dialog>
  );
}
