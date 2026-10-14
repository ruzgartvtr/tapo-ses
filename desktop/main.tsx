import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Studio } from "../components/Studio";
import { I18nProvider } from "../src/i18n";
import "../src/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <Studio />
    </I18nProvider>
  </StrictMode>,
);
