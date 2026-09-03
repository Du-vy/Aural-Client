import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import { Perm, has } from "@/lib/permissions";
import type { AuditEntry } from "@/lib/protocol";
import { formatDateTime } from "@/lib/time";
import { useSession } from "@/store/session";
import { useMyPermissions } from "@/store/selectors";
import { FileTextIcon } from "../../Icons";

/**
 * The audit log: what moderators did, in the order they did it.
 *
 * Everything an entry names was captured when it was written, so a role deleted
 * last week still reads by the name it had. That is what makes the log worth
 * keeping and what stops it changing every time it is opened.
 */
export function ServerAuditPage() {
  const { t } = useTranslation();
  const audit = useSession((state) => state.audit);
  const loadAudit = useSession((state) => state.loadAudit);
  const users = useSession((state) => state.users);

  const permissions = useMyPermissions();
  const allowed = has(permissions, Perm.ViewAuditLog);

  const [action, setAction] = useState("");

  useEffect(() => {
    if (!allowed) return;
    void loadAudit(action ? { action } : {});
  }, [allowed, loadAudit, action]);

  // Every action the held page mentions, so the filter offers what is actually
  // there rather than a fixed list of everything the protocol can log.
  const actions = useMemo(() => {
    const seen = new Set<string>();
    for (const entry of audit.entries) seen.add(entry.action);
    return [...seen].sort();
  }, [audit.entries]);

  if (!allowed) {
    return (
      <div className="settings-section">
        <header className="settings-section__header">
          <h2 className="settings-section__title">{t("dialogs.serverSettings.audit.title")}</h2>
          <p className="settings-section__desc">{t("dialogs.serverSettings.audit.noPermission")}</p>
        </header>
      </div>
    );
  }

  const oldest = audit.entries.at(-1);

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">{t("dialogs.serverSettings.audit.title")}</h2>
        <p className="settings-section__desc">{t("dialogs.serverSettings.audit.desc")}</p>
      </header>

      <div className="settings-card">
        <div className="field field--inline">
          <label className="field__label" htmlFor="audit-action">
            {t("dialogs.serverSettings.audit.filterAction")}
          </label>
          <select
            id="audit-action"
            className="input"
            value={action}
            onChange={(event) => setAction(event.target.value)}
          >
            <option value="">{t("dialogs.serverSettings.audit.filterAll")}</option>
            {actions.map((name) => (
              <option key={name} value={name}>
                {actionLabel(t, name)}
              </option>
            ))}
          </select>
        </div>

        {audit.error ? <p className="settings-inline-error">{audit.error}</p> : null}

        {audit.entries.length === 0 ? (
          <p className="settings-card__subtitle">
            {audit.loading ? t("common.loading") : t("dialogs.serverSettings.audit.empty")}
          </p>
        ) : (
          <ul className="audit-list">
            {audit.entries.map((entry) => (
              <AuditRow
                key={entry.id}
                entry={entry}
                actorName={
                  entry.actorId !== null
                    ? (users.get(entry.actorId)?.nickname ?? entry.actorName)
                    : entry.actorName
                }
              />
            ))}
          </ul>
        )}

        {audit.hasMore && oldest ? (
          <div className="settings-actions">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={audit.loading}
              onClick={() =>
                void loadAudit(action ? { before: oldest.id, action } : { before: oldest.id })
              }
            >
              {audit.loading ? t("common.loading") : t("dialogs.serverSettings.audit.loadMore")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AuditRow({ entry, actorName }: { entry: AuditEntry; actorName: string }) {
  const { t } = useTranslation();

  return (
    <li className="audit-row">
      <span className="audit-row__icon" aria-hidden="true">
        <FileTextIcon size={16} />
      </span>
      <div className="audit-row__body">
        <p className="audit-row__headline">
          <strong>{actorName}</strong> {actionLabel(t, entry.action)}
          {entry.targetName ? <> <strong>{entry.targetName}</strong></> : null}
        </p>

        {entry.reason ? <p className="audit-row__reason">{entry.reason}</p> : null}

        {entry.changes && entry.changes.length > 0 ? (
          <ul className="audit-row__changes">
            {entry.changes.map((change, index) => (
              <li key={`${change.key}-${index}`}>
                <span className="audit-row__key">{change.key}</span>
                {change.before ? <span className="audit-row__before">{change.before}</span> : null}
                {change.before && change.after ? <span aria-hidden="true"> → </span> : null}
                {change.after ? <span className="audit-row__after">{change.after}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}

        <p className="audit-row__meta">{formatDateTime(entry.createdAt)}</p>
      </div>
    </li>
  );
}

/**
 * The wording for one action.
 *
 * The dot in an action name becomes an underscore: the translation resolver
 * reads a key as a path, so `user.ban` would be looked up as three levels of
 * nesting rather than as one name.
 *
 * An action this client has no phrase for falls back to the string the server
 * sent, so a log written by a newer server still reads as something rather
 * than as a blank.
 */
function actionLabel(t: (key: never, params?: never) => string, action: string): string {
  const key = `dialogs.serverSettings.audit.actions.${action.replace(/\./g, "_")}`;
  const translated = t(key as never);
  return translated === key ? action : translated;
}
