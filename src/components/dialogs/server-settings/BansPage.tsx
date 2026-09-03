import { useEffect, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import { Perm, has } from "@/lib/permissions";
import { describeError, type Ban } from "@/lib/protocol";
import { formatDateTime } from "@/lib/time";
import { useSession } from "@/store/session";
import { useMyPermissions } from "@/store/selectors";
import { GavelIcon, UserXIcon } from "../../Icons";
import { ConfirmDialog } from "../ConfirmDialog";

/**
 * The ban list.
 *
 * What a ban actually catches is summarised rather than spelled out: an address
 * and a device hash identify somebody outside this server as well as inside it,
 * and a moderator deciding whether to lift a ban needs to know that it reaches
 * a machine, not which machine it reaches. The server never sends the values.
 */
export function ServerBansPage() {
  const { t } = useTranslation();
  const bans = useSession((state) => state.bans);
  const listBans = useSession((state) => state.listBans);
  const deleteBan = useSession((state) => state.deleteBan);

  const permissions = useMyPermissions();
  const allowed = has(permissions, Perm.BanUsers);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lifting, setLifting] = useState<Ban | null>(null);

  useEffect(() => {
    if (!allowed) return;
    setLoading(true);
    listBans()
      .catch((failure: unknown) => setError(describeError(failure)))
      .finally(() => setLoading(false));
  }, [allowed, listBans]);

  async function lift(ban: Ban) {
    setError(null);
    try {
      await deleteBan(ban.id);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setLifting(null);
    }
  }

  if (!allowed) {
    return (
      <div className="settings-section">
        <header className="settings-section__header">
          <h2 className="settings-section__title">{t("dialogs.serverSettings.bans.title")}</h2>
          <p className="settings-section__desc">{t("dialogs.serverSettings.bans.noPermission")}</p>
        </header>
      </div>
    );
  }

  const list = bans ?? [];

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">{t("dialogs.serverSettings.bans.title")}</h2>
        <p className="settings-section__desc">{t("dialogs.serverSettings.bans.desc")}</p>
      </header>

      {error ? <p className="settings-inline-error">{error}</p> : null}

      <div className="settings-card">
        {loading && list.length === 0 ? (
          <p className="settings-card__subtitle">{t("common.loading")}</p>
        ) : list.length === 0 ? (
          <p className="settings-card__subtitle">{t("dialogs.serverSettings.bans.empty")}</p>
        ) : (
          <ul className="ban-list">
            {list.map((ban) => (
              <li key={ban.id} className={ban.active ? "ban-row" : "ban-row ban-row--expired"}>
                <span className="ban-row__icon" aria-hidden="true">
                  <UserXIcon size={18} />
                </span>

                <div className="ban-row__body">
                  <div className="ban-row__name">
                    <strong>{ban.userNickname}</strong>
                    {ban.userUsername ? (
                      <span className="field__hint">@{ban.userUsername}</span>
                    ) : (
                      <span className="settings-badge">{t("common.guest")}</span>
                    )}
                    {!ban.active ? (
                      <span className="settings-badge">
                        {t("dialogs.serverSettings.bans.expired")}
                      </span>
                    ) : null}
                  </div>

                  <p className="ban-row__reason">
                    {ban.reason || t("dialogs.serverSettings.bans.noReason")}
                  </p>

                  <p className="ban-row__meta">
                    {t("dialogs.serverSettings.bans.by", {
                      actor: ban.actorNickname,
                      when: formatDateTime(ban.createdAt),
                    })}
                    {ban.expiresAt
                      ? ` · ${t("dialogs.serverSettings.bans.until", {
                          when: formatDateTime(ban.expiresAt),
                        })}`
                      : ` · ${t("dialogs.serverSettings.bans.permanent")}`}
                  </p>

                  <div className="ban-row__matches">
                    {ban.matches.map((match) => (
                      <span
                        key={match.kind}
                        className="settings-badge"
                        title={t(`dialogs.serverSettings.bans.matchHelp.${match.kind}` as never)}
                      >
                        {t(`dialogs.serverSettings.bans.match.${match.kind}` as never)}
                        {match.count > 1 ? ` ×${match.count}` : ""}
                      </span>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setLifting(ban)}
                >
                  {t("dialogs.serverSettings.bans.lift")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="settings-card settings-card--note">
        <span className="settings-card__note-icon" aria-hidden="true">
          <GavelIcon size={18} />
        </span>
        <p className="settings-card__subtitle">{t("dialogs.serverSettings.bans.explainer")}</p>
      </div>

      {lifting ? (
        <ConfirmDialog
          title={t("dialogs.serverSettings.bans.lift")}
          subtitle={t("dialogs.serverSettings.bans.liftConfirm", { name: lifting.userNickname })}
          confirmText={t("dialogs.serverSettings.bans.lift")}
          onConfirm={() => void lift(lifting)}
          onClose={() => setLifting(null)}
        />
      ) : null}
    </div>
  );
}
