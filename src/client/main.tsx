import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";

const elem = document.getElementById("root")!;
const tree = (
  <StrictMode>
    <App />
  </StrictMode>
);

declare global {
  interface ImportMeta {
    hot?: { data: { root?: Root } };
  }
}

const root = import.meta.hot
  ? (import.meta.hot.data.root ??= createRoot(elem))
  : createRoot(elem);

root.render(tree);
