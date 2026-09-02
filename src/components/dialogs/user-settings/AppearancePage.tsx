import { useState, useRef, type FormEvent } from "react";
import { useTranslation } from "@/lib/i18n";
import {
  useTheme,
  FONT_OPTIONS,
  readActiveBackground,
  writeActiveBackground,
  type ThemeColors,
  type AuralTheme,
} from "@/lib/theme";
import {
  readDensity,
  writeDensity,
  type MessageDensity,
} from "@/lib/storage";
import {
  CopyIcon,
  DownloadIcon,
  ImageIcon,
  PaletteIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SlidersIcon,
  TrashIcon,
  UploadIcon,
} from "@/components/Icons";

export function AppearancePage() {
  const { t } = useTranslation();
  const {
    activeTheme,
    allThemes,
    setActiveTheme,
    createCustomTheme,
    duplicateTheme,
    renameCustomTheme,
    deleteCustomTheme,
    resetToDefaultTheme,
    exportThemeToFile,
    importThemeFromFile,
    updateActiveColors,
    updateActiveBackground,
    updateActiveFont,
    updateActiveFontSize,
  } = useTheme();

  const [density, setDensityState] = useState<MessageDensity>(readDensity);
  const [feedback, setFeedback] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const setDensity = (d: MessageDensity) => {
    setDensityState(d);
    writeDensity(d);
  };

  // Modals / prompts state
  const [isCreating, setIsCreating] = useState(false);
  const [newThemeName, setNewThemeName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

  const colorFields: { key: keyof ThemeColors; label: string }[] = [
    { key: "bgMain", label: t("dialogs.userSettings.appearance.colorMain") },
    { key: "bgSidebar", label: t("dialogs.userSettings.appearance.colorSidebar") },
    { key: "bgRail", label: t("dialogs.userSettings.appearance.colorRail") },
    { key: "bgRaised", label: t("dialogs.userSettings.appearance.colorRaised") },
    { key: "bgOverlay", label: t("dialogs.userSettings.appearance.colorOverlay") },
    { key: "bgInput", label: t("dialogs.userSettings.appearance.colorInput") },
    { key: "accent", label: t("dialogs.userSettings.appearance.colorAccent") },
    { key: "text", label: t("dialogs.userSettings.appearance.colorText") },
    { key: "textMuted", label: t("dialogs.userSettings.appearance.colorTextMuted") },
    { key: "danger", label: t("dialogs.userSettings.appearance.colorDanger") },
  ];

  const showFeedback = (msg: string, type: "success" | "error") => {
    setFeedback({ msg, type });
    setTimeout(() => setFeedback(null), 3500);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imported = await importThemeFromFile(file);
      showFeedback(`${t("dialogs.userSettings.appearance.importSuccess")} (${imported.name})`, "success");
    } catch {
      showFeedback(t("dialogs.userSettings.appearance.importError"), "error");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleExport = async (themeToExport: AuralTheme) => {
    try {
      const saved = await exportThemeToFile(themeToExport);
      if (saved) {
        showFeedback(`${t("dialogs.userSettings.appearance.exportSuccess")} (${themeToExport.name})`, "success");
      }
    } catch {
      showFeedback(t("dialogs.userSettings.appearance.exportError"), "error");
    }
  };

  const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        updateActiveBackground({ imageUrl: reader.result });
        showFeedback("¡Fondo de pantalla aplicado correctamente!", "success");
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
    if (imgInputRef.current) imgInputRef.current.value = "";
  };

  const handleCreateSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!newThemeName.trim()) return;
    const created = createCustomTheme(newThemeName.trim());
    setIsCreating(false);
    setNewThemeName("");
    showFeedback(`Tema "${created.name}" creado con éxito`, "success");
  };

  const handleRenameSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!renamingId || !renameValue.trim()) return;
    renameCustomTheme(renamingId, renameValue.trim());
    setRenamingId(null);
    setRenameValue("");
  };

  const handleDeleteConfirm = () => {
    if (!deletingId) return;
    deleteCustomTheme(deletingId);
    setDeletingId(null);
  };

  return (
    <div className="settings-section">
      <header className="settings-section__header">
        <h2 className="settings-section__title">
          {t("dialogs.userSettings.appearance.title")}
        </h2>
        <p className="settings-section__desc">
          {t("dialogs.userSettings.appearance.desc")}
        </p>
      </header>

      {feedback && (
        <div className={`alert ${feedback.type === "error" ? "alert--danger" : "alert--info"}`} style={{ marginBottom: 12 }}>
          {feedback.msg}
        </div>
      )}

      {/* Hidden File Inputs */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".json,.auraltheme"
        style={{ display: "none" }}
        onChange={handleImport}
      />
      <input
        type="file"
        ref={imgInputRef}
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleBgUpload}
      />

      {/* Theme Selection Grid */}
      <div className="settings-card">
        <div className="settings-theme-header-row">
          <div>
            <h3 className="settings-card__title">{t("dialogs.userSettings.appearance.themeTitle")}</h3>
            <p className="field__hint" style={{ marginTop: 2 }}>
              {t("dialogs.userSettings.appearance.themeDesc")}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn--primary"
              style={{ padding: "6px 12px", fontSize: 13 }}
              onClick={() => setIsCreating(true)}
            >
              <PlusIcon size={14} />
              {t("dialogs.userSettings.appearance.newTheme")}
            </button>
            <button
              type="button"
              className="btn"
              style={{ padding: "6px 12px", fontSize: 13 }}
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadIcon size={14} />
              {t("dialogs.userSettings.appearance.importTheme")}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              style={{ padding: "6px 10px", fontSize: 13 }}
              onClick={resetToDefaultTheme}
              title={t("dialogs.userSettings.appearance.resetDefault")}
            >
              <RotateCcwIcon size={14} />
            </button>
          </div>
        </div>

        {/* Modal: New Custom Theme */}
        {isCreating && (
          <form onSubmit={handleCreateSubmit} style={{ marginTop: 14, padding: 12, background: "var(--bg-input)", borderRadius: "var(--radius)", border: "1px solid var(--accent)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span className="field__label">Crear Nuevo Tema Personalizado</span>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  className="input"
                  placeholder="Ej. Cyber Neon, Synthwave..."
                  value={newThemeName}
                  onChange={(e) => setNewThemeName(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="btn btn--primary" disabled={!newThemeName.trim()}>
                  Crear
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setIsCreating(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Modal: Rename Theme */}
        {renamingId && (
          <form onSubmit={handleRenameSubmit} style={{ marginTop: 14, padding: 12, background: "var(--bg-input)", borderRadius: "var(--radius)", border: "1px solid var(--accent)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span className="field__label">{t("dialogs.userSettings.appearance.renamePrompt")}</span>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  className="input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="btn btn--primary" disabled={!renameValue.trim()}>
                  Guardar
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setRenamingId(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Modal: Delete Theme Confirm */}
        {deletingId && (
          <div style={{ marginTop: 14, padding: 12, background: "var(--danger-soft)", borderRadius: "var(--radius)", border: "1px solid var(--danger)" }}>
            <p style={{ fontSize: 13, marginBottom: 8, color: "var(--text)" }}>
              {t("dialogs.userSettings.appearance.deleteThemeConfirm")}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn--danger" onClick={handleDeleteConfirm}>
                {t("dialogs.userSettings.appearance.deleteTheme")}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setDeletingId(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Theme Cards Grid */}
        <div className="settings-theme-grid" style={{ marginTop: 16 }}>
          {allThemes.map((item) => {
            const isActive = activeTheme.id === item.id;
            return (
              <div
                key={item.id}
                className={`theme-card ${isActive ? "theme-card--active" : ""}`}
                onClick={() => setActiveTheme(item.id)}
              >
                {/* Simulated UI Swatch Preview */}
                <div className="theme-card__swatches">
                  <div
                    className="theme-card__swatch-rail"
                    style={{ background: item.colors.bgRail }}
                  >
                    <div
                      className="theme-card__swatch-dot"
                      style={{ background: item.colors.accent }}
                    />
                  </div>
                  <div
                    className="theme-card__swatch-sidebar"
                    style={{ background: item.colors.bgSidebar }}
                  >
                    <div className="theme-card__swatch-line" style={{ background: item.colors.text }} />
                    <div className="theme-card__swatch-line" style={{ background: item.colors.textMuted }} />
                    <div className="theme-card__swatch-line" style={{ background: item.colors.textMuted }} />
                  </div>
                  <div
                    className="theme-card__swatch-main"
                    style={{ background: item.colors.bgMain }}
                  >
                    <div
                      className="theme-card__swatch-bubble"
                      style={{ background: item.colors.bgRaised }}
                    />
                    <div
                      className="theme-card__swatch-accent-pill"
                      style={{ background: item.colors.accent }}
                    />
                  </div>
                </div>

                <div className="theme-card__info">
                  <div className="theme-card__label-wrap">
                    <span className="theme-card__label">{item.name}</span>
                    <span className="theme-card__badge">
                      {isActive
                        ? t("dialogs.userSettings.appearance.activeBadge")
                        : item.isBuiltin
                        ? t("dialogs.userSettings.appearance.builtinBadge")
                        : t("dialogs.userSettings.appearance.customBadge")}
                    </span>
                  </div>

                  <div className="theme-card__actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="iconbtn"
                      style={{ width: 22, height: 22 }}
                      title={t("dialogs.userSettings.appearance.duplicateTheme")}
                      onClick={() => {
                        const dup = duplicateTheme(item.id);
                        showFeedback(`Tema "${dup.name}" duplicado`, "success");
                      }}
                    >
                      <CopyIcon size={12} />
                    </button>
                    <button
                      type="button"
                      className="iconbtn"
                      style={{ width: 22, height: 22 }}
                      title={t("dialogs.userSettings.appearance.exportTheme")}
                      onClick={() => void handleExport(item)}
                    >
                      <DownloadIcon size={12} />
                    </button>
                    {!item.isBuiltin && (
                      <>
                        <button
                          type="button"
                          className="iconbtn"
                          style={{ width: 22, height: 22 }}
                          title={t("dialogs.userSettings.appearance.renameTheme")}
                          onClick={() => {
                            setRenamingId(item.id);
                            setRenameValue(item.name);
                          }}
                        >
                          <PencilIcon size={12} />
                        </button>
                        <button
                          type="button"
                          className="iconbtn iconbtn--danger"
                          style={{ width: 22, height: 22 }}
                          title={t("dialogs.userSettings.appearance.deleteTheme")}
                          onClick={() => setDeletingId(item.id)}
                        >
                          <TrashIcon size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Real-time Theme Customizer for Active Theme */}
      <div className="settings-card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 className="settings-card__title">
            {t("dialogs.userSettings.appearance.themeCustomizerTitle")}: <span style={{ color: "var(--accent)" }}>{activeTheme.name}</span>
          </h3>
          <button
            type="button"
            className="btn btn--ghost"
            style={{ padding: "4px 10px", fontSize: 12 }}
            onClick={() => void handleExport(activeTheme)}
          >
            <DownloadIcon size={14} />
            {t("dialogs.userSettings.appearance.exportTheme")}
          </button>
        </div>

        {/* 1. Colors Palette */}
        <div className="theme-editor-section" style={{ marginTop: 8, paddingTop: 0, borderTop: "none" }}>
          <span className="theme-editor-title">
            <PaletteIcon size={15} />
            {t("dialogs.userSettings.appearance.colorsTitle")}
          </span>
          <div className="theme-color-grid">
            {colorFields.map((field) => {
              const val = activeTheme.colors[field.key];
              return (
                <div key={field.key} className="theme-color-item">
                  <div className="theme-color-picker-wrap" style={{ backgroundColor: val }}>
                    <input
                      type="color"
                      className="theme-color-picker-input"
                      value={val.startsWith("#") && (val.length === 7 || val.length === 4) ? val : "#12b8a0"}
                      onChange={(e) => updateActiveColors({ [field.key]: e.target.value })}
                    />
                  </div>
                  <div className="theme-color-info">
                    <span className="theme-color-label">
                      {field.label}
                    </span>
                    <span className="theme-color-hex">{val}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 2. Optional Background Image */}
        {(() => {
          const currentBg = activeTheme.background?.imageUrl
            ? activeTheme.background
            : (readActiveBackground() || activeTheme.background);
          const hasImage = Boolean(currentBg?.imageUrl);

          return (
            <div className="theme-editor-section">
              <span className="theme-editor-title">
                <ImageIcon size={15} />
                {t("dialogs.userSettings.appearance.bgTitle")}
              </span>
              <div className="theme-bg-controls">
                <div className="theme-bg-input-row">
                  {hasImage && (
                    <div
                      className="theme-bg-preview"
                      style={{ backgroundImage: `url("${currentBg?.imageUrl}")` }}
                    />
                  )}
                  <input
                    type="text"
                    className="input"
                    placeholder={t("dialogs.userSettings.appearance.bgUrlPlaceholder")}
                    value={currentBg?.imageUrl || ""}
                    onChange={(e) => updateActiveBackground({ imageUrl: e.target.value })}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      if (imgInputRef.current) imgInputRef.current.value = "";
                      imgInputRef.current?.click();
                    }}
                  >
                    <UploadIcon size={14} />
                    {t("dialogs.userSettings.appearance.bgUpload")}
                  </button>
                  {hasImage && (
                    <button
                      type="button"
                      className="btn btn--danger"
                      onClick={() => {
                        updateActiveBackground({ imageUrl: "" });
                        writeActiveBackground(null);
                        showFeedback("Fondo eliminado", "success");
                      }}
                      title={t("dialogs.userSettings.appearance.bgRemove")}
                    >
                      <TrashIcon size={14} />
                    </button>
                  )}
                </div>

                {hasImage && (
                  <div className="theme-sliders-grid" style={{ marginTop: 6 }}>
                    <div className="theme-slider-box">
                      <div className="theme-slider-header">
                        <span className="field__label">{t("dialogs.userSettings.appearance.bgBlur")}</span>
                        <span className="field__hint">{currentBg?.blur ?? 0}px</span>
                      </div>
                      <input
                        type="range"
                        className="slider"
                        min={0}
                        max={20}
                        value={currentBg?.blur ?? 0}
                        onChange={(e) => updateActiveBackground({ blur: Number(e.target.value) })}
                      />
                    </div>

                    <div className="theme-slider-box">
                      <div className="theme-slider-header">
                        <span className="field__label">{t("dialogs.userSettings.appearance.bgOpacity")}</span>
                        <span className="field__hint">{currentBg?.opacity ?? 100}%</span>
                      </div>
                      <input
                        type="range"
                        className="slider"
                        min={10}
                        max={100}
                        value={currentBg?.opacity ?? 100}
                        onChange={(e) => updateActiveBackground({ opacity: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* 3. Typography & Font Scaling */}
        <div className="theme-editor-section">
          <span className="theme-editor-title">
            <SlidersIcon size={15} />
            {t("dialogs.userSettings.appearance.fontTitle")}
          </span>
          <div className="theme-sliders-grid">
            <div className="field">
              <label className="field__label">{t("dialogs.userSettings.appearance.fontFamily")}</label>
              <select
                className="select"
                value={activeTheme.fontFamily || FONT_OPTIONS[0]!.value}
                onChange={(e) => updateActiveFont(e.target.value)}
              >
                {FONT_OPTIONS.map((f) => (
                  <option key={f.id} value={f.value} style={{ fontFamily: f.value }}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="theme-slider-box">
              <div className="theme-slider-header">
                <span className="field__label">{t("dialogs.userSettings.appearance.fontSize")}</span>
                <span className="field__hint">{activeTheme.fontSize || 15}px</span>
              </div>
              <input
                type="range"
                className="slider"
                min={12}
                max={20}
                value={activeTheme.fontSize || 15}
                onChange={(e) => updateActiveFontSize(Number(e.target.value))}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Message Density */}
      <div className="settings-card" style={{ marginTop: 16 }}>
        <h3 className="settings-card__title">{t("dialogs.userSettings.appearance.densityTitle")}</h3>
        <div className="settings-radio-group" style={{ marginTop: 12 }}>
          <label className={`settings-radio-card ${density === "cozy" ? "settings-radio-card--active" : ""}`}>
            <input
              type="radio"
              name="msg-density"
              checked={density === "cozy"}
              onChange={() => setDensity("cozy")}
            />
            <span className="settings-radio-card__body">
              <span className="settings-radio-card__title">
                {t("dialogs.userSettings.appearance.densityCozy")}
              </span>
            </span>
          </label>

          <label className={`settings-radio-card ${density === "compact" ? "settings-radio-card--active" : ""}`}>
            <input
              type="radio"
              name="msg-density"
              checked={density === "compact"}
              onChange={() => setDensity("compact")}
            />
            <span className="settings-radio-card__body">
              <span className="settings-radio-card__title">
                {t("dialogs.userSettings.appearance.densityCompact")}
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* Live Chat Preview */}
      <div className="settings-card" style={{ marginTop: 16 }}>
        <h3 className="settings-card__title" style={{ marginBottom: 12 }}>
          {t("dialogs.userSettings.appearance.previewTitle")}
        </h3>
        <div
          className={`chat-preview-box ${density === "compact" ? "chat-preview-box--compact" : ""}`}
          style={{
            fontSize: `${activeTheme.fontSize || 15}px`,
            fontFamily: activeTheme.fontFamily,
          }}
        >
          <div className="chat-preview-item">
            <div className="chat-preview-avatar">A</div>
            <div className="chat-preview-content">
              <div className="chat-preview-header">
                <span className="chat-preview-author" style={{ color: "var(--accent)" }}>Aural Bot</span>
                <span className="chat-preview-time">Today at 12:00 PM</span>
              </div>
              <div className="chat-preview-msg">
                ¡Bienvenido a Aural! Este es un ejemplo de cómo se verá el chat con el tema <strong>{activeTheme.name}</strong> y tu tipografía seleccionada.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
