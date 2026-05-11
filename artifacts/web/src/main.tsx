import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { getAccessToken } from "./lib/auth";
import App from "./App";
import "./index.css";

// Configure the API client to use our in-memory token
setAuthTokenGetter(() => getAccessToken());

createRoot(document.getElementById("root")!).render(<App />);
