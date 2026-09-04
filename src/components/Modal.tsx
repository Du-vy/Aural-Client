import { useEffect, useRef, type ReactNode } from "react";

import { useMouseBack } from "@/store/navigation";
import { CloseIcon } from "./Icons";

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  tabs?: ReactNode;
  wide?: boolean;
}

/**
 * A dialog with the behaviour people expect of one: Escape closes it, a click
 * on the backdrop closes it, and focus lands inside when it opens.
 */
export function Modal({ title, subtitle, onClose, children, footer, tabs, wide }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // The mouse's Back button closes it too, the way Escape does.
  useMouseBack(true, onClose);

  useEffect(() => {
    const focusable = panel.current?.querySelector<HTMLElement>(
      "input, select, textarea, button:not([data-close])",
    );
    focusable?.focus();
  }, []);

  return (
    <div
      className="scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className={wide ? "modal modal--wide" : "modal"}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal__header">
          <div className="modal__heading">
            <h2 className="modal__title">{title}</h2>
            {subtitle ? <p className="modal__subtitle">{subtitle}</p> : null}
          </div>
          <button className="iconbtn" onClick={onClose} data-close aria-label="Close">
            <CloseIcon size={18} />
          </button>
        </header>

        {tabs ? <nav className="tabs">{tabs}</nav> : null}

        <div className="modal__body">{children}</div>

        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
