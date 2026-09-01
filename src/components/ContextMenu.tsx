import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  keepOpen?: boolean;
  onClick?: () => void;
  items?: MenuEntry[];
}

export type MenuEntry = MenuItem | { type: "separator" };

export interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Clamp positioning inside the viewport
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const margin = 8;
    let nextX = x;
    let nextY = y;

    if (x + rect.width > window.innerWidth - margin) {
      nextX = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (y + rect.height > window.innerHeight - margin) {
      nextY = Math.max(margin, window.innerHeight - rect.height - margin);
    }

    setPos({ x: nextX, y: nextY });
  }, [x, y]);

  // Handle outside clicks, escape key, and window scrolling/resizing
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }

    function onScrollOrResize() {
      onClose();
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={rootRef}
      className="menu"
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
      }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuList items={items} onClose={onClose} />
    </div>,
    document.body
  );
}

interface MenuListProps {
  items: MenuEntry[];
  onClose: () => void;
}

function MenuList({ items, onClose }: MenuListProps) {
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);

  return (
    <div className="menu__list">
      {items.map((entry, index) => {
        if ("type" in entry && entry.type === "separator") {
          return <div key={`sep-${index}`} className="menu__divider" role="separator" />;
        }

        const item = entry as MenuItem;
        const hasSubmenu = item.items && item.items.length > 0;
        const isSubmenuOpen = activeSubmenu === item.id;

        return (
          <div
            key={item.id}
            className="menu__item-wrapper"
            onMouseEnter={() => {
              if (hasSubmenu && !item.disabled) setActiveSubmenu(item.id);
              else setActiveSubmenu(null);
            }}
          >
            <button
              type="button"
              className={[
                "menu__item",
                item.danger ? "menu__item--danger" : "",
                item.disabled ? "menu__item--disabled" : "",
                hasSubmenu ? "menu__item--has-submenu" : "",
                isSubmenuOpen ? "menu__item--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={item.disabled}
              onClick={(e) => {
                e.stopPropagation();
                if (item.disabled) return;
                item.onClick?.();
                if (!item.keepOpen && !hasSubmenu) {
                  onClose();
                }
              }}
              role={item.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
              aria-checked={item.checked}
            >
              {item.checked !== undefined ? (
                <span className={item.checked ? "menu__checkbox menu__checkbox--checked" : "menu__checkbox"}>
                  {item.checked ? "✓" : ""}
                </span>
              ) : item.icon ? (
                <span className="menu__icon">{item.icon}</span>
              ) : null}

              <span className="menu__label">{item.label}</span>

              {hasSubmenu ? <span className="menu__arrow">›</span> : null}
            </button>

            {hasSubmenu && isSubmenuOpen && !item.disabled ? (
              <Submenu items={item.items!} onClose={onClose} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

interface SubmenuProps {
  items: MenuEntry[];
  onClose: () => void;
}

function Submenu({ items, onClose }: SubmenuProps) {
  const submenuRef = useRef<HTMLDivElement>(null);
  const [alignedLeft, setAlignedLeft] = useState(false);

  useLayoutEffect(() => {
    const el = submenuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
      setAlignedLeft(true);
    }
  }, []);

  return (
    <div
      ref={submenuRef}
      className={alignedLeft ? "menu menu--submenu menu--submenu-left" : "menu menu--submenu"}
      role="menu"
    >
      <MenuList items={items} onClose={onClose} />
    </div>
  );
}
