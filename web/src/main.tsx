import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";

// Patient links (/book/…, /connect/…) load only the small public app; everything
// else loads the staff portal. Each is a separate download, chosen on page load.
const isPublic = /^\/(book|connect)\//.test(window.location.pathname);
// Two separate lazy() calls: one import() per expression keeps Vite from
// preloading the staff chunk on patient pages.
const Root = isPublic ? lazy(() => import("./PublicApp")) : lazy(() => import("./StaffApp"));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={<div className="auth-screen"><div className="auth-card">Loading…</div></div>}>
        <Root />
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>,
);
