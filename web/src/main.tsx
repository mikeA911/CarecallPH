import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import { supabaseConfigProblems } from "./lib/env";

// Patient links (/book/…, /connect/…, /check, /join/…) load only the small public app; everything
// else loads the staff portal. Each is a separate download, chosen on page load.
const isPublic = /^\/(book\/|connect\/|join\/|check(\/|$))/.test(window.location.pathname);
// Two separate lazy() calls: one import() per expression keeps Vite from
// preloading the staff chunk on patient pages.
const Root = isPublic ? lazy(() => import("./PublicApp")) : lazy(() => import("./StaffApp"));

// A missing or mistyped Supabase setting would otherwise crash to a blank page.
// The /connect invite page is static and doesn't use Supabase, so it still works.
const configProblems = /^\/connect\//.test(window.location.pathname) ? [] : supabaseConfigProblems();

function SetupError() {
  return (
    <div className="auth-screen">
      <div className="auth-card" role="alert" style={{ maxWidth: 520 }}>
        <h1 style={{ marginTop: 0 }}>{isPublic ? "This page isn't available right now" : "Portal setup incomplete"}</h1>
        {isPublic ? (
          <p>Please contact your clinic, or try again later.</p>
        ) : (
          <>
            <p>The portal was built without valid Supabase settings:</p>
            <ul>{configProblems.map((p) => <li key={p}>{p}</li>)}</ul>
            <p className="muted small">
              Fix them in Vercel under Settings → Environment Variables (Production), then
              redeploy. The values are read when the site is built, so a redeploy is required.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      {configProblems.length ? <SetupError /> : (
        <Suspense fallback={<div className="auth-screen"><div className="auth-card">Loading…</div></div>}>
          <Root />
        </Suspense>
      )}
    </BrowserRouter>
  </React.StrictMode>,
);
