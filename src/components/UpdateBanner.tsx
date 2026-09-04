import { DownloadIcon, CloseIcon, AlertTriangleIcon, CheckCircleIcon } from "@/components/Icons";
import { useTranslation } from "@/lib/i18n";
import {
  dismissUpdate,
  installUpdate,
  openReleasesPage,
  restartIntoUpdate,
  useUpdateState,
} from "@/lib/updater";

/**
 * What the client says when there is a newer release.
 *
 * A corner card rather than a bar across the top, because it appears while
 * somebody is doing something else. Nothing here moves the layout, nothing
 * takes focus, and no state it can be in blocks the client: an update found at
 * startup is news, not an interruption, and the thing it is interrupting might
 * be a conversation.
 *
 * The two states it deliberately does not draw are `checking` and a failed
 * check. Both only ever come from the button on the settings page, and both
 * belong next to the button that caused them.
 */
export function UpdateBanner() {
  const { t } = useTranslation();
  const state = useUpdateState();

  if (state.phase === "idle" || state.phase === "checking") return null;
  if (state.phase === "failed" && state.where === "check") return null;

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <div className="update-banner__icon" aria-hidden="true">
        {state.phase === "ready" ? (
          <CheckCircleIcon size={18} />
        ) : state.phase === "failed" ? (
          <AlertTriangleIcon size={18} />
        ) : (
          <DownloadIcon size={18} />
        )}
      </div>

      <div className="update-banner__body">
        {state.phase === "available" ? (
          <p className="update-banner__text">{t("updater.available", { version: state.version })}</p>
        ) : null}

        {state.phase === "downloading" ? (
          <>
            <p className="update-banner__text">
              {t("updater.downloading", { version: state.version })}
            </p>
            {/* Indeterminate when the download sent no length to divide by,
                rather than a bar that sits at zero and looks stuck. */}
            <div
              className={
                state.percent === null
                  ? "update-banner__bar update-banner__bar--waiting"
                  : "update-banner__bar"
              }
            >
              <div
                className="update-banner__bar-fill"
                style={state.percent === null ? undefined : { width: `${state.percent}%` }}
              />
            </div>
          </>
        ) : null}

        {state.phase === "ready" ? (
          <p className="update-banner__text">{t("updater.ready", { version: state.version })}</p>
        ) : null}

        {state.phase === "failed" ? (
          <p className="update-banner__text">{t("updater.installFailed")}</p>
        ) : null}
      </div>

      <div className="update-banner__actions">
        {state.phase === "available" ? (
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void installUpdate()}>
            {t("updater.install")}
          </button>
        ) : null}

        {state.phase === "ready" ? (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => void restartIntoUpdate()}
          >
            {t("updater.restart")}
          </button>
        ) : null}

        {state.phase === "failed" ? (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => void openReleasesPage()}
          >
            {t("updater.download")}
          </button>
        ) : null}

        {/* Everything but the download can be put away. A download in progress
            has nothing to dismiss: stopping it would need a cancel, and this
            is the wrong shape of control for one. */}
        {state.phase !== "downloading" ? (
          <button
            type="button"
            className="iconbtn"
            onClick={dismissUpdate}
            aria-label={t("updater.dismiss")}
            title={t("updater.dismiss")}
          >
            <CloseIcon size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
