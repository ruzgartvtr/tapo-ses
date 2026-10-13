import "@fontsource/fraunces/500.css";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Studio } from "../components/Studio";
import "../src/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Studio />
  </StrictMode>,
);
