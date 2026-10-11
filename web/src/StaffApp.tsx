// The signed-in staff portal with its session and clinic context.
import App from "./App";
import { SessionProvider } from "./lib/session";
import { ClinicProvider } from "./lib/clinic";

export default function StaffApp() {
  return (
    <SessionProvider>
      <ClinicProvider>
        <App />
      </ClinicProvider>
    </SessionProvider>
  );
}
