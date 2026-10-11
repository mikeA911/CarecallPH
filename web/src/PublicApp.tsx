// Public patient pages: /book/:token (self-booking) and /connect/:token (chat
// opt-in). Patients open these from a chat message or SMS on their phone, often
// on slow mobile data, so this app is loaded on its own and never pulls in the
// staff portal, its sign-in or the Supabase client (self-booking-link-spec §6).
import { Route, Routes } from "react-router-dom";
import BookPage from "./pages/BookPage";
import ConnectPage from "./pages/ConnectPage";

export default function PublicApp() {
  return (
    <Routes>
      <Route path="/book/:token" element={<BookPage />} />
      <Route path="/connect/:token" element={<ConnectPage />} />
    </Routes>
  );
}
