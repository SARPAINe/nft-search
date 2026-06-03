import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import SearchPage from "./pages/SearchPage";
import AddNftPage from "./pages/AddNftPage";
import "./styles/global.css";

function App() {
  return (
    <BrowserRouter>
      <header className="topbar">
        <div className="brand">NFT Search</div>
        <nav>
          <NavLink to="/search" className={({ isActive }) => (isActive ? "active" : "")}>Search</NavLink>
          <NavLink to="/add" className={({ isActive }) => (isActive ? "active" : "")}>Add NFT</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/search" replace />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/add" element={<AddNftPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
