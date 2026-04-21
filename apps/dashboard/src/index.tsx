import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthGate } from "./components/AuthGate";
import "./index.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <AuthGate>
      <App />
    </AuthGate>,
  );
}
