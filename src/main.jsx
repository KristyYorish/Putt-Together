import { createRoot } from "react-dom/client";
import { installStorage } from "./storage.js";
import App from "./putt-together.jsx";

// The app was written for Claude's built-in storage (window.storage).
// On Netlify we provide the same thing ourselves before the app starts.
installStorage();

createRoot(document.getElementById("root")).render(<App />);
