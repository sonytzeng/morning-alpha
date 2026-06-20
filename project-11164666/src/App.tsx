import { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import { AppRoutes } from "./router";
import { I18nextProvider } from "react-i18next";
import i18n from "./i18n";
import { initGA } from "@/utils/analytics";
import ErrorBoundary from "@/components/base/ErrorBoundary";


function App() {
  useEffect(() => {
    initGA();
  }, []);

  return (
    <ErrorBoundary
      fallbackTitle="Morning Alpha 暫時無法使用"
      fallbackMessage="系統發生未預期的錯誤，請稍後再試。"
    >
      <I18nextProvider i18n={i18n}>
        <BrowserRouter basename={__BASE_PATH__}>
          <AppRoutes />
        </BrowserRouter>
      </I18nextProvider>
    </ErrorBoundary>
  );
}

export default App;
