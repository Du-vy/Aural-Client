import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles/theme.css";
import "./styles/app.css";

// Suppress the default browser context menu across the app except on text inputs
window.addEventListener("contextmenu", (event) => {
  const target = event.target as HTMLElement | null;
  const isEditable =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    Boolean(target?.isContentEditable);
  if (!isEditable) {
    event.preventDefault();
  }
});

const container = document.getElementById("root");
if (!container) {
  throw new Error("The #root element is missing from index.html.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
