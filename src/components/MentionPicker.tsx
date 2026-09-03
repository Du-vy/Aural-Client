import { useEffect, useRef } from "react";

import { useTranslation } from "@/lib/i18n";
import { EVERYONE, type MentionTarget } from "@/lib/mentions";
import { Avatar } from "./Avatar";

interface MentionPickerProps {
  /** Already ranked: this draws them in the order it is given. */
  targets: readonly MentionTarget[];
  /** Which one Enter would take. */
  active: number;
  onHover(index: number): void;
  onPick(target: MentionTarget): void;
}

/** A stable key: a role and a member may share an id, and keywords have none. */
function keyOf(target: MentionTarget): string {
  return `${target.kind}-${target.id}-${target.name}`;
}

/**
 * The list of who could be meant, over the composer.
 *
 * It is deliberately not focusable. The caret stays in the message box the
 * whole time somebody is picking, because they are still typing the name: the
 * keys that move this list are handled by the box, and a click here is taken
 * on mousedown so the box never loses focus at all.
 */
export function MentionPicker({ targets, active, onHover, onPick }: MentionPickerProps) {
  const { t } = useTranslation();
  const list = useRef<HTMLUListElement>(null);

  // Arrowing past the end of what is on screen has to bring the row with it.
  useEffect(() => {
    const row = list.current?.children[active];
    row?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="mentions" role="presentation">
      <div className="mentions__head">
        <span className="mentions__title">{t("mentions.title")}</span>
        <span className="mentions__hint">{t("mentions.hint")}</span>
      </div>

      <ul className="mentions__list" ref={list} role="listbox" aria-label={t("mentions.title")}>
        {targets.map((target, index) => (
          <li key={keyOf(target)} role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              className={index === active ? "mention-option mention-option--on" : "mention-option"}
              // Mousedown rather than click: a click would land after the box
              // had already lost the caret this insertion needs.
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(target);
              }}
              onMouseEnter={() => onHover(index)}
            >
              <span className="mention-option__face">
                {target.user ? (
                  <Avatar user={target.user} size="sm" status={target.user.status} showStatus />
                ) : (
                  <span
                    className="mention-option__dot"
                    style={target.color ? { background: target.color } : undefined}
                    aria-hidden="true"
                  />
                )}
              </span>

              <span
                className="mention-option__name"
                style={target.color ? { color: target.color } : undefined}
              >
                {target.name}
              </span>

              <span className="mention-option__detail">{detailOf(target, t)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The grey half of a row: what this target is, or the account behind it. */
function detailOf(
  target: MentionTarget,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (target.kind === "keyword") {
    return target.name === EVERYONE ? t("mentions.everyone") : t("mentions.here");
  }
  if (target.kind === "role") return t("mentions.role");
  if (target.alias) return `@${target.alias}`;
  return target.user?.online ? t("common.online") : t("common.offline");
}
