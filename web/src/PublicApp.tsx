// Public patient pages: /book/:token (self-booking), /connect/:token (chat
// opt-in), /check, /check/:slug (symptom check) and /join/:slug (patient sign-up). Patients open these from a chat message or SMS on their phone, often
// on slow mobile data, so this app is loaded on its own and never pulls in the
// staff portal, its sign-in or the Supabase client (self-booking-link-spec §6).
import { Route, Routes } from "react-router-dom";
import BookPage from "./pages/BookPage";
import ConnectPage from "./pages/ConnectPage";
import CheckPage from "./pages/CheckPage";
import JoinPage from "./pages/JoinPage";

export default function PublicApp() {
  return (
    <Routes>
      <Route path="/book/:token" element={<BookPage />} />
      <Route path="/connect/:token" element={<ConnectPage />} />
      <Route path="/check" element={<CheckPage />} />
      <Route path="/check/:slug" element={<CheckPage />} />
      <Route path="/join/:slug" element={<JoinPage />} />
    </Routes>
  );
}
