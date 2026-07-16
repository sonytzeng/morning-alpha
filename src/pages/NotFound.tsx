import { Link } from "react-router-dom";
import Navbar from "@/components/feature/Navbar";
import Footer from "@/components/feature/Footer";

export default function NotFound() {
  return (
    <div className="ma-page flex min-h-screen flex-col overflow-x-hidden">
      <Navbar />
      <main className="flex flex-1 items-center justify-center px-4 py-16 text-center">
        <section className="ma-card-elevated w-full max-w-lg" aria-labelledby="not-found-title">
          <p className="ma-eyebrow mb-3">404</p>
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
            <i className="ri-compass-3-line text-2xl text-white/55" aria-hidden="true" />
          </div>
          <h1 id="not-found-title" className="text-xl font-bold text-white md:text-2xl">找不到這個頁面</h1>
          <p className="ma-body mx-auto mt-3 max-w-md">網址可能已變更，或內容目前不對外開放。你可以回到首頁，或查看最新的今日判斷。</p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/" className="ma-btn-secondary w-full sm:w-auto">返回首頁</Link>
            <Link to="/report/today" className="ma-btn-primary w-full sm:w-auto">查看今日判斷</Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
