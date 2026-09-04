import { useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { useSession } from "@/store/session";
import {
  SettingsModal,
  type SettingsNavCategory,
} from "../SettingsModal";
import { Avatar } from "../Avatar";
import {
  BellIcon,
  GlobeIcon,
  KeyIcon,
  LogOutIcon,
  MicIcon,
  MonitorIcon,
  AccessibilityIcon,
  PaletteIcon,
  ShieldIcon,
  UserIcon,
} from "../Icons";
import { ProfilePage } from "./user-settings/ProfilePage";
import { AccountPage } from "./user-settings/AccountPage";
import { PrivacyPage } from "./user-settings/PrivacyPage";
import { VoiceAudioPage } from "./user-settings/VoiceAudioPage";
import { AppearancePage } from "./user-settings/AppearancePage";
import { NotificationsPage } from "./user-settings/NotificationsPage";
import { AccessibilityPage } from "./user-settings/AccessibilityPage";
import { LanguagePage } from "./user-settings/LanguagePage";
import { StartupPage } from "./user-settings/StartupPage";

type TabId =
  | "profile"
  | "account"
  | "privacy"
  | "voice"
  | "appearance"
  | "notifications"
  | "accessibility"
  | "language"
  | "startup";

export function UserSettingsDialog({
  onClose,
  initialTab,
}: {
  onClose(): void;
  /** Which page to open on. The voice strip uses it to land on voice. */
  initialTab?: TabId;
}) {
  const { t } = useTranslation();
  const self = useSession((state) => state.self);
  const disconnect = useSession((state) => state.disconnect);

  const [activeTab, setActiveTab] = useState<TabId>(initialTab ?? "profile");

  if (!self) return null;

  const categories: SettingsNavCategory[] = [
    {
      title: t("dialogs.userSettings.categoryUser"),
      items: [
        {
          id: "profile",
          label: t("dialogs.userSettings.tabProfile"),
          icon: <UserIcon size={16} />,
        },
        {
          id: "account",
          label: t("dialogs.userSettings.tabAccount"),
          icon: <KeyIcon size={16} />,
        },
        {
          id: "privacy",
          label: t("dialogs.userSettings.tabPrivacy"),
          icon: <ShieldIcon size={16} />,
        },
      ],
    },
    {
      title: t("dialogs.userSettings.categoryApp"),
      items: [
        {
          id: "voice",
          label: t("dialogs.userSettings.tabVoice"),
          icon: <MicIcon size={16} />,
        },
        {
          id: "appearance",
          label: t("dialogs.userSettings.tabAppearance"),
          icon: <PaletteIcon size={16} />,
        },
        {
          id: "notifications",
          label: t("dialogs.userSettings.tabNotifications"),
          icon: <BellIcon size={16} />,
        },
        {
          id: "accessibility",
          label: t("dialogs.userSettings.tabAccessibility"),
          icon: <AccessibilityIcon size={16} />,
        },
        {
          id: "language",
          label: t("dialogs.userSettings.tabLanguage"),
          icon: <GlobeIcon size={16} />,
        },
        {
          id: "startup",
          label: t("dialogs.userSettings.tabStartup"),
          icon: <MonitorIcon size={16} />,
        },
      ],
    },
  ];

  const headerElement = (
    <div className="settings-user-header">
      <Avatar user={self} size="md" status={self.status} showStatus />
      <div className="settings-user-header__info">
        <span className="settings-user-header__name">{self.nickname}</span>
        <span className="settings-user-header__sub">
          {self.registered ? `@${self.username}` : t("common.guest")}
        </span>
      </div>
    </div>
  );

  const sidebarFooter = (
    <div className="settings-sidebar__footer-content">
      <button
        type="button"
        className="settings-nav-item settings-nav-item--danger"
        onClick={() => {
          onClose();
          disconnect();
        }}
      >
        <span className="settings-nav-item__icon">
          <LogOutIcon size={16} />
        </span>
        <span className="settings-nav-item__label">{t("userPanel.disconnect")}</span>
      </button>
      <div className="settings-sidebar__version-wrap">
        <span className="settings-sidebar__version">Aural Client v0.7.8</span>
      </div>
    </div>
  );

  return (
    <SettingsModal
      headerElement={headerElement}
      categories={categories}
      activeTab={activeTab}
      onSelectTab={(tabId) => setActiveTab(tabId as TabId)}
      onClose={onClose}
      sidebarFooter={sidebarFooter}
    >
      {activeTab === "profile" ? <ProfilePage /> : null}
      {activeTab === "account" ? <AccountPage /> : null}
      {activeTab === "privacy" ? <PrivacyPage /> : null}
      {activeTab === "voice" ? <VoiceAudioPage /> : null}
      {activeTab === "appearance" ? <AppearancePage /> : null}
      {activeTab === "notifications" ? <NotificationsPage /> : null}
      {activeTab === "accessibility" ? <AccessibilityPage /> : null}
      {activeTab === "language" ? <LanguagePage /> : null}
      {activeTab === "startup" ? <StartupPage /> : null}
    </SettingsModal>
  );
}
