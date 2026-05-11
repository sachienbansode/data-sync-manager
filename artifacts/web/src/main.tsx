import { createRoot } from "react-dom/client";
import { setAuthTokenGetter, setTokenRefresher } from "@workspace/api-client-react";
import { getAccessToken, silentRefresh } from "./lib/auth";
import App from "./App";
import "./index.css";

setAuthTokenGetter(() => getAccessToken());
setTokenRefresher(silentRefresh);

createRoot(document.getElementById("root")!).render(<App />);
